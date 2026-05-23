const express = require('express');
const router = express.Router();
const path = require('path');

const pagesDir = path.join(__dirname, '../../public/pages');

router.get('/login', (req, res) => {
    res.sendFile(path.join(pagesDir, 'login.html'));
});

router.get('/register', (req, res) => {
    res.sendFile(path.join(pagesDir, 'login.html'));
});

router.get('/reset-password', (req, res) => {
    res.sendFile(path.join(pagesDir, 'reset-password.html'));
});

router.get('/', (req, res) => {
    res.sendFile(path.join(pagesDir, 'app.html'));
});

router.get('/admin', (req, res) => {
    res.sendFile(path.join(pagesDir, 'admin.html'));
});

router.get('/privacy', (req, res) => {
    res.sendFile(path.join(pagesDir, 'privacy.html'));
});

router.get('/cookies', (req, res) => {
    res.sendFile(path.join(pagesDir, 'cookies.html'));
});

router.get('/terms', (req, res) => {
    res.sendFile(path.join(pagesDir, 'terms.html'));
});

module.exports = router;
