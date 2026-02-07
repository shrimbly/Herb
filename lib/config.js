import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

dotenv.config({ path: join(root, '.env') });

const raw = JSON.parse(readFileSync(join(root, 'config.json'), 'utf-8'));

const required = ['OPENAI_API_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}. Copy .env.example to .env and fill it in.`);
  }
}

const config = Object.freeze({
  root,
  db: {
    path: join(root, raw.database.path),
  },
  scraper: Object.freeze({ ...raw.scraper }),
  embedding: Object.freeze({ ...raw.embedding }),
  backup: Object.freeze({ ...raw.backup }),
  store: Object.freeze({
    ...raw.store,
    id: process.env.NW_STORE_ID || '',
    name: process.env.NW_STORE_NAME || raw.store.name,
  }),
  openaiKey: process.env.OPENAI_API_KEY,
});

export default config;
