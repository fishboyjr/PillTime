import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundle } from '../tv/build.mjs';

test('TV bundle is a plain script with no module syntax', () => {
  const src = bundle();
  assert.doesNotMatch(src, /^\s*(import|export)\b/m);
  new vm.Script(src); // throws on syntax error
});

test('TV bundle avoids syntax too new for webOS 5 (Chromium 68)', () => {
  const src = bundle().replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\?\./, 'optional chaining');
  assert.doesNotMatch(src, /\?\?/, 'nullish coalescing');
  assert.doesNotMatch(src, /\d_\d/, 'numeric separators');
});
