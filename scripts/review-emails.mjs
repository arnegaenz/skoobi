import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const STATUS_EMOJI = {
  needs_reply: '🙋',
  handled: '✅',
  unread: '📨',
  sent: '📤',
};

async function reviewEmails() {
  const filter = process.argv[2] || 'needs_reply';
  const validFilters = ['needs_reply', 'handled', 'unread', 'all'];

  if (!validFilters.includes(filter)) {
    console.log(`Usage: node review-emails.mjs [needs_reply|handled|unread|all]`);
    process.exit(1);
  }

  let query = supabase.from('emails').select('*').order('received_at', { ascending: false });
  if (filter !== 'all') query = query.eq('status', filter);

  const { data: emails, error } = await query;

  if (error) {
    console.error('Error fetching emails:', error.message);
    return;
  }

  if (!emails || emails.length === 0) {
    console.log(`No emails with status: ${filter}`);
    return;
  }

  console.log(`\n${STATUS_EMOJI[filter] || '📬'} ${emails.length} email(s) — filter: ${filter}\n`);
  console.log('─'.repeat(70));

  for (const email of emails) {
    const emoji = STATUS_EMOJI[email.status] || '•';
    console.log(`\n${emoji} [${email.category || 'uncategorized'}] ${email.subject}`);
    console.log(`   From:    ${email.from_name || ''} <${email.from_email}>`);
    console.log(`   Date:    ${new Date(email.received_at).toLocaleString()}`);
    console.log(`   Status:  ${email.status}`);
    console.log(`   ID:      ${email.id}`);

    if (email.aurora_notes) {
      console.log(`\n   Aurora's notes:\n   ${email.aurora_notes}`);
    }

    if (email.aurora_draft_response) {
      console.log(`\n   Draft response:\n   ${email.aurora_draft_response.split('\n').join('\n   ')}`);
    }

    if (email.body_text) {
      const preview = email.body_text.substring(0, 300).trim();
      console.log(`\n   Body preview:\n   ${preview}${email.body_text.length > 300 ? '...' : ''}`);
    }

    console.log('\n' + '─'.repeat(70));
  }

  // Summary
  const { data: all } = await supabase.from('emails').select('status, category');
  if (all) {
    const byStatus = all.reduce((acc, e) => {
      acc[e.status] = (acc[e.status] || 0) + 1;
      return acc;
    }, {});
    const byCategory = all.reduce((acc, e) => {
      if (e.category) acc[e.category] = (acc[e.category] || 0) + 1;
      return acc;
    }, {});

    console.log('\n📊 All-time summary:');
    Object.entries(byStatus).forEach(([s, c]) => console.log(`   ${STATUS_EMOJI[s] || '•'} ${s}: ${c}`));
    if (Object.keys(byCategory).length > 0) {
      console.log('\n   By category:');
      Object.entries(byCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, cnt]) => {
        console.log(`   ${cat}: ${cnt}`);
      });
    }
  }
}

reviewEmails();
