# `state.json` schema and update procedure

`state.json` lives in the **private data repo**. It is the only shared state.
Phones write it through the GitHub Contents API, the scheduled checker writes
it from a GitHub Action, and the TV only reads it.

A sample with placeholder names is in
[`data-repo-template/state.json`](../data-repo-template/state.json).

## Top level

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | number | Currently `1`. |
| `timezone` | IANA zone, e.g. `"America/New_York"` | Daily times are wall-clock times in this zone. Display uses it too. |
| `vapid_public_key` | string | Web Push public key. Phones use it to subscribe. Must match the `VAPID_PUBLIC_KEY` secret in the data repo. Not secret. |
| `settings.notify_lead_minutes` | number, default `0` | The checker may send the push this many minutes before the dose is due. |
| `settings.tv_repeat_minutes` | number, default `30` | The TV repeats its toast this often while a dose stays overdue. `0` = once. |
| `settings.log_limit` | number, default `500` | Oldest `log` entries are dropped past this count. Git history keeps everything. |
| `meds` | array | See below. |
| `subscriptions` | array | Web Push subscriptions, one per phone. Written by phones, pruned by the checker. |
| `log` | array | Dose history. Written by phones. |

## `meds[]`

| Field | Type | Meaning |
|---|---|---|
| `id` | string, unique | Stable id used in the log. |
| `group` | string, optional | Meds with the same `group` are given together and share one timer. The app shows one card and one **Given** button for the group. All meds in a group must have the same `schedule`. |
| `name` | string | Shown on phones, the TV and in notifications. |
| `schedule` | object | One of the two shapes below. |
| `last_given` | `{ "at": ISO time, "by": name }` or `null` | Actual time of the last dose and who logged it. |
| `next_due` | ISO time or `null` | When the next dose is due. `null` until the first dose is logged. |
| `notified_for` | ISO time or `null` | The `next_due` value the checker last sent a push for. Stops repeat pushes for the same dose. |

All times are ISO-8601 UTC strings (`2026-11-08T13:00:00.000Z`).

### `schedule` shapes

**Daily, fixed time** (the morning med):

```json
{ "type": "daily", "time": "08:00", "early_window_hours": 2, "short_gap_warning_hours": 12 }
```

- Due every day at `time` in `timezone` until it is logged.
- Logging a dose at time *T* sets `next_due` to the first `time` slot after
  *T* + `early_window_hours`. So a dose up to 2 h before 08:00, or any time
  after it, counts for that day's 08:00 dose, and tomorrow is still 08:00.
  Logging late never moves the next day's time.
- `short_gap_warning_hours` (default 12): the **Given** dialog warns when the
  next dose would come sooner than this after the one being logged, for example
  logging a missed dose at 05:00 when 08:00 is 3 h away.

**Fixed interval** (the two 6-hour meds):

```json
{ "type": "interval", "hours": 6 }
```

- Logging a dose at *T* sets `next_due = T + hours`. If a dose is late, the
  next one is `hours` after the actual dose. Fractional hours are allowed,
  which is handy for testing (`0.1` = 6 minutes).

## `subscriptions[]`

```json
{ "endpoint": "https://…", "keys": { "p256dh": "…", "auth": "…" }, "name": "Sam", "added_at": "…" }
```

Added by a phone when notifications are turned on, keyed by `endpoint`. The
checker removes entries whose push service answers 404 or 410.

## `log[]`

```json
{
  "id": "…", "type": "given", "unit": "q6", "meds": ["q6a", "q6b"],
  "at": "2026-11-08T15:55:00.000Z", "by": "Sam", "logged_at": "2026-11-08T16:00:12.000Z",
  "prev": { "q6a": { "last_given": null, "next_due": null } },
  "undone_at": "…", "undone_by": "…"
}
```

`at` is when the dose was given, which can be earlier than `logged_at`.
`prev` holds the values before the dose, so the most recent dose for a card
can be undone. `undone_*` are set when that happens.

## Update procedure

Every writer follows the same steps. This is how the app keeps concurrent
writes from two phones and the checker safe.

1. `GET /repos/{owner}/{repo}/contents/state.json` and keep the returned `sha`.
2. Apply the change to the freshly read data. Never write back an older copy.
3. `PUT` the whole file with that `sha`.
4. If GitHub answers **409** or **422** (someone else wrote first), go back
   to step 1 and re-apply the change to the new data. Give up after about 5
   tries.

Each kind of change, and who makes it:

| Change | Who | What changes |
|---|---|---|
| Dose given | Phone, **Given** button | For each med in the card: `last_given`, `next_due`. Appends a `log` entry. |
| Undo last dose | Phone, **Undo last** | Restores `last_given`/`next_due` from the entry's `prev`. Sets `undone_*`. Only the most recent dose, and only if nothing has replaced it. |
| Turn on notifications | Phone | Adds or replaces an entry in `subscriptions`. |
| Turn off notifications | Phone | Removes that phone's entry. |
| Push sent | Checker | Sets `notified_for = next_due` on the meds it notified about, but only if `next_due` has not changed since it planned the push. |
| Dead subscription | Checker | Removes the entry. |

### Editing by hand

To change names, times or intervals, edit `state.json` in the GitHub web UI of
the data repo and commit. Keep the shapes above. The app checks the file on
every load and shows a banner if something is wrong, and it refuses to write
until the problem is fixed. After changing a schedule, the current `next_due`
stays as it was until the next dose is logged. Set it by hand if it should
change straight away.
