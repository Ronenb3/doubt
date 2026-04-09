/**
 * doubt — Information Propagation Analyzer
 *
 * The propagation pattern of a claim IS evidence about its truth.
 *
 * Information that starts in a primary document and gets independently
 * discovered by multiple outlets is fundamentally different from information
 * that appears simultaneously across 20 sites (coordinated campaign) or
 * that starts on social media and gets retroactively "confirmed" by news
 * outlets who simply repackage the viral claim.
 *
 * This module reconstructs HOW information spread:
 *
 *   PRIMARY_DISCOVERY       — originates from a primary source (filing, record)
 *   INDEPENDENT_CONVERGENCE — multiple unrelated sources converge on the same fact
 *   GRADUAL_DIFFUSION       — one source reports, others pick up over days/weeks
 *   SIMULTANEOUS_BURST      — 5+ sources report within hours (coordinated)
 *   SOCIAL_FIRST            — social media reports before any news/primary source
 *   SINGLE_SOURCE           — only one source ever reports this
 *
 * The key analytical insight: most "well-sourced" claims are actually
 * single-source claims wearing a trench coat. Twenty outlets citing
 * the same anonymous tip is not twenty sources — it's one source
 * amplified twenty times. The propagation pattern reveals this.
 */

import { log } from '../core/config.js';

const PropagationPattern = Object.freeze({
  PRIMARY_DISCOVERY:       'PRIMARY_DISCOVERY',
  INDEPENDENT_CONVERGENCE: 'INDEPENDENT_CONVERGENCE',
  GRADUAL_DIFFUSION:       'GRADUAL_DIFFUSION',
  SIMULTANEOUS_BURST:      'SIMULTANEOUS_BURST',
  SOCIAL_FIRST:            'SOCIAL_FIRST',
  SINGLE_SOURCE:           'SINGLE_SOURCE',
});

const TRUST_MULTIPLIERS = Object.freeze({
  PRIMARY_DISCOVERY:       1.2,
  INDEPENDENT_CONVERGENCE: 1.3,
  GRADUAL_DIFFUSION:       1.0,
  SIMULTANEOUS_BURST:      0.7,
  SOCIAL_FIRST:            0.5,
  SINGLE_SOURCE:           0.8,
});

const PRIMARY_CONNECTORS = new Set([
  'sec_edgar', 'courtlistener', 'pacer', 'fec', 'ofac', 'sam_gov',
  'federal_register', 'patents', 'clinical_trials', 'fdic', 'finra',
  'usa_spending', 'federal_procurement', 'congressional_record',
  'open_ownership', 'gleif', 'state_sos', 'crt_sh',
]);

const SOCIAL_CONNECTORS = new Set([
  'reddit', 'hackernews', 'stocktwits', 'community',
]);

const NEWS_CONNECTORS = new Set([
  'gdelt', 'news_intel', 'news_archive', 'media', 'google_factcheck',
]);

const BURST_WINDOW_MS = 3 * 3600 * 1000;     // 3 hours
const BURST_MIN_SOURCES = 5;
const SIMILARITY_THRESHOLD = 0.6;
const COORDINATION_SIMILARITY = 0.8;

export class PropagationAnalyzer {

  /**
   * Analyze how information propagated across the evidence set.
   * Returns a propagation model with pattern classification,
   * trust adjustments, and coordination signals.
   */
  analyze(evidence) {
    if (!evidence || evidence.length === 0) {
      return {
        pattern: PropagationPattern.SINGLE_SOURCE,
        originSource: null,
        timeline: [],
        amplificationFactor: 0,
        trustAdjustments: new Map(),
        independentDiscoveries: 0,
        coordinationSignals: [],
        summary: 'No evidence to analyze.',
      };
    }

    const sorted = this._temporalSort(evidence);
    const origin = sorted[0];
    const timeline = this._buildTimeline(sorted, origin);
    const roots = this._identifyRoots(sorted);
    const pattern = this._classifyPattern(sorted, roots, timeline);
    const amplification = this._computeAmplification(sorted, roots);
    const coordination = this.detectCoordination(sorted);
    const trustAdjustments = this._computeTrustAdjustments(sorted, pattern, roots);

    const result = {
      pattern,
      originSource: {
        connectorId: origin.connectorId,
        timestamp: origin.timestamp,
        summary: truncate(origin.summary, 200),
      },
      timeline,
      amplificationFactor: round(amplification),
      trustAdjustments,
      independentDiscoveries: roots.length,
      coordinationSignals: coordination,
      summary: this._generateSummary(pattern, origin, sorted, roots, amplification, coordination),
    };

    log('info', `Propagation: ${pattern} (${roots.length} independent, ${round(amplification)}x amplification)`);
    return result;
  }

  /**
   * Detect signs of coordinated information campaigns.
   *
   * Coordination signals:
   *   - Multiple sources publishing within the same hour with similar language
   *   - Social media surge preceding news coverage (astroturfing)
   *   - All sources citing the same unnamed "source" or "insider"
   *   - Language similarity > 0.8 across sources (copy-paste journalism)
   */
  detectCoordination(evidence) {
    const signals = [];
    const sorted = this._temporalSort(evidence);

    // 1. Temporal clustering — find bursts of near-simultaneous publication
    const bursts = this._findTemporalBursts(sorted);
    for (const burst of bursts) {
      if (burst.items.length >= 3) {
        const similarities = this._pairwiseSimilarity(burst.items);
        const avgSim = similarities.reduce((s, v) => s + v, 0) / Math.max(1, similarities.length);

        if (avgSim > SIMILARITY_THRESHOLD) {
          signals.push({
            type: 'simultaneous_similar',
            description: `${burst.items.length} sources published within ${burst.windowHours.toFixed(1)}h with ${(avgSim * 100).toFixed(0)}% language overlap — likely coordinated release`,
            evidence: burst.items.map(e => e.id),
            confidence: Math.min(0.95, 0.5 + avgSim * 0.4),
          });
        }
      }
    }

    // 2. Social-first pattern — social media predates news coverage
    const socialTimestamps = sorted
      .filter(e => SOCIAL_CONNECTORS.has(e.connectorId))
      .map(e => parseTimestamp(e.timestamp));
    const newsTimestamps = sorted
      .filter(e => NEWS_CONNECTORS.has(e.connectorId))
      .map(e => parseTimestamp(e.timestamp));

    if (socialTimestamps.length > 0 && newsTimestamps.length > 0) {
      const earliestSocial = Math.min(...socialTimestamps);
      const earliestNews = Math.min(...newsTimestamps);
      const leadHours = (earliestNews - earliestSocial) / 3600000;

      if (leadHours > 2) {
        signals.push({
          type: 'social_precedes_news',
          description: `Social media reported ${leadHours.toFixed(0)}h before first news outlet — potential astroturfing or viral rumor promoted to "fact"`,
          evidence: sorted
            .filter(e => SOCIAL_CONNECTORS.has(e.connectorId))
            .map(e => e.id),
          confidence: Math.min(0.85, 0.4 + leadHours * 0.02),
        });
      }
    }

    // 3. Anonymous source convergence — multiple outlets citing unnamed sources
    const anonCiting = sorted.filter(e => {
      const text = (e.summary || '').toLowerCase();
      return /\b(unnamed source|anonymous source|person familiar|sources say|insider|people close to)\b/.test(text);
    });

    if (anonCiting.length >= 3) {
      signals.push({
        type: 'anonymous_convergence',
        description: `${anonCiting.length} sources all cite unnamed/anonymous sources — could be single leak amplified or coordinated narrative`,
        evidence: anonCiting.map(e => e.id),
        confidence: 0.5 + Math.min(0.4, anonCiting.length * 0.05),
      });
    }

    // 4. Copy-paste detection — near-identical language across different outlets
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[i].connectorId === sorted[j].connectorId) continue;
        const sim = textSimilarity(sorted[i].summary || '', sorted[j].summary || '');
        if (sim > COORDINATION_SIMILARITY) {
          signals.push({
            type: 'copy_paste',
            description: `${sorted[i].connectorId} and ${sorted[j].connectorId} share ${(sim * 100).toFixed(0)}% text overlap — copy-paste journalism or shared press release`,
            evidence: [sorted[i].id, sorted[j].id],
            confidence: Math.min(0.95, sim),
          });
        }
      }
    }

    return signals;
  }

  /**
   * Generate a text-based timeline visualization of how information spread.
   */
  visualize(propagationResult) {
    if (!propagationResult || !propagationResult.timeline || propagationResult.timeline.length === 0) {
      return '(no propagation data to visualize)';
    }

    const lines = [];
    const maxBarWidth = 20;
    let prevHours = -1;

    for (const entry of propagationResult.timeline) {
      const hours = entry.hoursAfterOrigin;
      const hourLabel = hours === 0 ? 'T+0h  ' : `T+${hours < 100 ? hours.toString().padStart(2, ' ') : hours}h `;
      const connector = `[${entry.connectorId}]`.padEnd(22);

      // Bar width: 1 for origin, more for entries that represent amplification
      const barWidth = entry.isOrigin ? 1 : Math.min(maxBarWidth, 1 + (entry.derivativeCount || 0));
      const bar = '\u25A0'.repeat(barWidth);

      const label = entry.isOrigin
        ? `ORIGIN: ${truncate(entry.summary || '(first report)', 50)}`
        : truncate(entry.summary || '', 50);

      // Only show hour separator when the gap is significant
      if (prevHours >= 0 && hours - prevHours > 12) {
        lines.push('');
      }
      prevHours = hours;

      lines.push(`${hourLabel} ${connector} ${bar} ${label}`);
    }

    lines.push('');
    lines.push(`Pattern: ${propagationResult.pattern}`);
    lines.push(`Amplification: ${propagationResult.amplificationFactor}x (${propagationResult.independentDiscoveries} root → ${propagationResult.timeline.length} total)`);
    lines.push(`Independent discoveries: ${propagationResult.independentDiscoveries}`);

    if (propagationResult.coordinationSignals.length > 0) {
      lines.push(`Coordination signals: ${propagationResult.coordinationSignals.length}`);
      for (const sig of propagationResult.coordinationSignals) {
        lines.push(`  ! ${sig.description}`);
      }
    }

    return lines.join('\n');
  }

  // ── Internal ────────────────────────────────────────────

  _temporalSort(evidence) {
    return [...evidence].sort((a, b) => {
      const tA = parseTimestamp(a.timestamp);
      const tB = parseTimestamp(b.timestamp);
      if (isNaN(tA) && isNaN(tB)) return 0;
      if (isNaN(tA)) return 1;
      if (isNaN(tB)) return -1;
      return tA - tB;
    });
  }

  _buildTimeline(sorted, origin) {
    const originTs = parseTimestamp(origin.timestamp);

    return sorted.map(e => {
      const ts = parseTimestamp(e.timestamp);
      const hoursAfter = isNaN(originTs) || isNaN(ts) ? 0 : Math.max(0, (ts - originTs) / 3600000);
      return {
        connectorId: e.connectorId,
        evidenceId: e.id,
        timestamp: e.timestamp,
        hoursAfterOrigin: Math.round(hoursAfter),
        isOrigin: e.id === origin.id,
        summary: truncate(e.summary, 100),
        derivativeCount: 0,
      };
    });
  }

  /**
   * Identify root (independent) sources. A root is either:
   *   - A primary document source
   *   - A source with low similarity to all earlier sources
   *   - A source from a different connector category that arrived
   *     significantly later (independent discovery, not echo)
   */
  _identifyRoots(sorted) {
    const roots = [];
    const seenText = [];

    for (const e of sorted) {
      if (PRIMARY_CONNECTORS.has(e.connectorId)) {
        roots.push(e);
        seenText.push(e.summary || '');
        continue;
      }

      const maxSim = seenText.reduce((max, prev) =>
        Math.max(max, textSimilarity(e.summary || '', prev)), 0);

      if (maxSim < SIMILARITY_THRESHOLD) {
        roots.push(e);
      }

      seenText.push(e.summary || '');
    }

    return roots.length > 0 ? roots : sorted.slice(0, 1);
  }

  _classifyPattern(sorted, roots, timeline) {
    if (sorted.length <= 1) {
      return PropagationPattern.SINGLE_SOURCE;
    }

    const originConnector = sorted[0].connectorId;

    // Check for primary discovery
    if (PRIMARY_CONNECTORS.has(originConnector)) {
      if (roots.length >= 3) return PropagationPattern.INDEPENDENT_CONVERGENCE;
      return PropagationPattern.PRIMARY_DISCOVERY;
    }

    // Check for social-first
    if (SOCIAL_CONNECTORS.has(originConnector)) {
      const hasLaterNews = sorted.some((e, i) =>
        i > 0 && (NEWS_CONNECTORS.has(e.connectorId) || PRIMARY_CONNECTORS.has(e.connectorId))
      );
      if (hasLaterNews) return PropagationPattern.SOCIAL_FIRST;
    }

    // Check for simultaneous burst
    const earlyWindow = sorted.filter(e => {
      const dt = parseTimestamp(e.timestamp) - parseTimestamp(sorted[0].timestamp);
      return !isNaN(dt) && dt < BURST_WINDOW_MS;
    });

    const uniqueConnectorsInBurst = new Set(earlyWindow.map(e => e.connectorId)).size;
    if (earlyWindow.length >= BURST_MIN_SOURCES && uniqueConnectorsInBurst >= 3) {
      return PropagationPattern.SIMULTANEOUS_BURST;
    }

    // Check for independent convergence
    if (roots.length >= 3) {
      return PropagationPattern.INDEPENDENT_CONVERGENCE;
    }

    // Default: gradual diffusion
    const span = timeline.length > 1
      ? timeline[timeline.length - 1].hoursAfterOrigin - timeline[0].hoursAfterOrigin
      : 0;
    if (span > 24) return PropagationPattern.GRADUAL_DIFFUSION;

    return PropagationPattern.GRADUAL_DIFFUSION;
  }

  _computeAmplification(sorted, roots) {
    if (roots.length === 0) return 0;
    return sorted.length / roots.length;
  }

  _computeTrustAdjustments(sorted, pattern, roots) {
    const adjustments = new Map();
    const baseMultiplier = TRUST_MULTIPLIERS[pattern] || 1.0;
    const rootIds = new Set(roots.map(r => r.id));

    const suspiciousPattern =
      pattern === PropagationPattern.SIMULTANEOUS_BURST ||
      pattern === PropagationPattern.SOCIAL_FIRST;

    for (const e of sorted) {
      let multiplier = baseMultiplier;

      // Root sources get a boost — but not in suspicious propagation patterns,
      // where the pattern-level penalty is the whole point
      if (rootIds.has(e.id) && !suspiciousPattern) {
        multiplier = Math.max(multiplier, 1.0);
      }

      // Primary document sources always get at least a neutral adjustment —
      // a SEC filing is a SEC filing regardless of how people react to it
      if (PRIMARY_CONNECTORS.has(e.connectorId)) {
        multiplier = Math.max(multiplier, 1.1);
      }

      // Social-only evidence in a non-social-first pattern
      if (SOCIAL_CONNECTORS.has(e.connectorId) && !suspiciousPattern) {
        multiplier = Math.min(multiplier, 0.9);
      }

      adjustments.set(e.id, round(multiplier));
    }

    return adjustments;
  }

  _findTemporalBursts(sorted) {
    const bursts = [];
    let i = 0;

    while (i < sorted.length) {
      const windowStart = parseTimestamp(sorted[i].timestamp);
      if (isNaN(windowStart)) { i++; continue; }

      const burst = [sorted[i]];
      let j = i + 1;

      while (j < sorted.length) {
        const ts = parseTimestamp(sorted[j].timestamp);
        if (isNaN(ts) || ts - windowStart > BURST_WINDOW_MS) break;
        burst.push(sorted[j]);
        j++;
      }

      if (burst.length >= 3) {
        const lastTs = parseTimestamp(burst[burst.length - 1].timestamp);
        bursts.push({
          items: burst,
          windowHours: (lastTs - windowStart) / 3600000,
        });
      }

      i = j > i + 1 ? j : i + 1;
    }

    return bursts;
  }

  _pairwiseSimilarity(items) {
    const sims = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        sims.push(textSimilarity(items[i].summary || '', items[j].summary || ''));
      }
    }
    return sims;
  }

  _generateSummary(pattern, origin, sorted, roots, amplification, coordination) {
    const parts = [];

    const patternDescriptions = {
      [PropagationPattern.PRIMARY_DISCOVERY]:
        `Information originated from a primary document (${origin.connectorId})`,
      [PropagationPattern.INDEPENDENT_CONVERGENCE]:
        `${roots.length} independent sources arrived at the same finding without apparent coordination`,
      [PropagationPattern.GRADUAL_DIFFUSION]:
        `The claim first appeared via ${origin.connectorId} and was picked up by other outlets over time`,
      [PropagationPattern.SIMULTANEOUS_BURST]:
        `${sorted.length} sources reported this within hours — characteristic of a coordinated release or press campaign`,
      [PropagationPattern.SOCIAL_FIRST]:
        `This claim appeared on social media (${origin.connectorId}) before any news outlet or primary source reported it — unverified viral information`,
      [PropagationPattern.SINGLE_SOURCE]:
        `Only one source has reported this claim, making independent verification impossible`,
    };

    parts.push(patternDescriptions[pattern] || `Propagation pattern: ${pattern}`);

    if (amplification > 5) {
      parts.push(`The amplification factor of ${amplification.toFixed(1)}x (${roots.length} root source${roots.length === 1 ? '' : 's'} → ${sorted.length} total reports) suggests significant echo-chamber effect.`);
    } else if (amplification > 1) {
      parts.push(`Amplification is moderate at ${amplification.toFixed(1)}x.`);
    }

    if (coordination.length > 0) {
      parts.push(`${coordination.length} coordination signal${coordination.length === 1 ? '' : 's'} detected, warranting closer examination of source independence.`);
    }

    if (pattern === PropagationPattern.INDEPENDENT_CONVERGENCE) {
      parts.push('Independent convergence is one of the strongest indicators of factual accuracy.');
    }

    return parts.join(' ');
  }
}

// ─── Utility ──────────────────────────────────────────────

function parseTimestamp(ts) {
  if (!ts) return NaN;
  if (typeof ts === 'number') return ts;
  const ms = new Date(ts).getTime();
  return isNaN(ms) ? NaN : ms;
}

function textSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.length / union.size;
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
}

function round(n, places = 2) {
  return Math.round(n * 10 ** places) / 10 ** places;
}

export { PropagationPattern, TRUST_MULTIPLIERS };
export default PropagationAnalyzer;
