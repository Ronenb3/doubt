import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class NewsIntelConnector extends BaseConnector {
  constructor() {
    super({
      id: 'news_intel',
      name: 'News Intelligence',
      description: 'GDELT-based news volume and tone analysis — media attention signals',
      baseUrl: 'https://api.gdeltproject.org/api/v2',
      domains: ['news'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 6000,
    });
  }

  async search(query, options = {}) {
    try {
      const items = [];

      const volumeResults = await this._volumeTrend(query, options);
      items.push(...volumeResults);

      const articleResults = await this._articleSearch(query, options);
      items.push(...articleResults);

      return this._toEvidence(items.slice(0, options.limit || 15), options.claimId);
    } catch {
      return [];
    }
  }

  async _volumeTrend(query, options) {
    const params = new URLSearchParams({
      query: query,
      mode: 'timelinevolinfo',
      format: 'json',
      sourcelang: 'eng',
    });
    params.set('timespan', options.timespan || '3months');

    const url = `${this.baseUrl}/doc/doc?${params}`;
    const res = await this._fetch(url, { timeout: 30000 });
    if (!res.ok) return [];

    const timeline = res.data?.timeline || [];
    if (timeline.length === 0) return [];

    const series = timeline[0]?.data || [];
    const totalVolume = series.reduce((sum, d) => sum + (d.value || 0), 0);
    const peak = series.reduce((max, d) => (d.value || 0) > (max.value || 0) ? d : max, { value: 0 });

    return [{
      url: `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=timelinevolinfo`,
      title: `${query} — News Volume Trend`,
      summary: `Media coverage for "${query}": ${totalVolume} total mentions, peak at ${peak.date || 'unknown'} (${peak.value || 0} articles)`,
      type: EvidenceType.CONTEXTUAL,
      timestamp: peak.date || null,
      data: {
        totalVolume,
        peakDate: peak.date,
        peakValue: peak.value,
        dataPoints: series.length,
        timelineSample: series.slice(-5),
      },
    }];
  }

  async _articleSearch(query, options) {
    const params = new URLSearchParams({
      query: query,
      mode: 'artlist',
      maxrecords: String(options.limit || 10),
      format: 'json',
      timespan: '3months',
      sourcelang: 'eng',
    });

    const url = `${this.baseUrl}/doc/doc?${params}`;
    const res = await this._fetch(url, { timeout: 30000 });
    if (!res.ok) return [];

    const articles = res.data?.articles || [];
    return articles.slice(0, options.limit || 10).map(a => ({
      url: a.url || '',
      title: a.title || query,
      summary: `${a.title || ''} — ${a.domain || 'unknown source'} (tone: ${a.tone ? a.tone.toFixed(1) : 'N/A'})`,
      type: EvidenceType.CONTEXTUAL,
      timestamp: a.seendate ? this._parseGdeltDate(a.seendate) : null,
      data: {
        title: a.title,
        domain: a.domain,
        language: a.language,
        sourcecountry: a.sourcecountry,
        tone: a.tone,
        socialimage: a.socialimage,
      },
    }));
  }

  _parseGdeltDate(dateStr) {
    if (!dateStr || dateStr.length < 8) return null;
    const y = dateStr.slice(0, 4);
    const m = dateStr.slice(4, 6);
    const d = dateStr.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
}

export default NewsIntelConnector;
