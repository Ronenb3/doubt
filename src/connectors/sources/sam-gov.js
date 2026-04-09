import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class SAMGovConnector extends BaseConnector {
  constructor() {
    super({
      id: 'sam_gov',
      name: 'SAM.gov Entity Registration',
      description: 'SAM.gov — federal entity registration, exclusions, and responsibility data',
      baseUrl: 'https://api.sam.gov/entity-information/v3',
      domains: ['procurement', 'compliance'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1500,
    });
    this._apiKey = process.env.SAM_GOV_API_KEY || 'DEMO_KEY';
  }

  async search(query, options = {}) {
    try {
      const entities = await this._searchEntities(query, options);
      if (entities.length > 0) return this._toEvidence(entities, options.claimId);

      const exclusions = await this._searchExclusions(query, options);
      return this._toEvidence(exclusions, options.claimId);
    } catch {
      return [];
    }
  }

  async _searchEntities(query, options) {
    const params = new URLSearchParams({
      q: query,
      api_key: this._apiKey,
    });
    if (options.limit) params.set('registrationStatus', 'A');

    const url = `${this.baseUrl}/entities?${params}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const entities = res.data?.entityData || res.data?.results || [];
    return (Array.isArray(entities) ? entities : []).slice(0, options.limit || 10).map(e => {
      const reg = e.entityRegistration || e;
      const core = e.coreData || {};
      return {
        url: `https://sam.gov/entity/${reg.ueiSAM || reg.duns || ''}`,
        title: `${reg.legalBusinessName || core.entityInformation?.entityName || query} — SAM.gov`,
        summary: `${reg.legalBusinessName || 'Entity'}: UEI ${reg.ueiSAM || 'N/A'}, status ${reg.registrationStatus || 'unknown'}, ${core.physicalAddress?.city || ''} ${core.physicalAddress?.stateOrProvinceCode || ''}`,
        type: EvidenceType.NEUTRAL,
        timestamp: reg.registrationDate || null,
        data: {
          uei: reg.ueiSAM,
          duns: reg.duns,
          legalName: reg.legalBusinessName,
          status: reg.registrationStatus,
          activationDate: reg.activationDate,
          expirationDate: reg.expirationDate,
          cageCode: reg.cageCode,
          naicsCode: core.entityInformation?.primaryNaics,
          address: core.physicalAddress,
        },
      };
    });
  }

  async _searchExclusions(query, options) {
    const params = new URLSearchParams({
      q: query,
      api_key: this._apiKey,
    });

    const url = `https://api.sam.gov/entity-information/v3/exclusions?${params}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const exclusions = res.data?.results || [];
    return (Array.isArray(exclusions) ? exclusions : []).slice(0, options.limit || 10).map(ex => ({
      url: `https://sam.gov/exclusions`,
      title: `${ex.name || query} — SAM.gov Exclusion`,
      summary: `Excluded entity: ${ex.name || query}, type ${ex.classificationType || 'unknown'}, from ${ex.activateDate || 'N/A'} to ${ex.terminationDate || 'indefinite'}`,
      type: EvidenceType.CONTRADICTS,
      timestamp: ex.activateDate || null,
      data: {
        name: ex.name,
        classificationType: ex.classificationType,
        exclusionType: ex.exclusionType,
        activateDate: ex.activateDate,
        terminationDate: ex.terminationDate,
        agency: ex.excludingAgencyCode,
      },
    }));
  }
}

export default SAMGovConnector;
