/**
 * GreyNoise Connector
 *
 * GreyNoise Community API — IP reputation, threat classification,
 * and internet scanner detection. Essential for cyber/infrastructure
 * investigations: is a domain/IP associated with malicious activity?
 *
 * Free community API key: https://viz.greynoise.io/signup
 * Key name: GREYNOISE_API_KEY
 * Without key: very limited (IP context only, low rate).
 * Trust: FINANCIAL_DATA (0.85) — sensor network, aggregated telemetry
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

class GreyNoiseConnector extends BaseConnector {
  constructor() {
    super({
      id: 'greynoise',
      name: 'GreyNoise',
      description: 'IP/domain threat intelligence — scanner detection, malicious activity, internet noise classification',
      baseUrl: 'https://api.greynoise.io/v3',
      domains: ['infrastructure', 'tech', 'compliance'],
      trustTier: SourceTrust.FINANCIAL_DATA,
      rateMs: 500,
      requiresKey: false,
      keyName: 'GREYNOISE_API_KEY',
    });
  }

  get available() {
    // Works without key but very limited; flag as available either way
    return true;
  }

  async search(query, options = {}) {
    try {
      const config = getConfig();
      const apiKey = config.keys['GREYNOISE_API_KEY'];

      const headers = { 'Accept': 'application/json' };
      if (apiKey) headers['key'] = apiKey;

      // IP address pattern
      const ipMatch = query.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
      if (ipMatch) {
        return await this._lookupIP(ipMatch[1], headers, options);
      }

      // GNQL query search (requires key)
      if (apiKey) {
        return await this._gnqlSearch(query, headers, options);
      }

      return [];
    } catch {
      return [];
    }
  }

  async _lookupIP(ip, headers, options) {
    const res = await this._fetch(
      `${this.baseUrl}/community/${ip}`,
      { headers }
    );
    if (!res.ok) return [];

    const d = res.data;
    if (d.message === 'This record does not exist') return [];

    const classification = d.classification || 'unknown';
    const isNoise = d.noise ?? false;
    const isRiot = d.riot ?? false; // Known innocuous traffic

    const item = {
      url: `https://viz.greynoise.io/ip/${ip}`,
      title: `GreyNoise: ${ip} — ${classification}`,
      summary: isRiot
        ? `${ip} is RIOT (known benign service: ${d.name || 'unknown'})`
        : `${ip} classified as ${classification}. Internet noise: ${isNoise}. ${d.message || ''}`,
      type: classification === 'malicious' ? EvidenceType.SUPPORTING : EvidenceType.CONTEXTUAL,
      timestamp: d.last_seen || null,
      data: {
        ip,
        classification,
        noise: isNoise,
        riot: isRiot,
        name: d.name,
        link: d.link,
        lastSeen: d.last_seen,
      },
    };

    return this._toEvidence([item], options.claimId);
  }

  async _gnqlSearch(query, headers, options) {
    const params = new URLSearchParams({
      query,
      size: String(options.limit || 10),
    });

    const res = await this._fetch(
      `https://api.greynoise.io/v2/experimental/gnql?${params}`,
      { headers }
    );
    if (!res.ok) return [];

    const data = res.data?.data || [];
    const items = data.map(d => ({
      url: `https://viz.greynoise.io/ip/${d.ip}`,
      title: `GreyNoise: ${d.ip} — ${d.classification || 'unknown'}`,
      summary: `IP ${d.ip} (${d.country || 'unknown country'}) — classified: ${d.classification}. Last seen: ${d.last_seen || 'unknown'}.`,
      type: d.classification === 'malicious' ? EvidenceType.SUPPORTING : EvidenceType.CONTEXTUAL,
      timestamp: d.last_seen || null,
      data: {
        ip: d.ip,
        classification: d.classification,
        country: d.country,
        org: d.organization,
        tags: d.tags,
      },
    }));

    return this._toEvidence(items, options.claimId);
  }
}

export default GreyNoiseConnector;
