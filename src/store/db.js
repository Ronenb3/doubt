/**
 * doubt — SQLite Store
 *
 * Persistence layer using sqlite3 CLI — zero npm dependencies.
 * Stores investigations, claims, evidence, contradictions,
 * and learned domain priors.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { log } from '../core/config.js';

export class Store {
  /**
   * @param {string} [dbPath='.doubt/doubt.db']
   */
  constructor(dbPath = '.doubt/doubt.db') {
    this.dbPath = dbPath;
  }

  /**
   * Create the DB directory and all required tables.
   */
  init() {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this._exec(`
      CREATE TABLE IF NOT EXISTS investigations (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        confidence REAL DEFAULT 0,
        fragility_score REAL DEFAULT 0,
        vectors_json TEXT,
        created_at INTEGER,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS claims (
        id TEXT PRIMARY KEY,
        investigation_id TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        confidence REAL DEFAULT 0,
        is_keystone INTEGER DEFAULT 0,
        cascade_size INTEGER DEFAULT 0,
        FOREIGN KEY (investigation_id) REFERENCES investigations(id)
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        claim_id TEXT,
        connector_id TEXT NOT NULL,
        type TEXT NOT NULL,
        source_url TEXT,
        summary TEXT,
        trust_weight REAL DEFAULT 0.5,
        timestamp TEXT,
        FOREIGN KEY (claim_id) REFERENCES claims(id)
      );

      CREATE TABLE IF NOT EXISTS contradictions (
        id TEXT PRIMARY KEY,
        investigation_id TEXT NOT NULL,
        claim_a_id TEXT NOT NULL,
        claim_b_id TEXT NOT NULL,
        type TEXT,
        severity REAL DEFAULT 0,
        explanation TEXT,
        FOREIGN KEY (investigation_id) REFERENCES investigations(id),
        FOREIGN KEY (claim_a_id) REFERENCES claims(id),
        FOREIGN KEY (claim_b_id) REFERENCES claims(id)
      );

      CREATE TABLE IF NOT EXISTS learning (
        domain TEXT PRIMARY KEY,
        prior_alpha REAL DEFAULT 1,
        prior_beta REAL DEFAULT 1,
        investigations_count INTEGER DEFAULT 0,
        last_updated INTEGER
      );
    `);

    log('info', `store: initialized at ${this.dbPath}`);
  }

  /**
   * Save a full investigation object (upserts investigation + children).
   * @param {object} investigation
   */
  save(investigation) {
    const inv = investigation;
    const vectorsJson = inv.vectors ? JSON.stringify(inv.vectors) : null;

    this._exec(`
      INSERT OR REPLACE INTO investigations (id, query, status, confidence, fragility_score, vectors_json, created_at, completed_at)
      VALUES ('${esc(inv.id)}', '${esc(inv.query)}', '${esc(inv.status)}', ${inv.confidence}, ${inv.fragilityScore}, '${esc(vectorsJson)}', ${inv.timestamps.created}, ${inv.timestamps.completed || 'NULL'});
    `);

    for (const claim of inv.claims || []) {
      this._exec(`
        INSERT OR REPLACE INTO claims (id, investigation_id, text, status, confidence, is_keystone, cascade_size)
        VALUES ('${esc(claim.id)}', '${esc(inv.id)}', '${esc(claim.text)}', '${esc(claim.status)}', ${claim.confidence}, ${claim.isKeystone ? 1 : 0}, ${claim.cascadeSize || 0});
      `);
    }

    let evSaved = 0;
    for (const ev of inv.evidence || []) {
      this._exec(`
        INSERT OR REPLACE INTO evidence (id, claim_id, connector_id, type, source_url, summary, trust_weight, timestamp)
        VALUES ('${esc(ev.id)}', ${ev.claimId ? `'${esc(ev.claimId)}'` : 'NULL'}, '${esc(ev.connectorId)}', '${esc(ev.type)}', '${esc(ev.sourceUrl)}', '${esc(ev.summary)}', ${ev.trustWeight}, ${ev.timestamp ? `'${esc(ev.timestamp)}'` : 'NULL'});
      `, false);  // non-critical: don't crash pipeline if one evidence item has bad chars
      evSaved++;
    }

    for (const c of inv.contradictions || []) {
      this._exec(`
        INSERT OR REPLACE INTO contradictions (id, investigation_id, claim_a_id, claim_b_id, type, severity, explanation)
        VALUES ('${esc(c.id)}', '${esc(inv.id)}', '${esc(c.claimA.id)}', '${esc(c.claimB.id)}', '${esc(c.type)}', ${c.severity}, '${esc(c.explanation)}');
      `);
    }

    log('info', `store: saved investigation ${inv.id}`);
  }

  /**
   * Load an investigation by ID, including claims, evidence, contradictions.
   * @param {string} id
   * @returns {object|null}
   */
  load(id) {
    const rows = this._query(`SELECT * FROM investigations WHERE id = '${esc(id)}' LIMIT 1;`);
    if (!rows.length) return null;

    const inv = rows[0];
    inv.vectors = inv.vectors_json ? JSON.parse(inv.vectors_json) : null;
    inv.claims = this._query(`SELECT * FROM claims WHERE investigation_id = '${esc(id)}';`);
    inv.evidence = this._query(`SELECT * FROM evidence WHERE claim_id IN (SELECT id FROM claims WHERE investigation_id = '${esc(id)}');`);
    inv.contradictions = this._query(`SELECT * FROM contradictions WHERE investigation_id = '${esc(id)}';`);

    for (const claim of inv.claims) {
      claim.isKeystone = !!claim.is_keystone;
      claim.cascadeSize = claim.cascade_size;
    }

    log('debug', `store: loaded investigation ${id}`);
    return inv;
  }

  /**
   * Get domain priors for Bayesian learning.
   * @param {string} domain
   * @returns {{ alpha: number, beta: number, count: number } | null}
   */
  getDomainPriors(domain) {
    const rows = this._query(`SELECT * FROM learning WHERE domain = '${esc(domain)}' LIMIT 1;`);
    if (!rows.length) return null;
    return {
      alpha: rows[0].prior_alpha,
      beta: rows[0].prior_beta,
      count: rows[0].investigations_count,
    };
  }

  /**
   * Update or insert domain priors after an investigation.
   * @param {string} domain
   * @param {number} alpha
   * @param {number} beta
   */
  updateDomainPriors(domain, alpha, beta) {
    this._exec(`
      INSERT INTO learning (domain, prior_alpha, prior_beta, investigations_count, last_updated)
      VALUES ('${esc(domain)}', ${alpha}, ${beta}, 1, ${Date.now()})
      ON CONFLICT(domain) DO UPDATE SET
        prior_alpha = ${alpha},
        prior_beta = ${beta},
        investigations_count = investigations_count + 1,
        last_updated = ${Date.now()};
    `);
    log('debug', `store: updated priors for domain "${domain}" (α=${alpha}, β=${beta})`);
  }

  /**
   * List recent investigations.
   * @param {number} [limit=20]
   * @returns {Array}
   */
  listInvestigations(limit = 20) {
    return this._query(`SELECT id, query, status, confidence, fragility_score, created_at, completed_at FROM investigations ORDER BY created_at DESC LIMIT ${limit};`);
  }

  /**
   * Execute raw SQL (no return value).
   * @param {boolean} [throwOnError=true] — set false for non-critical ops
   */
  _exec(sql, throwOnError = true) {
    try {
      execSync(`sqlite3 "${this.dbPath}" "${escapeSql(sql)}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });
    } catch (err) {
      log('error', `store: SQL exec failed: ${err.message.slice(0, 200)}`);
      if (throwOnError) throw err;
    }
  }

  /**
   * Query and return JSON rows.
   */
  _query(sql) {
    try {
      const out = execSync(`sqlite3 -json "${this.dbPath}" "${escapeSql(sql)}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
        encoding: 'utf8',
      });
      const trimmed = out.trim();
      if (!trimmed) return [];
      return JSON.parse(trimmed);
    } catch (err) {
      if (err.stdout && err.stdout.trim() === '') return [];
      log('error', `store: SQL query failed: ${err.message}`);
      return [];
    }
  }
}

/** Escape characters for SQL string values inside shell-invoked sqlite3. */
function esc(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/'/g, "''")
    .replace(/\\/g, '\\\\')
    .replace(/[\x00-\x1f]/g, ' ')  // strip control chars
    .slice(0, 2000);  // cap field length to avoid command-line overflow
}

/** Escape double quotes for shell argument to sqlite3. */
function escapeSql(sql) {
  return sql.replace(/\n/g, ' ').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim();
}
