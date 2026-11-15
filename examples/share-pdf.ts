// Upload a PDF and get a tracked share link for one recipient.
//   HELPRANGE_API_KEY=hr_test_… npx tsx examples/share-pdf.ts ./proposal.pdf
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { HelpRange } from 'helprange';

const path = process.argv[2] ?? 'proposal.pdf';
const hr = new HelpRange(); // reads HELPRANGE_API_KEY

const { document, link } = await hr.share({
  file: await readFile(path),
  filename: basename(path),
  link: {
    label: 'ACME - Anna', // who the link is for – shown in the statistics, unique per document
    allow_download: false,
    watermark: true,
    require_email: true,
    expires_on: '2026-12-31',
  },
});

console.log(`Uploaded "${document.name}" (${document.pages ?? '?'} pages, id ${document.id})`);
console.log(`Send this link: ${link.url}`);
if (hr.testMode) console.log('(test mode – this lives in your sandbox)');
