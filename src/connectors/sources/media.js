import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class MediaConnector extends BaseConnector {
  constructor() {
    super({
      id: 'media',
      name: 'Internet Archive',
      description: 'Internet Archive search — books, video, audio, web captures, historical media',
      baseUrl: 'https://archive.org',
      domains: ['media', 'news'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const rows = options.limit || 10;
      const url = `${this.baseUrl}/advancedsearch.php?q=${encodeURIComponent(query)}&output=json&rows=${rows}&fl[]=identifier,title,description,mediatype,date,downloads,creator`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const docs = res.data?.response?.docs || [];
      const items = docs.map(d => ({
        url: `${this.baseUrl}/details/${d.identifier}`,
        title: d.title || d.identifier || 'Untitled',
        summary: (d.description || d.title || '').toString().slice(0, 500),
        type: EvidenceType.CONTEXTUAL,
        timestamp: d.date || null,
        data: {
          identifier: d.identifier,
          mediaType: d.mediatype,
          creator: d.creator,
          downloads: d.downloads,
          date: d.date,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default MediaConnector;
