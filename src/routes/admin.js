const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const emailService = require('../services/email');

router.use(requireAuth, requireAdmin);

router.get('/users', (req, res) => {
    const users = db.prepare(
        'SELECT id, email, name, role, active, created_at FROM users ORDER BY created_at DESC'
    ).all();
    res.json(users);
});

router.post('/users/:id/toggle', (req, res) => {
    const user = db.prepare('SELECT id, active, role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Non puoi disabilitare un admin' });

    const newActive = user.active ? 0 : 1;
    db.prepare("UPDATE users SET active = ?, updated_at = datetime('now') WHERE id = ?").run(newActive, user.id);
    res.json({ ok: true, active: newActive });
});

router.post('/invite', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email obbligatoria' });

    const normalized = email.toLowerCase().trim();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
    if (existing) return res.status(409).json({ error: 'Utente gia registrato' });

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    db.prepare(
        'INSERT INTO invites (email, token, invited_by, expires_at) VALUES (?, ?, ?, ?)'
    ).run(normalized, token, req.session.userId, expiresAt);

    try {
        await emailService.sendInvite(normalized, token);
        res.json({ ok: true });
    } catch (e) {
        console.error('[Admin] Errore invio invito:', e.message);
        res.json({ ok: true, warning: 'Invito creato ma email non inviata' });
    }
});

// --- Settings ---

router.get('/settings', (req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }
    res.json(settings);
});

router.put('/settings', (req, res) => {
    const allowed = ['app_subtitle', 'confirmation_min_minutes', 'pending_timeout_minutes', 'countdown_enabled'];
    const updates = req.body;

    const upsert = db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );

    db.transaction(() => {
        for (const [key, value] of Object.entries(updates)) {
            if (allowed.includes(key) && typeof value === 'string' && value.trim()) {
                upsert.run(key, value.trim());
            }
        }
    })();

    res.json({ ok: true });
});

// --- Photo management ---

router.get('/photos', (req, res) => {
    const status = req.query.status;
    let where = 'WHERE p.parent_id IS NULL';
    const params = [];
    if (status && ['PENDING', 'INFRAZIONE', 'SCARTO'].includes(status)) {
        where += ' AND p.status = ?';
        params.push(status);
    }

    const photos = db.prepare(`
        SELECT p.uuid, p.status, p.notes, p.server_ts, p.confirmed_at,
               u.name AS user_name, u.email AS user_email,
               cp.uuid AS confirmed_photo_uuid
        FROM photos p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN photos cp ON cp.id = p.confirmed_photo_id
        ${where}
        ORDER BY p.server_ts DESC
    `).all(...params);

    res.json(photos);
});

router.post('/photos/:uuid/discard', (req, res) => {
    const photo = db.prepare(
        "SELECT * FROM photos WHERE uuid = ? AND parent_id IS NULL"
    ).get(req.params.uuid);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });
    if (photo.status === 'SCARTO') return res.json({ ok: true, status: 'SCARTO' });

    db.transaction(() => {
        db.prepare("UPDATE photos SET status = 'SCARTO' WHERE id = ?").run(photo.id);
        // Also discard the confirmation photo if exists
        if (photo.confirmed_photo_id) {
            db.prepare("UPDATE photos SET status = 'SCARTO' WHERE id = ?").run(photo.confirmed_photo_id);
        }
    })();

    res.json({ ok: true, status: 'SCARTO' });
});

router.delete('/photos/:uuid', (req, res) => {
    const photo = db.prepare(
        "SELECT * FROM photos WHERE uuid = ? AND parent_id IS NULL"
    ).get(req.params.uuid);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });

    db.transaction(() => {
        // Delete confirmation photo if exists
        if (photo.confirmed_photo_id) {
            const confirmPhoto = db.prepare('SELECT filename FROM photos WHERE id = ?').get(photo.confirmed_photo_id);
            if (confirmPhoto) {
                const confirmPath = path.resolve(config.UPLOAD_DIR, confirmPhoto.filename);
                try { fs.unlinkSync(confirmPath); } catch (e) { /* file may not exist */ }
            }
            db.prepare('DELETE FROM photos WHERE id = ?').run(photo.confirmed_photo_id);
        }
        // Delete child photos (confirmations pointing to this)
        const children = db.prepare('SELECT id, filename FROM photos WHERE parent_id = ?').all(photo.id);
        for (const child of children) {
            const childPath = path.resolve(config.UPLOAD_DIR, child.filename);
            try { fs.unlinkSync(childPath); } catch (e) { /* ignore */ }
            db.prepare('DELETE FROM photos WHERE id = ?').run(child.id);
        }
        // Delete main photo
        const mainPath = path.resolve(config.UPLOAD_DIR, photo.filename);
        try { fs.unlinkSync(mainPath); } catch (e) { /* ignore */ }
        db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
    })();

    res.json({ ok: true });
});

module.exports = router;
