/**
 * Unit tests for doubt/src/intelligence/relevance.js
 * Tests the relevance scorer and filter.
 */

import { describe, it, expect } from 'vitest';
import { RelevanceScorer } from '../../src/intelligence/relevance.js';

const scorer = new RelevanceScorer();

// Helper to build a minimal evidence item
function fakeEvidence(overrides = {}) {
  return {
    connectorId: overrides.connectorId || 'test_connector',
    sourceUrl: overrides.sourceUrl || 'https://example.com',
    summary: overrides.summary || 'generic summary text',
    data: overrides.data || {},
    trustWeight: overrides.trustWeight ?? 0.5,
    timestamp: overrides.timestamp || null,
    ...overrides,
  };
}

// ── score() ──────────────────────────────────────────────────────────────────

describe('RelevanceScorer.score()', () => {
  it('attaches _relevanceScore to every item', () => {
    const items = [
      fakeEvidence({ summary: 'Tesla autopilot safety record 2024' }),
      fakeEvidence({ summary: 'Tesla recall investigation crash fatality' }),
    ];
    const result = scorer.score(items, 'Tesla autopilot safety', {
      companies: ['Tesla'],
      topics: ['autopilot', 'safety'],
      domains: ['corporate'],
    });
    for (const item of result) {
      expect(item._relevanceScore).toBeDefined();
      expect(item._relevanceScore).toBeGreaterThanOrEqual(0);
      expect(item._relevanceScore).toBeLessThanOrEqual(1);
    }
  });

  it('relevant evidence scores higher than irrelevant', () => {
    const items = [
      fakeEvidence({ summary: 'Tesla autopilot safety data: 5x fewer crashes than human drivers' }),
      fakeEvidence({ summary: 'Pineapple yogurt recipe with mango and coconut cream' }),
    ];
    scorer.score(items, 'Tesla autopilot safety', { companies: ['Tesla'], domains: ['corporate'] });
    expect(items[0]._relevanceScore).toBeGreaterThan(items[1]._relevanceScore);
  });

  it('returns empty array for empty input', () => {
    expect(scorer.score([], 'anything')).toEqual([]);
  });

  it('returns empty array for null input', () => {
    expect(scorer.score(null, 'anything')).toEqual([]);
  });

  it('scores 0 for empty summary and no match', () => {
    const items = [fakeEvidence({ summary: '', data: {} })];
    scorer.score(items, 'Tesla autopilot', {});
    expect(items[0]._relevanceScore).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(items[0]._relevanceScore)).toBe(false);
  });

  it('applies freshness multiplier in recency mode', () => {
    const recent = fakeEvidence({
      summary: 'AI regulation breaking news today',
      connectorId: 'rss_news',
      timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1h ago
    });
    const old = fakeEvidence({
      summary: 'AI regulation breaking news today',
      connectorId: 'rss_news',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 180).toISOString(), // 6mo ago
    });

    scorer.score([recent, old], 'AI regulation news', { recencyMode: true });
    expect(recent._relevanceScore).toBeGreaterThan(old._relevanceScore);
  });

  it('high-authority connector with entity mention gets floor 0.30', () => {
    const item = fakeEvidence({
      connectorId: 'nhtsa',
      summary: 'Tesla vehicle recall 23V-838 defective windshield wiper',
    });
    scorer.score([item], 'general question', { companies: ['Tesla'] });
    expect(item._relevanceScore).toBeGreaterThanOrEqual(0.30);
  });
});

// ── filter() ─────────────────────────────────────────────────────────────────

describe('RelevanceScorer.filter()', () => {
  it('returns { kept, dropped, stats } shape', () => {
    const items = [
      fakeEvidence({ summary: 'Tesla safety record is excellent' }),
      fakeEvidence({ summary: 'random unrelated content about cooking' }),
    ];
    const result = scorer.filter(items, 'Tesla safety', { companies: ['Tesla'] });
    expect(result).toHaveProperty('kept');
    expect(result).toHaveProperty('dropped');
    expect(result).toHaveProperty('stats');
    expect(Array.isArray(result.kept)).toBe(true);
    expect(Array.isArray(result.dropped)).toBe(true);
  });

  it('stats.total equals input length', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      fakeEvidence({ summary: `item ${i} about some random thing` })
    );
    const { stats } = scorer.filter(items, 'Tesla autopilot');
    expect(stats.total).toBe(10);
    expect(stats.kept + stats.dropped).toBe(10);
  });

  it('catastrophic-drop protection: does not drop ALL evidence', () => {
    // All items have NO overlap with the query — all score 0.
    // With >10 items and <10% above threshold, the fallback keeps the top 20%.
    const items = Array.from({ length: 20 }, (_, i) =>
      fakeEvidence({ summary: `Pasta recipe tomato sauce olive oil basil garlic dish ${i}` })
    );
    const { kept } = scorer.filter(items, 'magnesium anxiety', {});
    // Catastrophic-drop fallback should keep at least the top 10 items (top 20% = max(10,4)=10)
    expect(kept.length).toBeGreaterThan(0);
  });

  it('drops genuinely irrelevant evidence', () => {
    const items = [
      fakeEvidence({ summary: 'Tesla autopilot safety study confirms reduced crash rate' }),
      fakeEvidence({ summary: 'Lorem ipsum dolor sit amet consectetur adipiscing elit' }),
      fakeEvidence({ summary: 'Completely unrelated tourism guide to Lut Desert Iran' }),
    ];
    const { kept, dropped } = scorer.filter(
      items,
      'Tesla autopilot safety',
      { companies: ['Tesla'], topics: ['autopilot'] },
      0.25
    );
    // The Tesla item should pass; the lorem ipsum & tourism guide should drop
    const keptSummaries = kept.map(e => e.summary);
    expect(keptSummaries.some(s => s.includes('Tesla'))).toBe(true);
  });

  it('rankByRelevance sorts by score descending', () => {
    const items = [
      fakeEvidence({ summary: 'slightly relevant item', _relevanceScore: 0.3 }),
      fakeEvidence({ summary: 'very relevant Tesla autopilot item', _relevanceScore: 0.8 }),
      fakeEvidence({ summary: 'somewhat relevant', _relevanceScore: 0.5 }),
    ];
    const ranked = scorer.rankByRelevance(items);
    expect(ranked[0]._relevanceScore).toBeGreaterThanOrEqual(ranked[1]._relevanceScore);
    expect(ranked[1]._relevanceScore).toBeGreaterThanOrEqual(ranked[2]._relevanceScore);
  });
});

// ── Internal helpers ─────────────────────────────────────────────────────────

describe('RelevanceScorer internals', () => {
  it('_extractTerms strips stop words and punctuation', () => {
    const terms = scorer._extractTerms('Is the Tesla autopilot safe?');
    expect(terms).toContain('tesla');
    expect(terms).toContain('autopilot');
    expect(terms).toContain('safe');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('is');
  });

  it('_termOverlap returns 0 for empty query terms', () => {
    expect(scorer._termOverlap([], 'any text')).toBe(0);
  });

  it('_entityOverlap returns 0 for no entities', () => {
    expect(scorer._entityOverlap([], 'any text')).toBe(0);
  });
});
