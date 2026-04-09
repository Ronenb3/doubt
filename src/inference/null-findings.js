/**
 * doubt — Null Finding Detector
 *
 * "The dog that didn't bark."
 *
 * In Arthur Conan Doyle's "Silver Blaze," Sherlock Holmes solves the case
 * by noticing what DIDN'T happen: the guard dog didn't bark, which meant
 * the intruder was someone the dog knew. The absence was the evidence.
 *
 * This module implements the same logic computationally.
 *
 * The absence of expected evidence is itself evidence. If a company claims
 * $2B in annual revenue, SEC filings MUST exist. If a person claims a PhD,
 * a dissertation MUST be findable. If a drug is "FDA approved," FDA records
 * MUST confirm it.
 *
 * These absences are often more diagnostic than positive findings. Positive
 * evidence can be fabricated, cherry-picked, or derivative. But the
 * non-existence of mandatory records — filings that MUST exist by law,
 * registrations that MUST exist by regulation, publications that MUST
 * exist by academic norm — is very hard to fake.
 *
 * Every verification tool counts what it finds.
 * This module counts what it SHOULD have found but didn't.
 */

import { EvidenceType } from '../core/schema.js';
import { log } from '../core/config.js';

// ─── Evidence Expectation Rules ──────────────────────────────
//
// These rules encode domain knowledge: given a claim of type X,
// what evidence MUST exist in the world if the claim is true?
//
// The severity tiers reflect how diagnostic each absence is:
//   critical (0.8-1.0)  — legally required records (SEC, court, patent)
//   high     (0.6-0.8)  — strongly expected records (corporate registry, WHOIS)
//   moderate (0.4-0.6)  — normally expected coverage (news, academic databases)
//   low      (0.2-0.4)  — nice-to-have signals (social media, Wikipedia)

const EXPECTATION_RULES = [
  {
    id: 'financial',
    patterns: [
      /\b(revenue|profit|earnings|income|loss|valuation|market\s*cap|ipo|quarterly|annual\s+report|10-[kq]|sec\s+filing)\b/i,
      /\$[\d,.]+\s*(billion|million|B|M|T)/i,
    ],
    expectedSources: [
      { connectorId: 'sec_edgar',      because: 'Public financial claims require SEC filings',              baseSeverity: 0.9 },
      { connectorId: 'sec_xbrl',       because: 'Structured financial data should exist in XBRL format',   baseSeverity: 0.75 },
      { connectorId: 'polygon_market',  because: 'Publicly traded companies have market data',             baseSeverity: 0.7 },
      { connectorId: 'fred',           because: 'Major financial metrics appear in economic databases',     baseSeverity: 0.5 },
    ],
  },
  {
    id: 'corporate',
    patterns: [
      /\b(company|corporation|inc|llc|ltd|gmbh|founded|headquartered|employees?|subsidiary|parent\s+company|incorporated)\b/i,
    ],
    expectedSources: [
      { connectorId: 'opencorporates',  because: 'Registered companies appear in corporate registries',     baseSeverity: 0.8 },
      { connectorId: 'gleif',           because: 'Financial entities have Legal Entity Identifiers',        baseSeverity: 0.65 },
      { connectorId: 'open_ownership',  because: 'Beneficial ownership should be registered',               baseSeverity: 0.6 },
      { connectorId: 'state_sos',       because: 'US companies register with state Secretaries of State',   baseSeverity: 0.75 },
    ],
  },
  {
    id: 'legal',
    patterns: [
      /\b(lawsuit|sued|litigation|court|ruling|verdict|settlement|plaintiff|defendant|indicted|convicted|arraigned|docket)\b/i,
    ],
    expectedSources: [
      { connectorId: 'courtlistener',  because: 'Federal court cases appear in CourtListener/PACER',       baseSeverity: 0.85 },
      { connectorId: 'pacer',          because: 'Federal litigation requires PACER docket entries',         baseSeverity: 0.9 },
      { connectorId: 'state_courts',   because: 'State-level cases appear in state court systems',          baseSeverity: 0.7 },
    ],
  },
  {
    id: 'political',
    patterns: [
      /\b(campaign|election|donated|lobbied|lobbyist|pac|super\s*pac|political\s+contribution|fec|congressional)\b/i,
    ],
    expectedSources: [
      { connectorId: 'fec',              because: 'Political contributions and campaigns are FEC-reported', baseSeverity: 0.85 },
      { connectorId: 'lobbying',         because: 'Lobbying activities require federal disclosure',         baseSeverity: 0.8 },
      { connectorId: 'federal_register', because: 'Regulatory actions appear in the Federal Register',     baseSeverity: 0.7 },
    ],
  },
  {
    id: 'academic',
    patterns: [
      /\b(published|peer[\s-]?reviewed|journal|study|research\s+paper|dissertation|phd|professor|cited\s+by|meta[\s-]?analysis)\b/i,
    ],
    expectedSources: [
      { connectorId: 'openalex',           because: 'Academic publications are indexed in OpenAlex',       baseSeverity: 0.85 },
      { connectorId: 'semantic_scholar',   because: 'Research papers appear in Semantic Scholar',          baseSeverity: 0.8 },
      { connectorId: 'crossref',           because: 'Published works have DOIs registered with Crossref',  baseSeverity: 0.75 },
      { connectorId: 'pubmed',             because: 'Biomedical research appears in PubMed',               baseSeverity: 0.7 },
    ],
  },
  {
    id: 'infrastructure',
    patterns: [
      /\b(domain|website|url|server|hosted|registered\s+domain|dns|ssl|certificate|online\s+presence)\b/i,
    ],
    expectedSources: [
      { connectorId: 'whois',     because: 'Registered domains have WHOIS records',                         baseSeverity: 0.8 },
      { connectorId: 'crt_sh',    because: 'Websites with HTTPS have Certificate Transparency logs',        baseSeverity: 0.65 },
      { connectorId: 'wayback',   because: 'Established websites appear in the Wayback Machine',            baseSeverity: 0.55 },
    ],
  },
  {
    id: 'sanctions_compliance',
    patterns: [
      /\b(sanction(?:ed|s)?|embargo|ofac|sdn\s+list|blocked\s+person|specially\s+designated|compliance|aml|kyc|money\s+laundering)\b/i,
    ],
    expectedSources: [
      { connectorId: 'ofac',                    because: 'US sanctions appear on the OFAC SDN list',                baseSeverity: 0.9 },
      { connectorId: 'opensanctions',            because: 'International sanctions are aggregated by OpenSanctions', baseSeverity: 0.85 },
      { connectorId: 'international_sanctions',   because: 'Multi-jurisdictional sanctions data should exist',       baseSeverity: 0.8 },
    ],
  },
  {
    id: 'public_figure',
    patterns: [
      /\b(ceo|president|senator|governor|director|chairman|spokesperson|celebrity|public\s+figure|well[\s-]?known)\b/i,
    ],
    expectedSources: [
      { connectorId: 'wikipedia',    because: 'Notable public figures typically have Wikipedia entries',    baseSeverity: 0.45 },
      { connectorId: 'gdelt',        because: 'Public figures generate news coverage tracked by GDELT',    baseSeverity: 0.5 },
      { connectorId: 'duckduckgo',   because: 'Public figures have significant search-engine footprints',  baseSeverity: 0.35 },
    ],
  },
  {
    id: 'patent_ip',
    patterns: [
      /\b(patent(?:ed)?|intellectual\s+property|trademark|copyright|invention|patent\s+number|uspto|wipo)\b/i,
    ],
    expectedSources: [
      { connectorId: 'patents',   because: 'Patents are registered with national patent offices',    baseSeverity: 0.9 },
    ],
  },
  {
    id: 'medical',
    patterns: [
      /\b(fda[\s-]?approved|clinical\s+trial|drug|therapeutic|treatment|diagnosed|medical\s+device|pharmaceutical|phase\s+[1-4])\b/i,
    ],
    expectedSources: [
      { connectorId: 'pubmed',           because: 'Medical claims should have PubMed-indexed evidence',          baseSeverity: 0.8 },
      { connectorId: 'clinical_trials',  because: 'Clinical trials must be registered on ClinicalTrials.gov',   baseSeverity: 0.85 },
    ],
  },
  {
    id: 'government_spending',
    patterns: [
      /\b(government\s+contract|federal\s+grant|procurement|awarded|taxpayer|appropriat(?:ed|ion)|budget|federal\s+spending)\b/i,
    ],
    expectedSources: [
      { connectorId: 'usa_spending',          because: 'Federal spending is tracked on USASpending.gov',             baseSeverity: 0.85 },
      { connectorId: 'federal_procurement',   because: 'Government contracts appear in procurement databases',       baseSeverity: 0.8 },
      { connectorId: 'sam_gov',               because: 'Government contractors must register on SAM.gov',            baseSeverity: 0.75 },
    ],
  },
  {
    id: 'enforcement',
    patterns: [
      /\b(violation|fine|penalty|enforcement\s+action|consent\s+order|cease\s+and\s+desist|regulatory\s+action|sec\s+enforcement)\b/i,
    ],
    expectedSources: [
      { connectorId: 'enforcement',            because: 'Enforcement actions appear in regulatory databases',   baseSeverity: 0.85 },
      { connectorId: 'regulatory_enforcement',  because: 'Regulatory penalties are publicly disclosed',         baseSeverity: 0.8 },
      { connectorId: 'finra',                   because: 'Financial industry actions appear in FINRA BrokerCheck', baseSeverity: 0.75 },
    ],
  },
];

// Source authority tiers: how diagnostic is the absence of this source type?
const SOURCE_AUTHORITY = {
  // Government/primary sources: absence is highly diagnostic
  sec_edgar: 1.0, pacer: 1.0, fec: 0.95, ofac: 0.95, patents: 0.95,
  usa_spending: 0.9, courtlistener: 0.9, clinical_trials: 0.9,
  federal_register: 0.85, sam_gov: 0.85, finra: 0.85,

  // Institutional/registry sources: absence is moderately diagnostic
  opencorporates: 0.8, openalex: 0.8, gleif: 0.75, crossref: 0.75,
  opensanctions: 0.8, state_sos: 0.75, state_courts: 0.7,

  // Reference/secondary sources: absence is weakly diagnostic
  wikipedia: 0.4, gdelt: 0.45, whois: 0.6, pubmed: 0.7,
  duckduckgo: 0.3, wayback: 0.4, crt_sh: 0.5,
};

export class NullFindingDetector {
  constructor() {
    this._rules = EXPECTATION_RULES;
  }

  /**
   * Detect null findings: evidence that SHOULD exist but doesn't.
   *
   * @param {Array} claims - The claims being investigated
   * @param {Array} evidence - All gathered evidence
   * @param {Array} connectorResults - Raw results from pipeline: [{connectorId, evidence, error}]
   * @returns {Array} NullFinding objects
   */
  detectNullFindings(claims, evidence, connectorResults) {
    const findings = [];
    const queriedConnectors = new Set(connectorResults.map(r => r.connectorId));
    const connectorHasResults = new Map(
      connectorResults.map(r => [r.connectorId, !!(r.evidence && r.evidence.length > 0)])
    );

    for (const claim of claims) {
      const text = claim.text || '';
      const matchedRules = this._matchRules(text);

      for (const rule of matchedRules) {
        for (const expected of rule.expectedSources) {
          const queried = queriedConnectors.has(expected.connectorId);
          const returned = connectorHasResults.get(expected.connectorId) || false;

          // Check if any returned evidence is actually relevant to this claim
          const relevantFound = queried && returned && this._hasRelevantEvidence(
            claim, evidence, expected.connectorId
          );

          const severity = this._computeSeverity(
            expected, queried, returned, relevantFound
          );

          // Only report findings where something is actually missing
          if (severity > 0.1) {
            findings.push({
              claimId: claim.id,
              claimText: text,
              expectedSource: expected.connectorId,
              expectedBecause: expected.because,
              ruleId: rule.id,
              connectorQueried: queried,
              connectorReturned: returned,
              relevantResultFound: relevantFound,
              severity: round(severity),
              interpretation: this._interpretAbsence(
                expected, queried, returned, relevantFound, text
              ),
            });
          }
        }
      }
    }

    findings.sort((a, b) => b.severity - a.severity);
    log('info', `Detected ${findings.length} null findings across ${claims.length} claims`);
    return findings;
  }

  /**
   * Aggregate severity across all null findings.
   *
   * The aggregate reflects how many expected sources are missing and
   * how authoritative those sources are. Missing a government filing
   * is catastrophic. Missing a Wikipedia article is a footnote.
   */
  severityScore(nullFindings) {
    if (nullFindings.length === 0) {
      return { score: 0, criticalAbsences: [], summary: 'No expected evidence was found to be missing.' };
    }

    const critical = nullFindings.filter(f => f.severity >= 0.7);
    const moderate = nullFindings.filter(f => f.severity >= 0.4 && f.severity < 0.7);

    // Weighted aggregate: critical absences dominate
    const criticalWeight = critical.reduce((sum, f) => sum + f.severity, 0);
    const moderateWeight = moderate.reduce((sum, f) => sum + f.severity * 0.5, 0);
    const totalPossible = nullFindings.length;

    const rawScore = (criticalWeight + moderateWeight) / Math.max(1, totalPossible);
    const score = clamp(rawScore);

    const criticalAbsences = critical.map(f => ({
      source: f.expectedSource,
      claim: f.claimText.slice(0, 120),
      severity: f.severity,
      reason: f.expectedBecause,
    }));

    let summary;
    if (critical.length === 0) {
      summary = `${nullFindings.length} expected source${nullFindings.length === 1 ? '' : 's'} ` +
        `returned no relevant results, but none are from critical authoritative sources.`;
    } else {
      summary = `${critical.length} critical absence${critical.length === 1 ? '' : 's'} detected. ` +
        `${critical.map(f => f.expectedSource).join(', ')} ` +
        `should have returned results but did not. ` +
        `This significantly undermines the verifiability of the investigated claims.`;
    }

    return { score: round(score), criticalAbsences, summary };
  }

  /**
   * Generate a human-readable narrative of what's missing and why it matters.
   *
   * The goal: a paragraph that a journalist, analyst, or skeptic would find
   * immediately useful. Not technical jargon — clear reasoning about what
   * the silence means.
   */
  generateAbsenceNarrative(nullFindings) {
    if (nullFindings.length === 0) {
      return 'All expected evidentiary sources returned relevant results. ' +
        'No significant absences were detected.';
    }

    const critical = nullFindings.filter(f => f.severity >= 0.7);
    const moderate = nullFindings.filter(f => f.severity >= 0.4 && f.severity < 0.7);
    const minor = nullFindings.filter(f => f.severity < 0.4);

    const parts = [];

    if (critical.length > 0) {
      const grouped = groupByClaimId(critical);
      for (const [claimId, findings] of Object.entries(grouped)) {
        const claimText = findings[0].claimText;
        const sources = findings.map(f => formatSourceName(f.expectedSource));
        const uniqueSources = [...new Set(sources)];

        parts.push(
          `Despite the claim that "${truncate(claimText, 100)}," ` +
          `no results were found in ${uniqueSources.join(', ')}. ` +
          `${findings[0].interpretation}`
        );
      }
    }

    if (moderate.length > 0) {
      const sourceList = [...new Set(moderate.map(f => formatSourceName(f.expectedSource)))];
      parts.push(
        `Additionally, ${moderate.length} moderately expected source${moderate.length === 1 ? '' : 's'} ` +
        `(${sourceList.slice(0, 4).join(', ')}${sourceList.length > 4 ? ', and others' : ''}) ` +
        `returned no relevant results.`
      );
    }

    if (minor.length > 0 && critical.length === 0 && moderate.length === 0) {
      parts.push(
        `${minor.length} secondary source${minor.length === 1 ? '' : 's'} returned no relevant results. ` +
        `These absences are not individually significant but may reflect limited public visibility.`
      );
    }

    // Add the "what this means" coda
    if (critical.length > 0) {
      const notQueriedCount = nullFindings.filter(f => !f.connectorQueried).length;
      if (notQueriedCount > 0) {
        parts.push(
          `Note: ${notQueriedCount} expected source${notQueriedCount === 1 ? ' was' : 's were'} ` +
          `not queried during this investigation. Querying these sources could resolve some absences.`
        );
      }
    }

    return parts.join(' ');
  }

  // ─── Internal ───────────────────────────────────────────────

  _matchRules(claimText) {
    return this._rules.filter(rule =>
      rule.patterns.some(pattern => pattern.test(claimText))
    );
  }

  /**
   * Check if any evidence from a specific connector is actually relevant
   * to a given claim. Raw result count isn't enough — a WHOIS connector
   * might return results about a completely different domain.
   */
  _hasRelevantEvidence(claim, allEvidence, connectorId) {
    const connectorEvidence = allEvidence.filter(e => e.connectorId === connectorId);
    if (connectorEvidence.length === 0) return false;

    const claimTerms = extractKeyTerms(claim.text);
    return connectorEvidence.some(e => {
      const evidenceTerms = extractKeyTerms(e.summary || '');
      return termOverlap(claimTerms, evidenceTerms) > 0.08;
    });
  }

  /**
   * Compute how severe this particular absence is.
   *
   * Three scenarios, from most to least severe:
   * 1. Connector was queried, returned results, but none relevant → high severity
   *    (The data exists, it just doesn't support the claim)
   * 2. Connector was queried but returned nothing → moderate-high severity
   *    (The source had no data at all)
   * 3. Connector was NOT queried → reduced severity
   *    (We can't conclude absence — we never looked)
   */
  _computeSeverity(expected, queried, returned, relevantFound) {
    const base = expected.baseSeverity;
    const authority = SOURCE_AUTHORITY[expected.connectorId] || 0.5;

    if (!queried) {
      // We didn't even look — can't call it a true null finding,
      // but it's still a gap in the investigation
      return base * 0.3;
    }

    if (queried && !returned) {
      // Looked and found nothing at all
      return base * authority * 0.9;
    }

    if (queried && returned && !relevantFound) {
      // Looked, found things, but nothing relevant — the most telling absence.
      // The source HAS data; it just doesn't have data supporting this claim.
      return base * authority;
    }

    // Relevant evidence was found — no null finding
    return 0;
  }

  _interpretAbsence(expected, queried, returned, relevantFound, claimText) {
    if (!queried) {
      return `${formatSourceName(expected.connectorId)} was not queried during this investigation. ` +
        `${expected.because}. This source should be consulted to fill this gap.`;
    }

    if (queried && !returned) {
      return `${formatSourceName(expected.connectorId)} was queried but returned no results. ` +
        `${expected.because}. ` +
        `Either the information does not exist in this source, it is filed under ` +
        `a different name or entity, or the claim is unsubstantiated by this source.`;
    }

    if (queried && returned && !relevantFound) {
      return `${formatSourceName(expected.connectorId)} returned results, but none were relevant ` +
        `to this specific claim. ${expected.because}. ` +
        `The source contains data in this domain, but nothing that corroborates ` +
        `the claim in question — a telling silence.`;
    }

    return 'Expected evidence was found.';
  }
}

// ─── Utility ────────────────────────────────────────────────

function extractKeyTerms(text) {
  if (!text) return new Set();
  const stopwords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'that', 'this', 'it', 'not', 'and',
    'or', 'but', 'if', 'as', 'its', 'than', 'into', 'also', 'about',
  ]);
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  return new Set(words.filter(w => w.length > 2 && !stopwords.has(w)));
}

function termOverlap(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const term of setA) {
    if (setB.has(term)) overlap++;
  }
  return overlap / Math.max(setA.size, setB.size);
}

function groupByClaimId(findings) {
  const groups = {};
  for (const f of findings) {
    if (!groups[f.claimId]) groups[f.claimId] = [];
    groups[f.claimId].push(f);
  }
  return groups;
}

function formatSourceName(connectorId) {
  const names = {
    sec_edgar: 'SEC EDGAR', sec_xbrl: 'SEC XBRL', fec: 'FEC',
    ofac: 'OFAC', pacer: 'PACER', courtlistener: 'CourtListener',
    opencorporates: 'OpenCorporates', gleif: 'GLEIF', openalex: 'OpenAlex',
    semantic_scholar: 'Semantic Scholar', crossref: 'Crossref',
    pubmed: 'PubMed', whois: 'WHOIS', crt_sh: 'crt.sh',
    wayback: 'Wayback Machine', wikipedia: 'Wikipedia', gdelt: 'GDELT',
    patents: 'USPTO Patents', clinical_trials: 'ClinicalTrials.gov',
    usa_spending: 'USASpending.gov', federal_procurement: 'Federal Procurement Data',
    sam_gov: 'SAM.gov', opensanctions: 'OpenSanctions', duckduckgo: 'DuckDuckGo',
    state_sos: 'State Secretary of State', state_courts: 'State Court Records',
    open_ownership: 'Open Ownership', fred: 'FRED', polygon_market: 'Polygon.io',
    federal_register: 'Federal Register', lobbying: 'Federal Lobbying Disclosures',
    finra: 'FINRA BrokerCheck', enforcement: 'Enforcement Actions Database',
    regulatory_enforcement: 'Regulatory Enforcement Database',
    international_sanctions: 'International Sanctions Data',
  };
  return names[connectorId] || connectorId;
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function clamp(n, min = 0, max = 1) {
  return Math.max(min, Math.min(max, n));
}

function round(n, places = 4) {
  return Math.round(n * 10 ** places) / 10 ** places;
}

export default NullFindingDetector;
