import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class PubMedConnector extends BaseConnector {
  constructor() {
    super({
      id: 'pubmed',
      name: 'PubMed',
      description: 'Biomedical literature via NCBI E-utilities — abstracts, MeSH terms, citations',
      baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
      domains: ['academic', 'health'],
      trustTier: SourceTrust.FINANCIAL_DATA,
      rateMs: 400,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 10;
      const searchUrl = `${this.baseUrl}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${limit}`;
      const searchRes = await this._fetch(searchUrl);
      if (!searchRes.ok) return [];

      const ids = searchRes.data?.esearchresult?.idlist || [];
      if (ids.length === 0) return [];

      const detailUrl = `${this.baseUrl}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
      const detailRes = await this._fetch(detailUrl);
      if (!detailRes.ok) return [];

      const result = detailRes.data?.result || {};
      const items = ids.map(id => {
        const r = result[id];
        if (!r) return null;
        const authors = (r.authors || []).map(a => a.name);
        return {
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
          title: r.title || 'Untitled',
          summary: `${r.title || ''} — ${r.source || ''} (${r.pubdate || ''})`,
          type: EvidenceType.NEUTRAL,
          timestamp: r.pubdate || null,
          data: {
            pmid: id,
            journal: r.source,
            pubDate: r.pubdate,
            authors,
            doi: r.elocationid || null,
            pubTypes: r.pubtype || [],
          },
        };
      }).filter(Boolean);

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default PubMedConnector;
