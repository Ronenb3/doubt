/**
 * doubt — Evidence-Claim Matcher
 *
 * Links each piece of evidence to the specific claims it's relevant to.
 *
 * Problem: all evidence has claimId: null, so it all applies to everything
 * via the Bayesian engine's fallback (e.claimId === null passes for all claims).
 * That means every claim gets the same posterior — defeating the purpose
 * of having multiple claims at all.
 *
 * Solution: score each evidence-claim pair on entity overlap, keyword overlap,
 * semantic relatedness, and domain match. Assign evidence to its best-fit claim.
 */

import { log } from '../core/config.js';

const MATCH_THRESHOLD = 0.2;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off',
  'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'that', 'this',
  'these', 'those', 'and', 'but', 'or', 'if', 'while', 'because', 'about',
  'what', 'which', 'who', 'whom', 'its', 'it', 'they', 'them', 'their',
  'he', 'she', 'his', 'her', 'him', 'my', 'your', 'our', 'we', 'you',
]);

// Domain clusters — connectors grouped by what kind of claim they're best for
const DOMAIN_MAP = {
  financial: [
    'sec-edgar', 'sec-insider', 'sec-xbrl', 'polygon-market', 'fred',
    'finra', 'fdic', 'cftc-cot', 'cme-warehouse', 'stocktwits',
    'usa-spending', 'federal-procurement', 'gleif', 'market-intelligence',
  ],
  legal: [
    'courtlistener', 'pacer', 'state-courts', 'ofac', 'interpol',
    'opensanctions', 'international-sanctions', 'fbi', 'enforcement',
    'regulatory-enforcement',
  ],
  corporate: [
    'opencorporates', 'uk-companies-house', 'eu-business-registers',
    'open-ownership', 'state-sos', 'gleif', 'sam-gov',
  ],
  scientific: [
    'pubmed', 'openalex', 'semantic-scholar', 'crossref', 'arxiv',
    'clinical-trials', 'papers-with-code', 'orcid',
  ],
  political: [
    'fec', 'congressional-record', 'federal-register', 'lobbying',
    'propublica-nonprofits', 'pep', 'immigration',
  ],
  safety: [
    'nhtsa', 'cfpb', 'clinical-trials', 'fbi',
    'enforcement', 'regulatory-enforcement',
  ],
  media: [
    'gdelt', 'news-intel', 'news-archive', 'reddit', 'hackernews',
    'duckduckgo', 'youtube-transcript', 'media', 'google-factcheck',
  ],
  tech: [
    'github', 'github-deep', 'huggingface', 'patents',
    'stackexchange', 'crt-sh', 'deep-sec',
  ],
};

// Keyword clusters for claim-type detection
const CLAIM_DOMAINS = {
  financial: /\b(revenue|profit|stock|share|dividend|earnings|valuation|market\s+cap|ipo|sec|filing|quarterly|annual\s+report|financial|billion|million|investor)\b/i,
  legal: /\b(lawsuit|court|judge|ruling|settlement|indicted|convicted|charged|sentenced|verdict|trial|appeal|injunction|plaintiff|defendant|litigation)\b/i,
  corporate: /\b(ceo|board|director|subsidiary|merger|acquisition|incorporated|llc|corporation|company|founded|headquartered)\b/i,
  scientific: /\b(study|research|clinical|trial|peer[\s-]reviewed|published|journal|experiment|hypothesis|findings|data\s+shows?|evidence\s+suggests?|paper)\b/i,
  political: /\b(congress|senator|representative|legislation|bill|vote|election|campaign|lobbyist|political|government|federal|democrat|republican|policy)\b/i,
  safety: /\b(safe(?:ty)?|crash|accident|recall|injury|hazard|risk|inspection|compliance|violation|warning|defect)\b/i,
};

export class ClaimMatcher {
  /**
   * For each evidence item, find which claim it best matches.
   * Sets evidence.claimId to the best-matching claim's ID.
   * Returns the evidence array (mutated in-place).
   */
  match(evidence, claims) {
    if (!evidence?.length || !claims?.length) return evidence;

    const claimProfiles = claims.map(c => this._profileClaim(c));
    let matched = 0;

    for (const e of evidence) {
      const text = e.summary || e.text || '';
      if (!text) continue;

      const eProfile = this._profileEvidence(e);
      let bestScore = 0;
      let bestClaimId = null;

      for (let i = 0; i < claims.length; i++) {
        const score = this._scoreMatch(eProfile, claimProfiles[i], e);
        if (score > bestScore) {
          bestScore = score;
          bestClaimId = claims[i].id;
        }
      }

      if (bestScore >= MATCH_THRESHOLD) {
        e.claimId = bestClaimId;
        e._matchScore = bestScore;
        matched++;
      }
    }

    log('info', `claim-matcher: ${matched}/${evidence.length} evidence matched to claims (${claims.length} claims)`);
    return evidence;
  }

  /**
   * Build a map of claimId → Evidence[].
   */
  buildEvidenceMap(evidence, claims) {
    const map = {};

    for (const c of claims) {
      map[c.id] = [];
    }
    map['_unmatched'] = [];

    for (const e of evidence) {
      if (e.claimId && map[e.claimId]) {
        map[e.claimId].push(e);
      } else {
        map['_unmatched'].push(e);
      }
    }

    return map;
  }

  /**
   * Enrich claims with matched evidence metadata.
   * Attaches evidence IDs, counts, and support/contradict breakdown.
   */
  enrichClaims(claims, evidence) {
    const map = this.buildEvidenceMap(evidence, claims);

    for (const claim of claims) {
      const matched = map[claim.id] || [];
      claim.matchedEvidence = matched.map(e => e.id);
      claim.evidenceCount = matched.length;
      claim.supportCount = matched.filter(e => e.type === 'supports').length;
      claim.contradictCount = matched.filter(e => e.type === 'contradicts').length;
    }

    return claims;
  }

  // ─── Internal ───────────────────────────────────────────

  /**
   * Build a matching profile for a claim.
   */
  _profileClaim(claim) {
    const text = claim.text || '';
    return {
      id: claim.id,
      tokens: tokenize(text),
      entities: extractEntities(text),
      domain: detectDomain(text),
      text,
    };
  }

  /**
   * Build a matching profile for an evidence item.
   */
  _profileEvidence(evidence) {
    const text = evidence.summary || evidence.text || '';
    return {
      tokens: tokenize(text),
      entities: extractEntities(text),
      domain: detectDomain(text),
      connectorId: evidence.connectorId,
      text,
    };
  }

  /**
   * Score how well an evidence profile matches a claim profile.
   * Combines entity overlap, keyword overlap, domain match, and semantic relatedness.
   */
  _scoreMatch(eProfile, cProfile, evidence) {
    let score = 0;

    // 1. Entity overlap (strongest signal, weight: 0.40)
    const entityOverlap = setOverlap(eProfile.entities, cProfile.entities);
    score += entityOverlap * 0.40;

    // 2. Keyword overlap (weight: 0.30)
    const keywordOverlap = setOverlap(eProfile.tokens, cProfile.tokens);
    score += keywordOverlap * 0.30;

    // 3. Domain match (weight: 0.15)
    if (cProfile.domain && eProfile.domain && cProfile.domain === eProfile.domain) {
      score += 0.15;
    }

    // 4. Connector-domain relevance (weight: 0.15)
    if (cProfile.domain && evidence.connectorId) {
      const domainConnectors = DOMAIN_MAP[cProfile.domain];
      if (domainConnectors?.includes(evidence.connectorId)) {
        score += 0.15;
      }
    }

    return Math.min(1, score);
  }
}

// ─── Utility Functions ───────────────────────────────────

/**
 * Tokenize text into significant lowercase words.
 */
function tokenize(text) {
  if (!text) return new Set();
  return new Set(
    text.toLowerCase()
      .split(/[\s\-\/,;:.()"']+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

/**
 * Extract capitalized entity-like phrases from text.
 * Returns a Set of lowercased entity strings.
 */
function extractEntities(text) {
  if (!text) return new Set();

  const entities = new Set();

  // Multi-word capitalized sequences (e.g. "Tesla Motors", "New York")
  const multiWord = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g);
  if (multiWord) {
    for (const m of multiWord) entities.add(m.toLowerCase());
  }

  // All-caps acronyms (e.g. "SEC", "FDA", "NHTSA")
  const acronyms = text.match(/\b[A-Z]{2,6}\b/g);
  if (acronyms) {
    for (const a of acronyms) entities.add(a.toLowerCase());
  }

  // Single capitalized words that aren't sentence starters (heuristic: preceded by space)
  const singles = text.match(/(?<=\s)[A-Z][a-z]{2,}/g);
  if (singles) {
    for (const s of singles) entities.add(s.toLowerCase());
  }

  return entities;
}

/**
 * Detect which domain a text belongs to based on keyword patterns.
 */
function detectDomain(text) {
  if (!text) return null;

  let best = null;
  let bestCount = 0;

  for (const [domain, pattern] of Object.entries(CLAIM_DOMAINS)) {
    const matches = text.match(new RegExp(pattern, 'gi'));
    const count = matches?.length || 0;
    if (count > bestCount) {
      bestCount = count;
      best = domain;
    }
  }

  return bestCount >= 1 ? best : null;
}

/**
 * Jaccard-ish overlap between two Sets.
 * Returns 0-1 score based on intersection relative to the smaller set.
 */
function setOverlap(a, b) {
  if (!a?.size || !b?.size) return 0;

  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;

  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }

  // Normalize by smaller set to avoid penalizing long evidence against short claims
  return intersection / smaller.size;
}

export default ClaimMatcher;
