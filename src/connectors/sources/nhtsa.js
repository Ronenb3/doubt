import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

const KNOWN_MAKES = [
  'TESLA', 'FORD', 'CHEVROLET', 'TOYOTA', 'HONDA', 'BMW', 'MERCEDES-BENZ',
  'NISSAN', 'HYUNDAI', 'KIA', 'JEEP', 'DODGE', 'RAM', 'GMC', 'BUICK',
  'CADILLAC', 'CHRYSLER', 'SUBARU', 'MAZDA', 'VOLKSWAGEN', 'AUDI', 'LEXUS',
  'ACURA', 'INFINITI', 'VOLVO', 'PORSCHE', 'JAGUAR', 'LAND ROVER', 'RIVIAN',
  'LUCID', 'GENESIS', 'LINCOLN', 'MITSUBISHI', 'MINI', 'FIAT', 'ALFA ROMEO',
  'MASERATI', 'FERRARI', 'LAMBORGHINI', 'ASTON MARTIN', 'BENTLEY', 'ROLLS-ROYCE',
];

class NHTSAConnector extends BaseConnector {
  constructor() {
    super({
      id: 'nhtsa',
      name: 'NHTSA',
      description: 'Vehicle safety — recalls, complaints, investigations from NHTSA',
      baseUrl: 'https://api.nhtsa.gov',
      domains: ['safety', 'corporate'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const make = this._extractMake(query);
      if (!make) return [];

      const limit = options.limit || 25;
      const vehicles = await this._getVehicles(make);
      if (vehicles.length === 0) return [];

      // Search across multiple models in parallel for broader coverage
      const searchTasks = vehicles.slice(0, 5).map(({ model, modelYear }) =>
        Promise.all([
          this._searchComplaints(make, model, modelYear, 5),
          this._searchRecalls(make, model, modelYear, 10),
        ]).then(([complaints, recalls]) => [...recalls, ...complaints])
      );

      const results = await Promise.allSettled(searchTasks);
      const allItems = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value);

      return this._toEvidence(allItems.slice(0, limit), options.claimId);
    } catch {
      return [];
    }
  }

  _extractMake(query) {
    const upper = query.toUpperCase();
    return KNOWN_MAKES.find(m => upper.includes(m)) || null;
  }

  async _getVehicles(make) {
    const currentYear = new Date().getFullYear();
    const seen = new Set();
    const vehicles = [];

    for (const year of [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4]) {
      const url = `${this.baseUrl}/products/vehicle/models?make=${encodeURIComponent(make)}&modelYear=${year}&issueType=c`;
      const res = await this._fetch(url);
      if (!res.ok) continue;

      for (const r of (res.data?.results || [])) {
        const key = `${r.model}|${r.modelYear}`;
        if (!seen.has(key)) {
          seen.add(key);
          vehicles.push({ model: r.model, modelYear: r.modelYear });
        }
      }
    }
    return vehicles;
  }

  async _searchComplaints(make, model, modelYear, limit) {
    const params = new URLSearchParams({ make, model, modelYear });
    const url = `${this.baseUrl}/complaints/complaintsByVehicle?${params}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const results = res.data?.results || [];
    if (!Array.isArray(results)) return [];

    return results.slice(0, limit).map(r => {
      const prod = r.products?.[0] || {};
      return {
        url: `https://www.nhtsa.gov/vehicle/${encodeURIComponent(prod.productMake || make)}/${encodeURIComponent(prod.productModel || model)}/${prod.productYear || modelYear}`,
        title: `NHTSA Complaint: ${prod.productYear || modelYear} ${prod.productMake || make} ${prod.productModel || model} — ${r.components || 'Unknown'}`,
        summary: (r.summary || `${make} ${model} ${r.components || ''} complaint`).slice(0, 500),
        type: EvidenceType.NEUTRAL,
        timestamp: r.dateComplaintFiled || r.dateOfIncident || null,
        data: {
          odiNumber: r.odiNumber,
          make: prod.productMake || make,
          model: prod.productModel || model,
          modelYear: prod.productYear || modelYear,
          component: r.components,
          crash: r.crash,
          fire: r.fire,
          injuries: r.numberOfInjuries,
          deaths: r.numberOfDeaths,
        },
      };
    });
  }

  async _searchRecalls(make, model, modelYear, limit) {
    const params = new URLSearchParams({ make, model, modelYear });
    const url = `${this.baseUrl}/recalls/recallsByVehicle?${params}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const results = res.data?.results || [];
    if (!Array.isArray(results)) return [];

    return results.slice(0, limit).map(r => ({
      url: `https://www.nhtsa.gov/recalls?nhtsaId=${r.NHTSACampaignNumber || ''}`,
      title: `NHTSA Recall: ${r.Manufacturer || ''} — ${r.Summary?.slice(0, 80) || r.Component || 'Vehicle recall'}`,
      summary: (r.Consequence || r.Summary || r.Component || '').slice(0, 500),
      type: EvidenceType.NEUTRAL,
      timestamp: r.ReportReceivedDate || null,
      data: {
        campaignNumber: r.NHTSACampaignNumber,
        manufacturer: r.Manufacturer,
        subject: r.Summary,
        component: r.Component,
        consequence: r.Consequence,
        remedy: r.Remedy,
        potentialUnitsAffected: r.PotentialNumberofUnitsAffected,
      },
    }));
  }
}

export default NHTSAConnector;
