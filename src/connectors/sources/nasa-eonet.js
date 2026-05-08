/**
 * doubt — NASA EONET Connector (Earth Observatory Natural Event Tracker)
 *
 * Curated stream of natural events: wildfires, severe storms, volcanoes,
 * sea/lake ice, drought, dust/haze, earthquakes, landslides, manmade events.
 * Free, no key. Public API at eonet.gsfc.nasa.gov/api/v3.
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class NASAEONETConnector extends BaseConnector {
  constructor() {
    super({
      id: 'nasa_eonet',
      name: 'NASA EONET — Natural Events',
      description: 'NASA-curated natural event database: wildfires, storms, volcanoes, earthquakes, landslides',
      baseUrl: 'https://eonet.gsfc.nasa.gov',
      domains: ['general', 'geopolitical', 'disaster'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 25;
      // Last 60 days of events, all categories, all statuses
      const url = `${this.baseUrl}/api/v3/events?days=60&limit=200`;
      const res = await this._fetch(url);
      if (!res.ok || !res.data) return [];

      const events = res.data?.events || [];
      const q = (query || '').toLowerCase();
      const tokens = q.split(/\s+/).filter(w => w.length > 2);

      const scored = events.map(e => {
        const blob = [
          e.title || '',
          e.description || '',
          ...(e.categories || []).map(c => c.title || ''),
        ].join(' ').toLowerCase();
        const overlap = tokens.filter(t => blob.includes(t)).length;
        return { e, overlap };
      });

      const matched = scored.filter(s => s.overlap > 0).sort((a, b) => b.overlap - a.overlap);
      const list = (matched.length > 0 ? matched : scored).slice(0, limit).map(s => s.e);

      const items = list.map(e => {
        const latestGeom = (e.geometry || []).slice(-1)[0];
        const category = (e.categories || [])[0]?.title || 'Event';
        const summary = [
          category.toUpperCase(),
          e.title,
          latestGeom?.date ? `last update ${latestGeom.date.slice(0, 10)}` : null,
          latestGeom?.coordinates ? `at [${latestGeom.coordinates.join(', ')}]` : null,
        ].filter(Boolean).join(' — ');

        return {
          url: (e.sources || [])[0]?.url || e.link || `${this.baseUrl}/api/v3/events/${e.id}`,
          title: e.title,
          summary,
          // An EONET event corroborates that a natural event occurred at coords/time
          type: EvidenceType.SUPPORTS,
          timestamp: latestGeom?.date || null,
          data: {
            eventId: e.id,
            categories: (e.categories || []).map(c => c.title),
            sources: (e.sources || []).map(s => ({ id: s.id, url: s.url })),
            geometryCount: (e.geometry || []).length,
            firstDate: (e.geometry || [])[0]?.date,
            lastDate: latestGeom?.date,
            coordinates: latestGeom?.coordinates,
            magnitudeValue: latestGeom?.magnitudeValue,
            magnitudeUnit: latestGeom?.magnitudeUnit,
            closed: !!e.closed,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default NASAEONETConnector;
