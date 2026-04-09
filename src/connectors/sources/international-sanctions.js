import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class InternationalSanctionsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'international_sanctions',
      name: 'International Sanctions',
      description: 'Multi-list sanctions search — OpenSanctions primary with EU consolidated list fallback',
      baseUrl: 'https://api.opensanctions.org',
      domains: ['sanctions', 'compliance', 'geopolitical'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const items = [];
      const limit = options.limit || 10;

      // 1. OpenSanctions comprehensive sanctions search
      const osUrl = `${this.baseUrl}/search/default?q=${encodeURIComponent(query)}&limit=${limit}`;
      const osRes = await this._fetch(osUrl);
      if (osRes.ok) {
        for (const r of (osRes.data?.results || [])) {
          const props = r.properties || {};
          const sanctionLists = (r.datasets || []).filter(d =>
            /sanction|sdn|ofac|eu_|un_sc/i.test(d)
          );
          items.push({
            url: `https://opensanctions.org/entities/${r.id}/`,
            title: r.caption || props.name?.[0] || query,
            summary: [
              r.caption,
              r.schema ? `(${r.schema})` : null,
              sanctionLists.length ? `Sanctions lists: ${sanctionLists.join(', ')}` : null,
              props.country?.length ? `Country: ${props.country.join(', ')}` : null,
            ].filter(Boolean).join(' — '),
            type: EvidenceType.SUPPORTS,
            timestamp: r.first_seen || r.last_seen || null,
            trustWeight: 0.95,
            data: {
              source: 'opensanctions',
              entityId: r.id,
              schema: r.schema,
              allDatasets: r.datasets,
              sanctionLists,
              score: r.score,
              countries: props.country,
              topics: props.topics,
              programs: props.program,
              idNumbers: props.idNumber,
            },
          });
        }
      }

      // 2. EU consolidated sanctions list (fallback / supplement)
      const euUrl = `https://webgate.ec.europa.eu/fsd/fsf/public/consultation/search/json?searchText=${encodeURIComponent(query)}`;
      const euRes = await this._fetch(euUrl);
      if (euRes.ok) {
        const euEntries = Array.isArray(euRes.data) ? euRes.data : (euRes.data?.entries || []);
        for (const e of euEntries.slice(0, 5)) {
          const name = e.nameAlias?.[0]?.wholeName || e.name || query;
          const alreadyFound = items.some(i =>
            i.title.toLowerCase().includes(name.toLowerCase().slice(0, 20))
          );
          if (alreadyFound) continue;
          items.push({
            url: `https://www.sanctionsmap.eu/#/main/details/${e.logicalId || ''}`,
            title: `EU Sanctions: ${name}`,
            summary: [
              `EU consolidated list: ${name}`,
              e.subjectType ? `Type: ${e.subjectType.description || e.subjectType}` : null,
              e.regulation ? `Regulation: ${e.regulation.programme}` : null,
            ].filter(Boolean).join(' — '),
            type: EvidenceType.SUPPORTS,
            timestamp: e.designationDate || null,
            trustWeight: 0.95,
            data: {
              source: 'eu_sanctions',
              logicalId: e.logicalId,
              subjectType: e.subjectType,
              regulation: e.regulation,
              designationDate: e.designationDate,
              remark: e.remark,
            },
          });
        }
      }

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default InternationalSanctionsConnector;
