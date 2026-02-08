/**
 * WhatsApp-friendly formatting utilities.
 * Uses WhatsApp markdown: *bold*, _italic_, ~strikethrough~, ```monospace```
 */

export function formatRecipeCard(recipe) {
  const lines = [];
  lines.push(`📖 *${recipe.name}*`);

  if (recipe.source_author || recipe.sourceAuthor) {
    lines.push(`👨‍🍳 ${recipe.source_author || recipe.sourceAuthor}`);
  }

  const meta = [];
  if (recipe.servings) meta.push(`🍽️ ${recipe.servings} servings`);
  if (recipe.prep_time || recipe.prepTime) meta.push(`⏱️ ${recipe.prep_time || recipe.prepTime} min prep`);
  if (recipe.cook_time || recipe.cookTime) meta.push(`🔥 ${recipe.cook_time || recipe.cookTime} min cook`);
  if (meta.length) lines.push(meta.join('  '));

  if (recipe.rating) {
    lines.push(`${'⭐'.repeat(recipe.rating)}`);
  }

  const tags = typeof recipe.tags === 'string' ? JSON.parse(recipe.tags || '[]') : (recipe.tags || []);
  if (tags.length) {
    lines.push(tags.map(t => `#${t}`).join(' '));
  }

  lines.push('');
  lines.push('*Ingredients:*');

  const ingredients = recipe.ingredients || [];
  for (const ing of ingredients) {
    const qty = ing.quantity || '';
    const name = ing.generic_name || ing.genericName || ing.name;
    const prep = ing.preparation ? `, ${ing.preparation}` : '';
    const opt = (ing.optional === 1 || ing.optional === true) ? ' _(optional)_' : '';
    lines.push(`• ${qty} ${name}${prep}${opt}`.trim());
  }

  const instructions = recipe.instructions;
  if (instructions) {
    lines.push('');
    lines.push('*Method:*');
    const text = typeof instructions === 'string' && instructions.startsWith('[')
      ? JSON.parse(instructions).join('\n')
      : instructions;
    lines.push(text);
  }

  return lines.join('\n');
}

export function formatRecipeList(recipes) {
  if (recipes.length === 0) return 'No recipes found.';

  const lines = [`📚 *${recipes.length} Recipe(s)*`, ''];

  for (const r of recipes) {
    const tags = typeof r.tags === 'string' ? JSON.parse(r.tags || '[]') : (r.tags || []);
    const tagStr = tags.length ? ` ${tags.map(t => `#${t}`).join(' ')}` : '';
    const rating = r.rating ? ` ${'⭐'.repeat(r.rating)}` : '';
    lines.push(`${r.id}. *${r.name}*${rating}${tagStr}`);
  }

  return lines.join('\n');
}

export function formatProductOptions(products) {
  if (products.length === 0) return 'No products found.';

  const lines = ['🏪 *Product Options:*', ''];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const price = p.price != null ? `$${p.price.toFixed(2)}` : 'N/A';
    const stock = p.in_stock ? '✅' : '❌';
    const special = p.on_special ? ' 🏷️' : '';
    lines.push(`${i + 1}. ${p.name} — ${price} ${stock}${special}`);
    if (p.brand) lines.push(`   _${p.brand}_`);
  }

  return lines.join('\n');
}

export function formatPreferenceUpdate(preference) {
  return `✅ Preference saved: *${preference.generic_name || preference.genericName}* → ${preference.product_name || preference.productName} (${preference.brand || 'no brand'})`;
}
