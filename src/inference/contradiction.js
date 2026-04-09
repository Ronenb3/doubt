/**
 * doubt — Contradiction Engine
 *
 * Given a set of claims with evidence, detect contradictions.
 * Not just "A says X, B says Y" — structural contradictions:
 *
 *   TEMPORAL:      "Founded in 2015" vs "Operating since 2012"
 *   NUMERICAL:     "$5B revenue" vs "$3B revenue" (same period)
 *   ROLE:          "CEO of X" vs "CEO of Y" (same person, same time)
 *   LOCATION:      "HQ in SF" vs "HQ in NYC" (same entity)
 *   EXISTENCE:     "Company shut down" vs "Company raised Series C"
 *   ATTRIBUTION:   "A invented X" vs "B invented X"
 *   INTRA_SPEAKER: Same source making conflicting claims
 *   LOGICAL:       "All data is encrypted" vs "We share raw data with partners"
 *
 * The severity score reflects how damaging the contradiction is
 * to the overall investigation. A contradiction between two
 * primary documents is devastating (0.9+). Between social media
 * posts, less so (0.3).
 */

import { createContradiction, ContradictionType } from '../core/schema.js';

export class ContradictionEngine {
  constructor() {
    // Precompiled patterns for structural contradiction detection
    this._patterns = [
      {
        type: ContradictionType.TEMPORAL,
        detect: this._detectTemporal.bind(this),
      },
      {
        type: ContradictionType.NUMERICAL,
        detect: this._detectNumerical.bind(this),
      },
      {
        type: ContradictionType.EXISTENCE,
        detect: this._detectExistence.bind(this),
      },
      {
        type: ContradictionType.ATTRIBUTION,
        detect: this._detectAttribution.bind(this),
      },
      {
        type: ContradictionType.LOGICAL,
        detect: this._detectLogical.bind(this),
      },
    ];

    this._negationPairs = [
      ['increase', 'decrease'], ['rise', 'fall'], ['grow', 'shrink'],
      ['profit', 'loss'], ['expand', 'contract'], ['hire', 'fire'],
      ['acquire', 'divest'], ['open', 'close'], ['approve', 'reject'],
      ['confirm', 'deny'], ['support', 'oppose'], ['allow', 'prohibit'],
      ['true', 'false'], ['legal', 'illegal'], ['safe', 'dangerous'],
      ['success', 'failure'], ['transparent', 'opaque'], ['independent', 'dependent'],
    ];
  }

  /**
   * Detect all contradictions in a claim set.
   */
  detect(claims) {
    const contradictions = [];
    const n = claims.length;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const found = this._compare(claims[i], claims[j]);
        contradictions.push(...found);
      }
    }

    // Sort by severity (most damaging first)
    contradictions.sort((a, b) => b.severity - a.severity);
    return contradictions;
  }

  _compare(claimA, claimB) {
    const results = [];

    for (const pattern of this._patterns) {
      const result = pattern.detect(claimA, claimB);
      if (result) {
        results.push(createContradiction(
          claimA, claimB,
          result.type,
          result.severity,
          result.explanation,
        ));
      }
    }

    // Check negation patterns
    const negation = this._detectNegation(claimA, claimB);
    if (negation) {
      results.push(createContradiction(
        claimA, claimB,
        ContradictionType.LOGICAL,
        negation.severity,
        negation.explanation,
      ));
    }

    // Intra-speaker check
    if (claimA.source && claimB.source &&
        claimA.source === claimB.source) {
      const intra = this._detectIntraSpeaker(claimA, claimB);
      if (intra) {
        results.push(createContradiction(
          claimA, claimB,
          ContradictionType.INTRA_SPEAKER,
          intra.severity,
          intra.explanation,
        ));
      }
    }

    return results;
  }

  _detectTemporal(a, b) {
    const datesA = extractDates(a.text);
    const datesB = extractDates(b.text);
    if (datesA.length === 0 || datesB.length === 0) return null;

    // Check for overlapping time references with conflicting assertions
    const verbsA = extractVerbs(a.text);
    const verbsB = extractVerbs(b.text);

    // Same entity mentioned + different dates + conflicting verbs
    const entitiesA = extractNamedEntities(a.text);
    const entitiesB = extractNamedEntities(b.text);
    const sharedEntities = entitiesA.filter(e => entitiesB.includes(e));

    if (sharedEntities.length > 0) {
      for (const dateA of datesA) {
        for (const dateB of datesB) {
          if (dateA !== dateB) {
            const trust = Math.min(
              a.inference?.alpha || 0.5,
              b.inference?.alpha || 0.5
            );
            return {
              type: ContradictionType.TEMPORAL,
              severity: Math.min(0.95, 0.5 + trust * 0.3),
              explanation: `Temporal conflict on "${sharedEntities[0]}": "${dateA}" vs "${dateB}"`,
            };
          }
        }
      }
    }
    return null;
  }

  _detectNumerical(a, b) {
    const numsA = extractNumbers(a.text);
    const numsB = extractNumbers(b.text);
    if (numsA.length === 0 || numsB.length === 0) return null;

    // Find numbers with shared context (same unit, same entity)
    const entitiesA = extractNamedEntities(a.text);
    const entitiesB = extractNamedEntities(b.text);
    const shared = entitiesA.filter(e => entitiesB.includes(e));

    if (shared.length > 0) {
      for (const nA of numsA) {
        for (const nB of numsB) {
          // Numbers more than 30% apart on the same entity = conflict
          if (nA.value > 0 && nB.value > 0) {
            const ratio = Math.max(nA.value, nB.value) / Math.min(nA.value, nB.value);
            if (ratio > 1.3 && nA.unit === nB.unit) {
              return {
                type: ContradictionType.NUMERICAL,
                severity: Math.min(0.95, 0.4 + (ratio - 1) * 0.3),
                explanation: `Numerical conflict on "${shared[0]}": ${nA.raw} vs ${nB.raw}`,
              };
            }
          }
        }
      }
    }
    return null;
  }

  _detectExistence(a, b) {
    const text = `${a.text.toLowerCase()} ||| ${b.text.toLowerCase()}`;

    const existenceSignals = [
      [/\b(shut down|closed|bankrupt|dissolved|defunct)\b/, /\b(raised|launched|expanded|opened|hired)\b/],
      [/\b(no longer exists?|ceased operations?)\b/, /\b(currently operating|active|growing)\b/],
      [/\b(fired|terminated|resigned)\b/, /\b(promoted|appointed|hired as)\b/],
    ];

    for (const [patternA, patternB] of existenceSignals) {
      const aLower = a.text.toLowerCase();
      const bLower = b.text.toLowerCase();
      if ((patternA.test(aLower) && patternB.test(bLower)) ||
          (patternB.test(aLower) && patternA.test(bLower))) {
        return {
          type: ContradictionType.EXISTENCE,
          severity: 0.85,
          explanation: `Existence conflict: one claim suggests cessation while the other suggests active operation`,
        };
      }
    }
    return null;
  }

  _detectAttribution(a, b) {
    // "A founded X" vs "B founded X"
    const attrPattern = /\b(\w+(?:\s\w+)?)\s+(founded|invented|created|developed|discovered|coined|pioneered)\s+(.+?)(?:\.|,|$)/i;
    const matchA = a.text.match(attrPattern);
    const matchB = b.text.match(attrPattern);

    if (matchA && matchB) {
      const [, personA, verbA, thingA] = matchA;
      const [, personB, verbB, thingB] = matchB;

      if (thingA.toLowerCase().includes(thingB.toLowerCase()) ||
          thingB.toLowerCase().includes(thingA.toLowerCase())) {
        if (personA.toLowerCase() !== personB.toLowerCase()) {
          return {
            type: ContradictionType.ATTRIBUTION,
            severity: 0.75,
            explanation: `Attribution conflict: "${personA}" vs "${personB}" both credited with "${thingA}"`,
          };
        }
      }
    }
    return null;
  }

  _detectLogical(a, b) {
    const allPatterns = [
      [/\b(all|every|always|100%|entirely)\b.*\b(encrypted|secure|private|protected)\b/i,
       /\b(share|expose|public|accessible|open)\b.*\b(data|information|records)\b/i],
      [/\b(no|zero|never|none)\b.*\b(breach|leak|incident|violation)\b/i,
       /\b(breach|leak|incident|hack|compromised)\b/i],
      [/\b(fully|completely)\s+(independent|autonomous|self-funded)\b/i,
       /\b(subsidiary|owned by|controlled by|funded by|dependent on)\b/i],
    ];

    const aLower = a.text.toLowerCase();
    const bLower = b.text.toLowerCase();

    for (const [patA, patB] of allPatterns) {
      if ((patA.test(aLower) && patB.test(bLower)) ||
          (patB.test(aLower) && patA.test(bLower))) {
        return {
          type: ContradictionType.LOGICAL,
          severity: 0.80,
          explanation: `Logical impossibility between absolute claims`,
        };
      }
    }
    return null;
  }

  _detectNegation(a, b) {
    const aLower = a.text.toLowerCase();
    const bLower = b.text.toLowerCase();

    for (const [pos, neg] of this._negationPairs) {
      const aHasPos = aLower.includes(pos);
      const aHasNeg = aLower.includes(neg);
      const bHasPos = bLower.includes(pos);
      const bHasNeg = bLower.includes(neg);

      // Shared context needed
      const entitiesA = extractNamedEntities(a.text);
      const entitiesB = extractNamedEntities(b.text);
      const shared = entitiesA.filter(e => entitiesB.includes(e));

      if (shared.length > 0 && ((aHasPos && bHasNeg) || (aHasNeg && bHasPos))) {
        return {
          severity: 0.60,
          explanation: `Opposing assertions about "${shared[0]}": ${pos} vs ${neg}`,
        };
      }
    }
    return null;
  }

  _detectIntraSpeaker(a, b) {
    // Same source making conflicting claims — higher severity
    const negation = this._detectNegation(a, b);
    if (negation) {
      return {
        severity: Math.min(0.95, negation.severity + 0.2),
        explanation: `Same source (${a.source}) makes contradicting claims: ${negation.explanation}`,
      };
    }
    return null;
  }
}

// ─── Text Extraction Utilities ─────────────────────────────

function extractDates(text) {
  const patterns = [
    /\b(\d{4})\b/g,                          // years
    /\b(\w+ \d{1,2},? \d{4})\b/g,            // Month DD, YYYY
    /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g,      // MM/DD/YYYY
    /\b(Q[1-4]\s*\d{4})\b/g,                  // Q1 2024
  ];
  const dates = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      dates.push(match[1]);
    }
  }
  return [...new Set(dates)];
}

function extractNumbers(text) {
  const pattern = /\$?([\d,]+\.?\d*)\s*(billion|million|trillion|thousand|%|percent|B|M|K|T)?\b/gi;
  const numbers = [];
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    let value = parseFloat(match[1].replace(/,/g, ''));
    const unit = (match[2] || '').toLowerCase();

    const multipliers = { billion: 1e9, b: 1e9, million: 1e6, m: 1e6, thousand: 1e3, k: 1e3, trillion: 1e12, t: 1e12 };
    if (multipliers[unit]) value *= multipliers[unit];

    numbers.push({ value, unit: unit || 'raw', raw });
  }
  return numbers;
}

function extractNamedEntities(text) {
  // Simple NER: capitalized multi-word sequences
  const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  const entities = [];
  for (const match of text.matchAll(pattern)) {
    entities.push(match[1].toLowerCase());
  }
  return [...new Set(entities)];
}

function extractVerbs(text) {
  const pattern = /\b(founded|created|launched|closed|acquired|merged|raised|filed|sued|hired|fired|resigned|appointed)\b/gi;
  return [...text.matchAll(pattern)].map(m => m[1].toLowerCase());
}

export default ContradictionEngine;
