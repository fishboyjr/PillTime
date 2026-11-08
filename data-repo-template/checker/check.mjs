// Scheduled checker: sends one Web Push per due dose and records it.
// Run by .github/workflows/check.yml. Keep logs free of medication names:
// it prints unit ids and counts only.
import webpush from 'web-push';
import { planNotifications, applyResults } from './logic.mjs';

const env = process.env;
const [owner, repo] = (env.GITHUB_REPOSITORY || '').split('/');
const path = env.STATE_PATH || 'state.json';
const branch = env.STATE_BRANCH || env.GITHUB_REF_NAME || '';
const dryRun = env.DRY_RUN === '1' || env.DRY_RUN === 'true';

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
const plans = planNotifications(state, Date.now());
const subs = Array.isArray(state.subscriptions) ? state.subscriptions : [];
console.log(`Due units: ${plans.map((p) => p.unit).join(', ') || 'none'}; subscriptions: ${subs.length}`);
if (!plans.length) process.exit(0);
if (!subs.length) {
  console.log('No subscriptions; nothing sent. Will retry next run.');
  process.exit(0);
}

const publicKey = need('VAPID_PUBLIC_KEY');
if (state.vapid_public_key && state.vapid_public_key !== publicKey) {
  console.warn('WARNING: state.json vapid_public_key does not match the VAPID_PUBLIC_KEY secret. Phones subscribed with the wrong key will not receive pushes.');
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
        console.log(`Subscription gone (${e.statusCode}); removing.`);
      } else {
        console.warn(`Push failed for one subscription: ${e.statusCode || e.message}`);
      }
    }
  }
  console.log(`Unit ${plan.unit}: delivered to ${ok}/${subs.length}${dryRun ? ' (dry run)' : ''}`);
  // Only mark as notified if at least one phone accepted it; otherwise retry next run.
  if (ok > 0) sent.push(plan);
}

if (dryRun) process.exit(0);

for (let attempt = 0; attempt < 6; attempt++) {
  const cur = await readState();
  const next = applyResults(cur.data, sent, [...dead]);
  if (!next) break;
  const msg = `checker: notified ${sent.map((p) => p.unit).join(', ') || 'none'}` +
    (dead.size ? `, removed ${dead.size} subscription(s)` : '');
  if (await writeState(next, cur.sha, msg)) {
    console.log('state.json updated.');
    break;
  }
  console.log('Write conflict; retrying.');
  await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
}
