/**
 * The redirects a source's own configuration states. Mintlify and Fern write them the way the
 * platform reads them (an exact path, a `:slug` parameter, a `:slug*` wildcard redirect, a `*`
 * partial wildcard), so each rule carries over as written. A source the platform would never match
 * (more than one `*`, a query or anchor, a `*` inside a parameter name) is listed in `skipped` with
 * the reason instead.
 */
import { getUnmatchableSourceReason, isRedirectPattern } from '@dai/content-contract';
import type { RedirectRule } from '../urls/plan.js';

/** `exact` rules name one address each; `dynamic` rules hold a parameter, a wildcard or a partial wildcard. */
export interface SourceRedirects { exact: RedirectRule[]; dynamic: RedirectRule[]; skipped: Array<{ source: string; reason: string }> }

const REDIRECT_STATUS_CODES = [301, 302, 307, 308];

/** A rule as a source's configuration states it, before it is read. */
export interface StatedRedirect { source?: unknown; destination?: unknown; permanent?: unknown; statusCode?: unknown }

/**
 * The status a stated rule redirects with: its `statusCode` when it is one the platform sends
 * (Documentation.AI sources write it), else `permanent: false` for a temporary 307, else 308.
 */
const getStatusCode = (rule: StatedRedirect): number => {
  if (typeof rule.statusCode === 'number' && REDIRECT_STATUS_CODES.includes(rule.statusCode)) return rule.statusCode;
  return rule.permanent === false ? 307 : 308;
};

export function sourceRedirects(rules: unknown): SourceRedirects {
  const exact: RedirectRule[] = []; const dynamic: RedirectRule[] = []; const skipped: SourceRedirects['skipped'] = [];
  for (const r of (Array.isArray(rules) ? rules : []) as StatedRedirect[]) {
    if (typeof r?.source !== 'string' || typeof r?.destination !== 'string' || !r.source || !r.destination) continue;
    const unmatchableReason = getUnmatchableSourceReason(r.source);
    if (unmatchableReason) { skipped.push({ source: r.source, reason: unmatchableReason }); continue; }
    const rule = { source: r.source, destination: r.destination, statusCode: getStatusCode(r) };
    if (isRedirectPattern(rule.source)) dynamic.push(rule);
    else exact.push(rule);
  }
  return { exact, dynamic, skipped };
}
