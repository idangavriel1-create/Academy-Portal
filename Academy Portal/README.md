# Comda Academy Portal

פורטל למידה (PWA) להצגת מצגות מוצרים על טאבלטים ברחבי החברה. מארחים ב-GitHub Pages, עם המרת PowerPoint אוטומטית ל-WebP באמצעות GitHub Actions, ופעילות מלאה במצב offline אחרי סנכרון ראשון.

---

## מבנה הריפו

```
/
├── index.html                   # קטלוג ראשי (מה שהמשתמשים רואים על הטאבלט)
├── admin.html                   # דף ניהול (נגיש בלחיצה ארוכה על הלוגו)
├── manifest.webmanifest         # PWA manifest (installability)
├── sw.js                        # Service Worker (offline + cache)
├── assets/
│   ├── css/styles.css
│   └── js/
│       ├── app.js               # לוגיקת קטלוג + Swiper
│       ├── admin.js             # לוגיקת הניהול
│       ├── github-api.js        # עטיפה ל-GitHub REST API + PBKDF2
│       └── background.js        # אנימציית חלקיקים
├── data/
│   ├── products.json            # "DB" של הקטלוג
│   ├── auth.json                # hash של סיסמת המנהל (PBKDF2)
│   └── presentations/           # תמונות WebP המיוצרות אוטומטית
│       └── {folder}/{he|en}/page-{N}.webp
├── uploads/                     # קבצי PPTX שמחכים להמרה
├── icons/
└── .github/workflows/convert-pptx.yml
```

---

## התקנה ראשונית

### 1. יצירת ריפו ב-GitHub
1. פתח ריפו חדש ב-GitHub (למשל `academy-portal`).
2. `git init && git remote add origin ...` בתיקייה הזו ואז `git add . && git commit -m "initial" && git push`.

### 2. הפעלת GitHub Pages
1. בריפו: **Settings → Pages**
2. **Source**: Deploy from a branch
3. **Branch**: `main`, **Folder**: `/ (root)`
4. שמור. אחרי דקה-שתיים האתר יהיה זמין ב-`https://<USER>.github.io/<REPO>/`

### 3. יצירת Personal Access Token (PAT)
נדרש כדי שהמנהל יוכל לעדכן את הקטלוג ולהעלות מצגות מהדפדפן.

1. היכנס ל-[GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/tokens?type=beta).
2. לחץ **Generate new token**.
3. **Resource owner**: עצמך / הארגון; **Repository access**: Only select repositories → בחר את הריפו של הפורטל.
4. **Repository permissions**:
   - `Contents` → **Read and write**
   - `Metadata` → **Read-only** (נבחר אוטומטית)
   - `Actions` → **Read-only** (כדי לראות סטטוס המרה)
5. **Expiration**: 90 יום (או יותר — לפי המדיניות שלך).
6. שמור את ה-token. תצטרך אותו פעם אחת ראשונה בדף הניהול.

### 4. שינוי סיסמת ברירת מחדל
סיסמת ברירת מחדל היא `admin123`. **חובה להחליף אותה מיד.**

1. פתח את `https://<USER>.github.io/<REPO>/admin.html`
2. שם משתמש: `admin`, סיסמה: `admin123`
3. מלא את פרטי GitHub (owner/repo/branch + ה-PAT).
4. לאחר הכניסה, עבור ללשונית "הגדרות" ושנה את הסיסמה.

---

## שימוש יומיומי

### כניסה לניהול
1. בדף הראשי, בצע **לחיצה ארוכה של 2.5 שניות על הלוגו** — יובלת לדף הניהול.
2. הזן את שם המשתמש, הסיסמה ופרטי GitHub (אם לא שמרת מקודם).

### הוספת מוצר חדש
1. **לשונית מוצרים → "+ הוסף מוצר"**
2. מלא שם בעברית ובאנגלית, בחר קטגוריה, וקבע **מזהה (folder)** — רצף אותיות אנגליות קטנות בלבד, בלי רווחים.
3. שמור. מתבצע commit אוטומטי לריפו.
4. לחץ **"העלה PPTX"** על המוצר החדש → בחר שפה → בחר קובץ PPTX או PDF → התחל העלאה.
5. המתן כדקה — GitHub Actions ממיר את הקובץ ל-WebP. הקטלוג מתעדכן אוטומטית.

### עריכת מוצר קיים
- "ערוך" מאפשר לשנות שם/קטגוריה (לא את ה-folder — לא ניתן לשנות אותו אחרי יצירה).
- "העלה PPTX" מחליף את הקובץ הקיים.

### מחיקת מוצר
- "מחק" מסיר את המוצר מהקטלוג ומוחק את כל השקפים שלו מהריפו.

### קטגוריות
- זהה למוצרים. קטגוריה עם מוצרים אקטיביים לא ניתנת למחיקה — קודם יש להעביר או למחוק את המוצרים.

---

## ביצועים

מה השתפר לעומת האפליקציה הקודמת:

| נושא | לפני | אחרי |
|------|------|------|
| טעינת קטלוג | מריצה `preloadAllImages` שטוענת עד 1,140 תמונות בעליה | טוענת רק 19 thumbnails (בערך 3MB) |
| פתיחת מצגת | עד 100 בקשות HTTP סדרתיות עם `await` עד 404 | 0 בקשות גישוש — מספר העמודים שמור ב-products.json |
| עמוד ראשון | אחרי שכל התמונות נטענו | מיד |
| דפדוף | תמונות לא מקומיות איטיות | עמודים סמוכים נטענים מראש ברקע |
| Offline | לא נתמך | נתמך מלא אחרי צפייה ראשונה |
| גדלי קבצים | JPG ~500KB-1MB | WebP ~150-300KB |

---

## התקנת האפליקציה על טאבלטים

### Android (Chrome)
1. פתח את האתר.
2. תפריט → "Add to Home screen" / "התקן אפליקציה".
3. האיקון יופיע במסך הבית. פתיחה תציג מסך מלא.
4. **חשוב**: גלוש דרך כל המצגות פעם אחת עם רשת כדי למלא את המטמון ה-Offline.

### iPad (Safari)
1. פתח את האתר.
2. כפתור Share → "Add to Home Screen".
3. פתח מהאייקון. Service Worker נתמך ב-iOS 16.4+.

### Kiosk mode (מומלץ לטאבלטים ציבוריים)
- Android: Fully Kiosk Browser או Kiosk Browser Lockdown
- iPad: Guided Access (הגדרות → נגישות → גישה מודרכת)

---

## אבטחה

- **ה-PAT לעולם לא נכנס לריפו**. הוא נשמר רק ב-`localStorage` של הדפדפן של המנהל.
- **ה-hash של הסיסמה** נשמר ב-`data/auth.json` — PBKDF2-SHA256 עם 150,000 איטרציות. בטוח להיות פומבי.
- **תהליך האימות רץ בדפדפן** (Web Crypto API). אין שרת שיודע את הסיסמה.
- **GitHub Actions** רץ עם `GITHUB_TOKEN` אוטומטי בהרשאות `contents: write` — לא צריך להגדיר סודות נוספים.

### איפוס סיסמה שנשכחה
אם שכחת את סיסמת הניהול:
1. צור hash חדש מקומית: `node -e "const c=require('crypto');const s=c.randomBytes(16);const k=c.pbkdf2Sync('YOUR_NEW_PASSWORD',s,150000,32,'sha256');console.log('pbkdf2-sha256\$150000\$'+s.toString('base64')+'\$'+k.toString('base64'))"`
2. ערוך את `data/auth.json` בגיטהאב ישירות והחלף את ה-hash.
3. Commit & push.

---

## תחזוקה

- **גודל הריפו**: GitHub Pages מאפשר עד 1GB. מצגת טיפוסית של 20 שקפים = ~5MB. מעל 200 מצגות — כדאי לשקול Git LFS.
- **Rate limits**: GitHub API מוגבל ל-5,000 בקשות/שעה ל-PAT. די והותר למנהל בודד.
- **Action minutes**: ריפו ציבורי = ללא הגבלה. ריפו פרטי = 2,000 דקות/חודש בחינם.

---

## אבחון בעיות

| בעיה | פתרון |
|------|-------|
| "סיסמה שגויה" אחרי שינוי | המטמון — לחץ `Ctrl+F5` כדי לרענן את `data/auth.json` |
| העלאת PPTX נכשלת | בדוק שה-PAT עדיין תקף + בעל הרשאות Contents: Read and write |
| המצגת לא מופיעה אחרי המרה | עבור ל-Actions בגיטהאב וראה את ה-log של הריצה |
| הטאבלט לא מציג offline | ודא שגלשת לפחות פעם אחת במצגת כשהייתה רשת |
| אנימציית הרקע איטית | הורד את מספר החלקיקים ב-`background.js` משורה `PARTICLE_COUNT = 80` |
