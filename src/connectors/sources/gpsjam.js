/**
 * doubt — gpsjam.org Connector
 *
 * GPS jamming detection — derives jamming probability from ADS-B aircraft NIC values.
 * Verifies claims like "GPS is being jammed near X" or "navigation interference reported."
 *
 * gpsjam.org publishes daily H3-cell tile data at gpsjam.org/data/<YYYY-MM-DD>/h3_4.json
 * Free, no key.
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class GPSJamConnector extends BaseConnector {
  constructor() {
    super({
      id: 'gpsjam',
      name: 'gpsjam.org — GPS Jamming',
      description: 'Daily GPS jamming detection from aggregated ADS-B navigation integrity data',
      baseUrl: 'https://gpsjam.org',
      domains: ['cyber', 'geopolitical', 'aviation'],
      trustTier: SourceTrust.ACADEMIC_PEER,
      rateMs: 2000,
      skipPrecheck: true, // gpsjam returns 404 on root, prechecker would mark dead
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 15;
      // Use yesterday's tile — today's may be incomplete
      const date = this._yesterday();
      // Resolution 4 = ~250km hexagons, manageable file size, country-level
      const url = `${this.baseUrl}/data/${date}/h3_4.json.gz`;

      // Try un-gzipped variant first (some days are uncompressed)
      let res = await this._fetch(`${this.baseUrl}/data/${date}/h3_4.json`);
      if (!res.ok) res = await this._fetch(url);
      if (!res.ok || !Array.isArray(res.data)) return [];

      // Each row: [h3_index, total_aircraft, bad_aircraft]
      // Bad % = bad / total. Filter to cells with measurable jamming (>20% bad and >10 aircraft).
      const significant = res.data
        .filter(r => Array.isArray(r) && r[1] >= 10 && (r[2] / r[1]) >= 0.20)
        .map(r => ({
          h3: r[0],
          total: r[1],
          bad: r[2],
          badPct: r[2] / r[1],
        }))
        .sort((a, b) => b.badPct - a.badPct)
        .slice(0, limit);

      const items = significant.map(c => ({
        url: `${this.baseUrl}/?date=${date}&zoom=4`,
        title: `GPS jamming detected — H3 cell ${c.h3}`,
        summary: `GPS JAMMING — ${(c.badPct * 100).toFixed(0)}% of ${c.total} aircraft showing degraded NIC in cell ${c.h3} on ${date}`,
        type: EvidenceType.SUPPORTS,
        timestamp: date + 'T00:00:00Z',
        data: {
          h3Index: c.h3,
          date,
          totalAircraft: c.total,
          badAircraft: c.bad,
          jammingPercent: c.badPct,
          resolution: 4,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _yesterday() {
    const d = new Date(Date.now() - 86400000);
    return d.toISOString().slice(0, 10);
  }
}

export default GPSJamConnector;
