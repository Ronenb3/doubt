import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class ChroniclingAmericaConnector extends BaseConnector {
  constructor() {
    super({
      id: 'chronicling_america',
      name: 'Chronicling America',
      description: 'Library of Congress digital newspaper archive (1770–1963) — historical claim verification with primary sources',
      baseUrl: 'https://chroniclingamerica.loc.gov',
      domains: ['historical', 'political', 'legal', 'cultural'],
      trustTier: SourceTrust.PRIMARY_DOCUMENT,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = Math.min(options.limit || 10, 20);
      const url = `${this.baseUrl}/search/pages/results/?andtext=${encodeURIComponent(query)}&format=json&rows=${limit}`;

      const res = await this._fetch(url);
      if (!res.ok) return [];

      const items = (res.data?.items || []).map(p => ({
        url: p.url ? `${this.baseUrl}${p.url}` : this.baseUrl,
        title: `${p.title || 'Newspaper Page'} — ${p.date || 'Unknown date'}`.slice(0, 200),
        summary: [
          p.title && `Publication: ${p.title}`,
          p.date && `Date: ${p.date}`,
          p.city && p.state && `Location: ${p.city.join(', ')}, ${p.state.join(', ')}`,
          p.edition_label && `Edition: ${p.edition_label}`,
          p.page && `Page: ${p.page}`,
          p.ocr_eng && p.ocr_eng.slice(0, 300),
        ].filter(Boolean).join('. ').slice(0, 500),
        type: EvidenceType.NEUTRAL,
        timestamp: p.date ? this._parseDate(p.date) : null,
        data: {
          publication: p.title,
          date: p.date,
          city: p.city,
          state: p.state,
          edition: p.edition_label,
          page: p.page,
          sequence: p.sequence,
          lccn: p.lccn,
          batch: p.batch,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _parseDate(dateStr) {
    // LOC dates can be "YYYYMMDD" format
    if (!dateStr) return null;
    const clean = dateStr.replace(/[^0-9]/g, '');
    if (clean.length === 8) {
      return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
    }
    return dateStr;
  }
}

export default ChroniclingAmericaConnector;
