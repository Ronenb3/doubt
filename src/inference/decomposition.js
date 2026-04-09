/**
 * doubt — Confidence Decomposition Engine
 *
 * An unexplained confidence score is no better than a guess.
 *
 * When a system says "71%", you should be able to ask "which 71%?"
 * and get an exact answer: "42% from SEC filings (trust 0.95, 3 pieces),
 * 18% from Reuters (trust 0.65, 2 pieces), 11% from Reddit (trust 0.30,
 * 5 pieces)."
 *
 * This module decomposes every confidence score into:
 *   - per-connector contributions (which source contributed what)
 *   - direction analysis (supporting vs contradicting vs mixed)
 *   - concentration risk (all eggs in one basket?)
 *   - surprises (evidence that moved the needle more than expected)
 *
 * The output is both structured data and a readable table.
 * Numbers tell analysts. Tables tell executives. Both matter.
 */

import { log } from '../core/config.js';

export class ConfidenceDecomposition {

  /**
   * Decompose a single claim's confidence into per-source contributions.
   *
   * Takes the Bayesian inference trail and traces exactly how
   * each connector contributed to the final posterior.
   */
  decompose(claims, evidence, bayesianResult) {
    const results = [];

    for (const claim of (Array.isArray(bayesianResult) ? bayesianResult : [bayesianResult])) {
      const trail = claim.inference?.trail || [];

      if (trail.length === 0) {
        results.push({
          claim: { id: claim.id, text: claim.text, finalConfidence: claim.confidence },
          contributions: [],
          dominantSource: null,
          concentrationRisk: 0,
          surprises: [],
        });
        continue;
      }

      // Group trail entries by connector
      const byConnector = new Map();
      for (const step of trail) {
        const key = step.connector || 'unknown';
        if (!byConnector.has(key)) {
          byConnector.set(key, { steps: [], rawWeightSum: 0, effectiveWeightSum: 0 });
        }
        const bucket = byConnector.get(key);
        bucket.steps.push(step);
        bucket.rawWeightSum += step.rawWeight;
        bucket.effectiveWeightSum += step.effectiveWeight;
      }

      const totalEffective = trail.reduce((s, t) => s + t.effectiveWeight, 0);

      // Build contribution list
      const contributions = [];
      for (const [connectorId, bucket] of byConnector) {
        const fraction = totalEffective > 0
          ? bucket.effectiveWeightSum / totalEffective
          : 0;

        const direction = this._inferDirection(bucket.steps);
        const topStep = bucket.steps.reduce(
          (best, s) => s.effectiveWeight > best.effectiveWeight ? s : best,
          bucket.steps[0]
        );

        const topEvidence = this._findEvidence(evidence, topStep.evidenceId);

        contributions.push({
          connectorId,
          evidenceCount: bucket.steps.length,
          totalRawWeight: round(bucket.rawWeightSum),
          totalEffectiveWeight: round(bucket.effectiveWeightSum),
          confidenceContribution: round(fraction),
          direction,
          trustTier: round(bucket.steps[0]?.rawWeight || 0),
          topEvidence: {
            summary: topEvidence?.summary || `Evidence ${topStep.evidenceId}`,
            weight: round(topStep.effectiveWeight),
          },
        });
      }

      contributions.sort((a, b) => b.confidenceContribution - a.confidenceContribution);

      const dominant = contributions[0] || null;
      const concentrationRisk = this._herfindahlIndex(contributions);
      const surprises = this.findSurprises(trail);

      results.push({
        claim: { id: claim.id, text: claim.text, finalConfidence: claim.confidence },
        contributions,
        dominantSource: dominant
          ? { connectorId: dominant.connectorId, contribution: dominant.confidenceContribution }
          : null,
        concentrationRisk: round(concentrationRisk),
        surprises,
      });

      log('info', `Decomposed claim "${truncate(claim.text, 50)}": ` +
        `${contributions.length} connectors, concentration ${(concentrationRisk * 100).toFixed(0)}%`);
    }

    return results.length === 1 ? results[0] : results;
  }

  /**
   * Decompose an entire investigation's confidence by domain, trust tier,
   * and originality. Reveals structural vulnerabilities in the evidence base.
   */
  decomposeInvestigation(investigation) {
    const claims = investigation.claims || [];
    const evidence = investigation.evidence || [];

    if (claims.length === 0) {
      return {
        byDomain: {},
        byTrustTier: { 'high (≥0.80)': 0, 'medium (0.50-0.79)': 0, 'low (<0.50)': 0 },
        byOriginality: { root: 0, derivative: 0 },
        priorContribution: 0,
        evidenceContribution: 0,
        concentrationRisk: 0,
        vulnerabilities: ['No claims to analyze'],
      };
    }

    // Collect all trail steps across all claims
    const allSteps = [];
    let totalPriorWeight = 0;
    let totalEvidenceWeight = 0;

    for (const claim of claims) {
      const trail = claim.inference?.trail || [];
      allSteps.push(...trail);
      const alpha0 = claim._domainPrior?.alpha || 1;
      const beta0 = claim._domainPrior?.beta || 1;
      totalPriorWeight += (alpha0 + beta0) - 2; // excess over uniform prior
      totalEvidenceWeight += trail.reduce((s, t) => s + t.effectiveWeight, 0);
    }

    const grandTotal = totalPriorWeight + totalEvidenceWeight;

    // By domain (inferred from connector naming conventions)
    const byDomain = {};
    for (const step of allSteps) {
      const domain = connectorToDomain(step.connector);
      byDomain[domain] = (byDomain[domain] || 0) + step.effectiveWeight;
    }
    normalizeTo1(byDomain);

    // By trust tier — use connectorTrustTier (static source type) not rawWeight (pipeline-modified)
    const tiers = { 'high (≥0.80)': 0, 'medium (0.50-0.79)': 0, 'low (<0.50)': 0 };
    for (const step of allSteps) {
      const w = step.connectorTrustTier ?? step.rawWeight;
      if (w >= 0.80) tiers['high (≥0.80)'] += step.effectiveWeight;
      else if (w >= 0.50) tiers['medium (0.50-0.79)'] += step.effectiveWeight;
      else tiers['low (<0.50)'] += step.effectiveWeight;
    }
    normalizeTo1(tiers);

    // By originality (root vs derivative)
    const byOriginality = { root: 0, derivative: 0 };
    for (const ev of evidence) {
      const isRoot = ev.trustWeight >= 0.9 || !ev.rootSource || ev.rootSource === ev.id;
      const weight = ev.trustWeight;
      if (isRoot) byOriginality.root += weight;
      else byOriginality.derivative += weight;
    }
    normalizeTo1(byOriginality);

    // Prior vs evidence contribution
    const priorContribution = grandTotal > 0 ? round(totalPriorWeight / grandTotal) : 0;
    const evidenceContribution = grandTotal > 0 ? round(totalEvidenceWeight / grandTotal) : 0;

    // Concentration risk across connectors
    const connectorWeights = new Map();
    for (const step of allSteps) {
      const key = step.connector || 'unknown';
      connectorWeights.set(key, (connectorWeights.get(key) || 0) + step.effectiveWeight);
    }
    const totalW = [...connectorWeights.values()].reduce((s, v) => s + v, 0);
    let hhi = 0;
    for (const w of connectorWeights.values()) {
      const share = totalW > 0 ? w / totalW : 0;
      hhi += share * share;
    }
    const concentrationRisk = round(hhi);

    // Vulnerabilities
    const vulnerabilities = [];
    const sorted = [...connectorWeights.entries()]
      .sort((a, b) => b[1] - a[1]);

    if (sorted.length > 0) {
      const topShare = totalW > 0 ? sorted[0][1] / totalW : 0;
      if (topShare > 0.50) {
        vulnerabilities.push(
          `${(topShare * 100).toFixed(0)}% of confidence depends on ${sorted[0][0]} ` +
          `— if those are inaccurate, confidence collapses`
        );
      }
    }

    if (tiers['low (<0.50)'] > 0.40) {
      vulnerabilities.push(
        `${(tiers['low (<0.50)'] * 100).toFixed(0)}% of confidence from low-trust sources`
      );
    }

    if (byOriginality.derivative > 0.60) {
      vulnerabilities.push(
        `${(byOriginality.derivative * 100).toFixed(0)}% of evidence is derivative — ` +
        `true independent sourcing is thin`
      );
    }

    if (priorContribution > 0.30) {
      vulnerabilities.push(
        `${(priorContribution * 100).toFixed(0)}% of confidence comes from domain priors, ` +
        `not new evidence`
      );
    }

    if (evidence.length < 5) {
      vulnerabilities.push(
        `Only ${evidence.length} total evidence items — sample size is dangerously small`
      );
    }

    log('info', `Investigation decomposition: ${Object.keys(byDomain).length} domains, ` +
      `concentration ${(concentrationRisk * 100).toFixed(0)}%, ` +
      `${vulnerabilities.length} vulnerabilities`);

    return {
      byDomain,
      byTrustTier: tiers,
      byOriginality,
      priorContribution,
      evidenceContribution,
      concentrationRisk,
      vulnerabilities,
    };
  }

  /**
   * Find evidence items that moved the posterior more than expected.
   * These "surprises" are often the most interesting findings.
   *
   * Surprise = actual_shift / expected_shift.
   * > 2x is surprising. > 5x is very surprising.
   */
  findSurprises(trail) {
    if (trail.length < 2) return [];

    const totalWeight = trail.reduce((s, t) => s + t.effectiveWeight, 0);
    if (totalWeight === 0) return [];

    const surprises = [];

    for (let i = 1; i < trail.length; i++) {
      const prev = trail[i - 1];
      const curr = trail[i];

      const expectedShare = curr.effectiveWeight / totalWeight;
      const actualShift = Math.abs(curr.posteriorMean - prev.posteriorMean);
      const expectedShift = expectedShare * 0.5; // baseline: weight's share of a max 0.5 swing

      if (expectedShift === 0) continue;

      const surpriseRatio = actualShift / expectedShift;

      if (surpriseRatio > 2.0) {
        surprises.push({
          evidenceId: curr.evidenceId,
          connector: curr.connector,
          expectedShift: round(expectedShift),
          actualShift: round(actualShift),
          surpriseRatio: round(surpriseRatio),
          direction: curr.posteriorMean > prev.posteriorMean ? 'boosted' : 'undermined',
          severity: surpriseRatio > 5 ? 'very_surprising' : 'surprising',
        });
      }
    }

    surprises.sort((a, b) => b.surpriseRatio - a.surpriseRatio);
    return surprises;
  }

  /**
   * Render a decomposition as a markdown table.
   * Designed for terminal output and report embedding.
   */
  generateDecompositionTable(decomposition) {
    const { claim, contributions, dominantSource, concentrationRisk, surprises } = decomposition;

    if (!contributions || contributions.length === 0) {
      return `No decomposition available for claim "${truncate(claim?.text || '(unknown)', 60)}"`;
    }

    const lines = [];
    lines.push(`### Confidence Decomposition: ${(claim.finalConfidence * 100).toFixed(1)}%`);
    lines.push(`> ${truncate(claim.text, 100)}`);
    lines.push('');
    lines.push('| Source | Evidence | Trust | Direction | Contribution |');
    lines.push('|--------|----------|-------|-----------|--------------|');

    let totalEvidence = 0;

    for (const c of contributions) {
      const name = formatConnectorName(c.connectorId);
      const count = `${c.evidenceCount} item${c.evidenceCount !== 1 ? 's' : ''}`;
      const trust = c.trustTier.toFixed(2);
      const dir = capitalize(c.direction);
      const pct = `${(c.confidenceContribution * 100).toFixed(1)}%`;
      totalEvidence += c.evidenceCount;

      lines.push(`| ${padRight(name, 12)} | ${padRight(count, 8)} | ${trust} | ${padRight(dir, 13)} | ${padRight(pct, 12)} |`);
    }

    lines.push(`| **TOTAL** | **${totalEvidence}** | | | **100%** |`);
    lines.push('');

    // Concentration risk label
    const riskLabel = concentrationRisk > 0.60 ? 'HIGH'
      : concentrationRisk > 0.35 ? 'MODERATE'
      : 'LOW';

    const topPct = contributions[0]
      ? `${(contributions[0].confidenceContribution * 100).toFixed(0)}% from single source`
      : '';

    lines.push(`Concentration risk: ${riskLabel} (${topPct})`);

    if (dominantSource) {
      lines.push(`Dominant source: ${formatConnectorName(dominantSource.connectorId)}`);
    }

    if (surprises.length > 0) {
      lines.push('');
      lines.push(`**Surprises** (${surprises.length} evidence items shifted confidence unexpectedly):`);
      for (const s of surprises.slice(0, 5)) {
        lines.push(`  - ${formatConnectorName(s.connector)}: ${s.direction} confidence ` +
          `${s.surpriseRatio.toFixed(1)}x more than expected (${s.severity})`);
      }
    }

    return lines.join('\n');
  }

  // ─── Internal ──────────────────────────────────────────────

  _inferDirection(steps) {
    let supporting = 0;
    let contradicting = 0;

    for (const s of steps) {
      if (s.type === 'supports') supporting += s.effectiveWeight;
      else if (s.type === 'contradicts') contradicting += s.effectiveWeight;
    }

    if (supporting > 0 && contradicting > 0) return 'mixed';
    if (contradicting > supporting) return 'contradicting';
    return 'supporting';
  }

  _findEvidence(evidence, evidenceId) {
    if (!evidence || !evidenceId) return null;
    return evidence.find(e => e.id === evidenceId) || null;
  }

  /**
   * Herfindahl-Hirschman Index: sum of squared market shares.
   * 1.0 = all from one source (monopoly). 1/n = perfectly distributed.
   */
  _herfindahlIndex(contributions) {
    if (contributions.length === 0) return 0;
    return contributions.reduce((sum, c) => sum + c.confidenceContribution ** 2, 0);
  }
}

// ─── Utility ──────────────────────────────────────────────

function round(n, places = 4) {
  return Math.round(n * 10 ** places) / 10 ** places;
}

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function padRight(s, len) {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function formatConnectorName(id) {
  if (!id) return 'unknown';
  return id.replace(/[_-]/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const CONNECTOR_DOMAINS = {
  sec_edgar: 'financial', sec_insider: 'financial', sec_xbrl: 'financial',
  polygon_market: 'financial', fred: 'financial', fdic: 'financial',
  finra: 'financial', cftc_cot: 'financial', cme_warehouse: 'financial',
  courtlistener: 'legal', pacer: 'legal', state_courts: 'legal',
  reuters: 'news', gdelt: 'news', hackernews: 'news', google_factcheck: 'news',
  duckduckgo: 'news', news_archive: 'news', news_intel: 'news',
  reddit: 'social', stocktwits: 'social',
  openalex: 'academic', semantic_scholar: 'academic', pubmed: 'academic',
  crossref: 'academic', arxiv: 'academic', papers_with_code: 'academic',
  opensanctions: 'sanctions', ofac: 'sanctions', interpol: 'sanctions',
  opencorporates: 'corporate', gleif: 'corporate', uk_companies_house: 'corporate',
  wikipedia: 'reference', wayback: 'reference',
  fec: 'political', congressional_record: 'political', lobbying: 'political',
  sam_gov: 'government', federal_register: 'government', federal_procurement: 'government',
  github: 'technical', github_deep: 'technical', huggingface: 'technical',
};

function connectorToDomain(connectorId) {
  if (!connectorId) return 'unknown';
  return CONNECTOR_DOMAINS[connectorId] || 'other';
}

function normalizeTo1(obj) {
  const total = Object.values(obj).reduce((s, v) => s + v, 0);
  if (total === 0) return;
  for (const key of Object.keys(obj)) {
    obj[key] = round(obj[key] / total);
  }
}

export default ConfidenceDecomposition;
