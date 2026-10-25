// בונה את תיקיית www של האפליקציה מתוך public/ של השרת
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), pub = path.join(root, 'public'), www = path.join(__dirname, 'www');
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'socket.io'), { recursive: true });
fs.copyFileSync(path.join(pub, 'play.html'), path.join(www, 'index.html'));
for (const f of ['play.js', 'native.js']) fs.copyFileSync(path.join(pub, f), path.join(www, f));
fs.copyFileSync(path.join(__dirname, 'config.js'), path.join(www, 'config.js'));
const io = [path.join(root, 'node_modules/socket.io/client-dist/socket.io.min.js'), path.join(root, 'node_modules/socket.io-client/dist/socket.io.min.js')].find(fs.existsSync);
if (!io) { console.error('הריצו קודם npm install בתיקייה הראשית'); process.exit(1); }
fs.copyFileSync(io, path.join(www, 'socket.io', 'socket.io.js'));
if (/appl_X|goog_X/.test(fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8'))) console.warn('⚠ שימו לב: עדיין לא הוכנסו מפתחות RevenueCat ב-mobile/config.js');
console.log('✓ www מוכן:', fs.readdirSync(www).join(', '));
