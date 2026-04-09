/**
 * doubt — Epistemic Cascade Engine
 *
 * THE STRUCTURAL INTELLIGENCE UPGRADE.
 *
 * Most verification systems treat claims as a flat list:
 * "Claim 1: 72% confidence, Claim 2: 45% confidence..."
 *
 * That's useless. Claims are a GRAPH. Some claims depend on others.
 * If you prove "Iran has a nuclear weapons program" is false,
 * then "Iran nuclear sanctions should be maintained" collapses too.
 * But "Iran has high inflation" survives — it's independent.
 *
 * This module:
 *   1. Takes doubt's extracted claims
 *   2. Uses LLM to infer dependency edges between them
 *   3. Builds a ClaimDependencyGraph (DAG)
 *   4. Runs cascade simulations: "if claim X is false, what collapses?"
 *   5. Identifies KEYSTONE claims — the ones that matter most
 *   6. Returns structural intelligence that transforms the investigation
 *
 * Ported from epistemic-cascade/ — the most mathematically rigorous
 * cascade analysis in the workspace. Adapted to work within doubt's
 * pipeline architecture.
 *
 * WHAT THIS GIVES YOU THAT NOBODY ELSE HAS:
 *   - "The entire Iran investigation hinges on 2 keystone claims"
 *   - "If claim #3 is false, 7 other conclusions collapse"
 *   - "Claims #5 and #8 are leaves — even if wrong, nothing else breaks"
 *   - Structural fragility score for the entire investigation
 */

import { log, getConfig } from '../core/config.js';

// ─── Beta-Bernoulli Node ─────────────────────────────────────

class BetaBernoulliNode {
  constructor({ alpha = 1.0, beta = 1.0, claimId = null } = {}) {
    this.alpha = alpha;
    this.beta = beta;
    this.claimId = claimId;
  }

  confidence() { return this.alpha / (this.alpha + this.beta); }

  uncertainty() {
    const n = this.alpha + this.beta;
    return (this.alpha * this.beta) / (n * n * (n + 1));
  }

  credibleInterval() {
    const mean = this.confidence();
    const std = Math.sqrt(this.uncertainty());
    return { lower: Math.max(0, mean - 1.96 * std), upper: Math.min(1, mean + 1.96 * std) };
  }

  update(supports, weight = 1.0) {
    const w = Math.max(0.1, Math.min(10, weight));
    if (supports) this.alpha += w;
    else this.beta += w;
    return this;
  }

  clone() {
    return new BetaBernoulliNode({ alpha: this.alpha, beta: this.beta, claimId: this.claimId });
  }
}

function confidenceToBeta(p, kappa = 2) {
  p = Math.max(0.01, Math.min(0.99, p));
  return { alpha: p * kappa, beta: (1 - p) * kappa };
}

// ─── Edge Types & Damping ────────────────────────────────────

const EdgeType = {
  DEPENDS_ON: 'depends_on', SUPPORTS: 'supports', IMPLIES: 'implies',
  REQUIRES: 'requires', EVIDENCES: 'evidences', BLOCKS: 'blocks',
  CONTRADICTS: 'contradicts', SUBSTITUTES: 'substitutes',
};

const EDGE_DAMPING = {
  depends_on: 0.75, requires: 0.80, supports: 0.40,
  implies: 0.65, evidences: 0.35, blocks: -0.20,
  contradicts: 0.0, substitutes: 0.20,
};

function getDampingFactor(edgeType) { return EDGE_DAMPING[edgeType] ?? 0.45; }

// ─── Collapse/Damage Thresholds ──────────────────────────────

const COLLAPSE_THRESHOLD = 0.25;
const DAMAGE_THRESHOLD = 0.45;

// ─── ClaimNode ───────────────────────────────────────────────

class ClaimNode {
  constructor({ id, text, confidence = 0.5, isRoot = false, category = 'assertion', metadata = {} }) {
    this.id = id;
    this.text = text;
    this.isRoot = isRoot;
    this.category = category;
    this.metadata = metadata;
    const { alpha, beta } = confidenceToBeta(confidence, 2);
    this.belief = new BetaBernoulliNode({ alpha, beta, claimId: id });
    this.baselineConfidence = confidence;
    this.postCascadeConfidence = null;
    this.keystoneScore = 0;
    this.cascadeRadius = 0;
  }

  confidence() { return this.belief.confidence(); }

  applyEvidence(items) {
    for (const ev of items) {
      this.belief.update(ev.supports, ev.weight ?? 1.0);
      this.baselineConfidence = this.confidence();
    }
  }
}

// ─── ClaimEdge ───────────────────────────────────────────────

class ClaimEdge {
  constructor({ sourceId, targetId, type = EdgeType.SUPPORTS, weight = 1.0, label = '' }) {
    this.id = `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.sourceId = sourceId;
    this.targetId = targetId;
    this.type = type;
    this.weight = weight;
    this.label = label;
  }
}

// ─── ClaimDependencyGraph ────────────────────────────────────

class ClaimDependencyGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.outgoing = new Map();
    this.incoming = new Map();
  }

  addNode(node) {
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) this.outgoing.set(node.id, []);
    if (!this.incoming.has(node.id)) this.incoming.set(node.id, []);
    return node;
  }

  getNode(id) { return this.nodes.get(id); }

  getRootNode() {
    for (const node of this.nodes.values()) if (node.isRoot) return node;
    return this.nodes.values().next().value;
  }

  addEdge(edge) {
    if (!this.nodes.has(edge.sourceId) || !this.nodes.has(edge.targetId)) return null;
    this.edges.set(edge.id, edge);
    this.outgoing.get(edge.sourceId).push(edge.id);
    this.incoming.get(edge.targetId).push(edge.id);
    return edge;
  }

  getOutgoingEdges(nodeId) {
    return (this.outgoing.get(nodeId) || []).map(id => this.edges.get(id)).filter(Boolean);
  }

  getIncomingEdges(nodeId) {
    return (this.incoming.get(nodeId) || []).map(id => this.edges.get(id)).filter(Boolean);
  }

  toJSON() {
    return {
      claims: [...this.nodes.values()].map(n => ({
        id: n.id, text: n.text, isRoot: n.isRoot, category: n.category,
        confidence: n.confidence(), keystoneScore: n.keystoneScore,
        cascadeRadius: n.cascadeRadius,
      })),
      edges: [...this.edges.values()].map(e => ({
        sourceId: e.sourceId, targetId: e.targetId, type: e.type, weight: e.weight, label: e.label,
      })),
    };
  }
}

// ─── Cascade Simulator ───────────────────────────────────────

function simulateCascade(graph, targetNodeId) {
  const targetNode = graph.getNode(targetNodeId);
  if (!targetNode) return null;

  const baselineConf = new Map();
  for (const [id, node] of graph.nodes.entries()) {
    baselineConf.set(id, node.belief.confidence());
  }

  const workingConf = new Map(baselineConf);
  workingConf.set(targetNodeId, 0.02); // falsify

  const nodeStates = new Map();
  nodeStates.set(targetNodeId, {
    nodeId: targetNodeId, nodeText: targetNode.text,
    baselineConfidence: baselineConf.get(targetNodeId),
    postCascadeConfidence: 0.02,
    confidenceDelta: -(baselineConf.get(targetNodeId) - 0.02),
    status: 'falsified', depth: 0,
  });

  // BFS cascade propagation
  const queue = [{ nodeId: targetNodeId, depth: 1 }];
  const visited = new Set([targetNodeId]);
  const SCALE = 8.0;
  const kappa = 2.0;

  while (queue.length > 0) {
    const { nodeId: parentId, depth } = queue.shift();
    const parentDelta = workingConf.get(parentId) - baselineConf.get(parentId);
    if (parentDelta >= 0) continue;

    for (const edge of graph.getOutgoingEdges(parentId)) {
      const childId = edge.targetId;
      if (!graph.getNode(childId)) continue;

      const damp = getDampingFactor(edge.type) * edge.weight;
      const damageWeight = Math.abs(parentDelta) * damp;
      const currentConf = workingConf.get(childId) ?? baselineConf.get(childId);
      const newConf = Math.max(0.02, (currentConf * kappa) / (kappa + damageWeight * SCALE));
      workingConf.set(childId, newConf);

      if (!nodeStates.has(childId)) {
        nodeStates.set(childId, {
          nodeId: childId, nodeText: graph.getNode(childId).text,
          baselineConfidence: baselineConf.get(childId),
          postCascadeConfidence: null, confidenceDelta: null,
          status: 'unaffected', depth,
        });
      }

      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push({ nodeId: childId, depth: depth + 1 });
      }
    }
  }

  // Finalize states
  let collapsed = 0, damaged = 0;
  for (const [nodeId, state] of nodeStates.entries()) {
    if (state.status === 'falsified') continue;
    const postConf = workingConf.get(nodeId);
    state.postCascadeConfidence = postConf;
    state.confidenceDelta = postConf - state.baselineConfidence;
    if (postConf < COLLAPSE_THRESHOLD) { state.status = 'collapsed'; collapsed++; }
    else if (postConf < DAMAGE_THRESHOLD) { state.status = 'damaged'; damaged++; }
  }

  const totalNonTarget = graph.nodes.size - 1;
  const collapseFraction = totalNonTarget > 0 ? collapsed / totalNonTarget : 0;
  const rootNode = graph.getRootNode();
  const rootState = rootNode ? nodeStates.get(rootNode.id) : null;
  const rootCollapsed = rootState?.status === 'collapsed' || rootState?.status === 'falsified';

  const affectedStates = [...nodeStates.values()].filter(s =>
    s.status !== 'falsified' && s.confidenceDelta !== null
  );
  const avgDrop = affectedStates.length > 0
    ? affectedStates.reduce((s, st) => s + Math.abs(st.confidenceDelta), 0) / affectedStates.length
    : 0;

  return {
    falsifiedNodeId: targetNodeId,
    falsifiedNodeText: targetNode.text,
    totalNodes: graph.nodes.size,
    collapsedCount: collapsed,
    damagedCount: damaged,
    collapseFraction,
    rootCollapsed,
    averageConfidenceDrop: avgDrop,
    nodeStates: Object.fromEntries(nodeStates),
  };
}

// ─── Keystone Detector ───────────────────────────────────────

function detectKeystones(graph, cascadeResults) {
  const rootNode = graph.getRootNode();
  const rootId = rootNode?.id ?? null;
  const scores = [];

  for (const [nodeId, result] of cascadeResults.entries()) {
    const node = graph.getNode(nodeId);
    if (!node) continue;

    const isRoot = nodeId === rootId;
    const totalNonRoot = Math.max(1, graph.nodes.size - 1);
    const collapseFraction = result.collapseFraction;
    const rootCollapsed = result.rootCollapsed ? 1 : 0;
    const avgDrop = Math.min(1, result.averageConfidenceDrop * 2);
    const reachFraction = (result.collapsedCount + result.damagedCount) / totalNonRoot;

    const keystoneScore =
      reachFraction * 0.25 + collapseFraction * 0.15 +
      rootCollapsed * 0.25 + avgDrop * 0.15 + 0.1; // base

    node.keystoneScore = keystoneScore;
    node.cascadeRadius = result.collapsedCount;

    scores.push({
      nodeId, nodeText: node.text, isRoot,
      keystoneScore, cascadeRadius: result.collapsedCount,
      collapseFraction, rootCollapsed: !!rootCollapsed,
      averageConfidenceDrop: result.averageConfidenceDrop,
    });
  }

  // Percentile-based classification
  const nonRoot = scores.filter(s => !s.isRoot).sort((a, b) => b.keystoneScore - a.keystoneScore);
  const n = nonRoot.length;
  const keystoneMin = n > 0 ? (nonRoot[Math.floor(n * 0.25)]?.keystoneScore ?? 0) : Infinity;
  const structuralMin = n > 0 ? (nonRoot[Math.floor(n * 0.65)]?.keystoneScore ?? 0) : Infinity;

  for (const s of scores) {
    if (s.isRoot) { s.role = 'ROOT'; continue; }
    if (s.keystoneScore >= keystoneMin) { s.role = 'KEYSTONE'; continue; }
    if (s.keystoneScore >= structuralMin) { s.role = 'STRUCTURAL'; continue; }
    s.role = 'LEAF';
  }

  return scores.sort((a, b) => b.keystoneScore - a.keystoneScore);
}

// ─── Main Engine ─────────────────────────────────────────────

export class EpistemicCascadeEngine {
  constructor() {
    const config = getConfig();
    this._llmCfg = config.llm || {};
    this._ollamaUrl = this._llmCfg.endpoint || 'http://localhost:11434';
    this._ollamaModel = this._llmCfg.model || 'llama3';
  }

  /**
   * Run full cascade analysis on an investigation's claims.
   *
   * @param {Object[]} claims - doubt's claim objects (with .id, .text, .confidence)
   * @param {Object[]} evidence - evidence items (with .type, .claimId, .trustWeight)
   * @param {string} query - original investigation query
   * @returns {Object} Cascade analysis results
   */
  async analyze(claims, evidence, query) {
    if (!claims?.length || claims.length < 2) {
      return { graph: null, keystones: [], cascades: null, fragilityScore: 0, summary: null };
    }

    log('info', `cascade: analyzing ${claims.length} claims for structural dependencies`);

    // Step 1: Build the claim dependency graph
    const graph = await this._buildGraph(claims, evidence, query);
    log('info', `cascade: graph built — ${graph.nodes.size} nodes, ${graph.edges.size} edges`);

    // Step 2: Apply evidence to graph nodes
    this._applyEvidence(graph, claims, evidence);

    // Step 3: Run cascade simulation for every node
    const cascadeResults = new Map();
    for (const nodeId of graph.nodes.keys()) {
      const result = simulateCascade(graph, nodeId);
      if (result) cascadeResults.set(nodeId, result);
    }

    // Step 4: Detect keystones
    const keystones = detectKeystones(graph, cascadeResults);

    // Step 5: Compute structural fragility
    const fragilityScore = this._computeFragility(keystones, graph);

    // Step 6: Generate human intelligence summary
    const summary = this._generateSummary(keystones, graph, query);

    log('info', `cascade: ${keystones.filter(k => k.role === 'KEYSTONE').length} keystones, fragility=${fragilityScore.toFixed(2)}`);

    return {
      graph: graph.toJSON(),
      keystones,
      cascades: Object.fromEntries([...cascadeResults].map(([k, v]) => [k, v])),
      fragilityScore,
      summary,
    };
  }

  // ─── Graph Construction ────────────────────────────────────

  async _buildGraph(claims, evidence, query) {
    const graph = new ClaimDependencyGraph();

    // Add all claims as nodes
    for (const claim of claims) {
      graph.addNode(new ClaimNode({
        id: claim.id,
        text: claim.text,
        confidence: claim.confidence || 0.5,
        isRoot: !claim.dependsOn || claim.dependsOn.length === 0,
        category: this._categorize(claim.text),
      }));
    }

    // Try LLM-based edge inference first
    const llmEdges = await this._inferEdgesLLM(claims, query);
    if (llmEdges.length > 0) {
      for (const edge of llmEdges) {
        graph.addEdge(new ClaimEdge(edge));
      }
    }

    // Always add heuristic edges for depth
    const heuristicEdges = this._inferEdgesHeuristic(claims);
    for (const edge of heuristicEdges) {
      // Don't duplicate edges
      const existing = [...graph.edges.values()].find(e =>
        e.sourceId === edge.sourceId && e.targetId === edge.targetId
      );
      if (!existing) {
        graph.addEdge(new ClaimEdge(edge));
      }
    }

    // If graph has isolated nodes, connect them to root with weak supports edges
    const rootNode = graph.getRootNode();
    if (rootNode) {
      for (const [nodeId] of graph.nodes) {
        if (nodeId === rootNode.id) continue;
        const hasIncoming = (graph.incoming.get(nodeId) || []).length > 0;
        const hasOutgoing = (graph.outgoing.get(nodeId) || []).length > 0;
        if (!hasIncoming && !hasOutgoing) {
          graph.addEdge(new ClaimEdge({
            sourceId: rootNode.id, targetId: nodeId,
            type: EdgeType.SUPPORTS, weight: 0.3,
            label: 'weak-thematic-link',
          }));
        }
      }
    }

    return graph;
  }

  async _inferEdgesLLM(claims, query) {
    try {
      const config = getConfig();
      const ollamaUrl = this._ollamaUrl;

      // Check Ollama availability
      const check = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!check.ok) return [];

      const claimList = claims.slice(0, 30).map((c, i) =>
        `[${c.id}] "${c.text.slice(0, 150)}"`
      ).join('\n');

      const prompt = `You are an epistemic analyst. Given these claims from an investigation about "${query.slice(0, 200)}", identify DEPENDENCY RELATIONSHIPS between them.

CLAIMS:
${claimList}

For each pair with a relationship, specify:
- sourceId: the claim that is depended upon (upstream)
- targetId: the claim that depends on it (downstream)
- type: one of: depends_on, supports, implies, requires, evidences, blocks, contradicts, substitutes
- weight: 0.1 to 1.0 (strength of relationship)

Rules:
- "A depends_on B" means: if B is false, A's credibility drops significantly
- "A supports B" means: A being true makes B more likely
- "A implies B" means: if A is true, B is almost certainly true
- "A blocks B" means: A being true makes B less likely
- "A contradicts B" means: A and B cannot both be true
- Only include relationships where there's a clear logical connection
- Don't force relationships — missing edges are fine

Reply with ONLY a JSON array:
[{"sourceId":"claim_1","targetId":"claim_2","type":"supports","weight":0.7},...]`;

      const res = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this._ollamaModel, prompt, stream: false,
          options: { num_predict: 2000, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) return [];
      const data = await res.json();
      const raw = data.response || '';

      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return [];

      const edges = JSON.parse(match[0]);
      const validEdges = edges.filter(e =>
        e.sourceId && e.targetId && e.type &&
        claims.some(c => c.id === e.sourceId) &&
        claims.some(c => c.id === e.targetId) &&
        Object.values(EdgeType).includes(e.type)
      );

      log('info', `cascade: LLM inferred ${validEdges.length} edges`);
      return validEdges;
    } catch (err) {
      log('debug', `cascade: LLM edge inference failed: ${err.message}`);
      return [];
    }
  }

  _inferEdgesHeuristic(claims) {
    const edges = [];

    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const a = claims[i], b = claims[j];
        const aLower = a.text.toLowerCase();
        const bLower = b.text.toLowerCase();

        // Entity overlap
        const aWords = new Set(aLower.split(/\s+/).filter(w => w.length > 4));
        const bWords = new Set(bLower.split(/\s+/).filter(w => w.length > 4));
        const overlap = [...aWords].filter(w => bWords.has(w)).length;
        const overlapRatio = Math.min(aWords.size, bWords.size) > 0
          ? overlap / Math.min(aWords.size, bWords.size) : 0;

        if (overlapRatio < 0.2) continue; // too different

        // Check for dependency patterns
        if (a.dependsOn?.includes(b.id)) {
          edges.push({ sourceId: b.id, targetId: a.id, type: EdgeType.DEPENDS_ON, weight: 0.8 });
          continue;
        }
        if (b.dependsOn?.includes(a.id)) {
          edges.push({ sourceId: a.id, targetId: b.id, type: EdgeType.DEPENDS_ON, weight: 0.8 });
          continue;
        }

        // Causal language detection
        const CAUSAL = /\b(because|therefore|consequently|as a result|leads? to|caused? by|due to)\b/i;
        if (CAUSAL.test(aLower) && overlapRatio > 0.3) {
          edges.push({ sourceId: b.id, targetId: a.id, type: EdgeType.SUPPORTS, weight: overlapRatio });
        } else if (CAUSAL.test(bLower) && overlapRatio > 0.3) {
          edges.push({ sourceId: a.id, targetId: b.id, type: EdgeType.SUPPORTS, weight: overlapRatio });
        } else if (overlapRatio > 0.4) {
          // Strong thematic overlap → weak supports relationship
          edges.push({ sourceId: a.id, targetId: b.id, type: EdgeType.SUPPORTS, weight: overlapRatio * 0.6 });
        }
      }
    }

    return edges;
  }

  // ─── Evidence Application ──────────────────────────────────

  _applyEvidence(graph, claims, evidence) {
    for (const claim of claims) {
      const node = graph.getNode(claim.id);
      if (!node) continue;

      // Use doubt's pre-classified evidence
      const relevant = evidence.filter(e =>
        e.claimId === claim.id || (e.claimId === null && claim.isRoot)
      );

      for (const e of relevant) {
        const supports = e.type === 'supports';
        const contradicts = e.type === 'contradicts';
        if (!supports && !contradicts) continue;

        const weight = Math.max(0.1, e.trustWeight || 0.5);
        node.belief.update(supports, weight);
      }

      node.baselineConfidence = node.confidence();
    }
  }

  // ─── Claim Categorization ──────────────────────────────────

  _categorize(text) {
    const lower = text.toLowerCase();
    if (/\b(cause[ds]?|led to|result(?:s|ed) in|because)\b/.test(lower)) return 'causal';
    if (/\b(should|must|ought|need to|important)\b/.test(lower)) return 'normative';
    if (/\b(defined? as|means?|constitutes?)\b/.test(lower)) return 'definitional';
    if (/\b(data|study|research|evidence|found|measured|observed)\b/.test(lower)) return 'empirical';
    return 'assertion';
  }

  // ─── Fragility Scoring ─────────────────────────────────────

  _computeFragility(keystones, graph) {
    if (keystones.length === 0) return 0;

    const ks = keystones.filter(k => k.role === 'KEYSTONE');
    const structural = keystones.filter(k => k.role === 'STRUCTURAL');
    const leaves = keystones.filter(k => k.role === 'LEAF');

    // High fragility = few keystones control most of the graph
    const keystoneRatio = ks.length / Math.max(1, keystones.length);
    const avgCascadeRadius = ks.length > 0
      ? ks.reduce((s, k) => s + k.cascadeRadius, 0) / ks.length
      : 0;
    const normalizedRadius = Math.min(1, avgCascadeRadius / Math.max(1, graph.nodes.size - 1));

    // Fragility = how much of the graph is controlled by keystones
    return Math.min(1, keystoneRatio * 0.4 + normalizedRadius * 0.4 + (ks.length > 0 ? 0.2 : 0));
  }

  // ─── Intelligence Summary ──────────────────────────────────

  _generateSummary(keystones, graph, query) {
    const ks = keystones.filter(k => k.role === 'KEYSTONE');
    const structural = keystones.filter(k => k.role === 'STRUCTURAL');
    const leaves = keystones.filter(k => k.role === 'LEAF');

    const lines = [];
    lines.push(`STRUCTURAL ANALYSIS: ${graph.nodes.size} claims, ${graph.edges.size} dependencies`);

    if (ks.length > 0) {
      lines.push(`\n🔑 KEYSTONE CLAIMS (investigation hinges on these):`);
      for (const k of ks.slice(0, 5)) {
        const node = graph.getNode(k.nodeId);
        lines.push(`  • "${node?.text?.slice(0, 120) || k.nodeText?.slice(0, 120)}" — if false, ${k.cascadeRadius} other claims collapse`);
      }
    }

    if (structural.length > 0) {
      lines.push(`\n🏗️ STRUCTURAL CLAIMS (important but not critical):`);
      for (const s of structural.slice(0, 3)) {
        const node = graph.getNode(s.nodeId);
        lines.push(`  • "${node?.text?.slice(0, 120) || s.nodeText?.slice(0, 120)}"`);
      }
    }

    if (leaves.length > 0) {
      lines.push(`\n🍃 LEAF CLAIMS (isolated — can fail without cascade):`);
      lines.push(`  ${leaves.length} claims are structurally independent`);
    }

    return lines.join('\n');
  }
}

export default EpistemicCascadeEngine;
