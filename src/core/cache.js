/**
 * doubt — Persistent Evidence Cache
 *
 * File-backed cache that persists across process restarts.
 * Avoids re-fetching evidence from APIs on repeated/similar investigations.
 *
 * Storage: ~/.doubt/cache/{sha256}.json
 * Atomicity: write to .tmp then rename (safe under concurrent access)
 * Eviction: LRU by mtime when total size exceeds limit
 */

import { log, getConfig } from './config.js';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
  statSync, readdirSync, unlinkSync, renameSync,
} from 'fs';
import { createHash, randomBytes } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export class EvidenceCache {
  constructor(options = {}) {
    this._dir = options.cacheDir || join(homedir(), '.doubt', 'cache');
    this._ttl = options.ttl ?? DEFAULT_TTL_MS;
    this._maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this._enabled = options.enabled ?? true;
    this._hits = 0;
    this._misses = 0;

    if (this._enabled) {
      mkdirSync(this._dir, { recursive: true });
    }
  }

  /**
   * Retrieve cached evidence for a connector+query pair.
   * Returns the data array on hit, null on miss or expiry.
   */
  get(connectorId, query) {
    if (!this._enabled) return null;

    const file = this._path(connectorId, query);

    if (!existsSync(file)) {
      this._misses++;
      return null;
    }

    try {
      const mtime = statSync(file).mtimeMs;
      if (Date.now() - mtime > this._ttl) {
        this._misses++;
        this._tryUnlink(file);
        log('debug', `cache: EXPIRED ${connectorId}/${query.slice(0, 40)}`);
        return null;
      }

      const entry = JSON.parse(readFileSync(file, 'utf8'));

      if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
        this._misses++;
        this._tryUnlink(file);
        return null;
      }

      this._hits++;
      log('debug', `cache: HIT ${connectorId}/${query.slice(0, 40)} (${entry.data?.length ?? 0} items)`);
      return entry.data;
    } catch (err) {
      this._misses++;
      log('warn', `cache: read error for ${connectorId}: ${err.message}`);
      this._tryUnlink(file);
      return null;
    }
  }

  /**
   * Store evidence data for a connector+query pair.
   * Atomic write (tmp + rename) prevents partial reads.
   */
  set(connectorId, query, data) {
    if (!this._enabled) return;

    const entry = {
      connectorId,
      query,
      timestamp: Date.now(),
      ttl: this._ttl,
      data,
    };

    const payload = JSON.stringify(entry);
    const file = this._path(connectorId, query);
    const tmp = file + '.' + randomBytes(4).toString('hex') + '.tmp';

    try {
      this._enforceLimit(payload.length);
      writeFileSync(tmp, payload, 'utf8');
      renameSync(tmp, file);
      log('debug', `cache: SET ${connectorId}/${query.slice(0, 40)} (${data?.length ?? 0} items, ${(payload.length / 1024).toFixed(1)}KB)`);
    } catch (err) {
      log('warn', `cache: write error for ${connectorId}: ${err.message}`);
      this._tryUnlink(tmp);
    }
  }

  /**
   * Quick check: valid (non-expired) cache exists for this pair.
   */
  has(connectorId, query) {
    if (!this._enabled) return false;

    const file = this._path(connectorId, query);
    if (!existsSync(file)) return false;

    try {
      const mtime = statSync(file).mtimeMs;
      if (Date.now() - mtime > this._ttl) {
        this._tryUnlink(file);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a specific cache entry.
   */
  invalidate(connectorId, query) {
    const file = this._path(connectorId, query);
    this._tryUnlink(file);
  }

  /**
   * Delete all cache files.
   */
  clear() {
    try {
      for (const name of readdirSync(this._dir)) {
        if (name.endsWith('.json')) {
          this._tryUnlink(join(this._dir, name));
        }
      }
      this._hits = 0;
      this._misses = 0;
      log('info', 'cache: cleared');
    } catch (err) {
      log('warn', `cache: clear failed: ${err.message}`);
    }
  }

  /**
   * Return cache statistics.
   */
  stats() {
    let totalEntries = 0;
    let totalSizeBytes = 0;
    let oldestEntry = Infinity;
    let newestEntry = 0;

    try {
      for (const name of readdirSync(this._dir)) {
        if (!name.endsWith('.json')) continue;
        const fp = join(this._dir, name);
        try {
          const st = statSync(fp);
          totalEntries++;
          totalSizeBytes += st.size;
          if (st.mtimeMs < oldestEntry) oldestEntry = st.mtimeMs;
          if (st.mtimeMs > newestEntry) newestEntry = st.mtimeMs;
        } catch { /* skip unreadable */ }
      }
    } catch { /* dir may not exist */ }

    const total = this._hits + this._misses;
    return {
      totalEntries,
      totalSizeBytes,
      oldestEntry: totalEntries > 0 ? new Date(oldestEntry).toISOString() : null,
      newestEntry: totalEntries > 0 ? new Date(newestEntry).toISOString() : null,
      hitRate: total > 0 ? this._hits / total : 0,
      hits: this._hits,
      misses: this._misses,
    };
  }

  // ── internals ──────────────────────────────────────

  _key(connectorId, query) {
    return createHash('sha256')
      .update(`${connectorId}:${query.toLowerCase().trim()}`)
      .digest('hex');
  }

  _path(connectorId, query) {
    return join(this._dir, this._key(connectorId, query) + '.json');
  }

  /**
   * Evict oldest entries until adding `incomingBytes` stays under the limit.
   */
  _enforceLimit(incomingBytes) {
    let files;
    try { files = readdirSync(this._dir); } catch { return; }

    const entries = [];
    let totalSize = 0;

    for (const name of files) {
      if (!name.endsWith('.json')) continue;
      const fp = join(this._dir, name);
      try {
        const st = statSync(fp);
        totalSize += st.size;
        entries.push({ path: fp, size: st.size, mtime: st.mtimeMs });
      } catch { /* skip */ }
    }

    if (totalSize + incomingBytes <= this._maxBytes) return;

    entries.sort((a, b) => a.mtime - b.mtime);

    let freed = 0;
    const target = (totalSize + incomingBytes) - this._maxBytes;
    for (const entry of entries) {
      if (freed >= target) break;
      this._tryUnlink(entry.path);
      freed += entry.size;
      log('debug', `cache: evicted ${entry.path} (${(entry.size / 1024).toFixed(1)}KB)`);
    }
  }

  _tryUnlink(file) {
    try { unlinkSync(file); } catch { /* already gone or locked */ }
  }
}

let _instance = null;

/**
 * Singleton accessor. Respects config.store.cacheTTL and DOUBT_CACHE_DISABLED env var.
 */
export function getEvidenceCache() {
  if (_instance) return _instance;

  const config = getConfig();
  const disabled = process.env.DOUBT_CACHE_DISABLED === '1'
    || process.env.DOUBT_CACHE_DISABLED === 'true';

  _instance = new EvidenceCache({
    ttl: config.store?.cacheTTL ?? DEFAULT_TTL_MS,
    enabled: !disabled,
  });

  return _instance;
}
