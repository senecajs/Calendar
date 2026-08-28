# Tutorial: track a maintenance deadline

This walkthrough registers a TLS certificate renewal on the calendar, sees when it becomes due, and wires a notification hook.

## 1. Install and boot Seneca

```js
const Seneca = require('seneca')
const Calendar = require('@seneca/calendar')

const seneca = Seneca({ legacy: false })
  .use('promisify')
  .use('entity')
  .use(Calendar)
```

## 2. Add an event

Keys are unique. A second `add:event` with the same key fails (`why: 'key-exists'`). Use `existing:true` for idempotent seeding, or `update:event` to change fields.

```js
const due = Date.UTC(2026, 5, 1) // 1 Jun 2026

await seneca.post('sys:calendar,add:event', {
  key: 'tls-api',
  kind: 'tls',
  title: 'Renew api.example.com certificate',
  due,
  remindBefore: [
    30 * 24 * 60 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000,
    24 * 60 * 60 * 1000,
  ],
  severity: 'warn',
  recurrence: 'yearly',
})
```

## 3. Ask what is due

Inject `now` in tests (or set the `now` option) so results are deterministic:

```js
const res = await seneca.post('sys:calendar,due:events', {
  now: due - 7 * 24 * 60 * 60 * 1000,
})
// res.list contains tls-api once we are inside the 7-day window
```

## 4. Deliver notifications (no email built in)

Override the hook — or pass `notifyCallback` in options:

```js
seneca.message('sys:calendar,hook:notify', async function (msg) {
  // msg.event, msg.stages (newly crossed remindBefore values), msg.now
  console.log('notify', msg.event.key, msg.stages)
  return { ok: true }
})

await seneca.post('sys:calendar,notify:due')
```

Each reminder stage fires once per cycle. Acknowledge or snooze to reset stages for the next cycle.

## 5. Acknowledge or snooze

```js
await seneca.post('sys:calendar,ack:event,key:tls-api')
// yearly → due advances by one calendar year; status stays active

await seneca.post('sys:calendar,snooze:event', {
  key: 'tls-api',
  until: Date.now() + 3 * 24 * 60 * 60 * 1000,
})
```

Next: [How-to](how-to.md) for wiring patterns, or [Reference](reference.md) for every message and option.
