// Manage the team's webhook endpoint through the API: create it (the secret is shown once), send a test event,
// look at the delivery log, redeliver a failure, rotate the secret.
//   HELPRANGE_API_KEY=hr_live_… npx tsx examples/webhook-endpoints.ts https://example.com/webhooks/helprange
import { HelpRange, ConflictError } from 'helprange';

const hr = new HelpRange();
const url = process.argv[2] ?? 'https://example.com/webhooks/helprange';

let endpoint;
try {
  endpoint = await hr.webhookEndpoints.create({ url });
  console.log(`Created endpoint ${endpoint.id}. Store this secret now – it is not shown again: ${endpoint.secret}`);
} catch (e) {
  if (!(e instanceof ConflictError)) throw e;
  // A team has one endpoint: reuse it and point it at the new URL
  const { webhook_endpoints } = await hr.webhookEndpoints.list();
  endpoint = await hr.webhookEndpoints.update(webhook_endpoints[0]!.id, { url, enabled: true });
  console.log(`Updated endpoint ${endpoint.id} → ${endpoint.url}`);
}

const test = await hr.webhookEndpoints.sendTest(endpoint.id);
console.log(`Test event ${test.event_id}: ${test.delivered ? 'delivered' : `failed (${test.last_status_code ?? test.last_error})`}`);

const { deliveries, retention_days } = await hr.webhookEndpoints.deliveries(endpoint.id, { status: 'failed', limit: 20 });
console.log(`${deliveries.length} failed deliveries in the last ${retention_days} days`);
const failed = deliveries[0];
if (failed) {
  const again = await hr.webhookEndpoints.redeliver(endpoint.id, failed.id);
  console.log(`Redelivered ${again.event_id}: ${again.delivered ? 'ok' : 'failed again'}`);
}

// Rotate the secret: for 24 hours HelpRange signs with both the old and the new one
const rotated = await hr.webhookEndpoints.rotateSecret(endpoint.id);
console.log(`New secret: ${rotated.secret} (old one valid until ${rotated.previous_secret_expires_at})`);
