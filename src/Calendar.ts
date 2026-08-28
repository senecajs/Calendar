/* Copyright © 2024–2026 Seneca Project Contributors, MIT License. */


export type Recurrence =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'interval-ms'

export type Severity = 'info' | 'warn' | 'critical'
export type Status = 'active' | 'acknowledged' | 'snoozed' | 'done'

export type CalendarEvent = {
  key: string
  kind?: string
  title?: string
  description?: string
  due: number
  remindBefore: number[]
  recurrence: Recurrence
  severity: Severity
  status: Status
  snoozeUntil?: number | null
  lastNotified?: number | null
  notifiedStages: number[]
  assignee?: string | null
  tags?: string[]
  meta?: Record<string, any>
  /** For recurrence === 'interval-ms' */
  intervalMs?: number
}


type CanonOpt = {
  zone: string | undefined
  base: string | undefined
  name: string | undefined
}

type CalendarOptionsFull = {
  debug: boolean
  canon: CanonOpt
  /** Injectable clock; defaults to Date.now */
  now: () => number
  /** Default remind-before offsets (ms) applied when add:event omits remindBefore */
  remindBefore: number[]
  tick: {
    active: boolean
    interval: number
  }
  /** Optional delivery callback; also see sys:calendar,hook:notify */
  notifyCallback: (data: any) => any
  /** Persist notification outbox rows on each emission attempt */
  record: boolean
  /** Entity canon for notification outbox rows */
  recordCanon: CanonOpt
}

export type CalendarOptions = Partial<CalendarOptionsFull>


const MS_DAY = 24 * 60 * 60 * 1000
const MS_WEEK = 7 * MS_DAY

/** Cosmos-safe / portable entity ids (no / \\ # ?). */
const KEY_RE = /^[A-Za-z0-9._:-]+$/

const VALID_RECURRENCE: Recurrence[] = [
  'none',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'interval-ms',
]

const VALID_SEVERITY: Severity[] = ['info', 'warn', 'critical']
const VALID_STATUS: Status[] = ['active', 'acknowledged', 'snoozed', 'done']


/** Add calendar months (UTC) without day-of-month overflow (e.g. Jan 31 + 1m → Feb 28/29). */
function addMonths(ms: number, months: number): number {
  const d = new Date(ms)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.getTime()
}


function addYears(ms: number, years: number): number {
  return addMonths(ms, years * 12)
}


function nextDue(
  due: number,
  recurrence: Recurrence,
  intervalMs?: number,
): number {
  switch (recurrence) {
    case 'daily':
      return due + MS_DAY
    case 'weekly':
      return due + MS_WEEK
    case 'monthly':
      return addMonths(due, 1)
    case 'yearly':
      return addYears(due, 1)
    case 'interval-ms': {
      const step = null != intervalMs && intervalMs > 0 ? intervalMs : MS_DAY
      return due + step
    }
    case 'none':
    default:
      return due
  }
}


/** Stages (remindBefore values) that have been crossed at `now` relative to `due`. */
function crossedStages(
  due: number,
  remindBefore: number[],
  now: number,
): number[] {
  const stages = uniqueSortedDesc(remindBefore)
  const out: number[] = []
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]
    if (now >= due - stage) {
      out.push(stage)
    }
  }
  if (now >= due && out.indexOf(0) < 0) {
    out.push(0)
  }
  return out
}


function uniqueSortedDesc(values: number[]): number[] {
  const seen: Record<string, boolean> = {}
  const out: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i])
    if (!isFinite(v) || v < 0) continue
    const k = String(v)
    if (seen[k]) continue
    seen[k] = true
    out.push(v)
  }
  out.sort((a, b) => b - a)
  return out
}


function stagesNotYetNotified(
  crossed: number[],
  notifiedStages: number[],
): number[] {
  const notified: Record<string, boolean> = {}
  for (let i = 0; i < notifiedStages.length; i++) {
    notified[String(notifiedStages[i])] = true
  }
  const fresh: number[] = []
  for (let i = 0; i < crossed.length; i++) {
    if (!notified[String(crossed[i])]) {
      fresh.push(crossed[i])
    }
  }
  return fresh
}


function isDueWindow(entry: any, now: number): boolean {
  if ('active' === entry.status) {
    // ok
  } else if (
    'snoozed' === entry.status &&
    null != entry.snoozeUntil &&
    now >= entry.snoozeUntil
  ) {
    // woken by clock
  } else {
    return false
  }

  const remindBefore: number[] = Array.isArray(entry.remindBefore)
    ? entry.remindBefore
    : []
  const maxRemind = remindBefore.reduce(
    (m: number, v: number) => (v > m ? v : m),
    0,
  )
  return now >= entry.due - maxRemind
}


function canonString(canon: CanonOpt): string {
  return (
    ('string' === typeof canon.zone ? canon.zone : '-') +
    '/' +
    ('string' === typeof canon.base ? canon.base : '-') +
    '/' +
    ('string' === typeof canon.name ? canon.name : '-')
  )
}


function plainEvent(entry: any): any {
  return null == entry ? undefined : entry.data$(false)
}


/** Delivery succeeds when there is no explicit failure ({ok:false}) and no throw. */
function isDeliveryOk(result: any): boolean {
  if (null == result) return true
  if ('object' === typeof result && false === result.ok) return false
  return true
}


function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}


/** Format UTC ms as ICS basic datetime (YYYYMMDDTHHMMSSZ). */
function icsDate(ms: number): string {
  const d = new Date(ms)
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    'Z'
  )
}


function icsEscape(text: string): string {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}


function rruleFor(recurrence: Recurrence): string | null {
  switch (recurrence) {
    case 'daily':
      return 'FREQ=DAILY'
    case 'weekly':
      return 'FREQ=WEEKLY'
    case 'monthly':
      return 'FREQ=MONTHLY'
    case 'yearly':
      return 'FREQ=YEARLY'
    default:
      return null
  }
}


function buildIcs(events: any[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//seneca//calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  const stamp = icsDate(Date.now())

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    const cats: string[] = []
    if (ev.severity) cats.push(String(ev.severity))
    if (ev.kind) cats.push(String(ev.kind))

    lines.push('BEGIN:VEVENT')
    lines.push('UID:' + icsEscape(String(ev.key)))
    lines.push('DTSTAMP:' + stamp)
    lines.push('DTSTART:' + icsDate(Number(ev.due)))
    lines.push('SUMMARY:' + icsEscape(null != ev.title ? ev.title : ev.key))
    if (ev.description) {
      lines.push('DESCRIPTION:' + icsEscape(ev.description))
    }
    if (cats.length) {
      lines.push('CATEGORIES:' + cats.map(icsEscape).join(','))
    }
    const rrule = rruleFor(ev.recurrence)
    if (rrule) {
      lines.push('RRULE:' + rrule)
    }
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}


function Calendar(this: any, options: CalendarOptionsFull) {
  const seneca: any = this

  const { Default } = seneca.valid

  const canon = canonString(options.canon)
  const recordCanon = canonString(options.recordCanon)
  const getNow = typeof options.now === 'function' ? options.now : () => Date.now()

  let tickTimer: ReturnType<typeof setInterval> | null = null

  seneca
    .fix('sys:calendar')
    .message('add:event', {
      key: String,
      due: Number,
      existing: Default(false),
    }, msgAddEvent)
    .message('get:event', { key: String }, msgGetEvent)
    .message('list:event', { q: Default({}) }, msgListEvent)
    .message('update:event', { key: String }, msgUpdateEvent)
    .message('remove:event', { key: String }, msgRemoveEvent)
    .message('due:events', {}, msgDueEvents)
    .message('ack:event', { key: String }, msgAckEvent)
    .message('snooze:event', { key: String, until: Number }, msgSnoozeEvent)
    .message('notify:due', {}, msgNotifyDue)
    .message('export:ics', { q: Default({}) }, msgExportIcs)
    .message('list:notifications', { q: Default({}) }, msgListNotifications)
    .message('refresh:event', { key: String }, msgRefreshEvent)
    .message('refresh:events', { q: Default({}) }, msgRefreshEvents)

  // Note: do not register default hook:notify / hook:source actions.
  // Plugin init would re-pin them above handlers added between use() and ready().


  seneca.add('init:Calendar', function (this: any, _msg: any, reply: any) {
    if (options.tick && options.tick.active) {
      const interval =
        options.tick.interval > 0 ? options.tick.interval : 60 * 1000
      tickTimer = setInterval(() => {
        seneca.act('sys:calendar,notify:due', function (err: any) {
          if (err && options.debug) {
            seneca.log.debug('calendar-tick-error', err)
          }
        })
      }, interval)
      if (typeof (tickTimer as any).unref === 'function') {
        ;(tickTimer as any).unref()
      }
    }
    reply()
  })

  seneca.add('role:seneca,cmd:close', function (this: any, msg: any, reply: any) {
    if (null != tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
    this.prior(msg, reply)
  })


  async function deliverPayload(this: any, payload: any): Promise<{
    ok: boolean
    result: any
    error?: any
  }> {
    const seneca = this
    let lastResult: any = undefined

    try {
      if (typeof options.notifyCallback === 'function') {
        lastResult = await options.notifyCallback.call(seneca, payload)
        if (!isDeliveryOk(lastResult)) {
          return { ok: false, result: lastResult }
        }
      }

      if (seneca.find('sys:calendar,hook:notify')) {
        lastResult = await seneca.post('sys:calendar,hook:notify', payload)
        if (!isDeliveryOk(lastResult)) {
          return { ok: false, result: lastResult }
        }
      }

      return { ok: true, result: lastResult }
    } catch (err) {
      return { ok: false, result: lastResult, error: err }
    }
  }


  async function recordNotification(
    this: any,
    data: {
      event_key: string
      stage: number
      when: number
      severity: string
      delivered: boolean
      result: any
      meta?: any
    },
  ) {
    if (!options.record) return
    const seneca = this

    // Stable outbox id: one row per (event_key, stage). Re-polls upsert instead of appending.
    const id = data.event_key + ':' + String(data.stage)
    const result =
      null == data.result
        ? null
        : 'object' === typeof data.result
          ? Object.assign({}, data.result)
          : { value: data.result }
    const meta =
      data.meta && 'object' === typeof data.meta ? Object.assign({}, data.meta) : {}

    let entry = await seneca.entity(recordCanon).load$(id)

    if (null != entry) {
      const prevAttempts =
        'number' === typeof entry.attempts && entry.attempts > 0 ? entry.attempts : 1
      entry.attempts = prevAttempts + 1
      entry.lastTried = data.when
      entry.delivered = data.delivered
      entry.severity = data.severity
      entry.result = result
      entry.meta = Object.assign({}, entry.meta || {}, meta)
      if (data.delivered) {
        entry.deliveredAt = data.when
      }
      await entry.save$()
      return
    }

    await seneca
      .entity(recordCanon)
      .data$({
        id$: id,
        event_key: data.event_key,
        stage: data.stage,
        when: data.when,
        lastTried: data.when,
        attempts: 1,
        severity: data.severity,
        delivered: data.delivered,
        deliveredAt: data.delivered ? data.when : null,
        result,
        meta,
      })
      .save$()
  }


  async function markNotified(
    this: any,
    entry: any,
    fresh: number[],
    now: number,
  ) {
    const notifiedStages: number[] = Array.isArray(entry.notifiedStages)
      ? entry.notifiedStages.slice()
      : []
    entry.notifiedStages = notifiedStages.concat(fresh)
    entry.lastNotified = now
    return entry.save$()
  }


  async function msgAddEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key
    const existing = true === msg.existing

    if (!KEY_RE.test(key)) {
      return {
        ok: false,
        why: 'invalid-key',
      }
    }

    let entry = await seneca.entity(canon).load$(key)

    if (null != entry) {
      if (existing) {
        return {
          ok: true,
          why: 'existing',
          event: plainEvent(entry),
        }
      }
      return {
        ok: false,
        why: 'key-exists',
        event: plainEvent(entry),
      }
    }

    const remindBefore = uniqueSortedDesc(
      Array.isArray(msg.remindBefore) ? msg.remindBefore : options.remindBefore,
    )

    const recurrence: Recurrence =
      VALID_RECURRENCE.indexOf(msg.recurrence) >= 0 ? msg.recurrence : 'none'
    const severity: Severity =
      VALID_SEVERITY.indexOf(msg.severity) >= 0 ? msg.severity : 'info'

    const data: any = {
      id$: key,
      key,
      kind: null != msg.kind ? String(msg.kind) : 'maintenance',
      title: null != msg.title ? String(msg.title) : key,
      description: null != msg.description ? String(msg.description) : '',
      due: Number(msg.due),
      remindBefore,
      recurrence,
      severity,
      status: 'active' as Status,
      snoozeUntil: null,
      lastNotified: null,
      notifiedStages: [],
      assignee: null != msg.assignee ? msg.assignee : null,
      tags: Array.isArray(msg.tags) ? msg.tags.slice() : [],
      meta: msg.meta && 'object' === typeof msg.meta ? Object.assign({}, msg.meta) : {},
    }

    if ('interval-ms' === recurrence) {
      data.intervalMs =
        null != msg.intervalMs
          ? Number(msg.intervalMs)
          : null != msg.meta && null != msg.meta.intervalMs
            ? Number(msg.meta.intervalMs)
            : MS_DAY
    }

    entry = await seneca.entity(canon).data$(data).save$()

    return {
      ok: true,
      event: plainEvent(entry),
    }
  }


  async function msgGetEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key
    const entry = await seneca.entity(canon).load$(key)

    return {
      ok: null != entry,
      event: plainEvent(entry),
    }
  }


  async function msgListEvent(this: any, msg: any) {
    const seneca = this
    const q = msg.q || {}
    let list = await seneca.entity(canon).list$(q)
    list = list.map((entry: any) => entry.data$(false))

    return {
      ok: true,
      list,
    }
  }


  async function msgUpdateEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key

    let entry = await seneca.entity(canon).load$(key)
    if (null == entry) {
      return {
        ok: false,
        why: 'key-not-found',
      }
    }

    // Validate before mutating so a rejected update never partially assigns.
    if (undefined !== msg.recurrence && VALID_RECURRENCE.indexOf(msg.recurrence) < 0) {
      return { ok: false, why: 'invalid-recurrence' }
    }
    if (undefined !== msg.severity && VALID_SEVERITY.indexOf(msg.severity) < 0) {
      return { ok: false, why: 'invalid-severity' }
    }
    if (undefined !== msg.status && VALID_STATUS.indexOf(msg.status) < 0) {
      return { ok: false, why: 'invalid-status' }
    }

    const fields = [
      'kind',
      'title',
      'description',
      'due',
      'severity',
      'status',
      'snoozeUntil',
      'assignee',
      'tags',
      'meta',
      'intervalMs',
      'lastNotified',
      'notifiedStages',
      'recurrence',
    ]

    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]
      if (undefined !== msg[f]) {
        entry[f] = msg[f]
      }
    }

    if (undefined !== msg.remindBefore) {
      entry.remindBefore = uniqueSortedDesc(
        Array.isArray(msg.remindBefore) ? msg.remindBefore : [],
      )
    }

    entry = await entry.save$()

    return {
      ok: true,
      event: plainEvent(entry),
    }
  }


  async function msgRemoveEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key
    const entry = await seneca.entity(canon).load$(key)

    if (null == entry) {
      return {
        ok: false,
        why: 'key-not-found',
      }
    }

    await seneca.entity(canon).remove$(key)

    return {
      ok: true,
      event: plainEvent(entry),
    }
  }


  async function msgDueEvents(this: any, msg: any) {
    const seneca = this
    const now = null != msg.now ? Number(msg.now) : getNow()

    let list = await seneca.entity(canon).list$({})
    const due = list
      .filter((entry: any) => isDueWindow(entry, now))
      .map((entry: any) => entry.data$(false))

    return {
      ok: true,
      now,
      list: due,
    }
  }


  async function msgAckEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key
    const now = null != msg.now ? Number(msg.now) : getNow()

    let entry = await seneca.entity(canon).load$(key)
    if (null == entry) {
      return {
        ok: false,
        why: 'key-not-found',
      }
    }

    const recurrence: Recurrence = entry.recurrence || 'none'

    entry.notifiedStages = []
    entry.lastNotified = null
    entry.snoozeUntil = null

    if ('none' !== recurrence) {
      entry.due = nextDue(entry.due, recurrence, entry.intervalMs)
      entry.status = 'active'
    } else {
      // Plain ack → acknowledged; require done:true to mark done.
      entry.status = true === msg.done ? 'done' : 'acknowledged'
    }

    entry = await entry.save$()

    return {
      ok: true,
      now,
      event: plainEvent(entry),
    }
  }


  async function msgSnoozeEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key
    const until = Number(msg.until)
    const now = null != msg.now ? Number(msg.now) : getNow()

    let entry = await seneca.entity(canon).load$(key)
    if (null == entry) {
      return {
        ok: false,
        why: 'key-not-found',
      }
    }

    if (!isFinite(until) || until <= now) {
      return {
        ok: false,
        why: 'invalid-until',
      }
    }

    entry.status = 'snoozed'
    entry.snoozeUntil = until
    entry.notifiedStages = []
    entry.lastNotified = null

    entry = await entry.save$()

    return {
      ok: true,
      now,
      event: plainEvent(entry),
    }
  }


  async function collectPending(this: any, now: number) {
    const seneca = this
    let list = await seneca.entity(canon).list$({})
    const pending: any[] = []

    for (let i = 0; i < list.length; i++) {
      let entry = list[i]

      if (
        'snoozed' === entry.status &&
        null != entry.snoozeUntil &&
        now >= entry.snoozeUntil
      ) {
        entry.status = 'active'
        entry.snoozeUntil = null
      }

      if (!isDueWindow(entry, now)) {
        continue
      }

      const remindBefore: number[] = Array.isArray(entry.remindBefore)
        ? entry.remindBefore
        : []
      const notifiedStages: number[] = Array.isArray(entry.notifiedStages)
        ? entry.notifiedStages
        : []

      const crossed = crossedStages(entry.due, remindBefore, now)
      const fresh = stagesNotYetNotified(crossed, notifiedStages)

      if (0 === fresh.length) {
        continue
      }

      pending.push({
        entry,
        fresh,
        payload: {
          event: entry.data$(false),
          stages: fresh,
          now,
        },
      })
    }

    return pending
  }


  async function writeOutboxFor(
    this: any,
    item: any,
    now: number,
    delivered: boolean,
    result: any,
    error?: any,
    meta?: any,
  ) {
    const seneca = this
    const severity = item.entry.severity || 'info'
    for (let s = 0; s < item.fresh.length; s++) {
      await recordNotification.call(seneca, {
        event_key: item.entry.key,
        stage: item.fresh[s],
        when: now,
        severity,
        delivered,
        result,
        meta: Object.assign({}, meta || {}, error ? { error: error && error.message ? String(error.message) : String(error) } : {}),
      })
    }
  }


  async function msgNotifyDue(this: any, msg: any) {
    const seneca = this
    const now = null != msg.now ? Number(msg.now) : getNow()
    const digest = true === msg.digest

    const pending = await collectPending.call(seneca, now)
    const emissions: any[] = []
    const failures: any[] = []

    if (0 === pending.length) {
      return { ok: true, now, notified: [], failed: [] }
    }

    if (digest) {
      const payload = {
        digest: true,
        events: pending.map((p: any) => p.payload),
        now,
      }

      const delivery = await deliverPayload.call(seneca, payload)

      for (let i = 0; i < pending.length; i++) {
        const item = pending[i]
        await writeOutboxFor.call(
          seneca,
          item,
          now,
          delivery.ok,
          delivery.result,
          delivery.error,
          { digest: true },
        )

        if (delivery.ok) {
          item.entry = await markNotified.call(seneca, item.entry, item.fresh, now)
          emissions.push({
            key: item.entry.key,
            stages: item.fresh,
            event: plainEvent(item.entry),
          })
        } else {
          failures.push({
            key: item.entry.key,
            stages: item.fresh,
            why: 'delivery-failed',
          })
        }
      }

      return {
        ok: true,
        now,
        digest: true,
        notified: emissions,
        failed: failures,
      }
    }

    // Per-event delivery: one failure must not abort the batch.
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]
      const delivery = await deliverPayload.call(seneca, item.payload)

      await writeOutboxFor.call(
        seneca,
        item,
        now,
        delivery.ok,
        delivery.result,
        delivery.error,
      )

      if (!delivery.ok) {
        failures.push({
          key: item.entry.key,
          stages: item.fresh,
          why: 'delivery-failed',
        })
        if (options.debug && delivery.error) {
          seneca.log.debug('calendar-notify-error', item.entry.key, delivery.error)
        }
        continue
      }

      item.entry = await markNotified.call(seneca, item.entry, item.fresh, now)
      emissions.push({
        key: item.entry.key,
        stages: item.fresh,
        event: plainEvent(item.entry),
      })
    }

    return {
      ok: true,
      now,
      notified: emissions,
      failed: failures,
    }
  }


  async function msgExportIcs(this: any, msg: any) {
    const seneca = this
    const q = msg.q || {}
    let list = await seneca.entity(canon).list$(q)
    list = list.map((entry: any) => entry.data$(false))
    const ics = buildIcs(list)

    return {
      ok: true,
      ics,
      count: list.length,
    }
  }


  async function msgListNotifications(this: any, msg: any) {
    const seneca = this
    const q = msg.q || {}
    let list = await seneca.entity(recordCanon).list$(q)
    list = list.map((entry: any) => entry.data$(false))

    return {
      ok: true,
      list,
    }
  }


  async function applySourceRefresh(this: any, entry: any, now: number) {
    const seneca = this

    if (!seneca.find('sys:calendar,hook:source')) {
      return {
        ok: true,
        changed: false,
        event: plainEvent(entry),
        why: 'no-source-hook',
      }
    }

    const src = await seneca.post('sys:calendar,hook:source', {
      key: entry.key,
      kind: entry.kind,
      event: plainEvent(entry),
      now,
    })

    if (!isDeliveryOk(src) || null == src || null == src.due) {
      return {
        ok: true,
        changed: false,
        event: plainEvent(entry),
        why: 'no-due',
        source: src,
      }
    }

    const newDue = Number(src.due)
    if (!isFinite(newDue) || newDue === entry.due) {
      return {
        ok: true,
        changed: false,
        event: plainEvent(entry),
        source: src,
      }
    }

    entry.due = newDue
    // New due date → reset stage tracking for the new cycle
    entry.notifiedStages = []
    entry.lastNotified = null
    entry = await entry.save$()

    return {
      ok: true,
      changed: true,
      event: plainEvent(entry),
      source: src,
    }
  }


  async function msgRefreshEvent(this: any, msg: any) {
    const seneca = this
    const key = msg.key
    const now = null != msg.now ? Number(msg.now) : getNow()

    let entry = await seneca.entity(canon).load$(key)
    if (null == entry) {
      return {
        ok: false,
        why: 'key-not-found',
      }
    }

    return applySourceRefresh.call(seneca, entry, now)
  }


  async function msgRefreshEvents(this: any, msg: any) {
    const seneca = this
    const now = null != msg.now ? Number(msg.now) : getNow()
    const q = msg.q || {}

    let list = await seneca.entity(canon).list$(q)
    const results: any[] = []

    for (let i = 0; i < list.length; i++) {
      results.push(await applySourceRefresh.call(seneca, list[i], now))
    }

    return {
      ok: true,
      now,
      list: results,
    }
  }
}


// Default options — Seneca validates plugin options against this shape (gubu).
const defaults: CalendarOptionsFull = {
  debug: false,

  canon: {
    zone: undefined,
    base: 'sys',
    name: 'calendar',
  },

  now: () => Date.now(),

  remindBefore: [],

  tick: {
    active: false,
    interval: 60 * 1000,
  },

  notifyCallback: function (_data: any) {},

  record: false,

  recordCanon: {
    zone: undefined,
    base: 'sys',
    name: 'calendar_notification',
  },
}


Object.assign(Calendar, { defaults })

Object.defineProperty(Calendar, 'name', { value: 'Calendar' })

;(Calendar as any).nextDue = nextDue
;(Calendar as any).crossedStages = crossedStages
;(Calendar as any).KEY_RE = KEY_RE
;(Calendar as any).buildIcs = buildIcs

export { nextDue, crossedStages, KEY_RE, buildIcs }
export default Calendar

if ('undefined' !== typeof module) {
  module.exports = Calendar
}
