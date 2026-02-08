import { getDb, closeDb } from '../lib/db.js';
import { resolveIngredient } from '../lib/resolve.js';
import { setPreference } from '../preferences/set-preference.js';

export async function addItem(db, listId, itemName, quantity = null) {
  const resolution = await resolveIngredient(db, { genericName: itemName });

  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM shopping_list_items WHERE list_id = ?').get(listId);
  const sortOrder = (maxOrder?.max ?? -1) + 1;

  const displayName = resolution.resolved ? resolution.productName : itemName;
  const category = resolution.resolved && resolution.candidates?.[0]?.category
    ? resolution.candidates[0].category
    : null;

  db.prepare(`
    INSERT INTO shopping_list_items (list_id, generic_name, resolved_product_id, display_name, quantity, category, source, estimated_price, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)
  `).run(
    listId,
    itemName,
    resolution.resolved ? resolution.productId : null,
    displayName,
    quantity,
    category,
    resolution.resolved ? resolution.price : null,
    sortOrder,
  );

  db.prepare("UPDATE shopping_lists SET updated_at = datetime('now') WHERE id = ?").run(listId);

  return {
    displayName,
    resolved: resolution.resolved,
    price: resolution.resolved ? resolution.price : null,
  };
}

export function removeItem(db, itemId) {
  const item = db.prepare('SELECT list_id FROM shopping_list_items WHERE id = ?').get(itemId);
  if (!item) return null;

  db.prepare('DELETE FROM shopping_list_items WHERE id = ?').run(itemId);
  db.prepare("UPDATE shopping_lists SET updated_at = datetime('now') WHERE id = ?").run(item.list_id);
  return true;
}

export function swapItem(db, itemId, newProductId, saveAsPreference = false) {
  const item = db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(itemId);
  if (!item) return null;

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(newProductId);
  if (!product) throw new Error(`Product ${newProductId} not found`);

  db.prepare(`
    UPDATE shopping_list_items
    SET resolved_product_id = ?, display_name = ?, estimated_price = ?, category = ?
    WHERE id = ?
  `).run(product.id, product.name, product.price, product.category, itemId);

  db.prepare("UPDATE shopping_lists SET updated_at = datetime('now') WHERE id = ?").run(item.list_id);

  if (saveAsPreference && item.generic_name) {
    setPreference(db, {
      genericName: item.generic_name,
      productId: product.id,
      source: 'swap',
    });
  }

  return { displayName: product.name, price: product.price };
}

export function checkItem(db, itemId, checked = true) {
  db.prepare('UPDATE shopping_list_items SET checked = ? WHERE id = ?').run(checked ? 1 : 0, itemId);
}

export function completeList(db, listId) {
  db.prepare(`
    UPDATE shopping_lists
    SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(listId);
}

// CLI
if (process.argv[1]?.includes('update-list')) {
  const [action, ...rest] = process.argv.slice(2);

  if (!action) {
    console.log('Usage:');
    console.log('  node lists/update-list.js add <list_id> "<item_name>" [quantity]');
    console.log('  node lists/update-list.js remove <item_id>');
    console.log('  node lists/update-list.js swap <item_id> <product_id> [--save-preference]');
    console.log('  node lists/update-list.js check <item_id>');
    console.log('  node lists/update-list.js uncheck <item_id>');
    console.log('  node lists/update-list.js complete <list_id>');
    process.exit(1);
  }

  const db = getDb();

  try {
    switch (action) {
      case 'add': {
        const [listId, itemName, quantity] = rest;
        const result = await addItem(db, Number(listId), itemName, quantity);
        console.log(`Added: ${result.displayName}${result.price ? ` ~$${result.price.toFixed(2)}` : ''}${result.resolved ? '' : ' ❓'}`);
        break;
      }
      case 'remove': {
        removeItem(db, Number(rest[0]));
        console.log('Item removed.');
        break;
      }
      case 'swap': {
        const saveAsPref = rest.includes('--save-preference');
        const result = swapItem(db, Number(rest[0]), Number(rest[1]), saveAsPref);
        console.log(`Swapped to: ${result.displayName} $${result.price?.toFixed(2) || 'N/A'}${saveAsPref ? ' (preference saved)' : ''}`);
        break;
      }
      case 'check': {
        checkItem(db, Number(rest[0]), true);
        console.log('Item checked.');
        break;
      }
      case 'uncheck': {
        checkItem(db, Number(rest[0]), false);
        console.log('Item unchecked.');
        break;
      }
      case 'complete': {
        completeList(db, Number(rest[0]));
        console.log('List completed.');
        break;
      }
      default:
        console.log(`Unknown action: ${action}`);
        process.exit(1);
    }
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  } finally {
    closeDb();
  }
}
