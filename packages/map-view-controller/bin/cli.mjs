#!/usr/bin/env node
/**
 * npx @bharat3d/state-maps <command>
 *
 *   list [filter]       list every state and UT, with slug and district count
 *   add <slug> [--out]  scaffold a ready-to-run starter for one state
 *   preview <slug>      serve a live preview on localhost, no install needed
 *   help
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  accent: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
};

const registry = await import(pathToFileURL(path.join(ROOT, 'data/states/index.js')).href);

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : dflt;
};
const positional = rest.filter((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'));

/* ------------------------------------------------------------------ */

function help() {
  console.log(`
${c.bold(PKG.name)} ${c.dim('v' + PKG.version)}
${c.dim(PKG.description)}

${c.bold('Usage')}
  npx ${PKG.name} <command>

${c.bold('Commands')}
  ${c.accent('list')} [filter]        Every state and UT, with its slug and district count
  ${c.accent('add')} <slug>           Scaffold a runnable starter for one state
       --out <dir>        Where to write it            ${c.dim('(default: ./<slug>-map)')}
       --framework <f>    html | react                 ${c.dim('(default: html)')}
  ${c.accent('preview')} <slug>       Serve a live preview on localhost
       --port <n>                                      ${c.dim('(default: 5179)')}
  ${c.accent('help')}

${c.bold('Examples')}
  npx ${PKG.name} list kerala
  npx ${PKG.name} preview bihar
  npx ${PKG.name} add tamil-nadu --framework react
`);
}

function list() {
  const q = (positional[0] || '').toLowerCase();
  const rows = registry.STATES.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.slug.includes(q)
  );
  if (!rows.length) {
    console.error(c.red(`No state matches "${q}".`));
    process.exitCode = 1;
    return;
  }
  const w = Math.max(...rows.map((s) => s.slug.length));
  console.log();
  for (const s of rows) {
    console.log(`  ${c.accent(s.slug.padEnd(w))}  ${s.name.padEnd(28)} ${c.dim(`${s.districtCount} districts`)}`);
  }
  console.log(
    c.dim(`\n  ${rows.length} of ${registry.STATE_COUNT} states/UTs · ${registry.DISTRICT_COUNT} districts total\n`)
  );
}

function requireState(slug) {
  if (!slug) {
    console.error(c.red('Missing <slug>.') + ` Run ${c.accent(`npx ${PKG.name} list`)} to see them all.`);
    process.exit(1);
  }
  const entry = registry.findState(slug);
  if (!entry) {
    const near = registry.STATES.filter((s) => s.slug.includes(slug) || slug.includes(s.slug.slice(0, 4)));
    console.error(c.red(`Unknown state "${slug}".`));
    if (near.length) console.error(`Did you mean: ${near.map((s) => c.accent(s.slug)).join(', ')}?`);
    else console.error(`Run ${c.accent(`npx ${PKG.name} list`)} to see all ${registry.STATE_COUNT}.`);
    process.exit(1);
  }
  return entry;
}

async function add() {
  const entry = requireState(positional[0]);
  const framework = flag('framework', 'html');
  const outDir = path.resolve(flag('out', `./${entry.slug}-map`));

  const templateDir = path.join(ROOT, 'templates', framework);
  if (!(await exists(templateDir))) {
    console.error(c.red(`Unknown --framework "${framework}".`) + ' Use `html` or `react`.');
    process.exit(1);
  }

  if (await exists(outDir)) {
    const entries = await fs.readdir(outDir);
    if (entries.length) {
      console.error(c.red(`${path.relative(process.cwd(), outDir) || '.'} already exists and is not empty.`));
      console.error('Pass a different --out, or remove it first.');
      process.exit(1);
    }
  }
  await fs.mkdir(outDir, { recursive: true });

  const vars = {
    __SLUG__: entry.slug,
    __NAME__: entry.name,
    __DISTRICTS__: String(entry.districtCount),
    __PKG__: PKG.name,
    __VERSION__: PKG.version,
  };

  const files = await fs.readdir(templateDir);
  for (const f of files) {
    let body = await fs.readFile(path.join(templateDir, f), 'utf8');
    for (const [k, v] of Object.entries(vars)) body = body.replaceAll(k, v);
    // `.gitignore` etc. can't ship under their real name inside an npm package.
    await fs.writeFile(path.join(outDir, f.replace(/^_/, '.')), body);
  }

  const rel = path.relative(process.cwd(), outDir) || '.';
  console.log(`
${c.green('✓')} ${c.bold(entry.name)} ${c.dim(`(${entry.districtCount} districts)`)} scaffolded into ${c.accent(rel)}

  ${c.dim('next:')}
    cd ${rel}
${framework === 'html' ? `    npx serve .            ${c.dim('# no install needed — loads three + the package from a CDN')}` : `    npm install\n    npm run dev`}
`);
}

async function preview() {
  const entry = requireState(positional[0]);
  const port = Number(flag('port', '5179'));

  const page = (await fs.readFile(path.join(ROOT, 'templates/html/index.html'), 'utf8'))
    .replaceAll('__SLUG__', entry.slug)
    .replaceAll('__NAME__', entry.name)
    .replaceAll('__DISTRICTS__', String(entry.districtCount))
    .replaceAll('__PKG__', PKG.name)
    .replaceAll('__VERSION__', PKG.version)
    // Preview runs against this checkout, not the CDN, so local edits show up.
    // The whole import map is swapped rather than URL-patched: the template's
    // trailing-slash entry ("pkg/" -> CDN root) relies on npm exports
    // resolution, which the browser has no way to do against a local folder.
    .replace(
      /<script type="importmap">[\s\S]*?<\/script>/,
      `<script type="importmap">
  {
    "imports": {
      "three": "https://esm.sh/three@0.160.0",
      "${PKG.name}": "/src/index.js",
      "${PKG.name}/data": "/data/states/index.js"
    }
  }
  </script>`
    );

  const types = {
    '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
    '.html': 'text/html', '.css': 'text/css', '.map': 'application/json',
  };

  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page);
    }
    // Serve only from inside the package — no traversal above ROOT.
    const target = path.join(ROOT, path.normalize(url).replace(/^([/\\])+/, ''));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    try {
      const body = await fs.readFile(target);
      res.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(c.red(`Port ${port} is in use.`) + ` Try ${c.accent(`--port ${port + 1}`)}.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(`
  ${c.bold(entry.name)} ${c.dim(`· ${entry.districtCount} districts`)}
  ${c.accent(`http://localhost:${port}`)}   ${c.dim('ctrl-c to stop')}
`);
  });
}

const exists = (p) => fs.access(p).then(() => true, () => false);

switch (cmd) {
  case 'list': case 'ls': list(); break;
  case 'add': case 'init': await add(); break;
  case 'preview': case 'dev': await preview(); break;
  case 'help': case '--help': case '-h': case undefined: help(); break;
  case '--version': case '-v': console.log(PKG.version); break;
  default:
    console.error(c.red(`Unknown command "${cmd}".`));
    help();
    process.exitCode = 1;
}
