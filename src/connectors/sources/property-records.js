import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class PropertyRecordsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'property_records',
      name: 'Property Records',
      description: 'Address verification and geolocation via Census Geocoder — property/location lookup proxy',
      baseUrl: 'https://geocoding.geo.census.gov/geocoder',
      domains: ['property', 'location'],
      trustTier: SourceTrust.COURT_RECORD,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const results = await this._geocodeOnelineAddress(query, options);
      if (results.length > 0) return this._toEvidence(results, options.claimId);

      return this._toEvidence(await this._geocodeFreeform(query, options), options.claimId);
    } catch {
      return [];
    }
  }

  async _geocodeOnelineAddress(query, options) {
    const params = new URLSearchParams({
      address: query,
      benchmark: 'Public_AR_Current',
      vintage: 'Current_Current',
      format: 'json',
    });
    const url = `${this.baseUrl}/geographies/onelineaddress?${params}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const matches = res.data?.result?.addressMatches || [];
    return matches.slice(0, options.limit || 5).map(m => ({
      url: `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(m.matchedAddress)}&benchmark=Public_AR_Current&vintage=Current_Current&format=html`,
      title: `${m.matchedAddress || query} — Census Geocoder`,
      summary: `${m.matchedAddress}: coordinates (${m.coordinates?.x}, ${m.coordinates?.y}), FIPS ${m.geographies?.['Census Tracts']?.[0]?.GEOID || 'N/A'}`,
      type: EvidenceType.NEUTRAL,
      timestamp: null,
      data: {
        matchedAddress: m.matchedAddress,
        coordinates: m.coordinates,
        tigerLineId: m.tigerLine?.tigerLineId,
        side: m.tigerLine?.side,
        state: m.addressComponents?.state,
        county: m.geographies?.['Counties']?.[0]?.NAME,
        tract: m.geographies?.['Census Tracts']?.[0]?.GEOID,
        blockGroup: m.geographies?.['Census Block Groups']?.[0]?.GEOID,
      },
    }));
  }

  async _geocodeFreeform(query, options) {
    const params = new URLSearchParams({
      address: query,
      benchmark: 'Public_AR_Current',
      format: 'json',
    });
    const url = `${this.baseUrl}/locations/onelineaddress?${params}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const matches = res.data?.result?.addressMatches || [];
    return matches.slice(0, options.limit || 5).map(m => ({
      url: `https://geocoding.geo.census.gov/`,
      title: `${m.matchedAddress || query} — Location`,
      summary: `${m.matchedAddress}: (${m.coordinates?.x}, ${m.coordinates?.y})`,
      type: EvidenceType.NEUTRAL,
      timestamp: null,
      data: {
        matchedAddress: m.matchedAddress,
        coordinates: m.coordinates,
        addressComponents: m.addressComponents,
      },
    }));
  }
}

export default PropertyRecordsConnector;
