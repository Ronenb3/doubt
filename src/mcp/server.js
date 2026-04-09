#!/usr/bin/env node
/**
 * doubt — MCP Server
 *
 * Exposes the full investigation engine as MCP tools
 * callable from Cursor, Claude Desktop, or any MCP client.
 *
 * Tools:
 *   investigate  — full pipeline with triple gate
 *   sweep        — quick multi-source OSINT
 *   connectors   — list all 92 data sources
 *   fragility    — analyze claim set fragility
 *   status       — epistemic vector readout
 *   recent       — recency-mode investigation (breaking news)
 */

import { createInterface } from 'readline';
import { Pipeline } from '../core/pipeline.js';
import { ReportGenerator } from '../report/generator.js';
import registry from '../connectors/registry.js';

const tools = [
  {
    name: 'investigate',
    description: 'Run a full investigation: 92 free data sources across 15 domains (news, geopolitical, financial, corporate, legal, security, OSINT, academic, government, sanctions, property, infrastructure, social, trade, health) → Bayesian inference → contradiction detection → citation diversity → keystone fragility → adversarial engine → epistemic triple gate → report. Cannot produce confident conclusions from insufficient evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: 'The claim, company, person, or topic to investigate' },
        depth: { type: 'string', enum: ['quick', 'standard', 'deep'], default: 'standard' },
        format: { type: 'string', enum: ['markdown', 'json'], default: 'markdown' },
      },
      required: ['claim'],
    },
  },
  {
    name: 'sweep',
    description: 'Quick parallel OSINT sweep across multiple free sources. Returns raw evidence without full inference pipeline. Fast (5-15 seconds).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Company, person, domain, or topic' },
        sources: { type: 'array', items: { type: 'string' }, description: 'Specific connectors (omit for auto-routing)' },
        max_sources: { type: 'number', default: 15 },
      },
      required: ['target'],
    },
  },
  {
    name: 'connectors',
    description: 'List all 92 free data source connectors with their domains, trust tiers, and availability status. Covers: news (RSS, GNews, Currents, Brave), security (OTX, Shodan, IntelX), OSINT, financial (SEC, EDGAR, FRED, Polygon), government (USAspending, SAM, Congress), corporate (OpenCorporates, GLEIF), academic (CrossRef, PubMed, arXiv, Semantic Scholar), geopolitical (GDELT, sanctions, Interpol), and more.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cert_transparency',
    description: 'Check SSL certificate transparency for a domain. Reveals infrastructure, API endpoints, partnerships, product names. Free, instant, no auth.',
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string', description: 'Domain to check (e.g. cursor.sh)' } },
      required: ['domain'],
    },
  },
  {
    name: 'sec_filings',
    description: 'Search SEC EDGAR for filings. Form 4 (insider trades), 13F (institutional), 8-K (material events), 10-K/10-Q (financials).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        form_type: { type: 'string', enum: ['4', '8-K', '13F', '10-K', '10-Q', 'all'], default: 'all' },
      },
      required: ['query'],
    },
  },
  {
    name: 'social_signals',
    description: 'Reddit + HackerNews signals for a topic. Returns posts with scores, comments, sentiment indicators.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'recent',
    description: 'Breaking news / recency-mode investigation. Force-injects 5 real-time news connectors (RSS, SearXNG, Brave, GNews, Currents) and applies freshness multipliers (<6h = 5×, <24h = 3.5×, <48h = 2×). Use for: "what is happening right now with X", "latest news on Y", "breaking developments in Z".',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The topic, event, or entity to get current news on' },
        depth: { type: 'string', enum: ['quick', 'standard', 'deep'], default: 'standard' },
      },
      required: ['query'],
    },
  },
];

async function handleTool(name, args) {
  const pipeline = new Pipeline();

  switch (name) {
    case 'investigate': {
      const inv = await pipeline.investigate(args.claim, {
        depth: args.depth || 'standard',
      });
      if (args.format === 'json') return inv;
      const report = new ReportGenerator();
      return report.generate(inv);
    }

    case 'sweep': {
      const result = await pipeline.sweep(args.target, {
        maxSources: args.max_sources || 15,
        connectors: args.sources || null,
      });
      return result;
    }

    case 'connectors': {
      await registry.loadAll();
      return registry.toJSON();
    }

    case 'cert_transparency': {
      await registry.loadAll();
      const crt = registry.get('crt_sh');
      if (!crt) return { error: 'crt_sh connector not available' };
      const evidence = await crt.search(args.domain);
      return evidence;
    }

    case 'sec_filings': {
      await registry.loadAll();
      const sec = registry.get('sec_edgar');
      if (!sec) return { error: 'sec_edgar connector not available' };
      return await sec.search(args.query, { formType: args.form_type });
    }

    case 'social_signals': {
      await registry.loadAll();
      const [reddit, hn] = await Promise.all([
        registry.get('reddit')?.search(args.query) || [],
        registry.get('hackernews')?.search(args.query) || [],
      ]);
      return { reddit, hackernews: hn };
    }

    case 'recent': {
      const inv = await pipeline.investigate(
        `latest breaking ${args.query}`,
        { depth: args.depth || 'standard', recencyMode: true },
      );
      const report = new ReportGenerator();
      return report.generate(inv);
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── MCP Protocol ─────────────────────────────────────────

const rl = createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }

  const { id, method, params } = req;
  const send = (r) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: r }) + '\n');
  const sendErr = (c, m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: c, message: m } }) + '\n');

  try {
    if (method === 'initialize') {
      send({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'doubt',
          version: '0.1.0',
          description: 'Claim verification engine — 92 free sources across 15 domains, Bayesian inference, adversarial engine, triple epistemic gate, keystone fragility. Cannot hallucinate confidence it has not earned.',
        },
      });
    } else if (method === 'tools/list') {
      send({ tools });
    } else if (method === 'tools/call') {
      const result = await handleTool(params.name, params.arguments || {});
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      send({ content: [{ type: 'text', text }] });
    } else if (method !== 'notifications/initialized') {
      sendErr(-32601, `Unknown: ${method}`);
    }
  } catch (err) {
    sendErr(-32603, err.message);
  }
});

process.stderr.write('doubt MCP server started.\n');
