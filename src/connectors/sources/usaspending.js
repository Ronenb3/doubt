import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * USAspending.gov Connector
 *
 * Official US federal spending database — contracts, grants, loans, direct
 * payments. No API key required. The single best free source for:
 *   - Who is getting government contracts (and how much)
 *   - Agency spending patterns
 *   - Defense/intelligence contractor exposure
 *   - Sanctions evasion via federal awards
 *
 * API: https://api.usaspending.gov/api/v2/
 */
class USASpendingConnector extends BaseConnector {
  constructor() {
    super({
      id: 'usaspending',
      name: 'USAspending.gov',
      description: 'US federal spending — contracts, grants, loans. All agencies. No auth required.',
      baseUrl: 'https://api.usaspending.gov/api/v2',
      domains: ['financial', 'government', 'political', 'compliance'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 15;

      // Award search — covers contracts, grants, direct payments
      const body = {
        filters: {
          keywords: [query],
          award_type_codes: ['A', 'B', 'C', 'D', '02', '03', '04', '05'],  // contracts + grants
        },
        fields: [
          'Award ID', 'Recipient Name', 'Awarding Agency', 'Awarding Sub Agency',
          'Award Amount', 'Description', 'Period of Performance Start Date',
          'Period of Performance Current End Date', 'Place of Performance State Code',
          'Contract Award Type',
        ],
        page: 1,
        limit,
        sort: 'Award Amount',
        order: 'desc',
      };

      const res = await this._fetch(`${this.baseUrl}/search/spending_by_award/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return [];

      const results = res.data?.results || [];
      const items = results.map(r => {
        const amount = r['Award Amount'];
        const amountStr = amount != null
          ? `$${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
          : 'amount unknown';
        const agency = r['Awarding Sub Agency'] || r['Awarding Agency'] || 'Unknown Agency';
        const recipient = r['Recipient Name'] || 'Unknown Recipient';
        const desc = r['Description'] || '';
        const awardId = r['Award ID'] || '';

        return {
          url: awardId
            ? `https://www.usaspending.gov/award/${encodeURIComponent(awardId)}/`
            : 'https://www.usaspending.gov/',
          title: `${recipient} — ${amountStr} from ${agency}`,
          summary: `Federal award to ${recipient}: ${amountStr}. Agency: ${agency}. ${desc ? 'Description: ' + desc.slice(0, 200) : ''}`.trim(),
          type: EvidenceType.SUPPORTS,
          timestamp: r['Period of Performance Start Date'] || null,
          data: {
            awardId,
            recipient,
            agency,
            amount,
            description: desc,
            contractType: r['Contract Award Type'],
            startDate: r['Period of Performance Start Date'],
            endDate: r['Period of Performance Current End Date'],
            state: r['Place of Performance State Code'],
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default USASpendingConnector;
