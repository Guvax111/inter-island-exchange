import type { EmailMessage } from './email.provider';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function render(to: string, subject: string, paragraphs: string[], action?: { label: string; url: string }): EmailMessage {
  const text = [...paragraphs, ...(action ? [`${action.label}: ${action.url}`] : []), '', 'Inter-Island Exchange'].join('\n\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a">
<h2 style="color:#0e7490">Inter-Island Exchange</h2>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
${action ? `<p><a href="${escapeHtml(action.url)}" style="background:#0e7490;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p><p style="font-size:12px;color:#64748b">Or paste this link into your browser: ${escapeHtml(action.url)}</p>` : ''}
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
  accountSuspended: (to: string, firstName: string) =>
    render(to, 'Your account has been suspended', [
      `Hi ${firstName},`,
      'Your Inter-Island Exchange account has been suspended. Please contact support if you believe this is a mistake.',
    ]),
};
