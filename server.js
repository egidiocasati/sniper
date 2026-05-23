const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const config = require('./src/config');
const db = require('./src/db');
const scheduler = require('./src/services/scheduler');
const csrfMiddleware = require('./src/middleware/csrf');

const app = express();

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: './data' }),
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'sniper.sid',
    cookie: {
        secure: config.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(csrfMiddleware);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/settings/public', (req, res) => {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('app_subtitle', 'countdown_enabled', 'confirmation_min_minutes')").all();
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json(settings);
});

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/photos', require('./src/routes/photos'));
app.use('/', require('./src/routes/pages'));

app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File troppo grande (max 5MB)' });
    }
    if (err.message?.includes('Formato file non supportato')) {
        return res.status(400).json({ error: err.message });
    }
    console.error('[Error]', err);
    res.status(500).json({ error: 'Errore interno del server' });
});

scheduler.start();

app.listen(config.PORT, () => {
    console.log(`Sniper avviato su porta ${config.PORT}`);
});
