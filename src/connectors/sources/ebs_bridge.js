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
      description: 'EBS graph intelligence + OSINT bridge for corporate, person, compliance, and monitoring context',
      baseUrl: 'http://127.0.0.1:3002',
      domains: ['financial', 'corporate', 'compliance', 'legal', 'sanctions'],
      trustTier: SourceTrust.FINANCIAL_DATA,
      rateMs: 2000, // EBS orchestrator can be heavy
    });
  }

  async search(query, options = {}) {
    try {
      const healthy = await this._isHealthy();
      if (!healthy) return [];

      const limit = options.limit || 10;

      // 1. Fast graph search path
      const graphSearch = await this._fetch(
        `${this.baseUrl}/api/v1/graph-intel/search?q=${encodeURIComponent(query)}&limit=${limit}`
      );
      if (graphSearch.ok) {
        const mapped = this._mapResults(graphSearch.data, query, options.claimId, 'graph_search');
        if (mapped.length > 0) return mapped;
      }

      // 2. Entity-focused investigation path
      const investigation = await this._runInvestigation(query, options);
      if (investigation?.ok) {
        const mapped = this._mapResults(investigation.data, query, options.claimId, investigation.meta?.endpoint);
        if (mapped.length > 0) return mapped;
      }

      // 3. Ecosystem metadata can still provide contextual signal even when graph intel is sparse
      const ecosystem = await this._fetch(
        `${this.baseUrl}/api/v1/ecosystem/compose`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'entity_resolve',
            goals: [`Investigate ${query}`],
            payload: {
              record_type: this._inferEntityType(query) === 'person' ? 'person' : 'organization',
              records: [{ name: query }],
            },
          }),
        }
      );
      if (ecosystem.ok) {
        return this._mapResults(ecosystem.data, query, options.claimId, 'ecosystem_compose');
      }

      return [];
    } catch (err) {
      // EBS requires PostgreSQL + server — often not running
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        return [];
      }
      return [];
    }
  }

  async _isHealthy() {
    const checks = [
      `${this.baseUrl}/health`,
      `${this.baseUrl}/api/v1/graph-intel/health`,
    ];

    for (const url of checks) {
      const res = await this._fetch(url);
      if (res.ok) return true;
    }
    return false;
  }

  async _runInvestigation(query, options = {}) {
    const inferred = this._inferEntityType(query);
    if (inferred === 'person') {
      return {
        ...(await this._fetch(`${this.baseUrl}/api/v1/graph-intel/investigate/person`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: query, context: options.context || {} }),
        })),
        meta: { endpoint: 'graph_person_investigate' },
      };
    }

    if (inferred === 'organization') {
      return {
        ...(await this._fetch(`${this.baseUrl}/api/v1/graph-intel/investigate/corporate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: query }),
        })),
        meta: { endpoint: 'graph_corporate_investigate' },
      };
    }

    return { ok: false, meta: { endpoint: 'none' } };
  }

  _inferEntityType(query) {
    const q = `${query}`.trim();
    if (!q) return 'organization';
    if (q.includes('.') && !q.includes(' ')) return 'domain';

    const tokens = q.split(/\s+/).filter(Boolean);
    const normalizedTokens = tokens.map(token => token.replace(/[.,]/g, '').toLowerCase());
    const orgMarkers = new Set([
      'ai', 'associates', 'bank', 'capital', 'corp', 'corporation', 'group',
      'holdings', 'inc', 'institute', 'labs', 'llc', 'ltd', 'partners',
      'systems', 'technologies', 'technology', 'university', 'ventures',
    ]);

    if (normalizedTokens.some(token => orgMarkers.has(token))) {
      return 'organization';
    }

    const looksLikePerson = tokens.length >= 2 && tokens.length <= 3
      && tokens.every(token => /^[A-Z][a-z'’-]+$/.test(token));

    if (looksLikePerson) return 'person';
    return 'organization';
  }

  _mapResults(data, query, claimId, endpoint = 'ebs') {
    const results = this._extractRecords(data);
    if (!Array.isArray(results) || results.length === 0) return [];

    const items = results.map(r => ({
      url: r.source_url || r.url || r.metadata?.source_url || `ebs://${endpoint}/${encodeURIComponent(r.name || query)}`,
      title: r.name || r.title || r._type || `EBS: ${query}`,
      summary: this._summarizeRecord(r, query),
      type: EvidenceType.CONTEXTUAL,
      timestamp: r.created_at || r.timestamp || r.retrieved_at || null,
      data: {
        entity_id: r.id || r.entity_id,
        entity_type: r.type || r.entity_type || r._type,
        source_connector: r.source || r.connector_id || endpoint,
        confidence: r.confidence || r.metadata?.confidence,
        source_system: 'ebs',
        raw: r,
      },
    }));

    return this._toEvidence(items, claimId);
  }

  _extractRecords(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.entities)) return data.entities;

    if (data.status === 'failed' && !data.results && !data.entities) {
      return [];
    }

    const nestedArrays = Object.values(data).filter(value =>
      Array.isArray(value) && value.some(item => item && typeof item === 'object')
    );
    if (nestedArrays.length > 0) {
      return nestedArrays.flat();
    }

    if (data.composition?.artifacts?.cross_system_previews?.ebs) {
      return [data.composition.artifacts.cross_system_previews.ebs];
    }

    return typeof data === 'object' ? [data] : [];
  }

  _summarizeRecord(record, query) {
    const direct = record.summary || record.description || record.evidence_text || record.snippet || record.content;
    if (direct) return direct;

    if (record.name && record._type) {
      return `${record._type}: ${record.name}`;
    }

    try {
      const json = JSON.stringify(record);
      return json.length > 300 ? `${json.slice(0, 299)}…` : json;
    } catch {
      return `EBS context for ${query}`;
    }
  }
}

export default EBSBridgeConnector;
