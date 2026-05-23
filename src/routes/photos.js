const express = require('express');
const router = express.Router();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(requireAuth);

router.post('/upload', upload.single('photo'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Foto obbligatoria' });
    }
    const photoUuid = uuidv4();
    const serverTs = new Date().toISOString();
    const notes = req.body.notes?.trim() || null;

    db.prepare(`
        INSERT INTO photos (uuid, user_id, filename, status, notes, server_ts)
        VALUES (?, ?, ?, 'PENDING', ?, ?)
    `).run(photoUuid, req.session.userId, req.file.filename, notes, serverTs);

    res.json({
        ok: true,
        photo: { uuid: photoUuid, status: 'PENDING', server_ts: serverTs, notes }
    });
});

router.get('/', (req, res) => {
    const status = req.query.status;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    let where = 'WHERE p.parent_id IS NULL';
    const params = [];
    if (status && ['PENDING', 'INFRAZIONE', 'SCARTO'].includes(status)) {
        where += ' AND p.status = ?';
        params.push(status);
    }

    const photos = db.prepare(`
        SELECT p.uuid, p.status, p.notes, p.server_ts, p.confirmed_at,
               u.name AS user_name,
               cp.uuid AS confirmed_photo_uuid
        FROM photos p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN photos cp ON cp.id = p.confirmed_photo_id
        ${where}
        ORDER BY p.server_ts DESC
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const countRow = db.prepare(
        `SELECT COUNT(*) AS total FROM photos p ${where}`
    ).get(...params);

    res.json({ photos, total: countRow.total, page, limit });
});

router.get('/confirmable', (req, res) => {
    const minMinutes = config.CONFIRMATION_MIN_MINUTES;
    const photos = db.prepare(`
        SELECT p.uuid, p.notes, p.server_ts, u.name AS user_name
        FROM photos p
        JOIN users u ON u.id = p.user_id
        WHERE p.status = 'PENDING'
          AND p.parent_id IS NULL
          AND datetime(p.server_ts, '+' || ? || ' minutes') <= datetime('now')
        ORDER BY p.server_ts ASC
    `).all(minMinutes);
    res.json(photos);
});

router.get('/:uuid', (req, res) => {
    const photo = db.prepare(`
        SELECT p.uuid, p.status, p.notes, p.server_ts, p.confirmed_at,
               u.name AS user_name,
               cp.uuid AS confirmed_photo_uuid, cp.server_ts AS confirmed_photo_ts,
               cp.notes AS confirmed_notes
        FROM photos p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN photos cp ON cp.id = p.confirmed_photo_id
        WHERE p.uuid = ?
    `).get(req.params.uuid);

    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });
    res.json(photo);
});

router.get('/:uuid/image', (req, res) => {
    const photo = db.prepare('SELECT filename FROM photos WHERE uuid = ?').get(req.params.uuid);
    if (!photo) return res.status(404).json({ error: 'Foto non trovata' });
    res.sendFile(path.resolve(config.UPLOAD_DIR, photo.filename));
});

router.post('/:uuid/confirm', upload.single('photo'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Foto di conferma obbligatoria' });
    }

    const original = db.prepare(
        "SELECT * FROM photos WHERE uuid = ? AND status = 'PENDING' AND parent_id IS NULL"
    ).get(req.params.uuid);
    if (!original) {
        return res.status(404).json({ error: 'Foto pendente non trovata' });
    }

    const countdownSetting = db.prepare("SELECT value FROM settings WHERE key = 'countdown_enabled'").get();
    const countdownEnabled = !countdownSetting || countdownSetting.value !== 'false';

    if (countdownEnabled) {
        const originalTime = new Date(original.server_ts).getTime();
        const now = Date.now();
        const elapsedMinutes = (now - originalTime) / (1000 * 60);

        if (elapsedMinutes < config.CONFIRMATION_MIN_MINUTES) {
            const remaining = Math.ceil(config.CONFIRMATION_MIN_MINUTES - elapsedMinutes);
            return res.status(400).json({
                error: `Devi attendere ancora ${remaining} minuti prima di confermare.`
            });
        }
    }

    const confirmUuid = uuidv4();
    const serverTs = new Date().toISOString();
    const notes = req.body.notes?.trim() || null;

    db.transaction(() => {
        const info = db.prepare(`
            INSERT INTO photos (uuid, user_id, filename, status, notes, server_ts, parent_id)
            VALUES (?, ?, ?, 'INFRAZIONE', ?, ?, ?)
        `).run(confirmUuid, req.session.userId, req.file.filename, notes, serverTs, original.id);

        db.prepare(`
            UPDATE photos SET status = 'INFRAZIONE', confirmed_photo_id = ?, confirmed_at = ?
            WHERE id = ?
        `).run(info.lastInsertRowid, serverTs, original.id);
    })();

    res.json({
        ok: true,
        infraction: {
            originalUuid: req.params.uuid,
            confirmationUuid: confirmUuid,
            confirmedAt: serverTs
        }
    });
});

module.exports = router;
