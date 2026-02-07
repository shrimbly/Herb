import OpenAI from 'openai';
import { getDb, closeDb } from '../lib/db.js';
import config from '../lib/config.js';

const openai = new OpenAI({ apiKey: config.openaiKey });

function buildEmbeddingText(product) {
  return [product.name, product.brand, product.generic_name, product.category, product.subcategory]
    .filter(Boolean)
    .join(' ');
}

export async function embedProducts() {
  const db = getDb();

  // Find products that don't have embeddings yet
  const products = db.prepare(`
    SELECT p.id, p.name, p.brand, p.generic_name, p.category, p.subcategory
    FROM products p
    LEFT JOIN vec_products v ON v.product_id = p.id
    WHERE v.product_id IS NULL
  `).all();

  console.log(`Found ${products.length} products needing embeddings.`);

  if (products.length === 0) {
    console.log('All products already have embeddings.');
    closeDb();
    return;
  }

  const insertVec = db.prepare(`
    INSERT INTO vec_products (product_id, embedding) VALUES (?, ?)
  `);

  const batchSize = config.embedding.batchSize;
  let embedded = 0;

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const texts = batch.map(buildEmbeddingText);

    console.log(`  Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(products.length / batchSize)} (${batch.length} products)...`);

    try {
      const response = await openai.embeddings.create({
        model: config.embedding.model,
        input: texts,
        dimensions: config.embedding.dimensions,
      });

      db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          const embedding = response.data[j].embedding;
          const buffer = new Float32Array(embedding).buffer;
          insertVec.run(batch[j].id, Buffer.from(buffer));
          embedded++;
        }
      })();
    } catch (err) {
      console.error(`  Batch failed: ${err.message}`);
      // Continue with next batch rather than failing entirely
    }
  }

  const totalVec = db.prepare('SELECT COUNT(*) as count FROM vec_products').get().count;
  const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;

  console.log(`\nEmbedding complete.`);
  console.log(`  Embedded this run: ${embedded}`);
  console.log(`  Total embeddings: ${totalVec}/${totalProducts}`);

  closeDb();
}

// Run standalone
const isMain = process.argv[1] && (
  process.argv[1].includes('embed-products') ||
  process.argv[1].endsWith('embed-products.js')
);
if (isMain) {
  embedProducts().catch(err => {
    console.error('Embedding failed:', err);
    process.exit(1);
  });
}
