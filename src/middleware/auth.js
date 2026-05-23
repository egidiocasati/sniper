function requireAuth(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Non autenticato' });
    }
    next();
}

module.exports = { requireAuth };
