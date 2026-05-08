/**
 * doubt — abuse.ch Connector (Feodo Tracker + URLhaus)
 *
 * Cyber threat intelligence: command-and-control servers (Feodo Tracker)
 * and malicious URLs (URLhaus). Free, no key.
 *
 * Verifies cyber-claims:
 *   "domain X is being used for malware distribution" → check URLhaus
 *   "IP X is a known C2 server" → check Feodo Tracker
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class AbuseChConnector extends BaseConnector {
  constructor() {
    super({
      id: 'abuse_ch',
      name: 'abuse.ch — Feodo + URLhaus',
      description: 'Active C2 server tracking and malicious URL feeds from abuse.ch',
      baseUrl: 'https://urlhaus-api.abuse.ch',
      domains: ['cyber', 'general'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 20;
      const q = (query || '').trim();
      if (!q) return [];

      const isIP = /^\d{1,3}(\.\d{1,3}){3}$/.test(q);
      const isHost = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(q) && !isIP;
      const isUrl = /^https?:\/\//i.test(q);

      const items = [];

      if (isIP) {
        // Feodo Tracker IP lookup
        const feodo = await this._fetch('https://feodotracker.abuse.ch/downloads/ipblocklist.json');
        if (feodo.ok && Array.isArray(feodo.data)) {
          const hits = feodo.data.filter(e => e.ip_address === q).slice(0, limit);
          for (const h of hits) {
            items.push({
              url: `https://feodotracker.abuse.ch/browse/host/${h.ip_address}/`,
              title: `C2 server ${h.ip_address}:${h.port} (${h.malware})`,
              summary: `KNOWN COMMAND-AND-CONTROL SERVER — ${h.malware} family — ${h.status} — first seen ${h.first_seen}`,
              type: EvidenceType.SUPPORTS,
              timestamp: h.first_seen,
              data: {
                source: 'feodo_tracker',
                ip: h.ip_address,
                port: h.port,
                malware: h.malware,
                status: h.status,
                firstSeen: h.first_seen,
                lastOnline: h.last_online,
              },
            });
          }
        }
      }

      if (isHost || isUrl) {
        // URLhaus host lookup
        const body = new URLSearchParams({ host: isUrl ? new URL(q).hostname : q });
        const res = await fetch('https://urlhaus-api.abuse.ch/v1/host/', {
          method: 'POST',
          body,
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.query_status === 'ok' && Array.isArray(data.urls)) {
            for (const u of data.urls.slice(0, limit)) {
              items.push({
                url: u.urlhaus_reference || u.url,
                title: `Malicious URL on ${data.host}`,
                summary: `KNOWN MALICIOUS URL — payload: ${u.threat || 'malware'} — status: ${u.url_status} — added ${u.date_added?.slice(0, 10)}`,
                type: EvidenceType.SUPPORTS,
                timestamp: u.date_added,
                data: {
                  source: 'urlhaus',
                  host: data.host,
                  url: u.url,
                  status: u.url_status,
                  threat: u.threat,
                  tags: u.tags,
                  dateAdded: u.date_added,
                  reporter: u.reporter,
                },
              });
            }
          }
        }
      }

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default AbuseChConnector;
