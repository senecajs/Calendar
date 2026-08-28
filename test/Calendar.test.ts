/* Copyright © 2024–2026 Seneca Project Contributors, MIT License. */

import Seneca from 'seneca'

import CalendarDoc from '../src/CalendarDoc'
import Calendar from '../src/Calendar'

const nextDue = (Calendar as any).nextDue
const crossedStages = (Calendar as any).crossedStages
const buildIcs = (Calendar as any).buildIcs

const MS_DAY = 24 * 60 * 60 * 1000
const MS_HOUR = 60 * 60 * 1000


describe('Calendar', () => {
  test('load-plugin', async () => {
    expect(CalendarDoc).toBeDefined()
    const seneca = Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Calendar)
    await seneca.ready()
  })


  test('add-get-list-update-remove', async () => {
    const seneca = makeSeneca()

    const due = Date.UTC(2026, 5, 1)
    const add0 = await seneca.post('sys:calendar,add:event', {
      key: 'tls-api',
      kind: 'tls',
      title: 'API cert renewal',
      description: 'Renew api.example.com',
      due,
      remindBefore: [7 * MS_DAY, MS_DAY],
      severity: 'warn',
      tags: ['infra'],
      meta: { host: 'api.example.com' },
    })
    expect(add0).toMatchObject({
      ok: true,
      event: {
        key: 'tls-api',
        kind: 'tls',
        title: 'API cert renewal',
        due,
        status: 'active',
        notifiedStages: [],
        recurrence: 'none',
      },
    })

    const addDup = await seneca.post('sys:calendar,add:event', {
      key: 'tls-api',
      due: due + 1,
    })
    expect(addDup).toMatchObject({ ok: false, why: 'key-exists' })

    const addExisting = await seneca.post('sys:calendar,add:event', {
      key: 'tls-api',
      due: due + 1,
      existing: true,
    })
    expect(addExisting).toMatchObject({
      ok: true,
      why: 'existing',
      event: { key: 'tls-api', due },
    })

    const get0 = await seneca.post('sys:calendar,get:event,key:tls-api')
    expect(get0).toMatchObject({ ok: true, event: { key: 'tls-api' } })

    const getMissing = await seneca.post('sys:calendar,get:event,key:nope')
    expect(getMissing).toMatchObject({ ok: false, event: undefined })

    const list0 = await seneca.post('sys:calendar,list:event')
    expect(list0.ok).toBe(true)
    expect(list0.list).toHaveLength(1)

    const upd0 = await seneca.post('sys:calendar,update:event', {
      key: 'tls-api',
      title: 'API cert renewal (prod)',
      severity: 'critical',
    })
    expect(upd0).toMatchObject({
      ok: true,
      event: { title: 'API cert renewal (prod)', severity: 'critical' },
    })

    const updMissing = await seneca.post('sys:calendar,update:event', {
      key: 'missing',
      title: 'x',
    })
    expect(updMissing).toMatchObject({ ok: false, why: 'key-not-found' })

    const rem0 = await seneca.post('sys:calendar,remove:event,key:tls-api')
    expect(rem0).toMatchObject({ ok: true, event: { key: 'tls-api' } })

    const rem1 = await seneca.post('sys:calendar,remove:event,key:tls-api')
    expect(rem1).toMatchObject({ ok: false, why: 'key-not-found' })

    const list1 = await seneca.post('sys:calendar,list:event')
    expect(list1.list).toHaveLength(0)
  })


  test('invalid-key-rejected-valid-roundtrips', async () => {
    const seneca = makeSeneca()
    const due = Date.UTC(2026, 0, 1)

    const bad = await seneca.post('sys:calendar,add:event', {
      key: 'tls/api#1',
      due,
    })
    expect(bad).toMatchObject({ ok: false, why: 'invalid-key' })

    const badQ = await seneca.post('sys:calendar,add:event', {
      key: 'has?query',
      due,
    })
    expect(badQ).toMatchObject({ ok: false, why: 'invalid-key' })

    const good = await seneca.post('sys:calendar,add:event', {
      key: 'tls.api_v1:prod-2',
      due,
    })
    expect(good).toMatchObject({
      ok: true,
      event: { key: 'tls.api_v1:prod-2', id: 'tls.api_v1:prod-2' },
    })

    const got = await seneca.post('sys:calendar,get:event', {
      key: 'tls.api_v1:prod-2',
    })
    expect(got).toMatchObject({ ok: true, event: { key: 'tls.api_v1:prod-2' } })
  })


  test('due-events-with-injected-now', async () => {
    const due = Date.UTC(2026, 0, 15)
    let now = due - 10 * MS_DAY
    const seneca = makeSeneca({ now: () => now })

    await seneca.post('sys:calendar,add:event', {
      key: 'secret-a',
      due,
      remindBefore: [7 * MS_DAY, MS_DAY],
    })

    let dueRes = await seneca.post('sys:calendar,due:events')
    expect(dueRes).toMatchObject({ ok: true, list: [] })

    now = due - 7 * MS_DAY
    dueRes = await seneca.post('sys:calendar,due:events')
    expect(dueRes.list).toHaveLength(1)
    expect(dueRes.list[0].key).toBe('secret-a')

    dueRes = await seneca.post('sys:calendar,due:events', {
      now: due - 10 * MS_DAY,
    })
    expect(dueRes.list).toHaveLength(0)
  })


  test('notify-due-stage-dedupe', async () => {
    const due = Date.UTC(2026, 2, 1)
    let now = due - 30 * MS_DAY
    const notified: any[] = []

    const seneca = makeSeneca({
      now: () => now,
      notifyCallback: function (data: any) {
        notified.push(data)
      },
    })

    await seneca.post('sys:calendar,add:event', {
      key: 'token-rot',
      due,
      remindBefore: [30 * MS_DAY, 7 * MS_DAY, MS_DAY],
    })

    now = due - 30 * MS_DAY
    let res = await seneca.post('sys:calendar,notify:due')
    expect(res.notified).toHaveLength(1)
    expect(res.notified[0].stages).toEqual([30 * MS_DAY])
    expect(notified).toHaveLength(1)

    res = await seneca.post('sys:calendar,notify:due')
    expect(res.notified).toHaveLength(0)
    expect(notified).toHaveLength(1)

    now = due - 7 * MS_DAY
    res = await seneca.post('sys:calendar,notify:due')
    expect(res.notified).toHaveLength(1)
    expect(res.notified[0].stages).toEqual([7 * MS_DAY])
    expect(notified).toHaveLength(2)

    now = due
    res = await seneca.post('sys:calendar,notify:due')
    expect(res.notified[0].stages.sort((a: number, b: number) => b - a)).toEqual([
      MS_DAY,
      0,
    ])
  })


  test('notify-delivery-failure-does-not-mark-stages', async () => {
    const due = Date.UTC(2026, 3, 1)
    const now = due
    let failA = true

    const seneca = makeSeneca({ now: () => now, record: true })

    seneca.message('sys:calendar,hook:notify', async function (msg: any) {
      if (msg.event && msg.event.key === 'ev-a' && failA) {
        throw new Error('boom')
      }
      if (msg.event && msg.event.key === 'ev-b') {
        return { ok: false, why: 'channel-down' }
      }
      return { ok: true }
    })

    await seneca.post('sys:calendar,add:event', {
      key: 'ev-a',
      due,
      remindBefore: [],
    })
    await seneca.post('sys:calendar,add:event', {
      key: 'ev-b',
      due,
      remindBefore: [],
    })
    await seneca.post('sys:calendar,add:event', {
      key: 'ev-c',
      due,
      remindBefore: [],
    })

    const res = await seneca.post('sys:calendar,notify:due')
    expect(res.notified.map((n: any) => n.key).sort()).toEqual(['ev-c'])
    expect(res.failed.map((f: any) => f.key).sort()).toEqual(['ev-a', 'ev-b'])

    const a = await seneca.post('sys:calendar,get:event,key:ev-a')
    const b = await seneca.post('sys:calendar,get:event,key:ev-b')
    const c = await seneca.post('sys:calendar,get:event,key:ev-c')
    expect(a.event.notifiedStages).toEqual([])
    expect(b.event.notifiedStages).toEqual([])
    expect(c.event.notifiedStages).toEqual([0])

    let notes = await seneca.post('sys:calendar,list:notifications')
    expect(notes.list.length).toBe(3)
    const byKey: any = {}
    for (const n of notes.list) byKey[n.event_key] = n
    expect(byKey['ev-a'].delivered).toBe(false)
    expect(byKey['ev-a'].attempts).toBe(1)
    expect(byKey['ev-b'].delivered).toBe(false)
    expect(byKey['ev-c'].delivered).toBe(true)

    // Re-poll while still failing: upsert same rows (no unbounded growth)
    await seneca.post('sys:calendar,notify:due')
    notes = await seneca.post('sys:calendar,list:notifications')
    expect(notes.list.length).toBe(3)
    for (const n of notes.list) byKey[n.event_key] = n
    expect(byKey['ev-a'].attempts).toBe(2)
    expect(byKey['ev-b'].attempts).toBe(2)
    expect(byKey['ev-c'].attempts).toBe(1) // success not retried

    // Retry after fixing A — stage should fire once and stick
    failA = false
    const retry = await seneca.post('sys:calendar,notify:due')
    expect(retry.notified.map((n: any) => n.key).sort()).toEqual(['ev-a'])
    expect(retry.failed.map((f: any) => f.key)).toContain('ev-b')

    const a2 = await seneca.post('sys:calendar,get:event,key:ev-a')
    expect(a2.event.notifiedStages).toEqual([0])

    notes = await seneca.post('sys:calendar,list:notifications')
    expect(notes.list.length).toBe(3)
    for (const n of notes.list) byKey[n.event_key] = n
    expect(byKey['ev-a'].delivered).toBe(true)
    expect(byKey['ev-a'].attempts).toBe(3)

    const retry2 = await seneca.post('sys:calendar,notify:due')
    expect(retry2.notified.find((n: any) => n.key === 'ev-a')).toBeUndefined()
  })


  test('notify-digest-failure-leaves-stages-unmarked', async () => {
    const due = Date.UTC(2026, 7, 2)
    const now = due
    let fail = true

    const seneca = makeSeneca({ now: () => now, record: true })
    seneca.message('sys:calendar,hook:notify', async function () {
      if (fail) return { ok: false, why: 'digest-down' }
      return { ok: true }
    })

    await seneca.post('sys:calendar,add:event', {
      key: 'dg-a',
      due,
      remindBefore: [],
    })
    await seneca.post('sys:calendar,add:event', {
      key: 'dg-b',
      due,
      remindBefore: [],
    })

    const bad = await seneca.post('sys:calendar,notify:due', { digest: true })
    expect(bad.notified).toHaveLength(0)
    expect(bad.failed.map((f: any) => f.key).sort()).toEqual(['dg-a', 'dg-b'])

    const a0 = await seneca.post('sys:calendar,get:event,key:dg-a')
    expect(a0.event.notifiedStages).toEqual([])

    let notes = await seneca.post('sys:calendar,list:notifications')
    expect(notes.list.length).toBe(2)
    expect(notes.list.every((n: any) => n.delivered === false)).toBe(true)

    // Second failed digest upserts, does not duplicate
    await seneca.post('sys:calendar,notify:due', { digest: true })
    notes = await seneca.post('sys:calendar,list:notifications')
    expect(notes.list.length).toBe(2)
    expect(notes.list.every((n: any) => n.attempts === 2)).toBe(true)

    fail = false
    const ok = await seneca.post('sys:calendar,notify:due', { digest: true })
    expect(ok.notified.map((n: any) => n.key).sort()).toEqual(['dg-a', 'dg-b'])
    notes = await seneca.post('sys:calendar,list:notifications')
    expect(notes.list.length).toBe(2)
    expect(notes.list.every((n: any) => n.delivered === true)).toBe(true)
  })


  test('notify-hook', async () => {
    const due = Date.UTC(2026, 3, 1)
    const now = due
    const hookPayloads: any[] = []

    const seneca = makeSeneca({ now: () => now })

    seneca.message('sys:calendar,hook:notify', async function (msg: any) {
      hookPayloads.push(msg)
      return { ok: true, via: 'hook' }
    })

    await seneca.post('sys:calendar,add:event', {
      key: 'hook-ev',
      due,
      remindBefore: [],
    })

    const res = await seneca.post('sys:calendar,notify:due')
    expect(res.notified).toHaveLength(1)
    expect(hookPayloads).toHaveLength(1)
    expect(hookPayloads[0].event.key).toBe('hook-ev')
    expect(hookPayloads[0].stages).toContain(0)
  })


  test('ack-defaults-to-acknowledged-done-requires-flag', async () => {
    const due = Date.UTC(2026, 0, 10)
    let now = due
    const seneca = makeSeneca({ now: () => now })

    await seneca.post('sys:calendar,add:event', {
      key: 'weekly-check',
      due,
      recurrence: 'weekly',
      remindBefore: [MS_DAY],
    })

    await seneca.post('sys:calendar,notify:due')
    const ack0 = await seneca.post('sys:calendar,ack:event,key:weekly-check')
    expect(ack0).toMatchObject({
      ok: true,
      event: {
        status: 'active',
        due: due + 7 * MS_DAY,
        notifiedStages: [],
        lastNotified: null,
      },
    })

    await seneca.post('sys:calendar,add:event', {
      key: 'once',
      due,
      recurrence: 'none',
    })
    const ack1 = await seneca.post('sys:calendar,ack:event,key:once')
    expect(ack1).toMatchObject({
      ok: true,
      event: { status: 'acknowledged', notifiedStages: [] },
    })

    // acknowledged (non-active) is not due
    now = due + 1000
    let dueRes = await seneca.post('sys:calendar,due:events')
    expect(dueRes.list.find((e: any) => e.key === 'once')).toBeUndefined()

    await seneca.post('sys:calendar,add:event', {
      key: 'once-done',
      due,
      recurrence: 'none',
    })
    const ack2 = await seneca.post('sys:calendar,ack:event', {
      key: 'once-done',
      done: true,
    })
    expect(ack2).toMatchObject({
      ok: true,
      event: { status: 'done' },
    })
  })


  test('update-validates-before-assign', async () => {
    const due = Date.UTC(2026, 0, 1)
    const seneca = makeSeneca()
    await seneca.post('sys:calendar,add:event', {
      key: 'upd-me',
      due,
      severity: 'info',
      title: 'keep',
    })

    const bad = await seneca.post('sys:calendar,update:event', {
      key: 'upd-me',
      title: 'mutated',
      severity: 'nope',
    })
    expect(bad).toMatchObject({ ok: false, why: 'invalid-severity' })

    const got = await seneca.post('sys:calendar,get:event,key:upd-me')
    expect(got.event.title).toBe('keep')
    expect(got.event.severity).toBe('info')
  })


  test('monthly-yearly-calendar-arithmetic', () => {
    const jan31 = Date.UTC(2026, 0, 31, 12, 0, 0)
    const feb = new Date(nextDue(jan31, 'monthly'))
    expect(feb.getUTCFullYear()).toBe(2026)
    expect(feb.getUTCMonth()).toBe(1)
    expect(feb.getUTCDate()).toBe(28)

    const feb28 = Date.UTC(2025, 1, 28, 12, 0, 0)
    const nextYear = new Date(nextDue(feb28, 'yearly'))
    expect(nextYear.getUTCFullYear()).toBe(2026)
    expect(nextYear.getUTCMonth()).toBe(1)
    expect(nextYear.getUTCDate()).toBe(28)

    expect(nextDue(1000, 'interval-ms', 500)).toBe(1500)
    expect(nextDue(1000, 'daily')).toBe(1000 + MS_DAY)
  })


  test('monthly-ack-no-drift', async () => {
    const due = Date.UTC(2026, 0, 31, 15, 0, 0)
    const seneca = makeSeneca({ now: () => due })

    await seneca.post('sys:calendar,add:event', {
      key: 'monthly-cert',
      due,
      recurrence: 'monthly',
    })

    const ack0 = await seneca.post('sys:calendar,ack:event,key:monthly-cert')
    const rolled = new Date(ack0.event.due)
    expect(rolled.getUTCMonth()).toBe(1)
    expect(rolled.getUTCDate()).toBe(28)
    expect(rolled.getUTCHours()).toBe(15)
  })


  test('snooze-resets-stages-and-hides-from-due', async () => {
    const due = Date.UTC(2026, 4, 1)
    let now = due - MS_HOUR
    const seneca = makeSeneca({ now: () => now })

    await seneca.post('sys:calendar,add:event', {
      key: 'snooze-me',
      due,
      remindBefore: [2 * MS_HOUR],
    })

    await seneca.post('sys:calendar,notify:due')
    let get0 = await seneca.post('sys:calendar,get:event,key:snooze-me')
    expect(get0.event.notifiedStages.length).toBeGreaterThan(0)

    const until = due + 2 * MS_DAY
    const snooze0 = await seneca.post('sys:calendar,snooze:event', {
      key: 'snooze-me',
      until,
    })
    expect(snooze0).toMatchObject({
      ok: true,
      event: {
        status: 'snoozed',
        snoozeUntil: until,
        notifiedStages: [],
        lastNotified: null,
      },
    })

    let dueRes = await seneca.post('sys:calendar,due:events')
    expect(dueRes.list).toHaveLength(0)

    now = due + MS_DAY
    dueRes = await seneca.post('sys:calendar,due:events')
    expect(dueRes.list).toHaveLength(0)

    now = until + 1
    dueRes = await seneca.post('sys:calendar,due:events')
    expect(dueRes.list).toHaveLength(1)

    const notified: any[] = []
    seneca.message('sys:calendar,hook:notify', async function (msg: any) {
      notified.push(msg)
      return { ok: true }
    })

    const nres = await seneca.post('sys:calendar,notify:due')
    expect(nres.notified.length).toBe(1)
    expect(notified.length).toBe(1)
  })


  test('export-ics', async () => {
    const due = Date.UTC(2026, 6, 15, 12, 0, 0)
    const seneca = makeSeneca()

    await seneca.post('sys:calendar,add:event', {
      key: 'ics-yearly',
      title: 'Yearly cert',
      description: 'Line1\nLine2',
      due,
      kind: 'tls',
      severity: 'warn',
      recurrence: 'yearly',
    })
    await seneca.post('sys:calendar,add:event', {
      key: 'ics-once',
      title: 'One shot',
      due: due + MS_DAY,
      recurrence: 'none',
    })

    const res = await seneca.post('sys:calendar,export:ics')
    expect(res.ok).toBe(true)
    expect(res.count).toBe(2)
    expect(res.ics).toContain('BEGIN:VCALENDAR')
    expect(res.ics).toContain('BEGIN:VEVENT')
    expect(res.ics).toContain('UID:ics-yearly')
    expect(res.ics).toContain('SUMMARY:Yearly cert')
    expect(res.ics).toContain('RRULE:FREQ=YEARLY')
    expect(res.ics).toContain('CATEGORIES:warn,tls')
    expect(res.ics).not.toMatch(/UID:ics-once[\s\S]*RRULE/)

    // Helper round-trip of key fields
    const built = buildIcs([
      {
        key: 'x',
        title: 'T',
        due,
        severity: 'info',
        kind: 'secret',
        recurrence: 'weekly',
      },
    ])
    expect(built).toContain('UID:x')
    expect(built).toContain('RRULE:FREQ=WEEKLY')
    expect(built).toContain('DTSTART:20260715T120000Z')
  })


  test('notify-digest', async () => {
    const due = Date.UTC(2026, 7, 1)
    const now = due
    const payloads: any[] = []

    const seneca = makeSeneca({
      now: () => now,
      notifyCallback: function (data: any) {
        payloads.push(data)
      },
    })

    await seneca.post('sys:calendar,add:event', {
      key: 'd1',
      due,
      remindBefore: [],
    })
    await seneca.post('sys:calendar,add:event', {
      key: 'd2',
      due,
      remindBefore: [],
    })

    const res = await seneca.post('sys:calendar,notify:due', { digest: true })
    expect(res.digest).toBe(true)
    expect(payloads).toHaveLength(1)
    expect(payloads[0].digest).toBe(true)
    expect(payloads[0].events).toHaveLength(2)
    expect(res.notified.map((n: any) => n.key).sort()).toEqual(['d1', 'd2'])

    const d1 = await seneca.post('sys:calendar,get:event,key:d1')
    const d2 = await seneca.post('sys:calendar,get:event,key:d2')
    expect(d1.event.notifiedStages).toEqual([0])
    expect(d2.event.notifiedStages).toEqual([0])

    const again = await seneca.post('sys:calendar,notify:due', { digest: true })
    expect(again.notified).toHaveLength(0)
    expect(payloads).toHaveLength(1)
  })


  test('refresh-event-source-hook', async () => {
    const due = Date.UTC(2026, 8, 1)
    const now = due
    const seneca = makeSeneca({ now: () => now })

    await seneca.post('sys:calendar,add:event', {
      key: 'live-tls',
      kind: 'tls',
      due,
    })

    // No hook → no-op
    const noop = await seneca.post('sys:calendar,refresh:event,key:live-tls')
    expect(noop).toMatchObject({
      ok: true,
      changed: false,
      why: 'no-source-hook',
      event: { due },
    })

    const next = due + 30 * MS_DAY
    seneca.message('sys:calendar,hook:source', async function (msg: any) {
      if (msg.key === 'live-tls') {
        return { ok: true, due: next }
      }
      return { ok: true }
    })

    const refreshed = await seneca.post(
      'sys:calendar,refresh:event,key:live-tls',
    )
    expect(refreshed).toMatchObject({
      ok: true,
      changed: true,
      event: { due: next, notifiedStages: [] },
    })

    const batch = await seneca.post('sys:calendar,refresh:events')
    expect(batch.ok).toBe(true)
    expect(batch.list[0].changed).toBe(false) // same due returned
  })


  test('crossedStages-helper', () => {
    const due = 1_000_000
    expect(crossedStages(due, [1000, 100], due - 2000)).toEqual([])
    expect(crossedStages(due, [1000, 100], due - 1000)).toEqual([1000])
    expect(crossedStages(due, [1000, 100], due - 50)).toEqual([1000, 100])
    expect(crossedStages(due, [1000, 100], due)).toEqual([1000, 100, 0])
  })


  test('tick-clears-on-close', async () => {
    const seneca = makeSeneca({
      tick: { active: true, interval: 60_000 },
    })
    await seneca.ready()

    await new Promise<void>((resolve, reject) => {
      seneca.close((err: any) => (err ? reject(err) : resolve()))
    })
    expect(true).toBe(true)
  })
})


function makeSeneca(opts: any = {}) {
  const seneca = Seneca({ legacy: false })
    .test()
    .use('promisify')
    .use('entity')
    .use(Calendar, opts)
  return seneca
}
