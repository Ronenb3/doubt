/**
 * Perspective API Connector
 *
 * Google's Perspective API (Jigsaw) scores text for toxicity, identity attack,
 * insult, threat, and obscenity. Used to assess credibility of social media
 * evidence — high toxicity is a marker of low epistemic quality.
 *
 * This connector has a different purpose than most: it's called NOT as a
 * regular search connector, but as a post-processing step that annotates
 * evidence that came from social-tier sources (reddit, hackernews, stocktwits)
 * with toxicity scores. High toxicity automatically reduces trustWeight.
 *
 * When used as a search connector (rare), it can be pointed at a specific
 * URL/text claim to score it directly.
 *
 * Free tier: 1 QPS with quota increase available.
 * Sign up: https://developers.perspectiveapi.com/s/
 * Key name: PERSPECTIVE_API_KEY
 * Trust: does not produce evidence itself — used to downgrade social evidence
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

// Social-tier connector IDs whose evidence should be scored for toxicity
const SOCIAL_CONNECTORS = new Set(['reddit', 'hackernews', 'stocktwits', 'community']);

// Toxicity score above this threshold triggers trust penalty
const TOXICITY_THRESHOLD = 0.70;
// Trust multiplier applied to high-toxicity evidence
const TOXICITY_PENALTY = 0.40;

export class PerspectiveScorer {
  constructor() {
    this.baseUrl = 'https://commentanalyzer.googleapis.com/v1alpha1';
    this._apiKey = null;
  }

  _getKey() {
    if (!this._apiKey) {
      const config = getConfig();
      this._apiKey = config.keys['PERSPECTIVE_API_KEY'];
    }
    return this._apiKey;
  }

  get available() {
    return !!this._getKey();
  }

  /**
   * Score a text string for toxicity.
   * Returns { toxicity, identityAttack, insult, threat } scores (0–1),
   * or null if unavailable.
   */
  async scoreText(text) {
    const key = this._getKey();
    if (!key || !text?.trim()) return null;

    try {
      const body = JSON.stringify({
        comment: { text: text.slice(0, 20480) }, // API limit
        requestedAttributes: {
          TOXICITY: {},
          IDENTITY_ATTACK: {},
          INSULT: {},
          THREAT: {},
        },
        languages: ['en'],
      });

      const res = await fetch(
        `${this.baseUrl}/comments:analyze?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!res.ok) return null;
      const data = await res.json();
      const scores = data.attributeScores || {};

      return {
        toxicity:       scores.TOXICITY?.summaryScore?.value ?? null,
        identityAttack: scores.IDENTITY_ATTACK?.summaryScore?.value ?? null,
        insult:         scores.INSULT?.summaryScore?.value ?? null,
        threat:         scores.THREAT?.summaryScore?.value ?? null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Score all social-tier evidence in a set, attach `perspective` data,
   * and proportionally penalize trustWeight for high-toxicity items.
   *
   * Returns { scored, penalized } count summary.
   */
  async scoreEvidence(evidenceArray) {
    if (!this.available) return { scored: 0, penalized: 0 };

    let scored = 0;
    let penalized = 0;

    for (const ev of evidenceArray) {
      if (!SOCIAL_CONNECTORS.has(ev.connectorId)) continue;

      const text = [ev.title, ev.summary].filter(Boolean).join(' ');
      const result = await this.scoreText(text);
      if (!result) continue;

      ev.data = ev.data || {};
      ev.data.perspective = result;
      scored++;

      if (result.toxicity !== null && result.toxicity > TOXICITY_THRESHOLD) {
        const originalWeight = ev.trustWeight ?? 0.3;
        ev.trustWeight = Math.max(0.05, originalWeight * TOXICITY_PENALTY);
        ev.data.perspective.penalized = true;
        penalized++;
      }
    }

    return { scored, penalized };
  }
}

// Export a singleton scorer for use in the pipeline
export const perspectiveScorer = new PerspectiveScorer();

// Also export as a dummy connector so registry loads it without error.
// The real power is the exported perspectiveScorer used by pipeline.js.
class PerspectiveConnector extends BaseConnector {
  constructor() {
    super({
      id: 'perspective',
      name: 'Perspective API',
      description: 'Google Jigsaw: toxicity scoring for social-tier evidence (reddit, hackernews, stocktwits)',
      baseUrl: 'https://commentanalyzer.googleapis.com/v1alpha1',
      domains: ['social'],
      trustTier: SourceTrust.SOCIAL_MEDIA,
      rateMs: 1100, // 1 QPS free tier
      requiresKey: true,
      keyName: 'PERSPECTIVE_API_KEY',
    });
    this._scorer = perspectiveScorer;
  }

  get available() {
    return this._scorer.available;
  }

  // When called as a search connector, score the query text itself
  async search(query, options = {}) {
    const result = await this._scorer.scoreText(query);
    if (!result) return [];

    const dominant = Object.entries(result)
      .filter(([, v]) => v !== null)
      .sort(([, a], [, b]) => b - a)[0];

    const isToxic = result.toxicity > TOXICITY_THRESHOLD;
    const item = {
      url: '',
      title: `Perspective: "${query.slice(0, 60)}"`,
      summary: `Toxicity: ${(result.toxicity * 100).toFixed(0)}% | Identity attack: ${(result.identityAttack * 100).toFixed(0)}% | Insult: ${(result.insult * 100).toFixed(0)}% | Threat: ${(result.threat * 100).toFixed(0)}%`,
      type: isToxic ? EvidenceType.CONTRADICTING : EvidenceType.CONTEXTUAL,
      timestamp: new Date().toISOString(),
      data: { perspective: result, dominant: dominant?.[0], dominantScore: dominant?.[1] },
    };

    return this._toEvidence([item], options.claimId);
  }
}

export default PerspectiveConnector;
