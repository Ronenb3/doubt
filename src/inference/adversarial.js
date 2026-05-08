/**
 * doubt — Adversarial Hypothesis Engine
 *
 * Computational Popperian falsification.
 *
 * Every other verification system asks: "Is there evidence FOR this claim?"
 * This engine asks: "What is the strongest possible argument AGAINST this
 * claim — and does it survive?"
 *
 * Karl Popper's core insight was that science doesn't advance by confirmation.
 * A million white swans don't prove "all swans are white." One black swan
 * destroys it. Confirmation bias is the default mode of human cognition —
 * we seek what agrees with us. The adversarial engine is the antidote.
 *
 * For every claim, we generate structured counter-hypotheses using five
 * inversion strategies:
 *
 *   NEGATION      — "X is true"          → "X is false"
 *   ALTERNATIVE   — "X caused Y"         → "Z caused Y instead"
 *   SCALE         — "X is $2B"           → "X is significantly different"
 *   TEMPORAL      — "X happened in 2020" → "X happened at a different time"
 *   ATTRIBUTION   — "Person A did X"     → "Person B did X"
 *
 * Then we check: does the gathered evidence support any of these counter-
 * hypotheses? If yes — the original claim is weakened. If no — the claim
 * has survived a structured attempt to destroy it, and that survival is
 * worth more than a hundred confirming sources.
 *
 * This is not a feature. This is the system's conscience.
 */

import { createClaim, ClaimStatus, EvidenceType } from '../core/schema.js';
import { getConfig, log } from '../core/config.js';

// ─── Inversion Strategies ───────────────────────────────────

const Strategy = Object.freeze({
  NEGATION:    'negation',
  ALTERNATIVE: 'alternative',
  SCALE:       'scale',
  TEMPORAL:    'temporal',
  ATTRIBUTION: 'attribution',
});

// ─── Claim Structure Patterns ───────────────────────────────

// Don't match bare 4-digit years as "amounts" — those are dates, not quantities
const AMOUNT_PATTERN = /\$\s*([\d,]+\.?\d*)\s*(billion|million|trillion|thousand|%|percent|B|M|K|T)?|([\d,]+\.?\d+)\s*(billion|million|trillion|thousand|%|percent|B|M|K|T)/gi;
const DATE_PATTERN = /\b((?:19|20)\d{2}|Q[1-4]\s*\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4})\b/gi;
const NAMED_ENTITY_PATTERN = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
const CAUSAL_PATTERN = /\b(caused|led to|resulted in|because of|due to|triggered|produced|created|drove)\b/i;
const EXISTENCE_PATTERN = /\b(exists?|has|had|owns?|operates?|runs?|employs?|maintains?|holds?)\b/i;

// ─── Claim Type Detection ───────────────────────────────────
// Topic queries (keyword-salad search terms) vs. factual assertions
// (proper sentences with subjects, verbs, and claims)
const ASSERTION_VERBS = /\b(is|are|was|were|has|have|had|does|did|will|would|can|could|should|may|might|confirmed|denied|reported|alleged|claimed|stated|announced|declared|revealed|showed|proved|found|discovered|increased|decreased|rose|fell|dropped|grew|declined|signed|violated|breached|complied|agreed|rejected|approved|blocked|sanctioned|enriched|developed|deployed|launched|acquired|sold|purchased|invested|funded|transferred|operated|produced|manufactured|exported|imported|supplied|delivered)\b/i;

function isTopicQuery(text) {
  if (!text || text.length < 10) return true;
  // Topic queries are usually short keyword clusters without sentence structure
  const words = text.trim().split(/\s+/);
  // Very short = topic keyword
  if (words.length <= 4) return true;
  // No assertion verb = topic, not a claim
  if (!ASSERTION_VERBS.test(text)) return true;
  // If it reads like a search query (all caps words, no periods, mostly nouns)
  const capsWords = words.filter(w => /^[A-Z]{2,}$/.test(w)).length;
  if (capsWords > words.length * 0.3) return true;
  return false;
}

const CAUSAL_VERBS = [
  'caused', 'led to', 'resulted in', 'triggered', 'produced',
  'created', 'drove', 'sparked', 'prompted', 'enabled',
];

export class AdversarialEngine {
  constructor() {
    this._strategies = [
      { id: Strategy.NEGATION,    generate: this._generateNegation.bind(this) },
      { id: Strategy.ALTERNATIVE, generate: this._generateAlternative.bind(this) },
      { id: Strategy.SCALE,       generate: this._generateScale.bind(this) },
      { id: Strategy.TEMPORAL,    generate: this._generateTemporal.bind(this) },
      { id: Strategy.ATTRIBUTION, generate: this._generateAttribution.bind(this) },
    ];
    const llmCfg = getConfig().llm || {};
    this._ollamaAvailable = (!!llmCfg.enabled && llmCfg.enabled !== 'false') ? null : false;
  }

  /**
   * Check if Ollama is available for LLM-powered adversarial generation.
   */
  async _checkOllama() {
    if (this._ollamaAvailable !== null) return this._ollamaAvailable;
    try {
      const resp = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) });
      this._ollamaAvailable = resp.ok;
    } catch { this._ollamaAvailable = false; }
    return this._ollamaAvailable;
  }

  /**
   * LLM-powered adversarial generation: ask the model to generate the
   * strongest possible counter-arguments against a claim. This produces
   * far more sophisticated counter-hypotheses than regex inversion.
   */
  async _generateLLMCounters(claim) {
    const text = claim.text || '';
    if (text.length < 15) return [];

    try {
      const prompt = `You are a senior intelligence analyst playing devil's advocate. Your job is to find the STRONGEST possible counter-arguments against a claim — arguments that are plausible, specific, and grounded in reality.

CLAIM: "${text}"

Generate 2-3 counter-hypotheses. Each must be:
- A specific, falsifiable assertion that an informed skeptic would raise
- Grounded in real-world facts (not just negating the claim with "not")
- Different from each other — each should attack a different assumption
- The kind of argument that would appear in a professional intelligence assessment

BAD examples (do NOT generate these):
- "It is not the case that X" — this is just negation, not a counter-argument
- "X is false" — too vague
- "The sources are wrong" — not specific or falsifiable

GOOD examples:
- "The enrichment data cited by IAEA may reflect civilian power generation, not weapons development"
- "Historical precedent suggests that countries at this stage often negotiate rather than weaponize"
- "The intelligence community has a documented history of overestimating nuclear capabilities (cf. Iraq 2003)"

Return ONLY a JSON array: [{"text": "counter-hypothesis", "strategy": "alternative|scale|temporal|attribution|methodological"}]
No commentary, no markdown — just the JSON array.`;

      const resp = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3', prompt, stream: false }),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) return [];
      const data = await resp.json();
      const raw = (data.response || '').trim();

      // Extract JSON array from response
      const arrMatch = raw.match(/\[[\s\S]*\]/);
      if (!arrMatch) return [];

      const arr = JSON.parse(arrMatch[0]);
      if (!Array.isArray(arr)) return [];

      return arr
        .filter(h => h && typeof h.text === 'string' && h.text.length > 10)
        .slice(0, 3)
        .map(h => ({
          text: h.text,
          strategy: h.strategy || 'llm_adversarial',
          expectedEvidence: ['expert_analysis', 'contradicting_records', 'alternative_sources'],
        }));
    } catch (err) {
      log('debug', `LLM adversarial generation failed: ${err.message}`);
      return [];
    }
  }

  /**
   * For each claim, generate 1-3 counter-hypotheses via structural inversion.
   *
   * The logic: parse the claim's structure, identify what KIND of assertion
   * it makes, then systematically invert it. A claim about revenue gets a
   * scale attack. A claim about causation gets an alternative-cause attack.
   * Every claim gets at least a negation attack — because if "not X" is
   * well-supported, then X is in serious trouble.
   */
  async generateCounterHypotheses(claims) {
    const allCounters = [];
    const useOllama = await this._checkOllama();

    for (const claim of claims) {
      const text = claim.text || '';
      const counters = [];
      const isTopic = isTopicQuery(text);

      for (const strategy of this._strategies) {
        // Skip SCALE and TEMPORAL for topic queries — they produce nonsense
        // like "Iran nuclear a significantly different figure than 2025"
        if (isTopic && (strategy.id === Strategy.SCALE || strategy.id === Strategy.TEMPORAL)) {
          continue;
        }
        const hypothesis = strategy.generate(text, claim);
        if (hypothesis) {
          counters.push({
            id: `counter_${claim.id}_${strategy.id}`,
            text: hypothesis.text,
            strategy: strategy.id,
            originalClaimId: claim.id,
            originalClaimText: text,
            expectedEvidence: hypothesis.expectedEvidence || [],
            score: 0,
            evidenceFor: [],
            evidenceAgainst: [],
          });
        }
      }

      // Every claim gets at least a negation. If the specific strategies
      // didn't produce anything, the negation is the minimal attack surface.
      if (counters.length === 0) {
        counters.push({
          id: `counter_${claim.id}_negation_fallback`,
          text: `It is not the case that: ${text}`,
          strategy: Strategy.NEGATION,
          originalClaimId: claim.id,
          originalClaimText: text,
          expectedEvidence: ['contradicting_statements', 'official_denials'],
          score: 0,
          evidenceFor: [],
          evidenceAgainst: [],
        });
      }

      // LLM adversarial: generate sophisticated counter-hypotheses that
      // regex patterns can't produce. This is the real Popperian engine.
      if (useOllama && counters.length < 3) {
        try {
          const llmCounters = await this._generateLLMCounters(claim);
          for (const lc of llmCounters) {
            // Don't duplicate strategies already generated
            if (counters.some(c => c.strategy === lc.strategy)) continue;
            counters.push({
              id: `counter_${claim.id}_llm_${lc.strategy}`,
              text: lc.text,
              strategy: `llm_${lc.strategy}`,
              originalClaimId: claim.id,
              originalClaimText: text,
              expectedEvidence: lc.expectedEvidence || [],
              score: 0,
              evidenceFor: [],
              evidenceAgainst: [],
            });
          }
        } catch (err) {
          log('debug', `LLM adversarial failed for claim ${claim.id}: ${err.message}`);
        }
      }

      // Cap at 4 per claim — LLM can produce higher quality, allow one extra
      allCounters.push(...counters.slice(0, 4));
    }

    log('info', `Generated ${allCounters.length} counter-hypotheses for ${claims.length} claims`);
    return allCounters;
  }

  /**
   * Evaluate counter-hypotheses against gathered evidence.
   *
   * For each counter-hypothesis, scan the evidence set for signals that
   * support it. The key insight: we're not looking for evidence that
   * DISPROVES the original claim (that's the contradiction engine's job).
   * We're looking for evidence that makes the ALTERNATIVE explanation
   * plausible. These are different things.
   *
   * "Company X has $2B revenue" could be contradicted by "$1B revenue."
   * But the adversarial alternative "Company X is significantly smaller
   * than claimed" is SUPPORTED by evidence like: small office, few
   * employees, no SEC filing, limited press coverage. None of those
   * directly contradict the revenue number, but together they make
   * the counter-hypothesis compelling.
   */
  evaluateCounterHypotheses(counterHypotheses, evidence) {
    const evaluated = [];

    for (const counter of counterHypotheses) {
      const counterTerms = extractKeyTerms(counter.text);
      const originalTerms = extractKeyTerms(counter.originalClaimText);
      let supportScore = 0;
      let undermineScore = 0;
      let totalWeight = 0;
      const evidenceFor = [];
      const evidenceAgainst = [];

      // Detect negation-style counters: high term overlap = same keywords, opposite meaning.
      // These require NLI stance to distinguish support from undermine.
      const negationOverlap = termOverlap(counterTerms, originalTerms);
      const isNegationStyle = negationOverlap > 0.5 || counter.strategy === 'negation';

      for (const e of evidence) {
        const eSummary = (e.summary || '').toLowerCase();
        const eTerms = extractKeyTerms(eSummary);
        const weight = e.trustWeight || 0.5;

        // Does this evidence align with the counter-hypothesis?
        const counterRelevance = termOverlap(counterTerms, eTerms);
        const originalRelevance = termOverlap(originalTerms, eTerms);

        if (counterRelevance < 0.05 && originalRelevance < 0.05) continue;
        totalWeight += weight;

        if (e.type === EvidenceType.CONTRADICTS) {
          // Evidence that contradicts the ORIGINAL claim supports the counter
          supportScore += weight * 0.8;
          evidenceFor.push(e.id);
        } else if (e.type === EvidenceType.SUPPORTS && originalRelevance > 0.1) {
          // Evidence that supports the original undermines the counter
          undermineScore += weight * 0.6;
          evidenceAgainst.push(e.id);
        } else if (isNegationStyle) {
          // For negation-style counters: NEUTRAL and CONTEXTUAL evidence
          // should not count as support — the keywords are identical.
          // Slightly undermine the counter (existence of relevant neutral evidence
          // suggests the topic is well-documented, making wild negations less plausible).
          undermineScore += weight * 0.1;
        }

        // Check if counter-hypothesis expected evidence types are present
        if (counter.expectedEvidence.length > 0) {
          const hasExpected = counter.expectedEvidence.some(expected =>
            eSummary.includes(expected.toLowerCase?.() || expected) ||
            (e.connectorId || '').includes(expected)
          );
          if (hasExpected) {
            // For negation counters, expected evidence is unreliable (same keywords)
            // so weight it much lower
            const eeWeight = isNegationStyle ? 0.05 : 0.3;
            supportScore += weight * eeWeight;
            if (!evidenceFor.includes(e.id)) evidenceFor.push(e.id);
          }
        }
      }

      // Normalize to 0-1: how well-supported is this counter-hypothesis?
      // A score of 0.0 means no evidence for the counter.
      // A score of 1.0 means overwhelming evidence for the counter.
      const rawScore = totalWeight > 0
        ? supportScore / (supportScore + undermineScore + 0.5)
        : 0;

      evaluated.push({
        ...counter,
        score: clamp(rawScore),
        evidenceFor,
        evidenceAgainst,
        supportWeight: round(supportScore),
        undermineWeight: round(undermineScore),
      });
    }

    evaluated.sort((a, b) => b.score - a.score);
    return evaluated;
  }

  /**
   * Generate a Red Team Brief: the strongest possible case AGAINST
   * the investigation's conclusions.
   *
   * This is what an adversarial attorney would present. Not strawmen —
   * steelmen. The best version of the counter-argument, supported by
   * the best available evidence.
   */
  generateRedTeamBrief(claims, counterHypotheses, evidence) {
    const evaluated = Array.isArray(counterHypotheses[0]?.score !== undefined)
      ? counterHypotheses
      : this.evaluateCounterHypotheses(counterHypotheses, evidence);

    // Select the top 3 most-supported counter-hypotheses
    const topCounters = evaluated
      .filter(c => c.score > 0.1)
      .slice(0, 3);

    if (topCounters.length === 0) {
      return {
        strength: 0,
        arguments: [],
        summary: 'No counter-hypotheses found sufficient evidentiary support. ' +
          'The investigation\'s conclusions survived all adversarial challenges.',
      };
    }

    const args = topCounters.map(counter => {
      const original = claims.find(c => c.id === counter.originalClaimId);
      const supportingEvidence = evidence.filter(e =>
        counter.evidenceFor.includes(e.id)
      );

      const implications = deriveImplications(counter, original, claims);

      return {
        counterHypothesis: counter.text,
        strategy: counter.strategy,
        attackedClaim: counter.originalClaimText,
        score: counter.score,
        supportingEvidence: supportingEvidence.map(e => ({
          id: e.id,
          summary: e.summary,
          source: e.connectorId,
          trust: e.trustWeight,
        })),
        reasoning: buildCounterReasoning(counter, supportingEvidence),
        implications,
      };
    });

    // Overall strength: weighted average of top counter-scores,
    // with emphasis on the strongest argument
    const weights = [0.5, 0.3, 0.2].slice(0, args.length);
    const strength = args.reduce((sum, arg, i) =>
      sum + arg.score * (weights[i] || 0.1), 0
    );

    const summary = synthesizeBriefSummary(args, strength);

    return {
      strength: clamp(strength),
      arguments: args,
      summary,
    };
  }

  /**
   * The Attack Survival Score.
   *
   * 1.0 = every counter-hypothesis was demolished. The conclusions
   *        survived structured adversarial challenge.
   * 0.0 = at least one counter-hypothesis is as well-supported as
   *        the original claim. The investigation is fragile.
   *
   * This score is epistemically more meaningful than raw confidence.
   * A claim can have 90% Bayesian confidence from 50 news articles
   * and still score 0.3 here if a single counter-hypothesis is
   * strongly supported by a primary document.
   */
  attackScore(claims, counterHypotheses) {
    if (counterHypotheses.length === 0) return 1.0;

    // For each original claim, find the strongest counter-attack
    const claimAttacks = new Map();
    for (const counter of counterHypotheses) {
      const existing = claimAttacks.get(counter.originalClaimId);
      if (!existing || counter.score > existing.score) {
        claimAttacks.set(counter.originalClaimId, counter);
      }
    }

    if (claimAttacks.size === 0) return 1.0;

    // The attack score is (1 - max counter-score), weighted by
    // claim importance. A keystone claim under attack drags the
    // score down harder than a peripheral claim.
    let totalWeight = 0;
    let weightedSurvival = 0;

    for (const claim of claims) {
      const attack = claimAttacks.get(claim.id);
      const claimWeight = claim.isKeystone ? 3.0 : 1.0;
      totalWeight += claimWeight;

      if (attack) {
        // Survival = how poorly the counter-hypothesis fared
        const survival = 1.0 - attack.score;
        weightedSurvival += survival * claimWeight;
      } else {
        // No counter-hypothesis = perfect survival for this claim
        weightedSurvival += 1.0 * claimWeight;
      }
    }

    return round(clamp(weightedSurvival / totalWeight));
  }

  // ─── Inversion Strategy Implementations ─────────────────────

  /**
   * Negation: the simplest and most universal attack.
   * If the claim says something IS, the counter says it ISN'T.
   */
  _generateNegation(text, claim) {
    const lower = text.toLowerCase();

    // Direct negation patterns
    const affirmatives = [
      { pattern: /\bis\b/i,            replacement: 'is not' },
      { pattern: /\bhas\b/i,           replacement: 'does not have' },
      { pattern: /\bhad\b/i,           replacement: 'did not have' },
      { pattern: /\bwas\b/i,           replacement: 'was not' },
      { pattern: /\bwere\b/i,          replacement: 'were not' },
      { pattern: /\bdoes\b/i,          replacement: 'does not' },
      { pattern: /\bdid\b/i,           replacement: 'did not' },
      { pattern: /\bcan\b/i,           replacement: 'cannot' },
      { pattern: /\bwill\b/i,          replacement: 'will not' },
      { pattern: /\bconfirmed\b/i,     replacement: 'did not confirm' },
    ];

    for (const { pattern, replacement } of affirmatives) {
      if (pattern.test(text)) {
        return {
          text: text.replace(pattern, replacement),
          expectedEvidence: ['official_denials', 'contradicting_records'],
        };
      }
    }

    return {
      text: `It is not the case that: ${text}`,
      expectedEvidence: ['contradicting_statements'],
    };
  }

  /**
   * Alternative cause: if the claim asserts "X caused Y," the counter
   * proposes "Z caused Y instead." This is critical for investigations
   * that rely on causal narratives.
   */
  _generateAlternative(text, claim) {
    if (!CAUSAL_PATTERN.test(text)) return null;

    const causalMatch = text.match(
      /(.+?)\s+(caused|led to|resulted in|triggered|produced|created|drove)\s+(.+?)(?:\.|$)/i
    );
    if (!causalMatch) return null;

    const [, cause, verb, effect] = causalMatch;
    return {
      text: `An unidentified or different factor, not ${cause.trim()}, ${verb} ${effect.trim()}`,
      expectedEvidence: [
        'alternative_explanations',
        'expert_analysis',
        'historical_precedent',
      ],
    };
  }

  /**
   * Scale attack: if the claim involves a specific quantity, the counter
   * proposes the real number is significantly different. "$2B revenue"
   * becomes "The stated figure of $2B may be inaccurate."
   */
  _generateScale(text, claim) {
    const amounts = [...text.matchAll(AMOUNT_PATTERN)];
    if (amounts.length === 0) return null;

    const firstAmount = amounts[0][0];
    // Build a clean counter-hypothesis as a standalone sentence
    return {
      text: `The stated figure of ${firstAmount} in this claim is inaccurate — the actual number may be significantly higher or lower`,
      expectedEvidence: [
        'financial_filings',
        'independent_audits',
        'regulatory_disclosures',
      ],
    };
  }

  /**
   * Temporal attack: if the claim pins an event to a time, the counter
   * proposes it happened at a different time. Timelines are often the
   * first thing to crack in a false narrative.
   */
  _generateTemporal(text, claim) {
    const dates = [...text.matchAll(DATE_PATTERN)];
    if (dates.length === 0) return null;

    const firstDate = dates[0][0];
    // Build a clean counter-hypothesis as a standalone sentence
    return {
      text: `The timeline is wrong: the events described did not occur in ${firstDate} — they happened at a materially different time, which changes the causal sequence`,
      expectedEvidence: [
        'dated_documents',
        'timestamped_records',
        'archived_filings',
      ],
    };
  }

  /**
   * Attribution attack: if the claim attributes an action to a person
   * or entity, the counter proposes a different actor. Mis-attribution
   * is one of the most common forms of false narrative.
   */
  _generateAttribution(text, claim) {
    const entities = [...text.matchAll(NAMED_ENTITY_PATTERN)];
    if (entities.length === 0) return null;

    const primaryEntity = entities[0][0];
    const actionMatch = text.match(
      new RegExp(`${escapeRegex(primaryEntity)}\\s+(\\w+(?:ed|s|ing))\\b`, 'i')
    );

    if (actionMatch) {
      return {
        text: `${primaryEntity} did not ${actionMatch[1].replace(/ed$/, '').replace(/s$/, '')} this, or a different party was responsible`,
        expectedEvidence: [
          'attribution_records',
          'witness_statements',
          'corporate_filings',
        ],
      };
    }

    return {
      text: `${primaryEntity}'s role in this is misattributed or overstated`,
      expectedEvidence: ['corporate_filings', 'personnel_records'],
    };
  }
}

// ─── Internal Utilities ───────────────────────────────────────

function extractKeyTerms(text) {
  if (!text) return new Set();
  const stopwords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'that', 'this', 'it', 'not', 'and',
    'or', 'but', 'if', 'as', 'its', 'than', 'into', 'also', 'about',
  ]);
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  return new Set(words.filter(w => w.length > 2 && !stopwords.has(w)));
}

function termOverlap(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const term of setA) {
    if (setB.has(term)) overlap++;
  }
  return overlap / Math.max(setA.size, setB.size);
}

function buildCounterReasoning(counter, supportingEvidence) {
  if (supportingEvidence.length === 0) {
    return `The counter-hypothesis "${counter.text}" lacks direct evidentiary support, ` +
      `but warrants consideration as an alternative framing.`;
  }

  const sourceTypes = supportingEvidence.map(e => e.connectorId || 'unknown');
  const uniqueSources = [...new Set(sourceTypes)];
  const highTrust = supportingEvidence.filter(e => (e.trustWeight || 0) >= 0.7);

  let reasoning = `This counter-hypothesis is supported by ${supportingEvidence.length} ` +
    `piece${supportingEvidence.length === 1 ? '' : 's'} of evidence from ` +
    `${uniqueSources.length} source${uniqueSources.length === 1 ? '' : 's'}.`;

  if (highTrust.length > 0) {
    reasoning += ` Notably, ${highTrust.length} of these are from high-trust sources ` +
      `(trust >= 0.7), giving this counter-argument substantial weight.`;
  }

  return reasoning;
}

function deriveImplications(counter, originalClaim, allClaims) {
  const implications = [];

  if (originalClaim?.isKeystone) {
    const dependents = allClaims.filter(c =>
      (c.dependsOn || []).includes(originalClaim.id)
    );
    implications.push(
      `If this counter-hypothesis holds, it undermines a keystone claim. ` +
      `${dependents.length} dependent claim${dependents.length === 1 ? '' : 's'} ` +
      `would also be compromised.`
    );
  }

  if (counter.strategy === Strategy.SCALE) {
    implications.push(
      'If the actual figures differ significantly, all derivative calculations ' +
      '(growth rates, valuations, comparisons) built on the original number are unreliable.'
    );
  }

  if (counter.strategy === Strategy.ATTRIBUTION) {
    implications.push(
      'If attribution is incorrect, the entire causal narrative may need restructuring ' +
      'around a different actor or set of actors.'
    );
  }

  if (counter.strategy === Strategy.TEMPORAL) {
    implications.push(
      'If the timeline is wrong, sequence-dependent conclusions (cause before effect, ' +
      'motive before action) may be invalidated.'
    );
  }

  if (implications.length === 0) {
    implications.push(
      `If "${counter.text}" is true, the original claim requires significant revision ` +
      `or retraction.`
    );
  }

  return implications;
}

function synthesizeBriefSummary(args, strength) {
  if (args.length === 0) {
    return 'No viable counter-arguments were identified.';
  }

  const strongest = args[0];
  const qualifier = strength > 0.6 ? 'seriously'
    : strength > 0.3 ? 'meaningfully'
    : 'marginally';

  let summary = `The investigation's conclusions are ${qualifier} challenged. `;
  summary += `The strongest counter-argument (score: ${round(strongest.score)}) `;
  summary += `uses a ${strongest.strategy} inversion: "${strongest.counterHypothesis}" `;

  if (strongest.supportingEvidence.length > 0) {
    summary += `This is backed by ${strongest.supportingEvidence.length} piece` +
      `${strongest.supportingEvidence.length === 1 ? '' : 's'} of evidence. `;
  }

  if (args.length > 1) {
    summary += `${args.length - 1} additional counter-argument` +
      `${args.length > 2 ? 's' : ''} also warrant attention.`;
  }

  return summary;
}

function clamp(n, min = 0, max = 1) {
  return Math.max(min, Math.min(max, n));
}

function round(n, places = 4) {
  return Math.round(n * 10 ** places) / 10 ** places;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default AdversarialEngine;
