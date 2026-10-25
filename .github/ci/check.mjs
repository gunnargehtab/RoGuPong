// RoGuPong — static checks, run by CI on every push and pull request.
//
//   node --experimental-vm-modules .github/ci/check.mjs
//
// No dependencies, nothing executed: Node parses every module and links the
// game's and the trailer's import graphs without running a line of them.
// (Plain `node --check` won't do: with no package.json, Node 22 lets a file
// with import/export in it through even when it doesn't parse.)
//
// 1. Every JS file parses (the game's, the trailer's, sw.js, the Worker).
// 2. Every relative import points at a file that exists, and every name it
//    imports is one that file exports.
// 3. sw.js's ASSETS is exactly what index.html loads: the stylesheet, the
//    manifest and its icons, and main.js's whole import graph. A file missing
//    from it is not there offline; an entry that isn't a file makes
//    cache.addAll reject, and then nothing is cached at all.

import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRIES = ['js/main.js', 'js/trailer/trailer.js'];

const errors = [];
const fail = (msg) => errors.push(msg);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function jsFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = posix.join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return jsFiles(rel);
    return name.endsWith('.js') ? [rel] : [];
  });
}

/* ------------------------------------------------------------------ */
/* 1. Parse                                                            */

/** The line and column of a syntax error, which vm's own error leaves out. */
function locate(rel, type) {
  const args = type === 'module' ? ['--input-type=module', '--check'] : ['--check'];
  const out = spawnSync(process.execPath, args, { input: read(rel), encoding: 'utf8' }).stderr;
  const at = out.match(/^\[stdin\]:(\d+)/m);
  return at ? `${rel}:${at[1]}` : rel;
}

function parse(rel) {
  try {
    return new vm.SourceTextModule(read(rel), { identifier: rel });
  } catch (err) {
    fail(`${locate(rel, 'module')}: ${err.message}`);
    return null;
  }
}

const sources = [...jsFiles('js'), 'cloud/worker.js'];
const parsed = sources.filter((rel) => parse(rel)).length;

try {
  new vm.Script(read('sw.js'), { filename: 'sw.js' });
} catch (err) {
  fail(`${locate('sw.js', 'script')}: ${err.message}`);
}

/* ------------------------------------------------------------------ */
/* 2. Imports                                                          */

// Linking checks every import of the graph: that the file is there and that
// each name imported from it is exported. Each entry links modules of its
// own, so a break in one graph doesn't spill into the other. The Worker
// imports 'cloudflare:workers', which only exists on Cloudflare, so it is
// parsed above but not linked.

function linkGraph(entry) {
  const modules = new Map();
  const load = (rel) => {
    if (!modules.has(rel)) modules.set(rel, new vm.SourceTextModule(read(rel), { identifier: rel }));
    return modules.get(rel);
  };
  const linker = (specifier, referencing) => {
    const from = referencing.identifier;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      throw new Error(`${from} imports '${specifier}', which is not a relative path — the game has no packages`);
    }
    const rel = posix.normalize(posix.join(posix.dirname(from), specifier));
    if (!existsSync(join(ROOT, rel))) throw new Error(`${from} imports '${specifier}', but ${rel} does not exist`);
    try {
      return load(rel);
    } catch {
      throw new Error(`${from} imports ${rel}, which does not parse`);
    }
  };
  return load(entry).link(linker).then(
    () => ({ files: new Set(modules.keys()), ok: true }),
    (err) => {
      fail(`${entry}: ${blame(err.message, modules)}`);
      return { files: new Set(modules.keys()), ok: false };
    },
  );
}

/** V8 names the missing export but not who asked for it; find the importer. */
function blame(message, modules) {
  const m = message.match(/module '([^']+)' does not provide an export named '([^']+)'/);
  if (!m) return message;
  const [, specifier, name] = m;
  for (const rel of modules.keys()) {
    for (const imp of read(rel).matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
      if (imp[2] === specifier && new RegExp(`(^|[\\s,])${name}([\\s,]|$)`).test(imp[1])) {
        return `${rel} imports ${name} from '${specifier}', which doesn't export it`;
      }
    }
  }
  return message;
}

const graphs = {};
for (const entry of ENTRIES) {
  if (existsSync(join(ROOT, entry))) graphs[entry] = await linkGraph(entry);
  else fail(`${entry} is missing`);
}

/* ------------------------------------------------------------------ */
/* 3. The service worker's precache list                               */

const game = graphs['js/main.js'];
const list = read('sw.js').match(/const ASSETS = \[([\s\S]*?)\];/);
if (!list) {
  fail('sw.js: could not find the ASSETS array');
} else if (game?.ok) {
  const assets = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const listed = new Set(assets.filter((a) => a !== './'));
  if (!assets.includes('./')) fail(`sw.js: ASSETS is missing './', the page the home-screen icon opens`);
  for (const a of new Set(assets)) {
    if (assets.indexOf(a) !== assets.lastIndexOf(a)) fail(`sw.js: ASSETS lists ${a} twice`);
  }

  // What the game loads: index.html itself, its <link>s and <script>s, the
  // manifest's icons, anything the stylesheet points at, and main.js's
  // import graph.
  const loaded = new Set(['index.html']);
  for (const m of read('index.html').matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+)"/g)) {
    if (!/^(data:|[a-z]+:|\/\/)/.test(m[1])) loaded.add(posix.normalize(m[1]));
  }
  if (loaded.has('manifest.webmanifest')) {
    try {
      const manifest = JSON.parse(read('manifest.webmanifest'));
      for (const icon of manifest.icons || []) loaded.add(posix.normalize(icon.src));
    } catch (err) {
      fail(`manifest.webmanifest: ${err.message}`);
    }
  }
  for (const m of read('css/style.css').matchAll(/url\(\s*['"]?([^'")]+)/g)) {
    if (!m[1].startsWith('data:')) loaded.add(posix.normalize(posix.join('css', m[1])));
  }
  for (const rel of game.files) loaded.add(rel);

  for (const rel of loaded) {
    if (!listed.has(rel)) fail(`sw.js: ASSETS is missing ${rel}, which the game loads — it would not be there offline`);
  }
  for (const rel of listed) {
    if (!existsSync(join(ROOT, rel))) fail(`sw.js: ASSETS lists ${rel}, which does not exist — cache.addAll would fail and nothing would be cached`);
    else if (!loaded.has(rel)) fail(`sw.js: ASSETS lists ${rel}, which the game never loads`);
  }
}

/* ------------------------------------------------------------------ */

if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  if (game && !game.ok) console.error('  (the precache list is checked once js/main.js links)');
  console.error(`\n${errors.length} problem${errors.length === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log(`✓ ${parsed} modules and sw.js parse`);
for (const entry of ENTRIES) console.log(`✓ ${entry} links: ${graphs[entry].files.size} modules`);
console.log('✓ sw.js precaches exactly what the game loads');
