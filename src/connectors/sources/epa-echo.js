import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class EPAEchoConnector extends BaseConnector {
  constructor() {
    super({
      id: 'epa_echo',
      name: 'EPA ECHO',
      description: 'EPA Enforcement & Compliance History — environmental violations, inspections, penalties, facility profiles',
      baseUrl: 'https://echo.epa.gov',
      domains: ['legal', 'corporate', 'compliance', 'environmental'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = Math.min(options.limit || 10, 25);
      const results = [];

      // Search facilities by name/keyword
      const facUrl = `${this.baseUrl}/echo/facilities?output=JSON&p_fn=${encodeURIComponent(query)}&responseset=${limit}`;
      const facRes = await this._fetch(facUrl);

      if (facRes.ok) {
        const facilities = facRes.data?.Results?.Facilities || [];
        for (const f of facilities) {
          const hasViolation = f.CurrVioFlag === 'Y' || (f.Infea5yrCnt && Number(f.Infea5yrCnt) > 0);
          results.push({
            url: f.RegistryID
              ? `https://echo.epa.gov/detailed-facility-report?fid=${f.RegistryID}`
              : `${this.baseUrl}/echo/facilities`,
            title: `EPA: ${f.FacName || f.FacAddr || 'Unknown facility'}`.slice(0, 200),
            summary: [
              f.FacName && `Facility: ${f.FacName}`,
              f.FacAddr && `Address: ${f.FacAddr}, ${f.FacCity || ''} ${f.FacState || ''}`,
              f.FACSICCodes && `SIC: ${f.FACSICCodes}`,
              f.FACNAICSCodes && `NAICS: ${f.FACNAICSCodes}`,
              f.CurrVioFlag === 'Y' && '⚠ CURRENT VIOLATION',
              f.Infea5yrCnt && `Enforcement actions (5yr): ${f.Infea5yrCnt}`,
              f.InspCnt && `Inspections: ${f.InspCnt}`,
              f.FecPenalties && `Penalties: $${Number(f.FecPenalties).toLocaleString()}`,
              f.CWAPermitStatusDesc && `CWA status: ${f.CWAPermitStatusDesc}`,
              f.RCRAStatus && `RCRA status: ${f.RCRAStatus}`,
              f.AIRStatus && `CAA status: ${f.AIRStatus}`,
            ].filter(Boolean).join('. ').slice(0, 500),
            type: hasViolation ? EvidenceType.SUPPORTING : EvidenceType.NEUTRAL,
            timestamp: f.DateLastInsp || null,
            data: {
              registryId: f.RegistryID,
              facilityName: f.FacName,
              state: f.FacState,
              county: f.FacCounty,
              currentViolation: f.CurrVioFlag === 'Y',
              enforcementCount5yr: f.Infea5yrCnt ? Number(f.Infea5yrCnt) : 0,
              inspectionCount: f.InspCnt ? Number(f.InspCnt) : 0,
              totalPenalties: f.FecPenalties ? Number(f.FecPenalties) : 0,
              programs: {
                cwa: f.CWAPermitStatusDesc,
                rcra: f.RCRAStatus,
                caa: f.AIRStatus,
              },
              sicCodes: f.FACSICCodes,
              naicsCodes: f.FACNAICSCodes,
            },
          });
        }
      }

      // Also search enforcement actions directly
      const enfUrl = `${this.baseUrl}/echo/enforcement_case_search?output=JSON&p_case_name=${encodeURIComponent(query)}&responseset=${Math.min(limit, 10)}`;
      const enfRes = await this._fetch(enfUrl);

      if (enfRes.ok) {
        const cases = enfRes.data?.Results?.EnforcementCases || [];
        for (const c of cases) {
          results.push({
            url: c.CaseNumber
              ? `https://echo.epa.gov/enforcement-compliance-history/civil-cases/${c.CaseNumber}`
              : `${this.baseUrl}/echo/enforcement_case_search`,
            title: `EPA Enforcement: ${c.CaseName || c.Defendant || 'Unknown case'}`.slice(0, 200),
            summary: [
              c.CaseName && `Case: ${c.CaseName}`,
              c.Defendant && `Defendant: ${c.Defendant}`,
              c.ActivityStatusDesc && `Status: ${c.ActivityStatusDesc}`,
              c.PenaltyAmt && `Penalty: $${Number(c.PenaltyAmt).toLocaleString()}`,
              c.EnfOutcomeDesc && `Outcome: ${c.EnfOutcomeDesc}`,
              c.LawViolated && `Law: ${c.LawViolated}`,
              c.FiledDate && `Filed: ${c.FiledDate}`,
            ].filter(Boolean).join('. ').slice(0, 500),
            type: EvidenceType.NEUTRAL,
            timestamp: c.FiledDate || c.SettlementDate || null,
            data: {
              source: 'enforcement_case',
              caseNumber: c.CaseNumber,
              defendant: c.Defendant,
              penalty: c.PenaltyAmt ? Number(c.PenaltyAmt) : null,
              law: c.LawViolated,
              status: c.ActivityStatusDesc,
            },
          });
        }
      }

      return this._toEvidence(results.slice(0, limit * 2), options.claimId);
    } catch {
      return [];
    }
  }
}

export default EPAEchoConnector;
