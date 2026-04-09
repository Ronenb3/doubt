import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class AircraftTrackingConnector extends BaseConnector {
  constructor() {
    super({
      id: 'aircraft',
      name: 'OpenSky Aircraft Tracking',
      description: 'OpenSky Network — live and historical aircraft position data by callsign/ICAO24',
      baseUrl: 'https://opensky-network.org/api',
      domains: ['infrastructure', 'transportation'],
      trustTier: SourceTrust.FINANCIAL_DATA,
      rateMs: 5000,
    });
  }

  async search(query, options = {}) {
    try {
      const callsign = query.toUpperCase().replace(/\s+/g, '');
      const items = await this._searchByCallsign(callsign, options);
      if (items.length > 0) return this._toEvidence(items, options.claimId);

      return await this._searchAllStates(callsign, options);
    } catch {
      return [];
    }
  }

  async _searchByCallsign(callsign, options) {
    const url = `${this.baseUrl}/states/all?callsign=${callsign}`;
    const res = await this._fetch(url);
    if (!res.ok || !res.data?.states) return [];

    return this._parseStates(res.data.states, res.data.time);
  }

  async _searchAllStates(query, options) {
    const url = `${this.baseUrl}/states/all`;
    const res = await this._fetch(url);
    if (!res.ok || !res.data?.states) return [];

    const matching = res.data.states.filter(s => {
      const cs = (s[1] || '').trim().toUpperCase();
      const icao = (s[0] || '').trim().toUpperCase();
      return cs.includes(query) || icao.includes(query);
    });

    return this._parseStates(matching.slice(0, options.limit || 10), res.data.time);
  }

  _parseStates(states, time) {
    return states.map(s => ({
      url: `https://opensky-network.org/aircraft-profile?icao24=${s[0]}`,
      title: `${(s[1] || '').trim() || s[0]} — Aircraft`,
      summary: `Callsign ${(s[1] || '').trim()}: altitude ${s[7] || 'N/A'}m, speed ${s[9] || 'N/A'}m/s, origin ${s[2] || '?'}`,
      type: EvidenceType.NEUTRAL,
      timestamp: time ? new Date(time * 1000).toISOString() : null,
      data: {
        icao24: s[0],
        callsign: (s[1] || '').trim(),
        originCountry: s[2],
        longitude: s[5],
        latitude: s[6],
        altitudeMeters: s[7],
        onGround: s[8],
        velocityMs: s[9],
        heading: s[10],
        verticalRate: s[11],
        squawk: s[14],
      },
    }));
  }
}

export default AircraftTrackingConnector;
