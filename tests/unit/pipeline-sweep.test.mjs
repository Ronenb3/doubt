import { describe, it, expect, vi, afterEach } from 'vitest';

import { Pipeline } from '../../src/core/pipeline.js';
import registry from '../../src/connectors/registry.js';

const originalLoadAll = registry.loadAll;
const originalRoute = registry.route;

afterEach(() => {
  registry.loadAll = originalLoadAll;
  registry.route = originalRoute;
  vi.restoreAllMocks();
});

describe('Pipeline.sweep()', () => {
  it('passes explicit source allowlists through to registry routing', async () => {
    registry.loadAll = vi.fn(async () => {});
    registry.route = vi.fn(() => [{ id: 'travel_advisories' }]);

    const pipeline = new Pipeline();
    pipeline._runConnectors = vi.fn(async () => [
      { connectorId: 'travel_advisories', evidence: [{ summary: 'Level 4 advisory' }] },
    ]);

    const result = await pipeline.sweep('Russia travel advisory', {
      maxSources: 5,
      sources: ['travel_advisories'],
    });

    expect(registry.route).toHaveBeenCalledWith('Russia travel advisory', {
      maxSources: 5,
      connectors: ['travel_advisories'],
    });
    expect(result.connectors).toEqual(['travel_advisories']);
    expect(result.evidence).toHaveLength(1);
  });
});
