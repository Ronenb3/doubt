/**
 * doubt — Bayesian Inference Engine
 *
 * Given a claim and a set of evidence, compute the posterior
 * probability that the claim is true.
 *
 * Model: Beta-Bernoulli conjugate.
 * Prior: Beta(α, β) — starts uniform (1,1), updated by domain priors.
 * Each piece of evidence shifts the distribution based on:
 *   - its type (supports/contradicts/neutral)
 *   - its trust weight (primary document vs social media)
 *   - citation diversity penalty (derivative sources count less)
 *
 * The insight: raw evidence count is meaningless.
 * 100 news articles citing one Reuters wire is ONE piece of evidence.
 * Citation diversity scoring (citation.js) feeds into this.
 *
 * Outputs:
 *   - posterior mean: P(claim is true | evidence)
 *   - credible interval: [low, high] at 95%
 *   - expected information gain (EIG) per additional source
 *   - convergence status: has the posterior stabilized?
 */

import { ClaimStatus, EvidenceType } from '../core/schema.js';
import { getConfig } from '../core/config.js';

export class BayesianEngine {
  constructor(options = {}) {
    const config = getConfig();
    this.priorAlpha = options.priorAlpha || config.inference.priorAlpha;
    this.priorBeta = options.priorBeta || config.inference.priorBeta;
  }

  /**
   * Run Bayesian inference over a claim's evidence.
   * Returns updated claim with confidence and credible interval.
   */
  evaluate(claim, evidence, citationDiversity = null) {
    let alpha = finiteOr(this.priorAlpha, 1);
    let beta = finiteOr(this.priorBeta, 1);
    const trail = [];

    // Apply domain priors if available
    if (claim._domainPrior) {
      alpha = finiteOr(claim._domainPrior.alpha, alpha);
      beta = finiteOr(claim._domainPrior.beta, beta);
    }

    // Domain-aware prior boost: factually grounded claims benefit from higher priors
    // A claim like "Iran is a major oil exporter" already has strong factual basis
    // Don't start from 50/50 uncertainty — start from reasonable baseline expectations
    if (claim._domain) {
      const domainPriors = {
        'geopolitical': { alpha: 3, beta: 2 },    // Geopolitical facts usually have basis in reality
        'financial': { alpha: 3, beta: 2 },        // Financial data is usually verifiable
        'corporate': { alpha: 2, beta: 2 },        // Corporate claims vary widely
        'energy': { alpha: 3, beta: 2 },           // Energy supply chains well-documented
        'default': { alpha: 1, beta: 1 }
      };
      const prior = domainPriors[claim._domain] || domainPriors.default;
      // Only override if not already set by explicit domain prior
      if (!claim._domainPrior) {
        alpha = prior.alpha;
        beta = prior.beta;
      }
    }

    alpha = Math.max(1e-6, alpha);
    beta = Math.max(1e-6, beta);

    // Filter to evidence relevant to this claim
    const relevant = evidence.filter(e =>
      e.claimId === claim.id || e.claimId === null
    );

    if (relevant.length === 0) {
      return {
        ...claim,
        confidence: 0.5,
        credibleInterval: [0.1, 0.9],
        status: ClaimStatus.INSUFFICIENT,
        inference: {
          alpha, beta,
          evidenceUsed: 0,
          effectiveWeight: 0,
          convergence: 0,
          eig: 1.0,
          trail: [],
        },
      };
    }

    // Compute effective weight for each piece of evidence
    for (const e of relevant) {
      const trust = clamp(finiteOr(e.trustWeight, 0.5), 0, 1);
      // Non-linear trust curve: mid-to-high trust (0.6+) get amplified,
      // low-trust sources (< 0.6) get dampened.
      // This ensures major news (0.65) is amplified, not dampened.
      // Without this, 10 Reddit posts (0.3 each) outweigh 3 major news articles (0.65 each).
      let weight = trust >= 0.6
        ? trust * 1.3  // amplify credible sources
        : trust * trust; // dampen noise (0.3² = 0.09, 0.5² = 0.25)

      // Citation diversity penalty:
      // If many pieces of evidence trace to the same root source,
      // each additional one is worth geometrically less.
      if (citationDiversity && e.rootSource) {
        const clusterSize = citationDiversity.clusterSizes?.[e.rootSource] ||
          (Array.isArray(citationDiversity.clusters?.[e.rootSource])
            ? citationDiversity.clusters[e.rootSource].length : 1);
        weight *= Math.pow(0.5, clusterSize - 1);
      }

      // Temporal decay: older evidence worth slightly less
      if (e.timestamp) {
        const ageMs = Date.now() - new Date(e.timestamp).getTime();
        const ageDays = ageMs / 86400000;
        weight *= Math.max(0.3, 1 - (ageDays / 365) * 0.3);
      }

      // Classification confidence: classifier assigns 0-1 confidence in its stance call.
      // High-confidence classifications get full weight; low-confidence get reduced.
      const classConf = clamp(finiteOr(e._classificationConfidence, 0.5), 0, 1);
      const stanceWeight = weight * (0.5 + 0.5 * classConf);

      // Update posterior
      if (e.type === EvidenceType.SUPPORTS) {
        alpha += stanceWeight;
      } else if (e.type === EvidenceType.CONTRADICTS) {
        beta += stanceWeight;
      } else if (e.type === EvidenceType.CONTEXTUAL) {
        alpha += weight * 0.1;
        beta += weight * 0.1;
      }
      // Neutral evidence doesn't shift the distribution

      trail.push({
        evidenceId: e.id,
        connector: e.connectorId,
        type: e.type,
        rawWeight: trust,
        connectorTrustTier: e.connectorTrustTier ?? trust,
        effectiveWeight: weight,
        posteriorMean: alpha / (alpha + beta),
      });
    }

    const totalWeight = alpha + beta;
    const posteriorMean = totalWeight > 0 ? alpha / totalWeight : 0.5;

    // 95% credible interval via Beta quantile approximation
    // Using normal approximation for large alpha+beta
    const variance = totalWeight > 0
      ? (alpha * beta) / ((totalWeight ** 2) * (totalWeight + 1))
      : 0;
    const std = Math.sqrt(variance);
    const ci = [
      Math.max(0, posteriorMean - 1.96 * std),
      Math.min(1, posteriorMean + 1.96 * std),
    ];

    // Expected Information Gain: how much would one more source help?
    // High EIG means we're still uncertain; low means we've converged.
    const eig = Math.max(0, variance * relevant.length);

    // Convergence: how stable is the posterior?
    // If last 3 evidence updates moved the posterior less than 0.02, we've converged.
    const recentDeltas = trail.slice(-3).map((t, i, arr) =>
      i === 0 ? 0 : Math.abs(t.posteriorMean - arr[i - 1].posteriorMean)
    );
    const maxRecentDelta = Math.max(...recentDeltas, 0);
    const convergence = Math.max(0, 1 - maxRecentDelta * 20);

    // Determine status
    let status;
    if (totalWeight < 4) {
      status = ClaimStatus.INSUFFICIENT;
    } else if (posteriorMean >= 0.70 && ci[0] >= 0.45) {
      status = ClaimStatus.SUPPORTED;  // Lowered ci[0] threshold from 0.50 to 0.45
    } else if (posteriorMean <= 0.30 && ci[1] <= 0.50) {
      status = ClaimStatus.CONTRADICTED;
    } else if (std < 0.20 && posteriorMean > 0.40 && posteriorMean < 0.70) {
      // CONTESTED: evidence supports claim but with meaningful disagreement
      // Lowered lower bound from 0.35 to 0.40 and upper from 0.65 to 0.70
      status = ClaimStatus.CONTESTED;
    } else if (posteriorMean >= 0.60) {
      // Strong evidence but not quite at SUPPORTED threshold — better than INSUFFICIENT
      status = ClaimStatus.CONTESTED;
    } else {
      status = ClaimStatus.INSUFFICIENT;
    }

    return {
      ...claim,
      confidence: round(posteriorMean),
      credibleInterval: [round(ci[0]), round(ci[1])],
      status,
      inference: {
        alpha: round(alpha),
        beta: round(beta),
        evidenceUsed: relevant.length,
        effectiveWeight: round(totalWeight),
        convergence: round(convergence),
        eig: round(eig),
        trail,
      },
    };
  }

  /**
   * Run inference over all claims in an investigation.
   */
  evaluateAll(claims, evidence, citationDiversity = null) {
    return claims.map(claim => this.evaluate(claim, evidence, citationDiversity));
  }

  /**
   * Aggregate claim-level confidences into investigation-level confidence.
   * Weighted by claim importance (keystone claims weight more).
   */
  aggregateConfidence(claims) {
    if (claims.length === 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const claim of claims) {
      const confidence = clamp(finiteOr(claim.confidence, 0), 0, 1);
      // Keystones get 3x weight, claims with more dependents get more weight
      const weight = claim.isKeystone ? 3 : 1 + (claim.supports?.length || 0) * 0.5;
      weightedSum += confidence * weight;
      totalWeight += weight;
    }

    if (totalWeight <= 0) return 0;
    return round(weightedSum / totalWeight);
  }
}

function round(n, places = 4) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** places) / 10 ** places;
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default BayesianEngine;
