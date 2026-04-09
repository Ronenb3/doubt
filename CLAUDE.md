# doubt/CLAUDE.md

## What This System Does

**doubt** is the epistemic verification engine — 114 connectors, triple-gate scoring, Bayesian confidence. Given a claim, it searches across 114 data sources, cross-references results, scores contradictions, and returns a fragility score (0–1).

This is the most production-ready system and the core revenue tool for freelance OSINT reports.

## Key Commands

```bash
node bin/doubt.js connectors | wc -l           # Verify connector count (should be 114)
node bin/doubt.js verify "claim here"          # Run verification pipeline
node bin/doubt.js connectors                   # List all connectors
node bin/doubt.js --help                       # Full CLI reference
```

## Architecture

```
bin/
  doubt.js           — Main CLI entry point
src/
  connectors/        — 114 individual connectors (extend BaseConnector)
  pipeline/          — Triple-gate verification pipeline
  scoring/           — Bayesian confidence + fragility scoring
```

## Connector Pattern

Every connector extends `BaseConnector`, implements `search()`, returns `_toEvidence()`. This is the pattern for all new connectors:

```js
import { BaseConnector } from '../base.js';

export class MyConnector extends BaseConnector {
  async search(query) {
    // fetch data
    return this._toEvidence(results);
  }
}
```

## Current Integrations

- TikTalk bridge: ✅
- INNERNET bridge: ✅
- EBS bridge (Argus): ✅
- epistemic-cascade: ❌ pending

## Rules When Working Here

- **Verify count before citing:** `node bin/doubt.js connectors | wc -l` — the number has changed (50→48→111→114). Always check.
- **ESM only.** No `require()`.
- **Cascade check:** modifying the pipeline or connector registry affects downstream systems. Check what calls this.
- **Triple gate = three independent source categories must agree** before a claim clears verification.
