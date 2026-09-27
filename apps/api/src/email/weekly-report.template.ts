import type { EmailMessage } from './email.provider';
import type { WeeklyFigures } from '../reports/reports.service';

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const list = (v: string[]) => (v.length ? v.join(', ') : 'none');

/** The directors' weekly email: plain tables that read well in any mail client, with a text version. */
export function weeklyReport(to: string, name: string, f: WeeklyFigures, url: string): EmailMessage {
  const sections: [string, [string, string | number][]][] = [
    [
      'Orders',
      [
        ['Placed', f.orders.placed!],
        ['Paid', f.orders.paid!],
        ['Delivered', f.orders.delivered!],
        ['Completed (seller paid)', f.orders.completed!],
        ['Cancelled (not paid)', f.orders.cancelled!],
        ['Refunded in full', f.orders.refunded!],
        ['In progress now', f.orders.inProgress!],
      ],
    ],
    ...(f.money.length ? [] : [['Money', [['No payments, refunds or payouts this week', '']]] as [string, [string, string | number][]]]),
    ...f.money.map(
      (m): [string, [string, string | number][]] => [
        `Money (${m.currency})`,
        [
          ['Gross sales (paid orders)', `${m.grossSales} (${m.paidOrders})`],
          ['IIE fees', m.iieFees],
          ['Refunds', `${m.refunds} (${m.refundCount})`],
          ['Paid to sellers', `${m.sellerPayouts} (${m.payoutCount})`],
        ],
      ],
    ),
    [
      'Owed between IIE and partners',
      [
        ['Provider to IIE: overdue', list(f.settlements.owedToIie.overdue)],
        ['Provider to IIE: due in 14 days', list(f.settlements.owedToIie.dueNext14Days)],
        ['Received this week', list(f.settlements.owedToIie.settledThisWeek)],
        ['IIE to logistics partners: overdue', list(f.settlements.owedByIie.overdue)],
        ['IIE to logistics partners: due in 14 days', list(f.settlements.owedByIie.dueNext14Days)],
        ['Paid this week', list(f.settlements.owedByIie.settledThisWeek)],
      ],
    ],
    [
      'Disputes',
      [
        ['Opened', f.disputes.opened!],
        ['Decided', f.disputes.decided!],
        ['Open now', f.disputes.openNow!],
      ],
    ],
    [
      'Growth',
      [
        ['New accounts', f.growth.newAccounts!],
        ['Sellers approved', f.growth.sellersApproved!],
        ['Products published', f.growth.productsPublished!],
        ['Reviews published', f.growth.reviewsPublished!],
      ],
    ],
    [
      'Waiting on IIE',
      [
        ['Sellers to review', f.waitingOnIie.sellersToReview!],
        ['Products to review', f.waitingOnIie.productsToReview!],
        ['Reviews to moderate', f.waitingOnIie.reviewsToModerate!],
        ['Messages awaiting a reply', f.waitingOnIie.messagesAwaitingReply!],
        ['Open disputes', f.waitingOnIie.openDisputes!],
        ['Orders on hold', f.waitingOnIie.ordersOnHold!],
      ],
    ],
    ['Trade lanes (paid orders)', f.lanes.length ? f.lanes.map((l) => [l.lane, `${l.orders} orders, ${l.grossSales}`]) : [['No paid orders', '']]],
  ];
  const subject = `IIE weekly report: ${f.period.label}`;
  const text = [
    `Hi ${name},`,
    `Inter-Island Exchange, week of ${f.period.label} (St. Vincent time).`,
    ...sections.map(([title, rows]) => [title.toUpperCase(), ...rows.map(([k, v]) => `  ${k}: ${v}`)].join('\n')),
    `Full report: ${url}`,
  ].join('\n\n');
  const table = (title: string, rows: [string, string | number][]) => `
<h3 style="color:#024381;margin:24px 0 8px">${esc(title)}</h3>
<table style="border-collapse:collapse;width:100%">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${esc(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:bold">${esc(v)}</td></tr>`)
    .join('')}</table>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#011e4d">
<h2 style="color:#024381">Inter-Island Exchange: weekly report</h2>
<p>Hi ${esc(name)},</p>
<p>Week of <strong>${esc(f.period.label)}</strong> (St. Vincent time).</p>
${sections.map(([t, r]) => table(t, r)).join('\n')}
<p style="margin-top:24px"><a href="${esc(url)}" style="background:#024381;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Open reports</a></p>
<p style="font-size:12px;color:#64748b">Payments are held by IIE's licensed payment provider. Figures are from IIE's records at ${esc(f.generatedAt)}.</p>
</div>`;
  return { to, subject, text, html };
}
