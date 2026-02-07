import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { getDb, closeDb } from '../lib/db.js';
import config from '../lib/config.js';

const migrationsDir = join(config.root, 'db', 'migrations');

function migrate() {
  const db = getDb();

  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Read migration files
  let files;
  try {
    files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch {
    console.log('No migrations directory or files found.');
    closeDb();
    return;
  }

  if (files.length === 0) {
    console.log('No migration files found.');
    closeDb();
    return;
  }

  // Get already applied migrations
  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map(r => r.name)
  );

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    console.log(`Applying migration: ${file}`);

    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    })();

    count++;
  }

  if (count === 0) {
    console.log('All migrations already applied.');
  } else {
    console.log(`Applied ${count} migration(s).`);
  }

  closeDb();
}

migrate();
