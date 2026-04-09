// EBS Entity Background System bridge connector
// Submits evidence requirements to EBS orchestrator (localhost:3002)
// Trust tier: FINANCIAL_DATA (0.85) — aggregated multi-source OSINT
// Only useful when EBS server is running with PostgreSQL
// Falls back gracefully when EBS is offline (most of its sources are already
// covered by doubt's own connectors individually)

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class EBSBridgeConnector extends BaseConnector {
  constructor() {
    super({
      id: 'ebs_bridge',
      name: 'EBS Entity Background System',
      description: 'Orchestrated evidence gathering across 50 deep sources — corporate, sanctions, financial',
      baseUrl: 'http://127.0.0.1:3002',
      domains: ['financial', 'corporate', 'compliance', 'legal', 'sanctions'],
      trustTier: SourceTrust.FINANCIAL_DATA,
      rateMs: 2000, // EBS orchestrator can be heavy
    });
  }

  async search(query, options = {}) {
    try {
      // Check if EBS is even running before making the heavier call
      const healthCheck = await this._fetch(`${this.baseUrl}/api/v1/health`);
      if (!healthCheck.ok) return [];

      // Submit an evidence search to the EBS API
      const res = await this._fetch(`${this.baseUrl}/api/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          limit: options.limit || 10,
        }),
      });

      if (!res.ok) {
        // Try the entity lookup endpoint as fallback
        const entityRes = await this._fetch(
          `${this.baseUrl}/api/v1/entities?q=${encodeURIComponent(query)}&limit=${options.limit || 10}`
        );
        if (!entityRes.ok) return [];
        return this._mapResults(entityRes.data, query, options.claimId);
      }

      return this._mapResults(res.data, query, options.claimId);
    } catch (err) {
      // EBS requires PostgreSQL + server — often not running
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        return [];
      }
      return [];
    }
  }

  _mapResults(data, query, claimId) {
    const results = Array.isArray(data) ? data : (data?.results || data?.entities || []);
    if (!Array.isArray(results) || results.length === 0) return [];

    const items = results.map(r => ({
      url: r.source_url || r.url || `ebs://entity/${encodeURIComponent(r.name || query)}`,
      title: r.name || r.title || `EBS: ${query}`,
      summary: r.summary || r.description || r.evidence_text || '',
      type: EvidenceType.CONTEXTUAL,
      timestamp: r.created_at || r.timestamp || null,
      data: {
        entity_id: r.id || r.entity_id,
        entity_type: r.type || r.entity_type,
        source_connector: r.source || r.connector_id,
        confidence: r.confidence,
        source_system: 'ebs',
      },
    }));

    return this._toEvidence(items, claimId);
  }
}

export default EBSBridgeConnector;
