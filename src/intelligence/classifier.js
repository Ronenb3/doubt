/**
 * doubt — Evidence Stance Classifier
 *
 * The single most important fix in the pipeline.
 *
 * Problem: all evidence enters as EvidenceType.NEUTRAL, so the Bayesian
 * engine never shifts alpha or beta — every claim sits at 50%.
 *
 * Solution: for each piece of evidence, determine whether it SUPPORTS,
 * CONTRADICTS, or provides CONTEXTUAL background relative to a claim.
 *
 * No LLM. Pure heuristic keyword/pattern matching with sentiment analysis,
 * claim-direction detection, and confidence scoring.
 */

import { EvidenceType } from '../core/schema.js';
import { log } from '../core/config.js';

// ─── Signal Lexicons ─────────────────────────────────────

const POSITIVE_SIGNALS = [
  'safe', 'safety record', 'improvement', 'improved', 'milestone',
  'approved', 'passed', 'certified', 'compliant', 'compliance',
  'reduced accidents', 'fewer crashes', 'better than human',
  'advanced', 'reliable', 'reliability', 'successful', 'success',
  'progress', 'innovation', 'innovative', 'breakthrough',
  'achievement', 'exceeded expectations', 'outperformed',
  'growth', 'revenue growth', 'profitable', 'profit',
  'awarded', 'patent granted', 'cleared', 'authorized',
  'confirmed', 'verified', 'validated', 'proven', 'effective',
  'endorsed', 'recommended', 'upgraded', 'expanding',
];

const NEGATIVE_SIGNALS = [
  'crash', 'crashed', 'accident', 'fatal', 'fatality', 'death',
  'died', 'killed', 'injury', 'injured', 'recall', 'recalled',
  'defect', 'defective', 'investigation', 'probe', 'investigating',
  'lawsuit', 'sued', 'litigation', 'unsafe', 'dangerous',
  'failed', 'failure', 'violation', 'penalty', 'fine', 'fined',
  'warning', 'warned', 'banned', 'suspended', 'suspension',
  'misleading', 'fraud', 'fraudulent', 'deceptive', 'deception',
  'indicted', 'charged', 'convicted', 'alleged', 'allegations',
  'whistleblower', 'coverup', 'cover-up', 'concealed',
  'bankruptcy', 'insolvent', 'default', 'downgrade', 'downgraded',
  'terminated', 'revoked', 'censured', 'sanctioned',
  'contaminated', 'toxic', 'hazardous', 'carcinogenic',
  'collapsed', 'plummeted', 'lost', 'losses', 'decline', 'declined',
];

const CONTEXTUAL_SIGNALS = [
  'industry', 'sector', 'market overview', 'regulatory framework',
  'background', 'history', 'historical', 'competitor', 'compared to',
  'according to analysts', 'market cap', 'founded in', 'headquartered',
  'general', 'overview', 'typically', 'standard', 'benchmark',
  'average', 'median', 'peers', 'peer group',
];

// Claim direction patterns: what is the claim asserting?
const POSITIVE_CLAIM_PATTERNS = [
  /\b(?:is|are)\s+safe\b/i,
  /\bsafety\b/i,
  /\beffective\b/i,
  /\bsuccess(?:ful)?\b/i,
  /\bprofitable\b/i,
  /\bgrow(?:th|ing)\b/i,
  /\breliable\b/i,
  /\bcompliant\b/i,
  /\bapproved\b/i,
  /\blegitimate\b/i,
  /\bbeneficial\b/i,
  /\bimproved?\b/i,
  /\badvanced?\b/i,
  /\binnovati(?:ve|on)\b/i,
];

const NEGATIVE_CLAIM_PATTERNS = [
  /\bfraud(?:ulent)?\b/i,
  /\bscam\b/i,
  /\bunsafe\b/i,
  /\bdangerous\b/i,
  /\bcorrupt(?:ion)?\b/i,
  /\billegal\b/i,
  /\bdecepti(?:ve|on)\b/i,
  /\bfail(?:ed|ing|ure)?\b/i,
  /\bdefective\b/i,
  /\bharm(?:ful|ing)?\b/i,
  /\bmislead(?:ing)?\b/i,
  /\bviolat(?:ion|ing|ed)\b/i,
  /\bbankrupt\b/i,
  /\bcollaps(?:e|ed|ing)\b/i,
];

const CAUSAL_CLAIM_PATTERNS = [
  /\bcaus(?:e[ds]?|ing)\b/i,
  /\bleads?\s+to\b/i,
  /\bresults?\s+in\b/i,
  /\bresponsible\s+for\b/i,
  /\blinked\s+to\b/i,
  /\battributed?\s+to\b/i,
];

export class StanceClassifier {
  /**
   * Classify every evidence item's stance relative to the primary claim.
   * Mutates evidence in-place (sets .type and ._classificationConfidence)
   * and returns the array.
   */
  classify(evidence, claims, query) {
    if (!evidence || evidence.length === 0) return evidence;

    const primaryClaim = claims?.[0]?.text || query || '';
    const direction = this._detectDirection(primaryClaim);

    log('debug', `classifier: claim direction=${direction.type} for "${primaryClaim.slice(0, 60)}"`);

    let classified = 0;
    for (const e of evidence) {
      const result = this._classifySingle(e, primaryClaim, direction);
      e.type = result.stance;
      e._classificationConfidence = result.confidence;
      if (result.stance !== EvidenceType.NEUTRAL) classified++;
    }

    log('info', `classifier: ${classified}/${evidence.length} evidence classified (${evidence.length - classified} neutral)`);
    return evidence;
  }

  /**
   * Classify a single evidence item against a specific claim.
   */
  classifyForClaim(evidence, claim) {
    const direction = this._detectDirection(claim.text || claim);
    return this._classifySingle(
      evidence,
      typeof claim === 'string' ? claim : claim.text,
      direction
    );
  }

  /**
   * Simple sentiment analysis: count positive vs negative indicator words.
   */
  detectSentiment(text) {
    if (!text) return { sentiment: 0, positive: 0, negative: 0, indicators: [] };

    const lower = text.toLowerCase();
    const indicators = [];
    let positiveCount = 0;
    let negativeCount = 0;

    for (const signal of POSITIVE_SIGNALS) {
      if (lower.includes(signal)) {
        positiveCount++;
        indicators.push(`+${signal}`);
      }
    }

    for (const signal of NEGATIVE_SIGNALS) {
      if (lower.includes(signal)) {
        negativeCount++;
        indicators.push(`-${signal}`);
      }
    }

    const total = positiveCount + negativeCount;
    const sentiment = total === 0 ? 0 : (positiveCount - negativeCount) / total;

    return {
      sentiment: Math.max(-1, Math.min(1, sentiment)),
      positive: positiveCount,
      negative: negativeCount,
      indicators,
    };
  }

  /**
   * Return classification breakdown statistics.
   */
  getStats(classifiedEvidence) {
    const stats = { supports: 0, contradicts: 0, contextual: 0, neutral: 0 };
    let totalConf = 0;

    for (const e of classifiedEvidence) {
      if (e.type === EvidenceType.SUPPORTS) stats.supports++;
      else if (e.type === EvidenceType.CONTRADICTS) stats.contradicts++;
      else if (e.type === EvidenceType.CONTEXTUAL) stats.contextual++;
      else stats.neutral++;

      totalConf += e._classificationConfidence || 0;
    }

    const total = classifiedEvidence.length || 1;
    const sided = stats.supports + stats.contradicts || 1;

    return {
      ...stats,
      total: classifiedEvidence.length,
      avgConfidence: Math.round((totalConf / total) * 1000) / 1000,
      stanceRatio: Math.round((stats.supports / sided) * 1000) / 1000,
    };
  }

  // ─── Internal ───────────────────────────────────────────

  /**
   * Detect the direction of a claim: is it asserting something
   * positive, negative, causal, or factual?
   */
  _detectDirection(claimText) {
    const lower = claimText.toLowerCase();

    for (const pat of NEGATIVE_CLAIM_PATTERNS) {
      if (pat.test(lower)) return { type: 'negative', raw: claimText };
    }
    for (const pat of POSITIVE_CLAIM_PATTERNS) {
      if (pat.test(lower)) return { type: 'positive', raw: claimText };
    }
    for (const pat of CAUSAL_CLAIM_PATTERNS) {
      if (pat.test(lower)) return { type: 'causal', raw: claimText };
    }

    return { type: 'factual', raw: claimText };
  }

  /**
   * Core classification of a single evidence item against a claim.
   */
  _classifySingle(evidence, claimText, direction) {
    const summary = evidence.summary || evidence.text || '';
    if (!summary) {
      return { stance: EvidenceType.NEUTRAL, confidence: 0 };
    }

    const sentiment = this.detectSentiment(summary);
    const contextScore = this._contextualScore(summary);
    const entityOverlap = this._entityOverlap(summary, claimText);

    // If no entity overlap with the claim at all, it's contextual at best
    if (entityOverlap === 0 && sentiment.positive + sentiment.negative === 0) {
      return { stance: EvidenceType.NEUTRAL, confidence: 0.3 };
    }

    // Strong contextual signals with no clear sentiment → contextual
    if (contextScore > 2 && Math.abs(sentiment.sentiment) < 0.3) {
      return { stance: EvidenceType.CONTEXTUAL, confidence: 0.5 + contextScore * 0.05 };
    }

    // Now determine stance based on claim direction + evidence sentiment
    const stance = this._resolveStance(direction, sentiment, entityOverlap);

    // Confidence is a function of: how many signals matched, entity overlap, sentiment strength
    const signalCount = sentiment.positive + sentiment.negative;
    const sentimentStrength = Math.abs(sentiment.sentiment);
    const confidence = Math.min(0.95, 0.3 +
      signalCount * 0.08 +
      entityOverlap * 0.15 +
      sentimentStrength * 0.2
    );

    return { stance, confidence };
  }

  /**
   * Given claim direction and evidence sentiment, determine the stance.
   *
   * The key insight: if a claim says "X is safe" (positive direction)
   * and evidence is negative ("crash", "recall"), that's CONTRADICTING.
   * But if a claim says "X is fraudulent" (negative direction)
   * and evidence is negative ("indicted", "charged"), that's SUPPORTING.
   */
  _resolveStance(direction, sentiment, entityOverlap) {
    const { positive, negative } = sentiment;
    const total = positive + negative;

    if (total === 0) {
      return entityOverlap > 0 ? EvidenceType.CONTEXTUAL : EvidenceType.NEUTRAL;
    }

    const dominance = total > 0 ? (positive - negative) / total : 0;

    // Threshold: need clear dominance to classify as supporting/contradicting
    if (Math.abs(dominance) < 0.2 && total < 3) {
      return EvidenceType.CONTEXTUAL;
    }

    const evidenceIsPositive = dominance > 0;

    switch (direction.type) {
      case 'positive':
        // Claim asserts positive → positive evidence supports, negative contradicts
        return evidenceIsPositive ? EvidenceType.SUPPORTS : EvidenceType.CONTRADICTS;

      case 'negative':
        // Claim asserts negative → negative evidence supports, positive contradicts
        return evidenceIsPositive ? EvidenceType.CONTRADICTS : EvidenceType.SUPPORTS;

      case 'causal':
        // Causal claims: evidence confirming the mechanism supports,
        // evidence denying the link contradicts
        return evidenceIsPositive ? EvidenceType.SUPPORTS : EvidenceType.CONTRADICTS;

      case 'factual':
      default:
        // Neutral/factual claims: positive evidence → supports, negative → contradicts
        // (caller should verify factual alignment separately)
        if (Math.abs(dominance) > 0.3) {
          return evidenceIsPositive ? EvidenceType.SUPPORTS : EvidenceType.CONTRADICTS;
        }
        return EvidenceType.CONTEXTUAL;
    }
  }

  /**
   * Count how many contextual-background signals appear in the text.
   */
  _contextualScore(text) {
    const lower = text.toLowerCase();
    let score = 0;
    for (const signal of CONTEXTUAL_SIGNALS) {
      if (lower.includes(signal)) score++;
    }
    return score;
  }

  /**
   * Measure entity overlap between evidence text and claim text.
   * Extracts significant words (>3 chars, capitalized or important)
   * and counts shared terms.
   */
  _entityOverlap(evidenceText, claimText) {
    const claimTokens = this._significantTokens(claimText);
    if (claimTokens.size === 0) return 0;

    const evidenceLower = evidenceText.toLowerCase();
    let overlap = 0;

    for (const token of claimTokens) {
      if (evidenceLower.includes(token)) overlap++;
    }

    return overlap / claimTokens.size;
  }

  /**
   * Extract significant tokens from text for matching.
   * Filters out stop words, keeps terms that carry meaning.
   */
  _significantTokens(text) {
    const STOP = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
      'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
      'as', 'into', 'through', 'during', 'before', 'after', 'above',
      'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further',
      'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
      'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
      'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
      'than', 'too', 'very', 'just', 'that', 'this', 'these', 'those',
      'and', 'but', 'or', 'if', 'while', 'because', 'about', 'what',
      'which', 'who', 'whom', 'its', 'it', 'they', 'them', 'their', 'he',
      'she', 'his', 'her', 'him', 'my', 'your', 'our', 'we', 'you', 'me',
    ]);

    const words = text.toLowerCase().split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length > 2 && !STOP.has(w));

    return new Set(words);
  }
}

export default StanceClassifier;
