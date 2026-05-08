/**
 * doubt — Shared LLM client.
 *
 * Single multi-provider entry point used by every LLM-dependent component
 * (synthesis, claim-matching, fact-ranking, adversarial generation, etc.).
 *
 * Before this existed, llm-claim-matcher hardcoded Ollama-only and bypassed
 * the provider router — so when Ollama wasn't running locally, 100% of
 * evidence-claim links fell to keyword fallback even though the rest of the
 * pipeline was happily calling Anthropic. This module fixes that asymmetry.
 *
 * Providers: ollama (default), openai, anthropic, custom.
 * All providers respect llm.maxTokens / llm.temperature / llm.endpoint
 * from config, with sensible per-provider defaults.
 *
 * Returns the raw text response, or null when the LLM is disabled / errored.
 * Throws only on programmer error (bad config); transient errors return null
 * and are logged.
 */

import { log, getConfig } from './config.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 1;
const RETRY_BACKOFF_MS = 800;

/**
 * Call the configured LLM provider. Returns text or null.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]   per-attempt timeout
 * @param {number} [opts.retries]     number of retries on transient failure
 * @param {number} [opts.maxTokens]   override config maxTokens
 * @param {number} [opts.temperature] override config temperature
 * @returns {Promise<string|null>}
 */
export async function callLLM(prompt, opts = {}) {
  const cfg = getConfig().llm || {};
  if (!cfg.enabled || cfg.enabled === 'false') return null;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const provider = (cfg.provider || 'ollama').toLowerCase();

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const text = await dispatchProvider(provider, prompt, cfg, opts, timeoutMs);
      if (text != null) return text;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const wait = RETRY_BACKOFF_MS * (attempt + 1);
        log('debug', `llm: ${provider} attempt ${attempt + 1} failed (${err.message}) — retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }
    }
  }

  if (lastErr) log('debug', `llm: ${provider} failed after ${retries + 1} attempts — ${lastErr.message}`);
  return null;
}

/**
 * Probe whether the configured provider is actually reachable.
 * Useful for components that want to bail to a non-LLM fallback before
 * spending time building a prompt.
 */
export async function isLLMAvailable() {
  const cfg = getConfig().llm || {};
  if (!cfg.enabled || cfg.enabled === 'false') return false;

  const provider = (cfg.provider || 'ollama').toLowerCase();

  if (provider === 'ollama') {
    const endpoint = cfg.endpoint || 'http://localhost:11434';
    try {
      const res = await fetchWithTimeout(`${endpoint}/api/tags`, { method: 'GET' }, 3000);
      return res.ok;
    } catch {
      return false;
    }
  }

  // Cloud providers: presence of an API key is the best signal we can give
  // without spending a real round-trip. The first call() will surface a 401.
  return !!cfg.apiKey;
}

/**
 * Tolerant JSON parser. LLMs frequently emit minor irregularities
 * (trailing commas, code-fence wrapping, leading prose). Try strict first,
 * then progressively repair.
 *
 * Returns parsed value or null. Never throws.
 */
export function parseLenientJson(raw) {
  if (raw == null) return null;
  let text = String(raw).trim();
  if (!text) return null;

  // Strip code fences: ```json ... ``` or ``` ... ```
  text = text.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '');

  // First attempt: strict.
  try { return JSON.parse(text); } catch {}

  // Extract the largest array or object substring.
  const slice = extractJsonSlice(text);
  if (slice == null) return null;

  // Strip trailing commas inside arrays/objects.
  // Matches: ",  ]" or ",\n]" or ",  }" — anywhere in the string.
  const repaired = slice.replace(/,(\s*[\]}])/g, '$1');

  try { return JSON.parse(repaired); } catch {}

  // Last resort: try to evaluate it as a JS literal in a sandbox-ish way.
  // Only safe for scalar arrays of numbers/strings, which covers most
  // ranking responses. Reject anything containing identifiers or function
  // calls.
  if (/^[\[\]{}":,\s\d.\-+truefalsnl"'\\\/]*$/.test(repaired)) {
    try {
      // eslint-disable-next-line no-new-func
      return Function(`"use strict"; return (${repaired});`)();
    } catch {}
  }

  return null;
}

// ─── Internals ──────────────────────────────────────────────────

async function dispatchProvider(provider, prompt, cfg, opts, timeoutMs) {
  switch (provider) {
    case 'ollama':    return callOllama(prompt, cfg, opts, timeoutMs);
    case 'openai':    return callOpenAI(prompt, cfg, opts, timeoutMs);
    case 'anthropic': return callAnthropic(prompt, cfg, opts, timeoutMs);
    case 'custom':    return callCustom(prompt, cfg, opts, timeoutMs);
    default:
      log('warn', `llm: unknown provider "${provider}"`);
      return null;
  }
}

async function callOllama(prompt, cfg, opts, timeoutMs) {
  const endpoint = cfg.endpoint || 'http://localhost:11434';
  const res = await fetchWithTimeout(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model || 'llama3.2',
      prompt,
      stream: false,
      options: {
        num_predict: opts.maxTokens ?? cfg.maxTokens ?? 2000,
        temperature: opts.temperature ?? parseFloat(cfg.temperature) ?? 0.3,
      },
    }),
  }, timeoutMs);

  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const data = await res.json();
  return data.response || null;
}

async function callOpenAI(prompt, cfg, opts, timeoutMs) {
  const endpoint = cfg.endpoint || 'https://api.openai.com/v1/chat/completions';
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: opts.maxTokens ?? parseInt(cfg.maxTokens) ?? 2000,
      temperature: opts.temperature ?? parseFloat(cfg.temperature) ?? 0.3,
    }),
  }, timeoutMs);

  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}

async function callAnthropic(prompt, cfg, opts, timeoutMs) {
  const endpoint = cfg.endpoint || 'https://api.anthropic.com/v1/messages';
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.model || 'claude-haiku-4-5-20251001',
      max_tokens: opts.maxTokens ?? parseInt(cfg.maxTokens) ?? 2000,
      messages: [{ role: 'user', content: prompt }],
      temperature: opts.temperature ?? parseFloat(cfg.temperature) ?? 0.3,
    }),
  }, timeoutMs);

  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || null;
}

async function callCustom(prompt, cfg, opts, timeoutMs) {
  const endpoint = cfg.endpoint;
  if (!endpoint) throw new Error('custom provider requires llm.endpoint');

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: opts.maxTokens ?? parseInt(cfg.maxTokens) ?? 2000,
      temperature: opts.temperature ?? parseFloat(cfg.temperature) ?? 0.3,
    }),
  }, timeoutMs);

  if (!res.ok) throw new Error(`custom ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content
    || data.content?.[0]?.text
    || data.response
    || null;
}

function extractJsonSlice(text) {
  // Prefer the outermost array; fall back to the outermost object.
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  return null;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  // Use AbortController so the timeout actually kills the underlying
  // request. The previous Promise.race pattern only rejected the caller's
  // promise — the fetch kept running, holding the connection. With Ollama
  // (single inference slot), dead fetches piled up behind each other and
  // every subsequent batch sat in queue, blowing the matcher's wall-clock
  // budget by orders of magnitude.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
