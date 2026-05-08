/**
 * doubt — GDACS Connector (Global Disaster Alert and Coordination System)
 *
 * UN-grade real-time disaster alerts. Verifies disaster claims:
 * "magnitude 7 earthquake hit Turkey" → ground truth from a UN-OCHA feed.
 *
 * Free, no key. Public RSS endpoint at gdacs.org/xml/rss.xml,
 * JSON event API at gdacs.org/gdacsapi/api/events.
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class GDACSConnector extends BaseConnector {
  constructor() {
    super({
      id: 'gdacs',
      name: 'GDACS — Global Disaster Alerts',
      description: 'UN-OCHA real-time alerts for earthquakes, floods, cyclones, droughts, volcanoes, wildfires',
      baseUrl: 'https://www.gdacs.org',
      domains: ['general', 'geopolitical', 'disaster'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 25;
      // GDACS public events endpoint — last 30 days, all event types, JSON
      const url = `${this.baseUrl}/gdacsapi/api/events/geteventlist/MAP?fromDate=${this._daysAgo(30)}&toDate=${this._today()}`;
      const res = await this._fetch(url);
      if (!res.ok || !res.data) return [];

      const features = res.data?.features || [];
      const q = (query || '').toLowerCase();

      // Score each event by overlap with query terms; keep events that match
      // OR keep all if query is too generic (let downstream relevance filter).
      const scored = features.map(f => {
        const p = f.properties || {};
        const country = (p.country || '').toLowerCase();
        const name = (p.name || '').toLowerCase();
        const eventName = (p.eventname || p.htmldescription || '').toLowerCase();
        const blob = `${country} ${name} ${eventName}`;
        const overlap = q.split(/\s+/).filter(w => w.length > 2 && blob.includes(w)).length;
        return { f, overlap };
      });

      const matched = scored.filter(s => s.overlap > 0).sort((a, b) => b.overlap - a.overlap);
      const events = (matched.length > 0 ? matched : scored).slice(0, limit).map(s => s.f);

      const items = events.map(f => {
        const p = f.properties || {};
        const coords = f.geometry?.coordinates || [];
        const alertLevel = p.alertlevel || 'Green';
        const isAlert = alertLevel === 'Orange' || alertLevel === 'Red';
        const summary = [
          `${(p.eventtype || '').toUpperCase()}`,
          p.name || p.eventname,
          p.country ? `in ${p.country}` : null,
          p.severitydata?.severity ? `severity ${p.severitydata.severity}` : null,
          `alert: ${alertLevel}`,
          p.fromdate ? `from ${p.fromdate.slice(0, 10)}` : null,
        ].filter(Boolean).join(' — ');

        return {
          url: p.url?.report || p.htmldescription || `${this.baseUrl}/report.aspx?eventid=${p.eventid}`,
          title: p.name || p.eventname || `GDACS ${p.eventtype}`,
          summary,
          // Orange/Red alerts are corroborating evidence for "X disaster occurred"
          type: isAlert ? EvidenceType.SUPPORTS : EvidenceType.NEUTRAL,
          timestamp: p.fromdate || p.todate || null,
          data: {
            eventId: p.eventid,
            eventType: p.eventtype,
            country: p.country,
            iso3: p.iso3,
            alertLevel,
            severity: p.severitydata?.severity,
            severityText: p.severitydata?.severitytext,
            magnitude: p.magnitude,
            depth: p.depth,
            coordinates: coords,
            fromDate: p.fromdate,
            toDate: p.todate,
            episodeId: p.episodeid,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _daysAgo(n) {
    const d = new Date(Date.now() - n * 86400000);
    return d.toISOString().slice(0, 10);
  }

  _today() {
    return new Date().toISOString().slice(0, 10);
  }
}

export default GDACSConnector;
