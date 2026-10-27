# זירה – אפליקציית השלט (Expo)

השלט של זירה כאפליקציה לאייפון ולאנדרואיד, נבנית בענן של Expo, **בלי Mac ובלי Xcode**.

* טוענת את השלט מהשרת (`/play`), כך שכל עדכון במשחקים מגיע לאפליקציה מיד, בלי עדכון בחנות.
* רכישת פרו דרך RevenueCat ופרסומות דרך AdMob, באותו גשר `window.ZiraNative` שהשלט כבר מכיר.
* המסך לא נכבה באמצע משחק, והשרת החינמי שמתעורר מקבל מסך טעינה וניסיון חוזר אוטומטי.

## לפני העלאה לחנות
ממלאים את `config.js` (מפתחות RevenueCat ומזהה פרסומת AdMob), ובקובץ `app.json` מחליפים את מזהי האפליקציה של AdMob (כרגע מזהי בדיקה של Google).

## בנייה
```
npm install
npx eas-cli@latest init        # פעם אחת – מקשר לחשבון Expo
npx eas-cli@latest build -p android --profile preview      # APK להתקנה ישירה
npx eas-cli@latest build -p ios --profile production       # לאייפון (דורש Apple Developer)
npx eas-cli@latest submit -p ios                           # שליחה ל-App Store / TestFlight
```
