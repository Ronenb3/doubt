import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class NewsArchiveConnector extends BaseConnector {
  constructor() {
    super({
      id: 'news_archive',
      name: 'News Archive',
      description: 'Deep news archive — Internet Archive full-text search supplemented with GDELT doc search',
      baseUrl: 'https://archive.org',
      domains: ['news', 'media'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const items = [];
      const limit = options.limit || 10;

      // 1. Internet Archive advanced search
      const iaQuery = `${query} mediatype:texts`;
      const iaUrl = `${this.baseUrl}/advancedsearch.php?q=${encodeURIComponent(iaQuery)}&output=json&rows=${limit}&fl[]=identifier&fl[]=title&fl[]=description&fl[]=date&fl[]=creator&fl[]=mediatype&fl[]=source`;
      const iaRes = await this._fetch(iaUrl);
      if (iaRes.ok) {
        const docs = iaRes.data?.response?.docs || [];
        for (const d of docs) {
          items.push({
            url: `https://archive.org/details/${d.identifier}`,
            title: d.title || d.identifier || 'Untitled',
            summary: [
              d.title,
              d.creator ? `by ${d.creator}` : null,
              d.description ? (typeof d.description === 'string' ? d.description : d.description[0])?.slice(0, 200) : null,
            ].filter(Boolean).join(' — '),
            type: EvidenceType.NEUTRAL,
            timestamp: d.date || null,
            data: {
              source: 'internet_archive',
              identifier: d.identifier,
              creator: d.creator,
              mediatype: d.mediatype,
              originalSource: d.source,
            },
          });
        }
      }

      // 2. GDELT doc search for broader news coverage
      const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=10&format=json`;
      const gdeltRes = await this._fetch(gdeltUrl);
      if (gdeltRes.ok) {
        const articles = gdeltRes.data?.articles || [];
        for (const a of articles.slice(0, 5)) {
          const alreadyFound = items.some(i =>
            i.title.toLowerCase() === (a.title || '').toLowerCase()
          );
          if (alreadyFound) continue;
          items.push({
            url: a.url || '',
            title: a.title || 'Untitled',
            summary: a.title || '',
            type: EvidenceType.NEUTRAL,
            timestamp: a.seendate
              ? new Date(a.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')).toISOString()
              : null,
            data: {
              source: 'gdelt',
              domain: a.domain,
              language: a.language,
              sourcecountry: a.sourcecountry,
            },
          });
        }
      }

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default NewsArchiveConnector;
