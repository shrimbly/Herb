import { parseWithAI } from '../lib/ai.js';
import { getDb, closeDb } from '../lib/db.js';

const SYSTEM_PROMPT = `You are an order parser for New World (NZ grocery store). Given pasted order text (from email, website, or app), extract the structured order data.

Return a JSON object:
{
  "orderDate": "YYYY-MM-DD or null",
  "orderReference": "order number/reference or null",
  "items": [
    {
      "rawName": "exact product name as shown",
      "quantity": 1,
      "unitPrice": 3.99,
      "totalPrice": 3.99
    }
  ],
  "totalAmount": 45.67
}

Rules:
- rawName should be the exact product name from the order (not generic)
- Prices should be numbers without currency symbols
- If quantity is not specified, assume 1
- totalPrice = quantity * unitPrice
- Include ALL items, even if they look like duplicates
- If you can't parse the text as an order, return {"error": "Could not parse order"}`;

export async function parseOrder(orderText, importMethod = 'paste') {
  const parsed = await parseWithAI(SYSTEM_PROMPT, orderText);

  if (parsed.error) return parsed;

  const db = getDb();

  const result = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO purchases (order_date, order_reference, import_method, item_count, total_amount)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      parsed.orderDate,
      parsed.orderReference,
      importMethod,
      parsed.items?.length || 0,
      parsed.totalAmount,
    );

    const purchaseId = info.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO purchase_items (purchase_id, raw_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const item of parsed.items || []) {
      insertItem.run(
        purchaseId,
        item.rawName,
        item.quantity || 1,
        item.unitPrice,
        item.totalPrice,
      );
    }

    return purchaseId;
  })();

  closeDb();

  return {
    purchaseId: result,
    orderDate: parsed.orderDate,
    orderReference: parsed.orderReference,
    itemCount: parsed.items?.length || 0,
    totalAmount: parsed.totalAmount,
  };
}

// CLI
if (process.argv[1]?.includes('parse-order')) {
  const chunks = [];
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', async () => {
    const input = chunks.join('');
    if (!input.trim()) {
      console.log('Usage: echo "order text..." | node history/parse-order.js');
      console.log('Or: node history/parse-order.js < order.txt');
      process.exit(1);
    }

    try {
      const result = await parseOrder(input);

      if (result.error) {
        console.error('Parse error:', result.error);
        process.exit(1);
      }

      console.log('Order imported:');
      console.log(`  Purchase #${result.purchaseId}`);
      console.log(`  Date: ${result.orderDate || '-'}`);
      console.log(`  Reference: ${result.orderReference || '-'}`);
      console.log(`  Items: ${result.itemCount}`);
      console.log(`  Total: $${result.totalAmount?.toFixed(2) || '-'}`);
      console.log('\nRun `node history/match-items.js ' + result.purchaseId + '` to match items to catalog.');
    } catch (err) {
      console.error('Failed:', err.message);
      process.exit(1);
    }
  });
}
