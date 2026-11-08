// Minimal GitHub Contents API client for one JSON file.
// Works in browsers, the TV and Node 18+. Plain syntax for old TV browsers
// except async/await (needs webOS 5 / Chromium 68 or later).

export function GitHubError(message, status) {
  var e = new Error(message);
  e.name = 'GitHubError';
  e.status = status;
  return e;
}

function utf8ToBase64(str) {
  var bytes = new TextEncoder().encode(str);
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToUtf8(b64) {
  var bin = atob(b64.replace(/\s/g, ''));
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function explain(status, body) {
  if (status === 401) return 'GitHub rejected the token (expired or mistyped).';
  if (status === 403) return 'The token is not allowed to do this (check its repository permissions).';
  if (status === 404) return 'Repository or file not found. Check owner, repo and path, and that the token can access that repo.';
  return 'GitHub error ' + status + (body && body.message ? ': ' + body.message : '');
}

// opts: { owner, repo, path, branch, token, fetchImpl }
export function GitHubFile(opts) {
  this.owner = opts.owner;
  this.repo = opts.repo;
  this.path = opts.path || 'state.json';
  this.branch = opts.branch || '';
  this.token = opts.token;
  this.fetchImpl = opts.fetchImpl || function (u, o) { return fetch(u, o); };
}

GitHubFile.prototype.url = function () {
  var path = this.path.split('/').map(encodeURIComponent).join('/');
  return 'https://api.github.com/repos/' + encodeURIComponent(this.owner) + '/' +
    encodeURIComponent(this.repo) + '/contents/' + path;
};

GitHubFile.prototype.headers = function () {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': 'Bearer ' + this.token,
    'X-GitHub-Api-Version': '2022-11-28'
  };
};

// Returns { sha, data }.
GitHubFile.prototype.read = async function () {
  var url = this.url() + (this.branch ? '?ref=' + encodeURIComponent(this.branch) : '');
  var res = await this.fetchImpl(url, { headers: this.headers(), cache: 'no-store' });
  var body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  if (!res.ok) throw GitHubError(explain(res.status, body), res.status);
  var data;
  try { data = JSON.parse(base64ToUtf8(body.content)); }
  catch (e) { throw GitHubError('The file is not valid JSON: ' + e.message, 0); }
  return { sha: body.sha, data: data };
};

// Writes data if the file's current SHA is still `sha`. Returns the new SHA.
GitHubFile.prototype.write = async function (data, sha, message) {
  var payload = {
    message: message,
    content: utf8ToBase64(JSON.stringify(data, null, 2) + '\n'),
    sha: sha
  };
  if (this.branch) payload.branch = this.branch;
  var h = this.headers();
  h['Content-Type'] = 'application/json';
  var res = await this.fetchImpl(this.url(), { method: 'PUT', headers: h, body: JSON.stringify(payload) });
  var body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  if (!res.ok) throw GitHubError(explain(res.status, body), res.status);
  return body.content.sha;
};

// Read, apply mutate(data) -> newData (or null for "no change"), write.
// If someone else wrote in between (SHA mismatch), re-read and retry.
// Returns { data, sha, changed }.
GitHubFile.prototype.update = async function (mutate, message, retries) {
  if (retries == null) retries = 5;
  for (var attempt = 0; ; attempt++) {
    var cur = await this.read();
    var next = mutate(cur.data);
    if (next === null || next === undefined) return { data: cur.data, sha: cur.sha, changed: false };
    try {
      var sha = await this.write(next, cur.sha, message);
      return { data: next, sha: sha, changed: true };
    } catch (e) {
      var conflict = e.status === 409 || e.status === 422;
      if (!conflict || attempt >= retries) throw e;
      await new Promise(function (r) { setTimeout(r, 300 * (attempt + 1) + Math.random() * 300); });
    }
  }
};
