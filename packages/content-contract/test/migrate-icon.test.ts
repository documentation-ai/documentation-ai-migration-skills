import { describe, expect, it } from 'vitest';

import { iconDraws, migrateIcon, validateNavigation } from '../src/index.js';

/**
 * Sources write Font Awesome (Mintlify, GitBook, ReadMe, Fern), often in Pro styles the platform
 * cannot draw. Their names are kept; anything drawn differently, or not at all, comes with a note.
 */
describe('migrateIcon on a Font Awesome site', () => {
  const fa = (source: unknown, style?: string) => migrateIcon(source, 'fontawesome', { style });

  it('keeps Font Awesome names as written, solid then brands', () => {
    expect(fa('rocket')).toEqual({ value: 'rocket' });
    expect(fa('github')).toEqual({ value: 'fa-brands:github' });
    expect(fa('fa-rocket')).toEqual({ value: 'rocket' });
  });

  it('answers to the names older Font Awesome versions used', () => {
    expect(fa('home')).toEqual({ value: 'house' });
    expect(fa('cog')).toEqual({ value: 'gear' });
    expect(fa('times')).toEqual({ value: 'xmark' });
  });

  it('keeps the style Mintlify states in iconType where Font Awesome Free has it', () => {
    expect(fa('bell', 'regular')).toEqual({ value: 'fa-regular:bell' });
    expect(fa('rocket', 'regular')).toEqual({ value: 'rocket', note: 'icon "rocket" has no Font Awesome Free regular version; drawn solid' });
    expect(fa('github', 'brands')).toEqual({ value: 'fa-brands:github' });
  });

  it('draws a Pro style in the nearest Free one, and says so', () => {
    expect(fa('bell', 'light')).toEqual({ value: 'fa-regular:bell', note: 'icon "bell" asks for the Font Awesome Pro light style; drawn regular' });
    expect(fa('house', 'duotone').value).toBe('house');
    expect(fa('fa-duotone fa-solid fa-house')).toEqual({ value: 'house', note: 'icon "house" asks for the Font Awesome Pro duotone style; drawn solid' });
    expect(fa('fa-sharp fa-solid fa-bell').note).toMatch(/Pro sharp-solid style/);
  });

  it('reads Fern and ReadMe class strings, ignoring sizing classes', () => {
    expect(fa('fa-solid fa-rocket')).toEqual({ value: 'rocket' });
    expect(fa('fab fa-github')).toEqual({ value: 'fa-brands:github' });
    expect(fa('fa-regular fa-bell fa-fw')).toEqual({ value: 'fa-regular:bell' });
  });

  it('draws a name Font Awesome Free lacks as the same idea in Lucide, and says so', () => {
    expect(fa('rocket-launch')).toEqual({ value: 'lucide:rocket', note: 'icon "rocket-launch" is not in Font Awesome Free; drawn as Lucide "rocket"' });
    expect(fa('not-an-icon')).toEqual({ note: 'icon "not-an-icon" is not in Font Awesome Free or Lucide; left out' });
  });

  it('keeps explicit libraries and files, and is idempotent on what it writes', () => {
    expect(fa('lucide:rocket')).toEqual({ value: 'lucide:rocket' });
    expect(fa('fa-brands:github')).toEqual({ value: 'fa-brands:github' });
    expect(fa('/icons/brand.svg').value).toBeUndefined();
    expect(fa('/icons/brand.svg').note).toMatch(/is a project file, which the platform does not draw icons from yet; left out/);
    expect(fa('https://blob-cdn.documentation.ai/org-1/doc-1/1-a.svg')).toEqual({ value: 'https://blob-cdn.documentation.ai/org-1/doc-1/1-a.svg' });
    expect(fa('https://cdn.example.com/a.svg').value).toBeUndefined();
    expect(fa('https://cdn.example.com/a.svg').note).toMatch(/is on another site, which the platform does not draw icons from; left out/);
    for (const written of ['rocket', 'fa-regular:bell', 'fa-brands:github', 'lucide:rocket']) expect(fa(written).value).toBe(written);
  });

  it('reads Mintlify\'s object form and Tabler names', () => {
    expect(fa({ name: 'bell', style: 'regular' })).toEqual({ value: 'fa-regular:bell' });
    expect(fa({ name: 'zap', library: 'lucide' })).toEqual({ value: 'lucide:zap' });
    expect(fa('tabler:rocket')).toEqual({ value: 'tabler:rocket' });
    expect(fa({ name: 'brand-github', library: 'tabler' })).toEqual({ value: 'tabler:brand-github' });
  });

  it('leaves out emoji, which the platform does not draw as icons, and says so', () => {
    expect(fa('🚀')).toEqual({ note: 'emoji icon "🚀" left out; icons are library names or image files' });
  });
});

describe('migrateIcon on a Lucide site', () => {
  const lucide = (source: unknown) => migrateIcon(source, 'lucide');

  it('keeps Lucide names and reads Font Awesome lightning as lightning', () => {
    expect(lucide('rocket')).toEqual({ value: 'rocket' });
    expect(lucide('bolt')).toEqual({ value: 'zap' });
    expect(lucide('gear')).toEqual({ value: 'settings' });
  });

  it('draws what only Font Awesome has from Font Awesome, with its prefix', () => {
    expect(lucide('fa-brands fa-discord')).toEqual({ value: 'fa-brands:discord' });
    expect(lucide('claude')).toEqual({ value: 'fa-brands:claude' });
  });
});

describe('migrateIcon on a Tabler site', () => {
  const tabler = (source: unknown, style?: string) => migrateIcon(source, 'tabler', { style });

  it('keeps Tabler names as written, outline unless filled is asked for', () => {
    expect(tabler('rocket')).toEqual({ value: 'rocket' });
    expect(tabler('star-filled')).toEqual({ value: 'tabler-filled:star' });
    expect(tabler('tabler-filled:star')).toEqual({ value: 'tabler-filled:star' });
    expect(tabler('star', 'filled')).toEqual({ value: 'tabler-filled:star' });
    expect(tabler('2fa')).toEqual({ value: 'auth-2fa' });
  });

  it('draws outline when a Tabler icon has no filled version, and says so', () => {
    expect(tabler('rocket', 'filled')).toEqual({ value: 'rocket', note: 'icon "rocket" has no Tabler filled version; drawn outline' });
  });

  it('draws a name Tabler lacks from Lucide, or leaves it out, and says so', () => {
    expect(tabler('a-large-small')).toEqual({ value: 'lucide:a-large-small', note: 'icon "a-large-small" is not in Tabler; drawn as Lucide "a-large-small"' });
    expect(tabler('rokcet')).toEqual({ note: 'icon "rokcet" is not in Tabler or Lucide; left out' });
  });

  it('keeps other libraries and Font Awesome class strings', () => {
    expect(tabler('lucide:zap')).toEqual({ value: 'lucide:zap' });
    expect(tabler('fa-brands fa-github')).toEqual({ value: 'fa-brands:github' });
  });
});

describe('what the validator accepts', () => {
  const site = (icon: string, library?: string) => ({ name: 'Docs', ...(library ? { icons: { library } } : {}), navigation: { pages: [{ title: 'A', path: 'a', icon }] } });

  it('accepts every icon the site draws, by its own library', () => {
    expect(validateNavigation(site('rocket'), () => true)).toEqual([]);
    expect(validateNavigation(site('gear', 'fontawesome'), () => true)).toEqual([]);
    expect(validateNavigation(site('fa-brands:github'), () => true)).toEqual([]);
    expect(validateNavigation(site('https://blob-cdn.documentation.ai/org-1/doc-1/1-a.svg'), () => true)).toEqual([]);
    expect(validateNavigation(site('/icons/brand.svg'), () => true)[0].message).toMatch(/is not an icon the site draws/);
    expect(validateNavigation(site('gear'), () => true)[0].message).toMatch(/icon "gear" is not an icon the site draws/);
  });

  it('reports what a value draws', () => {
    expect(iconDraws('rocket', 'fontawesome')).toBe('fa-solid');
    expect(iconDraws('panel-top', 'fontawesome')).toBe('lucide');
    expect(iconDraws('/icons/a.svg', 'lucide')).toBeUndefined();
    expect(iconDraws('https://blob-cdn.documentation.ai/a.svg', 'lucide')).toBe('file');
    expect(iconDraws('https://cdn.example.com/a.svg', 'lucide')).toBeUndefined();
    expect(iconDraws('fa-regular:rocket', 'lucide')).toBeUndefined();
    expect(iconDraws('rocket', 'tabler')).toBe('tabler');
    expect(iconDraws('tabler:star-filled', 'lucide')).toBe('tabler-filled');
    expect(iconDraws('github', 'tabler')).toBe('lucide');
  });
});
