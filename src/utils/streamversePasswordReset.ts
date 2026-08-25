import fs from 'fs';
import path from 'path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Resend } from 'resend';

let initialized = false;

function getFirebaseAuth() {
  if (!initialized && !getApps().length) {
    const serviceAccountPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'firebase-service-account.json');
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    initializeApp({ credential: cert(serviceAccount) });
  }
  initialized = true;
  return getAuth();
}

export async function sendStreamVersePasswordReset(email: string): Promise<void> {
  const resendKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!resendKey) throw new Error('RESEND_API_KEY is not configured');

  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) throw new Error('A valid email is required');

  const continueUrl = String(
    process.env.STREAMVERSE_RESET_URL || 'http://localhost:3005/login.html',
  ).trim();
  const link = await getFirebaseAuth().generatePasswordResetLink(normalizedEmail, {
    url: continueUrl,
    handleCodeInApp: false,
  });
  // Keep Firebase's one-time code, but send users to StreamVerse instead of the
  // project's legacy hosted action page.
  const firebaseLink = new URL(link);
  const localLink = new URL(continueUrl);
  ['mode', 'oobCode', 'apiKey'].forEach((key) => {
    const value = firebaseLink.searchParams.get(key);
    if (value) localLink.searchParams.set(key, value);
  });
  const logoPath = 'C:\\Users\\Jeet\\Music\\StreamVerse\\logo.png';
  const hasLogo = fs.existsSync(logoPath);

  const resend = new Resend(resendKey);
  const from = String(process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev').trim();
  const result = await resend.emails.send({
    from,
    to: normalizedEmail,
    subject: 'Reset your StreamVerse password',
    attachments: hasLogo
      ? [{ filename: 'streamverse-logo.png', content: fs.readFileSync(logoPath), contentId: 'streamverse-logo' }]
      : undefined,
    html: `
      <div style="margin:0;padding:52px 20px;background:#090a0e;font-family:Arial,Helvetica,sans-serif;color:#f5f5f7">
        <div style="max-width:560px;margin:0 auto;padding:40px;border:1px solid #353844;border-radius:22px;background:#15161d;box-shadow:0 18px 45px rgba(0,0,0,.28)">
           <div style="margin-bottom:34px;display:flex;align-items:center;font-size:25px;font-weight:700;letter-spacing:-1px;color:#fff">
             <span style="display:inline-block;width:30px;height:30px;margin-right:10px;border-radius:9px;background:#ff5148;text-align:center;line-height:30px;color:#fff;font-size:14px">▶</span><span style="color:#ff5148">Stream</span>Verse
          </div>
          <div style="margin-bottom:25px;width:42px;height:3px;border-radius:3px;background:#ff5148"></div>
          <h1 style="margin:0 0 14px;font-size:29px;line-height:1.2;color:#fff">Reset your password</h1>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#c0c1cc">We received a request to reset your StreamVerse password.</p>
          <p style="margin:0 0 30px;font-size:15px;line-height:1.7;color:#c0c1cc">Click the button below to choose a new password and get back to watching.</p>
           <a href="${localLink.toString()}" style="display:inline-block;padding:15px 25px;border:1px solid #ff7771;border-radius:12px;background:#ff5148;color:#fff;text-decoration:none;font-size:14px;font-weight:700;box-shadow:0 8px 20px rgba(255,81,72,.24)">Reset password &nbsp;→</a>
          <p style="margin:29px 0 0;font-size:13px;line-height:1.7;color:#858694">This link will expire for your security. If you did not request this, you can safely ignore this email.</p>
          <div style="height:1px;margin:30px 0;background:#30323c"></div>
          <p style="margin:0;font-size:12px;line-height:1.7;color:#747582">StreamVerse<br><span style="color:#9a9ba8">Your watchlist, everywhere.</span></p>
        </div>
      </div>`,
  });
  if (result.error) throw new Error(result.error.message || 'Email delivery failed');
}
