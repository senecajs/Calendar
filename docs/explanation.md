# Explanation

## Why a calendar plugin

Operational deadlines — client-secret expiry, TLS renewal, token rotation — are time-based facts that belong next to the rest of your Seneca data, not only in a human calendar or a hard-coded cron. This plugin stores those facts as entities and answers “what needs attention now?” without choosing how you notify anyone.

## Store-agnostic events

Events are normal `seneca-entity` rows (default canon `sys/calendar`). Swap `mem-store` for Redis, SQL, or another store the same way as any other Seneca entity. The message API stays fixed.

## Due windows vs notify stages

`due:events` answers a membership question: is this event inside its remind window right now? That list can be polled often.

`notify:due` answers a delivery question: which **reminder stages** have we newly crossed? With `remindBefore: [30d, 7d, 1d]`, entering the 30-day window should page once — not on every tick. The entity field `notifiedStages` records what already fired. Stage `0` means “at or past due”.

Acknowledging or snoozing clears those stages so the next occurrence (or the post-snooze window) can notify cleanly.

## Recurrence without drift

Fixed day counts (`+30d`, `+365d`) drift across months and leap years. `monthly` and `yearly` use local date arithmetic that clamps the day-of-month (31 Jan → 28/29 Feb). `interval-ms` remains the escape hatch for true fixed periods.

## Pluggable delivery

Email, Slack, UI toasts, and queues are application concerns. The plugin only emits structured payloads through `hook:notify` and an optional `notifyCallback`, following the same idea as `@seneca/audit`’s callback: capture the fact, let the host decide the channel.

## Optional tick

A built-in interval is convenient for single-process apps and dangerous if left running in tests. It is off by default and always cleared on `seneca.close`.

## Delivery success and the outbox

Marking a stage notified before the channel accepts it causes silent loss on
failure. `notify:due` therefore updates `notifiedStages` only after the
callback/hook succeeds. Optional `record:true` rows give you an outbox and an
audit trail (`delivered: true|false`) without coupling the plugin to a mailer.

## Concurrency

Stage accounting is optimistic read-modify-write. Two notifier instances can
both observe an unmarked stage and both deliver. Keep a single scheduler (or
external lease) in front of `notify:due`.
