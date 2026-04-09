/**
 * doubt — Query Feedback Loop
 *
 * Makes round 2 learn from round 1. After the primary search round,
 * analyze what was found and generate BETTER queries for the next round.
 *
 * Before this: round 2 was just a wider version of round 1.
 * After this: round 2 targets gaps, follows leads, and searches for
 * specific entities/events discovered in round 1.
 *
 * This is how a real investigator works: find something, then dig deeper.
 */

import { log } from './config.js';

export class QueryFeedback {

  /**
   * Given evidence from round 1, generate refined queries for round 2.
   *
   * @param {Object[]} evidence - evidence gathered so far
   * @param {string}   query   - original query
   * @param {Object}   plan    - original search plan
   * @returns {Object} refinedQueries - { connectorId: string[] } map of new queries
   */
  refine(evidence, query, plan) {
    if (!evidence?.length) return {};

    const refinedQueries = {};

    // Strategy 1: Extract specific identifiers found in evidence → targeted follow-up
    const ids = this._extractIdentifiers(evidence);
    if (ids.recallNumbers.length > 0) {
      this._addQueries(refinedQueries, 'nhtsa', ids.recallNumbers.map(r => `recall ${r}`));
      this._addQueries(refinedQueries, 'federal_register', ids.recallNumbers.map(r => r));
    }
    if (ids.caseNumbers.length > 0) {
      this._addQueries(refinedQueries, 'courtlistener', ids.caseNumbers);
      this._addQueries(refinedQueries, 'pacer', ids.caseNumbers);
    }
    if (ids.patentNumbers.length > 0) {
      this._addQueries(refinedQueries, 'patents', ids.patentNumbers);
    }
    if (ids.secFilings.length > 0) {
      this._addQueries(refinedQueries, 'sec_edgar', ids.secFilings);
    }

    // Strategy 2: Extract named entities not in original query → explore connections
    const queryLower = query.toLowerCase();
    const newEntities = this._extractNewEntities(evidence, queryLower);
    if (newEntities.length > 0) {
      for (const entity of newEntities.slice(0, 5)) {
        this._addQueries(refinedQueries, 'duckduckgo', [`${entity} ${queryLower.split(' ').slice(0, 3).join(' ')}`]);
        this._addQueries(refinedQueries, 'reddit', [`${entity}`]);
      }
    }

    // Strategy 3: Follow contradictions → dig deeper into contested points
    const contradicting = evidence.filter(e => e.type === 'contradicts');
    if (contradicting.length > 0) {
      const contraTerms = this._extractKeyTerms(contradicting, queryLower);
      for (const term of contraTerms.slice(0, 3)) {
        this._addQueries(refinedQueries, 'hackernews', [term]);
        this._addQueries(refinedQueries, 'wikipedia', [term]);
        this._addQueries(refinedQueries, 'media', [term]);
      }
    }

    // Strategy 4: Fill source gaps — if important source types returned nothing, retry with different terms
    const respondedConnectors = new Set(evidence.map(e => e.connectorId));
    const criticalMissing = ['nhtsa', 'courtlistener', 'sec_edgar', 'openalex', 'pubmed']
      .filter(c => !respondedConnectors.has(c));

    for (const connector of criticalMissing) {
      // Generate simpler, broader queries for failed connectors
      const simpleTerms = query.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(t => t.length > 3)
        .slice(0, 2);
      if (simpleTerms.length > 0) {
        this._addQueries(refinedQueries, connector, [simpleTerms.join(' ')]);
      }
    }

    const totalNew = Object.values(refinedQueries).reduce((s, q) => s + q.length, 0);
    if (totalNew > 0) {
      log('info', `feedback: generated ${totalNew} refined queries across ${Object.keys(refinedQueries).length} connectors`);
    }

    return refinedQueries;
  }

  _extractIdentifiers(evidence) {
    const ids = {
      recallNumbers: [],
      caseNumbers: [],
      patentNumbers: [],
      secFilings: [],
    };

    for (const ev of evidence) {
      const text = ev.summary || '';

      // NHTSA recall numbers: pattern like 23V-838, 24V-123
      const recalls = text.match(/\d{2}V[-–]?\d{3,6}/g);
      if (recalls) ids.recallNumbers.push(...recalls);

      // Court case numbers: pattern like 1:23-cv-01234
      const cases = text.match(/\d+:\d{2}-[a-z]{2,3}-\d{4,6}/gi);
      if (cases) ids.caseNumbers.push(...cases);

      // Patent numbers: US1234567, US 11,123,456
      const patents = text.match(/US\s*[\d,]{7,12}/g);
      if (patents) ids.patentNumbers.push(...patents);

      // SEC filings: 10-K, 10-Q, 8-K
      const sec = text.match(/\b(10-[KQ]|8-K|DEF 14A|S-1)\b/gi);
      if (sec) ids.secFilings.push(...sec);
    }

    // Deduplicate
    for (const key of Object.keys(ids)) {
      ids[key] = [...new Set(ids[key])].slice(0, 5);
    }
    return ids;
  }

  _extractNewEntities(evidence, queryLower) {
    const entities = new Map();
    const queryWords = new Set(queryLower.split(/\s+/));

    for (const ev of evidence) {
      const text = ev.summary || '';
      // Extract capitalized multi-word phrases
      const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g);
      if (!matches) continue;

      for (const m of matches) {
        const lower = m.toLowerCase();
        if (queryWords.has(lower) || lower.length < 5) continue;
        entities.set(lower, (entities.get(lower) || 0) + 1);
      }
    }

    // Return entities that appear in 2+ evidence items (likely important)
    return [...entities.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }

  _extractKeyTerms(evidence, queryLower) {
    const termFreq = new Map();
    const queryTerms = new Set(queryLower.split(/\s+/).filter(t => t.length > 3));

    for (const ev of evidence) {
      const words = (ev.summary || '').toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 4 && !queryTerms.has(w));
      for (const w of words) {
        termFreq.set(w, (termFreq.get(w) || 0) + 1);
      }
    }

    return [...termFreq.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([term]) => `${term} ${[...queryTerms].slice(0, 2).join(' ')}`);
  }

  _addQueries(map, connectorId, queries) {
    if (!map[connectorId]) map[connectorId] = [];
    for (const q of queries) {
      if (!map[connectorId].includes(q)) {
        map[connectorId].push(q);
      }
    }
  }
}

export default QueryFeedback;
