#!/usr/bin/env node
/**
 * doubt — Deep Recursive Investigation Engine
 *
 * Takes a simple query, runs doubt's full pipeline, then recursively
 * branches into sub-investigations based on findings. Tree-structured
 * intelligence gathering that goes deeper as interesting things emerge.
 *
 * How it works:
 *   1. Root query → full doubt pipeline → evidence + findings + entities
 *   2. Extract expansion queries from:
 *      - Entities discovered
 *      - Themes identified
 *      - Key findings worth digging into
 *      - Coverage gaps (blind spots)
 *      - Counter-hypotheses (opposing views)
 *      - Contradictions (conflicting info)
 *   3. Run doubt on each expansion query (lighter depth at deeper levels)
 *   4. When interesting findings emerge → generate MORE sub-queries
 *   5. Continue branching to specified depth
 *   6. Auto-save EVERYTHING as it goes — crash-proof
 *   7. Generate comprehensive merged report
 *
 * Usage:
 *   node deep-investigate.js "Iran situation" --depth 2 --branches 5
 *   node deep-investigate.js "Apple antitrust" --depth 3 --branches 8
 *   node deep-investigate.js "climate policy" --depth 1 --branches 10
 *
 * Auto-saves to .doubt/deep/<timestamp>/ — nothing is ever lost
 */

import { Pipeline } from '../src/core/pipeline.js';
import { ReportGenerator } from '../src/report/generator.js';
import { Store } from '../src/store/db.js';
import registry from '../src/connectors/registry.js';
import { setLogLevel, log } from '../src/core/config.js';
import { resolve, join } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';

// ── Parse Arguments ──────────────────────────────────────────

const args = process.argv.slice(2);
const query = args.find(a => !a.startsWith('--'));

const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
}

if (!query) {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           doubt — Deep Recursive Investigation Engine            ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Takes a simple query, runs full investigation, then branches    ║
║  into sub-investigations based on findings. Follows the most     ║
║  interesting leads, going as deep as specified.                   ║
║                                                                  ║
║  Usage:                                                          ║
║    node deep-investigate.js "query" [options]                    ║
║                                                                  ║
║  Options:                                                        ║
║    --depth N       Recursion depth (default: 2)                  ║
║    --branches N    Branches per level (default: 5)               ║
║    --root-depth X  Pipeline depth for root: quick|standard|deep  ║
║    --output FILE   Save final report to file                     ║
║    --verbose       Debug output                                  ║
║    --quiet         Minimal output                                ║
║                                                                  ║
║  Auto-saves everything to .doubt/deep/<timestamp>/               ║
║  Nothing is ever lost — even if the process crashes.             ║
║                                                                  ║
║  Examples:                                                       ║
║    node deep-investigate.js "Iran situation March 2026"          ║
║    node deep-investigate.js "Apple antitrust" --depth 3          ║
║    node deep-investigate.js "climate policy" --branches 8        ║
╚══════════════════════════════════════════════════════════════════╝
`);
  process.exit(0);
}

// ── Configuration ────────────────────────────────────────────

const MAX_DEPTH = parseInt(flags.depth) || 2;
const MAX_BRANCHES = parseInt(flags.branches) || 5;
const ROOT_DEPTH = flags['root-depth'] || 'deep';
const OUTPUT_PATH = flags.output || null;

if (flags.verbose) setLogLevel('debug');
if (flags.quiet) setLogLevel('warn');

// ── Auto-save Setup ─────────────────────────────────────────

const dbDir = resolve(process.cwd(), '.doubt');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const deepDir = resolve(dbDir, 'deep', timestamp);
mkdirSync(deepDir, { recursive: true });

const stateFile = resolve(deepDir, 'state.json');
const reportFile = resolve(deepDir, 'report.md');

// ── Global State ─────────────────────────────────────────────

const STATE = {
  query,
  startTime: new Date().toISOString(),
  maxDepth: MAX_DEPTH,
  maxBranches: MAX_BRANCHES,
  rootDepth: ROOT_DEPTH,
  saveDir: deepDir,
  tree: null,
  allEvidence: [],
  allEntities: [],
  allFindings: [],
  branchCount: 0,
  totalEvidenceCount: 0,
  completedBranches: [],
  status: 'running',
  endTime: null,
  wallTimeMs: 0,
};

function saveState() {
  try {
    // Save lightweight state (no evidence blobs — those go in branch files)
    const lightweight = {
      ...STATE,
      allEvidence: `[${STATE.allEvidence.length} items — see branch files]`,
      allEntities: STATE.allEntities.slice(0, 100),
      allFindings: STATE.allFindings.slice(0, 50),
    };
    writeFileSync(stateFile, JSON.stringify(lightweight, null, 2));
  } catch (e) {
    console.error(`  [autosave] State save failed: ${e.message}`);
  }
}

function saveBranch(nodeId, data) {
  try {
    const branchFile = resolve(deepDir, `branch_${nodeId}.json`);
    writeFileSync(branchFile, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`  [autosave] Branch save failed: ${e.message}`);
  }
}

function saveReport(report) {
  try {
    writeFileSync(reportFile, report);
    if (OUTPUT_PATH) writeFileSync(OUTPUT_PATH, report);
  } catch (e) {
    console.error(`  [autosave] Report save failed: ${e.message}`);
  }
}

// ── Tree Node ────────────────────────────────────────────────

function createNode(q, depth, parent = null) {
  return {
    id: `d${depth}_b${STATE.branchCount++}`,
    query: q,
    depth,
    parent: parent?.id || null,
    status: 'pending',
    evidenceCount: 0,
    confidence: 0,
    keyFindings: [],
    entities: [],
    themes: [],
    coverageGaps: [],
    expansionQueries: [],
    children: [],
    startTime: null,
    endTime: null,
    wallTimeMs: 0,
    error: null,
  };
}

// ── Query Expansion Engine ───────────────────────────────────
//
// This is the brain of the recursive branching system.
// Given an investigation result, it generates the best follow-up queries.

function extractExpansionQueries(investigation, node, maxQueries) {
  const queries = [];
  const seen = new Set();

  // Normalize the original query for dedup
  const rootWords = new Set(node.query.toLowerCase().split(/\s+/));

  const addQuery = (q, source, priority = 5) => {
    if (!q || typeof q !== 'string') return;
    q = q.trim();
    if (q.length < 10 || q.length > 200) return;
    const norm = q.toLowerCase();
    if (seen.has(norm)) return;

    // Skip if it's basically the same as the parent query
    const words = new Set(norm.split(/\s+/));
    const overlap = [...words].filter(w => rootWords.has(w)).length / Math.max(words.size, 1);
    if (overlap > 0.8) return;

    seen.add(norm);
    queries.push({ query: q, source, priority });
  };

  // === 1. Entity-based expansions ===
  // Entities discovered in the investigation → dig into each one
  const entities = investigation.entities || [];
  for (const entity of entities.slice(0, 15)) {
    const name = entity.name || entity.text || (typeof entity === 'string' ? entity : null);
    if (!name || name.length < 3) continue;
    // Skip generic/stopword entities
    if (name.length < 4 || /^(the|this|that|they|their|which|what|when|where|how|and|but|for|with|from)$/i.test(name)) continue;

    // Contextual entity query
    addQuery(`${name} latest developments March 2026`, 'entity', 7);
    addQuery(`${name} investigation background`, 'entity', 5);
  }

  // === 2. Theme-based expansions ===
  const synthesis = investigation.synthesis || {};
  const themes = synthesis.themes || [];
  for (const theme of themes.slice(0, 5)) {
    const text = theme.name || theme.label || (typeof theme === 'string' ? theme : null);
    if (!text || text.length < 5) continue;
    addQuery(`${text} evidence analysis 2026`, 'theme', 6);
  }

  // === 3. Key finding expansions — dig deeper into most interesting results ===
  const findings = synthesis.keyFindings || [];
  for (const finding of findings.slice(0, 8)) {
    const text = finding.text || finding.summary || (typeof finding === 'string' ? finding : null);
    if (!text || text.length < 15) continue;

    // Extract a focused query from the finding
    const short = text.slice(0, 120).replace(/[.!?]+$/, '');
    addQuery(short, 'finding', 8);
  }

  // === 4. Fact verification — verify specific claims found ===
  const facts = investigation.facts || [];
  for (const fact of facts.slice(0, 5)) {
    const text = fact.text || fact.statement || (typeof fact === 'string' ? fact : null);
    if (!text || text.length < 10) continue;
    addQuery(`verify ${text.slice(0, 100)}`, 'fact-check', 6);
  }

  // === 5. Coverage gap filling — investigate blind spots ===
  const gaps = investigation.coverageGaps?.gaps || [];
  for (const gap of gaps.slice(0, 5)) {
    const desc = gap.description || gap.domain || (typeof gap === 'string' ? gap : null);
    if (!desc || desc.length < 5) continue;

    // Build a gap-filling query
    const rootTopic = node.query.split(/[,;]/).shift().trim().slice(0, 50);
    addQuery(`${rootTopic} ${desc}`, 'gap-fill', 7);
  }

  // === 6. Counter-hypothesis expansion — explore opposing views ===
  const counterHypotheses = investigation.counterHypotheses || [];
  for (const ch of counterHypotheses.slice(0, 4)) {
    const text = ch.text || ch.hypothesis || (typeof ch === 'string' ? ch : null);
    if (!text || text.length < 10) continue;
    addQuery(text.slice(0, 150), 'counter-hypothesis', 4);
  }

  // === 7. Contradiction exploration — dig into conflicting info ===
  const contradictions = investigation.contradictions || [];
  for (const c of contradictions.slice(0, 3)) {
    const text = c.description || c.summary || (typeof c === 'string' ? c : null);
    if (!text) continue;
    addQuery(`${text.slice(0, 100)} evidence`, 'contradiction', 9);
  }

  // === 8. LLM synthesis insights — follow up on patterns ===
  if (synthesis.llm?.missingAngles) {
    for (const angle of synthesis.llm.missingAngles.slice(0, 3)) {
      if (typeof angle === 'string' && angle.length > 10) {
        addQuery(angle.slice(0, 150), 'llm-angle', 7);
      }
    }
  }

  // Sort by priority (highest first) and return top N
  queries.sort((a, b) => b.priority - a.priority);
  return queries.slice(0, maxQueries).map(q => q.query);
}

// ── Node Investigation ───────────────────────────────────────

async function investigateNode(node, pipeline, store) {
  node.status = 'running';
  node.startTime = new Date().toISOString();

  const indent = '  '.repeat(node.depth);
  const label = node.depth === 0 ? 'ROOT' : `BRANCH ${node.id}`;
  const divider = '─'.repeat(Math.max(40 - node.depth * 2, 10));

  console.error(`\n${indent}┌${divider}`);
  console.error(`${indent}│ ${label}`);
  console.error(`${indent}│ Query: "${node.query.slice(0, 80)}"`);
  console.error(`${indent}│ Depth: ${node.depth}/${MAX_DEPTH}`);
  console.error(`${indent}├${divider}`);

  // Pipeline depth scales with tree depth
  const pipelineDepth = node.depth === 0 ? ROOT_DEPTH :
                         node.depth === 1 ? 'standard' : 'quick';

  // Auto-save directory for this node
  const nodeAutosave = resolve(deepDir, node.id);
  mkdirSync(nodeAutosave, { recursive: true });

  // Pipeline options — deeper tree nodes get lighter investigation
  const options = {
    depth: pipelineDepth,
    autosaveDir: nodeAutosave,
    sources: 'all',
    maxSources: node.depth === 0 ? 100 : node.depth === 1 ? 40 : 20,
  };

  try {
    const investigation = await pipeline.investigate(node.query, options);

    // Record node results
    node.evidenceCount = investigation.evidence?.length || 0;
    node.confidence = investigation.confidence || 0;
    node.status = investigation.status || 'complete';

    // Extract key data for the tree
    node.keyFindings = (investigation.synthesis?.keyFindings || [])
      .slice(0, 10)
      .map(f => ({
        text: f.text || f.summary || (typeof f === 'string' ? f : ''),
        confidence: f.confidence,
      }));

    node.entities = (investigation.entities || [])
      .slice(0, 20)
      .map(e => ({
        name: e.name || e.text || (typeof e === 'string' ? e : ''),
        type: e.type,
      }));

    node.themes = (investigation.synthesis?.themes || [])
      .slice(0, 10)
      .map(t => ({
        name: t.name || t.label || (typeof t === 'string' ? t : ''),
      }));

    node.coverageGaps = (investigation.coverageGaps?.gaps || [])
      .slice(0, 5)
      .map(g => g.description || g.domain || '');

    // Merge into global evidence pool
    if (investigation.evidence) {
      STATE.allEvidence.push(...investigation.evidence);
      STATE.totalEvidenceCount += investigation.evidence.length;
    }
    if (investigation.entities) {
      STATE.allEntities.push(...investigation.entities);
    }
    if (node.keyFindings.length > 0) {
      STATE.allFindings.push(...node.keyFindings);
    }

    console.error(`${indent}│ Evidence: ${node.evidenceCount} | Confidence: ${(node.confidence * 100).toFixed(1)}%`);
    console.error(`${indent}│ Findings: ${node.keyFindings.length} | Entities: ${node.entities.length} | Themes: ${node.themes.length}`);

    // Save branch data (includes full evidence for this branch)
    saveBranch(node.id, {
      node: { ...node, children: node.children.map(c => c.id) },
      evidenceCount: investigation.evidence?.length || 0,
      evidence: investigation.evidence?.map(e => ({
        summary: e.summary,
        sourceUrl: e.sourceUrl,
        sourceLabel: e.sourceLabel,
        connectorId: e.connectorId,
        trustTier: e.trustTier,
        trustWeight: e.trustWeight,
        stance: e.stance,
        date: e.date,
      })),
      facts: investigation.facts?.slice(0, 20),
      synthesis: investigation.synthesis,
      coverageGaps: investigation.coverageGaps,
      contradictions: investigation.contradictions?.slice(0, 10),
      counterHypotheses: investigation.counterHypotheses?.slice(0, 10),
    });

    // Generate intermediate report after each branch
    const intermediateReport = generateReport(STATE.tree);
    saveReport(intermediateReport);

    // ── BRANCHING: Generate expansion queries if not at max depth ──
    if (node.depth < MAX_DEPTH) {
      const expansionQueries = extractExpansionQueries(investigation, node, MAX_BRANCHES);
      node.expansionQueries = expansionQueries;

      if (expansionQueries.length > 0) {
        console.error(`${indent}│`);
        console.error(`${indent}│ Branching into ${expansionQueries.length} sub-investigations:`);
        for (let i = 0; i < expansionQueries.length; i++) {
          console.error(`${indent}│   ${i + 1}. "${expansionQueries[i].slice(0, 70)}"`);
        }

        for (const expandQuery of expansionQueries) {
          const childNode = createNode(expandQuery, node.depth + 1, node);
          node.children.push(childNode);

          // Save state before each child investigation
          saveState();

          await investigateNode(childNode, pipeline, store);
        }
      } else {
        console.error(`${indent}│ Leaf node (no expansion queries generated)`);
      }
    } else {
      console.error(`${indent}│ Max depth reached — not branching further`);
    }

    node.endTime = new Date().toISOString();
    node.wallTimeMs = new Date(node.endTime) - new Date(node.startTime);
    STATE.completedBranches.push(node.id);

    console.error(`${indent}└${divider} Done (${(node.wallTimeMs / 1000).toFixed(1)}s)`);

  } catch (err) {
    node.status = 'error';
    node.error = err.message;
    node.endTime = new Date().toISOString();
    node.wallTimeMs = new Date(node.endTime) - new Date(node.startTime);

    console.error(`${indent}│ ERROR: ${err.message}`);
    console.error(`${indent}└${divider} Failed (${(node.wallTimeMs / 1000).toFixed(1)}s)`);
  }

  // Save state after every node
  saveState();
}

// ── Report Generation ────────────────────────────────────────

function generateReport(tree) {
  if (!tree) return '# Deep Investigation — No Results Yet\n';

  const duration = ((Date.now() - new Date(STATE.startTime).getTime()) / 1000).toFixed(0);

  let report = '';

  report += `# Deep Investigation: ${STATE.query}\n\n`;
  report += `> Auto-generated recursive investigation report\n\n`;
  report += `| Metric | Value |\n|--------|-------|\n`;
  report += `| Generated | ${new Date().toISOString()} |\n`;
  report += `| Recursion Depth | ${MAX_DEPTH} |\n`;
  report += `| Max Branches | ${MAX_BRANCHES} per level |\n`;
  report += `| Root Pipeline Depth | ${ROOT_DEPTH} |\n`;
  report += `| Total Evidence | ${STATE.totalEvidenceCount} items |\n`;
  report += `| Total Branches | ${STATE.branchCount} |\n`;
  report += `| Completed | ${STATE.completedBranches.length} |\n`;
  report += `| Duration | ${duration}s |\n`;
  report += `| Status | ${STATE.status} |\n\n`;

  report += `---\n\n`;

  // === Investigation Tree ===
  report += `## Investigation Tree\n\n`;
  report += renderTreeNode(tree, 0);
  report += `\n---\n\n`;

  // === Merged Key Findings ===
  report += `## Key Findings (All Branches)\n\n`;
  const uniqueFindings = deduplicateFindings(STATE.allFindings);
  if (uniqueFindings.length === 0) {
    report += `*No findings yet*\n\n`;
  } else {
    for (let i = 0; i < uniqueFindings.length; i++) {
      report += `${i + 1}. ${uniqueFindings[i].text || uniqueFindings[i]}\n`;
    }
    report += '\n';
  }

  report += `---\n\n`;

  // === Entity Map ===
  report += `## Entities Discovered\n\n`;
  const entityMap = new Map();
  for (const e of STATE.allEntities) {
    const name = e.name || e.text || (typeof e === 'string' ? e : null);
    if (name && !entityMap.has(name.toLowerCase())) {
      entityMap.set(name.toLowerCase(), { name, type: e.type || 'unknown' });
    }
  }

  if (entityMap.size === 0) {
    report += `*No entities yet*\n\n`;
  } else {
    // Group by type
    const byType = {};
    for (const [_, entity] of entityMap) {
      if (!byType[entity.type]) byType[entity.type] = [];
      byType[entity.type].push(entity.name);
    }
    for (const [type, names] of Object.entries(byType).sort()) {
      report += `**${type}**: ${names.join(', ')}\n\n`;
    }
  }

  report += `---\n\n`;

  // === Coverage Gaps (from all branches) ===
  const allGaps = [];
  collectGaps(tree, allGaps);
  if (allGaps.length > 0) {
    report += `## Coverage Gaps Detected\n\n`;
    const uniqueGaps = [...new Set(allGaps)];
    for (const gap of uniqueGaps) {
      report += `- ${gap}\n`;
    }
    report += '\n---\n\n';
  }

  // === Auto-save Info ===
  report += `## Data Files\n\n`;
  report += `All raw data auto-saved to:\n\`\`\`\n${deepDir}\n\`\`\`\n\n`;
  report += `- \`state.json\` — full tree state\n`;
  report += `- \`branch_*.json\` — per-branch evidence + analysis\n`;
  report += `- \`<node_id>/\` — per-node pipeline autosave checkpoints\n`;
  report += `- \`report.md\` — this report (updated after each branch)\n`;

  return report;
}

function renderTreeNode(node, indent) {
  const prefix = '  '.repeat(indent);
  const statusIcon = {
    supported: '\u2705', contradicted: '\u274c', contested: '\u26a0\ufe0f',
    insufficient: '\u2753', error: '\ud83d\udca5', pending: '\u23f3',
    running: '\ud83d\udd04', complete: '\u2705',
  }[node.status] || '\u2753';

  let text = `${prefix}${statusIcon} **${node.id}** — "${node.query.slice(0, 80)}"\n`;
  text += `${prefix}   Evidence: ${node.evidenceCount} | `;
  text += `Confidence: ${(node.confidence * 100).toFixed(1)}% | `;
  text += `Time: ${((node.wallTimeMs || 0) / 1000).toFixed(1)}s\n`;

  if (node.keyFindings?.length > 0) {
    text += `${prefix}   Top findings:\n`;
    for (const f of node.keyFindings.slice(0, 3)) {
      const ft = f.text || f;
      text += `${prefix}   - ${(typeof ft === 'string' ? ft : '').slice(0, 120)}\n`;
    }
  }

  if (node.error) {
    text += `${prefix}   Error: ${node.error}\n`;
  }

  text += '\n';

  for (const child of node.children || []) {
    text += renderTreeNode(child, indent + 1);
  }

  return text;
}

function collectGaps(node, gaps) {
  if (node.coverageGaps) {
    for (const g of node.coverageGaps) {
      if (typeof g === 'string' && g.length > 0) gaps.push(g);
    }
  }
  for (const child of node.children || []) {
    collectGaps(child, gaps);
  }
}

function deduplicateFindings(findings) {
  const seen = new Set();
  return findings.filter(f => {
    const text = ((f.text || f || '')).toString().toLowerCase().slice(0, 80);
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.error(`
╔══════════════════════════════════════════════════════════════════╗
║           doubt — Deep Recursive Investigation                   ║
╠══════════════════════════════════════════════════════════════════╣
║  Query:    "${query.slice(0, 50)}"
║  Depth:    ${MAX_DEPTH} levels (root: ${ROOT_DEPTH})
║  Branches: ${MAX_BRANCHES} per level
║  Max runs: ~${1 + MAX_BRANCHES + (MAX_DEPTH >= 2 ? MAX_BRANCHES * MAX_BRANCHES : 0)} investigations
║  Save dir: ${deepDir}
╚══════════════════════════════════════════════════════════════════╝
`);

  // Initialize database
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  const store = new Store(resolve(dbDir, 'doubt.db'));
  await store.init();

  // Load all connectors once
  await registry.loadAll();
  const allConnectors = registry.all();
  console.error(`  Loaded ${allConnectors.length} connectors\n`);

  // Create pipeline (reused across all nodes)
  const pipeline = new Pipeline({
    onProgress: (event) => {
      if (flags.quiet) return;
      const ts = new Date().toISOString().slice(11, 19);
      process.stderr.write(`  [${ts}] [${event.phase}] ${event.message}\n`);
    },
  });
  pipeline.setStore(store);

  // Build root node
  const root = createNode(query, 0);
  STATE.tree = root;
  saveState();

  // Run recursive investigation
  await investigateNode(root, pipeline, store);

  // Finalize
  STATE.status = 'complete';
  STATE.endTime = new Date().toISOString();
  STATE.wallTimeMs = Date.now() - new Date(STATE.startTime).getTime();
  saveState();

  // Generate final report
  const finalReport = generateReport(root);
  saveReport(finalReport);

  // Print report to stdout
  console.log(finalReport);

  console.error(`
╔══════════════════════════════════════════════════════════════════╗
║  INVESTIGATION COMPLETE                                          ║
╠══════════════════════════════════════════════════════════════════╣
║  Total evidence:  ${String(STATE.totalEvidenceCount).padEnd(43)}║
║  Total branches:  ${String(STATE.branchCount).padEnd(43)}║
║  Duration:        ${String(((STATE.wallTimeMs) / 1000).toFixed(0) + 's').padEnd(43)}║
║  Report:          ${reportFile.slice(-43).padEnd(43)}║
╚══════════════════════════════════════════════════════════════════╝
`);
}

main().catch(err => {
  STATE.status = 'error';
  STATE.error = err.message;
  saveState();

  // Still generate whatever report we can
  if (STATE.tree) {
    const partialReport = generateReport(STATE.tree);
    saveReport(partialReport);
    console.error(`  Partial report saved to: ${reportFile}`);
  }

  console.error(`\n  FATAL: ${err.message}\n`);
  process.exit(1);
});
