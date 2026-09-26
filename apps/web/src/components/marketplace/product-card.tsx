import Link from 'next/link';
import { BadgeCheck, ImageOff } from 'lucide-react';
import type { ProductCard as Card } from '@/lib/types';

export function ProductCard({ product }: { product: Card }) {
  return (
    <Link href={`/products/${product.id}`} className="group flex h-full flex-col overflow-hidden rounded-lg border bg-white transition hover:border-ocean-600 hover:shadow-md">
      <div className="flex aspect-square items-center justify-center bg-muted">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <ImageOff className="h-8 w-8 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 font-medium group-hover:text-ocean-800">{product.title}</p>
        <p className="text-lg font-semibold text-ocean-900">
          {product.priceFrom.formatted}
          <span className="ml-1 text-xs font-normal text-muted-foreground">{product.priceFrom.currency}</span>
        </p>
        {!product.inStock && <p className="text-xs font-medium text-coral-600">Out of stock</p>}
        <p className="mt-auto flex items-center gap-1 pt-2 text-xs text-muted-foreground">
          {product.seller.verified !== false && <BadgeCheck className="h-3.5 w-3.5 text-ocean-700" aria-label="IIE-verified seller" />}
          {product.seller.name} · {product.seller.countryName}
        </p>
      </div>
    </Link>
  );
}

export function ProductGrid({ products, empty }: { products: Card[]; empty: string }) {
  if (!products.length) return <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <li key={p.id}>
          <ProductCard product={p} />
        </li>
      ))}
    </ul>
  );
}
