/**
 * OpenSky Network Connector
 *
 * Real-time and historical aircraft tracking via the OpenSky Network.
 * Independent crowdsourced ADS-B network — good for corroborating
 * aircraft tail number / route queries alongside existing aircraft-tracking.
 *
 * No API key required (unauthenticated tier — 10 req/10s).
 * Trust: FINANCIAL_DATA (0.85) — sensor-verified flight data
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

const BASE = 'https://opensky-network.org/api';

class OpenSkyConnector extends BaseConnector {
  constructor() {
    super({
      id: 'opensky',
      name: 'OpenSky Network',
      description: 'Independent ADS-B aircraft tracking — flight state, callsign, registration lookups',
      baseUrl: BASE,
      domains: ['infrastructure', 'general'],
      trustTier: SourceTrust.FINANCIAL_DATA,
      rateMs: 1200,
    });
  }

  async search(query, options = {}) {
    try {
      // Parse for ICAO24 hex code (6 hex chars) or tail number pattern
      const icaoMatch = query.match(/\b([0-9a-fA-F]{6})\b/);
      const callsignMatch = query.match(/\b([A-Z]{2,3}\d{2,4}[A-Z]?)\b/i);

      if (!icaoMatch && !callsignMatch) {
        // Search by callsign text via flights endpoint
        const params = new URLSearchParams({ callsign: query.slice(0, 8).toUpperCase() });
        const res = await this._fetch(`${BASE}/states/all?${params}`);
        if (!res.ok || !res.data?.states?.length) return [];

        return this._stateVectorsToEvidence(res.data.states, options.claimId);
      }

      const icao = icaoMatch?.[1]?.toLowerCase();
      if (icao) {
        const params = new URLSearchParams({ icao24: icao });
        const res = await this._fetch(`${BASE}/states/all?${params}`);
        if (!res.ok) return [];
        return this._stateVectorsToEvidence(res.data?.states || [], options.claimId);
      }

      return [];
    } catch {
      return [];
    }
  }

  _stateVectorsToEvidence(states, claimId) {
    const items = states.slice(0, 10).map(s => {
      // OpenSky state vector: [icao24, callsign, origin_country, time_position,
      //   last_contact, lon, lat, baro_alt, on_ground, velocity, heading, ...]
      const [icao24, callsign, country, , lastContact, lon, lat, alt, onGround, velocity] = s;
      const ts = lastContact ? new Date(lastContact * 1000).toISOString() : null;
      return {
        url: `https://opensky-network.org/aircraft-profile?icao24=${icao24}`,
        title: `Aircraft ${callsign?.trim() || icao24} (${country}) via OpenSky`,
        summary: onGround
          ? `${callsign?.trim() || icao24} on ground in ${country}`
          : `${callsign?.trim() || icao24} at ${Math.round(alt || 0)}m altitude, ${Math.round(velocity || 0)} m/s, ${country}`,
        type: EvidenceType.NEUTRAL,
        timestamp: ts,
        data: { icao24, callsign: callsign?.trim(), country, lat, lon, altitude: alt, velocity, onGround },
      };
    });
    return this._toEvidence(items, claimId);
  }
}

export default OpenSkyConnector;
