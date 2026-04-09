import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * Intelligence X Connector
 *
 * Professional OSINT search engine indexing darkweb, leaks, documents,
 * Tor, I2P, Usenet, paste sites, and more. Purpose-built for investigations.
 *
 * Free tier: ~1000 search units/month. Get key at https://intelx.io
 * Apply for researcher/journalist account for higher limits at no cost.
 *
 * Use cases:
 *   - Data leak checking (emails, domains in breaches)
 *   - Darkweb mentions of entities/companies
 *   - Historical WHOIS / DNS records
 *   - Document leaks referencing specific people/orgs
 *
 * Set env: INTELX_API_KEY=your_key (format: uuid)
 */
class IntelXConnector extends BaseConnector {
  constructor() {
    super({
      id: 'intelx',
      name: 'Intelligence X',
      description: 'OSINT search across darkweb, leaks, paste sites, Tor, documents — purpose-built for investigations',
      baseUrl: 'https://2.intelx.io',
      domains: ['security', 'osint', 'geopolitical', 'compliance'],
      trustTier: SourceTrust.OPEN_SOURCE,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    const apiKey = process.env.INTELX_API_KEY;
    if (!apiKey) return [];

    try {
      // Phase 1: submit search and get search ID
      const searchBody = {
        term: query,
        buckets: [],
        lookuplevel: 0,
        maxresults: options.limit || 10,
        timeout: 10,
        datefrom: '',
        dateto: '',
        sort: 4,         // sort by relevance
        media: 0,        // all media types
        terminate: [],
      };

      const initRes = await this._fetch(`${this.baseUrl}/intelligent/search`, {
        method: 'POST',
        headers: {
          'x-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchBody),
      });

      if (!initRes.ok) return [];
      const searchId = initRes.data?.id;
      if (!searchId) return [];

      // Phase 2: fetch results (brief delay for search to complete)
      await new Promise(r => setTimeout(r, 2000));

      const resultsRes = await this._fetch(
        `${this.baseUrl}/intelligent/search/result?id=${searchId}&limit=${options.limit || 10}&offset=0`,
        {
          headers: { 'x-key': apiKey },
        }
      );

      if (!resultsRes.ok) return [];

      const records = resultsRes.data?.records || [];
      const items = records.map(r => {
        const bucket = r.bucket || '';
        const date = r.date ? new Date(r.date).toISOString() : null;

        return {
          url: r.keyvalues?.find(k => k.key === 'url')?.value
            || `https://intelx.io/?did=${r.systemid}`,
          title: r.name || `IntelX result: ${bucket || query}`,
          summary: [
            r.snippet || null,
            bucket ? `Source: ${bucket}` : null,
            r.date ? `Date: ${r.date}` : null,
            r.storageid ? `(ID: ${r.storageid})` : null,
          ].filter(Boolean).join(' | '),
          type: EvidenceType.SUPPORTS,
          timestamp: date,
          data: {
            systemId: r.systemid,
            storageId: r.storageid,
            bucket,
            media: r.media,
            date: r.date,
            score: r.score,
            keyvalues: r.keyvalues,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default IntelXConnector;
