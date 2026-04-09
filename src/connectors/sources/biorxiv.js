import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class BioRxivConnector extends BaseConnector {
  constructor() {
    super({
      id: 'biorxiv',
      name: 'bioRxiv/medRxiv',
      description: 'Preprints in biology and medicine — cutting-edge research before peer review. Forward-looking scientific intelligence.',
      baseUrl: 'https://api.biorxiv.org',
      domains: ['health', 'academic', 'science'],
      trustTier: SourceTrust.ACADEMIC_PEER,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = Math.min(options.limit || 10, 30);
      const results = [];

      // bioRxiv content API uses date ranges — search last 90 days
      // The /details endpoint provides search-like functionality
      const now = new Date();
      const ago = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const startDate = ago.toISOString().slice(0, 10);
      const endDate = now.toISOString().slice(0, 10);

      // bioRxiv
      const bioUrl = `${this.baseUrl}/details/biorxiv/${startDate}/${endDate}/0/json`;
      const bioRes = await this._fetch(bioUrl);

      if (bioRes.ok && bioRes.data?.collection) {
        const queryLower = query.toLowerCase();
        const terms = queryLower.split(/\s+/).filter(t => t.length > 3);

        const matched = bioRes.data.collection.filter(p => {
          const text = `${p.title || ''} ${p.abstract || ''} ${p.authors || ''}`.toLowerCase();
          return terms.some(t => text.includes(t));
        }).slice(0, limit);

        for (const p of matched) {
          results.push({
            url: p.doi ? `https://doi.org/${p.doi}` : `https://www.biorxiv.org`,
            title: `bioRxiv: ${(p.title || 'Untitled').slice(0, 150)}`,
            summary: [
              p.title,
              p.authors && `Authors: ${p.authors.slice(0, 100)}`,
              p.category && `Category: ${p.category}`,
              p.abstract && p.abstract.slice(0, 250),
            ].filter(Boolean).join('. ').slice(0, 500),
            type: EvidenceType.NEUTRAL,
            timestamp: p.date || null,
            data: {
              source: 'biorxiv',
              doi: p.doi,
              authors: p.authors,
              category: p.category,
              version: p.version,
              published: p.published,
              server: p.server || 'biorxiv',
            },
          });
        }
      }

      // medRxiv
      const medUrl = `${this.baseUrl}/details/medrxiv/${startDate}/${endDate}/0/json`;
      const medRes = await this._fetch(medUrl);

      if (medRes.ok && medRes.data?.collection) {
        const queryLower = query.toLowerCase();
        const terms = queryLower.split(/\s+/).filter(t => t.length > 3);

        const matched = medRes.data.collection.filter(p => {
          const text = `${p.title || ''} ${p.abstract || ''} ${p.authors || ''}`.toLowerCase();
          return terms.some(t => text.includes(t));
        }).slice(0, limit);

        for (const p of matched) {
          results.push({
            url: p.doi ? `https://doi.org/${p.doi}` : `https://www.medrxiv.org`,
            title: `medRxiv: ${(p.title || 'Untitled').slice(0, 150)}`,
            summary: [
              p.title,
              p.authors && `Authors: ${p.authors.slice(0, 100)}`,
              p.category && `Category: ${p.category}`,
              p.abstract && p.abstract.slice(0, 250),
            ].filter(Boolean).join('. ').slice(0, 500),
            type: EvidenceType.NEUTRAL,
            timestamp: p.date || null,
            data: {
              source: 'medrxiv',
              doi: p.doi,
              authors: p.authors,
              category: p.category,
              version: p.version,
              published: p.published,
              server: p.server || 'medrxiv',
            },
          });
        }
      }

      return this._toEvidence(results.slice(0, limit), options.claimId);
    } catch {
      return [];
    }
  }
}

export default BioRxivConnector;
