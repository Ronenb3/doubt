# doubt

**Claim verification engine that can't hallucinate confidence it hasn't earned.**

82 free data sources. Intelligent query decomposition. Evidence relevance filtering. Stance classification. Bayesian inference. Adversarial hypothesis attack. Key finding synthesis. Contradiction detection. Citation diversity analysis. Propagation forensics. Keystone fragility scoring. Null finding detection. Narrative coherence checking. Evidence caching. Connector health tracking. Optional LLM deep synthesis. A triple epistemic gate that blocks conclusions until the investigation has been *earned*.

Zero dependencies. Zero API keys required. 17,000 lines of pure investigation logic.

```
$ doubt investigate "Tesla full self-driving is safe for public roads"

[intake]        🌑 0%  │ Extracting claims and entities
[hunt]          🌑 0%  │ Query plan: 176 queries across 54 connectors (10 lateral expansions)
[hunt]          🌑 0%  │ [primary] 20 sources | [broad] 34 sources + feedback refinement
[intelligence]  🌑13%  │ Relevance: kept 110/864 (dropped 737 irrelevant)
[intelligence]  🌑13%  │ Classified: 13 supporting, 26 contradicting, 68 contextual
[intelligence]  🌑13%  │ Synthesis: 10 key findings, direction: contested
[inference]     💡73%  │ Confidence: 54.5% (α=12.9 β=10.7)
[adversarial]   💡73%  │ Attack survival: 15.4% | Red team strength: 42.3%
[check]         💡73%  │ Gate blocked: adversarial

# Key Findings
1. 🔴 4 evidence items allege fraud or deceptive practices (from cfpb, wikipedia, reddit)
2. 🔴 5 evidence items reference safety recalls or defects (from media, reddit)
3. 🟢 5 supporting evidence items from 4 independent sources
4. 🔴 6 evidence items document crashes, accidents, or fatalities
5. 🔵 No evidence found from clinical_trials, pubmed — expected sources missing

Status: ⛔ INSUFFICIENT — adversarial gate blocked
```

864 pieces of raw evidence gathered. 737 irrelevant items filtered by the intelligence layer. 110 high-relevance items survived. The Bayesian engine found the evidence *contested* — 54.5% confidence with both supporting and contradicting evidence from independent sources. But the adversarial engine proved the conclusion couldn't survive attack (15.4% survival). So the system refused to conclude. That's the point.

---

## What Makes This Different

Every fact-checking tool treats evidence as additive: more evidence = more confidence. **That's fundamentally wrong.** And every search tool treats query = results. Also wrong.

doubt has two revolutionary architectures:

### The Intelligence Layer (between search and inference)

Before doubt runs any analysis, it filters, classifies, deduplicates, and synthesizes evidence. Out of 864 raw results, only 110 survive:

1. **Relevance scoring** — TF-IDF term overlap, entity matching, domain matching, specificity scoring. If it's about pineapple yogurt when you asked about Tesla safety, it's gone.
2. **Stance classification** — Every piece of evidence is classified as supporting, contradicting, or contextual relative to the claim. This is what makes Bayesian inference actually work.
3. **Evidence-claim matching** — Evidence is linked to specific claims by entity overlap, keyword matching, and domain relevance.
4. **Near-duplicate removal** — URL dedup, bigram Jaccard similarity, cross-source fact merging.
5. **Key finding synthesis** — Theme extraction, multi-source agreement detection, stance-based grouping, plain English summary.
6. **Query feedback loop** — Round 1 findings generate refined queries for round 2. Specific recall numbers, case IDs, patent numbers discovered in round 1 become targeted searches.
7. **Optional LLM synthesis** — Plug in any local (ollama) or remote model for deeper pattern analysis. The heuristic layer always runs first.

### The Anti-Hallucination Architecture

doubt treats evidence as something to be *attacked*:

1. **Evidence can REDUCE confidence** — adversarial counter-hypotheses are generated and tested against the same evidence
2. **The ABSENCE of evidence is evidence** — if a company claims $2B revenue but has no SEC filing, that silence is louder than 100 positive articles
3. **The PATTERN of evidence spread matters** — 20 articles appearing simultaneously means coordinated PR, not independent verification
4. **Confidence must be DECOMPOSED** — not "71%" but "42% from SEC filings, 18% from Reuters, 11% from Reddit"
5. **The TEMPORAL story must be possible** — "Founded in 2020, IPO'd in 2018" isn't a contradiction, it's a fabrication signal
6. **The RATE of confidence change reveals stability** — wildly swinging confidence means the investigation hasn't converged
7. **The STRUCTURAL vulnerability matters** — which single belief, if it fails, collapses the entire argument?
8. **The system ATTACKS its own conclusions** — before reporting, it builds the strongest case against its own findings
9. **Trust is non-linear** — 10 Reddit posts cannot outweigh 3 government filings. Authority sources get amplified; social media gets dampened.
10. **Connector health is tracked** — sources that consistently fail get deprioritized. Sources that work get tried first.

No tool in the world does all of this simultaneously.

---

## The Triple Gate

Most systems produce output regardless of input quality. doubt has three gates:

| Gate | What it checks | Must pass |
|------|---------------|-----------|
| **Evidence** | Bayesian posterior, knowledge coverage, citation diversity | know ≥ 0.70, uncertainty ≤ 0.35, diversity ≥ 0.30 |
| **Adversarial** | Did the conclusions survive structured counter-argument attack? | attack survival ≥ 0.50 |
| **Narrative** | Is the temporal and logical story told by the evidence possible? | coherence ≥ 0.40 |

All three must pass. A report with high Bayesian confidence but low adversarial survival is **blocked**. The system tells you what's missing, not what it guessed.

---

## The 82 Data Sources

All free. No paid tiers. Optional API keys enhance a few but are never required.

| Domain | Sources | Count |
|--------|---------|-------|
| **Financial** | SEC EDGAR, SEC XBRL, SEC Insider, Deep SEC, GLEIF, FINRA, FDIC, FRED, BLS, CFTC, CME, Polygon, Market Intelligence, StockTwits | 14 |
| **Political** | FEC, Congressional Record, Lobbying, Federal Register, Federal Procurement, USASpending | 6 |
| **Legal** | CourtListener, PACER/RECAP, State Courts, Patents, Enforcement | 5 |
| **Compliance** | OFAC, OpenSanctions, FBI, Interpol, PEP, International Sanctions, CFPB, Regulatory Enforcement, ProPublica Nonprofits, Compliance aggregate | 10 |
| **Corporate** | OpenCorporates, UK Companies House, EU Registers, Open Ownership, State SoS, Job Postings, SAM.gov, Alternative Data | 8 |
| **News/Media** | GDELT, Google Fact Check, News Intel, News Archive, Internet Archive, Wikipedia, DuckDuckGo, YouTube | 8 |
| **Academic/Health** | OpenAlex, Semantic Scholar, Crossref, arXiv, PubMed, ORCID, Papers With Code, openFDA, Clinical Trials, HuggingFace | 10 |
| **Geopolitical** | GDELT Geopolitical, UN Comtrade, Supply Chain, World Bank, Data.gov | 5 |
| **Tech/Social** | GitHub, GitHub Deep, Stack Exchange, HackerNews, Reddit, Community, StockTwits | 7 |
| **Infrastructure** | crt.sh, WHOIS/RDAP, Geospatial, Aircraft, Property Records, Wayback, Blockchain | 7 |
| **Safety** | NHTSA recalls, Immigration courts | 2 |

## Install

```bash
# Clone and run
git clone https://github.com/ronenb3/doubt
cd doubt
node bin/doubt.js investigate "claim"

# Or install globally
npm install -g doubt
doubt investigate "claim"
```

**Requirements:** Node.js ≥ 18. That's it.

No Python. No Docker. No database setup. No API keys. No cloud account. Zero npm dependencies.

## Usage

### Full Investigation
```bash
# Standard depth (up to 30 sources, full inference + adversarial)
doubt investigate "Tesla's self-driving claims are accurate"

# Deep investigation (all 82 sources)
doubt investigate "Sam Altman conflicts of interest" --depth deep

# Specific sources only
doubt investigate "Pfizer patent portfolio" --sources sec_edgar,patents,courtlistener

# JSON output for piping
doubt investigate "claim" --format json | jq '.confidence'

# Save report
doubt investigate "claim" --output report.md
```

### Quick OSINT Sweep
```bash
doubt sweep "Anthropic"
doubt sweep "cursor.sh" --max-sources 10
```

### List Connectors
```bash
doubt connectors
```

## Architecture

```
query
  │
  ▼
PREFLIGHT ── check domain priors from past investigations
  │
  ▼
INTAKE ── extract claims, entities, sub-claims
  │
  ▼
HUNT ── route to relevant connectors (parallel, rate-limited)
  │           │
  │     ┌─────┴─────┬──────────┬──────────┬──────────┬─────────┐
  │     SEC    GDELT   Interpol  PubMed   Blockchain  ...×82
  │     └─────┬─────┴──────────┴──────────┴──────────┴─────────┘
  │           │
  ▼           ▼
INFERENCE ── propagation analysis → citation diversity → Bayesian inference
  │          → contradiction detection → confidence decomposition
  │
  ▼
ADVERSARIAL ── generate counter-hypotheses → attack own conclusions
  │             → evaluate counter-evidence → detect null findings
  │
  ▼
FRAGILITY ── infer dependencies → find keystones → cascade simulation
  │
  ▼
NARRATIVE ── timeline construction → temporal validation → causal chain check
  │           → narrative gap detection → coherence scoring
  │
  ▼
CHECK ── triple gate:
  │      Gate 1: Evidence (Bayesian ≥ 0.70, diversity ≥ 0.30)
  │      Gate 2: Adversarial (attack survival ≥ 0.50)
  │      Gate 3: Narrative (coherence ≥ 0.40)
  │
  ├── ALL PASS → generate 16-section report with Red Team Brief
  │
  └── ANY FAIL → report uncertainty with explicit blockers
  │
  ▼
POSTFLIGHT ── learning delta → persist domain priors for next investigation
```

## Key Concepts

### Adversarial Hypothesis Attack

For every claim, the system generates the strongest possible counter-argument and investigates it with equal rigor. "OpenAI is independent from Microsoft" generates counter-hypotheses like "Microsoft has significant control over OpenAI" and checks whether the evidence supports the counter-argument better than the original.

This is Popperian falsification made computational. Truth isn't what evidence confirms — it's what survives structured attempts to destroy it.

### Null Finding Detection

The dog that didn't bark. The system maps claims to expected evidence: financial claims should have SEC filings, corporate claims should have registry entries, public figure claims should have news coverage. When expected evidence is absent, the absence itself is flagged as informative.

"Despite claiming $2.3B in annual revenue, no SEC 10-K filing was found. Public companies of this size are required to file."

### Information Propagation Forensics

Not just "what sources say this" but "how did this information spread?"

- **Primary Discovery** — originates from authoritative source (SEC filing → news) → most trustworthy
- **Independent Convergence** — multiple unrelated sources find the same thing → very trustworthy
- **Simultaneous Burst** — 20 outlets publish within hours → likely coordinated PR
- **Social First** — appears on social media before any primary source → viral rumor

The propagation pattern IS evidence about the claim's truth.

### Citation Diversity

100 news articles about an event sounds strong. But if 98 cite the same Reuters wire, you have 1 root source with 100 derivatives. doubt traces evidence to roots and discounts derivatives geometrically.

### Keystone Beliefs

Structural engineering applied to arguments. A keystone is the claim whose failure causes the largest cascade. If "Revenue is $2B" falls, everything above it — valuation, growth projections, hiring plans — collapses.

### Confidence Decomposition

Not just "71% confident" but a full attribution:
```
| Source        | Evidence | Trust | Direction    | Contribution |
|--------------|----------|-------|-------------|--------------|
| SEC EDGAR    | 3 items  | 0.95  | Supporting  | 42.1%        |
| Reuters      | 2 items  | 0.65  | Supporting  | 18.3%        |
| CourtListener| 1 item   | 0.90  | Contradicting| 15.2%       |
| Reddit       | 5 items  | 0.30  | Mixed       | 3.8%         |
```

### 12 Epistemic Vectors

Real-time investigation health tracking:

| Vector | What it measures |
|--------|-----------------|
| `know` | Evidence weight relative to what's needed |
| `coverage` | % of relevant sources that responded |
| `diversity` | Citation diversity score |
| `freshness` | How recent is the evidence |
| `coherence` | Absence of contradictions |
| `convergence` | Has the Bayesian posterior stabilized |
| `falsifiability` | Could claims have been disproven if false |
| `uncertainty` | Explicit doubt level |
| `fragility` | Keystone concentration |
| `blindspots` | Domains with zero coverage |
| `velocity` | Rate of confidence change (oscillation vs convergence) |
| `attackSurvival` | How well claims survived adversarial attack |

### The Red Team Brief

Every investigation report includes a mandatory Red Team Brief — the strongest possible argument AGAINST the conclusion. You can't have a finding without seeing the best case against it. This isn't a feature. It's the system's conscience.

### The Shadow Brief

A synthesis of the most damaging findings into a single paragraph. The intelligence report they don't want you to have.

## The 16-Section Report

Every investigation produces:

1. **Title & Status** — verdict, confidence, attack survival, fragility
2. **Executive Summary** — one-paragraph finding with gate status
3. **Triple Gate Status** — which gates passed, which blocked, why
4. **Epistemic Health** — ASCII vector chart with warnings
5. **Confidence Decomposition** — which sources contributed which confidence
6. **Key Claims** — all claims ranked with status and keystone flags
7. **Evidence Summary** — by source, by trust tier
8. **Source Independence Graph** — visual tree of evidence dependencies
9. **Propagation Analysis** — how information spread, coordination signals
10. **Contradictions** — ranked by severity with explanations
11. **Narrative Coherence** — temporal, causal, numerical, geographic consistency
12. **Keystone Analysis** — load-bearing beliefs and cascade sizes
13. **Null Findings** — what should exist but doesn't
14. **Red Team Brief** — strongest case against the conclusion
15. **Shadow Brief** — most damaging findings synthesized
16. **Methodology** — sources used, wall time, metrics

## MCP Server (Cursor / Claude Desktop)

```json
{
  "mcpServers": {
    "doubt": {
      "command": "node",
      "args": ["/path/to/doubt/src/mcp/server.js"]
    }
  }
}
```

## Compound Learning

doubt gets better with each investigation. Domain priors persist:

```
Investigation 1:  "OpenAI governance" → learns AI company patterns
Investigation 2:  "Anthropic safety claims" → starts with AI domain priors
Investigation 10: any AI company → investigator is now a domain expert
```

## Philosophy

This tool exists because confident-sounding output from insufficient investigation is worse than silence.

The triple gate is not a feature. It's the architecture. The system is structurally incapable of producing confident conclusions from:
- Shallow evidence (evidence gate)
- Untested conclusions (adversarial gate)  
- Impossible narratives (narrative gate)

When doubt says "I don't know enough to conclude," that's not a failure. That's the system working exactly as designed. The absence of a conclusion IS the conclusion: the investigation hasn't been earned yet.

**Truth is not what evidence confirms. Truth is what survives structured attempts to destroy it.**

*Built by someone who believes machines should doubt, not just retrieve.*

## License

MIT
