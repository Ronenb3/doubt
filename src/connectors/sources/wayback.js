import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class WaybackConnector extends BaseConnector {
  constructor() {
    super({
      id: 'wayback',
      name: 'Wayback Machine',
      description: 'Internet Archive — check if a URL was archived and retrieve historical snapshots',
      baseUrl: 'http://archive.org',
      domains: ['news', 'infrastructure'],
      trustTier: SourceTrust.PRIMARY_DOCUMENT,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const items = [];

      const availRes = await this._fetch(
        `${this.baseUrl}/wayback/available?url=${encodeURIComponent(query)}`
      );
      if (availRes.ok && availRes.data?.archived_snapshots?.closest) {
        const snap = availRes.data.archived_snapshots.closest;
        items.push({
          url: snap.url,
          title: `Wayback snapshot: ${query}`,
          summary: `Archived ${snap.status === '200' ? 'successfully' : `(status ${snap.status})`} on ${snap.timestamp || 'unknown date'}`,
          type: EvidenceType.CONTEXTUAL,
          timestamp: snap.timestamp
            ? new Date(snap.timestamp.replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z')).toISOString()
            : null,
          data: {
            archiveUrl: snap.url,
            status: snap.status,
            timestamp: snap.timestamp,
            available: snap.available,
          },
        });
      }

      const cdxUrl = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(query)}&output=json&limit=5`;
      const cdxRes = await this._fetch(cdxUrl);
      if (cdxRes.ok && Array.isArray(cdxRes.data) && cdxRes.data.length > 1) {
        const headers = cdxRes.data[0];
        const rows = cdxRes.data.slice(1);
        for (const row of rows) {
          const record = {};
          headers.forEach((h, i) => { record[h] = row[i]; });

          const ts = record.timestamp || '';
          const isoTs = ts.length >= 14
            ? new Date(ts.replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z')).toISOString()
            : null;

          items.push({
            url: `http://web.archive.org/web/${ts}/${record.original || query}`,
            title: `CDX: ${record.original || query} (${ts})`,
            summary: `Capture ${record.statuscode || '?'} — ${record.mimetype || '?'}, ${record.length || '?'} bytes`,
            type: EvidenceType.CONTEXTUAL,
            timestamp: isoTs,
            data: {
              original: record.original,
              timestamp: ts,
              statuscode: record.statuscode,
              mimetype: record.mimetype,
              digest: record.digest,
              length: record.length,
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

export default WaybackConnector;
