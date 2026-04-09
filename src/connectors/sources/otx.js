import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * AlienVault OTX (Open Threat Exchange) Connector
 *
 * AlienVault's community threat intelligence platform. 20M+ indicators.
 * Free API key at https://otx.alienvault.com (sign up, get key instantly).
 *
 * Use cases in doubt:
 *   - IP/domain/URL/file hash reputation lookups
 *   - Attribution — is this entity tied to known threat actors?
 *   - Malware campaign investigations
 *   - Infrastructure analysis for cybersecurity stories
 *
 * Set env: OTX_API_KEY=your_key
 */
class AlienVaultOTXConnector extends BaseConnector {
  constructor() {
    super({
      id: 'otx',
      name: 'AlienVault OTX',
      description: 'Open Threat Exchange — IP/domain/file threat intelligence from 20M+ community indicators',
      baseUrl: 'https://otx.alienvault.com/api/v1',
      domains: ['security', 'compliance', 'geopolitical'],
      trustTier: SourceTrust.OPEN_SOURCE,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    const apiKey = process.env.OTX_API_KEY;
    if (!apiKey) return [];  // silent skip — no key

    try {
      const limit = options.limit || 10;
      const params = new URLSearchParams({
        q: query,
        limit: String(limit),
        sort: '-created',
      });

      const res = await this._fetch(`${this.baseUrl}/search/pulses?${params}`, {
        headers: {
          'X-OTX-API-KEY': apiKey,
          'Accept': 'application/json',
        },
      });
      if (!res.ok) return [];

      const results = res.data?.results || [];
      const items = results.map(r => {
        const tags = (r.tags || []).slice(0, 6).join(', ');
        const iocCount = r.indicator_count || 0;
        const adversary = r.adversary || '';
        const malware = (r.malware_families || []).slice(0, 3).join(', ');

        return {
          url: `https://otx.alienvault.com/pulse/${r.id}`,
          title: r.name || `OTX Pulse: ${query}`,
          summary: [
            r.description ? r.description.slice(0, 300) : null,
            iocCount ? `${iocCount} indicators of compromise.` : null,
            adversary ? `Adversary: ${adversary}.` : null,
            malware ? `Malware families: ${malware}.` : null,
            tags ? `Tags: ${tags}.` : null,
          ].filter(Boolean).join(' '),
          type: EvidenceType.SUPPORTS,
          timestamp: r.created || r.modified || null,
          data: {
            id: r.id,
            author: r.author_name,
            indicatorCount: iocCount,
            adversary,
            malwareFamilies: r.malware_families,
            targetedCountries: r.targeted_countries,
            tags: r.tags,
            tlp: r.tlp,
            references: r.references,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default AlienVaultOTXConnector;
