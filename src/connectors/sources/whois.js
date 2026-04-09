import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class WhoisConnector extends BaseConnector {
  constructor() {
    super({
      id: 'whois',
      name: 'WHOIS/RDAP',
      description: 'Domain registration data via RDAP — registrant, dates, nameservers',
      baseUrl: 'https://rdap.org',
      domains: ['infrastructure'],
      trustTier: SourceTrust.FINANCIAL_DATA,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const domain = this._extractDomain(query);
      if (!domain) return [];

      const url = `${this.baseUrl}/domain/${domain}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const d = res.data || {};
      const registrant = this._findVcard(d.entities, 'registrant');
      const registrar = this._findVcard(d.entities, 'registrar');
      const events = d.events || [];
      const registration = events.find(e => e.eventAction === 'registration')?.eventDate;
      const expiration = events.find(e => e.eventAction === 'expiration')?.eventDate;
      const lastChanged = events.find(e => e.eventAction === 'last changed')?.eventDate;

      const items = [{
        url: `https://rdap.org/domain/${domain}`,
        title: `${domain} — RDAP/WHOIS`,
        summary: `Domain ${domain}: registered ${registration || 'unknown'}, expires ${expiration || 'unknown'}, registrar: ${registrar || 'unknown'}`,
        type: EvidenceType.NEUTRAL,
        timestamp: registration || lastChanged || null,
        data: {
          domain,
          handle: d.handle,
          status: d.status,
          registrant,
          registrar,
          registration,
          expiration,
          lastChanged,
          nameservers: (d.nameservers || []).map(ns => ns.ldhName || ns.objectClassName),
          secureDNS: d.secureDNS,
        },
      }];

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _extractDomain(query) {
    const cleaned = query.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
    return cleaned.includes('.') ? cleaned : null;
  }

  _findVcard(entities, role) {
    if (!Array.isArray(entities)) return null;
    for (const entity of entities) {
      const roles = entity.roles || [];
      if (roles.includes(role)) {
        const fn = entity.vcardArray?.[1]?.find(v => v[0] === 'fn');
        return fn?.[3] || entity.handle || roles.join(', ');
      }
    }
    return null;
  }
}

export default WhoisConnector;
