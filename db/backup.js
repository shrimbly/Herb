import { existsSync, copyFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from '../lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backupDir = join(config.root, 'data', 'backups');

export function backupDatabase() {
  const dbPath = config.db.path;

  if (!existsSync(dbPath)) {
    console.log('No database file to backup.');
    return null;
  }

  mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `grocery-${timestamp}.db`);

  copyFileSync(dbPath, backupPath);
  console.log(`Backed up to ${backupPath}`);

  pruneBackups();

  return backupPath;
}

function pruneBackups() {
  const files = readdirSync(backupDir)
    .filter(f => f.startsWith('grocery-') && f.endsWith('.db'))
    .sort()
    .reverse();

  const toDelete = files.slice(config.backup.maxBackups);
  for (const file of toDelete) {
    const fullPath = join(backupDir, file);
    unlinkSync(fullPath);
    console.log(`Pruned old backup: ${file}`);
  }
}

// Run standalone
if (process.argv[1] && process.argv[1].includes('backup')) {
  backupDatabase();
}
