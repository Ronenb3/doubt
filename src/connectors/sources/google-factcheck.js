import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

const RATING_MAP = {
  true: EvidenceType.SUPPORTS,
  'mostly true': EvidenceType.SUPPORTS,
  'half true': EvidenceType.NEUTRAL,
  'mostly false': EvidenceType.CONTRADICTS,
  false: EvidenceType.CONTRADICTS,
  'pants on fire': EvidenceType.CONTRADICTS,
  'partly true': EvidenceType.NEUTRAL,
  mixture: EvidenceType.NEUTRAL,
  misleading: EvidenceType.CONTRADICTS,
  correct: EvidenceType.SUPPORTS,
  incorrect: EvidenceType.CONTRADICTS,
  unproven: EvidenceType.NEUTRAL,
};

function ratingToEvidenceType(rating) {
  if (!rating) return EvidenceType.NEUTRAL;
  const lower = rating.toLowerCase().trim();
  for (const [key, type] of Object.entries(RATING_MAP)) {
    if (lower.includes(key)) return type;
  }
  return EvidenceType.NEUTRAL;
}

class GoogleFactCheckConnector extends BaseConnector {
  constructor() {
    super({
      id: 'google_factcheck',
      name: 'Google Fact Check Tools',
      description: 'Google Fact Check API — aggregated fact-check ratings from verified publishers',
      baseUrl: 'https://factchecktools.googleapis.com',
      domains: ['general', 'news'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const pageSize = options.limit || 10;
      const url = `${this.baseUrl}/v1alpha1/claims:search?query=${encodeURIComponent(query)}&pageSize=${pageSize}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const claims = res.data?.claims || [];
      const items = [];

      for (const claim of claims) {
        const reviews = claim.claimReview || [];
        for (const review of reviews) {
          const rating = review.textualRating || '';
          items.push({
            url: review.url || '',
            title: `[${rating}] ${claim.text || 'Claim'}`,
            summary: `Claim: "${(claim.text || '').slice(0, 150)}" — Rating: ${rating} by ${review.publisher?.name || 'unknown'}`,
            type: ratingToEvidenceType(rating),
            timestamp: review.reviewDate || claim.claimDate || null,
            data: {
              claimText: claim.text,
              claimant: claim.claimant,
              rating,
              publisher: review.publisher?.name,
              publisherSite: review.publisher?.site,
              reviewTitle: review.title,
              languageCode: review.languageCode,
            },
          });
        }
      }

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default GoogleFactCheckConnector;
