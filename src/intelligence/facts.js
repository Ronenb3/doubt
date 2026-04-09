/**
 * doubt — Fact Extraction Engine
 *
 * The difference between "4 evidence items allege fraud" and
 * "CFPB complaint #4291038: consumer reported unauthorized $3,500
 * charge on Tesla account, filed 2024-03-15."
 *
 * Scans evidence summaries and structured data fields to extract
 * concrete, verifiable, specific data points. Every fact carries
 * identifiers, numbers, dates, and source attribution — the raw
 * material for conclusions a human can verify independently.
 *
 * No LLM required. Pure regex + structural extraction.
 */

import { createHash } from 'crypto';
import { log } from '../core/config.js';

// ─── Source Authority Tiers ─────────────────────────────────

const SOURCE_TRUST = {
  nhtsa:              0.95,
  sec_edgar:          0.95,
  courtlistener:      0.90,
  clinical_trials:    0.90,
  fec:                0.90,
  ofac:               0.95,
  opensanctions:      0.90,
  cfpb:               0.85,
  patents:            0.90,
  federal_register:   0.95,
  pubmed:             0.85,
  congressional_record: 0.90,
  opencorporates:     0.80,
  gleif:              0.85,
  wikipedia:          0.50,
  reddit:             0.30,
  news:               0.55,
};

// ─── Fact Type Detection Patterns ───────────────────────────

const TYPE_PATTERNS = [
  { type: 'recall',     pattern: /\b(recall(?:ed|s|ing)?|defect(?:s|ive)?)\b/i },
  { type: 'regulatory', pattern: /\b(investigation|probe|inquiry|enforcement|opened.{0,20}investigation|regulatory.{0,20}action)\b/i },
  { type: 'lawsuit',    pattern: /\b(lawsuit|sued|litigation|filed.{0,15}(suit|complaint)|class.action|verdict|settlement)\b/i },
  { type: 'complaint',  pattern: /\b(consumer.complaint|cfpb|filed.{0,15}complaint|odi.{0,10}complaint)\b/i },
  { type: 'financial',  pattern: /\b(revenue|profit|earnings|net.income|quarterly.results|fiscal|dividend|market.cap)\b/i },
  { type: 'event',      pattern: /\b(killed|death[s]?|fatal(?:ity|ities)?|injur(?:y|ies|ed)|crash(?:es|ed)?|accident[s]?|fire[s]?|explosion)\b/i },
  { type: 'quote',      pattern: /"[^"]{10,}"[^"]*\b(said|stated|according|wrote|announced|testified)\b/i },
  { type: 'technical',  pattern: /\b(software.update|firmware|version|bug|patch|CVE-|vulnerability|algorithm)\b/i },
  { type: 'statistic',  pattern: /\b(\d[\d,.]*\s*(?:percent|%)|rate.of.\d|increased.by.\d|\d+.out.of.\d+)\b/i },
];

// ─── Number Extraction Patterns ─────────────────────────────

const NUMBER_PATTERNS = [
  {
    pattern: /\$\s*([\d,]+(?:\.\d+)?)\s*(billion|million|thousand|[BMKbmk])\b/g,
    parse: (m) => ({
      value: parseScaledNumber(m[1], m[2]),
      unit: 'USD',
      context: 'dollar amount',
      raw: m[0],
    }),
  },
  {
    pattern: /\$\s*([\d,]+(?:\.\d+)?)\b/g,
    parse: (m) => ({
      value: parseFloat(m[1].replace(/,/g, '')),
      unit: 'USD',
      context: 'dollar amount',
      raw: m[0],
    }),
  },
  {
    pattern: /([\d,]+(?:\.\d+)?)\s*(billion|million|thousand)\s+(vehicle|unit|car|share|user|customer|account|complaint|recall)s?\b/gi,
    parse: (m) => ({
      value: parseScaledNumber(m[1], m[2]),
      unit: m[3].toLowerCase() + 's',
      context: 'count',
      raw: m[0],
    }),
  },
  {
    pattern: /([\d,]+)\s+(vehicle|unit|car|share|complaint|recall|death|injur(?:y|ies)|fatality|fatalities|crash|accident|incident)s?\b/gi,
    parse: (m) => ({
      value: parseInt(m[1].replace(/,/g, ''), 10),
      unit: m[2].toLowerCase() + 's',
      context: 'count',
      raw: m[0],
    }),
  },
  {
    pattern: /([\d,]+(?:\.\d+)?)\s*(?:percent|%)/gi,
    parse: (m) => ({
      value: parseFloat(m[1].replace(/,/g, '')),
      unit: 'percent',
      context: 'percentage',
      raw: m[0],
    }),
  },
  {
    pattern: /(\d+)\s+(recall|lawsuit|complaint|investigation|patent|filing|violation|incident|case)s?\b/gi,
    parse: (m) => ({
      value: parseInt(m[1], 10),
      unit: m[2].toLowerCase() + 's',
      context: 'count',
      raw: m[0],
    }),
  },
];

// ─── Identifier Extraction Patterns ─────────────────────────

const IDENTIFIER_PATTERNS = [
  { name: 'nhtsa_recall',  pattern: /\b(\d{2}[VvEeTt][-–]?\d{3,6})\b/g },
  { name: 'court_case',    pattern: /\b(\d+:\d{2}-[a-z]{2,4}-\d{4,6})\b/g },
  { name: 'patent_us',     pattern: /\b(US\s?\d{1,2},?\d{3},?\d{3})\b/g },
  { name: 'patent_us_app', pattern: /\b(US\d{7,11}[A-Z]?\d?)\b/g },
  { name: 'sec_filing',    pattern: /\b(10-[KQ]|8-K|DEF\s?14A|S-1|13[FD])\b/gi },
  { name: 'doi',           pattern: /\b(10\.\d{4,}\/\S+)\b/g },
  { name: 'cve',           pattern: /\b(CVE-\d{4}-\d{4,})\b/g },
  { name: 'nhtsa_odi',     pattern: /\b(?:ODI|complaint)[#:\s-]*(\d{8})\b/gi },
  { name: 'docket',        pattern: /\b(?:docket|case)\s*(?:no\.?\s*|#\s*)?([\w-]{5,20})\b/gi },
];

// ─── Date Extraction Patterns ───────────────────────────────

const MONTH_NAMES = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

const DATE_PATTERNS = [
  // ISO: 2024-01-15
  /\b(\d{4}-\d{2}-\d{2})\b/g,
  // Long: January 15, 2024
  new RegExp(`\\b((?:${MONTH_NAMES})\\s+\\d{1,2},?\\s+\\d{4})\\b`, 'gi'),
  // Short: Jan 15, 2024
  new RegExp(`\\b((?:${MONTH_NAMES})\\.?\\s+\\d{1,2},?\\s+\\d{4})\\b`, 'gi'),
  // US: 01/15/2024
  /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g,
  // Quarter: Q3 2024
  /\b(Q[1-4]\s+\d{4})\b/g,
];

// ─── Structured Data Field Maps ─────────────────────────────

const CONNECTOR_FIELD_MAPS = {
  nhtsa: [
    { field: 'campaignNumber',        factField: 'identifiers', label: 'NHTSA Recall' },
    { field: 'potentialUnitsAffected', factField: 'numbers',    label: 'affected vehicles', unit: 'vehicles', context: 'affected' },
    { field: 'consequence',           factField: 'text' },
    { field: 'component',             factField: 'text' },
    { field: 'crash',                 factField: 'numbers',    label: 'crashes', unit: 'crashes', context: 'reported' },
    { field: 'deaths',                factField: 'numbers',    label: 'deaths', unit: 'deaths', context: 'reported' },
    { field: 'injuries',              factField: 'numbers',    label: 'injuries', unit: 'injuries', context: 'reported' },
    { field: 'summary',               factField: 'text' },
    { field: 'manufacturer',          factField: 'entities' },
    { field: 'subject',               factField: 'text' },
  ],
  sec_edgar: [
    { field: 'formType',              factField: 'identifiers', label: 'SEC Filing' },
    { field: 'filingDate',            factField: 'dates' },
    { field: 'amount',                factField: 'numbers',    label: 'amount', unit: 'USD', context: 'filing amount' },
    { field: 'companyName',           factField: 'entities' },
    { field: 'cik',                   factField: 'identifiers', label: 'CIK' },
  ],
  courtlistener: [
    { field: 'caseName',              factField: 'text' },
    { field: 'docketNumber',          factField: 'identifiers', label: 'Docket' },
    { field: 'court',                 factField: 'text' },
    { field: 'dateFiled',             factField: 'dates' },
    { field: 'plaintiff',             factField: 'entities' },
    { field: 'defendant',             factField: 'entities' },
  ],
  patents: [
    { field: 'patentNumber',          factField: 'identifiers', label: 'Patent' },
    { field: 'title',                 factField: 'text' },
    { field: 'assignee',              factField: 'entities' },
    { field: 'filingDate',            factField: 'dates' },
    { field: 'inventors',             factField: 'entities' },
  ],
  cfpb: [
    { field: 'complaintId',           factField: 'identifiers', label: 'CFPB Complaint' },
    { field: 'company',               factField: 'entities' },
    { field: 'product',               factField: 'text', label: 'product' },
    { field: 'issue',                 factField: 'text', label: 'issue' },
    { field: 'subProduct',            factField: 'text', label: 'type' },
    { field: 'subIssue',              factField: 'text', label: 'detail' },
    { field: 'state',                 factField: 'text', label: 'state' },
    { field: 'dateSent',              factField: 'dates' },
    { field: 'dateReceived',          factField: 'dates' },
    { field: 'complaintId',           factField: 'identifiers', label: 'CFPB Complaint' },
    { field: 'subProduct',            factField: 'text' },
    { field: 'subIssue',              factField: 'text' },
    { field: 'state',                 factField: 'text' },
  ],
  clinical_trials: [
    { field: 'nctId',                 factField: 'identifiers', label: 'Clinical Trial' },
    { field: 'briefTitle',            factField: 'text' },
    { field: 'phase',                 factField: 'text' },
    { field: 'enrollment',            factField: 'numbers',    label: 'enrollment', unit: 'participants', context: 'enrolled' },
    { field: 'sponsor',               factField: 'entities' },
  ],
  fec: [
    { field: 'committeeId',           factField: 'identifiers', label: 'FEC Committee' },
    { field: 'candidateName',         factField: 'entities' },
    { field: 'totalReceipts',         factField: 'numbers',    label: 'receipts', unit: 'USD', context: 'total receipts' },
    { field: 'totalDisbursements',    factField: 'numbers',    label: 'disbursements', unit: 'USD', context: 'total disbursements' },
  ],
};

// ─── Main Class ─────────────────────────────────────────────

export class FactExtractor {

  /**
   * Extract all facts from an array of evidence items.
   *
   * @param {Object[]} evidence - Evidence items with .summary, .data, .connectorId, etc.
   * @param {string}   query    - The original investigation query
   * @returns {Object[]} Array of Fact objects
   */
  extractAll(evidence, query) {
    if (!evidence?.length) return [];

    const allFacts = [];
    const queryLower = (query || '').toLowerCase();
    const queryTerms = significantTerms(queryLower);

    for (const ev of evidence) {
      const fromStructured = this._extractStructured(ev);
      const fromText = this._extractFromText(ev, queryTerms);

      const merged = this._mergeExtractions(fromStructured, fromText, ev, queryLower, queryTerms);
      allFacts.push(...merged);
    }

    log('info', `facts: extracted ${allFacts.length} raw facts from ${evidence.length} evidence items`);
    return allFacts;
  }

  /**
   * Score and rank facts by importance.
   */
  rankFacts(facts, query) {
    const queryLower = (query || '').toLowerCase();
    const queryTerms = significantTerms(queryLower);

    for (const fact of facts) {
      const specificity = this._specificityScore(fact);
      const authority = this._authorityScore(fact);
      const relevance = this._relevanceScore(fact, queryTerms);

      // Relevance is the gating factor — a highly specific fact about the
      // wrong topic is worthless. Apply a relevance multiplier that
      // crushes off-topic facts regardless of their specificity.
      const relevanceGate = relevance < 0.15 ? 0.1 : relevance < 0.3 ? 0.5 : 1.0;
      fact.importance = clamp(
        (specificity * 0.25 + authority * 0.25 + relevance * 0.50) * relevanceGate
      );
      fact.relevanceToQuery = relevance;
    }

    facts.sort((a, b) => b.importance - a.importance);
    return facts;
  }

  /**
   * Merge facts that describe the same underlying event or record.
   * Same recall number, case number, or very similar text from different sources
   * → keep the most detailed version, note multiple sources.
   */
  deduplicateFacts(facts) {
    if (facts.length <= 1) return facts;

    const buckets = new Map();

    for (const fact of facts) {
      const key = this._deduplicationKey(fact);
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key).push(fact);
    }

    const merged = [];
    for (const group of buckets.values()) {
      if (group.length === 1) {
        merged.push(group[0]);
        continue;
      }

      group.sort((a, b) => {
        const detailA = a.numbers.length + a.identifiers.length + a.dates.length + a.entities.length;
        const detailB = b.numbers.length + b.identifiers.length + b.dates.length + b.entities.length;
        if (detailB !== detailA) return detailB - detailA;
        return b.text.length - a.text.length;
      });

      const best = { ...group[0] };

      // Absorb unique info from duplicates
      for (let i = 1; i < group.length; i++) {
        const other = group[i];
        for (const n of other.numbers) {
          if (!best.numbers.some(bn => bn.value === n.value && bn.unit === n.unit)) {
            best.numbers.push(n);
          }
        }
        for (const id of other.identifiers) {
          if (!best.identifiers.includes(id)) best.identifiers.push(id);
        }
        for (const d of other.dates) {
          if (!best.dates.includes(d)) best.dates.push(d);
        }
        for (const e of other.entities) {
          if (!best.entities.includes(e)) best.entities.push(e);
        }
        if (other.text.length > best.text.length) {
          best.text = other.text;
        }
      }

      best._mergedFrom = group.length;
      merged.push(best);
    }

    log('info', `facts: dedup ${facts.length} → ${merged.length}`);
    return merged;
  }

  /**
   * Return the top N most important, unique facts.
   */
  topFacts(facts, n = 10) {
    const deduped = this.deduplicateFacts(facts);
    deduped.sort((a, b) => b.importance - a.importance);
    const top = deduped.slice(0, n);
    // Pre-format each fact for report use
    for (const f of top) {
      f.formatted = this.formatFactAsStatement(f);
    }
    return top;
  }

  /**
   * Convert a structured fact into a clean, readable, citable statement.
   */
  formatFactAsStatement(fact) {
    const parts = [];

    // Lead with identifier if available
    if (fact.identifiers.length > 0) {
      const idLabel = this._identifierLabel(fact);
      if (idLabel) parts.push(idLabel);
    }

    // Core statement
    parts.push(fact.text);

    // Append key numbers not already in text
    for (const num of fact.numbers) {
      const numStr = formatNumber(num.value);
      if (!fact.text.includes(numStr) && !fact.text.includes(String(num.value))) {
        // Don't repeat unit if context is the same word
        const contextSuffix = (num.context && num.context !== num.unit) ? `, ${num.context}` : '';
        parts.push(`(${numStr} ${num.unit}${contextSuffix})`);
      }
    }

    // Append date if not already present
    for (const d of fact.dates) {
      if (!fact.text.includes(d)) {
        parts.push(`(${d})`);
      }
    }

    let statement = parts.join(' — ').replace(/\s+/g, ' ').trim();

    // Append source
    if (fact.source?.connectorId) {
      statement += ` [${fact.source.connectorId}]`;
    }

    return statement;
  }

  // ─── Strategy 1: Structured Data Extraction ───────────────

  _extractStructured(ev) {
    const data = ev.data;
    if (!data || typeof data !== 'object') return null;

    const connectorId = ev.connectorId || '';
    const fieldMap = CONNECTOR_FIELD_MAPS[connectorId];
    if (!fieldMap) return this._extractGenericStructured(data);

    const result = { textParts: [], numbers: [], dates: [], identifiers: [], entities: [] };

    for (const mapping of fieldMap) {
      const value = data[mapping.field];
      if (value == null || value === '' || value === 0) continue;

      switch (mapping.factField) {
        case 'identifiers':
          result.identifiers.push(String(value));
          result.textParts.push(`${mapping.label}: ${value}`);
          break;
        case 'numbers': {
          const numVal = typeof value === 'number' ? value : parseInt(String(value).replace(/,/g, ''), 10);
          if (!isNaN(numVal) && numVal > 0) {
            result.numbers.push({ value: numVal, unit: mapping.unit, context: mapping.context });
            result.textParts.push(`${formatNumber(numVal)} ${mapping.unit}`);
          }
          break;
        }
        case 'dates':
          result.dates.push(normalizeDate(String(value)));
          break;
        case 'entities':
          if (Array.isArray(value)) {
            result.entities.push(...value.map(String));
          } else {
            result.entities.push(String(value));
          }
          break;
        case 'text':
          result.textParts.push(String(value));
          break;
      }
    }

    if (result.textParts.length === 0 && result.numbers.length === 0 && result.identifiers.length === 0) {
      return null;
    }

    return result;
  }

  _extractGenericStructured(data) {
    const result = { textParts: [], numbers: [], dates: [], identifiers: [], entities: [] };
    let found = false;

    for (const [key, value] of Object.entries(data)) {
      if (value == null || value === '') continue;

      if (typeof value === 'number' && value > 0) {
        result.numbers.push({ value, unit: key, context: key });
        found = true;
      } else if (typeof value === 'string') {
        if (/date|filed|created|published/i.test(key)) {
          const d = normalizeDate(value);
          if (d) { result.dates.push(d); found = true; }
        } else if (/name|company|org|manufacturer|assignee|plaintiff|defendant/i.test(key)) {
          result.entities.push(value);
          found = true;
        } else if (/number|id|docket|case|patent|campaign/i.test(key)) {
          result.identifiers.push(value);
          found = true;
        } else if (value.length > 10 && value.length < 500) {
          result.textParts.push(value);
          found = true;
        }
      }
    }

    return found ? result : null;
  }

  // ─── Strategy 2–5: Text Extraction ────────────────────────

  _extractFromText(ev, queryTerms) {
    const text = evidenceText(ev);
    if (!text || text.length < 10) return null;

    const numbers = this._extractNumbers(text);
    const identifiers = this._extractIdentifiers(text);
    const dates = this._extractDates(text);
    const entities = this._extractEntities(text, queryTerms);
    const quotes = this._extractQuotes(text);
    const type = this._detectType(text);

    if (numbers.length === 0 && identifiers.length === 0 && dates.length === 0 && quotes.length === 0) {
      return null;
    }

    return { textParts: quotes, numbers, dates, identifiers, entities, type };
  }

  _extractNumbers(text) {
    const results = [];
    const seen = new Set();

    for (const { pattern, parse } of NUMBER_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        const parsed = parse(match);
        if (parsed && !isNaN(parsed.value) && parsed.value > 0) {
          const key = `${parsed.value}|${parsed.unit}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push(parsed);
          }
        }
      }
    }

    return results;
  }

  _extractIdentifiers(text) {
    const results = [];
    const seen = new Set();

    for (const { pattern } of IDENTIFIER_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        const id = match[1].trim();
        if (id.length >= 3 && !seen.has(id.toLowerCase())) {
          seen.add(id.toLowerCase());
          results.push(id);
        }
      }
    }

    return results;
  }

  _extractDates(text) {
    const results = [];
    const seen = new Set();

    for (const pattern of DATE_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        const d = normalizeDate(match[1]);
        if (d && !seen.has(d)) {
          seen.add(d);
          results.push(d);
        }
      }
    }

    return results;
  }

  _extractEntities(text, queryTerms) {
    // Capitalized multi-word names (simple NER without an LLM)
    const entityPattern = /\b([A-Z][a-z]+(?:\s+(?:of|the|and|&|for)\s+)?(?:[A-Z][a-z]+)+)\b/g;
    const entities = new Set();
    let match;

    while ((match = entityPattern.exec(text)) !== null) {
      const candidate = match[1].trim();
      if (candidate.length > 2 && candidate.length < 60) {
        entities.add(candidate);
      }
    }

    // Known org acronyms
    const orgPattern = /\b(NHTSA|SEC|FBI|DOJ|FTC|CFPB|EPA|FAA|FDA|OSHA|FEC|IRS|OFAC|DOE|NTSB|NYSE|NASDAQ)\b/g;
    while ((match = orgPattern.exec(text)) !== null) {
      entities.add(match[1]);
    }

    // Add query entity terms that appear in text (case-insensitive match)
    const textLower = text.toLowerCase();
    for (const term of queryTerms) {
      if (term.length > 2 && textLower.includes(term)) {
        const idx = textLower.indexOf(term);
        const original = text.slice(idx, idx + term.length);
        if (/^[A-Z]/.test(original)) entities.add(original);
      }
    }

    return [...entities].slice(0, 15);
  }

  _extractQuotes(text) {
    const quotes = [];
    // "quoted text" said/according to PERSON
    const quotePattern = /"([^"]{10,200})"\s*(?:,?\s*(?:said|stated|according to|wrote|announced|testified)\s+([A-Z][\w\s]{2,40}))/gi;
    let match;
    while ((match = quotePattern.exec(text)) !== null) {
      quotes.push(`"${match[1]}" — ${match[2].trim()}`);
    }
    // PERSON said "quoted text"
    const reversePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:said|stated|announced|testified)\s*[:,]?\s*"([^"]{10,200})"/gi;
    while ((match = reversePattern.exec(text)) !== null) {
      quotes.push(`"${match[2]}" — ${match[1].trim()}`);
    }
    return quotes;
  }

  _detectType(text) {
    for (const { type, pattern } of TYPE_PATTERNS) {
      if (pattern.test(text)) return type;
    }
    return 'statistic';
  }

  // ─── Merge Structured + Text Extractions Into Facts ───────

  _mergeExtractions(structured, fromText, ev, queryLower, queryTerms) {
    const facts = [];
    const connectorId = ev.connectorId || 'unknown';
    const trustWeight = ev.trustWeight ?? SOURCE_TRUST[connectorId] ?? 0.5;
    const sourceInfo = {
      connectorId,
      trustWeight,
      url: ev.sourceUrl || ev.url || '',
    };

    // If we have structured data, it's the gold standard — produce one primary fact
    if (structured) {
      const text = this._buildStructuredText(structured, ev, connectorId);
      const allEntities = dedupeStrings([
        ...(structured.entities || []),
        ...(fromText?.entities || []),
      ]);
      const allNumbers = [...(structured.numbers || []), ...(fromText?.numbers || [])];
      const allDates = dedupeStrings([...(structured.dates || []), ...(fromText?.dates || [])]);
      const allIdentifiers = dedupeStrings([...(structured.identifiers || []), ...(fromText?.identifiers || [])]);

      const type = fromText?.type || this._detectType(text);

      facts.push(this._buildFact({
        text: truncate(text, 300),
        type,
        entities: allEntities,
        numbers: dedupeNumbers(allNumbers),
        dates: allDates,
        identifiers: allIdentifiers,
        source: sourceInfo,
        evidenceId: ev.id || '',
        direction: ev.type === 'supports' ? 'supports' : ev.type === 'contradicts' ? 'contradicts' : 'contextual',
        importance: 0,
        relevanceToQuery: 0,
      }));
    }

    // Text-only extraction: one fact per evidence item if no structured data,
    // or supplementary quotes as separate facts
    if (!structured && fromText) {
      const text = bestSentence(ev.summary || '', queryTerms) || ev.summary || '';
      facts.push(this._buildFact({
        text: truncate(text, 300),
        type: fromText.type || 'statistic',
        entities: fromText.entities || [],
        numbers: dedupeNumbers(fromText.numbers || []),
        dates: fromText.dates || [],
        identifiers: fromText.identifiers || [],
        source: sourceInfo,
        evidenceId: ev.id || '',
        direction: ev.type === 'supports' ? 'supports' : ev.type === 'contradicts' ? 'contradicts' : 'contextual',
        importance: 0,
        relevanceToQuery: 0,
      }));
    }

    // Quotes become separate facts (they're independently citable)
    const quoteParts = fromText?.textParts || [];
    for (const q of quoteParts) {
      facts.push(this._buildFact({
        text: q,
        type: 'quote',
        entities: fromText?.entities || [],
        numbers: [],
        dates: fromText?.dates || [],
        identifiers: [],
        source: sourceInfo,
        evidenceId: ev.id || '',
        importance: 0,
        relevanceToQuery: 0,
      }));
    }

    return facts;
  }

  _buildFact(raw) {
    const hash = createHash('sha256')
      .update(raw.text + raw.type + (raw.source?.connectorId || ''))
      .digest('hex')
      .slice(0, 12);

    return {
      id: `fact-${hash}`,
      text: raw.text,
      type: raw.type,
      direction: raw.direction || 'contextual',
      entities: raw.entities.slice(0, 10),
      numbers: raw.numbers.slice(0, 10),
      dates: raw.dates.slice(0, 5),
      identifiers: raw.identifiers.slice(0, 10),
      source: raw.source,
      evidenceId: raw.evidenceId,
      importance: raw.importance,
      relevanceToQuery: raw.relevanceToQuery,
    };
  }

  // ─── Scoring ──────────────────────────────────────────────

  _specificityScore(fact) {
    let score = 0.1;
    if (fact.numbers.length > 0) score += 0.25;
    if (fact.numbers.length > 2) score += 0.10;
    if (fact.identifiers.length > 0) score += 0.30;
    if (fact.dates.length > 0) score += 0.15;
    if (fact.entities.length > 0) score += 0.10;
    if (fact.text.length > 80) score += 0.10;
    return clamp(score);
  }

  _authorityScore(fact) {
    const trust = fact.source?.trustWeight ?? 0.5;
    return clamp(trust);
  }

  _relevanceScore(fact, queryTerms) {
    if (queryTerms.length === 0) return 0.5;

    const factText = fact.text.toLowerCase();
    const entityText = fact.entities.join(' ').toLowerCase();
    const combined = factText + ' ' + entityText;

    let hits = 0;
    for (const term of queryTerms) {
      if (combined.includes(term)) hits++;
    }

    let score = hits / queryTerms.length;

    // Semantic expansion: check if the fact is about the same DOMAIN as the query.
    // "Tesla recall for phantom braking" is about the same domain as "Tesla FSD safe".
    // "Tesla money transfer complaint" is NOT about the same domain.
    const DRIVING_SAFETY_TERMS = ['crash', 'accident', 'recall', 'defect', 'fatal', 'injury',
      'death', 'autopilot', 'fsd', 'self-driving', 'self driving', 'phantom', 'collision',
      'brake', 'braking', 'autonomous', 'vehicle', 'driving', 'driver', 'road', 'highway',
      'traffic', 'pedestrian', 'swerve', 'disengag', 'steer', 'accelerat'];

    const queryAboutDriving = queryTerms.some(t =>
      ['driving', 'self-driving', 'safe', 'safety', 'road', 'autonomous', 'vehicle'].includes(t)
    );
    const factAboutDriving = DRIVING_SAFETY_TERMS.some(t => combined.includes(t));

    if (queryAboutDriving && factAboutDriving) score += 0.20;

    // Penalize facts about unrelated domains even if they mention query entities
    const FINANCIAL_TERMS = ['money transfer', 'loan', 'lease', 'credit report', 'virtual currency',
      'mortgage', 'interest rate', 'payment', 'billing'];
    const factAboutFinance = FINANCIAL_TERMS.some(t => combined.includes(t));
    if (queryAboutDriving && factAboutFinance && !factAboutDriving) score *= 0.3;

    return clamp(score);
  }

  // ─── Deduplication Key ────────────────────────────────────

  _deduplicationKey(fact) {
    // Best key: a real identifier (recall number, case number, etc.)
    if (fact.identifiers.length > 0) {
      const primary = fact.identifiers[0].toLowerCase().replace(/[\s–-]/g, '');
      return `id:${primary}`;
    }

    // Fallback: type + sorted significant terms from text
    const terms = significantTerms(fact.text)
      .sort()
      .slice(0, 6)
      .join('|');
    return `txt:${fact.type}:${terms}`;
  }

  // ─── Structured Text Builders ─────────────────────────────

  _buildStructuredText(structured, ev, connectorId) {
    // Social/community connectors: use title/summary directly — their .data is engagement metadata
    const SOCIAL_CONNECTORS = new Set(['reddit', 'hackernews', 'stocktwits', 'twitter', 'media', 'news_archive', 'news_intel']);
    if (SOCIAL_CONNECTORS.has(connectorId)) {
      return (ev.title || ev.summary || '').slice(0, 300);
    }

    const data = ev.data || {};

    if (connectorId === 'nhtsa') {
      const parts = [];
      if (data.component) parts.push(data.component);
      if (data.modelYear && data.make && data.model) parts.push(`${data.modelYear} ${data.make} ${data.model}`);
      const summary = ev.summary || data.consequence || data.subject || '';
      if (summary) parts.push(truncate(summary, 200));
      if (data.potentialUnitsAffected) parts.push(`(${formatNumber(data.potentialUnitsAffected)} vehicles affected)`);
      if (data.deaths > 0) parts.push(`${data.deaths} death(s) reported`);
      if (data.injuries > 0) parts.push(`${data.injuries} injury(ies) reported`);
      return parts.join(' — ') || ev.summary || '';
    }

    // CFPB: "CFPB complaint: [company] — [issue] ([product type], [state])"
    if (connectorId === 'cfpb') {
      const company = data.company || 'Unknown';
      const issue = data.issue || 'consumer complaint';
      const product = data.subProduct || data.product || '';
      const state = data.state || '';
      const id = data.complaintId || '';
      return `${company}: ${issue}${product ? ' (' + product + ')' : ''}${state ? ', ' + state : ''}${id ? ' [#' + id + ']' : ''}`;
    }

    if (connectorId === 'courtlistener') {
      const name = data.caseName || ev.title || '';
      const court = data.court || '';
      const date = data.dateFiled || '';
      const docket = data.docketNumber || '';
      const judge = data.judge || '';
      const parts = [];
      if (name && name !== 'Unnamed Case') parts.push(name);
      if (court) parts.push(court);
      if (docket) parts.push(`Docket ${docket}`);
      if (judge) parts.push(`Judge: ${judge}`);
      if (date) parts.push(date);
      return parts.join(' — ') || ev.summary || '';
    }

    // Federal Register: use summary as-is, it's usually good
    if (connectorId === 'federal_register') {
      return truncate(ev.summary || structured.textParts.join('. '), 300);
    }

    // SEC: "[formType] filed by [company] on [date]"
    if (connectorId === 'sec_edgar') {
      const form = data.formType || '';
      const company = data.companyName || '';
      const date = data.filingDate || '';
      if (form) return `SEC ${form}${company ? ' filed by ' + company : ''}${date ? ' on ' + date : ''}`;
    }

    // Default: join text parts with separators
    const text = structured.textParts.join('. ').trim();
    return text || ev.summary || '';
  }

  // ─── Statement Formatting Helpers ─────────────────────────

  _identifierLabel(fact) {
    if (fact.identifiers.length === 0) return null;

    const id = fact.identifiers[0];
    const connector = fact.source?.connectorId || '';

    if (connector === 'nhtsa' || /^\d{2}[VvEeTt]/.test(id)) return `NHTSA Recall ${id}`;
    if (connector === 'courtlistener' || /^\d+:\d{2}-/.test(id)) return `Case ${id}`;
    if (connector === 'patents' || /^US/.test(id)) return `Patent ${id}`;
    if (connector === 'sec_edgar') return `SEC ${id}`;
    if (connector === 'cfpb') return `CFPB Complaint ${id}`;
    if (connector === 'clinical_trials' || /^NCT/.test(id)) return `Trial ${id}`;
    if (connector === 'fec') return `FEC ${id}`;

    return id;
  }
}

// ─── Pure Utility Functions ─────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
  'these', 'those', 'it', 'its', 'he', 'she', 'they', 'we', 'i', 'you',
  'not', 'no', 'if', 'then', 'than', 'so', 'as', 'up', 'out', 'about',
]);

function significantTerms(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function evidenceText(ev) {
  const parts = [ev.summary || ''];
  if (ev.data?.title) parts.push(ev.data.title);
  if (ev.data?.description) parts.push(ev.data.description);
  if (ev.data?.snippet) parts.push(ev.data.snippet);
  if (ev.data?.text) parts.push(ev.data.text);
  return parts.join(' ');
}

function bestSentence(text, queryTerms) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 15);
  if (sentences.length === 0) return null;

  let best = sentences[0];
  let bestScore = -1;

  for (const s of sentences) {
    const lower = s.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      if (lower.includes(term)) score++;
    }
    // Prefer sentences with numbers and identifiers
    if (/\d/.test(s)) score += 0.5;
    if (/\$/.test(s)) score += 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  return best.trim();
}

function parseScaledNumber(rawNum, scale) {
  const num = parseFloat(rawNum.replace(/,/g, ''));
  const s = (scale || '').toLowerCase();
  if (s === 'billion' || s === 'b') return num * 1_000_000_000;
  if (s === 'million' || s === 'm') return num * 1_000_000;
  if (s === 'thousand' || s === 'k') return num * 1_000;
  return num;
}

function formatNumber(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} billion`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} million`;
  if (n >= 1_000) return n.toLocaleString('en-US');
  return String(n);
}

function normalizeDate(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1900 && d.getFullYear() < 2100) {
      return d.toISOString().slice(0, 10);
    }
  } catch { /* ignore */ }

  // Quarter → approximate date
  const qMatch = trimmed.match(/^Q([1-4])\s+(\d{4})$/);
  if (qMatch) {
    const month = String((parseInt(qMatch[1]) - 1) * 3 + 1).padStart(2, '0');
    return `${qMatch[2]}-${month}-01`;
  }

  return trimmed;
}

function clamp(n, min = 0, max = 1) {
  return Math.round(Math.min(max, Math.max(min, n)) * 1000) / 1000;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

function dedupeStrings(arr) {
  const seen = new Set();
  return arr.filter(s => {
    const key = String(s).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeNumbers(arr) {
  const seen = new Set();
  return arr.filter(n => {
    const key = `${n.value}|${n.unit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default FactExtractor;
