const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { loginLimiter } = require('../middleware/rateLimit');
const emailService = require('../services/email');
const { generateCsrfToken } = require('../middleware/csrf');

router.post('/login', loginLimiter, (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email e password obbligatori' });
    }
    const user = db.prepare(
        'SELECT * FROM users WHERE email = ? AND active = 1'
    ).get(email.toLowerCase().trim());

    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Credenziali non valide' });
    }
    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userName = user.name;
    res.json({ ok: true, user: { name: user.name, role: user.role } });
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('sniper.sid');
        res.json({ ok: true });
    });
});

router.post('/forgot-password', loginLimiter, async (req, res) => {
    const { email } = req.body;
    res.json({ ok: true, message: "Se l'email esiste, riceverai un link di reset." });

    const user = db.prepare(
        'SELECT id FROM users WHERE email = ? AND active = 1'
    ).get(email?.toLowerCase().trim());
    if (!user) return;

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(
        'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).run(user.id, token, expiresAt);

    try {
        await emailService.sendPasswordReset(email, token);
    } catch (e) {
        console.error('[Auth] Errore invio email reset:', e.message);
    }
});

router.post('/reset-password', (req, res) => {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
        return res.status(400).json({ error: 'Token e password (min 8 caratteri) obbligatori' });
    }
    const reset = db.prepare(
        "SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime('now')"
    ).get(token);
    if (!reset) {
        return res.status(400).json({ error: 'Link di reset non valido o scaduto' });
    }
    const hash = bcrypt.hashSync(password, 10);
    db.transaction(() => {
        db.prepare("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?").run(hash, reset.user_id);
        db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
    })();
    res.json({ ok: true });
});

router.post('/register', (req, res) => {
    const { token, name, password } = req.body;
    if (!token || !name || !password || password.length < 8) {
        return res.status(400).json({ error: 'Dati mancanti o password troppo corta (min 8)' });
    }
    const invite = db.prepare(
        "SELECT * FROM invites WHERE token = ? AND used = 0 AND expires_at > datetime('now')"
    ).get(token);
    if (!invite) {
        return res.status(400).json({ error: 'Invito non valido o scaduto' });
    }
    const hash = bcrypt.hashSync(password, 10);
    try {
        db.transaction(() => {
            db.prepare('INSERT INTO users (email, password, name) VALUES (?, ?, ?)').run(invite.email, hash, name);
            db.prepare('UPDATE invites SET used = 1 WHERE id = ?').run(invite.id);
        })();
        res.json({ ok: true });
    } catch (e) {
        if (e.message.includes('UNIQUE constraint')) {
            return res.status(409).json({ error: 'Utente gia registrato' });
        }
        throw e;
    }
});

router.get('/me', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Non autenticato' });
    }
    const config = require('../config');
    res.json({
        userId: req.session.userId,
        name: req.session.userName,
        role: req.session.userRole,
        csrfToken: generateCsrfToken(req),
        confirmationMinMinutes: config.CONFIRMATION_MIN_MINUTES,
        serverTime: new Date().toISOString()
    });
});

module.exports = router;
