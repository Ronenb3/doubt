/**
 * doubt — Evidence Flood Gate
 *
 * THE EFFICIENCY UPGRADE.
 *
 * Problem: OpenSky Aircraft Tracking returned 14,350 results for "Iran"
 * which is 95% of all evidence. The Bayesian engine then grinds through
 * 14,000 aircraft transponder records, each one slightly shifting the
 * posterior. The investigation takes 10 minutes and the result is noise.
 *
 * Solution: Cap evidence PER CONNECTOR with intelligent pruning.
 * High-trust sources get more slots. Low-trust sources get fewer.
 * Within each connector's allocation, keep the most diverse and
 * highest-quality items.
 *
 * This runs BEFORE relevance filtering, dedup, and classification.
 *
 * Rules:
 *   - No single connector may contribute >15% of total evidence
 *   - Hard cap per connector based on trust tier:
 *       PRIMARY_DOCUMENT/GOVERNMENT: 100 items
 *       ACADEMIC/FINANCIAL: 75 items
 *       NEWS: 50 items
 *       SOCIAL: 25 items
 *   - When pruning: keep items with the most unique URLs/titles
 *   - Global cap: 3000 items total (after per-connector caps)
 */

import { log } from '../core/config.js';

const TIER_CAPS = {
  1.0:  100,  // PRIMARY_DOCUMENT
  0.95: 100,  // GOVERNMENT_FILING
  0.90: 100,  // COURT_RECORD
  0.85: 75,   // FINANCIAL_DATA
  0.80: 75,   // ACADEMIC_PEER
  0.70: 60,   // custom (e.g. geopolitical)
  0.65: 50,   // NEWS_MAJOR
  0.50: 40,   // NEWS_MINOR
  0.30: 25,   // SOCIAL_MEDIA
};

const GLOBAL_CAP = 3000;
const MAX_CONNECTOR_SHARE = 0.15; // no single connector > 15%

export class FloodGate {
  /**
   * Cap evidence per connector and globally.
   *
   * @param {Object[]} evidence - raw evidence array
   * @returns {{ capped: Object[], stats: Object }}
   */
  cap(evidence) {
    if (!evidence?.length) return { capped: [], stats: { total: 0, capped: 0 } };

    const byConnector = new Map();
    for (const e of evidence) {
      const cid = e.connectorId || 'unknown';
      if (!byConnector.has(cid)) byConnector.set(cid, []);
      byConnector.get(cid).push(e);
    }

    const result = [];
    const stats = {
      total: evidence.length,
      capped: 0,
      cappedConnectors: [],
    };

    // Phase 1: Per-connector caps
    const dynamicMaxPerConnector = Math.ceil(evidence.length * MAX_CONNECTOR_SHARE);

    for (const [cid, items] of byConnector) {
      // Determine tier cap
      const sampleTrust = items[0]?.trustWeight ?? 0.5;
      const tierCap = this._getTierCap(sampleTrust);
      const cap = Math.min(tierCap, dynamicMaxPerConnector);

      if (items.length <= cap) {
        result.push(...items);
      } else {
        // Prune: keep most diverse items
        const kept = this._selectDiverse(items, cap);
        result.push(...kept);
        const dropped = items.length - kept.length;
        stats.capped += dropped;
        stats.cappedConnectors.push({ id: cid, original: items.length, kept: kept.length });
        log('info', `flood-gate: ${cid} capped ${items.length} → ${kept.length} (trust=${sampleTrust.toFixed(2)})`);
      }
    }

    // Phase 2: Global cap
    if (result.length > GLOBAL_CAP) {
      // Sort by trust weight descending, keep top N
      result.sort((a, b) => (b.trustWeight || 0) - (a.trustWeight || 0));
      const globalDropped = result.length - GLOBAL_CAP;
      result.length = GLOBAL_CAP;
      stats.capped += globalDropped;
      log('info', `flood-gate: global cap applied, ${globalDropped} additional items dropped`);
    }

    if (stats.capped > 0) {
      log('info', `flood-gate: ${evidence.length} → ${result.length} (${stats.capped} flood items removed)`);
    }

    return { capped: result, stats };
  }

  _getTierCap(trustWeight) {
    // Find closest tier
    let bestCap = 50;
    let bestDist = Infinity;
    for (const [tier, cap] of Object.entries(TIER_CAPS)) {
      const dist = Math.abs(parseFloat(tier) - trustWeight);
      if (dist < bestDist) {
        bestDist = dist;
        bestCap = cap;
      }
    }
    return bestCap;
  }

  _selectDiverse(items, cap) {
    // Score each item: unique URL + unique title words + trust weight
    const scored = items.map(item => {
      const urlScore = item.sourceUrl ? 1 : 0;
      const trust = item.trustWeight || 0.5;
      const titleLen = (item.summary || item.data?.title || '').length;
      return { item, score: trust * 10 + urlScore * 2 + Math.min(titleLen / 100, 1) };
    });

    // Sort by score descending, take top cap
    scored.sort((a, b) => b.score - a.score);

    // But also ensure URL diversity — don't keep 50 items all from the same domain
    const kept = [];
    const domainCounts = new Map();
    const domainCap = Math.ceil(cap * 0.3); // no domain > 30% of kept items

    for (const { item } of scored) {
      if (kept.length >= cap) break;

      const domain = this._extractDomain(item.sourceUrl || item.url || '');
      const domainCount = domainCounts.get(domain) || 0;

      if (domain && domainCount >= domainCap) continue; // skip over-represented domain
      kept.push(item);
      domainCounts.set(domain, domainCount + 1);
    }

    // If we couldn't fill the cap due to domain limits, fill from remaining
    if (kept.length < cap) {
      const keptIds = new Set(kept.map(e => e.id));
      for (const { item } of scored) {
        if (kept.length >= cap) break;
        if (!keptIds.has(item.id)) {
          kept.push(item);
          keptIds.add(item.id);
        }
      }
    }

    return kept;
  }

  _extractDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }
}

export default FloodGate;
