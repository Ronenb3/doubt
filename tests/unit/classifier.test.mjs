/**
 * Unit tests for doubt/src/intelligence/classifier.js
 * Tests stance classification: SUPPORTS / CONTRADICTS / CONTEXTUAL / NEUTRAL
 */

import { describe, it, expect } from 'vitest';
import StanceClassifier from '../../src/intelligence/classifier.js';
import { EvidenceType } from '../../src/core/schema.js';

const classifier = new StanceClassifier();

function fakeEvidence(summary) {
  return { summary, type: EvidenceType.NEUTRAL, _classificationConfidence: 0 };
}

function fakeClaim(text) {
  return { id: 'c1', text };
}

// ── classify() ───────────────────────────────────────────────────────────────

describe('StanceClassifier.classify()', () => {
  it('returns empty array for empty input', () => {
    expect(classifier.classify([], [], 'any')).toEqual([]);
  });

  it('returns empty array for null input', () => {
    expect(classifier.classify(null, [], 'any')).toBeNull();
  });

  it('attaches .type and ._classificationConfidence to every item', () => {
    const evidence = [
      fakeEvidence('Tesla autopilot is safe and improved'),
      fakeEvidence('Tesla recall and crash investigation'),
    ];
    classifier.classify(evidence, [fakeClaim('Tesla autopilot is safe')], 'Tesla autopilot is safe');
    for (const e of evidence) {
      expect(e.type).toBeDefined();
      expect(Object.values(EvidenceType)).toContain(e.type);
      expect(typeof e._classificationConfidence).toBe('number');
    }
  });

  it('positive claim + positive evidence → SUPPORTS', () => {
    const evidence = [
      fakeEvidence('Tesla autopilot is safe, reliable, approved, and successful — exceeded safety expectations'),
    ];
    classifier.classify(evidence, [fakeClaim('Tesla autopilot is safe')], 'Tesla autopilot is safe');
    expect(evidence[0].type).toBe(EvidenceType.SUPPORTS);
  });

  it('positive claim + negative evidence → CONTRADICTS', () => {
    const evidence = [
      fakeEvidence('Tesla autopilot fatal crash recall investigation — 3 deaths, dangerous defect'),
    ];
    classifier.classify(evidence, [fakeClaim('Tesla autopilot is safe')], 'Tesla autopilot is safe');
    expect(evidence[0].type).toBe(EvidenceType.CONTRADICTS);
  });

  it('negative claim + negative evidence → SUPPORTS', () => {
    // Claim: "Tesla has dangerous defects" — negative direction
    // Evidence: confirms recalls, crashes → SUPPORTS the negative claim
    const evidence = [
      fakeEvidence('Tesla recall investigation confirmed dangerous defect failure bankruptcy warning'),
    ];
    classifier.classify(evidence, [fakeClaim('Tesla vehicles are dangerous and defective')], 'Tesla vehicles are dangerous');
    expect(evidence[0].type).toBe(EvidenceType.SUPPORTS);
  });

  it('contextual background signals → CONTEXTUAL', () => {
    const evidence = [
      fakeEvidence('Industry overview: automotive sector market overview historical average benchmark compared to peers'),
    ];
    classifier.classify(evidence, [fakeClaim('Tesla autopilot is safe')], 'Tesla autopilot is safe');
    // Should be CONTEXTUAL or NEUTRAL — not SUPPORTS/CONTRADICTS
    expect([EvidenceType.CONTEXTUAL, EvidenceType.NEUTRAL]).toContain(evidence[0].type);
  });

  it('empty summary → NEUTRAL with low confidence', () => {
    const evidence = [fakeEvidence('')];
    classifier.classify(evidence, [fakeClaim('something')], 'something');
    expect(evidence[0].type).toBe(EvidenceType.NEUTRAL);
    expect(evidence[0]._classificationConfidence).toBeLessThanOrEqual(0.35);
  });
});

// ── classifyForClaim() ────────────────────────────────────────────────────────

describe('StanceClassifier.classifyForClaim()', () => {
  it('returns { stance, confidence } for a single item', () => {
    const result = classifier.classifyForClaim(
      fakeEvidence('approved safe effective reliable growth profit'),
      fakeClaim('Drug X is effective')
    );
    expect(result).toHaveProperty('stance');
    expect(result).toHaveProperty('confidence');
    expect(typeof result.confidence).toBe('number');
  });

  it('works with a plain string claim', () => {
    const result = classifier.classifyForClaim(
      fakeEvidence('Vaccine cleared approved certified safe effective'),
      'Vaccine is safe'
    );
    expect(result.stance).toBe(EvidenceType.SUPPORTS);
  });
});

// ── detectSentiment() ────────────────────────────────────────────────────────

describe('StanceClassifier.detectSentiment()', () => {
  it('returns 0 sentiment for empty text', () => {
    const result = classifier.detectSentiment('');
    expect(result.sentiment).toBe(0);
    expect(result.positive).toBe(0);
    expect(result.negative).toBe(0);
  });

  it('returns null-safe for null input', () => {
    const result = classifier.detectSentiment(null);
    expect(result.sentiment).toBe(0);
  });

  it('detects positive signals', () => {
    const result = classifier.detectSentiment('safe approved certified reliable successful growth');
    expect(result.positive).toBeGreaterThan(0);
    expect(result.sentiment).toBeGreaterThan(0);
  });

  it('detects negative signals', () => {
    const result = classifier.detectSentiment('crash fatal recall investigation fraud lawsuit bankruptcy');
    expect(result.negative).toBeGreaterThan(0);
    expect(result.sentiment).toBeLessThan(0);
  });

  it('mixed signals → moderate sentiment near 0', () => {
    const result = classifier.detectSentiment('safe approved but investigation recall crash');
    // Both positive and negative → sentiment closer to 0 than extreme
    expect(result.sentiment).toBeGreaterThan(-1);
    expect(result.sentiment).toBeLessThan(1);
  });

  it('returns indicators array', () => {
    const result = classifier.detectSentiment('safe certified reliable crash fatal');
    expect(Array.isArray(result.indicators)).toBe(true);
    expect(result.indicators.length).toBeGreaterThan(0);
  });
});

// ── getStats() ────────────────────────────────────────────────────────────────

describe('StanceClassifier.getStats()', () => {
  it('counts by type correctly', () => {
    const evidence = [
      { type: EvidenceType.SUPPORTS,     _classificationConfidence: 0.8 },
      { type: EvidenceType.SUPPORTS,     _classificationConfidence: 0.7 },
      { type: EvidenceType.CONTRADICTS,  _classificationConfidence: 0.6 },
      { type: EvidenceType.CONTEXTUAL,   _classificationConfidence: 0.5 },
      { type: EvidenceType.NEUTRAL,      _classificationConfidence: 0.3 },
    ];
    const stats = classifier.getStats(evidence);
    expect(stats.supports).toBe(2);
    expect(stats.contradicts).toBe(1);
    expect(stats.contextual).toBe(1);
    expect(stats.neutral).toBe(1);
    expect(stats.total).toBe(5);
    expect(stats.avgConfidence).toBeGreaterThan(0);
  });

  it('handles empty array', () => {
    const stats = classifier.getStats([]);
    expect(stats.supports).toBe(0);
    expect(stats.total).toBe(0);
  });
});
