import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class FederalProcurementConnector extends BaseConnector {
  constructor() {
    super({
      id: 'federal_procurement',
      name: 'Federal Procurement',
      description: 'Federal contract opportunities and awards via SAM.gov and USASpending',
      baseUrl: 'https://api.sam.gov',
      domains: ['political', 'corporate'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1500,
    });
    this._apiKey = process.env.SAM_GOV_API_KEY || 'DEMO_KEY';
  }

  async search(query, options = {}) {
    try {
      const items = await this._searchOpportunities(query, options);
      if (items.length > 0) return this._toEvidence(items, options.claimId);

      const awards = await this._searchAwards(query, options);
      return this._toEvidence(awards, options.claimId);
    } catch {
      return [];
    }
  }

  async _searchOpportunities(query, options) {
    const params = new URLSearchParams({
      q: query,
      limit: String(options.limit || 10),
      api_key: this._apiKey,
    });
    const url = `${this.baseUrl}/opportunities/v2/search?${params}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const opps = res.data?.opportunitiesData || res.data?.results || [];
    return (Array.isArray(opps) ? opps : []).slice(0, options.limit || 10).map(o => ({
      url: o.uiLink || `https://sam.gov/opp/${o.noticeId || ''}`,
      title: `${o.title || query} — Federal Opportunity`,
      summary: `${o.title || 'Opportunity'} by ${o.department || o.fullParentPathName || 'agency'} — ${o.type || 'contract'}`,
      type: EvidenceType.NEUTRAL,
      timestamp: o.postedDate || o.responseDeadLine || null,
      data: {
        noticeId: o.noticeId,
        title: o.title,
        department: o.department || o.fullParentPathName,
        type: o.type,
        postedDate: o.postedDate,
        responseDeadline: o.responseDeadLine,
        setAside: o.typeOfSetAsideDescription,
        naics: o.naicsCode,
      },
    }));
  }

  async _searchAwards(query, options) {
    const url = `https://api.usaspending.gov/api/v2/search/spending_by_award/?limit=${options.limit || 10}`;
    const res = await this._fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: { keywords: [query] },
        fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Start Date'],
        limit: options.limit || 10,
        page: 1,
        sort: 'Award Amount',
        order: 'desc',
      }),
    });
    if (!res.ok) return [];

    const results = res.data?.results || [];
    return results.slice(0, options.limit || 10).map(a => ({
      url: `https://www.usaspending.gov/award/${a['internal_id'] || ''}`,
      title: `${a['Recipient Name'] || query} — ${a['Award ID'] || 'Award'}`,
      summary: `Award ${a['Award ID'] || ''} to ${a['Recipient Name'] || 'unknown'}: $${a['Award Amount'] || 'N/A'} from ${a['Awarding Agency'] || 'agency'}`,
      type: EvidenceType.NEUTRAL,
      timestamp: a['Start Date'] || null,
      data: a,
    }));
  }
}

export default FederalProcurementConnector;
