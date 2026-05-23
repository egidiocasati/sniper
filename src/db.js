const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const config = require('./config');

const dataDir = path.dirname(path.resolve(config.DB_PATH));
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.resolve(config.DB_PATH));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        email       TEXT UNIQUE NOT NULL,
        password    TEXT NOT NULL,
        name        TEXT NOT NULL,
        role        TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invites (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        email       TEXT NOT NULL,
        token       TEXT UNIQUE NOT NULL,
        invited_by  INTEGER NOT NULL REFERENCES users(id),
        used        INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        token       TEXT UNIQUE NOT NULL,
        used        INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS photos (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid                TEXT UNIQUE NOT NULL,
        user_id             INTEGER NOT NULL REFERENCES users(id),
        filename            TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK(status IN ('PENDING','INFRAZIONE','SCARTO')),
        notes               TEXT,
        server_ts           TEXT NOT NULL,
        parent_id           INTEGER REFERENCES photos(id),
        confirmed_photo_id  INTEGER REFERENCES photos(id),
        confirmed_at        TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
    CREATE INDEX IF NOT EXISTS idx_photos_user ON photos(user_id);
    CREATE INDEX IF NOT EXISTS idx_photos_uuid ON photos(uuid);
    CREATE INDEX IF NOT EXISTS idx_photos_parent ON photos(parent_id);

    CREATE TABLE IF NOT EXISTS settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

// Seed default settings
const defaultSettings = {
    app_subtitle: 'Viale Teodorico 7',
    confirmation_min_minutes: '30',
    pending_timeout_minutes: '240',
    countdown_enabled: 'true',
};
const upsertSetting = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO NOTHING`
);
for (const [key, value] of Object.entries(defaultSettings)) {
    upsertSetting.run(key, value);
}

const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!adminExists) {
    const password = config.ADMIN_PASSWORD || crypto.randomBytes(12).toString('hex');
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)')
      .run('admin@sniper.local', hash, 'Amministratore', 'admin');
    if (!config.ADMIN_PASSWORD) {
        console.log('');
        console.log('  *** Account admin creato ***');
        console.log('  Email:    admin@sniper.local');
        console.log(`  Password: ${password}`);
        console.log('');
    }
}

module.exports = db;
