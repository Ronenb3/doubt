/**
 * doubt — Document Ingester
 *
 * Fetches and chunks documents for downstream claim extraction.
 * Supports HTML (tag-stripped) and plain text.
 * Chunks at sentence boundaries with configurable overlap.
 */

import { getConfig, log } from '../core/config.js';

const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 300;

const HTML_TAG = /<[^>]+>/g;
const SCRIPT_STYLE = /<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};
const ENTITY_RE = /&(?:amp|lt|gt|quot|apos|nbsp|#39);/gi;

export class DocumentIngester {
  /**
   * Fetch a URL, detect content type, extract text, and chunk.
   * @param {string} url
   * @returns {Promise<Array<{text:string, index:number, source:string, charStart:number, charEnd:number}>>}
   */
  async ingestURL(url) {
    try {
      const config = getConfig();
      const resp = await fetch(url, {
        headers: { 'User-Agent': config.connectors.userAgent },
        signal: AbortSignal.timeout(config.connectors.timeout),
      });

      if (!resp.ok) {
        log('warn', `documents: fetch failed for ${url} (${resp.status})`);
        return [];
      }

      const contentType = resp.headers.get('content-type') || '';
      const raw = await resp.text();

      let text;
      if (contentType.includes('html')) {
        text = stripHTML(raw);
      } else {
        text = raw;
      }

      text = collapseWhitespace(text);
      if (!text.trim()) return [];

      return chunkText(text, url);
    } catch (err) {
      log('warn', `documents: error ingesting ${url}: ${err.message}`);
      return [];
    }
  }

  /**
   * Chunk raw text directly (no fetch).
   * @param {string} text
   * @param {string} [label] — source label for provenance
   * @returns {Array<{text:string, index:number, source:string, charStart:number, charEnd:number}>}
   */
  ingestText(text, label = 'direct_input') {
    try {
      if (!text || typeof text !== 'string') return [];
      const clean = collapseWhitespace(text);
      if (!clean.trim()) return [];
      return chunkText(clean, label);
    } catch (err) {
      log('warn', `documents: error chunking text: ${err.message}`);
      return [];
    }
  }
}

/**
 * Strip HTML tags, scripts, styles, and decode entities.
 */
function stripHTML(html) {
  let text = html
    .replace(SCRIPT_STYLE, ' ')
    .replace(HTML_TAG, ' ')
    .replace(ENTITY_RE, m => HTML_ENTITIES[m.toLowerCase()] || m);
  return text;
}

function collapseWhitespace(text) {
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Chunk text into segments of ~CHUNK_SIZE chars with CHUNK_OVERLAP overlap.
 * Breaks at sentence boundaries when possible.
 */
function chunkText(text, source) {
  const chunks = [];
  let pos = 0;
  let index = 0;

  while (pos < text.length) {
    let end = Math.min(pos + CHUNK_SIZE, text.length);

    if (end < text.length) {
      const boundary = findSentenceBoundary(text, pos + CHUNK_SIZE - 200, end);
      if (boundary > pos) end = boundary;
    }

    const segment = text.slice(pos, end).trim();
    if (segment.length > 0) {
      chunks.push({
        text: segment,
        index,
        source,
        charStart: pos,
        charEnd: end,
      });
      index++;
    }

    const advance = end - CHUNK_OVERLAP;
    pos = advance > pos ? advance : end;
  }

  log('debug', `documents: chunked ${text.length} chars → ${chunks.length} chunks from ${source}`);
  return chunks;
}

/**
 * Find the best sentence boundary (. ! ? followed by space/newline)
 * within a character range. Returns the position after the boundary,
 * or -1 if none found.
 */
function findSentenceBoundary(text, from, to) {
  let best = -1;
  for (let i = Math.max(from, 0); i < Math.min(to, text.length) - 1; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if ((ch === '.' || ch === '!' || ch === '?') && (next === ' ' || next === '\n')) {
      best = i + 2;
    }
  }
  return best;
}
