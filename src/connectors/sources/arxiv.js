import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class ArxivConnector extends BaseConnector {
  constructor() {
    super({
      id: 'arxiv',
      name: 'arXiv',
      description: 'Preprint search via arXiv Atom API — physics, CS, math, bio papers',
      baseUrl: 'https://export.arxiv.org',
      domains: ['academic'],
      trustTier: 0.75,
      rateMs: 3000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 10;
      const url = `${this.baseUrl}/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}`;
      const res = await this._fetch(url, { headers: { Accept: 'application/xml' } });
      if (!res.ok) return [];

      const xml = typeof res.data === 'string' ? res.data : '';
      const items = this._parseAtom(xml);
      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _parseAtom(xml) {
    const entries = [];
    const entryBlocks = xml.split('<entry>').slice(1);

    for (const block of entryBlocks) {
      const get = (tag) => {
        const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
        return m ? m[1].trim() : '';
      };

      const linkMatch = block.match(/<link[^>]*href="([^"]*)"[^>]*type="text\/html"/);
      const pdfLink = block.match(/<link[^>]*href="([^"]*)"[^>]*title="pdf"/);
      const fallbackLink = block.match(/<link[^>]*href="([^"]*)"/);

      const authors = [];
      const authorMatches = block.matchAll(/<author>\s*<name>([^<]+)<\/name>/g);
      for (const am of authorMatches) authors.push(am[1].trim());

      entries.push({
        url: linkMatch?.[1] || fallbackLink?.[1] || '',
        title: get('title').replace(/\s+/g, ' '),
        summary: get('summary').replace(/\s+/g, ' ').slice(0, 500),
        type: EvidenceType.NEUTRAL,
        timestamp: get('published') || null,
        data: {
          authors,
          categories: (block.match(/term="([^"]+)"/g) || []).map(m => m.slice(6, -1)),
          pdfUrl: pdfLink?.[1] || '',
          arxivId: get('id'),
        },
      });
    }
    return entries;
  }
}

export default ArxivConnector;
