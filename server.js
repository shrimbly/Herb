import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import checkoutRoutes from './web/routes/checkout.js';

const app = new Hono();

// Health check
app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

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
