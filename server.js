// זירה – שרת משחקי מסיבה
// המסך הגדול (host) יוצר חדר, הטלפונים (players) מצטרפים עם קוד ושולחים קלט.
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
app.get('/qr', async (req, res) => {
  const url = String(req.query.u || '').slice(0, 300);
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0b0d1c', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  } catch (e) { res.status(400).end(); }
});

const MAX_PLAYERS = 2;
const rooms = new Map(); // code -> { host, players: [{id,name}|null], state }

function makeCode() {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join(''); } while (rooms.has(c));
  return c;
}

io.on('connection', (sock) => {
  sock.data = {};

  sock.on('host:create', (ack) => {
    const code = makeCode();
    rooms.set(code, { host: sock.id, players: Array(MAX_PLAYERS).fill(null), state: { mode: 'menu' } });
    sock.join(code);
    sock.data = { role: 'host', code };
    if (typeof ack === 'function') ack({ code });
  });

  sock.on('player:join', (msg, ack) => {
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
      io.to(r.host).emit('player:joined', { slot, name: p.name, back: true });
      return ack({ slot, name: p.name, state: r.state, token: p.token });
    }
    slot = r.players.findIndex((p) => !p);
    if (slot < 0) return ack({ error: 'החדר מלא (2 שחקנים)' });
    const name = String((msg && msg.name) || '').trim().slice(0, 12) || `שחקן ${slot + 1}`;
    const token = crypto.randomUUID();
    r.players[slot] = { id: sock.id, name, token, offline: false, timer: null };
    sock.join(code);
    sock.data = { role: 'player', code, slot };
    io.to(r.host).emit('player:joined', { slot, name });
    ack({ slot, name, state: r.state, token });
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
    if (role !== 'host') return;
    const r = rooms.get(code);
    if (!r) return;
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

  sock.on('disconnect', () => {
    const { role, code, slot } = sock.data;
    const r = rooms.get(code);
    if (!r) return;
    if (role === 'host') {
      sock.to(code).emit('host:gone');
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

server.listen(PORT, () => console.log(`זירה פועלת על http://localhost:${PORT}`));
