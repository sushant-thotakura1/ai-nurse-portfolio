/**
 * Builds the SME conversation guides.
 *
 * Content is defined ONCE as block data below, then rendered to both .docx
 * (the thing SMEs receive) and .md (reviewable in git without opening Word),
 * so the two can never drift apart.
 *
 * Output:
 *   SME_Conversation_Guide.docx        — common: why / what / how. Sent once.
 *   Conversation_Menu_<Condition>.docx — per-condition checklist. One per KB.
 *
 * Usage: npm install && node build-docx.js
 * To render for visual checking (this machine has Word but no LibreOffice):
 *   powershell -File ../../scripts/docx-to-pdf.ps1 -Path <file>.docx
 */
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, LevelFormat, convertInchesToTwip,
} = require('docx');

const ACCENT = '2E5E4E';       // deep teal — headings
const ESCALATE = 'B3261E';     // red
const NOT_ESCALATE = '1E7A4C'; // green
const MUTED = '6B6B6B';

// ─────────────────────────────────────────────────────────────────────────────
// Content — single source of truth for both renderers
// ─────────────────────────────────────────────────────────────────────────────

const COMMON_TITLE = 'Your Voice Becomes the Standard';
const COMMON_SUBTITLE = 'How to record real check-in conversations';

const COMMON_BLOCKS = [
  { type: 'h2', text: 'Why we’re asking you this' },
  { type: 'p', text: 'On our last call, you looked at a list of situations and told us, in plain terms, which ones should raise the alarm and which ones shouldn’t. That was the hard part, and you made it look easy.' },
  { type: 'p', text: 'Now we want to hear those same situations the way they’d actually come up — a real back-and-forth with a patient, in your own words, not a spreadsheet row. That conversation becomes the permanent yardstick. Every future version of the system gets checked against exactly what you say should happen here. Your judgment, captured once, gets reused forever — instead of being re-argued every time someone tweaks the system.' },
  { type: 'p', text: 'It’s also genuinely quick. These aren’t case studies or essays — they’re the kind of exchange you have in your sleep. Most will take you well under a minute to think through.' },

  { type: 'h2', text: 'The one thing we want you to know before you start' },
  { type: 'callout', text: 'This doesn’t have to be perfect.' },
  { type: 'p', text: 'We are deliberately calling this a working set, not a finished one. If a scenario comes out slightly off, or you think of a better way to phrase it after the fact, that’s not a failure — that’s exactly how this is supposed to go. Getting something wrong here, on a practice conversation, is about as low-stakes as it gets. Getting it wrong on a real patient is the thing we’re trying to prevent, and this is how we prevent it.' },
  { type: 'p', text: 'We’ll come back to this together and sharpen it as we go. Nothing here is locked in.' },

  { type: 'h2', text: 'What “a conversation” means' },
  { type: 'p', text: 'It can be text or voice — whichever feels more natural to you — on the test WhatsApp channel we’ve provided. Keep it as close to a real-world exchange as possible.' },
  { type: 'p', text: 'A few things that make these more useful, not less:' },
  { type: 'bullet', lead: 'Talk the way a real patient talks to you —', text: 'a little hesitant, a little vague, maybe using the wrong word for something. That messiness is the point. A textbook-perfect description of a symptom is actually less useful to us than the slightly muddled real version, because muddled is what the system has to handle.' },
  { type: 'bullet', lead: 'Keep it short.', text: 'A handful of messages back and forth is plenty. You’re not writing a case report.' },
  { type: 'bullet', lead: 'After each one, jot down one line: what should happen.', text: 'Escalate now, tell them to come in today, just note it and move on, or nothing at all. That one line is the answer key — it’s the whole reason the conversation is worth having.' },

  { type: 'h2', text: 'What to cover' },
  { type: 'p', text: 'You’ll have a separate one-page menu for each condition, listing the situations we’d most like covered. For every one of them, we’d love two versions of the conversation:' },
  { type: 'bullet', lead: 'One where it should clearly escalate.', text: '' },
  { type: 'bullet', lead: 'One where it shouldn’t —', text: 'and if you can make that one a near-miss rather than an obviously-unrelated case, even better. The near-misses are where a system like this is most likely to get it wrong, and where your judgment is worth the most.' },
  { type: 'p', text: 'Some menus flag a situation that has no automatic rule behind it yet. For those, the system is relying entirely on judgment — reading your words and deciding — so a real conversation there matters more, not less.' },
  { type: 'p', text: 'If you have five extra minutes: one “everything is fine, routine check-in” conversation and one “two things going wrong at once” conversation are both genuinely useful and won’t appear on any menu.' },

  { type: 'h2', text: 'What happens with what you give us' },
  { type: 'p', text: 'These conversations become the set we test every future version of the system against — including versions built specifically in response to feedback from calls like this one. You’ll get to see, later, how the system actually performs against the exact scenarios you gave it. That’s the loop: your judgment sets the bar, and we show our work against it.' },
  { type: 'p', text: 'Thank you — genuinely. This is the part of the process that’s hardest to fake and easiest to get wrong without someone like you in the room.' },
];

const CONDITIONS = [
  {
    slug: 'Heart_Failure',
    name: 'Heart Failure',
    intro: 'Sixteen situations, grouped the way you’d actually think about them. For each pair, try one that should escalate and one that shouldn’t — the closer the “shouldn’t” version is to the line, the better.',
    note: 'One situation near the bottom has no automatic rule behind it yet. Your conversation is the only thing guiding the system there, so it’s especially worth doing.',
    themes: [
      ['1. Fluid & weight', [
        { tag: 'escalate', text: 'A patient tells you they’ve put on weight suddenly — they were 70 kg yesterday and they’re 72 kg today — and they’re also more breathless or puffier than usual.' },
        { tag: 'pair', text: 'Tell that exact same story again, changing one thing only: “two days ago” instead of “yesterday.” We already know the system treats those two differently, and we want both on record. Does that difference matter clinically? Your answer decides how hard we chase it.' },
        { tag: 'note', text: 'This is the one place we’re knowingly showing you a rough edge. Everything else on this list should behave the same however you phrase the timing — and where it doesn’t, we want to hear about it.' },
        { tag: 'not', text: 'Same story, but the weight gain is just under the line — say 1.8 kg over the week instead of 2 — and everything else about how they describe it (near-miss).' },
        { tag: 'also', text: 'Both legs are suddenly swollen after weeks of nothing, versus the swelling being the same on-and-off puffiness they’ve mentioned before.' },
        { tag: 'also', text: 'Peeing less than usual, more swelling, and some weight gain, versus peeing less and more swollen but the weight barely moved.' },
      ]],
      ['2. Breathing', [
        { tag: 'escalate', text: 'Short of breath just sitting still, or breathing that’s been quietly getting worse day after day even without a single dramatic moment.' },
        { tag: 'not', text: 'No breathlessness at rest, nothing unusual.' },
        { tag: 'also', text: 'Waking up gasping for air in the night, unable to get relief even sitting up — versus no nighttime breathing episodes at all.' },
        { tag: 'also', text: 'Now has to sleep sitting upright every night — versus sleeping flat exactly as always.' },
        { tag: 'also', text: 'Coughing up pink or frothy stuff — versus an ordinary dry cough.' },
      ]],
      ['3. Heart rhythm & chest', [
        { tag: 'escalate', text: 'Heart racing for a while, along with feeling faint or breathless with it — or chest tightness spreading into the arm or jaw.' },
        { tag: 'not', text: 'No racing heart, no chest pain or pressure at all.' },
        { tag: 'escalate', text: 'A full blackout — actually losing consciousness.' },
        { tag: 'not', text: 'No fainting.' },
        { tag: 'also', text: 'Two separate near-fainting spells in the same week — versus just one, with nothing before it.' },
      ]],
      ['4. Mental state & mood', [
        { tag: 'escalate', text: 'A caregiver mentions the patient suddenly seems confused or “not themselves” since yesterday.' },
        { tag: 'not', text: 'Alert and oriented as usual.' },
        { tag: 'escalate', text: 'Handle gently — the patient mentions thoughts of hurting themselves.' },
        { tag: 'not', text: 'No such thoughts when asked.' },
      ]],
      ['5. Medication & self-care', [
        { tag: 'escalate', text: 'The patient mentions they stopped one of their heart medications on their own a few days ago.' },
        { tag: 'not', text: 'They confirm they’ve been taking everything as prescribed.' },
      ]],
      ['6. One limb, standing out', [
        { tag: 'escalate', text: 'Just one leg — swollen, red, warm, and painful, unlike the other.' },
        { tag: 'not', text: 'Nothing like that reported.' },
      ]],
      ['7. No rule yet — your voice matters most here', [
        { tag: 'plain', text: 'Exercise tolerance that isn’t improving the way it should by three months in, or that seems out of step with how far along in recovery the patient is. This one has no automatic check behind it — a conversation here is especially valuable, because right now the system has nothing else to go on but how you describe it.' },
      ]],
    ],
  },
  {
    slug: 'Keratoplasty',
    name: 'Keratoplasty',
    intro: 'Twelve red flags, grouped the way you’d actually think about them. A couple have two timing-related versions (the early-recovery version and the “shows up later” version) — worth trying both if you have time, since they test different things.',
    note: 'Every situation on this list already has an automatic rule behind it, so every conversation you have here directly tests something the system is already trying to get right.',
    themes: [
      ['1. Vision', [
        { tag: 'escalate', text: 'Sudden loss of vision in the operated eye.' },
        { tag: 'not', text: 'Vision is stable, nothing sudden or progressive.' },
        { tag: 'escalate', text: 'Vision has been quietly getting worse over several days — not a single sudden moment, but a real decline.' },
        { tag: 'escalate', text: 'Vision suddenly gets much worse, clearly different from the gradual blur that’s expected after surgery.' },
        { tag: 'not', text: 'The usual gradual, expected blur — nothing sudden.' },
      ]],
      ['2. Pain', [
        { tag: 'escalate', text: 'Pain that comes back, or shows up, well past the first day or two after surgery — outside the window where a bit of ache is expected.' },
        { tag: 'not', text: 'Mild ache on day one, exactly as expected.' },
        { tag: 'escalate', text: 'A patient who’s been comfortable for weeks suddenly develops real pain for the first time.' },
        { tag: 'not', text: 'Pain that’s been present and unchanged since a prior check-in — same complaint, not a new one.' },
      ]],
      ['3. How the eye looks', [
        { tag: 'escalate', text: 'A visible white spot or patch on the operated eye.' },
        { tag: 'not', text: 'Nothing like that visible.' },
        { tag: 'escalate', text: 'Redness that hasn’t settled down when it should have, or shows up fresh well after surgery.' },
        { tag: 'not', text: 'Mild redness on day one that’s already resolving, as expected.' },
        { tag: 'escalate', text: 'Yellow or sticky discharge that’s stuck around for more than a day.' },
        { tag: 'not', text: 'Eye is clean and dry.' },
      ]],
      ['4. Pressure, light, and the combination that matters most', [
        { tag: 'escalate', text: 'The eye feels hard or under pressure, with halos around lights, pain, and a bit of nausea — that whole cluster together.' },
        { tag: 'not', text: 'None of that — no pressure, no halos, no nausea.' },
        { tag: 'escalate', text: 'New light sensitivity that wasn’t there before, in a patient who’s further along in recovery.' },
        { tag: 'not', text: 'Light sensitivity that’s been there for a while already — same complaint as last time, not new.' },
        { tag: 'escalate', text: 'Two of the four warning signs at once — say, redness and real pain together, even if neither alone would worry you as much.' },
        { tag: 'not', text: 'Just one of those four signs on its own, or none at all.' },
      ]],
      ['5. Trauma & structural emergencies', [
        { tag: 'escalate', text: 'The patient describes something in the eye “giving way,” with sudden pain and fluid leaking out.' },
        { tag: 'not', text: 'No sense of anything giving way, no leaking.' },
        { tag: 'escalate', text: 'An actual injury to the operated eye — a bump, a poke, anything — that also comes with pain or bleeding.' },
        { tag: 'escalate', text: 'Lower urgency, but still worth a same-day check — a minor bump to the eye where the patient says they otherwise feel fine.' },
        { tag: 'not', text: 'No injury of any kind.' },
      ]],
    ],
  },
];

const TAG_LABEL = {
  escalate: 'Escalate:',
  not: 'Shouldn’t escalate:',
  also: 'Also worth trying:',
  pair: 'Then say it once more:',
};
const TAG_COLOR = {
  escalate: ESCALATE,
  not: NOT_ESCALATE,
  also: undefined,
  pair: ACCENT,
};

// ─────────────────────────────────────────────────────────────────────────────
// DOCX renderer
// ─────────────────────────────────────────────────────────────────────────────

const numbering = {
  config: [{
    reference: 'bullets',
    levels: [{
      level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.2) } } },
    }],
  }],
};

function dTitle(text) {
  return new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text, bold: true, size: 40, color: ACCENT })],
  });
}

function dSubtitle(text) {
  return new Paragraph({
    spacing: { after: 300 },
    children: [new TextRun({ text, italics: true, size: 24, color: MUTED })],
  });
}

function dH1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    border: { bottom: { color: ACCENT, space: 4, style: BorderStyle.SINGLE, size: 6 } },
    children: [new TextRun({ text, bold: true, color: ACCENT, size: 30 })],
  });
}

function dH2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, bold: true, color: ACCENT, size: 24 })],
  });
}

function dH3(text) {
  return new Paragraph({
    spacing: { before: 240, after: 90 },
    children: [new TextRun({ text, bold: true, size: 22 })],
  });
}

function dP(text) {
  return new Paragraph({
    spacing: { after: 160, line: 300 },
    children: [new TextRun({ text, size: 22 })],
  });
}

function dCallout(text) {
  return new Paragraph({
    spacing: { before: 120, after: 240, line: 300 },
    border: {
      top: { color: ACCENT, space: 8, style: BorderStyle.SINGLE, size: 4 },
      bottom: { color: ACCENT, space: 8, style: BorderStyle.SINGLE, size: 4 },
      left: { color: ACCENT, space: 8, style: BorderStyle.SINGLE, size: 18 },
      right: { color: ACCENT, space: 8, style: BorderStyle.SINGLE, size: 4 },
    },
    indent: { left: convertInchesToTwip(0.15), right: convertInchesToTwip(0.15) },
    children: [new TextRun({ text, bold: true, size: 22 })],
  });
}

function dBullet(runs) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 100, line: 290 },
    children: runs,
  });
}

function dBlock(b) {
  switch (b.type) {
    case 'h2': return dH2(b.text);
    case 'p': return dP(b.text);
    case 'callout': return dCallout(b.text);
    case 'bullet': {
      const runs = [new TextRun({ text: b.lead, bold: true, size: 22 })];
      if (b.text) runs.push(new TextRun({ text: ' ' + b.text, size: 22 }));
      return dBullet(runs);
    }
    default: throw new Error('unknown block type: ' + b.type);
  }
}

function dMenuItem(item) {
  if (item.tag === 'plain') {
    return dBullet([new TextRun({ text: item.text, size: 22 })]);
  }
  if (item.tag === 'note') {
    return new Paragraph({
      spacing: { before: 60, after: 150, line: 290 },
      indent: { left: convertInchesToTwip(0.35) },
      children: [new TextRun({ text: item.text, italics: true, size: 21, color: MUTED })],
    });
  }
  return dBullet([
    new TextRun({ text: TAG_LABEL[item.tag] + ' ', bold: true, color: TAG_COLOR[item.tag], size: 22 }),
    new TextRun({ text: item.text, size: 22 }),
  ]);
}

function docWrap(children) {
  return new Document({
    numbering,
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, bottom: 1080, left: 1260, right: 1260 },
        },
      },
      children,
    }],
  });
}

function buildCommonDocx() {
  return docWrap([
    dTitle(COMMON_TITLE),
    dSubtitle(COMMON_SUBTITLE),
    ...COMMON_BLOCKS.map(dBlock),
  ]);
}

function buildMenuDocx(cond) {
  const children = [
    dTitle('Conversation Menu'),
    dSubtitle(cond.name),
    dP(cond.intro),
    dCallout(cond.note),
  ];
  for (const [title, items] of cond.themes) {
    children.push(dH3(title));
    for (const it of items) children.push(dMenuItem(it));
  }
  children.push(dH1('A reminder'));
  children.push(dP('Use this alongside “Your Voice Becomes the Standard,” which explains how to record these and what happens with them afterwards. Short is good, messy is good, and none of it has to be perfect.'));
  return docWrap(children);
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown renderer (same content, for git review)
// ─────────────────────────────────────────────────────────────────────────────

function mBlock(b) {
  switch (b.type) {
    case 'h2': return `## ${b.text}\n`;
    case 'p': return `${b.text}\n`;
    case 'callout': return `> **${b.text}**\n`;
    case 'bullet': return `- **${b.lead}**${b.text ? ' ' + b.text : ''}\n`;
    default: throw new Error('unknown block type: ' + b.type);
  }
}

function mMenuItem(item) {
  if (item.tag === 'plain') return `- ${item.text}\n`;
  if (item.tag === 'note') return `\n  *${item.text}*\n\n`;
  return `- **${TAG_LABEL[item.tag]}** ${item.text}\n`;
}

function buildCommonMd() {
  let out = `# ${COMMON_TITLE}\n\n*${COMMON_SUBTITLE}*\n\n`;
  for (const b of COMMON_BLOCKS) out += mBlock(b) + '\n';
  return out;
}

function buildMenuMd(cond) {
  let out = `# Conversation Menu\n\n*${cond.name}*\n\n${cond.intro}\n\n> **${cond.note}**\n\n`;
  for (const [title, items] of cond.themes) {
    out += `### ${title}\n\n`;
    for (const it of items) out += mMenuItem(it);
    out += '\n';
  }
  out += `## A reminder\n\nUse this alongside "Your Voice Becomes the Standard," which explains how to record these and what happens with them afterwards. Short is good, messy is good, and none of it has to be perfect.\n`;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  fs.writeFileSync('SME_Conversation_Guide.docx', await Packer.toBuffer(buildCommonDocx()));
  fs.writeFileSync('SME_Conversation_Guide.md', buildCommonMd());
  console.log('wrote SME_Conversation_Guide.{docx,md}');

  for (const cond of CONDITIONS) {
    const base = `Conversation_Menu_${cond.slug}`;
    fs.writeFileSync(`${base}.docx`, await Packer.toBuffer(buildMenuDocx(cond)));
    fs.writeFileSync(`${base}.md`, buildMenuMd(cond));
    console.log(`wrote ${base}.{docx,md}`);
  }
}

main();
