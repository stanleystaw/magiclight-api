/**
 * lib/mailer.js — Service d'Envoi Réel d'E-mails OTP & Blocage Strict Anti-Fraude
 *
 * Supporte :
 * 1. Gmail SMTP (GMAIL_USER / GMAIL_PASS)
 * 2. Serveurs SMTP personnalisés (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
 * 3. Resend API (RESEND_API_KEY)
 * 4. Détection et blocage des faux e-mails et domaines jetables
 */

const nodemailer = require("nodemailer");
const crypto = require("crypto");

// Liste noire étendue des domaines jetables / faux e-mails
const DISPOSABLE_DOMAINS = new Set([
  "guerrillamail.com", "guerrillamailblock.com", "sharklasers.com", "grr.la", "guerrillamail.biz",
  "tempmail.com", "temp-mail.org", "10minutemail.com", "10minutemail.net", "mailinator.com",
  "yopmail.com", "yopmail.fr", "dispostable.com", "trashmail.com", "burnermail.io",
  "getairmail.com", "throwawaymail.com", "mohmal.com", "crazymailing.com", "mytemp.email",
  "fakemailgenerator.com", "emailondeck.com", "tempail.com", "tempmailaddress.com",
  "generator.email", "generator.email.com", "armyspy.com", "cuvox.de", "dayrep.com",
  "einrot.com", "fleckens.hu", "gustr.com", "jourrapide.com", "rhyta.com", "superrito.com",
  "teleworm.us", "inboxkitten.com", "nada.ltd", "getnada.com", "abovethefray.com"
]);

function isDisposableEmail(email) {
  if (!email || !email.includes("@")) return true;
  const parts = email.split("@");
  if (parts.length !== 2) return true;
  const domain = parts[1].toLowerCase().trim();
  if (!domain || !domain.includes(".")) return true;
  return DISPOSABLE_DOMAINS.has(domain);
}

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function getTransporter() {
  const user = process.env.GMAIL_USER || process.env.SMTP_USER;
  const pass = process.env.GMAIL_PASS || process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "465", 10);

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

async function sendOtpEmail(toEmail, otpCode) {
  const cleanEmail = toEmail.trim().toLowerCase();

  // 1. Envoi via Resend si configuré
  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || "Stanley Stawa AI <onboarding@resend.dev>",
          to: [cleanEmail],
          subject: `${otpCode} est votre code de vérification Stanley Stawa AI`,
          html: getEmailHtml(otpCode)
        })
      });
      if (res.ok) {
        console.log(`[Resend] E-mail OTP envoyé à ${cleanEmail}`);
        return { sent: true };
      }
    } catch (err) {
      console.warn("[Resend Error]", err.message);
    }
  }

  // 2. Envoi via SMTP / Gmail
  const transporter = getTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"Stanley Stawa AI" <${process.env.GMAIL_USER || process.env.SMTP_USER}>`,
        to: cleanEmail,
        subject: `${otpCode} est votre code de vérification Stanley Stawa AI`,
        html: getEmailHtml(otpCode)
      });
      console.log(`[SMTP] E-mail OTP envoyé à ${cleanEmail}`);
      return { sent: true };
    } catch (err) {
      console.error("[SMTP Error]", err.message);
      return { sent: false, error: err.message };
    }
  }

  console.warn(`[Mailer Warning] Aucun serveur SMTP ou clé Resend configuré pour envoyer l'e-mail à ${cleanEmail}.`);
  return { sent: false, error: "Service d'envoi d'e-mail non configuré (GMAIL_USER/PASS requis)." };
}

function getEmailHtml(otpCode) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;background:#090b10;color:#f0f3f8;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);padding:36px 28px;text-align:center;">
      <h1 style="font-size:20px;font-weight:800;margin:0 0 6px;color:#ffffff;letter-spacing:-0.4px;">Stanley Stawa <span style="color:#00f2ad;">AI Studio</span></h1>
      <p style="font-size:13px;color:#8b949e;margin:0 0 28px;">Vérification de votre compte (+100 Crédits de bienvenue)</p>
      
      <div style="background:rgba(0,242,173,0.06);border:2px dashed #00f2ad;border-radius:14px;padding:20px 14px;margin-bottom:28px;">
        <span style="font-size:36px;font-weight:900;letter-spacing:10px;color:#00f2ad;font-family:monospace;">${otpCode}</span>
      </div>

      <p style="font-size:13px;color:#8b949e;line-height:1.6;margin:0 0 24px;">
        Saisissez ce code à 6 chiffres pour valider votre compte et activer votre clé API personnelle. Ce code est valable pendant <strong>10 minutes</strong>.
      </p>

      <div style="font-size:11px;color:#545d68;border-top:1px solid rgba(255,255,255,0.08);padding-top:20px;">
        Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail en toute sécurité.<br>
        © 2026 Stanley Stawa AI • Système de Protection & Sécurité
      </div>
    </div>
  `;
}

module.exports = {
  isDisposableEmail,
  generateOtp,
  sendOtpEmail
};
