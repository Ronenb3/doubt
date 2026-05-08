/**
 * ACLED Connector (Armed Conflict Location & Event Data Project)
 *
 * Curated, geo-coded record of political-violence and protest events:
 * battles, explosions/remote violence, riots, protests, violence against
 * civilians. The gold standard for verifying conflict claims:
 *   "fighting in Sudan continues" → check recent battle events
 *   "protests erupted in Paris" → check protest events
 *
 * Free for non-commercial use. Requires email + access key.
 * Sign up: https://developer.acleddata.com/
 *
 * Key names: ACLED_API_KEY (token), ACLED_EMAIL (account email)
 * Trust: ACADEMIC_PEER (0.80) — peer-reviewed coding methodology
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

class ACLEDConnector extends BaseConnector {
  constructor() {
    super({
      id: 'acled',
      name: 'ACLED — Armed Conflict Events',
      description: 'Curated political-violence and protest event database (battles, riots, protests, civilian violence)',
      baseUrl: 'https://api.acleddata.com',
      domains: ['geopolitical', 'military', 'general'],
      trustTier: SourceTrust.ACADEMIC_PEER,
      rateMs: 1500,
      requiresKey: true,
      keyName: 'ACLED_API_KEY',
    });
  }

  async search(query, options = {}) {
    try {
      const config = getConfig();
      const apiKey = config.keys['ACLED_API_KEY'];
      const email = config.keys['ACLED_EMAIL'];
      if (!apiKey || !email) return [];

      const limit = options.limit || 25;
      const q = (query || '').trim();
      if (!q) return [];

      // Look back 90 days by default; allow override.
      const since = options.since || this._daysAgo(90);

      const params = new URLSearchParams({
        key: apiKey,
        email,
        limit: String(Math.min(limit, 100)),
        event_date: `${since}|${this._today()}`,
        event_date_where: 'BETWEEN',
      });

      // ACLED supports a 'notes' LIKE filter for free-text search and 'country' filter.
      // Try treating the query as a country first; fall back to notes-LIKE.
      params.set('country', q);
      params.set('country_where', 'LIKE');

      const res = await this._fetch(`${this.baseUrl}/acled/read.csv?${params.toString()}`);
      if (!res.ok || typeof res.data !== 'string') return [];

      let rows = this._parseCSV(res.data);
      // Fallback: if country match returned nothing, try notes-LIKE.
      if (rows.length === 0) {
        const p2 = new URLSearchParams({
          key: apiKey,
          email,
          limit: String(Math.min(limit, 100)),
          event_date: `${since}|${this._today()}`,
          event_date_where: 'BETWEEN',
          notes: q,
          notes_where: 'LIKE',
        });
        const r2 = await this._fetch(`${this.baseUrl}/acled/read.csv?${p2.toString()}`);
        if (!r2.ok || typeof r2.data !== 'string') return [];
        rows = this._parseCSV(r2.data);
      }

      const items = rows.slice(0, limit).map(r => {
        const fatalities = parseInt(r.fatalities, 10) || 0;
        const summary = [
          (r.event_type || 'EVENT').toUpperCase(),
          r.sub_event_type ? `(${r.sub_event_type})` : null,
          r.location ? `at ${r.location}` : null,
          r.country ? `, ${r.country}` : null,
          r.event_date ? `on ${r.event_date}` : null,
          fatalities > 0 ? `fatalities: ${fatalities}` : null,
        ].filter(Boolean).join(' — ');

        return {
          url: r.source_scale && r.source ? r.source : 'https://acleddata.com',
          title: r.notes ? r.notes.slice(0, 160) : `${r.event_type} in ${r.location}`,
          summary,
          // ACLED events corroborate that violence/protest occurred.
          type: EvidenceType.SUPPORTS,
          timestamp: r.event_date ? r.event_date + 'T00:00:00Z' : null,
          data: {
            eventId: r.data_id,
            eventType: r.event_type,
            subEventType: r.sub_event_type,
            actor1: r.actor1,
            actor2: r.actor2,
            country: r.country,
            region: r.region,
            location: r.location,
            latitude: parseFloat(r.latitude) || null,
            longitude: parseFloat(r.longitude) || null,
            fatalities,
            source: r.source,
            sourceScale: r.source_scale,
            eventDate: r.event_date,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _parseCSV(csv) {
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = this._splitCSVLine(lines[0]);
    return lines.slice(1).map(line => {
      const cols = this._splitCSVLine(line);
      const row = {};
      headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
      return row;
    });
  }

  // Minimal RFC-4180-ish splitter — handles quoted fields with embedded commas.
  _splitCSVLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { cur += c; }
      } else {
        if (c === ',') { out.push(cur); cur = ''; }
        else if (c === '"') { inQuotes = true; }
        else { cur += c; }
      }
    }
    out.push(cur);
    return out;
  }

  _daysAgo(n) {
    const d = new Date(Date.now() - n * 86400000);
    return d.toISOString().slice(0, 10);
  }

  _today() {
    return new Date().toISOString().slice(0, 10);
  }
}

export default ACLEDConnector;
