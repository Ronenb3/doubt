import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

class CMEWarehouseConnector extends BaseConnector {
  constructor() {
    super({
      id: 'cme_warehouse',
      name: 'CME Warehouse',
      description: 'CME Group commodity data via Nasdaq Data Link (Quandl) with CFTC CoT fallback',
      baseUrl: 'https://data.nasdaq.com',
      domains: ['financial', 'commodities'],
      trustTier: SourceTrust.FINANCIAL_DATA,
      rateMs: 1500,
      requiresKey: false,
      keyName: 'NASDAQ_DATA_KEY',
    });
  }

  _apiKey() {
    const config = getConfig();
    return config.keys?.NASDAQ_DATA_KEY || config.keys?.nasdaq_data_key ||
           config.keys?.QUANDL_API_KEY || config.keys?.quandl_api_key || '';
  }

  async search(query, options = {}) {
    try {
      const items = [];
      const key = this._apiKey();

      // 1. Nasdaq Data Link (Quandl) CME dataset search
      const keyParam = key ? `&api_key=${key}` : '';
      const nasdaqUrl = `${this.baseUrl}/api/v3/datasets.json?query=${encodeURIComponent(query)}&database_code=CME&per_page=10${keyParam}`;
      const nasdaqRes = await this._fetch(nasdaqUrl);
      if (nasdaqRes.ok) {
        for (const ds of (nasdaqRes.data?.datasets || [])) {
          items.push({
            url: `https://data.nasdaq.com/data/${ds.database_code}/${ds.dataset_code}`,
            title: `CME: ${ds.name || ds.dataset_code}`,
            summary: [
              ds.name,
              ds.frequency ? `Frequency: ${ds.frequency}` : null,
              ds.newest_available_date ? `Latest: ${ds.newest_available_date}` : null,
              ds.description ? ds.description.slice(0, 150) : null,
            ].filter(Boolean).join(' — '),
            type: EvidenceType.NEUTRAL,
            timestamp: ds.newest_available_date || ds.refreshed_at || null,
            data: {
              source: 'nasdaq_data_link',
              datasetCode: ds.dataset_code,
              databaseCode: ds.database_code,
              frequency: ds.frequency,
              columnNames: ds.column_names,
              oldestDate: ds.oldest_available_date,
              newestDate: ds.newest_available_date,
            },
          });
        }
      }

      // 2. CFTC Commitments of Traders (via Quandl CFTC database) as proxy
      if (items.length < 3) {
        const cftcUrl = `${this.baseUrl}/api/v3/datasets.json?query=${encodeURIComponent(query)}&database_code=CFTC&per_page=5${keyParam}`;
        const cftcRes = await this._fetch(cftcUrl);
        if (cftcRes.ok) {
          for (const ds of (cftcRes.data?.datasets || [])) {
            items.push({
              url: `https://data.nasdaq.com/data/CFTC/${ds.dataset_code}`,
              title: `CFTC CoT: ${ds.name || ds.dataset_code}`,
              summary: [
                `CFTC Commitments of Traders: ${ds.name || ds.dataset_code}`,
                ds.frequency ? `Frequency: ${ds.frequency}` : null,
                ds.newest_available_date ? `Latest: ${ds.newest_available_date}` : null,
              ].filter(Boolean).join(' — '),
              type: EvidenceType.CONTEXTUAL,
              timestamp: ds.newest_available_date || ds.refreshed_at || null,
              data: {
                source: 'cftc_cot',
                datasetCode: ds.dataset_code,
                databaseCode: 'CFTC',
                frequency: ds.frequency,
                newestDate: ds.newest_available_date,
              },
            });
          }
        }
      }

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default CMEWarehouseConnector;
