import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class USASpendingConnector extends BaseConnector {
  constructor() {
    super({
      id: 'usa_spending',
      name: 'USAspending.gov',
      description: 'Federal spending data — contracts, grants, and awarding agencies',
      baseUrl: 'https://api.usaspending.gov',
      domains: ['political', 'corporate'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const items = [];

      const agencyRes = await this._fetch(`${this.baseUrl}/api/v2/autocomplete/awarding_agency/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search_text: query, limit: 10 }),
      });
      if (agencyRes.ok && agencyRes.data?.results) {
        for (const a of agencyRes.data.results) {
          items.push({
            url: `https://www.usaspending.gov/agency/${a.id || ''}`,
            title: `Agency: ${a.subtier_agency?.name || a.toptier_agency?.name || 'Unknown'}`,
            summary: `${a.toptier_agency?.name || ''} > ${a.subtier_agency?.name || ''} (CGAC: ${a.toptier_agency?.toptier_code || '?'})`,
            type: EvidenceType.NEUTRAL,
            timestamp: null,
            data: {
              toptierAgency: a.toptier_agency,
              subtierAgency: a.subtier_agency,
              agencyId: a.id,
            },
          });
        }
      }

      const recipientRes = await this._fetch(`${this.baseUrl}/api/v2/autocomplete/recipient/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search_text: query, limit: 10 }),
      });
      if (recipientRes.ok && recipientRes.data?.results) {
        for (const r of recipientRes.data.results) {
          items.push({
            url: `https://www.usaspending.gov/recipient/${r.recipient_id || ''}`,
            title: `Recipient: ${r.recipient_name || 'Unknown'}`,
            summary: `Federal spending recipient: ${r.recipient_name || query}`,
            type: EvidenceType.NEUTRAL,
            timestamp: null,
            data: {
              recipientName: r.recipient_name,
              recipientId: r.recipient_id,
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

export default USASpendingConnector;
