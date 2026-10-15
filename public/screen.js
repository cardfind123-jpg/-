'use strict';
// ============================================================
//  זירה – המסך הגדול. כל המשחקים רצים כאן; הטלפונים רק שולחים קלט.
// ============================================================
(() => {
const socket = io({ transports: ['websocket', 'polling'] });
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const VW = 1600, VH = 900;           // עולם וירטואלי – מותאם לכל מסך
let S = 1, OX = 0, OY = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.floor(innerWidth * dpr); cv.height = Math.floor(innerHeight * dpr);
  S = Math.min(cv.width / VW, cv.height / VH);
  OX = (cv.width - VW * S) / 2; OY = (cv.height - VH * S) / 2;
}
addEventListener('resize', resize); resize();
document.getElementById('fs').onclick = (e) => {
  e.stopPropagation();
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
};

const FONT = '"Rubik","Segoe UI",Arial,sans-serif';
const PC = ['#ff4d6d', '#2ec5ff'];
const PC_DARK = ['#9e1d3a', '#0b6a96'];
const GOLD = '#ffd60a';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const wrapAng = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
function seeded(s) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

const G = { code: null, players: [null, null], wins: [0, 0], scene: null, sceneName: '', slowT: 0, shake: 0, t: 0 };
const inp = [mkInp(), mkInp()];
function mkInp() { return { steer: 0, gas: false, brake: false, x: 0.5, y: 0.5, down: false, block: false }; }
const isBot = (i) => !G.players[i];
const pname = (i) => (G.players[i] ? G.players[i].name : 'המחשב');

// ---------------- סאונד ----------------
let AC = null;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
  if (AC.state === 'suspended') AC.resume();
}
addEventListener('pointerdown', audio); addEventListener('keydown', audio);
function tone(f, d = 0.12, type = 'square', vol = 0.08, slide = 0) {
  if (!AC || AC.state !== 'running') return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d + 0.02);
}
let noiseBuf = null;
function noise(d = 0.15, vol = 0.2, freq = 1200) {
  if (!AC || AC.state !== 'running') return;
  if (!noiseBuf) { noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate); const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; }
  const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(f).connect(g).connect(AC.destination); s.start(t); s.stop(t + d);
}
const seq = (notes, gap, d, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, d, type, vol), i * gap));
const SFX = {
  join: () => seq([523, 784], 90, 0.15),
  beep: () => tone(440, 0.18, 'square', 0.06),
  go: () => tone(880, 0.4, 'square', 0.07),
  hit: () => { noise(0.14, 0.35, 900); tone(130, 0.14, 'sine', 0.25, -70); },
  bighit: () => { noise(0.3, 0.45, 700); tone(90, 0.3, 'sine', 0.3, -50); },
  block: () => tone(320, 0.06, 'square', 0.05),
  whoosh: () => noise(0.12, 0.08, 2500),
  puck: () => tone(980, 0.04, 'square', 0.05),
  wall: () => tone(600, 0.03, 'square', 0.03),
  goal: () => seq([523, 659, 784, 1047], 90, 0.2),
  win: () => seq([392, 523, 659, 784, 1047], 120, 0.28),
  bump: () => noise(0.1, 0.2, 400),
};

// ---------------- אפקטים ----------------
const parts = [], floats = [];
function burst(x, y, col, n = 14, sp = 300, size = 6, life = 0.5) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rnd(sp * 0.3, sp);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(life * 0.5, life), max: life, col, size: rnd(size * 0.5, size), g: 0 });
  }
}
function floatText(s, x, y, col, size = 48) { floats.push({ s, x, y, col, size, life: 1.2, max: 1.2 }); }
function updFx(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= 1 - 2.5 * dt; p.vy *= 1 - 2.5 * dt;
  }
  for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; f.life -= dt; f.y -= 50 * dt; if (f.life <= 0) floats.splice(i, 1); }
  G.shake = Math.max(0, G.shake - dt * 45);
}
function drawFx() {
  for (const p of parts) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const f of floats) {
    const k = f.life / f.max, pop = 1 + Math.max(0, (k - 0.85)) * 3;
    ctx.globalAlpha = clamp(k * 2, 0, 1);
    txt(f.s, f.x, f.y, f.size * pop, f.col, 'center', 900, 8);
  }
  ctx.globalAlpha = 1;
}

// ---------------- ציור בסיסי ----------------
function txt(s, x, y, size, col = '#fff', align = 'center', weight = 800, stroke = 0) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.direction = /[\u0590-\u05FF]/.test(s) ? 'rtl' : 'ltr';
  if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = col; ctx.fillText(s, x, y);
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function panel(x, y, w, h, r = 24, fill = 'rgba(255,255,255,.05)', line = 'rgba(255,255,255,.1)') {
  rr(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = line; ctx.stroke();
}
function bar(x, y, w, h, v, col, back = 'rgba(0,0,0,.45)', fromRight = false) {
  rr(x, y, w, h, h / 2); ctx.fillStyle = back; ctx.fill();
  const fw = Math.max(0, w * clamp(v, 0, 1));
  if (fw > 1) { rr(fromRight ? x + w - fw : x, y, fw, h, h / 2); ctx.fillStyle = col; ctx.fill(); }
}
function bgGrad(c1, c2) {
  const g = ctx.createLinearGradient(0, 0, 0, VH); g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
}
function codeBadge() {
  if (!G.code) return;
  panel(VW / 2 - 110, VH - 46, 220, 36, 18, 'rgba(0,0,0,.5)', 'rgba(255,255,255,.12)');
  txt(`קוד חדר: ${G.code}`, VW / 2, VH - 28, 18, '#c9cdf0', 'center', 700);
}

// ---------------- רשת ----------------
function setScene(name, sc) {
  G.sceneName = name; G.scene = sc;
  if (sc.enter) sc.enter();
  socket.emit('host:state', Object.assign({ mode: name }, sc.stateExtra || {}));
}
function toPlayer(slot, ev, d) { if (G.players[slot]) socket.emit('host:to', { slot, ev, d }); }

const qrImg = new Image();
function loadQR() { qrImg.src = '/qr?u=' + encodeURIComponent(location.origin + '/play?c=' + G.code); }

socket.on('connect', () => {
  socket.emit('host:create', (r) => {
    G.code = r.code; G.players = [null, null]; loadQR(); setScene('menu', Menu);
  });
});
socket.on('player:joined', ({ slot, name }) => {
  G.players[slot] = { name }; inp[slot] = mkInp(); SFX.join();
  if (G.sceneName === 'menu') burst(slot ? 1220 : 380, 330, PC[slot], 30, 400, 7, 0.8);
});
socket.on('player:left', ({ slot }) => { G.players[slot] = null; inp[slot] = mkInp(); });
socket.on('axis', ({ slot, d }) => {
  const p = inp[slot]; if (!p || !d) return;
  if (typeof d.steer === 'number' && isFinite(d.steer)) p.steer = clamp(d.steer, -1, 1);
  if ('gas' in d) p.gas = !!d.gas;
  if ('brake' in d) p.brake = !!d.brake;
  if (typeof d.x === 'number' && isFinite(d.x)) p.x = clamp(d.x, 0, 1);
  if (typeof d.y === 'number' && isFinite(d.y)) p.y = clamp(d.y, 0, 1);
  if ('down' in d) p.down = !!d.down;
});
socket.on('input', ({ slot, d }) => {
  if (!d || !G.scene) return;
  if (d.t === 'quit') { if (G.sceneName !== 'menu') setScene('menu', Menu); return; }
  if (G.scene.onInput) G.scene.onInput(slot, d);
});

// ---------------- מקלדת ועכבר במסך ----------------
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && G.sceneName !== 'menu') setScene('menu', Menu);
  if (G.sceneName === 'menu' && ['1', '2', '3'].includes(e.key)) startGame(GAMES[+e.key - 1].id);
  if (G.sceneName === 'results' && (e.key === 'Enter' || e.key === ' ')) setScene('menu', Menu);
});
cv.addEventListener('pointerdown', (e) => {
  const x = (e.clientX * (cv.width / innerWidth) - OX) / S, y = (e.clientY * (cv.height / innerHeight) - OY) / S;
  if (G.sceneName === 'menu') GAMES.forEach((g, i) => { const c = cardRect(i); if (x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h) startGame(g.id); });
  else if (G.sceneName === 'results') setScene('menu', Menu);
});

// ============================================================
//  תפריט / לובי
// ============================================================
const GAMES = [
  { id: 'race', name: 'מרוץ', desc: 'הטו את הטלפון כמו הגה', col: '#ffb703' },
  { id: 'box', name: 'אגרוף', desc: 'ג׳אב, הוק, בלוק, נוקאאוט', col: '#ff4d6d' },
  { id: 'hockey', name: 'הוקי אוויר', desc: 'גררו את האצבע ותבקיעו', col: '#2ec5ff' },
];
function cardRect(i) { const w = 262, gap = 17; return { x: 100 + (2 - i) * (w + gap), y: 470, w, h: 250 }; }
function startGame(id) {
  if (id === 'race') setScene('race', Race);
  else if (id === 'box') setScene('box', Box);
  else if (id === 'hockey') setScene('hockey', Hockey);
}
function drawIcon(id, cx, cy, k = 1) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k);
  if (id === 'race') {
    ctx.rotate(-0.25);
    ctx.fillStyle = '#111'; [[-34, -26], [14, -26], [-34, 18], [14, 18]].forEach(([x, y]) => { rr(x, y, 22, 9, 3); ctx.fill(); });
    rr(-44, -20, 88, 40, 14); ctx.fillStyle = '#ffb703'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(-44, -4, 88, 8);
    rr(-10, -15, 28, 30, 6); ctx.fillStyle = '#7a4b00'; ctx.fill();
    rr(10, -13, 12, 26, 4); ctx.fillStyle = '#bfe9ff'; ctx.fill();
  } else if (id === 'box') {
    ctx.rotate(-0.4);
    rr(-22, 26, 44, 30, 8); ctx.fillStyle = '#f1f1f1'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, 44, 40, 0, 0, Math.PI * 2); ctx.fillStyle = '#ff4d6d'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(-34, 6, 18, 22, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-12, -14, 18, 12, -0.4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
  } else {
    ctx.beginPath(); ctx.ellipse(-26, 18, 34, 14, 0, 0, Math.PI * 2); ctx.fillStyle = '#20243f'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(-26, 12, 34, 14, 0, 0, Math.PI * 2); ctx.fillStyle = '#3a3f66'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(26, -4, 38, 22, 0, 0, Math.PI * 2); ctx.fillStyle = '#0b6a96'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(26, -10, 38, 22, 0, 0, Math.PI * 2); ctx.fillStyle = '#2ec5ff'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(26, -22, 16, 12, 0, 0, Math.PI * 2); ctx.fillStyle = '#e8f8ff'; ctx.fill();
  }
  ctx.restore();
}
const Menu = {
  enter() { this.t = 0; },
  update(dt) { this.t += dt; },
  onInput(slot, d) { if (d.t === 'menu') startGame(d.g); },
  draw() {
    bgGrad('#14183a', '#07081a');
    // עיגולים מרחפים ברקע
    for (let i = 0; i < 9; i++) {
      const x = (i * 211 + this.t * (12 + i * 3)) % (VW + 300) - 150, y = 120 + ((i * 137) % 700);
      ctx.beginPath(); ctx.arc(x, y, 60 + (i % 3) * 40, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? 'rgba(255,77,109,.05)' : 'rgba(46,197,255,.05)'; ctx.fill();
    }
    // כותרת
    const tg = ctx.createLinearGradient(600, 0, 1000, 0); tg.addColorStop(0, PC[1]); tg.addColorStop(1, PC[0]);
    txt('זירה', VW / 2, 92, 120, tg, 'center', 900);
    txt('המסך הוא הזירה · הטלפונים הם השלטים', VW / 2, 172, 30, '#a9afd8', 'center', 600);

    // שחקנים
    panel(100, 230, 820, 210);
    txt('שחקנים', 880, 262, 26, '#c9cdf0', 'right', 800);
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? 510 : 120, y = 290, w = 390, h = 130, on = !!G.players[i];
      panel(x, y, w, h, 20, on ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.25)', on ? PC[i] : 'rgba(255,255,255,.1)');
      ctx.beginPath(); ctx.arc(x + w - 62, y + h / 2, 38, 0, Math.PI * 2);
      ctx.fillStyle = on ? PC[i] : 'rgba(255,255,255,.08)'; ctx.fill();
      txt(String(i + 1), x + w - 62, y + h / 2 + 2, 38, on ? '#fff' : 'rgba(255,255,255,.3)', 'center', 900);
      if (on) {
        txt(pname(i), x + w - 120, y + 48, 36, '#fff', 'right', 800);
        txt(`ניצחונות: ${G.wins[i]}`, x + w - 120, y + 92, 22, '#a9afd8', 'right', 600);
      } else {
        const a = 0.45 + 0.35 * Math.sin(this.t * 3 + i);
        ctx.globalAlpha = a; txt('ממתין לשחקן…', x + w - 120, y + 48, 30, '#fff', 'right', 700); ctx.globalAlpha = 1;
        txt('בינתיים המחשב ישחק', x + w - 120, y + 92, 20, '#7d84b3', 'right', 600);
      }
    }

    // משחקים
    GAMES.forEach((g, i) => {
      const c = cardRect(i), bob = Math.sin(this.t * 2 + i) * 4;
      panel(c.x, c.y + bob, c.w, c.h, 24, 'rgba(255,255,255,.06)', g.col);
      txt(String(i + 1), c.x + c.w - 26, c.y + 28 + bob, 22, g.col, 'center', 900);
      drawIcon(g.id, c.x + c.w / 2, c.y + 92 + bob, 1);
      txt(g.name, c.x + c.w / 2, c.y + 172 + bob, 38, '#fff', 'center', 900);
      txt(g.desc, c.x + c.w / 2, c.y + 214 + bob, 19, '#a9afd8', 'center', 600);
    });
    txt('בחרו משחק בטלפון, או לחצו על כרטיס', 510, 762, 24, '#c9cdf0', 'center', 700);

    // הצטרפות
    panel(980, 230, 520, 560);
    txt('הצטרפו מהטלפון', 1240, 276, 34, '#fff', 'center', 900);
    rr(1110, 312, 260, 260, 18); ctx.fillStyle = '#fff'; ctx.fill();
    if (qrImg.complete && qrImg.naturalWidth) ctx.drawImage(qrImg, 1120, 322, 240, 240);
    txt('סרקו, או היכנסו לכתובת:', 1240, 606, 22, '#a9afd8', 'center', 600);
    txt(location.host + '/play', 1240, 638, 26, '#fff', 'center', 700);
    txt('קוד החדר', 1240, 690, 22, '#a9afd8', 'center', 600);
    const code = G.code || '····';
    for (let i = 0; i < 4; i++) {
      const x = 1240 + (i - 1.5) * 86;
      rr(x - 36, 712, 72, 64, 14); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.stroke();
      txt(code[i], x, 746, 46, GOLD, 'center', 900);
    }
    txt('2 שחקנים · כל משחק לבד מול המחשב או מול חבר', VW / 2, 860, 20, '#6c73a3', 'center', 600);
  },
};

// ============================================================
//  תוצאות
// ============================================================
const Results = {
  enter() { this.t = 0; },
  update(dt) {
    this.t += dt;
    if (this.w >= 0 && Math.random() < 0.6) parts.push({ x: rnd(0, VW), y: -10, vx: rnd(-60, 60), vy: rnd(150, 320), g: 120, life: 4, max: 4, col: Math.random() < 0.5 ? PC[this.w] : GOLD, size: rnd(4, 8) });
    if (this.t > 15) setScene('menu', Menu);
  },
  onInput(slot, d) {
    if (this.t < 0.8) return;
    if (d.t === 'again') startGame(this.game);
    else if (d.t === 'next') setScene('menu', Menu);
    else if (d.t === 'menu') startGame(d.g);
  },
  draw() {
    bgGrad('#14183a', '#07081a');
    const col = this.w >= 0 ? PC[this.w] : '#fff';
    const pop = 1 + Math.max(0, 0.4 - this.t) * 1.5;
    // גביע
    ctx.save(); ctx.translate(VW / 2, 270); ctx.scale(pop, pop);
    ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.moveTo(-80, -90); ctx.lineTo(80, -90); ctx.quadraticCurveTo(76, 20, 0, 40); ctx.quadraticCurveTo(-76, 20, -80, -90); ctx.fill();
    ctx.lineWidth = 14; ctx.strokeStyle = GOLD;
    ctx.beginPath(); ctx.arc(-84, -50, 34, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(84, -50, 34, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
    ctx.fillRect(-14, 38, 28, 40); rr(-60, 74, 120, 26, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(-36, -50, 12, 30, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (this.w >= 0) txt(`${pname(this.w)} ניצח/ה!`, VW / 2, 470, 92 * pop, col, 'center', 900, 10);
    else txt('תיקו!', VW / 2, 470, 92, '#fff', 'center', 900, 10);
    if (this.sub) txt(this.sub, VW / 2, 556, 32, '#c9cdf0', 'center', 700);
    // טבלת ניצחונות
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? VW / 2 + 40 : VW / 2 - 340;
      panel(x, 620, 300, 110, 22, 'rgba(255,255,255,.06)', PC[i]);
      txt(pname(i), x + 150, 652, 28, PC[i], 'center', 800);
      txt(`${G.wins[i]} ניצחונות`, x + 150, 698, 26, '#fff', 'center', 700);
    }
    txt('בטלפון: "עוד סיבוב" או "לתפריט"', VW / 2, 800, 26, '#a9afd8', 'center', 600);
  },
};
function showResults(w, sub, game) {
  if (w >= 0) G.wins[w]++;
  Results.w = w; Results.sub = sub; Results.game = game;
  Results.stateExtra = { w };
  SFX.win();
  setScene('results', Results);
}

// ============================================================
//  משחק 1: מרוץ
// ============================================================
const LAPS = 4;
const TRACK = { pts: null, N: 0, hw: 60, path: null, trees: [], stands: [] };
function buildTrack() {
  const C = [[230, 470], [270, 230], [470, 140], [700, 220], [930, 140], [1200, 120], [1400, 220], [1430, 450],
    [1300, 600], [1070, 570], [870, 680], [630, 790], [410, 775], [260, 680]];
  const raw = [], n = C.length;
  for (let i = 0; i < n; i++) {
    const p0 = C[(i - 1 + n) % n], p1 = C[i], p2 = C[(i + 1) % n], p3 = C[(i + 2) % n];
    for (let s = 0; s < 30; s++) {
      const t = s / 30, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const SP = 8, pts = [raw[0]];
  let acc = 0;
  for (let i = 1; i <= raw.length; i++) {
    let a = raw[i - 1]; const b = raw[i % raw.length];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (acc + seg >= SP) {
      const t = (SP - acc) / seg, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      pts.push(p); a = p; seg = Math.hypot(b[0] - a[0], b[1] - a[1]); acc = 0;
    }
    acc += seg;
  }
  if (Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) < SP * 0.6) pts.pop();
  TRACK.pts = pts; TRACK.N = pts.length;
  const p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]); for (const q of pts) p.lineTo(q[0], q[1]); p.closePath();
  TRACK.path = p;
  const R = seeded(7);
  const minD = (x, y) => { let m = 1e9; for (let i = 0; i < pts.length; i += 2) m = Math.min(m, Math.hypot(pts[i][0] - x, pts[i][1] - y)); return m; };
  for (let k = 0; k < 400 && TRACK.trees.length < 46; k++) {
    const x = 30 + R() * (VW - 60), y = 110 + R() * (VH - 140);
    if (minD(x, y) > TRACK.hw + 50) TRACK.trees.push([x, y, 16 + R() * 14, R()]);
  }
}
function nearest(x, y, hint) {
  const N = TRACK.N; let best = 1e12, bi = hint;
  for (let k = -40; k <= 40; k++) {
    const i = (hint + k + N) % N, p = TRACK.pts[i], d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  if (best > (TRACK.hw * 3) ** 2) {
    for (let i = 0; i < N; i++) { const p = TRACK.pts[i], d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < best) { best = d; bi = i; } }
  }
  return [bi, Math.sqrt(best)];
}
function mkCar(i) {
  const N = TRACK.N, idx = N - 9, p = TRACK.pts[idx], q = TRACK.pts[(idx + 1) % N];
  const a = Math.atan2(q[1] - p[1], q[0] - p[0]), nx = -Math.sin(a), ny = Math.cos(a), off = i === 0 ? -24 : 24;
  return { i, x: p[0] + nx * off, y: p[1] + ny * off, a, v: 0, idx, prog: -9, lap: 0, done: false, time: 0, off: false, bump: 0 };
}
function raceAI(c) {
  const N = TRACK.N, look = Math.round(10 + Math.abs(c.v) / 35), t = TRACK.pts[(c.idx + look) % N];
  const want = Math.atan2(t[1] - c.y, t[0] - c.x), diff = wrapAng(want - c.a);
  return [clamp(diff * (c.i ? 2.2 : 2.6), -1, 1), c.v < (c.i ? 455 : 480), Math.abs(diff) > 0.85 && c.v > 300];
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const Race = {
  enter() {
    if (!TRACK.pts) buildTrack();
    this.cars = [mkCar(0), mkCar(1)]; this.state = 'count'; this.count = 3.6; this.lastBeep = 4;
    this.raceT = 0; this.finish = []; this.endT = 0; this.goT = 0; this.skids = [];
  },
  update(dt) {
    if (this.state === 'count') {
      this.count -= dt; const c = Math.ceil(this.count);
      if (c < this.lastBeep && c > 0) { this.lastBeep = c; SFX.beep(); }
      if (this.count <= 0) { this.state = 'go'; this.goT = 0.9; SFX.go(); }
    }
    const racing = this.state !== 'count';
    if (racing) this.raceT += dt;
    this.goT = Math.max(0, this.goT - dt);
    const N = TRACK.N;
    for (const c of this.cars) {
      let steer, gas, brake;
      if (isBot(c.i)) [steer, gas, brake] = raceAI(c);
      else { const p = inp[c.i]; steer = p.steer; gas = p.gas; brake = p.brake; }
      if (c.done) { gas = false; brake = true; }
      if (!racing) { gas = false; brake = false; steer = 0; }
      const max = c.off ? 220 : 540;
      if (gas) c.v += 470 * dt;
      if (brake) { if (c.v > 20) c.v -= 950 * dt; else if (!c.done) c.v = Math.max(-150, c.v - 300 * dt); else c.v = 0; }
      c.v -= c.v * (c.off ? 1.8 : 0.42) * dt;
      if (c.v > max) c.v = lerp(c.v, max, 4 * dt);
      const grip = clamp(Math.abs(c.v) / 150, 0, 1) * (c.v < 0 ? -1 : 1);
      c.a += steer * 2.8 * grip * dt;
      c.x += Math.cos(c.a) * c.v * dt; c.y += Math.sin(c.a) * c.v * dt;
      c.x = clamp(c.x, 20, VW - 20); c.y = clamp(c.y, 110, VH - 20);
      const [ni, d] = nearest(c.x, c.y, c.idx);
      let di = ni - c.idx; if (di > N / 2) di -= N; if (di < -N / 2) di += N;
      c.prog += di; c.idx = ni; c.off = d > TRACK.hw;
      if (c.off && Math.abs(c.v) > 90 && Math.random() < 0.6)
        parts.push({ x: c.x - Math.cos(c.a) * 20, y: c.y - Math.sin(c.a) * 20, vx: rnd(-40, 40), vy: rnd(-40, 40), life: 0.6, max: 0.6, col: 'rgba(120,90,40,.55)', size: rnd(5, 10), g: 0 });
      if (!c.off && Math.abs(steer) > 0.8 && c.v > 380 && Math.random() < 0.5) this.skids.push([c.x, c.y, 1.4]);
      const lap = Math.floor(c.prog / N);
      if (!c.done && lap > c.lap && lap < LAPS) {
        c.lap = lap; floatText(lap === LAPS - 1 ? 'הקפה אחרונה!' : `הקפה ${lap + 1}`, c.x, c.y - 50, PC[c.i], 36); SFX.beep(); toPlayer(c.i, 'vibe', 60);
      }
      if (!c.done && c.prog >= LAPS * N) {
        c.done = true; c.time = this.raceT; this.finish.push(c.i);
        burst(c.x, c.y, PC[c.i], 40, 450, 7, 0.9); toPlayer(c.i, 'vibe', [150, 80, 150]);
        if (this.finish.length === 1) { this.state = 'finish'; this.endT = 0; SFX.goal(); }
      }
    }
    for (const s of this.skids) s[2] -= dt;
    this.skids = this.skids.filter((s) => s[2] > 0);
    // התנגשות בין המכוניות
    const A = this.cars[0], B = this.cars[1], dx = B.x - A.x, dy = B.y - A.y, dd = Math.hypot(dx, dy);
    if (dd < 40 && dd > 0.01) {
      const push = (40 - dd) / 2, nx = dx / dd, ny = dy / dd;
      A.x -= nx * push; A.y -= ny * push; B.x += nx * push; B.y += ny * push;
      if (Math.abs(A.v - B.v) > 60 || Math.max(A.v, B.v) > 250) {
        if (A.bump <= 0) { SFX.bump(); G.shake = Math.max(G.shake, 7); burst((A.x + B.x) / 2, (A.y + B.y) / 2, GOLD, 10, 250, 4, 0.35); toPlayer(0, 'vibe', 40); toPlayer(1, 'vibe', 40); }
        A.bump = B.bump = 0.4;
      }
      A.v *= 0.97; B.v *= 0.97;
    }
    A.bump -= dt; B.bump -= dt;
    if (this.state === 'finish') {
      this.endT += dt;
      if (this.finish.length === 2 || this.endT > 8) {
        const w = this.finish[0], loser = this.cars[1 - w];
        const sub = loser.done ? `${fmtTime(this.cars[w].time)} · פער של ${(loser.time - this.cars[w].time).toFixed(2)} שניות` : `זמן: ${fmtTime(this.cars[w].time)}`;
        showResults(w, sub, 'race');
      }
    }
  },
  position(i) {
    const a = this.cars[i], b = this.cars[1 - i];
    if (a.done && b.done) return this.finish.indexOf(i) + 1;
    if (a.done) return 1; if (b.done) return 2;
    return a.prog >= b.prog ? 1 : 2;
  },
  draw() {
    ctx.fillStyle = '#2f7d3a'; ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = '#2b7335'; for (let x = 0; x < VW; x += 100) ctx.fillRect(x, 0, 50, VH);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = TRACK.hw * 2 + 34; ctx.stroke(TRACK.path);
    ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = TRACK.hw * 2 + 18; ctx.stroke(TRACK.path);
    ctx.lineCap = 'butt'; ctx.setLineDash([22, 22]); ctx.strokeStyle = '#e63946'; ctx.stroke(TRACK.path); ctx.setLineDash([]); ctx.lineCap = 'round';
    ctx.strokeStyle = '#3b3f4f'; ctx.lineWidth = TRACK.hw * 2; ctx.stroke(TRACK.path);
    ctx.lineCap = 'butt'; ctx.setLineDash([26, 30]); ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 4; ctx.stroke(TRACK.path); ctx.setLineDash([]); ctx.lineCap = 'round';
    // קו זינוק
    { const p = TRACK.pts[0], q = TRACK.pts[1], a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(a);
      const sq = 10, rows = Math.ceil((TRACK.hw * 2) / sq);
      for (let r = 0; r < rows; r++) for (let k = 0; k < 2; k++) { ctx.fillStyle = (r + k) % 2 ? '#111' : '#fff'; ctx.fillRect(-sq + k * sq, -TRACK.hw + r * sq, sq, sq); }
      ctx.restore(); }
    for (const s of this.skids) { ctx.globalAlpha = s[2] / 1.4 * 0.35; ctx.fillStyle = '#111'; ctx.fillRect(s[0] - 3, s[1] - 3, 6, 6); }
    ctx.globalAlpha = 1;
    // עצים
    for (const [x, y, r, k] of TRACK.trees) {
      ctx.beginPath(); ctx.arc(x + 5, y + 6, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = k > 0.5 ? '#1f5e2a' : '#246b30'; ctx.fill();
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fill();
    }
    for (const c of this.cars) drawCar(c);
    drawFx();
    // HUD
    for (let i = 0; i < 2; i++) {
      const c = this.cars[i], x = i === 0 ? 24 : VW - 344, pos = this.position(i);
      panel(x, 18, 320, 76, 38, 'rgba(10,12,30,.78)', PC[i]);
      ctx.beginPath(); ctx.arc(x + 282, 56, 26, 0, Math.PI * 2); ctx.fillStyle = PC[i]; ctx.fill();
      txt(String(pos), x + 282, 58, 30, '#fff', 'center', 900);
      txt(pname(i), x + 240, 42, 24, '#fff', 'right', 800);
      const lapShow = c.done ? 'סיים!' : `הקפה ${clamp(Math.floor(c.prog / TRACK.N) + 1, 1, LAPS)}/${LAPS}`;
      txt(lapShow, x + 240, 74, 20, '#c9cdf0', 'right', 600);
      bar(x + 24, 66, 110, 10, Math.max(0, c.v) / 540, PC[i]);
      txt(`${Math.round(Math.max(0, c.v) / 3)} קמ״ש`, x + 79, 42, 18, '#c9cdf0', 'center', 700);
    }
    if (this.raceT > 0) txt(fmtTime(this.raceT), VW / 2, 50, 30, '#fff', 'center', 800, 6);
    if (this.state === 'count') {
      const c = Math.ceil(this.count), f = this.count - Math.floor(this.count);
      if (c <= 3) txt(String(c), VW / 2, VH / 2, 200 * (0.8 + f * 0.4), GOLD, 'center', 900, 16);
      else txt('היכונו…', VW / 2, VH / 2, 110, '#fff', 'center', 900, 14);
      txt('הטו את הטלפון כדי לנווט · לחצו "גז" כדי לנסוע', VW / 2, VH / 2 + 150, 30, '#fff', 'center', 700, 8);
    }
    if (this.goT > 0) { ctx.globalAlpha = Math.min(1, this.goT * 2); txt('סעו!', VW / 2, VH / 2, 220, '#6bff8a', 'center', 900, 16); ctx.globalAlpha = 1; }
    if (this.state === 'finish') txt(`${pname(this.finish[0])} חצה ראשון!`, VW / 2, VH / 2, 90, PC[this.finish[0]], 'center', 900, 12);
    codeBadge();
  },
};
function drawCar(c) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
  rr(-22, -10, 48, 26, 9); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
  ctx.fillStyle = '#111'; [[-19, -16], [8, -16], [-19, 11], [8, 11]].forEach(([x, y]) => { rr(x, y, 13, 5, 2); ctx.fill(); });
  rr(-25, -13, 50, 26, 9); ctx.fillStyle = PC[c.i]; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(-25, -2.5, 50, 5);
  rr(-8, -10, 18, 20, 5); ctx.fillStyle = PC_DARK[c.i]; ctx.fill();
  rr(5, -9, 8, 18, 3); ctx.fillStyle = '#c4ecff'; ctx.fill();
  ctx.fillStyle = '#fff6b0'; ctx.fillRect(21, -10, 4, 5); ctx.fillRect(21, 5, 4, 5);
  ctx.restore();
  txt(pname(c.i), c.x, c.y - 30, 16, '#fff', 'center', 800, 4);
}

// ============================================================
//  משחק 2: אגרוף
// ============================================================
const MOVES = {
  jab: { w: 0.09, h: 0.13, e: 0.32, dmg: 6, sta: 9 },
  hook: { w: 0.30, h: 0.35, e: 0.62, dmg: 14, sta: 20 },
  super: { w: 0.36, h: 0.44, e: 0.85, dmg: 26, sta: 0 },
};
const FIGHT_TIME = 90;
const crowd = (() => { const R = seeded(3), a = []; for (let row = 0; row < 4; row++) for (let i = 0; i < 34; i++) a.push([i * 49 + (row % 2) * 24 + R() * 10, 330 + row * 46, 20 + R() * 6, R() * 6, R()]); return a; })();
const Box = {
  enter() {
    this.b = [0, 1].map((i) => ({ i, x: i ? 905 : 695, dir: i ? -1 : 1, hp: 100, shownHp: 100, sta: 100, meter: 0, act: 'idle', t: 0, did: false, blk: false, dodgeCd: 0, hitT: 0, flash: 0, ai: { t: 1.2, blk: 0, reacted: false }, landed: 0, thrown: 0, last: [] }));
    this.time = FIGHT_TIME; this.state = 'intro'; this.it = 2.4; this.endT = 0; this.winner = -1; this.reason = ''; this.t = 0;
    this.sent = [null, null];
  },
  onInput(slot, d) {
    const b = this.b[slot]; if (!b) return;
    if (d.t === 'block') { b.blk = !!d.v; return; }
    if (this.state === 'fight') this.act(b, d.t);
  },
  act(b, m) {
    if (b.act !== 'idle' || b.hitT > 0) return;
    if (m === 'dodge') {
      if (b.dodgeCd > 0 || b.sta < 12) return;
      b.sta -= 12; b.act = 'dodge'; b.t = 0; b.dodgeCd = 0.75; SFX.whoosh(); return;
    }
    const mv = MOVES[m]; if (!mv) return;
    if (m === 'super') { if (b.meter < 100) return; b.meter = 0; floatText('סופר!', b.x, 250, GOLD, 64); tone(200, 0.45, 'sawtooth', 0.06, 600); }
    else if (b.sta < mv.sta) { floatText('אין כוח!', b.x, 270, '#9aa1c9', 28); return; }
    b.sta -= mv.sta; b.act = m; b.t = 0; b.did = false; b.thrown++;
    if (m !== 'super') SFX.whoosh();
  },
  ai(b, o, dt) {
    const A = b.ai; A.t -= dt;
    const oMv = MOVES[o.act];
    if (oMv && !A.reacted) {
      A.reacted = true; const r = Math.random();
      if (o.act !== 'jab' && r < 0.35) this.act(b, 'dodge');
      else if (r < 0.55) { b.blk = true; A.blk = 0.55; }
    }
    if (!oMv) A.reacted = false;
    if (A.blk > 0) { A.blk -= dt; if (A.blk <= 0) b.blk = false; }
    if (A.t <= 0) {
      A.t = rnd(0.5, 1.15);
      if (b.meter >= 100) this.act(b, 'super');
      else { const r = Math.random(); if (r < 0.55) this.act(b, 'jab'); else if (r < 0.8) this.act(b, 'hook'); else { b.blk = true; A.blk = rnd(0.4, 0.9); } }
    }
  },
  resolve(a, o, m, mv) {
    if (this.state !== 'fight') return;
    const hx = o.x - o.dir * 6, hy = m === 'super' ? 330 : 350;
    if (o.act === 'dodge' && o.t > 0.03 && o.t < 0.4) {
      floatText('התחמקות!', o.x, 280, '#bde0fe', 34); tone(500, 0.08, 'sine', 0.05, -200);
      o.sta = Math.min(100, o.sta + 10); o.meter = Math.min(100, o.meter + 6); return;
    }
    let dmg = mv.dmg, counter = false;
    const oMv = MOVES[o.act];
    if (oMv && !o.did && o.t < oMv.h) { dmg *= 1.5; counter = true; o.act = 'idle'; o.t = 0; }
    const blocking = o.blk && o.act === 'idle' && o.hitT <= 0;
    if (blocking && !counter) {
      if (m !== 'super') {
        o.hp = Math.max(0, o.hp - dmg * 0.15); o.sta = Math.max(0, o.sta - 8);
        a.meter = Math.min(100, a.meter + 3); o.meter = Math.min(100, o.meter + 4);
        SFX.block(); burst(hx, hy, '#cfd8ff', 8, 220, 5, 0.3); floatText('בלוק', o.x, 280, '#cfd8ff', 28);
        toPlayer(o.i, 'vibe', 20); this.checkKO(a, o); return;
      }
      dmg *= 0.5;
    }
    o.hp = Math.max(0, o.hp - dmg); o.hitT = m === 'jab' ? 0.22 : 0.4; o.flash = 0.15;
    if (o.act !== 'ko') { o.act = 'idle'; o.t = 0; }
    a.meter = Math.min(100, a.meter + dmg * 2.2); o.meter = Math.min(100, o.meter + dmg * 0.8); a.landed++;
    const big = m !== 'jab';
    big ? SFX.bighit() : SFX.hit();
    G.shake = Math.max(G.shake, m === 'jab' ? 6 : m === 'hook' ? 13 : 24);
    burst(hx, hy, '#fff', m === 'super' ? 40 : 16, m === 'super' ? 600 : 350, 6, 0.45);
    burst(hx, hy, PC[a.i], m === 'super' ? 24 : 8, 300, 5, 0.4);
    floatText(counter ? 'קאונטר!' : `-${Math.round(dmg)}`, o.x, counter ? 240 : 270, counter ? GOLD : '#fff', counter ? 46 : 34);
    if (m === 'super') G.slowT = 0.45;
    toPlayer(o.i, 'vibe', m === 'jab' ? 40 : m === 'hook' ? 90 : [120, 60, 180]);
    this.checkKO(a, o);
  },
  checkKO(a, o) {
    if (o.hp <= 0 && this.state === 'fight') {
      o.hp = 0; o.act = 'ko'; o.t = 0; this.state = 'ko'; this.endT = 0; this.winner = a.i; this.reason = 'נוקאאוט!';
      G.slowT = 1.3; floatText('נוקאאוט!', VW / 2, 230, GOLD, 120); toPlayer(o.i, 'vibe', [300, 100, 300]);
    }
  },
  update(dt) {
    this.t += dt;
    if (this.state === 'intro') { this.it -= dt; if (this.it <= 0) { this.state = 'fight'; SFX.go(); tone(660, 0.6, 'triangle', 0.08); } }
    else if (this.state === 'fight') {
      this.time -= dt;
      if (this.time <= 0) {
        this.time = 0; const [p, q] = this.b; this.state = 'ko'; this.endT = 0; this.reason = 'הכרעת שופטים';
        this.winner = Math.abs(p.hp - q.hp) < 0.5 ? -1 : p.hp > q.hp ? 0 : 1; tone(300, 0.8, 'sawtooth', 0.06);
      }
    }
    for (const b of this.b) {
      const o = this.b[1 - b.i];
      b.shownHp = lerp(b.shownHp, b.hp, 3 * dt);
      if (isBot(b.i) && this.state === 'fight') this.ai(b, o, dt);
      b.dodgeCd = Math.max(0, b.dodgeCd - dt); b.hitT = Math.max(0, b.hitT - dt); b.flash = Math.max(0, b.flash - dt);
      if (b.act === 'ko') { b.t += dt; continue; }
      if (b.act === 'idle' && b.hitT <= 0) b.sta = Math.min(100, b.sta + (b.blk ? 9 : 24) * dt);
      if (b.act !== 'idle') {
        b.t += dt; const mv = MOVES[b.act];
        if (mv) { if (!b.did && b.t >= mv.h) { b.did = true; this.resolve(b, o, b.act, mv); } if (b.t >= mv.e && b.act !== 'ko') { b.act = 'idle'; b.t = 0; } }
        else if (b.act === 'dodge' && b.t >= 0.45) { b.act = 'idle'; b.t = 0; }
      }
      const snap = [Math.floor(b.meter / 5), Math.floor(b.sta / 10)].join();
      if (snap !== this.sent[b.i]) { this.sent[b.i] = snap; toPlayer(b.i, 'meter', { v: Math.round(b.meter), sta: Math.round(b.sta) }); }
    }
    if (this.state === 'ko') {
      this.endT += dt;
      if (this.endT > 2.8) {
        const w = this.winner, sub = w >= 0 ? `${this.reason} · ${this.b[w].landed} מכות שנחתו` : 'אותה כמות חיים בדיוק!';
        showResults(w, sub, 'box');
      }
    }
  },
  draw() {
    // זירה ורקע
    bgGrad('#1a1030', '#050409');
    for (const [x, y, r, ph, k] of crowd) {
      const bob = Math.sin(this.t * (4 + k * 3) + ph) * (this.state === 'ko' ? 9 : 3);
      ctx.fillStyle = `rgba(${30 + k * 30},${20 + k * 20},${50 + k * 30},1)`;
      ctx.beginPath(); ctx.arc(x, y + bob, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - r * 1.1, y + bob + r * 0.7, r * 2.2, 40);
    }
    // פלאשים של מצלמות
    if (Math.random() < 0.08) { const x = rnd(0, VW), y = rnd(320, 470); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }
    // אורות במה
    for (const sx of [500, 1100]) {
      const g = ctx.createRadialGradient(sx, 0, 10, sx, 600, 520);
      g.addColorStop(0, 'rgba(255,240,200,.22)'); g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sx - 40, 0); ctx.lineTo(sx + 40, 0); ctx.lineTo(sx + 380, 820); ctx.lineTo(sx - 380, 820); ctx.fill();
    }
    // רצפת הזירה
    ctx.fillStyle = '#2b2f5c'; ctx.beginPath(); ctx.moveTo(130, 600); ctx.lineTo(1470, 600); ctx.lineTo(1580, 840); ctx.lineTo(20, 840); ctx.fill();
    ctx.fillStyle = '#3a3f7a'; ctx.beginPath(); ctx.moveTo(150, 605); ctx.lineTo(1450, 605); ctx.lineTo(1540, 800); ctx.lineTo(60, 800); ctx.fill();
    ctx.fillStyle = '#1b1e3d'; ctx.fillRect(20, 840, 1560, 60);
    const fg = ctx.createRadialGradient(800, 700, 20, 800, 700, 500); fg.addColorStop(0, 'rgba(255,255,255,.12)'); fg.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = fg; ctx.fillRect(0, 600, VW, 240);
    // חבלים אחוריים
    const ropes = (ys, w) => { for (const [y, c] of ys) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(150, y); ctx.lineTo(1450, y); ctx.stroke(); } };
    ropes([[470, '#c1121f'], [515, '#f1f1f1'], [560, '#1d4ed8']], 7);
    for (const x of [150, 1450]) { rr(x - 14, 440, 28, 170, 8); ctx.fillStyle = '#d6d6e6'; ctx.fill(); }
    // מתאגרפים (צל + גוף)
    for (const b of this.b) { ctx.beginPath(); ctx.ellipse(b.x, 712, 90, 16, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill(); }
    const order = this.b[0].act === 'ko' ? [0, 1] : [1, 0];
    for (const k of order) drawBoxer(this.b[k], this.t);
    // חבל קדמי
    ctx.globalAlpha = 0.85; ropes([[640, '#c1121f']], 9); ctx.globalAlpha = 1;
    for (const x of [60, 1540]) { rr(x - 16, 600, 32, 240, 8); ctx.fillStyle = '#e8e8f4'; ctx.fill(); }
    drawFx();
    // HUD
    for (let i = 0; i < 2; i++) {
      const b = this.b[i], left = i === 0, x = left ? 40 : 920, w = 640;
      txt(pname(i), left ? x : x + w, 28, 28, PC[i], left ? 'left' : 'right', 900, 6);
      bar(x, 50, w, 34, b.shownHp / 100, 'rgba(255,255,255,.35)', 'rgba(0,0,0,.6)', left);
      bar(x, 50, w, 34, b.hp / 100, b.hp > 30 ? PC[i] : '#ff2a2a', 'rgba(0,0,0,0)', left);
      rr(x, 50, w, 34, 17); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.stroke();
      bar(left ? x + w - 300 : x, 92, 300, 10, b.sta / 100, '#6bff8a', 'rgba(0,0,0,.55)', left);
      bar(left ? x + w - 300 : x, 108, 300, 10, b.meter / 100, b.meter >= 100 ? (Math.sin(this.t * 12) > 0 ? GOLD : '#fff') : GOLD, 'rgba(0,0,0,.55)', left);
      txt(b.meter >= 100 ? 'סופר מוכן!' : 'כוח · סופר', left ? x + w - 310 : x + 310, 100, 15, b.meter >= 100 ? GOLD : '#9aa1c9', left ? 'right' : 'left', 700);
    }
    ctx.beginPath(); ctx.arc(VW / 2, 70, 50, 0, Math.PI * 2); ctx.fillStyle = 'rgba(10,10,25,.9)'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = this.time < 10 ? '#ff2a2a' : GOLD; ctx.stroke();
    txt(String(Math.ceil(this.time)), VW / 2, 72, 44, '#fff', 'center', 900);
    if (this.state === 'intro') {
      const k = this.it > 1.2 ? 'מוכנים?' : 'קרב!';
      txt(k, VW / 2, VH / 2 - 60, 170, k === 'קרב!' ? GOLD : '#fff', 'center', 900, 16);
      txt('ג׳אב מהיר · הוק חזק · בלוק · התחמקות · מלאו את הסופר', VW / 2, VH / 2 + 70, 30, '#fff', 'center', 700, 8);
    }
    if (this.state === 'ko' && this.reason === 'הכרעת שופטים') txt('הזמן נגמר!', VW / 2, VH / 2 - 60, 120, '#fff', 'center', 900, 14);
    codeBadge();
  },
};
function ext(b) {
  const mv = MOVES[b.act]; if (!mv) return 0; const t = b.t;
  if (t < mv.w) return -0.2 * (t / mv.w);
  if (t < mv.h) return lerp(-0.2, 1, (t - mv.w) / (mv.h - mv.w));
  return Math.max(0, 1 - (t - mv.h) / (mv.e - mv.h));
}
function drawBoxer(b, T) {
  const d = b.dir, skin = '#e0a96d', skinD = '#b97f45', col = PC[b.i], colD = PC_DARK[b.i];
  let bx = b.x, lean = 0, drop = 0, rot = 0;
  const bob = b.act === 'ko' ? 0 : Math.sin(T * 7 + b.i * 2) * 4;
  if (b.act === 'dodge') { const k = Math.sin(Math.min(1, b.t / 0.45) * Math.PI); bx -= d * 55 * k; drop = 38 * k; lean = -0.25 * k; }
  if (b.hitT > 0) { const k = b.hitT / 0.4; bx -= d * 18 * k; lean = -0.18 * k; }
  if (b.act === 'ko') { const k = Math.min(1, b.t * 2.2); rot = -d * 1.45 * k; bx -= d * 60 * k; drop = 20 * k; }
  if (MOVES[b.act]) lean = 0.12 * Math.max(0, ext(b));
  ctx.save();
  ctx.translate(bx, 700); ctx.rotate(rot); ctx.translate(0, -700 + drop + bob);
  // רגליים
  ctx.lineCap = 'round'; ctx.strokeStyle = skinD; ctx.lineWidth = 24;
  ctx.beginPath(); ctx.moveTo(-18 * d, 560); ctx.lineTo(-44 * d, 690); ctx.moveTo(18 * d, 560); ctx.lineTo(40 * d, 690); ctx.stroke();
  ctx.fillStyle = '#16162a'; rr(-62 * d - (d < 0 ? 40 : 0), 682, 40, 18, 8); ctx.fill(); rr(26 * d - (d < 0 ? 40 : 0), 682, 40, 18, 8); ctx.fill();
  // גוף נוטה
  ctx.save(); ctx.translate(0, 560); ctx.rotate(lean * d); ctx.translate(0, -560);
  rr(-40, 520, 80, 62, 14); ctx.fillStyle = col; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(-40, 524, 80, 8);
  ctx.beginPath(); ctx.moveTo(-44, 420); ctx.quadraticCurveTo(0, 405, 44, 420); ctx.lineTo(36, 528); ctx.lineTo(-36, 528); ctx.closePath(); ctx.fillStyle = skin; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 440); ctx.lineTo(0, 500); ctx.stroke();
  // ראש
  const hx = 8 * d, hy = 370;
  ctx.beginPath(); ctx.arc(hx, hy, 36, 0, Math.PI * 2); ctx.fillStyle = skin; ctx.fill();
  ctx.beginPath(); ctx.arc(hx - 4 * d, hy - 8, 37, Math.PI * 1.05, Math.PI * 1.95); ctx.fillStyle = '#2a1a10'; ctx.fill();
  ctx.fillStyle = col; ctx.fillRect(hx - 37, hy - 16, 74, 9);
  if (b.act === 'ko') { ctx.strokeStyle = '#111'; ctx.lineWidth = 3; const ex = hx + 16 * d; ctx.beginPath(); ctx.moveTo(ex - 6, hy - 4); ctx.lineTo(ex + 6, hy + 6); ctx.moveTo(ex + 6, hy - 4); ctx.lineTo(ex - 6, hy + 6); ctx.stroke(); }
  else { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(hx + 18 * d, hy + 2, 4.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = '#7a3b2e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hx + 14 * d, hy + 20); ctx.lineTo(hx + 26 * d, hy + (b.hitT > 0 ? 24 : 18)); ctx.stroke();
  if (b.flash > 0) { ctx.globalAlpha = b.flash / 0.15 * 0.7; ctx.beginPath(); ctx.arc(hx, hy, 38, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.globalAlpha = 1; }
  // ידיים
  const shF = [14 * d, 430], shR = [-16 * d, 432];
  let gF = [62 * d, 382], gR = [34 * d, 400];
  const blockingNow = b.blk && b.act === 'idle' && b.hitT <= 0;
  if (blockingNow) { gF = [44 * d, 350]; gR = [30 * d, 382]; }
  if (b.act === 'jab') { const e = ext(b); gF = [lerp(62, 230, e) * d, 382 - 20 * e]; }
  if (b.act === 'hook') { const e = ext(b); gR = [lerp(34, 210, e) * d, 400 - 50 * Math.sin(Math.PI * clamp(e, 0, 1)) - 20 * e]; }
  if (b.act === 'super') { const e = ext(b); gR = [lerp(34, 200, Math.max(0, e)) * d, lerp(470, 330, Math.max(0, e))]; }
  if (b.act === 'ko') { gF = [70 * d, 470]; gR = [-40 * d, 480]; }
  const arm = (s, g, back) => {
    ctx.strokeStyle = back ? skinD : skin; ctx.lineWidth = 20; ctx.beginPath(); ctx.moveTo(s[0], s[1]);
    ctx.quadraticCurveTo((s[0] + g[0]) / 2, Math.max(s[1], g[1]) + 22, g[0], g[1]); ctx.stroke();
    ctx.beginPath(); ctx.arc(g[0], g[1], 27, 0, Math.PI * 2); ctx.fillStyle = back ? colD : col; ctx.fill();
    ctx.beginPath(); ctx.arc(g[0] - 7, g[1] - 9, 9, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
    ctx.fillStyle = '#f1f1f1'; ctx.beginPath(); ctx.arc(g[0] - 20 * d, g[1] + 8, 9, 0, Math.PI * 2); ctx.fill();
  };
  arm(shR, gR, true); arm(shF, gF, false);
  if (b.act === 'super' && ext(b) > 0.4) { ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(gR[0], gR[1], 46, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill(); ctx.globalAlpha = 1; }
  ctx.restore();
  ctx.restore();
  if (b.act === 'ko') for (let k = 0; k < 4; k++) { const a = T * 4 + k * 1.57; txt('★', bx - d * 120 + Math.cos(a) * 46, 640 + Math.sin(a) * 14, 26, GOLD, 'center', 900); }
}

// ============================================================
//  משחק 3: הוקי אוויר
// ============================================================
const RINK = { x0: 120, y0: 110, x1: 1480, y1: 830, gy0: 360, gy1: 580, pr: 22, mr: 42 };
const WIN_GOALS = 7;
const Hockey = {
  enter() {
    const cy = (RINK.y0 + RINK.y1) / 2;
    this.m = [0, 1].map((i) => ({ i, x: i ? 1300 : 300, y: cy, vx: 0, vy: 0, tx: i ? 1300 : 300, ty: cy }));
    this.score = [0, 0]; this.state = 'intro'; this.it = 1.8; this.goalT = 0; this.scorer = -1; this.trail = [];
    this.resetPuck(Math.random() < 0.5 ? 0 : 1); this.endT = 0;
    inp[0].x = 0.2; inp[1].x = 0.8; inp[0].y = inp[1].y = 0.5;
  },
  resetPuck(toward) { const cy = (RINK.y0 + RINK.y1) / 2; this.p = { x: toward === 0 ? 640 : 960, y: cy, vx: 0, vy: 0 }; },
  half(i) { const cx = (RINK.x0 + RINK.x1) / 2, r = RINK.mr; return i === 0 ? [RINK.x0 + r, cx - r] : [cx + r, RINK.x1 - r]; },
  ai(m) {
    const p = this.p, [mn, mx] = this.half(m.i), home = m.i === 0 ? RINK.x0 + 90 : RINK.x1 - 90, mine = m.i === 0 ? p.x < 800 : p.x > 800;
    const towardMe = m.i === 0 ? p.vx < 50 : p.vx > -50;
    if (mine && towardMe) { m.tx = p.x - (m.i === 0 ? 40 : -40); m.ty = p.y + (p.y > m.y ? 8 : -8); }
    else if (mine) { m.tx = p.x - (m.i === 0 ? 30 : -30); m.ty = p.y; }
    else { m.tx = home + (m.i === 0 ? 60 : -60); m.ty = lerp((RINK.y0 + RINK.y1) / 2, p.y, 0.6); }
    m.tx = clamp(m.tx, mn, mx); m.ty = clamp(m.ty, RINK.y0 + RINK.mr, RINK.y1 - RINK.mr);
  },
  update(dt) {
    if (this.state === 'intro') { this.it -= dt; if (this.it <= 0) { this.state = 'play'; SFX.go(); } }
    for (const m of this.m) {
      const [mn, mx] = this.half(m.i);
      if (isBot(m.i)) this.ai(m);
      else { const k = inp[m.i]; m.tx = lerp(mn, mx, k.x); m.ty = lerp(RINK.y0 + RINK.mr, RINK.y1 - RINK.mr, k.y); }
      const dx = m.tx - m.x, dy = m.ty - m.y, dist = Math.hypot(dx, dy), maxS = isBot(m.i) ? 950 : 2200, step = Math.min(dist, maxS * dt);
      const ox = m.x, oy = m.y;
      if (dist > 0.01) { m.x += dx / dist * step; m.y += dy / dist * step; }
      m.x = clamp(m.x, mn, mx); m.y = clamp(m.y, RINK.y0 + RINK.mr, RINK.y1 - RINK.mr);
      m.vx = (m.x - ox) / dt; m.vy = (m.y - oy) / dt;
    }
    if (this.state === 'goal') {
      this.goalT -= dt;
      if (this.goalT <= 0) {
        if (this.score[this.scorer] >= WIN_GOALS) { this.state = 'over'; this.endT = 0; }
        else { this.resetPuck(1 - this.scorer); this.state = 'play'; }
      }
      return;
    }
    if (this.state === 'over') {
      this.endT += dt;
      if (this.endT > 1.2) { const w = this.score[0] > this.score[1] ? 0 : 1; showResults(w, `${this.score[Math.max(0, w)]} : ${this.score[1 - w]}`, 'hockey'); }
      return;
    }
    if (this.state !== 'play') return;
    const p = this.p, R = RINK, pr = R.pr;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const f = 1 - 0.22 * dt; p.vx *= f; p.vy *= f;
    const sp = Math.hypot(p.vx, p.vy), MAXP = 1900; if (sp > MAXP) { p.vx *= MAXP / sp; p.vy *= MAXP / sp; }
    if (this.walls(sp)) return;
    for (const m of this.m) {
      const dx = p.x - m.x, dy = p.y - m.y, dist = Math.hypot(dx, dy), minD = pr + R.mr;
      if (dist < minD && dist > 0.001) {
        const nx = dx / dist, ny = dy / dist;
        p.x = m.x + nx * minD; p.y = m.y + ny * minD;
        const rvx = p.vx - m.vx, rvy = p.vy - m.vy, vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          p.vx -= 1.85 * vn * nx; p.vy -= 1.85 * vn * ny;
          const hit = Math.abs(vn);
          if (hit > 200) { SFX.puck(); burst(p.x - nx * pr, p.y - ny * pr, PC[m.i], Math.min(16, hit / 80), 220, 4, 0.3); if (hit > 900) { G.shake = Math.max(G.shake, 5); toPlayer(m.i, 'vibe', 25); } }
        }
      }
    }
    if (this.walls(0)) return;
    const near = (Math.min(p.x - R.x0, R.x1 - p.x) < 90) && (Math.min(p.y - R.y0, R.y1 - p.y) < 90);
    const slow = Math.hypot(p.vx, p.vy) < 250;
    this.stuck = (near || slow) && Math.hypot(p.vx, p.vy) < 250 ? (this.stuck || 0) + dt : 0;
    if (this.stuck > (near ? 1.2 : 4)) { const a = Math.atan2((R.y0 + R.y1) / 2 - p.y, 800 - p.x); p.vx = Math.cos(a) * 450; p.vy = Math.sin(a) * 450; this.stuck = 0; }
    this.trail.push([p.x, p.y]); if (this.trail.length > 14) this.trail.shift();
  },
  walls(sp) {
    const p = this.p, R = RINK, pr = R.pr;
    if (p.y < R.y0 + pr) { p.y = R.y0 + pr; p.vy = Math.abs(p.vy) * 0.92; if (sp > 120) SFX.wall(); }
    if (p.y > R.y1 - pr) { p.y = R.y1 - pr; p.vy = -Math.abs(p.vy) * 0.92; if (sp > 120) SFX.wall(); }
    const inMouth = p.y > R.gy0 + 4 && p.y < R.gy1 - 4;
    if (p.x < R.x0 + pr && !inMouth) { p.x = R.x0 + pr; p.vx = Math.abs(p.vx) * 0.92; if (sp > 120) SFX.wall(); }
    if (p.x > R.x1 - pr && !inMouth) { p.x = R.x1 - pr; p.vx = -Math.abs(p.vx) * 0.92; if (sp > 120) SFX.wall(); }
    if (p.x < R.x0 - pr) { this.goal(1); return true; }
    if (p.x > R.x1 + pr) { this.goal(0); return true; }
    return false;
  },
  goal(scorer) {
    this.score[scorer]++; this.scorer = scorer; this.state = 'goal'; this.goalT = 1.6; this.trail = [];
    SFX.goal(); G.shake = 14; burst(scorer === 0 ? RINK.x1 : RINK.x0, (RINK.gy0 + RINK.gy1) / 2, PC[scorer], 50, 600, 8, 1);
    toPlayer(scorer, 'vibe', [80, 50, 80]); toPlayer(1 - scorer, 'vibe', 250);
    this.p.vx = this.p.vy = 0; this.p.x = -999;
  },
  draw() {
    bgGrad('#0f1330', '#05060f');
    const R = RINK, cx = (R.x0 + R.x1) / 2, cy = (R.y0 + R.y1) / 2;
    // מסגרת ושולחן
    rr(R.x0 - 26, R.y0 - 26, R.x1 - R.x0 + 52, R.y1 - R.y0 + 52, 60); ctx.fillStyle = '#23284d'; ctx.fill();
    rr(R.x0 - 26, R.y0 - 26, R.x1 - R.x0 + 52, R.y1 - R.y0 + 52, 60); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.stroke();
    const ice = ctx.createRadialGradient(cx, cy, 50, cx, cy, 800); ice.addColorStop(0, '#f4fbff'); ice.addColorStop(1, '#cfe3f5');
    rr(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0, 40); ctx.fillStyle = ice; ctx.fill();
    // סימונים
    ctx.save(); rr(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0, 40); ctx.clip();
    ctx.fillStyle = 'rgba(255,77,109,.06)'; ctx.fillRect(R.x0, R.y0, cx - R.x0, R.y1 - R.y0);
    ctx.fillStyle = 'rgba(46,197,255,.07)'; ctx.fillRect(cx, R.y0, R.x1 - cx, R.y1 - R.y0);
    ctx.strokeStyle = 'rgba(30,40,90,.35)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(cx, R.y0); ctx.lineTo(cx, R.y1); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 120, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fillStyle = 'rgba(30,40,90,.35)'; ctx.fill();
    for (const [x, i] of [[R.x0, 0], [R.x1, 1]]) { ctx.strokeStyle = PC[i]; ctx.globalAlpha = 0.45; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, cy, 150, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    // נקודות אוויר
    ctx.fillStyle = 'rgba(30,40,90,.08)'; for (let x = R.x0 + 40; x < R.x1; x += 40) for (let y = R.y0 + 40; y < R.y1; y += 40) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    ctx.restore();
    // שערים
    for (const [x, i] of [[R.x0, 0], [R.x1, 1]]) {
      const w = 34; rr(i === 0 ? x - w : x, R.gy0, w, R.gy1 - R.gy0, 10); ctx.fillStyle = '#07081a'; ctx.fill();
      ctx.fillStyle = PC[i]; ctx.fillRect(x - 5, R.gy0 - 12, 10, 16); ctx.fillRect(x - 5, R.gy1 - 4, 10, 16);
    }
    // שובל ודיסקית
    const p = this.p;
    this.trail.forEach(([x, y], k) => { ctx.globalAlpha = (k / this.trail.length) * 0.25; ctx.beginPath(); ctx.arc(x, y, R.pr * (0.4 + 0.6 * k / this.trail.length), 0, Math.PI * 2); ctx.fillStyle = '#1b1f3b'; ctx.fill(); });
    ctx.globalAlpha = 1;
    if (p.x > -100) {
      ctx.beginPath(); ctx.arc(p.x + 4, p.y + 6, R.pr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,30,.2)'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, R.pr, 0, Math.PI * 2); ctx.fillStyle = '#1b1f3b'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, R.pr * 0.62, 0, Math.PI * 2); ctx.strokeStyle = '#3a4070'; ctx.lineWidth = 3; ctx.stroke();
    }
    // מחבטים
    for (const m of this.m) {
      ctx.beginPath(); ctx.arc(m.x + 5, m.y + 8, R.mr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,30,.22)'; ctx.fill();
      ctx.beginPath(); ctx.arc(m.x, m.y, R.mr, 0, Math.PI * 2); ctx.fillStyle = PC_DARK[m.i]; ctx.fill();
      ctx.beginPath(); ctx.arc(m.x, m.y - 3, R.mr - 5, 0, Math.PI * 2); ctx.fillStyle = PC[m.i]; ctx.fill();
      ctx.beginPath(); ctx.arc(m.x, m.y - 6, R.mr * 0.45, 0, Math.PI * 2); ctx.fillStyle = PC_DARK[m.i]; ctx.fill();
      ctx.beginPath(); ctx.arc(m.x - 4, m.y - 10, R.mr * 0.2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fill();
    }
    drawFx();
    // ניקוד
    panel(cx - 170, 18, 340, 70, 35, 'rgba(10,12,30,.85)', 'rgba(255,255,255,.15)');
    txt(String(this.score[0]), cx - 60, 55, 50, PC[0], 'center', 900);
    txt(':', cx, 52, 44, '#fff', 'center', 900);
    txt(String(this.score[1]), cx + 60, 55, 50, PC[1], 'center', 900);
    txt(pname(0), cx - 200, 55, 26, PC[0], 'right', 800);
    txt(pname(1), cx + 200, 55, 26, PC[1], 'left', 800);
    if (this.state === 'intro') { txt('הוקי אוויר', cx, cy - 40, 120, '#1b1f3b', 'center', 900); txt(`גררו את האצבע על הטלפון · ראשון ל־${WIN_GOALS} גולים`, cx, cy + 60, 34, '#3a4070', 'center', 700); }
    if (this.state === 'goal') { const k = 1 + Math.max(0, this.goalT - 1.3) * 2; txt('גול!', cx, cy, 200 * k, PC[this.scorer], 'center', 900, 16); }
    codeBadge();
  },
};

// ============================================================
//  לולאה ראשית
// ============================================================
let last = performance.now(), acc = 0;
const STEP = 1 / 120;
function frame(t) {
  let dt = Math.min(0.1, (t - last) / 1000); last = t;
  if (G.slowT > 0) { G.slowT -= dt; dt *= 0.3; }
  acc += dt;
  while (acc >= STEP) { if (G.scene) G.scene.update(STEP); updFx(STEP); acc -= STEP; }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, cv.width, cv.height);
  const sx = G.shake ? rnd(-G.shake, G.shake) : 0, sy = G.shake ? rnd(-G.shake, G.shake) : 0;
  ctx.setTransform(S, 0, 0, S, OX + sx * S, OY + sy * S);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, VW, VH); ctx.clip();
  if (G.scene) G.scene.draw();
  if (G.sceneName === 'menu' || G.sceneName === 'results') drawFx();
  ctx.restore();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__zira = { G, inp, startGame };
})();
