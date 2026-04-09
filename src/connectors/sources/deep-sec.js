import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class DeepSECConnector extends BaseConnector {
  constructor() {
    super({
      id: 'deep_sec',
      name: 'Deep SEC',
      description: 'Deep SEC analysis — EDGAR full-text search combined with XBRL facts and insider transactions',
      baseUrl: 'https://efts.sec.gov',
      domains: ['financial', 'corporate'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1200,
    });
  }

  async search(query, options = {}) {
    try {
      const items = [];

      // 1. EDGAR full-text search (expanded date range)
      const startDate = options.startDate || '2020-01-01';
      const params = new URLSearchParams({
        q: query,
        dateRange: 'custom',
        startdt: startDate,
      });
      if (options.formType) params.set('forms', options.formType);

      const edgarUrl = `${this.baseUrl}/LATEST/search-index?${params}`;
      const edgarRes = await this._fetch(edgarUrl);
      if (edgarRes.ok) {
        for (const hit of (edgarRes.data?.hits?.hits || []).slice(0, 10)) {
          const src = hit._source || {};
          items.push({
            url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${src.entity_id || ''}&type=${src.form_type || ''}&dateb=&owner=include&count=10`,
            title: `${src.entity_name || 'Unknown'} — ${src.form_type || 'Filing'} (${src.file_date || ''})`,
            summary: `${src.form_type || 'Filing'} by ${src.entity_name || 'Unknown'} filed ${src.file_date || 'unknown date'}`,
            type: EvidenceType.NEUTRAL,
            timestamp: src.file_date || null,
            trustWeight: 0.95,
            data: {
              source: 'edgar_fulltext',
              formType: src.form_type,
              entityName: src.entity_name,
              entityId: src.entity_id,
              fileDate: src.file_date,
              score: hit._score,
            },
          });
        }
      }

      // 2. XBRL company facts (requires a CIK — extract from EDGAR results)
      const ciks = new Set();
      for (const item of items) {
        if (item.data?.entityId) ciks.add(item.data.entityId);
      }

      for (const cik of [...ciks].slice(0, 3)) {
        const paddedCik = String(cik).padStart(10, '0');
        const xbrlUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`;
        const xbrlRes = await this._fetch(xbrlUrl, {
          headers: { 'Accept': 'application/json' },
        });
        if (xbrlRes.ok && xbrlRes.data) {
          const entityName = xbrlRes.data.entityName || cik;
          const facts = xbrlRes.data.facts?.['us-gaap'] || {};

          const keyMetrics = ['Revenue', 'NetIncomeLoss', 'Assets', 'Liabilities',
            'StockholdersEquity', 'EarningsPerShareBasic'];
          const foundMetrics = {};

          for (const metric of keyMetrics) {
            if (facts[metric]?.units) {
              const usdValues = facts[metric].units.USD || facts[metric].units['USD/shares'] || [];
              const latest = usdValues[usdValues.length - 1];
              if (latest) {
                foundMetrics[metric] = { val: latest.val, filed: latest.filed, form: latest.form };
              }
            }
          }

          if (Object.keys(foundMetrics).length > 0) {
            const metricSummary = Object.entries(foundMetrics)
              .map(([k, v]) => `${k}: ${typeof v.val === 'number' ? v.val.toLocaleString() : v.val}`)
              .join(', ');
            items.push({
              url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=10`,
              title: `XBRL Facts: ${entityName}`,
              summary: `Key financials for ${entityName}: ${metricSummary}`,
              type: EvidenceType.CONTEXTUAL,
              timestamp: Object.values(foundMetrics)[0]?.filed || null,
              trustWeight: 0.95,
              data: {
                source: 'xbrl_facts',
                cik,
                entityName,
                metrics: foundMetrics,
              },
            });
          }
        }
      }

      // 3. Insider transactions (Form 4 filings)
      const insiderUrl = `${this.baseUrl}/LATEST/search-index?q=${encodeURIComponent(query)}&forms=4&dateRange=custom&startdt=${startDate}`;
      const insiderRes = await this._fetch(insiderUrl);
      if (insiderRes.ok) {
        for (const hit of (insiderRes.data?.hits?.hits || []).slice(0, 5)) {
          const src = hit._source || {};
          const alreadyFound = items.some(i =>
            i.data?.source === 'edgar_fulltext' &&
            i.data?.entityId === src.entity_id &&
            i.data?.formType === '4'
          );
          if (alreadyFound) continue;
          items.push({
            url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${src.entity_id || ''}&type=4&dateb=&owner=include&count=10`,
            title: `Insider Filing: ${src.entity_name || 'Unknown'} — Form 4 (${src.file_date || ''})`,
            summary: `Insider transaction (Form 4) by ${src.entity_name || 'Unknown'} filed ${src.file_date || 'unknown date'}`,
            type: EvidenceType.CONTEXTUAL,
            timestamp: src.file_date || null,
            trustWeight: 0.90,
            data: {
              source: 'insider_form4',
              formType: '4',
              entityName: src.entity_name,
              entityId: src.entity_id,
              fileDate: src.file_date,
              score: hit._score,
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

export default DeepSECConnector;
