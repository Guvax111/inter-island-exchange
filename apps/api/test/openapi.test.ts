import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src/bootstrap';
import { createTestApp, TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

describe('API documentation', () => {
  // The API refuses to start if a request schema cannot be described (e.g. a Date input), so build it here too.
  it('builds the OpenAPI document for every endpoint', () => {
    const doc = buildOpenApiDocument(ctx.app);
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/api/v1/partner/shipments/{iieId}/steps', '/api/v1/me/orders/{iieId}/confirm-delivery']));
  });
});
