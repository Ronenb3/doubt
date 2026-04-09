import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * RSS News Connector
 *
 * Aggregates real-time headlines from major free public RSS feeds:
 * BBC, Guardian, Al Jazeera, NPR, Reuters via Feedburner.
 *
 * No API key. Minutes-fresh. The single fastest way to catch
 * breaking news — exactly what GDELT/Wikipedia can never do.
 *
 * Query matching is keyword-based: query terms must appear in
 * the article title or description. Recency is the real value —
 * these items carry timestamps from minutes ago.
 */

const RSS_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',        name: 'BBC World News',   trust: SourceTrust.NEWS_MAJOR },
  { url: 'https://feeds.bbci.co.uk/news/rss.xml',              name: 'BBC News',         trust: SourceTrust.NEWS_MAJOR },
  { url: 'https://www.theguardian.com/world/rss',              name: 'Guardian World',   trust: SourceTrust.NEWS_MAJOR },
  { url: 'https://www.theguardian.com/us-news/rss',            name: 'Guardian US',      trust: SourceTrust.NEWS_MAJOR },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',          name: 'Al Jazeera',       trust: SourceTrust.NEWS_MAJOR },
  { url: 'https://feeds.npr.org/1001/rss.xml',                 name: 'NPR News',         trust: SourceTrust.NEWS_MAJOR },
  { url: 'https://feeds.npr.org/1004/rss.xml',                 name: 'NPR World',        trust: SourceTrust.NEWS_MAJOR },
  { url: 'https://rss.dw.com/rdf/rss-en-all',                  name: 'Deutsche Welle',   trust: SourceTrust.NEWS_MAJOR },
  { url: 'https://feeds.skynews.com/feeds/rss/world.xml',      name: 'Sky News World',   trust: SourceTrust.NEWS_MAJOR },
];

/**
 * Parse all <item> or <entry> blocks from RSS/Atom XML.
 * Zero dependencies — hand-rolls the parse.
 */
function parseRSS(xml, feedName) {
  const items = [];

  // Handle both RSS <item> and Atom <entry>
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const title       = _extractTag(block, 'title');
    const link        = _extractLink(block);
    const description = _extractTag(block, 'description') ||
                        _extractTag(block, 'summary') ||
                        _extractTag(block, 'content:encoded');
    const pubDate     = _extractTag(block, 'pubDate') ||
                        _extractTag(block, 'published') ||
                        _extractTag(block, 'updated') ||
                        _extractTag(block, 'dc:date');

    if (!title || !link) continue;

    items.push({
      title: _strip(title),
      link,
      description: _strip(description || ''),
      pubDate,
      feedName,
    });
  }

  return items;
}

function _extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return null;
  // Strip CDATA wrapper if present
  return m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}

function _extractLink(block) {
  // RSS: <link>url</link>
  const rss = _extractTag(block, 'link');
  if (rss && rss.startsWith('http')) return rss;

  // Atom: <link href="url"/>   or <link rel="alternate" href="url"/>
  const atom = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  if (atom) return atom[1];

  return rss || null;
}

function _strip(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score how relevant an RSS item is to a query.
 * Returns 0-1. Any hit on a query term gives 0.2; bonus for multiple hits.
 */
function relevanceScore(title, description, queryTerms) {
  const text = `${title} ${description}`.toLowerCase();
  let hits = 0;
  for (const term of queryTerms) {
    if (text.includes(term)) hits++;
  }
  if (queryTerms.length === 0) return 0.5;
  return Math.min(1.0, hits / queryTerms.length * 1.5);
}

class RSSNewsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'rss_news',
      name: 'RSS News Feeds',
      description: 'Real-time headlines from BBC, Guardian, Al Jazeera, NPR, DW, Sky News — no API key, minutes-fresh',
      baseUrl: 'https://feeds.bbci.co.uk',
      domains: ['news', 'geopolitical', 'general'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 500,
    });
  }

  async search(query, options = {}) {
    const limit = options.limit || 30;

    // Build keyword list from query
    const stopWords = new Set(['the','is','a','an','for','to','of','in','on','by',
      'with','that','this','are','was','were','what','how','why','when','where',
      'right','now','happening','current','situation','about','and','or','but']);
    const queryTerms = query.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !stopWords.has(t));

    const allItems = [];

    // Fetch all feeds in parallel, with individual error tolerance
    const feedResults = await Promise.allSettled(
      RSS_FEEDS.map(async (feed) => {
        try {
          const res = await this._fetch(feed.url, {
            headers: { 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
          });
          if (!res.ok) return [];
          const xml = res.data;
          if (typeof xml !== 'string') return [];
          return parseRSS(xml, feed.name).map(item => ({ ...item, feedTrust: feed.trust }));
        } catch {
          return [];
        }
      })
    );

    for (const result of feedResults) {
      if (result.status === 'fulfilled') {
        allItems.push(...result.value);
      }
    }

    // Score and filter by query relevance
    const scored = allItems
      .map(item => ({
        ...item,
        score: relevanceScore(item.title, item.description, queryTerms),
      }))
      .filter(item => item.score > 0.1)
      .sort((a, b) => {
        // Primary sort: recency (most recent first)
        const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
        const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
        if (tb !== ta) return tb - ta;
        // Secondary: relevance score
        return b.score - a.score;
      })
      .slice(0, limit);

    const evidenceItems = scored.map(item => ({
      url: item.link,
      title: item.title,
      summary: item.description ? item.description.slice(0, 300) : item.title,
      type: EvidenceType.NEUTRAL,
      timestamp: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      data: {
        feed: item.feedName,
        description: item.description,
        relevanceScore: item.score,
        ageMinutes: item.pubDate
          ? Math.round((Date.now() - new Date(item.pubDate).getTime()) / 60000)
          : null,
      },
    }));

    return this._toEvidence(evidenceItems, options.claimId);
  }
}

export default RSSNewsConnector;
