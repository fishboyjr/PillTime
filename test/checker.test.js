import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planNotifications, applyResults } from '../data-repo-template/checker/logic.mjs';
import { applyGiven } from '../app/lib/schedule.js';

const sample = () => JSON.parse(readFileSync(new URL('../data-repo-template/state.json', import.meta.url), 'utf8'));
const T0 = Date.parse('2026-11-08T10:00:00Z');
const H = 3600000;

function given() {
  let s = applyGiven(sample(), 'q6', new Date(T0).toISOString(), 'A', T0);
  s = applyGiven(s, 'am', '2026-11-08T13:00:00Z', 'A', Date.parse('2026-11-08T13:00:00Z'));
  s.subscriptions = [{ endpoint: 'e1', keys: { p256dh: 'p', auth: 'a' } }, { endpoint: 'e2', keys: { p256dh: 'p', auth: 'a' } }];
  return s;
}

test('nothing planned before due or when never given', () => {
  assert.deepEqual(planNotifications(sample(), T0), []);
  assert.deepEqual(planNotifications(given(), T0 + 5 * H), []);
});

test('one plan per due group, with both names', () => {
  const plans = planNotifications(given(), T0 + 6 * H + 60000);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].unit, 'q6');
  assert.match(plans[0].payload.body, /6-hour med A> \+ <TBD 6-hour med B>: due 11:00 AM/);
  assert.deepEqual(Object.keys(plans[0].dueFor), ['q6a', 'q6b']);
});

test('overdue wording after 15 minutes', () => {
  const [p] = planNotifications(given(), T0 + 7 * H);
  assert.match(p.payload.body, /overdue since 11:00 AM/);
});

test('lead time notifies early', () => {
  const s = given();
  s.settings.notify_lead_minutes = 10;
  assert.equal(planNotifications(s, T0 + 6 * H - 5 * 60000).length, 1);
  assert.equal(planNotifications(s, T0 + 6 * H - 15 * 60000).length, 0);
});

test('dedupe: once notified, the same dose is not re-sent; next dose is', () => {
  let s = given();
  const now = T0 + 6 * H + 60000;
  const plans = planNotifications(s, now);
  s = applyResults(s, plans, []);
  assert.equal(s.meds[1].notified_for, s.meds[1].next_due);
  assert.deepEqual(planNotifications(s, now + 2 * H), []);
  s = applyGiven(s, 'q6', new Date(now + 2 * H).toISOString(), 'B', now + 2 * H);
  assert.equal(planNotifications(s, now + 8 * H + 60000).length, 1);
});

test('applyResults skips meds logged since planning, and removes dead subscriptions', () => {
  const s = given();
  const now = T0 + 6 * H + 60000;
  const plans = planNotifications(s, now);
  const fresher = applyGiven(s, 'q6', new Date(now).toISOString(), 'B', now);
  const out = applyResults(fresher, plans, ['e2']);
  assert.equal(out.meds[1].notified_for, null, 'new dose not marked as notified');
  assert.deepEqual(out.subscriptions.map((x) => x.endpoint), ['e1']);
  assert.equal(applyResults(fresher, plans, []), null, 'no change -> null');
});
