import GDELTConnector from './src/connectors/sources/gdelt.js';
import GeopoliticalConnector from './src/connectors/sources/geopolitical.js';
import NewsIntelConnector from './src/connectors/sources/news-intel.js';
import IntlSanctionsConnector from './src/connectors/sources/international-sanctions.js';

async function test() {
  console.log('=== GDELT ===');
  const gdelt = new GDELTConnector();
  console.log('available:', gdelt.available);
  const r1 = await gdelt.search('Iran nuclear sanctions 2026').catch(e => { console.error('GDELT error:', e.message); return []; });
  console.log('results:', r1.length);
  if (r1.length > 0) r1.slice(0,3).forEach(r => console.log(' -', (r.title || r.summary || '').slice(0,100)));

  console.log('\n=== GEOPOLITICAL ===');
  const geo = new GeopoliticalConnector();
  console.log('available:', geo.available);
  const r2 = await geo.search('Iran nuclear 2026').catch(e => { console.error('GEO error:', e.message); return []; });
  console.log('results:', r2.length);
  if (r2.length > 0) r2.slice(0,3).forEach(r => console.log(' -', (r.title || r.summary || '').slice(0,100)));

  console.log('\n=== NEWS INTEL ===');
  const ni = new NewsIntelConnector();
  console.log('available:', ni.available);
  const r3 = await ni.search('Iran 2026').catch(e => { console.error('NEWSINTEL error:', e.message); return []; });
  console.log('results:', r3.length);
  if (r3.length > 0) r3.slice(0,3).forEach(r => console.log(' -', (r.title || r.summary || '').slice(0,100)));

  console.log('\n=== INTERNATIONAL SANCTIONS ===');
  const is = new IntlSanctionsConnector();
  console.log('available:', is.available);
  const r4 = await is.search('Iran').catch(e => { console.error('SANCTIONS error:', e.message); return []; });
  console.log('results:', r4.length);
  if (r4.length > 0) r4.slice(0,3).forEach(r => console.log(' -', (r.title || r.summary || '').slice(0,100)));
}

test().catch(console.error);
