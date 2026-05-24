const db = require('../db');

function requireAdmin(req, res, next) {
    const user = db.prepare('SELECT role FROM users WHERE id = ? AND active = 1').get(req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Accesso non autorizzato' });
    }
    req.userRole = user.role;
    next();
}

function requireAdminOrCouncilor(req, res, next) {
    const user = db.prepare('SELECT role FROM users WHERE id = ? AND active = 1').get(req.session.userId);
    if (!user || (user.role !== 'admin' && user.role !== 'councilor')) {
        return res.status(403).json({ error: 'Accesso non autorizzato' });
    }
    req.userRole = user.role;
    next();
}

module.exports = { requireAdmin, requireAdminOrCouncilor };
