const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Troppi tentativi. Riprova tra 15 minuti.' },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = { loginLimiter };
