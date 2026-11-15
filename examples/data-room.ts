// Set up a data room end to end: create it with folders and an NDA, add documents, invite guests and print each
// guest's own link, then read the index and the Q&A.
//   HELPRANGE_API_KEY=hr_test_… npx tsx examples/data-room.ts
import { HelpRange, BadRequestError } from 'helprange';

const hr = new HelpRange();

// NDAs need the Max plan (or the Deal Room Pass / trial). ndas.list() says whether the team has them.
const { nda_available, ndas } = await hr.ndas.list();

const room = await hr.dataRooms.create({
  name: `Project Falcon ${new Date().toISOString().slice(0, 10)}`,
  folders: ['1. Corporate', '2. Financials', '3. Legal'],
  settings: {
    download: false,
    watermark: true,
    ...(nda_available ? (ndas[0] ? { nda_id: ndas[0].id } : { nda: true, nda_template: 'investor' as const }) : {}),
  },
});
console.log(`Created "${room.name}" (id ${room.id}) – guest link ${room.links.guest_link}`);

// Put the two newest documents into the first room folder
const { documents } = await hr.documents.list();
const financials = room.folders[1];
await hr.dataRooms.documents.add(room.id, {
  document_ids: documents.slice(0, 2).map((d) => d.id),
  ...(financials ? { folder_id: financials.id } : {}),
});

// Invite guests – each gets their own link (test mode only accepts reserved domains such as example.com)
for (const email of ['jane@example.com', 'max@example.com']) {
  try {
    const guest = await hr.dataRooms.guests.invite(room.id, { email });
    console.log(`${guest.email}: ${guest.link}${guest.already_a_guest ? ' (already a guest)' : ''}`);
  } catch (e) {
    if (e instanceof BadRequestError && e.code === 'sandbox_email_domain') console.error('Use an example.com address in test mode');
    else throw e;
  }
}

const { guests } = await hr.dataRooms.guests.list(room.id);
console.log(guests.map((g) => `${g.email} → ${g.link}`).join('\n'));

const index = await hr.dataRooms.getIndex(room.id);
console.log(JSON.stringify(index, null, 2));

const questions = await hr.dataRooms.questions.list(room.id, { status: 'open' });
console.log(questions);

// Clean up: remove a guest, and delete the room (deleting needs an explicit confirm: true)
await hr.dataRooms.guests.remove(room.id, { email: 'max@example.com' });
if (process.env.DELETE_ROOM === '1') await hr.dataRooms.delete(room.id, { confirm: true });
