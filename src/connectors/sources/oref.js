/**
 * doubt — OREF Connector (Israel Home Front Command)
 *
 * Real-time rocket / missile / hostile-aircraft alert feed published by
 * pikud-haoref (Israel's Home Front Command). Used to verify claims like
 * "rockets fired at Tel Aviv" or "siren sounded in Sderot at HH:MM."
 *
 * Public endpoints (no key, no auth):
 *   https://www.oref.org.il/WarningMessages/alert/alerts.json   — active alerts
 *   https://www.oref.org.il/WarningMessages/History/AlertsHistory.json — recent history
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class OREFConnector extends BaseConnector {
  constructor() {
    super({
      id: 'oref',
      name: 'OREF — Israel Home Front Command',
      description: 'Real-time rocket / missile / aircraft alert feed from Israel\'s Home Front Command',
      baseUrl: 'https://www.oref.org.il',
      domains: ['geopolitical', 'military', 'general'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1500,
      skipPrecheck: true, // root path is a SPA, prechecker can mark it dead
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 25;
      const q = (query || '').trim().toLowerCase();
      const tokens = q.split(/\s+/).filter(w => w.length > 2);

      // Pull active and history in parallel — both are flat JSON arrays.
      const [active, history] = await Promise.all([
        this._fetch('https://www.oref.org.il/WarningMessages/alert/alerts.json'),
        this._fetch('https://www.oref.org.il/WarningMessages/History/AlertsHistory.json'),
      ]);

      const events = [];

      if (active.ok && active.data && Array.isArray(active.data.data)) {
        for (const city of active.data.data) {
          events.push({
            city,
            category: active.data.cat || 'rocket',
            title: active.data.title || 'Rocket alert',
            time: new Date().toISOString(),
            isActive: true,
          });
        }
      }

      if (history.ok && Array.isArray(history.data)) {
        for (const h of history.data.slice(0, 500)) {
          events.push({
            city: h.data,
            category: h.category_desc || h.category || 'alert',
            title: h.title || 'Alert',
            time: h.alertDate, // "YYYY-MM-DD HH:mm:ss"
            isActive: false,
          });
        }
      }

      if (events.length === 0) return [];

      // Score by query overlap on city + category + title; if no query, take most recent.
      const scored = events.map(e => {
        const blob = `${e.city || ''} ${e.category || ''} ${e.title || ''}`.toLowerCase();
        const overlap = tokens.filter(t => blob.includes(t)).length;
        return { e, overlap };
      });

      const matched = scored.filter(s => s.overlap > 0).sort((a, b) => b.overlap - a.overlap);
      const list = (matched.length > 0 ? matched : scored).slice(0, limit).map(s => s.e);

      const items = list.map(e => {
        const ts = e.time && e.time.includes(' ')
          ? e.time.replace(' ', 'T') + 'Z'
          : e.time;
        return {
          url: 'https://www.oref.org.il/',
          title: `${e.title} — ${e.city}`,
          summary: [
            'ISRAEL HOME FRONT ALERT',
            (e.category || '').toUpperCase(),
            e.city,
            e.isActive ? '(ACTIVE)' : null,
            ts ? `at ${ts.slice(0, 16).replace('T', ' ')}` : null,
          ].filter(Boolean).join(' — '),
          // An OREF alert is direct corroboration that a siren / impact event occurred.
          type: EvidenceType.SUPPORTS,
          timestamp: ts || null,
          data: {
            city: e.city,
            category: e.category,
            title: e.title,
            time: e.time,
            isActive: e.isActive,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default OREFConnector;
