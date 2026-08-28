# How-to guides

## Seed events idempotently

`add:event` rejects duplicate keys. Keys must match `^[A-Za-z0-9._:-]+$`
(Cosmos-safe: no `/ \ # ?`). For deploy-time seeding:

```js
await seneca.post('sys:calendar,add:event', {
  key: 'client-secret-foo',
  due: secretExpiresAt,
  existing: true, // ok:true, why:'existing' if already present
})
```

To change an existing event, use `update:event`.

## Inject a clock for tests

```js
let now = 1_700_000_000_000
seneca.use(Calendar, { now: () => now })
// or per call:
await seneca.post('sys:calendar,due:events', { now })
```

## Wire delivery without hardcoding a channel

**Option A — callback**

```js
.use(Calendar, {
  notifyCallback: async function (data) {
    await myQueue.push(data.event)
    return { ok: true }
  },
})
```

**Option B — hook message**

Register `sys:calendar,hook:notify` yourself (the plugin does not ship a default
action, so your handler is not overwritten at init):

```js
seneca.message('sys:calendar,hook:notify', async function (msg) {
  await sendSlack(msg.event)
  return { ok: true } // {ok:false} or throw → stage NOT marked; will retry
})
```

Both can be used together. `notify:due` only emits **newly crossed** stages (see `notifiedStages` on the entity), and only marks them after a successful delivery.

## Single-scheduler note

`notify:due` is a read-modify-write with **no distributed lock**. Drive it from a
**single scheduler** (or one process instance). Multiple concurrent pollers can
double-deliver the same stage before `notifiedStages` is persisted. Horizontal
scale-out of the notifier is not supported without an external lease.

## Reliable delivery via the outbox

Enable `record: true` to persist an attempt row per `(event_key, stage)` (default
canon `sys/calendar_notification`). Failed deliveries write/upsert
`delivered:false` (incrementing `attempts` / `lastTried`) and leave the stage
unmarked so the next poll retries — without appending a new row each tick.

A channel worker can drain `list:notifications` with `{ delivered: false }`:

```js
.use(Calendar, { record: true })

const outbox = await seneca.post('sys:calendar,list:notifications', {
  q: { delivered: false },
})
```

Prune or archive delivered rows yourself (the plugin does not retain a TTL).
## Subscribe to the ICS feed

```js
const { ics } = await seneca.post('sys:calendar,export:ics')
// optional filter: { q: { kind: 'tls' } }
// Serve `ics` as text/calendar from your gateway — no calendar UI in the plugin.
```

Recurring `daily`/`weekly`/`monthly`/`yearly` events include `RRULE`.
`interval-ms` and `none` omit it.

## Auto-update due dates with a source hook

Register `sys:calendar,hook:source` to recompute `due` from a live resource
(Key Vault, cert inventory, etc.). The plugin only defines the contract:

```js
seneca.message('sys:calendar,hook:source', async function (msg) {
  // msg.key, msg.kind, msg.event, msg.now
  const expires = await lookupExpiry(msg.event)
  return { ok: true, due: expires }
})

await seneca.post('sys:calendar,refresh:event,key:tls-api')
// or batch:
await seneca.post('sys:calendar,refresh:events', { q: { kind: 'tls' } })
```

No hook → no-op. Returning a new `due` resets `notifiedStages`.

## Digest notifications

```js
await seneca.post('sys:calendar,notify:due', { digest: true })
// hook/callback receives { digest:true, events:[{event,stages,now},...], now }
```

One payload for the host (e.g. a summary email); stages are still accounted per event.

## Avoid reminder spam

With `remindBefore: [30d, 7d, 1d]`, call `notify:due` on a poll/tick. The first poll inside the 30-day window emits once; later polls in the same window emit nothing until the 7-day stage is crossed.

`ack:event` and `snooze:event` clear `notifiedStages` so the next cycle can notify again.

## Acknowledge vs done

Plain `ack:event` sets `status: 'acknowledged'`. Pass `done:true` to mark `done`.
Recurring events still roll `due` forward and stay `active`.

## Enable an optional tick

Off by default. When enabled, the plugin posts `notify:due` on an interval and **clears the timer on `seneca.close`**:

```js
.use(Calendar, {
  tick: { active: true, interval: 60_000 },
})
```

Prefer an external single scheduler in production (see single-scheduler note).

## Change recurrence after create

```js
await seneca.post('sys:calendar,update:event', {
  key: 'tls-api',
  recurrence: 'monthly',
})
```

`monthly` / `yearly` use calendar arithmetic (Jan 31 → Feb 28/29). `interval-ms` uses a fixed millisecond step (`intervalMs` on the event).
