import type { EmailMessage } from './email.provider';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function render(to: string, subject: string, paragraphs: string[], action?: { label: string; url: string }): EmailMessage {
  const text = [...paragraphs, ...(action ? [`${action.label}: ${action.url}`] : []), '', 'Inter-Island Exchange'].join('\n\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#011e4d">
<h2 style="color:#024381">Inter-Island Exchange</h2>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
${action ? `<p><a href="${escapeHtml(action.url)}" style="background:#024381;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p><p style="font-size:12px;color:#64748b">Or paste this link into your browser: ${escapeHtml(action.url)}</p>` : ''}
</div>`;
  return { to, subject, text, html };
}

export const templates = {
  verifyEmail: (to: string, firstName: string, url: string) =>
    render(
      to,
      'Confirm your email address',
      [`Hi ${firstName},`, 'Welcome to Inter-Island Exchange. Please confirm your email address. This link expires in 24 hours.'],
      { label: 'Confirm email', url },
    ),
  registrationAttempt: (to: string, firstName: string, loginUrl: string, resetUrl: string) =>
    render(to, 'Someone tried to register with your email', [
      `Hi ${firstName},`,
      'Someone tried to create an Inter-Island Exchange account with this email address, which already has an account.',
      `If this was you, sign in at ${loginUrl}. If you forgot your password, reset it at ${resetUrl}.`,
      'If this was not you, you can ignore this email.',
    ]),
  passwordReset: (to: string, firstName: string, url: string) =>
    render(
      to,
      'Reset your password',
      [`Hi ${firstName},`, 'We received a request to reset your password. This link expires in 1 hour. If you did not ask for this, ignore this email.'],
      { label: 'Reset password', url },
    ),
  passwordChanged: (to: string, firstName: string) =>
    render(to, 'Your password was changed', [
      `Hi ${firstName},`,
      'Your Inter-Island Exchange password was just changed and your other sessions were signed out.',
      'If you did not do this, reset your password immediately and contact support.',
    ]),
  sellerDecision: (to: string, firstName: string, decision: 'approved' | 'rejected' | 'changes_requested' | 'activated' | 'suspended', notes: string | undefined, url: string) => {
    const copy = {
      approved: ['Your seller application is approved', 'Good news: IIE has approved your seller application. Our team will contact you to set up how you receive payouts. You can start preparing your storefront and products now; they go live once payouts are set up.'],
      activated: ['Your store is live', 'Payout setup is complete and your seller account is active. Approved products now appear on the marketplace.'],
      rejected: ['Update on your seller application', 'We are unable to approve your seller application at this time.'],
      changes_requested: ['Your seller application needs changes', 'Please update your seller details and submit them again.'],
      suspended: ['Your seller account has been suspended', 'Your products are hidden from the marketplace while your seller account is suspended. Contact support if you believe this is a mistake.'],
    }[decision];
    return render(to, copy[0]!, [`Hi ${firstName},`, copy[1]!, ...(notes ? [`Note from the IIE team: ${notes}`] : [])], { label: 'Open seller dashboard', url });
  },
  productDecision: (to: string, firstName: string, title: string, decision: 'approved' | 'rejected' | 'changes_requested', notes: string | undefined, url: string) => {
    const copy = {
      approved: [`"${title}" is approved`, 'Your product passed review and is now on the marketplace (while your store is active and the item is in stock).'],
      rejected: [`"${title}" was not approved`, 'This product cannot be listed on IIE.'],
      changes_requested: [`"${title}" needs changes`, 'Please update the product and submit it for review again.'],
    }[decision];
    return render(to, copy[0]!, [`Hi ${firstName},`, copy[1]!, ...(notes ? [`Note from the IIE team: ${notes}`] : [])], { label: 'Open product', url });
  },
  orderPlaced: (to: string, firstName: string, iieId: string, total: string, url: string) =>
    render(
      to,
      `Order ${iieId}: complete your payment`,
      [
        `Hi ${firstName},`,
        `Your order ${iieId} is placed and your items are reserved. Please complete payment of ${total} within 30 minutes, or the order is cancelled and the items released.`,
        'Keep this order number: every step of your delivery is tracked under it.',
      ],
      { label: 'View order', url },
    ),
  orderCancelled: (to: string, firstName: string, iieId: string, reason: string, url: string) =>
    render(to, `Order ${iieId} cancelled`, [`Hi ${firstName},`, reason, 'You have not been charged.'], { label: 'View order', url }),
  transactionUpdate: (to: string, firstName: string, subject: string, message: string, url: string) =>
    render(to, subject, [`Hi ${firstName},`, message], { label: 'View order', url }),
  partnerInvited: (to: string, firstName: string, partnerName: string, url: string) =>
    render(
      to,
      `You have been added to ${partnerName} on Inter-Island Exchange`,
      [
        `Hi ${firstName},`,
        `Inter-Island Exchange has given you access to the IIE partner portal for ${partnerName}, where you see and update the shipments assigned to ${partnerName}.`,
        'Choose your password to get started. This link expires in 72 hours. If you were not expecting this, ignore this email.',
      ],
      { label: 'Choose your password', url },
    ),
  partnerMemberAdded: (to: string, firstName: string, partnerName: string, url: string) =>
    render(
      to,
      `You have been added to ${partnerName} on Inter-Island Exchange`,
      [`Hi ${firstName},`, `You can now see and update the shipments assigned to ${partnerName} in the IIE partner portal. Sign in with your existing IIE account.`],
      { label: 'Open the partner portal', url },
    ),
  partnerUpdate: (to: string, firstName: string, subject: string, message: string, url: string) =>
    render(to, subject, [`Hi ${firstName},`, message], { label: 'Open shipment', url }),
  accountSuspended: (to: string, firstName: string) =>
    render(to, 'Your account has been suspended', [
      `Hi ${firstName},`,
      'Your Inter-Island Exchange account has been suspended. Please contact support if you believe this is a mistake.',
    ]),
};
