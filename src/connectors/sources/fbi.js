import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class FBIConnector extends BaseConnector {
  constructor() {
    super({
      id: 'fbi',
      name: 'FBI Most Wanted',
      description: 'FBI Most Wanted API — fugitives, missing persons, terrorism subjects',
      baseUrl: 'https://api.fbi.gov',
      domains: ['compliance', 'legal'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const url = `${this.baseUrl}/wanted/v1/list?title=${encodeURIComponent(query)}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const records = res.data?.items || [];
      const items = records.slice(0, options.limit || 10).map(r => ({
        url: r.url || `https://www.fbi.gov/wanted/${r.uid || ''}`,
        title: r.title || 'Unknown Subject',
        summary: (r.description || r.caution || r.title || '').slice(0, 500),
        type: EvidenceType.NEUTRAL,
        timestamp: r.publication || r.modified || null,
        data: {
          uid: r.uid,
          aliases: r.aliases,
          subjects: r.subjects,
          nationality: r.nationality,
          placeOfBirth: r.place_of_birth,
          dates_of_birth: r.dates_of_birth_used,
          hair: r.hair,
          eyes: r.eyes,
          sex: r.sex,
          race: r.race,
          reward: r.reward_text,
          warningMessage: r.warning_message,
          images: (r.images || []).map(i => i.original),
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default FBIConnector;
