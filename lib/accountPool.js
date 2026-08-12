/**
 * lib/accountPool.js — Gestionnaire de pool avec rotation automatique intelligente anti-rate-limit
 */

const turso = require("./turso");

const TEMPMAIL_API = "https://vercel-text-api-zeta.vercel.app/stanleystawa/tempmail";
const MAGICLIGHT_API = "https://api.magiclight.ai";

class AccountPool {
  constructor() {
    this.isRefilling = false;
  }

  generatePassword(length = 12) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let pass = "";
    for (let i = 0; i < length; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pass + "Aa1!";
  }

  async createNewAccount() {
    console.log("[AutoRegister] Création d'une nouvelle boîte e-mail temporaire...");
    const createRes = await fetch(`${TEMPMAIL_API}?action=create&format=json`);
    const createData = await createRes.json();

    const email = createData.email;
    const sessionId = createData.session_id;
    if (!email || !sessionId) {
      throw new Error(`Échec création e-mail temporaire: ${JSON.stringify(createData)}`);
    }

    const password = this.generatePassword();
    console.log(`[AutoRegister] E-mail obtenu : ${email}`);

    // 1. Envoi code MagicLight
    const sendRes = await fetch(`${MAGICLIGHT_API}/api/user/send-sms-code`, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json",
        "Origin": "https://magiclight.ai",
        "Referer": "https://magiclight.ai/"
      },
      body: JSON.stringify({
        phone: email,
        captchaCode: "",
        method: "signup",
        type: "email",
        inviteCode: "",
        bdVid: "",
        ptag: ""
      })
    });
    const sendData = await sendRes.json();
    if (sendData.code !== 200 && !sendData.isOk) {
      throw new Error(`Échec envoi code MagicLight: ${JSON.stringify(sendData)}`);
    }

    // 2. Récupération du code OTP
    console.log("[AutoRegister] Attente de réception du code OTP...");
    let otpCode = null;
    const startTime = Date.now();

    while (Date.now() - startTime < 60000) {
      await new Promise(r => setTimeout(r, 4000));
      try {
        const inboxRes = await fetch(`${TEMPMAIL_API}?action=inbox&session_id=${sessionId}&format=json`);
        const inboxData = await inboxRes.json();

        if (inboxData.best_otp_code) {
          otpCode = String(inboxData.best_otp_code);
          break;
        }

        const messages = inboxData.messages || [];
        for (const msg of messages) {
          if (msg.code_otp_detecte) {
            otpCode = String(msg.code_otp_detecte);
            break;
          }
          const text = (msg.snippet || "") + " " + (msg.full_text || "");
          const match = text.match(/\b\d{6}\b/);
          if (match) {
            otpCode = match[0];
            break;
          }
        }
        if (otpCode) break;
      } catch (err) {}
    }

    if (!otpCode) {
      throw new Error("Délai d'attente du code OTP dépassé.");
    }

    // 3. Inscription
    const signupRes = await fetch(`${MAGICLIGHT_API}/api/user/signup`, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json",
        "Origin": "https://magiclight.ai",
        "Referer": "https://magiclight.ai/"
      },
      body: JSON.stringify({
        displayName: "user_" + email.split("@")[0].slice(0, 10),
        password,
        confirm: password,
        phoneOrEmail: email,
        code: otpCode,
        affiliation: "",
        bdVid: "",
        ptag: ""
      })
    });
    const signupData = await signupRes.json();
    if (signupData.code !== 200 && !signupData.isOk) {
      throw new Error(`Échec inscription MagicLight: ${JSON.stringify(signupData)}`);
    }

    // 4. Connexion
    await new Promise(r => setTimeout(r, 1000));
    const signinRes = await fetch(`${MAGICLIGHT_API}/api/user/signin`, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json",
        "Origin": "https://magiclight.ai",
        "Referer": "https://magiclight.ai/"
      },
      body: JSON.stringify({
        phone: email,
        password,
        code: "",
        inviteCode: "",
        bdVid: "",
        ptag: ""
      })
    });
    const signinData = await signinRes.json();
    const token = signinData.data?.accessToken;
    const refreshToken = signinData.data?.refreshToken || "";
    const credits = signinData.data?.user?.payCredit || 800;

    if (!token) {
      throw new Error(`Échec récupération token: ${JSON.stringify(signinData)}`);
    }

    // 5. Sauvegarde dans Turso
    await turso.addOrUpdateAccount(email, password, token, refreshToken, credits);
    console.log(`[AutoRegister] ✅ Nouveau compte ${email} ajouté dans Turso avec ${credits} crédits.`);

    return {
      email,
      password,
      accessToken: token,
      refreshToken,
      credits
    };
  }

  async getBestAccount(excludeEmails = []) {
    let accounts = await turso.getActiveAccounts();
    if (excludeEmails.length > 0) {
      accounts = accounts.filter(a => !excludeEmails.includes(a.email));
    }
    if (!accounts.length) {
      console.log("[Pool] Tous les comptes sont limités ou épuisés. Création d'un nouveau compte immédiat...");
      const newAcc = await this.createNewAccount();
      return newAcc;
    }
    return accounts[0];
  }

  async deductCredits(email, amount = 5) {
    const remaining = await turso.deductCredits(email, amount);
    return remaining;
  }
}

module.exports = new AccountPool();
