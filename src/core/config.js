/**
 * doubt — Configuration
 *
 * Zero-config by default. Every connector works without API keys.
 * Keys are optional performance upgrades, not requirements.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const defaults = {
  // Connector settings
  connectors: {
    timeout: 20000,
    retries: 1,
    retryDelay: 500,
    maxConcurrent: 12,
    userAgent: 'doubt/0.1.0 research-tool contact@doubt.tools',
    // SEC EDGAR requires a specific User-Agent format: "tool-name contact@email.com"
    // Using a generic UA gets a 403 "Undeclared Automated Tool" block.
    secUserAgent: 'doubt-research/1.0 contact@doubt.tools',
  },

  // Pipeline settings
  pipeline: {
    maxSources: 30,
    maxEvidence: 200,
    maxClaims: 100,
    timeout: 120000,
  },

  // Epistemic thresholds — the dual gate
  epistemic: {
    evidenceGate: 0.70,     // Bayesian confidence must reach this
    knowGate: 0.70,         // epistemic know vector must reach this
    uncertaintyMax: 0.35,   // uncertainty must stay below this
    minSources: 3,          // minimum distinct sources before any conclusion
    minDiversity: 0.30,     // citation diversity floor
  },

  // Inference settings
  inference: {
    priorAlpha: 1,          // Beta-Bernoulli prior (uniform)
    priorBeta: 1,
    contradictionSeverityThreshold: 0.50,
  },

  // Storage
  store: {
    dbPath: null,           // set by CLI, defaults to .doubt/doubt.db
    cacheTTL: 86400000,     // 24 hours
    maxCacheSize: 500,      // max cached responses per connector
  },

  // LLM synthesis (optional — heuristic synthesis works without any LLM)
  llm: {
    enabled: true,
    provider: 'ollama',     // 'ollama', 'openai', 'anthropic', 'custom'
    endpoint: 'http://localhost:11434',
    model: 'llama3:latest',
    apiKey: null,
    maxTokens: 2000,
    temperature: 0.3,
  },

  // API keys (all optional — system works without any)
  keys: {},

  // Display
  display: {
    color: true,
    verbose: false,
    showProgress: true,
  },
};

let _config = null;

export function getConfig() {
  if (_config) return _config;
  _config = { ...defaults };

  // Load .env if it exists
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match) {
        const [, key, value] = match;
        _config.keys[key.toLowerCase()] = value.trim().replace(/^["']|["']$/g, '');
      }
    }
  }

  // Auto-detect LLM provider from environment
  if (process.env.ANTHROPIC_API_KEY) {
    _config.llm.provider = 'anthropic';
    _config.llm.model = 'claude-haiku-4-5-20251001';
    _config.llm.apiKey = process.env.ANTHROPIC_API_KEY;
    _config.llm.endpoint = null;
  } else if (process.env.OPENAI_API_KEY) {
    _config.llm.provider = 'openai';
    _config.llm.model = 'gpt-4o-mini';
    _config.llm.apiKey = process.env.OPENAI_API_KEY;
    _config.llm.endpoint = null;
  }

  // Environment variables override
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith('DOUBT_')) {
      const path = key.slice(6).toLowerCase().split('_');
      let obj = _config;
      for (let i = 0; i < path.length - 1; i++) {
        obj = obj[path[i]] = obj[path[i]] || {};
      }
      // Coerce boolean/number strings so DOUBT_LLM_ENABLED=false works correctly
      let coerced = val;
      if (val === 'true') coerced = true;
      else if (val === 'false') coerced = false;
      else if (/^\d+$/.test(val)) coerced = parseInt(val);
      obj[path[path.length - 1]] = coerced;
    }
  }

  return _config;
}

// Rate limiter shared across all connectors
const _lastCall = new Map();

export async function rateLimit(host, minMs = 1000) {
  const now = Date.now();
  const last = _lastCall.get(host) || 0;
  const wait = Math.max(0, minMs - (now - last));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastCall.set(host, Date.now());
}

// Logging
const levels = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
let _level = levels.info;

export function setLogLevel(level) { _level = levels[level] || levels.info; }

export function log(level, ...args) {
  if ((levels[level] || 0) >= _level) {
    const prefix = { debug: '  ', info: '→', warn: '⚠', error: '✗' }[level] || ' ';
    console.error(`${prefix}`, ...args);
  }
}
