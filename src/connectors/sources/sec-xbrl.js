import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class SECXBRLConnector extends BaseConnector {
  constructor() {
    super({
      id: 'sec_xbrl',
      name: 'SEC XBRL',
      description: 'SEC XBRL company financial facts — structured financial data from EDGAR filings',
      baseUrl: 'https://data.sec.gov',
      domains: ['financial'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const cik = options.cik || await this._resolveCIK(query);
      if (!cik) return [];

      const padded = String(cik).padStart(10, '0');
      const url = `${this.baseUrl}/api/xbrl/companyfacts/CIK${padded}.json`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const facts = res.data?.facts || {};
      const items = [];

      for (const [taxonomy, concepts] of Object.entries(facts)) {
        for (const [concept, details] of Object.entries(concepts)) {
          const units = details.units || {};
          for (const [unit, entries] of Object.entries(units)) {
            const recent = entries.slice(-3);
            for (const entry of recent) {
              items.push({
                url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padded}`,
                title: `${res.data?.entityName || query} — ${concept}`,
                summary: `${concept}: ${entry.val} ${unit} (filed ${entry.filed || 'unknown'})`,
                type: EvidenceType.NEUTRAL,
                timestamp: entry.filed || entry.end || null,
                data: {
                  taxonomy,
                  concept,
                  unit,
                  value: entry.val,
                  period: entry.end,
                  filed: entry.filed,
                  form: entry.form,
                  entityName: res.data?.entityName,
                  cik: padded,
                },
              });
            }
          }
          if (items.length >= (options.limit || 20)) break;
        }
        if (items.length >= (options.limit || 20)) break;
      }

      return this._toEvidence(items.slice(0, options.limit || 20), options.claimId);
    } catch {
      return [];
    }
  }

  async _resolveCIK(query) {
    try {
      const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(query)}`;
      const res = await this._fetch(url);
      if (!res.ok) return null;
      const hit = res.data?.hits?.hits?.[0];
      return hit?._source?.entity_id || null;
    } catch {
      return null;
    }
  }
}

export default SECXBRLConnector;
