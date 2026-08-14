/**
 * lib/mailer.js — Service d'Envoi d'E-mails OTP & Détection des E-mails Jetables (Anti-Fraude)
 */

const nodemailer = require("nodemailer");
const crypto = require("crypto");

// Domaines temporaires / jetables interdits
const DISPOSABLE_DOMAINS = new Set([
  "guerrillamail.com", "guerrillamailblock.com", "sharklasers.com", "grr.la", "guerrillamail.biz",
  "tempmail.com", "temp-mail.org", "10minutemail.com", "10minutemail.net", "mailinator.com",
  "yopmail.com", "yopmail.fr", "dispostable.com", "trashmail.com", "burnermail.io",
  "getairmail.com", "throwawaymail.com", "mohmal.com", "crazymailing.com", "mytemp.email"
]);

function isDisposableEmail(email) {
  if (!email || !email.includes("@")) return true;
  const domain = email.split("@")[1]?.toLowerCase()?.trim();
  if (!domain) return true;
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
  const transporter = getTransporter();

  const htmlContent = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;background:#0b0f19;color:#f9fafb;border-radius:14px;overflow:hidden;border:1px solid #374151;padding:32px 24px;text-align:center;">
      <div style="font-size:28px;margin-bottom:8px;">⚡</div>
      <h1 style="font-size:20px;font-weight:800;margin:0 0 8px;color:#fff;">★ Stanley Stawa <span style="color:#7cf0c4;">AI Studio</span></h1>
      <p style="font-size:13px;color:#9ca3af;margin:0 0 24px;">Code de vérification pour votre inscription (+100 Crédits offerts)</p>
      
      <div style="background:rgba(124,240,196,0.08);border:2px dashed #7cf0c4;border-radius:12px;padding:18px 12px;margin-bottom:24px;">
        <span style="font-size:32px;font-weight:900;letter-spacing:8px;color:#7cf0c4;font-family:monospace;">${otpCode}</span>
      </div>

      <p style="font-size:12px;color:#9ca3af;line-height:1.5;margin:0 0 20px;">
        Entrez ce code sur le site pour valider votre compte Gmail et débloquer votre clé API personnelle. Ce code expire dans <strong>10 minutes</strong>.
      </p>

      <div style="font-size:11px;color:#6b7280;border-top:1px solid #1f2937;padding-top:16px;">
        Si vous n'avez pas demandé ce code, ignorez simplement cet e-mail.<br>
        © 2026 Stanley Stawa AI • Sécurité & Anti-Fraude
      </div>
    </div>
  `;

  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"★ Stanley Stawa AI" <${process.env.GMAIL_USER || process.env.SMTP_USER}>`,
        to: toEmail,
        subject: `🔑 ${otpCode} est votre code de vérification Stanley Stawa AI`,
        html: htmlContent
      });
      console.log(`📧 E-mail OTP envoyé avec succès à ${toEmail}`);
      return { sent: true };
    } catch (err) {
      console.warn("Erreur envoi SMTP:", err.message);
      return { sent: false, error: err.message };
    }
  } else {
    console.log(`⚠️ SMTP non configuré (GMAIL_USER/PASS). Code OTP généré pour ${toEmail} : [${otpCode}]`);
    return { sent: false, simulated: true, otp: otpCode };
  }
}

module.exports = {
  isDisposableEmail,
  generateOtp,
  sendOtpEmail
};
