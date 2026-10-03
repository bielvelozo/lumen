import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 { status: "ok" }', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('error handler keeps client errors as 4xx', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    app.post('/echo', async (request) => request.body ?? null);
    app.get('/boom', async () => {
      throw new Error('internal failure');
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('malformed JSON → 400, not 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: 'not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BadRequest' });
  });

  it('JSON content-type with an empty body → 400, not 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(res.statusCode).toBe(400);
  });

  it('a body-less POST without a content-type still reaches the handler', async () => {
    const res = await app.inject({ method: 'POST', url: '/echo' });
    expect(res.statusCode).toBe(200);
  });

  it('a thrown server error is still a sanitized 500 with a request id', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'InternalError' });
    expect(res.json().requestId).toBeTruthy();
    expect(res.body).not.toContain('internal failure');
  });
});
