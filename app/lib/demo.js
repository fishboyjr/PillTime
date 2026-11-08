// Demo mode: same interface as GitHubFile, but the state lives in this
// browser's localStorage. Lets someone try the app without a data repo.
import { applyGiven, HOUR_MS } from './schedule.js';

const KEY = 'pilltime.demoState';

export function demoSeed(now = Date.now()) {
  let tz = 'UTC';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep UTC */ }
  let s = {
    schema_version: 1,
    timezone: tz,
    vapid_public_key: '',
    settings: { notify_lead_minutes: 0, tv_repeat_minutes: 30, log_limit: 500 },
    meds: [
      { id: 'am', name: 'Morning med (demo)', schedule: { type: 'daily', time: '08:00', early_window_hours: 2 }, last_given: null, next_due: null, notified_for: null },
      { id: 'q6a', group: 'q6', name: '6-hour med A (demo)', schedule: { type: 'interval', hours: 6 }, last_given: null, next_due: null, notified_for: null },
      { id: 'q6b', group: 'q6', name: '6-hour med B (demo)', schedule: { type: 'interval', hours: 6 }, last_given: null, next_due: null, notified_for: null }
    ],
    subscriptions: [],
    log: []
  };
  // Some history so the screen has something to show: the 6-hour pair is
  // due in about 40 minutes, and the morning med was given yesterday.
  s = applyGiven(s, 'am', new Date(now - 26 * HOUR_MS).toISOString(), 'Demo', now);
  s = applyGiven(s, 'q6', new Date(now - 5 * HOUR_MS - 20 * 60000).toISOString(), 'Demo', now);
  return s;
}

export class DemoFile {
  constructor() { this.demo = true; }

  async read() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(KEY)); } catch { data = null; }
    if (!data) {
      data = demoSeed();
      this._save(data);
    }
    return { sha: 'demo', data };
  }

  _save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  async update(mutate) {
    const cur = await this.read();
    const next = mutate(cur.data);
    if (next === null || next === undefined) return { data: cur.data, sha: 'demo', changed: false };
    this._save(next);
    return { data: next, sha: 'demo', changed: true };
  }

  static reset() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }
}
