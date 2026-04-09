import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class ClinicalTrialsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'clinical_trials',
      name: 'ClinicalTrials.gov',
      description: 'Clinical trial registry — study protocols, results, sponsors, conditions',
      baseUrl: 'https://clinicaltrials.gov',
      domains: ['health', 'academic'],
      trustTier: SourceTrust.COURT_RECORD,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 10;
      const url = `${this.baseUrl}/api/v2/studies?query.term=${encodeURIComponent(query)}&pageSize=${limit}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const studies = res.data?.studies || [];
      const items = studies.map(s => {
        const proto = s.protocolSection || {};
        const id = proto.identificationModule || {};
        const status = proto.statusModule || {};
        const design = proto.designModule || {};
        const sponsor = proto.sponsorCollaboratorsModule?.leadSponsor || {};
        const conditions = proto.conditionsModule?.conditions || [];

        const nctId = id.nctId || '';
        return {
          url: `${this.baseUrl}/study/${nctId}`,
          title: id.briefTitle || id.officialTitle || 'Untitled Study',
          summary: `${id.briefTitle || ''} — ${status.overallStatus || 'unknown status'}, Phase ${design.phases?.join('/') || 'N/A'} (${sponsor.name || 'unknown sponsor'})`,
          type: EvidenceType.NEUTRAL,
          timestamp: status.startDateStruct?.date || status.studyFirstPostDateStruct?.date || null,
          data: {
            nctId,
            status: status.overallStatus,
            phases: design.phases,
            sponsor: sponsor.name,
            conditions,
            enrollment: design.enrollmentInfo?.count,
            studyType: design.studyType,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default ClinicalTrialsConnector;
