import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  // Auth check
  const token = req.query.token || req.headers['authorization']?.replace('Bearer ', '');
  if (token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY
    );

    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.ZOHO_EMAIL,
        pass: process.env.ZOHO_PASSWORD,
      },
    });

    // Get emails from last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: emails, error } = await supabase
      .from('emails')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Also get any older emails still needing reply
    const { data: pendingEmails } = await supabase
      .from('emails')
      .select('*')
      .eq('status', 'needs_reply')
      .lt('created_at', since)
      .order('created_at', { ascending: true });

    // Build stats
    const byCategory = {};
    const byStatus = {};
    const byApp = {};
    for (const e of emails || []) {
      byCategory[e.category] = (byCategory[e.category] || 0) + 1;
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
      const app = e.app_tag || 'unknown';
      byApp[app] = (byApp[app] || 0) + 1;
    }

    const total = emails?.length || 0;
    const sent = byStatus['sent'] || 0;
    const handled = byStatus['handled'] || 0;
    const needsReply = byStatus['needs_reply'] || 0;
    const spam = byStatus['spam'] || 0;
    const olderPending = pendingEmails?.length || 0;

    // Build email body
    const lines = [];
    lines.push('Good morning, Arne!\n');
    lines.push(`Here's your daily email summary from Aurora.\n`);

    lines.push('--- LAST 24 HOURS ---\n');

    if (total === 0) {
      lines.push('No new emails came in. Quiet day!\n');
    } else {
      lines.push(`Total emails: ${total}`);
      lines.push(`  Aurora sent replies: ${sent}`);
      lines.push(`  Aurora handled (no reply needed): ${handled}`);
      lines.push(`  Needs your attention: ${needsReply}`);
      lines.push(`  Spam filtered: ${spam}\n`);

      // Breakdown by category
      lines.push('By category:');
      for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${cat}: ${count}`);
      }
      lines.push('');

      // Breakdown by app
      const appEntries = Object.entries(byApp).sort((a, b) => b[1] - a[1]);
      if (appEntries.length > 0) {
        lines.push('By app:');
        for (const [app, count] of appEntries) {
          lines.push(`  ${app}: ${count}`);
        }
        lines.push('');
      }

      // List emails needing reply
      const needsReplyEmails = (emails || []).filter(e => e.status === 'needs_reply');
      if (needsReplyEmails.length > 0) {
        lines.push('NEEDS YOUR REPLY (new):');
        for (const e of needsReplyEmails) {
          lines.push(`  - "${e.subject}" from ${e.from_name || e.from_email} [${e.app_tag || 'unknown'}]`);
          if (e.aurora_notes) lines.push(`    Aurora's take: ${e.aurora_notes}`);
        }
        lines.push('');
      }

      // List what Aurora handled
      const auroraHandled = (emails || []).filter(e => e.status === 'sent');
      if (auroraHandled.length > 0) {
        lines.push('AURORA REPLIED TO:');
        for (const e of auroraHandled) {
          lines.push(`  - "${e.subject}" from ${e.from_name || e.from_email} [${e.category}]`);
        }
        lines.push('');
      }
    }

    // Older pending items
    if (olderPending > 0) {
      lines.push('--- STILL AWAITING YOUR ATTENTION ---\n');
      for (const e of pendingEmails) {
        const age = Math.round((Date.now() - new Date(e.created_at).getTime()) / (1000 * 60 * 60));
        lines.push(`  - "${e.subject}" from ${e.from_name || e.from_email} (${age}h ago)`);
        if (e.aurora_notes) lines.push(`    Aurora's take: ${e.aurora_notes}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('— Aurora @ SkoobiLabs');

    const body = lines.join('\n');

    // Send summary email
    await transporter.sendMail({
      from: `Aurora @ SkoobiLabs <${process.env.ZOHO_EMAIL}>`,
      to: 'arne@skoobi.com',
      subject: `Daily Email Summary — ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
      text: body,
    });

    return res.status(200).json({
      ok: true,
      emailsSummarized: total,
      pendingOlder: olderPending,
      sentTo: 'arne@skoobi.com',
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
}
