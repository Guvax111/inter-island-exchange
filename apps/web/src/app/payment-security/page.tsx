export const metadata = { title: 'Payment & Transaction Security' };

export default function PaymentSecurityPage() {
  return (
    <section className="container max-w-3xl py-12">
      <h1 className="text-3xl font-bold text-ocean-900">Payment &amp; Transaction Security</h1>
      <h2 className="mt-8 text-xl font-semibold">The IIE Transaction Safeguard</h2>
      <p className="mt-2 text-muted-foreground">
        When you pay for an order, your payment is processed and held by a licensed payment partner, not by IIE. The seller is paid only after
        you confirm delivery and a short review window has passed, or after any issue you report has been resolved.
      </p>
      <p className="mt-2 rounded-md bg-muted p-4 text-sm">
        <strong>Test mode.</strong> Payments currently run on a sandbox (test) payment page: no real money moves and no card is charged. IIE will announce its licensed payment partner before
        the marketplace opens.
      </p>
      <h2 className="mt-8 text-xl font-semibold">What happens after you pay</h2>
      <ul className="mt-2 list-disc space-y-2 pl-6 text-muted-foreground">
        <li>You pay on the payment partner&apos;s own secure page. Your card details never reach IIE.</li>
        <li>The seller has 48 hours to confirm they can supply your order. If they decline or do not answer, you are refunded in full automatically.</li>
        <li>The seller is paid 7 days after you confirm delivery. Until then you can report a problem; IIE reviews it and can refund you in full or in part.</li>
        <li>Import duties and taxes shown at checkout are an estimate. They are not collected by IIE; you pay them on arrival, based on customs&apos; own assessment.</li>
        <li>Every payment, refund and payout is recorded in a ledger that cannot be edited, under your order&apos;s IIE transaction ID.</li>
      </ul>
      <h2 className="mt-8 text-xl font-semibold">Protecting your account</h2>
      <ul className="mt-2 list-disc space-y-2 pl-6 text-muted-foreground">
        <li>Passwords are stored using a one-way, memory-hard hash. IIE staff cannot see them.</li>
        <li>You can turn on two-step verification with an authenticator app.</li>
        <li>You can see every device signed in to your account and sign any of them out.</li>
        <li>IIE will never store your full card number.</li>
      </ul>
    </section>
  );
}
