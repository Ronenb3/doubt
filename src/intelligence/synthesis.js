/**
 * doubt — Synthesis Engine
 *
 * The difference between a data aggregator and an investigation engine.
 * Takes 700 pieces of raw evidence and produces intelligence a human
 * can act on: themes, key findings, consensus maps, quality assessments,
 * and a plain English summary.
 *
 * No LLM required. Pure structural analysis over the evidence graph.
 */

import { log } from '../core/config.js';
import { assessIdeologicalDiversity } from './source-bias.js';

const GOV_IDS = new Set(['nhtsa', 'federal_register', 'cfpb', 'sec_edgar', 'congressional_record', 'fec', 'bls', 'fred', 'sam_gov', 'enforcement']);
const LEGAL_IDS = new Set(['courtlistener', 'pacer', 'state_courts']);
const ACADEMIC_IDS = new Set(['arxiv', 'openalex', 'semantic_scholar', 'crossref', 'pubmed', 'papers_with_code']);

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
  'these', 'those', 'it', 'its', 'he', 'she', 'they', 'we', 'i', 'you',
  'not', 'no', 'if', 'then', 'than', 'so', 'as', 'up', 'out', 'about',
  'which', 'who', 'whom', 'what', 'where', 'when', 'how', 'all', 'each',
  'every', 'both', 'more', 'most', 'other', 'some', 'such', 'only',
  'same', 'also', 'just', 'into', 'over', 'after', 'before', 'between',
  'under', 'through', 'during', 'here', 'there', 'again', 'further',
  'once', 'new', 'one', 'two', 'said', 'says', 'based', 'according',
  'however', 'while', 'since', 'per', 'via', 'including', 'using',
  'used', 'use', 'data', 'found', 'well', 'very', 'many', 'much',
  'own', 'still', 'even', 'back', 'any', 'get', 'got', 'like',
]);

const SENTIMENT_POSITIVE = new Set([
  'success', 'growth', 'profit', 'approved', 'positive', 'increased',
  'improved', 'innovation', 'breakthrough', 'compliant', 'safe', 'secure',
  'milestone', 'achievement', 'progress', 'promising', 'beneficial',
  'effective', 'awarded', 'praised', 'strong', 'healthy', 'gain',
]);

const SENTIMENT_NEGATIVE = new Set([
  'failure', 'loss', 'violation', 'fraud', 'recall', 'lawsuit', 'fine',
  'penalty', 'breach', 'scandal', 'bankruptcy', 'decline', 'crash',
  'investigation', 'indictment', 'warning', 'risk', 'danger', 'hazard',
  'deficit', 'default', 'complaint', 'negligence', 'misconduct', 'sued',
  'contamination', 'death', 'injury', 'harm', 'misleading', 'deceptive',
]);

export class SynthesisEngine {

  /**
   * Transform raw evidence into structured intelligence.
   *
   * @param {Object[]} evidence - All gathered evidence items
   * @param {Object[]} claims   - Extracted claims
   * @param {string}   query    - The original investigation query
   * @param {Object[]} entities - Extracted entities
   * @returns {Object} Complete synthesis
   */
  synthesize(evidence, claims, query, entities) {
    if (!evidence?.length) {
      log('warn', 'synthesis: no evidence to synthesize');
      return this._emptySynthesis(query);
    }

    log('info', `synthesis: processing ${evidence.length} evidence items across ${new Set(evidence.map(e => e.connectorId)).size} sources`);

    const themes = this._extractThemes(evidence, query);
    const keyFindings = this._extractKeyFindings(evidence, claims, query, themes);
    const consensusMap = this._buildConsensusMap(evidence, claims, query);
    const evidenceQuality = this._assessQuality(evidence, query);
    const stanceBreakdown = this._computeStance(evidence);
    const overallDirection = this._determineDirection(stanceBreakdown, evidence);
    const biasAssessment = assessIdeologicalDiversity(evidence);
    if (biasAssessment.biasWarning) {
      log('warn', `synthesis: ${biasAssessment.warningText}`);
    }
    const topFindingSentences = keyFindings.slice(0, 3).map(f => f.statement);

    const summary = this._generateSummary(
      query, evidence, keyFindings, stanceBreakdown,
      overallDirection, evidenceQuality, consensusMap
    );

    log('info', `synthesis: ${themes.length} themes, ${keyFindings.length} findings, direction=${overallDirection}`);

    return {
      themes,
      keyFindings,
      consensusMap,
      evidenceQuality,
      summary,
      stanceBreakdown,
      overallDirection,
      topFindingSentences,
      biasAssessment,
    };
  }

  // ─── Step 1: Theme Extraction ──────────────────────────────

  _extractThemes(evidence, query) {
    const termFreq = new Map();
    const termWeight = new Map(); // relevance-weighted frequency
    const termEvidence = new Map();

    for (const ev of evidence) {
      const text = this._evidenceText(ev);
      const terms = this._significantTerms(text);
      // Weight evidence contribution by its relevance score — aircraft data scores near 0,
      // EDGAR filings score high. This prevents garbage connectors from dominating themes.
      const relevanceWeight = ev._relevanceScore != null ? ev._relevanceScore : 0.5;
      const trustWeight = ev.trustWeight != null ? ev.trustWeight : 0.5;
      const itemWeight = (relevanceWeight * 0.6) + (trustWeight * 0.4);

      for (const term of terms) {
        termFreq.set(term, (termFreq.get(term) || 0) + 1);
        termWeight.set(term, (termWeight.get(term) || 0) + itemWeight);
        if (!termEvidence.has(term)) termEvidence.set(term, []);
        termEvidence.get(term).push(ev);
      }
    }

    // Keep terms that appear in at least 3 items or 2% of evidence AND have meaningful weight
    const minAppearances = Math.max(3, Math.ceil(evidence.length * 0.02));
    const significant = [...termFreq.entries()]
      .filter(([, count]) => count >= minAppearances)
      // Sort by weighted score, not raw count — prevents low-relevance floods from dominating
      .sort((a, b) => (termWeight.get(b[0]) || 0) - (termWeight.get(a[0]) || 0));

    // Cluster: greedily merge terms that co-occur in >40% of their evidence
    const clusters = [];
    const assigned = new Set();

    for (const [seedTerm] of significant) {
      if (assigned.has(seedTerm)) continue;

      const seedItems = new Set(termEvidence.get(seedTerm).map(e => e.id));
      const cluster = { terms: [seedTerm], evidenceIds: new Set(seedItems) };

      for (const [otherTerm] of significant) {
        if (otherTerm === seedTerm || assigned.has(otherTerm)) continue;
        const otherItems = termEvidence.get(otherTerm).map(e => e.id);
        const overlap = otherItems.filter(id => seedItems.has(id)).length;
        if (overlap / Math.min(seedItems.size, otherItems.length) > 0.4) {
          cluster.terms.push(otherTerm);
          for (const id of otherItems) cluster.evidenceIds.add(id);
          assigned.add(otherTerm);
        }
      }

      assigned.add(seedTerm);
      clusters.push(cluster);
    }

    // Convert clusters to themes
    const evidenceById = new Map(evidence.map(e => [e.id, e]));

    const themes = clusters.slice(0, 8).map(cluster => {
      const items = [...cluster.evidenceIds]
        .map(id => evidenceById.get(id))
        .filter(Boolean);

      const connectors = new Map();
      for (const ev of items) {
        const c = ev.connectorId || 'unknown';
        connectors.set(c, (connectors.get(c) || 0) + 1);
      }

      return {
        name: this._labelTheme(cluster.terms, query),
        evidenceCount: items.length,
        sentiment: this._clusterSentiment(items),
        topSources: [...connectors.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name]) => name),
        summary: this._clusterSummary(items, cluster.terms),
        _terms: cluster.terms.slice(0, 6),
        _evidenceIds: [...cluster.evidenceIds],
      };
    });

    themes.sort((a, b) => b.evidenceCount - a.evidenceCount);
    return themes;
  }

  // ─── Step 2: Key Findings ──────────────────────────────────

  _extractKeyFindings(evidence, claims, query, themes) {
    const findings = [];
    const queryLower = query.toLowerCase();

    // 2a: Stance-based aggregation — what do supporting vs contradicting evidence tell us?
    const supporting = evidence.filter(e => e.type === 'supports');
    const contradicting = evidence.filter(e => e.type === 'contradicts');

    // Group contradicting evidence by sub-topic to extract distinct findings
    const contraGroups = this._groupByTopic(contradicting, queryLower);
    for (const group of contraGroups.slice(0, 5)) {
      const connectors = [...new Set(group.items.map(e => e.connectorId))];
      const best = group.items.reduce((a, b) => a.trustWeight > b.trustWeight ? a : b);
      findings.push({
        statement: this._distillFinding(group, query, 'contradicts'),
        confidence: Math.min(0.95, (best.trustWeight + connectors.length * 0.05)),
        sources: connectors,
        sourceCount: connectors.length,
        evidenceIds: group.items.map(e => e.id),
        importance: 0.6 + Math.min(0.3, connectors.length * 0.1) + best.trustWeight * 0.1,
        surprise: 0.6,
        direction: 'contradicts',
      });
    }

    // Group supporting evidence by sub-topic
    const supGroups = this._groupByTopic(supporting, queryLower);
    for (const group of supGroups.slice(0, 4)) {
      const connectors = [...new Set(group.items.map(e => e.connectorId))];
      const best = group.items.reduce((a, b) => a.trustWeight > b.trustWeight ? a : b);
      findings.push({
        statement: this._distillFinding(group, query, 'supports'),
        confidence: Math.min(0.95, (best.trustWeight + connectors.length * 0.05)),
        sources: connectors,
        sourceCount: connectors.length,
        evidenceIds: group.items.map(e => e.id),
        importance: 0.5 + Math.min(0.3, connectors.length * 0.1) + best.trustWeight * 0.1,
        surprise: 0.2,
        direction: 'supports',
      });
    }

    // 2b: Multi-source agreement — facts confirmed across independent sources
    const byContent = this._groupBySimilarity(evidence);
    for (const group of byContent.slice(0, 5)) {
      if (group.length < 2) continue;
      const connectors = [...new Set(group.map(e => e.connectorId))];
      if (connectors.length < 2) continue;
      const alreadyCovered = findings.some(f =>
        group.some(e => f.evidenceIds.includes(e.id))
      );
      if (alreadyCovered) continue;

      const best = group.reduce((a, b) => a.trustWeight > b.trustWeight ? a : b);
      findings.push({
        statement: `${connectors.length} independent sources confirm: ${this._extractKeyPhrase(best, query)}`,
        confidence: Math.min(0.95, connectors.length * 0.15 + best.trustWeight * 0.4),
        sources: connectors,
        sourceCount: connectors.length,
        evidenceIds: group.map(e => e.id),
        importance: this._importanceScore(best, queryLower, connectors.length),
        surprise: this._surpriseScore(best, claims),
        direction: this._evidenceDirection(best),
      });
    }

    // 2c: Notable absences
    if (themes.length > 0 && evidence.length > 20) {
      const connectorTypes = new Set(evidence.map(e => e.connectorId));
      const expectedSources = this._expectedSourcesFor(queryLower);
      const missing = expectedSources.filter(s => !connectorTypes.has(s));

      if (missing.length > 0) {
        findings.push({
          statement: `No evidence found from ${missing.slice(0, 3).join(', ')} — sources that would typically cover this topic`,
          confidence: 0.5,
          sources: [],
          sourceCount: 0,
          evidenceIds: [],
          importance: 0.6,
          surprise: 0.5,
          direction: 'contextual',
        });
      }
    }

    // 2d: Stance imbalance itself is a finding
    if (supporting.length > 0 || contradicting.length > 0) {
      const total = supporting.length + contradicting.length;
      if (contradicting.length > supporting.length * 2) {
        findings.push({
          statement: `${contradicting.length} pieces of evidence contradict the claim vs only ${supporting.length} supporting it (${Math.round(contradicting.length/total*100)}% negative)`,
          confidence: 0.8,
          sources: [...new Set(contradicting.map(e => e.connectorId))],
          sourceCount: new Set(contradicting.map(e => e.connectorId)).size,
          evidenceIds: [],
          importance: 0.85,
          surprise: 0.4,
          direction: 'contradicts',
        });
      } else if (supporting.length > contradicting.length * 2) {
        findings.push({
          statement: `${supporting.length} pieces of evidence support the claim vs ${contradicting.length} contradicting (${Math.round(supporting.length/total*100)}% positive)`,
          confidence: 0.8,
          sources: [...new Set(supporting.map(e => e.connectorId))],
          sourceCount: new Set(supporting.map(e => e.connectorId)).size,
          evidenceIds: [],
          importance: 0.85,
          surprise: 0.3,
          direction: 'supports',
        });
      }
    }

    findings.sort((a, b) => {
      const scoreA = a.importance * 0.5 + a.confidence * 0.3 + a.surprise * 0.2;
      const scoreB = b.importance * 0.5 + b.confidence * 0.3 + b.surprise * 0.2;
      return scoreB - scoreA;
    });

    return findings.slice(0, 10);
  }

  _groupByTopic(evidenceItems, queryLower) {
    const TOPIC_PATTERNS = {
      'recall_defect':    /\b(recall|defect|nhtsa)\b/i,
      'crash_fatality':   /\b(crash|accident|fatal|death|killed|injury)\b/i,
      'lawsuit_legal':    /\b(lawsuit|court|sued|litigation|verdict)\b/i,
      'investigation':    /\b(investigation|probe|inquiry|review)\b/i,
      'fraud_deception':  /\b(fraud|misleading|deceptive|misrepresent)\b/i,
      'consumer_complaint': /\b(complaint|consumer|cfpb|filed)\b/i,
      'regulation':       /\b(regulation|policy|legislation|ban|restrict)\b/i,
      'improvement':      /\b(improvement|improved|progress|advance|milestone)\b/i,
      'tech_innovation':  /\b(patent|innovation|technology|software|update)\b/i,
      'safety_record':    /\b(safety\s+record|safer|accident\s+rate|fewer|reduction)\b/i,
    };

    const groups = {};
    for (const ev of evidenceItems) {
      const text = this._evidenceText(ev);
      let matched = false;
      for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
        if (pattern.test(text)) {
          if (!groups[topic]) groups[topic] = { topic, items: [] };
          groups[topic].items.push(ev);
          matched = true;
          break;
        }
      }
      if (!matched) {
        if (!groups['_other']) groups['_other'] = { topic: '_other', items: [] };
        groups['_other'].items.push(ev);
      }
    }

    return Object.values(groups)
      .filter(g => g.items.length >= 1)
      .sort((a, b) => b.items.length - a.items.length);
  }

  _distillFinding(group, query, direction) {
    // Pick the highest-trust evidence item from the group and use its actual content
    const sorted = [...group.items].sort((a, b) => (b.trustWeight || 0) - (a.trustWeight || 0));
    const best = sorted[0];
    const bestText = this._extractKeyPhrase(best, query);

    const connectors = [...new Set(group.items.map(e => e.connectorId))];
    const sourceStr = connectors.length > 3
      ? `${connectors.slice(0, 3).join(', ')} and ${connectors.length - 3} others`
      : connectors.join(', ');

    const n = group.items.length;
    if (bestText && bestText.length > 20) {
      return n > 1
        ? `${bestText} (${n} items from ${sourceStr})`
        : `${bestText} [${sourceStr}]`;
    }
    return `${n} ${direction === 'contradicts' ? 'contradicting' : 'supporting'} evidence items (from ${sourceStr})`;
  }

  _extractKeyPhrase(ev, query) {
    const text = ev.summary || this._evidenceText(ev);
    // Extract the most relevant sentence
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    if (sentences.length === 0) return truncate(text, 100);

    const queryTerms = new Set(this._significantTerms(query));
    let best = sentences[0];
    let bestScore = 0;
    for (const s of sentences) {
      const words = this._significantTerms(s);
      const overlap = words.filter(w => queryTerms.has(w)).length;
      if (overlap > bestScore) {
        bestScore = overlap;
        best = s;
      }
    }
    return truncate(best.trim(), 120);
  }

  // ─── Step 3: Consensus / Dissent Map ───────────────────────

  _buildConsensusMap(evidence, claims, query) {
    const supporting = evidence.filter(e => e.type === 'supports');
    const contradicting = evidence.filter(e => e.type === 'contradicts');
    const contextual = evidence.filter(e => e.type === 'contextual' || e.type === 'neutral');

    // Consensus: points agreed on by 2+ independent connectors
    const consensus = this._findAgreements(supporting);
    const dissent = this._findDisagreements(supporting, contradicting);
    const unknown = this._findGaps(evidence, claims, query);

    const stanceBreakdown = {
      supporting: supporting.length,
      contradicting: contradicting.length,
      contextual: contextual.length,
    };

    const total = evidence.length || 1;
    let overallAssessment;
    if (supporting.length > contradicting.length * 2) {
      overallAssessment = `The evidence is predominantly supporting with ${contradicting.length} dissenting item${contradicting.length !== 1 ? 's' : ''} out of ${total}.`;
    } else if (contradicting.length > supporting.length * 2) {
      overallAssessment = `The evidence is predominantly contradicting with ${supporting.length} supporting item${supporting.length !== 1 ? 's' : ''} out of ${total}.`;
    } else if (supporting.length > 0 && contradicting.length > 0) {
      overallAssessment = `The evidence is contested — ${supporting.length} items support vs ${contradicting.length} contradict, with ${contextual.length} providing context.`;
    } else {
      overallAssessment = `Insufficient directional evidence — most of the ${total} items are contextual rather than directly supporting or contradicting.`;
    }

    return {
      consensus,
      dissent,
      unknown,
      stanceBreakdown,
      overallAssessment,
    };
  }

  // ─── Step 4: Evidence Quality Assessment ───────────────────

  _assessQuality(evidence, query) {
    const total = evidence.length || 1;

    // Trust distribution
    const highTrust = evidence.filter(e => e.trustWeight >= 0.7).length;
    const medTrust = evidence.filter(e => e.trustWeight >= 0.4 && e.trustWeight < 0.7).length;
    const lowTrust = evidence.filter(e => e.trustWeight < 0.4).length;

    const trustDistribution = {
      high: round(highTrust / total),
      medium: round(medTrust / total),
      low: round(lowTrust / total),
    };

    // Recency distribution
    const now = Date.now();
    const oneYear = 365 * 86400000;
    const fiveYears = 5 * oneYear;

    let recent = 0, midAge = 0, old = 0, undated = 0;
    for (const ev of evidence) {
      if (!ev.timestamp) { undated++; continue; }
      const age = now - new Date(ev.timestamp).getTime();
      if (age < oneYear) recent++;
      else if (age < fiveYears) midAge++;
      else old++;
    }

    const recencyDistribution = {
      lastYear: round(recent / total),
      lastFiveYears: round(midAge / total),
      older: round(old / total),
      undated: round(undated / total),
    };

    // Source diversity
    const uniqueConnectors = new Set(evidence.map(e => e.connectorId)).size;
    const diversity = {
      uniqueConnectorTypes: uniqueConnectors,
      diversityRatio: round(uniqueConnectors / Math.max(1, total)),
      // Shannon entropy over connector distribution
      shannonEntropy: this._shannonEntropy(evidence.map(e => e.connectorId)),
    };

    // Specificity — how many items actually name entities from the query
    const queryTerms = this._significantTerms(query || '');
    let specific = 0;
    for (const ev of evidence) {
      const text = this._evidenceText(ev).toLowerCase();
      if (queryTerms.some(t => text.includes(t))) specific++;
    }

    const specificity = round(specific / total);

    return { trustDistribution, recencyDistribution, diversity, specificity };
  }

  // ─── Step 5: Plain English Summary ─────────────────────────

  _generateSummary(query, evidence, keyFindings, stance, direction, quality, consensusMap) {
    const sourceCount = new Set(evidence.map(e => e.connectorId)).size;
    const parts = [];

    // Opener — state the verdict clearly
    const verdicts = {
      supports: `The evidence predominantly supports "${truncate(query, 80)}."`,
      contradicts: `The evidence predominantly contradicts "${truncate(query, 80)}."`,
      contested: `The claim "${truncate(query, 80)}" is actively contested across multiple authoritative sources.`,
      insufficient: `There is insufficient evidence to confidently assess "${truncate(query, 80)}."`,
    };
    parts.push(verdicts[direction] || `Investigation of "${truncate(query, 80)}" yielded inconclusive results.`);

    // Source breadth
    const govSources = evidence.filter(e => GOV_IDS.has(e.connectorId));
    const courtSources = evidence.filter(e => LEGAL_IDS.has(e.connectorId));
    const academicSources = evidence.filter(e => ACADEMIC_IDS.has(e.connectorId));
    const breadthParts = [];
    if (govSources.length > 0) breadthParts.push(`${govSources.length} government records`);
    if (courtSources.length > 0) breadthParts.push(`${courtSources.length} legal records`);
    if (academicSources.length > 0) breadthParts.push(`${academicSources.length} academic papers`);
    if (breadthParts.length > 0) {
      parts.push(`The investigation analyzed ${evidence.length} evidence items from ${sourceCount} sources, including ${breadthParts.join(', ')}.`);
    } else {
      parts.push(`The investigation analyzed ${evidence.length} evidence items from ${sourceCount} sources.`);
    }

    // Stance summary
    const supporting = stance.supporting || 0;
    const contradicting = stance.contradicting || 0;
    if (supporting > 0 && contradicting > 0) {
      parts.push(`${supporting} pieces of evidence support the claim while ${contradicting} contradict it.`);
    }

    // Top finding highlight — use the best specific finding that's not a count
    if (keyFindings.length > 0) {
      const best = keyFindings.find(f =>
        f.statement && f.statement.length > 30 && !/^\d+ /.test(f.statement)
      );
      if (best) {
        parts.push(`Most notably: ${truncate(best.statement, 150)}.`);
      }
    }

    // Notable gaps
    if (consensusMap.unknown.length > 0) {
      parts.push(`Notable gaps: ${consensusMap.unknown.slice(0, 2).join('; ')}.`);
    }

    return parts.join(' ');
  }

  // ─── Internal helpers ──────────────────────────────────────

  _emptySynthesis(query) {
    return {
      themes: [],
      keyFindings: [],
      consensusMap: { consensus: [], dissent: [], unknown: [], stanceBreakdown: { supporting: 0, contradicting: 0, contextual: 0 }, overallAssessment: 'No evidence was gathered.' },
      evidenceQuality: { trustDistribution: { high: 0, medium: 0, low: 0 }, recencyDistribution: { lastYear: 0, lastFiveYears: 0, older: 0, undated: 0 }, diversity: { uniqueConnectorTypes: 0, diversityRatio: 0, shannonEntropy: 0 }, specificity: 0 },
      summary: `Regarding "${truncate(query, 80)}", no evidence was gathered. The investigation cannot proceed without data.`,
      stanceBreakdown: { supports: 0, contradicts: 0, contextual: 0, neutral: 0 },
      overallDirection: 'insufficient',
      topFindingSentences: [],
    };
  }

  _evidenceText(ev) {
    const parts = [ev.summary || ''];
    if (ev.data?.title) parts.push(ev.data.title);
    if (ev.data?.description) parts.push(ev.data.description);
    if (ev.data?.snippet) parts.push(ev.data.snippet);
    if (ev.data?.text) parts.push(ev.data.text);
    return parts.join(' ');
  }

  _significantTerms(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  }

  _labelTheme(terms, query) {
    const THEME_LABELS = {
      'recall|defect|nhtsa':           'Safety Recalls & Defects',
      'crash|accident|fatal|death':    'Crash Reports & Fatalities',
      'lawsuit|court|sued|litigation': 'Legal Actions',
      'investigation|probe|enforce':   'Regulatory Investigations',
      'patent|invention|technology':   'Technology & Patents',
      'stock|market|investor|share':   'Market & Investment Activity',
      'revenue|profit|earnings|financial': 'Financial Performance',
      'autonomous|self-driving|autopilot|fsd': 'Autonomous Driving Technology',
      'regulation|policy|congress|bill': 'Regulation & Policy',
      'research|study|paper|journal':  'Academic Research',
      'complaint|consumer|cfpb':       'Consumer Complaints',
      'safety|safe|risk|hazard':       'Safety Assessment',
      'fraud|misleading|deceptive':    'Fraud & Deception Allegations',
      'competitor|waymo|cruise|rival': 'Industry Competition',
      'software|update|version|code':  'Software & Updates',
    };

    const termStr = terms.join(' ');
    for (const [pattern, label] of Object.entries(THEME_LABELS)) {
      if (new RegExp(pattern, 'i').test(termStr)) return label;
    }

    // Fallback to cleaned-up term label
    const queryTerms = new Set(this._significantTerms(query));
    const descriptive = terms
      .filter(t => !queryTerms.has(t) && t.length > 3)
      .slice(0, 2)
      .map(t => t.charAt(0).toUpperCase() + t.slice(1));
    return descriptive.join(' & ') || 'General Context';
  }

  _clusterSentiment(items) {
    let pos = 0, neg = 0;
    for (const ev of items) {
      const words = this._significantTerms(this._evidenceText(ev));
      for (const w of words) {
        if (SENTIMENT_POSITIVE.has(w)) pos++;
        if (SENTIMENT_NEGATIVE.has(w)) neg++;
      }
    }
    if (pos > neg * 1.5) return 'positive';
    if (neg > pos * 1.5) return 'negative';
    if (pos > 0 || neg > 0) return 'mixed';
    return 'neutral';
  }

  _clusterSummary(items, terms) {
    // Pick the most relevant item (highest trust + longest summary)
    const ranked = [...items].sort((a, b) => {
      const scoreA = (a.trustWeight || 0) * 10 + Math.min(200, (a.summary || '').length) / 200;
      const scoreB = (b.trustWeight || 0) * 10 + Math.min(200, (b.summary || '').length) / 200;
      return scoreB - scoreA;
    });

    // Try to find a summary that actually has content (not just a title)
    for (const item of ranked.slice(0, 5)) {
      const text = item.summary || '';
      if (text.length > 40 && !/^certificate|^unknown|^murder/i.test(text)) {
        // Extract first real sentence
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
        if (sentences.length > 0) return truncate(sentences[0].trim(), 200);
        return truncate(text, 200);
      }
    }

    // Fallback: describe the cluster statistically
    const connectors = [...new Set(items.map(e => e.connectorId))];
    const stances = { supports: 0, contradicts: 0, contextual: 0 };
    for (const i of items) stances[i.type || 'contextual']++;
    return `${items.length} evidence items across ${connectors.length} sources (${stances.supports} supporting, ${stances.contradicts} contradicting).`;
  }

  _groupBySimilarity(evidence) {
    // Group evidence items that share significant term overlap (Jaccard > 0.3)
    const groups = [];
    const used = new Set();

    const termSets = evidence.map(ev => ({
      ev,
      terms: new Set(this._significantTerms(this._evidenceText(ev))),
    }));

    for (let i = 0; i < termSets.length; i++) {
      if (used.has(i)) continue;
      const group = [termSets[i].ev];
      used.add(i);

      for (let j = i + 1; j < termSets.length; j++) {
        if (used.has(j)) continue;
        const intersection = [...termSets[i].terms].filter(t => termSets[j].terms.has(t)).length;
        const union = new Set([...termSets[i].terms, ...termSets[j].terms]).size;
        if (union > 0 && intersection / union > 0.3) {
          group.push(termSets[j].ev);
          used.add(j);
        }
      }
      groups.push(group);
    }

    groups.sort((a, b) => b.length - a.length);
    return groups;
  }

  _importanceScore(ev, queryLower, sourceCount) {
    let score = 0.3;
    score += Math.min(0.3, sourceCount * 0.1);
    score += Math.min(0.2, ev.trustWeight * 0.25);
    const text = this._evidenceText(ev).toLowerCase();
    const queryTerms = this._significantTerms(queryLower);
    const hits = queryTerms.filter(t => text.includes(t)).length;
    score += Math.min(0.2, (hits / Math.max(1, queryTerms.length)) * 0.2);
    return Math.min(1, round(score));
  }

  _surpriseScore(ev, claims) {
    // Evidence that contradicts claims or has low prior expectation is surprising
    if (ev.type === 'contradicts') return 0.7;
    if (ev.trustWeight >= 0.8 && ev.type === 'supports') return 0.1;
    return 0.3;
  }

  _evidenceDirection(ev) {
    if (ev.type === 'supports') return 'supports';
    if (ev.type === 'contradicts') return 'contradicts';
    return 'contextual';
  }

  _expectedSourcesFor(queryLower) {
    // Heuristic: what sources should have something to say about this topic?
    const expected = [];
    if (/compan|corp|inc|business|firm/i.test(queryLower)) {
      expected.push('sec_edgar', 'opencorporates', 'gleif');
    }
    if (/safe|recall|injur|death|harm|fda|drug/i.test(queryLower)) {
      expected.push('nhtsa', 'clinical_trials', 'pubmed');
    }
    if (/court|law|legal|sued|indict/i.test(queryLower)) {
      expected.push('courtlistener', 'pacer');
    }
    if (/patent|invent/i.test(queryLower)) {
      expected.push('patents');
    }
    if (/sanction|ofac|terror/i.test(queryLower)) {
      expected.push('ofac', 'opensanctions');
    }
    if (/politic|congress|lobby|campaign/i.test(queryLower)) {
      expected.push('fec', 'congressional_record', 'lobbying');
    }
    return expected;
  }

  _findAgreements(supporting) {
    // Find factual points where 2+ connectors independently agree
    const byConnector = new Map();
    for (const ev of supporting) {
      const key = ev.connectorId || 'unknown';
      if (!byConnector.has(key)) byConnector.set(key, []);
      byConnector.get(key).push(ev);
    }

    if (byConnector.size < 2) return [];

    const agreements = [];
    const connectorEntries = [...byConnector.entries()];

    for (let i = 0; i < connectorEntries.length; i++) {
      for (let j = i + 1; j < connectorEntries.length; j++) {
        const [srcA, itemsA] = connectorEntries[i];
        const [srcB, itemsB] = connectorEntries[j];

        for (const a of itemsA) {
          const aTerms = new Set(this._significantTerms(this._evidenceText(a)));
          for (const b of itemsB) {
            const bTerms = new Set(this._significantTerms(this._evidenceText(b)));
            const intersection = [...aTerms].filter(t => bTerms.has(t)).length;
            const union = new Set([...aTerms, ...bTerms]).size;
            if (union > 4 && intersection / union > 0.35) {
              agreements.push(
                `${srcA} and ${srcB} independently confirm: ${truncate(a.summary || this._evidenceText(a), 100)}`
              );
              break; // one agreement per connector pair is enough
            }
          }
          if (agreements.length > 6) break;
        }
        if (agreements.length > 6) break;
      }
    }

    return [...new Set(agreements)].slice(0, 5);
  }

  _findDisagreements(supporting, contradicting) {
    if (supporting.length === 0 || contradicting.length === 0) return [];

    const dissent = [];
    for (const c of contradicting.slice(0, 10)) {
      const cTerms = new Set(this._significantTerms(this._evidenceText(c)));

      for (const s of supporting.slice(0, 20)) {
        const sTerms = new Set(this._significantTerms(this._evidenceText(s)));
        const overlap = [...cTerms].filter(t => sTerms.has(t)).length;
        if (overlap >= 3) {
          dissent.push(
            `${s.connectorId} supports but ${c.connectorId} contradicts on: ${truncate(c.summary || this._evidenceText(c), 100)}`
          );
          break;
        }
      }
    }

    return dissent.slice(0, 5);
  }

  _findGaps(evidence, claims, query) {
    const gaps = [];
    const connectorTypes = new Set(evidence.map(e => e.connectorId));

    // Check for expected sources that are absent
    const expected = this._expectedSourcesFor((query || '').toLowerCase());
    for (const src of expected) {
      if (!connectorTypes.has(src)) {
        gaps.push(`no data from ${src}`);
      }
    }

    // Check for claims without supporting evidence
    if (claims?.length) {
      const unsupported = claims.filter(c =>
        !evidence.some(e => e.claimId === c.id && e.type === 'supports')
      );
      if (unsupported.length > 0) {
        gaps.push(
          `${unsupported.length} claim${unsupported.length > 1 ? 's' : ''} without direct supporting evidence`
        );
      }
    }

    return gaps.slice(0, 5);
  }

  _computeStance(evidence) {
    let supports = 0, contradicts = 0, contextual = 0, neutral = 0;
    for (const ev of evidence) {
      if (ev.type === 'supports') supports++;
      else if (ev.type === 'contradicts') contradicts++;
      else if (ev.type === 'contextual') contextual++;
      else neutral++;
    }
    return { supports, contradicts, contextual, neutral };
  }

  _determineDirection(stance, evidence) {
    const total = evidence.length;
    if (total < 3) return 'insufficient';

    const directional = stance.supports + stance.contradicts;
    if (directional === 0) return 'insufficient';

    const ratio = stance.supports / directional;
    if (ratio > 0.7) return 'supports';
    if (ratio < 0.3) return 'contradicts';
    return 'contested';
  }

  _strongestSourceType(evidence, direction) {
    const targetType = direction === 'contradicts' ? 'contradicts' : 'supports';
    const relevant = evidence.filter(e => e.type === targetType);
    if (relevant.length === 0) return null;

    // Find the connector with the highest average trust among relevant evidence
    const byConnector = new Map();
    for (const ev of relevant) {
      const key = ev.connectorId || 'unknown';
      if (!byConnector.has(key)) byConnector.set(key, []);
      byConnector.get(key).push(ev.trustWeight);
    }

    let best = null, bestAvg = 0;
    for (const [connector, weights] of byConnector) {
      const avg = weights.reduce((s, w) => s + w, 0) / weights.length;
      if (avg > bestAvg) {
        bestAvg = avg;
        best = connector;
      }
    }

    return best;
  }

  _shannonEntropy(labels) {
    const counts = new Map();
    for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
    const total = labels.length || 1;
    let entropy = 0;
    for (const count of counts.values()) {
      const p = count / total;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    return round(entropy);
  }
}

// ─── Utilities ───────────────────────────────────────────────

function round(n, places = 4) {
  return Math.round(n * 10 ** places) / 10 ** places;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

export default SynthesisEngine;
