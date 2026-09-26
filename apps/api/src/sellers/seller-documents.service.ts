import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { SellerDocumentType } from '@iie/shared';
import { Database, DB } from '../db/db';
import { sellerDocuments, sellerProfiles } from '../db/schema';
import { AppError, Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import { STORAGE_PROVIDER, StorageProvider } from '../media/storage.provider';
import type { Principal } from '../rbac/principal';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2400;

type DocumentRow = typeof sellerDocuments.$inferSelect;

/**
 * Proof a seller must give before IIE approves them: business registration or a national ID. Documents are
 * private (the seller and reviewers for the seller's country). PDFs are stored as uploaded; photos are re-encoded
 * with their metadata (including location) removed.
 */
@Injectable()
export class SellerDocumentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly audit: AuditService,
  ) {}

  async upload(principal: Principal, type: SellerDocumentType, file: { buffer: Buffer; size: number; originalname?: string } | undefined, meta: RequestMeta) {
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, principal.userId));
    if (!seller) throw Errors.notFound('Seller profile');
    if (!file) throw Errors.badRequest('FILE_REQUIRED', 'Choose a PDF or photo of the document');
    if (file.size > MAX_DOCUMENT_BYTES) throw new AppError(HttpStatus.PAYLOAD_TOO_LARGE, 'FILE_TOO_LARGE', 'Documents must be 10 MB or smaller');

    let body: Buffer;
    let contentType: string;
    let ext: string;
    if (file.buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
      body = file.buffer;
      contentType = 'application/pdf';
      ext = 'pdf';
    } else {
      try {
        const image = sharp(file.buffer, { limitInputPixels: 60_000_000, failOn: 'error' });
        const format = (await image.metadata()).format;
        if (!format || !['jpeg', 'png', 'webp'].includes(format)) throw new Error('unsupported');
        body = await image.rotate().resize(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
      } catch {
        throw Errors.badRequest('UNSUPPORTED_DOCUMENT', 'Upload a PDF, or a JPEG, PNG or WebP photo of the document');
      }
      contentType = 'image/jpeg';
      ext = 'jpg';
    }
    const storageKey = `documents/${randomUUID()}.${ext}`;
    await this.storage.put(storageKey, body, contentType);
    const originalName = (file.originalname ?? `document.${ext}`).replace(/[^\w.\- ]/g, '_').slice(0, 200);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(sellerDocuments)
        .values({ sellerProfileId: seller.id, type, storageKey, contentType, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), originalName, uploadedBy: principal.userId })
        .returning();
      await this.audit.record(tx, meta, { action: 'seller.document_uploaded', entityType: 'seller_profile', entityId: seller.id, after: { documentId: row!.id, type, bytes: body.length } });
      return this.view(row!);
    });
  }

  async listMine(principal: Principal) {
    const [seller] = await this.db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, principal.userId));
    if (!seller) return { items: [] };
    return { items: (await this.forSeller(seller.id)).map((d) => this.view(d)) };
  }

  forSeller(sellerProfileId: string) {
    return this.db.select().from(sellerDocuments).where(eq(sellerDocuments.sellerProfileId, sellerProfileId)).orderBy(desc(sellerDocuments.createdAt));
  }

  async hasAccepted(sellerProfileId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: sellerDocuments.id })
      .from(sellerDocuments)
      .where(and(eq(sellerDocuments.sellerProfileId, sellerProfileId), eq(sellerDocuments.status, 'ACCEPTED')))
      .limit(1);
    return !!row;
  }

  /** The file, for the seller who uploaded it or a reviewer with scope over the seller's country. */
  async download(principal: Principal, documentId: string) {
    const { doc, seller } = await this.load(documentId);
    if (seller.userId !== principal.userId && !principal.canInCountry('seller.review', seller.countryId)) throw Errors.notFound('Document');
    const body = await this.storage.get(doc.storageKey);
    if (!body) throw Errors.notFound('Document');
    return { body, contentType: doc.contentType, fileName: doc.originalName };
  }

  async review(principal: Principal, documentId: string, decision: 'ACCEPT' | 'REJECT', note: string | undefined, meta: RequestMeta) {
    const { doc, seller } = await this.load(documentId);
    if (!principal.canInCountry('seller.review', seller.countryId)) throw Errors.notFound('Document');
    if (seller.userId === principal.userId) throw Errors.forbidden('You cannot review your own documents');
    const status = decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
    await this.db.transaction(async (tx) => {
      await tx.update(sellerDocuments).set({ status, reviewNote: note ?? null, reviewedBy: principal.userId, reviewedAt: new Date() }).where(eq(sellerDocuments.id, doc.id));
      await this.audit.record(tx, meta, { action: `seller.document_${status.toLowerCase()}`, entityType: 'seller_profile', entityId: seller.id, before: { status: doc.status }, after: { documentId: doc.id, status, note: note ?? null } });
    });
  }

  view(d: DocumentRow) {
    return { id: d.id, type: d.type, status: d.status, fileName: d.originalName, contentType: d.contentType, bytes: d.bytes, reviewNote: d.reviewNote, uploadedAt: d.createdAt, reviewedAt: d.reviewedAt, url: `/api/v1/seller-documents/${d.id}` };
  }

  private async load(documentId: string) {
    const [row] = await this.db.select({ doc: sellerDocuments, seller: sellerProfiles }).from(sellerDocuments).innerJoin(sellerProfiles, eq(sellerProfiles.id, sellerDocuments.sellerProfileId)).where(eq(sellerDocuments.id, documentId));
    if (!row) throw Errors.notFound('Document');
    return row;
  }
}
