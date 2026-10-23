/**
 * What both commands check before the migrator starts: a Node.js new enough for its dependencies,
 * and those dependencies installed.
 *
 * Neither can be assumed. A host that installs the plugin by copying its folder (Claude Code,
 * Codex, Cowork) copies no node_modules, and an MCP host starts the command from a folder of its
 * own choosing. A missing loader used to end in a stack trace about `tsx`; an old Node.js in an
 * error from deep inside a dependency. Everything here is written to stderr, because under an MCP
 * host stdout is the protocol.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The newest minimum any runtime dependency states (undici 8 needs 22.19). package.json `engines` says the same. */
const REQUIRED_NODE = [22, 19, 0];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI = join(ROOT, 'packages', 'migrate-core', 'src', 'cli.ts');

const say = (line) => process.stderr.write(`${line}\n`);

export function nodeIsRecentEnough(version) {
  const have = version.split('.').map(Number);
  for (let i = 0; i < REQUIRED_NODE.length; i++) if (have[i] !== REQUIRED_NODE[i]) return have[i] > REQUIRED_NODE[i];
  return true;
}

/** The TypeScript loader, resolved from this file rather than from wherever the command was started. */
function loaderUrl() {
  try { return import.meta.resolve('tsx'); } catch { /* not installed yet */ }
  // read afresh: the resolver may remember that the package was missing a moment ago
  const manifest = join(ROOT, 'node_modules', 'tsx', 'package.json');
  if (!existsSync(manifest)) return undefined;
  const entry = JSON.parse(readFileSync(manifest, 'utf8')).exports?.['.'];
  const file = typeof entry === 'string' ? entry : entry?.import?.default ?? entry?.import ?? entry?.default;
  return typeof file === 'string' ? pathToFileURL(join(ROOT, 'node_modules', 'tsx', file)).href : undefined;
}

/** The exact versions package-lock.json pins, runtime packages only. */
function installDependencies() {
  say(`documentation-ai-migrate: first run from ${ROOT}; installing what it needs (once, about a minute)…`);
  const windows = process.platform === 'win32';
  const run = spawnSync(windows ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: ROOT, stdio: ['ignore', 2, 2], shell: windows });
  if (run.error) say(`  npm could not be started (${run.error.message}); it comes with Node.js from https://nodejs.org`);
  return run.status === 0;
}

export function launch(args) {
  if (!nodeIsRecentEnough(process.versions.node)) {
    say(`documentation-ai-migrate needs Node.js ${REQUIRED_NODE.join('.')} or newer; this is Node.js ${process.versions.node} (${process.execPath}).`);
    say('Install Node.js 22 or newer from https://nodejs.org (or run "nvm install 22"), then run the same command again.');
    process.exit(1);
  }
  let loader = loaderUrl();
  if (!loader && process.env.DAI_MIGRATE_NO_INSTALL !== '1' && installDependencies()) loader = loaderUrl();
  if (!loader) {
    say(`documentation-ai-migrate cannot start: its dependencies are not installed in ${ROOT}.`);
    say(`Run this once, then run the same command again:\n  cd "${ROOT}" && npm install`);
    process.exit(1);
  }
  const child = spawn(process.execPath, ['--import', loader, CLI, ...args], { stdio: 'inherit' });
  child.on('error', (error) => { say(`documentation-ai-migrate could not start: ${error.message}`); process.exit(1); });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
