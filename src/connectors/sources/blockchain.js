import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class BlockchainConnector extends BaseConnector {
  constructor() {
    super({
      id: 'blockchain',
      name: 'Blockchain Explorer',
      description: 'Bitcoin/crypto address lookup via Blockchain.com and Blockchair APIs',
      baseUrl: 'https://api.blockchair.com',
      domains: ['financial', 'crypto'],
      trustTier: SourceTrust.FINANCIAL_DATA,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      if (this._looksLikeAddress(query)) {
        return await this._searchAddress(query, options);
      }
      return await this._searchGeneral(query, options);
    } catch {
      return [];
    }
  }

  _looksLikeAddress(query) {
    return /^(1|3|bc1|0x)[a-zA-Z0-9]{25,}$/.test(query.trim());
  }

  async _searchAddress(address, options) {
    const chain = address.startsWith('0x') ? 'ethereum' : 'bitcoin';
    const url = `${this.baseUrl}/${chain}/dashboards/address/${address}`;
    const res = await this._fetch(url);
    if (!res.ok) {
      return this._fallbackBlockchainInfo(address, options);
    }

    const addrData = res.data?.data?.[address] || {};
    const info = addrData.address || {};
    const items = [{
      url: `https://blockchair.com/${chain}/address/${address}`,
      title: `${address.slice(0, 12)}... — ${chain} address`,
      summary: `Balance: ${info.balance || 0} satoshis, total received: ${info.received || 0}, txs: ${info.transaction_count || 0}`,
      type: EvidenceType.NEUTRAL,
      timestamp: info.first_seen_receiving || null,
      data: {
        chain,
        address,
        balance: info.balance,
        received: info.received,
        spent: info.spent,
        transactionCount: info.transaction_count,
        firstSeen: info.first_seen_receiving,
        lastSeen: info.last_seen_receiving,
      },
    }];

    return this._toEvidence(items, options.claimId);
  }

  async _fallbackBlockchainInfo(address, options) {
    const url = `https://blockchain.info/q/addressbalance/${address}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const balance = typeof res.data === 'number' ? res.data : parseInt(res.data, 10);
    if (isNaN(balance)) return [];

    const items = [{
      url: `https://www.blockchain.com/btc/address/${address}`,
      title: `${address.slice(0, 12)}... — Bitcoin address`,
      summary: `Bitcoin address balance: ${balance} satoshis (${(balance / 1e8).toFixed(8)} BTC)`,
      type: EvidenceType.NEUTRAL,
      timestamp: null,
      data: { address, balanceSatoshis: balance, balanceBTC: balance / 1e8 },
    }];

    return this._toEvidence(items, options.claimId);
  }

  async _searchGeneral(query, options) {
    const url = `${this.baseUrl}/bitcoin/dashboards/transaction/${query}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const txData = res.data?.data?.[query] || {};
    const tx = txData.transaction || {};
    const items = [{
      url: `https://blockchair.com/bitcoin/transaction/${query}`,
      title: `TX ${(query).slice(0, 16)}...`,
      summary: `Bitcoin tx: ${tx.input_total || 0} in, ${tx.output_total || 0} out, fee ${tx.fee || 0}`,
      type: EvidenceType.NEUTRAL,
      timestamp: tx.time || null,
      data: { hash: query, ...tx },
    }];

    return this._toEvidence(items, options.claimId);
  }
}

export default BlockchainConnector;
