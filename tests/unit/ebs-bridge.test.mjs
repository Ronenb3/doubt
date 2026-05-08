import { describe, it, expect, vi } from 'vitest';

import EBSBridgeConnector from '../../src/connectors/sources/ebs_bridge.js';
import { EvidenceType } from '../../src/core/schema.js';

function createConnectorWithFetch(mockImpl) {
  const connector = new EBSBridgeConnector();
  connector._fetch = vi.fn(mockImpl);
  return connector;
}

describe('EBSBridgeConnector', () => {
  it('degrades gracefully when EBS is offline', async () => {
    const connector = createConnectorWithFetch(async () => ({ ok: false, error: 'offline' }));

    const results = await connector.search('Acme Corp');

    expect(results).toEqual([]);
    expect(connector._fetch).toHaveBeenCalledWith('http://127.0.0.1:3002/health');
    expect(connector._fetch).toHaveBeenCalledWith('http://127.0.0.1:3002/api/v1/graph-intel/health');
  });

  it('maps graph-intel search results into doubt evidence', async () => {
    const connector = createConnectorWithFetch(async (url) => {
      if (url.endsWith('/health')) {
        return { ok: true, data: { status: 'healthy' } };
      }

      if (url.includes('/api/v1/graph-intel/search')) {
        return {
          ok: true,
          data: {
            results: [
              {
                id: 'org-1',
                name: 'Acme Corp',
                type: 'organization',
                summary: 'Corporate registry match',
                source_url: 'https://example.com/acme',
                confidence: 0.92,
              },
            ],
          },
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const results = await connector.search('Acme Corp');

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe(EvidenceType.CONTEXTUAL);
    expect(results[0].connectorId).toBe('ebs_bridge');
    expect(results[0].sourceUrl).toBe('https://example.com/acme');
    expect(results[0].summary).toBe('Corporate registry match');
    expect(results[0].data.entity_id).toBe('org-1');
    expect(results[0].data.source_system).toBe('ebs');
  });

  it('falls back to person investigation when graph search is empty', async () => {
    const connector = createConnectorWithFetch(async (url, options = {}) => {
      if (url.endsWith('/health')) {
        return { ok: true, data: { status: 'healthy' } };
      }

      if (url.includes('/api/v1/graph-intel/search')) {
        return { ok: true, data: { results: [] } };
      }

      if (url.endsWith('/api/v1/graph-intel/investigate/person')) {
        expect(JSON.parse(options.body)).toMatchObject({ name: 'Jane Doe' });
        return {
          ok: true,
          data: {
            entities: [
              {
                id: 'person-1',
                name: 'Jane Doe',
                _type: 'person',
                description: 'Background investigation match',
              },
            ],
          },
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const results = await connector.search('Jane Doe');

    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe('Background investigation match');
    expect(results[0].data.source_connector).toBe('graph_person_investigate');
  });

  it('falls back to ecosystem composition when graph routes are sparse', async () => {
    const connector = createConnectorWithFetch(async (url, options = {}) => {
      if (url.endsWith('/health')) {
        return { ok: true, data: { status: 'healthy' } };
      }

      if (url.includes('/api/v1/graph-intel/search')) {
        return { ok: true, data: { results: [] } };
      }

      if (url.endsWith('/api/v1/graph-intel/investigate/corporate')) {
        return { ok: false, status: 503, error: 'graph unavailable' };
      }

      if (url.endsWith('/api/v1/ecosystem/compose')) {
        const payload = JSON.parse(options.body);
        expect(payload.operation).toBe('entity_resolve');
        return {
          ok: true,
          data: {
            composition: {
              artifacts: {
                cross_system_previews: {
                  ebs: {
                    name: 'Acme Labs',
                    _type: 'organization',
                    summary: 'Provider-composed organization context',
                  },
                },
              },
            },
          },
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const results = await connector.search('Acme Labs');

    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe('Provider-composed organization context');
    expect(results[0].data.source_connector).toBe('ecosystem_compose');
  });

  it('ignores failed investigation payloads and continues to ecosystem fallback', async () => {
    const connector = createConnectorWithFetch(async (url, options = {}) => {
      if (url.endsWith('/health')) {
        return { ok: true, data: { status: 'healthy' } };
      }

      if (url.includes('/api/v1/graph-intel/search')) {
        return { ok: true, data: { results: [] } };
      }

      if (url.endsWith('/api/v1/graph-intel/investigate/corporate')) {
        return {
          ok: true,
          data: {
            subject: null,
            status: 'failed',
            error: 'Could not resolve company identity',
          },
        };
      }

      if (url.endsWith('/api/v1/ecosystem/compose')) {
        const payload = JSON.parse(options.body);
        expect(payload.operation).toBe('entity_resolve');
        return {
          ok: true,
          data: {
            composition: {
              artifacts: {
                cross_system_previews: {
                  ebs: {
                    name: 'Acme Labs',
                    _type: 'organization',
                    summary: 'Ecosystem fallback rescued the sparse lookup',
                  },
                },
              },
            },
          },
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const results = await connector.search('Acme Labs');

    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe('Ecosystem fallback rescued the sparse lookup');
    expect(results[0].data.source_connector).toBe('ecosystem_compose');
  });
});
