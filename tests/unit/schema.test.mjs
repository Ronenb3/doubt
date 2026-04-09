/**
 * Unit tests for doubt/src/core/schema.js
 * Tests the universal evidence data model.
 */

import { describe, it, expect } from 'vitest';
import {
  createEvidence,
  createClaim,
  createInvestigation,
  createEntity,
  createContradiction,
  deterministicId,
  ClaimStatus,
  EvidenceType,
  SourceTrust,
  ContradictionType,
  EntityType,
  Phase,
} from '../../src/core/schema.js';

// ── createEvidence ───────────────────────────────────────────────────────────

describe('createEvidence()', () => {
  it('produces an object with all required fields', () => {
    const ev = createEvidence({
      type: EvidenceType.SUPPORTS,
      connectorId: 'duckduckgo',
      sourceUrl: 'https://example.com/article',
      summary: 'Magnesium reduces anxiety according to a study.',
      trustWeight: 0.65,
    });

    expect(ev).toHaveProperty('id');
    expect(ev).toHaveProperty('type', EvidenceType.SUPPORTS);
    expect(ev).toHaveProperty('connectorId', 'duckduckgo');
    expect(ev).toHaveProperty('sourceUrl', 'https://example.com/article');
    expect(ev).toHaveProperty('summary', 'Magnesium reduces anxiety according to a study.');
    expect(ev).toHaveProperty('trustWeight', 0.65);
    expect(ev).toHaveProperty('timestamp');
    expect(ev).toHaveProperty('citedBy');
    expect(ev).toHaveProperty('rootSource');
    expect(Array.isArray(ev.citedBy)).toBe(true);
  });

  it('generates a non-empty string id', () => {
    const ev = createEvidence({
      type: EvidenceType.NEUTRAL,
      connectorId: 'arxiv',
      sourceUrl: 'https://arxiv.org/abs/1234.5678',
      summary: 'Test paper',
    });
    expect(typeof ev.id).toBe('string');
    expect(ev.id.length).toBeGreaterThan(0);
  });

  it('defaults missing optional fields', () => {
    const ev = createEvidence({
      type: EvidenceType.NEUTRAL,
      connectorId: 'test',
      sourceUrl: 'https://example.com',
      summary: 'Test summary',
    });
    expect(ev.claimId).toBeNull();
    expect(ev.data).toEqual({});
    expect(ev.trustWeight).toBe(0.5);
    expect(ev.rootSource).toBeNull();
  });

  it('handles empty summary without crash', () => {
    const ev = createEvidence({
      type: EvidenceType.NEUTRAL,
      connectorId: 'test',
      sourceUrl: '',
      summary: '',
    });
    expect(ev).toBeDefined();
    expect(ev.summary).toBe('');
  });

  it('two evidence items with different content get different ids', () => {
    const ev1 = createEvidence({ type: EvidenceType.SUPPORTS, connectorId: 'a', sourceUrl: 'http://a.com', summary: 'A' });
    const ev2 = createEvidence({ type: EvidenceType.SUPPORTS, connectorId: 'b', sourceUrl: 'http://b.com', summary: 'B' });
    // IDs are based on connectorId:sourceUrl:timestamp so they differ
    // (even if same timestamp, the inputs differ)
    expect(ev1.id).not.toBe(ev2.id);
  });
});

// ── Enums ────────────────────────────────────────────────────────────────────

describe('EvidenceType', () => {
  it('has SUPPORTS, CONTRADICTS, NEUTRAL, CONTEXTUAL', () => {
    expect(EvidenceType.SUPPORTS).toBe('supports');
    expect(EvidenceType.CONTRADICTS).toBe('contradicts');
    expect(EvidenceType.NEUTRAL).toBe('neutral');
    expect(EvidenceType.CONTEXTUAL).toBe('contextual');
  });

  it('is frozen (no mutation)', () => {
    expect(() => { EvidenceType.SUPPORTS = 'x'; }).toThrow();
  });
});

describe('SourceTrust', () => {
  it('primary documents rank highest', () => {
    expect(SourceTrust.PRIMARY_DOCUMENT).toBe(1.0);
    expect(SourceTrust.GOVERNMENT_FILING).toBeGreaterThan(SourceTrust.SOCIAL_MEDIA);
  });

  it('social media ranks lowest among non-AI', () => {
    expect(SourceTrust.SOCIAL_MEDIA).toBeLessThan(SourceTrust.NEWS_MINOR);
    expect(SourceTrust.AI_GENERATED).toBeLessThan(SourceTrust.SOCIAL_MEDIA);
  });
});

describe('ClaimStatus', () => {
  it('has all expected statuses', () => {
    expect(ClaimStatus.PENDING).toBeDefined();
    expect(ClaimStatus.SUPPORTED).toBeDefined();
    expect(ClaimStatus.CONTRADICTED).toBeDefined();
    expect(ClaimStatus.INSUFFICIENT).toBeDefined();
    expect(ClaimStatus.CONTESTED).toBeDefined();
    expect(ClaimStatus.UNFALSIFIABLE).toBeDefined();
  });
});

// ── createClaim ──────────────────────────────────────────────────────────────

describe('createClaim()', () => {
  it('produces a valid claim object', () => {
    const c = createClaim('Magnesium is effective for anxiety.', 'pubmed');
    expect(c).toHaveProperty('id');
    expect(c.text).toBe('Magnesium is effective for anxiety.');
    expect(c.status).toBe(ClaimStatus.PENDING);
    expect(c.confidence).toBe(0);
    expect(Array.isArray(c.evidence)).toBe(true);
    expect(c.isKeystone).toBe(false);
  });

  it('trims whitespace from text', () => {
    const c = createClaim('  hello world  ');
    expect(c.text).toBe('hello world');
  });

  it('same text produces same deterministic id', () => {
    const c1 = createClaim('test claim');
    const c2 = createClaim('test claim');
    expect(c1.id).toBe(c2.id);
  });

  it('different text produces different ids', () => {
    const c1 = createClaim('claim A');
    const c2 = createClaim('claim B');
    expect(c1.id).not.toBe(c2.id);
  });
});

// ── createInvestigation ──────────────────────────────────────────────────────

describe('createInvestigation()', () => {
  it('produces a full investigation scaffold', () => {
    const inv = createInvestigation('Is caffeine safe in high doses?');
    expect(inv).toHaveProperty('id');
    expect(inv.query).toBe('Is caffeine safe in high doses?');
    expect(Array.isArray(inv.claims)).toBe(true);
    expect(Array.isArray(inv.evidence)).toBe(true);
    expect(inv.status).toBe(ClaimStatus.PENDING);
    expect(inv.phase).toBe(Phase.PREFLIGHT);
    expect(inv.confidence).toBe(0);
    expect(inv.timestamps.created).toBeGreaterThan(0);
  });

  it('respects options override', () => {
    const inv = createInvestigation('test', { depth: 'deep', maxSources: 100 });
    expect(inv.options.depth).toBe('deep');
    expect(inv.options.maxSources).toBe(100);
  });

  it('defaults depth to standard', () => {
    const inv = createInvestigation('test');
    expect(inv.options.depth).toBe('standard');
  });
});

// ── createEntity ─────────────────────────────────────────────────────────────

describe('createEntity()', () => {
  it('creates entity with correct structure', () => {
    const e = createEntity(EntityType.ORGANIZATION, 'Tesla Inc.', { ticker: 'TSLA' });
    expect(e.type).toBe(EntityType.ORGANIZATION);
    expect(e.canonical).toBe('Tesla Inc.');
    expect(e.data.ticker).toBe('TSLA');
    expect(Array.isArray(e.aliases)).toBe(true);
    expect(e.mentions).toBe(1);
  });

  it('same type+name produces same id', () => {
    const e1 = createEntity('person', 'Elon Musk');
    const e2 = createEntity('person', 'Elon Musk');
    expect(e1.id).toBe(e2.id);
  });
});

// ── deterministicId ──────────────────────────────────────────────────────────

describe('deterministicId()', () => {
  it('produces a 16-char hex string', () => {
    const id = deterministicId('claim', 'test input');
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('same inputs → same id', () => {
    expect(deterministicId('ev', 'hello')).toBe(deterministicId('ev', 'hello'));
  });

  it('different inputs → different ids', () => {
    expect(deterministicId('ev', 'hello')).not.toBe(deterministicId('ev', 'world'));
  });

  it('different namespaces → different ids', () => {
    expect(deterministicId('claim', 'test')).not.toBe(deterministicId('entity', 'test'));
  });
});
