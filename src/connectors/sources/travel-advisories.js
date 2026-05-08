/**
 * doubt — Travel Advisories Connector
 *
 * Government travel advisories from three Five Eyes governments:
 *   • US Department of State — travel.state.gov advisory levels (1–4)
 *   • UK FCDO — gov.uk foreign-travel-advice
 *   • Australian DFAT — smartraveller.gov.au
 *
 * Verifies geopolitical / safety claims:
 *   "Country X is unsafe for travel"
 *   "Region Y has been issued a do-not-travel warning"
 *
 * All three publish public RSS / JSON feeds. No keys.
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class TravelAdvisoriesConnector extends BaseConnector {
  constructor() {
    super({
      id: 'travel_advisories',
      name: 'Travel Advisories — US/UK/AU',
      description: 'Aggregated government travel advisories: US State Dept, UK FCDO, Australian DFAT',
      baseUrl: 'https://travel.state.gov',
      domains: ['geopolitical', 'general'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1500,
      skipPrecheck: true, // advisory landing pages return 403 to HEAD
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 20;
      const q = (query || '').trim().toLowerCase();
      const tokens = q.split(/\s+/).filter(w => w.length > 2);
      const focus = this._extractFocus(q);

      // Pull all three feeds in parallel, but cap wait time per source so one
      // slow government endpoint does not stall the whole user task.
      const settled = await Promise.allSettled([
        this._fetchUS(),
        this._fetchUK(),
        this._fetchAU(),
      ]);

      const all = settled
        .filter(result => result.status === 'fulfilled')
        .flatMap(result => result.value);
      if (all.length === 0) return [];

      const scored = all.map(a => {
        const blob = `${a.country || ''} ${a.title || ''} ${a.summary || ''}`.toLowerCase();
        const overlap = tokens.filter(t => blob.includes(t)).length;
        const exactFocus = focus && (
          `${a.country || ''}`.toLowerCase() === focus
          || `${a.title || ''}`.toLowerCase().includes(focus)
        );
        return { a, overlap, exactFocus };
      });

      const exact = scored.filter(s => s.exactFocus);
      const matched = scored.filter(s => s.overlap > 0);
      const list = (exact.length > 0 ? exact : matched.length > 0 ? matched : scored)
        .sort((x, y) => {
          if ((y.exactFocus ? 1 : 0) !== (x.exactFocus ? 1 : 0)) {
            return (y.exactFocus ? 1 : 0) - (x.exactFocus ? 1 : 0);
          }
          if (y.overlap !== x.overlap) return y.overlap - x.overlap;
          return (y.a.severity || 0) - (x.a.severity || 0);
        })
        .slice(0, limit)
        .map(s => s.a);

      const items = list.map(a => ({
        url: a.link,
        title: `${a.source} — ${a.country}: ${a.title}`,
        summary: [
          'TRAVEL ADVISORY',
          a.source,
          a.country,
          a.levelText ? `level: ${a.levelText}` : null,
          a.published ? `published ${a.published.slice(0, 10)}` : null,
        ].filter(Boolean).join(' — '),
        // Level 3+ (US) or "avoid all/all but essential" (UK) supports unsafe-claims.
        type: (a.severity || 0) >= 3 ? EvidenceType.SUPPORTS : EvidenceType.CONTEXTUAL,
        timestamp: a.published || null,
        data: {
          source: a.source,
          country: a.country,
          level: a.level,
          levelText: a.levelText,
          severity: a.severity,
          link: a.link,
          published: a.published,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  async _fetchUS() {
    // travel.state.gov publishes a JSON list of all current advisories.
    const r = await this._fetch('https://travel.state.gov/_res/rss/TAsTWs.xml', {
      timeout: 5000,
      retries: 0,
    });
    if (!r.ok || typeof r.data !== 'string') return [];
    return this._parseRSS(r.data, 'US State Dept', /level\s+(\d)/i);
  }

  async _fetchUK() {
    // FCDO publishes one HTML page per country. Their search index is in a JSON feed.
    const r = await this._fetch('https://www.gov.uk/api/search.json?filter_organisations=foreign-commonwealth-development-office&filter_format=travel_advice&count=40&fields=title,link,public_timestamp,description', {
      timeout: 5000,
      retries: 0,
    });
    if (!r.ok || !r.data) return [];
    const results = r.data.results || [];
    return results.map(x => {
      const title = x.title || '';
      const desc = x.description || '';
      const sev = this._severityFromUK(desc);
      return {
        source: 'UK FCDO',
        country: title.replace(/^travel advice:?\s*/i, '').trim(),
        title,
        summary: desc,
        link: 'https://www.gov.uk' + (x.link || ''),
        published: x.public_timestamp,
        level: sev.level,
        levelText: sev.levelText,
        severity: sev.severity,
      };
    });
  }

  async _fetchAU() {
    // DFAT publishes an RSS feed of advisory updates.
    const r = await this._fetch('https://www.smartraveller.gov.au/countries/feed.rss', {
      timeout: 5000,
      retries: 0,
    });
    if (!r.ok || typeof r.data !== 'string') return [];
    return this._parseRSS(r.data, 'AU DFAT', /(reconsider|do not travel|exercise|normal precautions)/i);
  }

  _extractFocus(query) {
    return `${query || ''}`
      .replace(/\b(travel|advisory|advice|warning|warnings|risk|safe|unsafe)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _parseRSS(xml, source, levelRe) {
    const items = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRe.exec(xml)) !== null) {
      const block = m[1];
      const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
      const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
      const desc = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
      const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
      const sev = source === 'US State Dept'
        ? this._severityFromUS(title + ' ' + desc, levelRe)
        : this._severityFromAU(title + ' ' + desc);
      items.push({
        source,
        country: title.split(/[—\-:]/)[0].trim(),
        title: title.trim(),
        summary: desc.replace(/<[^>]+>/g, '').trim(),
        link: link.trim(),
        published: pub ? new Date(pub).toISOString() : null,
        level: sev.level,
        levelText: sev.levelText,
        severity: sev.severity,
      });
    }
    return items;
  }

  _severityFromUS(blob, re) {
    const m = blob.match(re);
    if (!m) return { level: null, levelText: 'unknown', severity: 0 };
    const lvl = parseInt(m[1], 10);
    const map = { 1: 'normal precautions', 2: 'increased caution', 3: 'reconsider travel', 4: 'do not travel' };
    return { level: lvl, levelText: map[lvl] || 'unknown', severity: lvl };
  }

  _severityFromUK(blob) {
    const b = (blob || '').toLowerCase();
    if (/advise against all travel/.test(b)) return { level: 4, levelText: 'all travel', severity: 4 };
    if (/advise against all but essential/.test(b)) return { level: 3, levelText: 'all but essential', severity: 3 };
    return { level: 1, levelText: 'standard', severity: 1 };
  }

  _severityFromAU(blob) {
    const b = (blob || '').toLowerCase();
    if (/do not travel/.test(b)) return { level: 4, levelText: 'do not travel', severity: 4 };
    if (/reconsider your need to travel/.test(b)) return { level: 3, levelText: 'reconsider', severity: 3 };
    if (/high degree of caution/.test(b)) return { level: 2, levelText: 'high caution', severity: 2 };
    return { level: 1, levelText: 'normal precautions', severity: 1 };
  }
}

export default TravelAdvisoriesConnector;
