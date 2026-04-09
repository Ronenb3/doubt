import GDELTConnector from './src/connectors/sources/gdelt.js';
import { getConfig } from './src/core/config.js';

const c = new GDELTConnector();
const config = getConfig();
console.log('Timeout:', config.connectors.timeout);
console.log('Retries:', config.connectors.retries);

// Manually call the URL to see response
const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=Iran+nuclear+sanctions&mode=artlist&maxrecords=10&format=json`;
console.log('\nFetching:', url);

try {
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'doubt/0.1.0' },
    signal: AbortSignal.timeout(config.connectors.timeout),
  });
  console.log('Status:', resp.status);
  console.log('Content-Type:', resp.headers.get('content-type'));
  const data = await resp.json();
  console.log('Keys:', Object.keys(data));
  console.log('Articles count:', data.articles?.length || 0);
  if (data.articles?.length > 0) {
    console.log('First title:', data.articles[0].title);
  }
} catch (e) {
  console.error('Error:', e.message);
}
