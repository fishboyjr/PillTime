#!/usr/bin/env node
// Builds the sideloadable webOS TV app into tv/dist/ and, if the webOS CLI
// (ares-package) is installed, packages it as an .ipk.
//
//   node tv/build.mjs --demo     (sample data, meds come due 2 and 5 min after launch)
//   PILLTIME_OWNER=me PILLTIME_REPO=pilltime-data PILLTIME_TV_TOKEN=github_pat_... node tv/build.mjs
//
// Optional: PILLTIME_PATH (default state.json), PILLTIME_BRANCH.
// The token must be a fine-grained token with Contents: Read-only on the data
// repo only. It ends up inside the .ipk: never publish the .ipk or tv/dist/.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(here, 'dist');
const noToken = process.argv.includes('--no-token'); // for CI syntax checks
const demo = process.argv.includes('--demo'); // sample data, no repo or token needed

// Turn the ES modules into one plain script: drop import lines and the
// `export` keyword. The lib files are written so that this is safe.
export function bundle() {
  const parts = ['app/lib/schedule.js', 'app/lib/format.js', 'app/lib/github.js', 'app/lib/demo.js'].map((f) => {
    const src = readFileSync(join(root, f), 'utf8')
      .replace(/^import .*$/gm, '')
      .replace(/^export \{[^}]*\};?$/gm, '')
      .replace(/^export (?=(var|const|let|function|async function|class) )/gm, '');
    if (/^\s*(import|export)\b/m.test(src)) throw new Error(`${f}: unsupported import/export form`);
    return `// ---- ${f} ----\n${src}`;
  });
  parts.push(`// ---- tv/tv.js ----\n${readFileSync(join(here, 'tv.js'), 'utf8')}`);
  return `(function () {\n'use strict';\n${parts.join('\n')}\n})();\n`;
}

function main() {
  const cfg = {
    owner: process.env.PILLTIME_OWNER || '',
    repo: process.env.PILLTIME_REPO || '',
    path: process.env.PILLTIME_PATH || 'state.json',
    branch: process.env.PILLTIME_BRANCH || '',
    token: noToken || demo ? '' : (process.env.PILLTIME_TV_TOKEN || ''),
    demo
  };
  if (!noToken && !demo && (!cfg.owner || !cfg.repo || !cfg.token)) {
    console.error('Set PILLTIME_OWNER, PILLTIME_REPO and PILLTIME_TV_TOKEN (read-only token).');
    process.exit(1);
  }
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'bundle.js'), bundle());
  writeFileSync(join(dist, 'config.js'), `window.PILLTIME_CONFIG = ${JSON.stringify(cfg)};\n`);
  for (const f of ['appinfo.json', 'index.html', 'tv.css', 'icon.png', 'largeIcon.png']) {
    copyFileSync(join(here, f), join(dist, f));
  }
  if (existsSync(join(here, 'webOSTV.js'))) {
    copyFileSync(join(here, 'webOSTV.js'), join(dist, 'webOSTV.js'));
  } else {
    console.warn('tv/webOSTV.js not found: system toasts will be skipped. Get it from the webOS TV SDK.');
  }
  console.log(`Built ${dist}`);
  if (noToken) return;
  try {
    execFileSync('ares-package', [dist, '-o', here], { stdio: 'inherit' });
  } catch {
    console.log('ares-package not available; install the webOS CLI to make an .ipk (see tv/README.md).');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
