import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class CensusTrade extends BaseConnector {
  constructor() {
    super({
      id: 'census_trade',
      name: 'US Census Trade',
      description: 'US Census Bureau International Trade — import/export flows by HS code, country, value. Sanctions evasion detection.',
      baseUrl: 'https://api.census.gov',
      domains: ['financial', 'geopolitical', 'compliance', 'trade'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 2000,
    });
    this._apiKey = process.env.CENSUS_API_KEY || null;
  }

  async search(query, options = {}) {
    try {
      const results = [];
      const country = this._extractCountry(query);

      if (country) {
        // Search exports by country
        const keyParam = this._apiKey ? `&key=${this._apiKey}` : '';
        const expUrl = `${this.baseUrl}/data/timeseries/intltrade/exports/hs?get=CTY_CODE,CTY_NAME,ALL_VAL_MO,ALL_VAL_YR,COMM_LVL,I_COMMODITY,I_COMMODITY_LDESC&CTY_NAME=${encodeURIComponent(country)}&time=2024${keyParam}`;

        const expRes = await this._fetch(expUrl);
        if (expRes.ok && Array.isArray(expRes.data) && expRes.data.length > 1) {
          const headers = expRes.data[0];
          const rows = expRes.data.slice(1, 11); // top 10

          for (const row of rows) {
            const entry = {};
            headers.forEach((h, i) => { entry[h] = row[i]; });

            const monthVal = entry.ALL_VAL_MO ? Number(entry.ALL_VAL_MO) : 0;
            const yearVal = entry.ALL_VAL_YR ? Number(entry.ALL_VAL_YR) : 0;
            if (monthVal === 0 && yearVal === 0) continue;

            results.push({
              url: `https://usatrade.census.gov/`,
              title: `US Exports to ${entry.CTY_NAME || country}: ${entry.I_COMMODITY_LDESC || entry.I_COMMODITY || 'Total'}`.slice(0, 200),
              summary: [
                `Country: ${entry.CTY_NAME || country}`,
                entry.I_COMMODITY_LDESC && `Commodity: ${entry.I_COMMODITY_LDESC}`,
                monthVal && `Monthly value: $${monthVal.toLocaleString()}`,
                yearVal && `Annual value: $${yearVal.toLocaleString()}`,
                entry.COMM_LVL && `Level: ${entry.COMM_LVL}`,
                entry.time && `Period: ${entry.time}`,
              ].filter(Boolean).join('. ').slice(0, 500),
              type: EvidenceType.NEUTRAL,
              timestamp: entry.time ? `${entry.time}-01` : null,
              data: {
                source: 'us_exports',
                countryCode: entry.CTY_CODE,
                countryName: entry.CTY_NAME,
                commodity: entry.I_COMMODITY,
                commodityDesc: entry.I_COMMODITY_LDESC,
                monthlyValue: monthVal,
                annualValue: yearVal,
                period: entry.time,
              },
            });
          }
        }

        // Search imports from country
        const impUrl = `${this.baseUrl}/data/timeseries/intltrade/imports/hs?get=CTY_CODE,CTY_NAME,GEN_VAL_MO,GEN_VAL_YR,COMM_LVL,I_COMMODITY,I_COMMODITY_LDESC&CTY_NAME=${encodeURIComponent(country)}&time=2024${keyParam}`;

        const impRes = await this._fetch(impUrl);
        if (impRes.ok && Array.isArray(impRes.data) && impRes.data.length > 1) {
          const headers = impRes.data[0];
          const rows = impRes.data.slice(1, 11);

          for (const row of rows) {
            const entry = {};
            headers.forEach((h, i) => { entry[h] = row[i]; });

            const monthVal = entry.GEN_VAL_MO ? Number(entry.GEN_VAL_MO) : 0;
            const yearVal = entry.GEN_VAL_YR ? Number(entry.GEN_VAL_YR) : 0;
            if (monthVal === 0 && yearVal === 0) continue;

            results.push({
              url: `https://usatrade.census.gov/`,
              title: `US Imports from ${entry.CTY_NAME || country}: ${entry.I_COMMODITY_LDESC || entry.I_COMMODITY || 'Total'}`.slice(0, 200),
              summary: [
                `Country: ${entry.CTY_NAME || country}`,
                entry.I_COMMODITY_LDESC && `Commodity: ${entry.I_COMMODITY_LDESC}`,
                monthVal && `Monthly value: $${monthVal.toLocaleString()}`,
                yearVal && `Annual value: $${yearVal.toLocaleString()}`,
                entry.time && `Period: ${entry.time}`,
              ].filter(Boolean).join('. ').slice(0, 500),
              type: EvidenceType.NEUTRAL,
              timestamp: entry.time ? `${entry.time}-01` : null,
              data: {
                source: 'us_imports',
                countryCode: entry.CTY_CODE,
                countryName: entry.CTY_NAME,
                commodity: entry.I_COMMODITY,
                commodityDesc: entry.I_COMMODITY_LDESC,
                monthlyValue: monthVal,
                annualValue: yearVal,
                period: entry.time,
              },
            });
          }
        }
      }

      // Fallback — if no country detected, still search as general term
      if (results.length === 0) {
        const genUrl = `${this.baseUrl}/data/timeseries/intltrade/exports/hs?get=CTY_NAME,ALL_VAL_YR,I_COMMODITY_LDESC&I_COMMODITY_LDESC=${encodeURIComponent(query)}&time=2024${this._apiKey ? `&key=${this._apiKey}` : ''}`;
        const genRes = await this._fetch(genUrl);

        if (genRes.ok && Array.isArray(genRes.data) && genRes.data.length > 1) {
          const headers = genRes.data[0];
          for (const row of genRes.data.slice(1, 11)) {
            const entry = {};
            headers.forEach((h, i) => { entry[h] = row[i]; });

            results.push({
              url: 'https://usatrade.census.gov/',
              title: `US Trade: ${entry.I_COMMODITY_LDESC || query} → ${entry.CTY_NAME || 'Various'}`.slice(0, 200),
              summary: `${entry.I_COMMODITY_LDESC || query} exports to ${entry.CTY_NAME || 'various'}. Annual value: $${Number(entry.ALL_VAL_YR || 0).toLocaleString()}`.slice(0, 500),
              type: EvidenceType.NEUTRAL,
              timestamp: '2024-01-01',
              data: {
                source: 'us_exports_commodity',
                country: entry.CTY_NAME,
                commodity: entry.I_COMMODITY_LDESC,
                annualValue: Number(entry.ALL_VAL_YR || 0),
              },
            });
          }
        }
      }

      return this._toEvidence(results.slice(0, 20), options.claimId);
    } catch {
      return [];
    }
  }

  _extractCountry(query) {
    const countries = [
      'China', 'Russia', 'Iran', 'North Korea', 'Saudi Arabia', 'Israel', 'India',
      'Pakistan', 'Turkey', 'Brazil', 'Mexico', 'Japan', 'Germany', 'France',
      'United Kingdom', 'Canada', 'Australia', 'South Korea', 'Indonesia',
      'Nigeria', 'Egypt', 'South Africa', 'Venezuela', 'Cuba', 'Syria',
      'Ukraine', 'Taiwan', 'Vietnam', 'Thailand', 'Philippines', 'Colombia',
      'Argentina', 'Chile', 'Peru', 'Ethiopia', 'Kenya', 'Tanzania', 'Ghana',
      'Iraq', 'Afghanistan', 'Yemen', 'Libya', 'Myanmar', 'Bangladesh',
      'Sri Lanka', 'Nepal', 'Singapore', 'Malaysia', 'UAE', 'Qatar', 'Kuwait',
      'Bahrain', 'Oman', 'Jordan', 'Lebanon', 'Morocco', 'Algeria', 'Tunisia',
    ];
    const lower = query.toLowerCase();
    return countries.find(c => lower.includes(c.toLowerCase())) || null;
  }
}

export default CensusTrade;
