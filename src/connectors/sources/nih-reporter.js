import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class NIHReporterConnector extends BaseConnector {
  constructor() {
    super({
      id: 'nih_reporter',
      name: 'NIH Reporter',
      description: 'NIH research grants — PIs, institutions, funding amounts, abstracts. Maps the US biomedical research funding graph.',
      baseUrl: 'https://api.reporter.nih.gov',
      domains: ['health', 'academic', 'financial', 'science'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = Math.min(options.limit || 10, 25);

      const body = {
        criteria: {
          advanced_text_search: {
            operator: 'and',
            search_field: 'projecttitle,terms',
            search_text: query,
          },
        },
        offset: 0,
        limit,
        sort_field: 'project_start_date',
        sort_order: 'desc',
      };

      const res = await this._fetch(`${this.baseUrl}/v2/projects/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) return [];
      const projects = res.data?.results || [];

      const items = projects.map(p => {
        const pi = p.contact_pi_name || p.principal_investigators?.[0]?.full_name || 'Unknown PI';
        const org = p.organization?.org_name || 'Unknown org';
        const cost = p.award_amount ? `$${(p.award_amount).toLocaleString()}` : null;

        return {
          url: p.project_num
            ? `https://reporter.nih.gov/search/results?query=${encodeURIComponent(p.project_num)}`
            : `https://reporter.nih.gov`,
          title: `NIH Grant: ${(p.project_title || 'Untitled').slice(0, 150)}`,
          summary: [
            p.project_title,
            `PI: ${pi}`,
            `Org: ${org}`,
            cost && `Award: ${cost}`,
            p.project_num && `Grant #: ${p.project_num}`,
            p.funding_mechanism && `Type: ${p.funding_mechanism}`,
            p.agency_ic_fundings?.length && `IC: ${p.agency_ic_fundings.map(f => f.abbreviation).join(', ')}`,
            p.abstract_text && p.abstract_text.slice(0, 200),
          ].filter(Boolean).join('. ').slice(0, 500),
          type: EvidenceType.NEUTRAL,
          timestamp: p.project_start_date || p.award_notice_date || null,
          data: {
            projectNum: p.project_num,
            piName: pi,
            organization: org,
            awardAmount: p.award_amount,
            fiscalYear: p.fiscal_year,
            mechanism: p.funding_mechanism,
            icFundings: p.agency_ic_fundings?.map(f => ({
              code: f.abbreviation,
              name: f.name,
              amount: f.total_cost,
            })),
            startDate: p.project_start_date,
            endDate: p.project_end_date,
            isActive: p.is_active,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default NIHReporterConnector;
