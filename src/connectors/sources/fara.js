import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class FARAConnector extends BaseConnector {
  constructor() {
    super({
      id: 'fara',
      name: 'FARA',
      description: 'Foreign Agents Registration Act — foreign government lobbyists, agents, and their US activities',
      baseUrl: 'https://efile.fara.gov',
      domains: ['political', 'legal', 'compliance', 'geopolitical'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = Math.min(options.limit || 10, 25);
      const results = [];

      // Search active registrants
      const regUrl = `${this.baseUrl}/api/v1/Registrants/search/${encodeURIComponent(query)}`;
      const regRes = await this._fetch(regUrl);

      if (regRes.ok) {
        const registrants = Array.isArray(regRes.data) ? regRes.data : (regRes.data?.data || []);
        for (const r of registrants.slice(0, limit)) {
          results.push({
            url: r.Url || r.registrationUrl || `${this.baseUrl}/ords/fara/q/{!${encodeURIComponent(query)}}`,
            title: `FARA: ${r.Name || r.registrantName || 'Unknown agent'}`.slice(0, 200),
            summary: [
              r.Name && `Agent: ${r.Name}`,
              r.Address && `Address: ${r.Address}`,
              r.ForeignPrincipal && `Foreign principal: ${r.ForeignPrincipal}`,
              r.Country && `Country: ${r.Country}`,
              r.RegistrationDate && `Registered: ${r.RegistrationDate}`,
              r.TerminationDate && `Terminated: ${r.TerminationDate}`,
              r.RegistrationNumber && `Reg #: ${r.RegistrationNumber}`,
            ].filter(Boolean).join('. ').slice(0, 500),
            type: EvidenceType.NEUTRAL,
            timestamp: r.RegistrationDate || null,
            data: {
              registrationNumber: r.RegistrationNumber,
              name: r.Name,
              foreignPrincipal: r.ForeignPrincipal,
              country: r.Country,
              registrationDate: r.RegistrationDate,
              terminationDate: r.TerminationDate,
              address: r.Address,
            },
          });
        }
      }

      // Also try document search
      const docUrl = `${this.baseUrl}/api/v1/RegDocs/search/${encodeURIComponent(query)}`;
      const docRes = await this._fetch(docUrl);

      if (docRes.ok) {
        const docs = Array.isArray(docRes.data) ? docRes.data : (docRes.data?.data || []);
        for (const d of docs.slice(0, limit)) {
          results.push({
            url: d.Url || d.documentUrl || `${this.baseUrl}`,
            title: `FARA Filing: ${d.RegistrantName || d.DocumentType || 'Unknown filing'}`.slice(0, 200),
            summary: [
              d.RegistrantName && `Registrant: ${d.RegistrantName}`,
              d.DocumentType && `Type: ${d.DocumentType}`,
              d.ForeignPrincipal && `Foreign principal: ${d.ForeignPrincipal}`,
              d.Country && `Country: ${d.Country}`,
              d.StampDate && `Filed: ${d.StampDate}`,
            ].filter(Boolean).join('. ').slice(0, 500),
            type: EvidenceType.NEUTRAL,
            timestamp: d.StampDate || d.DateSubmitted || null,
            data: {
              source: 'fara_document',
              registrantName: d.RegistrantName,
              documentType: d.DocumentType,
              foreignPrincipal: d.ForeignPrincipal,
              country: d.Country,
            },
          });
        }
      }

      return this._toEvidence(results.slice(0, limit * 2), options.claimId);
    } catch {
      return [];
    }
  }
}

export default FARAConnector;
