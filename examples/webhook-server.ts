// A webhook receiver on plain node:http. Point Settings → Integrations → Webhook URL at it
// and use "Send test event" in the delivery log to try it.
//   HELPRANGE_WEBHOOK_SECRET=whsec_… npx tsx examples/webhook-server.ts
import { createServer } from 'node:http';
import { verifyWebhook, WebhookVerificationError } from 'helprange';

const secret = process.env.HELPRANGE_WEBHOOK_SECRET!;
const seen = new Set<string>(); // deduplicate on the event id (retries carry the same id) – use your database in production

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    try {
      const event = verifyWebhook(Buffer.concat(chunks), req.headers, secret);
      if (!seen.has(event.id)) {
        seen.add(event.id);
        if (event.event === 'document.opened') console.log(`${event.data.viewer} opened ${event.data.document}`);
      }
      res.writeHead(200).end('ok'); // answer 2xx within 10 seconds
    } catch (e) {
      res.writeHead(e instanceof WebhookVerificationError ? 400 : 500).end();
    }
  });
}).listen(3000, () => console.log('Listening on http://localhost:3000'));
