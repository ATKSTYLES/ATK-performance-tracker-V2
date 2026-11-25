import 'dotenv/config';
import { hashPassword } from '../server/auth.ts';
import { loadServerConfig } from '../server/config.ts';
import { openSqliteDatabase } from '../server/db.ts';

async function main() {
  const [, , identifier, newPassword] = process.argv;
  if (!identifier || !newPassword) {
    console.error('Usage: npm run reset-password -- <username-or-email> <new-password>');
    process.exit(1);
  }
  if (newPassword.length < 8) {
    console.error('Error: New password must be at least 8 characters long.');
    process.exit(1);
  }

  const config = loadServerConfig();
  const db = openSqliteDatabase(config.dbPath);

  const row = db
    .prepare('SELECT id, username, email FROM users WHERE username = ? OR email = ?')
    .get(identifier.trim(), identifier.trim().toLowerCase()) as
    | { id: string; username: string; email: string }
    | undefined;

  if (!row) {
    console.error(`Error: No user found matching "${identifier}".`);
    db.close();
    process.exit(1);
  }

  const hash = await hashPassword(newPassword);
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hash,
    now,
    row.id
  );
  // Revoke all existing sessions for security
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(row.id);

  console.log(`Password reset successfully for ${row.username} (${row.email}). All active sessions were revoked.`);
  db.close();
}

void main();
