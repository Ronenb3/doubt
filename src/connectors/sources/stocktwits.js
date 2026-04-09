import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class StockTwitsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'stocktwits',
      name: 'StockTwits',
      description: 'StockTwits social sentiment — retail trader chatter and sentiment on tickers',
      baseUrl: 'https://api.stocktwits.com/api/2',
      domains: ['financial', 'social'],
      trustTier: SourceTrust.SOCIAL_MEDIA,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const ticker = this._extractTicker(query);
      if (!ticker) return [];

      const url = `${this.baseUrl}/streams/symbol/${ticker}.json`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const messages = res.data?.messages || [];
      const symbol = res.data?.symbol || {};
      const items = messages.slice(0, options.limit || 15).map(msg => ({
        url: `https://stocktwits.com/${msg.user?.username}/message/${msg.id}`,
        title: `@${msg.user?.username || 'anon'} on $${ticker}`,
        summary: (msg.body || '').slice(0, 200),
        type: EvidenceType.CONTEXTUAL,
        timestamp: msg.created_at || null,
        data: {
          messageId: msg.id,
          body: msg.body,
          sentiment: msg.entities?.sentiment?.basic || null,
          user: msg.user?.username,
          followers: msg.user?.followers,
          likes: msg.likes?.total || 0,
          symbol: ticker,
          symbolTitle: symbol.title,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _extractTicker(query) {
    const match = query.match(/\$?([A-Z]{1,5})\b/);
    return match ? match[1] : query.toUpperCase().split(/\s+/)[0]?.slice(0, 5);
  }
}

export default StockTwitsConnector;
