import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  nextDailySlotAfter, nextDueAfterGiven, applyGiven, previewGiven, getUnits,
  unitStatus, undoableEntry, applyUndo, validateState, upsertSubscription,
  removeSubscription, localToInstant, HOUR_MS
} from '../app/lib/schedule.js';
import { formatWhen, formatRelative } from '../app/lib/format.js';

const TZ = 'America/New_York';
const sample = () => JSON.parse(readFileSync(new URL('../data-repo-template/state.json', import.meta.url), 'utf8'));
const iso = (s) => new Date(s).toISOString();

test('sample state.json is valid', () => {
  assert.deepEqual(validateState(sample()), []);
});

test('validateState catches problems', () => {
  const s = sample();
  s.meds[2].schedule = { type: 'interval', hours: 8 };
  s.meds[0].schedule.time = '8am';
  s.timezone = 'Not/AZone';
  const errs = validateState(s).join('\n');
  assert.match(errs, /same schedule/);
  assert.match(errs, /Bad time/);
  assert.match(errs, /timezone/);
});

test('units group the two 6-hour meds', () => {
  const units = getUnits(sample());
  assert.deepEqual(units.map((u) => u.id), ['am', 'q6']);
  assert.equal(units[1].meds.length, 2);
});

test('localToInstant handles EST and EDT', () => {
  assert.equal(iso(localToInstant(2026, 1, 15, 8, 0, TZ)), '2026-01-15T13:00:00.000Z');
  assert.equal(iso(localToInstant(2026, 7, 15, 8, 0, TZ)), '2026-07-15T12:00:00.000Z');
});

test('daily slot is the next 08:00 local, across DST change', () => {
  // DST ends 2026-11-01 in New York.
  const t = Date.parse('2026-10-31T13:00:00Z'); // 09:00 EDT on Oct 31
  assert.equal(iso(nextDailySlotAfter(t, '08:00', TZ)), '2026-11-01T13:00:00.000Z'); // 08:00 EST
});

test('interval: next due is 6 h after the actual dose, even when late', () => {
  const med = sample().meds[1];
  const late = Date.parse('2026-11-08T15:40:00Z');
  assert.equal(iso(nextDueAfterGiven(med, late, TZ)), '2026-11-08T21:40:00.000Z');
});

test('daily: logging late does not move the next day time', () => {
  const med = sample().meds[0];
  // 14:00 EST, six hours late
  assert.equal(iso(nextDueAfterGiven(med, Date.parse('2026-11-08T19:00:00Z'), TZ)), '2026-11-09T13:00:00.000Z');
  // 23:30 EST, very late: still tomorrow 08:00
  assert.equal(iso(nextDueAfterGiven(med, Date.parse('2026-11-09T04:30:00Z'), TZ)), '2026-11-09T13:00:00.000Z');
  // 07:30 EST, slightly early: counts for today, next is tomorrow
  assert.equal(iso(nextDueAfterGiven(med, Date.parse('2026-11-08T12:30:00Z'), TZ)), '2026-11-09T13:00:00.000Z');
  // 05:00 EST, more than 2 h early: does not count, 08:00 today still due
  assert.equal(iso(nextDueAfterGiven(med, Date.parse('2026-11-08T10:00:00Z'), TZ)), '2026-11-08T13:00:00.000Z');
});

test('applyGiven on the q6 group updates both meds and logs who and when', () => {
  const now = Date.parse('2026-11-08T16:00:00Z');
  const s = applyGiven(sample(), 'q6', '2026-11-08T15:55:00Z', 'Sam', now);
  for (const id of ['q6a', 'q6b']) {
    const m = s.meds.find((x) => x.id === id);
    assert.deepEqual(m.last_given, { at: '2026-11-08T15:55:00.000Z', by: 'Sam' });
    assert.equal(m.next_due, '2026-11-08T21:55:00.000Z');
  }
  assert.equal(s.meds[0].last_given, null, 'morning med untouched');
  assert.equal(s.log.length, 1);
  assert.equal(s.log[0].by, 'Sam');
  assert.deepEqual(s.log[0].meds, ['q6a', 'q6b']);
});

test('applyGiven rejects future times and unknown units, and does not mutate input', () => {
  const s = sample();
  const now = Date.parse('2026-11-08T16:00:00Z');
  assert.throws(() => applyGiven(s, 'q6', '2026-11-08T17:00:00Z', 'Sam', now), /future/);
  assert.throws(() => applyGiven(s, 'nope', '2026-11-08T15:00:00Z', 'Sam', now), /Unknown/);
  applyGiven(s, 'q6', '2026-11-08T15:00:00Z', 'Sam', now);
  assert.equal(s.meds[1].last_given, null);
});

test('log is capped', () => {
  let s = sample();
  s.settings.log_limit = 3;
  for (let i = 0; i < 5; i++) {
    s = applyGiven(s, 'q6', iso(Date.parse('2026-11-08T00:00:00Z') + i * 6 * HOUR_MS), 'A', Date.parse('2026-11-09T12:00:00Z'));
  }
  assert.equal(s.log.length, 3);
});

test('undo restores the previous dose, only for the latest entry', () => {
  const now = Date.parse('2026-11-08T22:00:00Z');
  const s1 = applyGiven(sample(), 'q6', '2026-11-08T10:00:00Z', 'A', now);
  const s2 = applyGiven(s1, 'q6', '2026-11-08T16:00:00Z', 'B', now);
  const e = undoableEntry(s2, 'q6');
  assert.equal(e.by, 'B');
  const s3 = applyUndo(s2, 'q6', e.id, 'C', now);
  assert.equal(s3.meds[1].last_given.by, 'A');
  assert.equal(s3.meds[1].next_due, '2026-11-08T16:00:00.000Z');
  assert.equal(undoableEntry(s3, 'q6'), null, 'one step of undo only');
  assert.throws(() => applyUndo(s3, 'q6', e.id, 'C', now));
});

test('preview warns on early and repeated daily doses and early interval doses', () => {
  const now = Date.parse('2026-11-08T23:00:00Z');
  let s = applyGiven(sample(), 'am', '2026-11-08T13:05:00Z', 'A', now); // 08:05 EST
  assert.match(previewGiven(s, 'am', '2026-11-09T01:00:00Z').warning, /already logged/);
  // next morning 05:00 EST: still inside yesterday's covered period
  assert.match(previewGiven(s, 'am', '2026-11-09T10:00:00Z').warning, /extra dose/);
  assert.equal(previewGiven(s, 'am', '2026-11-09T12:30:00Z').warning, null);
  assert.equal(previewGiven(s, 'am', '2026-11-09T19:00:00Z').warning, null, '6 h late: 18 h gap is fine');
  // Missed a day (pending slot is in the past), then 05:00: too early for today's 08:00
  const missed = sample();
  missed.meds[0].next_due = '2026-11-08T13:00:00.000Z';
  assert.match(previewGiven(missed, 'am', '2026-11-09T10:00:00Z').warning, /only 3 h after this one/);
  s = applyGiven(s, 'q6', '2026-11-08T15:00:00Z', 'A', now);
  assert.match(previewGiven(s, 'q6', '2026-11-08T18:00:00Z').warning, /restarts the 6-hour timer/);
  assert.equal(previewGiven(s, 'q6', '2026-11-08T21:30:00Z').warning, null);
});

test('unitStatus levels', () => {
  const s = applyGiven(sample(), 'q6', '2026-11-08T10:00:00Z', 'A', Date.parse('2026-11-08T10:00:00Z'));
  const u = getUnits(s)[1];
  assert.equal(unitStatus(u, Date.parse('2026-11-08T12:00:00Z')).level, 'ok');
  assert.equal(unitStatus(u, Date.parse('2026-11-08T15:45:00Z')).level, 'soon');
  assert.equal(unitStatus(u, Date.parse('2026-11-08T16:00:00Z')).level, 'due');
  assert.equal(unitStatus(getUnits(s)[0], 0).level, 'unknown');
});

test('subscriptions upsert by endpoint and remove', () => {
  const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
  let s = upsertSubscription(sample(), sub, 'Sam', 0);
  s = upsertSubscription(s, { ...sub, keys: { p256dh: 'p2', auth: 'a2' } }, 'Sam', 1000);
  assert.equal(s.subscriptions.length, 1);
  assert.equal(s.subscriptions[0].keys.p256dh, 'p2');
  assert.equal(s.subscriptions[0].added_at, new Date(0).toISOString());
  assert.equal(removeSubscription(s, sub.endpoint).subscriptions.length, 0);
});

test('formatting', () => {
  const now = Date.parse('2026-11-08T17:00:00Z'); // 12:00 EST
  assert.equal(formatWhen(Date.parse('2026-11-08T19:00:00Z'), now, TZ), 'Today 2:00 PM');
  assert.equal(formatWhen(Date.parse('2026-11-09T13:00:00Z'), now, TZ), 'Tomorrow 8:00 AM');
  assert.equal(formatWhen(Date.parse('2026-11-08T04:00:00Z'), now, TZ), 'Yesterday 11:00 PM');
  assert.equal(formatWhen(Date.parse('2026-11-12T05:05:00Z'), now, TZ), 'Thu 11/12 12:05 AM');
  assert.equal(formatWhen(Date.parse('2026-11-08T17:30:00Z'), now, TZ), 'Today 12:30 PM');
  assert.equal(formatRelative(now + 125 * 60000, now), 'in 2 h 5 min');
  assert.equal(formatRelative(now - 35 * 60000, now), '35 min ago');
});
