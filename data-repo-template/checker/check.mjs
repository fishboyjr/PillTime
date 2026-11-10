// Scheduled checker: sends one Web Push per due dose and records it.
// Run by .github/workflows/check.yml. Keep logs free of medication names:
// it prints unit ids and counts only.
import webpush from 'web-push';
import { planNotifications, applyResults } from './logic.mjs';

const env = process.env;
// STATE_REPO (owner/name) lets the checker run from another repo, such as the
// public code repo, and read the private data repo with a token.
const stateRepo = env.STATE_REPO || env.GITHUB_REPOSITORY || '';
const [owner, repo] = stateRepo.split('/');
const path = env.STATE_PATH || 'state.json';
const branch = env.STATE_BRANCH || (env.STATE_REPO ? '' : env.GITHUB_REF_NAME) || '';
const dryRun = env.DRY_RUN === '1' || env.DRY_RUN === 'true';
// QUIET=1 prints nothing but errors: used when the logs are public.
const quiet = env.QUIET === '1' || env.QUIET === 'true';
const log = quiet ? () => {} : console.log;
const warn = quiet ? () => {} : console.warn;

function need(name) {
  if (!env[name]) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return env[name];
}

const token = need('GITHUB_TOKEN');
const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28'
};

async function readState() {
  const res = await fetch(api + (branch ? `?ref=${encodeURIComponent(branch)}` : ''), { headers });
  if (!res.ok) throw new Error(`Read failed: ${res.status}`);
  const body = await res.json();
  return { sha: body.sha, data: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) };
}

async function writeState(data, sha, message) {
  const res = await fetch(api, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      sha,
      ...(branch ? { branch } : {}),
      content: Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').toString('base64')
    })
  });
  if (res.ok) return true;
  if (res.status === 409 || res.status === 422) return false; // someone else wrote first
  throw new Error(`Write failed: ${res.status}`);
}

const { data: state } = await readState();
// A manual run with a test message sends just that, to every phone, and
// leaves the medication schedule and notified_for alone.
const testMessage = (env.TEST_MESSAGE || '').trim();
const plans = testMessage
  ? [{ unit: 'test', dueFor: {}, payload: { title: 'PillTime test', body: testMessage.slice(0, 200), tag: 'pilltime-test' } }]
  : planNotifications(state, Date.now());
const subs = Array.isArray(state.subscriptions) ? state.subscriptions : [];
log(`Due units: ${plans.map((p) => p.unit).join(', ') || 'none'}; subscriptions: ${subs.length}`);
if (!plans.length) process.exit(0);
if (!subs.length) {
  log('No subscriptions; nothing sent. Will retry next run.');
  process.exit(0);
}

const publicKey = need('VAPID_PUBLIC_KEY');
if (state.vapid_public_key && state.vapid_public_key !== publicKey) {
  warn('WARNING: state.json vapid_public_key does not match the VAPID_PUBLIC_KEY secret. Phones subscribed with the wrong key will not receive pushes.');
}
webpush.setVapidDetails(need('VAPID_SUBJECT'), publicKey, need('VAPID_PRIVATE_KEY'));

const sent = [];
const dead = new Set();
for (const plan of plans) {
  let ok = 0;
  for (const sub of subs) {
    if (dead.has(sub.endpoint)) continue;
    if (dryRun) { ok++; continue; }
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(plan.payload),
        { TTL: 6 * 3600, urgency: 'high' }
      );
      ok++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        dead.add(sub.endpoint);
        log(`Subscription gone (${e.statusCode}); removing.`);
      } else {
        warn(`Push failed for one subscription: ${e.statusCode || e.message}`);
      }
    }
  }
  log(`Unit ${plan.unit}: delivered to ${ok}/${subs.length}${dryRun ? ' (dry run)' : ''}`);
  // Only mark as notified if at least one phone accepted it; otherwise retry next run.
  if (ok > 0) sent.push(plan);
  // Every live subscription refused it (for example a wrong VAPID key): fail
  // the run so GitHub emails the owner, even when logs are silenced.
  else if (subs.some((x) => !dead.has(x.endpoint))) {
    console.error('No phone accepted the notification. Check the VAPID secrets.');
    process.exitCode = 1;
  }
}

if (dryRun) process.exit(0);

for (let attempt = 0; attempt < 6; attempt++) {
  const cur = await readState();
  const next = applyResults(cur.data, sent, [...dead]);
  if (!next) break;
  const msg = `checker: notified ${sent.map((p) => p.unit).join(', ') || 'none'}` +
    (dead.size ? `, removed ${dead.size} subscription(s)` : '');
  if (await writeState(next, cur.sha, msg)) {
    log('state.json updated.');
    break;
  }
  log('Write conflict; retrying.');
  await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
}
