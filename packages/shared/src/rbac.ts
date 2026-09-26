/**
 * Role and permission catalogue. This is the source of truth that the database seed syncs from;
 * enforcement always happens server-side against the database copy.
 *
 * "Guest" is the absence of a session. "Buyer + Seller" is two role assignments.
 */
export const PERMISSIONS = [
  // Own account
  'profile.read.own',
  'profile.update.own',
  'session.manage.own',
  'account.delete.own',
  // Buying (Phase 2+)
  'cart.manage.own',
  'order.create',
  'order.read.own',
  'dispute.create.own',
  'saved.manage.own',
  // Selling (Phase 2+)
  'product.manage.own',
  'order.fulfil.own',
  'payout.read.own',
  // Partners (Phase 4+)
  'shipment.read.assigned',
  'shipment.update.assigned',
  'customs.document.manage',
  'payment.reconcile.assigned',
  // Operations
  'user.read.any',
  'transaction.read.any',
  'compliance.review',
  'seller.review',
  'product.review',
  'user.suspend',
  'user.roles.manage',
  'country.manage',
  'audit.read',
  'payout.approve',
  'config.manage',
  'category.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  'buyer',
  'business_buyer',
  'seller',
  'business_seller',
  'logistics_partner',
  'freight_consolidator',
  'customs_broker',
  'payment_partner',
  'customer_support',
  'compliance_officer',
  'country_admin',
  'super_admin',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles a person can give themselves at sign-up. Everything else is granted by an administrator. */
export const SELF_REGISTRABLE_ROLES = ['buyer', 'seller'] as const satisfies readonly Role[];

/** Roles whose assignment must be limited to one country. */
export const COUNTRY_SCOPED_ROLES = ['country_admin'] as const satisfies readonly Role[];

const OWN_ACCOUNT: Permission[] = ['profile.read.own', 'profile.update.own', 'session.manage.own', 'account.delete.own'];
const BUYING: Permission[] = ['cart.manage.own', 'order.create', 'order.read.own', 'dispute.create.own', 'saved.manage.own'];
const SELLING: Permission[] = ['product.manage.own', 'order.fulfil.own', 'order.read.own', 'payout.read.own'];
const LOGISTICS: Permission[] = ['shipment.read.assigned', 'shipment.update.assigned', 'customs.document.manage'];

export const ROLE_DEFINITIONS: Record<Role, { name: string; description: string; permissions: Permission[] }> = {
  buyer: { name: 'Buyer', description: 'Buys products on the marketplace', permissions: [...OWN_ACCOUNT, ...BUYING] },
  business_buyer: { name: 'Business Buyer', description: 'Verified business purchasing account', permissions: [...OWN_ACCOUNT, ...BUYING] },
  seller: { name: 'Seller', description: 'Lists and sells products', permissions: [...OWN_ACCOUNT, ...SELLING] },
  business_seller: { name: 'Business Seller', description: 'Verified business selling account', permissions: [...OWN_ACCOUNT, ...SELLING] },
  logistics_partner: { name: 'Logistics Partner', description: 'Carrier or last-mile delivery partner', permissions: [...OWN_ACCOUNT, ...LOGISTICS] },
  freight_consolidator: { name: 'Freight Consolidator', description: 'Consolidates and ships regional freight', permissions: [...OWN_ACCOUNT, ...LOGISTICS] },
  customs_broker: { name: 'Customs Broker', description: 'Handles customs documentation and clearance', permissions: [...OWN_ACCOUNT, 'shipment.read.assigned', 'customs.document.manage'] },
  payment_partner: { name: 'Payment Partner', description: 'Licensed payment provider staff (reconciliation)', permissions: [...OWN_ACCOUNT, 'payment.reconcile.assigned'] },
  customer_support: { name: 'Customer Support', description: 'Helps users; read-only access to accounts and transactions', permissions: [...OWN_ACCOUNT, 'user.read.any', 'transaction.read.any'] },
  compliance_officer: {
    name: 'Compliance Officer',
    description: 'Reviews KYC, sellers and suspicious activity',
    permissions: [...OWN_ACCOUNT, 'user.read.any', 'transaction.read.any', 'compliance.review', 'seller.review', 'user.suspend', 'audit.read'],
  },
  country_admin: {
    name: 'Country Administrator',
    description: 'Administers one country (assignment is country-scoped)',
    permissions: [...OWN_ACCOUNT, 'user.read.any', 'transaction.read.any', 'seller.review', 'product.review', 'user.suspend', 'country.manage', 'audit.read'],
  },
  super_admin: { name: 'Super Administrator', description: 'Full platform administration', permissions: [...PERMISSIONS] },
};
