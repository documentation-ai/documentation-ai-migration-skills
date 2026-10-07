import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ICON_CONTRACT_VERSION,
  iconContractFixtureFailures,
  type IconContractFixtures,
} from '../src/icon-contract/icon-contract.js';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`../src/icon-contract/${name}`, import.meta.url)), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const STAMP = /^\/\/ @documentation-ai\/icon-contract (\S+) contract-sha256:([0-9a-f]+) fixtures-sha256:([0-9a-f]+)\n/m;

describe('icon contract copy', () => {
  it('is the generated copy, unedited', () => {
    const copy = read('icon-contract.ts');
    const stamp = copy.match(STAMP);
    expect(stamp).not.toBeNull();
    const [line, version, contractHash, fixturesHash] = stamp as RegExpMatchArray;
    expect(version).toBe(ICON_CONTRACT_VERSION);
    expect(sha256(copy.slice(copy.indexOf(line) + line.length))).toBe(contractHash);
    expect(sha256(read('icon-contract.fixtures.json'))).toBe(fixturesHash);
  });

  it('passes the shared fixtures', () => {
    const fixtures = JSON.parse(read('icon-contract.fixtures.json')) as IconContractFixtures;
    expect(iconContractFixtureFailures(fixtures)).toEqual([]);
  });
});
