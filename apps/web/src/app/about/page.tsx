export const metadata = { title: 'About IIE' };

export default function AboutPage() {
  return (
    <section className="container max-w-3xl py-12">
      <h1 className="text-3xl font-bold text-ocean-900">About Inter-Island Exchange</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Inter-Island Exchange, Inc. (IIE) is building a digital marketplace and trade platform designed specifically for CARICOM, so that
        businesses and shoppers in one island can trade with another as easily as they buy locally.
      </p>
      <p className="mt-4 text-muted-foreground">
        IIE brings together sellers, buyers, licensed payment providers, logistics partners and customs brokers around a single transaction
        record, so everyone can see where an order is and what happens next.
      </p>
      <p className="mt-4 text-muted-foreground">
        Our first trade lane connects St. Lucia and St. Vincent and the Grenadines. More countries will follow.
      </p>
    </section>
  );
}
