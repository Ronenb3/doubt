import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

const INFRA_CATEGORIES = {
  api: 'api_endpoint',
  prod: 'production',
  staging: 'staging',
  internal: 'internal',
  auth: 'authentication',
  admin: 'admin_panel',
  worker: 'worker_service',
  ml: 'machine_learning',
  model: 'machine_learning',
};

class CrtShConnector extends BaseConnector {
  constructor() {
    super({
      id: 'crt_sh',
      name: 'crt.sh Certificate Transparency',
      description: 'Certificate transparency logs — discover subdomains and infrastructure via SSL certificates',
      baseUrl: 'https://crt.sh',
      domains: ['infrastructure', 'corporate'],
      trustTier: SourceTrust.PRIMARY_DOCUMENT,
      rateMs: 2000,
    });
  }

  _categorize(name) {
    const lower = name.toLowerCase();
    for (const [keyword, category] of Object.entries(INFRA_CATEGORIES)) {
      if (lower.includes(keyword)) return category;
    }
    return 'standard';
  }

  async search(query, options = {}) {
    try {
      const url = `${this.baseUrl}/?q=${encodeURIComponent(query)}&output=json`;
      const res = await this._fetch(url);
      if (!res.ok || !Array.isArray(res.data)) return [];

      const seen = new Set();
      const unique = res.data.filter(cert => {
        const name = cert.name_value;
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      });

      const items = unique.slice(0, options.limit || 30).map(cert => ({
        url: `${this.baseUrl}/?id=${cert.id}`,
        title: cert.name_value,
        summary: `Certificate for ${cert.name_value} issued by ${cert.issuer_name || 'unknown CA'}`,
        type: EvidenceType.CONTEXTUAL,
        timestamp: cert.entry_timestamp || null,
        data: {
          nameValue: cert.name_value,
          issuer: cert.issuer_name,
          notBefore: cert.not_before,
          notAfter: cert.not_after,
          serialNumber: cert.serial_number,
          infraCategory: this._categorize(cert.name_value),
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default CrtShConnector;
