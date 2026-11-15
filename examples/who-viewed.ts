// Who opened a document, through which share link, when and for how long.
//   HELPRANGE_API_KEY=hr_live_… npx tsx examples/who-viewed.ts 250
import { HelpRange } from 'helprange';

const documentId = Number(process.argv[2]);
const hr = new HelpRange();

const doc = await hr.documents.get(documentId);
console.log(`${doc.name}: ${doc.views} views, ${doc.downloads} downloads, ${doc.total_seconds_read ?? 0}s read in total`);

// Every share link of the document (links.list also filters by folder_id, room_id, label, status, created_*)
const { links } = await hr.links.list({ document_id: documentId, status: 'all', limit: 200 });
for (const link of links) {
  console.log(`\nLink "${link.label}" (${link.status}) – ${link.views} views – ${link.url}`);
  // All views through this one link, page by page
  for (let page: number | null = 1; page !== null; ) {
    const res = await hr.links.views(link.id, { page, limit: 100 });
    for (const v of res.views) {
      console.log(`  ${v.opened_at}  ${v.viewer.padEnd(30)}  ${v.seconds_read ?? 0}s  ${v.pages_read} pages  ${v.country ?? ''}${v.downloaded ? '  downloaded' : ''}`);
    }
    page = res.next_page;
  }
}

// Per-page attention
for (const p of doc.avg_seconds_per_page ?? []) console.log(`page ${p.page}: ${p.avg_seconds}s on average`);
