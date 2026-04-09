/**
 * doubt — Entity Extractor
 *
 * Heuristic NLP entity extraction: people, organizations,
 * locations, financial instruments, concepts.
 * Includes fuzzy deduplication for name resolution.
 */

import { createEntity, EntityType } from '../core/schema.js';
import { log } from '../core/config.js';

const PERSON_TITLES = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'president', 'ceo', 'cfo', 'cto',
  'coo', 'director', 'chairman', 'chairwoman', 'senator', 'governor',
  'representative', 'judge', 'justice', 'general', 'admiral', 'captain',
  'officer', 'minister', 'secretary', 'ambassador', 'mayor', 'coach',
  'reverend', 'father', 'brother', 'sister', 'rabbi', 'imam',
]);

const ORG_SUFFIXES = new Set([
  'inc', 'llc', 'corp', 'ltd', 'co', 'plc', 'gmbh', 'ag', 'sa',
  'group', 'holdings', 'partners', 'associates', 'foundation',
  'institute', 'university', 'council', 'commission', 'committee',
  'corporation', 'company', 'limited', 'incorporated',
]);

const LOCATION_SIGNALS = /\b(?:based\s+in|headquartered\s+in|located\s+in|born\s+in|lives?\s+in|moved\s+to|traveled?\s+to|from|city\s+of|state\s+of|country|province|region)\s+/i;

const TICKER_PATTERN = /\b[A-Z]{1,5}(?=\s*(?:\(|stock|shares?|trades?|price|market))/;
const DOLLAR_PATTERN = /\$[\d,.]+\s*(?:billion|million|thousand|[BMKbmk])\b/i;

const STOP_WORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'When', 'Where', 'Which',
  'While', 'What', 'How', 'But', 'And', 'For', 'With', 'From', 'Into',
  'After', 'Before', 'During', 'Between', 'About', 'Under', 'Over',
  'Also', 'However', 'Moreover', 'Furthermore', 'Meanwhile', 'According',
  'Based', 'According', 'Instead', 'Despite', 'Although', 'Because',
  'Since', 'Until', 'Unless', 'Whether', 'Neither', 'Either', 'Both',
  'Each', 'Every', 'Many', 'Most', 'Some', 'Several', 'Few', 'All',
  'Any', 'Other', 'New', 'First', 'Last', 'Next', 'Such',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
]);

export class EntityExtractor {
  /**
   * Extract entities from raw text.
   * @param {string} text
   * @returns {Array} Entity objects
   */
  extract(text) {
    if (!text || typeof text !== 'string') return [];

    const entities = [];
    const seen = new Set();

    this._extractNamedEntities(text, entities, seen);
    this._extractTitledPersons(text, entities, seen);
    this._extractOrgBySuffix(text, entities, seen);
    this._extractCamelCaseOrgs(text, entities, seen);  // NEW: Extract CoreWeave, OpenAI, etc.
    this._extractLocations(text, entities, seen);
    this._extractFinancial(text, entities, seen);

    log('debug', `entities: extracted ${entities.length} from text (${text.length} chars)`);
    return entities;
  }

  /**
   * Deduplicate entities by fuzzy name similarity.
   * Merges aliases and sums mention counts.
   * @param {Array} entities
   * @returns {Array} Deduplicated entities
   */
  resolve(entities) {
    if (!Array.isArray(entities) || entities.length === 0) return [];

    const merged = [];

    for (const entity of entities) {
      let match = null;
      let bestSim = 0;

      for (const existing of merged) {
        if (existing.type !== entity.type) continue;
        const sim = nameSimilarity(existing.canonical, entity.canonical);
        if (sim > bestSim && sim >= 0.75) {
          bestSim = sim;
          match = existing;
        }
      }

      if (match) {
        if (!match.aliases.includes(entity.canonical)) {
          match.aliases.push(entity.canonical);
        }
        match.mentions += entity.mentions;
        match.lastSeen = Math.max(match.lastSeen, entity.lastSeen);
      } else {
        merged.push({ ...entity, aliases: [...entity.aliases] });
      }
    }

    log('debug', `entities: resolved ${entities.length} → ${merged.length}`);
    return merged;
  }

  _extractNamedEntities(text, entities, seen) {
    const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const name = m[1];
      if (isStopSequence(name)) continue;

      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const wordCount = name.split(/\s+/).length;
      const type = wordCount <= 3 ? EntityType.PERSON : EntityType.ORGANIZATION;
      entities.push(createEntity(type, name));
    }
  }

  _extractTitledPersons(text, entities, seen) {
    const pattern = /\b(\w+)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const title = m[1].toLowerCase().replace(/\.$/, '');
      const name = m[2];
      if (!PERSON_TITLES.has(title)) continue;
      if (name.split(/\s+/).length < 1) continue;

      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      entities.push(createEntity(EntityType.PERSON, name, { title }));
    }
  }

  _extractOrgBySuffix(text, entities, seen) {
    const pattern = /\b([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*)*)\s+(Inc|LLC|Corp|Ltd|Co|PLC|GmbH|AG|SA|Group|Holdings|Partners|Associates|Foundation|Institute|University|Corporation|Company|Limited|Incorporated)\.?\b/gi;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const name = `${m[1]} ${m[2]}`;
      const key = name.toLowerCase().replace(/\.\s*$/, '');
      if (seen.has(key)) continue;
      seen.add(key);

      entities.push(createEntity(EntityType.ORGANIZATION, name));
    }
  }

  _extractCamelCaseOrgs(text, entities, seen) {
    // Extract CamelCase company names like CoreWeave, OpenAI, TikTok, etc.
    // Pattern: Capital letter followed by lowercase, then another capital + lowercase(s)
    const pattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]*)+)\b/g;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const name = m[1];

      // Skip common words that look like CamelCase but aren't companies
      const commonWords = new Set(['JavaScript', 'iPhone', 'iPad', 'MacBook', 'YouTube', 'Facebook', 'Twitter', 'GitHub', 'OpenAI', 'ChatGPT', 'GPT', 'DuckDuckGo']);
      if (commonWords.has(name)) {
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        entities.push(createEntity(EntityType.ORGANIZATION, name));
        continue;
      }

      // If it looks like a company (context around it suggests so, or just a reasonable name)
      // Only extract if it appears in contexts like "X funding", "X valuation", "X infrastructure"
      const contextPattern = new RegExp(`\\b${name}\\s+(?:AI|funding|valuation|infrastructure|platform|service|product|company|startup|api|app|software)\\b`, 'i');
      if (contextPattern.test(text)) {
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        entities.push(createEntity(EntityType.ORGANIZATION, name));
      }
    }
  }

  _extractLocations(text, entities, seen) {
    const pattern = new RegExp(LOCATION_SIGNALS.source + '([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*)', 'gi');
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const name = m[m.length - 1];
      if (!name) continue;

      const key = `loc:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      entities.push(createEntity(EntityType.LOCATION, name));
    }
  }

  _extractFinancial(text, entities, seen) {
    let m;

    const tickerRe = new RegExp(TICKER_PATTERN.source, 'g');
    while ((m = tickerRe.exec(text)) !== null) {
      const ticker = m[0];
      const key = `fin:${ticker}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entities.push(createEntity(EntityType.FINANCIAL, ticker, { subtype: 'ticker' }));
    }

    const dollarRe = new RegExp(DOLLAR_PATTERN.source, 'gi');
    while ((m = dollarRe.exec(text)) !== null) {
      const amount = m[0];
      const key = `fin:${amount.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entities.push(createEntity(EntityType.FINANCIAL, amount, { subtype: 'amount' }));
    }
  }
}

/**
 * Check if a capitalized sequence is just stop words.
 */
function isStopSequence(name) {
  return name.split(/\s+/).every(w => STOP_WORDS.has(w));
}

/**
 * Fuzzy name similarity (0–1).
 * Combines token-level Jaccard with character-level bigram overlap.
 */
function nameSimilarity(a, b) {
  const aNorm = a.toLowerCase().trim();
  const bNorm = b.toLowerCase().trim();

  if (aNorm === bNorm) return 1.0;

  // Token Jaccard
  const aTokens = new Set(aNorm.split(/\s+/));
  const bTokens = new Set(bNorm.split(/\s+/));
  const intersection = [...aTokens].filter(t => bTokens.has(t)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  // Bigram overlap
  const aBigrams = bigrams(aNorm);
  const bBigrams = bigrams(bNorm);
  const bigramIntersect = [...aBigrams].filter(bg => bBigrams.has(bg)).length;
  const bigramUnion = new Set([...aBigrams, ...bBigrams]).size;
  const bigramSim = bigramUnion > 0 ? bigramIntersect / bigramUnion : 0;

  // Containment bonus: if one name is contained in the other
  const containment = (aNorm.includes(bNorm) || bNorm.includes(aNorm)) ? 0.15 : 0;

  return Math.min(jaccard * 0.5 + bigramSim * 0.35 + containment + 0.0, 1.0);
}

function bigrams(str) {
  const set = new Set();
  const clean = str.replace(/\s+/g, '');
  for (let i = 0; i < clean.length - 1; i++) {
    set.add(clean.slice(i, i + 2));
  }
  return set;
}
