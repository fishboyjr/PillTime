# PillTime

Household reminders for the dog's three medications. It shows when each was
last given and when the next dose is due, sends push notifications to iPhone
and Android, and shows a pop-up on a webOS TV.

It is free to run. It needs no Apple Developer or Google Play account, no
Firebase, and only GitHub for hosting.

> **This is a reminder tool, not dosing advice.** Dose schedules and rules
> come from the vet and the medication labels.

## How it fits together

```
 Phones (PWA on GitHub Pages)          Private data repo                 webOS TV (sideloaded)
 ┌───────────────────────┐   write    ┌────────────────────────┐  read   ┌──────────────────────┐
 │ Given / Undo          │──────────▶│ state.json             │◀────────│ polls every minute    │
 │ turn on notifications │ Contents   │                        │  token  │ toast when due        │
 └───────────▲───────────┘   API      │ Action every 30 min:   │         └──────────────────────┘
             │                        │  finds due doses,      │
             └──────── Web Push ──────│  sends one push each   │
                                      └────────────────────────┘
```

- **This repo (public):** the phone app (`app/`), the TV app (`tv/`), tests,
  and a template for the data repo (`data-repo-template/`). It holds no
  secrets and no medication data. The template only has placeholder names.
- **Data repo (private, you create it):** `state.json`, push subscriptions,
  and the scheduled checker. See
  [`data-repo-template/README.md`](data-repo-template/README.md).

## The medication rules

- **Morning med:** due every day at a fixed time (08:00 for now). Logging it
  late does not change the next day's time.
- **Two 6-hour meds:** given together, so they share one card and one timer.
  The next dose is due 6 hours after the dose was actually given, so a late
  dose pushes the next one back.

Times and intervals are data in `state.json`, not code. The full schema and
the update procedure are in [`docs/state-schema.md`](docs/state-schema.md).

## Setup

1. **Data repo.** Follow
   [`data-repo-template/README.md`](data-repo-template/README.md): create the
   private repo, add the VAPID secrets, and make the phone and TV tokens.
2. **Phone app hosting.** In this repo, go to **Settings → Pages → Source**
   and choose *GitHub Actions*. Pushing to `main` deploys `app/` to
   `https://<owner>.github.io/<repo>/`.
3. **Each phone.**
   - **iPhone (iOS 16.4+):** open the Pages URL in Safari, tap Share → *Add
     to Home Screen*, then open PillTime **from the Home Screen icon**. Do the
     setup there. The Home Screen app has its own storage, separate from
     Safari.
   - **Android:** open the URL in Chrome and install it when prompted (or
     menu → *Install app*).
   - In the app: enter your name, the data repo owner and name, and the
     phone token. Then tap **Turn on** under *Notifications on this phone*.
4. **TV.** See [`tv/README.md`](tv/README.md).

## Using it

- **Given** opens a dialog with the time pre-filled. Change it if the dose
  was given earlier. The dialog shows when the next dose will be due, and
  warns about unusual cases, such as an extra morning dose or a 6-hour dose
  given before it was due.
- **Undo last** reverses the most recent dose on that card, for mistaken taps.
- Every change is a commit in the data repo, so its history is a full audit
  trail.

## Testing end to end with short intervals

1. In the data repo's `state.json`, temporarily set the 6-hour meds to
   `"hours": 0.1` (6 minutes).
2. Log a dose on a phone. Wait 6 minutes, then run the checker by hand
   (**Actions → Medication checker → Run workflow**). The push should arrive
   on every subscribed phone, and the TV should toast within a minute of the
   due time.
3. Run the workflow again: no second push (dedupe through `notified_for`).
4. Set `"hours"` back to `6` and log a real dose to reset `next_due`.

## Development

```sh
npm test            # schedule, checker, GitHub client and TV bundle tests
npm run serve       # serve app/ on http://localhost:8080
```

No build step for the phone app: `app/` is served as is. The shared logic is
in `app/lib/`, and the TV build bundles the same files.

## Known limits

- GitHub Actions cron runs can start several minutes late, and the checker
  runs every 30 minutes to stay inside the free minutes. A push can arrive up
  to about 30–40 minutes after the due time. `settings.notify_lead_minutes`
  can send it earlier. The phone and TV screens show the exact due time
  either way.
- iPhone push only works for the Home Screen app, on iOS 16.4 or later.
- The TV only reacts while it is on. See the unverified items in
  [`tv/README.md`](tv/README.md).
- Each phone stores its GitHub token in the app's local storage. Anyone with
  the unlocked phone can use it. The token can only touch the data repo.
