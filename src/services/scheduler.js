const db = require('../db');
const config = require('../config');

function discardExpiredPending() {
    const timeout = config.PENDING_TIMEOUT_MINUTES;
    const result = db.prepare(`
        UPDATE photos
        SET status = 'SCARTO'
        WHERE status = 'PENDING'
          AND parent_id IS NULL
          AND datetime(server_ts, '+' || ? || ' minutes') <= datetime('now')
    `).run(timeout);

    if (result.changes > 0) {
        console.log(`[Scheduler] ${result.changes} foto scadute -> SCARTO`);
    }
}

function start() {
    setInterval(discardExpiredPending, 5 * 60 * 1000);
    discardExpiredPending();
    console.log(`[Scheduler] Auto-discard attivo (timeout: ${config.PENDING_TIMEOUT_MINUTES} min)`);
}

module.exports = { start, discardExpiredPending };
