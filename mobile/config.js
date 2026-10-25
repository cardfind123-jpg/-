// הגדרות האפליקציה – למלא לפני שמעלים לחנויות
window.ZIRA_CONFIG = {
  // כתובת השרת (בלי / בסוף)
  server: 'https://zira-j0ms.onrender.com',
  // מפתחות ציבוריים של RevenueCat (Project → API keys → Public app-specific keys)
  revenuecat: { ios: 'appl_XXXXXXXX', android: 'goog_XXXXXXXX' },
  entitlement: 'pro',
  // מזהי פרסומת מסך מלא ב-AdMob. כרגע אלה מזהי הבדיקה הרשמיים של Google – להחליף במזהים שלך
  admobInterstitial: { ios: 'ca-app-pub-3940256099942544/4411468910', android: 'ca-app-pub-3940256099942544/1033173712' },
  adEvery: 2,
};
