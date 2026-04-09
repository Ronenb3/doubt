/**
 * Integration test: Connector registry health check
 * - Loads all connectors via registry
 * - Verifies each has required shape
 * - Smoke-tests 5 free connectors with a live query
 *
 * Note: these tests make real HTTP requests. They may be slow.
 * Individual connector timeouts are capped in vitest.config.js at 30s.
 */

import { describe, it, expect, beforeAll } from 'vitest';

// We import the registry dynamically because it loads from filesystem
let registry;

beforeAll(async () => {
  const mod = await import('../../src/connectors/registry.js');
  registry = mod.default || mod.registry || mod;
  await registry.loadAll();
}, 15000);

// ── Registry shape ────────────────────────────────────────────────────────────

describe('ConnectorRegistry — shape validation', () => {
  it('loads at least 50 connectors', () => {
    const all = registry.all();
    expect(all.length).toBeGreaterThanOrEqual(50);
  });

  it('every connector has id, name, and search function', () => {
    const all = registry.all();
    const invalid = all.filter(c =>
      !c.id ||
      typeof c.id !== 'string' ||
      !c.name ||
      typeof c.name !== 'string' ||
      typeof c.search !== 'function'
    );
    if (invalid.length > 0) {
      console.warn('Connectors missing required fields:', invalid.map(c => c.id || '(no id)'));
    }
    expect(invalid.length).toBe(0);
  });

  it('every connector has a trustTier between 0 and 1', () => {
    const all = registry.all();
    for (const c of all) {
      expect(c.trustTier).toBeGreaterThanOrEqual(0);
      expect(c.trustTier).toBeLessThanOrEqual(1);
    }
  });

  it('every connector has a domains array', () => {
    const all = registry.all();
    for (const c of all) {
      expect(Array.isArray(c.domains)).toBe(true);
    }
  });

  it('can retrieve a connector by id', () => {
    const ddg = registry.get('duckduckgo');
    expect(ddg).toBeDefined();
    expect(ddg.id).toBe('duckduckgo');
  });

  it('available() returns only connectors that are enabled', () => {
    const all = registry.all();
    const avail = registry.available();
    // available() must be a subset of all
    expect(avail.length).toBeLessThanOrEqual(all.length);
    for (const c of avail) {
      expect(c.available).toBe(true);
    }
  });
});

// ── Live smoke tests for free-tier connectors ─────────────────────────────────

// These tests make real HTTP calls. If a connector's external API is down,
// the test should still pass (it just returns []).

describe('DuckDuckGo connector — live smoke test', () => {
  it('returns an array for a simple query', async () => {
    const ddg = registry.get('duckduckgo');
    expect(ddg).toBeDefined();
    const results = await ddg.search('magnesium anxiety research');
    expect(Array.isArray(results)).toBe(true);
  }, 15000);

  it('each result follows the evidence schema', async () => {
    const ddg = registry.get('duckduckgo');
    const results = await ddg.search('climate change research');
    for (const item of results) {
      expect(item).toHaveProperty('connectorId', 'duckduckgo');
      expect(item).toHaveProperty('sourceUrl');
      expect(item).toHaveProperty('summary');
      expect(item).toHaveProperty('trustWeight');
      expect(typeof item.trustWeight).toBe('number');
    }
  }, 15000);

  it('returns empty array (not crash) for odd characters', async () => {
    const ddg = registry.get('duckduckgo');
    const results = await ddg.search('ÄÖÜ€ unicode test 🔍');
    expect(Array.isArray(results)).toBe(true);
  }, 10000);
});

describe('arXiv connector — live smoke test', () => {
  it('returns an array for an academic query', async () => {
    const arxiv = registry.get('arxiv');
    expect(arxiv).toBeDefined();
    const results = await arxiv.search('machine learning neural networks', { limit: 3 });
    expect(Array.isArray(results)).toBe(true);
  }, 20000);

  it('results have sourceUrl and summary', async () => {
    const arxiv = registry.get('arxiv');
    const results = await arxiv.search('quantum computing', { limit: 2 });
    for (const item of results) {
      if (item.sourceUrl) {
        expect(item.sourceUrl).toMatch(/https?:\/\//);
      }
      expect(typeof item.summary).toBe('string');
    }
  }, 20000);
});

describe('Wayback Machine connector — live smoke test', () => {
  it('returns an array for a URL availability query', async () => {
    const wayback = registry.get('wayback');
    expect(wayback).toBeDefined();
    const results = await wayback.search('https://example.com');
    expect(Array.isArray(results)).toBe(true);
  }, 20000);
});

describe('FRED connector — live smoke test', () => {
  it('returns an array for an economic query', async () => {
    const fred = registry.get('fred');
    expect(fred).toBeDefined();
    const results = await fred.search('unemployment rate', { limit: 3 });
    expect(Array.isArray(results)).toBe(true);
  }, 25000);
});

describe('BLS connector — live smoke test', () => {
  it('returns an array without crashing', async () => {
    const bls = registry.get('bls');
    expect(bls).toBeDefined();
    const results = await bls.search('unemployment');
    expect(Array.isArray(results)).toBe(true);
  }, 20000);
});
