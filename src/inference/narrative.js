/**
 * doubt — Narrative Coherence Engine
 *
 * Evidence doesn't just need to be true individually — it needs to tell
 * a story that's physically and logically possible.
 *
 * "Founded in 2020, IPO'd in 2018" isn't just two contradicting facts —
 * it's a narrative impossibility that reveals fabrication.
 *
 * This module builds a temporal/causal model from all available claims
 * and evidence, then checks whether the resulting narrative is coherent:
 *
 *   TEMPORAL    — do events follow a possible chronological order?
 *   CAUSAL      — if A causes B, does A precede B?
 *   NUMERICAL   — do financial figures add up across the timeline?
 *   GEOGRAPHIC  — can events at different locations co-occur given timeframes?
 *   LIFECYCLE   — birth before death, founding before IPO, hire before fire
 *   ROLE        — does the same person hold conflicting roles simultaneously?
 *
 * The narrative gap detector identifies suspiciously absent evidence —
 * the dog that didn't bark. A company that IPO'd at $10B with zero
 * press coverage between founding and listing is a red flag, not a gap.
 *
 * Coherence score: 0 = fabricated fiction, 1 = airtight chronology.
 */

import { ContradictionType, createContradiction } from '../core/schema.js';
import { log } from '../core/config.js';

const LIFECYCLE_ORDERINGS = [
  ['founded', 'incorporated', 'launched', 'ipo', 'acquired', 'merged', 'dissolved', 'bankrupt'],
  ['born', 'graduated', 'hired', 'promoted', 'appointed', 'resigned', 'retired', 'died'],
  ['filed', 'reviewed', 'approved', 'enacted', 'repealed'],
  ['proposed', 'funded', 'started', 'completed', 'published'],
  ['charged', 'indicted', 'tried', 'convicted', 'sentenced', 'appealed', 'released'],
  ['invented', 'patented', 'manufactured', 'recalled'],
];

const EVENT_VERB_MAP = buildVerbMap();

const EXPECTED_MILESTONES = {
  company: [
    { between: ['founded', 'ipo'], expect: ['product', 'revenue', 'funding', 'hired', 'launched'], label: 'operational activity' },
    { between: ['ipo', 'acquired'], expect: ['revenue', 'earnings', 'quarterly', 'annual report'], label: 'public reporting' },
  ],
  person: [
    { between: ['hired', 'promoted'], expect: ['project', 'achievement', 'role', 'led', 'managed'], label: 'professional activity' },
    { between: ['appointed', 'resigned'], expect: ['decision', 'statement', 'policy', 'announced'], label: 'leadership activity' },
  ],
};

export class NarrativeCoherenceEngine {

  /**
   * Build a narrative model from claims, evidence, and entities,
   * then evaluate its coherence across multiple dimensions.
   */
  analyze(claims, evidence, entities) {
    const timeline = this.buildTimeline(claims, evidence);
    const impossibilities = [];
    const warnings = [];

    // Causal chain validation
    const causalIssues = this._validateCausalChains(timeline.events);
    impossibilities.push(...causalIssues.filter(i => i.severity >= 0.7));
    warnings.push(...causalIssues.filter(i => i.severity < 0.7));

    // Entity lifecycle consistency
    const lifecycleIssues = this._validateLifecycles(timeline.events, entities);
    impossibilities.push(...lifecycleIssues.filter(i => i.severity >= 0.7));
    warnings.push(...lifecycleIssues.filter(i => i.severity < 0.7));

    // Numerical consistency
    const numericalIssues = this._validateNumerical(claims, evidence);
    impossibilities.push(...numericalIssues);

    // Geographic consistency
    const geoIssues = this._validateGeographic(timeline.events);
    impossibilities.push(...geoIssues);

    // Role consistency
    const roleIssues = this._validateRoles(claims, entities);
    impossibilities.push(...roleIssues);

    // Cross-lifecycle: actions on an entity before the entity exists
    const existenceIssues = this._validateExistencePrereqs(timeline.events);
    impossibilities.push(...existenceIssues);

    // Narrative gaps
    const gaps = this.findNarrativeGaps(timeline);

    timeline.impossibilities = impossibilities;

    const narrativeModel = {
      timeline,
      impossibilities,
      warnings,
      gaps,
      entities: entities || [],
    };

    const scores = this.scoreCoherence(narrativeModel);
    narrativeModel.scores = scores;
    narrativeModel.report = this.generateNarrativeReport(narrativeModel);

    log('info', `Narrative coherence: ${scores.overall.toFixed(2)} (${impossibilities.length} impossibilities, ${gaps.length} gaps)`);
    return narrativeModel;
  }

  /**
   * Extract temporal facts from claims and evidence,
   * then build a chronological model with confidence scores.
   */
  buildTimeline(claims, evidence) {
    const events = [];
    const seen = new Set();

    for (const claim of (claims || [])) {
      const extracted = this._extractTemporalEvents(claim.text, claim.source, claim.confidence || 0.5);
      for (const evt of extracted) {
        const key = `${evt.date}:${evt.verb}:${evt.entity}`;
        if (!seen.has(key)) {
          seen.add(key);
          events.push(evt);
        }
      }
    }

    for (const e of (evidence || [])) {
      const extracted = this._extractTemporalEvents(
        e.summary || '', e.connectorId, e.trustWeight || 0.5
      );
      for (const evt of extracted) {
        const key = `${evt.date}:${evt.verb}:${evt.entity}`;
        if (!seen.has(key)) {
          seen.add(key);
          events.push(evt);
        }
      }
    }

    events.sort((a, b) => {
      const da = parseDate(a.date);
      const db = parseDate(b.date);
      if (da && db) return da - db;
      if (da) return -1;
      if (db) return 1;
      return 0;
    });

    const gaps = this._findTimelineGaps(events);

    return { events, gaps, impossibilities: [] };
  }

  /**
   * Score the narrative model on 0–1 across multiple dimensions.
   *
   *   temporal   — are events in a possible chronological order?
   *   causal     — do cause-effect relationships hold?
   *   numerical  — do numbers add up across the timeline?
   *   geographic — are locations/travel times plausible?
   *   overall    — weighted composite
   */
  scoreCoherence(narrativeModel) {
    const { impossibilities, warnings, gaps, timeline } = narrativeModel;
    const eventCount = timeline.events.length;

    if (eventCount === 0) {
      return { temporal: 0.5, causal: 0.5, numerical: 0.5, geographic: 0.5, overall: 0.5 };
    }

    const temporalIssues = impossibilities.filter(i => i.dimension === 'temporal' || i.dimension === 'lifecycle');
    const causalIssues = impossibilities.filter(i => i.dimension === 'causal');
    const numericalIssues = impossibilities.filter(i => i.dimension === 'numerical');
    const geoIssues = impossibilities.filter(i => i.dimension === 'geographic');

    const temporal = penalize(1.0, temporalIssues, warnings.filter(w => w.dimension === 'temporal'), eventCount);
    const causal = penalize(1.0, causalIssues, warnings.filter(w => w.dimension === 'causal'), eventCount);
    const numerical = penalize(1.0, numericalIssues, [], eventCount);
    const geographic = penalize(1.0, geoIssues, [], eventCount);

    // Gap penalty: more severe for longer, more numerous gaps
    const gapPenalty = gaps.reduce((sum, g) => sum + g.severity * 0.1, 0);

    const overall = Math.max(0, Math.min(1,
      temporal * 0.35 +
      causal * 0.25 +
      numerical * 0.20 +
      geographic * 0.10 +
      0.10 -   // baseline for gap dimension
      gapPenalty
    ));

    return {
      temporal: round(temporal),
      causal: round(causal),
      numerical: round(numerical),
      geographic: round(geographic),
      overall: round(overall),
    };
  }

  /**
   * Identify periods where evidence is suspiciously absent.
   *
   * Not all gaps are suspicious — a gap between founding and first product
   * is normal. But a gap between founding and a $10B IPO with nothing
   * in between is the dog that didn't bark.
   */
  findNarrativeGaps(timeline) {
    const gaps = [];

    if (!timeline.events || timeline.events.length < 2) return gaps;

    const events = timeline.events.filter(e => parseDate(e.date));

    for (let i = 0; i < events.length - 1; i++) {
      const current = events[i];
      const next = events[i + 1];
      const dateA = parseDate(current.date);
      const dateB = parseDate(next.date);
      if (!dateA || !dateB) continue;

      const monthsGap = (dateB - dateA) / (30 * 24 * 3600 * 1000);
      if (monthsGap < 3) continue;

      const severity = this._assessGapSeverity(current, next, monthsGap);
      if (severity < 0.2) continue;

      const expectedMilestones = this._expectedBetween(current, next);

      gaps.push({
        from: current.date,
        to: next.date,
        fromEvent: current.description,
        toEvent: next.description,
        monthsGap: Math.round(monthsGap),
        description: `No evidence for ${Math.round(monthsGap)}-month period between "${current.description}" and "${next.description}"`,
        severity: round(severity),
        expectedMilestones,
      });
    }

    return gaps.sort((a, b) => b.severity - a.severity);
  }

  /**
   * Human-readable narrative coherence report.
   */
  generateNarrativeReport(narrativeModel) {
    const { timeline, impossibilities, warnings, gaps, scores } = narrativeModel;
    const parts = [];

    // Opening assessment
    if (scores.overall >= 0.85) {
      parts.push('The evidence tells a largely coherent story.');
    } else if (scores.overall >= 0.6) {
      parts.push('The evidence tells a partially coherent story with notable concerns.');
    } else if (scores.overall >= 0.3) {
      parts.push('The evidence contains significant narrative inconsistencies.');
    } else {
      parts.push('The evidence tells a deeply incoherent story — multiple elements cannot logically co-exist.');
    }

    // Impossibilities
    if (impossibilities.length > 0) {
      const critical = impossibilities.filter(i => i.severity >= 0.8);
      if (critical.length > 0) {
        parts.push(`Critical impossibilit${critical.length === 1 ? 'y' : 'ies'}: ${critical.map(i => i.reason).join('; ')}.`);
      }
      const moderate = impossibilities.filter(i => i.severity < 0.8);
      if (moderate.length > 0) {
        parts.push(`${moderate.length} additional narrative inconsistenc${moderate.length === 1 ? 'y' : 'ies'} detected.`);
      }
    }

    // Gaps
    const significantGaps = gaps.filter(g => g.severity >= 0.5);
    if (significantGaps.length > 0) {
      const worst = significantGaps[0];
      parts.push(
        `Notably, between "${worst.fromEvent}" (${worst.from}) and "${worst.toEvent}" (${worst.to}), ` +
        `there is no evidence of ${worst.expectedMilestones.length > 0 ? worst.expectedMilestones.join(', ') : 'any activity'} ` +
        `across a ${worst.monthsGap}-month void.`
      );

      if (significantGaps.length > 1) {
        parts.push(`${significantGaps.length - 1} additional significant gap${significantGaps.length - 1 === 1 ? '' : 's'} identified.`);
      }
    }

    // Sub-scores
    const weakest = Object.entries(scores)
      .filter(([k]) => k !== 'overall')
      .sort((a, b) => a[1] - b[1]);

    if (weakest.length > 0 && weakest[0][1] < 0.6) {
      parts.push(`Weakest dimension: ${weakest[0][0]} coherence (${weakest[0][1].toFixed(2)}).`);
    }

    return parts.join(' ');
  }

  // ── Internal: Temporal extraction ──────────────────────

  _extractTemporalEvents(text, source, confidence) {
    if (!text) return [];
    const events = [];

    const VERBS = 'founded|incorporated|launched|ipo\'?d?|acquired|merged|dissolved|bankrupt|born|graduated|hired|promoted|appointed|resigned|retired|died|filed|charged|indicted|convicted|sentenced|acquitted|raised|earned|reported|generated';
    const DATE = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\\s*\\d{0,2},?\\s*\\d{4}|\\d{4}|Q[1-4]\\s*\\d{4}';

    const patterns = [
      // "verb ... in/on Date" — allows up to 50 chars of intervening text
      new RegExp(`\\b(${VERBS})\\w*\\b.{0,50}?\\b(?:in|on|around|during)\\s+(${DATE})`, 'gi'),
      // "Date ... verb" — date first, then verb
      new RegExp(`\\b(${DATE})\\s*[,:;]?\\s*.{0,30}?\\b(${VERBS})\\w*`, 'gi'),
    ];

    const allEntities = extractNamedEntities(text);
    const primaryEntity = allEntities[0] || '(unknown)';

    for (let pi = 0; pi < patterns.length; pi++) {
      const pattern = patterns[pi];
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const g1 = match[1];
        const g2 = match[2];

        const isDateFirst = pi === 1;
        const rawVerb = (isDateFirst ? g2 : g1).toLowerCase().replace(/['']/g, '');
        const rawDate = isDateFirst ? g1 : g2;

        events.push({
          date: normalizeDate(rawDate),
          description: truncate(match[0].trim(), 120),
          verb: rawVerb.replace(/ed$/, '').replace(/ing$/, '').replace(/'\w*$/, ''),
          entity: primaryEntity,
          allEntities,
          source,
          confidence: round(confidence),
        });
      }
    }

    return events;
  }

  _validateCausalChains(events) {
    const issues = [];
    if (events.length < 2) return issues;

    // Group events by entity
    const byEntity = new Map();
    for (const evt of events) {
      const key = evt.entity || '(unknown)';
      if (!byEntity.has(key)) byEntity.set(key, []);
      byEntity.get(key).push(evt);
    }

    for (const [entity, entityEvents] of byEntity) {
      const sorted = entityEvents
        .filter(e => parseDate(e.date))
        .sort((a, b) => parseDate(a.date) - parseDate(b.date));

      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const earlier = sorted[i];
          const later = sorted[j];

          // Check if the later event should logically precede the earlier one
          const verbOrderA = getVerbOrder(earlier.verb);
          const verbOrderB = getVerbOrder(later.verb);

          if (verbOrderA !== null && verbOrderB !== null && verbOrderA > verbOrderB) {
            issues.push({
              dimension: 'causal',
              eventA: earlier,
              eventB: later,
              reason: `"${earlier.description}" (${earlier.date}) logically must follow "${later.description}" (${later.date}), but chronologically precedes it`,
              severity: 0.85,
            });
          }
        }
      }
    }

    return issues;
  }

  _validateLifecycles(events, entities) {
    const issues = [];
    const byEntity = new Map();

    for (const evt of events) {
      const key = evt.entity || '(unknown)';
      if (!byEntity.has(key)) byEntity.set(key, []);
      byEntity.get(key).push(evt);
    }

    for (const [entity, entityEvents] of byEntity) {
      for (const ordering of LIFECYCLE_ORDERINGS) {
        const matched = entityEvents
          .filter(e => {
            const verb = e.verb || '';
            return ordering.some(stage => verb.includes(stage));
          })
          .sort((a, b) => {
            const da = parseDate(a.date);
            const db = parseDate(b.date);
            return (da || 0) - (db || 0);
          });

        for (let i = 0; i < matched.length; i++) {
          for (let j = i + 1; j < matched.length; j++) {
            const stageA = ordering.findIndex(s => (matched[i].verb || '').includes(s));
            const stageB = ordering.findIndex(s => (matched[j].verb || '').includes(s));

            if (stageA >= 0 && stageB >= 0 && stageA > stageB) {
              issues.push({
                dimension: 'lifecycle',
                eventA: matched[i],
                eventB: matched[j],
                reason: `Lifecycle violation for "${entity}": "${matched[i].verb}" (${matched[i].date}) must come after "${matched[j].verb}" (${matched[j].date})`,
                severity: 0.9,
              });
            }
          }
        }
      }
    }

    return issues;
  }

  _validateNumerical(claims, evidence) {
    const issues = [];
    const financialFacts = [];

    for (const source of [...(claims || []), ...(evidence || [])]) {
      const text = source.text || source.summary || '';
      const numbers = extractFinancials(text);
      const entities = extractNamedEntities(text);
      const entity = entities[0] || '(unknown)';
      const dates = extractYears(text);
      const date = dates[0] || null;

      for (const num of numbers) {
        financialFacts.push({ ...num, entity, date, sourceText: text, sourceId: source.id });
      }
    }

    // Group by entity+date, look for conflicts
    const groups = new Map();
    for (const fact of financialFacts) {
      const key = `${fact.entity}:${fact.date}:${fact.label}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(fact);
    }

    for (const [key, facts] of groups) {
      if (facts.length < 2) continue;
      const values = facts.map(f => f.value).sort((a, b) => a - b);
      const ratio = values[values.length - 1] / Math.max(1, values[0]);

      if (ratio > 1.5) {
        issues.push({
          dimension: 'numerical',
          reason: `Conflicting ${facts[0].label} figures for "${facts[0].entity}" (${facts[0].date || 'undated'}): ${facts.map(f => f.raw).join(' vs ')}`,
          severity: Math.min(0.95, 0.5 + (ratio - 1) * 0.15),
        });
      }
    }

    // Revenue > costs should imply profit, and vice versa
    for (const [entity, entityFacts] of groupBy(financialFacts, f => `${f.entity}:${f.date}`)) {
      const revenue = entityFacts.find(f => f.label === 'revenue');
      const cost = entityFacts.find(f => f.label === 'cost' || f.label === 'expense');
      const profit = entityFacts.find(f => f.label === 'profit' || f.label === 'income');
      const loss = entityFacts.find(f => f.label === 'loss');

      if (revenue && cost && profit) {
        const impliedProfit = revenue.value - cost.value;
        if (impliedProfit > 0 && loss) {
          issues.push({
            dimension: 'numerical',
            reason: `Revenue (${revenue.raw}) exceeds costs (${cost.raw}) but a loss (${loss.raw}) is reported`,
            severity: 0.8,
          });
        }
      }
    }

    return issues;
  }

  _validateGeographic(events) {
    const issues = [];
    const locatedEvents = events
      .filter(e => e.location && parseDate(e.date))
      .sort((a, b) => parseDate(a.date) - parseDate(b.date));

    for (let i = 0; i < locatedEvents.length - 1; i++) {
      const a = locatedEvents[i];
      const b = locatedEvents[i + 1];

      if (a.entity !== b.entity) continue;
      if (a.location === b.location) continue;

      const dateA = parseDate(a.date);
      const dateB = parseDate(b.date);
      const hoursBetween = (dateB - dateA) / 3600000;

      // Same entity at different locations within impossible timeframes
      // (using very conservative 2-hour threshold for same-day events)
      if (hoursBetween < 2 && hoursBetween >= 0) {
        issues.push({
          dimension: 'geographic',
          eventA: a,
          eventB: b,
          reason: `"${a.entity}" at "${a.location}" and "${b.location}" within ${hoursBetween.toFixed(1)} hours`,
          severity: 0.7,
        });
      }
    }

    return issues;
  }

  _validateRoles(claims, entities) {
    const issues = [];
    const roleAssignments = [];
    const sources = claims || [];

    for (const source of sources) {
      const text = source.text || source.summary || '';
      const roles = extractRoles(text);
      for (const role of roles) {
        roleAssignments.push({ ...role, sourceId: source.id });
      }
    }

    // Check for conflicting simultaneous roles
    const byPerson = new Map();
    for (const ra of roleAssignments) {
      if (!byPerson.has(ra.person)) byPerson.set(ra.person, []);
      byPerson.get(ra.person).push(ra);
    }

    for (const [person, roles] of byPerson) {
      for (let i = 0; i < roles.length; i++) {
        for (let j = i + 1; j < roles.length; j++) {
          // CEO of two different companies at the same time
          if (roles[i].role === roles[j].role &&
              roles[i].organization !== roles[j].organization &&
              roles[i].role.match(/\b(ceo|president|chairman|director)\b/i)) {
            issues.push({
              dimension: 'role',
              reason: `${person} allegedly holds "${roles[i].role}" at both "${roles[i].organization}" and "${roles[j].organization}" simultaneously`,
              severity: 0.6,
            });
          }
        }
      }
    }

    return issues;
  }

  /**
   * Cross-lifecycle check: actions that imply an entity's existence
   * (resigned from X, promoted at X) must not precede the entity's
   * creation event (X founded, X incorporated).
   */
  _validateExistencePrereqs(events) {
    const issues = [];
    const CREATION_VERBS = new Set(['found', 'incorporat', 'born', 'creat', 'establish']);
    const IMPLIES_EXISTENCE = new Set([
      'resign', 'retir', 'promot', 'appoint', 'hir', 'fir',
      'ipo', 'acquir', 'merg', 'dissolv', 'launch', 'rais',
      'report', 'earn', 'fil',
    ]);

    const creationByEntity = new Map();
    for (const evt of events) {
      const verb = evt.verb || '';
      for (const cv of CREATION_VERBS) {
        if (verb.startsWith(cv)) {
          const d = parseDate(evt.date);
          if (d) {
            const existing = creationByEntity.get(evt.entity);
            if (!existing || d < existing.dateMs) {
              creationByEntity.set(evt.entity, { dateMs: d, event: evt });
            }
          }
        }
      }
    }

    for (const evt of events) {
      const verb = evt.verb || '';
      let impliesExistence = false;
      for (const iv of IMPLIES_EXISTENCE) {
        if (verb.startsWith(iv)) { impliesExistence = true; break; }
      }
      if (!impliesExistence) continue;

      const evtDate = parseDate(evt.date);
      if (!evtDate) continue;

      // Check primary entity and all mentioned entities
      const entitiesToCheck = evt.allEntities
        ? [...new Set([evt.entity, ...evt.allEntities])]
        : [evt.entity];

      for (const entityName of entitiesToCheck) {
        const creation = creationByEntity.get(entityName);
        if (!creation) continue;

        if (evtDate < creation.dateMs) {
          issues.push({
            dimension: 'temporal',
            eventA: evt,
            eventB: creation.event,
            reason: `"${evt.description}" (${evt.date}) occurred before "${entityName}" existed (${creation.event.description}, ${creation.event.date})`,
            severity: 0.9,
          });
        }
      }
    }

    return issues;
  }

  _findTimelineGaps(events) {
    const gaps = [];
    if (events.length < 2) return gaps;

    for (let i = 0; i < events.length - 1; i++) {
      const dateA = parseDate(events[i].date);
      const dateB = parseDate(events[i + 1].date);
      if (!dateA || !dateB) continue;

      const monthsGap = (dateB - dateA) / (30 * 24 * 3600 * 1000);
      if (monthsGap >= 6) {
        gaps.push({
          from: events[i].date,
          to: events[i + 1].date,
          description: `No evidence for ${Math.round(monthsGap)}-month period`,
          severity: Math.min(0.9, monthsGap / 60),
        });
      }
    }

    return gaps;
  }

  _assessGapSeverity(eventBefore, eventAfter, monthsGap) {
    let severity = Math.min(0.8, monthsGap / 48);

    // Gaps between "big" events are more suspicious
    const bigVerbs = new Set(['founded', 'ipo', 'acquired', 'convicted', 'bankrupt', 'died']);
    if (bigVerbs.has(eventBefore.verb) || bigVerbs.has(eventAfter.verb)) {
      severity = Math.min(1.0, severity + 0.3);
    }

    // High-confidence events on both sides make the gap more suspicious
    const avgConfidence = ((eventBefore.confidence || 0.5) + (eventAfter.confidence || 0.5)) / 2;
    severity *= (0.5 + avgConfidence * 0.5);

    return Math.min(1.0, severity);
  }

  _expectedBetween(eventBefore, eventAfter) {
    const verbA = eventBefore.verb || '';
    const verbB = eventAfter.verb || '';

    for (const category of Object.values(EXPECTED_MILESTONES)) {
      for (const rule of category) {
        const matchesA = rule.between[0] && verbA.includes(rule.between[0]);
        const matchesB = rule.between[1] && verbB.includes(rule.between[1]);
        if (matchesA && matchesB) {
          return [rule.label];
        }
      }
    }

    return ['any activity'];
  }
}

// ─── Utility ──────────────────────────────────────────────

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Handle year-only
  if (/^\d{4}$/.test(dateStr.trim())) {
    return new Date(`${dateStr.trim()}-07-01`).getTime();
  }
  const ms = new Date(dateStr).getTime();
  return isNaN(ms) ? null : ms;
}

function normalizeDate(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Already a year
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  // Quarter
  const qMatch = trimmed.match(/Q([1-4])\s*(\d{4})/);
  if (qMatch) {
    const month = (parseInt(qMatch[1]) - 1) * 3 + 1;
    return `${qMatch[2]}-${String(month).padStart(2, '0')}`;
  }
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return trimmed;
}

function extractNamedEntities(text) {
  if (!text) return [];
  const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  const entities = [];
  for (const match of text.matchAll(pattern)) {
    entities.push(match[1]);
  }
  return [...new Set(entities)];
}

function extractYears(text) {
  if (!text) return [];
  const matches = text.match(/\b(19|20)\d{2}\b/g);
  return matches ? [...new Set(matches)] : [];
}

function extractFinancials(text) {
  if (!text) return [];
  const results = [];
  const pattern = /\$?([\d,]+\.?\d*)\s*(billion|million|trillion|B|M|T|K)?\s*(?:in\s+)?(revenue|profit|income|loss|cost|expense|earnings|debt|valuation|funding)/gi;

  for (const match of text.matchAll(pattern)) {
    let value = parseFloat(match[1].replace(/,/g, ''));
    const unit = (match[2] || '').toLowerCase();
    const label = match[3].toLowerCase();

    const multipliers = { billion: 1e9, b: 1e9, million: 1e6, m: 1e6, thousand: 1e3, k: 1e3, trillion: 1e12, t: 1e12 };
    if (multipliers[unit]) value *= multipliers[unit];

    results.push({ value, label, raw: match[0].trim() });
  }

  return results;
}

function extractRoles(text) {
  if (!text) return [];
  const results = [];
  const pattern = /\b(\w+(?:\s+\w+)?)\s+(?:as|is|was|became|named|appointed)\s+(CEO|CTO|CFO|COO|President|Chairman|Director|VP|SVP|EVP|Head|Chief)\s+(?:of|at)\s+(\w+(?:\s+\w+)*)/gi;

  for (const match of text.matchAll(pattern)) {
    results.push({
      person: match[1].trim(),
      role: match[2].trim().toLowerCase(),
      organization: match[3].trim(),
    });
  }

  return results;
}

function buildVerbMap() {
  const map = new Map();
  for (const ordering of LIFECYCLE_ORDERINGS) {
    for (let i = 0; i < ordering.length; i++) {
      map.set(ordering[i], i);
    }
  }
  return map;
}

function getVerbOrder(verb) {
  if (!verb) return null;
  const clean = verb.toLowerCase().replace(/ed$/, '').replace(/ing$/, '');
  return EVENT_VERB_MAP.get(clean) ?? null;
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function penalize(base, criticalIssues, warningIssues, eventCount) {
  const scale = Math.max(1, eventCount);
  let score = base;
  for (const issue of criticalIssues) {
    score -= (issue.severity || 0.5) * (1 / scale) * 3;
  }
  for (const issue of warningIssues) {
    score -= (issue.severity || 0.3) * (1 / scale);
  }
  return Math.max(0, Math.min(1, score));
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
}

function round(n, places = 3) {
  return Math.round(n * 10 ** places) / 10 ** places;
}

export { LIFECYCLE_ORDERINGS };
export default NarrativeCoherenceEngine;
