# PillTime for webOS TV (sideloaded)

A full-screen dashboard of the dog's meds. It reads `state.json` once a
minute with a read-only token and shows a system toast when a dose comes due.
It is installed in Developer Mode and never published.

The TV is a secondary channel. It only reacts while it is on, and see the
caveats below. Phones are the reliable channel.

## Quick test with sample data

`node tv/build.mjs --demo` builds the app with sample data and no token. The
6-hour meds come due 2 minutes after launch and the morning med 5 minutes
after launch, so you can check the toast and background behaviour before the
data repo exists. Install it as below. Each launch starts the timers again.

## Build

Needs Node 20+ and a read-only fine-grained token for the data repo (see
`data-repo-template/README.md`).

1. Optional, for system toasts: copy `webOSTV.js` from the webOS TV SDK into
   this folder as `tv/webOSTV.js`. It is gitignored. Without it the app still
   shows the in-app banner.
2. Build:

   ```sh
   PILLTIME_OWNER=your-user PILLTIME_REPO=pilltime-data \
   PILLTIME_TV_TOKEN=github_pat_... node tv/build.mjs
   ```

   This writes `tv/dist/` (with the token in `config.js`) and, if the webOS
   CLI is installed, an `.ipk` in `tv/`. Both are gitignored. **Never commit
   or share them: they contain the token.**

## Install

1. Install the LG *Developer Mode* app on the TV, sign in with an LG
   developer account (free) and turn Developer Mode on.
2. Install the webOS CLI on your computer (`npm install -g @webos-tools/cli`)
   and register the TV with `ares-setup-device`.
3. `ares-install --device <tv> tv/com.household.pilltime_1.0.0_all.ipk`
4. `ares-launch --device <tv> com.household.pilltime`

Developer Mode sessions expire and must be extended in the Developer Mode
app from time to time. Check LG's current rules for how long a session lasts.

## Not yet verified

These were written without access to the current LG docs. The developer
site was not reachable from the build environment. Check each one before
relying on the TV:

- [ ] **Toast API.** `tv.js` calls
  `webOS.service.request('luna://com.webos.notification', { method: 'createToast', parameters: { message } })`.
  Confirm in the webOS TV SDK reference that this method exists for
  third-party apps on your TV's webOS version, and what parameters it takes.
  If a call fails, the error appears in the footer of the TV screen.
- [ ] **Background running.** A web app may be suspended when you switch to
  another input or app, which would stop polling and toasts. Test it: start
  the app, switch to live TV, set a med's `next_due` a few minutes ahead, and
  see if a toast appears. If it does not, toasts only work while PillTime is
  on screen, and a background JS service would be the next thing to try.
- [ ] **webOS version.** The bundle needs webOS 5 or later (2020+ TVs) for
  `async`/`await`. Older TVs would need a transpile step.
- [ ] **Tooling names.** Confirm `@webos-tools/cli` and the `ares-*` commands
  are still current.
