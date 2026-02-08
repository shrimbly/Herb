import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import checkoutRoutes from './web/routes/checkout.js';

const app = new Hono();
const CHECKOUT_SECRET = process.env.CHECKOUT_SECRET || '';

// Health check
app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

// Temporary DB upload endpoint
app.post('/api/upload-db', async (c) => {
  if (CHECKOUT_SECRET) {
    const auth = c.req.header('Authorization');
    if (auth !== `Bearer ${CHECKOUT_SECRET}`) return c.json({ error: 'Unauthorized' }, 401);
  }
  const body = await c.req.arrayBuffer();
  const dataDir = '/app/data';
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(`${dataDir}/grocery.db`, Buffer.from(body));
  return c.json({ ok: true, size: body.byteLength });
});

// Check data dir contents
app.get('/api/data-status', (c) => {
  if (CHECKOUT_SECRET) {
    const auth = c.req.header('Authorization');
    if (auth !== `Bearer ${CHECKOUT_SECRET}`) return c.json({ error: 'Unauthorized' }, 401);
  }
  const dataDir = '/app/data';
  if (!existsSync(dataDir)) return c.json({ exists: false });
  const files = readdirSync(dataDir).map(f => ({
    name: f,
    size: statSync(`${dataDir}/${f}`).size,
  }));
  return c.json({ exists: true, files });
});

// Mount checkout routes
app.route('/', checkoutRoutes);

// 404
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

const port = parseInt(process.env.PORT || '3000', 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`);
});
