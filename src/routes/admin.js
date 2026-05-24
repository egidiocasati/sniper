const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requireAdminOrCouncilor } = require('../middleware/admin');
const emailService = require('../services/email');

router.get('/users', requireAuth, requireAdminOrCouncilor, (req, res) => {
    const users = db.prepare(
        'SELECT id, email, name, role, active, created_at FROM users ORDER BY created_at DESC'
    ).all();
    res.json(users);
});

router.post('/users/:id/toggle', requireAuth, requireAdminOrCouncilor, (req, res) => {
    const user = db.prepare('SELECT id, active, role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Non puoi disabilitare un admin' });
    if (req.userRole === 'councilor' && user.role === 'councilor') {
        return res.status(400).json({ error: 'Un consigliere non può modificare un altro consigliere' });
    }

    const newActive = user.active ? 0 : 1;
    db.prepare("UPDATE users SET active = ?, updated_at = datetime('now') WHERE id = ?").run(newActive, user.id);
    res.json({ ok: true, active: newActive });
});

router.post('/users/:id/role', requireAuth, requireAdmin, (req, res) => {
    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Non puoi modificare il ruolo di un admin' });

    const newRole = user.role === 'councilor' ? 'user' : 'councilor';
    db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(newRole, user.id);
    res.json({ ok: true, role: newRole });
});

router.post('/invite', requireAuth, requireAdminOrCouncilor, async (req, res) => {
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

// --- Invites ---

router.get('/invites', requireAuth, requireAdminOrCouncilor, (req, res) => {
    const invites = db.prepare(`
        SELECT i.id, i.email, i.used, i.created_at, i.expires_at,
               u.name AS invited_by_name
        FROM invites i
        JOIN users u ON u.id = i.invited_by
        ORDER BY i.created_at DESC
    `).all();

    const now = new Date().toISOString();
    const result = invites.map(inv => ({
        ...inv,
        status: inv.used ? 'accepted' : (inv.expires_at < now ? 'expired' : 'pending')
    }));

    res.json(result);
});

router.delete('/invites/:id', requireAuth, requireAdminOrCouncilor, (req, res) => {
    const invite = db.prepare('SELECT id, used FROM invites WHERE id = ?').get(req.params.id);
    if (!invite) return res.status(404).json({ error: 'Invito non trovato' });
    if (invite.used) return res.status(400).json({ error: 'Invito già accettato, non annullabile' });

    db.prepare('DELETE FROM invites WHERE id = ?').run(invite.id);
    res.json({ ok: true });
});

router.post('/invites/:id/resend', requireAuth, requireAdminOrCouncilor, async (req, res) => {
    const invite = db.prepare('SELECT id, email, used FROM invites WHERE id = ?').get(req.params.id);
    if (!invite) return res.status(404).json({ error: 'Invito non trovato' });
    if (invite.used) return res.status(400).json({ error: 'Invito già accettato' });

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE invites SET token = ?, expires_at = ? WHERE id = ?').run(token, expiresAt, invite.id);

    try {
        await emailService.sendInvite(invite.email, token);
        res.json({ ok: true });
    } catch (e) {
        console.error('[Admin] Errore re-invio invito:', e.message);
        res.json({ ok: true, warning: 'Invito aggiornato ma email non inviata' });
    }
});

// --- Settings ---

router.get('/settings', requireAuth, requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }
    res.json(settings);
});

router.put('/settings', requireAuth, requireAdmin, (req, res) => {
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

router.get('/photos', requireAuth, requireAdminOrCouncilor, (req, res) => {
    const status = req.query.status;
    const archived = req.query.archived === '1' ? 1 : 0;
    let where = 'WHERE p.parent_id IS NULL AND p.archived = ?';
    const params = [archived];
    if (status && ['PENDING', 'INFRAZIONE', 'SCARTO'].includes(status)) {
        where += ' AND p.status = ?';
        params.push(status);
    }

    const photos = db.prepare(`
        SELECT p.uuid, p.status, p.notes, p.server_ts, p.confirmed_at,
               p.archived,
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

router.post('/photos/:uuid/archive', requireAuth, requireAdminOrCouncilor, (req, res) => {
    const photo = db.prepare(
        "SELECT * FROM photos WHERE uuid = ? AND parent_id IS NULL"
    ).get(req.params.uuid);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });
    if (photo.status !== 'INFRAZIONE') return res.status(400).json({ error: 'Solo le infrazioni possono essere archiviate' });

    db.prepare("UPDATE photos SET archived = 1 WHERE id = ?").run(photo.id);
    res.json({ ok: true });
});

router.post('/photos/:uuid/unarchive', requireAuth, requireAdminOrCouncilor, (req, res) => {
    const photo = db.prepare(
        "SELECT * FROM photos WHERE uuid = ? AND parent_id IS NULL"
    ).get(req.params.uuid);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });

    db.prepare("UPDATE photos SET archived = 0 WHERE id = ?").run(photo.id);
    res.json({ ok: true });
});

router.get('/photos/report', requireAuth, requireAdminOrCouncilor, (req, res) => {
    const status = req.query.status || 'INFRAZIONE';
    const archived = req.query.archived === '1' ? 1 : 0;
    let where = 'WHERE p.parent_id IS NULL AND p.archived = ?';
    const params = [archived];
    if (['PENDING', 'INFRAZIONE', 'SCARTO'].includes(status)) {
        where += ' AND p.status = ?';
        params.push(status);
    }

    const photos = db.prepare(`
        SELECT p.uuid, p.status, p.notes, p.server_ts, p.confirmed_at,
               p.filename,
               u.name AS user_name, u.email AS user_email,
               cp.uuid AS confirmed_photo_uuid, cp.filename AS confirmed_filename
        FROM photos p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN photos cp ON cp.id = p.confirmed_photo_id
        ${where}
        ORDER BY p.server_ts DESC
    `).all(...params);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-infrazioni-${dateStr}.pdf"`);
    doc.pipe(res);

    // Title page
    doc.fontSize(22).text('Report Infrazioni', { align: 'center' });
    doc.fontSize(12).text('Sniper Parcheggio', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#757575')
       .text(`Generato il ${now.toLocaleString('it-IT')}`, { align: 'center' });
    doc.fillColor('#212121');

    if (photos.length === 0) {
        doc.moveDown(2);
        doc.fontSize(14).text('Nessuna infrazione trovata.', { align: 'center' });
    }

    for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        if (i > 0) doc.addPage();

        doc.fontSize(14).text(`Infrazione #${i + 1}`, { underline: true });
        doc.moveDown(0.5);

        doc.fontSize(10);
        doc.text(`Stato: ${p.status}`);
        doc.text(`Data scatto: ${p.server_ts ? new Date(p.server_ts).toLocaleString('it-IT') : '-'}`);
        if (p.confirmed_at) {
            doc.text(`Data conferma: ${new Date(p.confirmed_at).toLocaleString('it-IT')}`);
        }
        doc.text(`Utente: ${p.user_name} (${p.user_email})`);
        if (p.notes) {
            doc.text(`Note: ${p.notes}`);
        }
        doc.moveDown(0.5);

        // Main photo
        const mainPath = path.resolve(config.UPLOAD_DIR, p.filename);
        if (fs.existsSync(mainPath)) {
            doc.text('Foto originale:', { underline: true });
            doc.moveDown(0.3);
            try {
                doc.image(mainPath, { width: 350 });
            } catch (e) {
                doc.text('[Impossibile caricare immagine]');
            }
        }

        // Confirmation photo
        if (p.confirmed_filename) {
            doc.moveDown(0.5);
            const confirmPath = path.resolve(config.UPLOAD_DIR, p.confirmed_filename);
            if (fs.existsSync(confirmPath)) {
                doc.text('Foto di conferma:', { underline: true });
                doc.moveDown(0.3);
                try {
                    doc.image(confirmPath, { width: 350 });
                } catch (e) {
                    doc.text('[Impossibile caricare immagine]');
                }
            }
        }
    }

    doc.end();
});

router.post('/photos/:uuid/discard', requireAuth, requireAdminOrCouncilor, (req, res) => {
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

router.delete('/photos/:uuid', requireAuth, requireAdminOrCouncilor, (req, res) => {
    const photo = db.prepare(
        "SELECT * FROM photos WHERE uuid = ? AND parent_id IS NULL"
    ).get(req.params.uuid);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });

    db.transaction(() => {
        // Clear FK reference before deleting confirmation photo
        if (photo.confirmed_photo_id) {
            db.prepare('UPDATE photos SET confirmed_photo_id = NULL WHERE id = ?').run(photo.id);
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
