import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class NSFAwardsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'nsf_awards',
      name: 'NSF Awards',
      description: 'National Science Foundation funded research — awards, PIs, institutions, abstracts',
      baseUrl: 'https://api.nsf.gov',
      domains: ['academic', 'science', 'technology', 'financial'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = Math.min(options.limit || 10, 25);
      const url = `${this.baseUrl}/services/v1/awards.json?keyword=${encodeURIComponent(query)}&printFields=id,title,abstractText,piFirstName,piLastName,piEmail,awardee,fundProgramName,awardeeName,startDate,expDate,estimatedTotalAmt,fundsObligatedAmt,agency&rpp=${limit}`;

      const res = await this._fetch(url);
      if (!res.ok) return [];

      const awards = res.data?.response?.award || [];
      const items = awards.map(a => {
        const pi = [a.piFirstName, a.piLastName].filter(Boolean).join(' ') || 'Unknown PI';
        const cost = a.estimatedTotalAmt ? `$${Number(a.estimatedTotalAmt).toLocaleString()}` : null;

        return {
          url: a.id ? `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${a.id}` : 'https://www.nsf.gov/awardsearch/',
          title: `NSF Award: ${(a.title || 'Untitled').slice(0, 150)}`,
          summary: [
            a.title,
            `PI: ${pi}`,
            a.awardeeName && `Institution: ${a.awardeeName}`,
            cost && `Amount: ${cost}`,
            a.fundProgramName && `Program: ${a.fundProgramName}`,
            a.startDate && `Start: ${a.startDate}`,
            a.abstractText && a.abstractText.slice(0, 200),
          ].filter(Boolean).join('. ').slice(0, 500),
          type: EvidenceType.NEUTRAL,
          timestamp: a.startDate ? this._parseNSFDate(a.startDate) : null,
          data: {
            awardId: a.id,
            piName: pi,
            piEmail: a.piEmail,
            institution: a.awardeeName,
            estimatedTotal: a.estimatedTotalAmt ? Number(a.estimatedTotalAmt) : null,
            fundsObligated: a.fundsObligatedAmt ? Number(a.fundsObligatedAmt) : null,
            program: a.fundProgramName,
            agency: a.agency,
            startDate: a.startDate,
            endDate: a.expDate,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _parseNSFDate(dateStr) {
    // NSF dates are MM/DD/YYYY
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  }
}

export default NSFAwardsConnector;
