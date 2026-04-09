/**
 * doubt — Universal Data Model
 *
 * Everything in the system flows through these types.
 * A claim enters. Evidence accumulates. Beliefs form.
 * Contradictions emerge. Keystones are identified.
 * The system doubts — and only speaks when the doubt is resolved.
 *
 * Design principle: every object carries its provenance.
 * You can always trace back to "why do we believe this?"
 */

import { createHash, randomUUID } from 'crypto';

// ─── Enums ────────────────────────────────────────────────

export const ClaimStatus = Object.freeze({
  PENDING:      'pending',       // submitted, not yet investigated
  INVESTIGATING:'investigating', // sources are being queried
  SUPPORTED:    'supported',     // evidence converges toward true
  CONTRADICTED: 'contradicted',  // evidence converges toward false
  CONTESTED:    'contested',     // strong evidence on both sides
  INSUFFICIENT: 'insufficient',  // not enough evidence to judge
  UNFALSIFIABLE:'unfalsifiable', // claim cannot be tested with available sources
});

export const EvidenceType = Object.freeze({
  SUPPORTS:     'supports',
  CONTRADICTS:  'contradicts',
  NEUTRAL:      'neutral',
  CONTEXTUAL:   'contextual',    // relevant background, not directly supporting/contradicting
});

export const SourceTrust = Object.freeze({
  PRIMARY_DOCUMENT:  1.0,   // direct filing, raw data, court document
  GOVERNMENT_FILING: 0.95,  // SEC, FEC, OFAC, USPTO
  COURT_RECORD:      0.90,  // CourtListener, PACER
  FINANCIAL_DATA:    0.85,  // Bloomberg, Polygon, FMP
  ACADEMIC_PEER:     0.80,  // peer-reviewed via OpenAlex, Semantic Scholar
  NEWS_MAJOR:        0.65,  // Reuters, AP, NYT
  NEWS_MINOR:        0.50,  // trade press, blogs
  SOCIAL_MEDIA:      0.30,  // Reddit, HN, StockTwits
  ANONYMOUS:         0.15,  // unverified tips, 4chan, anon posts
  AI_GENERATED:      0.10,  // LLM output without grounding
});

export const ContradictionType = Object.freeze({
  TEMPORAL:      'temporal_impossibility',
  NUMERICAL:     'numerical_conflict',
  ROLE:          'role_conflict',
  LOCATION:      'location_conflict',
  EXISTENCE:     'existence_conflict',
  ATTRIBUTION:   'attribution_conflict',
  INTRA_SPEAKER: 'intra_speaker_conflict',
  LOGICAL:       'logical_impossibility',
});

export const EntityType = Object.freeze({
  PERSON:        'person',
  ORGANIZATION:  'organization',
  CLAIM:         'claim',
  DOCUMENT:      'document',
  FINANCIAL:     'financial_instrument',
  LEGAL_CASE:    'legal_case',
  LOCATION:      'location',
  EVENT:         'event',
  CONCEPT:       'concept',
});

export const Phase = Object.freeze({
  PREFLIGHT:  'preflight',
  INTAKE:     'intake',
  HUNT:       'hunt',
  INFERENCE:  'inference',
  FRAGILITY:  'fragility',
  CHECK:      'check',
  REPORT:     'report',
  POSTFLIGHT: 'postflight',
});

// ─── Factory Functions ────────────────────────────────────

export function createInvestigation(query, options = {}) {
  options = options || {};
  return {
    id: randomUUID(),
    query,
    claims: [],
    evidence: [],
    entities: [],
    contradictions: [],
    keystones: [],
    vectors: null,
    phase: Phase.PREFLIGHT,
    confidence: 0,
    fragilityScore: 0,
    status: ClaimStatus.PENDING,
    options: {
      depth: options.depth || 'standard',
      sources: options.sources || 'all',
      maxSources: options.maxSources || 30,
      timeout: options.timeout || 60000,
      ...options,
    },
    timestamps: {
      created: Date.now(),
      started: null,
      completed: null,
    },
    learning: {
      domainPriors: {},
      previousInvestigations: 0,
    },
    meta: {
      sourcesQueried: 0,
      sourcesResponded: 0,
      sourcesFailed: 0,
      evidenceCount: 0,
      contradictionCount: 0,
      citationDiversity: 0,
      wallTimeMs: 0,
    },
  };
}

export function createClaim(text, source = null) {
  return {
    id: deterministicId('claim', text),
    text: text.trim(),
    status: ClaimStatus.PENDING,
    confidence: 0,
    evidence: [],
    dependsOn: [],       // claim IDs this claim assumes
    supports: [],        // claim IDs that depend on this claim
    isKeystone: false,
    fragilityScore: 0,
    cascadeSize: 0,      // how many claims collapse if this fails
    source,
    extractedAt: Date.now(),
  };
}

export function createEvidence({
  type,
  claimId = null,
  connectorId,
  sourceUrl,
  summary,
  data = {},
  trustWeight = 0.5,
  timestamp = null,
}) {
  return {
    id: deterministicId('evidence', `${connectorId}:${sourceUrl}:${Date.now()}`),
    type,
    claimId,
    connectorId,
    sourceUrl,
    summary,
    data,
    trustWeight,
    timestamp: timestamp || new Date().toISOString(),
    citedBy: [],          // other evidence IDs that cite the same source
    rootSource: null,     // if this is derivative, what's the primary source?
  };
}

export function createEntity(type, name, data = {}, source = null) {
  return {
    id: deterministicId('entity', `${type}:${name}`),
    type,
    canonical: name.trim(),
    aliases: [],
    mentions: 1,
    data,
    source,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
  };
}

export function createContradiction(claimA, claimB, type, severity, explanation) {
  return {
    id: deterministicId('contradiction', `${claimA.id}:${claimB.id}`),
    claimA: { id: claimA.id, text: claimA.text },
    claimB: { id: claimB.id, text: claimB.text },
    type,
    severity,    // 0.0–1.0
    explanation,
    detectedAt: Date.now(),
    resolved: false,
    resolution: null,
  };
}

// ─── Utility ──────────────────────────────────────────────

function deterministicId(namespace, input) {
  return createHash('sha256')
    .update(`${namespace}:${input.toLowerCase().trim()}`)
    .digest('hex')
    .slice(0, 16);
}

export { deterministicId };
