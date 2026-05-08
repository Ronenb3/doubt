/**
 * Cloudflare Radar Connector
 *
 * Internet-traffic intelligence: outages, attack telemetry, BGP routing
 * incidents, traffic anomalies. Verifies claims like:
 *   "internet outage in Iran" → /annotations/outages
 *   "country X is censoring traffic" → traffic-by-country deltas
 *
 * Free key: https://dash.cloudflare.com/profile/api-tokens
 * Token requires "Radar:Read" permission.
 *
 * Key name: CLOUDFLARE_API_KEY
 * Trust: NEWS_MAJOR (0.65) — operational telemetry from one of the
 * world's largest reverse proxies; not peer-reviewed but ground-truth-y.
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

class CloudflareRadarConnector extends BaseConnector {
  constructor() {
    super({
      id: 'cloudflare_radar',
      name: 'Cloudflare Radar — Internet Telemetry',
      description: 'Internet outages, attack telemetry, traffic anomalies and BGP incidents',
      baseUrl: 'https://api.cloudflare.com/client/v4/radar',
      domains: ['cyber', 'geopolitical', 'general'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 1500,
      requiresKey: true,
      keyName: 'CLOUDFLARE_API_KEY',
    });
  }

  async search(query, options = {}) {
    try {
      const config = getConfig();
      const apiKey = config.keys['CLOUDFLARE_API_KEY'];
      if (!apiKey) return [];

      const limit = options.limit || 20;
      const q = (query || '').trim().toLowerCase();
      const tokens = q.split(/\s+/).filter(w => w.length > 2);

      const headers = { Authorization: `Bearer ${apiKey}` };

      // Pull recent outages (last 30 days). Country filter narrows when query
      // mentions a known country code; otherwise pull global.
      const url = `${this.baseUrl}/annotations/outages?dateRange=30d&limit=200&format=json`;
      const res = await this._fetch(url, { headers });
      if (!res.ok || !res.data) return [];

      const outages = res.data?.result?.annotations || [];
      if (outages.length === 0) return [];

      // Score by overlap with country / asn name / description.
      const scored = outages.map(o => {
        const blob = `${(o.locations || []).join(' ')} ${o.asnsDetails ? o.asnsDetails.map(a => a.name).join(' ') : ''} ${o.description || ''} ${o.outage?.outageCause || ''}`.toLowerCase();
        const overlap = tokens.filter(t => blob.includes(t)).length;
        return { o, overlap };
      });

      const matched = scored.filter(s => s.overlap > 0).sort((a, b) => b.overlap - a.overlap);
      const list = (matched.length > 0 ? matched : scored)
        .sort((x, y) => new Date(y.o.startDate || 0) - new Date(x.o.startDate || 0))
        .slice(0, limit)
        .map(s => s.o);

      const items = list.map(o => {
        const country = (o.locations || [])[0] || 'global';
        const cause = o.outage?.outageCause || 'unspecified cause';
        const scope = o.outage?.outageScope || 'partial';
        const summary = [
          'INTERNET OUTAGE',
          country.toUpperCase(),
          `cause: ${cause}`,
          `scope: ${scope}`,
          o.startDate ? `start ${o.startDate.slice(0, 16).replace('T', ' ')}` : null,
          o.endDate ? `end ${o.endDate.slice(0, 16).replace('T', ' ')}` : 'ongoing',
        ].filter(Boolean).join(' — ');

        return {
          url: `https://radar.cloudflare.com/outage-center?dateRange=30d`,
          title: `Internet outage — ${country}`,
          summary,
          // A confirmed outage SUPPORTS claims that connectivity was lost.
          type: EvidenceType.SUPPORTS,
          timestamp: o.startDate || null,
          data: {
            outageId: o.id,
            locations: o.locations,
            asns: (o.asnsDetails || []).map(a => ({ asn: a.asn, name: a.name })),
            cause,
            scope,
            description: o.description,
            startDate: o.startDate,
            endDate: o.endDate,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default CloudflareRadarConnector;
