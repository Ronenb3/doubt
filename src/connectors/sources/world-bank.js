import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class WorldBankConnector extends BaseConnector {
  constructor() {
    super({
      id: 'world_bank',
      name: 'World Bank Projects',
      description: 'World Bank project database — development projects, financing, and country operations',
      baseUrl: 'https://search.worldbank.org',
      domains: ['general', 'financial'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const rows = options.limit || 10;
      const url = `${this.baseUrl}/api/v2/projects?format=json&qterm=${encodeURIComponent(query)}&rows=${rows}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const projects = res.data?.projects || {};
      const projectList = Object.values(projects).filter(p => typeof p === 'object' && p.id);
      const items = projectList.map(p => ({
        url: p.project_url || `https://projects.worldbank.org/en/projects-operations/project-detail/${p.id}`,
        title: p.project_name || p.projectdesc || p.id,
        summary: [
          p.project_name,
          p.countryname ? `Country: ${p.countryname}` : null,
          p.totalamt ? `Amount: $${p.totalamt}` : null,
          p.status ? `Status: ${p.status}` : null,
        ].filter(Boolean).join(' — '),
        type: EvidenceType.NEUTRAL,
        timestamp: p.boardapprovaldate || p.closingdate || null,
        data: {
          projectId: p.id,
          name: p.project_name,
          country: p.countryname,
          countryCode: p.countryshortname,
          totalAmount: p.totalamt,
          status: p.status,
          sector: p.sector,
          theme: p.theme1,
          boardApprovalDate: p.boardapprovaldate,
          closingDate: p.closingdate,
          lendProjectCost: p.lendprojectcost,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default WorldBankConnector;
