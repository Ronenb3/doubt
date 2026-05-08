/**
 * NASA FIRMS Connector (Fire Information for Resource Management System)
 *
 * Active fire / thermal anomaly detections from MODIS and VIIRS satellites.
 * Verifies wildfire claims like "wildfires raging in Greece" or "active
 * burning detected in the Amazon" with direct satellite ground-truth.
 *
 * Free key: https://firms.modaps.eosdis.nasa.gov/api/area/
 * Key name: NASA_FIRMS_KEY
 * Trust: GOVERNMENT_FILING (0.95)
 *
 * The API returns CSV; we parse it to evidence rows. Country names are
 * resolved client-side from a small ISO map; fallback is global recent fires.
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

// Compact ISO-3 lookup for country-name → code; covers regions in conflict /
// wildfire-prone areas. Unknown countries fall back to global pull.
const ISO3 = {
  'australia': 'AUS', 'brazil': 'BRA', 'canada': 'CAN', 'china': 'CHN',
  'russia': 'RUS', 'usa': 'USA', 'united states': 'USA', 'us': 'USA',
  'greece': 'GRC', 'italy': 'ITA', 'spain': 'ESP', 'portugal': 'PRT',
  'france': 'FRA', 'germany': 'DEU', 'turkey': 'TUR', 'turkiye': 'TUR',
  'algeria': 'DZA', 'morocco': 'MAR', 'tunisia': 'TUN', 'egypt': 'EGY',
  'mexico': 'MEX', 'argentina': 'ARG', 'chile': 'CHL', 'peru': 'PER',
  'india': 'IND', 'indonesia': 'IDN', 'thailand': 'THA', 'vietnam': 'VNM',
  'kazakhstan': 'KAZ', 'mongolia': 'MNG', 'south africa': 'ZAF',
  'nigeria': 'NGA', 'kenya': 'KEN', 'ethiopia': 'ETH', 'sudan': 'SDN',
  'syria': 'SYR', 'iraq': 'IRQ', 'iran': 'IRN', 'israel': 'ISR',
  'lebanon': 'LBN', 'palestine': 'PSE', 'gaza': 'PSE', 'ukraine': 'UKR',
  'belarus': 'BLR', 'poland': 'POL', 'romania': 'ROU',
  'japan': 'JPN', 'korea': 'KOR', 'philippines': 'PHL', 'malaysia': 'MYS',
};

class NASAFIRMSConnector extends BaseConnector {
  constructor() {
    super({
      id: 'nasa_firms',
      name: 'NASA FIRMS — Active Fires',
      description: 'Satellite-detected active fires and thermal anomalies (MODIS / VIIRS)',
      baseUrl: 'https://firms.modaps.eosdis.nasa.gov/api',
      domains: ['general', 'geopolitical', 'disaster'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 2000,
      requiresKey: true,
      keyName: 'NASA_FIRMS_KEY',
      skipPrecheck: true,
    });
  }

  async search(query, options = {}) {
    try {
      const config = getConfig();
      const apiKey = config.keys['NASA_FIRMS_KEY'];
      if (!apiKey) return [];

      const limit = options.limit || 25;
      const q = (query || '').trim().toLowerCase();
      const days = Math.min(Math.max(options.days || 2, 1), 10);

      // Resolve a country code from the query if possible; else use a wide bbox.
      let url;
      const matchedCountry = Object.keys(ISO3).find(k => q.includes(k));
      if (matchedCountry) {
        const iso = ISO3[matchedCountry];
        url = `${this.baseUrl}/country/csv/${apiKey}/VIIRS_SNPP_NRT/${iso}/${days}`;
      } else {
        // Global bbox: -180,-90,180,90 — let the limit cut it down.
        url = `${this.baseUrl}/area/csv/${apiKey}/VIIRS_SNPP_NRT/-180,-90,180,90/${days}`;
      }

      const res = await this._fetch(url);
      if (!res.ok || typeof res.data !== 'string') return [];

      const rows = this._parseCSV(res.data);
      if (rows.length === 0) return [];

      // FIRMS fires are individual pixel detections — group by date & coarse
      // location for readability, then keep the most intense events.
      const ranked = rows
        .map(r => ({
          ...r,
          frp: parseFloat(r.frp) || 0,
          confidence: r.confidence,
          lat: parseFloat(r.latitude),
          lon: parseFloat(r.longitude),
        }))
        .sort((a, b) => b.frp - a.frp)
        .slice(0, limit);

      const items = ranked.map(r => ({
        url: 'https://firms.modaps.eosdis.nasa.gov/map/',
        title: `Active fire detected — FRP ${r.frp.toFixed(1)} MW`,
        summary: [
          'ACTIVE FIRE',
          `[${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}]`,
          r.acq_date ? `on ${r.acq_date}` : null,
          r.confidence ? `confidence ${r.confidence}` : null,
          `FRP ${r.frp.toFixed(1)} MW`,
          r.daynight === 'D' ? 'day' : r.daynight === 'N' ? 'night' : null,
        ].filter(Boolean).join(' — '),
        type: EvidenceType.SUPPORTS,
        timestamp: r.acq_date ? `${r.acq_date}T${(r.acq_time || '0000').padStart(4, '0').slice(0, 2)}:${(r.acq_time || '0000').padStart(4, '0').slice(2, 4)}:00Z` : null,
        data: {
          latitude: r.lat,
          longitude: r.lon,
          brightness: parseFloat(r.bright_ti4 || r.brightness) || null,
          frpMW: r.frp,
          confidence: r.confidence,
          satellite: r.satellite,
          instrument: r.instrument,
          acqDate: r.acq_date,
          acqTime: r.acq_time,
          dayNight: r.daynight,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _parseCSV(csv) {
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const cols = line.split(',');
      const row = {};
      headers.forEach((h, i) => { row[h] = (cols[i] || '').trim(); });
      return row;
    });
  }
}

export default NASAFIRMSConnector;
