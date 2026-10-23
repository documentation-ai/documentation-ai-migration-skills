/**
 * What the command checks before the migrator starts. A host that installs the plugin by copying
 * its folder (Claude Code, Codex, Cowork) copies no node_modules, and the customer saw a stack trace
 * about `tsx`; an old Node.js failed deep inside a dependency instead of saying what it needs.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error: a plain .mjs module with no type declarations
import { nodeIsRecentEnough } from '../bin/launch.mjs';

const bin = fileURLToPath(new URL('../bin/', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('starting the command', () => {
  it('asks for the Node.js its dependencies need, and no more', () => {
    const engines = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines: { node: string } }).engines.node;
    expect(engines).toBe('>=22.19.0');
    expect(nodeIsRecentEnough('22.19.0')).toBe(true);
    expect(nodeIsRecentEnough('24.1.0')).toBe(true);
    expect(nodeIsRecentEnough('22.18.9')).toBe(false);
    expect(nodeIsRecentEnough('20.11.1')).toBe(false);
  });

  it('says what to run when its dependencies are missing and installing them is not allowed', () => {
    const copy = mkdtempSync(join(tmpdir(), 'dai-launch-'));
    const copied = join(copy, 'packages', 'migrate-core', 'bin');
    mkdirSync(copied, { recursive: true });
    for (const file of ['launch.mjs', 'documentation-ai-migrate.mjs']) copyFileSync(join(bin, file), join(copied, file));
    const run = spawnSync(process.execPath, [join(copied, 'documentation-ai-migrate.mjs'), '--help'], { encoding: 'utf8', env: { ...process.env, DAI_MIGRATE_NO_INSTALL: '1' } });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('its dependencies are not installed');
    expect(run.stderr).toContain(`cd "${copy}" && npm install`);
  });
});
