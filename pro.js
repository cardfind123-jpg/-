// זירה פרו – בדיקת זכאות
// שלוש דרכים לקבל פרו:
//  1. רכישה באפליקציה (App Store / Google Play) דרך RevenueCat – השרת בודק מול RevenueCat (REVENUECAT_SECRET)
//  2. קוד פרו חתום (ZIRA-XXXX-XXXX) – נוצר עם `node tools/make-codes.js` (דורש PRO_SECRET)
//  3. קודי מבצע קבועים מתוך PROMO_CODES (מופרדים בפסיקים), למשל למשפיענים
const crypto = require('crypto');
const https = require('https');

const SECRET = process.env.PRO_SECRET || '';
const PROMO = new Set(String(process.env.PROMO_CODES || '').split(',').map((s) => norm(s)).filter(Boolean));
const RC_KEY = process.env.REVENUECAT_SECRET || '';
const RC_ENTITLEMENT = process.env.REVENUECAT_ENTITLEMENT || 'pro';
const cache = new Map(); // appUserId -> { ok, at }

function norm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function sign(body) {
  const h = crypto.createHmac('sha256', SECRET).update('zira:' + body).digest();
  let s = ''; for (let i = 0; i < 4; i++) s += ALPHA[h[i] % ALPHA.length];
  return s;
}
// קוד: ZIRA-AAAA-SSSS  (AAAA אקראי, SSSS חתימה)
function makeCode() {
  if (!SECRET) throw new Error('צריך להגדיר PRO_SECRET');
  let body = ''; const b = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) body += ALPHA[b[i] % ALPHA.length];
  return `ZIRA-${body}-${sign(body)}`;
}
function checkCode(code) {
  const c = norm(code);
  if (!c) return false;
  if (PROMO.has(c)) return true;
  if (!SECRET || !/^ZIRA[A-Z0-9]{8}$/.test(c)) return false;
  const body = c.slice(4, 8), sig = c.slice(8, 12);
  return crypto.timingSafeEqual(Buffer.from(sign(body)), Buffer.from(sig));
}

function rcGet(id) {
  return new Promise((resolve) => {
    const req = https.get({
      host: 'api.revenuecat.com', path: '/v1/subscribers/' + encodeURIComponent(id),
      headers: { Authorization: 'Bearer ' + RC_KEY, Accept: 'application/json' }, timeout: 5000,
    }, (res) => {
      let body = ''; res.on('data', (d) => { body += d; if (body.length > 2e5) req.destroy(); });
      res.on('end', () => {
        try {
          const e = JSON.parse(body).subscriber.entitlements[RC_ENTITLEMENT];
          resolve(!!e && (!e.expires_date || new Date(e.expires_date) > new Date()));
        } catch (err) { resolve(false); }
      });
    });
    req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function checkRC(id) {
  id = String(id || '').slice(0, 100);
  if (!RC_KEY || !id) return false;
  const c = cache.get(id);
  if (c && Date.now() - c.at < (c.ok ? 6 * 3600e3 : 60e3)) return c.ok;
  const ok = await rcGet(id);
  cache.set(id, { ok, at: Date.now() });
  return ok;
}

async function check(ent) {
  if (!ent || typeof ent !== 'object') return false;
  if (ent.code && checkCode(ent.code)) return true;
  if (ent.rc && await checkRC(ent.rc)) return true;
  return false;
}

module.exports = { check, checkCode, makeCode };
