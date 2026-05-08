/**
 * doubt — NLI Evidence Classifier (LLM-Powered)
 *
 * THE SINGLE MOST IMPORTANT UPGRADE TO THE PIPELINE.
 *
 * Problem: The old StanceClassifier uses keyword matching to determine
 * SUPPORTS/CONTRADICTS/CONTEXTUAL. An article about "Iran sanctions relief"
 * gets classified based on whether "safe" or "crash" appears in the text.
 * That's worse than random for complex geopolitical/investigative queries.
 *
 * The Bayesian engine is mathematically elegant — but it gets garbage input.
 * Garbage in, garbage out. 10,000 evidence items all classified as NEUTRAL
 * means the Bayesian engine does literally nothing.
 *
 * Solution: Use Ollama (free, local LLM) to classify claim-evidence pairs
 * using actual natural language inference. Falls back to the old keyword
 * classifier when no LLM is available.
 *
 * This module is adapted from ARGUS's NLI classifier (argus/src/inference/nli.js)
 * which proved the approach works. Ported to doubt's architecture.
 *
 * THREE MODES (tries in order):
 *   1. Ollama batch (local LLM, free, batches 10 items per call)
 *   2. OpenAI (if DOUBT_LLM_APIKEY set)
 *   3. Pattern heuristic fallback (the old classifier)
 *
 * OUTPUT per evidence item:
 *   { label: 'SUPPORTS'|'CONTRADICTS'|'CONTEXTUAL'|'IRRELEVANT',
 *     confidence: 0.0-1.0,
 *     method: 'ollama'|'openai'|'pattern' }
 */

import { EvidenceType } from '../core/schema.js';
import { getConfig, log } from '../core/config.js';

// Trust weight multipliers by source tier + NLI label
// These override the base trustWeight from the connector
const TRUST_MULTIPLIERS = {
  SUPPORTS: {
    government: 1.4, court: 1.5, academic: 1.3, financial: 1.2,
    news_major: 1.0, news_minor: 0.8, social: 0.5, default: 0.9,
  },
  CONTRADICTS: {
    government: 1.5, court: 1.6, academic: 1.4, financial: 1.3,
    news_major: 1.1, news_minor: 0.85, social: 0.55, default: 0.95,
  },
  CONTEXTUAL: { default: 0.3 },
  IRRELEVANT: { default: 0 },
};

// Map connector IDs to tier names for trust multiplier lookup
const CONNECTOR_TIER = {
  sec_edgar: 'government', sec_insider: 'government', sec_xbrl: 'government',
  federal_register: 'government', congressional_record: 'government',
  usaspending: 'government', usa_spending: 'government', sam_gov: 'government',
  fred: 'government', bls: 'government', fec: 'government',
  ofac: 'government', opensanctions: 'government', interpol: 'government',
  fbi: 'government', nhtsa: 'government', cfpb: 'government',
  courtlistener: 'court', pacer: 'court', state_courts: 'court',
  arxiv: 'academic', pubmed: 'academic', crossref: 'academic',
  semantic_scholar: 'academic', openalex: 'academic', core_research: 'academic',
  clinical_trials: 'academic', papers_with_code: 'academic',
  polygon_market: 'financial', finra: 'financial', fdic: 'financial',
  cftc_cot: 'financial', gleif: 'financial', deep_sec: 'financial',
  guardian: 'news_major', rss_news: 'news_major', gnews: 'news_major',
  brave_news: 'news_major', gdelt: 'news_major', associated_press: 'news_major',
  marketaux: 'news_major', geopolitical: 'news_major', news_intel: 'news_major',
  currents: 'news_minor', searxng: 'news_minor', news_archive: 'news_minor',
  media: 'news_minor',
  reddit: 'social', hackernews: 'social', stocktwits: 'social',
  community: 'social', youtube_transcript: 'social',
};

export class NLIClassifier {
  constructor() {
    const config = getConfig();
    this._llmCfg = config.llm || {};
    this._llmEnabled = !!this._llmCfg.enabled && this._llmCfg.enabled !== 'false';
    this._ollamaUrl = this._llmCfg.endpoint || 'http://localhost:11434';
    this._ollamaModel = this._llmCfg.model || 'llama3';
    this._ollamaAvailable = this._llmEnabled ? null : false; // skip LLM probing when disabled
    this._batchSize = 6; // evidence items per LLM call
    this._maxLLMItems = 500; // cap LLM classification to top-N by trust weight
    this._timeout = 15_000; // 15s per batch — if Ollama is slower than this, switch to pattern
    this._consecutiveTimeouts = 0;
    this._maxConsecutiveTimeouts = 2; // after 2 consecutive timeouts, abandon LLM for this run
  }

  /**
   * Classify all evidence items against the investigation claims.
   * This is the main entry point — replaces StanceClassifier.classify().
   *
   * Strategy:
   *   1. Sort evidence by trust weight (highest first)
   *   2. Classify top N via LLM (if available)
   *   3. Classify remainder via pattern heuristics
   *   4. Apply trust multipliers based on classification
   *
   * @param {Object[]} evidence - All evidence items
   * @param {Object[]} claims - Extracted claims
   * @param {string} query - Original query
   * @returns {Object[]} evidence (mutated in place)
   */
  async classify(evidence, claims, query) {
    if (!evidence?.length) return evidence;

    // Build a claim summary for classification — use ALL claims, not just first
    const claimTexts = (claims || []).map(c => c.text).filter(Boolean);
    const claim = claimTexts.length > 1
      ? `PRIMARY: ${claimTexts[0]}\nSUB-CLAIMS:\n${claimTexts.slice(1).map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : claimTexts[0] || query || '';
    const totalStart = Date.now();

    // Sort by trust weight — classify the most important evidence with LLM
    const sorted = [...evidence].sort((a, b) =>
      (b.trustWeight || 0) - (a.trustWeight || 0)
    );

    const llmAvailable = await this._isOllamaAvailable();

    let llmClassified = 0;
    let patternClassified = 0;

    if (llmAvailable) {
      // Classify top N via LLM in batches
      const llmSlice = sorted.slice(0, this._maxLLMItems);
      const batches = chunk(llmSlice, this._batchSize);
      this._consecutiveTimeouts = 0;
      let abandonLLM = false;

      for (const batch of batches) {
        // If too many consecutive timeouts, stop trying LLM and fall through to pattern
        if (abandonLLM) {
          for (const e of batch) {
            if (!e._nliMethod) { this._classifyPattern(e, claim); patternClassified++; }
          }
          continue;
        }

        try {
          const results = await this._classifyBatchLLM(batch, claim);
          this._consecutiveTimeouts = 0; // reset on success
          for (let i = 0; i < batch.length; i++) {
            const r = results[i];
            if (r) {
              batch[i].type = r.label;
              batch[i]._classificationConfidence = r.confidence;
              batch[i]._nliMethod = 'ollama';
              this._applyTrustMultiplier(batch[i], r.label);
              llmClassified++;
            }
          }
        } catch (err) {
          const isTimeout = err.message?.includes('abort') || err.message?.includes('timeout') || err.name === 'AbortError';
          if (isTimeout) {
            this._consecutiveTimeouts++;
            if (this._consecutiveTimeouts >= this._maxConsecutiveTimeouts) {
              log('warn', `NLI: ${this._consecutiveTimeouts} consecutive timeouts — Ollama too slow, switching to pattern classifier for remainder`);
              abandonLLM = true;
            }
          }
          log('warn', `NLI batch failed: ${err.message}`);
          for (const e of batch) {
            if (!e._nliMethod) { this._classifyPattern(e, claim); patternClassified++; }
          }
        }
      }

      // Classify remaining via pattern
      const remaining = sorted.slice(this._maxLLMItems);
      for (const e of remaining) {
        this._classifyPattern(e, claim);
        patternClassified++;
      }
    } else {
      // No LLM — all pattern
      for (const e of evidence) {
        this._classifyPattern(e, claim);
        patternClassified++;
      }
    }

    const elapsed = Date.now() - totalStart;
    const stats = this.getStats(evidence);
    log('info', `NLI classifier: ${llmClassified} LLM + ${patternClassified} pattern in ${elapsed}ms | ${stats.supports}S ${stats.contradicts}C ${stats.contextual}X ${stats.neutral}N`);

    return evidence;
  }

  // ─── LLM Batch Classification ─────────────────────────────────

  async _classifyBatchLLM(batch, claim) {
    const items = batch.map((e, i) => {
      const text = (e.summary || e.data?.title || '').slice(0, 300);
      const src = e.connectorId || 'unknown';
      return `[${i + 1}] (${src}) ${text}`;
    }).join('\n');

    const prompt = `You are an evidence classifier for investigative intelligence.

CLAIM: "${claim.slice(0, 500)}"

EVIDENCE ITEMS:
${items}

For each numbered item, classify its relationship to the CLAIM:
- SUPPORTS: Evidence directly supports or confirms the claim
- CONTRADICTS: Evidence directly undermines or disproves the claim
- CONTEXTUAL: Related background information but doesn't directly support or contradict
- IRRELEVANT: Not related to the claim at all

Reply with ONLY a JSON array of objects, one per item, in order:
[{"label":"SUPPORTS","confidence":0.8},{"label":"CONTRADICTS","confidence":0.9},...]

confidence = how certain you are about the classification (0.0-1.0)
Do NOT include any other text. ONLY the JSON array.`;

    const raw = await this._callOllama(prompt);
    if (!raw) return batch.map(() => null);

    // Parse JSON from response
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return batch.map(() => null);

      const parsed = JSON.parse(match[0]);
      return parsed.map(r => {
        const label = this._normalizeLabel(r.label || r.Label || '');
        const confidence = Math.min(1, Math.max(0, r.confidence || r.Confidence || 0.5));
        return label ? { label, confidence } : null;
      });
    } catch {
      return batch.map(() => null);
    }
  }

  _normalizeLabel(label) {
    const upper = (label || '').toUpperCase().trim();
    if (upper === 'SUPPORTS' || upper === 'SUPPORT') return EvidenceType.SUPPORTS;
    if (upper === 'CONTRADICTS' || upper === 'CONTRADICT' || upper === 'CONTRADICTING') return EvidenceType.CONTRADICTS;
    if (upper === 'CONTEXTUAL' || upper === 'CONTEXT') return EvidenceType.CONTEXTUAL;
    if (upper === 'IRRELEVANT' || upper === 'NEUTRAL') return EvidenceType.NEUTRAL;
    return null;
  }

  // ─── Pattern Fallback ──────────────────────────────────────

  _classifyPattern(evidence, claim) {
    const text = (evidence.summary || evidence.data?.title || '').toLowerCase();
    const claimLower = claim.toLowerCase();

    if (!text) {
      evidence.type = EvidenceType.NEUTRAL;
      evidence._classificationConfidence = 0;
      evidence._nliMethod = 'pattern';
      return;
    }

    // Entity overlap check
    const claimWords = new Set(
      claimLower.split(/\s+/).filter(w => w.length > 3)
    );
    const overlap = [...claimWords].filter(w => text.includes(w)).length;
    const overlapRatio = claimWords.size > 0 ? overlap / claimWords.size : 0;

    if (overlapRatio < 0.1) {
      evidence.type = EvidenceType.NEUTRAL;
      evidence._classificationConfidence = 0.3;
      evidence._nliMethod = 'pattern';
      return;
    }

    // Stance signals
    const supportSignals = countPatterns(text, SUPPORT_PATTERNS);
    const contradictSignals = countPatterns(text, CONTRADICT_PATTERNS);
    const totalSignals = supportSignals + contradictSignals;

    if (totalSignals === 0 || (totalSignals < 2 && overlapRatio < 0.3)) {
      evidence.type = EvidenceType.CONTEXTUAL;
      evidence._classificationConfidence = 0.4;
      evidence._nliMethod = 'pattern';
      this._applyTrustMultiplier(evidence, 'CONTEXTUAL');
      return;
    }

    const dominance = (supportSignals - contradictSignals) / totalSignals;

    if (Math.abs(dominance) < 0.3) {
      evidence.type = EvidenceType.CONTEXTUAL;
      evidence._classificationConfidence = 0.45;
    } else if (dominance > 0) {
      evidence.type = EvidenceType.SUPPORTS;
      evidence._classificationConfidence = Math.min(0.75, 0.4 + dominance * 0.3);
    } else {
      evidence.type = EvidenceType.CONTRADICTS;
      evidence._classificationConfidence = Math.min(0.75, 0.4 + Math.abs(dominance) * 0.3);
    }

    evidence._nliMethod = 'pattern';
    this._applyTrustMultiplier(evidence, evidence.type === EvidenceType.SUPPORTS ? 'SUPPORTS' : evidence.type === EvidenceType.CONTRADICTS ? 'CONTRADICTS' : 'CONTEXTUAL');
  }

  // ─── Trust Multiplier ──────────────────────────────────────

  _applyTrustMultiplier(evidence, label) {
    const tier = CONNECTOR_TIER[evidence.connectorId] || 'default';
    const multipliers = TRUST_MULTIPLIERS[label] || TRUST_MULTIPLIERS.CONTEXTUAL;
    const mult = multipliers[tier] || multipliers.default || 1.0;

    if (Number.isFinite(evidence.trustWeight)) {
      evidence.trustWeight = Math.min(1, evidence.trustWeight * mult);
    }
  }

  // ─── Ollama Communication ──────────────────────────────────

  async _isOllamaAvailable() {
    if (this._ollamaAvailable !== null) return this._ollamaAvailable;

    try {
      const res = await fetch(`${this._ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      this._ollamaAvailable = res.ok;
    } catch {
      this._ollamaAvailable = false;
    }

    return this._ollamaAvailable;
  }

  async _callOllama(prompt) {
    const res = await fetch(`${this._ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this._ollamaModel,
        prompt,
        stream: false,
        options: {
          num_predict: 1500,
          temperature: 0.1,  // very low temp for classification
        },
      }),
      signal: AbortSignal.timeout(this._timeout),
    });

    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    return data.response || null;
  }

  // ─── Stats ──────────────────────────────────────────────────

  getStats(evidence) {
    const stats = { supports: 0, contradicts: 0, contextual: 0, neutral: 0, llm: 0, pattern: 0 };
    for (const e of evidence) {
      if (e.type === EvidenceType.SUPPORTS) stats.supports++;
      else if (e.type === EvidenceType.CONTRADICTS) stats.contradicts++;
      else if (e.type === EvidenceType.CONTEXTUAL) stats.contextual++;
      else stats.neutral++;
      if (e._nliMethod === 'ollama') stats.llm++;
      else stats.pattern++;
    }
    return stats;
  }
}

// ─── Pattern Constants ───────────────────────────────────────

const SUPPORT_PATTERNS = [
  /\bconfirmed?\b/i, /\bverified?\b/i, /\bproved?\b/i, /\bdemonstrated?\b/i,
  /\bestablished?\b/i, /\bdocumented?\b/i, /\breported\b/i, /\bpublished\b/i,
  /\bfiled\b/i, /\bregistered\b/i, /\bsigned\b/i, /\bfounded\b/i,
  /\blaunched\b/i, /\bannounced?\b/i, /\breleased?\b/i, /\bfunded?\b/i,
  /\bapproved\b/i, /\bcertified\b/i, /\bcompliant\b/i, /\bauthorized\b/i,
  /\bawarded\b/i, /\bpassed\b/i, /\bvalidated\b/i, /\bendorsed\b/i,
];

const CONTRADICT_PATTERNS = [
  /\bno evidence\b/i, /\bdenied?\b/i, /\bfalse\b/i, /\bmisleading\b/i,
  /\bdebunked?\b/i, /\bmyth\b/i, /\bincorrect\b/i, /\bdid not\b/i,
  /\bnever happened\b/i, /\bunfounded\b/i, /\bcontradicts?\b/i,
  /\brejects?\b/i, /\bdisputed?\b/i, /\bnot true\b/i, /\bcorrection\b/i,
  /\bfailed\b/i, /\bviolation\b/i, /\bfraud\b/i, /\brecalled\b/i,
  /\bdefective\b/i, /\bunsafe\b/i, /\bdeceptive\b/i, /\bsanctioned\b/i,
];

function countPatterns(text, patterns) {
  let count = 0;
  for (const p of patterns) { if (p.test(text)) count++; }
  return count;
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export default NLIClassifier;
