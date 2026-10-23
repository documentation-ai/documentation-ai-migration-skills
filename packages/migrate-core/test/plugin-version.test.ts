/**
 * Customers receive a change only when the plugin's version rises: the customer-report fixes were
 * merged at 0.2.2, the version customers already had, so no installed copy would have received them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFESTS, isNewer, raised, shipsToCustomers, versionProblems, versionsIn } from '../scripts/plugin-version.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const same = (version: string) => Object.fromEntries(MANIFESTS.map((file) => [file, version]));

describe('plugin version', () => {
  it('is one version, stated by every manifest', () => {
    const versions = versionsIn((file) => readFileSync(join(root, file), 'utf8'));
    expect(new Set(Object.values(versions)).size).toBe(1);
    expect(Object.values(versions)[0]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(versionProblems(versions)).toEqual([]);
  });

  it('must rise when a change reaches customers, and need not for tests, docs or tooling', () => {
    const base = (changed: string[]) => ({ ref: 'origin/main', version: '0.3.0', changed });
    expect(versionProblems(same('0.3.0'), base(['packages/migrate-core/src/cli.ts', 'skills/x/SKILL.md']))[0]).toMatch(/reaches customers \(packages\/migrate-core\/src\/cli\.ts, skills\/x\/SKILL\.md\) but the plugin version is 0\.3\.0, as on origin\/main/);
    expect(versionProblems(same('0.3.1'), base(['packages/migrate-core/src/cli.ts']))).toEqual([]);
    expect(versionProblems(same('0.3.0'), base(['packages/migrate-core/test/a.test.ts', 'README.md', 'docs/guide.md', '.github/workflows/ci.yml', 'packages/migrate-core/scripts/plugin-version.ts']))).toEqual([]);
  });

  it('refuses manifests that disagree', () => {
    expect(versionProblems({ ...same('0.3.0'), 'plugin.json': '0.2.2' })[0]).toMatch(/state different versions/);
  });

  it('counts what an installed copy runs as shipped', () => {
    for (const path of ['packages/migrate-core/src/cli.ts', 'packages/migrate-core/bin/launch.mjs', 'skills/a/mappings/fern.yaml', 'references/how-a-migration-runs.md', '.claude-plugin/plugin.json', '.agents/plugins/marketplace.json', 'package-lock.json', '.mcp.json']) expect(shipsToCustomers(path)).toBe(true);
    for (const path of ['packages/migrate-core/test/x.test.ts', 'README.md', 'docs/a.md', '.github/workflows/ci.yml', 'vitest.config.ts']) expect(shipsToCustomers(path)).toBe(false);
  });

  it('raises a version the way semantic versioning does', () => {
    expect(raised('0.2.2', 'patch')).toBe('0.2.3');
    expect(raised('0.2.2', 'minor')).toBe('0.3.0');
    expect(raised('0.2.2', 'major')).toBe('1.0.0');
    expect(raised('0.2.2', '0.4.1')).toBe('0.4.1');
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('0.3.0', '0.3.0')).toBe(false);
  });
});
