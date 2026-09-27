import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Database, DB } from '../db/db';
import { helpArticles } from '../db/schema';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../rbac/principal';
import { HELP_DRAFTS } from './help-drafts';

type Audience = 'BUYER' | 'SELLER' | 'PARTNER' | 'ALL';
type ArticleInput = { slug: string; title: string; audience: Audience; summary: string; body: string; sortOrder: number };

/** Must match the expression of the help_articles_search_idx index (migration 0014). */
const searchDoc = sql`to_tsvector('english', ${helpArticles.title} || ' ' || ${helpArticles.summary} || ' ' || ${helpArticles.body})`;

/** Help Center articles: written and published by IIE staff (`content.manage`); the public sees published ones only. */
@Injectable()
export class HelpService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ public

  async listPublished(filter: { audience?: Audience; q?: string }) {
    const rows = await this.db
      .select({ slug: helpArticles.slug, title: helpArticles.title, audience: helpArticles.audience, summary: helpArticles.summary })
      .from(helpArticles)
      .where(
        and(
          eq(helpArticles.status, 'PUBLISHED'),
          // "Buyers" also shows the articles for everyone.
          filter.audience && filter.audience !== 'ALL' ? inArray(helpArticles.audience, [filter.audience, 'ALL']) : undefined,
          filter.q ? sql`${searchDoc} @@ websearch_to_tsquery('english', ${filter.q})` : undefined,
        ),
      )
      .orderBy(
        ...(filter.q ? [sql`ts_rank(${searchDoc}, websearch_to_tsquery('english', ${filter.q})) desc`] : []),
        asc(helpArticles.sortOrder),
        asc(helpArticles.title),
      )
      .limit(100);
    return { items: rows };
  }

  async published(slug: string) {
    const [a] = await this.db.select().from(helpArticles).where(and(eq(helpArticles.slug, slug), eq(helpArticles.status, 'PUBLISHED')));
    if (!a) throw Errors.notFound('Article');
    return { slug: a.slug, title: a.title, audience: a.audience, summary: a.summary, body: a.body, updatedAt: a.publishedAt ?? a.updatedAt };
  }

  // ------------------------------------------------------------------ IIE staff

  async listAll() {
    const rows = await this.db.select().from(helpArticles).orderBy(asc(helpArticles.audience), asc(helpArticles.sortOrder), asc(helpArticles.title));
    return { items: rows.map((a) => this.adminView(a)) };
  }

  async get(id: string) {
    return this.adminView(await this.load(id));
  }

  async create(principal: Principal, input: ArticleInput, meta: RequestMeta) {
    return this.db.transaction(async (tx) => {
      const [a] = await tx.insert(helpArticles).values({ ...input, updatedBy: principal.userId }).onConflictDoNothing().returning();
      if (!a) throw Errors.conflict('SLUG_TAKEN', 'Another article already uses this web address');
      await this.audit.record(tx, meta, { action: 'help.created', entityType: 'help_article', entityId: a.id, after: { slug: a.slug, title: a.title } });
      return this.adminView(a);
    });
  }

  /** Edits keep the article's status: a published article is updated live. */
  async update(principal: Principal, id: string, input: Partial<ArticleInput>, meta: RequestMeta) {
    const before = await this.load(id);
    if (input.slug && input.slug !== before.slug) {
      const [taken] = await this.db.select({ id: helpArticles.id }).from(helpArticles).where(eq(helpArticles.slug, input.slug));
      if (taken) throw Errors.conflict('SLUG_TAKEN', 'Another article already uses this web address');
    }
    return this.db.transaction(async (tx) => {
      const [a] = await tx.update(helpArticles).set({ ...input, updatedBy: principal.userId, updatedAt: new Date() }).where(eq(helpArticles.id, id)).returning();
      await this.audit.record(tx, meta, { action: 'help.updated', entityType: 'help_article', entityId: id, before: { slug: before.slug, title: before.title }, after: { ...input, body: input.body ? '(changed)' : undefined } });
      return this.adminView(a!);
    });
  }

  async setStatus(principal: Principal, id: string, status: 'DRAFT' | 'PUBLISHED', meta: RequestMeta) {
    const before = await this.load(id);
    return this.db.transaction(async (tx) => {
      const [a] = await tx
        .update(helpArticles)
        .set({ status, publishedAt: status === 'PUBLISHED' ? new Date() : before.publishedAt, updatedBy: principal.userId, updatedAt: new Date() })
        .where(eq(helpArticles.id, id))
        .returning();
      await this.audit.record(tx, meta, { action: status === 'PUBLISHED' ? 'help.published' : 'help.unpublished', entityType: 'help_article', entityId: id, before: { status: before.status }, after: { status } });
      return this.adminView(a!);
    });
  }

  private async load(id: string) {
    const [a] = await this.db.select().from(helpArticles).where(eq(helpArticles.id, id));
    if (!a) throw Errors.notFound('Article');
    return a;
  }

  private adminView(a: typeof helpArticles.$inferSelect) {
    return {
      id: a.id,
      slug: a.slug,
      title: a.title,
      audience: a.audience,
      summary: a.summary,
      body: a.body,
      sortOrder: a.sortOrder,
      status: a.status,
      // Drafts written for IIE to check still carry "[IIE to confirm]" notes.
      needsConfirmation: a.body.includes('[IIE to confirm]'),
      publishedAt: a.publishedAt,
      updatedAt: a.updatedAt,
    };
  }
}

/** Seeds the first drafts once; never touches an article that already exists (staff edits are kept). */
export async function seedHelpDrafts(db: Database) {
  await db
    .insert(helpArticles)
    .values(HELP_DRAFTS.map((d) => ({ ...d, status: 'DRAFT' })))
    .onConflictDoNothing();
}
