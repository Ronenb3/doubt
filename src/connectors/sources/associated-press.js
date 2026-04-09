/**
 * Associated Press Connector
 *
 * AP News search — wire service, highest authority for originating
 * news. AP stories are syndicated everywhere; going to source eliminates
 * derivative inflation in citation diversity scoring.
 *
 * Enterprise API key required: https://developer.ap.org
 * Set AP_API_KEY in .env. Without it this connector is disabled.
 * AP content already flows into doubt via rss_news/gnews/brave_news;
 * this connector goes direct-to-wire when key is present to avoid
 * derivative inflation in citation diversity scoring.
 * Trust: NEWS_MAJOR (0.65)
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

class AssociatedPressConnector extends BaseConnector {
  constructor() {
    super({
      id: 'associated_press',
      name: 'Associated Press',
      description: 'AP News search — wire service, highest-authority originating journalism',
      baseUrl: 'https://api.ap.org',
      domains: ['news', 'general'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 1000,
      requiresKey: true,
      keyName: 'AP_API_KEY',
    });
  }

  async search(query, options = {}) {
    try {
      const config = getConfig();
      const apiKey = config.keys['AP_API_KEY'];
      if (!apiKey) return [];
      return await this._searchEnterprise(query, apiKey, options);
    } catch {
      return [];
    }
  }

  async _searchEnterprise(query, apiKey, options) {
    const params = new URLSearchParams({
      q: query,
      apiKey,
      count: String(options.limit || 20),
    });
    const res = await this._fetch(
      `https://api.ap.org/media/v/content/feed?${params}`
    );
    if (!res.ok) return [];

    const items = (res.data?.data?.items || []).map(item => ({
      url: item.altids?.itemid ? `https://apnews.com/article/${item.altids.itemid}` : '',
      title: item.headline || 'AP Story',
      summary: item.description_summary || item.headline || '',
      type: EvidenceType.NEUTRAL,
      timestamp: item.firstcreated || null,
      data: { slug: item.slugline, subject: item.subject },
    }));

    return this._toEvidence(items, options.claimId);
  }
}

export default AssociatedPressConnector;
