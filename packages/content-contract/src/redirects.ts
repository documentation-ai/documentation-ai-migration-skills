/**
 * How the platform matches a redirect, ported from the site's middleware
 * (documentation-ai-app/src/lib/redirects.ts) so the migrator reads a rule the way the site will run
 * it. The tests carry the app's cases: if either side changes its matching, they fail here rather
 * than the migrator quietly disagreeing with the site about where an old address goes.
 *
 * A source holds three kinds of pattern:
 * - `:slug`, a parameter: one segment.
 * - `:slug*`, a wildcard: any number of segments, none included.
 * - `concepts-*`, a partial wildcard: any text where the `*` is, inside one segment.
 */

/** One address segment as written, undoing percent-encoding; a malformed escape is kept as it came. */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The only wildcard character. A source holds at most one; Mintlify skips a source with more. */
const WILDCARD = '*';

/** The key a partial wildcard's matched text is kept under, as `*` is never a parameter name. */
const PARTIAL_WILDCARD_CAPTURE = WILDCARD;

interface RedirectRule {
  source: string;
  destination: string;
}

/** A parameter, `:slug`: exactly one segment. */
const isParameterSegment = (segment: string) => segment.startsWith(':') && !segment.includes(WILDCARD);

/** A wildcard, `:slug*`: any number of segments, none included. */
export const isWildcardSegment = (segment: string) => /^:[^*]+\*$/.test(segment);

/** A partial wildcard, `concepts-*`: any text where the `*` is, inside one segment. */
export const isPartialWildcardSegment = (segment: string) =>
  !segment.startsWith(':') && segment.includes(WILDCARD);

const isPatternSegment = (segment: string) =>
  isParameterSegment(segment) || isWildcardSegment(segment) || isPartialWildcardSegment(segment);

const hasMoreThanOneWildcard = (source: string) => source.indexOf(WILDCARD) !== source.lastIndexOf(WILDCARD);

/**
 * The text a partial wildcard matches in one path segment, or null. Both sides
 * are compared decoded, as plain segments are; the matched text goes back into
 * a URL, so it is encoded again when the request sent it encoded.
 */
const matchPartialWildcard = (sourceSegment: string, pathSegment: string): string | null => {
  const [textBefore, textAfter] = sourceSegment.split(WILDCARD).map(decodeSegment);
  const segment = decodeSegment(pathSegment);
  const isPartialWildcardMatch =
    segment.length >= textBefore.length + textAfter.length &&
    segment.startsWith(textBefore) &&
    segment.endsWith(textAfter);
  if (!isPartialWildcardMatch) return null;

  const matchedText = segment.slice(textBefore.length, segment.length - textAfter.length);
  return segment === pathSegment ? matchedText : encodeURIComponent(matchedText);
};

/**
 * Match a path against a redirect source. Returns what each pattern matched
 * (a partial wildcard's text under `*`), or null when the source does not apply.
 * Literal segments are compared decoded and case-sensitively; trailing slashes
 * are ignored.
 */
export function matchRedirectPath(pathname: string, source: string): Record<string, string> | null {
  const normalizedPathname = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
  const normalizedSource = source === '/' ? '/' : source.replace(/\/$/, '');

  if (hasMoreThanOneWildcard(normalizedSource)) return null;

  const pathSegments = normalizedPathname.split('/').filter(Boolean);
  const sourceSegments = normalizedSource.split('/').filter(Boolean);

  // The one wildcard takes whatever the segments around it leave.
  const wildcardIndex = normalizedSource.includes(WILDCARD) ? sourceSegments.findIndex(isWildcardSegment) : -1;
  const hasWildcard = wildcardIndex !== -1;
  const segmentsBefore = hasWildcard ? sourceSegments.slice(0, wildcardIndex) : sourceSegments;
  const segmentsAfter = hasWildcard ? sourceSegments.slice(wildcardIndex + 1) : [];
  const fixedSegmentCount = segmentsBefore.length + segmentsAfter.length;
  const hasMatchingSegmentCount = hasWildcard
    ? pathSegments.length >= fixedSegmentCount
    : pathSegments.length === fixedSegmentCount;
  if (!hasMatchingSegmentCount) return null;

  const segmentsAfterStart = pathSegments.length - segmentsAfter.length;
  const segmentPairs: Array<[string, string]> = [
    ...segmentsBefore.map((segment, i): [string, string] => [segment, pathSegments[i]]),
    ...segmentsAfter.map((segment, i): [string, string] => [segment, pathSegments[segmentsAfterStart + i]]),
  ];

  const params: Record<string, string> = {};

  for (const [sourceSegment, pathSegment] of segmentPairs) {
    if (isParameterSegment(sourceSegment)) {
      params[sourceSegment.slice(1)] = pathSegment;
    } else if (isPartialWildcardSegment(sourceSegment)) {
      const matchedText = matchPartialWildcard(sourceSegment, pathSegment);
      if (matchedText === null) return null;
      params[PARTIAL_WILDCARD_CAPTURE] = matchedText;
    } else if (decodeSegment(sourceSegment) !== decodeSegment(pathSegment)) {
      return null;
    }
  }

  if (hasWildcard) {
    const wildcardName = sourceSegments[wildcardIndex].slice(1, -WILDCARD.length);
    params[wildcardName] = pathSegments.slice(segmentsBefore.length, segmentsAfterStart).join('/');
  }

  return params;
}

const escapeForRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Fill a destination with what the source matched: every `:name` and `:name*`
 * the source matched, and `*` with a partial wildcard's text. A name is only
 * replaced as a whole, and a wildcard that matched no segments takes the slash
 * before it along, so `/v2/:slug*` gives `/v2`, not `/v2/`.
 */
export function applyRedirectDestination(destination: string, params: Record<string, string>): string {
  const parameterNames = Object.keys(params)
    .filter((name) => name !== PARTIAL_WILDCARD_CAPTURE)
    .sort((a, b) => b.length - a.length)
    .map(escapeForRegExp);
  const hasPartialWildcard = PARTIAL_WILDCARD_CAPTURE in params;
  if (!parameterNames.length && !hasPartialWildcard) return destination;

  // One pass, so a filled-in value is never read as a token. The name group
  // must always exist, or `replace` hands over the match offset in its place;
  // `(?!)` never matches and stands in when only a partial wildcard matched.
  const namePattern = parameterNames.join('|') || '(?!)';
  const destinationTokenPattern = new RegExp(`(/?)(?::(${namePattern})\\*?(?!\\w)|\\*)`, 'g');
  const filledDestination = destination.replace(
    destinationTokenPattern,
    (token, slash: string, name: string | undefined) => {
      if (name === undefined && !hasPartialWildcard) return token;
      const value = params[name ?? PARTIAL_WILDCARD_CAPTURE];
      return value ? `${slash}${value}` : '';
    },
  );

  return destination.startsWith('/') && !filledDestination.startsWith('/') ? `/${filledDestination}` : filledDestination;
}

type RedirectSourceKind = 'exact' | 'partialWildcard' | 'parameterOrWildcard';

const getRedirectSourceKind = (source: string): RedirectSourceKind => {
  if (!/[:*]/.test(source)) return 'exact';
  const segments = source.split('/');
  if (segments.some(isPartialWildcardSegment)) return 'partialWildcard';
  if (segments.some((segment) => isParameterSegment(segment) || isWildcardSegment(segment))) return 'parameterOrWildcard';
  return 'exact';
};

/** True when a source or destination holds a parameter, a wildcard or a partial wildcard. */
export const isRedirectPattern = (path: string): boolean => getRedirectSourceKind(path) !== 'exact';

/**
 * The redirects in the order the site tries them, as Mintlify tries them: exact
 * sources, then partial wildcards, then parameters and wildcards. Within each
 * group the list's own order holds.
 */
export function sortRedirectsByProcessingOrder<T extends { source: string }>(redirects: readonly T[]): T[] {
  const redirectsByKind: Record<RedirectSourceKind, T[]> = { exact: [], partialWildcard: [], parameterOrWildcard: [] };
  for (const redirect of redirects) redirectsByKind[getRedirectSourceKind(redirect.source)].push(redirect);
  return [...redirectsByKind.exact, ...redirectsByKind.partialWildcard, ...redirectsByKind.parameterOrWildcard];
}

/**
 * Why the site would never use this source, or null when it can match: more
 * than one `*`, a query or anchor (a request path carries neither), or a `*`
 * inside a parameter name (`:sl*ug`).
 */
export function getUnmatchableSourceReason(source: string): string | null {
  if (hasMoreThanOneWildcard(source)) return 'Use one * at most. The site skips a source with more.';
  if (/[?#]/.test(source)) return 'Leave out ? and #. A source matches the path only.';
  const hasMisplacedWildcard = source
    .split('/')
    .some((segment) => segment.startsWith(':') && segment.includes(WILDCARD) && !isWildcardSegment(segment));
  return hasMisplacedWildcard ? 'Write a wildcard as :name*, with the * last.' : null;
}

/** An address the source matches, with `x` wherever a pattern stands. */
export const buildSampleAddressForSource = (source: string): string =>
  source
    .split('/')
    .map((segment) => {
      if (isParameterSegment(segment) || isWildcardSegment(segment)) return 'x';
      return isPartialWildcardSegment(segment) ? segment.replace(WILDCARD, 'x') : segment;
    })
    .join('/');

/** Where the rule sends an address its source matches, or null when it can match none. */
const fillDestinationForSampleAddress = ({ source, destination }: RedirectRule): string | null => {
  if (getUnmatchableSourceReason(source)) return null;
  const params = matchRedirectPath(buildSampleAddressForSource(source), source);
  return params && applyRedirectDestination(destination, params);
};

export const stripQueryAndAnchor = (address: string) => address.split(/[?#]/)[0];

/** A path on this site, as opposed to a full or protocol-relative URL. */
export const isOnSiteAddress = (address: string) => address.startsWith('/') && !address.startsWith('//');

/**
 * True when the destination names a pattern the source does not match, which
 * readers would get as written: `/:version`, or `*` in `/new/*` when the source
 * has no partial wildcard. A `*` in another site's URL is that site's own text.
 */
export function hasUnmatchedPatternInDestination(redirect: RedirectRule): boolean {
  const filledDestination = fillDestinationForSampleAddress(redirect);
  if (filledDestination === null) return false;
  const filledPath = stripQueryAndAnchor(filledDestination);
  return /\/:[A-Za-z_]/.test(filledPath) || (isOnSiteAddress(filledDestination) && filledPath.includes(WILDCARD));
}

/**
 * True when the rule sends an address back to an address its own source
 * matches, so readers would be redirected again and again:
 * `/docs/:slug*` to `/docs/v2/:slug*`, or `/a` to `/a/`.
 */
export function isSelfLoopingRedirect(redirect: RedirectRule): boolean {
  const filledDestination = fillDestinationForSampleAddress(redirect);
  if (filledDestination === null || !isOnSiteAddress(filledDestination)) return false;
  return matchRedirectPath(stripQueryAndAnchor(filledDestination), redirect.source) !== null;
}

/** The page path an exact source names, as navigation stores it: no edge slashes, decoded. */
const toPagePath = (source: string) => source.split('/').filter(Boolean).map(decodeSegment).join('/');

/** The whole plain segments a pattern starts with, as `/api/v2/:slug*` gives `api/v2/`. */
const getLeadingPlainSegments = (source: string): string => {
  const segments = source.split('/').filter(Boolean);
  const patternIndex = segments.findIndex(isPatternSegment);
  const plainSegments = segments.slice(0, patternIndex === -1 ? segments.length : patternIndex);
  return plainSegments.map((segment) => `${decodeSegment(segment)}/`).join('');
};

/**
 * The pages a source also matches, which readers are then sent away from.
 * Page paths come without a leading slash, as navigation stores them, and so
 * do the matches. A `.md` source applies to Markdown addresses only, never to a
 * page. An exact source is looked up; a pattern is matched only against pages
 * under its plain leading segments, which keeps the check short on a large site.
 */
export function findPagesMatchedByRedirectSource(source: string, pagePaths: ReadonlySet<string>): string[] {
  if (source.endsWith('.md') || getUnmatchableSourceReason(source)) return [];
  if (!isRedirectPattern(source)) {
    const pagePath = toPagePath(source);
    return pagePaths.has(pagePath) ? [pagePath] : [];
  }

  const leadingPlainSegments = getLeadingPlainSegments(source);
  const pagesMatched: string[] = [];
  for (const pagePath of pagePaths) {
    const isUnderPlainSegments = `${pagePath}/`.startsWith(leadingPlainSegments);
    if (isUnderPlainSegments && matchRedirectPath(`/${pagePath}`, source)) pagesMatched.push(pagePath);
  }
  return pagesMatched;
}
