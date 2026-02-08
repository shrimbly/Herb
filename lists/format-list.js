const CATEGORY_EMOJI = {
  'fruit & vegetables': '🥬',
  'fruit & veg': '🥬',
  'fresh vegetables': '🥬',
  'fresh fruit': '🍎',
  'meat & seafood': '🥩',
  'meat & poultry': '🥩',
  'seafood': '🐟',
  'bakery': '🍞',
  'dairy & eggs': '🥛',
  'dairy': '🥛',
  'frozen': '🧊',
  'frozen foods': '🧊',
  'pantry': '🏪',
  'canned & packaged': '🏪',
  'drinks': '🥤',
  'beverages': '🥤',
  'snacks': '🍿',
  'health & beauty': '💊',
  'household': '🧹',
  'baby': '👶',
  'deli': '🧀',
  'international': '🌏',
  'condiments & sauces': '🫙',
  'baking': '🧁',
  'cereals & breakfast': '🥣',
  'pasta & rice': '🍝',
  'pet': '🐾',
};

function getCategoryEmoji(category) {
  if (!category) return '📦';
  const lower = category.toLowerCase();
  for (const [key, emoji] of Object.entries(CATEGORY_EMOJI)) {
    if (lower.includes(key) || key.includes(lower)) return emoji;
  }
  return '📦';
}

/**
 * Format shopping list for WhatsApp output.
 */
export function formatList(list) {
  const lines = [];
  lines.push(`🛒 *${list.name}*`);

  if (list.recipes?.length) {
    lines.push(`📖 ${list.recipes.map(r => r.name).join(', ')}`);
  }

  lines.push('');

  // Group by category
  const groups = new Map();
  for (const item of list.items) {
    const cat = item.category || 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(item);
  }

  for (const [cat, items] of groups) {
    const emoji = getCategoryEmoji(cat);
    lines.push(`${emoji} *${cat}*`);

    for (const item of items) {
      const qty = item.quantity ? `${item.quantity} ` : '';
      const price = item.estimatedPrice != null ? ` ~$${item.estimatedPrice.toFixed(2)}` : '';
      const resolved = item.resolved ? '' : ' ❓';
      lines.push(`  ☐ ${qty}${item.displayName}${price}${resolved}`);
    }

    lines.push('');
  }

  if (list.unresolvedCount > 0) {
    lines.push(`⚠️ ${list.unresolvedCount} item(s) need manual selection (marked ❓)`);
  }

  if (list.estimatedTotal > 0) {
    lines.push(`💰 Estimated total: ~$${list.estimatedTotal.toFixed(2)}`);
  }

  return lines.join('\n');
}

/**
 * Compact format for quick reference.
 */
export function formatListCompact(list) {
  const lines = [`🛒 ${list.name}`];

  for (const item of list.items) {
    const qty = item.quantity ? `${item.quantity} ` : '';
    lines.push(`☐ ${qty}${item.displayName}`);
  }

  if (list.estimatedTotal > 0) {
    lines.push(`\n💰 ~$${list.estimatedTotal.toFixed(2)}`);
  }

  return lines.join('\n');
}
