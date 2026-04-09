import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class CongressionalRecordConnector extends BaseConnector {
  constructor() {
    super({
      id: 'congressional_record',
      name: 'Congressional Record',
      description: 'US Congress bill search — legislation text, sponsors, status, actions',
      baseUrl: 'https://api.congress.gov/v3',
      domains: ['political'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
      requiresKey: false,
    });
    this._apiKey = process.env.CONGRESS_API_KEY || 'DEMO_KEY';
  }

  async search(query, options = {}) {
    try {
      const params = new URLSearchParams({
        query: query,
        limit: String(options.limit || 10),
        api_key: this._apiKey,
      });

      const url = `${this.baseUrl}/bill?${params}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const bills = res.data?.bills || [];
      const items = bills.slice(0, options.limit || 10).map(bill => ({
        url: bill.url || `https://www.congress.gov/bill/${bill.congress}th-congress/${bill.type?.toLowerCase()}-bill/${bill.number}`,
        title: `${bill.type || ''}${bill.number || ''} — ${bill.title || query}`,
        summary: `${bill.title || 'Bill'} (${bill.congress}th Congress) — latest action: ${bill.latestAction?.text || 'none'}`,
        type: EvidenceType.NEUTRAL,
        timestamp: bill.latestAction?.actionDate || bill.updateDate || null,
        data: {
          congress: bill.congress,
          billType: bill.type,
          billNumber: bill.number,
          title: bill.title,
          latestAction: bill.latestAction,
          originChamber: bill.originChamber,
          updateDate: bill.updateDate,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default CongressionalRecordConnector;
