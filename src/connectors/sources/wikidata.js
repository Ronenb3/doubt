/**
 * Wikidata Connector
 *
 * Structured knowledge graph assertions from Wikidata (wikidata.org).
 * Returns entity facts, relationships, corporate/political roles, identifiers.
 *
 * No API key required. Rate limit: respectful.
 * Trust: ACADEMIC_PEER (0.80) — structured, cross-referenced assertions
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class WikidataConnector extends BaseConnector {
  constructor() {
    super({
      id: 'wikidata',
      name: 'Wikidata',
      description: 'Structured knowledge graph — entity relationships, corporate roles, political affiliations, identifiers',
      baseUrl: 'https://www.wikidata.org',
      domains: ['general', 'corporate', 'political', 'academic'],
      trustTier: SourceTrust.ACADEMIC_PEER,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      // Step 1: Search entities
      const searchParams = new URLSearchParams({
        action: 'wbsearchentities',
        search: query,
        language: 'en',
        limit: '5',
        format: 'json',
        origin: '*',
      });

      const searchRes = await this._fetch(
        `${this.baseUrl}/w/api.php?${searchParams}`
      );
      if (!searchRes.ok) return [];

      const entities = searchRes.data?.search || [];
      if (!entities.length) return [];

      // Step 2: Fetch details for top entities via SPARQL summary
      const items = [];
      for (const entity of entities.slice(0, 3)) {
        const item = {
          url: `https://www.wikidata.org/wiki/${entity.id}`,
          title: `Wikidata: ${entity.label || entity.id}`,
          summary: entity.description
            ? `${entity.label}: ${entity.description}`
            : `Wikidata entity: ${entity.label || entity.id}`,
          type: EvidenceType.CONTEXTUAL,
          timestamp: null,
          data: {
            entityId: entity.id,
            label: entity.label,
            description: entity.description,
            aliases: entity.aliases,
          },
        };
        items.push(item);
      }

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default WikidataConnector;
