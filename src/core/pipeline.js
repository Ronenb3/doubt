/**
 * doubt — Investigation Pipeline
 *
 * The heart of the system. Orchestrates 10 phases:
 *
 *   PREFLIGHT    → assess domain priors from past investigations
 *   INTAKE       → parse claims, extract entities, build initial model
 *   HUNT         → intelligent multi-round search with query planning
 *   INTELLIGENCE → relevance filter, dedup, stance classify, claim-match, synthesize
 *   INFERENCE    → Bayesian inference + contradiction + citation diversity
 *   ADVERSARIAL  → generate counter-hypotheses, attack own conclusions
 *   FRAGILITY    → keystone detection + cascade simulation
 *   NARRATIVE    → temporal/logical coherence of the evidence story
 *   CHECK        → triple gate: evidence + epistemic + adversarial
 *   REPORT       → generate findings (only if CHECK passes)
 *   POSTFLIGHT   → persist learning deltas for compound improvement
 *
 * The pipeline cannot skip CHECK. It cannot skip ADVERSARIAL.
 * The system must attack its own conclusions before reporting them.
 *
 * This is the anti-hallucination architecture:
 * confidence that hasn't survived structured doubt
 * is not confidence — it's wishful thinking.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import registry from '../connectors/registry.js';
import { BayesianEngine } from '../inference/bayesian.js';
import { ContradictionEngine } from '../inference/contradiction.js';
import { CitationDiversityAnalyzer } from '../inference/citation.js';
import { AdversarialEngine } from '../inference/adversarial.js';
import { NullFindingDetector } from '../inference/null-findings.js';
import { PropagationAnalyzer } from '../inference/propagation.js';
import { NarrativeCoherenceEngine } from '../inference/narrative.js';
import { ConfidenceDecomposition } from '../inference/decomposition.js';
import { SourceGraph } from '../inference/source-graph.js';
import { EpistemicVectors } from '../epistemic/vectors.js';
import { KeystoneDetector } from '../fragility/keystone.js';
import { ClaimExtractor } from '../extraction/claims.js';
import { LLMClaimDecomposer } from '../extraction/llm-claims.js';
import { EntityExtractor } from '../extraction/entities.js';
import { QueryPlanner } from './query-planner.js';
import { QueryFeedback } from './feedback.js';
import { getEvidenceCache } from './cache.js';
import { RelevanceScorer } from '../intelligence/relevance.js';
import { Deduplicator } from '../intelligence/dedup.js';
import { StanceClassifier } from '../intelligence/classifier.js';
import { NLIClassifier } from '../intelligence/nli-classifier.js';
import { LLMClaimMatcher } from '../intelligence/llm-claim-matcher.js';
import { SynthesisEngine } from '../intelligence/synthesis.js';
import { FactExtractor } from '../intelligence/facts.js';
import { LLMSynthesis } from '../intelligence/llm-synthesis.js';
import { detectCoverageGaps } from '../intelligence/coverage-gap.js';
import { perspectiveScorer } from '../connectors/sources/perspective.js';
import { FloodGate } from '../intelligence/flood-gate.js';
import { EpistemicCascadeEngine } from '../intelligence/cascade.js';
import {
  createInvestigation,
  Phase,
  ClaimStatus,
  createClaim,
} from './schema.js';
import { getConfig, log } from './config.js';

export class Pipeline {
  constructor(options = {}) {
    this.bayesian = new BayesianEngine(options);
    this.contradiction = new ContradictionEngine();
    this.citation = new CitationDiversityAnalyzer();
    this.adversarial = new AdversarialEngine();
    this.nullFinder = new NullFindingDetector();
    this.propagation = new PropagationAnalyzer();
    this.narrative = new NarrativeCoherenceEngine();
    this.decomposition = new ConfidenceDecomposition();
    this.sourceGraph = new SourceGraph();
    this.epistemic = new EpistemicVectors();
    this.keystone = new KeystoneDetector();
    this.claimExtractor = new ClaimExtractor();
    this.claimDecomposer = new LLMClaimDecomposer();
    this.entityExtractor = new EntityExtractor();
    this.queryPlanner = new QueryPlanner();
    this.relevance = new RelevanceScorer();
    this.dedup = new Deduplicator();
    this.classifier = new StanceClassifier();
    this.nliClassifier = new NLIClassifier();
    this.claimMatcher = new LLMClaimMatcher();
    this.synthesis = new SynthesisEngine();
    this.factExtractor = new FactExtractor();
    this.llmSynthesis = new LLMSynthesis();
    this.floodGate = new FloodGate();
    this.cascadeEngine = new EpistemicCascadeEngine();
    this.cache = getEvidenceCache();
    this.feedback = new QueryFeedback();
    this._connectorHealth = new Map();
    this._onProgress = options.onProgress || null;
    this.autosaveDir = options.autosaveDir || null;
  }

  async investigate(query, options = {}) {
    const config = getConfig();
    const inv = createInvestigation(query, options);
    inv._autosaveDir = options.autosaveDir || null;
    const connectorResults = [];

    try {
      await registry.loadAll();

      // ── PREFLIGHT ───────────────────────────────────
      inv.phase = Phase.PREFLIGHT;
      inv.timestamps.started = Date.now();
      this.epistemic.setPhase('preflight');
      this._progress(inv, 'Starting investigation');

      if (this._store) {
        const priors = await this._store.getDomainPriors?.(query);
        if (priors) {
          inv.learning.domainPriors = priors;
          inv.learning.previousInvestigations = priors.investigationsCount || 0;
        }
      }

      this.epistemic.update(inv);

      // ── INTAKE ──────────────────────────────────────
      inv.phase = Phase.INTAKE;
      this.epistemic.setPhase('intake');
      this._progress(inv, 'Extracting claims and entities');

      const primaryClaim = createClaim(query);
      inv.claims.push(primaryClaim);

      // Extract entities first — needed by claim decomposer
      inv.entities = this.entityExtractor.extract(query);

      // Heuristic sub-claims (fast, pattern-based)
      const subClaims = this.claimExtractor.extract(query);
      for (const sc of subClaims) {
        if (sc.text !== query) {
          const sub = createClaim(sc.text);
          sub.dependsOn = [primaryClaim.id];
          primaryClaim.supports = primaryClaim.supports || [];
          primaryClaim.supports.push(sub.id);
          inv.claims.push(sub);
        }
      }

      // LLM claim decomposition — the critical upgrade
      // If heuristics only found 0-2 sub-claims, use LLM to decompose the query
      // into 5-12 independently verifiable sub-claims. This unlocks:
      //   - Cascade engine (needs ≥2 claims for DAG)
      //   - Contradiction detection (cross-claim conflicts)
      //   - Per-claim Bayesian confidence
      if (inv.claims.length < 4) {
        this._progress(inv, 'LLM claim decomposition (unlocking inference layer)...');
        try {
          const llmSubClaims = await this.claimDecomposer.decompose(query, inv.entities);
          for (const text of llmSubClaims) {
            if (!inv.claims.find(c => c.text === text)) {
              const sub = createClaim(text);
              sub.dependsOn = [primaryClaim.id];
              sub._source = 'llm-decomposer';
              primaryClaim.supports = primaryClaim.supports || [];
              primaryClaim.supports.push(sub.id);
              inv.claims.push(sub);
            }
          }
          this._progress(inv, `Claims: ${inv.claims.length} total (1 primary + ${inv.claims.length - 1} sub-claims)`);
        } catch (err) {
          log('warn', `claim-decomposer failed: ${err.message}`);
        }
      } else {
        this._progress(inv, `Claims: ${inv.claims.length} (heuristic decomposition sufficient)`);
      }

      this.epistemic.update(inv);

      // ── HUNT (intelligent multi-round search) ─────
      // Precheck connectors once per session — marks dead connectors unavailable
      // so we don't waste concurrency slots on unreachable endpoints.
      await registry.precheck({ timeout: 6000 }).catch(() => {});
      inv.phase = Phase.HUNT;
      this.epistemic.setPhase('hunt');

      // Generate search plan with query intelligence
      const searchPlan = this.queryPlanner.plan(query, inv.claims, inv.entities, options);
      inv.searchPlan = {
        entities: searchPlan.entities,
        totalQueries: searchPlan.totalQueries,
        lateralExpansions: searchPlan.lateralExpansions.length,
        rounds: searchPlan.searchRounds.map(r => r.name),
      };

      this._progress(inv, `Query plan: ${searchPlan.totalQueries} queries across ${Object.keys(searchPlan.connectorQueries).length} connectors (${searchPlan.lateralExpansions.length} lateral expansions)`);

      const concurrency = config.connectors.maxConcurrent;

      // Execute search rounds — primary + broad run in parallel, adversarial after
      const [primaryRound, broadRound, adversarialRound] = searchPlan.searchRounds;

      inv.meta.sourceDetails = { responded: [], failed: [], skipped: [] };

      const processResults = (roundResults) => {
        for (const result of roundResults) {
          connectorResults.push(result);
          if (result.evidence && result.evidence.length > 0) {
            inv.evidence.push(...result.evidence);
            inv.meta.sourcesResponded++;
            inv.meta.sourceDetails.responded.push({ id: result.connectorId, count: result.evidence.length });
          } else {
            inv.meta.sourcesFailed++;
            inv.meta.sourceDetails.failed.push({ id: result.connectorId, error: result.error || 'no results' });
          }
        }
      };

      // Round 1: Primary search
      if (primaryRound && Object.keys(primaryRound.connectors).length > 0) {
        this._progress(inv, `[primary] Searching ${Object.keys(primaryRound.connectors).length} sources`);
        const primaryResults = await this._runPlannedQueries(primaryRound.connectors, concurrency, inv);
        processResults(primaryResults);
        inv.meta.sourcesQueried += Object.keys(primaryRound.connectors).length;
      }

      // Feedback loop: use round 1 findings to refine round 2 queries
      const feedbackQueries = this.feedback.refine(inv.evidence, query, searchPlan);
      if (Object.keys(feedbackQueries).length > 0) {
        const fbTotal = Object.values(feedbackQueries).reduce((s, q) => s + q.length, 0);
        this._progress(inv, `[feedback] Generated ${fbTotal} refined queries from round 1 findings`);

        // Merge feedback queries into broad round, but never widen the connector
        // set beyond --max-sources. Feedback can add queries to known connectors,
        // not introduce new ones when a cap is set.
        if (broadRound) {
          const cap = Number.isFinite(options.maxSources) && options.maxSources > 0 ? options.maxSources : null;
          const allowedConnectors = cap
            ? new Set(Object.keys(searchPlan.connectorQueries))
            : null;
          for (const [cid, queries] of Object.entries(feedbackQueries)) {
            if (allowedConnectors && !allowedConnectors.has(cid)) continue;
            if (!broadRound.connectors[cid]) broadRound.connectors[cid] = [];
            broadRound.connectors[cid].push(...queries);
          }
        }
      }

      // Round 2: Broad search (includes feedback-refined queries)
      if (broadRound && Object.keys(broadRound.connectors).length > 0) {
        this._progress(inv, `[broad] Searching ${Object.keys(broadRound.connectors).length} sources (${feedbackQueries ? '+feedback' : ''})`);
        const broadResults = await this._runPlannedQueries(broadRound.connectors, concurrency, inv);
        processResults(broadResults);
        inv.meta.sourcesQueried += Object.keys(broadRound.connectors).length;
      }

      // Round 3: Adversarial (benefits from knowing what we already have)
      if (adversarialRound && Object.keys(adversarialRound.connectors).length > 0) {
        this._progress(inv, `[adversarial] Counter-evidence search across ${Object.keys(adversarialRound.connectors).length} sources`);
        const advResults = await this._runPlannedQueries(adversarialRound.connectors, concurrency, inv);
        processResults(advResults);
        inv.meta.sourcesQueried += Object.keys(adversarialRound.connectors).length;
      }

      inv.meta.evidenceCount = inv.evidence.length;
      this._progress(inv, `Collected ${inv.evidence.length} raw evidence from ${inv.meta.sourcesResponded} sources`);
      this.epistemic.update(inv);
      this._autosave(inv);

      // ── DEEP READ (firecrawl second-pass) ────────────
      // Evidence items have URLs but only 500-char summaries.
      // For high-trust sources (academic, legal, government),
      // fetch the full document text so NLI and claim matching
      // run on the actual content, not the abstract.
      inv.evidence = await this._deepReadEvidence(inv.evidence, inv);

      // ── INTELLIGENCE (the brain) ────────────────────
      // This phase transforms raw evidence into intelligence:
      // flood-gate, filter noise, remove duplicates, classify stances,
      // link evidence to claims, and synthesize findings.
      inv.phase = 'intelligence';
      this.epistemic.setPhase('intelligence');

      // Step 0: Flood gate — cap evidence per connector to prevent drowning
      const floodResult = this.floodGate.cap(inv.evidence);
      if (floodResult.stats.capped > 0) {
        inv.evidence = floodResult.capped;
        inv.meta.floodGateCapped = floodResult.stats.capped;
        this._progress(inv, `Flood gate: ${floodResult.stats.total} → ${floodResult.capped.length} (${floodResult.stats.capped} excess items from ${floodResult.stats.cappedConnectors.length} connectors)`);
      }

      // Step 1: Relevance filtering — drop the noise
      const searchEntities = inv.searchPlan?.entities || {};
      const relevanceResult = this.relevance.filter(inv.evidence, query, searchEntities);
      this._progress(inv, `Relevance: kept ${relevanceResult.kept.length}/${relevanceResult.stats.total} (dropped ${relevanceResult.stats.dropped} irrelevant, avg relevance: ${relevanceResult.stats.avgRelevance.toFixed(2)})`);
      inv.evidence = relevanceResult.kept;
      inv.meta.evidenceDropped = relevanceResult.stats.dropped;

      // Step 2: Deduplication — merge near-duplicates
      const dedupResult = this.dedup.deduplicate(inv.evidence);
      this._progress(inv, `Dedup: ${dedupResult.unique.length} unique (removed ${dedupResult.duplicatesRemoved} duplicates, merged ${dedupResult.mergedCount})`);
      inv.evidence = dedupResult.unique;
      inv.meta.evidenceDeduped = dedupResult.duplicatesRemoved;

      // Step 3: Stance classification — NLI (LLM-powered) with pattern fallback
      this._progress(inv, `NLI classification: classifying ${inv.evidence.length} evidence items via LLM...`);
      inv.evidence = await this.nliClassifier.classify(inv.evidence, inv.claims, query);
      const stanceStats = this.nliClassifier.getStats(inv.evidence);
      this._progress(inv, `Classified: ${stanceStats.supports} supporting, ${stanceStats.contradicts} contradicting, ${stanceStats.contextual} contextual, ${stanceStats.neutral} neutral (${stanceStats.llm} LLM, ${stanceStats.pattern} pattern)`);

      // Step 4: Claim matching — LLM semantic matching with keyword fallback
      this._progress(inv, `Claim matching: linking ${inv.evidence.length} evidence items to ${inv.claims.length} claims via LLM...`);
      await this.claimMatcher.match(inv.evidence, inv.claims);
      this.claimMatcher.enrichClaims(inv.claims, inv.evidence);
      const matchStats = inv.claims.reduce((s, c) => { s.matched += (c.matchedEvidence?.length || c.evidenceCount || 0); return s; }, { matched: 0 });
      this._progress(inv, `Matched: ${matchStats.matched} evidence-claim links across ${inv.claims.length} claims`);

      // Step 5: Fact extraction — pull specific data points from evidence
      const allFacts = this.factExtractor.extractAll(inv.evidence, query);
      inv.facts = this.factExtractor.topFacts(allFacts, 20);
      if (inv.facts.length > 0) {
        this._progress(inv, `Facts: ${inv.facts.length} specific facts extracted (${allFacts.length} total)`);
      }

      // Step 5b: LLM fact ranking — re-order facts by actual query relevance
      if (inv.facts.length > 0 && await this.llmSynthesis.isAvailable()) {
        this._progress(inv, `LLM re-ranking ${inv.facts.length} facts by relevance...`);
        inv.facts = await this.llmSynthesis.rankFacts(inv.facts, query);
      }

      // Step 6: Synthesis — extract themes, findings, summary
      inv.synthesis = this.synthesis.synthesize(inv.evidence, inv.claims, query, searchEntities);
      if (inv.synthesis?.keyFindings?.length > 0) {
        this._progress(inv, `Synthesis: ${inv.synthesis.keyFindings.length} key findings, ${inv.synthesis.themes?.length || 0} themes, direction: ${inv.synthesis.overallDirection}`);
      }

      // Step 6: Optional LLM deep synthesis (only if configured)
      if (this.llmSynthesis.isAvailable()) {
        this._progress(inv, 'Running LLM deep synthesis...');
        const llmResult = await this.llmSynthesis.synthesize(inv.evidence, inv.claims, query, inv.synthesis);
        if (llmResult) {
          inv.synthesis.llm = llmResult;
          this._progress(inv, `LLM synthesis complete (${llmResult.model}, ${llmResult.latencyMs}ms)`);
        }
      }

      // Step 7: Coverage gap analysis — audit blind spots in the evidence set
      inv.coverageGaps = detectCoverageGaps(inv.evidence, query, inv.claims);
      if (inv.coverageGaps.gaps.length > 0) {
        for (const w of inv.coverageGaps.warnings) log('warn', w);
        this._progress(inv, `Coverage: ${inv.coverageGaps.gaps.length} gaps detected (score: ${(inv.coverageGaps.score * 100).toFixed(0)}%)`);
      }

      // Step 8: Perspective toxicity scoring — penalize toxic social-tier evidence
      if (perspectiveScorer.available) {
        this._progress(inv, 'Scoring social evidence for toxicity (Perspective API)...');
        const { scored, penalized } = await perspectiveScorer.scoreEvidence(inv.evidence);
        if (scored > 0) {
          this._progress(inv, `Perspective: scored ${scored} social items, penalized ${penalized} high-toxicity`);
        }
      }

      inv.meta.evidenceCount = inv.evidence.length;
      this.epistemic.update(inv);
      this._autosave(inv);

      // ── INFERENCE ───────────────────────────────────
      inv.phase = Phase.INFERENCE;
      this.epistemic.setPhase('inference');
      this._progress(inv, 'Running Bayesian inference');

      // Citation diversity (feeds into Bayesian weights)
      const citationResult = this.citation.analyze(inv.evidence);
      inv.meta.citationDiversity = citationResult.diversity;

      // Propagation analysis — how did this information spread?
      inv.propagation = this.propagation.analyze(inv.evidence);
      if (inv.propagation.coordinationSignals?.length > 0) {
        this._progress(inv, `⚠ Detected ${inv.propagation.coordinationSignals.length} coordination signals`);
      }

      // Apply propagation trust adjustments to evidence
      if (inv.propagation.trustAdjustments) {
        for (const e of inv.evidence) {
          const adj = inv.propagation.trustAdjustments.get?.(e.id) ||
                      inv.propagation.trustAdjustments[e.id];
          if (adj) {
            const baseTrust = Number.isFinite(e.trustWeight) ? e.trustWeight : 0.5;
            const factor = Number.isFinite(adj) ? adj : 1;
            e.trustWeight = Math.min(1, Math.max(0, baseTrust * factor));
          }
        }
      }

      // Bayesian inference on each claim
      // The intelligence phase already classified stances and matched evidence to claims.
      // We don't extract additional claims from evidence here — that created noise.
      inv.claims = this.bayesian.evaluateAll(inv.claims, inv.evidence, citationResult);
      inv.confidence = this.bayesian.aggregateConfidence(inv.claims);
      if (!Number.isFinite(inv.confidence)) inv.confidence = 0;

      // Log per-claim results
      for (const c of inv.claims) {
        const inf = c.inference || {};
        log('info', `  claim "${c.text.slice(0, 60)}…" → ${(c.confidence * 100).toFixed(1)}% (${inf.evidenceUsed || 0} evidence, α=${inf.alpha || '?'} β=${inf.beta || '?'})`);
      }

      // Contradiction detection
      inv.contradictions = this.contradiction.detect(inv.claims);
      inv.meta.contradictionCount = inv.contradictions.length;

      // Source independence graph
      inv.sourceGraph = this.sourceGraph.build(inv.evidence, citationResult);

      // Confidence decomposition — where exactly does the confidence come from?
      inv.decomposition = this.decomposition.decomposeInvestigation(inv);

      this._progress(inv, `Confidence: ${(inv.confidence * 100).toFixed(1)}% | Diversity: ${citationResult.diversity} | Contradictions: ${inv.contradictions.length}`);
      this.epistemic.update(inv);
      this._autosave(inv);

      // ── ADVERSARIAL ─────────────────────────────────
      // The system must attack its own conclusions before reporting them.
      inv.phase = 'adversarial';
      this.epistemic.setPhase('adversarial');
      this._progress(inv, 'Generating counter-hypotheses (attacking own conclusions)');

      inv.counterHypotheses = await this.adversarial.generateCounterHypotheses(inv.claims);
      inv.counterHypotheses = this.adversarial.evaluateCounterHypotheses(inv.counterHypotheses, inv.evidence);
      inv.redTeamBrief = this.adversarial.generateRedTeamBrief(inv.claims, inv.counterHypotheses, inv.evidence);
      inv._attackSurvival = this.adversarial.attackScore(inv.claims, inv.counterHypotheses);

      this._progress(inv, `Attack survival: ${(inv._attackSurvival * 100).toFixed(1)}% | Red team strength: ${(inv.redTeamBrief?.strength * 100 || 0).toFixed(1)}%`);

      // Null finding detection — what's missing that should be there?
      inv.nullFindings = this.nullFinder.detectNullFindings(inv.claims, inv.evidence, connectorResults);
      inv.nullSeverity = this.nullFinder.severityScore(inv.nullFindings);

      if (inv.nullSeverity?.criticalAbsences?.length > 0) {
        this._progress(inv, `⚠ ${inv.nullSeverity.criticalAbsences.length} critical null findings (expected evidence is missing)`);
      }

      this.epistemic.update(inv);
      this._autosave(inv);

      // ── FRAGILITY ───────────────────────────────────
      inv.phase = Phase.FRAGILITY;
      this.epistemic.setPhase('fragility');
      this._progress(inv, 'Analyzing structural fragility');

      this.keystone.inferDependencies(inv.claims);
      const fragilityResult = this.keystone.analyze(inv.claims);
      inv.keystones = fragilityResult.keystones;
      inv.fragilityScore = fragilityResult.fragilityScore;

      if (inv.keystones.length > 0) {
        this._progress(inv, `Found ${inv.keystones.length} keystone beliefs (fragility: ${inv.fragilityScore})`);
      }
      // Epistemic Cascade Analysis — the structural intelligence layer
      // Builds a claim dependency DAG, simulates "what collapses if X is false",
      // identifies keystone claims that the entire investigation hinges on.
      if (inv.claims.length >= 2) {
        this._progress(inv, 'Running epistemic cascade analysis...');
        try {
          inv.cascadeAnalysis = await this.cascadeEngine.analyze(inv.claims, inv.evidence, query);
          if (inv.cascadeAnalysis.keystones?.length > 0) {
            const ks = inv.cascadeAnalysis.keystones.filter(k => k.role === 'KEYSTONE');
            this._progress(inv, `Cascade: ${ks.length} keystone claims, fragility=${inv.cascadeAnalysis.fragilityScore.toFixed(2)}`);
          }
          if (inv.cascadeAnalysis.summary) {
            log('info', inv.cascadeAnalysis.summary);
          }
        } catch (err) {
          log('warn', `Cascade analysis failed: ${err.message}`);
        }
      }
      this.epistemic.update(inv);
      this._autosave(inv);

      // ── NARRATIVE ───────────────────────────────────
      inv.phase = 'narrative';
      this.epistemic.setPhase('narrative');
      this._progress(inv, 'Checking narrative coherence');

      inv.narrativeModel = this.narrative.analyze(inv.claims, inv.evidence, inv.entities);
      inv.narrativeCoherence = this.narrative.scoreCoherence(inv.narrativeModel);

      if (inv.narrativeModel?.impossibilities?.length > 0) {
        this._progress(inv, `⚠ ${inv.narrativeModel.impossibilities.length} narrative impossibilities detected`);
      }

      this.epistemic.update(inv);
      this._autosave(inv);

      // ── CHECK (TRIPLE GATE) ─────────────────────────
      // Gate 1: Evidence (Bayesian confidence)
      // Gate 2: Epistemic (knowledge, diversity, coherence)
      // Gate 3: Adversarial (survived counter-arguments)
      inv.phase = Phase.CHECK;
      this.epistemic.setPhase('check');
      this._progress(inv, 'Checking triple gate');

      const epistemicGate = this.epistemic.checkGate(config.epistemic);
      // With LLM-powered adversarial generation, counter-hypotheses are much
      // stronger than the old regex strategies. A well-investigated claim should
      // survive ~30% — i.e., at least some counter-arguments lack support.
      // 0.50 was too strict with LLM adversaries (basically nothing passes).
      const adversarialGate = inv._attackSurvival >= 0.30;
      const narrativeGate = (inv.narrativeCoherence?.overall ?? 1) >= 0.40;

      const allGatesPassed = epistemicGate.passed && adversarialGate && narrativeGate;

      inv._gateResult = {
        ...epistemicGate,
        adversarialPassed: adversarialGate,
        narrativePassed: narrativeGate,
        passed: allGatesPassed,
        blockers: [
          ...epistemicGate.blockers,
          ...(!adversarialGate ? ['adversarial'] : []),
          ...(!narrativeGate ? ['narrative'] : []),
        ],
      };

      if (allGatesPassed) {
        this._progress(inv, 'All gates passed — conclusions earned');
        inv.status = inv.confidence >= 0.7 ? ClaimStatus.SUPPORTED :
                     inv.confidence <= 0.3 ? ClaimStatus.CONTRADICTED :
                     ClaimStatus.CONTESTED;
      } else {
        const blockers = inv._gateResult.blockers.join(', ');
        this._progress(inv, `Gate blocked: ${blockers}`);
        inv.status = ClaimStatus.INSUFFICIENT;
      }

      // ── REPORT ──────────────────────────────────────
      inv.phase = Phase.REPORT;
      inv.vectors = this.epistemic.toJSON();

      // ── POSTFLIGHT ──────────────────────────────────
      inv.phase = Phase.POSTFLIGHT;
      this.epistemic.setPhase('postflight');
      inv.timestamps.completed = Date.now();
      inv.meta.wallTimeMs = inv.timestamps.completed - inv.timestamps.started;

      inv.learning.delta = this.epistemic.learningDelta();

      this.epistemic.update(inv);
      this._progress(inv, `Complete in ${(inv.meta.wallTimeMs / 1000).toFixed(1)}s | ${inv.status.toUpperCase()}`);

      if (this._store) {
        try {
          await this._store.save?.(inv);
        } catch (storeErr) {
          log('warn', `store: save failed (non-fatal): ${storeErr.message?.slice(0, 200)}`);
        }
      }

      return inv;
    } catch (err) {
      inv.status = 'error';
      inv.error = err.message;
      log('error', `Pipeline error: ${err.stack || err.message}`);
      return inv;
    }
  }

  async sweep(query, options = {}) {
    await registry.loadAll();

    const allowedSources = options.sources && options.sources !== 'all'
      ? (Array.isArray(options.sources) ? options.sources : `${options.sources}`.split(','))
          .map(source => source.trim())
          .filter(Boolean)
      : null;

    const connectors = registry.route(query, {
      maxSources: options.maxSources || 15,
      connectors: allowedSources || undefined,
    });

    const config = getConfig();
    const results = await this._runConnectors(connectors, query, config.connectors.maxConcurrent);

    return {
      query,
      sourcesQueried: connectors.length,
      sourcesResponded: results.filter(r => r.evidence).length,
      evidence: results.flatMap(r => r.evidence || []),
      connectors: connectors.map(c => c.id),
    };
  }

  setStore(store) {
    this._store = store;
  }

  // ── Internal ────────────────────────────────────────────

  /**
   * Run planned queries — each connector gets its own specific queries.
   * Tries multiple queries per connector and merges results.
   */
  async _runPlannedQueries(connectorQueryMap, concurrency, inv = null) {
    const results = [];
    const entries = Object.entries(connectorQueryMap);

    // Sort by health score — prioritize connectors that have been reliable
    entries.sort((a, b) => {
      const healthA = this._getHealth(a[0]);
      const healthB = this._getHealth(b[0]);
      return healthB - healthA;
    });

    const queue = [...entries];

    const run = async () => {
      while (queue.length > 0) {
        const [connectorId, queries] = queue.shift();
        const connector = registry.get(connectorId);
        if (!connector) {
          results.push({ connectorId, evidence: null, error: 'connector not found' });
          continue;
        }

        // Check health but be lenient — only skip if we have better alternatives
        // Very low health (< 10%) suggests persistent failure, but < 20% might be transient
        const health = this._getHealth(connectorId);
        const isVeryBroken = health < 0.1 && this._connectorHealth.has(connectorId);

        if (isVeryBroken) {
          log('info', `Skipping ${connectorId} (persistent failure: ${(health*100).toFixed(0)}% health)`);
          continue;
        }

        if (health < 0.2 && this._connectorHealth.has(connectorId)) {
          log('info', `Retrying ${connectorId} despite low health (${(health*100).toFixed(0)}%) — selected by query planner as relevant`);
        }

        const allEvidence = [];
        const seenUrls = new Set();

        for (const q of queries) {
          try {
            // Check cache first
            const cached = this.cache.get(connectorId, q);
            if (cached) {
              for (const e of cached) {
                const key = e.sourceUrl || e.summary;
                if (!seenUrls.has(key)) {
                  seenUrls.add(key);
                  allEvidence.push(e);
                }
              }
              continue;
            }

            const evidence = await connector.search(q, {
              claimId: inv?.claims?.[0]?.id,
              recencyMode: inv?.searchPlan?.entities?.recencyMode || false,
            });

            // Cache the results
            if (evidence.length > 0) {
              this.cache.set(connectorId, q, evidence);
            }

            for (const e of evidence) {
              const key = e.sourceUrl || e.summary;
              if (!seenUrls.has(key)) {
                seenUrls.add(key);
                allEvidence.push(e);
              }
            }
          } catch (err) {
            log('warn', `${connectorId} query "${q.slice(0, 40)}..." failed: ${err.message}`);
            this._recordHealth(connectorId, false);
          }
        }

        if (allEvidence.length > 0) {
          this._recordHealth(connectorId, true);
        } else {
          this._recordHealth(connectorId, false);
        }

        results.push({ connectorId, evidence: allEvidence.length > 0 ? allEvidence : null });
        if (inv && allEvidence.length > 0) {
          this._progress(inv, `  ${connector.name}: ${allEvidence.length} results (${queries.length} queries)`);
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, entries.length) }, () => run());
    await Promise.all(workers);
    return results;
  }

  _recordHealth(connectorId, success) {
    if (!this._connectorHealth.has(connectorId)) {
      this._connectorHealth.set(connectorId, { successes: 0, failures: 0 });
    }
    const h = this._connectorHealth.get(connectorId);
    if (success) h.successes++;
    else h.failures++;
  }

  _getHealth(connectorId) {
    const h = this._connectorHealth.get(connectorId);
    if (!h) return 1.0; // unknown = give benefit of doubt
    const total = h.successes + h.failures;
    if (total === 0) return 1.0;
    return h.successes / total;
  }

  async _runConnectors(connectors, query, concurrency, inv = null) {
    const results = [];
    const queue = [...connectors];

    const run = async () => {
      while (queue.length > 0) {
        const connector = queue.shift();
        try {
          const evidence = await connector.search(query, { claimId: inv?.claims?.[0]?.id });
          results.push({ connectorId: connector.id, evidence });
          if (inv) {
            this._progress(inv, `  ${connector.name}: ${evidence.length} results`);
          }
        } catch (err) {
          results.push({ connectorId: connector.id, evidence: null, error: err.message });
          log('warn', `${connector.id} failed: ${err.message}`);
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, connectors.length) }, () => run());
    await Promise.all(workers);

    return results;
  }

  _autosave(inv) {
    const dir = inv._autosaveDir || this.autosaveDir;
    if (!dir) return;
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const snapshot = {
        ts: new Date().toISOString(),
        query: inv.query,
        phase: inv.phase,
        status: inv.status,
        confidence: inv.confidence,
        evidenceCount: inv.evidence?.length || 0,
        claimsCount: inv.claims?.length || 0,
        meta: inv.meta,
        timestamps: inv.timestamps,
        searchPlan: inv.searchPlan,
        evidence: inv.evidence,
        claims: inv.claims,
        entities: inv.entities,
        synthesis: inv.synthesis,
        facts: inv.facts,
        coverageGaps: inv.coverageGaps,
      };
      writeFileSync(join(dir, `phase_${inv.phase}.json`), JSON.stringify(snapshot, null, 2));
      writeFileSync(join(dir, 'latest.json'), JSON.stringify(snapshot, null, 2));
      log('info', `[autosave] ${inv.phase} checkpoint (${inv.evidence?.length || 0} evidence)`);
    } catch (e) {
      log('warn', `[autosave] Failed: ${e.message}`);
    }
  }

  _progress(inv, message) {
    const status = this.epistemic.statusLine();
    log('info', `[${inv.phase}] ${status} ${message}`);
    if (this._onProgress) {
      this._onProgress({
        phase: inv.phase,
        message,
        status,
        vectors: { ...this.epistemic.vectors },
      });
    }
  }

  /**
   * Firecrawl second-pass: for evidence items with a URL and short
   * summary (< 600 chars), fetch the full document text.
   * Only runs on high-trust connectors where full text matters:
   * academic, legal, government, and major news.
   * Capped at 12 items to avoid blowing the investigation budget.
   */
  async _deepReadEvidence(evidenceItems, inv) {
    const FIRECRAWL_URL = process.env.FIRECRAWL_URL || 'http://localhost:3002';
    const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

    // Only deep-read these high-signal connector types
    const DEEP_READ_CONNECTORS = new Set([
      'arxiv', 'biorxiv', 'pubmed', 'semantic_scholar', 'openalex', 'crossref',
      'courtlistener', 'pacer', 'federal_register', 'sec_edgar', 'deep-sec',
      'congressional_record', 'fda', 'epa-echo', 'dol-enforcement',
      'guardian', 'associated-press', 'nytimes',
    ]);

    const candidates = evidenceItems.filter(e =>
      e.sourceUrl &&
      e.sourceUrl.startsWith('http') &&
      (e.summary || '').length < 600 &&
      DEEP_READ_CONNECTORS.has(e.connectorId)
    ).slice(0, 12); // cap: 12 deep reads per investigation

    if (candidates.length === 0) return evidenceItems;

    this._progress(inv, `[deep-read] Fetching full text for ${candidates.length} high-trust sources via Firecrawl`);

    const deepRead = async (ev) => {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (FIRECRAWL_API_KEY) headers['Authorization'] = `Bearer ${FIRECRAWL_API_KEY}`;

        const res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ url: ev.sourceUrl, formats: ['markdown'] }),
          signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) return ev;
        const data = await res.json();
        const fullText = data.data?.markdown || data.markdown || '';

        if (fullText.length > ev.summary?.length) {
          return {
            ...ev,
            summary: fullText.slice(0, 8000), // keep first 8K chars
            data: { ...ev.data, fullTextFetched: true, originalSummaryLength: ev.summary?.length },
          };
        }
        return ev;
      } catch {
        return ev; // silently fall back to original
      }
    };

    // Run deep reads in parallel (max 4 at a time)
    const enriched = new Map(evidenceItems.map(e => [e.id, e]));
    const BATCH = 4;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(deepRead));
      for (const ev of results) enriched.set(ev.id, ev);
    }

    const deepReadCount = [...enriched.values()].filter(e => e.data?.fullTextFetched).length;
    if (deepReadCount > 0) {
      this._progress(inv, `[deep-read] ${deepReadCount} sources enriched with full document text`);
    }

    return [...enriched.values()];
  }
}

export default Pipeline;
