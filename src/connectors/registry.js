/**
 * doubt — Connector Registry
 *
 * Auto-discovers and manages all data source connectors.
 * Handles domain routing: given a claim about finance,
 * route to SEC/FINRA/FEC. Given a claim about a company,
 * route to OpenCorporates/GLEIF/crt.sh.
 */

import { readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { log } from '../core/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCES_DIR = resolve(__dirname, 'sources');

class ConnectorRegistry {
  constructor() {
    this._connectors = new Map();
    this._loaded = false;
  }

  async loadAll() {
    if (this._loaded) return;

    const files = readdirSync(SOURCES_DIR).filter(f => f.endsWith('.js'));
    for (const file of files) {
      try {
        const mod = await import(pathToFileURL(resolve(SOURCES_DIR, file)).href);
        const ConnectorClass = mod.default || Object.values(mod).find(v =>
          typeof v === 'function' && v.prototype?.constructor
        );
        if (ConnectorClass) {
          const instance = new ConnectorClass();
          this._connectors.set(instance.id, instance);
        }
      } catch (err) {
        log('warn', `Failed to load connector ${file}: ${err.message}`);
      }
    }
    this._loaded = true;
    log('info', `Loaded ${this._connectors.size} connectors`);
  }

  get(id) {
    return this._connectors.get(id);
  }

  all() {
    return [...this._connectors.values()];
  }

  available() {
    return this.all().filter(c => c.available);
  }

  /**
   * Route a query to the most relevant connectors based on domain signals.
   * Returns connectors sorted by relevance.
   */
  route(query, options = {}) {
    const available = options.connectors
      ? this.all().filter(c => options.connectors.includes(c.id))
      : this.available();

    const q = query.toLowerCase();
    const signals = detectDomains(q);

    // Score each connector by domain overlap
    const scored = available.map(connector => {
      let score = 0.5; // base relevance

      for (const domain of connector.domains) {
        if (signals.has(domain)) score += 0.3;
      }

      // Boost high-trust sources
      score += connector.trustTier * 0.1;

      // Universal connectors always get some weight
      if (connector.domains.includes('general')) score += 0.1;

      return { connector, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, options.maxSources || 30)
      .map(s => s.connector);
  }

  toJSON() {
    return this.all().map(c => c.toJSON());
  }
}

function detectDomains(query) {
  const signals = new Set();
  const q = query.toLowerCase();

  const patterns = {
    financial: /\b(stock|ticker|sec|filing|insider|trade|hedge|fund|revenue|earnings|ipo|nasdaq|nyse|market|invest|share|dividend|bond|equity|futures|options|commodity|forex)\b/,
    corporate: /\b(company|corporation|inc\.|llc|ltd|corporate|subsidiary|merger|acquisition|board|ceo|cfo|nonprofit|charity|501c|employer)\b/,
    political: /\b(congress|senate|lobby|campaign|fec|election|vote|democrat|republican|government|legislation|regulation|executive.order|federal.register)\b/,
    legal: /\b(court|lawsuit|plaintiff|defendant|judge|ruling|litigation|patent|trademark|settlement|verdict|docket|pacer|appeal)\b/,
    compliance: /\b(sanction|ofac|compliance|violation|penalty|enforcement|fraud|aml|kyc|pep|politically.exposed|debarment|exclusion)\b/,
    academic: /\b(research|paper|study|university|professor|journal|peer.review|citation|publish|arxiv|orcid|clinical.trial|pubmed)\b/,
    tech: /\b(github|open.source|api|developer|code|software|startup|saas|cloud|huggingface|model|machine.learning|ai|tesla|waymo|uber|lyft|autopilot)\b/,
    social: /\b(reddit|twitter|sentiment|viral|trending|community|forum|hacker.news|stocktwits|discourse)\b/,
    infrastructure: /\b(domain|certificate|ssl|server|deploy|subdomain|dns|hosting|whois|rdap)\b/,
    news: /\b(report|article|journalist|press|media|news|headline|breaking|archive|gdelt)\b/,
    health: /\b(drug|fda|clinical|hospital|pharma|vaccine|adverse.event|medical|disease|health)\b/,
    economic: /\b(gdp|inflation|unemployment|fed|interest.rate|cpi|bls|fred|macro|economic|labor)\b/,
    geopolitical: /\b(conflict|sanctions|war|diplomacy|un|nato|territory|border|geopolit|comtrade|export|import)\b/,
    sanctions: /\b(sanction|embargo|ofac|sdn|interpol|wanted|red.notice|blacklist)\b/,
    commodities: /\b(oil|gold|silver|wheat|corn|cftc|cme|commodity|futures|warehouse)\b/,
    location: /\b(address|property|real.estate|coordinates|geospatial|map|census|nominatim)\b/,
    safety: /\b(recall|nhtsa|vehicle|safety|complaint|defect|hazard|self.driving|autonomous|autopilot|crash|accident|fatal)\b/,
    procurement: /\b(contract|procurement|sam\.gov|federal.award|grant|spending|usaspending)\b/,
    crypto: /\b(bitcoin|ethereum|blockchain|crypto|wallet|defi|nft|token)\b/,
    trade: /\b(supply.chain|import|export|tariff|trade|shipping|customs|comtrade)\b/,
  };

  for (const [domain, pattern] of Object.entries(patterns)) {
    if (pattern.test(q)) signals.add(domain);
  }

  // If nothing matched, use general-purpose connectors
  if (signals.size === 0) {
    signals.add('general');
    signals.add('news');
    signals.add('social');
  }

  return signals;
}

// Singleton
const registry = new ConnectorRegistry();
export default registry;
export { ConnectorRegistry, detectDomains };
