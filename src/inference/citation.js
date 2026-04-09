/**
 * doubt — Citation Diversity Analyzer
 *
 * The core insight: 100 news articles citing one Reuters wire
 * is a diversity score of ~0.05, not 100.
 *
 * Evidence is only as diverse as its ROOT sources.
 * A root source is the originator of information — the primary document,
 * the firsthand witness, the original filing. Everything else is derivative.
 *
 * This module:
 * 1. Clusters evidence by probable root source
 * 2. Detects citation chains (A cites B cites C)
 * 3. Detects citation loops (A ← B ← C ← A)
 * 4. Computes diversity score: effective independent sources / total sources
 * 5. Feeds back into Bayesian inference (derivative evidence gets discounted)
 */

export class CitationDiversityAnalyzer {

  analyze(evidence) {
    if (evidence.length === 0) {
      return { diversity: 0, clusters: {}, loops: [], rootSources: 0, derivativeSources: 0 };
    }

    // Step 1: Cluster evidence by probable root source
    const clusters = this._clusterByRoot(evidence);

    // Step 2: Detect citation loops
    const loops = this._detectLoops(evidence);

    // Step 3: Compute diversity score
    const rootCount = Object.keys(clusters).length;
    const totalCount = evidence.length;
    const diversity = rootCount / Math.max(1, totalCount);

    // Step 4: Mark each evidence with its cluster info
    for (const e of evidence) {
      const root = this._findRoot(e, evidence);
      e.rootSource = root;
      e._citationCluster = clusters[root]?.length || 1;
    }

    return {
      diversity: Math.round(diversity * 1000) / 1000,
      clusters,
      clusterSizes: Object.fromEntries(
        Object.entries(clusters).map(([root, items]) => [root, items.length])
      ),
      loops,
      rootSources: rootCount,
      derivativeSources: totalCount - rootCount,
      totalEvidence: totalCount,
    };
  }

  _clusterByRoot(evidence) {
    const clusters = {};

    for (const e of evidence) {
      const root = this._findRoot(e, evidence);
      if (!clusters[root]) clusters[root] = [];
      clusters[root].push(e.id);
    }

    return clusters;
  }

  _findRoot(e, allEvidence) {
    // Heuristic root detection:
    // 1. Primary documents (trust >= 0.9) are always roots
    if (e.trustWeight >= 0.9) return e.id;

    // 2. Check if this evidence's URL domain matches another evidence's source
    const url = e.sourceUrl || '';
    const domain = extractDomain(url);

    // 3. Check for citation signals in summary
    const citesPattern = /\b(according to|citing|reported by|per|via|source:)\s+(.+?)(?:\.|,|$)/i;
    const citesMatch = (e.summary || '').match(citesPattern);

    if (citesMatch) {
      const citedSource = citesMatch[2].toLowerCase();
      // Find the cited source in our evidence set
      const cited = allEvidence.find(other =>
        other.id !== e.id && (
          (other.sourceUrl || '').toLowerCase().includes(citedSource) ||
          (other.connectorId || '').toLowerCase().includes(citedSource) ||
          (other.summary || '').toLowerCase().includes(citedSource)
        )
      );
      if (cited) return this._findRoot(cited, allEvidence);
    }

    // 4. Cluster by domain — same domain = same source
    // news.google.com/article → the actual source newspaper
    if (domain) {
      const sameSource = allEvidence.find(other =>
        other.id !== e.id &&
        extractDomain(other.sourceUrl || '') === domain &&
        other.trustWeight > e.trustWeight
      );
      if (sameSource) return sameSource.id;
    }

    // 5. Cluster by connector — multiple results from same connector
    //    that have similar content are likely from the same root
    const sameConnector = allEvidence.filter(other =>
      other.id !== e.id &&
      other.connectorId === e.connectorId
    );

    if (sameConnector.length > 0) {
      const similar = sameConnector.find(other =>
        textSimilarity(e.summary || '', other.summary || '') > 0.7
      );
      if (similar && similar.trustWeight > e.trustWeight) {
        return similar.id;
      }
    }

    // No root found — this evidence IS a root
    return e.id;
  }

  _detectLoops(evidence) {
    const loops = [];
    const graph = new Map();

    // Build citation graph
    for (const e of evidence) {
      const root = e.rootSource;
      if (root && root !== e.id) {
        if (!graph.has(e.id)) graph.set(e.id, []);
        graph.get(e.id).push(root);
      }
    }

    // DFS for cycles
    const visited = new Set();
    const stack = new Set();

    const dfs = (node, path) => {
      if (stack.has(node)) {
        const loopStart = path.indexOf(node);
        if (loopStart >= 0) {
          loops.push(path.slice(loopStart).concat(node));
        }
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      stack.add(node);

      for (const neighbor of (graph.get(node) || [])) {
        dfs(neighbor, [...path, node]);
      }

      stack.delete(node);
    };

    for (const node of graph.keys()) {
      dfs(node, []);
    }

    return loops;
  }
}

// ─── Utility ──────────────────────────────────────────────

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function textSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.length / union.size; // Jaccard
}

export default CitationDiversityAnalyzer;
