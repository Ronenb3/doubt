import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class GDELTConnector extends BaseConnector {
  constructor() {
    super({
      id: 'gdelt',
      name: 'GDELT Project',
      description: 'Global news event monitoring — real-time article search across worldwide media',
      baseUrl: 'https://api.gdeltproject.org',
      domains: ['news', 'general'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 6000,
    });
  }

  async search(query, options = {}) {
    try {
      const maxRecords = options.limit || 20;
      const params = new URLSearchParams({
        query,
        mode: 'artlist',
        maxrecords: String(maxRecords),
        format: 'json',
        timespan: '3months',
        sourcelang: 'eng',
      });

      const url = `${this.baseUrl}/api/v2/doc/doc?${params}`;
      const res = await this._fetch(url, { timeout: 30000 });
      if (!res.ok) return [];

      const articles = res.data?.articles || (Array.isArray(res.data) ? res.data : []);
      const items = articles.map(a => ({
        url: a.url || '',
        title: a.title || 'Untitled',
        summary: a.title || '',
        type: EvidenceType.NEUTRAL,
        timestamp: a.seendate
          ? new Date(a.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,
              '$1-$2-$3T$4:$5:$6Z')).toISOString()
          : null,
        data: {
          domain: a.domain,
          language: a.language,
          sourcecountry: a.sourcecountry,
          socialimage: a.socialimage,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default GDELTConnector;
