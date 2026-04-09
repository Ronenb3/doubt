import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class GeospatialConnector extends BaseConnector {
  constructor() {
    super({
      id: 'geospatial',
      name: 'OpenStreetMap Nominatim',
      description: 'Geospatial search via OpenStreetMap Nominatim — addresses, POIs, coordinates',
      baseUrl: 'https://nominatim.openstreetmap.org',
      domains: ['location', 'infrastructure'],
      trustTier: SourceTrust.FINANCIAL_DATA,
      rateMs: 1100,
    });
  }

  async search(query, options = {}) {
    try {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        limit: String(options.limit || 5),
        addressdetails: '1',
        extratags: '1',
      });

      const url = `${this.baseUrl}/search?${params}`;
      const res = await this._fetch(url, {
        headers: { 'User-Agent': 'doubt-intelligence-engine/1.0' },
      });
      if (!res.ok) return [];

      const results = Array.isArray(res.data) ? res.data : [];
      const items = results.slice(0, options.limit || 5).map(r => ({
        url: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
        title: `${r.display_name?.split(',').slice(0, 2).join(',') || query} — OSM`,
        summary: `${r.display_name || query} (${r.type || r.class || 'place'}) — lat ${r.lat}, lon ${r.lon}`,
        type: EvidenceType.NEUTRAL,
        timestamp: null,
        data: {
          osmId: r.osm_id,
          osmType: r.osm_type,
          placeId: r.place_id,
          displayName: r.display_name,
          latitude: parseFloat(r.lat),
          longitude: parseFloat(r.lon),
          boundingBox: r.boundingbox,
          category: r.class,
          type: r.type,
          importance: r.importance,
          address: r.address,
          extratags: r.extratags,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default GeospatialConnector;
