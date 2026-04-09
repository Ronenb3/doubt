import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class FederalRegisterConnector extends BaseConnector {
  constructor() {
    super({
      id: 'federal_register',
      name: 'Federal Register',
      description: 'US Federal Register — proposed rules, final rules, executive orders, notices',
      baseUrl: 'https://www.federalregister.gov',
      domains: ['political', 'legal'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 10;
      const url = `${this.baseUrl}/api/v1/documents.json?conditions[term]=${encodeURIComponent(query)}&per_page=${limit}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const docs = res.data?.results || [];
      const items = docs.map(d => ({
        url: d.html_url || d.raw_text_url || `${this.baseUrl}/documents/${d.document_number}`,
        title: d.title || 'Untitled',
        summary: (d.abstract || d.title || '').slice(0, 500),
        type: EvidenceType.NEUTRAL,
        timestamp: d.publication_date || null,
        data: {
          documentNumber: d.document_number,
          type: d.type,
          subtype: d.subtype,
          agencies: (d.agencies || []).map(a => a.name),
          publicationDate: d.publication_date,
          signingDate: d.signing_date,
          citationCount: d.citation_count,
          effectiveOn: d.effective_on,
          pdfUrl: d.pdf_url,
          excerpts: d.excerpts,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default FederalRegisterConnector;
