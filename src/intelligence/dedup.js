/**
 * doubt — Evidence Deduplication
 *
 * Multiple connectors return the same underlying information.
 * "Tesla recall 23V-838" appears from Federal Register, NHTSA,
 * Reuters, Reddit, and three news aggregators. The Bayesian
 * engine treats each as independent evidence — seven data points
 * when there's really one fact. This inflates confidence and
 * masks the fragility of the conclusion.
 *
 * Three dedup strategies, applied in sequence:
 *   1. URL dedup — identical sourceUrl = identical evidence
 *   2. Content similarity — Jaccard on bigrams of summaries
 *   3. Same-fact merge — different connectors, same entity + fact
 *      → keep as one evidence item with boosted trust
 */

import { log } from '../core/config.js';

const JACCARD_THRESHOLD = 0.6;

export class Deduplicator {

  /**
   * Remove near-duplicate evidence items.
   *
   * @param {Array} evidence - full evidence array
   * @returns {{ unique: Array, duplicatesRemoved: number, mergedCount: number, stats: object }}
   */
  deduplicate(evidence) {
    if (!evidence || evidence.length === 0) {
      return { unique: [], duplicatesRemoved: 0, mergedCount: 0, stats: this._emptyStats() };
    }

    const startLen = evidence.length;

    // Strategy 1: URL dedup
    const afterUrl = this._urlDedup(evidence);
    const urlDupsRemoved = startLen - afterUrl.length;

    // Strategy 2: Content similarity (bigram Jaccard)
    const { kept: afterContent, clusters: contentClusters } = this._contentDedup(afterUrl);
    const contentDupsRemoved = afterUrl.length - afterContent.length;

    // Strategy 3: Same-fact merge (cross-connector confirmation)
    const { items: final, mergedCount, mergeClusters } = this._sameFactMerge(afterContent);

    const duplicatesRemoved = urlDupsRemoved + contentDupsRemoved;

    const mostDuplicated = this._findMostDuplicated(contentClusters, mergeClusters);

    const stats = {
      inputSize: startLen,
      outputSize: final.length,
      urlDuplicates: urlDupsRemoved,
      contentDuplicates: contentDupsRemoved,
      mergedCrossConnector: mergedCount,
      duplicateClusters: contentClusters.length + mergeClusters.length,
      mostDuplicated,
      dedupRatio: startLen > 0
        ? Math.round((1 - final.length / startLen) * 1000) / 1000
        : 0,
    };

    log('info', `Dedup: ${startLen} → ${final.length} evidence (${duplicatesRemoved} duplicates removed, ${mergedCount} cross-connector merges)`);

    return { unique: final, duplicatesRemoved, mergedCount, stats };
  }

  // ── Strategy 1: URL Dedup ────────────────────────────────

  _urlDedup(evidence) {
    const seen = new Map();

    for (const item of evidence) {
      const url = item.sourceUrl;
      if (!url) {
        const key = `__nourl__${item.connectorId}__${(item.summary || '').slice(0, 100)}`;
        if (!seen.has(key)) seen.set(key, item);
        continue;
      }

      const normalized = this._normalizeUrl(url);
      const existing = seen.get(normalized);
      if (!existing || (item.trustWeight || 0) > (existing.trustWeight || 0)) {
        seen.set(normalized, item);
      }
    }

    return [...seen.values()];
  }

  // ── Strategy 2: Content Similarity ───────────────────────

  _contentDedup(evidence) {
    if (evidence.length <= 1) return { kept: [...evidence], clusters: [] };

    const bigramSets = evidence.map(item => this._bigrams(this._getText(item)));
    const removed = new Set();
    const clusters = [];

    for (let i = 0; i < evidence.length; i++) {
      if (removed.has(i)) continue;
      const cluster = [i];

      for (let j = i + 1; j < evidence.length; j++) {
        if (removed.has(j)) continue;
        if (bigramSets[i].size === 0 && bigramSets[j].size === 0) continue;

        const sim = this._jaccardSimilarity(bigramSets[i], bigramSets[j]);
        if (sim > JACCARD_THRESHOLD) {
          cluster.push(j);
          removed.add(j);
        }
      }

      if (cluster.length > 1) {
        clusters.push(cluster.map(idx => ({
          connectorId: evidence[idx].connectorId,
          summary: (evidence[idx].summary || '').slice(0, 80),
        })));
      }
    }

    const kept = evidence.filter((_, idx) => !removed.has(idx));
    return { kept, clusters };
  }

  // ── Strategy 3: Same-Fact Merge ──────────────────────────

  /**
   * When different connectors report the same fact about the same entity,
   * merge into one evidence item with boosted trust (independent confirmation).
   */
  _sameFactMerge(evidence) {
    const factKeys = new Map();
    const mergeClusters = [];
    let mergedCount = 0;

    for (const item of evidence) {
      const key = this._extractFactKey(item);
      if (!key) continue;

      if (!factKeys.has(key)) {
        factKeys.set(key, [item]);
      } else {
        factKeys.get(key).push(item);
      }
    }

    const mergedIds = new Set();
    const mergedItems = [];

    for (const [key, group] of factKeys) {
      if (group.length < 2) continue;

      const connectors = new Set(group.map(e => e.connectorId));
      if (connectors.size < 2) continue;

      group.sort((a, b) => (b.trustWeight || 0) - (a.trustWeight || 0));
      const primary = group[0];

      const confirmationBoost = Math.min(0.15, (connectors.size - 1) * 0.05);
      primary.trustWeight = Math.min(1.0, (primary.trustWeight || 0.5) + confirmationBoost);

      primary._mergedSources = group.map(e => ({
        connectorId: e.connectorId,
        sourceUrl: e.sourceUrl,
        trustWeight: e.trustWeight,
      }));
      primary._independentConfirmations = connectors.size;

      for (const item of group) {
        mergedIds.add(item.id || item.sourceUrl || item.summary);
      }
      mergedIds.delete(primary.id || primary.sourceUrl || primary.summary);

      mergedItems.push(primary);
      mergedCount += group.length - 1;

      mergeClusters.push({
        factKey: key,
        connectors: [...connectors],
        count: group.length,
      });
    }

    const items = [];
    for (const item of evidence) {
      const itemKey = item.id || item.sourceUrl || item.summary;
      if (mergedIds.has(itemKey)) continue;

      const factKey = this._extractFactKey(item);
      if (factKey && factKeys.has(factKey) && factKeys.get(factKey).length >= 2) {
        const connectors = new Set(factKeys.get(factKey).map(e => e.connectorId));
        if (connectors.size >= 2 && factKeys.get(factKey)[0] === item) {
          items.push(item);
        } else if (connectors.size < 2) {
          items.push(item);
        }
      } else {
        items.push(item);
      }
    }

    return { items, mergedCount, mergeClusters };
  }

  // ── Utilities ──────────────────────────────────────────

  _normalizeUrl(url) {
    try {
      const u = new URL(url);
      u.hash = '';
      u.searchParams.delete('utm_source');
      u.searchParams.delete('utm_medium');
      u.searchParams.delete('utm_campaign');
      u.searchParams.delete('ref');
      return u.toString().replace(/\/+$/, '');
    } catch {
      return url.toLowerCase().replace(/\/+$/, '');
    }
  }

  _getText(item) {
    return [item.summary || '', item.data?.title || ''].join(' ').toLowerCase();
  }

  _bigrams(text) {
    const words = text.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1);
    const set = new Set();
    for (let i = 0; i < words.length - 1; i++) {
      set.add(`${words[i]} ${words[i + 1]}`);
    }
    return set;
  }

  _jaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 0;
    let intersection = 0;
    const smaller = setA.size <= setB.size ? setA : setB;
    const larger = setA.size <= setB.size ? setB : setA;
    for (const item of smaller) {
      if (larger.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Extract a canonical "fact key" from evidence for same-fact detection.
   * Looks for identifiers (recall numbers, case IDs, filing numbers)
   * combined with entity references.
   */
  _extractFactKey(item) {
    const text = this._getText(item);

    const idPatterns = [
      /\b(\d{2}[A-Z]-\d{3,})\b/,         // NHTSA recall: 23V-838
      /\b(case[:\s]*\d[\w-]+)\b/i,         // court case numbers
      /\b(\d{4}-\d{5,})\b/,               // SEC filing IDs
      /\b(CVE-\d{4}-\d+)\b/,              // CVE identifiers
      /\b(US\d{7,}[A-Z]\d?)\b/,           // US patent numbers
      /\b(DOI:\s*10\.\d{4,}\/\S+)\b/i,    // DOI references
    ];

    for (const pattern of idPatterns) {
      const match = text.match(pattern);
      if (match) return match[1].toLowerCase();
    }

    return null;
  }

  _findMostDuplicated(contentClusters, mergeClusters) {
    const all = [
      ...contentClusters.map(c => ({ type: 'content', size: c.length, sample: c[0]?.summary || '' })),
      ...mergeClusters.map(c => ({ type: 'cross-connector', size: c.count, sample: c.factKey || '' })),
    ];
    all.sort((a, b) => b.size - a.size);
    return all.slice(0, 5);
  }

  _emptyStats() {
    return {
      inputSize: 0,
      outputSize: 0,
      urlDuplicates: 0,
      contentDuplicates: 0,
      mergedCrossConnector: 0,
      duplicateClusters: 0,
      mostDuplicated: [],
      dedupRatio: 0,
    };
  }
}

export default Deduplicator;
