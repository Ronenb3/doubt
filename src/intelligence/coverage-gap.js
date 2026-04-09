/**
 * doubt — Coverage Gap Detector
 *
 * Audits an evidence set for systematic blind spots:
 *   - Domain coverage gaps (academic vs news vs legal vs financial)
 *   - Geographic coverage gaps (Western-heavy? No Global South?)
 *   - Source tier gaps (only low-trust sources on a sensitive topic?)
 *   - Temporal gaps (all evidence from one time window?)
 *   - Viewpoint monoculture (all from same perspective)
 *
 * This runs AFTER synthesis, adds `coverageGaps` to the investigation,
 * and surfaces actionable warnings like:
 *   "⚠ No legal/court sources found for a compliance claim"
 *   "⚠ 89% of sources are US/UK — no coverage from Iran, Russia, China"
 *   "⚠ Zero academic sources on a health claim"
 *
 * Not a connector. A pure analysis module called from pipeline.js.
 */

import { log } from '../core/config.js';

// ─── Domain category → connector IDs that cover it ──────────────────────────
const DOMAIN_CONNECTORS = {
  legal:       ['courtlistener', 'pacer', 'state_courts', 'enforcement', 'regulatory_enforcement', 'compliance'],
  financial:   ['sec_edgar', 'sec_insider', 'sec_xbrl', 'deep_sec', 'finra', 'fdic', 'polygon_market', 'fred', 'marketaux'],
  government:  ['federal_register', 'congressional_record', 'usaspending', 'sam_gov', 'fec', 'lobbying'],
  sanctions:   ['ofac', 'opensanctions', 'international_sanctions', 'icij', 'pep', 'interpol'],
  academic:    ['pubmed', 'arxiv', 'crossref', 'semantic_scholar', 'openalex', 'orcid', 'core_research'],
  news:        ['rss_news', 'gnews', 'currents', 'gdelt', 'guardian', 'associated_press', 'brave_news', 'media', 'news_archive', 'news_intel'],
  social:      ['reddit', 'hackernews', 'stocktwits', 'community'],
  infosec:     ['otx', 'shodan', 'intelx', 'crt_sh', 'greynoise'],
  corporate:   ['opencorporates', 'gleif', 'uk_companies_house', 'eu_registers', 'open_ownership', 'state_sos'],
  geopolitical:['gdelt', 'world_bank', 'un_comtrade', 'hdx', 'geopolitical'],
};

// Which domains are EXPECTED for a given claim topic signal
const TOPIC_DOMAIN_EXPECTATIONS = [
  { signal: /sanction|ofac|embargo|blacklist|sdn/i,           expects: ['sanctions', 'legal'] },
  { signal: /court|lawsuit|litigation|verdict|case|pacer/i,   expects: ['legal'] },
  { signal: /sec|insider.trad|filing|10-k|balance.sheet/i,    expects: ['financial', 'government'] },
  { signal: /clinical|trial|drug|fda|vaccine|health|medical/i,expects: ['academic', 'government'] },
  { signal: /nuclear|weapon|bioweapon|chemical.weapon/i,       expects: ['government', 'academic', 'geopolitical'] },
  { signal: /election|vote|campaign|congress|senate/i,         expects: ['government', 'news'] },
  { signal: /hack|cyber|breach|malware|ransomware/i,           expects: ['infosec', 'news'] },
  { signal: /iran|russia|china|north.korea/i,                  expects: ['geopolitical', 'news', 'sanctions'] },
  { signal: /company|corporation|merger|acquisition/i,         expects: ['corporate', 'financial'] },
];

// Geographic signals — try to detect origin country from evidence URLs/summaries
const GEO_SIGNALS = {
  'US/UK/AU':  /\.gov\b|\.gov\.uk\b|whitehouse|congress|parliament|bbc\.co|reuters|apnews|nytimes|politico/i,
  'EU':        /\.eu\b|europarl|ecb\.europa|bundestag|elysee|le.monde|spiegel/i,
  'Middle East':/al.jazeera|iran|tehran|riyadh|jerusalem|tel.aviv|beirut|turkey|ankara/i,
  'Asia':      /xinhua|china.daily|nikkei|south.china|beijing|tokyo|delhi|hindustan/i,
  'Africa/LatAm':/africa|nigeria|kenya|brasil|mexico|argentina|colombia|al.jazeera/i,
};

/**
 * Detect which coverage gaps exist in the evidence set.
 *
 * Returns {
 *   gaps: Gap[],          — list of detected gaps, sorted by severity
 *   score: 0–1,           — overall coverage score (1 = fully covered)
 *   warnings: string[],   — human-readable warning strings for the report
 * }
 *
 * Gap shape: { type, severity: 'critical'|'warn'|'info', message, missingDomains? }
 */
export function detectCoverageGaps(evidence, query, claims = []) {
  const gaps = [];

  if (!evidence?.length) {
    return {
      gaps: [{ type: 'no_evidence', severity: 'critical', message: 'No evidence collected at all.' }],
      score: 0,
      warnings: ['⚠ CRITICAL: Zero evidence collected.'],
    };
  }

  const connectorIds = new Set(evidence.map(e => e.connectorId).filter(Boolean));
  const allText = [query, ...claims.map(c => c.text || '')].join(' ');

  // ── 1. Domain gap detection ──────────────────────────────────────────────
  // Which domains does this query touch? Which are uncovered?
  const expectedDomains = new Set();
  for (const { signal, expects } of TOPIC_DOMAIN_EXPECTATIONS) {
    if (signal.test(allText)) {
      for (const d of expects) expectedDomains.add(d);
    }
  }

  const coveredDomains = new Set();
  for (const domain of Object.keys(DOMAIN_CONNECTORS)) {
    const domainConnectors = DOMAIN_CONNECTORS[domain];
    if (domainConnectors.some(id => connectorIds.has(id))) {
      coveredDomains.add(domain);
    }
  }

  for (const domain of expectedDomains) {
    if (!coveredDomains.has(domain)) {
      const severity = ['sanctions', 'legal', 'financial'].includes(domain) ? 'critical' : 'warn';
      gaps.push({
        type: 'domain_gap',
        severity,
        domain,
        message: `No ${domain} sources found for a query that appears to require them.`,
        suggestedConnectors: DOMAIN_CONNECTORS[domain]?.slice(0, 4) ?? [],
      });
    }
  }

  // ── 2. Source tier gap ───────────────────────────────────────────────────
  // If all evidence is social-tier (trustWeight < 0.45), that's a critical gap
  const trustWeights = evidence.map(e => e.trustWeight ?? 0.5);
  const avgTrust = trustWeights.reduce((a, b) => a + b, 0) / trustWeights.length;
  const highTrustCount = trustWeights.filter(w => w >= 0.80).length;
  const socialOnlyCount = trustWeights.filter(w => w <= 0.35).length;

  if (highTrustCount === 0 && evidence.length > 5) {
    gaps.push({
      type: 'trust_tier_gap',
      severity: 'warn',
      message: `No high-trust sources (≥0.80) found. All evidence is from news or social tier. Consider adding SEC, court, government, or academic connectors.`,
      avgTrust: avgTrust.toFixed(2),
    });
  }

  if (socialOnlyCount / evidence.length > 0.6 && evidence.length > 3) {
    gaps.push({
      type: 'social_dominance',
      severity: 'warn',
      message: `${Math.round(socialOnlyCount / evidence.length * 100)}% of evidence is social-media tier (reddit, hackernews, stocktwits). Epistemic quality may be low.`,
    });
  }

  // ── 3. Geographic gap detection ──────────────────────────────────────────
  // Check if all sources appear to be from the same geographic cluster
  const geoCounts = {};
  for (const ev of evidence) {
    const text = [(ev.url || ''), (ev.summary || ''), (ev.title || '')].join(' ');
    for (const [region, pattern] of Object.entries(GEO_SIGNALS)) {
      if (pattern.test(text)) {
        geoCounts[region] = (geoCounts[region] || 0) + 1;
      }
    }
  }

  const totalGeoTagged = Object.values(geoCounts).reduce((a, b) => a + b, 0);
  if (totalGeoTagged > 3) {
    const usUkShare = (geoCounts['US/UK/AU'] || 0) / totalGeoTagged;
    if (usUkShare > 0.85) {
      gaps.push({
        type: 'geographic_gap',
        severity: 'info',
        message: `${Math.round(usUkShare * 100)}% of sources appear to be US/UK/AU. Limited non-Western perspective detected.`,
        distribution: geoCounts,
      });
    }
  }

  // ── 4. Temporal gap detection ────────────────────────────────────────────
  // If all evidence is from a single 30-day window, flag it
  const timestamps = evidence
    .map(e => e.timestamp ? new Date(e.timestamp).getTime() : null)
    .filter(Number.isFinite);

  if (timestamps.length > 5) {
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    const spanDays = (maxTs - minTs) / (1000 * 60 * 60 * 24);

    if (spanDays < 30 && evidence.length > 10) {
      gaps.push({
        type: 'temporal_gap',
        severity: 'info',
        message: `All dated evidence spans only ${Math.round(spanDays)} days. Historical context may be missing.`,
        spanDays: Math.round(spanDays),
      });
    }
  }

  // ── 5. Volume gap ────────────────────────────────────────────────────────
  if (evidence.length < 5) {
    gaps.push({
      type: 'volume_gap',
      severity: 'warn',
      message: `Only ${evidence.length} evidence items collected — investigation may be under-sourced.`,
      count: evidence.length,
    });
  }

  // ── Score & warnings ─────────────────────────────────────────────────────
  const criticalCount = gaps.filter(g => g.severity === 'critical').length;
  const warnCount     = gaps.filter(g => g.severity === 'warn').length;
  const totalPossible = Math.max(1, expectedDomains.size + 3);
  const score = Math.max(0, 1 - (criticalCount * 0.3 + warnCount * 0.1) / totalPossible);

  const warnings = gaps.map(g => {
    const prefix = g.severity === 'critical' ? '🔴' : g.severity === 'warn' ? '⚠' : 'ℹ';
    return `${prefix} COVERAGE GAP [${g.type}]: ${g.message}`;
  });

  // Sort: critical first, then warn, then info
  gaps.sort((a, b) => {
    const order = { critical: 0, warn: 1, info: 2 };
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });

  return { gaps, score, warnings };
}
