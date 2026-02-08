import { Hono } from 'hono';
import { getDb } from '../../lib/db.js';
import config from '../../lib/config.js';
import {
  createSession, getSession, selectProduct,
  addEventListener, removeEventListener,
} from '../session.js';
import { renderCheckoutPage, renderNotFound } from '../render.js';
import { submitCart } from '../cart-submit.js';

const app = new Hono();

const CHECKOUT_SECRET = process.env.CHECKOUT_SECRET || '';

function authCheck(c, next) {
  if (!CHECKOUT_SECRET) return next();
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${CHECKOUT_SECRET}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
}

/**
 * POST /api/checkout — Create a new checkout session.
 * Body: { items: [{ name, qty? }], source? }
 * Requires Bearer token if CHECKOUT_SECRET is set.
 */
app.post('/api/checkout', async (c) => {
  // Auth check
  if (CHECKOUT_SECRET) {
    const auth = c.req.header('Authorization');
    if (auth !== `Bearer ${CHECKOUT_SECRET}`) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }

  const body = await c.req.json();
  const items = body.items;
  const source = body.source || null;

  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: 'items array is required' }, 400);
  }

  // Validate items
  for (const item of items) {
    if (!item.name || typeof item.name !== 'string') {
      return c.json({ error: 'Each item must have a "name" string' }, 400);
    }
  }

  const db = getDb();
  const session = await createSession(db, items, source);

  const needsConfirmation = session.items.filter(i => !i.autoConfirmed).length;

  const baseUrl = new URL(c.req.url).origin;

  return c.json({
    sessionId: session.id,
    url: `${baseUrl}/checkout/${session.id}`,
    itemCount: session.items.length,
    needsConfirmation,
    estimatedTotal: session.estimatedTotal,
  });
});

/**
 * GET /checkout/:id — Server-rendered checkout page.
 */
app.get('/checkout/:id', (c) => {
  const session = getSession(c.req.param('id'));
  if (!session) {
    return c.html(renderNotFound(), 404);
  }
  return c.html(renderCheckoutPage(session));
});

/**
 * POST /api/checkout/:id/select — Record a product selection.
 * Body: { itemIndex, productId }
 */
app.post('/api/checkout/:id/select', async (c) => {
  const session = getSession(c.req.param('id'));
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const { itemIndex, productId } = await c.req.json();

  if (typeof itemIndex !== 'number' || !productId) {
    return c.json({ error: 'itemIndex (number) and productId are required' }, 400);
  }

  const updated = selectProduct(session.id, itemIndex, productId);
  if (!updated) {
    return c.json({ error: 'Invalid item index or product' }, 400);
  }

  return c.json({ ok: true, estimatedTotal: updated.estimatedTotal });
});

/**
 * POST /api/checkout/:id/confirm — Trigger cart submission.
 */
app.post('/api/checkout/:id/confirm', async (c) => {
  const session = getSession(c.req.param('id'));
  if (!session) return c.json({ error: 'Session not found' }, 404);

  if (session.status === 'submitting') {
    return c.json({ error: 'Already submitting' }, 409);
  }

  const db = getDb();

  // Fire and forget — progress is tracked via SSE
  submitCart(session, db).catch(err => {
    console.error('Cart submission error:', err);
  });

  return c.json({ ok: true, status: 'submitting' });
});

/**
 * GET /api/checkout/:id/events — SSE stream for cart progress.
 */
app.get('/api/checkout/:id/events', (c) => {
  const session = getSession(c.req.param('id'));
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const send = (data) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Stream closed
          }
        };

        // Send any existing events
        for (const event of session.events) {
          send(event);
        }

        // Listen for new events
        const listener = (event) => {
          send(event);
          if (event.type === 'done' || event.type === 'error') {
            try { controller.close(); } catch {}
          }
        };

        addEventListener(session.id, listener);

        // If session is already done/error, close
        if (session.status === 'done' || session.status === 'error') {
          try { controller.close(); } catch {}
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    }
  );
});

export default app;
