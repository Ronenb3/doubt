/**
 * doubt — Report Generator v2
 *
 * Produces a report that ANSWERS THE QUESTION.
 *
 * Design principles:
 * 1. The first section directly answers the investigation query
 * 2. Evidence is grouped by stance (supports/contradicts), not source type
 * 3. Only evidence that's actually about the query is shown
 * 4. All text is cleaned (no HTML, no entities, no raw markup)
 * 5. Missing information is explicit
 * 6. Counter-arguments are contextualized
 */

import { log } from '../core/config.js';

// ─── Text cleaning ──────────────────────────────────────────────

function clean(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/<\/?[a-z][^>]*>/gi, '')
    // Strip dangling/orphaned bold markers from LLM output (unpaired ** before/after text)
    .replace(/^\*\*\s*/gm, '')   // ** at start of line
    .replace(/\s*\*\*$/gm, '')   // ** at end of line
    .replace(/\*\*(?=[^*])/g, '') // ** not followed by another *
    .replace(/(?<=[^*])\*\*/g, '') // ** not preceded by another *
    // Strip LLM internal item references ("items 1, 3, 5", "item 6", "[3]", "(item 4-7)")
    .replace(/\bitems?\s+\d[\d,\s\-and]*\d/gi, 'the evidence')
    .replace(/\bitems?\s+\d+/gi, 'the evidence')
    .replace(/\(\s*items?\s+[\d,\s\-and]+\)/gi, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function smartTruncate(str, maxLen = 250) {
  if (!str || str.length <= maxLen) return str;
  const cut = str.slice(0, maxLen);
  const sentEnd = cut.lastIndexOf('. ');
  if (sentEnd > maxLen * 0.5) return cut.slice(0, sentEnd + 1);
  const wordEnd = cut.lastIndexOf(' ');
  if (wordEnd > maxLen * 0.6) return cut.slice(0, wordEnd) + '…';
  return cut + '…';
}

function pct(val) {
  if (val == null || !Number.isFinite(val)) return 'N/A';
  return `${(val * 100).toFixed(1)}%`;
}

function fmtNum(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString('en-US');
}

// ─── Query analysis ─────────────────────────────────────────────

const STOP = new Set([
  'is', 'are', 'was', 'were', 'the', 'a', 'an', 'in', 'of', 'to', 'for',
  'on', 'at', 'by', 'with', 'from', 'this', 'that', 'it', 'as', 'and',
  'or', 'not', 'but', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
  'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might',
  'can', 'shall', 'about', 'what', 'which', 'who', 'whom', 'when',
  'where', 'why', 'how', 'if', 'then', 'so', 'than', 'too', 'very',
  'just', 'only', 'there', 'their', 'they', 'its', 'any', 'all',
  'each', 'every', 'some', 'such', 'no', 'more', 'most', 'other',
  'into', 'over', 'after', 'before', 'between', 'under', 'again',
  'further', 'once', 'here', 'now', 'also', 'still', 'already',
  'many', 'much', 'really', 'actually', 'currently', 'recently',
  'developing', 'developed', 'development', // too generic
]);

function coreTerms(query) {
  return query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w));
}

/**
 * Build concept clusters: consecutive content-term PAIRS in the query belong to one concept.
 * Limits cluster size to 2 — compound nouns are 2-word entities ("magnesium glycinate",
 * "blood pressure", "vitamin D") not 3-word sequences. This prevents "magnesium glycinate
 * effective" from merging into one cluster when "effective" is a separate predicate.
 * "Is magnesium glycinate effective for anxiety?" →
 *   [["magnesium","glycinate"],["effective"],["anxiety"]]
 */
function conceptClusters(query, terms) {
  const termSet = new Set(terms);
  const words = query.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  const clusters = [];
  let i = 0;
  while (i < words.length) {
    if (termSet.has(words[i])) {
      // Only look one word ahead for compound nouns (max pair size = 2)
      if (i + 1 < words.length && termSet.has(words[i + 1])) {
        clusters.push([words[i], words[i + 1]]);
        i += 2;
      } else {
        clusters.push([words[i]]);
        i += 1;
      }
    } else {
      i++;
    }
  }
  return clusters.length > 0 ? clusters : terms.map(t => [t]);
}

/**
 * Report-level relevance: should a human see this evidence item?
 * Stricter than pipeline relevance — we want ZERO garbage in the report.
 */
function isReportWorthy(ev, terms, query) {
  const text = clean(ev.summary || ev.title || ev.data?.title || '').toLowerCase();
  if (text.length < 25) return false;
  if (!terms.length) return true;

  const hits = terms.filter(t => text.includes(t));

  // Require proportionally more hits for longer queries — prevents 2-word coincidences
  // letting in irrelevant results (e.g. "anxiety + effective" matching dog tryptophan studies).
  const need = Math.max(2, Math.ceil(terms.length * 0.4));
  if (hits.length < need) return false;

  // Hard requirement: at least ONE specific term (length > 6, i.e. a real noun)
  // must appear. This ensures the item is actually about the topic, not just
  // using generic words that happen to match ("effective", "clinical", "anxiety").
  const specificTerms = terms.filter(t => t.length > 6);
  if (specificTerms.length > 0 && !specificTerms.some(t => text.includes(t))) return false;

  // Concept diversity: for multi-concept queries, require hits from 2+ distinct clusters.
  // Prevents "magnesium glycinate crystal structure" from passing on 2 hits from
  // the same compound noun cluster ["magnesium","glycinate"].
  if (query) {
    const clusters = conceptClusters(query, terms);
    if (clusters.length >= 2) {
      const hitClusters = clusters.filter(cluster => cluster.some(t => text.includes(t)));
      if (hitClusters.length < 2) return false;
    }
  }

  return true;
}

function evText(ev) {
  return clean(ev.summary || ev.title || ev.data?.title || ev.data?.snippet || '');
}

function evScore(ev) {
  return (ev.trustWeight || 0.5) * 0.7 + (ev.relevanceScore || 0.5) * 0.3;
}

// Use connectorTrustTier (static, original tier assigned by the connector) for labeling,
// NOT trustWeight (dynamic, reduced by propagation/toxicity analysis).
// connectorTrustTier answers: "what KIND of source is this?" (peer-reviewed / news / social)
// trustWeight answers: "how much did the pipeline trust THIS specific item?"
function trustTag(ev) {
  const w = ev.connectorTrustTier ?? ev.trustWeight ?? 0.5;
  if (w >= 0.95) return 'government/primary';
  if (w >= 0.85) return 'official data';
  if (w >= 0.80) return 'peer-reviewed';
  if (w >= 0.65) return 'major news';
  if (w >= 0.50) return 'minor news';
  return 'social media';
}

const VERDICT_LABEL = {
  supported:     'SUPPORTED',
  contradicted:  'CONTRADICTED',
  contested:     'CONTESTED',
  insufficient:  'INSUFFICIENT',
  unfalsifiable: 'UNFALSIFIABLE',
  pending:       'PENDING',
  investigating: 'INVESTIGATING',
};

const VERDICT_EXPLAIN = {
  supported:    'Multiple credible sources corroborate this claim',
  contradicted: 'The weight of evidence contradicts this claim',
  contested:    'Credible sources disagree — evidence is divided',
  insufficient: 'Not enough evidence to reach a confident conclusion',
  unfalsifiable: 'This claim cannot be meaningfully verified or refuted',
};

// ─── Report Generator ───────────────────────────────────────────

export class ReportGenerator {

  generate(investigation) {
    const inv = investigation;
    const terms = coreTerms(inv.query || '');

    // Pre-filter: only evidence that's actually about the topic
    const worthy = (inv.evidence || []).filter(ev => isReportWorthy(ev, terms, inv.query));
    const byStance = {
      supports:    worthy.filter(e => e.type === 'supports').sort((a, b) => evScore(b) - evScore(a)),
      contradicts: worthy.filter(e => e.type === 'contradicts').sort((a, b) => evScore(b) - evScore(a)),
      context:     worthy.filter(e => e.type === 'contextual' || e.type === 'neutral')
                         .filter(e => (e.trustWeight || 0) >= 0.65)
                         .sort((a, b) => evScore(b) - evScore(a)),
    };

    const sections = [
      this._header(inv, worthy),
      '---',
      this._summary(inv, byStance),
      this._stanceSection('Supporting Evidence', 'Evidence that supports this claim, ranked by source credibility:', byStance.supports, 8),
      this._stanceSection('Contradicting Evidence', 'Evidence that contradicts or raises doubts about this claim:', byStance.contradicts, 6),
      this._contextSection(byStance.context),
      this._patterns(inv),
      this._whatsMissing(inv),
      this._counterArguments(inv),
      this._quality(inv),
      this._sources(inv),
      `---\n*Generated by [doubt](https://github.com/ronenb3/doubt) — the engine that doubts.*`,
    ].filter(Boolean);

    const report = sections.join('\n\n');
    log('info', `report: ${sections.length} sections, ${report.length} chars, ${worthy.length}/${(inv.evidence || []).length} evidence shown`);
    return report;
  }

  // ── Header ──────────────────────────────────────────────────

  _header(inv, worthy) {
    const verdict = VERDICT_LABEL[inv.status] || 'PENDING';
    const explain = VERDICT_EXPLAIN[inv.status] || '';
    const conf = pct(inv.confidence);
    const src = inv.meta?.sourcesResponded || 0;
    const elapsed = inv.meta?.wallTimeMs ? `${(inv.meta.wallTimeMs / 1000).toFixed(1)}s` : 'N/A';
    const total = inv.evidence?.length || 0;
    const shown = worthy.length;

    const GATE_LABELS = {
      know: 'knowledge sufficiency',
      uncertainty: 'uncertainty too high',
      diversity: 'source diversity',
      coherence: 'evidence coherence',
    };
    const gate = inv._gateResult;
    const gateBlockers = (gate?.blockers || []).map(b => GATE_LABELS[b] || b);
    const gateLine = (gate && !gate.passed && gateBlockers.length)
      ? `\n**⚠ Gate:** BLOCKED — ${gateBlockers.join(', ')}`
      : '';

    return [
      `# Investigation: "${inv.query}"`,
      '',
      `**${verdict}** — ${explain}`,
      `**Confidence:** ${conf} | **Sources:** ${fmtNum(src)} independent | **Time:** ${elapsed}`,
      `**Evidence:** ${fmtNum(shown)} relevant items shown (${fmtNum(total)} total collected)${gateLine}`,
    ].join('\n');
  }

  // ── Summary ─────────────────────────────────────────────────

  _summary(inv, byStance) {
    const parts = [];

    // Evidence balance — the first thing a reader needs
    const s = byStance.supports.length;
    const c = byStance.contradicts.length;
    const ctx = byStance.context.length;

    if (s + c > 0) {
      const total = s + c;
      const ratio = Math.round((s / total) * 100);
      let balance;
      if (ratio > 70) balance = 'Evidence **strongly favors** the claim.';
      else if (ratio > 55) balance = 'Evidence **leans toward supporting** the claim.';
      else if (ratio < 30) balance = 'Evidence **strongly weighs against** the claim.';
      else if (ratio < 45) balance = 'Evidence **leans toward contradicting** the claim.';
      else balance = 'Evidence is **evenly divided**.';

      // Reconcile with pipeline verdict — if the verdict says contested/insufficient
      // but the filtered evidence looks one-sided, the full pipeline saw more than
      // what passed the report filter. Make the summary consistent.
      const status = inv.status;
      if ((status === 'contested' || status === 'insufficient') && ratio > 70) {
        balance = 'Evidence in the displayed sources leans toward supporting, but the full pipeline verdict is **CONTESTED** — the broader evidence set is divided.';
      } else if ((status === 'contested' || status === 'insufficient') && ratio < 30) {
        balance = 'Evidence in the displayed sources leans against the claim, but the full pipeline verdict is **CONTESTED** — the broader evidence set is divided.';
      }

      parts.push(`${balance} Of the relevant evidence: **${s} items support**, **${c} contradict**, and ${ctx} provide context.`);
    }

    // LLM synthesis — the deep analysis
    const llmSynth = inv.synthesis?.llm?.synthesis;
    if (llmSynth) {
      // Strip leaked section headers (parser may have failed)
      const cleaned = clean(llmSynth)
        .replace(/\*\*(?:Pattern Analysis|Credibility Assessment|Missing Angles|Synthesis|Confidence Recommendation)\s*:?\s*\*\*/gi, '')
        .replace(/\b(?:Pattern Analysis|Credibility Assessment|Missing Angles|Synthesis|Confidence Recommendation)\s*:/gi, '')
        .replace(/^\d+\.\s*/gm, '')
        .trim();

      if (cleaned.length > 50) {
        // Try to extract just the SYNTHESIS paragraph (most useful part)
        const synthMatch = cleaned.match(/(?:synthesis|totality of evidence|overall)[:\s]*(.{50,}?)(?=(?:confidence recommendation|$))/i);
        if (synthMatch) {
          parts.push(smartTruncate(synthMatch[1].trim(), 600));
        } else {
          // Use the whole cleaned output but limit length
          parts.push(smartTruncate(cleaned, 600));
        }
      }
    } else if (inv.synthesis?.summary) {
      parts.push(clean(inv.synthesis.summary));
    }

    // Fallback template if nothing produced content
    if (parts.length === 0) {
      const n = inv.evidence?.length || 0;
      const src = inv.meta?.sourcesResponded || 0;
      parts.push(`Examined ${fmtNum(n)} evidence items from ${fmtNum(src)} sources.`);
      const blockers = inv._gateResult?.blockers || [];
      if (blockers.length) parts.push(`*Investigation blocked by: ${blockers.join(', ')}.*`);
    }

    return `## Summary\n\n${parts.join('\n\n')}`;
  }

  // ── Evidence by stance ──────────────────────────────────────

  _stanceSection(title, subtitle, items, max) {
    if (!items.length) {
      return `## ${title}\n\nNo ${title.toLowerCase()} was found.`;
    }

    const shown = items.slice(0, max);
    const lines = [`## ${title}`, '', subtitle, ''];

    for (const ev of shown) {
      const text = smartTruncate(evText(ev), 300);
      if (!text) continue;
      const src = ev.connectorId || 'unknown';
      const url = ev.url || ev.data?.url || '';
      const trust = trustTag(ev);

      let line = `- "${text}"`;
      line += url ? ` — [${src}](${url})` : ` — *${src}*`;
      line += ` (${trust})`;
      lines.push(line);
    }

    if (items.length > max) {
      lines.push('', `*Plus ${items.length - max} more items not shown.*`);
    }

    return lines.join('\n');
  }

  // ── Context ─────────────────────────────────────────────────

  _contextSection(items) {
    if (!items.length) return null;

    const shown = items.slice(0, 5);
    const lines = [
      '## Key Context',
      '',
      'High-credibility background that neither directly supports nor contradicts the claim:',
      '',
    ];

    for (const ev of shown) {
      const text = smartTruncate(evText(ev), 250);
      if (!text) continue;
      lines.push(`- "${text}" — *${ev.connectorId || 'unknown'}*`);
    }

    return lines.join('\n');
  }

  // ── Patterns ────────────────────────────────────────────────

  _patterns(inv) {
    const parts = [];

    // LLM patterns (best quality)
    const patterns = inv.synthesis?.llm?.patterns || [];
    if (patterns.length) {
      parts.push('**Cross-evidence patterns:**');
      for (const p of patterns.slice(0, 6)) {
        parts.push(`- ${clean(p)}`);
      }
    }

    // Heuristic themes (fallback)
    if (!patterns.length && inv.synthesis?.themes?.length) {
      parts.push('**Major themes across sources:**');
      for (const t of inv.synthesis.themes.slice(0, 5)) {
        const srcs = t.topSources?.slice(0, 3).join(', ') || '';
        parts.push(`- **${t.name}** — ${t.evidenceCount} evidence items${srcs ? ` (${srcs})` : ''}`);
      }
    }

    // LLM credibility notes
    if (inv.synthesis?.llm?.credibilityNotes) {
      const notes = clean(inv.synthesis.llm.credibilityNotes);
      if (notes.length > 30) {
        parts.push('', `**Credibility assessment:** ${smartTruncate(notes, 400)}`);
      }
    }

    // Bias warning
    if (inv.synthesis?.biasAssessment?.biasWarning) {
      parts.push('', `**⚠ Bias warning:** ${inv.synthesis.biasAssessment.warningText || 'Evidence skews heavily in one ideological direction.'}`);
    }

    if (!parts.length) return null;
    return `## Patterns & Insights\n\n${parts.join('\n')}`;
  }

  // ── What's Missing ──────────────────────────────────────────

  _whatsMissing(inv) {
    const parts = [];

    // LLM blind spots
    const missing = inv.synthesis?.llm?.missingAngles || [];
    if (missing.length) {
      parts.push('**Blind spots identified by analysis:**');
      for (const m of missing.slice(0, 4)) {
        parts.push(`- ${clean(m)}`);
      }
    }

    // Coverage gaps
    if (inv.coverageGaps?.gaps?.length) {
      if (parts.length) parts.push('');
      parts.push('**Coverage gaps:**');
      for (const gap of inv.coverageGaps.gaps.slice(0, 4)) {
        parts.push(`- ${clean(gap.message || gap.description || gap.gap || gap.type || 'Unspecified gap')}`);
      }
    }

    // Null findings (deduplicated)
    if (inv.nullFindings?.length) {
      const seen = new Map();
      for (const n of inv.nullFindings) {
        const key = n.expectedSource || 'unknown';
        if (!seen.has(key) || (n.severity || 0) > (seen.get(key).severity || 0)) {
          seen.set(key, n);
        }
      }
      const critical = [...seen.values()].filter(n => n.severity >= 0.5);
      if (critical.length) {
        if (parts.length) parts.push('');
        parts.push('**Sources that should have data but returned nothing:**');
        for (const n of critical.slice(0, 5)) {
          parts.push(`- **${n.expectedSource}**: ${clean(n.interpretation || n.expectedBecause || 'Expected evidence absent.')}`);
        }
      }
    }

    if (!parts.length) return null;
    return `## What's Missing\n\n${parts.join('\n')}`;
  }

  // ── Counter-Arguments ───────────────────────────────────────

  _counterArguments(inv) {
    const brief = inv.redTeamBrief;
    if (!brief?.arguments?.length) return null;

    // Filter garbage: pure negations, very low scores
    const args = brief.arguments.filter(arg => {
      const text = arg.counterHypothesis || arg.text || '';
      if (text.startsWith('It is not the case that')) return false;
      if ((arg.score ?? 0) < 0.05) return false;
      return text.length > 15;
    }).slice(0, 3);

    if (!args.length) {
      return `## Counter-Arguments\n\nNo credible counter-arguments survived adversarial analysis. The conclusions appear robust against structured challenge.`;
    }

    const lines = [
      '## Counter-Arguments',
      '',
      `Adversarial strength: ${pct(brief.strength)} — ${brief.strength > 0.5 ? 'conclusions are seriously challenged' : brief.strength > 0.3 ? 'some challenges warrant attention' : 'conclusions largely survive challenge'}`,
      '',
    ];

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const text = clean(a.counterHypothesis || a.text || '');
      const score = a.score ?? a.plausibility;
      const nEv = a.supportingEvidence?.length || 0;

      lines.push(`${i + 1}. **${text}**`);
      if (score != null) lines.push(`   *Plausibility: ${pct(score)} — backed by ${nEv} evidence items*`);
      if (a.reasoning) lines.push(`   ${smartTruncate(clean(a.reasoning), 250)}`);
      lines.push('');
    }

    if (brief.summary) lines.push(clean(brief.summary));

    return lines.join('\n');
  }

  // ── Quality ─────────────────────────────────────────────────

  _quality(inv) {
    const parts = [];

    const vectors = inv.vectors?.vectors || inv.vectors;
    if (vectors && typeof vectors === 'object') {
      const entries = Object.entries(vectors).filter(([k]) => k !== 'vectors');
      if (entries.length) {
        const rows = entries.map(([name, val]) => {
          const v = typeof val === 'number' ? val : 0;
          const warn = (name === 'uncertainty' && v > 0.35) ||
                       (name === 'fragility' && v > 0.5) ||
                       (name === 'attackSurvival' && v < 0.5);
          return `| ${name} | ${pct(v)} | ${warn ? '⚠' : '✓'} |`;
        });
        parts.push(`| Metric | Score | |\n|---|---|---|\n${rows.join('\n')}`);
      }
    }

    const d = inv.decomposition;
    if (d?.byTrustTier) {
      const tiers = Object.entries(d.byTrustTier).map(([t, v]) => `${t}: ${pct(v)}`).join(', ');
      parts.push(`**Confidence by trust tier:** ${tiers}`);
    }

    if (!parts.length) return null;
    return `## Investigation Quality\n\n${parts.join('\n\n')}`;
  }

  // ── Sources ─────────────────────────────────────────────────

  _sources(inv) {
    const evidence = inv.evidence || [];
    const meta = inv.meta || {};

    const counts = new Map();
    for (const ev of evidence) {
      const id = ev.connectorId || 'unknown';
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const list = sorted.map(([name, n]) => `${name} (${n})`).join(' · ');

    return [
      '## Sources Consulted',
      '',
      `${fmtNum(meta.sourcesQueried || 0)} queried, ${fmtNum(meta.sourcesResponded || 0)} responded, ${fmtNum(meta.sourcesFailed || 0)} failed.`,
      '',
      list,
    ].join('\n');
  }
}

export default ReportGenerator;
