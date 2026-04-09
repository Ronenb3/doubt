/**
 * Unit tests for doubt/src/intelligence/source-bias.js
 * Tests outlet bias lookup and ideological diversity assessment.
 */

import { describe, it, expect } from 'vitest';
import { lookupOutletBias, assessIdeologicalDiversity, OUTLET_BIAS } from '../../src/intelligence/source-bias.js';

// ── lookupOutletBias() ────────────────────────────────────────────────────────

describe('lookupOutletBias()', () => {
  it('returns { lean, magnitude } for known outlets', () => {
    const reuters = lookupOutletBias('https://www.reuters.com/article/xyz');
    expect(reuters).not.toBeNull();
    expect(reuters.lean).toBe('center');
    expect(typeof reuters.magnitude).toBe('number');
  });

  it('Fox News → right lean', () => {
    const result = lookupOutletBias('https://foxnews.com/politics/article');
    expect(result).not.toBeNull();
    expect(result.lean).toBe('right');
    expect(result.magnitude).toBeGreaterThan(0.5);
  });

  it('MSNBC → left lean', () => {
    const result = lookupOutletBias('https://msnbc.com/show');
    expect(result).not.toBeNull();
    expect(result.lean).toBe('left');
  });

  it('Reuters → center lean', () => {
    const result = lookupOutletBias('reuters.com');
    expect(result).not.toBeNull();
    expect(result.lean).toBe('center');
    expect(result.magnitude).toBeLessThan(0.2);
  });

  it('NYT → center-left lean', () => {
    const result = lookupOutletBias('nytimes.com/article');
    expect(result).not.toBeNull();
    expect(result.lean).toBe('center-left');
  });

  it('strips www. prefix', () => {
    const withWww = lookupOutletBias('www.foxnews.com');
    const withoutWww = lookupOutletBias('foxnews.com');
    expect(withWww).not.toBeNull();
    expect(withoutWww).not.toBeNull();
    expect(withWww.lean).toBe(withoutWww.lean);
  });

  it('returns null for unknown outlets — no crash', () => {
    const result = lookupOutletBias('https://unknownblog12345.xyz/article');
    expect(result).toBeNull();
  });

  it('returns null for empty string — no crash', () => {
    expect(lookupOutletBias('')).toBeNull();
  });

  it('returns null for null — no crash', () => {
    expect(lookupOutletBias(null)).toBeNull();
  });

  it('Breitbart → right with maximum magnitude', () => {
    const result = lookupOutletBias('breitbart.com');
    expect(result.lean).toBe('right');
    expect(result.magnitude).toBe(1.0);
  });

  it('nature.com → center with near-zero magnitude', () => {
    const result = lookupOutletBias('nature.com');
    expect(result.lean).toBe('center');
    expect(result.magnitude).toBeLessThan(0.1);
  });
});

// ── assessIdeologicalDiversity() ─────────────────────────────────────────────

describe('assessIdeologicalDiversity()', () => {
  function fakeEv(url) {
    return { url, summary: 'test', trustWeight: 0.5 };
  }

  it('returns the full expected shape', () => {
    const result = assessIdeologicalDiversity([fakeEv('https://reuters.com/a')]);
    expect(result).toHaveProperty('covered');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('coverageRatio');
    expect(result).toHaveProperty('distribution');
    expect(result).toHaveProperty('weightedLean');
    expect(result).toHaveProperty('diversityScore');
    expect(result).toHaveProperty('biasWarning');
    expect(result).toHaveProperty('warningText');
    expect(result).toHaveProperty('dominantLean');
  });

  it('handles empty evidence array', () => {
    const result = assessIdeologicalDiversity([]);
    expect(result.covered).toBe(0);
    expect(result.biasWarning).toBe(false);
    expect(result.diversityScore).toBeNull();
  });

  it('handles evidence with no known outlets', () => {
    const items = [fakeEv('https://unknownsite.xyz/a'), fakeEv('https://anotherunk.io/b')];
    const result = assessIdeologicalDiversity(items);
    expect(result.covered).toBe(0);
    expect(result.biasWarning).toBe(false);
  });

  it('right-heavy evidence triggers bias warning', () => {
    const items = [
      fakeEv('foxnews.com'),
      fakeEv('breitbart.com'),
      fakeEv('nypost.com'),
      fakeEv('dailywire.com'),
      fakeEv('newsmax.com'),
    ];
    const result = assessIdeologicalDiversity(items);
    expect(result.biasWarning).toBe(true);
    expect(result.dominantLean).toBe('right');
    expect(result.warningText).toContain('right');
  });

  it('left-heavy evidence triggers bias warning', () => {
    const items = [
      fakeEv('msnbc.com'),
      fakeEv('huffpost.com'),
      fakeEv('jacobin.com'),
      fakeEv('thenation.com'),
      fakeEv('salon.com'),
    ];
    const result = assessIdeologicalDiversity(items);
    expect(result.biasWarning).toBe(true);
    expect(result.dominantLean).toBe('left');
  });

  it('mixed center evidence → no bias warning', () => {
    const items = [
      fakeEv('reuters.com'),
      fakeEv('apnews.com'),
      fakeEv('bbc.com'),
      fakeEv('axios.com'),
    ];
    const result = assessIdeologicalDiversity(items);
    expect(result.biasWarning).toBe(false);
  });

  it('perfectly balanced left/right → higher diversity score', () => {
    const balanced = [
      fakeEv('foxnews.com'),       // right
      fakeEv('msnbc.com'),         // left
      fakeEv('wsj.com'),           // center-right
      fakeEv('huffpost.com'),      // left
      fakeEv('reuters.com'),       // center
    ];
    const heavy = [
      fakeEv('foxnews.com'),
      fakeEv('breitbart.com'),
      fakeEv('dailywire.com'),
      fakeEv('newsmax.com'),
      fakeEv('nypost.com'),
    ];

    const balancedResult = assessIdeologicalDiversity(balanced);
    const heavyResult = assessIdeologicalDiversity(heavy);
    expect(balancedResult.diversityScore).toBeGreaterThan(heavyResult.diversityScore);
  });

  it('coverageRatio is between 0 and 1', () => {
    const items = [fakeEv('reuters.com'), fakeEv('unknownsite.xyz')];
    const result = assessIdeologicalDiversity(items);
    expect(result.coverageRatio).toBeGreaterThanOrEqual(0);
    expect(result.coverageRatio).toBeLessThanOrEqual(1);
  });

  it('OUTLET_BIAS export contains expected outlets', () => {
    expect(OUTLET_BIAS).toHaveProperty('foxnews.com');
    expect(OUTLET_BIAS).toHaveProperty('reuters.com');
    expect(OUTLET_BIAS).toHaveProperty('msnbc.com');
    expect(OUTLET_BIAS).toHaveProperty('nature.com');
  });
});
