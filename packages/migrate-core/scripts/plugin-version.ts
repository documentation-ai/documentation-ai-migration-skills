/**
 * The plugin's version, which is how customers receive a change.
 *
 * Claude Code and Codex deliver an update to an installed plugin only when its version rises: with
 * the version unchanged, a customer who runs "update" keeps the old files, whatever was merged.
 * Three manifests state it (`.claude-plugin/plugin.json`, `plugin.json`, `.codex-plugin/plugin.json`)
 * and they must agree.
 *
 *   npm run version:bump -- <patch|minor|major|x.y.z>   raise it in all three manifests
 *   npm run version:check [-- --base <git ref>]          refuse a change customers would never get
 *
 * `check` fails when the manifests disagree and, given the branch a pull request merges into, when
 * the pull request changes what customers install without raising the version.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MANIFESTS = ['.claude-plugin/plugin.json', 'plugin.json', '.codex-plugin/plugin.json'];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A file customers install that changes what a migration does; tests, docs and repository tooling do not. */
export function shipsToCustomers(path: string): boolean {
  if (/^packages\/[^/]+\/(?:test|scripts)\//.test(path)) return false;
  if (/^(?:packages|skills|references|\.claude-plugin|\.codex-plugin|\.agents)\//.test(path)) return true;
  return ['plugin.json', '.mcp.json', 'package.json', 'package-lock.json'].includes(path);
}

function parse(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`"${version}" is not a version (major.minor.patch)`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewer(next: string, previous: string): boolean {
  const a = parse(next); const b = parse(previous);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function raised(current: string, how: string): string {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;
  const [major, minor, patch] = parse(current);
  if (how === 'major') return `${major + 1}.0.0`;
  if (how === 'minor') return `${major}.${minor + 1}.0`;
  if (how === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`bump takes patch, minor, major or a version such as 1.2.3, not "${how}"`);
}

export function versionsIn(read: (file: string) => string): Record<string, string> {
  return Object.fromEntries(MANIFESTS.map((file) => [file, String((JSON.parse(read(file)) as { version?: unknown }).version ?? '')]));
}

/** What stops this change reaching customers, in words a contributor can act on; empty when nothing does. */
export function versionProblems(versions: Record<string, string>, base?: { ref: string; version: string; changed: string[] }): string[] {
  const stated = [...new Set(Object.values(versions))];
  if (stated.length !== 1) return [`The plugin manifests state different versions (${Object.entries(versions).map(([file, version]) => `${file} ${version || 'none'}`).join(', ')}). Set one with "npm run version:bump -- <x.y.z>".`];
  if (!base) return [];
  const shipped = base.changed.filter(shipsToCustomers);
  if (!shipped.length || isNewer(stated[0], base.version)) return [];
  return [`This change reaches customers (${shipped.slice(0, 3).join(', ')}${shipped.length > 3 ? ` and ${shipped.length - 3} more` : ''}) but the plugin version is ${stated[0]}, as on ${base.ref}. Claude Code and Codex deliver an update only when the version rises, so installed copies would keep the old files: run "npm run version:bump -- patch" (or minor for new features) and commit the three manifests.`];
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function main(args: string[]): void {
  const [command, ...rest] = args;
  const versions = versionsIn((file) => readFileSync(join(ROOT, file), 'utf8'));
  if (command === 'bump') {
    const current = Object.values(versions)[0];
    const next = raised(current, rest[0] ?? '');
    for (const file of MANIFESTS) {
      const path = join(ROOT, file);
      writeFileSync(path, readFileSync(path, 'utf8').replace(/("version"\s*:\s*)"[^"]*"/, `$1"${next}"`));
    }
    console.log(`plugin version ${current} → ${next} in ${MANIFESTS.join(', ')}`);
    return;
  }
  if (command === 'check') {
    const at = rest.indexOf('--base');
    const ref = at === -1 ? undefined : rest[at + 1];
    // only what this branch changed counts, not what the base gained since it branched
    const from = ref ? git(['merge-base', ref, 'HEAD']) : undefined;
    const base = ref && from ? { ref, version: versionsIn((file) => git(['show', `${from}:${file}`]))[MANIFESTS[0]], changed: git(['diff', '--name-only', from, 'HEAD']).split('\n').filter(Boolean) } : undefined;
    const problems = versionProblems(versions, base);
    for (const problem of problems) console.error(problem);
    if (problems.length) process.exit(1);
    console.log(`plugin version ${Object.values(versions)[0]}${base ? ` (${base.ref} has ${base.version})` : ''}: ok`);
    return;
  }
  console.error('usage: plugin-version.ts bump <patch|minor|major|x.y.z> | check [--base <git ref>]');
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
