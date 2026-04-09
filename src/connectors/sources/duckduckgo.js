import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class DuckDuckGoConnector extends BaseConnector {
  constructor() {
    super({
      id: 'duckduckgo',
      name: 'DuckDuckGo',
      description: 'DuckDuckGo Instant Answer API — abstracts, related topics, and disambiguation',
      baseUrl: 'https://api.duckduckgo.com',
      domains: ['general'],
      trustTier: 0.60,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        no_html: '1',
        skip_disambig: '0',
      });

      const url = `${this.baseUrl}/?${params}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const d = res.data || {};
      const items = [];

      if (d.AbstractText) {
        items.push({
          url: d.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
          title: d.Heading || query,
          summary: d.AbstractText.slice(0, 500),
          type: EvidenceType.CONTEXTUAL,
          timestamp: null,
          data: {
            source: d.AbstractSource,
            image: d.Image,
            entity: d.Entity,
          },
        });
      }

      for (const topic of (d.RelatedTopics || []).slice(0, 8)) {
        if (topic.Text) {
          items.push({
            url: topic.FirstURL || '',
            title: topic.Text.slice(0, 120),
            summary: topic.Text,
            type: EvidenceType.CONTEXTUAL,
            timestamp: null,
            data: { icon: topic.Icon?.URL },
          });
        }
        // Handle sub-topics (grouped results)
        if (topic.Topics) {
          for (const sub of topic.Topics.slice(0, 3)) {
            if (sub.Text) {
              items.push({
                url: sub.FirstURL || '',
                title: sub.Text.slice(0, 120),
                summary: sub.Text,
                type: EvidenceType.CONTEXTUAL,
                timestamp: null,
                data: { group: topic.Name },
              });
            }
          }
        }
      }

      for (const r of (d.Results || []).slice(0, 5)) {
        if (r.Text) {
          items.push({
            url: r.FirstURL || '',
            title: r.Text.slice(0, 120),
            summary: r.Text,
            type: EvidenceType.NEUTRAL,
            timestamp: null,
            data: {},
          });
        }
      }

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default DuckDuckGoConnector;
