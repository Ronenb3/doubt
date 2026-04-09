/**
 * doubt — LLM Synthesis (Optional)
 *
 * Deep pattern analysis powered by any LLM provider.
 * Supplements (never replaces) the heuristic synthesis engine.
 * When no LLM is configured, every method returns null — zero impact on the pipeline.
 *
 * Supported providers:
 *   ollama   — local, zero config (default)
 *   openai   — requires DOUBT_LLM_APIKEY
 *   anthropic — requires DOUBT_LLM_APIKEY
 *   custom   — any OpenAI-compatible endpoint
 */

import { log, getConfig } from '../core/config.js';

const TIMEOUT_MS = 60_000;

export class LLMSynthesis {

  constructor() {
    const config = getConfig();
    this._cfg = config.llm || {};
    this._enabled = !!this._cfg.enabled && this._cfg.enabled !== 'false';

    if (this._enabled) {
      log('info', `llm-synthesis: provider=${this._cfg.provider} model=${this._cfg.model}`);
    }
  }

  // ─── Public API ──────────────────────────────────────────────

  /**
   * Produce deep analysis by combining heuristic synthesis with LLM reasoning.
   * Returns null when no LLM is available — caller keeps using heuristic output.
   */
  async synthesize(evidence, claims, query, heuristicSynthesis) {
    if (!this._enabled) return null;

    try {
      const prompt = this._buildPrompt(evidence, claims, query, heuristicSynthesis);
      const start = Date.now();
      const raw = await this._callProvider(prompt);
      const latencyMs = Date.now() - start;

      if (!raw) return null;

      const parsed = this._parseResponse(raw);

      return {
        available: true,
        patterns: parsed.patterns,
        credibilityNotes: parsed.credibilityNotes,
        missingAngles: parsed.missingAngles,
        synthesis: parsed.synthesis,
        confidenceRecommendation: parsed.confidenceRecommendation,
        rawResponse: raw,
        model: this._cfg.model,
        latencyMs,
      };
    } catch (err) {
      log('warn', `llm-synthesis: failed — ${err.message}`);
      return null;
    }
  }

  /**
   * True when an LLM provider is configured. Does NOT guarantee reachability.
   * For ollama, pings the endpoint to confirm the server is up.
   */
  async isAvailable() {
    if (!this._enabled) return false;

    if (this._cfg.provider === 'ollama') {
      try {
        const res = await fetchWithTimeout(`${this._cfg.endpoint}/api/tags`, {
          method: 'GET',
        }, 5000);
        return res.ok;
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Re-rank facts by actual relevance to the query using the LLM.
   * This is the critical fix for heuristic ranking failures.
   * Returns facts in relevance order, or the original array if LLM unavailable.
   */
  async rankFacts(facts, query) {
    if (!this._enabled || facts.length === 0) return facts;

    try {
      const items = facts.slice(0, 20).map((f, i) =>
        `${i + 1}. [${f.source?.connectorId || '?'}] ${(f.formatted || f.text || '').slice(0, 120)}`
      ).join('\n');

      const prompt = `You are ranking evidence facts by relevance to a specific claim.

CLAIM: "${query}"

FACTS (numbered):
${items}

Task: Rank these facts by how directly relevant they are to the claim above.
- Prioritize facts that directly address the claim topic
- Deprioritize facts about unrelated topics (financial complaints for a safety query, etc.)

Reply with ONLY a JSON array of the fact numbers in order from MOST to LEAST relevant.
Example format: [3,1,7,2,5,4,6]`;

      const raw = await this._callProvider(prompt);
      if (!raw) return facts;

      // Parse the JSON array from the response
      const match = raw.match(/\[[\d,\s]+\]/);
      if (!match) return facts;

      const order = JSON.parse(match[0]);
      if (!Array.isArray(order)) return facts;

      // Re-order facts according to LLM ranking
      const reranked = [];
      const used = new Set();
      for (const idx of order) {
        const i = idx - 1;
        if (i >= 0 && i < facts.length && !used.has(i)) {
          reranked.push(facts[i]);
          used.add(i);
        }
      }
      // Append any facts not mentioned in the ranking
      for (let i = 0; i < facts.length; i++) {
        if (!used.has(i)) reranked.push(facts[i]);
      }

      log('info', `llm-synthesis: re-ranked ${reranked.length} facts for relevance`);
      return reranked;
    } catch (err) {
      log('warn', `llm-synthesis: fact ranking failed — ${err.message}`);
      return facts;
    }
  }

  // ─── Prompt Construction ─────────────────────────────────────

  _buildPrompt(evidence, claims, query, heuristic) {
    const topEvidence = [...evidence]
      .sort((a, b) => (b.trustWeight || 0) - (a.trustWeight || 0))
      .slice(0, 50);

    const evidenceBlock = topEvidence.map((ev, i) => {
      const stance = ev.type || 'contextual';
      const trust = (ev.trustWeight || 0).toFixed(2);
      const src = ev.connectorId || 'unknown';
      const text = (ev.summary || ev.data?.title || '').slice(0, 200);
      return `[${i + 1}] (${stance}, trust=${trust}, src=${src}) ${text}`;
    }).join('\n');

    const heuristicBlock = [
      `Direction: ${heuristic.overallDirection || 'unknown'}`,
      `Stance: ${JSON.stringify(heuristic.stanceBreakdown || {})}`,
      `Themes: ${(heuristic.themes || []).map(t => t.name).join(', ') || 'none'}`,
      `Top findings: ${(heuristic.topFindingSentences || []).join('; ') || 'none'}`,
      `Summary: ${heuristic.summary || 'none'}`,
    ].join('\n');

    const heuristicConfidence = this._inferConfidence(heuristic);

    return `You are an investigative analyst writing a brief for a decision-maker. The investigation question is: "${query}"

Based on the evidence below, provide FIVE clearly-labeled sections:

1. PATTERN ANALYSIS
What non-obvious patterns do you see ACROSS the evidence? Look for: convergence of independent sources, temporal clusters, contradictions between source tiers, information that only appears in one source category. Be specific — name the sources and what they show.

2. CREDIBILITY ASSESSMENT
Which evidence is most trustworthy and why? Which is least? Flag any evidence that appears to be noise or unrelated to the actual question.

3. MISSING ANGLES
What critical aspects of this question are NOT covered by the evidence? What sources SHOULD have been consulted? What would change the assessment if discovered?

4. SYNTHESIS
In 3-5 sentences, directly answer the investigation question: "${query}"
Do NOT just summarize statistics. State what the evidence shows, where it agrees, where it conflicts, and what a reasonable person should conclude. Acknowledge uncertainty where it exists.

5. CONFIDENCE RECOMMENDATION
Should confidence be higher or lower than ${heuristicConfidence}%? Explain in one sentence.

Evidence (${topEvidence.length} items, sorted by trust):
${evidenceBlock}

Heuristic Analysis:
${heuristicBlock}

IMPORTANT: Label each section exactly as shown (e.g., "1. PATTERN ANALYSIS:"). Be direct and specific. Do not hedge excessively.`;
  }

  _inferConfidence(heuristic) {
    const stance = heuristic.stanceBreakdown || {};
    const total = (stance.supports || 0) + (stance.contradicts || 0) + (stance.contextual || 0) + (stance.neutral || 0);
    if (total === 0) return 50;
    const directional = (stance.supports || 0) + (stance.contradicts || 0);
    if (directional === 0) return 40;
    const dominance = Math.max(stance.supports || 0, stance.contradicts || 0) / directional;
    return Math.round(dominance * 100);
  }

  // ─── Provider Dispatch ───────────────────────────────────────

  async _callProvider(prompt) {
    const provider = (this._cfg.provider || 'ollama').toLowerCase();

    switch (provider) {
      case 'ollama':    return this._callOllama(prompt);
      case 'openai':    return this._callOpenAI(prompt);
      case 'anthropic': return this._callAnthropic(prompt);
      case 'custom':    return this._callCustom(prompt);
      default:
        log('warn', `llm-synthesis: unknown provider "${provider}"`);
        return null;
    }
  }

  async _callOllama(prompt) {
    const endpoint = this._cfg.endpoint || 'http://localhost:11434';
    const res = await fetchWithTimeout(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this._cfg.model || 'llama3.2',
        prompt,
        stream: false,
        options: {
          num_predict: this._cfg.maxTokens || 2000,
          temperature: parseFloat(this._cfg.temperature) || 0.3,
        },
      }),
    }, TIMEOUT_MS);

    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json();
    return data.response || null;
  }

  async _callOpenAI(prompt) {
    const endpoint = this._cfg.endpoint || 'https://api.openai.com/v1/chat/completions';
    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this._cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this._cfg.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: parseInt(this._cfg.maxTokens) || 2000,
        temperature: parseFloat(this._cfg.temperature) || 0.3,
      }),
    }, TIMEOUT_MS);

    if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  }

  async _callAnthropic(prompt) {
    const endpoint = this._cfg.endpoint || 'https://api.anthropic.com/v1/messages';
    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this._cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this._cfg.model || 'claude-sonnet-4-20250514',
        max_tokens: parseInt(this._cfg.maxTokens) || 2000,
        messages: [{ role: 'user', content: prompt }],
        temperature: parseFloat(this._cfg.temperature) || 0.3,
      }),
    }, TIMEOUT_MS);

    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json();
    return data.content?.[0]?.text || null;
  }

  async _callCustom(prompt) {
    const endpoint = this._cfg.endpoint;
    if (!endpoint) throw new Error('custom provider requires llm.endpoint');

    const headers = { 'Content-Type': 'application/json' };
    if (this._cfg.apiKey) headers['Authorization'] = `Bearer ${this._cfg.apiKey}`;

    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        model: this._cfg.model,
        max_tokens: parseInt(this._cfg.maxTokens) || 2000,
        temperature: parseFloat(this._cfg.temperature) || 0.3,
      }),
    }, TIMEOUT_MS);

    if (!res.ok) throw new Error(`custom ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json();
    return data.response || data.choices?.[0]?.message?.content || data.text || JSON.stringify(data);
  }

  // ─── Response Parsing ────────────────────────────────────────

  _parseResponse(raw) {
    const sections = {
      patterns: [],
      credibilityNotes: '',
      missingAngles: [],
      synthesis: '',
      confidenceRecommendation: { direction: 'same', reason: '' },
    };

    // Try multiple parsing strategies — LLMs are inconsistent with formatting.

    // Strategy 1: numbered sections with exact titles (original)
    const blocks = raw.split(/\d+[.)]\s*\**(?:PATTERN ANALYSIS|CREDIBILITY ASSESSMENT|MISSING ANGLES|SYNTHESIS|CONFIDENCE RECOMMENDATION)\**\s*:?\s*/i);
    if (blocks.length >= 6) {
      sections.patterns = this._extractList(blocks[1]);
      sections.credibilityNotes = blocks[2].trim();
      sections.missingAngles = this._extractList(blocks[3]);
      sections.synthesis = blocks[4].trim();
      sections.confidenceRecommendation = this._parseConfidenceRec(blocks[5]);
      log('debug', `llm-synthesis: parsed via numbered sections (${blocks.length} blocks)`);
      return sections;
    }

    // Strategy 2: section-by-section regex extraction (handles markdown headers, bold, etc.)
    const sectionPatterns = [
      { key: 'patternRaw',     re: /(?:pattern analysis|patterns?)\s*:?\s*\**\s*\n([\s\S]*?)(?=\n\s*\**\d*[.)]?\s*\**(?:credib|missing|synth|confid)|$)/i },
      { key: 'credibilityRaw', re: /(?:credibility assessment|credibility|source credibility)\s*:?\s*\**\s*\n([\s\S]*?)(?=\n\s*\**\d*[.)]?\s*\**(?:missing|synth|confid)|$)/i },
      { key: 'missingRaw',     re: /(?:missing angles?|blind spots?|what.*missing)\s*:?\s*\**\s*\n([\s\S]*?)(?=\n\s*\**\d*[.)]?\s*\**(?:synth|confid)|$)/i },
      { key: 'synthesisRaw',   re: /(?:synthesis|overall assessment|totality)\s*:?\s*\**\s*\n([\s\S]*?)(?=\n\s*\**\d*[.)]?\s*\**(?:confid)|$)/i },
      { key: 'confidenceRaw',  re: /(?:confidence recommendation|confidence)\s*:?\s*\**\s*\n([\s\S]*?)$/i },
    ];

    let matched = 0;
    const extracted = {};
    for (const { key, re } of sectionPatterns) {
      const m = raw.match(re);
      if (m?.[1]?.trim()) {
        extracted[key] = m[1].trim();
        matched++;
      }
    }

    if (matched >= 3) {
      if (extracted.patternRaw) sections.patterns = this._extractList(extracted.patternRaw);
      if (extracted.credibilityRaw) sections.credibilityNotes = extracted.credibilityRaw;
      if (extracted.missingRaw) sections.missingAngles = this._extractList(extracted.missingRaw);
      if (extracted.synthesisRaw) sections.synthesis = extracted.synthesisRaw;
      if (extracted.confidenceRaw) sections.confidenceRecommendation = this._parseConfidenceRec(extracted.confidenceRaw);
      log('debug', `llm-synthesis: parsed via regex extraction (${matched}/5 sections found)`);
      return sections;
    }

    // Strategy 3: fallback — treat paragraphs as approximate sections.
    // If the LLM just wrote prose, extract what we can.
    const paragraphs = raw.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 20);
    if (paragraphs.length >= 3) {
      sections.patterns = this._extractList(paragraphs[0]);
      sections.credibilityNotes = paragraphs[1];
      sections.synthesis = paragraphs.slice(2).join(' ').slice(0, 800);
      log('debug', `llm-synthesis: parsed via paragraph fallback (${paragraphs.length} paragraphs)`);
    } else {
      sections.synthesis = raw.slice(0, 1000).trim();
      log('debug', `llm-synthesis: full fallback — treating entire response as synthesis`);
    }

    return sections;
  }

  _extractList(text) {
    if (!text) return [];
    return text
      .split(/\n/)
      .map(l => l.replace(/^[\s\-*•]+/, '').trim())
      .filter(l => l.length > 5);
  }

  _parseConfidenceRec(text) {
    if (!text) return { direction: 'same', reason: '' };
    const lower = text.toLowerCase();
    let direction = 'same';
    if (/\bhigher\b/.test(lower)) direction = 'higher';
    else if (/\blower\b/.test(lower)) direction = 'lower';
    return { direction, reason: text.trim().slice(0, 300) };
  }
}

// ─── Utilities ──────────────────────────────────────────────────

function fetchWithTimeout(url, options, timeoutMs) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`LLM request timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

export default LLMSynthesis;
