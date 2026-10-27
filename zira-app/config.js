// הגדרות האפליקציה – למלא לפני שמעלים לחנויות
export default {
  // כתובת השרת (בלי / בסוף). השלט נטען משם, כך שכל עדכון בשרת מגיע לאפליקציה בלי עדכון בחנות
  server: 'https://zira-j0ms.onrender.com',
  // מפתחות ציבוריים של RevenueCat (Project → API keys → Public app-specific keys)
  revenuecat: { ios: 'appl_XXXXXXXX', android: 'goog_XXXXXXXX' },
  entitlement: 'pro',
  // פרסומת מסך מלא ב-AdMob. null = מזהי הבדיקה הרשמיים של Google. להחליף במזהים שלך לפני העלאה
  admobInterstitial: { ios: null, android: null },
  adEvery: 2,
};
