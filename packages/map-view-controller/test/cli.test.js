import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin/cli.mjs');

// Strip ANSI colour codes so assertions can match plain text.
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('help lists every command', async () => {
  const { stdout } = await run('node', [CLI, 'help']);
  const out = plain(stdout);
  assert.match(out, /list \[filter\]/);
  assert.match(out, /add <slug>/);
  assert.match(out, /preview <slug>/);
});

test('with no command, defaults to help rather than erroring', async () => {
  const { stdout } = await run('node', [CLI]);
  assert.match(plain(stdout), /Usage/);
});

test('list prints every state with its district and sub-district counts', async () => {
  const { stdout } = await run('node', [CLI, 'list']);
  const out = plain(stdout);
  assert.match(out, /36 of 36 states\/UTs · 785 districts · 6472 sub-districts total/);
  assert.match(out, /bihar\s+Bihar\s+38 districts, 533 sub-districts/);
});

test('list filters by name or slug', async () => {
  const { stdout } = await run('node', [CLI, 'list', 'kerala']);
  const out = plain(stdout);
  assert.match(out, /1 of 36 states\/UTs/);
  assert.doesNotMatch(out, /bihar/i);
});

test('list on an unmatched filter fails loudly', async () => {
  await assert.rejects(run('node', [CLI, 'list', 'atlantis']), /No state matches/);
});

test('add scaffolds a runnable html starter with real counts', async (t) => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bharat3d-cli-'));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));

  const { stdout } = await run('node', [CLI, 'add', 'goa', '--out', outDir]);
  const out = plain(stdout);
  assert.match(out, /Goa \(2 districts, 12 sub-districts\) scaffolded/);

  const files = await fs.readdir(outDir);
  assert.ok(files.includes('index.html'), 'template files were not written');

  const html = await fs.readFile(path.join(outDir, 'index.html'), 'utf8');
  assert.match(html, /goa/);
  assert.doesNotMatch(html, /__SLUG__|__NAME__|__DISTRICTS__/, 'template placeholders were left unreplaced');
});

test('add refuses to overwrite a non-empty --out', async (t) => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bharat3d-cli-'));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(outDir, 'keep-me.txt'), 'pre-existing work');

  await assert.rejects(run('node', [CLI, 'add', 'goa', '--out', outDir]), /already exists and is not empty/);
});

test('add rejects an unknown state slug', async () => {
  await assert.rejects(run('node', [CLI, 'add', 'atlantis']), /Unknown state "atlantis"/);
});

test('add rejects an unknown --framework', async (t) => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bharat3d-cli-'));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));
  await assert.rejects(
    run('node', [CLI, 'add', 'goa', '--out', outDir, '--framework', 'svelte']),
    /Unknown --framework/
  );
});

test('preview serves the requested state on the requested port', async (t) => {
  const port = 5980 + Math.floor(Math.random() * 400);
  const child = execFile('node', [CLI, 'preview', 'sikkim', '--port', String(port)]);
  t.after(() => child.kill());

  // Wait for the server's own "listening" line rather than a fixed sleep.
  await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('preview server never printed its banner')), 5000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (plain(out).includes(`http://localhost:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', reject);
  });

  const res = await fetch(`http://localhost:${port}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /sikkim/);
  assert.doesNotMatch(html, /__SLUG__|__NAME__/, 'preview left template placeholders unreplaced');

  const dataRes = await fetch(`http://localhost:${port}/data/states/index.js`);
  assert.equal(dataRes.status, 200);
});
