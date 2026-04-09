import { BaseConnector } from '../base.js';
import { getConfig } from '../../core/config.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class FECConnector extends BaseConnector {
  constructor() {
    super({
      id: 'fec',
      name: 'FEC Campaign Finance',
      description: 'Federal Election Commission — candidate and committee campaign finance records (get key at api.data.gov/signup)',
      baseUrl: 'https://api.open.fec.gov',
      domains: ['political'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 2000,
      requiresKey: false,
      keyName: 'fec',
    });
  }

  _getApiKey() {
    try {
      return getConfig().keys?.fec || 'DEMO_KEY';
    } catch {
      return 'DEMO_KEY';
    }
  }

  async search(query, options = {}) {
    try {
      const apiKey = this._getApiKey();
      const perPage = options.limit || 10;
      const results = [];

      const [candRes, comRes] = await Promise.all([
        this._fetch(`${this.baseUrl}/v1/candidates/search/?q=${encodeURIComponent(query)}&api_key=${apiKey}&per_page=${perPage}`),
        this._fetch(`${this.baseUrl}/v1/committees/?q=${encodeURIComponent(query)}&api_key=${apiKey}&per_page=${perPage}`),
      ]);

      if (candRes.ok && candRes.data?.results) {
        for (const c of candRes.data.results) {
          results.push({
            url: `https://www.fec.gov/data/candidate/${c.candidate_id}/`,
            title: `${c.name} (${c.party_full || c.party || '?'}) — ${c.office_full || c.office || ''}`,
            summary: `${c.name}, ${c.party_full || ''} candidate for ${c.office_full || ''} (${c.state || ''})`,
            type: EvidenceType.NEUTRAL,
            timestamp: c.last_file_date || null,
            data: {
              candidateId: c.candidate_id,
              party: c.party_full || c.party,
              office: c.office_full || c.office,
              state: c.state,
              district: c.district,
              cycles: c.cycles,
              incumbentChallenge: c.incumbent_challenge_full,
            },
          });
        }
      }

      if (comRes.ok && comRes.data?.results) {
        for (const c of comRes.data.results) {
          results.push({
            url: `https://www.fec.gov/data/committee/${c.committee_id}/`,
            title: `Committee: ${c.name}`,
            summary: `${c.name} — ${c.committee_type_full || c.committee_type || 'committee'}, ${c.designation_full || ''}`,
            type: EvidenceType.NEUTRAL,
            timestamp: c.last_file_date || null,
            data: {
              committeeId: c.committee_id,
              type: c.committee_type_full || c.committee_type,
              designation: c.designation_full,
              party: c.party_full || c.party,
              treasurerName: c.treasurer_name,
              totalReceipts: c.total_receipts,
              totalDisbursements: c.total_disbursements,
            },
          });
        }
      }

      return this._toEvidence(results, options.claimId);
    } catch {
      return [];
    }
  }
}

export default FECConnector;
