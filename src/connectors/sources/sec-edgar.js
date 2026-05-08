import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

// SEC EDGAR requires a specific User-Agent format or returns 403.
// Format: "tool-name contact@email.com"
// Reference: https://www.sec.gov/os/accessing-edgar-data
const SEC_USER_AGENT = 'doubt-research/1.0 contact@doubt.tools';

// High-value keywords to extract from filing text.
// Each match becomes a separate evidence item with the surrounding context.
const KEYSTONE_KEYWORDS = [
  'customer concentration', 'largest customer', 'percent of revenue', '% of revenue',
  'revenue from', 'significant customer', 'top customer', 'major customer',
  'risk factor', 'competition', 'competitive advantage', 'market share',
  'dependence on', 'material weakness', 'going concern',
  'related party', 'litigation', 'legal proceeding',
  'intellectual property', 'government contract', 'regulatory',
];

class SECEdgarConnector extends BaseConnector {
  constructor() {
    super({
      id: 'sec_edgar',
      name: 'SEC EDGAR',
      description: 'SEC filings with full document content: 10-K, S-1, 8-K. Extracts actual financial data, customer concentration, risk factors from primary documents.',
      baseUrl: 'https://efts.sec.gov',
      domains: ['financial', 'corporate'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1200,
      skipPrecheck: true,
    });
  }

  async _fetch(url, options = {}) {
    return super._fetch(url, {
      ...options,
      headers: { 'User-Agent': SEC_USER_AGENT, ...options.headers },
    });
  }

  async search(query, options = {}) {
    try {
      const companyName = options.companyName || this._extractCompanyName(query);
      const allItems = [];

      // Step 1: Resolve CIK from company name via EFTS search
      const cik = await this._resolveCIK(companyName || query);

      if (cik) {
        // Step 2: Get filing list from EDGAR submissions API (authoritative, structured)
        const filings = await this._getFilings(cik, companyName || query);

        // Step 3: Fetch content from the most important filings
        // Priority: 10-K (annual) > S-1 (IPO) > 10-Q (quarterly) > 8-K (events)
        const priority = ['10-K', 'S-1', 'S-1/A', '10-Q', '8-K'];
        const sorted = filings.sort((a, b) => {
          const ai = priority.indexOf(a.form);
          const bi = priority.indexOf(b.form);
          if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          return new Date(b.date) - new Date(a.date); // most recent first
        });

        for (const filing of sorted.slice(0, 4)) {
          const items = await this._fetchFilingContent(filing, cik, query);
          allItems.push(...items);
          await new Promise(r => setTimeout(r, 400));
        }
      }

      // Step 4: Also run EFTS full-text search for cross-filing mentions
      const eftsItems = await this._eftsSearch(companyName || query, options);
      allItems.push(...eftsItems);

      // Deduplicate
      const seen = new Set();
      return this._toEvidence(
        allItems.filter(item => {
          const key = `${item.data?.adsh || item.url}:${(item.summary || '').slice(0, 60)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
        options.claimId
      );
    } catch {
      return [];
    }
  }

  // ── CIK Resolution ───────────────────────────────────────────

  async _resolveCIK(query) {
    try {
      // Use EDGAR company search to find CIK
      const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(query)}%22&forms=10-K,S-1`;
      const res = await this._fetch(url);
      if (!res.ok) return null;
      const hits = res.data?.hits?.hits || [];
      if (!hits.length) return null;
      const ciks = hits[0]._source?.ciks || [];
      return ciks[0] ? ciks[0].replace(/^0+/, '') : null;
    } catch {
      return null;
    }
  }

  // ── Submissions API ──────────────────────────────────────────

  async _getFilings(cik, companyName) {
    try {
      const paddedCIK = cik.padStart(10, '0');
      const res = await this._fetch(`https://data.sec.gov/submissions/CIK${paddedCIK}.json`);
      if (!res.ok) return [];

      const recent = res.data?.filings?.recent || {};
      const forms = recent.form || [];
      const dates = recent.filingDate || [];
      const accessions = recent.accessionNumber || [];
      const primaryDocs = recent.primaryDocument || [];
      const descriptions = recent.primaryDocDescription || [];

      const relevantForms = new Set(['10-K', 'S-1', 'S-1/A', '10-Q', '8-K']);
      const filings = [];

      for (let i = 0; i < forms.length && filings.length < 10; i++) {
        if (!relevantForms.has(forms[i])) continue;
        filings.push({
          form: forms[i],
          date: dates[i],
          adsh: accessions[i],
          primaryDoc: primaryDocs[i],
          description: descriptions[i] || '',
          companyName,
          cik,
        });
      }

      return filings;
    } catch {
      return [];
    }
  }

  // ── Full Document Fetch ──────────────────────────────────────

  async _fetchFilingContent(filing, cik, query) {
    try {
      if (!filing.primaryDoc || !filing.adsh) return [this._metadataItem(filing)];

      // Build URL to primary document using accession number
      const adshPath = filing.adsh.replace(/-/g, '');
      const docUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${adshPath}/${filing.primaryDoc}`;

      const html = await this._fetchRaw(docUrl);
      if (!html || html.length < 500) return [this._metadataItem(filing)];

      return this._extractSections(html, query, filing);
    } catch {
      return [this._metadataItem(filing)];
    }
  }

  async _fetchRaw(url) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': SEC_USER_AGENT },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  // ── Section Extraction ───────────────────────────────────────

  _extractSections(html, query, filing) {
    // Clean HTML to plain text
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const items = [];
    const textLower = text.toLowerCase();
    const companyFirst = (filing.companyName || '').split(' ')[0].toLowerCase();

    for (const keyword of KEYSTONE_KEYWORDS) {
      let searchFrom = 0;
      // Find up to 2 occurrences of each keyword (filings repeat sections)
      for (let occurrence = 0; occurrence < 2; occurrence++) {
        const idx = textLower.indexOf(keyword.toLowerCase(), searchFrom);
        if (idx < 0) break;
        searchFrom = idx + keyword.length;

        const start = Math.max(0, idx - 150);
        const end = Math.min(text.length, idx + 1000);
        const snippet = text.slice(start, end).trim();

        // Skip if snippet doesn't mention the company or core entity
        const snippetLower = snippet.toLowerCase();
        if (!snippetLower.includes(companyFirst) && occurrence === 0) continue;

        // Skip XBRL/XML artifacts (not human-readable)
        if (snippet.includes('<DOCUMENT>') || snippet.includes('xmlns:') || snippet.match(/^[A-Z0-9_:]+\s*=/)) continue;

        items.push({
          url: `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.adsh.replace(/-/g, '')}/${filing.primaryDoc}`,
          title: `${filing.companyName} ${filing.form} (${filing.date}) — ${keyword}`,
          summary: `[SEC ${filing.form} ${filing.date}] ${snippet}`,
          type: this._inferStance(snippet),
          timestamp: filing.date || null,
          trustWeight: SourceTrust.GOVERNMENT_FILING,
          data: {
            formType: filing.form,
            entityName: filing.companyName,
            fileDate: filing.date,
            adsh: filing.adsh,
            section: keyword,
            source: 'full_document_content',
          },
        });
      }
    }

    if (items.length === 0) return [this._metadataItem(filing)];

    // Deduplicate overlapping snippets
    const seen = new Set();
    return items
      .filter(item => {
        const key = item.summary.slice(0, 100);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 10);
  }

  _inferStance(snippet) {
    const s = snippet.toLowerCase();
    const contradictPatterns = [
      /customer.{0,30}concentration/i, /\d+\s*%\s*(of\s*)?revenue.{0,30}(from|customer)/i,
      /significant.{0,20}customer/i, /depend.{0,20}(on|upon).{0,30}customer/i,
      /top\s+(two|three|\d)\s+customer/i, /largest\s+customer/i,
      /material\s+weakness/i, /going\s+concern/i, /risk\s+factor/i,
      /intense\s+competition/i, /unable\s+to\s+compet/i,
    ];
    if (contradictPatterns.some(p => p.test(snippet))) return EvidenceType.CONTRADICTS;

    const supportPatterns = [
      /competitive\s+advantage/i, /market\s+leader/i, /strong\s+growth/i,
      /revenue\s+(grew|increased|grew)/i, /profitable/i, /differentiat/i,
    ];
    if (supportPatterns.some(p => p.test(snippet))) return EvidenceType.SUPPORTS;

    return EvidenceType.CONTEXTUAL;
  }

  _metadataItem(filing) {
    return {
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filing.cik}&type=${filing.form}`,
      title: `${filing.companyName} — ${filing.form} (${filing.date})`,
      summary: `SEC ${filing.form} filing by ${filing.companyName} dated ${filing.date}. ${filing.description || 'Primary regulatory disclosure.'}`,
      type: EvidenceType.NEUTRAL,
      timestamp: filing.date || null,
      data: {
        formType: filing.form,
        entityName: filing.companyName,
        fileDate: filing.date,
        adsh: filing.adsh,
        source: 'metadata',
      },
    };
  }

  // ── EFTS Full-Text Search ────────────────────────────────────

  async _eftsSearch(query, options = {}) {
    try {
      const forms = options.formType || 'S-1,10-K,10-Q,8-K,SC 13G,4';
      const params = new URLSearchParams({ q: `"${query}"`, forms });
      if (options.dateRange?.start) {
        params.set('dateRange', 'custom');
        params.set('startdt', options.dateRange.start);
      }

      const res = await this._fetch(`${this.baseUrl}/LATEST/search-index?${params}`);
      if (!res.ok) return [];

      return (res.data?.hits?.hits || []).slice(0, 5).map(hit => {
        const src = hit._source || {};
        const ciks = src.ciks || [];
        const cik = (ciks[0] || '').replace(/^0+/, '');
        const adsh = src.adsh || '';
        const adshPath = adsh.replace(/-/g, '');
        const entityName = (src.display_names || ['Unknown'])[0].split('(')[0].trim();
        const form = (src.root_forms || [''])[0];

        return {
          url: `https://www.sec.gov/Archives/edgar/data/${cik}/${adshPath}/`,
          title: `${entityName} — ${form} (${src.file_date || ''})`,
          summary: `SEC ${form} filing by ${entityName} dated ${src.file_date || 'unknown'}. ${src.file_description || 'Regulatory disclosure.'}`,
          type: EvidenceType.NEUTRAL,
          timestamp: src.file_date || null,
          data: {
            formType: form,
            entityName,
            fileDate: src.file_date,
            adsh,
            cik,
            source: 'efts_search',
          },
        };
      });
    } catch {
      return [];
    }
  }

  _extractCompanyName(query) {
    const cleaned = query
      .replace(/\b(has|have|is|are|was|were|the|a|an|its|their|this|that)\b/gi, '')
      .replace(/\b(competitive|moat|market|independent|provider|platform|company|startup|firm|corp|inc|llc|durable|cloud|gpu)\b/gi, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleaned.split(' ').filter(w => w.length > 2);
    if (words.length === 0) return null;
    return words.slice(0, 3).join(' ');
  }
}

export default SECEdgarConnector;
