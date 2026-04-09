import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class SupplyChainConnector extends BaseConnector {
  constructor() {
    super({
      id: 'supply_chain',
      name: 'Supply Chain',
      description: 'Supply chain intelligence — ImportYeti with Comtrade fallback',
      baseUrl: 'https://api.importyeti.com',
      domains: ['corporate', 'trade'],
      trustTier: 0.75,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const items = await this._tryImportYeti(query, options);
      if (items.length > 0) return this._toEvidence(items, options.claimId);

      const fallback = await this._tryComtrade(query, options);
      return this._toEvidence(fallback, options.claimId);
    } catch {
      return [];
    }
  }

  async _tryImportYeti(query, options) {
    const url = `${this.baseUrl}/search?q=${encodeURIComponent(query)}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const results = res.data?.results || res.data?.companies || [];
    if (!Array.isArray(results)) return [];

    return results.slice(0, options.limit || 10).map(r => ({
      url: r.url || `https://www.importyeti.com/company/${encodeURIComponent(r.name || query)}`,
      title: r.name || r.company || query,
      summary: `${r.name || r.company || query} — ${r.shipment_count || '?'} shipments, ${r.country || 'unknown origin'}`,
      type: EvidenceType.NEUTRAL,
      timestamp: r.last_shipment_date || null,
      data: {
        company: r.name || r.company,
        shipmentCount: r.shipment_count,
        country: r.country,
        suppliers: r.suppliers || [],
      },
    }));
  }

  async _tryComtrade(query, options) {
    const url = `https://comtradeapi.un.org/public/v1/preview/C/A/HS?cmdCode=${encodeURIComponent(query)}&period=2023`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const records = Array.isArray(res.data?.data) ? res.data.data : [];
    return records.slice(0, options.limit || 10).map(r => ({
      url: `https://comtradeplus.un.org/TradeFlow?CommodityCodes=${r.cmdCode || query}`,
      title: `${r.reporterDesc || '?'} → ${r.partnerDesc || 'World'}: ${r.cmdDescE || query}`,
      summary: `Trade: $${(r.primaryValue || 0).toLocaleString()} of ${r.cmdDescE || query} (${r.period || '2023'})`,
      type: EvidenceType.NEUTRAL,
      timestamp: r.period ? `${r.period}-01-01` : null,
      data: {
        reporter: r.reporterDesc,
        partner: r.partnerDesc,
        commodity: r.cmdDescE,
        value: r.primaryValue,
      },
    }));
  }
}

export default SupplyChainConnector;
