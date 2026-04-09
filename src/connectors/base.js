/**
 * doubt — Base Connector
 *
 * Every data source extends this. Enforces rate limiting,
 * timeout, retry, normalization, and trust scoring.
 *
 * A connector's only job: given a query, return evidence.
 * The evidence schema is universal. The connector handles
 * the specific API, the parsing, the normalization.
 * Everything downstream treats all evidence identically.
 */

import { getConfig, rateLimit, log } from '../core/config.js';
import { createEvidence, EvidenceType, SourceTrust } from '../core/schema.js';

// Extend the default undici connect timeout (10s) to 30s so slow APIs (GDELT etc) don't abort at TCP handshake
try {
  const { Agent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new Agent({ connect: { timeout: 30000 } }));
} catch (_) { /* undici unavailable — use Node defaults */ }

export class BaseConnector {
  constructor({
    id,
    name,
    description = '',
    baseUrl = '',
    domains = [],
    trustTier = SourceTrust.NEWS_MINOR,
    rateMs = 1000,
    requiresKey = false,
    keyName = null,
  }) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.baseUrl = baseUrl;
    this.domains = domains;
    this.trustTier = trustTier;
    this.rateMs = rateMs;
    this.requiresKey = requiresKey;
    this.keyName = keyName;
    this._cache = new Map();
  }

  get available() {
    if (!this.requiresKey) return true;
    const config = getConfig();
    return !!config.keys[this.keyName];
  }

  async search(query, options = {}) {
    throw new Error(`${this.id}: search() not implemented`);
  }

  async _fetch(url, options = {}) {
    const config = getConfig();
    const host = new URL(url).hostname;

    await rateLimit(host, this.rateMs);

    const timeout = options.timeout || config.connectors.timeout;
    const retries = options.retries ?? config.connectors.retries;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': config.connectors.userAgent,
            'Accept': 'application/json',
            ...options.headers,
          },
          signal: AbortSignal.timeout(timeout),
          ...options,
        });

        if (resp.status === 429) {
          const raw = parseInt(resp.headers.get('retry-after') || '5');
          const retryAfter = Math.min(raw, 10) * 1000; // cap at 10s — never wait forever
          log('warn', `${this.id}: rate limited, waiting ${retryAfter}ms`);
          await new Promise(r => setTimeout(r, retryAfter));
          continue;
        }

        if (!resp.ok) {
          if (attempt < retries) continue;
          return { ok: false, status: resp.status, error: resp.statusText };
        }

        const ct = resp.headers.get('content-type') || '';
        const data = ct.includes('json') ? await resp.json() : await resp.text();
        return { ok: true, data, status: resp.status };
      } catch (err) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, config.connectors.retryDelay * (attempt + 1)));
          continue;
        }
        return { ok: false, error: err.message };
      }
    }
    return { ok: false, error: 'max retries exceeded' };
  }

  /**
   * Normalize connector-specific results into universal evidence objects.
   * Subclasses implement _normalize. This wrapper adds connector metadata.
   */
  _toEvidence(items, claimId = null) {
    return items.map(item => {
      const ev = createEvidence({
        type: item.type || EvidenceType.NEUTRAL,
        claimId,
        connectorId: this.id,
        sourceUrl: item.url || item.sourceUrl || '',
        summary: item.summary || item.title || '',
        data: item.data || item,
        trustWeight: item.trustWeight || this.trustTier,
        timestamp: item.timestamp || item.date || null,
      });
      // Preserve the static source-type label separately from the dynamic trustWeight.
      // trustWeight gets modified by propagation/toxicity analysis; connectorTrustTier never does.
      // The report uses connectorTrustTier to label what KIND of source this is (peer-reviewed,
      // major news, etc.) independently of how credible this specific item turned out to be.
      ev.connectorTrustTier = this.trustTier;
      return ev;
    });
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      domains: this.domains,
      trustTier: this.trustTier,
      requiresKey: this.requiresKey,
      available: this.available,
    };
  }
}
