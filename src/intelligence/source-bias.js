/**
 * doubt — Source Bias Registry
 *
 * Tracks ideological lean and bias magnitude for known news outlets.
 * Used by SynthesisEngine to flag when an investigation's evidence
 * skews heavily toward one end of the political spectrum.
 *
 * Lean: 'left' | 'center-left' | 'center' | 'center-right' | 'right'
 * Magnitude: 0.0 (neutral) → 1.0 (maximally partisan)
 *
 * Ratings sourced from AllSides.com and Ad Fontes Media bias charts
 * (both use panel-based methodology with left/center/right raters).
 *
 * This is NOT used to suppress evidence. It is used to:
 *   1. Warn when >70% of evidence comes from one side
 *   2. Surface diversity gaps so the investigator can seek balance
 *   3. Compute an ideological diversity score (0–1) alongside source diversity
 */

export const OUTLET_BIAS = {
  // ── Center / Wire Services ──────────────────────────────────────────────
  'apnews.com':             { lean: 'center',       magnitude: 0.05 },
  'reuters.com':            { lean: 'center',       magnitude: 0.05 },
  'pbs.org':                { lean: 'center',       magnitude: 0.10 },
  'bbc.com':                { lean: 'center',       magnitude: 0.15 },
  'bbc.co.uk':              { lean: 'center',       magnitude: 0.15 },
  'npr.org':                { lean: 'center-left',  magnitude: 0.30 },
  'c-span.org':             { lean: 'center',       magnitude: 0.00 },
  'thehill.com':            { lean: 'center',       magnitude: 0.20 },
  'axios.com':              { lean: 'center',       magnitude: 0.15 },

  // ── Center-Left ─────────────────────────────────────────────────────────
  'nytimes.com':            { lean: 'center-left',  magnitude: 0.35 },
  'washingtonpost.com':     { lean: 'center-left',  magnitude: 0.40 },
  'theguardian.com':        { lean: 'center-left',  magnitude: 0.45 },
  'politico.com':           { lean: 'center-left',  magnitude: 0.30 },
  'time.com':               { lean: 'center-left',  magnitude: 0.30 },
  'latimes.com':            { lean: 'center-left',  magnitude: 0.40 },
  'usatoday.com':           { lean: 'center-left',  magnitude: 0.25 },
  'nbcnews.com':            { lean: 'center-left',  magnitude: 0.35 },
  'cbsnews.com':            { lean: 'center-left',  magnitude: 0.35 },
  'abcnews.go.com':         { lean: 'center-left',  magnitude: 0.35 },
  'cnn.com':                { lean: 'center-left',  magnitude: 0.45 },
  'msnbc.com':              { lean: 'left',          magnitude: 0.75 },
  'huffpost.com':           { lean: 'left',          magnitude: 0.70 },
  'theatlantic.com':        { lean: 'center-left',  magnitude: 0.40 },
  'wired.com':              { lean: 'center-left',  magnitude: 0.30 },
  'slate.com':              { lean: 'left',          magnitude: 0.60 },
  'salon.com':              { lean: 'left',          magnitude: 0.70 },

  // ── Left ────────────────────────────────────────────────────────────────
  'thenation.com':          { lean: 'left',          magnitude: 0.80 },
  'jacobin.com':            { lean: 'left',          magnitude: 0.90 },
  'motherjones.com':        { lean: 'left',          magnitude: 0.75 },
  'democracynow.org':       { lean: 'left',          magnitude: 0.80 },
  'vox.com':                { lean: 'left',          magnitude: 0.60 },
  'vice.com':               { lean: 'left',          magnitude: 0.55 },

  // ── Center-Right ────────────────────────────────────────────────────────
  'wsj.com':                { lean: 'center-right',  magnitude: 0.40 },
  'economist.com':          { lean: 'center-right',  magnitude: 0.30 },
  'nationalreview.com':     { lean: 'center-right',  magnitude: 0.55 },
  'weeklystandard.com':     { lean: 'center-right',  magnitude: 0.55 },
  'reason.com':             { lean: 'center-right',  magnitude: 0.50 },
  'forbes.com':             { lean: 'center-right',  magnitude: 0.25 },
  'marketwatch.com':        { lean: 'center-right',  magnitude: 0.20 },
  'bloombergnews.com':      { lean: 'center',         magnitude: 0.15 },
  'bloomberg.com':          { lean: 'center',         magnitude: 0.15 },
  'businessinsider.com':    { lean: 'center-left',   magnitude: 0.30 },
  'newsweek.com':           { lean: 'center',         magnitude: 0.20 },

  // ── Right ───────────────────────────────────────────────────────────────
  'foxnews.com':            { lean: 'right',          magnitude: 0.75 },
  'nypost.com':             { lean: 'right',          magnitude: 0.65 },
  'washingtontimes.com':    { lean: 'right',          magnitude: 0.65 },
  'theblaze.com':           { lean: 'right',          magnitude: 0.80 },
  'townhall.com':           { lean: 'right',          magnitude: 0.80 },
  'dailycaller.com':        { lean: 'right',          magnitude: 0.75 },
  'dailywire.com':          { lean: 'right',          magnitude: 0.85 },
  'breitbart.com':          { lean: 'right',          magnitude: 1.00 },
  'oann.com':               { lean: 'right',          magnitude: 0.95 },
  'newsmax.com':            { lean: 'right',          magnitude: 0.85 },
  'epochtimes.com':         { lean: 'right',          magnitude: 0.80 },

  // ── Tech / Specialty ────────────────────────────────────────────────────
  'techcrunch.com':         { lean: 'center-left',   magnitude: 0.20 },
  'arstechnica.com':        { lean: 'center-left',   magnitude: 0.25 },
  'theverge.com':           { lean: 'center-left',   magnitude: 0.25 },
  'engadget.com':           { lean: 'center-left',   magnitude: 0.20 },
  'scientificamerican.com': { lean: 'center',         magnitude: 0.10 },
  'nature.com':             { lean: 'center',         magnitude: 0.05 },
  'science.org':            { lean: 'center',         magnitude: 0.05 },
  'propublica.org':         { lean: 'center-left',   magnitude: 0.35 },
  'intercept.com':          { lean: 'left',           magnitude: 0.70 },

  // ── International ───────────────────────────────────────────────────────
  'dw.com':                 { lean: 'center',         magnitude: 0.15 },
  'aljazeera.com':          { lean: 'center-left',   magnitude: 0.30 },
  'rt.com':                 { lean: 'right',          magnitude: 0.95 }, // state media
  'tass.com':               { lean: 'right',          magnitude: 1.00 }, // state media
  'xinhuanet.com':          { lean: 'right',          magnitude: 1.00 }, // state media
  'chinadaily.com':         { lean: 'right',          magnitude: 1.00 }, // state media
  'france24.com':           { lean: 'center',         magnitude: 0.15 },
  'lemonde.fr':             { lean: 'center-left',   magnitude: 0.35 },
  'spiegel.de':             { lean: 'center-left',   magnitude: 0.30 },
};

// Numerical lean scores for computing weighted averages
// Negative = left, Positive = right
const LEAN_SCORE = {
  'left':         -1.0,
  'center-left':  -0.5,
  'center':        0.0,
  'center-right':  0.5,
  'right':         1.0,
};

/**
 * Extract the root domain from a URL string.
 * "https://www.nytimes.com/article/..." → "nytimes.com"
 */
function extractDomain(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Look up bias data for a URL or domain.
 * Returns { lean, magnitude } or null if unknown.
 */
export function lookupOutletBias(urlOrDomain) {
  if (!urlOrDomain || typeof urlOrDomain !== 'string') return null;
  const domain = extractDomain(urlOrDomain) || urlOrDomain.replace(/^www\./, '');
  return OUTLET_BIAS[domain] ?? null;
}

/**
 * Assess the ideological diversity of an evidence set.
 *
 * Returns:
 *   {
 *     covered:        number of evidence items with known outlet bias,
 *     total:          total evidence count,
 *     coverageRatio:  0–1 (how many items we could classify),
 *     distribution: {
 *       left:         0–1 share,
 *       centerLeft:   0–1 share,
 *       center:       0–1 share,
 *       centerRight:  0–1 share,
 *       right:        0–1 share,
 *     },
 *     weightedLean:   -1.0 (hard left) → +1.0 (hard right),
 *     diversityScore: 0–1 (1 = perfectly balanced, 0 = all one side),
 *     biasWarning:    boolean — true if skew > 70% one direction,
 *     warningText:    human-readable explanation or null,
 *     dominantLean:   'left'|'center-left'|'center'|'center-right'|'right'|null,
 *   }
 */
export function assessIdeologicalDiversity(evidence) {
  const counts = { left: 0, 'center-left': 0, center: 0, 'center-right': 0, right: 0 };
  let covered = 0;
  let weightedLeanSum = 0;

  for (const ev of evidence) {
    const url = ev.url || ev.source || '';
    const bias = lookupOutletBias(url);
    if (!bias) continue;
    counts[bias.lean] = (counts[bias.lean] || 0) + 1;
    weightedLeanSum += LEAN_SCORE[bias.lean] * bias.magnitude;
    covered++;
  }

  const total = evidence.length;
  const coverageRatio = total > 0 ? covered / total : 0;

  if (covered === 0) {
    return {
      covered: 0, total, coverageRatio: 0,
      distribution: { left: 0, centerLeft: 0, center: 0, centerRight: 0, right: 0 },
      weightedLean: 0,
      diversityScore: null,
      biasWarning: false,
      warningText: null,
      dominantLean: null,
    };
  }

  const dist = {
    left:        counts['left'] / covered,
    centerLeft:  counts['center-left'] / covered,
    center:      counts['center'] / covered,
    centerRight: counts['center-right'] / covered,
    right:       counts['right'] / covered,
  };

  const weightedLean = covered > 0 ? weightedLeanSum / covered : 0;

  // Shannon entropy over 5 lean buckets for diversity score
  const probs = Object.values(dist);
  let entropy = 0;
  for (const p of probs) {
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(5); // 5 buckets
  const diversityScore = entropy / maxEntropy; // 0–1

  // Bias warning: >70% of known sources lean the same direction
  // Collapse to 3 buckets: left (left + center-left), center, right (center-right + right)
  const leftShare  = dist.left + dist.centerLeft;
  const rightShare = dist.centerRight + dist.right;

  let biasWarning = false;
  let warningText = null;
  let dominantLean = null;

  if (leftShare > 0.70) {
    biasWarning = true;
    dominantLean = 'left';
    warningText = `⚠ BIAS ALERT: ${Math.round(leftShare * 100)}% of classifiable sources lean left/center-left. Consider adding right-leaning or center sources.`;
  } else if (rightShare > 0.70) {
    biasWarning = true;
    dominantLean = 'right';
    warningText = `⚠ BIAS ALERT: ${Math.round(rightShare * 100)}% of classifiable sources lean right/center-right. Consider adding left-leaning or center sources.`;
  } else if (dist.center > 0.60) {
    dominantLean = 'center';
  } else {
    dominantLean = weightedLean < -0.1 ? 'center-left'
                 : weightedLean > 0.1  ? 'center-right'
                 : 'center';
  }

  return {
    covered,
    total,
    coverageRatio,
    distribution: dist,
    weightedLean,
    diversityScore,
    biasWarning,
    warningText,
    dominantLean,
  };
}
