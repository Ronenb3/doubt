import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class DOLEnforcementConnector extends BaseConnector {
  constructor() {
    super({
      id: 'dol_enforcement',
      name: 'DOL Enforcement',
      description: 'Department of Labor enforcement — OSHA citations, wage theft, mine safety, workplace fatalities, child labor violations',
      baseUrl: 'https://enforcedata.dol.gov',
      domains: ['legal', 'corporate', 'compliance', 'labor'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = Math.min(options.limit || 10, 25);
      const results = [];

      // OSHA inspections
      const oshaUrl = `${this.baseUrl}/api/v2/osha_inspection?filters={"estab_name":"${query.replace(/"/g, '')}"}&limit=${limit}&columns=activity_nr,estab_name,site_address,site_city,site_state,open_date,close_case_date,osha_accident_indicator,nr_in_state_flag,total_current_penalty,total_initial_penalty,violation_type_s`;
      const oshaRes = await this._fetch(oshaUrl);

      if (oshaRes.ok && oshaRes.data?.results) {
        for (const r of oshaRes.data.results) {
          const isSerious = r.total_current_penalty > 10000 || r.osha_accident_indicator === 'X';
          results.push({
            url: r.activity_nr
              ? `https://www.osha.gov/ords/imis/establishment.inspection_detail?id=${r.activity_nr}`
              : 'https://www.osha.gov/ords/imis/establishment.html',
            title: `OSHA: ${r.estab_name || 'Unknown establishment'}`.slice(0, 200),
            summary: [
              r.estab_name && `Establishment: ${r.estab_name}`,
              r.site_address && `Location: ${r.site_address}, ${r.site_city || ''} ${r.site_state || ''}`,
              r.open_date && `Inspection date: ${r.open_date}`,
              r.osha_accident_indicator === 'X' && '⚠ ACCIDENT/FATALITY',
              r.total_current_penalty && `Penalty: $${Number(r.total_current_penalty).toLocaleString()}`,
              r.violation_type_s && `Violations: ${r.violation_type_s}`,
            ].filter(Boolean).join('. ').slice(0, 500),
            type: isSerious ? EvidenceType.SUPPORTING : EvidenceType.NEUTRAL,
            timestamp: r.open_date || null,
            data: {
              source: 'osha_inspection',
              activityNr: r.activity_nr,
              establishment: r.estab_name,
              state: r.site_state,
              accidentIndicator: r.osha_accident_indicator === 'X',
              currentPenalty: r.total_current_penalty,
              initialPenalty: r.total_initial_penalty,
              violationTypes: r.violation_type_s,
            },
          });
        }
      }

      // Wage and Hour (WHD) — wage theft, FLSA violations
      const whdUrl = `${this.baseUrl}/api/v2/whd_whisard?filters={"trade_nm":"${query.replace(/"/g, '')}"}&limit=${limit}&columns=case_id,trade_nm,street_addr_1_txt,cty_nm,st_cd,findings_start_date,findings_end_date,bw_atp_amt,ee_atp_cnt,flsa_cmp_assd_amt,flsa_repeat_violator`;
      const whdRes = await this._fetch(whdUrl);

      if (whdRes.ok && whdRes.data?.results) {
        for (const r of whdRes.data.results) {
          results.push({
            url: `https://enforcedata.dol.gov/views/data_summary.php`,
            title: `DOL Wage & Hour: ${r.trade_nm || 'Unknown employer'}`.slice(0, 200),
            summary: [
              r.trade_nm && `Employer: ${r.trade_nm}`,
              r.street_addr_1_txt && `Location: ${r.street_addr_1_txt}, ${r.cty_nm || ''} ${r.st_cd || ''}`,
              r.bw_atp_amt && `Back wages: $${Number(r.bw_atp_amt).toLocaleString()}`,
              r.ee_atp_cnt && `Employees affected: ${r.ee_atp_cnt}`,
              r.flsa_cmp_assd_amt && `FLSA penalties: $${Number(r.flsa_cmp_assd_amt).toLocaleString()}`,
              r.flsa_repeat_violator === 'Y' && '⚠ REPEAT VIOLATOR',
              r.findings_start_date && `Period: ${r.findings_start_date} – ${r.findings_end_date || 'ongoing'}`,
            ].filter(Boolean).join('. ').slice(0, 500),
            type: EvidenceType.NEUTRAL,
            timestamp: r.findings_start_date || null,
            data: {
              source: 'whd_whisard',
              caseId: r.case_id,
              employer: r.trade_nm,
              state: r.st_cd,
              backWages: r.bw_atp_amt ? Number(r.bw_atp_amt) : null,
              employeesAffected: r.ee_atp_cnt ? Number(r.ee_atp_cnt) : null,
              flsaPenalties: r.flsa_cmp_assd_amt ? Number(r.flsa_cmp_assd_amt) : null,
              repeatViolator: r.flsa_repeat_violator === 'Y',
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

export default DOLEnforcementConnector;
