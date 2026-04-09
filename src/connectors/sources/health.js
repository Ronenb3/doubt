import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class HealthConnector extends BaseConnector {
  constructor() {
    super({
      id: 'health',
      name: 'openFDA',
      description: 'FDA adverse event reports — drug reactions, recalls, enforcement actions',
      baseUrl: 'https://api.fda.gov',
      domains: ['health'],
      trustTier: SourceTrust.COURT_RECORD,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 10;
      const url = `${this.baseUrl}/drug/event.json?search=${encodeURIComponent(query)}&limit=${limit}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const events = res.data?.results || [];
      const items = events.map(e => {
        const drug = e.patient?.drug?.[0] || {};
        const reaction = e.patient?.reaction?.[0] || {};
        return {
          url: `https://api.fda.gov/drug/event.json?search=safetyreportid:${e.safetyreportid}`,
          title: `FDA AE: ${drug.medicinalproduct || 'Unknown drug'} — ${reaction.reactionmeddrapt || 'Unknown reaction'}`,
          summary: `Adverse event report: ${drug.medicinalproduct || 'drug'} → ${reaction.reactionmeddrapt || 'reaction'} (${e.receivedate || ''})`,
          type: EvidenceType.NEUTRAL,
          timestamp: e.receivedate ? `${e.receivedate.slice(0, 4)}-${e.receivedate.slice(4, 6)}-${e.receivedate.slice(6, 8)}` : null,
          data: {
            reportId: e.safetyreportid,
            serious: e.serious,
            seriousnessDeath: e.seriousnessdeath,
            drug: drug.medicinalproduct,
            reaction: reaction.reactionmeddrapt,
            outcome: reaction.reactionoutcome,
            receiveDate: e.receivedate,
            country: e.occurcountry,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default HealthConnector;
