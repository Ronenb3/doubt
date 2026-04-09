/**
 * doubt — Evidence Relevance Scorer
 *
 * The noise problem: 82 connectors return 700 evidence items,
 * but most are irrelevant. PubMed returns pineapple yogurt papers
 * when investigating Tesla safety. Federal Register returns
 * unrelated commodity rules. Without filtering, the Bayesian
 * engine treats noise as signal — and every conclusion becomes
 * garbage.
 *
 * This module scores every evidence item 0-1 against the query
 * and its extracted entities. Anything below threshold gets dropped
 * before it can poison inference.
 *
 * Scoring dimensions:
 *   1. Term overlap (TF-IDF-like)  — 0.30 weight
 *   2. Entity overlap              — 0.30 weight
 *   3. Domain match                — 0.20 weight
 *   4. Title/keyword specificity   — 0.20 weight
 */

import { log } from '../core/config.js';

const STOP_WORDS = new Set([
  'the', 'is', 'a', 'an', 'for', 'to', 'of', 'in', 'on', 'by', 'with',
  'that', 'this', 'are', 'was', 'were', 'be', 'been', 'being', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'can', 'shall', 'it', 'its', 'i', 'you', 'we', 'they',
  'he', 'she', 'their', 'my', 'your', 'our', 'his', 'her',
]);

const DOMAIN_CONNECTOR_MAP = {
  safety:              ['nhtsa', 'cfpb', 'enforcement', 'fbi', 'interpol', 'courtlistener', 'federal_register'],
  financial:           ['sec_edgar', 'sec_xbrl', 'sec_insider', 'deep_sec', 'finra', 'fdic', 'polygon_market', 'market_intelligence', 'fred', 'bls', 'stocktwits', 'usaspending'],
  legal:               ['courtlistener', 'pacer', 'state_courts', 'enforcement'],
  autonomous_vehicles: ['nhtsa', 'patents', 'arxiv', 'openalex', 'courtlistener', 'federal_register'],
  corporate:           ['sec_edgar', 'opencorporates', 'courtlistener', 'federal_register', 'cfpb'],
  medical:             ['pubmed', 'clinical_trials', 'openalex'],
  ip:                  ['patents', 'opencorporates'],
  regulatory:          ['federal_register', 'congressional_record', 'government', 'sam_gov', 'nhtsa', 'usaspending'],
  compliance:          ['ofac', 'opensanctions', 'international_sanctions', 'finra', 'otx'],
  environment:         ['federal_register', 'world_bank', 'government'],
  political:           ['fec', 'congressional_record', 'lobbying', 'government', 'usaspending'],
  geopolitical:        ['gdelt', 'geopolitical', 'news_intel', 'international_sanctions', 'opensanctions', 'ofac', 'icij', 'pep', 'world_bank', 'interpol', 'media', 'news_archive', 'government', 'rss_news', 'searxng', 'brave_news', 'gnews', 'currents', 'nominatim', 'intelx'],
  sanctions:           ['ofac', 'opensanctions', 'international_sanctions', 'icij', 'pep', 'interpol', 'fbi'],
  news:                ['rss_news', 'searxng', 'brave_news', 'gnews', 'currents', 'gdelt', 'news_intel', 'media', 'news_archive'],
  security:            ['otx', 'shodan', 'intelx', 'fbi', 'interpol', 'enforcement', 'crt_sh'],
  osint:               ['intelx', 'shodan', 'otx', 'icij', 'pep', 'opencorporates'],
  // memory: always enriched with GraphRAG — past investigations + entity graph
  memory:              ['graphrag_memory'],
  // general fallback includes graphrag_memory so every investigation gets prior context
  general:             ['graphrag_memory', 'rss_news', 'searxng'],
};

// High-authority connectors get a minimum relevance floor —
// evidence from government/court sources should never be dropped if it mentions query entities
const HIGH_AUTHORITY_CONNECTORS = new Set([
  'nhtsa', 'federal_register', 'courtlistener', 'sec_edgar', 'cfpb', 'pacer', 'usaspending',
]);

// Major news sources — high-quality reporting for geopolitical, political, and news domains
const NEWS_MAJOR_CONNECTORS = new Set([
  'guardian', 'reuters', 'apnews', 'bbc', 'ft', 'economist', 'bbc_news',
  'cnn', 'bbc_world', 'nyt', 'wapo', 'wsj',
]);

// Recency-first connectors — in recencyMode, items from these are guaranteed to pass if they have any term overlap
const RECENCY_CONNECTORS = new Set(['rss_news', 'searxng', 'brave_news', 'gnews', 'currents', 'reddit', 'gdelt']);

/**
 * Compute freshness multiplier for recency-mode queries.
 * Items published very recently get a large score boost.
 * Old items get a slight penalty (you asked "right now", not "historically").
 *
 * @param {string|null} timestamp - ISO timestamp of the evidence item
 * @returns {number} multiplier to apply to base relevance score
 */
function freshnessMultiplier(timestamp) {
  if (!timestamp) return 1.0;
  try {
    const ageHours = (Date.now() - new Date(timestamp).getTime()) / 3_600_000;
    if (ageHours < 0)    return 1.0;   // future timestamp (clock skew)
    if (ageHours < 6)    return 5.0;   // < 6h: breaking news — huge boost
    if (ageHours < 24)   return 3.5;   // < 24h: same day
    if (ageHours < 48)   return 2.0;   // yesterday
    if (ageHours < 168)  return 1.3;   // past week
    if (ageHours < 720)  return 1.0;   // past month: neutral
    return 0.8;                         // older: slight penalty in recency queries
  } catch {
    return 1.0;
  }
}

export class RelevanceScorer {

  /**
   * Score every evidence item for relevance to the query.
   *
   * @param {Array} evidence - raw evidence array from HUNT phase
   * @param {string} query - original user query
   * @param {object} entities - from query planner: { companies, people, tickers, products, topics, domains }
   * @returns {Array} evidence with _relevanceScore attached
   */
  score(evidence, query, entities = {}) {
    if (!evidence || evidence.length === 0) return [];
    if (!query) return evidence;

    const queryTerms = this._extractTerms(query);
    const entityNames = this._flattenEntities(entities);
    const domainConnectors = this._buildDomainConnectorSet(entities.domains || []);
    const specificTerms = this._extractSpecificTerms(entities);

    for (const item of evidence) {
      const text = this._getSearchableText(item);
      const textLower = text.toLowerCase();

      const termScore = this._termOverlap(queryTerms, textLower);
      const entityScore = this._entityOverlap(entityNames, textLower);
      const domainScore = this._domainMatch(item.connectorId, domainConnectors);
      const specificityScore = this._specificityMatch(specificTerms, textLower);

      let score = termScore * 0.30 +
        entityScore * 0.30 +
        domainScore * 0.20 +
        specificityScore * 0.20;

      // Authority floor: if a high-authority source mentions ANY query entity,
      // ensure it passes the relevance threshold. A court case mentioning "Tesla"
      // should never be dropped.
      if (HIGH_AUTHORITY_CONNECTORS.has(item.connectorId) && entityScore > 0) {
        score = Math.max(score, 0.30);
      }

      // News source boost: major news outlets get 1.4x multiplier for geopolitical/political/news domains
      // Prevents news from being under-weighted vs social media in international affairs queries
      if (NEWS_MAJOR_CONNECTORS.has(item.connectorId)) {
        const isGeopoliticalDomain = (entities.domains || []).some(d =>
          ['geopolitical', 'political', 'news', 'sanctions', 'energy'].includes(d)
        );
        if (isGeopoliticalDomain) {
          score *= 1.4;  // Boost credible news sources for these domains
        }
      }

      // Freshness multiplier: in recency-mode queries, boost recent items dramatically.
      // "What is happening right now" should rank today's articles above all else.
      if (entities.recencyMode) {
        const multiplier = freshnessMultiplier(item.timestamp);
        score *= multiplier;
        // Recency connectors with ANY term overlap get a floor to prevent filter-drop
        if (RECENCY_CONNECTORS.has(item.connectorId) && termScore > 0) {
          score = Math.max(score, 0.35);
        }
      }

      item._relevanceScore = Math.min(1, Math.max(0, score));
    }

    return evidence;
  }

  /**
   * Score and filter evidence. Drop anything below threshold.
   * Includes catastrophic-drop protection: if the filter would drop >90%
   * of evidence, it relaxes the threshold progressively rather than
   * returning nothing.
   *
   * @param {Array} evidence
   * @param {string} query
   * @param {object} entities
   * @param {number} threshold - minimum relevance to keep (default 0.25)
   * @returns {{ kept: Array, dropped: Array, stats: object }}
   */
  filter(evidence, query, entities = {}, threshold = 0.25) {
    this.score(evidence, query, entities);

    const entityNames = this._flattenEntities(entities);

    // ── Catastrophic-drop protection ──────────────────────
    // If >90% of evidence scores below threshold, the threshold is too strict
    // for this query/entity combination. Progressively relax it.
    const aboveThreshold = evidence.filter(e => e._relevanceScore >= threshold).length;
    let effectiveThreshold = threshold;

    if (evidence.length > 10 && aboveThreshold < evidence.length * 0.10) {
      // Try progressively lower thresholds
      for (const fallback of [0.15, 0.10, 0.05, 0.01]) {
        const count = evidence.filter(e => e._relevanceScore >= fallback).length;
        if (count >= Math.min(evidence.length * 0.15, 30)) {
          effectiveThreshold = fallback;
          log('warn', `Relevance: threshold ${threshold} would drop ${evidence.length - aboveThreshold}/${evidence.length} — relaxed to ${fallback} (keeps ${count})`);
          break;
        }
      }
      // If even 0.01 keeps nothing, keep the top 20% by score rather than losing everything
      if (evidence.filter(e => e._relevanceScore >= effectiveThreshold).length === 0) {
        const sorted = [...evidence].sort((a, b) => b._relevanceScore - a._relevanceScore);
        const topN = Math.max(10, Math.floor(evidence.length * 0.20));
        const cutoff = sorted[Math.min(topN - 1, sorted.length - 1)]?._relevanceScore || 0;
        effectiveThreshold = cutoff;
        log('warn', `Relevance: all thresholds failed — keeping top ${topN} items (score >= ${cutoff.toFixed(3)})`);
      }
    }

    const kept = [];
    const dropped = [];

    for (const item of evidence) {
      if (item._relevanceScore >= effectiveThreshold) {
        // Borderline items from non-authority sources need entity presence
        if (item._relevanceScore < effectiveThreshold + 0.05 && !HIGH_AUTHORITY_CONNECTORS.has(item.connectorId)) {
          const text = this._getSearchableText(item).toLowerCase();
          const hasEntity = entityNames.some(e => text.includes(e.toLowerCase()));
          if (!hasEntity && effectiveThreshold >= 0.15) {
            // Only apply entity check at normal thresholds, not emergency fallbacks
            dropped.push(item);
            continue;
          }
        }
        kept.push(item);
      } else {
        dropped.push(item);
      }
    }

    const connectorCounts = {};
    for (const item of kept) {
      connectorCounts[item.connectorId] = (connectorCounts[item.connectorId] || 0) + 1;
    }
    const topConnectors = Object.entries(connectorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ id, count }));

    const avgRelevance = kept.length > 0
      ? kept.reduce((sum, e) => sum + e._relevanceScore, 0) / kept.length
      : 0;

    const stats = {
      total: evidence.length,
      kept: kept.length,
      dropped: dropped.length,
      avgRelevance: Math.round(avgRelevance * 1000) / 1000,
      topConnectors,
    };

    log('info', `Relevance filter: ${stats.kept}/${stats.total} kept (${stats.dropped} dropped, avg relevance ${stats.avgRelevance})`);

    return { kept, dropped, stats };
  }

  /**
   * Sort evidence by relevance score descending.
   * Attaches _relevanceScore if not already present.
   */
  rankByRelevance(evidence) {
    return [...evidence].sort((a, b) =>
      (b._relevanceScore || 0) - (a._relevanceScore || 0)
    );
  }

  // ── Scoring Components ─────────────────────────────────

  /**
   * Step 1: Term overlap — how many query terms appear in the evidence text.
   * Returns 0-1 based on fraction of query terms matched.
   */
  _termOverlap(queryTerms, textLower) {
    if (queryTerms.length === 0) return 0;
    let matched = 0;
    for (const term of queryTerms) {
      if (textLower.includes(term)) matched++;
    }
    return matched / queryTerms.length;
  }

  /**
   * Step 2: Entity overlap — each matched entity adds 0.15 bonus, capped at 0.45.
   * Normalized to 0-1 range.
   */
  _entityOverlap(entityNames, textLower) {
    if (entityNames.length === 0) return 0;
    let bonus = 0;
    for (const name of entityNames) {
      if (textLower.includes(name)) {
        bonus += 0.15;
      }
    }
    return Math.min(bonus, 0.45) / 0.45;
  }

  /**
   * Step 3: Domain match — does this connector serve the query's domains?
   */
  _domainMatch(connectorId, domainConnectors) {
    if (!connectorId || domainConnectors.size === 0) return 0.5;
    return domainConnectors.has(connectorId) ? 1.0 : 0.3;
  }

  /**
   * Step 4: Title/keyword specificity — exact product names, technical terms,
   * specific company references. Each match = 0.1 bonus, capped at 1.0.
   */
  _specificityMatch(specificTerms, textLower) {
    if (specificTerms.length === 0) return 0;
    let bonus = 0;
    for (const term of specificTerms) {
      if (textLower.includes(term)) {
        bonus += 0.1;
      }
    }
    return Math.min(bonus, 1.0);
  }

  // ── Helpers ────────────────────────────────────────────

  _extractTerms(query) {
    return query
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !STOP_WORDS.has(t));
  }

  _flattenEntities(entities) {
    const names = [];
    // Structured entities — added as full phrases
    for (const key of ['companies', 'people', 'tickers', 'products']) {
      const arr = entities[key];
      if (Array.isArray(arr)) {
        for (const name of arr) {
          if (name && name.length > 2) names.push(name.toLowerCase());
        }
      }
    }
    // Individual keyword tokens — single terms extracted from the query (country names, concepts)
    if (Array.isArray(entities.keywords)) {
      for (const kw of entities.keywords) {
        if (kw && kw.length >= 4) names.push(kw.toLowerCase());
      }
    }
    return names;
  }

  _buildDomainConnectorSet(domains) {
    const set = new Set();
    for (const domain of domains) {
      const connectors = DOMAIN_CONNECTOR_MAP[domain];
      if (connectors) {
        for (const c of connectors) set.add(c);
      }
    }
    return set;
  }

  _extractSpecificTerms(entities) {
    const terms = [];
    for (const key of ['products', 'companies', 'people', 'tickers']) {
      const arr = entities[key];
      if (Array.isArray(arr)) {
        for (const name of arr) {
          if (name && name.length > 2) terms.push(name.toLowerCase());
        }
      }
    }
    for (const topic of (entities.topics || [])) {
      const words = topic.split(/\s+/);
      if (words.length >= 2) terms.push(topic.toLowerCase());
    }
    return terms;
  }

  _getSearchableText(item) {
    const parts = [item.summary || ''];
    if (item.data?.title) parts.push(item.data.title);
    if (item.data?.description) parts.push(item.data.description);
    if (item.sourceUrl) parts.push(item.sourceUrl);
    return parts.join(' ');
  }
}

export default RelevanceScorer;
