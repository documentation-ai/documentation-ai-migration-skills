import { describe, it, expect } from 'vitest';
import {
  applyRedirectDestination,
  findPagesMatchedByRedirectSource,
  sortRedirectsByProcessingOrder,
  isRedirectPattern,
  matchRedirectPath,
  hasUnmatchedPatternInDestination,
  isSelfLoopingRedirect,
  getUnmatchableSourceReason,
} from '../src/redirects.js';

// The matching cases mirror documentation-ai-app/src/lib/__tests__/redirects.test.ts and the
// backend's helpers/__tests__/redirects.vitest.ts. They exist so a change to the site's matching
// fails here rather than the migrator silently disagreeing with the site about where an address goes.
describe('matchRedirectPath — parity with the app middleware', () => {
  it('matches an exact path', () => {
    expect(matchRedirectPath('/docs/old-page', '/docs/old-page')).toEqual({});
  });

  it('captures parameters', () => {
    expect(matchRedirectPath('/api/v2/users', '/api/:version/:endpoint')).toEqual({
      version: 'v2',
      endpoint: 'users',
    });
  });

  it('returns null when segment counts differ', () => {
    expect(matchRedirectPath('/docs/a/b', '/docs/:slug')).toBeNull();
  });

  it('ignores leading and trailing slashes', () => {
    expect(matchRedirectPath('old-page/', 'old-page')).toEqual({});
    expect(matchRedirectPath('/docs/page', '/docs/page/')).toEqual({});
  });

  it('is case-sensitive for exact segments', () => {
    expect(matchRedirectPath('/Docs/page', '/docs/page')).toBeNull();
  });

  it('matches a percent-encoded request against a source saved as plain text', () => {
    expect(matchRedirectPath('/rename-test/nie-je-%C5%A1%C5%A5', '/rename-test/nie-je-šť')).toEqual({});
    expect(matchRedirectPath('/caf%C3%A9', '/cafe')).toBeNull();
  });

  it('hands a parameter its value as the request sent it', () => {
    expect(matchRedirectPath('/docs/pori%C5%A1i%C5%A5', '/docs/:slug')).toEqual({ slug: 'pori%C5%A1i%C5%A5' });
  });

  describe('wildcards (:slug*)', () => {
    it('matches one, many or no segments', () => {
      expect(matchRedirectPath('/beta/introduction', '/beta/:slug*')).toEqual({ slug: 'introduction' });
      expect(matchRedirectPath('/beta/api/users/create', '/beta/:slug*')).toEqual({ slug: 'api/users/create' });
      expect(matchRedirectPath('/beta', '/beta/:slug*')).toEqual({ slug: '' });
      expect(matchRedirectPath('/beta/', '/beta/:slug*')).toEqual({ slug: '' });
    });

    it('needs the segments before it to match', () => {
      expect(matchRedirectPath('/betamax/intro', '/beta/:slug*')).toBeNull();
    });

    it('matches the whole site from the root', () => {
      expect(matchRedirectPath('/a/b', '/:slug*')).toEqual({ slug: 'a/b' });
      expect(matchRedirectPath('/', '/:slug*')).toEqual({ slug: '' });
    });

    it('matches in the middle, with fixed segments after it', () => {
      expect(matchRedirectPath('/docs/a/b/edit', '/docs/:path*/edit')).toEqual({ path: 'a/b' });
      expect(matchRedirectPath('/docs/edit', '/docs/:path*/edit')).toEqual({ path: '' });
      expect(matchRedirectPath('/docs/a/b', '/docs/:path*/edit')).toBeNull();
    });

    it('works with parameters around it', () => {
      expect(matchRedirectPath('/v1/guides/a/b', '/:version/guides/:slug*')).toEqual({ version: 'v1', slug: 'a/b' });
    });

    it('hands the segments on as the request sent them', () => {
      expect(matchRedirectPath('/beta/pori%C5%A1i%C5%A5/a%20b', '/beta/:slug*')).toEqual({
        slug: 'pori%C5%A1i%C5%A5/a%20b',
      });
    });

    it('skips a source with more than one wildcard, as Mintlify does', () => {
      expect(matchRedirectPath('/v1/guides/intro', '/:version*/guides/:slug*')).toBeNull();
    });
  });

  describe('partial wildcards (*)', () => {
    it('matches a segment that starts with the text before the *', () => {
      expect(matchRedirectPath('/articles/concepts-getting-started', '/articles/concepts-*')).toEqual({
        '*': 'getting-started',
      });
    });

    it('matches within one segment only', () => {
      expect(matchRedirectPath('/old/article-123', '/old/article-*')).toEqual({ '*': '123' });
      expect(matchRedirectPath('/old/article-123/details', '/old/article-*')).toBeNull();
    });

    it('matches text after the * too', () => {
      expect(matchRedirectPath('/guides/install-v1', '/guides/*-v1')).toEqual({ '*': 'install' });
      expect(matchRedirectPath('/guides/install-v2', '/guides/*-v1')).toBeNull();
    });

    it('matches any one segment when the * stands alone', () => {
      expect(matchRedirectPath('/old/page', '/old/*')).toEqual({ '*': 'page' });
      expect(matchRedirectPath('/old/a/b', '/old/*')).toBeNull();
    });

    it('compares decoded and hands the text on encoded', () => {
      expect(matchRedirectPath('/articles/concepts-%C5%A1t%C3%BDl', '/articles/concepts-*')).toEqual({
        '*': '%C5%A1t%C3%BDl',
      });
      expect(matchRedirectPath('/articles/n%C3%A1vod-intro', '/articles/návod-*')).toEqual({ '*': 'intro' });
    });

    it('skips a source with more than one *', () => {
      expect(matchRedirectPath('/a-x/b-y', '/a-*/b-*')).toBeNull();
      expect(matchRedirectPath('/a-x/b/c', '/a-*/:slug*')).toBeNull();
    });
  });
});

describe('applyRedirectDestination — parity with the app middleware', () => {
  it('substitutes parameters', () => {
    expect(applyRedirectDestination('/posts/:year/:slug', { year: '2024', slug: 'hi' })).toBe('/posts/2024/hi');
  });

  it('leaves a destination without parameters alone', () => {
    expect(applyRedirectDestination('/new', {})).toBe('/new');
  });

  it('replaces every occurrence, and a name only as a whole', () => {
    expect(applyRedirectDestination('/:slug/:slug', { slug: 'test' })).toBe('/test/test');
    expect(applyRedirectDestination('/x/:slugs', { slug: 'a' })).toBe('/x/:slugs');
    expect(applyRedirectDestination('/x/:slug/:slugger', { slug: 'a', slugger: 'b' })).toBe('/x/a/b');
    expect(applyRedirectDestination('/x/:slug-old', { slug: 'a' })).toBe('/x/a-old');
  });

  it('puts every matched segment in place of :slug*', () => {
    expect(applyRedirectDestination('/v2/:slug*', { slug: 'api/users/create' })).toBe('/v2/api/users/create');
  });

  it('drops the slash before a wildcard that matched no segments', () => {
    expect(applyRedirectDestination('/v2/:slug*', { slug: '' })).toBe('/v2');
    expect(applyRedirectDestination('/v2/:slug*/edit', { slug: '' })).toBe('/v2/edit');
    expect(applyRedirectDestination('/v2/:slug*?tab=a', { slug: '' })).toBe('/v2?tab=a');
    expect(applyRedirectDestination('/:slug*', { slug: '' })).toBe('/');
  });

  it('keeps a port in an external destination', () => {
    expect(applyRedirectDestination('https://example.com:8443/docs/:slug*', { slug: 'a/b' })).toBe(
      'https://example.com:8443/docs/a/b',
    );
  });

  it("puts a partial wildcard's text in place of *, and leaves * alone otherwise", () => {
    expect(applyRedirectDestination('/new/article-*', { '*': '123' })).toBe('/new/article-123');
    expect(applyRedirectDestination('/x/:slug/*', { slug: 'a' })).toBe('/x/a/*');
  });
});

describe('sortRedirectsByProcessingOrder', () => {
  it('puts exact sources first, then partial wildcards, then parameters and wildcards', () => {
    const ordered = sortRedirectsByProcessingOrder([
      { source: '/docs/:slug*' },
      { source: '/articles/:slug' },
      { source: '/articles/concepts-*' },
      { source: '/docs/intro' },
    ]);
    expect(ordered.map((redirect) => redirect.source)).toEqual([
      '/docs/intro',
      '/articles/concepts-*',
      '/docs/:slug*',
      '/articles/:slug',
    ]);
  });
});

describe('isRedirectPattern', () => {
  it.each(['/docs/:slug', '/beta/:slug*', '/articles/concepts-*', 'https://example.com/:slug'])(
    'calls %s a pattern',
    (path) => expect(isRedirectPattern(path)).toBe(true),
  );

  it.each(['/docs/intro', 'https://example.com:8443/docs', '/'])('calls %s a path', (path) =>
    expect(isRedirectPattern(path)).toBe(false),
  );
});

describe('getUnmatchableSourceReason', () => {
  it.each([
    ['/:version*/guides/:slug*', 'Use one * at most. The site skips a source with more.'],
    ['/a-*/b-*', 'Use one * at most. The site skips a source with more.'],
    ['/docs?tab=a', 'Leave out ? and #. A source matches the path only.'],
    ['/docs#intro', 'Leave out ? and #. A source matches the path only.'],
    ['/docs/:sl*ug', 'Write a wildcard as :name*, with the * last.'],
  ])('gives %s its reason', (source, reason) => expect(getUnmatchableSourceReason(source)).toBe(reason));

  it.each(['/docs/intro', '/docs/:slug', '/beta/:slug*', '/articles/concepts-*', '/:version/guides/:slug*'])(
    'accepts %s',
    (source) => expect(getUnmatchableSourceReason(source)).toBeNull(),
  );
});

describe('hasUnmatchedPatternInDestination', () => {
  it('flags a parameter or * the source does not have', () => {
    expect(hasUnmatchedPatternInDestination({ source: '/docs/:slug', destination: '/v2/:version/:slug' })).toBe(true);
    expect(hasUnmatchedPatternInDestination({ source: '/beta/:slug*', destination: '/v2/*' })).toBe(true);
    expect(hasUnmatchedPatternInDestination({ source: '/old', destination: '/new/:slug' })).toBe(true);
  });

  it('accepts what the source matched, and a port or query', () => {
    expect(hasUnmatchedPatternInDestination({ source: '/beta/:slug*', destination: '/v2/:slug*' })).toBe(false);
    expect(hasUnmatchedPatternInDestination({ source: '/old/article-*', destination: '/new/article-*' })).toBe(false);
    expect(
      hasUnmatchedPatternInDestination({ source: '/beta/:slug*', destination: 'https://x.com:8443/:slug*?a=*' }),
    ).toBe(false);
  });

  it("leaves a * in another site's URL alone", () => {
    expect(
      hasUnmatchedPatternInDestination({ source: '/old', destination: 'https://web.archive.org/web/*/example.com/old' }),
    ).toBe(false);
    expect(hasUnmatchedPatternInDestination({ source: '/old', destination: 'https://x.com/:slug' })).toBe(true);
  });
});

describe('isSelfLoopingRedirect', () => {
  it('flags a destination inside its own source', () => {
    expect(isSelfLoopingRedirect({ source: '/docs/:slug*', destination: '/docs/v2/:slug*' })).toBe(true);
    expect(isSelfLoopingRedirect({ source: '/old/*', destination: '/old/new-*' })).toBe(true);
    expect(isSelfLoopingRedirect({ source: '/a', destination: '/a/' })).toBe(true);
  });

  it('accepts a destination outside its source', () => {
    expect(isSelfLoopingRedirect({ source: '/beta/:slug*', destination: '/v2/:slug*' })).toBe(false);
    expect(isSelfLoopingRedirect({ source: '/docs/:slug', destination: '/docs/:slug/v2' })).toBe(false);
    expect(isSelfLoopingRedirect({ source: '/:slug*', destination: 'https://new.example.com/:slug*' })).toBe(false);
    expect(isSelfLoopingRedirect({ source: '/:slug*', destination: '//docs.example.com/:slug*' })).toBe(false);
  });
});

describe('findPagesMatchedByRedirectSource', () => {
  const pages = new Set(['api/overview', 'api/auth', 'apiary', 'guide', 'v2/intro', 'café/menu']);

  it('finds the pages a pattern matches', () => {
    expect(findPagesMatchedByRedirectSource('/api/:slug*', pages)).toEqual(['api/overview', 'api/auth']);
    expect(findPagesMatchedByRedirectSource('/:slug*', pages)).toEqual([...pages]);
    expect(findPagesMatchedByRedirectSource('/api//:slug', pages)).toEqual(['api/overview', 'api/auth']);
    expect(findPagesMatchedByRedirectSource('/caf%C3%A9/:slug', pages)).toEqual(['café/menu']);
    expect(findPagesMatchedByRedirectSource('/v2/in*', pages)).toEqual(['v2/intro']);
  });

  it('finds an exact source, with or without a trailing slash', () => {
    expect(findPagesMatchedByRedirectSource('/guide', pages)).toEqual(['guide']);
    expect(findPagesMatchedByRedirectSource('/guide/', pages)).toEqual(['guide']);
  });

  it('leaves out .md sources, which never apply to a page', () => {
    expect(findPagesMatchedByRedirectSource('/guide.md', new Set(['guide.md', 'guide']))).toEqual([]);
    expect(findPagesMatchedByRedirectSource('/docs/:slug.md', new Set(['docs/intro']))).toEqual([]);
  });

  it('finds nothing for a source the site skips', () => {
    expect(findPagesMatchedByRedirectSource('/a-*/b-*', new Set(['a-x/b-y']))).toEqual([]);
  });
});
