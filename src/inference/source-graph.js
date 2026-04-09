/**
 * doubt — Source Independence Graph
 *
 * Citation diversity as a number (0.35) is abstract.
 * A graph showing "these 15 articles all trace to 2 Reuters wires" is visceral.
 *
 * This module builds a visual dependency graph of evidence sources:
 *   - Root sources: the originators of information
 *   - Derivative sources: everything that cites, re-reports, or amplifies a root
 *   - Clusters: groups of derivatives hanging off one root
 *   - Echo chambers: self-reinforcing feedback loops
 *
 * Visualization creates understanding that numbers alone cannot.
 * The tree output is designed for terminal display and report embedding.
 */

import { log } from '../core/config.js';

export class SourceGraph {

  /**
   * Build the independence graph from evidence and citation analysis.
   *
   * citationResult comes from CitationDiversityAnalyzer.analyze() and has:
   *   { diversity, clusters, clusterSizes, loops, rootSources, derivativeSources, totalEvidence }
   */
  build(evidence, citationResult) {
    if (!evidence || evidence.length === 0) {
      return {
        nodes: [],
        edges: [],
        clusters: [],
        stats: {
          totalNodes: 0, rootNodes: 0, derivativeNodes: 0,
          maxClusterSize: 0, independenceScore: 0, largestCluster: null,
        },
      };
    }

    const clusters = citationResult?.clusters || {};
    const clusterSizes = citationResult?.clusterSizes || {};

    // Build node list
    const nodes = [];
    const rootIds = new Set(Object.keys(clusters));

    for (const e of evidence) {
      const isRoot = rootIds.has(e.id) || e.rootSource === e.id || !e.rootSource;
      nodes.push({
        id: e.id,
        connector: e.connectorId || 'unknown',
        isRoot,
        trust: round(e.trustWeight),
        summary: truncate(e.summary || '', 80),
      });
    }

    // Build edge list (derivative → root)
    const edges = [];
    for (const e of evidence) {
      if (e.rootSource && e.rootSource !== e.id) {
        edges.push({
          from: e.id,
          to: e.rootSource,
          type: 'derives_from',
        });
      }
    }

    // Build cluster summaries
    const clusterList = [];
    for (const [rootId, memberIds] of Object.entries(clusters)) {
      const rootEvidence = evidence.find(e => e.id === rootId);
      const derivativeIds = (Array.isArray(memberIds) ? memberIds : []).filter(id => id !== rootId);
      const derivativeConnectors = [...new Set(
        derivativeIds
          .map(id => evidence.find(e => e.id === id))
          .filter(Boolean)
          .map(e => e.connectorId || 'unknown')
      )];

      clusterList.push({
        rootId,
        rootConnector: rootEvidence?.connectorId || 'unknown',
        rootSummary: truncate(rootEvidence?.summary || '', 80),
        derivativeCount: derivativeIds.length,
        derivativeConnectors,
      });
    }
    clusterList.sort((a, b) => b.derivativeCount - a.derivativeCount);

    // Stats
    const rootCount = nodes.filter(n => n.isRoot).length;
    const derivativeCount = nodes.length - rootCount;
    const maxCluster = clusterList.length > 0 ? clusterList[0] : null;

    const stats = {
      totalNodes: nodes.length,
      rootNodes: rootCount,
      derivativeNodes: derivativeCount,
      maxClusterSize: maxCluster ? maxCluster.derivativeCount + 1 : 0,
      independenceScore: round(this.independenceScore({
        nodes, edges, clusters: clusterList, stats: {},
      })),
      largestCluster: maxCluster
        ? { rootConnector: maxCluster.rootConnector, size: maxCluster.derivativeCount + 1 }
        : null,
    };

    const graph = { nodes, edges, clusters: clusterList, stats };

    log('info', `Source graph: ${stats.rootNodes} roots, ` +
      `${stats.derivativeNodes} derivatives, ` +
      `independence ${(stats.independenceScore * 100).toFixed(0)}%`);

    return graph;
  }

  /**
   * Generate a text-based tree visualization of the dependency structure.
   * Designed for immediate "aha" understanding in terminal output.
   */
  visualize(graph) {
    if (!graph || graph.nodes.length === 0) {
      return 'SOURCE INDEPENDENCE GRAPH\n━━━━━━━━━━━━━━━━━━━━━━━\n(no evidence to graph)\n';
    }

    const lines = [];
    lines.push('SOURCE INDEPENDENCE GRAPH');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    const derivativesByRoot = new Map();
    for (const edge of graph.edges) {
      if (!derivativesByRoot.has(edge.to)) derivativesByRoot.set(edge.to, []);
      derivativesByRoot.get(edge.to).push(edge.from);
    }

    // Render each root as a tree
    const roots = graph.nodes.filter(n => n.isRoot);
    const rendered = new Set();

    for (const root of roots) {
      const derivatives = derivativesByRoot.get(root.id) || [];
      const isIndependent = derivatives.length === 0;

      lines.push(`◉ ROOT: ${root.connector} (trust: ${root.trust.toFixed(2)})` +
        (isIndependent ? '  [INDEPENDENT]' : ''));
      lines.push(`│  "${root.summary}"`);
      rendered.add(root.id);

      // Render derivatives as a tree
      this._renderDerivatives(lines, graph, root.id, derivativesByRoot, rendered, 0);
      lines.push('');
    }

    // Any orphan nodes not rendered (no root link, not a root themselves)
    const orphans = graph.nodes.filter(n => !rendered.has(n.id));
    if (orphans.length > 0) {
      lines.push('○ UNLINKED EVIDENCE:');
      for (const o of orphans) {
        lines.push(`   ${o.connector} (trust: ${o.trust.toFixed(2)}) "${o.summary}"`);
      }
      lines.push('');
    }

    // Footer
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(
      `Independence: ${graph.stats.rootNodes} root source${graph.stats.rootNodes !== 1 ? 's' : ''} ` +
      `from ${graph.stats.totalNodes} evidence items ` +
      `(diversity: ${graph.stats.independenceScore.toFixed(2)})`
    );

    if (graph.stats.largestCluster) {
      lines.push(
        `Largest cluster: ${graph.stats.largestCluster.rootConnector} → ` +
        `${graph.stats.largestCluster.size - 1} derivative${graph.stats.largestCluster.size - 1 !== 1 ? 's' : ''}`
      );
    }

    // Warnings
    if (graph.stats.totalNodes > 0) {
      const topClusterShare = graph.stats.maxClusterSize / graph.stats.totalNodes;
      if (topClusterShare > 0.50) {
        lines.push(
          `Warning: ${(topClusterShare * 100).toFixed(0)}% of evidence traces ` +
          `to a single ${graph.stats.largestCluster?.rootConnector || 'source'}`
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * Detect clusters where evidence is self-reinforcing.
   *
   * Echo chambers:
   *   - Large clusters with no independent verification
   *   - Social media amplifying news that amplifies social media
   *   - Multiple sources with suspiciously similar language
   */
  detectEchoChambers(graph) {
    if (!graph || graph.nodes.length === 0) return [];

    const warnings = [];
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

    for (const cluster of graph.clusters) {
      // Unverified large cluster: many derivatives, all from low-trust sources
      if (cluster.derivativeCount >= 3) {
        const derivativeNodes = graph.edges
          .filter(e => e.to === cluster.rootId)
          .map(e => nodeMap.get(e.from))
          .filter(Boolean);

        const avgDerivativeTrust = derivativeNodes.length > 0
          ? derivativeNodes.reduce((s, n) => s + n.trust, 0) / derivativeNodes.length
          : 0;

        const rootNode = nodeMap.get(cluster.rootId);

        // Large cluster where derivatives are just amplification
        if (avgDerivativeTrust < 0.50) {
          warnings.push({
            type: 'amplification_cluster',
            severity: cluster.derivativeCount >= 6 ? 'high' : 'medium',
            rootConnector: cluster.rootConnector,
            derivativeCount: cluster.derivativeCount,
            message: `${cluster.derivativeCount} low-trust sources all amplify ` +
              `one ${cluster.rootConnector} item — this is echo, not evidence`,
          });
        }

        // Social → news → social feedback loop
        const hasSocial = cluster.derivativeConnectors.some(c =>
          ['reddit', 'hackernews', 'stocktwits'].includes(c)
        );
        const hasNews = cluster.derivativeConnectors.some(c =>
          ['gdelt', 'news_archive', 'news_intel', 'google_factcheck'].includes(c)
        );

        if (hasSocial && hasNews) {
          warnings.push({
            type: 'feedback_loop',
            severity: 'medium',
            rootConnector: cluster.rootConnector,
            derivativeCount: cluster.derivativeCount,
            message: `Potential feedback loop: social media and news outlets ` +
              `cross-citing around ${cluster.rootConnector} — check chronological order`,
          });
        }

        // Similar language detection across derivatives
        const summaries = derivativeNodes.map(n => n.summary).filter(Boolean);
        if (summaries.length >= 3) {
          const similarity = avgPairwiseSimilarity(summaries);
          if (similarity > 0.60) {
            warnings.push({
              type: 'copy_paste',
              severity: similarity > 0.80 ? 'high' : 'medium',
              rootConnector: cluster.rootConnector,
              derivativeCount: cluster.derivativeCount,
              message: `${cluster.derivativeCount} sources have ${(similarity * 100).toFixed(0)}% ` +
                `text similarity — likely copy-paste, not independent reporting`,
            });
          }
        }
      }
    }

    // No independent roots at all
    if (graph.stats.rootNodes === 1 && graph.stats.totalNodes > 3) {
      warnings.push({
        type: 'single_root',
        severity: 'high',
        rootConnector: graph.clusters[0]?.rootConnector || 'unknown',
        derivativeCount: graph.stats.derivativeNodes,
        message: `ALL evidence traces to a single root source ` +
          `(${graph.clusters[0]?.rootConnector || 'unknown'}) — ` +
          `zero independent corroboration`,
      });
    }

    warnings.sort((a, b) => {
      const sev = { high: 3, medium: 2, low: 1 };
      return (sev[b.severity] || 0) - (sev[a.severity] || 0);
    });

    if (warnings.length > 0) {
      log('warn', `Echo chamber detection: ${warnings.length} warning(s)`);
    }

    return warnings;
  }

  /**
   * Calculate how independent the evidence base truly is.
   *
   * Scoring:
   *   - Penalize large clusters (many derivatives from one root)
   *   - Reward independent discoveries (multiple roots)
   *   - Penalize if all roots are from the same domain
   *   - Return 0–1 where 1 = maximally independent
   */
  independenceScore(graph) {
    if (!graph || graph.nodes.length === 0) return 0;
    if (graph.nodes.length === 1) return 1;

    const roots = graph.nodes.filter(n => n.isRoot);
    const total = graph.nodes.length;

    if (roots.length === 0) return 0;

    // Factor 1: Root ratio (more roots = more independent)
    const rootRatio = roots.length / total;

    // Factor 2: Cluster size penalty (large clusters hurt independence)
    let maxClusterShare = 0;
    for (const cluster of (graph.clusters || [])) {
      const clusterSize = cluster.derivativeCount + 1;
      const share = clusterSize / total;
      if (share > maxClusterShare) maxClusterShare = share;
    }
    const clusterPenalty = 1 - maxClusterShare;

    // Factor 3: Domain diversity among roots (all roots from same domain = bad)
    const rootDomains = new Set(roots.map(r => connectorToDomain(r.connector)));
    const domainDiversity = rootDomains.size > 1
      ? rootDomains.size / Math.max(roots.length, 1)
      : (roots.length === 1 ? 0.5 : 0.2);

    // Weighted combination
    const score = rootRatio * 0.40 + clusterPenalty * 0.35 + domainDiversity * 0.25;

    return Math.max(0, Math.min(1, round(score)));
  }

  // ─── Internal ──────────────────────────────────────────────

  _renderDerivatives(lines, graph, parentId, derivativesByRoot, rendered, depth) {
    const childIds = derivativesByRoot.get(parentId) || [];
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

    for (let i = 0; i < childIds.length; i++) {
      const childId = childIds[i];
      if (rendered.has(childId)) continue;
      rendered.add(childId);

      const child = nodeMap.get(childId);
      if (!child) continue;

      const isLast = i === childIds.length - 1;
      const prefix = depth === 0
        ? (isLast ? '└── ' : '├── ')
        : ('│   '.repeat(depth) + (isLast ? '└── ' : '├── '));

      lines.push(
        `${prefix}${child.connector} (trust: ${child.trust.toFixed(2)}) "${child.summary}"`
      );

      // Recurse for multi-level derivation
      this._renderDerivatives(lines, graph, childId, derivativesByRoot, rendered, depth + 1);
    }
  }
}

// ─── Utility ──────────────────────────────────────────────

function round(n, places = 4) {
  return Math.round(n * 10 ** places) / 10 ** places;
}

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

const CONNECTOR_DOMAINS = {
  sec_edgar: 'financial', sec_insider: 'financial', sec_xbrl: 'financial',
  polygon_market: 'financial', fred: 'financial', fdic: 'financial',
  finra: 'financial', cftc_cot: 'financial', cme_warehouse: 'financial',
  courtlistener: 'legal', pacer: 'legal', state_courts: 'legal',
  reuters: 'news', gdelt: 'news', hackernews: 'news', google_factcheck: 'news',
  duckduckgo: 'news', news_archive: 'news', news_intel: 'news',
  reddit: 'social', stocktwits: 'social',
  openalex: 'academic', semantic_scholar: 'academic', pubmed: 'academic',
  crossref: 'academic', arxiv: 'academic', papers_with_code: 'academic',
  opensanctions: 'sanctions', ofac: 'sanctions', interpol: 'sanctions',
  opencorporates: 'corporate', gleif: 'corporate', uk_companies_house: 'corporate',
  wikipedia: 'reference', wayback: 'reference',
  fec: 'political', congressional_record: 'political', lobbying: 'political',
  sam_gov: 'government', federal_register: 'government', federal_procurement: 'government',
  github: 'technical', github_deep: 'technical', huggingface: 'technical',
};

function connectorToDomain(connectorId) {
  if (!connectorId) return 'unknown';
  return CONNECTOR_DOMAINS[connectorId] || 'other';
}

/**
 * Average Jaccard similarity across all pairs of strings.
 * Used to detect copy-paste echo chambers.
 */
function avgPairwiseSimilarity(strings) {
  if (strings.length < 2) return 0;

  let totalSim = 0;
  let pairs = 0;

  for (let i = 0; i < strings.length; i++) {
    const wordsA = new Set(strings[i].toLowerCase().split(/\s+/).filter(w => w.length > 3));
    for (let j = i + 1; j < strings.length; j++) {
      const wordsB = new Set(strings[j].toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const intersection = [...wordsA].filter(w => wordsB.has(w));
      const union = new Set([...wordsA, ...wordsB]);
      totalSim += union.size > 0 ? intersection.length / union.size : 0;
      pairs++;
    }
  }

  return pairs > 0 ? totalSim / pairs : 0;
}

export default SourceGraph;
