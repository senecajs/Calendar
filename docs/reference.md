# Reference

## Options

Validated against plugin `defaults` at registration (Seneca/gubu).

| Option | Default | Description |
| ------ | ------- | ----------- |
| `debug` | `false` | Extra debug logging (e.g. tick errors). |
| `canon` | `{ zone: undefined, base: 'sys', name: 'calendar' }` | Entity canon for persisted events. |
| `now` | `() => Date.now()` | Clock injection for due/notify/ack/snooze. |
| `remindBefore` | `[]` | Default remind offsets (ms) when `add:event` omits them. |
| `tick.active` | `false` | When true, periodically run `notify:due`. |
| `tick.interval` | `60000` | Tick period in ms. Cleared on `seneca.close`. |
| `notifyCallback` | no-op function | Optional `(data) => any` delivery function (`this` = seneca). |
| `record` | `false` | Persist notification outbox rows on each emission attempt. |
| `recordCanon` | `{ base: 'sys', name: 'calendar_notification' }` | Entity canon for outbox rows. |

## Entity: `sys/calendar` (default)

| Field | Type | Notes |
| ----- | ---- | ----- |
| `key` | string | Stable id (`id` = key). Must match `^[A-Za-z0-9._:-]+$`. Unique. |
| `kind` | string | e.g. `tls`, `secret`, `token`. |
| `title` | string | Short label. |
| `description` | string | Longer text. |
| `due` | number | Due instant (Unix ms). |
| `remindBefore` | number[] | Offsets before `due` (ms), largest first when stored. |
| `recurrence` | string | `none` \| `daily` \| `weekly` \| `monthly` \| `yearly` \| `interval-ms`. |
| `intervalMs` | number | Step for `interval-ms` recurrence. |
| `severity` | string | `info` \| `warn` \| `critical`. |
| `status` | string | `active` \| `acknowledged` \| `snoozed` \| `done`. |
| `snoozeUntil` | number \| null | Wake time when snoozed. |
| `lastNotified` | number \| null | Last successful `notify:due` emission time. |
| `notifiedStages` | number[] | Reminder stages successfully delivered this cycle (includes `0` for due). |
| `assignee` | string \| null | Optional owner. |
| `tags` | string[] | Labels. |
| `meta` | object | Free-form metadata. |

## Entity: `sys/calendar_notification` (outbox, when `record:true`)

One row per `(event_key, stage)` — id is `event_key:stage`. Repeated
`notify:due` attempts **upsert** the same row (`attempts++`, `lastTried`) instead
of appending, so failed polls do not grow the table unbounded.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `event_key` | string | Calendar event key. |
| `stage` | number | Remind stage (ms offset, or `0` for due). |
| `when` | number | First attempt timestamp. |
| `lastTried` | number | Most recent attempt timestamp. |
| `attempts` | number | Delivery attempts for this stage. |
| `severity` | string | Copied from event. |
| `delivered` | boolean | `true` only when hook/callback succeeded. |
| `deliveredAt` | number \| null | Set when `delivered` becomes true. |
| `result` | object \| null | Hook/callback return value (best-effort). |
| `meta` | object | Extra (e.g. `digest`, error message). |

**Retention:** the plugin does not prune outbox rows. Schedule your own cleanup
(e.g. delete `delivered:true` older than N days, or archive stuck
`delivered:false` after investigation). `list:notifications` with a store-specific
query is the drain/prune entry point.

## Concurrency

`notify:due` has no lock. Use a **single scheduler / single notifier instance** to avoid double-delivery under concurrent polls. See [how-to](how-to.md#single-scheduler-note).

## Action patterns

All under `sys:calendar`.

### `add:event`

Create an event. Fails with `why: 'invalid-key'` if the key is not Cosmos-safe, or `why: 'key-exists'` if the key exists (unless `existing:true`).

Parameters: `key`, `due` (required); `kind`, `title`, `description`, `remindBefore`, `recurrence`, `severity`, `assignee`, `tags`, `meta`, `intervalMs`, `existing`.

Returns: `{ ok, event?, why? }`.

### `get:event`

Parameters: `key`.

Returns: `{ ok, event }`.

### `list:event`

Parameters: `q` (entity list query, default `{}`).

Returns: `{ ok, list }`.

### `update:event`

Parameters: `key` plus any updatable fields. Validates `severity` / `status` / `recurrence` **before** mutating the entity.

Returns: `{ ok, event?, why? }`.

### `remove:event`

Parameters: `key`.

Returns: `{ ok, event?, why? }`.

### `due:events`

Active events (or snoozed with `snoozeUntil` elapsed) whose `now >= due - max(remindBefore)`.

Parameters: optional `now`.

Returns: `{ ok, now, list }`.

### `ack:event`

Acknowledge. Recurring (`recurrence !== 'none'`): advance `due`, keep `active`, clear `notifiedStages`. Non-recurring: default `status: 'acknowledged'`; pass `done:true` for `done`.

Parameters: `key`; optional `now`, `done`.

Returns: `{ ok, now, event?, why? }`.

### `snooze:event`

Set `status: 'snoozed'`, `snoozeUntil: until`, clear notify stages.

Parameters: `key`, `until`; optional `now`.

Returns: `{ ok, now, event?, why? }`.

### `notify:due`

For each due event, compute crossed reminder stages; emit only stages not in `notifiedStages`. Delivery via `notifyCallback` and/or `sys:calendar,hook:notify`.

**Success gating:** stages are appended to `notifiedStages` only when delivery succeeds (no throw, and result is not `{ok:false}`). Failures are collected in `failed` and other events continue.

Parameters: optional `now`, `digest` (boolean).

Returns: `{ ok, now, notified, failed, digest? }`.

With `digest:true`, one payload `{ digest:true, events:[...], now }` is delivered; per-event stage accounting still applies.

### `export:ics`

Build a `VCALENDAR` string for events matching optional `q`.

Returns: `{ ok, ics, count }`.

### `list:notifications`

List outbox rows (useful when `record:true`).

Parameters: `q` (default `{}`).

Returns: `{ ok, list }`.

### `refresh:event` / `refresh:events`

Call app-registered `sys:calendar,hook:source` to recompute `due`. No hook → no-op.

Parameters: `key` (single) or `q` (batch); optional `now`.

Returns: `{ ok, changed?, event?, why? }` or `{ ok, now, list }`.

### `hook:notify` (optional, app-registered)

```js
seneca.message('sys:calendar,hook:notify', async function (msg) {
  // per-event: msg.event, msg.stages, msg.now
  // digest: msg.digest, msg.events, msg.now
  return { ok: true }
})
```

### `hook:source` (optional, app-registered)

```js
seneca.message('sys:calendar,hook:source', async function (msg) {
  // msg.key, msg.kind, msg.event, msg.now
  return { ok: true, due: newDueMs }
})
```
