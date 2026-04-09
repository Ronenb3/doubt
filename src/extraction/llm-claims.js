/**
 * doubt — LLM-Powered Claim Decomposer
 *
 * THE KEY THAT UNLOCKS THE ENTIRE INFERENCE LAYER.
 *
 * Problem: The heuristic ClaimExtractor works for simple declarative claims
 * ("Tesla FSD is safe"), but investigation queries like "Iran nuclear program
 * sanctions 2025 IAEA inspections" are complex topic clusters, not single
 * verifiable claims. The old extractor returns 1 claim for these.
 *
 * With 1 claim:
 *   - Cascade engine: disabled (needs ≥2)
 *   - Contradiction detector: nothing to contradict
 *   - Bayesian inference: single point estimate, no cross-claim propagation
 *   - Keystone detection: meaningless
 *
 * With 5-12 claims:
 *   - Cascade engine: builds dependency DAG, finds structural keystones
 *   - Contradiction detector: finds where evidence conflicts across claims
 *   - Bayesian inference: independent confidence per claim, cross-validated
 *   - The entire analytical layer actually works
 *
 * APPROACH:
 *   1. Try Ollama (free, local) to decompose query into verifiable sub-claims
 *   2. Fall back to entity-based heuristic decomposition
 *   3. Each sub-claim is specific, verifiable, and independently assessable
 */

import { getConfig, log } from '../core/config.js';

const DECOMPOSE_PROMPT = `You are an intelligence analyst. Given an investigation query, decompose it into 5-12 specific, independently verifiable sub-claims.

RULES:
- Each sub-claim must be a concrete factual assertion that can be TRUE or FALSE
- Each sub-claim should be independently verifiable from different sources
- Cover different dimensions: factual basis, legal status, international relations, timeline, consequences
- Be specific — include names, dates, numbers where possible
- No opinions, no questions, no hedging
- Return ONLY a JSON array of strings, nothing else

QUERY: "{query}"

ENTITIES DETECTED: {entities}

Return a JSON array of 5-12 verifiable sub-claims:`;

const HEURISTIC_TEMPLATES = {
  // Domain-specific decomposition patterns for when LLM is unavailable
  sanctions: (entities) => {
    const target = entities.countries?.[0] || entities.orgs?.[0] || 'the target';
    return [
      `${target} is currently under international sanctions`,
      `Sanctions against ${target} have been expanded or modified recently`,
      `${target} sanctions have measurable economic impact`,
      `Diplomatic negotiations regarding ${target} sanctions are ongoing`,
      `${target} has taken steps to circumvent or comply with sanctions`,
      `International consensus on ${target} sanctions is unified`,
    ];
  },
  nuclear: (entities) => {
    const country = entities.countries?.[0] || 'the country';
    return [
      `${country} has an active nuclear program`,
      `${country} nuclear activities exceed internationally agreed limits`,
      `International inspectors have verified ${country} nuclear compliance`,
      `${country} uranium enrichment has reached weapons-grade levels`,
      `Diplomatic negotiations on ${country} nuclear program are progressing`,
      `Military options regarding ${country} nuclear facilities have been discussed`,
    ];
  },
  conflict: (entities) => {
    const parties = entities.countries?.slice(0, 2) || ['parties'];
    return [
      `The ${parties.join('-')} conflict has resulted in documented casualties`,
      `International mediation efforts in the ${parties.join('-')} conflict are active`,
      `Humanitarian conditions in the conflict zone are deteriorating`,
      `Military capabilities of the parties have changed significantly`,
      `International law violations have been documented in the conflict`,
      `Economic sanctions related to the conflict are in effect`,
    ];
  },
  corporate: (entities) => {
    const org = entities.orgs?.[0] || 'the company';
    return [
      `${org} financial performance matches reported figures`,
      `${org} has pending legal or regulatory actions`,
      `${org} leadership has made claims consistent with filings`,
      `${org} market position is accurately represented`,
      `Independent audits corroborate ${org} public statements`,
    ];
  },
  election: (entities) => {
    const country = entities.countries?.[0] || 'the jurisdiction';
    return [
      `${country} election results are consistent with pre-election polls`,
      `International observers confirmed ${country} election integrity`,
      `Allegations of election irregularities have credible evidence`,
      `Voter participation rates in ${country} match historical patterns`,
      `Post-election legal challenges have been filed or resolved`,
    ];
  },
  health: (entities) => {
    const subject = entities.persons?.[0] || entities.orgs?.[0] || 'the subject';
    return [
      `Clinical evidence supports the health claims about ${subject}`,
      `Regulatory agencies have reviewed and approved relevant products`,
      `Peer-reviewed research corroborates the health assertions`,
      `Adverse effects or risks have been documented and disclosed`,
      `Expert medical consensus aligns with the claims`,
    ];
  },
  energy: (entities) => {
    const exporter = entities.countries?.[0] || 'Russia';
    const importer = entities.countries?.[1] || 'the EU';
    return [
      `${exporter} used energy supply cuts as deliberate geopolitical leverage against ${importer}`,
      `${importer} natural gas imports from ${exporter} fell significantly after 2022`,
      `${importer} has secured alternative LNG supply contracts to reduce dependency on ${exporter}`,
      `${exporter} pipeline infrastructure (Nord Stream, TurkStream) was weaponized as political coercion`,
      `Qatar and Norway increased LNG exports to ${importer} as a direct result of ${exporter} supply disruptions`,
      `${importer} accelerated renewable energy buildout to permanently reduce fossil fuel import dependency`,
      `Energy price spikes caused by ${exporter} supply cuts directly impacted ${importer} economic policy`,
      `Iran has explored alternative gas export routes that circumvent Western sanctions`,
      `The Nord Stream pipeline sabotage in September 2022 permanently removed a key ${exporter}-${importer} energy link`,
      `${importer} REPowerEU policy achieved measurable progress in reducing reliance on Russian gas by 2024`,
      `LNG spot market prices in Europe reached record highs following Russian supply restrictions`,
      `Beneficial ownership of gas transit infrastructure through Ukraine involves politically connected entities`,
    ];
  },
  geopolitics: (entities) => {
    const actors = entities.countries?.slice(0, 3) || ['major powers'];
    const subject = actors.join(', ');
    return [
      `${actors[0] || 'The primary actor'} has used economic leverage as a foreign policy tool`,
      `Multilateral alliances have been strained by the geopolitical dispute involving ${subject}`,
      `Sanctions regimes targeting ${actors[0] || 'the actor'} are coordinated across Western governments`,
      `${actors[1] || 'Affected states'} have pursued economic diversification to reduce dependency`,
      `Third-party states have exploited the conflict between ${subject} for strategic gain`,
      `International institutions (UN, EU, NATO) have issued documented positions on the dispute`,
      `Trade volumes between opposing parties changed measurably following the geopolitical rupture`,
      `Media coverage of the conflict shows measurable ideological bias across geographic regions`,
    ];
  },
};

// Domain keywords → template mapping
const DOMAIN_KEYWORDS = {
  sanctions: /\bsanction|embargo|ofac|sdn|freeze|restrict|tariff/i,
  nuclear: /\bnuclear|enrichment|uranium|iaea|plutonium|warhead|centrifuge|nonproliferation/i,
  conflict: /\bwar|conflict|invasion|military|troops|bombing|ceasefire|casualties/i,
  corporate: /\bcompany|corporation|ceo|revenue|stock|fraud|sec filing|earnings|funding|valuation|series\s+[a-z]|capital\s+raise|acquisition|merger|ipo\b/i,
  election: /\belection|vote|ballot|poll|candidate|campaign|democrat|republican/i,
  health: /\bhealth|drug|vaccine|clinical|fda|treatment|disease|pandemic/i,
  energy: /\bgas|lng|pipeline|energy|oil|petroleum|fuel|nord.?stream|gazprom|repowereu|kwh|barrel|btu|natural gas|energy supply|energy leverage|energy weapon/i,
  geopolitics: /\bgeopoliti|leverage|coercion|foreign policy|alliance|sphere of influence|soft power|hard power|geostr/i,
};

export class LLMClaimDecomposer {
  constructor() {
    const config = getConfig();
    this._llmCfg = config.llm || {};
    this._ollamaUrl = this._llmCfg.endpoint || 'http://localhost:11434';
    this._ollamaModel = this._llmCfg.model || 'llama3';
    this._ollamaAvailable = null;
    this._timeout = 30_000;
  }

  /**
   * Decompose an investigation query into multiple verifiable sub-claims.
   *
   * @param {string} query - The investigation query
   * @param {Object} entities - Extracted entities { persons, orgs, countries, ... }
   * @returns {Promise<string[]>} Array of sub-claim text strings
   */
  async decompose(query, entities = {}) {
    // Try LLM first
    const llmClaims = await this._tryOllama(query, entities);
    if (llmClaims && llmClaims.length >= 3) {
      log('info', `claim-decomposer: LLM produced ${llmClaims.length} sub-claims`);
      return llmClaims;
    }

    // Fall back to domain-aware heuristic
    const heuristicClaims = this._heuristicDecompose(query, entities);
    log('info', `claim-decomposer: heuristic produced ${heuristicClaims.length} sub-claims`);
    return heuristicClaims;
  }

  // ─── Ollama ──────────────────────────────────────────────

  async _tryOllama(query, entities) {
    try {
      if (this._ollamaAvailable === false) return null;

      // Check availability on first call
      if (this._ollamaAvailable === null) {
        const check = await fetch(`${this._ollamaUrl}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        });
        this._ollamaAvailable = check.ok;
        if (!check.ok) {
          log('debug', 'claim-decomposer: Ollama not available');
          return null;
        }
      }

      const entityStr = this._formatEntities(entities);
      const prompt = DECOMPOSE_PROMPT
        .replace('{query}', query)
        .replace('{entities}', entityStr);

      const res = await fetch(`${this._ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this._ollamaModel,
          prompt,
          stream: false,
          options: { temperature: 0.3, num_predict: 1024 },
        }),
        signal: AbortSignal.timeout(this._timeout),
      });

      if (!res.ok) {
        log('warn', `claim-decomposer: Ollama response ${res.status}`);
        return null;
      }

      const data = await res.json();
      const text = data.response || '';

      // Extract JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        log('warn', 'claim-decomposer: no JSON array in LLM response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return null;

      // Validate: each item should be a string, 20-300 chars
      const valid = parsed
        .filter(s => typeof s === 'string' && s.length >= 20 && s.length <= 300)
        .map(s => s.replace(/^\d+\.\s*/, '').trim())  // strip leading numbering
        .slice(0, 12);  // cap at 12

      return valid.length >= 3 ? valid : null;
    } catch (err) {
      if (err.name === 'AbortError') {
        log('warn', 'claim-decomposer: Ollama timeout');
      } else {
        log('debug', `claim-decomposer: Ollama error: ${err.message}`);
      }
      return null;
    }
  }

  // ─── Heuristic Decomposition ──────────────────────────

  _heuristicDecompose(query, entities) {
    const lower = query.toLowerCase();
    const claims = [];
    const matchedDomains = new Set();

    // Match domains
    for (const [domain, regex] of Object.entries(DOMAIN_KEYWORDS)) {
      if (regex.test(lower)) {
        matchedDomains.add(domain);
      }
    }

    // Generate claims from matched domain templates
    // If no entities, generate query-based claims instead of refusing
    for (const domain of matchedDomains) {
      const template = HEURISTIC_TEMPLATES[domain];
      if (template) {
        // VALIDATION: Check if template has required entities
        const hasRequiredEntities = this._validateTemplateEntities(domain, entities);
        if (hasRequiredEntities) {
          const domainClaims = template(entities);
          // Filter out placeholder claims (those containing only generic fallback text)
          const concrete = domainClaims.filter(claim => !this._isPlaceholderClaim(claim, entities));
          claims.push(...concrete);
        } else if (Object.keys(entities).some(k => entities[k]?.length > 0)) {
          // If we have SOME entities (even if not the specific ones this template needs),
          // still generate claims - better than refusing entirely
          const domainClaims = template(entities);
          const concrete = domainClaims.filter(claim => !this._isPlaceholderClaim(claim, entities));
          if (concrete.length > 0) claims.push(...concrete);
        }
      }
    }

    // If no domain templates matched, fall back to generic decomposition
    if (claims.length === 0) {
      // If we detected domains in the query but templates didn't produce claims,
      // still attempt generic decomposition rather than refusing entirely
      const hasDomainsDetected = matchedDomains.size > 0;
      const hasAnyEntity = !!(entities.persons?.length || entities.orgs?.length || entities.countries?.length);

      if (hasDomainsDetected || hasAnyEntity) {
        // Domain was detected OR we have some entities = attempt to decompose
        claims.push(...this._genericDecompose(query, entities));
      } else {
        // No domains, no entities, and generic decomposition would be empty
        log('warn', 'claim-decomposer: Query lacks domain signals and entities. Cannot generate verifiable claims.');
        return [];
      }
    }

    // Deduplicate
    const unique = [...new Set(claims)];
    return unique.slice(0, 12);
  }

  /**
   * Validate that a domain template has the required entities it needs.
   * E.g., "sanctions" template needs countries or orgs; "nuclear" needs countries
   */
  _validateTemplateEntities(domain, entities) {
    const requirements = {
      sanctions: () => !!(entities.countries?.length || entities.orgs?.length),
      nuclear: () => !!entities.countries?.length,
      conflict: () => entities.countries?.length >= 2 || (entities.countries?.length && entities.orgs?.length),
      corporate: () => !!entities.orgs?.length,
      election: () => !!entities.countries?.length,
      health: () => !!(entities.persons?.length || entities.orgs?.length),
      energy: () => entities.countries?.length >= 2,
      geopolitics: () => entities.countries?.length >= 2,
    };
    const validator = requirements[domain];
    return validator ? validator() : true;
  }

  /**
   * Detect if a claim is just a placeholder with generic fallback text.
   * E.g., "the target is currently under international sanctions" uses fallback 'the target'
   */
  _isPlaceholderClaim(claim, entities) {
    // Claims with generic placeholders like "the target", "the country", "the company"
    const genericPatterns = [
      /\bthe\s+(?:target|country|company|subject|party|parties)\b/i,
      /\bthe\s+jurisdiction\b/i,
      /\bmajor\s+powers\b/i,
    ];

    return genericPatterns.some(pattern => pattern.test(claim));
  }

  _genericDecompose(query, entities) {
    const claims = [];
    const subject = entities.persons?.[0] || entities.orgs?.[0] || entities.countries?.[0] || query.split(/\s+/).slice(0, 3).join(' ');

    claims.push(`${subject} is accurately described in public records`);
    claims.push(`Claims about ${subject} are supported by primary source evidence`);
    claims.push(`Independent sources corroborate assertions about ${subject}`);
    claims.push(`The timeline of events related to ${subject} is accurately reported`);
    claims.push(`Counter-evidence exists that challenges claims about ${subject}`);

    // Add entity-specific claims
    for (const person of (entities.persons || []).slice(0, 2)) {
      claims.push(`${person}'s stated role and actions are verifiable`);
    }
    for (const org of (entities.orgs || []).slice(0, 2)) {
      claims.push(`${org}'s public statements are consistent with their filings`);
    }
    for (const country of (entities.countries || []).slice(0, 2)) {
      claims.push(`Official ${country} government positions are documented`);
    }

    return claims;
  }

  _formatEntities(entities) {
    const parts = [];
    if (entities.persons?.length) parts.push(`People: ${entities.persons.join(', ')}`);
    if (entities.orgs?.length) parts.push(`Organizations: ${entities.orgs.join(', ')}`);
    if (entities.countries?.length) parts.push(`Countries: ${entities.countries.join(', ')}`);
    if (entities.dates?.length) parts.push(`Dates: ${entities.dates.join(', ')}`);
    if (entities.topics?.length) parts.push(`Topics: ${entities.topics.join(', ')}`);
    return parts.length > 0 ? parts.join('; ') : 'none detected';
  }
}

export default LLMClaimDecomposer;
