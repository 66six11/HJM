import Database from 'better-sqlite3';
import { kv } from '@vercel/kv';

const isVercel = Boolean(process.env.VERCEL);

// KV keys helpers
const userKey = id => `user:${id}`;
const ghIndexKey = githubId => `gh:${githubId}`;
const seqKey = 'seq:user:id';

// Local (dev) uses SQLite; Vercel uses KV
let database = null;
if (!isVercel) {
  const databaseFile = 'data.db';
  database = new Database(databaseFile);
  database.pragma('journal_mode = WAL');
  database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    githubId TEXT UNIQUE,
    username TEXT,
    avatarUrl TEXT,
    faction TEXT
  );
  `);
}

export function getUserByGithubId(githubId) {
  if (isVercel) {
    // Look up the mapped id then fetch the user
    return kv.get(ghIndexKey(githubId)).then(id => id ? kv.get(userKey(id)) : null);
  }
  const statement = database.prepare('SELECT id, githubId, username, avatarUrl, faction FROM users WHERE githubId = ?');
  return statement.get(githubId) || null;
}

export function getUserById(userId) {
  if (isVercel) {
    return kv.get(userKey(userId));
  }
  const statement = database.prepare('SELECT id, githubId, username, avatarUrl, faction FROM users WHERE id = ?');
  return statement.get(userId) || null;
}

export async function createOrUpdateUser(profile) {
  if (isVercel) {
    const existingId = await kv.get(ghIndexKey(profile.id));
    if (existingId) {
      const user = await kv.get(userKey(existingId));
      const updated = { ...user, username: profile.username, avatarUrl: profile.avatarUrl };
      await kv.set(userKey(existingId), updated);
      return updated;
    }
    const newId = await kv.incr(seqKey);
    const created = { id: newId, githubId: profile.id, username: profile.username, avatarUrl: profile.avatarUrl, faction: null };
    await kv.set(userKey(newId), created);
    await kv.set(ghIndexKey(profile.id), newId);
    return created;
  }
  const existingUser = getUserByGithubId(profile.id);
  if (existingUser) {
    const updateStatement = database.prepare('UPDATE users SET username = ?, avatarUrl = ? WHERE githubId = ?');
    updateStatement.run(profile.username, profile.avatarUrl, profile.id);
    return getUserByGithubId(profile.id);
  }
  const insertStatement = database.prepare('INSERT INTO users (githubId, username, avatarUrl, faction) VALUES (?, ?, ?, NULL)');
  const result = insertStatement.run(profile.id, profile.username, profile.avatarUrl);
  return getUserById(result.lastInsertRowid);
}

export async function createAnonymousUser(username = 'Guest') {
  if (isVercel) {
    const newId = await kv.incr(seqKey);
    const created = { id: newId, githubId: null, username, avatarUrl: null, faction: null };
    await kv.set(userKey(newId), created);
    return created;
  }
  const insertStatement = database.prepare('INSERT INTO users (githubId, username, avatarUrl, faction) VALUES (NULL, ?, NULL, NULL)');
  const result = insertStatement.run(username);
  return getUserById(result.lastInsertRowid);
}

export async function setUserFaction(userId, faction) {
  const normalized = faction === 'A' ? 'A' : faction === 'B' ? 'B' : null;
  if (!normalized) {
    throw new Error('Invalid faction');
  }
  if (isVercel) {
    const user = await kv.get(userKey(userId));
    if (!user) return null;
    const updated = { ...user, faction: normalized };
    await kv.set(userKey(userId), updated);
    return updated;
  }
  const statement = database.prepare('UPDATE users SET faction = ? WHERE id = ?');
  statement.run(normalized, userId);
  return getUserById(userId);
}

export async function getFactionByUserId(userId) {
  if (isVercel) {
    const user = await kv.get(userKey(userId));
    return user ? user.faction : null;
  }
  const statement = database.prepare('SELECT faction FROM users WHERE id = ?');
  const row = statement.get(userId);
  return row ? row.faction : null;
}

export default database;

