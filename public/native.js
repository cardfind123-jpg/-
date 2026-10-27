'use strict';
// ============================================================
//  זירה – גשר לאפליקציה (App Store / Google Play)
//  בדפדפן רגיל הכול כאן לא עושה כלום. באפליקציה (Capacitor) – רכישות דרך RevenueCat ופרסומות דרך AdMob.
//  המפתחות מגיעים מ-config.js של האפליקציה (window.ZIRA_CONFIG).
// ============================================================
(() => {
// באפליקציית Expo (zira-app) הגשר כבר הוזרק מבחוץ – לא דורסים אותו
if (window.ZiraNative && window.ZiraNative.__expo) return;
const CFG = window.ZIRA_CONFIG || {};
const cap = window.Capacitor;
const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
const platform = isNative ? cap.getPlatform() : 'web';
const plug = (n) => { try { return isNative && cap.registerPlugin ? cap.registerPlugin(n) : null; } catch (e) { return null; } };
const Purchases = plug('Purchases');
const AdMob = plug('AdMob');
const pick = (o) => (o ? o[platform] || o.default || '' : '');

let rcReady = null, adReady = false, adCount = 0;
function initRC() {
  if (rcReady) return rcReady;
  const key = pick(CFG.revenuecat);
  rcReady = (Purchases && key) ? Purchases.configure({ apiKey: key }).then(() => true).catch(() => false) : Promise.resolve(false);
  return rcReady;
}
async function rcInfo() {
  if (!(await initRC())) return null;
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    const { appUserID } = await Purchases.getAppUserID();
    const ent = CFG.entitlement || 'pro';
    return { id: appUserID, pro: !!(customerInfo && customerInfo.entitlements && customerInfo.entitlements.active && customerInfo.entitlements.active[ent]) };
  } catch (e) { return null; }
}

window.ZiraNative = {
  isNative, platform,
  canBuy: () => !!(Purchases && pick(CFG.revenuecat)),
  // מחזיר { rc: appUserId } אם יש פרו פעיל, אחרת null
  async entitlement() { const i = await rcInfo(); return i && i.pro ? { rc: i.id } : null; },
  async price() {
    if (!(await initRC())) return '';
    try { const o = await Purchases.getOfferings(); const p = o && o.current && o.current.availablePackages[0]; return p ? p.product.priceString : ''; } catch (e) { return ''; }
  },
  async buy() {
    if (!(await initRC())) throw new Error('הרכישה לא זמינה כרגע');
    const o = await Purchases.getOfferings();
    const p = o && o.current && o.current.availablePackages[0];
    if (!p) throw new Error('לא נמצא מוצר בחנות');
    try { await Purchases.purchasePackage({ aPackage: p }); }
    catch (e) { if (e && (e.userCancelled || e.code === '1')) return null; throw e; }
    return this.entitlement();
  },
  async restore() { if (!(await initRC())) return null; try { await Purchases.restorePurchases(); } catch (e) {} return this.entitlement(); },
  // פרסומת מסך מלא – רק באפליקציה, רק בלי פרו, לא יותר מפעם בשני משחקים
  async adBreak() {
    const id = pick(CFG.admobInterstitial);
    if (!AdMob || !id) return;
    adCount++;
    if (adCount % (CFG.adEvery || 2) !== 0) return;
    try {
      if (!adReady) { await AdMob.initialize({}); adReady = true; }
      await AdMob.prepareInterstitial({ adId: id });
      await AdMob.showInterstitial();
    } catch (e) {}
  },
};
})();
