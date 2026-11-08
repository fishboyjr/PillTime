import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubFile } from '../app/lib/github.js';

// Fake Contents API holding one file, with optional forced conflicts.
function fakeApi(initial, { conflicts = 0 } = {}) {
  let content = initial;
  let sha = 'sha0';
  let n = 0;
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers });
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if ((opts.method || 'GET') === 'GET') {
      return json(200, { sha, content: Buffer.from(JSON.stringify(content)).toString('base64').replace(/(.{60})/g, '$1\n') });
    }
    const body = JSON.parse(opts.body);
    if (conflicts > 0) {
      conflicts--;
      // Someone else wrote in between.
      content = { ...content, other: (content.other || 0) + 1 };
      sha = `sha${++n}`;
      return json(409, { message: 'conflict' });
    }
    if (body.sha !== sha) return json(409, { message: 'sha mismatch' });
    content = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
    sha = `sha${++n}`;
    return json(200, { content: { sha } });
  };
  return { fetchImpl, calls, get content() { return content; } };
}

const make = (api) => new GitHubFile({ owner: 'o', repo: 'r', path: 'state.json', token: 'tok', fetchImpl: api.fetchImpl });

test('reads UTF-8 JSON and sends the token', async () => {
  const api = fakeApi({ name: 'Médication ✓' });
  const { data, sha } = await make(api).read();
  assert.equal(data.name, 'Médication ✓');
  assert.equal(sha, 'sha0');
  assert.equal(api.calls[0].url, 'https://api.github.com/repos/o/r/contents/state.json');
  assert.equal(api.calls[0].headers.Authorization, 'Bearer tok');
});

test('update retries on SHA conflict and re-applies the change to fresh data', async () => {
  const api = fakeApi({ count: 0 }, { conflicts: 2 });
  const res = await make(api).update((d) => ({ ...d, count: d.count + 1 }), 'msg');
  assert.equal(res.changed, true);
  assert.deepEqual(api.content, { count: 1, other: 2 }, 'kept the other writer\'s change');
});

test('update gives up after the retry limit', async () => {
  const api = fakeApi({ count: 0 }, { conflicts: 10 });
  await assert.rejects(make(api).update((d) => ({ ...d, count: 1 }), 'msg', 2), (e) => e.status === 409);
});

test('mutate returning null writes nothing', async () => {
  const api = fakeApi({ a: 1 });
  const res = await make(api).update(() => null, 'msg');
  assert.equal(res.changed, false);
  assert.equal(api.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('friendly errors', async () => {
  const gh = new GitHubFile({ owner: 'o', repo: 'r', token: 't', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  await assert.rejects(gh.read(), /rejected the token/);
});
