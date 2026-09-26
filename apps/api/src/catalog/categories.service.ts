import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { categoryCreateSchema, categoryUpdateSchema } from '@iie/shared';
import { Database, DB, Tx } from '../db/db';
import { categories } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  children: CategoryNode[];
}

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async tree(includeInactive = false): Promise<CategoryNode[]> {
    const rows = await this.db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
    const visible = includeInactive ? rows : rows.filter((r) => r.active);
    const nodes = new Map(visible.map((r) => [r.id, { id: r.id, slug: r.slug, name: r.name, active: r.active, children: [] as CategoryNode[] }]));
    const roots: CategoryNode[] = [];
    for (const r of visible) {
      const node = nodes.get(r.id)!;
      if (r.parentId && nodes.has(r.parentId)) nodes.get(r.parentId)!.children.push(node);
      else if (!r.parentId) roots.push(node);
    }
    return roots;
  }

  async bySlug(slug: string, tx: Tx = this.db) {
    const [row] = await tx.select().from(categories).where(eq(categories.slug, slug));
    return row ?? null;
  }

  /** The category and all its descendants (for "Baby & Child" including "Diapers & Wipes"). */
  async descendantIds(slug: string): Promise<string[]> {
    const rows = await this.db.select({ id: categories.id, parentId: categories.parentId, slug: categories.slug }).from(categories);
    const root = rows.find((r) => r.slug === slug);
    if (!root) return [];
    const ids = [root.id];
    for (let i = 0; i < ids.length; i++) ids.push(...rows.filter((r) => r.parentId === ids[i]).map((r) => r.id));
    return ids;
  }

  /** Breadcrumb from the top-level category down to this one. */
  async path(categoryId: string): Promise<{ slug: string; name: string }[]> {
    const rows = await this.db.select().from(categories);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const trail: { slug: string; name: string }[] = [];
    for (let c = byId.get(categoryId); c; c = c.parentId ? byId.get(c.parentId) : undefined) trail.unshift({ slug: c.slug, name: c.name });
    return trail;
  }

  async create(input: z.infer<typeof categoryCreateSchema>, meta: RequestMeta) {
    return this.db.transaction(async (tx) => {
      const parent = input.parentSlug ? await this.bySlug(input.parentSlug, tx) : null;
      if (input.parentSlug && !parent) throw Errors.notFound('Parent category');
      const [created] = await tx
        .insert(categories)
        .values({ name: input.name, slug: input.slug, sortOrder: input.sortOrder, parentId: parent?.id ?? null })
        .onConflictDoNothing()
        .returning();
      if (!created) throw Errors.conflict('CATEGORY_EXISTS', 'A category with this web address already exists');
      await this.audit.record(tx, meta, { action: 'category.created', entityType: 'category', entityId: created.id, after: created });
      return created;
    });
  }

  async update(slug: string, patch: z.infer<typeof categoryUpdateSchema>, meta: RequestMeta) {
    return this.db.transaction(async (tx) => {
      const before = await this.bySlug(slug, tx);
      if (!before) throw Errors.notFound('Category');
      const [updated] = await tx.update(categories).set({ ...patch, updatedAt: new Date() }).where(eq(categories.id, before.id)).returning();
      await this.audit.record(tx, meta, {
        action: 'category.updated',
        entityType: 'category',
        entityId: before.id,
        before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof typeof before]])),
        after: patch,
      });
      return updated;
    });
  }
}
