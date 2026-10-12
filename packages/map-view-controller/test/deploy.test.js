import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel) => readFileSync(here(rel), 'utf8');
const { rewrites } = JSON.parse(read('../../../vercel.json'));

// The deployed site serves the repo through rewrites, not as a plain file tree.
// A demo whose imports point somewhere no rewrite covers renders a blank page
// in production while working locally — exactly what /logistics/ did once.
const covered = (servedPath) =>
  rewrites.some((r) => new RegExp(`^${r.source.replace(/\(\.\*\)/g, '.*')}$`).test(servedPath));

const DIR = '../examples/logistics/';
const PAGE_URL = '/logistics/';

test('importmap targets of the logistics page resolve on disk and under the production rewrites', () => {
  const map = JSON.parse(read(DIR + 'index.html').match(/<script type="importmap">\s*([\s\S]*?)<\/script>/)[1]);
  for (const [name, target] of Object.entries(map.imports)) {
    const served = new URL(target, 'https://x.test' + PAGE_URL).pathname;
    assert.ok(covered(served), `${name} -> ${served} has no rewrite in vercel.json`);
    if (!target.endsWith('/')) assert.ok(existsSync(here(DIR + target)), `${name} -> ${target} is missing on disk`);
  }
});

test('every relative import in the logistics app resolves on disk and under the rewrites', () => {
  const files = readdirSync(here(DIR)).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 4);
  for (const f of files) {
    const src = read(DIR + f);
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const served = new URL(m[1], 'https://x.test' + PAGE_URL + f).pathname;
      assert.ok(covered(served), `${f}: ${m[1]} -> ${served} has no rewrite in vercel.json`);
      assert.ok(existsSync(here(DIR + m[1])), `${f}: ${m[1]} is missing on disk`);
    }
  }
});

test('the page loads its stylesheet and entry script from paths the rewrites cover', () => {
  const html = read(DIR + 'index.html');
  for (const m of html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)) {
    const served = new URL(m[1], 'https://x.test' + PAGE_URL).pathname;
    assert.ok(covered(served), `${m[1]} -> ${served} is not routed`);
    assert.ok(existsSync(here(DIR + m[1])), `${m[1]} is missing on disk`);
  }
});
