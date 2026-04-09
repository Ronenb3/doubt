import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

class GitHubDeepConnector extends BaseConnector {
  constructor() {
    super({
      id: 'github_deep',
      name: 'GitHub Deep',
      description: 'GitHub code search + commit activity — source code evidence, development patterns',
      baseUrl: 'https://api.github.com',
      domains: ['tech'],
      trustTier: SourceTrust.NEWS_MINOR,
      rateMs: 2000,
      requiresKey: false,
      keyName: 'GITHUB_TOKEN',
    });
  }

  _authHeaders() {
    const config = getConfig();
    const token = config.keys?.GITHUB_TOKEN;
    return token ? { Authorization: `token ${token}` } : {};
  }

  async search(query, options = {}) {
    try {
      const [codeItems, commitItems] = await Promise.all([
        this._searchCode(query, options),
        this._searchCommits(query, options),
      ]);

      const items = [...codeItems, ...commitItems];
      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  async _searchCode(query, options) {
    const url = `${this.baseUrl}/search/code?q=${encodeURIComponent(query)}&per_page=${options.limit || 5}`;
    const res = await this._fetch(url, { headers: this._authHeaders() });
    if (!res.ok) return [];

    const results = res.data?.items || [];
    return results.map(r => ({
      url: r.html_url || '',
      title: `${r.repository?.full_name || ''}/${r.name || r.path || ''}`,
      summary: `Code match in ${r.repository?.full_name || 'unknown'} — ${r.path || ''}`,
      type: EvidenceType.CONTEXTUAL,
      timestamp: null,
      data: {
        repo: r.repository?.full_name,
        path: r.path,
        sha: r.sha,
        score: r.score,
      },
    }));
  }

  async _searchCommits(query, options) {
    const url = `${this.baseUrl}/search/commits?q=${encodeURIComponent(query)}&per_page=${options.limit || 5}`;
    const res = await this._fetch(url, {
      headers: { ...this._authHeaders(), Accept: 'application/vnd.github.cloak-preview+json' },
    });
    if (!res.ok) return [];

    const results = res.data?.items || [];
    return results.map(r => ({
      url: r.html_url || '',
      title: `Commit: ${(r.commit?.message || '').split('\n')[0].slice(0, 100)}`,
      summary: `${r.repository?.full_name || ''} — ${r.commit?.author?.name || 'unknown'} (${r.commit?.author?.date || ''})`,
      type: EvidenceType.CONTEXTUAL,
      timestamp: r.commit?.author?.date || null,
      data: {
        repo: r.repository?.full_name,
        sha: r.sha,
        author: r.commit?.author?.name,
        message: r.commit?.message,
      },
    }));
  }
}

export default GitHubDeepConnector;
