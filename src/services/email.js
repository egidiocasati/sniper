const nodemailer = require('nodemailer');
const config = require('../config');

let transporter;

function getTransporter() {
    if (!transporter) {
        if (!config.SMTP_USER) {
            console.warn('SMTP non configurato: le email verranno stampate a console');
            return null;
        }
        transporter = nodemailer.createTransport({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            secure: config.SMTP_PORT === 465,
            auth: { user: config.SMTP_USER, pass: config.SMTP_PASS }
        });
    }
    return transporter;
}

async function sendMail(to, subject, html) {
    const t = getTransporter();
    if (!t) {
        console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
        return;
    }
    await t.sendMail({ from: config.SMTP_FROM, to, subject, html });
}

async function sendInvite(email, token) {
    const url = `${config.APP_URL}/register?token=${token}`;
    await sendMail(email, 'Invito - Sniper Parcheggio', `
        <h2>Sei stato invitato a Sniper</h2>
        <p>Clicca il link per registrarti:</p>
        <p><a href="${url}">${url}</a></p>
        <p>Il link scade tra 48 ore.</p>
    `);
}

async function sendPasswordReset(email, token) {
    const url = `${config.APP_URL}/reset-password?token=${token}`;
    await sendMail(email, 'Reset password - Sniper', `
        <h2>Reset password</h2>
        <p>Clicca il link per reimpostare la password:</p>
        <p><a href="${url}">${url}</a></p>
        <p>Il link scade tra 1 ora.</p>
    `);
}

module.exports = { sendInvite, sendPasswordReset };
