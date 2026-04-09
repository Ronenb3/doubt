/**
 * Unit tests for doubt/src/intelligence/coverage-gap.js
 * Tests systematic coverage gap detection in evidence sets.
 */

import { describe, it, expect } from 'vitest';
import { detectCoverageGaps } from '../../src/intelligence/coverage-gap.js';

function fakeEvidence(overrides = {}) {
  return {
    connectorId: overrides.connectorId || 'test',
    sourceUrl: overrides.sourceUrl || '',
    summary: overrides.summary || '',
    url: overrides.url || overrides.sourceUrl || '',
    trustWeight: overrides.trustWeight ?? 0.5,
    timestamp: overrides.timestamp || null,
  };
}

// ── detectCoverageGaps() ─────────────────────────────────────────────────────

describe('detectCoverageGaps()', () => {
  it('returns { gaps, score, warnings } shape', () => {
    const evidence = [fakeEvidence({ connectorId: 'rss_news' })];
    const result = detectCoverageGaps(evidence, 'test query');
    expect(result).toHaveProperty('gaps');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.gaps)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(typeof result.score).toBe('number');
  });

  it('score is between 0 and 1', () => {
    const evidence = [fakeEvidence({ connectorId: 'rss_news', trustWeight: 0.5 })];
    const { score } = detectCoverageGaps(evidence, 'general query');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns critical gap for zero evidence', () => {
    const { gaps, score } = detectCoverageGaps([], 'anything');
    expect(score).toBe(0);
    const critical = gaps.find(g => g.type === 'no_evidence');
    expect(critical).toBeDefined();
    expect(critical.severity).toBe('critical');
  });

  it('financial query with no SEC data → flags financial domain gap', () => {
    const evidence = [
      fakeEvidence({ connectorId: 'rss_news', summary: 'SEC 10-K filing balance sheet', trustWeight: 0.5 }),
    ];
    // Query mentions SEC filing — expects financial domain coverage
    const { gaps } = detectCoverageGaps(evidence, 'SEC insider trading filing 10-K', []);
    const financialGap = gaps.find(g => g.domain === 'financial');
    expect(financialGap).toBeDefined();
  });

  it('legal query with no court sources → flags legal gap', () => {
    const evidence = [
      fakeEvidence({ connectorId: 'rss_news', summary: 'News about court case' }),
    ];
    const { gaps } = detectCoverageGaps(evidence, 'Tesla lawsuit litigation verdict', []);
    const legalGap = gaps.find(g => g.domain === 'legal');
    expect(legalGap).toBeDefined();
  });

  it('health/clinical query with no academic sources → flags academic gap', () => {
    const evidence = [
      fakeEvidence({ connectorId: 'reddit', summary: 'My experience with magnesium', trustWeight: 0.3 }),
    ];
    const { gaps } = detectCoverageGaps(evidence, 'clinical trial FDA drug vaccine health', []);
    const academicGap = gaps.find(g => g.domain === 'academic');
    expect(academicGap).toBeDefined();
  });

  it('all social-media evidence → flags social_dominance gap', () => {
    const evidence = Array.from({ length: 10 }, (_, i) =>
      fakeEvidence({ connectorId: 'reddit', trustWeight: 0.30, summary: `Reddit post ${i}` })
    );
    const { gaps } = detectCoverageGaps(evidence, 'is magnesium safe', []);
    const socialGap = gaps.find(g => g.type === 'social_dominance');
    expect(socialGap).toBeDefined();
    expect(socialGap.severity).toBe('warn');
  });

  it('zero high-trust sources on 6+ evidence → trust_tier_gap', () => {
    const evidence = Array.from({ length: 7 }, (_, i) =>
      fakeEvidence({ connectorId: 'rss_news', trustWeight: 0.50, summary: `News item ${i}` })
    );
    const { gaps } = detectCoverageGaps(evidence, 'generic query', []);
    const trustGap = gaps.find(g => g.type === 'trust_tier_gap');
    expect(trustGap).toBeDefined();
  });

  it('comprehensive high-trust evidence → low gap count', () => {
    // Evidence from multiple domains with high trust
    const evidence = [
      fakeEvidence({ connectorId: 'sec_edgar',       trustWeight: 0.95 }),
      fakeEvidence({ connectorId: 'courtlistener',   trustWeight: 0.90 }),
      fakeEvidence({ connectorId: 'pubmed',           trustWeight: 0.80 }),
      fakeEvidence({ connectorId: 'rss_news',         trustWeight: 0.65 }),
      fakeEvidence({ connectorId: 'federal_register', trustWeight: 0.95 }),
      fakeEvidence({ connectorId: 'opencorporates',   trustWeight: 0.70 }),
    ];
    const { gaps, score } = detectCoverageGaps(evidence, 'company corporate');
    const criticalGaps = gaps.filter(g => g.severity === 'critical');
    expect(criticalGaps.length).toBe(0);
    expect(score).toBeGreaterThan(0.5);
  });

  it('very few evidence items → volume_gap', () => {
    const evidence = [
      fakeEvidence({ connectorId: 'duckduckgo', trustWeight: 0.6 }),
      fakeEvidence({ connectorId: 'arxiv',      trustWeight: 0.75 }),
    ];
    const { gaps } = detectCoverageGaps(evidence, 'any query', []);
    const volumeGap = gaps.find(g => g.type === 'volume_gap');
    expect(volumeGap).toBeDefined();
    expect(volumeGap.severity).toBe('warn');
  });

  it('temporal gap when all timestamps cluster in short window', () => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const evidence = Array.from({ length: 12 }, (_, i) =>
      fakeEvidence({
        connectorId: 'rss_news',
        trustWeight: 0.5,
        timestamp: new Date(now - i * oneDay * 0.5).toISOString(), // all within ~6 days
      })
    );
    const { gaps } = detectCoverageGaps(evidence, 'general query', []);
    const temporalGap = gaps.find(g => g.type === 'temporal_gap');
    expect(temporalGap).toBeDefined();
  });

  it('warnings array contains human-readable strings', () => {
    const evidence = [
      fakeEvidence({ connectorId: 'reddit', trustWeight: 0.3, summary: 'Reddit 1' }),
      fakeEvidence({ connectorId: 'reddit', trustWeight: 0.3, summary: 'Reddit 2' }),
    ];
    const { warnings } = detectCoverageGaps(evidence, 'SEC filing fraud', []);
    for (const w of warnings) {
      expect(typeof w).toBe('string');
      expect(w.length).toBeGreaterThan(0);
    }
  });

  it('gaps are sorted: critical first, then warn, then info', () => {
    // Force multiple gaps including a critical one (sanctions query, no sanctions connectors)
    const evidence = [
      fakeEvidence({ connectorId: 'rss_news', trustWeight: 0.5, summary: 'OFAC sanction embargo news' }),
    ];
    const { gaps } = detectCoverageGaps(evidence, 'OFAC sanction embargo blacklist SDN', []);
    const severityOrder = { critical: 0, warn: 1, info: 2 };
    for (let i = 1; i < gaps.length; i++) {
      const prevOrd = severityOrder[gaps[i - 1].severity] ?? 3;
      const currOrd = severityOrder[gaps[i].severity] ?? 3;
      expect(prevOrd).toBeLessThanOrEqual(currOrd);
    }
  });
});
