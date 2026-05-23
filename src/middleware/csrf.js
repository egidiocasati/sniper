const crypto = require('crypto');

function csrfMiddleware(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    // Exempt routes that are accessed before having a session
    const exempt = ['/api/health', '/api/auth/login', '/api/auth/register',
                    '/api/auth/forgot-password', '/api/auth/reset-password'];
    if (exempt.includes(req.path)) return next();

    const sessionToken = req.session && req.session.csrfToken;
    const requestToken = req.headers['x-csrf-token'] || req.body?._csrf;

    if (!sessionToken || !requestToken || sessionToken !== requestToken) {
        return res.status(403).json({ error: 'Token CSRF non valido' });
    }
    next();
}

function generateCsrfToken(req) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    return req.session.csrfToken;
}

module.exports = csrfMiddleware;
module.exports.generateCsrfToken = generateCsrfToken;
