# PillTime data repo (private)

Copy the contents of this folder into a new **private** GitHub repository.
It holds the medication data and runs the reminder checker. Nothing here
should ever be copied into the public code repo.

```
state.json                      shared state (see docs/state-schema.md in the code repo)
checker/check.mjs               sends Web Push for due doses
checker/logic.mjs               decision logic (unit-tested in the code repo)
.github/workflows/check.yml     runs the checker every 30 minutes
```

## Setup

1. Create a private repo, for example `pilltime-data`, and push these files to
   its default branch.
2. Make VAPID keys once, on any computer with Node:

   ```sh
   npx web-push generate-vapid-keys
   ```

3. In the data repo, go to **Settings → Secrets and variables → Actions** and
   add these repository secrets:
   - `VAPID_PUBLIC_KEY`: the public key
   - `VAPID_PRIVATE_KEY`: the private key
   - `VAPID_SUBJECT`: `mailto:` plus an address the push services can contact,
     for example `mailto:you@example.com`
4. Put the **public** key in `state.json` as `vapid_public_key` and commit.
5. Edit `timezone`, the med `name`s and the `08:00` time in `state.json`.
6. **Settings → Actions → General → Workflow permissions**: choose *Read and
   write permissions*. The workflow also asks for `contents: write`.
7. Run the workflow once from the **Actions** tab (*Run workflow*, tick *dry
   run*) to check it starts.

## Tokens

Make these at **GitHub → Settings → Developer settings → Fine-grained tokens**.
For both, set *Repository access* to *Only select repositories* and pick this
data repo only.

| Token | Permission | Used by |
|---|---|---|
| Phone token | Contents: **Read and write** | Each phone's PillTime setup screen. One shared token or one per person both work. |
| TV token | Contents: **Read-only** | Built into the TV app. |

Fine-grained tokens expire. When one does, the app shows "GitHub rejected the
token". Make a new one and enter it in the app's settings (⚙), or rebuild
the TV app.

## Action minutes

Private repos get 2,000 free Action minutes a month, and each run counts as
at least one minute. Running every 30 minutes uses about 1,488 a month.
Every 15 minutes would use about 2,976 and go over the limit. If you want
pushes to arrive earlier, set `settings.notify_lead_minutes` in `state.json`
(for example `15`) rather than running more often. Check usage under
**Settings → Billing**.

GitHub turns off scheduled workflows after 60 days with no repo activity.
Logging doses commits to this repo, so normal use keeps it on.

## Logs

The checker logs unit ids (`am`, `q6`) and counts only, never med names.
Logs of a private repo are private, but keep it that way if you edit the
script.
