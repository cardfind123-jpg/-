// זירה – אפליקציית השלט (Expo)
// טוענת את השלט מהשרת בתוך WebView ומספקת לו גשר native: רכישות (RevenueCat) ופרסומות (AdMob).
// הדף מקבל window.ZiraNative עוד לפני שהוא נטען, ו-public/native.js יודע לא לדרוס אותו.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import { WebView } from 'react-native-webview';
import Purchases from 'react-native-purchases';
import mobileAds, { AdEventType, InterstitialAd, TestIds } from 'react-native-google-mobile-ads';
import CFG from './config';

const BG = '#0b0d1c';
const OS = Platform.OS; // 'ios' | 'android'
const PLAY_URL = CFG.server + '/play';
const SERVER_HOST = CFG.server.replace(/^https?:\/\//, '').split('/')[0];

// ---------------- רכישות ----------------
const rcKey = (CFG.revenuecat || {})[OS] || '';
const canBuy = !!rcKey && !/X{4}/.test(rcKey);
let rcReady = false;
function initRC() {
  if (!canBuy) return false;
  if (!rcReady) { try { Purchases.configure({ apiKey: rcKey }); rcReady = true; } catch (e) { return false; } }
  return true;
}
async function entitlement() {
  if (!initRC()) return null;
  try {
    const info = await Purchases.getCustomerInfo();
    const id = await Purchases.getAppUserID();
    const ent = CFG.entitlement || 'pro';
    return info && info.entitlements && info.entitlements.active && info.entitlements.active[ent] ? { rc: id } : null;
  } catch (e) { return null; }
}
async function firstPackage() {
  const o = await Purchases.getOfferings();
  return o && o.current && o.current.availablePackages[0];
}
const native = {
  entitlement,
  async price() {
    if (!initRC()) return '';
    try { const p = await firstPackage(); return p ? p.product.priceString : ''; } catch (e) { return ''; }
  },
  async buy() {
    if (!initRC()) throw new Error('הרכישה לא זמינה כרגע');
    const p = await firstPackage();
    if (!p) throw new Error('לא נמצא מוצר בחנות');
    try { await Purchases.purchasePackage(p); }
    catch (e) { if (e && e.userCancelled) return null; throw e; }
    return entitlement();
  },
  async restore() {
    if (!initRC()) return null;
    try { await Purchases.restorePurchases(); } catch (e) {}
    return entitlement();
  },
  // פרסומת מסך מלא – לא יותר מפעם בכמה משחקים. play.js קורא לזה רק כשאין פרו
  adBreak: (() => {
    let count = 0, ready = false;
    return async () => {
      count++;
      if (count % (CFG.adEvery || 2) !== 0) return;
      const id = (CFG.admobInterstitial || {})[OS] || TestIds.INTERSTITIAL;
      try {
        if (!ready) { await mobileAds().initialize(); ready = true; }
        await new Promise((resolve) => {
          const ad = InterstitialAd.createForAdRequest(id, { requestNonPersonalizedAdsOnly: true });
          const done = () => { subs.forEach((u) => u()); resolve(); };
          const subs = [
            ad.addAdEventListener(AdEventType.LOADED, () => ad.show().catch(done)),
            ad.addAdEventListener(AdEventType.CLOSED, done),
            ad.addAdEventListener(AdEventType.ERROR, done),
          ];
          setTimeout(done, 15000); // לא תוקעים את המשחק אם הפרסומת לא נטענת
          ad.load();
        });
      } catch (e) {}
    };
  })(),
};

// הגשר שמוזרק לדף לפני שהוא נטען
const BRIDGE = `(function(){
  var cb = {}, n = 0;
  function call(m){ return new Promise(function(res, rej){ var id = ++n; cb[id] = {res: res, rej: rej};
    window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, m: m })); }); }
  window.__ziraReply = function(id, ok, val){ var c = cb[id]; if (!c) return; delete cb[id]; ok ? c.res(val) : c.rej(new Error(val || 'שגיאה')); };
  window.ZiraNative = { __expo: true, isNative: true, platform: ${JSON.stringify(OS)},
    canBuy: function(){ return ${canBuy}; },
    entitlement: function(){ return call('entitlement'); },
    price: function(){ return call('price'); },
    buy: function(){ return call('buy'); },
    restore: function(){ return call('restore'); },
    adBreak: function(){ return call('adBreak'); } };
})(); true;`;

export default function App() {
  useKeepAwake(); // המסך לא נכבה באמצע משחק
  const web = useRef(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState(0);

  const reply = useCallback((id, ok, val) => {
    web.current && web.current.injectJavaScript(`window.__ziraReply(${id}, ${ok}, ${JSON.stringify(val === undefined ? null : val)}); true;`);
  }, []);

  const onMessage = useCallback(async (e) => {
    let msg; try { msg = JSON.parse(e.nativeEvent.data); } catch (_) { return; }
    const fn = native[msg && msg.m];
    if (!fn) return reply(msg.id, false, 'פעולה לא מוכרת');
    try { reply(msg.id, true, await fn()); }
    catch (err) { reply(msg.id, false, (err && err.message) || 'שגיאה'); }
  }, [reply]);

  // קישורים חיצוניים (מדיניות פרטיות וכו') נפתחים בדפדפן ולא בתוך האפליקציה
  const onNav = useCallback((req) => {
    const host = req.url.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
    if (!/^https?:/.test(req.url) || host === SERVER_HOST) return true;
    Linking.openURL(req.url).catch(() => {});
    return false;
  }, []);

  const retry = () => { setFailed(false); setLoading(true); setKey((k) => k + 1); };

  // השרת החינמי ב-Render יכול לקחת עד דקה להתעורר – מנסים שוב אוטומטית
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(retry, 5000);
    return () => clearTimeout(t);
  }, [failed]);

  return (
    <View style={s.root}>
      <StatusBar hidden />
      {!failed && (
        <WebView
          key={key}
          ref={web}
          source={{ uri: PLAY_URL }}
          style={s.web}
          originWhitelist={['https://*', 'http://*']}
          injectedJavaScriptBeforeContentLoaded={BRIDGE}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onNav}
          onLoadEnd={() => setLoading(false)}
          onError={() => setFailed(true)}
          onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
          onContentProcessDidTerminate={retry}
          onRenderProcessGone={retry}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          bounces={false}
          overScrollMode="never"
          scrollEnabled={false}
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures={false}
          textZoom={100}
          webviewDebuggingEnabled={__DEV__}
        />
      )}
      {(loading || failed) && (
        <View style={s.cover}>
          <Text style={s.logo}>זירה</Text>
          <ActivityIndicator color="#ffd60a" size="large" />
          <Text style={s.sub}>{failed ? 'השרת מתעורר… מנסים שוב' : 'מתחברים לזירה…'}</Text>
          {failed && <Pressable onPress={retry} style={s.btn}><Text style={s.btnT}>נסו עכשיו</Text></Pressable>}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
  cover: { ...StyleSheet.absoluteFillObject, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', gap: 18 },
  logo: { color: '#ffd60a', fontSize: 56, fontWeight: '900' },
  sub: { color: '#c9cbe0', fontSize: 16 },
  btn: { marginTop: 8, backgroundColor: '#ffd60a', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 14 },
  btnT: { color: BG, fontSize: 17, fontWeight: '800' },
});
