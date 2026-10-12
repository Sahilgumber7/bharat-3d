import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const { rewrites } = JSON.parse(read('../../../vercel.json'));

// The deployed site serves the repo through rewrites, not as a plain file tree.
// A demo whose importmap points somewhere no rewrite covers renders a blank
// page in production while working locally — exactly what /logistics/ did.
test('every demo importmap target resolves under the production rewrites', () => {
  for (const [page, url] of [['../examples/logistics/index.html', '/logistics/']]) {
    const map = JSON.parse(read(page).match(/<script type="importmap">\s*([\s\S]*?)<\/script>/)[1]);
    for (const [name, target] of Object.entries(map.imports)) {
      const served = new URL(target, 'https://x.test' + url).pathname;
      const hit = rewrites.some((r) => new RegExp(`^${r.source.replace(/\(\.\*\)/g, '.*')}$`).test(served));
      assert.ok(hit, `${name} -> ${served} has no rewrite in vercel.json`);
    }
  }
});
