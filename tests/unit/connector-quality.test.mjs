import { describe, it, expect, vi } from 'vitest';

import CoinGeckoConnector from '../../src/connectors/sources/coingecko.js';
import TravelAdvisoriesConnector from '../../src/connectors/sources/travel-advisories.js';

describe('CoinGeckoConnector', () => {
  it('prefers exact asset matches over noisy partial matches', async () => {
    const connector = new CoinGeckoConnector();
    connector._fetch = vi.fn(async (url) => {
      if (url.includes('/search?query=')) {
        return {
          ok: true,
          data: {
            coins: [
              { id: 'bitcoin-cash', symbol: 'bch', name: 'Bitcoin Cash' },
              { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
              { id: 'harrypotterobamasonic10in', symbol: 'bitcoin', name: 'HarryPotterObamaSonic10Inu (ETH)' },
            ],
          },
        };
      }

      if (url.includes('/coins/markets?')) {
        return {
          ok: true,
          data: [
            {
              id: 'bitcoin',
              symbol: 'btc',
              name: 'Bitcoin',
              current_price: 77549,
              market_cap: 1552412684648,
              total_volume: 17636037780,
              price_change_24h: -33.28,
              price_change_percentage_24h: -0.04,
              high_24h: 77878,
              low_24h: 77238,
              ath: 126080,
              ath_change_percentage: -38.49,
              last_updated: '2026-04-25T22:29:01.165Z',
            },
          ],
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const results = await connector.search('bitcoin', { limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].data.id).toBe('bitcoin');
    expect(results[0].summary).toMatch(/Bitcoin \(BTC\)/);
  });
});

describe('TravelAdvisoriesConnector', () => {
  it('returns focused results even if one upstream source fails', async () => {
    const connector = new TravelAdvisoriesConnector();
    connector._fetchUS = vi.fn(async () => ([
      {
        source: 'US State Dept',
        country: 'Russia',
        title: 'Russia Travel Advisory',
        summary: 'Level 4: Do not travel',
        link: 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/russia-travel-advisory.html',
        published: '2026-04-20T00:00:00.000Z',
        level: 4,
        levelText: 'do not travel',
        severity: 4,
      },
    ]));
    connector._fetchUK = vi.fn(async () => {
      throw new Error('timeout');
    });
    connector._fetchAU = vi.fn(async () => ([
      {
        source: 'AU DFAT',
        country: 'Russia',
        title: 'Russia',
        summary: 'Do not travel',
        link: 'https://www.smartraveller.gov.au/destinations/europe/russia',
        published: '2026-04-18T00:00:00.000Z',
        level: 4,
        levelText: 'do not travel',
        severity: 4,
      },
    ]));

    const results = await connector.search('Russia travel advisory', { limit: 5 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].summary).toMatch(/Russia/);
    expect(results[0].type).toBe('supports');
  });
});
