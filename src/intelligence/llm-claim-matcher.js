/**
 * doubt — LLM-Powered Evidence-Claim Matcher
 *
 * The old claim-matcher used keyword/entity overlap (Jaccard) to link
 * evidence to claims. This works for simple queries like "Tesla revenue"  
 * but fails catastrophically for complex geopolitical investigations
 * where evidence about "uranium enrichment levels breach NPT" doesn't  
 * share enough keywords with "Iran has been enriching uranium beyond 
 * JCPOA limits."
 *
 * This module uses the local LLM (Ollama) to semantically match evidence 
 * to claims. Given a batch of evidence items and a list of claims, the
 * LLM assigns each evidence item to its most relevant claim with a
 * confidence score.
 *
 * Falls back to keyword matching when Ollama is unavailable.
 */

import { log } from '../core/config.js';
import ClaimMatcher from './claim-matcher.js';

const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const MODEL = 'llama3';
const BATCH_SIZE = 8;  // Evidence items per LLM call
const TIMEOUT_MS = 45000;

export class LLMClaimMatcher {
  constructor() {
    this._available = null;
    this._fallback = new ClaimMatcher();
    this._stats = { llm: 0, fallback: 0, total: 0 };
  }

  async _checkAvailable() {
    if (this._available !== null) return this._available;
    try {
      const resp = await fetch('http://127.0.0.1:11434/api/tags', {
        signal: AbortSignal.timeout(3000),
      });
      this._available = resp.ok;
    } catch {
      this._available = false;
    }
    return this._available;
  }

  /**
   * Match evidence to claims using LLM semantic understanding.
   * Falls back to keyword matcher if Ollama unavailable.
   *
   * @param {Array} evidence - evidence items to match
   * @param {Array} claims - claims to match against
   * @returns {Array} evidence with claimId assigned (mutated in-place)
   */
  async match(evidence, claims) {
    if (!evidence?.length || !claims?.length) return evidence;

    this._stats = { llm: 0, fallback: 0, total: evidence.length };

    const canUseLLM = await this._checkAvailable();

    if (!canUseLLM) {
      log('info', 'LLM claim-matcher: Ollama unavailable, using keyword fallback');
      this._fallback.match(evidence, claims);
      this._stats.fallback = evidence.filter(e => e.claimId).length;
      return evidence;
    }

    // Build claim summary for the prompt
    const claimList = claims.map((c, i) => ({
      index: i + 1,
      id: c.id,
      text: (c.text || '').slice(0, 200),
    }));

    const claimSummary = claimList
      .map(c => `${c.index}. [${c.id}] ${c.text}`)
      .join('\n');

    // Process evidence in batches
    const batches = [];
    for (let i = 0; i < evidence.length; i += BATCH_SIZE) {
      batches.push(evidence.slice(i, i + BATCH_SIZE));
    }

    log('info', `LLM claim-matcher: matching ${evidence.length} evidence items to ${claims.length} claims in ${batches.length} batches`);

    for (const batch of batches) {
      try {
        await this._matchBatch(batch, claimList, claimSummary);
      } catch (err) {
        log('debug', `LLM batch failed, falling back: ${err.message}`);
        // Fallback for this batch
        this._fallback.match(batch, claims);
        this._stats.fallback += batch.filter(e => e.claimId).length;
      }
    }

    const matched = evidence.filter(e => e.claimId).length;
    const matchRate = evidence.length > 0 ? matched / evidence.length : 0;

    log('info', `LLM claim-matcher: ${matched}/${evidence.length} matched (${this._stats.llm} LLM, ${this._stats.fallback} keyword fallback)`);

    // Diagnostic: warn if match rate is suspiciously low
    if (evidence.length > 20 && matchRate < 0.3) {
      log('warn', `⚠️ QUALITY ALERT: Only ${(matchRate * 100).toFixed(1)}% of evidence linked to claims (${matched}/${evidence.length}). ` +
        `This suggests either: (1) claims are too generic/unfalsifiable, (2) LLM is struggling with query semantics, or (3) evidence is low-relevance. ` +
        `Investigation confidence should be treated as contested.`);
    }

    // Diagnostic: warn if purely fallback (LLM failed entirely)
    if (matched > 0 && this._stats.llm === 0 && this._stats.fallback === matched) {
      log('warn', `⚠️ CRITICAL: All evidence-claim links via keyword fallback (0 LLM successes). Semantic matching failed. ` +
        `Confidence in claims is significantly reduced.`);
    }

    return evidence;
  }

  /**
   * Process a single batch of evidence items against the claim list.
   */
  async _matchBatch(batch, claimList, claimSummary) {
    const evidenceSummaries = batch.map((e, i) => {
      const text = (e.summary || e.text || '').slice(0, 300);
      const source = e.connectorId || 'unknown';
      return `E${i + 1} [${source}]: ${text}`;
    }).join('\n\n');

    const prompt = `You are an evidence-to-claim matching system. Given a list of claims and a batch of evidence items, determine which claim each evidence item is MOST relevant to.

CLAIMS:
${claimSummary}

EVIDENCE ITEMS:
${evidenceSummaries}

For each evidence item, respond with ONLY a JSON array of objects:
[{"evidence": "E1", "claim": 1, "confidence": 0.85}, {"evidence": "E2", "claim": 3, "confidence": 0.6}]

Rules:
- "claim" is the claim NUMBER (1-${claimList.length})
- "confidence" is 0.0-1.0 (how confident you are this evidence relates to that claim)
- If evidence doesn't match ANY claim well, set confidence below 0.2
- Match based on MEANING, not just shared keywords
- An evidence item about "uranium enrichment violations" matches a claim about "Iran exceeding JCPOA limits" even without shared words

Return ONLY the JSON array. No commentary.`;

    const resp = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
    const data = await resp.json();
    const raw = (data.response || '').trim();

    // Parse JSON from response
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrMatch) throw new Error('No JSON array in response');

    const assignments = JSON.parse(arrMatch[0]);
    if (!Array.isArray(assignments)) throw new Error('Not an array');

    // Apply assignments
    for (const assignment of assignments) {
      const eIdx = parseInt((assignment.evidence || '').replace(/\D/g, ''), 10) - 1;
      const cIdx = (assignment.claim || 0) - 1;
      const confidence = assignment.confidence || 0;

      if (eIdx < 0 || eIdx >= batch.length) continue;
      if (cIdx < 0 || cIdx >= claimList.length) continue;
      if (confidence < 0.2) continue;

      batch[eIdx].claimId = claimList[cIdx].id;
      batch[eIdx]._matchScore = confidence;
      batch[eIdx]._matchMethod = 'llm';
      this._stats.llm++;
    }

    // Any unmatched items in this batch get keyword fallback
    const unmatched = batch.filter(e => !e.claimId);
    if (unmatched.length > 0) {
      // Quick keyword match for items LLM couldn't assign
      const claimObjs = claimList.map(c => ({ id: c.id, text: c.text }));
      this._fallback.match(unmatched, claimObjs);
      this._stats.fallback += unmatched.filter(e => e.claimId).length;
    }
  }

  /**
   * Build claim-evidence map (same interface as old ClaimMatcher).
   */
  buildEvidenceMap(evidence, claims) {
    return this._fallback.buildEvidenceMap(evidence, claims);
  }

  /**
   * Enrich claims with matched evidence metadata (same interface).
   */
  enrichClaims(claims, evidence) {
    return this._fallback.enrichClaims(claims, evidence);
  }

  getStats() {
    return { ...this._stats };
  }
}

export default LLMClaimMatcher;
