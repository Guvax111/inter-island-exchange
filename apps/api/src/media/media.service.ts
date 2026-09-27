import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, or } from 'drizzle-orm';
import sharp, { type OutputInfo } from 'sharp';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Database, DB, Tx } from '../db/db';
import { countries, deliveryProofs, disputeMessages, disputes, mediaAssets, partnerMembers, productImages, products, sellerProfiles, sellerStorefronts, shipments, transactions, users } from '../db/schema';
import { AppError, Errors } from '../common/errors';
import { isPublicStatus, PUBLIC_PRODUCT_JOINS } from '../catalog/visibility';
import type { Principal } from '../rbac/principal';
import { STORAGE_PROVIDER, StorageProvider } from './storage.provider';

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_EDGE = 1600;
const MAX_INPUT_PIXELS = 40_000_000;

export type MediaKind = 'PRODUCT_IMAGE' | 'STORE_LOGO' | 'DELIVERY_PHOTO' | 'DELIVERY_SIGNATURE' | 'DISPUTE_EVIDENCE';

const KIND_STORAGE: Record<MediaKind, { prefix: string; maxEdge: number }> = {
  PRODUCT_IMAGE: { prefix: 'products', maxEdge: MAX_EDGE },
  STORE_LOGO: { prefix: 'logos', maxEdge: 512 },
  DELIVERY_PHOTO: { prefix: 'deliveries', maxEdge: MAX_EDGE },
  DELIVERY_SIGNATURE: { prefix: 'signatures', maxEdge: 800 },
  DISPUTE_EVIDENCE: { prefix: 'disputes', maxEdge: MAX_EDGE },
};

@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Validates an upload by its actual content (not its name or declared type), applies EXIF rotation,
   * resizes to fit 1600px, re-encodes as WebP and drops all metadata (including GPS location).
   */
  async storeImage(tx: Tx, ownerUserId: string, kind: MediaKind, file: { buffer: Buffer; size: number } | undefined) {
    if (!file) throw Errors.badRequest('FILE_REQUIRED', 'Choose an image to upload');
    if (file.size > this.config.MAX_UPLOAD_MB * 1024 * 1024) {
      throw new AppError(HttpStatus.PAYLOAD_TOO_LARGE, 'FILE_TOO_LARGE', `Images must be ${this.config.MAX_UPLOAD_MB} MB or smaller`);
    }
    let output: { data: Buffer; info: OutputInfo };
    try {
      const image = sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
      const meta = await image.metadata();
      if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) throw new Error('unsupported');
      const size = KIND_STORAGE[kind].maxEdge;
      // Signatures are drawn on a transparent canvas: flatten onto white so they stay readable.
      const prepared = kind === 'DELIVERY_SIGNATURE' ? image.flatten({ background: '#ffffff' }) : image;
      output = await prepared.rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    } catch {
      throw Errors.badRequest('UNSUPPORTED_IMAGE', 'Upload a JPEG, PNG or WebP image');
    }
    const storageKey = `${KIND_STORAGE[kind].prefix}/${randomUUID()}.webp`;
    await this.storage.put(storageKey, output.data, 'image/webp');
    const [asset] = await tx
      .insert(mediaAssets)
      .values({
        ownerUserId,
        kind,
        storageKey,
        contentType: 'image/webp',
        width: output.info.width,
        height: output.info.height,
        bytes: output.info.size,
      })
      .returning();
    return asset!;
  }

  /**
   * Deletes the media row inside the caller's transaction and returns its storage key. Call deleteFile()
   * with the key only after the transaction commits, so a rollback never leaves a row without its file.
   */
  async detach(tx: Tx, mediaId: string): Promise<string | null> {
    const [asset] = await tx.delete(mediaAssets).where(eq(mediaAssets.id, mediaId)).returning();
    return asset?.storageKey ?? null;
  }

  async deleteFile(storageKey: string | null): Promise<void> {
    if (storageKey) await this.storage.delete(storageKey);
  }

  /**
   * Returns the file if the viewer may see it. Public when attached to a publicly visible product or an
   * active seller's storefront; otherwise only the owner and reviewers with scope over the seller's country.
   */
  async read(mediaId: string, principal: Principal | undefined) {
    const [asset] = await this.db.select().from(mediaAssets).where(eq(mediaAssets.id, mediaId));
    if (!asset) throw Errors.notFound('Image');

    let isPublic = false;
    let allowed = principal?.userId === asset.ownerUserId;
    if (asset.kind === 'DELIVERY_PHOTO' || asset.kind === 'DELIVERY_SIGNATURE') {
      allowed ||= !!principal && (await this.canSeeDeliveryProof(mediaId, principal));
    } else if (asset.kind === 'DISPUTE_EVIDENCE') {
      allowed ||= !!principal && (await this.canSeeDisputeEvidence(mediaId, principal));
    } else {
      const context = asset.kind === 'PRODUCT_IMAGE' ? await this.productContext(mediaId) : await this.logoContext(mediaId);
      isPublic = context?.isPublic ?? false;
      allowed ||= isPublic || !!(context && principal?.canInCountry(asset.kind === 'PRODUCT_IMAGE' ? 'product.review' : 'seller.review', context.countryId));
    }
    if (!allowed) throw Errors.notFound('Image');

    const body = await this.storage.get(asset.storageKey);
    if (!body) throw Errors.notFound('Image');
    return { body, contentType: asset.contentType, isPublic };
  }

  /** Proof-of-delivery images: the buyer, staff of the shipment's partners, and IIE staff for either country. */
  private async canSeeDeliveryProof(mediaId: string, principal: Principal): Promise<boolean> {
    const [row] = await this.db
      .select({ buyer: transactions.buyerUserId, origin: transactions.originCountryId, destination: transactions.destinationCountryId, logistics: shipments.logisticsPartnerId, broker: shipments.customsBrokerId })
      .from(deliveryProofs)
      .innerJoin(shipments, eq(shipments.id, deliveryProofs.shipmentId))
      .innerJoin(transactions, eq(transactions.id, shipments.transactionId))
      .where(or(eq(deliveryProofs.photoMediaId, mediaId), eq(deliveryProofs.signatureMediaId, mediaId)));
    if (!row) return false;
    if (row.buyer === principal.userId) return true;
    if (principal.canInCountry('transaction.read.any', row.origin) || principal.canInCountry('transaction.read.any', row.destination)) return true;
    const partnerIds = [row.logistics, row.broker].filter((v): v is string => !!v);
    if (!partnerIds.length || !principal.can('shipment.read.assigned')) return false;
    const [member] = await this.db
      .select({ id: partnerMembers.id })
      .from(partnerMembers)
      .where(and(eq(partnerMembers.userId, principal.userId), inArray(partnerMembers.partnerId, partnerIds)));
    return !!member;
  }

  /** Dispute evidence: the buyer, the seller and IIE staff for either country. */
  /** Dispute photos: IIE staff for either country, and the buyer or seller only on messages addressed to them. */
  private async canSeeDisputeEvidence(mediaId: string, principal: Principal): Promise<boolean> {
    const rows = await this.db
      .select({ visibleTo: disputeMessages.visibleTo, buyer: transactions.buyerUserId, sellerUser: sellerProfiles.userId, origin: transactions.originCountryId, destination: transactions.destinationCountryId })
      .from(disputeMessages)
      .innerJoin(disputes, eq(disputes.id, disputeMessages.disputeId))
      .innerJoin(transactions, eq(transactions.id, disputes.transactionId))
      .innerJoin(sellerProfiles, eq(sellerProfiles.id, transactions.sellerProfileId))
      .where(eq(disputeMessages.mediaId, mediaId));
    return rows.some(
      (row) =>
        principal.canInCountry('transaction.read.any', row.origin) ||
        principal.canInCountry('transaction.read.any', row.destination) ||
        (row.buyer === principal.userId && row.visibleTo !== 'SELLER') ||
        (row.sellerUser === principal.userId && row.visibleTo !== 'BUYER'),
    );
  }

  private async productContext(mediaId: string) {
    const [row] = await this.db
      .select({ status: products.status, sellerStatus: sellerProfiles.status, userStatus: users.status, open: countries.marketplaceEnabled, countryId: countries.id, storefront: sellerStorefronts.id })
      .from(productImages)
      .innerJoin(products, eq(products.id, productImages.productId))
      .innerJoin(sellerProfiles, PUBLIC_PRODUCT_JOINS.seller)
      .innerJoin(users, PUBLIC_PRODUCT_JOINS.user)
      .innerJoin(countries, PUBLIC_PRODUCT_JOINS.country)
      .leftJoin(sellerStorefronts, PUBLIC_PRODUCT_JOINS.storefront)
      .where(eq(productImages.mediaId, mediaId));
    if (!row) return null;
    const isPublic = isPublicStatus(row.status) && row.sellerStatus === 'ACTIVE' && row.userStatus === 'ACTIVE' && row.open && !!row.storefront;
    return { isPublic, countryId: row.countryId };
  }

  private async logoContext(mediaId: string) {
    const [row] = await this.db
      .select({ sellerStatus: sellerProfiles.status, userStatus: users.status, open: countries.marketplaceEnabled, countryId: countries.id })
      .from(sellerStorefronts)
      .innerJoin(sellerProfiles, eq(sellerProfiles.id, sellerStorefronts.sellerProfileId))
      .innerJoin(users, eq(users.id, sellerProfiles.userId))
      .innerJoin(countries, eq(countries.id, sellerProfiles.countryId))
      .where(eq(sellerStorefronts.logoMediaId, mediaId));
    if (!row) return null;
    return { isPublic: row.sellerStatus === 'ACTIVE' && row.userStatus === 'ACTIVE' && row.open, countryId: row.countryId };
  }
}
