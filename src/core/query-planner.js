/**
 * doubt — Query Planner
 *
 * The intelligence layer between a human question and 82 data sources.
 *
 * The problem: "Tesla full self-driving is safe for public roads" is
 * a perfectly good question for a human. But SEC needs a ticker (TSLA).
 * NHTSA needs a make (Tesla). PubMed needs medical terminology
 * ("autonomous vehicle collision injury"). CourtListener needs legal
 * phrases ("autopilot negligence"). Each connector speaks a different
 * language. The query planner translates.
 *
 * Beyond translation, it thinks laterally:
 * - Competitor comparison (Waymo, Cruise safety records)
 * - Adjacent domains (autonomous vehicle regulation, lidar vs vision)
 * - Counter-evidence targets (Tesla recalls, crash investigations)
 * - Expected evidence (NHTSA data should exist, academic papers should exist)
 *
 * The planner produces a SearchPlan: a set of connector-specific queries
 * that are each tailored to what that connector can actually find.
 */

import { log } from './config.js';

// Well-known entity mappings for financial sources
const TICKER_MAP = {
  'tesla': 'TSLA', 'apple': 'AAPL', 'microsoft': 'MSFT', 'google': 'GOOGL',
  'alphabet': 'GOOGL', 'amazon': 'AMZN', 'meta': 'META', 'facebook': 'META',
  'nvidia': 'NVDA', 'openai': null, 'anthropic': null, 'spacex': null,
  'twitter': null, 'x corp': null, 'netflix': 'NFLX', 'disney': 'DIS',
  'boeing': 'BA', 'lockheed': 'LMT', 'raytheon': 'RTX', 'pfizer': 'PFE',
  'moderna': 'MRNA', 'johnson & johnson': 'JNJ', 'jp morgan': 'JPM',
  'goldman sachs': 'GS', 'berkshire': 'BRK-A', 'walmart': 'WMT',
  'exxon': 'XOM', 'chevron': 'CVX', 'coca-cola': 'KO', 'pepsi': 'PEP',
};

const CIK_MAP = {
  'TSLA': '0001318605', 'AAPL': '0000320193', 'MSFT': '0000789019',
  'GOOGL': '0001652044', 'AMZN': '0001018724', 'META': '0001326801',
  'NVDA': '0001045810', 'NFLX': '0001065280', 'BA': '0000012927',
  'PFE': '0000078003',
};

// Domain-specific synonym expansion
const DOMAIN_SYNONYMS = {
  'self-driving': ['autonomous', 'driverless', 'automated driving', 'autopilot', 'FSD', 'ADAS', 'driver assistance'],
  'safe': ['safety', 'accident', 'crash', 'collision', 'fatality', 'injury', 'recall', 'defect', 'incident'],
  'electric vehicle': ['EV', 'electric car', 'BEV', 'battery electric'],
  'artificial intelligence': ['AI', 'machine learning', 'neural network', 'deep learning'],
  'cryptocurrency': ['crypto', 'bitcoin', 'blockchain', 'digital currency'],
  'climate change': ['global warming', 'carbon emissions', 'greenhouse gas', 'climate crisis'],
};

// Connector type → query strategy
const CONNECTOR_STRATEGIES = {
  // Financial connectors need tickers, company names, or CIKs
  sec_edgar: { type: 'entity', prefer: 'company_name', fallback: 'topic' },
  sec_xbrl: { type: 'entity', prefer: 'cik', fallback: 'ticker' },
  sec_insider: { type: 'entity', prefer: 'company_name', fallback: 'ticker' },
  deep_sec: { type: 'entity', prefer: 'company_name', fallback: 'topic' },
  finra: { type: 'entity', prefer: 'person_or_company', fallback: 'topic' },
  fdic: { type: 'entity', prefer: 'company_name', fallback: 'topic' },
  gleif: { type: 'entity', prefer: 'company_name' },
  polygon_market: { type: 'entity', prefer: 'ticker' },
  market_intelligence: { type: 'entity', prefer: 'ticker', fallback: 'company_name' },
  stocktwits: { type: 'entity', prefer: 'ticker' },
  fred: { type: 'topic', prefer: 'economic_term' },
  bls: { type: 'topic', prefer: 'economic_term' },
  cftc_cot: { type: 'topic', prefer: 'commodity_term' },
  cme_warehouse: { type: 'topic', prefer: 'commodity_term' },

  // Legal connectors need legal phrases, party names
  courtlistener: { type: 'entity', prefer: 'legal_query', fallback: 'company_name' },
  pacer: { type: 'entity', prefer: 'legal_query', fallback: 'company_name' },
  state_courts: { type: 'entity', prefer: 'legal_query', fallback: 'company_name' },
  enforcement: { type: 'entity', prefer: 'company_name', fallback: 'topic' },

  // Safety/government connectors need specific terms
  nhtsa: { type: 'entity', prefer: 'make_model', fallback: 'company_name' },
  cfpb: { type: 'entity', prefer: 'company_name', fallback: 'topic' },
  fbi: { type: 'entity', prefer: 'person_name', fallback: 'topic' },
  interpol: { type: 'entity', prefer: 'person_name', fallback: 'topic' },
  ofac: { type: 'entity', prefer: 'person_or_company', fallback: 'topic' },
  opensanctions: { type: 'entity', prefer: 'person_or_company', fallback: 'topic' },
  sam_gov: { type: 'entity', prefer: 'company_name', fallback: 'topic' },
  federal_register: { type: 'topic', prefer: 'regulatory_term', fallback: 'topic' },
  congressional_record: { type: 'topic', prefer: 'policy_term', fallback: 'topic' },
  government: { type: 'topic', prefer: 'topic' },

  // Geopolitical / international connectors use natural language topic queries
  geopolitical: { type: 'topic', prefer: 'news_query' },
  international_sanctions: { type: 'topic', prefer: 'news_query' },
  icij: { type: 'entity', prefer: 'person_or_company', fallback: 'topic' },
  pep: { type: 'entity', prefer: 'person_or_company', fallback: 'topic' },
  world_bank: { type: 'topic', prefer: 'topic' },
  un_comtrade: { type: 'topic', prefer: 'topic' },
  immigration: { type: 'topic', prefer: 'topic' },
  geospatial: { type: 'topic', prefer: 'topic' },
  supply_chain: { type: 'topic', prefer: 'topic' },

  // Academic connectors need research terms
  openalex: { type: 'topic', prefer: 'academic_term' },
  semantic_scholar: { type: 'topic', prefer: 'academic_term' },
  crossref: { type: 'topic', prefer: 'academic_term' },
  arxiv: { type: 'topic', prefer: 'academic_term' },
  pubmed: { type: 'topic', prefer: 'medical_term' },
  clinical_trials: { type: 'topic', prefer: 'medical_term' },
  papers_with_code: { type: 'topic', prefer: 'technical_term' },

  // Corporate connectors need company names
  opencorporates: { type: 'entity', prefer: 'company_name' },
  uk_companies_house: { type: 'entity', prefer: 'company_name' },
  eu_registers: { type: 'entity', prefer: 'company_name' },
  open_ownership: { type: 'entity', prefer: 'company_name' },
  propublica_nonprofits: { type: 'entity', prefer: 'company_name' },

  // News/general connectors work with natural language
  gdelt: { type: 'topic', prefer: 'news_query' },
  wikipedia: { type: 'topic', prefer: 'topic' },
  reddit: { type: 'topic', prefer: 'social_query' },
  hackernews: { type: 'topic', prefer: 'topic' },
  duckduckgo: { type: 'topic', prefer: 'natural_language' },
  google_factcheck: { type: 'topic', prefer: 'claim' },
  media: { type: 'topic', prefer: 'topic' },
  news_intel: { type: 'topic', prefer: 'topic' },
  news_archive: { type: 'topic', prefer: 'topic' },

  // New connectors (added connectors batch)
  guardian:           { type: 'topic', prefer: 'news_query' },
  hdx:                { type: 'topic', prefer: 'topic' },
  wikidata:           { type: 'entity', prefer: 'person_or_company', fallback: 'topic' },
  greynoise:          { type: 'entity', prefer: 'domain', fallback: 'topic' },
  core_research:      { type: 'topic', prefer: 'academic_term' },
  marketaux:          { type: 'entity', prefer: 'ticker', fallback: 'company_name' },
  perspective:        { type: 'topic', prefer: 'social_query' },
  opensky:            { type: 'entity', prefer: 'person_or_company', fallback: 'topic' },
  associated_press:   { type: 'topic', prefer: 'news_query' },

  // Recency/real-time connectors — RSS, metasearch, Brave News, GNews, Currents
  rss_news:   { type: 'topic', prefer: 'news_query' },
  searxng:    { type: 'topic', prefer: 'natural_language' },
  brave_news: { type: 'topic', prefer: 'news_query' },
  gnews:      { type: 'topic', prefer: 'news_query' },
  currents:   { type: 'topic', prefer: 'news_query' },

  // Government spending
  usaspending: { type: 'topic', prefer: 'topic' },

  // Geocoding
  nominatim: { type: 'topic', prefer: 'topic' },

  // Threat intelligence / OSINT / Security
  otx:    { type: 'topic', prefer: 'topic' },
  intelx: { type: 'topic', prefer: 'natural_language' },
  shodan: { type: 'topic', prefer: 'natural_language' },

  // IP/Patents
  patents: { type: 'topic', prefer: 'technical_term' },

  // Infrastructure
  crt_sh: { type: 'entity', prefer: 'domain' },
  whois: { type: 'entity', prefer: 'domain' },
  wayback: { type: 'entity', prefer: 'url' },
  github: { type: 'topic', prefer: 'technical_term' },
  github_deep: { type: 'topic', prefer: 'technical_term' },

  // Previously missing strategies — needed for depth=deep routing
  usa_spending: { type: 'topic', prefer: 'topic' },
  fec: { type: 'topic', prefer: 'topic' },
  lobbying: { type: 'topic', prefer: 'topic' },
  blockchain: { type: 'topic', prefer: 'topic' },
  alternative_data: { type: 'topic', prefer: 'topic' },
  job_postings: { type: 'topic', prefer: 'topic' },
  property_records: { type: 'topic', prefer: 'topic' },
  aircraft: { type: 'entity', prefer: 'person_or_company', fallback: 'topic' },
  health: { type: 'topic', prefer: 'medical_term' },
  community: { type: 'topic', prefer: 'social_query' },
  youtube_transcript: { type: 'topic', prefer: 'topic' },
  compliance: { type: 'entity', prefer: 'company_name', fallback: 'topic' },
  regulatory_enforcement: { type: 'entity', prefer: 'company_name', fallback: 'topic' },
  state_sos: { type: 'entity', prefer: 'company_name' },
  huggingface: { type: 'topic', prefer: 'technical_term' },
  orcid: { type: 'entity', prefer: 'person_name', fallback: 'topic' },
  federal_procurement: { type: 'entity', prefer: 'company_name', fallback: 'topic' },
  stackexchange: { type: 'topic', prefer: 'topic' },

  // Internal ecosystem connectors — local services that enrich doubt with personal/private data
  innernet:   { type: 'topic', prefer: 'natural_language' },   // Personal knowledge graph — belief context, prior investigations
  tiktalk:    { type: 'topic', prefer: 'social_query' },        // TikTok creator corpus — 391 creators, 856K words
  ebs_bridge: { type: 'entity', prefer: 'company_name', fallback: 'topic' }, // EBS orchestrator — 50 deep OSINT sources

  // Deep public data connectors (March 2026)
  openfda:              { type: 'topic', prefer: 'medical_term', fallback: 'company_name' },
  nih_reporter:         { type: 'topic', prefer: 'academic_term' },
  nsf_awards:           { type: 'topic', prefer: 'academic_term' },
  epa_echo:             { type: 'entity', prefer: 'company_name', fallback: 'topic' },
  fara:                 { type: 'entity', prefer: 'person_or_company', fallback: 'topic' },
  biorxiv:              { type: 'topic', prefer: 'medical_term' },
  chronicling_america:  { type: 'topic', prefer: 'topic' },
  dol_enforcement:      { type: 'entity', prefer: 'company_name', fallback: 'topic' },
  census_trade:         { type: 'entity', prefer: 'topic', fallback: 'topic' },
};

// Domain → relevant connector IDs (only these get queried when the domain is detected)
const DOMAIN_CONNECTOR_MAP = {
  vehicle_safety: ['nhtsa', 'federal_register', 'courtlistener', 'cfpb', 'news_archive', 'google_factcheck', 'enforcement'],
  safety: ['nhtsa', 'federal_register', 'courtlistener', 'cfpb', 'news_archive', 'google_factcheck', 'enforcement', 'openfda', 'dol_enforcement', 'epa_echo'],
  autonomous_vehicles: ['nhtsa', 'federal_register', 'courtlistener', 'patents', 'arxiv', 'semantic_scholar', 'openalex', 'crossref', 'github', 'papers_with_code'],
  technology: ['github', 'github_deep', 'arxiv', 'semantic_scholar', 'crossref', 'patents', 'hackernews', 'openalex', 'papers_with_code'],
  corporate: ['sec_edgar', 'opencorporates', 'gleif', 'open_ownership', 'propublica_nonprofits', 'ebs_bridge'],
  financial: ['sec_edgar', 'sec_xbrl', 'sec_insider', 'deep_sec', 'finra', 'fred', 'bls', 'polygon_market', 'stocktwits', 'market_intelligence', 'fdic', 'cftc_cot', 'cme_warehouse'],
  legal: ['courtlistener', 'pacer', 'state_courts', 'federal_register', 'enforcement'],
  medical: ['pubmed', 'clinical_trials', 'openalex', 'crossref', 'semantic_scholar', 'openfda', 'nih_reporter', 'biorxiv'],
  ip: ['patents', 'github', 'github_deep', 'arxiv', 'semantic_scholar'],
  regulatory: ['federal_register', 'congressional_record', 'government'],
  sanctions: ['ofac', 'opensanctions', 'international_sanctions', 'interpol', 'fbi', 'icij', 'pep', 'sam_gov', 'enforcement', 'wikidata', 'fara', 'census_trade'],
  environment: ['openalex', 'federal_register', 'government', 'semantic_scholar', 'crossref', 'hdx', 'world_bank', 'epa_echo'],
  labor:       ['dol_enforcement', 'courtlistener', 'federal_register', 'government', 'state_courts'],
  trade:       ['census_trade', 'un_comtrade', 'world_bank', 'ofac', 'international_sanctions'],
  research:    ['nih_reporter', 'nsf_awards', 'openalex', 'semantic_scholar', 'crossref', 'arxiv', 'pubmed', 'biorxiv', 'core_research'],
  historical:  ['chronicling_america', 'wayback', 'news_archive', 'wikipedia', 'wikidata'],
  political:    ['fec', 'congressional_record', 'federal_register', 'government', 'propublica_nonprofits', 'gdelt', 'usaspending', 'guardian', 'google_factcheck', 'fara', 'lobbying'],
  financial:    ['sec_edgar', 'sec_xbrl', 'sec_insider', 'deep_sec', 'finra', 'fred', 'bls', 'polygon_market', 'stocktwits', 'market_intelligence', 'fdic', 'cftc_cot', 'cme_warehouse', 'usaspending'],
  geopolitical: ['gdelt', 'geopolitical', 'news_intel', 'international_sanctions', 'opensanctions', 'ofac', 'icij', 'pep', 'world_bank', 'interpol', 'wikipedia', 'media', 'news_archive', 'government', 'rss_news', 'searxng', 'brave_news', 'gnews', 'currents', 'nominatim', 'intelx', 'guardian', 'hdx', 'wikidata', 'un_comtrade', 'congressional_record', 'federal_register', 'google_factcheck', 'reddit', 'hackernews', 'core_research', 'fara', 'census_trade'],
  news:         ['rss_news', 'searxng', 'brave_news', 'gnews', 'currents', 'gdelt', 'news_intel', 'media', 'news_archive', 'reddit', 'guardian', 'google_factcheck', 'hackernews', 'wikidata'],
  security:     ['otx', 'shodan', 'intelx', 'fbi', 'interpol', 'enforcement', 'crt_sh', 'greynoise'],
  osint:        ['intelx', 'shodan', 'otx', 'icij', 'pep', 'opencorporates', 'greynoise', 'wikidata'],

  // Internal ecosystem domains — local services
  memory:       ['innernet'],  // Personal knowledge graph: belief context, prior investigations, curated notes
  creator:      ['tiktalk', 'reddit', 'community', 'youtube_transcript'],  // Creator/influencer content queries
};

const ALWAYS_INCLUDE = new Set([
  'wikipedia', 'reddit', 'media', 'duckduckgo', 'hackernews', 'news_archive', 'crossref',
  'wikidata', 'guardian', 'google_factcheck',
  'innernet', // Personal knowledge graph — fast local service, always contributes belief context
]);

// Connectors that are injected automatically when recency mode is detected.
// These surface breaking news that no structured/archival connector can reach.
const RECENCY_CONNECTORS = ['rss_news', 'searxng', 'brave_news', 'gnews', 'currents', 'guardian'];

export class QueryPlanner {

  /**
   * Generate a full search plan from a natural language query.
   *
   * @param {string} query — the raw user query
   * @param {Array} claims — extracted claims from INTAKE
   * @param {Array} entities — extracted entities from INTAKE
   * @returns {SearchPlan}
   */
  plan(query, claims = [], entities = [], options = {}) {
    const extracted = this._extractQueryIntelligence(query, entities);
    const subQueries = this._decompose(query, extracted);
    const lateral = this._expandLaterally(query, extracted);
    let connectorQueries = this._mapToConnectors(extracted, subQueries, lateral, options);

    // If caller specified an explicit source allowlist, filter to only those connectors
    const allowedSources = options.sources && options.sources !== 'all'
      ? (Array.isArray(options.sources) ? options.sources : options.sources.split(','))
      : null;
    if (allowedSources && allowedSources.length > 0) {
      connectorQueries = Object.fromEntries(
        Object.entries(connectorQueries).filter(([cid]) => allowedSources.includes(cid))
      );
      // For connectors in the allowlist that weren't auto-selected, add the raw query
      for (const cid of allowedSources) {
        if (!connectorQueries[cid]) {
          connectorQueries[cid] = [query];
        }
      }
    }

    // depth=deep: force-include ALL registered connectors with topic-based queries.
    // Every connector gets a chance to contribute; the relevance filter will drop noise later.
    if (options.depth === 'deep') {
      const topicQueries = extracted.topics.length > 1
        ? extracted.topics.slice(0, 5)
        : [query.slice(0, 80)];
      for (const [connectorId] of Object.entries(CONNECTOR_STRATEGIES)) {
        if (!connectorQueries[connectorId]) {
          connectorQueries[connectorId] = topicQueries.slice(0, 2);
        }
      }
    }

    // If recency mode, inject real-time connectors regardless of source filtering
    if (extracted.recencyMode) {
      for (const cid of RECENCY_CONNECTORS) {
        if (!connectorQueries[cid]) {
          connectorQueries[cid] = [query];
        }
      }
    }

    const searchRounds = this._planRounds(connectorQueries, extracted);

    const plan = {
      originalQuery: query,
      entities: extracted,
      subQueries,
      lateralExpansions: lateral,
      connectorQueries,
      searchRounds,
      totalQueries: Object.values(connectorQueries).reduce((s, arr) => s + arr.length, 0),
    };

    log('info', `Query plan: ${Object.keys(connectorQueries).length} connectors, ${plan.totalQueries} queries, ${lateral.length} lateral expansions`);
    return plan;
  }

  /**
   * Extract structured intelligence from a raw query.
   */
  _extractQueryIntelligence(query, entities = []) {
    const q = query.toLowerCase();
    const result = {
      companies: [],
      people: [],
      tickers: [],
      ciks: [],
      products: [],
      topics: [],
      keywords: [],
      domains: [],
      makesModels: [],
      urls: [],
      claims: [],
      rawQuery: query,
    };

    // Extract company names from known list and entities
    for (const [name, ticker] of Object.entries(TICKER_MAP)) {
      if (q.includes(name)) {
        result.companies.push(name.charAt(0).toUpperCase() + name.slice(1));
        if (ticker) {
          result.tickers.push(ticker);
          if (CIK_MAP[ticker]) result.ciks.push(CIK_MAP[ticker]);
        }
      }
    }

    // Extract from entity extractor results
    for (const e of entities) {
      if (e.type === 'organization' && !result.companies.find(c => c.toLowerCase() === e.canonical.toLowerCase())) {
        result.companies.push(e.canonical);
      }
      if (e.type === 'person') result.people.push(e.canonical);
    }

    // Detect product names
    const productPatterns = [
      /\b(full self[- ]driving|FSD|autopilot|model [3sxy]|cybertruck|roadster)\b/gi,
      /\b(iphone|ipad|macbook|airpods|vision pro)\b/gi,
      /\b(chatgpt|gpt-\d|claude|gemini|copilot)\b/gi,
      /\b(windows|azure|office 365|teams)\b/gi,
    ];
    for (const pattern of productPatterns) {
      const matches = query.match(pattern);
      if (matches) result.products.push(...matches.map(m => m.trim()));
    }

    // Extract domains/URLs
    const urlMatch = query.match(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,})\b/gi);
    if (urlMatch) result.urls.push(...urlMatch);

    // Detect topical domains
    if (/\b(safe(?:ty)?|crash|accident|recall|defect|injury|fatal(?:ity|ities)?|hazard)\b/i.test(q)) result.domains.push('safety');
    if (/\b(stock|revenue|financ|profit|invest|SEC\b|ticker|IPO|dividend|quarterly\s+earnings|funding|valuation|series\s+[a-z]|capital\s+raise|capitalization|market\s+cap|acquisition|merger|buyout|private\s+equity|vc|venture|round)\b/i.test(q)) result.domains.push('financial');
    if (/\b(lawsuit|court|legal|ruling|plaintiff|sued|litigation|indictment|settlement)\b/i.test(q)) result.domains.push('legal');
    if (/\b(?:self[- ]driv|autonom|autopilot|FSD|ADAS|driver.?less)/i.test(q)) result.domains.push('autonomous_vehicles');
    if (/\b(drug|pharma|clinical|FDA|vaccine|medical|disease|patient|therapy|diagnosis)\b/i.test(q)) result.domains.push('medical');
    if (/\b(patent|intellectual property|trademark)\b/i.test(q)) result.domains.push('ip');
    if (/\b(regulat|legislation|policy|legislat|federal register)\b/i.test(q)) result.domains.push('regulatory');
    if (/\b(sanctions?|OFAC|embargo|money laundering|terrorist financ|watchlist)\b/i.test(q)) result.domains.push('sanctions');
    if (/\b(climate|carbon|emission|renewable|energy|pollution|EPA|environmental|contamination|superfund|toxic)\b/i.test(q)) result.domains.push('environment');
    if (/\b(worker|labor|wage|OSHA|workplace|union|employ|FLSA|overtime|minimum\s+wage|sweatshop|child\s+labor|mine\s+safety)\b/i.test(q)) result.domains.push('labor');
    if (/\b(import|export|tariff|trade\s+(war|deal|agreement)|customs|HS\s+code|ITAR|dual.use|trade\s+deficit)\b/i.test(q)) result.domains.push('trade');
    if (/\b(research\s+(fund|grant)|NIH|NSF|grant|principal\s+investigator|R01|R21|SBIR|STTR|funding\s+agency)\b/i.test(q)) result.domains.push('research');
    if (/\b(histor|18th.*century|19th.*century|colonial|civil\s+war|1[789]\d{2}|190\d|191\d|192\d|193\d|194\d|195\d|196\d|antebellum)\b/i.test(q)) result.domains.push('historical');
    if (/\b(election|campaign|congress|lobby|politic|senator|representative|government|military)\b/i.test(q)) result.domains.push('political');
    // Geopolitical: country/region mentions, diplomacy, conflict, nuclear, sanctions
    if (/\b(iran|iraq|russia|china|ukraine|north korea|palestine|israel|syria|afghanistan|venezuela|cuba|myanmar|belarus|pakistan|india|saudi|nato|un general assembly)\b/i.test(q) ||
        /\b(nuclear|ballistic|missile|warhead|enrichment|iaea|nonproliferation)\b/i.test(q) ||
        /\b(sanctions?|embargo|diplomacy|geopolit|regime|protests?|revolution|coup|civil war|ceasefire|peace talks)\b/i.test(q) ||
        /\b(inflation|currency\ crisis|gdp|foreign\ reserve|rial|riyal|exchange\ rate)\b/i.test(q)) {
      result.domains.push('geopolitical');
      if (!result.domains.includes('sanctions')) {
        if (/\b(sanctions?|embargo|ofac|watchlist|designation)\b/i.test(q)) result.domains.push('sanctions');
      }
      if (!result.domains.includes('news')) result.domains.push('news');
    }

    // Security / threat intelligence
    if (/\b(malware|ransomware|cyber|threat\s+actor|APT|phishing|exploit|vulnerability|CVE|CVSS|zero.?day|botnet|C2|command.and.control|hacker|breach|data\s+leak|TTP|indicator.of.compromise|IOC|darkweb|dark\s+web)\b/i.test(q)) result.domains.push('security');
    // OSINT / open source intelligence
    if (/\b(OSINT|open.?source\s+intel|dark\s+web|darkweb|leak|paste\s+site|doxx|dossier|intelligence|surveillance|tracking)\b/i.test(q)) result.domains.push('osint');
    // Government spending
    if (/\b(federal\s+(contract|spend|grant|award)|defense\s+(contract|spend)|government\s+(contract|procurement)|USAspending|SBIR|contractor)\b/i.test(q)) {
      if (!result.domains.includes('financial')) result.domains.push('financial');
      if (!result.domains.includes('regulatory')) result.domains.push('regulatory');
    }

    // Creator / influencer / social content → boost TikTalk
    if (/\b(creator|influencer|tiktok|social\s+media|content\s+creat|youtuber|health\s+claim|supplement\s+claim|wellness\s+creator|fitness\s+creator|thought\s+leader)\b/i.test(q)) {
      result.domains.push('creator');
    }
    // Due diligence / entity background → boost EBS bridge
    if (/\b(due\s+diligence|background\s+(check|report)|entity\s+(intelligence|background)|company\s+(profile|dossier|intel)|corporate\s+intel)\b/i.test(q)) {
      if (!result.domains.includes('corporate')) result.domains.push('corporate');
    }

    // Auto-detect makes/models for NHTSA
    if (result.companies.some(c => ['Tesla', 'Ford', 'GM', 'Toyota', 'BMW', 'Mercedes'].includes(c))) {
      result.makesModels.push(result.companies[0]);
    }

    // GraphRAG memory — always included to surface prior investigation context
    result.domains.push('memory');

    // Composite domains derived from primary detections
    const isVehicleContext = result.domains.includes('autonomous_vehicles') ||
      result.makesModels.length > 0 ||
      /\b(vehicle|car|truck|driving|driver|road|highway|automotive)\b/i.test(q);
    if (result.domains.includes('safety') && isVehicleContext) {
      result.domains.push('vehicle_safety');
    }
    if (/\b(software|algorithm|(?:artificial )?intelligence|machine learning|neural|deep learning|code|API|open source|tech(?:nology)?)\b/i.test(q) ||
        result.products.length > 0) {
      result.domains.push('technology');
    }
    if (/\b(corporate|governance|ownership|board|directors?|CEO|CFO|CTO|subsidiary|parent\s+company|incorporat|shareholder|merger|acquisition|restructur|IPO)\b/i.test(q) ||
        (result.companies.length > 0 && result.domains.includes('financial'))) {
      result.domains.push('corporate');
    }

    // Generate topic terms from the query
    result.topics = this._extractTopics(query, result);

    // Individual keyword tokens for relevance scoring — single meaningful words
    // that should appear in any relevant evidence (country names, key concepts, etc.)
    const kwStopWords = new Set([
      'the','is','a','an','for','to','of','in','on','by','with','that','this',
      'are','was','were','be','been','what','how','why','when','where','who',
      'right','now','happening','current','situation','about','does','did',
      'will','would','could','should','may','might','can','shall','it','its',
      'and','or','but','not','also','from','into','onto','over','under','their',
    ]);
    result.keywords = q
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 4 && !kwStopWords.has(t));

    // Recency mode: detect "what is happening now" intent.
    // Triggers injection of RSS/SearXNG/Brave connectors and freshness scoring.
    const recencySignals = [
      /\bright\s+now\b/i,
      /\bthis\s+(?:week|month|year)\b/i,
      /\btoday\b/i,
      /\blatest\b/i,
      /\bbreaking\b/i,
      /\bcurrently\b/i,
      /\bwhat(?:'s|\s+is|\s+are)\s+happening\b/i,
      /\bwhat(?:'s|\s+is)\s+going\s+on\b/i,
      /\bcurrent\s+(?:status|situation|state|news)\b/i,
      /\b(?:news|update|development)s?\s+(?:on|about|from|in)\b/i,
      /\b202[5-9]\b/,  // explicit year reference signals recency intent
    ];
    result.recencyMode = recencySignals.some(re => re.test(query));

    return result;
  }

  /**
   * Extract abstract topics for academic/news/general search.
   */
  _extractTopics(query, extracted) {
    const topics = [];
    const q = query.toLowerCase();

    // The core topic (without named entities)
    let coreTopic = query;
    for (const company of extracted.companies) {
      coreTopic = coreTopic.replace(new RegExp(company, 'gi'), '').trim();
    }
    for (const person of extracted.people) {
      coreTopic = coreTopic.replace(new RegExp(person, 'gi'), '').trim();
    }
    coreTopic = coreTopic.replace(/\b(is|are|was|were|the|a|an|for|to|of|in|on|by|with|that|this)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (coreTopic.length > 5) topics.push(coreTopic);

    // ── Compound query decomposition ──
    // Split queries that mention multiple distinct facets:
    //   "Iran nuclear program, sanctions, protests, economy"
    //   → ["Iran nuclear program", "Iran sanctions", "Iran protests", "Iran economy"]
    // Detect the subject (country/entity) and the facets.
    const subjectMatch = query.match(/^(.+?)\b\s*(?:—|--|:|\s+)\s*(.+)$/);
    if (subjectMatch) {
      const subject = subjectMatch[1].replace(/\b(situation|status|current|as of|march|january|february|april|may|june|july|august|september|october|november|december|20\d\d)\b/gi, '').trim();
      const facetPart = subjectMatch[2];
      // Split on commas, semicolons, "and"
      const facets = facetPart.split(/[,;]|\band\b/).map(f => f.trim()).filter(f => f.length > 2);
      if (subject.length >= 2 && facets.length >= 2) {
        for (const facet of facets) {
          const composed = `${subject} ${facet}`.replace(/\s+/g, ' ').trim();
          if (composed.length > 5 && composed.length < 80) topics.push(composed);
        }
      }
    }

    // Also split on commas/semicolons if the query lists multiple topics
    const segments = query.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 5);
    if (segments.length >= 2) {
      for (const seg of segments.slice(0, 6)) {
        const clean = seg.replace(/\b(as of|situation|current|status|march|20\d\d)\b/gi, '').replace(/[—–\-:]/g, '').replace(/\s+/g, ' ').trim();
        if (clean.length > 4 && clean.length < 60) topics.push(clean);
      }
    }

    // Extract individual meaningful keywords paired with subject for short queries
    const countryMatch = q.match(/\b(iran|iraq|russia|china|ukraine|north korea|israel|syria|pakistan|india|saudi arabia|venezuela|cuba|myanmar|turkey|afghanistan|belarus)\b/i);
    if (countryMatch) {
      const country = countryMatch[1].charAt(0).toUpperCase() + countryMatch[1].slice(1);
      for (const kw of extracted.keywords) {
        if (kw !== country.toLowerCase() && kw.length >= 4) {
          const facetQuery = `${country} ${kw}`;
          if (!topics.includes(facetQuery)) topics.push(facetQuery);
        }
      }
    }

    // Domain-specific synonym expansion
    for (const [phrase, synonyms] of Object.entries(DOMAIN_SYNONYMS)) {
      if (q.includes(phrase)) {
        topics.push(...synonyms.slice(0, 3));
      }
    }

    // Combine entities + topics for richer queries
    if (extracted.companies.length > 0 && coreTopic) {
      topics.push(`${extracted.companies[0]} ${coreTopic}`);
    }

    return [...new Set(topics)].slice(0, 15);
  }

  /**
   * Decompose the query into domain-specific sub-queries.
   */
  _decompose(query, extracted) {
    const subs = {};
    const company = extracted.companies[0] || '';
    const ticker = extracted.tickers[0] || '';
    const product = extracted.products[0] || '';

    // Financial sub-queries
    if (company || ticker) {
      subs.financial = [
        ticker || company,
        company ? `${company} SEC filing` : null,
        company ? `${company} revenue earnings` : null,
      ].filter(Boolean);
    }

    // Legal sub-queries
    if (company || extracted.people.length > 0) {
      subs.legal = [
        company ? `${company} lawsuit` : null,
        company && product ? `${company} ${product} negligence` : null,
        company ? `${company} class action` : null,
        ...extracted.people.map(p => `${p} litigation`),
      ].filter(Boolean);
    }

    // Safety sub-queries
    if (extracted.domains.includes('safety') || extracted.domains.includes('autonomous_vehicles')) {
      subs.safety = [
        company ? `${company} recall` : 'vehicle recall',
        company ? `${company} crash` : null,
        company ? `${company} defect` : null,
        product ? `${product} accident` : null,
        'autonomous vehicle crash statistics',
        'self-driving car safety data',
      ].filter(Boolean);
    }

    // Academic sub-queries
    subs.academic = [
      ...extracted.topics.slice(0, 3),
      extracted.domains.includes('autonomous_vehicles') ? 'autonomous vehicle safety analysis' : null,
      extracted.domains.includes('autonomous_vehicles') ? 'self-driving car accident rate study' : null,
      extracted.domains.includes('medical') ? `${company || query} clinical trial` : null,
    ].filter(Boolean);

    // Government/regulatory
    if (company || extracted.domains.includes('regulatory') || extracted.domains.includes('geopolitical') || extracted.domains.includes('political') || extracted.domains.includes('sanctions')) {
      subs.government = [
        company ? `${company} regulation` : null,
        extracted.domains.includes('autonomous_vehicles') ? 'autonomous vehicle regulation federal' : null,
        extracted.domains.includes('autonomous_vehicles') ? 'NHTSA autonomous driving' : null,
        company ? `${company} investigation` : null,
        // Geopolitical: use decomposed topics for government/congressional queries
        ...extracted.topics.slice(0, 4).filter(t => t.length < 60),
      ].filter(Boolean);
    }

    // Corporate intelligence
    if (company) {
      subs.corporate = [
        company,
        `${company} Inc`,
        `${company} Motors`,
      ];
    }

    // News/social — use decomposed topics, not just the raw query
    const newsTopics = extracted.topics.length > 1
      ? extracted.topics.slice(0, 5)
      : [query.slice(0, 80)];
    subs.news = [
      query.slice(0, 80),
      company ? `${company} ${product || ''}`.trim() : null,
      ...newsTopics,
    ].filter(Boolean);

    // Social media — use shorter, more targeted queries
    subs.social = [
      company && product ? `${company} ${product}` : null,
      ...extracted.topics.slice(0, 4).map(t => company ? `${company} ${t}` : t),
      query.slice(0, 50),
    ].filter(Boolean);

    return subs;
  }

  /**
   * Generate lateral expansion queries — things the user didn't ask for
   * but that are relevant to understanding the claim.
   */
  _expandLaterally(query, extracted) {
    const laterals = [];
    const company = extracted.companies[0];
    const product = extracted.products[0];

    // Competitor analysis
    if (extracted.domains.includes('autonomous_vehicles')) {
      laterals.push(
        { query: 'Waymo safety record autonomous driving', reason: 'Competitor safety comparison' },
        { query: 'Cruise autonomous vehicle safety', reason: 'Competitor safety comparison' },
        { query: 'autonomous vehicle miles per disengagement', reason: 'Industry safety metric' },
        { query: 'SAE levels autonomous driving classification', reason: 'Technical classification context' },
        { query: 'lidar vs camera self-driving safety', reason: 'Technical approach comparison' },
        { query: 'autonomous vehicle fatality rate vs human driver', reason: 'Statistical baseline comparison' },
      );
    }

    // Regulatory landscape
    if (company) {
      laterals.push(
        { query: `${company} NHTSA investigation`, reason: 'Regulatory investigation history' },
        { query: `${company} recall history`, reason: 'Product safety track record' },
        { query: `${company} settlement`, reason: 'Legal resolution history' },
      );
    }

    // Financial health context
    if (extracted.tickers[0]) {
      laterals.push(
        { query: `${extracted.tickers[0]} 10-K annual report`, reason: 'Financial disclosure' },
        { query: `${extracted.tickers[0]} insider trading`, reason: 'Insider confidence signals' },
      );
    }

    // Academic deep-dive
    if (extracted.domains.includes('autonomous_vehicles') || extracted.domains.includes('safety')) {
      laterals.push(
        { query: 'autonomous vehicle perception failure modes', reason: 'Technical failure analysis' },
        { query: 'self-driving car ethical trolley problem', reason: 'Ethical/philosophical context' },
        { query: 'computer vision limitations adverse weather', reason: 'Technical limitation context' },
      );
    }

    // Patent landscape
    if (company && product) {
      laterals.push(
        { query: `${company} ${product} patent`, reason: 'IP/technology landscape' },
      );
    }

    // Historical context
    if (company) {
      laterals.push(
        { query: `${company} history timeline`, reason: 'Historical context' },
      );
    }

    // Geopolitical lateral expansions — cover adjacent angles an analyst would check
    if (extracted.domains.includes('geopolitical')) {
      const countryMatch = query.match(/\b(iran|iraq|russia|china|ukraine|north korea|israel|syria|pakistan|india|saudi arabia|venezuela|cuba|myanmar|turkey|afghanistan|belarus)\b/i);
      if (countryMatch) {
        const country = countryMatch[1].charAt(0).toUpperCase() + countryMatch[1].slice(1);
        laterals.push(
          { query: `${country} IAEA latest report`, reason: 'International body assessment' },
          { query: `${country} UN Security Council resolution`, reason: 'International governance' },
          { query: `${country} human rights violations 2026`, reason: 'Humanitarian dimension' },
          { query: `${country} opposition movement leadership`, reason: 'Political opposition' },
          { query: `${country} currency inflation economic crisis`, reason: 'Economic dimension' },
          { query: `${country} military capability assessment`, reason: 'Military context' },
        );
      }
    }

    return laterals;
  }

  /**
   * Determine which connectors are relevant given the detected query domains
   * and entities. Prevents sending "Tesla FSD safety" to FINRA/FBI/FDIC/etc.
   */
  _getRelevantConnectors(extracted) {
    const relevant = new Set(ALWAYS_INCLUDE);

    for (const domain of extracted.domains) {
      const connectors = DOMAIN_CONNECTOR_MAP[domain];
      if (connectors) connectors.forEach(c => relevant.add(c));
    }

    if (extracted.companies.length > 0) {
      relevant.add('sec_edgar');
      if (extracted.domains.some(d => ['corporate', 'financial'].includes(d))) {
        for (const c of ['opencorporates', 'gleif']) relevant.add(c);
      }
    }

    if (extracted.tickers.length > 0) {
      relevant.add('stocktwits');
      if (extracted.domains.some(d => ['financial', 'corporate'].includes(d))) {
        for (const c of ['polygon_market', 'market_intelligence']) relevant.add(c);
      }
    }

    if (extracted.people.length > 0) {
      relevant.add('courtlistener');
      if (extracted.domains.some(d => ['sanctions', 'legal'].includes(d))) {
        relevant.add('opensanctions');
      }
    }

    if (extracted.urls.length > 0) {
      for (const c of ['crt_sh', 'whois', 'wayback']) relevant.add(c);
    }

    // No domains detected — conservative fallback with general knowledge sources.
    // Previously this added ALL entity-type connectors when companies were
    // present, sending queries to FINRA/FBI/FDIC/Interpol etc. regardless
    // of relevance. Now only basic corporate + legal connectors are added.
    if (extracted.domains.length === 0) {
      for (const c of [
        'openalex', 'semantic_scholar', 'crossref', 'arxiv', 'news_archive',
        'news_intel', 'gdelt', 'google_factcheck', 'github', 'hackernews', 'government',
      ]) {
        relevant.add(c);
      }
      if (extracted.companies.length > 0) {
        for (const c of ['sec_edgar', 'opencorporates', 'courtlistener', 'federal_register']) {
          relevant.add(c);
        }
      }
      if (extracted.people.length > 0) {
        for (const c of ['courtlistener', 'opensanctions']) {
          relevant.add(c);
        }
      }
    }

    return relevant;
  }

  /**
   * Map all queries to specific connectors, using each connector's
   * preferred query format.
   */
  _mapToConnectors(extracted, subQueries, lateral, options = {}) {
    const mapping = {};
    const company = extracted.companies[0] || '';
    const ticker = extracted.tickers[0] || '';
    const cik = extracted.ciks[0] || '';
    const relevant = this._getRelevantConnectors(extracted);

    // Define query allocation by source tier and domain
    // High-trust sources get more queries for authoritative domains
    const QUERY_ALLOCATION = {
      // High-trust government/financial (geopolitical domain)
      'geopolitical': {
        'guardian': 5, 'rss_news': 5, 'gnews': 4, 'brave_news': 4,
        'federal_register': 4, 'congress': 4, 'gdelt': 4,
        'reddit': 2, 'hackernews': 1, 'media': 3, 'news_archive': 4,
      },
      'political': {
        'guardian': 5, 'rss_news': 4, 'federal_register': 4,
        'reddit': 2, 'hackernews': 1, 'media': 3,
      },
      'sanctions': {
        'ofac': 5, 'opensanctions': 5, 'icij': 4, 'federal_register': 4,
        'reddit': 1, 'hackernews': 1, 'media': 2,
      },
      'financial': {
        'sec_edgar': 5, 'deep_sec': 4, 'market_intelligence': 4,
        'reddit': 2, 'hackernews': 1, 'stocktwits': 1,
      },
      'corporate': {
        'sec_edgar': 4, 'opencorporates': 4, 'media': 3,
        'reddit': 2, 'hackernews': 1,
      },
    };

    for (const [connectorId, strategy] of Object.entries(CONNECTOR_STRATEGIES)) {
      if (!relevant.has(connectorId)) continue;
      const queries = new Set();

      // Check if we should prioritize this connector based on domain + source tier
      let maxQueries = 4; // default
      for (const domain of extracted.domains) {
        if (QUERY_ALLOCATION[domain] && QUERY_ALLOCATION[domain][connectorId]) {
          maxQueries = QUERY_ALLOCATION[domain][connectorId];
          break;
        }
      }

      switch (strategy.prefer) {
        case 'ticker':
          if (ticker) queries.add(ticker);
          if (company) queries.add(company);
          break;
        case 'cik':
          if (cik) queries.add(cik);
          if (ticker) queries.add(ticker);
          break;
        case 'company_name':
          if (company) queries.add(company);
          if (company) queries.add(`${company} Inc`);
          break;
        case 'person_or_company':
          if (company) queries.add(company);
          extracted.people.forEach(p => queries.add(p));
          break;
        case 'person_name':
          extracted.people.forEach(p => queries.add(p));
          if (company) queries.add(company);
          break;
        case 'make_model':
          extracted.makesModels.forEach(m => queries.add(m));
          if (company) queries.add(company);
          break;
        case 'legal_query':
          if (subQueries.legal) subQueries.legal.forEach(q => queries.add(q));
          if (company) queries.add(company);
          break;
        case 'academic_term':
          if (subQueries.academic) subQueries.academic.forEach(q => queries.add(q));
          extracted.topics.forEach(t => queries.add(t));
          break;
        case 'medical_term':
          if (subQueries.academic) subQueries.academic.filter(q => !q.includes('study')).forEach(q => queries.add(q));
          extracted.topics.forEach(t => queries.add(t));
          break;
        case 'technical_term':
          extracted.topics.forEach(t => queries.add(t));
          extracted.products.forEach(p => queries.add(p));
          break;
        case 'news_query':
          if (subQueries.news) subQueries.news.forEach(q => queries.add(q));
          break;
        case 'social_query':
          if (subQueries.social) subQueries.social.forEach(q => queries.add(q));
          break;
        case 'regulatory_term':
          if (subQueries.government) subQueries.government.forEach(q => queries.add(q));
          break;
        case 'policy_term':
          if (subQueries.government) subQueries.government.forEach(q => queries.add(q));
          break;
        case 'economic_term':
          extracted.topics.forEach(t => queries.add(t));
          break;
        case 'domain':
          extracted.urls.forEach(u => queries.add(u));
          if (company) queries.add(`${company.toLowerCase()}.com`);
          break;
        case 'url':
          extracted.urls.forEach(u => queries.add(u));
          if (company) queries.add(`${company.toLowerCase()}.com`);
          break;
        case 'claim':
          queries.add(extracted.rawQuery);
          break;
        case 'natural_language':
          queries.add(extracted.rawQuery);
          extracted.topics.slice(0, 2).forEach(t => queries.add(t));
          break;
        case 'topic':
        default:
          if (subQueries.news) subQueries.news.slice(0, 2).forEach(q => queries.add(q));
          extracted.topics.slice(0, 2).forEach(t => queries.add(t));
          if (company) queries.add(company);
          break;
      }

      // Fallback: if preferred query format yielded nothing, use topic/raw query
      if (queries.size === 0 && strategy.fallback) {
        switch (strategy.fallback) {
          case 'topic':
            if (subQueries.news) subQueries.news.slice(0, 2).forEach(q => queries.add(q));
            extracted.topics.slice(0, 2).forEach(t => queries.add(t));
            if (!extracted.topics.length) queries.add(extracted.rawQuery);
            break;
          case 'company_name':
            if (company) queries.add(company);
            break;
        }
      }

      // Add lateral queries for connectors that accept topics
      if (strategy.type === 'topic' && lateral.length > 0) {
        for (const lat of lateral.slice(0, 2)) {
          queries.add(lat.query);
        }
      }

      // Filter empty strings and limit per connector based on domain/tier allocation
      const filtered = [...queries].filter(q => q && q.trim().length > 2).slice(0, maxQueries);
      if (filtered.length > 0) {
        mapping[connectorId] = filtered;
      }
    }

    return mapping;
  }

  /**
   * Plan multi-round search strategy.
   *
   * Round assignment is domain-aware: the PRIMARY round only includes
   * connectors that are authoritative for the detected query domains.
   * A vehicle-safety query puts NHTSA/courtlistener in round 1, not
   * FINRA/FBI/clinical_trials.
   */
  _planRounds(connectorQueries, extracted) {
    const PRIMARY_BY_DOMAIN = {
      vehicle_safety: ['nhtsa', 'federal_register', 'courtlistener', 'cfpb', 'enforcement'],
      safety:         ['nhtsa', 'federal_register', 'courtlistener', 'cfpb', 'enforcement'],
      autonomous_vehicles: ['nhtsa', 'federal_register', 'courtlistener', 'patents'],
      technology:     ['github', 'arxiv', 'semantic_scholar', 'patents'],
      corporate:      ['sec_edgar', 'opencorporates', 'gleif', 'open_ownership', 'state_sos', 'uk_companies_house', 'eu_registers'],
      financial:      ['sec_edgar', 'sec_xbrl', 'deep_sec', 'sec_insider', 'finra', 'fdic', 'fred', 'polygon_market', 'stocktwits', 'market_intelligence'],
      legal:          ['courtlistener', 'pacer', 'state_courts', 'federal_register', 'enforcement'],
      medical:        ['pubmed', 'clinical_trials', 'openalex'],
      ip:             ['patents', 'github', 'arxiv'],
      regulatory:     ['federal_register', 'congressional_record', 'government'],
      sanctions:      ['ofac', 'opensanctions', 'international_sanctions', 'interpol', 'fbi', 'icij', 'pep', 'sam_gov'],
      environment:    ['openalex', 'federal_register', 'government', 'hdx', 'world_bank'],
      political:      ['fec', 'congressional_record', 'federal_register', 'government', 'gdelt'],
      geopolitical:   ['gdelt', 'geopolitical', 'rss_news', 'guardian', 'gnews', 'brave_news', 'news_intel', 'ofac', 'opensanctions', 'international_sanctions', 'icij', 'world_bank', 'hdx', 'wikidata', 'wikipedia', 'congressional_record', 'un_comtrade', 'google_factcheck'],
      // Internal ecosystem primaries
      memory:         ['innernet'],
      creator:        ['tiktalk', 'reddit', 'community'],
    };

    const primarySet = new Set();
    for (const domain of extracted.domains) {
      const primaries = PRIMARY_BY_DOMAIN[domain];
      if (primaries) primaries.forEach(c => primarySet.add(c));
    }

    if (primarySet.size === 0) {
      // If no domains detected, start with high-trust government/corporate sources
      // then fall back to news. This ensures we prefer SEC/government over Reddit.
      const fallbackPrimaries = [
        'sec_edgar', 'opencorporates', 'federal_register', 'courtlistener',
        'openalex', 'semantic_scholar', 'google_factcheck', 'rss_news', 'news_archive'
      ];
      for (const c of fallbackPrimaries) {
        if (connectorQueries[c]) primarySet.add(c);
      }
      // Still include some breadth if above weren't selected
      if (primarySet.size === 0) {
        for (const c of ['wikipedia', 'media', 'google_factcheck', 'rss_news']) {
          primarySet.add(c);
        }
      }
    }

    const round1 = {};
    const round2 = {};
    const round3 = {};

    for (const [connectorId, queries] of Object.entries(connectorQueries)) {
      if (primarySet.has(connectorId)) {
        round1[connectorId] = queries;
      } else {
        round2[connectorId] = queries;
      }
    }

    // Round 3: adversarial queries (look for counter-evidence)
    if (extracted.companies[0]) {
      const company = extracted.companies[0];
      const adversarialQueries = [
        `${company} fraud`, `${company} scandal`, `${company} investigation`,
        `${company} class action`, `${company} misleading`, `${company} failure`,
      ];
      round3.courtlistener = adversarialQueries.slice(0, 3);
      round3.gdelt = adversarialQueries.slice(0, 2);
      round3.reddit = [`${company} problem`, `${company} issue`];
      round3.google_factcheck = [`${company} false claim`];
    }

    return [
      { name: 'primary', connectors: round1, description: 'Domain-relevant authoritative sources' },
      { name: 'broad', connectors: round2, description: 'Supporting coverage and context' },
      { name: 'adversarial', connectors: round3, description: 'Counter-evidence search' },
    ];
  }
}

export default QueryPlanner;
