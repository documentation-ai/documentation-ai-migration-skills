/**
 * The redirects a source's own configuration states, in the syntax Mintlify and Fern share (Next.js
 * style: an exact path, `:param` segments, and a trailing `:slug*` or `*`). The platform supports
 * exact paths, `:param` and a trailing wildcard, so a wildcard anywhere else is reported, not guessed.
 */
import type { RedirectRule } from '../urls/plan.js';

export interface SourceRedirects { exact: RedirectRule[]; wildcard: RedirectRule[]; skipped: Array<{ source: string; reason: string }> }

export function sourceRedirects(rules: unknown): SourceRedirects {
  const exact: RedirectRule[] = []; const wildcard: RedirectRule[] = []; const skipped: SourceRedirects['skipped'] = [];
  for (const r of (Array.isArray(rules) ? rules : []) as Array<{ source?: unknown; destination?: unknown; permanent?: unknown }>) {
    if (typeof r?.source !== 'string' || typeof r?.destination !== 'string' || !r.source || !r.destination) continue;
    const status = r.permanent === false ? 307 : 308;
    if (/\*/.test(r.source)) {
      const src = r.source.replace(/:(\w+)\*$/, '*').replace(/\*+$/, '*');
      const dst = r.destination.replace(/:(\w+)\*$/, ':splat').replace(/\*$/, ':splat');
      if (!/\*$/.test(src)) { skipped.push({ source: r.source, reason: 'wildcard not at the end' }); continue; }
      wildcard.push({ source: src, destination: dst, statusCode: status });
    } else exact.push({ source: r.source, destination: r.destination, statusCode: status });
  }
  return { exact, wildcard, skipped };
}
