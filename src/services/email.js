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
    await t.sendMail({
        from: `"Sniper Parcheggio" <${config.SMTP_FROM}>`,
        replyTo: config.SMTP_FROM,
        to,
        subject,
        html,
        headers: {
            'X-Mailer': 'Sniper Parcheggio',
            'List-Unsubscribe': `<mailto:${config.SMTP_FROM}?subject=unsubscribe>`
        }
    });
}

async function sendInvite(email, token) {
    const url = `${config.APP_URL}/register?token=${token}`;
    await sendMail(email, 'Sei stato invitato a Sniper Parcheggio', `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
    <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; border: 1px solid #e9ecef;">
        <h2 style="margin-top: 0; color: #212529;">Sei stato invitato!</h2>
        <p>Ciao,</p>
        <p>Sei stato invitato a unirti a <strong>Sniper Parcheggio</strong>, l'app per la gestione del parcheggio condominiale.</p>
        <p>Per completare la registrazione, clicca il pulsante qui sotto:</p>
        <p style="text-align: center; margin: 24px 0;">
            <a href="${url}" style="background: #0d6efd; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Registrati ora</a>
        </p>
        <p style="font-size: 0.85rem; color: #6c757d;">Se il pulsante non funziona, copia e incolla questo link nel browser:<br>
        <a href="${url}" style="color: #0d6efd; word-break: break-all;">${url}</a></p>
        <hr style="border: none; border-top: 1px solid #e9ecef; margin: 20px 0;">
        <p style="font-size: 0.8rem; color: #999; margin-bottom: 0;">Questo invito scade tra 48 ore. Se non hai richiesto questo invito, puoi ignorare questa email.</p>
    </div>
</body>
</html>`);
}

async function sendPasswordReset(email, token) {
    const url = `${config.APP_URL}/reset-password?token=${token}`;
    await sendMail(email, 'Reset password - Sniper Parcheggio', `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
    <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; border: 1px solid #e9ecef;">
        <h2 style="margin-top: 0; color: #212529;">Reset password</h2>
        <p>Ciao,</p>
        <p>Hai richiesto il reset della password per <strong>Sniper Parcheggio</strong>.</p>
        <p>Per reimpostare la password, clicca il pulsante qui sotto:</p>
        <p style="text-align: center; margin: 24px 0;">
            <a href="${url}" style="background: #0d6efd; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Reimposta password</a>
        </p>
        <p style="font-size: 0.85rem; color: #6c757d;">Se il pulsante non funziona, copia e incolla questo link nel browser:<br>
        <a href="${url}" style="color: #0d6efd; word-break: break-all;">${url}</a></p>
        <hr style="border: none; border-top: 1px solid #e9ecef; margin: 20px 0;">
        <p style="font-size: 0.8rem; color: #999; margin-bottom: 0;">Questo link scade tra 1 ora. Se non hai richiesto il reset, puoi ignorare questa email.</p>
    </div>
</body>
</html>`);
}

module.exports = { sendInvite, sendPasswordReset };
