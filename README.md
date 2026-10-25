# זירה – משחקי מסיבה (מסך גדול + טלפונים כשלטים)

**13 משחקים.** חינם: מרוץ, אגרוף, הוקי אוויר, כדורגל ראשים, טנקים, כדורעף, סומו, פצצה חמה + טורניר.
**זירה פרו** (קנייה חד־פעמית): שוד הכספת, קרב חלליות, המטבח המטורף, הרצפה קורסת, צבע טריטוריה · עד 4 שחקנים · בלי פרסומות. שחקן אחד עם פרו פותח את כל החדר.

* חינם: עד 2 שחקנים. בפרו: עד 4. במשחקי 1 על 1 עם יותר משניים – "מלך הזירה": המנצח נשאר, הבא בתור נכנס.
* שחקן שהטלפון שלו ננעל חוזר אוטומטית לאותו מקום (עד 30 שניות). לבד? המחשב משחק נגדכם.

## מבנה
| קובץ | מה יש בו |
|---|---|
| `server.js` | שרת חדרים (Express + Socket.IO), QR, פרו, סטטיסטיקה, `/health`, `/privacy` |
| `pro.js` | בדיקת זכאות פרו: RevenueCat / קוד חתום / קודי מבצע |
| `public/screen.js` | המסך הגדול וכל 13 המשחקים |
| `public/play.html`, `play.js` | השלט בטלפון |
| `public/native.js` | גשר לאפליקציה: רכישות (RevenueCat) ופרסומות (AdMob). בדפדפן לא עושה כלום |
| `mobile/` | פרויקט האפליקציה ל-App Store ול-Google Play (Capacitor) |
| `docs/store-listing.md` | טקסטים מוכנים לדף החנות |
| `tools/make-codes.js` | יוצר קודי פרו למכירה / מתנה |

## העלאה לשרת (Render)
1. ב-Render: **New → Blueprint** ובוחרים את ה-Repository – `render.yaml` מגדיר הכול.
   (או ידנית: Web Service, Build `npm install`, Start `npm start`.)
2. ב-Environment מוסיפים `SELF_URL` = הכתובת של השרת (למשל `https://zira-j0ms.onrender.com`) – השרת מעיר את עצמו ולא נרדם.
3. מומלץ לשנות ל-**Starter** (~$7 לחודש) כשיש משתמשים אמיתיים.

### משתני סביבה
| משתנה | למה |
|---|---|
| `PRO_SECRET` | סוד לחתימת קודי פרו |
| `PROMO_CODES` | קודי מבצע קבועים, למשל `FRIENDS2026,INFLUENCER1` |
| `REVENUECAT_SECRET` | המפתח הסודי מ-RevenueCat – כדי שהשרת יאמת רכישות מהחנות |
| `STATS_KEY` | סטטיסטיקה: `/api/stats?key=...` (חדרים, הצטרפויות, אילו משחקים שיחקו) |
| `SELF_URL` | מונע מהשרת החינמי להירדם |

### קודי פרו (למכירה באתר, מתנות, משפיענים)
```
PRO_SECRET=<אותו סוד כמו בשרת> node tools/make-codes.js 20
```
בטלפון: תפריט → "⭐ זירה פרו" → "יש לך קוד פרו?".

## אפליקציה ל-App Store ול-Google Play
מה שצריך לפתוח פעם אחת:
1. **Google Play Console** ($25 חד־פעמי) ו-**Apple Developer** ($99 לשנה).
2. **RevenueCat** (חינם עד הכנסה מסוימת): יוצרים מוצר חד־פעמי `zira_pro` בשתי החנויות, Entitlement בשם `pro`, Offering עם החבילה. את המפתח הסודי שמים ב-`REVENUECAT_SECRET` בשרת.
3. **AdMob**: יוצרים אפליקציה + יחידת "Interstitial" לכל פלטפורמה.
4. ממלאים את `mobile/config.js` (כתובת שרת, מפתחות RevenueCat, מזהי AdMob).

בנייה (דורש Android Studio; לאייפון – מחשב Mac עם Xcode):
```
npm install                 # בתיקייה הראשית
cd mobile && npm install
npx cap add android         # פעם אחת
npx cap add ios             # פעם אחת, רק ב-Mac
npm run android             # או: npm run ios
```
אחרי `cap add` צריך להוסיף את מזהה האפליקציה של AdMob:
* Android – `android/app/src/main/AndroidManifest.xml` בתוך `<application>`:
  `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-XXXX~YYYY"/>`
* iOS – `ios/App/App/Info.plist`: מפתח `GADApplicationIdentifier` עם המזהה.

האפליקציה היא השלט: מקלידים בה את קוד החדר שעל הטלוויזיה. הטלוויזיה/מחשב פותחים את כתובת השרת בדפדפן.

## הרצה על המחשב (לבדיקות)
```
npm install
PROMO_CODES=TEST npm start
```
ואז http://localhost:3000 (מסך) ו-http://localhost:3000/play (טלפון). קוד `TEST` פותח פרו לבדיקה.
חיישן ההטיה עובד רק ב-https (כמו ב-Render); בלי https השלט עובר לכפתורים.
