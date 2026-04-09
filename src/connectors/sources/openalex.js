import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class OpenAlexConnector extends BaseConnector {
  constructor() {
    super({
      id: 'openalex',
      name: 'OpenAlex',
      description: 'Open scholarly metadata — 250M+ works, authors, institutions, and citation networks',
      baseUrl: 'https://api.openalex.org',
      domains: ['academic'],
      trustTier: SourceTrust.ACADEMIC_PEER,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const perPage = options.limit || 10;
      const url = `${this.baseUrl}/works?search=${encodeURIComponent(query)}&per-page=${perPage}`;
      const res = await this._fetch(url, {
        headers: { 'User-Agent': 'doubt-investigation-engine (https://github.com/doubt)' },
      });
      if (!res.ok) return [];

      const works = res.data?.results || [];
      const items = works.map(w => {
        const authors = (w.authorships || [])
          .slice(0, 3)
          .map(a => a.author?.display_name)
          .filter(Boolean);
        const venue = w.primary_location?.source?.display_name || '';

        return {
          url: w.doi ? `https://doi.org/${w.doi.replace('https://doi.org/', '')}` : w.id,
          title: w.title || 'Untitled',
          summary: [
            w.title,
            authors.length ? `by ${authors.join(', ')}` : null,
            venue ? `in ${venue}` : null,
            w.publication_year ? `(${w.publication_year})` : null,
          ].filter(Boolean).join(' '),
          type: EvidenceType.NEUTRAL,
          timestamp: w.publication_date || null,
          data: {
            doi: w.doi,
            openAlexId: w.id,
            publicationYear: w.publication_year,
            citedByCount: w.cited_by_count,
            authors,
            venue,
            isOa: w.open_access?.is_oa,
            type: w.type,
            concepts: (w.concepts || []).slice(0, 5).map(c => c.display_name),
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default OpenAlexConnector;
