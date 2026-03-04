import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.ZOHO_EMAIL,
    pass: process.env.ZOHO_PASSWORD,
  },
});

const imapConfig = {
  host: process.env.ZOHO_IMAP_HOST,
  port: Number(process.env.ZOHO_IMAP_PORT),
  secure: true,
  auth: {
    user: process.env.ZOHO_EMAIL,
    pass: process.env.ZOHO_PASSWORD,
  },
  logger: false,
};

// Aurora's folder structure
const FOLDERS = {
  INBOX: 'INBOX',
  NEEDS_REPLY: 'Needs Reply',
  BUG_REPORTS: 'Bug Reports',
  FEATURE_REQUESTS: 'Feature Requests',
  SUPPORT: 'Support',
  PRAISE: 'Praise',
  WAITLIST: 'Waitlist',
  QUESTIONS: 'Questions',
  SPAM: 'Spam',
};

// Folders Zoho might sneak emails into — Aurora checks these too
const SCAN_FOLDERS = ['INBOX', 'Notification', 'Newsletter'];

const CATEGORY_TO_FOLDER = {
  bug_report: FOLDERS.BUG_REPORTS,
  feature_request: FOLDERS.FEATURE_REQUESTS,
  support: FOLDERS.SUPPORT,
  praise: FOLDERS.PRAISE,
  waitlist: FOLDERS.WAITLIST,
  question: FOLDERS.QUESTIONS,
  spam: FOLDERS.SPAM,
  other: FOLDERS.QUESTIONS,
};

// Zoho junk folders we don't want (cleaned up AFTER scanning)
const FOLDERS_TO_DELETE = ['Drafts', 'Sent', 'Trash', 'Snoozed', 'Templates', 'Sent Messages', 'Deleted Messages'];

async function setupFolders(client) {
  const existing = new Set();
  const mailboxes = await client.list();
  for (const mailbox of mailboxes) existing.add(mailbox.path);

  // Create Aurora's folders
  for (const folder of Object.values(FOLDERS).filter(f => f !== FOLDERS.INBOX)) {
    if (!existing.has(folder)) {
      await client.mailboxCreate(folder);
      console.log(`  Created folder: ${folder}`);
    }
  }

  return existing;
}

async function cleanupFolders(client) {
  const existing = new Set();
  const mailboxes = await client.list();
  for (const mailbox of mailboxes) existing.add(mailbox.path);

  // Delete junk Zoho folders and empty scan folders
  const allToDelete = [...FOLDERS_TO_DELETE, ...SCAN_FOLDERS.filter(f => f !== 'INBOX')];
  for (const folder of allToDelete) {
    if (existing.has(folder)) {
      try {
        await client.mailboxDelete(folder);
        console.log(`  Cleaned up folder: ${folder}`);
      } catch { /* system folders can't be deleted — skip */ }
    }
  }
}

async function triageEmail(email) {
  const prompt = `You are Aurora, the AI assistant for SkoobiLabs — a mobile app studio building iPhone/Android apps. You also help with Skoobi, a collectibles platform (books, coins, cards, vinyl, etc).

An email came in to ask@skoobilabs.com. Your job is to:
1. Categorize it
2. Decide if you can handle it or if Arne (the founder) needs to personally respond
3. Draft a warm, helpful reply if you can handle it

Email details:
From: ${email.from_name || ''} <${email.from_email}>
Subject: ${email.subject}
Body:
${email.body_text?.substring(0, 3000) || '(no body)'}

Respond ONLY with valid JSON in this exact format:
{
  "category": "bug_report|feature_request|support|praise|waitlist|question|spam|other",
  "needs_human": true|false,
  "aurora_notes": "Brief triage notes — what is this email about, why does/doesn't it need human reply",
  "aurora_draft_response": "Full draft reply text, or null if spam/needs_human"
}

Guidelines:
- needs_human: true for partnerships, business decisions, serious complaints, or personal matters Arne should handle
- needs_human: false for general questions, praise, feature requests you can acknowledge, support you can answer, waitlist confirmations
- Keep draft responses friendly and concise, signed "— Aurora @ SkoobiLabs"
- For spam: needs_human false, draft null
- waitlist: someone who signed up or is excited to hear more about Skoobi or SkoobiLabs
- IMPORTANT: For Formspree notifications (from noreply@formspree.io), extract the REAL person's email from the body (look for "email:" field) and put it in a "reply_to_email" field in your JSON response. This is the actual person to reply to, not noreply@formspree.io.
- For waitlist signups: ALWAYS send a warm, excited welcome message. Never mention testing, never reference who the person is. Treat every signup as a real new user. Example tone: "Welcome to the Skoobi waitlist! We're building something special for collectors — books, coins, cards, vinyl, and beyond. We'll keep you posted as things come together. Thanks for being an early believer!"

If this is a Formspree notification, add this field to your JSON:
  "reply_to_email": "the-actual-persons-email@example.com"`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const cleaned = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleaned);
}

async function sendReply(toEmail, toName, subject, body) {
  await transporter.sendMail({
    from: `Aurora @ SkoobiLabs <${process.env.ZOHO_EMAIL}>`,
    to: toName ? `${toName} <${toEmail}>` : toEmail,
    subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
    text: body,
  });
}

function folderForRecord(record) {
  if (record.status === 'needs_reply') return FOLDERS.NEEDS_REPLY;
  return CATEGORY_TO_FOLDER[record.category] || FOLDERS.QUESTIONS;
}

async function processFolder(client, folderName, existingFolders) {
  if (!existingFolders.has(folderName)) return;

  const lock = await client.getMailboxLock(folderName);
  const toMove = {}; // folder → [uids]

  try {
    const messages = [];

    for await (const message of client.fetch('1:*', {
      envelope: true,
      source: true,
      uid: true,
    })) {
      const from = message.envelope.from?.[0] || {};
      const rawSource = message.source?.toString() || '';
      const bodyParts = rawSource.split('\r\n\r\n');
      const bodyText = bodyParts.length > 1
        ? bodyParts.slice(1).join('\n\n').substring(0, 10000)
        : rawSource.substring(0, 10000);

      messages.push({
        uid: message.uid,
        from_email: from.address || 'unknown',
        from_name: from.name || null,
        subject: message.envelope.subject || '(no subject)',
        body_text: bodyText,
        received_at: message.envelope.date?.toISOString() || new Date().toISOString(),
      });
    }

    if (messages.length === 0) {
      console.log(`  ${folderName}: empty`);
      return;
    }

    console.log(`  ${folderName}: ${messages.length} email(s) found\n`);

    for (const msg of messages) {
      // Check if already processed in Supabase
      const { data: existing } = await supabase
        .from('emails')
        .select('id, status, category')
        .eq('from_email', msg.from_email)
        .eq('subject', msg.subject)
        .eq('received_at', msg.received_at)
        .limit(1);

      if (existing && existing.length > 0) {
        // Already processed — just move to the right folder
        const folder = folderForRecord(existing[0]);
        console.log(`    Straggler → ${folder}: "${msg.subject}"`);
        if (!toMove[folder]) toMove[folder] = [];
        toMove[folder].push(msg.uid);
        continue;
      }

      // Brand new email — triage it
      console.log(`    Triaging: "${msg.subject}" from ${msg.from_email}`);

      let triage;
      try {
        triage = await triageEmail(msg);
      } catch (err) {
        console.error(`    Triage failed: ${err.message}`);
        triage = {
          category: 'other',
          needs_human: true,
          aurora_notes: 'Triage failed — needs manual review',
          aurora_draft_response: null,
        };
      }

      const folder = triage.needs_human
        ? FOLDERS.NEEDS_REPLY
        : (CATEGORY_TO_FOLDER[triage.category] || FOLDERS.QUESTIONS);

      // Auto-send reply if Aurora is handling it
      let finalStatus = triage.needs_human ? 'needs_reply' : 'handled';
      if (!triage.needs_human && triage.aurora_draft_response && triage.category !== 'spam') {
        const replyTo = triage.reply_to_email || msg.from_email;
        const replyName = triage.reply_to_email ? null : msg.from_name;
        try {
          await sendReply(replyTo, replyName, msg.subject, triage.aurora_draft_response);
          finalStatus = 'sent';
          console.log(`    📤 Reply sent to ${replyTo}`);
        } catch (sendErr) {
          console.error(`    Send failed: ${sendErr.message}`);
        }
      }

      // Save to Supabase
      const { error } = await supabase.from('emails').insert({
        from_email: msg.from_email,
        from_name: msg.from_name,
        subject: msg.subject,
        body_text: msg.body_text,
        received_at: msg.received_at,
        status: finalStatus,
        category: triage.category,
        aurora_notes: triage.aurora_notes,
        aurora_draft_response: triage.aurora_draft_response,
      });

      if (error) {
        console.error(`    Supabase error: ${error.message} — routing to Needs Reply`);
        if (!toMove[FOLDERS.NEEDS_REPLY]) toMove[FOLDERS.NEEDS_REPLY] = [];
        toMove[FOLDERS.NEEDS_REPLY].push(msg.uid);
      } else {
        const flag = triage.needs_human ? '🙋 NEEDS YOU' : '✅ Aurora handled';
        console.log(`    ${flag} [${triage.category}] → ${folder}`);
        if (!toMove[folder]) toMove[folder] = [];
        toMove[folder].push(msg.uid);
      }
    }

    // Move all emails to their proper folders
    for (const [folder, uids] of Object.entries(toMove)) {
      await client.messageMove(uids, folder, { uid: true });
      console.log(`    Moved ${uids.length} email(s) → ${folder}`);
    }

  } finally {
    lock.release();
  }
}

async function fetchAndProcess() {
  const client = new ImapFlow(imapConfig);

  try {
    await client.connect();
    console.log('Aurora connected to Zoho IMAP\n');

    const existingFolders = await setupFolders(client);

    // Scan all folders where Zoho might hide emails
    for (const folder of SCAN_FOLDERS) {
      await processFolder(client, folder, existingFolders);
    }

    // Clean up junk folders now that they're empty
    await cleanupFolders(client);

    await client.logout();
    console.log('\nDone! All folders cleared.');

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

fetchAndProcess();
