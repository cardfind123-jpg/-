// יוצר קודי "זירה פרו" חתומים. שימוש:  PRO_SECRET=הסוד node tools/make-codes.js 20
// אותו PRO_SECRET חייב להיות מוגדר גם בשרת (Render → Environment).
const { makeCode, checkCode } = require('../pro');
const n = Math.min(1000, Math.max(1, +process.argv[2] || 10));
for (let i = 0; i < n; i++) { const c = makeCode(); if (!checkCode(c)) throw new Error('bad'); console.log(c); }
