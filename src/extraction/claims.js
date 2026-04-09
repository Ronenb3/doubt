/**
 * doubt — Claim Extractor
 *
 * Heuristic NLP extraction of verifiable claims from text.
 * No LLM required. Splits text into sentences, scores each
 * on verifiability (named entity + predicate + falsifiable),
 * and returns ranked claim objects.
 */

import { createClaim } from '../core/schema.js';
import { log } from '../core/config.js';

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'inc', 'ltd', 'corp',
  'co', 'vs', 'etc', 'dept', 'est', 'approx', 'gov', 'gen', 'sgt',
  'rev', 'st', 'ave', 'blvd', 'jan', 'feb', 'mar', 'apr', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'vol', 'no', 'fig',
  'eq', 'rep', 'sen', 'hon', 'assn', 'intl',
]);

const CAUSAL_MARKERS = /\b(caused?|leads?\s+to|results?\s+in|because|therefore|consequently|due\s+to|as\s+a\s+result|responsible\s+for|linked\s+to|attributed\s+to|driven\s+by|contribut(?:ed?|ing)\s+to)\b/i;
const ASSERTION_MARKERS = /\b(is|are|was|were|has|have|had|will|confirmed|stated|claimed|reported|revealed|showed?|proved?|found|discovered|determined|concluded|estimated|according\s+to)\b/i;
const NUMBER_PATTERN = /\b\d[\d,.]*%?|\$[\d,.]+[BMKbmk]?\b/;
const DATE_PATTERN = /\b((?:19|20)\d{2}|January|February|March|April|May|June|July|August|September|October|November|December)\b/i;
const NAMED_ENTITY_PATTERN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/;
const QUESTION_PATTERN = /\?\s*$/;
const OPINION_ONLY = /^(I think|I believe|I feel|In my opinion|Personally|Maybe|Perhaps)\b/i;
const DEFINITION_PATTERN = /^[A-Z][a-z]+\s+(?:is|are)\s+(?:a|an|the)\s+(?:type|kind|form|class|category)\s+of\b/i;

// Patterns for decomposing a single claim into investigable dimensions
const DECOMPOSITION_PATTERNS = [
  {
    pattern: /^(.+?)\s+(?:is|are)\s+safe(?:\s+(?:for|to|on|in)\s+(.+?))?\.?\s*$/i,
    template: (subject, context) => {
      const forCtx = context ? ` for ${context}` : '';
      const condCtx = context ? ` for ${context} conditions` : '';
      return [
        `${subject} has an acceptable safety record (crash rates, incidents)`,
        `Regulatory bodies have found ${subject} safe${forCtx}`,
        `${subject} technology is reliable${condCtx}`,
        `Consumers report ${subject} as safe to use`,
      ];
    },
  },
  {
    pattern: /^(.+?)\s+(?:is|are)\s+(?:fraudulent|a\s+(?:fraud|scam)|deceptive|corrupt)\b.*$/i,
    template: (subject) => [
      `${subject} has financial irregularities in its records`,
      `Legal actions have been filed against ${subject} for fraud`,
      `Whistleblowers have reported misconduct at ${subject}`,
      `Regulators have found evidence of fraud involving ${subject}`,
    ],
  },
  {
    pattern: /^(.+?)\s+(?:caused?|leads?\s+to|results?\s+in|responsible\s+for)\s+(.+?)\.?\s*$/i,
    template: (cause, effect) => [
      `There is a plausible causal mechanism by which ${cause} leads to ${effect}`,
      `${effect} has been documented or observed`,
      `Alternative explanations for ${effect} have been considered`,
      `The timeline supports ${cause} causing ${effect}`,
    ],
  },
  {
    pattern: /^(.+?)\s+(?:has|have|had|generates?|reported?|earned?)\s+(.+?(?:revenue|sales|income|earnings|profit))\b.*$/i,
    template: (subject) => [
      `${subject} financial filings support the claimed revenue figures`,
      `Independent auditors have verified ${subject} financial statements`,
      `${subject} revenue is consistent with industry and competitor benchmarks`,
      `${subject} revenue trends are internally consistent over time`,
    ],
  },
  {
    pattern: /^(.+?)\s+(?:is|are)\s+(?:effective|reliable|accurate|efficient)\b(?:\s+(?:for|at|in)\s+(.+?))?\.?\s*$/i,
    template: (subject, context) => {
      const ctx = context || 'its intended purpose';
      return [
        `${subject} has demonstrated measurable effectiveness for ${ctx}`,
        `Independent evaluations confirm ${subject} performs as claimed`,
        `${subject} compares favorably to alternatives for ${ctx}`,
        `Users or stakeholders report positive outcomes from ${subject}`,
      ];
    },
  },
  {
    pattern: /^(.+?)\s+(?:is|are)\s+(?:dangerous|harmful|toxic|risky|unsafe)\b(?:\s+(?:for|to)\s+(.+?))?\.?\s*$/i,
    template: (subject, target) => {
      const who = target || 'affected populations';
      return [
        `${subject} has documented cases of harm to ${who}`,
        `Scientific or regulatory evidence links ${subject} to negative outcomes`,
        `${subject} risk level exceeds accepted safety thresholds`,
        `Alternatives to ${subject} present lower risk to ${who}`,
      ];
    },
  },
  {
    pattern: /^(.+?)\s+(?:is|are|was|were|has been|have been)\s+(?:growing|declining|increasing|decreasing|expanding|shrinking)\b(?:\s+(.+?))?\.?\s*$/i,
    template: (subject, context) => {
      const where = context ? ` ${context}` : '';
      return [
        `Quantitative data confirms ${subject} is changing${where}`,
        `${subject} trend is consistent with industry and market conditions`,
        `Expert analysis supports the claimed direction of ${subject} change`,
      ];
    },
  },
  {
    // Generic fallback: "[X] is/are [predicate]" — broad catch-all for unmatched claim shapes
    pattern: /^(.+?)\s+(?:is|are|was|were|has|have)\s+(.{10,}?)\.?\s*$/i,
    template: (subject, predicate) => [
      `Evidence supports that ${subject} is ${predicate}`,
      `Independent sources corroborate that ${subject} is ${predicate}`,
      `Counter-evidence exists challenging whether ${subject} is ${predicate}`,
    ],
  },
];

export class ClaimExtractor {
  /**
   * Extract verifiable claims from raw text.
   * @param {string} text
   * @returns {Array} Claim objects sorted by verifiability score descending.
   */
  extract(text) {
    if (!text || typeof text !== 'string') return [];

    const sentences = splitSentences(text);
    const scored = [];

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length < 15) continue;
      if (QUESTION_PATTERN.test(trimmed)) continue;
      if (OPINION_ONLY.test(trimmed)) continue;
      if (DEFINITION_PATTERN.test(trimmed)) continue;

      const score = scoreVerifiability(trimmed);
      if (score > 0.2) {
        scored.push({ text: trimmed, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const claims = scored.map(s => {
      const claim = createClaim(s.text);
      claim.verifiabilityScore = s.score;
      return claim;
    });

    // For concise inputs, ensure the primary claim is always present and
    // decompose into investigable sub-claims (dimensions).
    // Short claim-like inputs (e.g. "X is safe for Y") legitimately score
    // low on the entity/number heuristics above, but they ARE the claim.
    const trimmedInput = text.trim();
    if (trimmedInput.length < 500) {
      // Normalize question-form inputs ("Is X safe for Y?") to statements
      // so decomposition patterns can match them.
      const normalized = QUESTION_PATTERN.test(trimmedInput)
        ? this._normalizeQuestionToStatement(trimmedInput)
        : null;
      const claimText = normalized || trimmedInput;

      if (!claims.find(c => c.text === claimText) &&
          claimText.length >= 15 &&
          !QUESTION_PATTERN.test(claimText) &&
          !OPINION_ONLY.test(claimText)) {
        const primary = createClaim(claimText);
        primary.verifiabilityScore = Math.max(0.4, scoreVerifiability(claimText));
        claims.unshift(primary);
      }

      const decomposed = this._decomposeIntoDimensions(claimText);
      for (const subText of decomposed) {
        if (!claims.find(c => c.text === subText)) {
          const sub = createClaim(subText);
          sub.verifiabilityScore = 0.6;
          sub.parentText = claims[0]?.text || claimText;
          claims.push(sub);
        }
      }
    }

    log('debug', `claims: extracted ${claims.length} from ${sentences.length} sentences`);
    return claims;
  }

  /**
   * Extract claims from evidence summary objects.
   * Useful for second-pass extraction from gathered evidence.
   * @param {Array} evidenceItems — objects with a .summary field
   * @returns {Array} Claim objects
   */
  extractFromEvidence(evidenceItems, query = '') {
    if (!Array.isArray(evidenceItems)) return [];

    const allClaims = [];
    const queryTerms = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    for (const e of evidenceItems) {
      const text = e.summary || e.text || '';
      if (!text) continue;

      // Relevance filter: only extract from evidence that shares terms with the query
      if (queryTerms.length > 0) {
        const lower = text.toLowerCase();
        const overlap = queryTerms.filter(t => lower.includes(t)).length;
        if (overlap === 0) continue;
      }

      const claims = this.extract(text);
      for (const c of claims.slice(0, 3)) {
        if (!allClaims.find(existing => existing.text === c.text)) {
          allClaims.push(c);
        }
      }
    }

    return allClaims.sort((a, b) => b.verifiabilityScore - a.verifiabilityScore).slice(0, 30);
  }

  /**
   * Decompose a claim into dimensional sub-claims using pattern matching.
   * E.g. "[X] is safe" → safety record, regulatory status, tech reliability, consumer experience.
   */
  _decomposeIntoDimensions(text) {
    for (const { pattern, template } of DECOMPOSITION_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const args = match.slice(1).map(s => s ? s.trim() : undefined);
        return template(...args);
      }
    }
    return [];
  }

  /**
   * Convert question-form input to a statement so decomposition patterns
   * can match it. "Is Tesla FSD safe for public roads?" → "Tesla FSD is safe for public roads"
   */
  _normalizeQuestionToStatement(text) {
    const PREDICATE_ADJECTIVES = /\b(safe|dangerous|harmful|toxic|risky|unsafe|fraudulent|deceptive|corrupt|effective|reliable|accurate|efficient|growing|declining|increasing|decreasing|expanding|shrinking)\b/i;

    const m = text.match(/^(Is|Are|Was|Were|Has|Have|Does|Do)\s+(.+?)\s*\?\s*$/i);
    if (!m) return null;

    const verb = m[1].toLowerCase();
    const rest = m[2];

    // "Is [subject] [adjective] (for/to [context])?" → "[subject] is [adjective] (for/to [context])"
    const adjMatch = rest.match(PREDICATE_ADJECTIVES);
    if (adjMatch) {
      const idx = rest.indexOf(adjMatch[0]);
      const subject = rest.substring(0, idx).trim();
      const predicate = rest.substring(idx).trim();
      if (subject.length > 0) {
        return `${subject} ${verb} ${predicate}`;
      }
    }

    // "Has [subject] caused [effect]?" → "[subject] has caused [effect]"
    const causalMatch = rest.match(/^(.+?)\s+(caused?|led\s+to|resulted?\s+in)\s+(.+)$/i);
    if (causalMatch) {
      return `${causalMatch[1]} ${verb} ${causalMatch[2]} ${causalMatch[3]}`;
    }

    // Fallback: "Does X have Y?" → "X has Y"
    const fallbackVerbs = { does: 'does', do: 'do', has: 'has', have: 'have', is: 'is', are: 'are', was: 'was', were: 'were' };
    return `${rest} ${fallbackVerbs[verb] || verb}`;
  }
}

/**
 * Split text into sentences, respecting abbreviations.
 * Handles: Mr., Dr., Inc., U.S., etc.
 */
function splitSentences(text) {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n');
  const results = [];
  let current = '';

  const tokens = normalized.split(/(?<=\.|\?|!)\s+/);

  for (const token of tokens) {
    current += (current ? ' ' : '') + token;

    if (/[.!?]\s*$/.test(current)) {
      const lastWord = current.match(/(\w+)\.\s*$/);
      if (lastWord && ABBREVIATIONS.has(lastWord[1].toLowerCase())) {
        continue;
      }
      results.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    results.push(current.trim());
  }

  return results;
}

/**
 * Score a sentence on verifiability (0–1).
 *
 * Components:
 *  - has named entity  (+0.30)
 *  - has number/date   (+0.25)
 *  - has assertion verb (+0.15)
 *  - has causal lang    (+0.15)
 *  - sentence length    (+0.05 if > 40 chars, +0.10 if > 80)
 */
function scoreVerifiability(sentence) {
  let score = 0;

  if (NAMED_ENTITY_PATTERN.test(sentence)) score += 0.30;
  if (NUMBER_PATTERN.test(sentence)) score += 0.25;
  if (DATE_PATTERN.test(sentence)) score += 0.15;
  if (ASSERTION_MARKERS.test(sentence)) score += 0.15;
  if (CAUSAL_MARKERS.test(sentence)) score += 0.15;
  if (sentence.length > 80) score += 0.10;
  else if (sentence.length > 40) score += 0.05;

  return Math.min(score, 1.0);
}
