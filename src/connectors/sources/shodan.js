import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * Shodan Connector
 *
 * Search engine for Internet-connected devices and infrastructure.
 * Free API key at https://shodan.io — gives access to search API.
 * Membership ($49 one-time) unlocks full search.
 *
 * Use cases in investigations:
 *   - Attribute IP infrastructure to organizations
 *   - Expose open/vulnerable systems tied to a company
 *   - Verify whether claimed infrastructure exists
 *   - Cyber threat actor attribution via ASN/cert/banner data
 *
 * Query syntax supports Shodan filters: org:, hostname:, country:,
 * port:, product:, net:, ssl.cert.subject.cn:, etc.
 *
 * Set env: SHODAN_API_KEY=your_key
 */
class ShodanConnector extends BaseConnector {
  constructor() {
    super({
      id: 'shodan',
      name: 'Shodan',
      description: 'Internet infrastructure search — devices, services, vulnerabilities, certificate data by org/IP',
      baseUrl: 'https://api.shodan.io',
      domains: ['security', 'osint'],
      trustTier: SourceTrust.OPEN_SOURCE,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    const apiKey = process.env.SHODAN_API_KEY;
    if (!apiKey) return [];

    try {
      // Build a Shodan search query
      // If query looks like an org name, wrap it in org: filter
      // Otherwise pass as-is to support raw Shodan syntax
      const shodanQuery = /^[\w\s.\-]+$/.test(query) && !query.includes(':')
        ? `org:"${query}"` : query;

      const params = new URLSearchParams({
        key: apiKey,
        query: shodanQuery,
        page: '1',
      });

      const res = await this._fetch(`${this.baseUrl}/shodan/host/search?${params}`);
      if (!res.ok) return [];

      const matches = res.data?.matches || [];
      const total = res.data?.total || 0;

      const items = matches.slice(0, options.limit || 10).map(h => {
        const org = h.org || h.isp || 'Unknown';
        const ip = h.ip_str || '';
        const ports = (h.ports || [h.port]).filter(Boolean).join(', ');
        const product = h.product || h.info || '';
        const os = h.os || '';
        const vulns = Object.keys(h.vulns || {}).slice(0, 5);
        const hostnames = (h.hostnames || []).slice(0, 3).join(', ');
        const country = h.location?.country_name || h.location?.country_code || '';

        return {
          url: ip ? `https://www.shodan.io/host/${ip}` : 'https://www.shodan.io/',
          title: `${org} — ${ip}${hostnames ? ' (' + hostnames.split(',')[0] + ')' : ''}`,
          summary: [
            `IP: ${ip}`,
            org ? `Org: ${org}` : null,
            country ? `Country: ${country}` : null,
            ports ? `Ports: ${ports}` : null,
            product ? `Product: ${product}` : null,
            os ? `OS: ${os}` : null,
            vulns.length ? `CVEs: ${vulns.join(', ')}` : null,
          ].filter(Boolean).join(' | '),
          type: EvidenceType.SUPPORTS,
          timestamp: h.timestamp ? new Date(h.timestamp).toISOString() : null,
          data: {
            ip,
            org,
            isp: h.isp,
            asn: h.asn,
            hostnames: h.hostnames,
            ports: h.ports || [h.port],
            product,
            os,
            country,
            city: h.location?.city,
            lat: h.location?.latitude,
            lon: h.location?.longitude,
            vulns: Object.keys(h.vulns || {}),
            tags: h.tags,
            totalMatches: total,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default ShodanConnector;
