import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class HuggingFaceConnector extends BaseConnector {
  constructor() {
    super({
      id: 'huggingface',
      name: 'Hugging Face',
      description: 'ML model search via Hugging Face Hub API — models, datasets, papers',
      baseUrl: 'https://huggingface.co',
      domains: ['tech', 'academic'],
      trustTier: SourceTrust.NEWS_MINOR,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 10;
      const url = `${this.baseUrl}/api/models?search=${encodeURIComponent(query)}&limit=${limit}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const models = Array.isArray(res.data) ? res.data : [];
      const items = models.map(m => ({
        url: `${this.baseUrl}/${m.modelId || m.id}`,
        title: m.modelId || m.id || 'Unknown model',
        summary: `${m.modelId || m.id} — ${m.pipeline_tag || 'general'} (↓${m.downloads || 0} / ♥${m.likes || 0})`,
        type: EvidenceType.CONTEXTUAL,
        timestamp: m.lastModified || m.createdAt || null,
        data: {
          modelId: m.modelId || m.id,
          pipeline: m.pipeline_tag,
          downloads: m.downloads,
          likes: m.likes,
          tags: m.tags || [],
          library: m.library_name,
          lastModified: m.lastModified,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default HuggingFaceConnector;
