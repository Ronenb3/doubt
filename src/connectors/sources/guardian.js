/**
 * The Guardian Connector
 *
 * The Guardian Open Platform API — structured news search with section,
 * date, tag, and contributor metadata. High-quality originating journalism.
 *
 * Free API key: https://bonobo.capi.gutools.co.uk/register/developer
 * Key name: GUARDIAN_API_KEY
 * Fallback: "test" key works for low-volume use.
 * Trust: NEWS_MAJOR (0.65)
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

class GuardianConnector extends BaseConnector {
  constructor() {
    super({
      id: 'guardian',
      name: 'The Guardian',
      description: 'The Guardian Open Platform — structured article search with full metadata',
      baseUrl: 'https://content.guardianapis.com',
      domains: ['news', 'general', 'political'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 500,
      requiresKey: false, // "test" key works without registration
      keyName: 'GUARDIAN_API_KEY',
    });
  }

  async search(query, options = {}) {
    try {
      const config = getConfig();
      const apiKey = config.keys['GUARDIAN_API_KEY'] || 'test';

      const params = new URLSearchParams({
        q: query,
        'api-key': apiKey,
        'show-fields': 'trailText,byline,wordcount,publication',
        'order-by': 'relevance',
        'page-size': String(options.limit || 20),
      });

      if (options.dateRange?.start) params.set('from-date', options.dateRange.start);
      if (options.dateRange?.end)   params.set('to-date',   options.dateRange.end);

      const res = await this._fetch(`${this.baseUrl}/search?${params}`);
      if (!res.ok) return [];

      const results = res.data?.response?.results || [];
      const items = results.map(r => ({
        url: r.webUrl,
        title: r.webTitle,
        summary: r.fields?.trailText || r.webTitle,
        type: EvidenceType.NEUTRAL,
        timestamp: r.webPublicationDate || null,
        data: {
          section: r.sectionName,
          byline: r.fields?.byline,
          wordCount: r.fields?.wordcount,
          pillar: r.pillarName,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default GuardianConnector;
