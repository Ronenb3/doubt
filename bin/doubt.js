#!/usr/bin/env node
/**
 * doubt — CLI
 *
 * Usage:
 *   doubt investigate "OpenAI is independent from Microsoft"
 *   doubt investigate "Tesla" --depth deep --sources sec_edgar,reddit,gdelt
 *   doubt sweep "Anthropic" --format json
 *   doubt connectors
 *   doubt history
 */

import { Pipeline } from '../src/core/pipeline.js';
import { ReportGenerator } from '../src/report/generator.js';
import { Store } from '../src/store/db.js';
import registry from '../src/connectors/registry.js';
import { setLogLevel, log } from '../src/core/config.js';
import { resolve } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const command = args[0];
const query = args[1];

// Parse flags
const flags = {};
for (let i = 2; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    flags[key] = args[i + 1] || true;
    if (typeof flags[key] === 'string') i++;
  }
}

if (flags.verbose) setLogLevel('debug');
if (flags.quiet) setLogLevel('warn');

async function main() {
  switch (command) {
    case 'investigate':
    case 'i':
      return await investigate();
    case 'sweep':
    case 's':
      return await sweep();
    case 'connectors':
    case 'c':
      return await listConnectors();
    case 'history':
    case 'h':
      return await history();
    case 'version':
    case '-v':
    case '--version':
      console.log('doubt 0.1.0');
      return;
    default:
      printUsage();
      return;
  }
}

async function investigate() {
  if (!query) {
    console.error('Usage: doubt investigate "claim or entity"');
    process.exit(1);
  }

  const dbDir = resolve(process.cwd(), '.doubt');
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

  // Auto-save directory — always enabled, crash-proof
  const autosaveDir = resolve(dbDir, 'autosave', Date.now().toString());
  mkdirSync(autosaveDir, { recursive: true });

  const store = new Store(resolve(dbDir, 'doubt.db'));
  await store.init();

  const liveFile = flags.live ? resolve(dbDir, 'live.json') : null;
  let lastPhase = null;
  let snapshotLog = [];

  const pipeline = new Pipeline({
    onProgress: (event) => {
      if (flags.quiet) return;

      if (flags.live) {
        // Print every message on its own line so you can read as it runs
        const ts = new Date().toISOString().slice(11, 19);
        const line = `  [${ts}] [${event.phase}] ${event.message}`;
        process.stderr.write(line + '\n');

        // On any progress, write a running snapshot so you can tail -f it
        const snap = {
          ts: new Date().toISOString(),
          phase: event.phase,
          message: event.message,
          vectors: event.vectors,
          log: snapshotLog,
        };
        snapshotLog.push({ ts: new Date().toISOString(), phase: event.phase, message: event.message });
        try { writeFileSync(liveFile, JSON.stringify(snap, null, 2)); } catch (_) {}
        lastPhase = event.phase;
      } else {
        const bar = event.status || '';
        process.stderr.write(`\r  [${event.phase}] ${bar} ${event.message}`.padEnd(100) + '\r');
      }
    },
  });
  pipeline.setStore(store);

  const options = {
    depth: flags.depth || 'standard',
    sources: flags.sources ? flags.sources.split(',') : 'all',
    maxSources: parseInt(flags['max-sources'] || '30'),
    autosaveDir,
  };

  console.error(`\n  doubt — investigating: "${query}"\n`);

  const investigation = await pipeline.investigate(query, options);

  console.error('\n');

  if (flags.format === 'json') {
    console.log(JSON.stringify(investigation, null, 2));
  } else {
    const report = new ReportGenerator();
    const markdown = report.generate(investigation);
    console.log(markdown);
  }

  // Save report to file
  const outputPath = flags.output || (flags.live ? resolve(dbDir, 'report.md') : null);
  if (outputPath) {
    const report = new ReportGenerator();
    writeFileSync(outputPath, report.generate(investigation));
    console.error(`  Report saved to ${outputPath}`);
  }

  // Also write final full snapshot when --live
  if (liveFile) {
    const finalSnap = {
      ts: new Date().toISOString(),
      phase: 'complete',
      status: investigation.status,
      confidence: investigation.confidence,
      verdict: investigation.verdict,
      vectors: investigation.epistemicVectors || {},
      evidenceCount: investigation.evidence?.length || 0,
      gateResults: investigation.gateResults || {},
      log: snapshotLog,
    };
    writeFileSync(liveFile, JSON.stringify(finalSnap, null, 2));
    console.error(`  Live snapshot: ${liveFile}`);
  }
}

async function sweep() {
  if (!query) {
    console.error('Usage: doubt sweep "target"');
    process.exit(1);
  }

  const pipeline = new Pipeline();

  console.error(`\n  doubt — sweeping: "${query}"\n`);

  const result = await pipeline.sweep(query, {
    maxSources: parseInt(flags['max-sources'] || '15'),
  });

  if (flags.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n# OSINT Sweep: ${query}`);
    console.log(`\n**Sources:** ${result.sourcesResponded}/${result.sourcesQueried} responded`);
    console.log(`**Evidence:** ${result.evidence.length} items\n`);

    // Group by connector
    const byConnector = {};
    for (const e of result.evidence) {
      if (!byConnector[e.connectorId]) byConnector[e.connectorId] = [];
      byConnector[e.connectorId].push(e);
    }

    for (const [connector, items] of Object.entries(byConnector)) {
      console.log(`\n## ${connector} (${items.length} results)\n`);
      for (const item of items.slice(0, 5)) {
        console.log(`- ${item.summary || 'No summary'}`);
        if (item.sourceUrl) console.log(`  ${item.sourceUrl}`);
      }
      if (items.length > 5) console.log(`  ... and ${items.length - 5} more`);
    }
  }
}

async function listConnectors() {
  await registry.loadAll();
  const connectors = registry.all();

  console.log(`\n  doubt — ${connectors.length} data sources\n`);

  // Group by domain
  const byDomain = {};
  for (const c of connectors) {
    for (const d of c.domains) {
      if (!byDomain[d]) byDomain[d] = [];
      byDomain[d].push(c);
    }
  }

  for (const [domain, items] of Object.entries(byDomain).sort()) {
    console.log(`  ${domain.toUpperCase()}`);
    for (const c of items) {
      const status = c.available ? '✅' : '🔑';
      console.log(`    ${status} ${c.id.padEnd(20)} ${c.name} (trust: ${c.trustTier})`);
    }
    console.log();
  }
}

async function history() {
  const dbPath = resolve(process.cwd(), '.doubt', 'doubt.db');
  if (!existsSync(dbPath)) {
    console.log('  No investigation history. Run `doubt investigate` first.');
    return;
  }

  const store = new Store(dbPath);
  await store.init();
  const investigations = await store.listInvestigations(20);

  console.log(`\n  doubt — investigation history\n`);
  for (const inv of investigations) {
    const status = { supported: '✅', contradicted: '❌', contested: '⚠️', insufficient: '❓' }[inv.status] || '❓';
    console.log(`  ${status} ${inv.query.slice(0, 60).padEnd(60)} conf:${inv.confidence} frag:${inv.fragility_score} ${inv.created_at}`);
  }
}

function printUsage() {
  console.log(`
  doubt — claim verification engine with epistemic self-awareness

  USAGE
    doubt investigate "claim or entity"     Full investigation with triple gate
    doubt sweep "target"                    Quick multi-source OSINT sweep
    doubt connectors                        List all 82 data sources
    doubt history                           View past investigations

  FLAGS
    --depth quick|standard|deep             Investigation depth (default: standard)
    --sources sec_edgar,reddit,...           Specific connectors to use
    --max-sources 30                        Max connectors to query
    --format json                           Output raw JSON
    --output report.md                      Save report to file
    --live                                  Print each step + save .doubt/live.json as it runs
    --verbose                               Show debug output
    --quiet                                 Minimal output

  EXAMPLES
    doubt investigate "OpenAI is independent from Microsoft"
    doubt investigate "Tesla insider trading" --depth deep --format json
    doubt investigate "NHTSA recalls Ford F-150 2024" --live
    doubt sweep "Anthropic" --max-sources 10
    doubt connectors

  ARCHITECTURE
    10 pipeline phases: PREFLIGHT → INTAKE → HUNT → INFERENCE →
    ADVERSARIAL → FRAGILITY → NARRATIVE → CHECK → REPORT → POSTFLIGHT

    Triple gate blocks conclusions until:
      1. Evidence gate:     Bayesian ≥ 0.70, diversity ≥ 0.30
      2. Adversarial gate:  Attack survival ≥ 0.50
      3. Narrative gate:    Coherence ≥ 0.40

    Truth is not what evidence confirms.
    Truth is what survives structured attempts to destroy it.
`);
}

main().catch(err => {
  console.error(`\n  ✗ ${err.message}\n`);
  process.exit(1);
});
