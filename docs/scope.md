# Scope: what this plugin deliberately does not do

The other four documents say what `@seneca/calendar` does. This one says what it does *not* — and,
more usefully, which of those absences are **decisions** that should stay, and which are **gaps**
a pull request would be welcome to close.

The distinction matters because the plugin is small and its domain is narrow: **time-based
maintenance events** — client-secret expiry, TLS renewal, token rotation. Several things a reader
might expect from something called "calendar" are missing on purpose, because they belong to a
different domain that happens to share the word. Others are simply not written yet. Telling those
two apart is the point of this file.

---

## Decisions

These follow from one position: **this is a store of facts that need attention, not a scheduling
system.** An event is something that becomes true at a time. It is not a meeting, it has no
invitees, and nobody accepts or declines it.

### No attendees

There is no `ATTENDEE`, no invitee list and no RSVP anywhere in the plugin. Attendees imply
invitations, which imply iTIP, sequence numbers, response tracking and duplicate-send prevention —
that is a scheduling product, and a much larger one.

### No external calendar providers

The plugin never talks to Google Calendar, Microsoft Graph or CalDAV. It stores events and emits
structured payloads; `hook:notify` is where an application decides what a notification *is*. A
provider inside here would mean credential handling, OAuth and per-vendor API drift inside a plugin
whose value is having none of that.

### ICS output is a publish feed, not a scheduling message

`export:ics` emits `METHOD:PUBLISH`. That is the correct method for a read-only feed somebody
subscribes to, which is what it is. `REQUEST` / `CANCEL` and the machinery around them are the
vocabulary of invitations, and follow from the two decisions above.

One consequence worth knowing, because it surprises people: **`export:ics` exports every event the
query returns, regardless of `status`.** An `acknowledged` or `done` event still appears as a live
`VEVENT`. Filter in the query (`q`) if that is not what you want.

### `record` defaults to `false`

The outbox (`sys/calendar_notification`) is an optional audit surface, not part of the core loop.
Defaulting it on would create a second table in every host that installs the plugin — including
hosts that already have their own delivery accounting and want exactly one source of truth for it.

### No outbox retention or pruning

Documented in [reference](reference.md). Retention is a host policy — regulatory in some
deployments, a day in others — and a plugin that quietly deletes audit rows on someone else's
schedule is worse than one that does nothing.

---

## Not yet

Gaps, not positions. Each of these is a reasonable thing to want, and none of them is refused on
principle.

### `notify:due` has no lock

Stage accounting is an optimistic read-modify-write on `notifiedStages`. Two notifier instances can
both observe an unmarked stage and both deliver. The current answer — documented in
[how-to](how-to.md#single-scheduler-note) and [reference](reference.md#concurrency) — is to run a
single scheduler.

That is adequate for maintenance reminders, where a duplicate is an extra Slack message. It stops
being adequate as soon as delivery is outward-facing and irreversible, because then a concurrent
poll means a third party receives the same thing twice.

**The intended fix is a lock the host supplies, not one the plugin implements** — an advisory lock
on a single machine, something like a Cloudflare Durable Object when deployed. The plugin should
grow a seam to plug that into and should not care what the lock is made of. Until then the
single-scheduler requirement stands.

### No timezone on events, so ICS is UTC-only

An event carries a single `due` epoch-ms and no zone field, and `icsDate()` always emits UTC
(`...Z`). There is no `VTIMEZONE` in the output because there is nothing to derive one from.

This was the shortest path to a working export rather than a considered position. A patch adding an
optional zone and a correct `VTIMEZONE` would be welcome. Two things to get right if you write it:
storing a zone *name* (not a UTC offset — an offset is derived and DST-dependent, and storing one is
how events drift an hour), and deciding what a wall-clock time means when it is ambiguous or
nonexistent across a DST transition.

### No `SEQUENCE` or `STATUS` in ICS

Neither is emitted. Both become necessary the moment a calendar client has to *reconcile* an event
against a version it already holds, rather than read a fresh publication — an update instead of a
feed. Related to the decisions above, but not foreclosed by them.

### `hook:source` recomputes one event at a time

`refresh:event` / `refresh:events` call `sys:calendar,hook:source` and accept a new `due`, resetting
the reminder stages. That is enough to pull a real expiry date from an external system. It is not
enough to reconcile a *set* of events against an external source of truth: nothing here diffs,
tombstones, or notices that something upstream was deleted.

---

## One defect

`buildIcs()` stamps `DTSTAMP` from `Date.now()` ([src/Calendar.ts:285](../src/Calendar.ts#L285)),
bypassing the injectable clock (`options.now`) that every other time-dependent path honours.
`buildIcs` is a module-level function outside the plugin closure, so it cannot reach the option —
fixing it properly means threading a clock through its signature.

Consequences: ICS output is not byte-identical across runs for identical input, and tests cannot pin
it. Anything downstream that hashes the export to detect change will see a change on every call.

---

## What this means for extensions

Roughly: **the maintenance-event core is settled; the scheduling half was never started.**

Extensions that add attendees, invitations, external providers, reconciliation ledgers or
`REQUEST`/`CANCEL` output are building that second half. They are welcome — but they should not
quietly change the first. The event entity, the staged-reminder accounting, the success-gated
outbox and the `hook:notify` / `hook:source` seams have live consumers and need to stay
backwards-compatible.

Three items above are worth fixing in the core itself rather than routing around, because each is
wrong for the existing domain and not only for a larger one: the **lock seam**, the **`DTSTAMP`
clock**, and the **timezone gap**.
