import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * Nominatim / OpenStreetMap Geocoding Connector
 *
 * Free address and place search from OpenStreetMap. Useful for:
 *   - Resolving entity locations mentioned in investigations
 *   - Disambiguating place names (Tehran vs Tehran province)
 *   - Reverse geocoding coordinates from other connectors
 *   - Enriching OSINT with geographic context
 *
 * No API key. Rate limit: 1 request/second (enforced via rateMs).
 */
class NominatimConnector extends BaseConnector {
  constructor() {
    super({
      id: 'nominatim',
      name: 'Nominatim (OpenStreetMap)',
      description: 'Free geocoding and place search from OpenStreetMap — resolves places, addresses, regions',
      baseUrl: 'https://nominatim.openstreetmap.org',
      domains: ['geopolitical', 'geocoding', 'government'],
      trustTier: SourceTrust.OPEN_SOURCE,
      rateMs: 1200,  // OSM policy: max 1 req/sec, be polite
    });
  }

  async search(query, options = {}) {
    try {
      const limit = Math.min(options.limit || 8, 10);
      const params = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        limit: String(limit),
        addressdetails: '1',
        extratags: '1',
        namedetails: '1',
      });

      const res = await this._fetch(`${this.baseUrl}/search?${params}`, {
        headers: {
          'User-Agent': 'doubt-intelligence/1.0 (investigative research tool)',
          'Accept': 'application/json',
        },
      });
      if (!res.ok) return [];

      const results = Array.isArray(res.data) ? res.data : [];
      const items = results.map(r => {
        const addr = r.address || {};
        const country = addr.country || '';
        const city = addr.city || addr.town || addr.village || addr.county || '';
        const osmType = (r.osm_type || 'node').toUpperCase();
        const displayName = r.display_name || r.name || query;

        return {
          url: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
          title: r.name || displayName.split(',')[0] || query,
          summary: `Geographic location: ${displayName}. Type: ${r.type || r.class || 'place'}. ${country ? 'Country: ' + country + '.' : ''} ${city ? 'City/Region: ' + city + '.' : ''} Coordinates: ${r.lat}, ${r.lon}`,
          type: EvidenceType.SUPPORTS,
          timestamp: null,
          data: {
            osmId: r.osm_id,
            osmType,
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
            displayName,
            type: r.type,
            class: r.class,
            importance: r.importance,
            country: addr.country,
            countryCode: addr.country_code,
            state: addr.state || addr.region,
            city,
            address: addr,
            boundingBox: r.boundingbox,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default NominatimConnector;
