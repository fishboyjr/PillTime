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

## When the checker runs

GitHub's own schedule proved unreliable here: in private repos it skipped
most runs, sometimes for 11 hours. So reminders run from the **public**
PillTime repo (`.github/workflows/checker.yml`), where Actions minutes are
free, and an outside pinger starts it every 5 minutes:

- **PillTime repo secrets:** `DATA_TOKEN` (fine-grained, this data repo only,
  Contents: Read and write) and the three `VAPID_*` secrets.
- **cron-job.org job:** every 5 minutes, `POST` to
  `https://api.github.com/repos/fishboyjr/PillTime/actions/workflows/checker.yml/dispatches`
  with headers `Authorization: Bearer <token>` (fine-grained, PillTime repo
  only, Actions: Read and write), `Accept: application/vnd.github+json`,
  `Content-Type: application/json`, and body
  `{"ref":"<PillTime default branch>"}`.
- The public workflow runs with `QUIET=1`, so its logs show nothing about the
  meds. It also has a 15-minute GitHub schedule as a backup.

The workflow in this repo has no schedule. Use it from the **Actions** tab
for dry runs, or to send a test message to every phone.

## Logs

The checker logs unit ids (`am`, `q6`) and counts only, never med names.
Logs of a private repo are private, but keep it that way if you edit the
script.
