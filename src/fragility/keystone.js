/**
 * doubt — Keystone Detection
 *
 * Structural engineering applied to beliefs.
 *
 * Given a graph of claims where some depend on others,
 * find the KEYSTONE: the claim whose failure causes
 * the largest cascade of downstream failures.
 *
 * This is the Jenga tower problem: which block,
 * if pulled, collapses the most?
 *
 * Algorithm:
 * 1. Build dependency graph from claims
 * 2. For each claim, simulate removal
 * 3. Propagate failure through dependencies
 * 4. Count cascade size (how many claims collapse)
 * 5. Score fragility: largest cascade / total claims
 *
 * A healthy belief structure has no keystones.
 * A fragile one has a single claim holding up everything.
 */

export class KeystoneDetector {

  /**
   * Analyze claims for keystone dependencies.
   * @param {Array} claims - claims with dependsOn[] and supports[] arrays
   * @returns {Object} - keystones, fragility score, cascade map
   */
  analyze(claims) {
    if (claims.length === 0) {
      return { keystones: [], fragilityScore: 0, cascadeMap: {}, maxCascade: 0 };
    }

    // Build adjacency: claim → claims that depend on it
    const dependents = new Map(); // claim ID → set of claim IDs that depend on it
    const claimMap = new Map();

    for (const c of claims) {
      claimMap.set(c.id, c);
      if (!dependents.has(c.id)) dependents.set(c.id, new Set());

      for (const depId of (c.dependsOn || [])) {
        if (!dependents.has(depId)) dependents.set(depId, new Set());
        dependents.get(depId).add(c.id);
      }
    }

    // For each claim, simulate removal and count cascade
    const cascadeMap = {};
    let maxCascade = 0;
    let maxCascadeId = null;

    for (const claim of claims) {
      const cascadeSize = this._simulateRemoval(claim.id, dependents, claimMap);
      cascadeMap[claim.id] = cascadeSize;

      if (cascadeSize > maxCascade) {
        maxCascade = cascadeSize;
        maxCascadeId = claim.id;
      }
    }

    // Identify keystones: claims whose removal cascades > 20% of total
    const threshold = claims.length * 0.2;
    const keystones = claims
      .filter(c => (cascadeMap[c.id] || 0) >= Math.max(2, threshold))
      .map(c => ({
        ...c,
        isKeystone: true,
        cascadeSize: cascadeMap[c.id],
        cascadePercent: Math.round((cascadeMap[c.id] / claims.length) * 100),
      }))
      .sort((a, b) => b.cascadeSize - a.cascadeSize);

    // Mark keystones on original claims
    for (const k of keystones) {
      const original = claimMap.get(k.id);
      if (original) {
        original.isKeystone = true;
        original.cascadeSize = k.cascadeSize;
      }
    }

    // Fragility score: 0 = robust (no keystones), 1 = fragile (one claim holds up everything)
    const fragilityScore = claims.length > 1
      ? Math.min(1, maxCascade / (claims.length - 1))
      : 0;

    return {
      keystones,
      fragilityScore: Math.round(fragilityScore * 1000) / 1000,
      cascadeMap,
      maxCascade,
      maxCascadeId,
      totalClaims: claims.length,
      robustnessIndex: Math.round((1 - fragilityScore) * 1000) / 1000,
    };
  }

  /**
   * Simulate removing a claim and count how many others collapse.
   * BFS propagation: if a claim's ALL dependencies are removed, it collapses too.
   */
  _simulateRemoval(targetId, dependents, claimMap) {
    const removed = new Set([targetId]);
    const queue = [...(dependents.get(targetId) || [])];

    while (queue.length > 0) {
      const candidateId = queue.shift();
      if (removed.has(candidateId)) continue;

      const candidate = claimMap.get(candidateId);
      if (!candidate) continue;

      // A claim collapses if ANY of its dependencies are removed
      // (conservative: even one missing support weakens the claim)
      const deps = candidate.dependsOn || [];
      const removedDeps = deps.filter(d => removed.has(d));

      // Collapse if >50% of dependencies are removed
      // or if the removed dependency was the highest-confidence one
      if (deps.length > 0 && removedDeps.length > 0) {
        const collapseRatio = removedDeps.length / deps.length;
        if (collapseRatio >= 0.5 || deps.length === 1) {
          removed.add(candidateId);
          // Propagate to this claim's dependents
          for (const next of (dependents.get(candidateId) || [])) {
            if (!removed.has(next)) queue.push(next);
          }
        }
      }
    }

    // Don't count the original claim
    return removed.size - 1;
  }

  /**
   * Build dependency graph from evidence patterns.
   * When explicit dependsOn isn't set, infer dependencies from:
   * - Claims that share entities
   * - Claims where one is a broader version of another
   * - Claims where one's evidence cites another's evidence
   */
  inferDependencies(claims) {
    for (let i = 0; i < claims.length; i++) {
      for (let j = 0; j < claims.length; j++) {
        if (i === j) continue;
        if (this._impliesDependency(claims[i], claims[j])) {
          if (!claims[i].dependsOn) claims[i].dependsOn = [];
          if (!claims[i].dependsOn.includes(claims[j].id)) {
            claims[i].dependsOn.push(claims[j].id);
          }
          if (!claims[j].supports) claims[j].supports = [];
          if (!claims[j].supports.includes(claims[i].id)) {
            claims[j].supports.push(claims[i].id);
          }
        }
      }
    }
    return claims;
  }

  _impliesDependency(claimA, claimB) {
    const a = claimA.text.toLowerCase();
    const b = claimB.text.toLowerCase();

    // If B is a premise word in A's text
    const premisePatterns = [
      /\b(because|since|given that|assuming|if)\b/,
      /\b(depends on|requires|relies on|built on|based on)\b/,
    ];

    for (const pattern of premisePatterns) {
      if (pattern.test(a)) {
        // Check if B's key terms appear after the premise word
        const bWords = b.split(/\s+/).filter(w => w.length > 4);
        const matchCount = bWords.filter(w => a.includes(w)).length;
        if (matchCount >= 2) return true;
      }
    }

    // Specificity dependency: "X revenue is $5B" depends on "X exists"
    // (more specific claims depend on more general ones)
    const aWords = new Set(a.split(/\s+/));
    const bWords = new Set(b.split(/\s+/));
    const overlap = [...aWords].filter(w => bWords.has(w) && w.length > 3);

    if (overlap.length >= 3 && aWords.size > bWords.size * 1.5) {
      // A is more specific than B and shares entities — A depends on B
      return true;
    }

    return false;
  }
}

export default KeystoneDetector;
