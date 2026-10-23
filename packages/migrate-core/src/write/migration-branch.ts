/**
 * Git writer, v1 and only: refs/heads/migration/<session-id>, files at the
 * repository root, one commit, one push after validation. Never force-push,
 * never a protected branch, never a personal remote, never /api/v1/push.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface WriteOptions {
  repoDir: string;
  outputDir: string;
  sessionId: string;
  /** Remote URL; must be under an allowed org. */
  remote?: string;
  allowedRemoteOrgs?: string[];
  baseBranch?: string;
  push?: boolean;
  authorName?: string;
  authorEmail?: string;
  message?: string;
  /** The base branch holds a software project (see `projectFiles`) and the person said the branch may replace it. */
  replaceRepoContents?: boolean;
}

/** The migration branch's name is taken, by an earlier write or by a working version the MCP flow published. */
export class MigrationBranchExistsError extends Error {
  constructor(readonly branch: string) {
    super(`branch ${branch} already exists; bump the session id rather than overwriting`);
  }
}

/**
 * Files that mark a software project rather than a documentation site. The platform reads a
 * repository's root, so a migration branch holds the documentation alone: written over these it
 * deletes them on that branch, and from the default branch if it is ever merged.
 */
const PROJECT_FILE = /(?:^|\/)(?:package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|tsconfig\.json|go\.mod|Cargo\.toml|pyproject\.toml|requirements\.txt|setup\.py|Gemfile|pom\.xml|build\.gradle(?:\.kts)?|Makefile|Dockerfile|composer\.json)$|\.(?:c|cc|cpp|cs|go|java|jsx?|kt|[cm]js|php|py|rb|rs|scala|swift|tsx?)$/i;

/** Files of `ref` that make the repository a software project rather than a documentation site. */
export function projectFiles(repoDir: string, ref: string): string[] {
  return git(repoDir, ['ls-tree', '-r', '--name-only', '-z', ref]).split('\0').filter((path) => path && PROJECT_FILE.test(path));
}

const PROTECTED = new Set(['main', 'master', 'production', 'live', 'develop']);

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function remoteOrg(remote: string): { host: string; org: string } | null {
  const scp = remote.match(/^[\w.-]+@([^:/]+):([^/]+)\/.+?(?:\.git)?\/?$/);
  if (scp) return { host: scp[1], org: scp[2] };
  try {
    const u = new URL(remote);
    if (!['http:', 'https:', 'ssh:'].includes(u.protocol)) return null;
    const parts = u.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    return parts.length >= 2 ? { host: u.hostname, org: parts[0] } : null;
  } catch {
    return null;
  }
}

/** The `origin` address of a checkout as its owner configured it (before any url.insteadOf rewrite), or undefined. */
export function originRemote(repoDir: string): string | undefined {
  try { return git(repoDir, ['config', '--get', 'remote.origin.url']) || undefined; } catch { return undefined; }
}

/** An allowlist entry as `host/org`, lower-cased; a bare org implies github.com. */
export function allowedOrgKey(entry: string): string {
  return (entry.includes('/') ? entry : `github.com/${entry}`).toLowerCase();
}

export function assertRemoteAllowed(remote: string, allowedOrgs: string[]): void {
  const r = remoteOrg(remote);
  if (!r) throw new Error(`cannot parse remote ${remote}`);
  // Allowlist entries are host/org pairs ("github.com/acme-docs"); a bare org implies github.com.
  const allowed = allowedOrgs.map(allowedOrgKey);
  if (!allowed.includes(`${r.host}/${r.org}`.toLowerCase())) {
    throw new Error(`remote org "${r.org}" is not in the allowed list [${allowedOrgs.join(', ')}]. Migrations land in the customer's org or the demo org, never a personal account.`);
  }
}

function clearTree(dir: string) {
  for (const f of readdirSync(dir)) { if (f === '.git') continue; rmSync(join(dir, f), { recursive: true, force: true }); }
}

export function writeMigrationBranch(opts: WriteOptions): { branch: string; commit: string; pushed: boolean } {
  if (!/^[A-Za-z0-9._-]+$/.test(opts.sessionId)) throw new Error('session id contains characters unsafe for a git ref');
  const branch = `migration/${opts.sessionId}`;
  if (PROTECTED.has(branch)) throw new Error('refusing protected branch');
  const { repoDir } = opts;
  if (!opts.allowedRemoteOrgs?.length) throw new Error('allowed remote organizations are required; refusing an unscoped write');
  if (!existsSync(opts.outputDir) || !existsSync(join(opts.outputDir, 'documentation.json'))) {
    throw new Error('output is incomplete: output/documentation.json is required before write');
  }
  if (opts.remote) assertRemoteAllowed(opts.remote, opts.allowedRemoteOrgs);
  if (!existsSync(join(repoDir, '.git'))) {
    if (!opts.remote) throw new Error(`${repoDir} is not a git repository and no --remote given`);
    mkdirSync(repoDir, { recursive: true });
    git(repoDir, ['clone', '--quiet', opts.remote, '.']);
  }
  const remote = opts.remote ?? originRemote(repoDir);
  if (!remote) throw new Error(`${repoDir} has no "origin" remote; clone the repository from your git host so the migration branch has somewhere to go`);
  assertRemoteAllowed(remote, opts.allowedRemoteOrgs);

  git(repoDir, ['fetch', '--quiet', 'origin']);
  const base = opts.baseBranch ?? git(repoDir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '');
  if (!/^[A-Za-z0-9._/-]+$/.test(base) || base.startsWith('-') || base.includes('..')) throw new Error(`unsafe base branch ${base}`);
  // collision: refuse to reuse an existing migration ref
  const exists = (ref: string) => { try { git(repoDir, ['rev-parse', '--verify', '--quiet', ref]); return true; } catch { return false; } };
  if (exists(`refs/remotes/origin/${branch}`) || exists(`refs/heads/${branch}`)) throw new MigrationBranchExistsError(branch);
  const project = projectFiles(repoDir, `origin/${base}`);
  if (project.length && !opts.replaceRepoContents) {
    throw new Error(`${remote} holds a software project, not only documentation: ${project.length} file(s) such as ${project.slice(0, 5).join(', ')}. Documentation.AI reads a repository's root, so the migration branch holds the documentation alone and would delete these files on that branch, and from ${base} if it were ever merged. Connect your Documentation.AI project to a repository of its own and write there. If this repository is your old documentation site and replacing it is what you want, run write again with --replace-repo-contents`);
  }

  // Build in an isolated git worktree. The operator's checkout, current branch,
  // untracked files and in-progress edits remain untouched.
  const tempRoot = mkdtempSync(join(tmpdir(), 'documentation-ai-migrate-write-'));
  const worktree = join(tempRoot, 'checkout');
  let added = false;
  let written = false;
  try {
    // --no-track: started from origin/<base>, the branch would otherwise track it, and a later plain
    // `git push` (or GitHub Desktop's Push) would send this documentation-only commit to <base>.
    // With no upstream, the first push names the branch itself; --push sets it to its own name.
    git(repoDir, ['worktree', 'add', '--quiet', '--no-track', '-b', branch, worktree, `origin/${base}`]);
    added = true;
    clearTree(worktree);
    cpSync(opts.outputDir, worktree, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes('.git') });
    git(worktree, ['add', '-A']);
    const env = { GIT_AUTHOR_NAME: opts.authorName ?? 'documentation-ai-migrate', GIT_AUTHOR_EMAIL: opts.authorEmail ?? 'migrations@documentation.ai', GIT_COMMITTER_NAME: opts.authorName ?? 'documentation-ai-migrate', GIT_COMMITTER_EMAIL: opts.authorEmail ?? 'migrations@documentation.ai' };
    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', opts.message ?? `chore(migration): import session ${opts.sessionId}`], { cwd: worktree, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const commit = git(worktree, ['rev-parse', 'HEAD']);
    let pushed = false;
    if (opts.push) { git(worktree, ['push', '--quiet', '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`]); pushed = true; } // no --force, ever
    written = true;
    return { branch, commit, pushed };
  } finally {
    if (added) {
      try { git(repoDir, ['worktree', 'remove', '--force', worktree]); } catch { /* retain the branch, clean the temporary directory below */ }
    }
    rmSync(tempRoot, { recursive: true, force: true });
    try { git(repoDir, ['worktree', 'prune']); } catch { /* best effort */ }
    // a write that stopped half-way leaves no branch behind, so running it again does not find its own name taken
    if (added && !written) { try { git(repoDir, ['branch', '-D', branch]); } catch { /* nothing to remove */ } }
  }
}

export function outputSize(dir: string): number {
  let n = 0;
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else n += s.size; } };
  walk(dir);
  return n;
}
