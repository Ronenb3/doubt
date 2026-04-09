import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class GitHubConnector extends BaseConnector {
  constructor() {
    super({
      id: 'github',
      name: 'GitHub',
      description: 'GitHub repository search — open source projects, code, and developer activity',
      baseUrl: 'https://api.github.com',
      domains: ['tech'],
      trustTier: SourceTrust.NEWS_MINOR,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const sort = options.sort || 'stars';
      const perPage = options.limit || 15;
      const url = `${this.baseUrl}/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&per_page=${perPage}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const repos = res.data?.items || [];
      const items = repos.map(r => ({
        url: r.html_url,
        title: `${r.full_name} (★${r.stargazers_count.toLocaleString()})`,
        summary: r.description || `${r.full_name} — ${r.language || 'unknown'} repository`,
        type: EvidenceType.CONTEXTUAL,
        timestamp: r.updated_at || r.pushed_at || null,
        data: {
          name: r.full_name,
          stars: r.stargazers_count,
          description: r.description,
          language: r.language,
          forks: r.forks_count,
          openIssues: r.open_issues_count,
          license: r.license?.spdx_id,
          topics: r.topics,
          updated: r.updated_at,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default GitHubConnector;
