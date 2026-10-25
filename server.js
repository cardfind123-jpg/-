// זירה – שרת משחקי מסיבה
// המסך הגדול (host) יוצר חדר, הטלפונים (players) מצטרפים עם קוד ושולחים קלט.
// גרסה חינמית: 2 שחקנים. חדר שיש בו שחקן עם "זירה פרו": עד 4 שחקנים + משחקי פרו + בלי פרסומות.
const express = require('express');
const http = require('http');
const path = require('path');
const https = require('https');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const crypto = require('crypto');
const pro = require('./pro');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000, pingTimeout: 8000,
  // אפליקציית הטלפון (Capacitor) רצה ממקור אחר – מאפשרים לה להתחבר
  cors: { origin: true, credentials: false },
});

app.use(express.json({ limit: '4kb' }));
app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); if (req.method === 'OPTIONS') return res.end(); next(); });
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size, up: Math.round(process.uptime()) }));
app.get('/qr', async (req, res) => {
  const url = String(req.query.u || '').slice(0, 300);
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0b0d1c', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  } catch (e) { res.status(400).end(); }
});

// בדיקת קוד פרו מהטלפון (לפני שהוא נשמר בטלפון)
app.post('/api/redeem', async (req, res) => {
  const ok = await pro.check({ code: req.body && req.body.code });
  res.json({ ok });
});

// ---------------- סטטיסטיקה פשוטה (בזיכרון) ----------------
const stats = { since: new Date().toISOString(), rooms: 0, joins: 0, proRooms: 0, games: {}, finished: {} };
app.get('/api/stats', (req, res) => {
  if (!process.env.STATS_KEY || req.query.key !== process.env.STATS_KEY) return res.status(403).json({ error: 'צריך ?key=' });
  res.json(Object.assign({ liveRooms: rooms.size }, stats));
});

const MAX_PLAYERS = 4, FREE_PLAYERS = 2;
const GAME_MODES = new Set(['race', 'box', 'hockey', 'soccer', 'tanks', 'volley', 'sumo', 'bomb', 'space', 'collapse', 'paint', 'kitchen', 'heist']);
const rooms = new Map(); // code -> { host, players: [{id,name,token,pro}|null], state, pro }

function makeCode() {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join(''); } while (rooms.has(c));
  return c;
}
function setPro(code, r) {
  if (r.pro) return;
  r.pro = true; stats.proRooms++;
  io.to(r.host).emit('room:pro', { pro: true });
  io.to(code).emit('pro', { pro: true });
}

io.on('connection', (sock) => {
  sock.data = {};

  sock.on('host:create', (ack) => {
    const code = makeCode();
    rooms.set(code, { host: sock.id, players: Array(MAX_PLAYERS).fill(null), state: { mode: 'menu' }, pro: false });
    sock.join(code);
    sock.data = { role: 'host', code };
    stats.rooms++;
    if (typeof ack === 'function') ack({ code, pro: false });
  });

  sock.on('player:join', async (msg, ack) => {
    if (typeof ack !== 'function') return;
    const code = String((msg && msg.code) || '').toUpperCase().trim();
    const r = rooms.get(code);
    if (!r) return ack({ error: 'לא נמצא חדר עם הקוד הזה' });
    const tok = String((msg && msg.token) || '').slice(0, 40);
    // חזרה של שחקן שהתנתק (מסך ננעל, רשת קפצה) – מקבל את אותו מקום
    let slot = tok ? r.players.findIndex((p) => p && p.token === tok) : -1;
    if (slot >= 0) {
      const p = r.players[slot];
      clearTimeout(p.timer); p.timer = null; p.offline = false;
      const old = p.id !== sock.id && io.sockets.sockets.get(p.id);
      if (old) old.data = {};
      p.id = sock.id;
      sock.join(code);
      sock.data = { role: 'player', code, slot };
      io.to(r.host).emit('player:joined', { slot, name: p.name, back: true, pro: p.pro });
      return ack({ slot, name: p.name, state: r.state, token: p.token, roomPro: r.pro });
    }
    // בדיקת פרו (קוד או רכישה באפליקציה)
    const isPro = await pro.check(msg && msg.pro).catch(() => false);
    if (!rooms.has(code)) return ack({ error: 'החדר נסגר' });
    if (isPro) setPro(code, r);
    const limit = r.pro ? MAX_PLAYERS : FREE_PLAYERS;
    slot = r.players.findIndex((p, i) => !p && i < limit);
    if (slot < 0) return ack({ error: r.pro ? 'החדר מלא (4 שחקנים)' : 'החדר מלא – 3 ו־4 שחקנים זמינים בזירה פרו', full: true, needPro: !r.pro });
    const name = String((msg && msg.name) || '').trim().slice(0, 12) || `שחקן ${slot + 1}`;
    const token = crypto.randomUUID();
    r.players[slot] = { id: sock.id, name, token, offline: false, timer: null, pro: isPro };
    sock.join(code);
    sock.data = { role: 'player', code, slot };
    stats.joins++;
    io.to(r.host).emit('player:joined', { slot, name, pro: isPro });
    ack({ slot, name, state: r.state, token, roomPro: r.pro });
  });

  // קלט רציף (הגה, מיקום אצבע) – volatile: אם חבילה אבדה, הבאה תגיע
  sock.on('axis', (d) => {
    const { role, code, slot } = sock.data;
    if (role !== 'player') return;
    const r = rooms.get(code);
    if (r) io.to(r.host).volatile.emit('axis', { slot, d });
  });

  // קלט בדיד (אגרוף, בחירת משחק) – אמין
  sock.on('input', (d) => {
    const { role, code, slot } = sock.data;
    if (role !== 'player') return;
    const r = rooms.get(code);
    if (r) io.to(r.host).emit('input', { slot, d });
  });

  sock.on('host:state', (state) => {
    const { role, code } = sock.data;
    if (role !== 'host' || !state || typeof state !== 'object') return;
    const r = rooms.get(code);
    if (!r) return;
    const prev = r.state && r.state.mode;
    if (GAME_MODES.has(state.mode) && state.mode !== prev) stats.games[state.mode] = (stats.games[state.mode] || 0) + 1;
    if (state.mode === 'results' && GAME_MODES.has(prev)) stats.finished[prev] = (stats.finished[prev] || 0) + 1;
    state.pro = r.pro;
    r.state = state;
    sock.to(code).emit('state', state);
  });

  sock.on('host:to', ({ slot, ev, d } = {}) => {
    const { role, code } = sock.data;
    if (role !== 'host') return;
    const r = rooms.get(code);
    const p = r && r.players[slot];
    if (p) io.to(p.id).emit('to', { ev, d });
  });

  // שחקן שקנה פרו באמצע – משדרג את החדר בלי להתנתק
  sock.on('player:pro', async (ent, ack) => {
    const { role, code, slot } = sock.data;
    const r = role === 'player' && rooms.get(code);
    if (!r) return typeof ack === 'function' && ack({ ok: false });
    const ok = await pro.check(ent).catch(() => false);
    if (ok) { r.players[slot].pro = true; setPro(code, r); }
    if (typeof ack === 'function') ack({ ok });
  });

  sock.on('disconnect', () => {
    const { role, code, slot } = sock.data;
    const r = rooms.get(code);
    if (!r) return;
    if (role === 'host') {
      sock.to(code).emit('host:gone');
      r.players.forEach((p) => p && clearTimeout(p.timer));
      rooms.delete(code);
    } else if (role === 'player' && r.players[slot] && r.players[slot].id === sock.id) {
      const p = r.players[slot];
      p.offline = true;
      io.to(r.host).emit('player:away', { slot });
      p.timer = setTimeout(() => {
        if (r.players[slot] === p && p.offline) { r.players[slot] = null; io.to(r.host).emit('player:left', { slot }); }
      }, 30000);
    }
  });
});

// שומר על השרת ער ב-Render (רק אם הוגדר SELF_URL, למשל https://zira-xxxx.onrender.com)
if (process.env.SELF_URL) {
  setInterval(() => { https.get(process.env.SELF_URL.replace(/\/$/, '') + '/health', (res) => res.resume()).on('error', () => {}); }, 10 * 60 * 1000);
}

server.listen(PORT, () => console.log(`זירה פועלת על http://localhost:${PORT}`));
