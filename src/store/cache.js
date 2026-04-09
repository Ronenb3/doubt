/**
 * doubt — Response Cache
 *
 * Avoids re-fetching from connectors for the same query.
 * In-memory Map with optional SQLite persistence and TTL.
 */

import { createHash } from 'crypto';
import { log } from '../core/config.js';

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

export class Cache {
  /**
   * @param {{ store?: import('./db.js').Store, maxSize?: number }} [options]
   */
  constructor(options = {}) {
    this._mem = new Map();
    this._store = options.store || null;
    this._maxSize = options.maxSize || 500;
  }

  /**
   * Get a cached response.
   * @param {string} connectorId
   * @param {string} query
   * @returns {*} Cached data or null if miss/expired.
   */
  get(connectorId, query) {
    const key = cacheKey(connectorId, query);
    const entry = this._mem.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this._mem.delete(key);
      return null;
    }

    entry.hits++;
    log('debug', `cache: HIT ${connectorId}/${query.slice(0, 40)}`);
    return entry.data;
  }

  /**
   * Store a response in the cache.
   * @param {string} connectorId
   * @param {string} query
   * @param {*} data
   * @param {number} [ttl] — TTL in ms, defaults to 24h.
   */
  set(connectorId, query, data, ttl = DEFAULT_TTL) {
    const key = cacheKey(connectorId, query);

    if (this._mem.size >= this._maxSize) {
      this._evictOldest();
    }

    this._mem.set(key, {
      connectorId,
      query,
      data,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      hits: 0,
    });

    log('debug', `cache: SET ${connectorId}/${query.slice(0, 40)} (ttl=${Math.round(ttl / 1000)}s)`);
  }

  /**
   * Check if a cached entry exists and is not expired.
   * @param {string} connectorId
   * @param {string} query
   * @returns {boolean}
   */
  has(connectorId, query) {
    const key = cacheKey(connectorId, query);
    const entry = this._mem.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this._mem.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Clear all entries.
   */
  clear() {
    this._mem.clear();
  }

  /**
   * Number of live (non-expired) entries.
   */
  get size() {
    this._purgeExpired();
    return this._mem.size;
  }

  /**
   * Cache hit statistics.
   */
  stats() {
    let totalHits = 0;
    let entries = 0;
    for (const entry of this._mem.values()) {
      if (Date.now() <= entry.expiresAt) {
        totalHits += entry.hits;
        entries++;
      }
    }
    return { entries, totalHits };
  }

  _evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this._mem) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) this._mem.delete(oldestKey);
  }

  _purgeExpired() {
    const now = Date.now();
    for (const [key, entry] of this._mem) {
      if (now > entry.expiresAt) this._mem.delete(key);
    }
  }
}

/**
 * Deterministic cache key from connectorId + query.
 */
function cacheKey(connectorId, query) {
  return createHash('sha256')
    .update(`${connectorId}:${query.toLowerCase().trim()}`)
    .digest('hex')
    .slice(0, 24);
}
