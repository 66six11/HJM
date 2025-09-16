import Database from 'better-sqlite3';

const isVercel = Boolean(process.env.VERCEL);
const databaseFile = isVercel ? '/tmp/data.db' : 'data.db';
const database = new Database(databaseFile);

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

export function getUserByGithubId(githubId) {
  const statement = database.prepare('SELECT id, githubId, username, avatarUrl, faction FROM users WHERE githubId = ?');
  return statement.get(githubId) || null;
}

export function getUserById(userId) {
  const statement = database.prepare('SELECT id, githubId, username, avatarUrl, faction FROM users WHERE id = ?');
  return statement.get(userId) || null;
}

export function createOrUpdateUser(profile) {
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

export function createAnonymousUser(username = 'Guest') {
  const insertStatement = database.prepare('INSERT INTO users (githubId, username, avatarUrl, faction) VALUES (NULL, ?, NULL, NULL)');
  const result = insertStatement.run(username);
  return getUserById(result.lastInsertRowid);
}

export function setUserFaction(userId, faction) {
  const normalized = faction === 'A' ? 'A' : faction === 'B' ? 'B' : null;
  if (!normalized) {
    throw new Error('Invalid faction');
  }
  const statement = database.prepare('UPDATE users SET faction = ? WHERE id = ?');
  statement.run(normalized, userId);
  return getUserById(userId);
}

export function getFactionByUserId(userId) {
  const statement = database.prepare('SELECT faction FROM users WHERE id = ?');
  const row = statement.get(userId);
  return row ? row.faction : null;
}

export default database;

