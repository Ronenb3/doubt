/**
 * doubt — Epistemic Vectors
 *
 * Inspired by Empirica's 13-vector model, adapted for investigation.
 * These vectors don't track an AI's self-awareness —
 * they track the INVESTIGATION's epistemic health.
 *
 * The key insight: an investigation can have high evidence confidence
 * (Bayesian posterior > 0.70) but low epistemic health:
 *   - All evidence comes from the same root source (diversity: 0.05)
 *   - Key claims are unfalsifiable with available connectors
 *   - The strongest evidence is from a low-trust connector
 *   - There's a temporal gap — no evidence from the last 6 months
 *
 * The dual gate: both evidence AND epistemic health must pass
 * before the system produces a conclusion. This is the architecture-level
 * anti-hallucination that makes doubt different.
 *
 * Vectors (0.0 to 1.0):
 *
 * ── EVIDENCE HEALTH ──
 * know:          How much does the evidence tell us? (effective evidence weight / needed)
 * coverage:      What % of relevant connectors returned data?
 * diversity:     Citation diversity score (from citation.js)
 * freshness:     How recent is the evidence? (temporal coverage)
 *
 * ── REASONING HEALTH ──
 * coherence:     Do the claims form a consistent picture? (1 - contradiction severity)
 * convergence:   Has the Bayesian posterior stabilized?
 * falsifiability: Could the claims have been disproven if false?
 *
 * ── META ──
 * uncertainty:   Explicit doubt (inverse of overall confidence)
 * fragility:     How many claims depend on a single keystone?
 * blindspots:    How many domains had zero connector coverage?
 *
 * The readiness gate triggers on:
 *   know >= 0.70 AND uncertainty <= 0.35 AND diversity >= 0.30
 */

export class EpistemicVectors {
  constructor() {
    this.vectors = {
      // Evidence health
      know: 0,
      coverage: 0,
      diversity: 0,
      freshness: 0,

      // Reasoning health
      coherence: 1.0,  // starts perfect, degrades with contradictions
      convergence: 0,
      falsifiability: 0,

      // Meta
      uncertainty: 1.0, // starts at max uncertainty
      fragility: 0,
      blindspots: 1.0,  // starts at max blindspots

      // Velocity — how fast is the investigation learning?
      velocity: 0,        // rate of confidence change (high = unstable, low = converged)
      attackSurvival: 0,  // how well claims survived adversarial attacks
    };

    this._history = []; // track vector changes over time
    this._phase = 'preflight';
    this._confidenceSnapshots = []; // for velocity tracking
  }

  /**
   * Update all vectors from investigation state.
   * Called after each pipeline stage.
   */
  update(investigation) {
    const prev = { ...this.vectors };

    this._updateKnow(investigation);
    this._updateCoverage(investigation);
    this._updateDiversity(investigation);
    this._updateFreshness(investigation);
    this._updateCoherence(investigation);
    this._updateConvergence(investigation);
    this._updateFalsifiability(investigation);
    this._updateUncertainty(investigation);
    this._updateFragility(investigation);
    this._updateBlindspots(investigation);
    this._updateVelocity(investigation);
    this._updateAttackSurvival(investigation);

    // Record delta
    const delta = {};
    for (const [key, value] of Object.entries(this.vectors)) {
      delta[key] = Math.round((value - prev[key]) * 1000) / 1000;
    }

    this._history.push({
      phase: this._phase,
      timestamp: Date.now(),
      vectors: { ...this.vectors },
      delta,
    });

    return this.vectors;
  }

  /**
   * Check the readiness gate — can we produce conclusions?
   */
  checkGate(config = {}) {
    const knowMin = config.knowGate || 0.70;
    const uncMax = config.uncertaintyMax || 0.35;
    const divMin = config.minDiversity || 0.30;

    const gates = {
      know: this.vectors.know >= knowMin,
      uncertainty: this.vectors.uncertainty <= uncMax,
      diversity: this.vectors.diversity >= divMin,
      coherence: this.vectors.coherence >= 0.40,
    };

    const passed = Object.values(gates).every(Boolean);

    return {
      passed,
      gates,
      vectors: { ...this.vectors },
      blockers: Object.entries(gates)
        .filter(([, v]) => !v)
        .map(([k]) => k),
      recommendation: passed ? null : this._recommend(gates),
    };
  }

  /**
   * Generate a human-readable status line.
   * [doubt] ⚡73% │ 🔍 18/21 sources │ K:73% U:31% D:45% C:85%
   */
  statusLine() {
    const v = this.vectors;
    const confidence = Math.round((1 - v.uncertainty) * 100);
    const icon = confidence >= 80 ? '⚡' : confidence >= 60 ? '💡' : confidence >= 40 ? '💫' : '🌑';

    return `${icon}${confidence}% │ K:${pct(v.know)} U:${pct(v.uncertainty)} D:${pct(v.diversity)} C:${pct(v.coherence)} A:${pct(v.attackSurvival)} V:${v.velocity < 0.2 ? '▼' : v.velocity < 0.5 ? '~' : '▲'}`;
  }

  setPhase(phase) {
    this._phase = phase;
  }

  getHistory() {
    return this._history;
  }

  /**
   * Compute learning delta: what changed between first and last measurement?
   */
  learningDelta() {
    if (this._history.length < 2) return null;
    const first = this._history[0].vectors;
    const last = this._history[this._history.length - 1].vectors;
    const delta = {};
    for (const key of Object.keys(first)) {
      delta[key] = Math.round((last[key] - first[key]) * 1000) / 1000;
    }
    return delta;
  }

  // ── Individual Vector Updaters ──────────────────────────

  _updateKnow(inv) {
    // How much evidence do we have relative to what we need?
    const evidenceCount = inv.evidence?.length || 0;
    const claimCount = Math.max(1, inv.claims?.length || 1);
    const evidencePerClaim = evidenceCount / claimCount;
    // 5+ evidence per claim = fully informed
    this.vectors.know = Math.min(1.0, evidencePerClaim / 5);
  }

  _updateCoverage(inv) {
    const queried = inv.meta?.sourcesQueried || 0;
    const responded = inv.meta?.sourcesResponded || 0;
    this.vectors.coverage = queried > 0 ? responded / queried : 0;
  }

  _updateDiversity(inv) {
    this.vectors.diversity = inv.meta?.citationDiversity || 0;
  }

  _updateFreshness(inv) {
    if (!inv.evidence || inv.evidence.length === 0) {
      this.vectors.freshness = 0;
      return;
    }

    const now = Date.now();
    const ages = inv.evidence
      .filter(e => e.timestamp)
      .map(e => (now - new Date(e.timestamp).getTime()) / 86400000);

    if (ages.length === 0) { this.vectors.freshness = 0.3; return; }

    const medianAge = ages.sort((a, b) => a - b)[Math.floor(ages.length / 2)];
    // Within 30 days = 1.0, within 365 days = 0.5, older = 0.1
    this.vectors.freshness = medianAge <= 30 ? 1.0 :
      medianAge <= 365 ? 0.5 + 0.5 * (1 - (medianAge - 30) / 335) :
      0.1;
  }

  _updateCoherence(inv) {
    const contradictions = inv.contradictions || [];
    if (contradictions.length === 0) { this.vectors.coherence = 1.0; return; }

    const totalSeverity = contradictions.reduce((s, c) => s + c.severity, 0);
    const avgSeverity = totalSeverity / contradictions.length;
    // More contradictions and higher severity = lower coherence
    const penalty = avgSeverity * Math.min(1, contradictions.length / 5);
    this.vectors.coherence = Math.max(0, 1 - penalty);
  }

  _updateConvergence(inv) {
    const claims = inv.claims || [];
    if (claims.length === 0) { this.vectors.convergence = 0; return; }

    const avgConvergence = claims.reduce((s, c) =>
      s + (c.inference?.convergence || 0), 0) / claims.length;
    this.vectors.convergence = avgConvergence;
  }

  _updateFalsifiability(inv) {
    // Score 1: Text-based — can this claim TYPE be empirically tested?
    // Runs from INTAKE phase onward. Distinguishes empirical claims from
    // philosophical/normative ones before any evidence is gathered.
    const claimTexts = [inv.query || '', ...(inv.claims || []).map(c => c.text)].join(' ');

    let textScore = 0.3; // baseline: assume partial testability

    // Signals that increase falsifiability
    if (/\$[\d,.]+[BMKbmk]?|\d+\s*%|\d+\s*(billion|million|thousand)/i.test(claimTexts)) textScore += 0.25;
    if (/\b(20\d\d|Q[1-4]\s*20\d\d|last\s+year|this\s+year|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(claimTexts)) textScore += 0.15;
    if (/\b(SEC|FDA|court|filed|ruling|verdict|announced|reported|confirmed|indicted|acquired|merged|raised)\b/i.test(claimTexts)) textScore += 0.15;
    if (/\b(is|was|are|were|has|have|had)\b/.test(claimTexts)) textScore += 0.05;

    // Signals that reduce falsifiability
    if (/\b(nature of|meaning of|consciousness|free will|god|soul|purpose|destiny|essence)\b/i.test(claimTexts)) textScore -= 0.40;
    if (/\b(should|ought to|morally|ethically|better|worse|good|evil|right|wrong)\b/i.test(claimTexts)) textScore -= 0.30;
    if (/\b(always|never|everyone|nobody|all people|human nature|inherently)\b/i.test(claimTexts)) textScore -= 0.15;

    textScore = Math.max(0, Math.min(1, textScore));

    // Score 2: Evidence-based — did we actually find evidence on either side?
    // Fixed: evidence items are objects with .type field, not strings.
    const claims = inv.claims || [];
    let evidenceScore = 0;
    if (claims.length > 0) {
      let falsifiable = 0;
      for (const c of claims) {
        const evidenceArr = c.evidence || [];
        const hasEvidence = evidenceArr.some(
          e => e?.type === 'supports' || e?.type === 'contradicts'
        );
        if (hasEvidence) falsifiable++;
      }
      evidenceScore = falsifiable / claims.length;
    }

    // Blend: text score dominates early phases, evidence score adds weight once gathered
    const evidenceWeight = evidenceScore > 0 ? 0.5 : 0;
    const textWeight = 1 - evidenceWeight;
    this.vectors.falsifiability = Math.round(
      (textScore * textWeight + evidenceScore * evidenceWeight) * 1000
    ) / 1000;
  }

  _updateUncertainty(inv) {
    // Inverse of aggregated confidence, weighted by coverage and diversity
    const confidence = inv.confidence || 0;
    const coveragePenalty = 1 - (this.vectors.coverage * 0.3);
    const diversityPenalty = 1 - (this.vectors.diversity * 0.3);
    this.vectors.uncertainty = Math.max(0, (1 - confidence) * coveragePenalty * diversityPenalty);
  }

  _updateFragility(inv) {
    const keystones = inv.keystones || [];
    if (keystones.length === 0) { this.vectors.fragility = 0; return; }

    const maxCascade = Math.max(...keystones.map(k => k.cascadeSize || 0));
    const totalClaims = Math.max(1, (inv.claims || []).length);
    this.vectors.fragility = Math.min(1, maxCascade / totalClaims);
  }

  _updateBlindspots(inv) {
    const queried = inv.meta?.sourcesQueried || 0;
    const failed = inv.meta?.sourcesFailed || 0;
    const total = queried + failed;
    if (total === 0) { this.vectors.blindspots = 1.0; return; }
    this.vectors.blindspots = failed / total;
  }

  _updateVelocity(inv) {
    const confidence = inv.confidence || 0;
    this._confidenceSnapshots.push({ confidence, timestamp: Date.now() });

    if (this._confidenceSnapshots.length < 2) {
      this.vectors.velocity = 1.0; // max velocity at start (we know nothing)
      return;
    }

    // Compute rate of change over last N snapshots
    const recent = this._confidenceSnapshots.slice(-5);
    let totalDelta = 0;
    for (let i = 1; i < recent.length; i++) {
      totalDelta += Math.abs(recent[i].confidence - recent[i - 1].confidence);
    }
    const avgDelta = totalDelta / (recent.length - 1);

    // High velocity = unstable investigation (oscillating)
    // Low velocity = converging on truth
    // We want velocity to DECREASE over time as the investigation stabilizes
    this.vectors.velocity = Math.min(1.0, avgDelta * 5);
  }

  _updateAttackSurvival(inv) {
    // Set by pipeline after adversarial analysis
    if (inv._attackSurvival !== undefined) {
      this.vectors.attackSurvival = inv._attackSurvival;
    }
  }

  _recommend(gates) {
    if (!gates.know) return 'Need more evidence. Try adding connectors or broadening the query.';
    if (!gates.uncertainty) return 'Evidence is inconclusive. Look for higher-trust sources.';
    if (!gates.diversity) return 'Evidence lacks diversity. Many sources may trace to the same origin.';
    if (!gates.coherence) return 'Significant contradictions detected. Resolve before concluding.';
    return null;
  }

  toJSON() {
    return {
      vectors: { ...this.vectors },
      phase: this._phase,
      history: this._history,
    };
  }
}

function pct(v) {
  return Math.round(v * 100) + '%';
}

export default EpistemicVectors;
