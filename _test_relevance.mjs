import { RelevanceScorer } from './src/intelligence/relevance.js';
import { QueryPlanner } from './src/core/query-planner.js';
import { EntityExtractor } from './src/extraction/entities.js';
import { createClaim } from './src/core/schema.js';

const scorer = new RelevanceScorer();
const planner = new QueryPlanner();
const query = 'Iran nuclear program sanctions 2025 IAEA inspections uranium enrichment diplomatic negotiations';
const ee = new EntityExtractor();
const entities = ee.extract(query);
const claims = [createClaim(query)];

console.log('Extracted entities:', JSON.stringify(entities, null, 2));
console.log('');

const plan = planner.plan(query, claims, entities, { depth: 'standard' });
console.log('Plan entities:', JSON.stringify(plan.entities, null, 2));
console.log('Total queries:', plan.totalQueries);
console.log('Connector count:', Object.keys(plan.connectorQueries).length);

// Now check what searchEntities looks like in the pipeline context
const searchEntities = plan.entities || {};
console.log('');
console.log('searchEntities keywords:', searchEntities.keywords);
console.log('searchEntities topics:', searchEntities.topics);
console.log('searchEntities domains:', searchEntities.domains);
