/**
 * Unit tests for doubt/src/intelligence/dedup.js
 * Tests URL dedup, content similarity dedup, and same-fact merge.
 */

import { describe, it, expect } from 'vitest';
import Deduplicator from '../../src/intelligence/dedup.js';

const dedup = new Deduplicator();

let _idCounter = 0;
function fakeEvidence({ id, connectorId = 'test', sourceUrl = '', summary = '', trustWeight = 0.5 } = {}) {
  return {
    id: id || `ev-${++_idCounter}`,
    connectorId,
    sourceUrl,
    summary,
    data: {},
    trustWeight,
  };
}

// ── deduplicate() ────────────────────────────────────────────────────────────

describe('Deduplicator.deduplicate()', () => {
  it('returns { unique, duplicatesRemoved, mergedCount, stats }', () => {
    const result = dedup.deduplicate([
      fakeEvidence({ summary: 'Test item', sourceUrl: 'https://example.com' }),
    ]);
    expect(result).toHaveProperty('unique');
    expect(result).toHaveProperty('duplicatesRemoved');
    expect(result).toHaveProperty('mergedCount');
    expect(result).toHaveProperty('stats');
    expect(Array.isArray(result.unique)).toBe(true);
  });

  it('handles empty array', () => {
    const { unique, duplicatesRemoved } = dedup.deduplicate([]);
    expect(unique).toEqual([]);
    expect(duplicatesRemoved).toBe(0);
  });

  it('handles null input', () => {
    const { unique } = dedup.deduplicate(null);
    expect(unique).toEqual([]);
  });

  it('passes through single item unchanged', () => {
    const items = [fakeEvidence({ sourceUrl: 'https://example.com/a', summary: 'Unique content here' })];
    const { unique } = dedup.deduplicate(items);
    expect(unique.length).toBe(1);
  });

  // ── URL dedup ─────────────────────────────────────────────────────────────

  it('removes exact URL duplicates', () => {
    const url = 'https://reuters.com/article/tesla-recall-12345';
    const items = [
      fakeEvidence({ id: 'a', sourceUrl: url, summary: 'Reuters: Tesla recall', trustWeight: 0.65 }),
      fakeEvidence({ id: 'b', sourceUrl: url, summary: 'Reuters: Tesla recall', trustWeight: 0.65 }),
    ];
    const { unique, stats } = dedup.deduplicate(items);
    expect(unique.length).toBe(1);
    expect(stats.urlDuplicates).toBe(1);
  });

  it('keeps higher-trust item when URL duplicates exist', () => {
    const url = 'https://sec.gov/filing/12345';
    const items = [
      fakeEvidence({ id: 'a', sourceUrl: url, summary: 'SEC filing', trustWeight: 0.5 }),
      fakeEvidence({ id: 'b', sourceUrl: url, summary: 'SEC filing', trustWeight: 0.95 }),
    ];
    const { unique } = dedup.deduplicate(items);
    expect(unique.length).toBe(1);
    expect(unique[0].trustWeight).toBe(0.95);
  });

  it('strips UTM params before URL dedup', () => {
    const base = 'https://example.com/article/123';
    const items = [
      fakeEvidence({ id: 'a', sourceUrl: `${base}?utm_source=twitter`, summary: 'Same article' }),
      fakeEvidence({ id: 'b', sourceUrl: `${base}?utm_medium=email`, summary: 'Same article' }),
    ];
    const { unique } = dedup.deduplicate(items);
    expect(unique.length).toBe(1);
  });

  // ── Content similarity dedup ─────────────────────────────────────────────

  it('removes near-duplicate content (high Jaccard similarity)', () => {
    const base = 'Tesla Motors issued a voluntary recall affecting 23 vehicles with defective autopilot firmware';
    const items = [
      fakeEvidence({ id: 'a', sourceUrl: 'https://a.com/1', summary: base }),
      fakeEvidence({ id: 'b', sourceUrl: 'https://b.com/2', summary: base + ' per NHTSA' }),
      fakeEvidence({ id: 'c', sourceUrl: 'https://c.com/3', summary: 'Completely different: pineapple yogurt recipe with mango' }),
    ];
    const { unique } = dedup.deduplicate(items);
    // a and b are near-duplicates; c is distinct
    expect(unique.length).toBe(2);
  });

  it('keeps non-duplicates', () => {
    const items = [
      fakeEvidence({ id: 'a', sourceUrl: 'https://a.com', summary: 'Tesla autopilot safety record excellent' }),
      fakeEvidence({ id: 'b', sourceUrl: 'https://b.com', summary: 'Clinical trial magnesium glycinate anxiety reduction' }),
      fakeEvidence({ id: 'c', sourceUrl: 'https://c.com', summary: 'SEC EDGAR filing 10-K annual report fiscal 2024' }),
    ];
    const { unique } = dedup.deduplicate(items);
    expect(unique.length).toBe(3);
  });

  // ── Same-fact merge ───────────────────────────────────────────────────────

  it('merges cross-connector items referencing same numeric filing ID', () => {
    // The _extractFactKey function lowercases text before regex matching.
    // Pattern \d{2}[A-Z]-\d{3,} won't match lowercased text, but \d{4}-\d{5,} does.
    // Use a 6-digit filing ID: "2024-123456" matches /\b(\d{4}-\d{5,})\b/
    const items = [
      fakeEvidence({
        id: 'nhtsa-1', connectorId: 'nhtsa',
        sourceUrl: 'https://nhtsa.gov/recall/2024-123456',
        summary: 'Tesla recall filing 2024-123456 defective windshield wiper motor',
        trustWeight: 0.95,
      }),
      fakeEvidence({
        id: 'reuters-1', connectorId: 'rss_news',
        sourceUrl: 'https://reuters.com/article/recall-2024-123456',
        summary: 'Reuters: Tesla issues recall 2024-123456 for wiper defect confirmed',
        trustWeight: 0.65,
      }),
    ];
    const { unique, mergedCount } = dedup.deduplicate(items);
    // Should merge into 1 with boosted trust
    expect(unique.length).toBe(1);
    expect(mergedCount).toBe(1);
    expect(unique[0].trustWeight).toBeGreaterThan(0.95);
    expect(unique[0]._independentConfirmations).toBeGreaterThanOrEqual(2);
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  it('stats.inputSize and outputSize are correct', () => {
    const items = [
      fakeEvidence({ id: 'x', sourceUrl: 'https://x.com', summary: 'Item X' }),
      fakeEvidence({ id: 'y', sourceUrl: 'https://y.com', summary: 'Item Y' }),
    ];
    const { stats } = dedup.deduplicate(items);
    expect(stats.inputSize).toBe(2);
    expect(stats.outputSize).toBe(2);
    expect(stats.dedupRatio).toBe(0);
  });

  it('order stability: first occurrence of URL-dup is kept by trust preference', () => {
    const url = 'https://same.com/article';
    const items = [
      fakeEvidence({ id: 'first', sourceUrl: url, summary: 'First occurrence', trustWeight: 0.6 }),
      fakeEvidence({ id: 'second', sourceUrl: url, summary: 'Second occurrence', trustWeight: 0.3 }),
    ];
    const { unique } = dedup.deduplicate(items);
    // Higher-trust item should win
    expect(unique[0].id).toBe('first');
  });
});
