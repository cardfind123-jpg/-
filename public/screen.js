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
// 4 צבעי שחקנים לפי המקום בחדר
const COL = ['#ff4d6d', '#2ec5ff', '#5eea7a', '#c084fc'];
const COL_DARK = ['#9e1d3a', '#0b6a96', '#1f8a3e', '#6d28d9'];
// "מושבים": במשחקי 1 על 1 עם 3–4 שחקנים, אינדקס 0/1 במשחק ממופה למקום אמיתי בחדר (המלך נשאר, המפסיד לסוף התור)
const sl = (i) => (G.seat ? G.seat[i] : i);
function seatView(get, set) { const o = []; for (let k = 0; k < 4; k++) Object.defineProperty(o, k, { get: () => get(sl(k)), set: set ? (v) => set(sl(k), v) : undefined, enumerable: true }); return o; }
const PC = seatView((s) => COL[s] || '#fff'), PC_DARK = seatView((s) => COL_DARK[s] || '#333');
const GOLD = '#ffd60a';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const wrapAng = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
function seeded(s) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

const G = { code: null, room: [null, null, null, null], wins: [0, 0, 0, 0], queue: [], seat: null, pro: false, scene: null, sceneName: '', slowT: 0, shake: 0, t: 0 };
function mkInp() { return { steer: 0, gas: false, brake: false, x: 0.5, y: 0.5, down: false, block: false, jx: 0, jy: 0, l: false, r: false }; }
const rawInp = [mkInp(), mkInp(), mkInp(), mkInp()];
const inp = seatView((s) => rawInp[s] || mkInp(), (s, v) => { rawInp[s] = v; });
const isBot = (i) => !G.room[sl(i)];
const pname = (i) => (G.room[sl(i)] ? G.room[sl(i)].name : 'המחשב');
const nPlayers = () => G.room.filter(Boolean).length;
// משתתפים במשחק מרובה שחקנים: כל מי שבחדר, ולפחות minN (משלימים עם המחשב)
function seatsFor(minN = 2) {
  const s = []; for (let i = 0; i < 4; i++) if (G.room[i]) s.push(i);
  for (let i = 0; s.length < minN && i < 4; i++) if (!s.includes(i)) s.push(i);
  return s.sort((a, b) => a - b);
}

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
  G.sceneName = name; G.scene = sc; parts.length = 0; floats.length = 0;
  if (sc.enter) sc.enter();
  socket.emit('host:state', Object.assign({ mode: name, seat: G.seat ? G.seat.slice() : null, pro: G.pro }, sc.stateExtra || {}));
}
function pushState() { if (G.scene) socket.emit('host:state', Object.assign({ mode: G.sceneName, seat: G.seat ? G.seat.slice() : null, pro: G.pro }, G.scene.stateExtra || {})); }
function toPlayer(i, ev, d) { const slot = sl(i); if (G.room[slot]) socket.emit('host:to', { slot, ev, d }); }

const qrImg = new Image();
function loadQR() { qrImg.src = '/qr?u=' + encodeURIComponent(location.origin + '/play?c=' + G.code); }

socket.on('connect', () => {
  socket.emit('host:create', (r) => {
    G.code = r.code; G.room = [null, null, null, null]; G.queue = []; G.pro = !!r.pro; loadQR(); setScene('menu', Menu);
  });
});
socket.on('room:pro', ({ pro }) => { if (pro && !G.pro) { G.pro = true; SFX.win(); floatText('זירה פרו פעיל!', VW / 2, 300, GOLD, 60); if (G.sceneName === 'menu') setScene('menu', Menu); } });
socket.on('player:away', ({ slot }) => { if (G.room[slot]) G.room[slot].away = true; rawInp[slot] = mkInp(); });
socket.on('player:joined', ({ slot, name, back, pro }) => {
  G.room[slot] = { name, pro: !!pro }; rawInp[slot] = mkInp(); SFX.join();
  if (!G.queue.includes(slot)) G.queue.push(slot);
  if (back) { if (G.scene && G.scene.onBack) G.scene.onBack(slot); return; }
  if (G.sceneName === 'menu') { const c = slotRect(slot); burst(c.x + c.w / 2, c.y + c.h / 2, COL[slot], 30, 400, 7, 0.8); }
  else if (G.scene && G.scene.onJoin) G.scene.onJoin(slot);
  else if (G.sceneName !== 'results') floatText(`${name} הצטרף/ה · משחק הבא`, VW / 2, VH - 90, COL[slot], 30);
});
socket.on('player:left', ({ slot }) => { G.room[slot] = null; rawInp[slot] = mkInp(); G.queue = G.queue.filter((q) => q !== slot); });
socket.on('axis', ({ slot, d }) => {
  const p = rawInp[slot]; if (!p || !d) return;
  if (typeof d.steer === 'number' && isFinite(d.steer)) p.steer = clamp(d.steer, -1, 1);
  if ('gas' in d) p.gas = !!d.gas;
  if ('brake' in d) p.brake = !!d.brake;
  if (typeof d.x === 'number' && isFinite(d.x)) p.x = clamp(d.x, 0, 1);
  if (typeof d.y === 'number' && isFinite(d.y)) p.y = clamp(d.y, 0, 1);
  if ('down' in d) p.down = !!d.down;
  if (typeof d.jx === 'number' && isFinite(d.jx)) p.jx = clamp(d.jx, -1, 1);
  if (typeof d.jy === 'number' && isFinite(d.jy)) p.jy = clamp(d.jy, -1, 1);
  if ('l' in d) p.l = !!d.l;
  if ('r' in d) p.r = !!d.r;
});
socket.on('input', ({ slot, d }) => {
  if (!d || !G.scene) return;
  if (d.t === 'quit') { if (G.sceneName !== 'menu') { G.seat = null; setScene('menu', Menu); } return; }
  const gi = G.seat ? G.seat.indexOf(slot) : slot;   // צופה שלא משחק כרגע – רק יציאה
  if (gi < 0) return;
  if (G.scene.onInput) G.scene.onInput(gi, d);
});

// ---------------- מקלדת ועכבר במסך ----------------
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && G.sceneName !== 'menu') { G.seat = null; setScene('menu', Menu); }
  if (G.sceneName === 'menu' && /^[1-9]$/.test(e.key) && GAMES[+e.key - 1]) startGame(GAMES[+e.key - 1].id);
  if (G.sceneName === 'menu' && (e.key === 't' || e.key === 'T' || e.key === 'א')) startTour();
  if (G.sceneName === 'results' && (e.key === 'Enter' || e.key === ' ')) Results.advance();
});
cv.addEventListener('pointerdown', (e) => {
  const x = (e.clientX * (cv.width / innerWidth) - OX) / S, y = (e.clientY * (cv.height / innerHeight) - OY) / S;
  const inR = (c) => x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h;
  if (G.sceneName === 'menu') { GAMES.forEach((g, i) => { if (inR(cardRect(i))) startGame(g.id); }); if (inR(TOUR_RECT)) startTour(); }
  else if (G.sceneName === 'results' && Results.t > 0.8) Results.advance();
  else if (G.scene && G.scene.onClick) G.scene.onClick(x, y);
});

// ============================================================
//  תפריט / לובי
// ============================================================
// max: כמה שחקנים המשחק תומך. במשחקי 1 על 1 עם 3–4 בחדר – "מלך הזירה": המנצח נשאר, הבא בתור נכנס.
const GAMES = [
  { id: 'race', name: 'מרוץ', desc: 'הטו את הטלפון כמו הגה', col: '#ffb703', max: 2 },
  { id: 'box', name: 'אגרוף', desc: 'ג׳אב, הוק, בלוק, נוקאאוט', col: '#ff4d6d', max: 2 },
  { id: 'hockey', name: 'הוקי אוויר', desc: 'גררו ותבקיעו', col: '#2ec5ff', max: 2 },
  { id: 'soccer', name: 'כדורגל ראשים', desc: 'נגיחות ובעיטות', col: '#6bff8a', max: 2 },
  { id: 'tanks', name: 'טנקים', desc: 'פגזים קופצים מהקירות', col: '#a3e635', max: 2 },
  { id: 'volley', name: 'כדורעף', desc: 'קפיצות והנחתות', col: '#facc15', max: 2 },
  { id: 'sumo', name: 'סומו', desc: 'דחפו את היריב מהזירה', col: '#fb923c', max: 2 },
  { id: 'bomb', name: 'פצצה חמה', desc: 'תעבירו לפני הפיצוץ', col: '#f87171', max: 2 },
  { id: 'heist', name: 'שוד הכספת', desc: 'כל אחד רואה רמז אחר', col: '#fde047', max: 4, pro: true, coop: true },
  { id: 'space', name: 'קרב חלליות', desc: 'גלי אויבים ובוס ענק', col: '#38bdf8', max: 4, pro: true },
  { id: 'kitchen', name: 'המטבח המטורף', desc: 'חותכים, מבשלים, מגישים', col: '#fdba74', max: 4, pro: true, coop: true },
  { id: 'collapse', name: 'הרצפה קורסת', desc: 'מי שנופל – הופך לרוח', col: '#f472b6', max: 4, pro: true },
  { id: 'paint', name: 'צבע טריטוריה', desc: 'תפסו הכי הרבה שטח', col: '#a78bfa', max: 4, pro: true },
];
const gameInfo = (id) => GAMES.find((g) => g.id === id) || {};
const gameName = (id) => gameInfo(id).name || '';
const locked = (id) => !!gameInfo(id).pro && !G.pro;
const CW = 185, CH = 142, CGX = 14, CGY = 12;
function cardRect(i) { const col = i % 5, row = Math.floor(i / 5); return { x: 60 + (4 - col) * (CW + CGX), y: 312 + row * (CH + CGY), w: CW, h: CH }; }
const TOUR_RECT = { x: 60, y: 312 + 2 * (CH + CGY), w: CW * 2 + CGX, h: CH };
function slotRect(i) { return { x: 60 + (3 - i) * 249, y: 180, w: 235, h: 112 }; }
function seat1v1() {
  const q = G.queue.filter((s) => G.room[s]);
  const pick = q.slice(0, 2);
  for (let i = 0; pick.length < 2 && i < 4; i++) if (!pick.includes(i) && !G.room[i]) pick.push(i);
  G.seat = q.length >= 3 ? pick : pick.sort((a, b) => a - b);
}
function startGame(id) {
  const map = { race: Race, box: Box, hockey: Hockey, soccer: Soccer, tanks: Tanks, volley: Volley, sumo: Sumo, bomb: Bomb, space: Space, collapse: Collapse, paint: Paint, kitchen: Kitchen, heist: Heist };
  if (id === 'tour') return startTour();
  if (!map[id]) return;
  if (locked(id)) { G.seat = null; if (G.sceneName !== 'menu') setScene('menu', Menu); Menu.promoT = 4; Menu.promoGame = id; SFX.block(); return; }
  if (gameInfo(id).max === 2) seat1v1(); else G.seat = null;
  setScene(id, map[id]);
}
function startTour() {
  const ids = GAMES.filter((g) => !locked(g.id)).map((g) => g.id).sort(() => Math.random() - 0.5).slice(0, 5);
  G.tour = { list: ids, k: 0, pts: [0, 0, 0, 0] };
  startGame(ids[0]);
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
  } else if (id === 'hockey') {
    ctx.beginPath(); ctx.ellipse(-26, 18, 34, 14, 0, 0, Math.PI * 2); ctx.fillStyle = '#20243f'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(-26, 12, 34, 14, 0, 0, Math.PI * 2); ctx.fillStyle = '#3a3f66'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(26, -4, 38, 22, 0, 0, Math.PI * 2); ctx.fillStyle = '#0b6a96'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(26, -10, 38, 22, 0, 0, Math.PI * 2); ctx.fillStyle = '#2ec5ff'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(26, -22, 16, 12, 0, 0, Math.PI * 2); ctx.fillStyle = '#e8f8ff'; ctx.fill();
  } else if (id === 'soccer') {
    ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = '#1b1f3b';
    polygon(0, 0, 14, 5, -Math.PI / 2); ctx.fill();
    for (let j = 0; j < 5; j++) { const a = -Math.PI / 2 + j * Math.PI * 2 / 5; polygon(Math.cos(a) * 36, Math.sin(a) * 36, 12, 5, a + Math.PI / 2); ctx.fill(); }
    ctx.restore(); ctx.lineWidth = 3; ctx.strokeStyle = '#1b1f3b'; ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.stroke();
  } else if (id === 'tanks') {
    ctx.rotate(-0.35);
    ctx.fillStyle = '#1d1f1a'; rr(-42, -36, 84, 18, 6); ctx.fill(); rr(-42, 18, 84, 18, 6); ctx.fill();
    rr(-34, -24, 68, 48, 10); ctx.fillStyle = '#a3e635'; ctx.fill();
    rr(8, -7, 52, 14, 4); ctx.fillStyle = '#4d7c0f'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
  } else if (id === 'volley') {
    ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.ellipse(-22, 0, 22, 48, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.ellipse(26, -10, 18, 44, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); ctx.lineWidth = 3; ctx.strokeStyle = '#1b1f3b'; ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.stroke();
  } else if (id === 'sumo') {
    ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.fillStyle = '#ead7a8'; ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = '#bfa064'; ctx.stroke();
    ctx.beginPath(); ctx.arc(-16, 4, 17, 0, Math.PI * 2); ctx.fillStyle = PC[0]; ctx.fill();
    ctx.beginPath(); ctx.arc(17, -4, 17, 0, Math.PI * 2); ctx.fillStyle = PC[1]; ctx.fill();
  } else if (id === 'bomb') {
    ctx.beginPath(); ctx.arc(0, 8, 38, 0, Math.PI * 2); ctx.fillStyle = '#1b1b24'; ctx.fill();
    ctx.beginPath(); ctx.arc(-12, -4, 10, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fill();
    ctx.fillStyle = '#555'; ctx.fillRect(-9, -38, 18, 12);
    ctx.strokeStyle = '#c9a46b'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, -38); ctx.quadraticCurveTo(14, -52, 24, -48); ctx.stroke();
    ctx.fillStyle = GOLD; star(26, -48, 14, 5, 6); ctx.fill();
  } else drawIconPro(id);
  ctx.restore();
}
function polygon(x, y, r, n, rot = 0) { ctx.beginPath(); for (let j = 0; j < n; j++) { const a = rot + j * Math.PI * 2 / n; j ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); }
function star(x, y, r1, r2, n) { ctx.beginPath(); for (let j = 0; j < n * 2; j++) { const a = -Math.PI / 2 + j * Math.PI / n, r = j % 2 ? r2 : r1; j ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); }

const Menu = {
  enter() { this.t = 0; G.tour = null; G.seat = null; },
  update(dt) { this.t += dt; this.promoT = Math.max(0, (this.promoT || 0) - dt); },
  onInput(slot, d) { if (d.t === 'menu') startGame(d.g); },
  draw() {
    bgGrad('#14183a', '#07081a');
    for (let i = 0; i < 9; i++) {
      const x = (i * 211 + this.t * (12 + i * 3)) % (VW + 300) - 150, y = 120 + ((i * 137) % 700);
      ctx.beginPath(); ctx.arc(x, y, 60 + (i % 3) * 40, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? 'rgba(255,77,109,.05)' : 'rgba(46,197,255,.05)'; ctx.fill();
    }
    const tg = ctx.createLinearGradient(600, 0, 1000, 0); tg.addColorStop(0, COL[1]); tg.addColorStop(1, COL[0]);
    txt('זירה', VW / 2, 74, 100, tg, 'center', 900);
    if (G.pro) { panel(VW / 2 + 128, 50, 92, 40, 20, 'rgba(255,214,10,.16)', GOLD); txt('פרו', VW / 2 + 174, 71, 24, GOLD, 'center', 900); }
    txt(`המסך הוא הזירה · הטלפונים הם השלטים · ${GAMES.length} משחקים`, VW / 2, 140, 26, '#a9afd8', 'center', 600);

    // שחקנים
    for (let i = 0; i < 4; i++) {
      const { x, y, w, h } = slotRect(i), pl = G.room[i], on = !!pl, lock = i >= 2 && !G.pro;
      panel(x, y, w, h, 20, on ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.25)', on ? COL[i] : 'rgba(255,255,255,.1)');
      ctx.beginPath(); ctx.arc(x + w - 40, y + h / 2, 26, 0, Math.PI * 2);
      ctx.fillStyle = on ? COL[i] : 'rgba(255,255,255,.08)'; ctx.fill();
      txt(lock ? '🔒' : String(i + 1), x + w - 40, y + h / 2 + 2, lock ? 22 : 28, on ? '#fff' : 'rgba(255,255,255,.3)', 'center', 900);
      const tx = x + w - 78;
      if (on) {
        txt(pl.name, tx, y + 40, 26, '#fff', 'right', 800);
        txt(pl.away ? 'מתחבר מחדש…' : `ניצחונות: ${G.wins[i]}`, tx, y + 76, 18, pl.away ? GOLD : '#a9afd8', 'right', 600);
      } else if (lock) {
        txt('זירה פרו', tx, y + 40, 24, GOLD, 'right', 800);
        txt(`שחקן ${i + 1} נפתח בפרו`, tx, y + 76, 16, '#7d84b3', 'right', 600);
      } else {
        ctx.globalAlpha = 0.45 + 0.35 * Math.sin(this.t * 3 + i); txt('ממתין…', tx, y + 40, 24, '#fff', 'right', 700); ctx.globalAlpha = 1;
        txt(i < 2 ? 'בינתיים המחשב ישחק' : 'אפשר להצטרף', tx, y + 76, 16, '#7d84b3', 'right', 600);
      }
    }
    // משחקים
    GAMES.forEach((g, i) => {
      const c = cardRect(i), bob = Math.sin(this.t * 2 + i * 0.8) * 2.5, lk = locked(g.id);
      panel(c.x, c.y + bob, c.w, c.h, 20, g.pro ? 'rgba(255,214,10,.06)' : 'rgba(255,255,255,.06)', g.col);
      if (i < 9) txt(String(i + 1), c.x + c.w - 18, c.y + 20 + bob, 16, g.col, 'center', 900);
      if (g.pro) { panel(c.x + 10, c.y + 9 + bob, 58, 24, 12, 'rgba(255,214,10,.18)', GOLD); txt(lk ? '🔒 פרו' : 'פרו', c.x + 39, c.y + 22 + bob, 14, GOLD, 'center', 800); }
      ctx.globalAlpha = lk ? 0.45 : 1;
      drawIcon(g.id, c.x + c.w / 2, c.y + 56 + bob, 0.58);
      txt(g.name, c.x + c.w / 2, c.y + 104 + bob, 24, '#fff', 'center', 900);
      txt(g.desc, c.x + c.w / 2, c.y + 128 + bob, 14, '#a9afd8', 'center', 600);
      ctx.globalAlpha = 1;
    });
    const T = TOUR_RECT, glow = 0.5 + 0.5 * Math.sin(this.t * 3);
    panel(T.x, T.y, T.w, T.h, 20, `rgba(255,214,10,${0.08 + glow * 0.06})`, GOLD);
    txt('🏆 טורניר', T.x + T.w / 2, T.y + 52, 38, GOLD, 'center', 900);
    txt('5 משחקים אקראיים · מי שמנצח הכי הרבה – אלוף', T.x + T.w / 2, T.y + 98, 17, '#e9dca0', 'center', 700);
    txt('בחרו בטלפון, או לחצו על כרטיס', 551, 796, 19, '#7d84b3', 'center', 600);
    if (!G.pro) {
      panel(160, 822, 782, 52, 26, 'rgba(255,214,10,.08)', 'rgba(255,214,10,.45)');
      txt('זירה פרו: עד 4 שחקנים · 5 משחקי פרו · בלי פרסומות — פותחים מהטלפון', 551, 848, 20, GOLD, 'center', 700);
    }

    // הצטרפות
    panel(1080, 180, 460, 694);
    txt('הצטרפו מהטלפון', 1310, 222, 32, '#fff', 'center', 900);
    rr(1195, 256, 230, 230, 18); ctx.fillStyle = '#fff'; ctx.fill();
    if (qrImg.complete && qrImg.naturalWidth) ctx.drawImage(qrImg, 1203, 264, 214, 214);
    txt('סרקו, או היכנסו לכתובת:', 1310, 518, 20, '#a9afd8', 'center', 600);
    txt(location.host + '/play', 1310, 550, location.host.length > 22 ? 20 : 24, '#fff', 'center', 700);
    txt('קוד החדר', 1310, 600, 20, '#a9afd8', 'center', 600);
    const code = G.code || '····';
    for (let i = 0; i < 4; i++) {
      const x = 1310 + (i - 1.5) * 84;
      rr(x - 35, 622, 70, 64, 14); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.stroke();
      txt(code[i], x, 656, 46, GOLD, 'center', 900);
    }
    txt(G.pro ? 'עד 4 שחקנים' : 'עד 2 שחקנים · 4 בפרו', 1310, 736, 22, '#c9cdf0', 'center', 700);
    txt('לבד? המחשב משחק נגדכם', 1310, 770, 20, '#7d84b3', 'center', 600);
    txt(nPlayers() > 2 ? 'במשחקי 1 על 1: המנצח נשאר, הבא בתור נכנס' : 'משחקי פרו: עד 4 ביחד', 1310, 812, 17, '#7d84b3', 'center', 600);

    if (this.promoT > 0) {
      ctx.globalAlpha = clamp(this.promoT * 2, 0, 1);
      ctx.fillStyle = 'rgba(5,6,15,.78)'; ctx.fillRect(0, 0, VW, VH);
      panel(400, 270, 800, 360, 30, '#161a38', GOLD);
      drawIcon(this.promoGame, VW / 2, 350, 0.9);
      txt(`"${gameName(this.promoGame)}" הוא משחק של זירה פרו`, VW / 2, 440, 38, '#fff', 'center', 900);
      txt('פרו פותח 5 משחקים נוספים, עד 4 שחקנים ובלי פרסומות', VW / 2, 494, 24, '#c9cdf0', 'center', 600);
      txt('בטלפון: כפתור "זירה פרו" בתפריט', VW / 2, 560, 26, GOLD, 'center', 800);
      txt('שחקן אחד שקנה – כל החדר נהנה', VW / 2, 600, 20, '#a9afd8', 'center', 600);
      ctx.globalAlpha = 1;
    }
  },
};

// ============================================================
//  תוצאות
// ============================================================
const Results = {
  enter() { this.t = 0; },
  update(dt) {
    this.t += dt;
    const w = this.final ? this.champ : this.w;
    const cc = w >= 0 ? COL[w] : GOLD;
    if ((w >= 0 || this.ok) && Math.random() < (this.final ? 0.9 : 0.6)) parts.push({ x: rnd(0, VW), y: -10, vx: rnd(-60, 60), vy: rnd(150, 320), g: 120, life: 4, max: 4, col: Math.random() < 0.5 ? cc : GOLD, size: rnd(4, 8) });
    if (this.t > (this.final ? 20 : 15)) this.advance();
  },
  advance() {
    if (G.tour && !this.final) startGame(G.tour.list[G.tour.k]);
    else setScene('menu', Menu);
  },
  onInput(slot, d) {
    if (this.t < 0.8) return;
    if (d.t === 'again') { if (G.tour) this.advance(); else startGame(this.game); }
    else if (d.t === 'next') this.advance();
    else if (d.t === 'menu' && !G.tour) startGame(d.g);
  },
  draw() {
    bgGrad('#14183a', '#07081a');
    const w = this.final ? this.champ : this.w;
    const col = w >= 0 ? COL[w] : this.coop ? (this.ok ? GOLD : '#c9cdf0') : '#fff';
    const pop = 1 + Math.max(0, 0.4 - this.t) * 1.5;
    ctx.save(); ctx.translate(VW / 2, 250); ctx.scale(pop * (this.final ? 1.25 : 1), pop * (this.final ? 1.25 : 1));
    if (this.coop && !this.ok && !this.final) ctx.globalAlpha = 0.35;
    ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.moveTo(-80, -90); ctx.lineTo(80, -90); ctx.quadraticCurveTo(76, 20, 0, 40); ctx.quadraticCurveTo(-76, 20, -80, -90); ctx.fill();
    ctx.lineWidth = 14; ctx.strokeStyle = GOLD;
    ctx.beginPath(); ctx.arc(-84, -50, 34, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(84, -50, 34, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
    ctx.fillRect(-14, 38, 28, 40); rr(-60, 74, 120, 26, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(-36, -50, 12, 30, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
    const nm = (s) => (G.room[s] ? G.room[s].name : 'המחשב');
    if (this.final) {
      txt('סוף הטורניר!', VW / 2, 420, 40, GOLD, 'center', 800, 6);
      txt(w >= 0 ? `${nm(w)} אלוף/ת הטורניר!` : 'תיקו בטורניר!', VW / 2, 490, 86 * pop, col, 'center', 900, 10);
    } else {
      const title = this.coop ? (this.ok ? 'הצוות ניצח!' : 'הפעם לא הצליח…') : w >= 0 ? `${nm(w)} ניצח/ה!` : 'תיקו!';
      txt(title, VW / 2, 450, 90 * pop, col, 'center', 900, 10);
      if (this.sub) txt(this.sub, VW / 2, 528, 30, '#c9cdf0', 'center', 700);
      if (this.tour) txt(`טורניר · אחרי ${this.tour.k} מתוך ${this.tour.n} · הבא: ${gameName(G.tour.list[G.tour.k])}`, VW / 2, 578, 24, GOLD, 'center', 700);
    }
    const L = this.slots, n = L.length, pw = Math.min(300, (VW - 240) / n - 20), gap = 20, tot = n * pw + (n - 1) * gap;
    L.forEach((s, k) => {
      const x = VW / 2 + tot / 2 - (k + 1) * pw - k * gap;
      panel(x, 620, pw, 112, 22, 'rgba(255,255,255,.06)', COL[s]);
      txt(nm(s), x + pw / 2, 650, 26, COL[s], 'center', 800);
      txt(this.tour ? `${this.tour.pts[s]} נק׳ בטורניר` : `${G.wins[s]} ניצחונות`, x + pw / 2, 694, 22, '#fff', 'center', 700);
    });
    txt(this.tour ? (this.final ? 'בטלפון: "לתפריט המשחקים"' : 'בטלפון: "למשחק הבא"') : 'בטלפון: "עוד סיבוב" או "לתפריט"', VW / 2, 786, 24, '#a9afd8', 'center', 600);
    if (this.queueNext) txt(this.queueNext, VW / 2, 826, 22, '#c9cdf0', 'center', 700);
    if (!G.pro) txt('זירה פרו: 4 שחקנים · 5 משחקי פרו · בלי פרסומות', VW / 2, 866, 18, GOLD, 'center', 700);
  },
};
// w = אינדקס במשחק (מושב) או -1 לתיקו. opt: { coop, ok, slots }
function showResults(w, sub, game, opt = {}) {
  const ws = w >= 0 ? sl(w) : -1;
  const slots = G.seat ? G.seat.slice() : (opt.slots || seatsFor(2));
  let queueNext = '';
  // מלך הזירה: המפסיד עובר לסוף התור, המנצח נשאר
  if (G.seat && G.queue.filter((s) => G.room[s]).length > 2) {
    const loser = ws >= 0 ? G.seat.find((s) => s !== ws) : G.seat[1];
    const keep = ws >= 0 ? ws : G.seat[0];
    G.queue = [keep, ...G.queue.filter((q) => q !== keep && q !== loser), loser].filter((q) => q != null);
    const nxt = G.queue.filter((s) => G.room[s])[1];
    if (nxt != null) queueNext = `בסיבוב הבא: ${G.room[keep] ? G.room[keep].name : 'המחשב'} נגד ${G.room[nxt].name}`;
  }
  G.seat = null;
  if (ws >= 0) G.wins[ws]++;
  if (opt.coop && opt.ok) slots.forEach((s) => { if (G.room[s]) G.wins[s]++; });
  let final = false, champ = -1, tour = null;
  if (G.tour) {
    const p = G.tour.pts;
    if (ws >= 0) p[ws] += 1;
    if (opt.coop && opt.ok) slots.forEach((s) => (p[s] += 1));
    G.tour.k++;
    final = G.tour.k >= G.tour.list.length;
    if (final) {
      const cand = [0, 1, 2, 3].filter((s) => G.room[s] || p[s] > 0), best = Math.max(...cand.map((s) => p[s]));
      const top = cand.filter((s) => p[s] === best); champ = top.length === 1 ? top[0] : -1;
    }
    tour = { k: G.tour.k, n: G.tour.list.length, pts: p.slice() };
  }
  const shown = final ? [0, 1, 2, 3].filter((s) => G.room[s] || slots.includes(s)) : slots;
  Object.assign(Results, { w: ws, sub, game, final, champ, tour, coop: !!opt.coop, ok: !!opt.ok, slots: shown, queueNext });
  Results.stateExtra = { w: ws, coop: !!opt.coop, ok: !!opt.ok, final, champ, tour, slots: shown, next: tour && !final ? gameName(G.tour.list[G.tour.k]) : '' };
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
  return { i, x: p[0] + nx * off, y: p[1] + ny * off, a, v: 0, idx, prog: -9, lap: 0, done: false, time: 0, off: false, bump: 0, boost: 0.6, boostT: 0, sentB: -1 };
}
function raceAI(c) {
  const N = TRACK.N, look = Math.round(10 + Math.abs(c.v) / 35), t = TRACK.pts[(c.idx + look) % N], t2 = TRACK.pts[(c.idx + look + 1) % N];
  const ta = Math.atan2(t2[1] - t[1], t2[0] - t[0]), lane = c.i ? 22 : -22, tx = t[0] - Math.sin(ta) * lane, ty = t[1] + Math.cos(ta) * lane;
  const want = Math.atan2(ty - c.y, tx - c.x), diff = wrapAng(want - c.a);
  return [clamp(diff * (c.i ? 2.2 : 2.6), -1, 1), c.v < (c.i ? 455 : 480), Math.abs(diff) > 0.85 && c.v > 300];
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const Race = {
  enter() {
    if (!TRACK.pts) buildTrack();
    this.cars = [mkCar(0), mkCar(1)]; this.state = 'count'; this.count = 3.6; this.lastBeep = 4;
    this.raceT = 0; this.finish = []; this.endT = 0; this.goT = 0; this.skids = [];
  },
  onInput(slot, d) { if (d.t === 'boost') this.useBoost(this.cars[slot]); },
  useBoost(c) {
    if (!c || this.state === 'count' || c.done || c.boost < 1) return;
    c.boost = 0; c.boostT = 1.4; tone(260, 0.6, 'sawtooth', 0.06, 600); toPlayer(c.i, 'vibe', [30, 30, 30]);
    floatText('טורבו!', c.x, c.y - 50, GOLD, 34);
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
      if (racing && !c.done) c.boost = Math.min(1, c.boost + dt / 8);
      if (isBot(c.i) && c.boost >= 1 && Math.abs(steer) < 0.15 && c.v > 300) this.useBoost(c);
      c.boostT = Math.max(0, c.boostT - dt);
      const bq = Math.floor(c.boost * 10); if (bq !== c.sentB) { c.sentB = bq; toPlayer(c.i, 'boost', { v: c.boost }); }
      const max = c.off ? 220 : c.boostT > 0 ? 780 : 540;
      if (gas) c.v += 470 * dt;
      if (c.boostT > 0) { c.v += 900 * dt; for (let k = 0; k < 2; k++) parts.push({ x: c.x - Math.cos(c.a) * 26, y: c.y - Math.sin(c.a) * 26, vx: -Math.cos(c.a) * 200 + rnd(-40, 40), vy: -Math.sin(c.a) * 200 + rnd(-40, 40), life: 0.3, max: 0.3, col: Math.random() < 0.5 ? '#ffb703' : '#ff5e3a', size: rnd(4, 8), g: 0 }); }
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
      A.v -= A.v * 0.6 * (1 / 120); B.v -= B.v * 0.6 * (1 / 120);
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
      bar(x + 24, 62, 110, 9, Math.max(0, c.v) / 780, PC[i]);
      bar(x + 24, 76, 110, 6, c.boost, c.boost >= 1 ? GOLD : 'rgba(255,214,10,.5)');
      txt(`${Math.round(Math.max(0, c.v) / 3)} קמ״ש`, x + 79, 42, 18, '#c9cdf0', 'center', 700);
    }
    if (this.raceT > 0) txt(fmtTime(this.raceT), VW / 2, 50, 30, '#fff', 'center', 800, 6);
    if (this.state === 'count') {
      const c = Math.ceil(this.count), f = this.count - Math.floor(this.count);
      if (c <= 3) txt(String(c), VW / 2, VH / 2, 200 * (0.8 + f * 0.4), GOLD, 'center', 900, 16);
      else txt('היכונו…', VW / 2, VH / 2, 110, '#fff', 'center', 900, 14);
      txt('הטו את הטלפון כדי לנווט · "גז" לנסיעה · "טורבו" כשהוא מלא', VW / 2, VH / 2 + 150, 30, '#fff', 'center', 700, 8);
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
//  עזרים משותפים למשחקי סבבים
// ============================================================
function scoreTop(score, extra) {
  const cx = VW / 2;
  panel(cx - 170, 18, 340, 70, 35, 'rgba(10,12,30,.85)', 'rgba(255,255,255,.15)');
  txt(String(score[0]), cx - 60, 55, 50, PC[0], 'center', 900);
  txt(':', cx, 52, 44, '#fff', 'center', 900);
  txt(String(score[1]), cx + 60, 55, 50, PC[1], 'center', 900);
  txt(pname(0), cx - 200, 55, 26, PC[0], 'right', 800, 5);
  txt(pname(1), cx + 200, 55, 26, PC[1], 'left', 800, 5);
  if (extra) txt(extra, cx, 104, 18, '#e3e6ff', 'center', 700, 5);
}
function banner(title, sub, col = '#fff', size = 130) {
  txt(title, VW / 2, VH / 2 - 30, size, col, 'center', 900, 14);
  if (sub) txt(sub, VW / 2, VH / 2 + 70, 30, '#fff', 'center', 700, 8);
}
// מהלך סבבים: intro → play → roundEnd → (סבב הבא | תוצאות)
function rounds(sc, dt, target, game) {
  if (sc.state === 'intro') { sc.it -= dt; if (sc.it <= 0) { sc.state = 'play'; SFX.go(); if (sc.onPlay) sc.onPlay(); } }
  else if (sc.state === 'roundEnd') {
    sc.rt -= dt;
    if (sc.rt <= 0) {
      if (Math.max(sc.score[0], sc.score[1]) >= target) { const w = sc.score[0] > sc.score[1] ? 0 : 1; showResults(w, `${sc.score[w]} : ${sc.score[1 - w]} בסיבובים`, game); }
      else { sc.round++; sc.reset(); sc.state = 'intro'; sc.it = 1.5; }
    }
  }
}
function endRound(sc, winner, msg) {
  if (sc.state !== 'play') return;
  sc.state = 'roundEnd'; sc.rt = 2.4; sc.roundWinner = winner; sc.roundMsg = msg || '';
  if (winner >= 0) { sc.score[winner]++; toPlayer(winner, 'vibe', [80, 40, 80]); SFX.goal(); }
  else tone(260, 0.5, 'triangle', 0.08);
}
function roundOverlay(sc, title, sub) {
  if (sc.state === 'intro') {
    if (sc.round === 1) banner(title, sub, '#fff', 120);
    else banner(`סיבוב ${sc.round}`, '', '#fff', 120);
  } else if (sc.state === 'roundEnd') {
    if (sc.roundWinner >= 0) banner(`${pname(sc.roundWinner)} לוקח/ת את הסיבוב!`, sc.roundMsg, PC[sc.roundWinner], 76);
    else banner('תיקו בסיבוב!', sc.roundMsg, '#fff', 90);
  }
}
function circRect(cx, cy, r, R) {
  const nx = clamp(cx, R[0], R[0] + R[2]), ny = clamp(cy, R[1], R[1] + R[3]);
  const dx = cx - nx, dy = cy - ny, d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 < 1e-6) {
    const l = cx - R[0], rt = R[0] + R[2] - cx, t = cy - R[1], b = R[1] + R[3] - cy, m = Math.min(l, rt, t, b);
    if (m === l) return [-(l + r), 0]; if (m === rt) return [rt + r, 0]; if (m === t) return [0, -(t + r)]; return [0, b + r];
  }
  const d = Math.sqrt(d2), k = (r - d) / d;
  return [dx * k, dy * k];
}
const stickOf = (i) => [inp[i].jx || 0, inp[i].jy || 0];

// ============================================================
//  משחק 4: טנקים
// ============================================================
const TA = { x0: 60, y0: 126, x1: 1540, y1: 858 };
const TWALLS = [[740, 432, 120, 120], [420, 222, 50, 180], [420, 582, 50, 180], [1130, 222, 50, 180], [1130, 582, 50, 180], [620, 242, 360, 40], [620, 702, 360, 40]];
const TANK_R = 28, TANK_HP = 3, TANK_WIN = 3;
function clearLine(x1, y1, x2, y2) {
  const d = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(d / 18);
  for (let k = 1; k < n; k++) {
    const x = x1 + (x2 - x1) * k / n, y = y1 + (y2 - y1) * k / n;
    for (const w of TWALLS) if (x > w[0] - 6 && x < w[0] + w[2] + 6 && y > w[1] - 6 && y < w[1] + w[3] + 6) return false;
  }
  return true;
}
const Tanks = {
  enter() { this.score = [0, 0]; this.round = 1; this.reset(); this.state = 'intro'; this.it = 2.8; },
  reset() {
    this.t = [0, 1].map((i) => ({ i, x: i ? 1440 : 160, y: 492, a: i ? Math.PI : 0, hp: TANK_HP, cd: 0, inv: 0, fire: false, dead: false, recoil: 0, ai: { t: 0, sx: 0, sy: 0, aimT: 0 } }));
    this.bullets = []; this.wreck = [];
  },
  onInput(slot, d) { if (d.t === 'act' && this.t[slot]) this.t[slot].fire = true; },
  ai(me, o, dt) {
    const A = me.ai; A.t -= dt; A.aimT -= dt;
    const dx = o.x - me.x, dy = o.y - me.y, d = Math.hypot(dx, dy) || 1;
    const los = clearLine(me.x, me.y, o.x, o.y);
    if (A.t <= 0) { A.t = rnd(0.5, 1.3); const s = Math.random() < 0.5 ? 1 : -1; A.sx = -dy / d * s; A.sy = dx / d * s; }
    let mx, my;
    if (!los) { mx = dx / d + A.sx * 0.7; my = dy / d + A.sy * 0.7; }
    else if (d > 620) { mx = dx / d; my = dy / d; }
    else if (d < 260) { mx = -dx / d + A.sx; my = -dy / d + A.sy; }
    else { mx = A.sx; my = A.sy; }
    for (const b of this.bullets) {
      if (b.o === me.i && b.bn === 0) continue;
      const bx = me.x - b.x, by = me.y - b.y, bd = Math.hypot(bx, by);
      if (bd < 240 && b.vx * bx + b.vy * by > 0) { const sp = Math.hypot(b.vx, b.vy); mx += -b.vy / sp * 1.3; my += b.vx / sp * 1.3; }
    }
    if (los && d < 950 && me.cd <= 0 && o.inv <= 0) {
      if (A.aimT <= 0 && Math.random() < dt * 2.6) A.aimT = 0.45;
      if (A.aimT > 0) {
        const want = Math.atan2(dy, dx); mx = Math.cos(want) * 0.25; my = Math.sin(want) * 0.25;
        if (Math.abs(wrapAng(want - me.a)) < 0.1) { me.fire = true; A.aimT = 0; }
      }
    }
    const m = Math.hypot(mx, my); return m > 1 ? [mx / m, my / m] : [mx, my];
  },
  shoot(me) {
    if (me.cd > 0 || this.bullets.filter((b) => b.o === me.i).length >= 3) return;
    const bx = me.x + Math.cos(me.a) * 44, by = me.y + Math.sin(me.a) * 44;
    if (TWALLS.some((w) => bx > w[0] && bx < w[0] + w[2] && by > w[1] && by < w[1] + w[3])) return;
    me.cd = 0.38; me.recoil = 0.12;
    this.bullets.push({ x: bx, y: by, vx: Math.cos(me.a) * 760, vy: Math.sin(me.a) * 760, o: me.i, bn: 0, life: 3.6, trail: [] });
    tone(170, 0.12, 'square', 0.06, -90); burst(bx, by, '#ffd166', 6, 160, 4, 0.25);
  },
  hit(me, b) {
    me.hp--; me.inv = 0.9; G.shake = Math.max(G.shake, 10); SFX.bighit();
    burst(me.x, me.y, '#ffb703', 18, 380, 6, 0.5); burst(me.x, me.y, PC[me.i], 10, 260, 5, 0.4);
    toPlayer(me.i, 'vibe', 120);
    floatText(b.o === me.i ? 'פגעת בעצמך!' : '-1', me.x, me.y - 60, '#fff', 32);
    if (me.hp <= 0) { me.dead = true; burst(me.x, me.y, '#ff6b35', 50, 600, 9, 1); burst(me.x, me.y, '#333', 26, 300, 10, 1.2); G.shake = 22; this.wreck.push([me.x, me.y]); }
  },
  update(dt) {
    rounds(this, dt, TANK_WIN, 'tanks');
    const playing = this.state === 'play';
    for (const me of this.t) {
      const o = this.t[1 - me.i];
      me.cd = Math.max(0, me.cd - dt); me.inv = Math.max(0, me.inv - dt); me.recoil = Math.max(0, me.recoil - dt);
      if (me.dead) continue;
      let jx = 0, jy = 0;
      if (playing) { if (isBot(me.i)) [jx, jy] = this.ai(me, o, dt); else [jx, jy] = stickOf(me.i); }
      const m = Math.min(1, Math.hypot(jx, jy));
      if (m > 0.15) {
        const want = Math.atan2(jy, jx), diff = wrapAng(want - me.a);
        me.a += clamp(diff, -9 * dt, 9 * dt);
        const sp = 290 * m; me.x += Math.cos(want) * sp * dt; me.y += Math.sin(want) * sp * dt;
        if (Math.random() < 0.25) parts.push({ x: me.x - Math.cos(me.a) * 28, y: me.y - Math.sin(me.a) * 28, vx: 0, vy: 0, life: 0.6, max: 0.6, col: 'rgba(30,25,15,.35)', size: 5, g: 0 });
      }
      me.x = clamp(me.x, TA.x0 + TANK_R, TA.x1 - TANK_R); me.y = clamp(me.y, TA.y0 + TANK_R, TA.y1 - TANK_R);
      for (const w of TWALLS) { const p = circRect(me.x, me.y, TANK_R, w); if (p) { me.x += p[0]; me.y += p[1]; } }
      if (me.fire) { me.fire = false; if (playing) this.shoot(me); }
    }
    const [A, B] = this.t;
    if (!A.dead && !B.dead) {
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy), md = TANK_R * 2;
      if (d < md && d > 0.01) { const k = (md - d) / 2 / d; A.x -= dx * k; A.y -= dy * k; B.x += dx * k; B.y += dy * k; }
    }
    for (let k = this.bullets.length - 1; k >= 0; k--) {
      const b = this.bullets[k]; b.life -= dt;
      const px = b.x, py = b.y; b.x += b.vx * dt; b.y += b.vy * dt;
      let hitW = false;
      if (b.x < TA.x0) { b.x = TA.x0; b.vx = Math.abs(b.vx); hitW = true; }
      if (b.x > TA.x1) { b.x = TA.x1; b.vx = -Math.abs(b.vx); hitW = true; }
      if (b.y < TA.y0) { b.y = TA.y0; b.vy = Math.abs(b.vy); hitW = true; }
      if (b.y > TA.y1) { b.y = TA.y1; b.vy = -Math.abs(b.vy); hitW = true; }
      for (const w of TWALLS) if (b.x > w[0] && b.x < w[0] + w[2] && b.y > w[1] && b.y < w[1] + w[3]) {
        if (px <= w[0] || px >= w[0] + w[2]) { b.vx = -b.vx; b.x = px; } else { b.vy = -b.vy; b.y = py; }
        hitW = true;
      }
      if (hitW) { b.bn++; SFX.wall(); burst(b.x, b.y, '#ffe8a3', 4, 120, 3, 0.2); }
      if (b.bn > 2 || b.life <= 0) { this.bullets.splice(k, 1); continue; }
      b.trail.push([b.x, b.y]); if (b.trail.length > 7) b.trail.shift();
      if (!playing) continue;
      for (const me of this.t) {
        if (me.dead || me.inv > 0 || (me.i === b.o && b.bn === 0)) continue;
        if (Math.hypot(me.x - b.x, me.y - b.y) < TANK_R + 5) { this.bullets.splice(k, 1); this.hit(me, b); break; }
      }
    }
    if (playing) {
      const alive = this.t.filter((x) => !x.dead);
      if (alive.length < 2) endRound(this, alive.length ? alive[0].i : -1, alive.length ? '' : 'שני הטנקים הושמדו!');
    }
  },
  draw() {
    ctx.fillStyle = '#23261d'; ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = '#4b5341'; ctx.fillRect(TA.x0, TA.y0, TA.x1 - TA.x0, TA.y1 - TA.y0);
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 2;
    for (let x = TA.x0; x <= TA.x1; x += 74) { ctx.beginPath(); ctx.moveTo(x, TA.y0); ctx.lineTo(x, TA.y1); ctx.stroke(); }
    for (let y = TA.y0; y <= TA.y1; y += 74) { ctx.beginPath(); ctx.moveTo(TA.x0, y); ctx.lineTo(TA.x1, y); ctx.stroke(); }
    for (const [x, y] of this.wreck) { const g = ctx.createRadialGradient(x, y, 5, x, y, 70); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - 70, y - 70, 140, 140); }
    ctx.lineWidth = 10; ctx.strokeStyle = '#15170f'; ctx.strokeRect(TA.x0 - 5, TA.y0 - 5, TA.x1 - TA.x0 + 10, TA.y1 - TA.y0 + 10);
    for (const w of TWALLS) {
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(w[0] + 6, w[1] + 8, w[2], w[3]);
      ctx.fillStyle = '#8b917a'; ctx.fillRect(w[0], w[1], w[2], w[3]);
      ctx.fillStyle = '#a7ad94'; ctx.fillRect(w[0], w[1], w[2], 7);
      ctx.strokeStyle = '#5b6050'; ctx.lineWidth = 3; ctx.strokeRect(w[0], w[1], w[2], w[3]);
      ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 2;
      for (let s = 20; s < w[2] + w[3]; s += 22) { ctx.beginPath(); ctx.moveTo(w[0] + Math.min(s, w[2]), w[1] + Math.max(0, s - w[2])); ctx.lineTo(w[0] + Math.max(0, s - w[3]), w[1] + Math.min(s, w[3])); ctx.stroke(); }
    }
    for (const b of this.bullets) {
      ctx.strokeStyle = PC[b.o]; ctx.globalAlpha = 0.45; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); b.trail.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, 7, 0, Math.PI * 2); ctx.fillStyle = PC[b.o]; ctx.fill();
      ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    }
    for (const me of this.t) if (!me.dead) drawTank(me);
    drawFx();
    scoreTop(this.score, `ראשון ל־${TANK_WIN} סיבובים`);
    roundOverlay(this, 'טנקים', 'ג׳ויסטיק לתנועה · "אש" יורה לכיוון התנועה · הפגזים קופצים מהקירות!');
    codeBadge();
  },
};
function drawTank(me) {
  const blink = me.inv > 0 && Math.floor(me.inv * 12) % 2 === 0;
  if (blink) ctx.globalAlpha = 0.45;
  ctx.save(); ctx.translate(me.x, me.y); ctx.rotate(me.a);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; rr(-25, -21, 60, 56, 10); ctx.fill();
  ctx.fillStyle = '#1d1f1a'; rr(-32, -30, 64, 15, 5); ctx.fill(); rr(-32, 15, 64, 15, 5); ctx.fill();
  ctx.fillStyle = '#3a3d33'; for (let k = -28; k < 30; k += 9) { ctx.fillRect(k, -28, 3, 11); ctx.fillRect(k, 17, 3, 11); }
  rr(-26, -18, 52, 36, 9); ctx.fillStyle = PC[me.i]; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.18)'; rr(-24, -16, 48, 10, 6); ctx.fill();
  const rc = me.recoil * 60;
  ctx.fillStyle = PC_DARK[me.i]; rr(4 - rc, -6, 42, 12, 4); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-3, -3, 6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fill();
  ctx.restore(); ctx.globalAlpha = 1;
  for (let k = 0; k < TANK_HP; k++) {
    ctx.beginPath(); ctx.arc(me.x - 20 + k * 20, me.y - 50, 7, 0, Math.PI * 2);
    ctx.fillStyle = k < me.hp ? PC[me.i] : 'rgba(0,0,0,.4)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
}

// ============================================================
//  משחק 6: כדורגל ראשים
// ============================================================
const SC = { gy: 790, top: 150, bar: 520, gw: 104, hr: 50, br: 28, time: 75 };
const SC_HEADY = SC.gy - SC.hr - 30;
const crowd2 = (() => { const R = seeded(11), a = []; for (let row = 0; row < 5; row++) for (let i = 0; i < 40; i++) a.push([i * 41 + (row % 2) * 20 + R() * 8, 330 + row * 44, 16 + R() * 5, R() * 6, R()]); return a; })();
const Soccer = {
  enter() { this.score = [0, 0]; this.time = SC.time; this.state = 'intro'; this.it = 2.6; this.t = 0; this.kickoff(-1); },
  kickoff(toward) {
    this.pl = [0, 1].map((i) => ({ i, x: i ? 1180 : 420, y: SC_HEADY, vx: 0, vy: 0, dir: i ? -1 : 1, ground: true, kt: 0, kicked: false, jq: false, kq: false }));
    this.b = { x: 800, y: 300, vx: toward === 0 ? -80 : toward === 1 ? 80 : 0, vy: 0, rot: 0 };
  },
  onInput(slot, d) { const p = this.pl[slot]; if (!p) return; if (d.t === 'jump') p.jq = true; if (d.t === 'kick') p.kq = true; },
  foot(p) { const k = p.kt > 0 ? Math.sin((1 - p.kt / 0.26) * Math.PI) : 0; return [p.x + p.dir * (26 + 46 * k), p.y + SC.hr + 12 - 24 * k, k]; },
  ai(p) {
    const b = this.b, dir = p.dir, own = p.i === 0 ? 0 : VW;
    let tx = b.x - dir * 55;
    if ((b.x - p.x) * dir < -10) tx = b.x - dir * 95;
    if (Math.abs(b.x - own) < 380 && b.vx * dir < 0) tx = b.x - dir * 40;
    const dx = tx - p.x;
    if (Math.abs(b.x - p.x) < 160 && b.y < p.y - 30 && b.vy > -300 && p.ground && Math.random() < 0.07) p.jq = true;
    const f = this.foot(p);
    if (Math.hypot(b.x - f[0], b.y - f[1]) < 80 && (b.x - p.x) * dir > 0 && Math.random() < 0.3) p.kq = true;
    return [dx < -18, dx > 18];
  },
  bounce(cx, cy, r, vx, vy, e, head) {
    const b = this.b, dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy), md = r + SC.br;
    if (d >= md || d < 0.01) return;
    const nx = dx / d, ny = dy / d; b.x = cx + nx * md; b.y = cy + ny * md;
    const vn = (b.vx - vx) * nx + (b.vy - vy) * ny;
    if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; if (head) { if (Math.abs(vn) > 250) SFX.puck(); if (ny < -0.5) b.vy -= 120; } }
  },
  goal(s) {
    this.score[s]++; this.scorer = s; this.state = 'goal'; this.goalT = 1.9;
    SFX.goal(); G.shake = 14; burst(this.b.x, this.b.y, PC[s], 50, 600, 8, 1);
    toPlayer(s, 'vibe', [80, 50, 80]); toPlayer(1 - s, 'vibe', 250);
  },
  ballStep(dt) {
    const b = this.b, R = SC.br;
    b.vy += 1500 * dt; b.vx *= 1 - 0.12 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vx * dt / R;
    if (b.y > SC.gy - R) { b.y = SC.gy - R; if (b.vy > 0) { if (b.vy > 220) SFX.wall(); b.vy = -b.vy * 0.68; } b.vx *= 0.985; if (Math.abs(b.vy) < 40) b.vy = 0; }
    if (b.y < SC.top + R) { b.y = SC.top + R; b.vy = Math.abs(b.vy) * 0.7; }
    if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx) * 0.7; }
    if (b.x > VW - R) { b.x = VW - R; b.vx = -Math.abs(b.vx) * 0.7; }
    for (const bar of [[0, SC.bar, SC.gw, 14], [VW - SC.gw, SC.bar, SC.gw, 14]]) {
      const p = circRect(b.x, b.y, R, bar);
      if (p) { b.x += p[0]; b.y += p[1]; const m = Math.hypot(p[0], p[1]) || 1, nx = p[0] / m, ny = p[1] / m, vn = b.vx * nx + b.vy * ny; if (vn < 0) { b.vx -= 1.75 * vn * nx; b.vy -= 1.75 * vn * ny; SFX.wall(); } }
    }
    if (b.x < SC.gw - R * 0.3 && b.y > SC.bar + 7) return this.goal(1);
    if (b.x > VW - SC.gw + R * 0.3 && b.y > SC.bar + 7) return this.goal(0);
    for (const p of this.pl) {
      this.bounce(p.x, p.y, SC.hr, p.vx, p.vy, 0.9, true);
      const f = this.foot(p);
      if (p.kt > 0 && !p.kicked && Math.hypot(b.x - f[0], b.y - f[1]) < R + 32) {
        p.kicked = true; b.vx = p.dir * 1150 + p.vx * 0.3; b.vy = -460 - Math.random() * 220;
        SFX.hit(); G.shake = Math.max(G.shake, 5); burst(b.x, b.y, '#fff', 8, 220, 4, 0.3); toPlayer(p.i, 'vibe', 30);
      } else this.bounce(f[0], f[1], 18, p.vx, p.vy, 0.6, false);
    }
    const sp = Math.hypot(b.vx, b.vy); if (sp > 1600) { b.vx *= 1600 / sp; b.vy *= 1600 / sp; }
  },
  update(dt) {
    this.t += dt;
    if (this.state === 'intro') { this.it -= dt; if (this.it <= 0) { this.state = 'play'; tone(1500, 0.35, 'square', 0.05); } }
    else if (this.state === 'play') { this.time -= dt; if (this.time <= 0) { this.time = 0; this.state = 'over'; this.ot = 2.2; tone(1500, 0.9, 'square', 0.05); } }
    else if (this.state === 'goal') { this.goalT -= dt; if (this.goalT <= 0) { this.kickoff(1 - this.scorer); this.state = 'play'; tone(1500, 0.25, 'square', 0.05); } }
    else if (this.state === 'over') { this.ot -= dt; if (this.ot <= 0) { const [a, b] = this.score; showResults(a === b ? -1 : a > b ? 0 : 1, `${Math.max(a, b)} : ${Math.min(a, b)}`, 'soccer'); } return; }
    const live = this.state === 'play';
    for (const p of this.pl) {
      let l = false, r = false;
      if (live) { if (isBot(p.i)) [l, r] = this.ai(p); else { l = inp[p.i].l; r = inp[p.i].r; } }
      else p.jq = p.kq = false;
      p.vx = lerp(p.vx, ((r ? 1 : 0) - (l ? 1 : 0)) * 440, Math.min(1, 14 * dt));
      if (p.jq) { p.jq = false; if (p.ground) { p.vy = -980; p.ground = false; tone(380, 0.09, 'sine', 0.05, 300); } }
      if (p.kq) { p.kq = false; if (p.kt <= 0) { p.kt = 0.26; p.kicked = false; SFX.whoosh(); } }
      p.kt = Math.max(0, p.kt - dt);
      p.vy += 2600 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y >= SC_HEADY) { p.y = SC_HEADY; p.vy = 0; p.ground = true; }
      p.x = clamp(p.x, 60 + SC.hr, VW - 60 - SC.hr);
    }
    const [a, b] = this.pl, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), md = SC.hr * 2;
    if (d < md && d > 0.01) { const k = (md - d) / 2 / d; a.x -= dx * k; b.x += dx * k; if (dy < -40) { b.y = Math.min(b.y, a.y - md + 4); b.vy = Math.min(b.vy, 0); b.ground = true; } else if (dy > 40) { a.y = Math.min(a.y, b.y - md + 4); a.vy = Math.min(a.vy, 0); a.ground = true; } }
    if (live) this.ballStep(dt);
  },
  drawGoal(left, front) {
    const x0 = left ? 0 : VW - SC.gw, w = SC.gw, postX = left ? SC.gw : VW - SC.gw;
    if (!front) {
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(x0, SC.bar, w, SC.gy - SC.bar);
      ctx.save(); ctx.beginPath(); ctx.rect(x0, SC.bar, w, SC.gy - SC.bar); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
      for (let s = -300; s < 400; s += 16) { ctx.beginPath(); ctx.moveTo(x0 + s, SC.bar); ctx.lineTo(x0 + s + 270, SC.gy); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x0 + s + 270, SC.bar); ctx.lineTo(x0 + s, SC.gy); ctx.stroke(); }
      ctx.restore();
    } else {
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(x0, SC.bar, w, 14);
      ctx.fillRect(postX - 6, SC.bar, 12, SC.gy - SC.bar);
    }
  },
  draw() {
    bgGrad('#0b1633', '#1d3a6b');
    for (const x of [230, 1370]) {
      const g = ctx.createRadialGradient(x, 120, 10, x, 300, 420); g.addColorStop(0, 'rgba(255,255,230,.35)'); g.addColorStop(1, 'rgba(255,255,230,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 420, 0, 840, 600);
      ctx.fillStyle = '#c9cbd6'; ctx.fillRect(x - 3, 130, 6, 200); rr(x - 50, 104, 100, 30, 6); ctx.fillStyle = '#f7f8ff'; ctx.fill();
    }
    ctx.fillStyle = '#121d42'; ctx.fillRect(0, 320, VW, 250);
    for (const [x, y, r, ph, k] of crowd2) {
      const bob = Math.sin(this.t * (4 + k * 3) + ph) * (this.state === 'goal' ? 10 : 2);
      ctx.fillStyle = k < 0.25 ? PC_DARK[0] : k < 0.5 ? PC_DARK[1] : `rgb(${40 + k * 40},${45 + k * 40},${80 + k * 50})`;
      ctx.beginPath(); ctx.arc(x, y + bob, r, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x - r, y + bob + r * 0.6, r * 2, 30);
    }
    ctx.fillStyle = '#0a1330'; ctx.fillRect(0, 556, VW, 50);
    for (let x = 40; x < VW; x += 320) txt('זירה', x + 120, 581, 26, 'rgba(255,255,255,.55)', 'center', 900);
    for (let x = 0; x < VW; x += 100) { ctx.fillStyle = (x / 100) % 2 ? '#2f8f3a' : '#33a043'; ctx.fillRect(x, 606, 100, SC.gy - 606); }
    ctx.fillStyle = '#25762e'; ctx.fillRect(0, SC.gy, VW, VH - SC.gy);
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(VW / 2 - 3, 606, 6, SC.gy - 606);
    this.drawGoal(true, false); this.drawGoal(false, false);
    const b = this.b, hk = clamp(1 - (SC.gy - b.y) / 600, 0.25, 1);
    ctx.beginPath(); ctx.ellipse(b.x, SC.gy + 4, 30 * hk, 8 * hk, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
    for (const p of this.pl) drawHead(p, b, this.foot(p));
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
    ctx.beginPath(); ctx.arc(0, 0, SC.br, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = '#1b1f3b'; polygon(0, 0, 9, 5); ctx.fill();
    for (let j = 0; j < 5; j++) { const a = -Math.PI / 2 + j * Math.PI * 2 / 5; polygon(Math.cos(a) * 24, Math.sin(a) * 24, 8, 5, a + Math.PI / 2); ctx.fill(); }
    ctx.restore(); ctx.lineWidth = 2; ctx.strokeStyle = '#1b1f3b'; ctx.beginPath(); ctx.arc(0, 0, SC.br, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    this.drawGoal(true, true); this.drawGoal(false, true);
    drawFx();
    const s = Math.ceil(this.time);
    scoreTop(this.score, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    if (this.state === 'intro') banner('כדורגל ראשים', '◀ ▶ לזוז · קפיצה לנגיחה · בעיטה כשהכדור ליד הרגל', '#fff', 110);
    if (this.state === 'goal') banner('גול!', `${pname(this.scorer)} הבקיע/ה`, PC[this.scorer], 200);
    if (this.state === 'over') banner('שריקת סיום!', '', '#fff', 110);
    codeBadge();
  },
};
function drawHead(p, b, f) {
  const x = p.x, y = p.y, r = SC.hr, d = p.dir;
  ctx.beginPath(); ctx.ellipse(x, SC.gy + 4, 46, 10, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
  rr(x - 28, y + r - 14, 56, 34, 14); ctx.fillStyle = PC[p.i]; ctx.fill();
  ctx.save(); ctx.translate(f[0], f[1]); ctx.rotate(-d * f[2] * 0.6);
  rr(-22, -11, 44, 22, 10); ctx.fillStyle = '#16162a'; ctx.fill();
  ctx.fillStyle = PC[p.i]; ctx.fillRect(-8, -11, 5, 22);
  ctx.restore();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#e8b48a'; ctx.fill();
  ctx.beginPath(); ctx.arc(x - d * 4, y - 6, r + 1, Math.PI * 1.02, Math.PI * 1.98); ctx.fillStyle = PC_DARK[p.i]; ctx.fill();
  ctx.fillStyle = PC[p.i]; ctx.fillRect(x - r, y - 14, r * 2, 9);
  const ex = x + d * 20, ey = y + 2;
  ctx.beginPath(); ctx.arc(ex, ey, 13, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  const ea = Math.atan2(b.y - ey, b.x - ex);
  ctx.beginPath(); ctx.arc(ex + Math.cos(ea) * 6, ey + Math.sin(ea) * 6, 6, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
  ctx.strokeStyle = '#3a2416'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ex - 12, ey - 18 + d * 2); ctx.lineTo(ex + 12, ey - 18 - d * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + d * (r - 4), y + 10, 9, 0, Math.PI * 2); ctx.fillStyle = '#d99c70'; ctx.fill();
  ctx.strokeStyle = '#7a3b2e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x + d * 18, y + 26, 10, d > 0 ? 0.2 : Math.PI - 1.4, d > 0 ? 1.4 : Math.PI - 0.2); ctx.stroke();
}

// ============================================================
//  משחק 7: סומו
// ============================================================
const SU = { cx: 800, cy: 500, r0: 330, rMin: 200, pr: 46, win: 3 };
const Sumo = {
  enter() { this.score = [0, 0]; this.round = 1; this.reset(); this.state = 'intro'; this.it = 2.8; },
  reset() {
    this.R = SU.r0; this.playT = 0; this.outT = 0;
    this.p = [0, 1].map((i) => ({ i, x: SU.cx + (i ? 150 : -150), y: SU.cy, vx: 0, vy: 0, face: i ? Math.PI : 0, dcd: 0, dt: 0, out: false, ft: 0, act: false }));
  },
  onInput(slot, d) { if (d.t === 'act' && this.p[slot]) this.p[slot].act = true; },
  ai(p, o) {
    const dcx = p.x - SU.cx, dcy = p.y - SU.cy, dc = Math.hypot(dcx, dcy) || 1;
    const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy) || 1;
    let mx = dx / d, my = dy / d;
    const ox = o.x - SU.cx, oy = o.y - SU.cy, od = Math.hypot(ox, oy) || 1;
    if (d > 150) { const qx = o.x - ox / od * 80 - p.x, qy = o.y - oy / od * 80 - p.y, q = Math.hypot(qx, qy) || 1; mx = qx / q; my = qy / q; }
    if (dc > this.R - 95) { mx = -dcx / dc; my = -dcy / dc; }
    if (d < 210 && p.dcd <= 0 && dc < this.R - 70 && Math.random() < 0.05) p.act = true;
    return [mx * 0.88, my * 0.88];
  },
  update(dt) {
    rounds(this, dt, SU.win, 'sumo');
    const live = this.state === 'play';
    if (live) { this.playT += dt; if (this.playT > 10) this.R = Math.max(SU.rMin, this.R - dt * 6); }
    for (const p of this.p) {
      p.dcd = Math.max(0, p.dcd - dt); p.dt = Math.max(0, p.dt - dt);
      if (p.out) { p.ft += dt; p.x += p.vx * dt * 0.4; p.y += p.vy * dt * 0.4; continue; }
      let jx = 0, jy = 0;
      if (live) { if (isBot(p.i)) [jx, jy] = this.ai(p, this.p[1 - p.i]); else [jx, jy] = stickOf(p.i); }
      const m = Math.min(1, Math.hypot(jx, jy));
      if (m > 0.12) { const a = Math.atan2(jy, jx); p.vx += Math.cos(a) * m * 1500 * dt; p.vy += Math.sin(a) * m * 1500 * dt; p.face = a; }
      if (p.act) {
        p.act = false;
        if (live && p.dcd <= 0) { const a = m > 0.2 ? Math.atan2(jy, jx) : p.face; p.vx += Math.cos(a) * 900; p.vy += Math.sin(a) * 900; p.dt = 0.28; p.dcd = 1.1; p.face = a; SFX.whoosh(); tone(160, 0.15, 'sawtooth', 0.05, -60); toPlayer(p.i, 'vibe', 25); }
      }
      p.vx *= 1 - 2.4 * dt; p.vy *= 1 - 2.4 * dt;
      const sp = Math.hypot(p.vx, p.vy), mx = p.dt > 0 ? 1300 : 430; if (sp > mx) { p.vx *= mx / sp; p.vy *= mx / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    const [a, b] = this.p;
    if (!a.out && !b.out) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), md = SU.pr * 2;
      if (d < md && d > 0.01) {
        const nx = dx / d, ny = dy / d, ov = (md - d) / 2; a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) {
          const j = -(1 + 0.85) * vn / 2; a.vx -= j * nx; a.vy -= j * ny; b.vx += j * nx; b.vy += j * ny;
          if (a.dt > 0) { b.vx += nx * 340; b.vy += ny * 340; }
          if (b.dt > 0) { a.vx -= nx * 340; a.vy -= ny * 340; }
          if (Math.abs(vn) > 200) { SFX.bump(); G.shake = Math.max(G.shake, Math.min(14, Math.abs(vn) / 60)); burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#fff3c4', 10, 260, 5, 0.35); toPlayer(0, 'vibe', 40); toPlayer(1, 'vibe', 40); }
        }
      }
    }
    if (live) {
      for (const p of this.p) if (!p.out && Math.hypot(p.x - SU.cx, p.y - SU.cy) > this.R + 6) { p.out = true; p.ft = 0; SFX.bighit(); burst(p.x, p.y, '#e8d5a3', 30, 400, 7, 0.8); toPlayer(p.i, 'vibe', 300); }
      const out = this.p.filter((p) => p.out);
      if (out.length) { this.outT += dt; if (out.length === 2 || this.outT > 0.15) endRound(this, out.length === 2 ? -1 : 1 - out[0].i, out.length === 2 ? 'שניכם עפתם החוצה!' : 'מחוץ לזירה!'); }
    }
  },
  draw() {
    for (let y = 0; y < VH; y += 60) { ctx.fillStyle = (y / 60) % 2 ? '#432a1a' : '#3b2416'; ctx.fillRect(0, y, VW, 60); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, y, VW, 2); }
    const cx = SU.cx, cy = SU.cy;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(cx - 366, cy - 360, 760, 760);
    ctx.fillStyle = '#c9a46b'; ctx.fillRect(cx - 380, cy - 380, 760, 760);
    ctx.fillStyle = '#b08b52'; ctx.fillRect(cx - 380, cy + 368, 760, 12);
    ctx.beginPath(); ctx.arc(cx, cy, SU.r0 + 34, 0, Math.PI * 2); ctx.fillStyle = '#d9bd85'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, SU.r0, 0, Math.PI * 2); ctx.fillStyle = '#ecdcae'; ctx.fill();
    ctx.lineWidth = 18; ctx.strokeStyle = '#bfa064'; ctx.beginPath(); ctx.arc(cx, cy, SU.r0 + 9, 0, Math.PI * 2); ctx.stroke();
    ctx.lineCap = 'butt'; ctx.setLineDash([6, 14]); ctx.strokeStyle = '#9f7f43'; ctx.stroke(); ctx.setLineDash([]);
    if (this.R < SU.r0 - 1) {
      ctx.beginPath(); ctx.arc(cx, cy, SU.r0, 0, Math.PI * 2); ctx.arc(cx, cy, this.R, 0, Math.PI * 2, true); ctx.fillStyle = 'rgba(190,40,40,.28)'; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = `rgba(230,50,50,${0.6 + 0.4 * Math.sin(G.t * 10)})`; ctx.beginPath(); ctx.arc(cx, cy, this.R, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.fillRect(cx - 94, cy - 40, 8, 80); ctx.fillRect(cx + 86, cy - 40, 8, 80);
    for (const p of this.p) drawSumo(p);
    drawFx();
    scoreTop(this.score, `ראשון ל־${SU.win} סיבובים`);
    roundOverlay(this, 'סומו', 'ג׳ויסטיק לתנועה · "הדיפה" לדחיפה חזקה · הזירה מתכווצת!');
    codeBadge();
  },
};
function drawSumo(p) {
  const s = p.out ? Math.max(0.25, 1 - p.ft * 1.1) : 1;
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s, s); ctx.rotate(p.face);
  ctx.globalAlpha = p.out ? Math.max(0, 1 - p.ft) : 1;
  ctx.beginPath(); ctx.arc(7, 9, SU.pr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
  if (p.dt > 0) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 4; for (const o of [-24, 0, 24]) { ctx.beginPath(); ctx.moveTo(-58, o); ctx.lineTo(-92, o); ctx.stroke(); } }
  ctx.fillStyle = '#e2ad7d';
  ctx.beginPath(); ctx.arc(16, -42, 16, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(16, 42, 16, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, SU.pr, 0, Math.PI * 2); ctx.fillStyle = '#efbd90'; ctx.fill();
  ctx.lineWidth = 12; ctx.strokeStyle = PC[p.i]; ctx.beginPath(); ctx.arc(0, 0, SU.pr - 6, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(20, 0, 20, 0, Math.PI * 2); ctx.fillStyle = '#e5ae82'; ctx.fill();
  ctx.beginPath(); ctx.ellipse(12, 0, 12, 8, 0, 0, Math.PI * 2); ctx.fillStyle = '#1b1b1b'; ctx.fill();
  ctx.beginPath(); ctx.arc(3, 0, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore(); ctx.globalAlpha = 1;
  if (!p.out) {
    txt(pname(p.i), p.x, p.y - SU.pr - 20, 18, '#fff', 'center', 800, 4);
    if (p.dcd <= 0) { ctx.beginPath(); ctx.arc(p.x, p.y, SU.pr + 8, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,214,10,.6)'; ctx.stroke(); }
  }
}

// ============================================================
//  משחק: כדורעף
// ============================================================
const VB = { gy: 800, netX: 800, netTop: 548, netW: 18, pr: 64, br: 26, win: 7, top: 110 };
const Volley = {
  enter() { this.score = [0, 0]; this.state = 'intro'; this.it = 2.6; this.t = 0; this.server = Math.random() < 0.5 ? 0 : 1; this.reset(); },
  reset() {
    this.pl = [0, 1].map((i) => ({ i, x: i ? 1200 : 400, y: VB.gy, vx: 0, vy: 0, ground: true, jq: false, kq: false, scd: 0, spikeT: 0 }));
    this.b = { x: this.server ? 1200 : 400, y: 300, vx: 0, vy: 0, rot: 0 };
    this.trail = []; this.spd = 1; this.err = [rnd(-30, 30), rnd(-30, 30)]; this.side = -1;
  },
  onInput(slot, d) { const p = this.pl[slot]; if (!p) return; if (d.t === 'jump') p.jq = true; if (d.t === 'kick') p.kq = true; },
  range(i) { const h = VB.netW / 2; return i === 0 ? [40 + VB.pr, VB.netX - h - VB.pr * 0.6] : [VB.netX + h + VB.pr * 0.6, VW - 40 - VB.pr]; },
  predict() {
    // לאן הכדור ייפול (בגובה ראש השחקן) – בשביל המחשב
    let { x, y, vx, vy } = this.b; const h = VB.gy - VB.pr - VB.br * 0.4;
    for (let k = 0; k < 300; k++) {
      vy += 1000 / 60; x += vx / 60; y += vy / 60;
      if (x < VB.br) { x = VB.br; vx = Math.abs(vx); } if (x > VW - VB.br) { x = VW - VB.br; vx = -Math.abs(vx); }
      if (vy > 0 && y >= h) break;
    }
    return x;
  },
  ai(p) {
    const b = this.b, toNet = p.i === 0 ? 1 : -1, [mn, mx] = this.range(p.i);
    const mine = (x) => (p.i === 0 ? x < VB.netX : x > VB.netX);
    const lx = this.predict();
    let tx = mine(lx) ? lx - toNet * 24 + this.err[p.i] : (p.i ? 1200 : 400);
    tx = clamp(tx, mn, mx);
    const dx = tx - p.x;
    if (mine(b.x) && p.ground && Math.abs(b.x - p.x) < 90 && b.vy > 0 && b.y > VB.gy - 330 && b.y < VB.gy - 170 && Math.abs(b.x - VB.netX) < 330 && Math.random() < 0.5) p.jq = true;
    if (!p.ground && mine(b.x) && Math.hypot(b.x - p.x, b.y - p.y) < VB.pr + VB.br + 60 && b.y < p.y && Math.random() < 0.25) p.kq = true;
    return [dx < -10, dx > 10];
  },
  point(winner) {
    this.score[winner]++; this.scorer = winner; this.server = 1 - winner;
    this.state = 'point'; this.pt = 1.6; SFX.goal(); G.shake = 10;
    burst(this.b.x, VB.gy - 10, '#f5deb3', 30, 400, 7, 0.8); burst(this.b.x, VB.gy - 10, PC[winner], 20, 350, 6, 0.7);
    toPlayer(winner, 'vibe', [80, 40, 80]); toPlayer(1 - winner, 'vibe', 220);
  },
  ballStep(dt) {
    const b = this.b, R = VB.br;
    const side = b.x < VB.netX ? 0 : 1;
    if (side !== this.side) { this.side = side; this.err[side] = rnd(-34, 34) * (Math.random() < 0.15 ? 2.6 : 1); }
    dt *= this.spd;
    b.vy += 1000 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vx * dt / R;
    if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx) * 0.9; SFX.wall(); }
    if (b.x > VW - R) { b.x = VW - R; b.vx = -Math.abs(b.vx) * 0.9; SFX.wall(); }
    if (b.y < VB.top + R) { b.y = VB.top + R; b.vy = Math.abs(b.vy) * 0.8; }
    const net = [VB.netX - VB.netW / 2, VB.netTop, VB.netW, VB.gy - VB.netTop];
    const pn = circRect(b.x, b.y, R, net);
    if (pn) {
      b.x += pn[0]; b.y += pn[1];
      const m = Math.hypot(pn[0], pn[1]) || 1, nx = pn[0] / m, ny = pn[1] / m, vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= 1.7 * vn * nx; b.vy -= 1.7 * vn * ny; SFX.wall(); }
      if (ny < -0.5) { b.vx += (b.x < VB.netX ? -1 : 1) * 160; b.vy = Math.min(b.vy, -260); }
    }
    for (const p of this.pl) {
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy), md = VB.pr + R;
      if (d < md && d > 0.01 && b.y < p.y + 4) {
        const nx = dx / d, ny = dy / d;
        b.x = p.x + nx * md; b.y = p.y + ny * md;
        const vn = (b.vx - p.vx) * nx + (b.vy - p.vy) * ny;
        if (vn < 0) {
          b.vx -= 1.9 * vn * nx; b.vy -= 1.9 * vn * ny;
          b.vx += p.vx * 0.3; b.vy += Math.min(0, p.vy) * 0.35;
          if (ny < -0.2) b.vy = Math.min(b.vy, -780);
          if (Math.abs(b.vx) < 150) b.vx = (p.i === 0 ? 1 : -1) * 150;
          this.spd = Math.min(1.55, this.spd + 0.035);
          SFX.puck(); burst(b.x - nx * R, b.y - ny * R, PC[p.i], 6, 180, 4, 0.25); toPlayer(p.i, 'vibe', 15);
        }
      }
      if (p.kq) {
        p.kq = false;
        const near = Math.hypot(b.x - p.x, b.y - p.y) < VB.pr + R + 75;
        if (p.scd <= 0 && !p.ground && near && b.y < p.y) {
          const toNet = p.i === 0 ? 1 : -1;
          b.vx = toNet * 1050; b.vy = b.y > VB.netTop - 70 ? -260 : 320;
          p.scd = 0.8; p.spikeT = 0.25;
          SFX.hit(); G.shake = Math.max(G.shake, 8); burst(b.x, b.y, '#fff', 14, 320, 5, 0.35); floatText('הנחתה!', b.x, b.y - 50, GOLD, 34);
          toPlayer(p.i, 'vibe', 40);
        }
      }
    }
    const sp = Math.hypot(b.vx, b.vy); if (sp > 1450) { b.vx *= 1450 / sp; b.vy *= 1450 / sp; }
    this.trail.push([b.x, b.y]); if (this.trail.length > 10) this.trail.shift();
    if (b.y >= VB.gy - R) { b.y = VB.gy - R; this.point(b.x < VB.netX ? 1 : 0); }
  },
  update(dt) {
    this.t += dt;
    if (this.state === 'intro') { this.it -= dt; if (this.it <= 0) { this.state = 'play'; SFX.go(); } }
    else if (this.state === 'point') {
      this.pt -= dt;
      if (this.pt <= 0) {
        if (Math.max(this.score[0], this.score[1]) >= VB.win) { this.state = 'over'; this.ot = 1.2; }
        else { this.reset(); this.state = 'play'; tone(900, 0.15, 'square', 0.05); }
      }
    } else if (this.state === 'over') {
      this.ot -= dt;
      if (this.ot <= 0) { const w = this.score[0] > this.score[1] ? 0 : 1; showResults(w, `${this.score[w]} : ${this.score[1 - w]}`, 'volley'); }
      return;
    }
    const live = this.state === 'play';
    for (const p of this.pl) {
      let l = false, r = false;
      if (live) { if (isBot(p.i)) [l, r] = this.ai(p); else { l = inp[p.i].l; r = inp[p.i].r; } }
      else p.jq = p.kq = false;
      const sp = isBot(p.i) ? 500 : 560;
      p.vx = lerp(p.vx, ((r ? 1 : 0) - (l ? 1 : 0)) * sp, Math.min(1, 14 * dt));
      if (p.jq) { p.jq = false; if (p.ground) { p.vy = -900; p.ground = false; tone(380, 0.09, 'sine', 0.05, 300); } }
      p.scd = Math.max(0, p.scd - dt); p.spikeT = Math.max(0, p.spikeT - dt);
      p.vy += 2400 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y >= VB.gy) { p.y = VB.gy; p.vy = 0; p.ground = true; }
      const [mn, mx] = this.range(p.i); p.x = clamp(p.x, mn, mx);
    }
    if (live) this.ballStep(dt); else p0kq(this);
  },
  draw() {
    const sky = ctx.createLinearGradient(0, 0, 0, 600); sky.addColorStop(0, '#3aa0e8'); sky.addColorStop(1, '#bfe8ff');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, VW, 600);
    ctx.beginPath(); ctx.arc(1330, 210, 80, 0, Math.PI * 2); ctx.fillStyle = '#fff3b0'; ctx.fill();
    for (const [x, y, s] of [[230, 220, 1], [620, 160, 0.8], [1050, 250, 0.7]]) {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (const [ox, oy, r] of [[0, 0, 40], [44, -12, 50], [92, 0, 40], [46, 14, 44]]) { ctx.beginPath(); ctx.arc(x + ox * s + ((this.t * 8) % VW), y + oy * s, r * s, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.fillStyle = '#1f7fbf'; ctx.fillRect(0, 560, VW, 80);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; for (let x = 0; x < VW; x += 90) ctx.fillRect((x + this.t * 20) % VW, 590 + (x % 3) * 12, 40, 3);
    ctx.fillStyle = '#f1d9a5'; ctx.fillRect(0, 630, VW, VH - 630);
    ctx.fillStyle = '#e6c88a'; for (let k = 0; k < 70; k++) ctx.fillRect((k * 263) % VW, 650 + ((k * 97) % 240), 6, 3);
    ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(0, VB.gy, VW, 4);
    // צל כדור
    const b = this.b, hk = clamp(1 - (VB.gy - b.y) / 700, 0.25, 1);
    ctx.beginPath(); ctx.ellipse(b.x, VB.gy + 4, 30 * hk, 8 * hk, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fill();
    // רשת
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(VB.netX - 6, VB.netTop - 20, 12, VB.gy - VB.netTop + 20);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(VB.netX - VB.netW / 2, VB.netTop, VB.netW, VB.gy - VB.netTop - 60);
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2;
    for (let y = VB.netTop; y < VB.gy - 60; y += 16) { ctx.beginPath(); ctx.moveTo(VB.netX - VB.netW / 2, y); ctx.lineTo(VB.netX + VB.netW / 2, y); ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.fillRect(VB.netX - VB.netW / 2 - 3, VB.netTop - 6, VB.netW + 6, 10);
    // שחקנים
    for (const p of this.pl) drawSlime(p, b);
    // שובל וכדור
    this.trail.forEach(([x, y], k) => { ctx.globalAlpha = (k / this.trail.length) * 0.25; ctx.beginPath(); ctx.arc(x, y, VB.br * (0.4 + 0.6 * k / this.trail.length), 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); });
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
    ctx.beginPath(); ctx.arc(0, 0, VB.br, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.ellipse(-14, 0, 14, 30, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.ellipse(16, -6, 12, 28, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2; ctx.strokeStyle = '#1b1f3b'; ctx.beginPath(); ctx.arc(0, 0, VB.br, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(-40, 0, 40, -0.6, 0.6); ctx.stroke(); ctx.beginPath(); ctx.arc(40, 0, 40, Math.PI - 0.6, Math.PI + 0.6); ctx.stroke();
    ctx.restore();
    drawFx();
    scoreTop(this.score, `ראשון ל־${VB.win} נקודות`);
    if (this.state === 'intro') banner('כדורעף', '◀ ▶ לזוז · קפיצה · "הנחתה" באוויר ליד הכדור', '#fff', 120);
    if (this.state === 'point') banner('נקודה!', pname(this.scorer), PC[this.scorer], 150);
    if (this.state === 'over') banner('סוף המשחק!', '', '#fff', 110);
    codeBadge();
  },
};
function p0kq(sc) { for (const p of sc.pl) p.kq = false; }
function drawSlime(p, b) {
  const r = VB.pr;
  ctx.beginPath(); ctx.ellipse(p.x, VB.gy + 4, r * 0.95, 12, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fill();
  ctx.beginPath(); ctx.arc(p.x, p.y, r, Math.PI, 0); ctx.closePath(); ctx.fillStyle = PC_DARK[p.i]; ctx.fill();
  ctx.beginPath(); ctx.arc(p.x, p.y - 4, r - 5, Math.PI, 0); ctx.closePath(); ctx.fillStyle = PC[p.i]; ctx.fill();
  ctx.beginPath(); ctx.ellipse(p.x - r * 0.35, p.y - r * 0.6, r * 0.22, r * 0.1, -0.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
  const d = p.i === 0 ? 1 : -1, ex = p.x + d * r * 0.42, ey = p.y - r * 0.55;
  ctx.beginPath(); ctx.arc(ex, ey, 13, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  const a = Math.atan2(b.y - ey, b.x - ex);
  ctx.beginPath(); ctx.arc(ex + Math.cos(a) * 6, ey + Math.sin(a) * 6, 6, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
  if (p.spikeT > 0) { ctx.strokeStyle = GOLD; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(p.x, p.y, r + 10, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
  txt(pname(p.i), p.x, VB.gy + 40, 22, PC_DARK[p.i], 'center', 800);
}

// ============================================================
//  משחק: פצצה חמה
// ============================================================
const BM = { x0: 80, y0: 140, x1: 1520, y1: 860, r: 34, win: 3 };
const PILLARS = [[560, 360, 46], [1040, 360, 46], [560, 640, 46], [1040, 640, 46]];
const Bomb = {
  enter() { this.score = [0, 0]; this.round = 1; this.reset(); this.state = 'intro'; this.it = 2.8; },
  reset() {
    this.p = [0, 1].map((i) => ({ i, x: i ? 1300 : 300, y: 500, vx: 0, vy: 0, face: i ? Math.PI : 0, dcd: 0, dt: 0, ddx: 0, ddy: 0, stun: 0, act: false, ai: { t: 0, sx: 0, sy: 0 } }));
    this.holder = Math.random() < 0.5 ? 0 : 1; this.fuse0 = rnd(13, 19); this.fuse = this.fuse0;
    this.passCd = 0; this.beepT = 0; this.boom = -1; this.scorch = null;
  },
  onInput(slot, d) { if (d.t === 'act' && this.p[slot]) this.p[slot].act = true; },
  avoid(me) {
    let ax = 0, ay = 0;
    for (const [px, py, pr] of PILLARS) { const dx = me.x - px, dy = me.y - py, d = Math.hypot(dx, dy) || 1; if (d < pr + 110) { const k = (pr + 110 - d) / 110; ax += dx / d * k * 1.6; ay += dy / d * k * 1.6; } }
    const m = 150;
    if (me.x < BM.x0 + m) ax += (BM.x0 + m - me.x) / m * 1.8; if (me.x > BM.x1 - m) ax -= (me.x - (BM.x1 - m)) / m * 1.8;
    if (me.y < BM.y0 + m) ay += (BM.y0 + m - me.y) / m * 1.8; if (me.y > BM.y1 - m) ay -= (me.y - (BM.y1 - m)) / m * 1.8;
    return [ax, ay];
  },
  ai(me, o, dt) {
    const A = me.ai; A.t -= dt;
    if (A.t <= 0) { A.t = rnd(0.6, 1.4); const s = Math.random() < 0.5 ? 1 : -1; A.sx = s; }
    let mx, my;
    const [ax, ay] = this.avoid(me);
    if (this.holder === me.i) {
      const tx = o.x + o.vx * 0.3, ty = o.y + o.vy * 0.3, dx = tx - me.x, dy = ty - me.y, d = Math.hypot(dx, dy) || 1;
      mx = dx / d + ax * 0.6; my = dy / d + ay * 0.6;
      if (d < 210 && me.dcd <= 0 && this.passCd <= 0 && Math.random() < 0.08) me.act = true;
    } else {
      const dx = me.x - o.x, dy = me.y - o.y, d = Math.hypot(dx, dy) || 1;
      mx = dx / d + (-dy / d) * A.sx * 0.6 + ax; my = dy / d + (dx / d) * A.sx * 0.6 + ay;
      if (d < 170 && me.dcd <= 0 && Math.random() < 0.1) me.act = true;
    }
    const m = Math.hypot(mx, my) || 1; return [mx / m, my / m];
  },
  explode() {
    const h = this.p[this.holder];
    this.boom = this.holder; this.scorch = [h.x, h.y];
    burst(h.x, h.y, '#ff6b35', 70, 750, 10, 1.1); burst(h.x, h.y, '#ffd60a', 40, 500, 8, 0.9); burst(h.x, h.y, '#333', 30, 350, 12, 1.4);
    G.shake = 26; noise(0.6, 0.6, 500); tone(70, 0.6, 'sine', 0.35, -40); toPlayer(this.holder, 'vibe', [400, 100, 400]);
    endRound(this, 1 - this.holder, `${pname(this.holder)} נשאר/ה עם הפצצה!`);
  },
  update(dt) {
    rounds(this, dt, BM.win, 'bomb');
    const live = this.state === 'play';
    if (live) {
      this.fuse -= dt; this.passCd = Math.max(0, this.passCd - dt);
      this.beepT -= dt;
      if (this.beepT <= 0) { const k = clamp(this.fuse / this.fuse0, 0, 1); this.beepT = 0.12 + 0.8 * k; tone(700 + (1 - k) * 700, 0.06, 'square', 0.04); }
      if (this.fuse <= 0) { this.explode(); }
    }
    for (const me of this.p) {
      const o = this.p[1 - me.i];
      me.dcd = Math.max(0, me.dcd - dt); me.dt = Math.max(0, me.dt - dt); me.stun = Math.max(0, me.stun - dt);
      if (this.boom === me.i) { me.vx = me.vy = 0; continue; }
      let jx = 0, jy = 0;
      if (live && me.stun <= 0) { if (isBot(me.i)) [jx, jy] = this.ai(me, o, dt); else [jx, jy] = stickOf(me.i); }
      const m = Math.min(1, Math.hypot(jx, jy));
      if (me.act) {
        me.act = false;
        if (live && me.stun <= 0 && me.dcd <= 0) {
          const a = m > 0.2 ? Math.atan2(jy, jx) : me.face;
          me.ddx = Math.cos(a); me.ddy = Math.sin(a); me.dt = 0.22; me.dcd = 1.5; me.face = a;
          SFX.whoosh(); toPlayer(me.i, 'vibe', 20);
        }
      }
      const base = (this.holder === me.i ? 370 : 335) * (isBot(me.i) ? 0.93 : 1);
      let tvx = 0, tvy = 0;
      if (me.dt > 0) { tvx = me.ddx * base * 2.6; tvy = me.ddy * base * 2.6; }
      else if (m > 0.12) { const a = Math.atan2(jy, jx); tvx = Math.cos(a) * base * m; tvy = Math.sin(a) * base * m; me.face = a; }
      const k = Math.min(1, (me.dt > 0 ? 30 : 10) * dt);
      me.vx = lerp(me.vx, tvx, k); me.vy = lerp(me.vy, tvy, k);
      me.x += me.vx * dt; me.y += me.vy * dt;
      me.x = clamp(me.x, BM.x0 + BM.r, BM.x1 - BM.r); me.y = clamp(me.y, BM.y0 + BM.r, BM.y1 - BM.r);
      for (const [px, py, pr] of PILLARS) {
        const dx = me.x - px, dy = me.y - py, d = Math.hypot(dx, dy), md = pr + BM.r;
        if (d < md && d > 0.01) { me.x = px + dx / d * md; me.y = py + dy / d * md; }
      }
      if (live && (Math.abs(me.vx) + Math.abs(me.vy) > 60) && Math.random() < 0.3) parts.push({ x: me.x + rnd(-10, 10), y: me.y + BM.r - 4, vx: 0, vy: -20, life: 0.4, max: 0.4, col: 'rgba(255,255,255,.18)', size: 4, g: 0 });
    }
    const [a, b] = this.p;
    if (this.boom < 0) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), md = BM.r * 2;
      if (d < md + 4 && live && this.passCd <= 0) {
        const nh = 1 - this.holder, newH = this.p[nh];
        this.holder = nh; this.passCd = 0.9; newH.stun = 0.4;
        SFX.hit(); G.shake = Math.max(G.shake, 7);
        burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffd60a', 16, 320, 5, 0.4);
        floatText('קיבלת פצצה!', newH.x, newH.y - 70, PC[nh], 30);
        toPlayer(nh, 'vibe', [60, 40, 60]); toPlayer(1 - nh, 'vibe', 20);
      }
      if (d < md && d > 0.01) { const k = (md - d) / 2 / d; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; }
    }
  },
  draw() {
    ctx.fillStyle = '#120f22'; ctx.fillRect(0, 0, VW, VH);
    for (let x = BM.x0; x < BM.x1; x += 80) for (let y = BM.y0; y < BM.y1; y += 80) {
      ctx.fillStyle = ((x - BM.x0) / 80 + (y - BM.y0) / 80) % 2 ? '#2a2347' : '#241e3e'; ctx.fillRect(x, y, 80, 80);
    }
    if (this.scorch) { const [x, y] = this.scorch, g = ctx.createRadialGradient(x, y, 5, x, y, 130); g.addColorStop(0, 'rgba(0,0,0,.75)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - 130, y - 130, 260, 260); }
    ctx.lineWidth = 8; ctx.strokeStyle = '#ff4d6d'; ctx.globalAlpha = 0.5; ctx.strokeRect(BM.x0 - 4, BM.y0 - 4, BM.x1 - BM.x0 + 8, BM.y1 - BM.y0 + 8); ctx.globalAlpha = 1;
    for (const [px, py, pr] of PILLARS) {
      ctx.beginPath(); ctx.ellipse(px + 6, py + 12, pr, pr * 0.9, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fillStyle = '#4a4170'; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py - 6, pr - 8, 0, Math.PI * 2); ctx.fillStyle = '#6a5fa0'; ctx.fill();
    }
    for (const me of this.p) if (this.boom !== me.i) drawRunner(me, this.holder === me.i, this.passCd);
    if (this.boom < 0) { const h = this.p[this.holder]; drawBombAt(h.x, h.y - 66, clamp(this.fuse / this.fuse0, 0, 1), G.t); }
    if (this.state === 'play' && this.fuse < 3) { const a = (0.5 + 0.5 * Math.sin(G.t * 18)) * 0.25; ctx.fillStyle = `rgba(255,30,30,${a})`; ctx.fillRect(0, 0, VW, VH); }
    drawFx();
    scoreTop(this.score, `ראשון ל־${BM.win} סיבובים`);
    roundOverlay(this, 'פצצה חמה', 'נגעו ביריב כדי להעביר לו את הפצצה · "ספרינט" לזינוק · מי שנשאר איתה – מתפוצץ!');
    codeBadge();
  },
};
function drawRunner(me, hold, passCd) {
  ctx.beginPath(); ctx.ellipse(me.x + 4, me.y + BM.r - 2, BM.r, 10, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  if (hold) { ctx.beginPath(); ctx.arc(me.x, me.y, BM.r + 10 + Math.sin(G.t * 14) * 3, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = '#ff5e3a'; ctx.stroke(); }
  if (me.stun > 0) ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.arc(me.x, me.y, BM.r, 0, Math.PI * 2); ctx.fillStyle = PC_DARK[me.i]; ctx.fill();
  ctx.beginPath(); ctx.arc(me.x, me.y - 3, BM.r - 4, 0, Math.PI * 2); ctx.fillStyle = PC[me.i]; ctx.fill();
  const fx = Math.cos(me.face), fy = Math.sin(me.face);
  for (const s of [-1, 1]) {
    const ex = me.x + fx * 14 - fy * 10 * s, ey = me.y - 6 + fy * 10 + fx * 10 * s;
    ctx.beginPath(); ctx.arc(ex, ey, 8, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex + fx * 3, ey + fy * 3, 4, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (me.dt > 0) { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 4; for (const o of [-14, 0, 14]) { ctx.beginPath(); ctx.moveTo(me.x - fx * 40 - fy * o, me.y - fy * 40 + fx * o); ctx.lineTo(me.x - fx * 75 - fy * o, me.y - fy * 75 + fx * o); ctx.stroke(); } }
  txt(pname(me.i), me.x, me.y + BM.r + 22, 18, '#fff', 'center', 800, 4);
}
function drawBombAt(x, y, k, T) {
  const pulse = 1 + (1 - k) * 0.25 * Math.max(0, Math.sin(T * (6 + (1 - k) * 20)));
  ctx.save(); ctx.translate(x, y); ctx.scale(pulse, pulse);
  ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fillStyle = k < 0.25 ? '#5a1010' : '#1b1b24'; ctx.fill();
  ctx.beginPath(); ctx.arc(-8, -8, 7, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fill();
  ctx.fillStyle = '#555'; ctx.fillRect(-6, -30, 12, 9);
  const L = 8 + 26 * k;
  ctx.strokeStyle = '#c9a46b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -30); ctx.quadraticCurveTo(L * 0.5, -30 - L * 0.4, L * 0.7, -30 - L * 0.8); ctx.stroke();
  const sx = L * 0.7, sy = -30 - L * 0.8;
  ctx.fillStyle = '#ffd60a'; star(sx, sy, 10 + Math.random() * 4, 4, 6); ctx.fill();
  ctx.fillStyle = '#ff5e3a'; star(sx, sy, 5, 2, 5); ctx.fill();
  ctx.restore();
}

// ============================================================
//  משחקי פרו – עזרים משותפים (2–4 שחקנים, אינדקס = מקום בחדר)
// ============================================================
function mpTop(sc, valFn, extra) {
  const L = sc.S, n = L.length, pw = n > 3 ? 240 : 270, gap = 14, tot = n * pw + (n - 1) * gap;
  L.forEach((s, k) => {
    const x = VW / 2 + tot / 2 - (k + 1) * pw - k * gap, dead = sc.isOut && sc.isOut(s);
    ctx.globalAlpha = dead ? 0.5 : 1;
    panel(x, 14, pw, 62, 31, 'rgba(10,12,30,.82)', COL[s]);
    ctx.beginPath(); ctx.arc(x + pw - 31, 45, 20, 0, Math.PI * 2); ctx.fillStyle = COL[s]; ctx.fill();
    txt(String(s + 1), x + pw - 31, 47, 22, '#fff', 'center', 900);
    txt(pname(s), x + pw - 60, 33, 20, '#fff', 'right', 800);
    txt(valFn(s), x + pw - 60, 59, 17, '#c9cdf0', 'right', 700);
    ctx.globalAlpha = 1;
  });
  if (extra) txt(extra, VW / 2, 96, 20, '#e3e6ff', 'center', 700, 5);
}
function steerTo(me, tx, ty, slow = 60) {
  const dx = tx - me.x, dy = ty - me.y, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / slow);
  return [dx / d * k, dy / d * k];
}
function countdown(sc, dt) {
  sc.it -= dt;
  const c = Math.ceil(sc.it);
  if (c !== sc.lastC && c <= 3 && c > 0) { sc.lastC = c; SFX.beep(); }
  if (sc.it <= 0) { sc.state = 'play'; SFX.go(); sc.goT = 0.8; if (sc.onPlay) sc.onPlay(); }
}
function introOverlay(sc, title, sub) {
  if (sc.state === 'intro') {
    ctx.fillStyle = 'rgba(5,6,15,.55)'; ctx.fillRect(0, 0, VW, VH);
    txt(title, VW / 2, VH / 2 - 120, 96, '#fff', 'center', 900, 12);
    (Array.isArray(sub) ? sub : [sub]).forEach((l, i) => txt(l, VW / 2, VH / 2 - 30 + i * 44, 28, '#e3e6ff', 'center', 700, 7));
    const c = Math.ceil(sc.it);
    if (c <= 3) txt(String(c), VW / 2, VH / 2 + 200, 110, GOLD, 'center', 900, 12);
  } else if (sc.goT > 0) { ctx.globalAlpha = Math.min(1, sc.goT * 2); txt('קדימה!', VW / 2, VH / 2, 180, '#6bff8a', 'center', 900, 16); ctx.globalAlpha = 1; }
}
function clockTxt(t) { const s = Math.ceil(Math.max(0, t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function chef(x, y, r, col, face) {
  ctx.beginPath(); ctx.ellipse(x + 4, y + r - 2, r, 9, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y - 3, r - 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fill();
  const fx = Math.cos(face), fy = Math.sin(face);
  for (const sd of [-1, 1]) {
    const ex = x + fx * r * 0.5 - fy * r * 0.36 * sd, ey = y - 4 + fy * r * 0.4 + fx * r * 0.36 * sd;
    ctx.beginPath(); ctx.arc(ex, ey, r * 0.24, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex + fx * 2.5, ey + fy * 2.5, r * 0.12, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
  }
}

function drawIconPro(id) {
  if (id === 'heist') {
    ctx.beginPath(); ctx.arc(0, 0, 44, 0, Math.PI * 2); ctx.fillStyle = '#6b7280'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 36, 0, Math.PI * 2); ctx.fillStyle = '#374151'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fillStyle = '#d1d5db'; ctx.fill();
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 5;
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + 0.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18); ctx.stroke(); }
    ctx.lineWidth = 6; ctx.lineCap = 'round';
    [['#ef4444', -16], ['#3b82f6', 0], ['#22c55e', 16]].forEach(([c, x]) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(x, 34); ctx.quadraticCurveTo(x + 10, 50, x, 62); ctx.stroke(); });
    ctx.lineCap = 'butt';
  } else if (id === 'space') {
    ctx.rotate(-0.6);
    ctx.fillStyle = '#ffb703'; ctx.beginPath(); ctx.moveTo(-24, -8); ctx.lineTo(-52, 0); ctx.lineTo(-24, 8); ctx.fill();
    ctx.beginPath(); ctx.moveTo(46, 0); ctx.lineTo(-26, -34); ctx.lineTo(-12, 0); ctx.lineTo(-26, 34); ctx.closePath(); ctx.fillStyle = '#38bdf8'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(46, 0); ctx.lineTo(-12, 0); ctx.lineTo(-26, 34); ctx.closePath(); ctx.fillStyle = '#0369a1'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(12, 0, 13, 8, 0, 0, Math.PI * 2); ctx.fillStyle = '#e0f7ff'; ctx.fill();
    ctx.fillStyle = '#fde047'; ctx.fillRect(52, -3, 22, 6);
  } else if (id === 'kitchen') {
    ctx.beginPath(); ctx.ellipse(0, 18, 46, 14, 0, Math.PI, 0); ctx.lineTo(46, 26); ctx.lineTo(-46, 26); ctx.closePath(); ctx.fillStyle = '#d99a4e'; ctx.fill();
    ctx.fillStyle = '#22c55e'; ctx.fillRect(-44, 26, 88, 8);
    ctx.fillStyle = '#7c3f1d'; rr(-42, 33, 84, 14, 7); ctx.fill();
    ctx.fillStyle = '#d99a4e'; rr(-44, 47, 88, 12, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, -14, 26, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-14, -26, 14, 0, Math.PI * 2); ctx.arc(14, -26, 14, 0, Math.PI * 2); ctx.arc(0, -36, 16, 0, Math.PI * 2); ctx.fill();
  } else if (id === 'collapse') {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if (i === 1 && j === 0) continue;
      const fall = i === 0 && j === 1;
      rr(i * 30 - 13, j * 30 - 13 + (fall ? 10 : 0), 26, 26, 6); ctx.fillStyle = fall ? 'rgba(244,114,182,.45)' : (i + j) % 2 ? '#f472b6' : '#ec4899'; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(-2, -6, 14, 0, Math.PI * 2); ctx.fillStyle = '#2ec5ff'; ctx.fill();
    ctx.globalAlpha *= 0.6; ctx.beginPath(); ctx.arc(36, -36, 12, Math.PI, 0); ctx.lineTo(48, -22); ctx.lineTo(24, -22); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.globalAlpha /= 0.6;
  } else if (id === 'paint') {
    const blob = (x, y, r, c) => { ctx.fillStyle = c; ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5, rr2 = r * (k % 2 ? 0.75 : 1.05); k ? ctx.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2) : ctx.moveTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); } ctx.closePath(); ctx.fill(); };
    blob(-14, -8, 32, '#a78bfa'); blob(22, 14, 24, '#ff4d6d'); blob(-20, 28, 14, '#5eea7a');
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-22, -16, 6, 0, Math.PI * 2); ctx.fill();
  }
}

// ============================================================
//  פרו: צבע טריטוריה
// ============================================================
const PT = { x0: 80, y0: 128, cell: 40, cols: 36, rows: 18, time: 75, r: 22 };
PT.x1 = PT.x0 + PT.cols * PT.cell; PT.y1 = PT.y0 + PT.rows * PT.cell;
const Paint = {
  enter() {
    this.S = seatsFor(2);
    this.grid = new Int8Array(PT.cols * PT.rows).fill(-1);
    this.cnt = [0, 0, 0, 0];
    this.cv = document.createElement('canvas'); this.cv.width = PT.cols * PT.cell; this.cv.height = PT.rows * PT.cell;
    this.g2 = this.cv.getContext('2d');
    const spots = [[PT.x1 - 120, PT.y0 + 120], [PT.x0 + 120, PT.y1 - 120], [PT.x0 + 120, PT.y0 + 120], [PT.x1 - 120, PT.y1 - 120]];
    this.p = {};
    this.S.forEach((s, k) => {
      const [x, y] = spots[k];
      this.p[s] = { i: s, x, y, vx: 0, vy: 0, face: 0, dash: 0, dcd: 0, stun: 0, fast: 0, ai: { t: 0, tx: x, ty: y } };
      this.paintAt(s, x, y, 3);
    });
    this.items = []; this.itemT = 6; this.time = PT.time;
    this.state = 'intro'; this.it = 4.2; this.lastC = 9; this.goT = 0; this.endT = 0;
  },
  isOut() { return false; },
  onInput(s, d) {
    const me = this.p[s];
    if (d.t === 'act' && me && this.state === 'play') this.doDash(me);
  },
  doDash(me) {
    if (me.dcd > 0 || me.stun > 0) return;
    me.dash = 0.32; me.dcd = 2.2; SFX.whoosh(); toPlayer(me.i, 'vibe', 25);
  },
  cellOf(x, y) { return [Math.floor((x - PT.x0) / PT.cell), Math.floor((y - PT.y0) / PT.cell)]; },
  paintAt(s, x, y, rad) {
    const [cx, cy] = this.cellOf(x, y), g = this.g2;
    for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
      if (i * i + j * j > rad * rad + rad * 0.6) continue;
      const X = cx + i, Y = cy + j;
      if (X < 0 || Y < 0 || X >= PT.cols || Y >= PT.rows) continue;
      const k = Y * PT.cols + X, prev = this.grid[k];
      if (prev === s) continue;
      if (prev >= 0) this.cnt[prev]--;
      this.grid[k] = s; this.cnt[s]++;
      g.fillStyle = COL[s]; g.fillRect(X * PT.cell, Y * PT.cell, PT.cell, PT.cell);
      g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(X * PT.cell + 3, Y * PT.cell + 3, PT.cell - 6, 6);
    }
  },
  ai(me, dt) {
    const a = me.ai; a.t -= dt;
    const d = Math.hypot(a.tx - me.x, a.ty - me.y);
    if (a.t <= 0 || d < 30) {
      a.t = rnd(0.9, 1.8);
      let best = null, bd = 1e9;
      for (let k = 0; k < 18; k++) {
        const X = Math.floor(Math.random() * PT.cols), Y = Math.floor(Math.random() * PT.rows), owner = this.grid[Y * PT.cols + X];
        if (owner === me.i) continue;
        const x = PT.x0 + (X + 0.5) * PT.cell, y = PT.y0 + (Y + 0.5) * PT.cell;
        const dd = Math.hypot(x - me.x, y - me.y) * (owner >= 0 ? 0.8 : 1) * rnd(0.8, 1.2);
        if (dd < bd) { bd = dd; best = [x, y]; }
      }
      if (this.items.length && Math.random() < 0.5) { const it = this.items[0]; best = [it.x, it.y]; }
      if (best) { a.tx = best[0]; a.ty = best[1]; }
    }
    if (me.dcd <= 0 && Math.random() < dt * 0.5) this.doDash(me);
    return steerTo(me, a.tx, a.ty, 40);
  },
  update(dt) {
    if (this.state === 'intro') { countdown(this, dt); return; }
    this.goT = Math.max(0, this.goT - dt);
    if (this.state === 'end') { this.endT += dt; if (this.endT > 2.5) this.finish(); return; }
    this.time -= dt;
    if (this.time <= 10 && Math.ceil(this.time) !== this.tick) { this.tick = Math.ceil(this.time); if (this.tick > 0) tone(this.tick <= 3 ? 1200 : 800, 0.08, 'square', 0.05); }
    if (this.time <= 0) { this.state = 'end'; this.endT = 0; SFX.goal(); return; }
    // פריטים: פצצת צבע / מהירות
    this.itemT -= dt;
    if (this.itemT <= 0 && this.items.length < 2) {
      this.itemT = rnd(7, 11);
      this.items.push({ x: rnd(PT.x0 + 80, PT.x1 - 80), y: rnd(PT.y0 + 80, PT.y1 - 80), k: Math.random() < 0.55 ? 'bomb' : 'fast', t: 0 });
    }
    for (const it of this.items) it.t += dt;
    for (const s of this.S) {
      const me = this.p[s];
      me.dcd = Math.max(0, me.dcd - dt); me.stun = Math.max(0, me.stun - dt); me.fast = Math.max(0, me.fast - dt);
      let [jx, jy] = isBot(s) ? this.ai(me, dt) : stickOf(s);
      if (me.stun > 0) { jx = 0; jy = 0; }
      const sp = (me.fast > 0 ? 470 : 340) * (me.dash > 0 ? 2.3 : 1);
      me.vx = lerp(me.vx, jx * sp, Math.min(1, 9 * dt)); me.vy = lerp(me.vy, jy * sp, Math.min(1, 9 * dt));
      if (me.dash > 0) { me.dash -= dt; const m = Math.hypot(me.vx, me.vy) || 1; if (m < sp * 0.6) { me.vx = Math.cos(me.face) * sp; me.vy = Math.sin(me.face) * sp; } }
      me.x = clamp(me.x + me.vx * dt, PT.x0 + PT.r, PT.x1 - PT.r); me.y = clamp(me.y + me.vy * dt, PT.y0 + PT.r, PT.y1 - PT.r);
      if (Math.hypot(me.vx, me.vy) > 30) me.face = Math.atan2(me.vy, me.vx);
      this.paintAt(s, me.x, me.y, me.dash > 0 ? 2 : 1);
      if (me.dash > 0 && Math.random() < 0.6) parts.push({ x: me.x, y: me.y, vx: rnd(-60, 60), vy: rnd(-60, 60), life: 0.4, max: 0.4, col: COL[s], size: rnd(4, 9), g: 0 });
      for (let k = this.items.length - 1; k >= 0; k--) {
        const it = this.items[k];
        if (Math.hypot(it.x - me.x, it.y - me.y) < PT.r + 22) {
          this.items.splice(k, 1);
          if (it.k === 'bomb') { this.paintAt(s, it.x, it.y, 5); burst(it.x, it.y, COL[s], 40, 520, 9, 0.7); SFX.bighit(); G.shake = 8; floatText('פצצת צבע!', it.x, it.y - 40, COL[s], 34); }
          else { me.fast = 6; tone(500, 0.4, 'sawtooth', 0.05, 700); floatText('מהירות!', it.x, it.y - 40, GOLD, 34); }
          toPlayer(s, 'vibe', 60);
        }
      }
    }
    // התנגשויות בין שחקנים, זינוק מפיל את היריב
    for (let a = 0; a < this.S.length; a++) for (let b = a + 1; b < this.S.length; b++) {
      const A = this.p[this.S[a]], B = this.p[this.S[b]], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
      if (d < PT.r * 2 && d > 0.01) {
        const nx = dx / d, ny = dy / d, push = (PT.r * 2 - d) / 2;
        A.x -= nx * push; A.y -= ny * push; B.x += nx * push; B.y += ny * push;
        if (A.dash > 0 && B.stun <= 0 && B.dash <= 0) { B.stun = 1.1; B.vx = nx * 600; B.vy = ny * 600; SFX.hit(); burst(B.x, B.y, COL[A.i], 16, 300, 6, 0.4); toPlayer(B.i, 'vibe', 200); }
        if (B.dash > 0 && A.stun <= 0 && A.dash <= 0) { A.stun = 1.1; A.vx = -nx * 600; A.vy = -ny * 600; SFX.hit(); burst(A.x, A.y, COL[B.i], 16, 300, 6, 0.4); toPlayer(A.i, 'vibe', 200); }
      }
    }
  },
  pct(s) { return Math.round(this.cnt[s] / (PT.cols * PT.rows) * 100); },
  finish() {
    const best = Math.max(...this.S.map((s) => this.cnt[s])), top = this.S.filter((s) => this.cnt[s] === best);
    const order = this.S.slice().sort((a, b) => this.cnt[b] - this.cnt[a]);
    showResults(top.length === 1 ? top[0] : -1, order.map((s) => `${pname(s)} ${this.pct(s)}%`).join(' · '), 'paint', { slots: this.S });
  },
  draw() {
    bgGrad('#1c1534', '#0a0818');
    rr(PT.x0 - 14, PT.y0 - 14, PT.x1 - PT.x0 + 28, PT.y1 - PT.y0 + 28, 22); ctx.fillStyle = '#2a2350'; ctx.fill();
    ctx.fillStyle = '#efeaf8'; ctx.fillRect(PT.x0, PT.y0, PT.x1 - PT.x0, PT.y1 - PT.y0);
    ctx.drawImage(this.cv, PT.x0, PT.y0);
    ctx.strokeStyle = 'rgba(0,0,0,.06)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 1; i < PT.cols; i++) { ctx.moveTo(PT.x0 + i * PT.cell, PT.y0); ctx.lineTo(PT.x0 + i * PT.cell, PT.y1); }
    for (let j = 1; j < PT.rows; j++) { ctx.moveTo(PT.x0, PT.y0 + j * PT.cell); ctx.lineTo(PT.x1, PT.y0 + j * PT.cell); }
    ctx.stroke();
    for (const it of this.items) {
      const b = Math.sin(it.t * 5) * 4;
      ctx.beginPath(); ctx.arc(it.x, it.y + b, 24, 0, Math.PI * 2); ctx.fillStyle = it.k === 'bomb' ? '#1b1b24' : GOLD; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
      txt(it.k === 'bomb' ? '💥' : '⚡', it.x, it.y + b + 2, 24, '#fff');
    }
    for (const s of this.S) {
      const me = this.p[s];
      if (me.stun > 0) ctx.globalAlpha = 0.55 + 0.3 * Math.sin(G.t * 30);
      chef(me.x, me.y, PT.r, COL[s], me.face);
      ctx.globalAlpha = 1;
      if (me.fast > 0) { ctx.beginPath(); ctx.arc(me.x, me.y, PT.r + 7, 0, Math.PI * 2); ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.stroke(); }
      txt(pname(s), me.x, me.y - PT.r - 16, 16, '#fff', 'center', 800, 4);
    }
    drawFx();
    // מד שטח כולל
    const tot = PT.cols * PT.rows; let x = PT.x0;
    for (const s of this.S) { const w = (PT.x1 - PT.x0) * this.cnt[s] / tot; ctx.fillStyle = COL[s]; ctx.fillRect(x, PT.y1 + 18, w, 10); x += w; }
    mpTop(this, (s) => `${this.pct(s)}% מהלוח`, `⏱ ${clockTxt(this.time)}`);
    if (this.time < 10 && this.state === 'play') txt(String(Math.ceil(this.time)), VW / 2, VH / 2, 220, 'rgba(255,255,255,.35)', 'center', 900);
    introOverlay(this, 'צבע טריטוריה', ['רוצו וצבעו את הלוח בצבע שלכם', '"זינוק" צובע רחב ומפיל יריבים · 💥 פצצת צבע · ⚡ מהירות', `מי שתופס הכי הרבה שטח אחרי ${PT.time} שניות – מנצח`]);
    if (this.state === 'end') banner('הזמן נגמר!', '', '#fff', 120);
    codeBadge();
  },
};

// ============================================================
//  פרו: הרצפה קורסת – אריחים נסדקים מתחת לרגליים, מי שנופל הופך לרוח
// ============================================================
const CL = { x0: 160, y0: 136, t: 64, cols: 20, rows: 11, r: 20, win: 2 };
CL.x1 = CL.x0 + CL.cols * CL.t; CL.y1 = CL.y0 + CL.rows * CL.t;
const Collapse = {
  enter() { this.S = seatsFor(2); this.score = [0, 0, 0, 0]; this.round = 1; this.reset(); this.state = 'intro'; this.it = 4.2; this.lastC = 9; this.goT = 0; },
  reset() {
    // 0 שלם, 1 נסדק, 2 נופל, 3 חור
    this.tile = new Uint8Array(CL.cols * CL.rows); this.tt = new Float32Array(CL.cols * CL.rows);
    const spots = [[CL.x1 - 160, CL.y0 + 140], [CL.x0 + 160, CL.y1 - 140], [CL.x0 + 160, CL.y0 + 140], [CL.x1 - 160, CL.y1 - 140]];
    this.p = {};
    this.S.forEach((s, k) => { const [x, y] = spots[k]; this.p[s] = { i: s, x, y, vx: 0, vy: 0, face: 0, z: 0, air: 0, jcd: 0, out: false, fall: 0, ghost: false, gx: x, gy: y, gcd: 1.5, stand: 0, last: -1, ai: { t: 0, tx: x, ty: y } }; });
    this.S.forEach((s) => toPlayer(s, 'mode', { ghost: false }));
    this.elapsed = 0; this.randT = 3; this.order = []; this.rt = 0; this.roundWinner = -1;
  },
  isOut(s) { return this.p[s] && this.p[s].ghost; },
  idx(x, y) { const X = Math.floor((x - CL.x0) / CL.t), Y = Math.floor((y - CL.y0) / CL.t); return X < 0 || Y < 0 || X >= CL.cols || Y >= CL.rows ? -1 : Y * CL.cols + X; },
  crack(k, delay = 0.9) { if (k >= 0 && this.tile[k] === 0) { this.tile[k] = 1; this.tt[k] = delay; } },
  onInput(s, d) {
    const me = this.p[s];
    if (d.t !== 'act' || !me || this.state !== 'play') return;
    if (me.ghost) this.ghostDrop(me);
    else if (!me.out && me.air <= 0 && me.jcd <= 0) this.jump(me);
  },
  jump(me) { me.air = 0.55; me.jcd = 1.1; tone(420, 0.15, 'triangle', 0.07, 300); toPlayer(me.i, 'vibe', 20); },
  ghostDrop(me) {
    if (me.gcd > 0) return;
    me.gcd = 2.6;
    const k = this.idx(me.gx, me.gy); if (k < 0) return;
    const X = k % CL.cols, Y = Math.floor(k / CL.cols);
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([i, j]) => { const x = X + i, y = Y + j; if (x >= 0 && y >= 0 && x < CL.cols && y < CL.rows) this.crack(y * CL.cols + x, 1.1); });
    burst(me.gx, me.gy, 'rgba(200,220,255,.8)', 14, 220, 5, 0.5); noise(0.2, 0.15, 500);
  },
  solidAt(x, y) { const k = this.idx(x, y); return k >= 0 && this.tile[k] < 2; },
  ai(me, dt) {
    const a = me.ai; a.t -= dt;
    const safe = (x, y) => { let n = 0; for (const [i, j] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = this.idx(x + i * CL.t, y + j * CL.t); if (k >= 0 && this.tile[k] === 0) n++; } return n; };
    if (a.t <= 0 || Math.hypot(a.tx - me.x, a.ty - me.y) < 20 || !this.solidAt(a.tx, a.ty)) {
      a.t = rnd(0.4, 1.0);
      let best = null, bs = -1;
      for (let k = 0; k < 14; k++) {
        const ang = Math.random() * Math.PI * 2, dist = rnd(70, 230), x = clamp(me.x + Math.cos(ang) * dist, CL.x0 + 30, CL.x1 - 30), y = clamp(me.y + Math.sin(ang) * dist, CL.y0 + 30, CL.y1 - 30);
        const sc = safe(x, y) + rnd(0, 1.2);
        if (sc > bs) { bs = sc; best = [x, y]; }
      }
      if (best) { a.tx = best[0]; a.ty = best[1]; }
    }
    // קפיצה מעל חור לפנינו
    const ax = me.x + Math.cos(me.face) * 40, ay = me.y + Math.sin(me.face) * 40;
    if (me.air <= 0 && me.jcd <= 0 && !this.solidAt(ax, ay) && this.solidAt(me.x + Math.cos(me.face) * 110, me.y + Math.sin(me.face) * 110)) this.jump(me);
    // עומד על אריח נסדק – בורח
    return steerTo(me, a.tx, a.ty, 30);
  },
  ghostAI(me, dt) {
    const alive = this.S.filter((s) => !this.p[s].out);
    if (!alive.length) return [0, 0];
    const t = this.p[alive[Math.floor((G.t * 0.3 + me.i) % alive.length)]];
    if (me.gcd <= 0 && Math.hypot(t.x - me.gx, t.y - me.gy) < 50) this.ghostDrop(me);
    return steerTo({ x: me.gx, y: me.gy }, t.x + Math.cos(t.face) * 60, t.y + Math.sin(t.face) * 60, 50);
  },
  update(dt) {
    if (this.state === 'intro') { countdown(this, dt); return; }
    this.goT = Math.max(0, this.goT - dt);
    // אריחים
    for (let k = 0; k < this.tile.length; k++) {
      if (this.tile[k] === 1) { this.tt[k] -= dt; if (this.tt[k] <= 0) { this.tile[k] = 2; this.tt[k] = 0.5; if (Math.random() < 0.3) noise(0.12, 0.05, 300); } }
      else if (this.tile[k] === 2) { this.tt[k] -= dt; if (this.tt[k] <= 0) this.tile[k] = 3; }
    }
    if (this.state === 'roundEnd') {
      this.rt -= dt;
      if (this.rt <= 0) {
        const best = Math.max(...this.S.map((s) => this.score[s]));
        if (best >= CL.win) { const w = this.S.find((s) => this.score[s] === best); showResults(w, this.S.map((s) => `${pname(s)} ${this.score[s]}`).join(' · '), 'collapse', { slots: this.S }); }
        else { this.round++; this.reset(); this.state = 'intro'; this.it = 3.2; this.lastC = 9; }
      }
    }
    if (this.state === 'play') {
      this.elapsed += dt;
      this.randT -= dt;
      if (this.randT <= 0) {   // סדקים אקראיים – מתגברים עם הזמן
        this.randT = Math.max(0.12, 1.4 - this.elapsed * 0.03);
        for (let n = 0; n < 1 + Math.floor(this.elapsed / 25); n++) this.crack(Math.floor(Math.random() * this.tile.length), 1.3);
      }
    }
    for (const s of this.S) {
      const me = this.p[s];
      if (me.ghost) {
        me.gcd = Math.max(0, me.gcd - dt);
        const [jx, jy] = this.state === 'play' ? (isBot(s) ? this.ghostAI(me, dt) : stickOf(s)) : [0, 0];
        me.gx = clamp(me.gx + jx * 430 * dt, CL.x0, CL.x1); me.gy = clamp(me.gy + jy * 430 * dt, CL.y0, CL.y1);
        continue;
      }
      if (me.out) { me.fall += dt; if (me.fall > 0.9) { me.ghost = true; me.gx = me.x; me.gy = me.y; toPlayer(s, 'mode', { ghost: true }); } continue; }
      me.jcd = Math.max(0, me.jcd - dt);
      let [jx, jy] = this.state === 'play' ? (isBot(s) ? this.ai(me, dt) : stickOf(s)) : [0, 0];
      const sp = 300;
      me.vx = lerp(me.vx, jx * sp, Math.min(1, 10 * dt)); me.vy = lerp(me.vy, jy * sp, Math.min(1, 10 * dt));
      me.x = clamp(me.x + me.vx * dt, CL.x0 + 4, CL.x1 - 4); me.y = clamp(me.y + me.vy * dt, CL.y0 + 4, CL.y1 - 4);
      if (Math.hypot(me.vx, me.vy) > 30) me.face = Math.atan2(me.vy, me.vx);
      if (me.air > 0) { me.air -= dt; me.z = Math.sin(clamp(1 - me.air / 0.55, 0, 1) * Math.PI) * 34; continue; }
      me.z = 0;
      if (this.state !== 'play') continue;
      const k = this.idx(me.x, me.y);
      if (k >= 0 && this.tile[k] === 0) { if (k !== me.last) { me.last = k; this.crack(k, 0.75); } }
      if (k < 0 || this.tile[k] >= 2) {
        me.out = true; me.fall = 0; this.order.push(s); SFX.bump(); tone(500, 0.6, 'sine', 0.08, -420); toPlayer(s, 'vibe', 300);
        floatText('נפל/ה!', me.x, me.y - 40, COL[s], 34);
      }
    }
    // דחיפה בין שחקנים חיים
    for (let a = 0; a < this.S.length; a++) for (let b = a + 1; b < this.S.length; b++) {
      const A = this.p[this.S[a]], B = this.p[this.S[b]];
      if (A.out || B.out || A.air > 0 || B.air > 0) continue;
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
      if (d < CL.r * 2 && d > 0.01) { const nx = dx / d, ny = dy / d, push = (CL.r * 2 - d) / 2; A.x -= nx * push; A.y -= ny * push; B.x += nx * push; B.y += ny * push; }
    }
    if (this.state === 'play') {
      const alive = this.S.filter((s) => !this.p[s].out);
      if (alive.length <= 1) {
        this.state = 'roundEnd'; this.rt = 2.6;
        this.roundWinner = alive.length ? alive[0] : -1;
        if (alive.length) { this.score[alive[0]]++; SFX.goal(); toPlayer(alive[0], 'vibe', [80, 40, 80]); } else tone(260, 0.5, 'triangle', 0.08);
      }
    }
  },
  draw() {
    bgGrad('#120a24', '#04030c');
    // עומק – ריק מתחת
    for (let i = 0; i < 40; i++) { const x = (i * 173) % VW, y = (i * 97 + G.t * 20 * (1 + i % 3)) % VH; ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(x, y, 2, 2); }
    for (let Y = 0; Y < CL.rows; Y++) for (let X = 0; X < CL.cols; X++) {
      const k = Y * CL.cols + X, st = this.tile[k]; if (st === 3) continue;
      let x = CL.x0 + X * CL.t, y = CL.y0 + Y * CL.t, s = 1;
      if (st === 1) { x += rnd(-1.5, 1.5) * (1 - this.tt[k]); y += rnd(-1.5, 1.5) * (1 - this.tt[k]); }
      if (st === 2) { s = clamp(this.tt[k] / 0.5, 0, 1); y += (1 - s) * 30; }
      const pad = 3 + (1 - s) * CL.t * 0.35, hue = (X + Y) % 2;
      ctx.globalAlpha = st === 2 ? s : 1;
      rr(x + pad, y + pad + 6, CL.t - pad * 2, CL.t - pad * 2, 10); ctx.fillStyle = '#3b1d52'; ctx.fill();
      rr(x + pad, y + pad, CL.t - pad * 2, CL.t - pad * 2, 10);
      ctx.fillStyle = st === 1 ? (this.tt[k] < 0.35 ? '#ff6b8f' : '#f9a8d4') : hue ? '#f472b6' : '#ec4899'; ctx.fill();
      if (st === 1) { ctx.strokeStyle = 'rgba(60,10,40,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 14, y + 12); ctx.lineTo(x + 30, y + 30); ctx.lineTo(x + 24, y + 46); ctx.moveTo(x + 30, y + 30); ctx.lineTo(x + 50, y + 26); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    for (const s of this.S) {
      const me = this.p[s];
      if (me.ghost) {
        ctx.globalAlpha = 0.5 + 0.15 * Math.sin(G.t * 4 + s);
        ctx.beginPath(); ctx.arc(me.gx, me.gy - 6, 22, Math.PI, 0); ctx.lineTo(me.gx + 22, me.gy + 16);
        for (let w = 0; w < 4; w++) ctx.lineTo(me.gx + 22 - (w + 0.5) * 11, me.gy + (w % 2 ? 16 : 8));
        ctx.lineTo(me.gx - 22, me.gy + 16); ctx.closePath(); ctx.fillStyle = COL[s]; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(me.gx - 8, me.gy - 6, 5, 0, Math.PI * 2); ctx.arc(me.gx + 8, me.gy - 6, 5, 0, Math.PI * 2); ctx.fill();
        if (me.gcd <= 0) { ctx.beginPath(); ctx.arc(me.gx, me.gy, 32, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]); }
        ctx.globalAlpha = 1; continue;
      }
      if (me.out) { const k = Math.max(0.05, 1 - me.fall); ctx.globalAlpha = k; ctx.save(); ctx.translate(me.x, me.y + me.fall * 40); ctx.scale(k, k); chef(0, 0, CL.r, COL[s], me.face); ctx.restore(); ctx.globalAlpha = 1; continue; }
      if (me.z > 0) { ctx.beginPath(); ctx.ellipse(me.x, me.y + CL.r, CL.r * (1 - me.z / 80), 7, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill(); }
      chef(me.x, me.y - me.z, CL.r, COL[s], me.face);
      txt(pname(s), me.x, me.y - me.z - CL.r - 14, 15, '#fff', 'center', 800, 4);
    }
    drawFx();
    mpTop(this, (s) => (this.p[s].ghost ? `👻 רוח · ${this.score[s]} נק׳` : `${this.score[s]} נקודות`), `סיבוב ${this.round} · ראשון ל־${CL.win}`);
    introOverlay(this, this.round === 1 ? 'הרצפה קורסת' : `סיבוב ${this.round}`, this.round === 1 ? ['כל אריח שדורכים עליו נסדק ונופל', '"קפיצה" מעל חורים · מי שנופל הופך לרוח ומפיל אריחים לאחרים', 'אחרון שנשאר על הרצפה – לוקח את הסיבוב'] : '');
    if (this.state === 'roundEnd') {
      if (this.roundWinner >= 0) banner(`${pname(this.roundWinner)} שרד/ה!`, '', COL[this.roundWinner], 90);
      else banner('כולם נפלו!', '', '#fff', 100);
    }
    codeBadge();
  },
};

// ============================================================
//  פרו: קרב חלליות – ביחד נגד גלי אויבים ובוס, אבל רק אחד מסיים עם הכי הרבה נקודות
// ============================================================
const SP = { y0: 110, r: 20, waves: 6 };
const SP_WAVES = [
  { drone: 6 },
  { drone: 8, shooter: 2 },
  { rock: 4, drone: 4 },
  { dart: 6, shooter: 3 },
  { drone: 10, rock: 3, shooter: 2, dart: 4 },
  { boss: 1 },
];
const SP_EN = {
  drone: { r: 16, hp: 1, pts: 10, col: '#f87171' },
  shooter: { r: 22, hp: 3, pts: 25, col: '#fbbf24' },
  rock: { r: 40, hp: 4, pts: 15, col: '#94a3b8' },
  rock2: { r: 22, hp: 2, pts: 8, col: '#94a3b8' },
  dart: { r: 14, hp: 1, pts: 20, col: '#e879f9' },
  boss: { r: 92, hp: 1, pts: 500, col: '#ef4444' },
};
const Space = {
  enter() {
    this.S = seatsFor(1);
    const n = this.S.length;
    this.ships = {};
    this.S.forEach((s, k) => { this.ships[s] = { i: s, x: VW / 2 + (k - (n - 1) / 2) * 140, y: VH - 140, vx: 0, vy: 0, ang: -Math.PI / 2, hp: 3, inv: 2, dead: false, respT: 0, score: 0, kills: 0, charge: 0.3, laser: 0, triple: 0, fireT: 0, sentC: -1 }; });
    this.en = []; this.bul = []; this.eb = []; this.ups = []; this.queue = []; this.spawnT = 0;
    this.wave = 0; this.waveT = 0; this.boss = null; this.stars = Array.from({ length: 90 }, () => [rnd(0, VW), rnd(0, VH), rnd(0.3, 1.6)]);
    this.state = 'intro'; this.it = 4.2; this.lastC = 9; this.goT = 0; this.endT = 0; this.won = false;
  },
  onPlay() { this.nextWave(); },
  isOut(s) { return this.ships[s] && this.ships[s].dead; },
  onJoin(s) {
    if (this.ships[s] || this.S.length >= 4) return;
    this.S.push(s); this.S.sort((a, b) => a - b);
    this.ships[s] = { i: s, x: VW / 2, y: VH - 140, vx: 0, vy: 0, ang: -Math.PI / 2, hp: 3, inv: 2, dead: false, respT: 0, score: 0, kills: 0, charge: 0.3, laser: 0, triple: 0, fireT: 0, sentC: -1 };
  },
  onInput(s, d) {
    const sh = this.ships[s];
    if (d.t === 'act' && sh && !sh.dead && this.state === 'play') this.fireLaser(sh);
  },
  fireLaser(sh) {
    if (sh.charge < 1 || sh.laser > 0) return;
    sh.charge = 0; sh.laser = 1.1; G.shake = 6; tone(140, 1.1, 'sawtooth', 0.07, 400); toPlayer(sh.i, 'vibe', [60, 30, 60, 30, 60]);
    floatText('מגה־לייזר!', sh.x, sh.y - 50, COL[sh.i], 32);
  },
  nextWave() {
    this.wave++; this.waveT = 2.2;
    const W = SP_WAVES[this.wave - 1], k = 0.7 + 0.3 * this.S.length;
    for (const t in W) {
      if (t === 'boss') continue;
      for (let i = 0; i < Math.round(W[t] * k); i++) this.queue.push(t);
    }
    this.queue.sort(() => Math.random() - 0.5);
    if (W.boss) {
      const hp = Math.round(240 * (0.6 + 0.4 * this.S.length));
      this.boss = { t: 'boss', x: VW / 2, y: -120, ty: 250, r: SP_EN.boss.r, hp, max: hp, vx: 140, ft: 2, ft2: 1, ft3: 3, ang: 0, flash: 0 };
      this.en.push(this.boss); tone(80, 1.5, 'sawtooth', 0.1, 40);
    }
  },
  spawn(t) {
    const side = Math.floor(Math.random() * 3), d = SP_EN[t];
    const x = side === 0 ? rnd(80, VW - 80) : side === 1 ? -40 : VW + 40, y = side === 0 ? SP.y0 - 30 : rnd(SP.y0 + 40, VH * 0.55);
    const e = { t, x, y, vx: 0, vy: 0, r: d.r, hp: d.hp, ft: rnd(1, 2.4), flash: 0, ph: rnd(0, 6), dash: 0 };
    if (t === 'rock' || t === 'rock2') { const a = Math.atan2(VH / 2 - y, VW / 2 - x) + rnd(-0.5, 0.5); e.vx = Math.cos(a) * 110; e.vy = Math.sin(a) * 110; }
    this.en.push(e);
  },
  nearestShip(x, y) {
    let b = null, bd = 1e9;
    for (const s of this.S) { const sh = this.ships[s]; if (sh.dead) continue; const d = Math.hypot(sh.x - x, sh.y - y); if (d < bd) { bd = d; b = sh; } }
    return b;
  },
  nearestEnemy(x, y, max = 1e9) {
    let b = null, bd = max;
    for (const e of this.en) { if (e.y < SP.y0 - 10 && e.t !== 'boss') continue; const d = Math.hypot(e.x - x, e.y - y) - e.r; if (d < bd) { bd = d; b = e; } }
    return b;
  },
  hitShip(sh) {
    if (sh.dead || sh.inv > 0) return;
    sh.hp--; sh.inv = 1.6; SFX.hit(); G.shake = Math.max(G.shake, 7); toPlayer(sh.i, 'vibe', 220); burst(sh.x, sh.y, COL[sh.i], 18, 300, 5, 0.5);
    if (sh.hp <= 0) { sh.dead = true; sh.respT = 6; burst(sh.x, sh.y, '#fff', 40, 500, 7, 0.9); SFX.bighit(); floatText('הושמד!', sh.x, sh.y - 40, COL[sh.i], 32); }
  },
  killEnemy(e, by) {
    const d = SP_EN[e.t];
    burst(e.x, e.y, d.col, e.t === 'boss' ? 120 : 16, e.t === 'boss' ? 900 : 320, e.t === 'boss' ? 12 : 5, e.t === 'boss' ? 1.6 : 0.5);
    noise(e.t === 'boss' ? 1 : 0.15, e.t === 'boss' ? 0.5 : 0.18, e.t === 'boss' ? 400 : 1300);
    const sh = this.ships[by];
    if (sh) { sh.score += d.pts; sh.kills++; sh.charge = Math.min(1, sh.charge + (e.t === 'rock2' ? 0.05 : 0.1)); floatText(`+${d.pts}`, e.x, e.y - 20, COL[by], 24); }
    if (e.t === 'rock') for (let k = 0; k < 2; k++) { const a = rnd(0, Math.PI * 2); this.en.push({ t: 'rock2', x: e.x, y: e.y, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170, r: SP_EN.rock2.r, hp: SP_EN.rock2.hp, ft: 9, flash: 0, ph: 0 }); }
    if (e.t !== 'boss' && Math.random() < 0.09) this.ups.push({ x: e.x, y: e.y, k: Math.random() < 0.5 ? 'heart' : 'triple', t: 0 });
    if (e.t === 'boss') { this.boss = null; this.won = true; this.state = 'end'; this.endT = 0; G.slowT = 1.2; SFX.win(); }
  },
  damage(e, dmg, by) {
    if (e.hp <= 0) return;
    e.hp -= dmg; e.flash = 0.08;
    if (e.t === 'boss' && this.ships[by]) { this.ships[by].score += Math.round(dmg * 2); this.ships[by].charge = Math.min(1, this.ships[by].charge + dmg * 0.004); }
    if (e.hp <= 0) this.killEnemy(e, by);
  },
  shipAI(sh, dt) {
    const e = this.nearestEnemy(sh.x, sh.y);
    let tx = VW / 2, ty = VH - 180;
    if (e) { const a = Math.atan2(sh.y - e.y, sh.x - e.x) + Math.sin(G.t * 0.7 + sh.i) * 0.8, dd = e.t === 'boss' ? 420 : 300; tx = e.x + Math.cos(a) * dd; ty = e.y + Math.sin(a) * dd; }
    for (const b of this.eb) {
      const dx = sh.x - b.x, dy = sh.y - b.y, d = Math.hypot(dx, dy);
      if (d < 140 && dx * b.vx + dy * b.vy > 0) { tx = sh.x - b.vy * 0.5; ty = sh.y + b.vx * 0.5; break; }
    }
    tx = clamp(tx, 60, VW - 60); ty = clamp(ty, SP.y0 + 60, VH - 60);
    if (sh.charge >= 1 && (this.boss || this.en.length >= 4)) this.fireLaser(sh);
    return steerTo(sh, tx, ty, 80);
  },
  update(dt) {
    for (const st of this.stars) { st[1] += st[2] * 60 * dt; if (st[1] > VH) { st[1] = 0; st[0] = rnd(0, VW); } }
    if (this.state === 'intro') { countdown(this, dt); return; }
    this.goT = Math.max(0, this.goT - dt);
    if (this.state === 'end') { this.endT += dt; updShots(this, dt); if (this.endT > 3) this.finish(); return; }
    this.waveT = Math.max(0, this.waveT - dt);
    // הזמנת אויבים
    this.spawnT -= dt;
    if (this.queue.length && this.spawnT <= 0 && this.waveT < 1.2) { this.spawnT = this.wave >= 5 ? 0.35 : 0.55; this.spawn(this.queue.shift()); }
    if (!this.queue.length && !this.en.length && this.wave < SP.waves) this.nextWave();
    // ספינות
    for (const s of this.S) {
      const sh = this.ships[s];
      if (sh.dead) {
        sh.respT -= dt;
        if (sh.respT <= 0 && this.S.some((o) => !this.ships[o].dead)) { sh.dead = false; sh.hp = 2; sh.inv = 2.5; sh.x = VW / 2; sh.y = VH - 140; sh.vx = sh.vy = 0; floatText('חזר/ה!', sh.x, sh.y - 40, COL[s], 30); }
        continue;
      }
      sh.inv = Math.max(0, sh.inv - dt); sh.triple = Math.max(0, sh.triple - dt);
      const [jx, jy] = isBot(s) ? this.shipAI(sh, dt) : stickOf(s);
      sh.vx = lerp(sh.vx, jx * 460, Math.min(1, 6 * dt)); sh.vy = lerp(sh.vy, jy * 460, Math.min(1, 6 * dt));
      sh.x = clamp(sh.x + sh.vx * dt, 30, VW - 30); sh.y = clamp(sh.y + sh.vy * dt, SP.y0 + 30, VH - 30);
      const tgt = this.nearestEnemy(sh.x, sh.y, 950);
      const want = tgt ? Math.atan2(tgt.y - sh.y, tgt.x - sh.x) : Math.hypot(sh.vx, sh.vy) > 60 ? Math.atan2(sh.vy, sh.vx) : sh.ang;
      if (sh.laser <= 0) sh.ang += wrapAng(want - sh.ang) * Math.min(1, 10 * dt);
      else sh.ang += wrapAng(want - sh.ang) * Math.min(1, 1.6 * dt);
      sh.fireT -= dt;
      if (tgt && sh.fireT <= 0 && sh.laser <= 0) {
        sh.fireT = 0.17;
        const spr = sh.triple > 0 ? [-0.18, 0, 0.18] : [0];
        for (const o of spr) this.bul.push({ x: sh.x + Math.cos(sh.ang) * 24, y: sh.y + Math.sin(sh.ang) * 24, vx: Math.cos(sh.ang + o) * 920, vy: Math.sin(sh.ang + o) * 920, by: s, life: 1.2 });
        if (Math.random() < 0.35) tone(1300 + s * 120, 0.03, 'square', 0.015);
      }
      if (sh.laser > 0) {
        sh.laser -= dt;
        const cx = Math.cos(sh.ang), cy = Math.sin(sh.ang);
        for (const e of this.en.slice()) {
          const ex = e.x - sh.x, ey = e.y - sh.y, along = ex * cx + ey * cy, perp = Math.abs(ex * -cy + ey * cx);
          if (along > 0 && perp < e.r + 16) this.damage(e, 22 * dt, s);
        }
        this.eb = this.eb.filter((b) => { const ex = b.x - sh.x, ey = b.y - sh.y; return !(ex * cx + ey * cy > 0 && Math.abs(ex * -cy + ey * cx) < 26); });
      }
      const q = Math.floor(sh.charge * 10); if (q !== sh.sentC) { sh.sentC = q; toPlayer(s, 'boost', { v: sh.charge }); }
      for (let k = this.ups.length - 1; k >= 0; k--) {
        const u = this.ups[k];
        if (Math.hypot(u.x - sh.x, u.y - sh.y) < 40) {
          this.ups.splice(k, 1); SFX.join(); toPlayer(s, 'vibe', 40);
          if (u.k === 'heart') { sh.hp = Math.min(5, sh.hp + 1); floatText('+❤', u.x, u.y - 30, '#ff6b8f', 30); } else { sh.triple = 9; floatText('ירי משולש!', u.x, u.y - 30, GOLD, 28); }
        }
      }
    }
    for (const u of this.ups) { u.t += dt; u.y += 40 * dt; }
    this.ups = this.ups.filter((u) => u.t < 9 && u.y < VH + 30);
    // אויבים
    for (const e of this.en) {
      e.flash = Math.max(0, e.flash - dt);
      const tgt = this.nearestShip(e.x, e.y);
      if (e.t === 'drone') {
        if (tgt) { const a = Math.atan2(tgt.y - e.y, tgt.x - e.x) + Math.sin(G.t * 3 + e.ph) * 0.4; e.vx = lerp(e.vx, Math.cos(a) * 170, 2 * dt); e.vy = lerp(e.vy, Math.sin(a) * 170, 2 * dt); }
      } else if (e.t === 'shooter') {
        if (tgt) {
          const a = Math.atan2(e.y - tgt.y, e.x - tgt.x) + e.ph, tx = tgt.x + Math.cos(a) * 380, ty = clamp(tgt.y + Math.sin(a) * 380, SP.y0 + 40, VH - 60);
          e.ph += dt * 0.5; e.vx = lerp(e.vx, (tx - e.x) * 1.2, 2 * dt); e.vy = lerp(e.vy, (ty - e.y) * 1.2, 2 * dt);
          e.ft -= dt;
          if (e.ft <= 0) { e.ft = rnd(1.6, 2.4); const b = Math.atan2(tgt.y - e.y, tgt.x - e.x); this.eb.push({ x: e.x, y: e.y, vx: Math.cos(b) * 330, vy: Math.sin(b) * 330, r: 8 }); tone(300, 0.08, 'square', 0.03); }
        }
      } else if (e.t === 'dart') {
        e.ft -= dt;
        if (e.dash > 0) e.dash -= dt; else { e.vx *= 1 - 3 * dt; e.vy *= 1 - 3 * dt; }
        if (e.ft <= 0 && tgt) { e.ft = rnd(1.4, 2.2); e.dash = 0.6; const a = Math.atan2(tgt.y - e.y, tgt.x - e.x); e.vx = Math.cos(a) * 520; e.vy = Math.sin(a) * 520; SFX.whoosh(); }
        else if (e.dash <= 0 && (e.x < 0 || e.x > VW || e.y < SP.y0)) { e.vx = (VW / 2 - e.x) * 0.8; e.vy = (VH / 2 - e.y) * 0.8; }
      } else if (e.t === 'rock' || e.t === 'rock2') {
        if (e.x < e.r && e.vx < 0 || e.x > VW - e.r && e.vx > 0) { if (e.x > -20 && e.x < VW + 20) e.vx *= -1; }
        if (e.y < SP.y0 + e.r && e.vy < 0 && e.y > SP.y0 - 20 || e.y > VH - e.r && e.vy > 0) e.vy *= -1;
        e.ph += dt;
      } else if (e.t === 'boss') this.bossAI(e, dt, tgt);
      if (e.t !== 'boss') { e.x += e.vx * dt; e.y += e.vy * dt; }
      // מגע עם ספינה
      for (const s of this.S) { const sh = this.ships[s]; if (!sh.dead && Math.hypot(sh.x - e.x, sh.y - e.y) < e.r + SP.r - 4) { this.hitShip(sh); if (e.t !== 'boss' && e.t !== 'rock') { e.hp = 0; burst(e.x, e.y, SP_EN[e.t].col, 14, 300, 5, 0.4); } } }
    }
    this.en = this.en.filter((e) => e.hp > 0 && e.x > -300 && e.x < VW + 300 && e.y < VH + 300);
    updShots(this, dt);
    // כולם הושמדו
    if (this.S.every((s) => this.ships[s].dead)) { this.state = 'end'; this.endT = 0; this.won = false; tone(200, 1.2, 'sawtooth', 0.08, -150); }
  },
  bossAI(b, dt, tgt) {
    b.y = lerp(b.y, b.ty, 1.5 * dt);
    b.x += b.vx * dt; if (b.x < 220 || b.x > VW - 220) b.vx *= -1;
    b.ang += dt * (b.hp < b.max * 0.33 ? 2.2 : 0.8);
    const k = b.hp / b.max, n = this.S.length;
    b.ft -= dt; b.ft2 -= dt; b.ft3 -= dt;
    if (b.y < b.ty - 30) return;
    if (b.ft <= 0) { b.ft = k > 0.33 ? 2.3 : 3; const N = 14 + n * 2; for (let i = 0; i < N; i++) { const a = b.ang + i * Math.PI * 2 / N; this.eb.push({ x: b.x, y: b.y, vx: Math.cos(a) * 250, vy: Math.sin(a) * 250, r: 9 }); } noise(0.2, 0.15, 600); }
    if (k < 0.66 && b.ft2 <= 0 && tgt) { b.ft2 = 1.3; const a0 = Math.atan2(tgt.y - b.y, tgt.x - b.x); for (let i = -2; i <= 2; i++) this.eb.push({ x: b.x, y: b.y + 40, vx: Math.cos(a0 + i * 0.16) * 380, vy: Math.sin(a0 + i * 0.16) * 380, r: 8 }); tone(240, 0.1, 'square', 0.04); }
    if (k < 0.33) {
      if (Math.random() < dt * 7) { const a = b.ang * 2.3; this.eb.push({ x: b.x, y: b.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, r: 7 }); }
      if (b.ft3 <= 0) { b.ft3 = 4.5; for (let i = 0; i < n + 1; i++) this.spawn('drone'); }
    }
  },
  finish() {
    const sc = (s) => this.ships[s].score, best = Math.max(...this.S.map(sc)), top = this.S.filter((s) => sc(s) === best);
    const scores = this.S.slice().sort((a, b) => sc(b) - sc(a)).map((s) => `${pname(s)} ${sc(s)}`).join(' · ');
    showResults(top.length === 1 ? top[0] : -1, (this.won ? 'הבוס הובס! · ' : `הצי הושמד בגל ${this.wave} · `) + scores, 'space', { slots: this.S });
  },
  draw() {
    bgGrad('#060a1f', '#02030a');
    for (const [x, y, z] of this.stars) { ctx.globalAlpha = 0.25 + z * 0.4; ctx.fillStyle = '#fff'; ctx.fillRect(x, y, z * 1.6, z * 1.6); }
    ctx.globalAlpha = 1;
    const neb = ctx.createRadialGradient(1200, 300, 20, 1200, 300, 500); neb.addColorStop(0, 'rgba(56,189,248,.10)'); neb.addColorStop(1, 'rgba(56,189,248,0)'); ctx.fillStyle = neb; ctx.fillRect(0, 0, VW, VH);
    for (const u of this.ups) { const bb = Math.sin(u.t * 6) * 3; ctx.beginPath(); ctx.arc(u.x, u.y + bb, 20, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fill(); ctx.strokeStyle = u.k === 'heart' ? '#ff6b8f' : GOLD; ctx.lineWidth = 3; ctx.stroke(); txt(u.k === 'heart' ? '❤' : '✦', u.x, u.y + bb + 2, 22, u.k === 'heart' ? '#ff6b8f' : GOLD); }
    for (const e of this.en) drawEnemy(e);
    for (const b of this.bul) { ctx.strokeStyle = COL[b.by]; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022); ctx.stroke(); }
    for (const b of this.eb) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fillStyle = '#ff4d4d'; ctx.fill(); ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2); ctx.fillStyle = '#ffe1e1'; ctx.fill(); }
    for (const s of this.S) {
      const sh = this.ships[s];
      if (sh.laser > 0) {
        const cx = Math.cos(sh.ang), cy = Math.sin(sh.ang), w = 18 + Math.sin(G.t * 60) * 5;
        ctx.save(); ctx.globalAlpha = Math.min(1, sh.laser * 3);
        ctx.lineCap = 'round'; ctx.strokeStyle = COL[s]; ctx.lineWidth = w * 2; ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(sh.x + cx * 2000, sh.y + cy * 2000); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = w * 0.7; ctx.stroke(); ctx.restore();
      }
      if (sh.dead) { if (this.S.some((o) => !this.ships[o].dead)) txt(`${pname(s)} חוזר/ת בעוד ${Math.ceil(sh.respT)}`, VW / 2, VH - 30 - this.S.indexOf(s) * 26, 18, COL[s], 'center', 700, 4); continue; }
      if (sh.inv > 0 && Math.floor(G.t * 16) % 2) ctx.globalAlpha = 0.4;
      drawShip(sh.x, sh.y, sh.ang, COL[s], COL_DARK[s], Math.hypot(sh.vx, sh.vy) > 80);
      ctx.globalAlpha = 1;
      txt('❤'.repeat(Math.max(0, sh.hp)), sh.x, sh.y + 38, 13, '#ff6b8f', 'center', 700);
      bar(sh.x - 24, sh.y + 50, 48, 5, sh.charge, sh.charge >= 1 ? GOLD : 'rgba(255,214,10,.5)');
    }
    drawFx();
    if (this.boss) { const b = this.boss; panel(VW / 2 - 400, 96, 800, 26, 13, 'rgba(0,0,0,.6)', 'rgba(255,255,255,.2)'); bar(VW / 2 - 396, 100, 792, 18, b.hp / b.max, '#ef4444', 'rgba(0,0,0,0)'); txt('ספינת האם', VW / 2, 109, 15, '#fff', 'center', 800, 4); }
    mpTop(this, (s) => `${this.ships[s].score} נק׳ · ${this.ships[s].kills} הפלות`, this.boss ? '' : `גל ${this.wave}/${SP.waves}`);
    if (this.waveT > 0 && this.state === 'play') { ctx.globalAlpha = Math.min(1, this.waveT); banner(this.wave === SP.waves ? '⚠ הבוס מגיע!' : `גל ${this.wave}`, this.wave === SP.waves ? 'כולם ביחד – ירו בה!' : '', this.wave === SP.waves ? '#ff6b6b' : '#fff', 110); ctx.globalAlpha = 1; }
    introOverlay(this, 'קרב חלליות', ['זזים עם הג׳ויסטיק – הספינה יורה לבד על האויב הקרוב', 'כל הפלה ממלאת את ה"לייזר" · מלא? לחצו והשמידו הכול', `${SP.waves - 1} גלים ואז ספינת האם · מי שצובר הכי הרבה נקודות – מנצח`]);
    if (this.state === 'end') banner(this.won ? 'ניצחון!' : 'הצי הושמד…', this.won ? 'ספינת האם הובסה' : '', this.won ? GOLD : '#ff6b6b', 130);
    codeBadge();
  },
};
function updShots(sc, dt) {
  for (const b of sc.bul) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    for (const e of sc.en) if (e.hp > 0 && Math.hypot(e.x - b.x, e.y - b.y) < e.r + 4) { sc.damage(e, 1, b.by); b.life = 0; if (Math.random() < 0.5) burst(b.x, b.y, '#fff', 3, 120, 3, 0.2); break; }
  }
  sc.bul = sc.bul.filter((b) => b.life > 0 && b.x > -20 && b.x < VW + 20 && b.y > 60 && b.y < VH + 20);
  for (const b of sc.eb) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (sc.state === 'play') for (const s of sc.S) { const sh = sc.ships[s]; if (!sh.dead && Math.hypot(sh.x - b.x, sh.y - b.y) < SP.r * 0.7 + b.r) { sc.hitShip(sh); b.x = -999; } }
  }
  sc.eb = sc.eb.filter((b) => b.x > -30 && b.x < VW + 30 && b.y > 60 && b.y < VH + 30);
}
function drawShip(x, y, a, col, dark, thrust) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  if (thrust) { ctx.fillStyle = Math.random() < 0.5 ? '#ffb703' : '#ff5e3a'; ctx.beginPath(); ctx.moveTo(-16, -7); ctx.lineTo(-30 - Math.random() * 14, 0); ctx.lineTo(-16, 7); ctx.fill(); }
  ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(-16, -20); ctx.lineTo(-8, 0); ctx.lineTo(-16, 20); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(-8, 0); ctx.lineTo(-16, 20); ctx.closePath(); ctx.fillStyle = dark; ctx.fill();
  ctx.beginPath(); ctx.ellipse(6, 0, 8, 5, 0, 0, Math.PI * 2); ctx.fillStyle = '#d6f3ff'; ctx.fill();
  ctx.restore();
}
function drawEnemy(e) {
  const d = SP_EN[e.t], col = e.flash > 0 ? '#fff' : d.col;
  ctx.save(); ctx.translate(e.x, e.y);
  if (e.t === 'drone') { ctx.rotate(G.t * 3 + e.ph); ctx.fillStyle = col; polygon(0, 0, e.r, 4); ctx.fill(); ctx.fillStyle = '#3b0a0a'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); }
  else if (e.t === 'shooter') { ctx.fillStyle = col; polygon(0, 0, e.r, 6, G.t); ctx.fill(); ctx.fillStyle = '#4a2a00'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(0, 0, 4 + Math.sin(G.t * 8) * 2, 0, Math.PI * 2); ctx.fill(); }
  else if (e.t === 'dart') { ctx.rotate(Math.atan2(e.vy, e.vx)); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(e.r + 6, 0); ctx.lineTo(-e.r, -e.r); ctx.lineTo(-e.r * 0.4, 0); ctx.lineTo(-e.r, e.r); ctx.closePath(); ctx.fill(); }
  else if (e.t === 'rock' || e.t === 'rock2') { ctx.rotate(e.ph); ctx.fillStyle = e.flash > 0 ? '#fff' : '#64748b'; polygon(0, 0, e.r, 7); ctx.fill(); ctx.fillStyle = col; polygon(-3, -3, e.r * 0.82, 7); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.arc(e.r * 0.3, e.r * 0.2, e.r * 0.22, 0, Math.PI * 2); ctx.fill(); }
  else if (e.t === 'boss') {
    ctx.fillStyle = e.flash > 0 ? '#fff' : '#7f1d1d'; polygon(0, 0, e.r + 14, 8, e.ang * 0.3); ctx.fill();
    ctx.fillStyle = col; polygon(0, 0, e.r, 8, -e.ang * 0.3); ctx.fill();
    for (let i = 0; i < 6; i++) { const a = e.ang + i * Math.PI / 3; ctx.fillStyle = '#fca5a5'; ctx.beginPath(); ctx.arc(Math.cos(a) * 62, Math.sin(a) * 62, 10, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI * 2); ctx.fillStyle = '#1a0505'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 18 + Math.sin(G.t * 6) * 4, 0, Math.PI * 2); ctx.fillStyle = '#ff2d2d'; ctx.fill();
  }
  ctx.restore();
}

// ============================================================
//  פרו: המטבח המטורף – שיתופי. חותכים, מבשלים, מרכיבים צלחות ומגישים לפני שההזמנה נגמרת
// ============================================================
const KT = { x0: 200, y0: 156, t: 80, r: 25, time: 180 };
const KMAP = [
  'CTCLCCBCMCCPWWC',
  'C.............X',
  'K.............S',
  'C...CCC..CCC..C',
  'K.............S',
  'C.............C',
  'C...CCC..CCC..C',
  'C.............C',
  'CCCCCCCCCCCCCCC',
];
const KCRATE = { T: 'tomato', L: 'lettuce', B: 'bread', M: 'meat' };
const KNAME = { tomato: 'עגבנייה', lettuce: 'חסה', bread: 'לחמנייה', meat: 'קציצה' };
const KRECIPES = {
  salad: { name: 'סלט', need: ['lettuce', 'tomato'], pts: 30, time: 70 },
  burger: { name: 'המבורגר', need: ['bread', 'meat'], pts: 40, time: 75 },
  deluxe: { name: 'המבורגר מלא', need: ['bread', 'lettuce', 'meat', 'tomato'], pts: 75, time: 95 },
};
const plateOK = (ing) => (ing.k === 'tomato' || ing.k === 'lettuce') ? ing.st === 'chopped' : ing.k === 'meat' ? ing.st === 'cooked' : ing.k === 'bread';
const Kitchen = {
  enter() {
    this.S = seatsFor(1);
    this.st = []; this.solid = [];
    KMAP.forEach((row, Y) => [...row].forEach((c, X) => {
      if (c === '.') return;
      const s = { c, X, Y, x: KT.x0 + X * KT.t, y: KT.y0 + Y * KT.t, item: null, prog: 0 };
      this.st.push(s); this.solid.push([s.x, s.y, KT.t, KT.t]);
    }));
    const spawn = [[7, 2], [7, 4], [6, 5], [8, 5]];
    this.p = {};
    this.S.forEach((s, k) => this.addChef(s, spawn[k]));
    this.orders = []; this.orderT = 4; this.score = 0; this.served = 0; this.missed = 0; this.time = KT.time;
    this.state = 'intro'; this.it = 5.2; this.lastC = 9; this.goT = 0; this.endT = 0; this.pops = [];
    const n = this.S.length, f = [0.6, 0.85, 1, 1.1][Math.min(3, n - 1)];
    this.stars = [60, 140, 230].map((v) => Math.round(v * f / 10) * 10);
  },
  addChef(s, [X, Y]) { this.p[s] = { i: s, x: KT.x0 + (X + 0.5) * KT.t, y: KT.y0 + (Y + 0.5) * KT.t, vx: 0, vy: 0, face: -Math.PI / 2, hold: null }; },
  onJoin(s) { if (this.p[s] || this.state === 'end') return; this.S.push(s); this.S.sort((a, b) => a - b); this.addChef(s, [7, 5]); },
  onPlay() { this.newOrder(); this.orderT = 8; },
  newOrder() {
    const pool = this.time < KT.time - 50 ? ['salad', 'burger', 'burger', 'deluxe', 'salad', 'deluxe'] : ['salad', 'burger'];
    const k = pool[Math.floor(Math.random() * pool.length)], R = KRECIPES[k];
    const tm = R.time + (this.S.length === 1 ? 15 : 0);
    this.orders.push({ k, t: tm, max: tm, id: Math.random() });
    tone(880, 0.1, 'triangle', 0.06); setTimeout(() => tone(1175, 0.15, 'triangle', 0.06), 110);
  },
  stationFor(me) {
    const fx = me.x + Math.cos(me.face) * 56, fy = me.y + Math.sin(me.face) * 56;
    let best = null, bd = 1e9;
    for (const s of this.st) {
      const cx = s.x + KT.t / 2, cy = s.y + KT.t / 2, dMe = Math.hypot(cx - me.x, cy - me.y);
      if (dMe > KT.t * 1.05) continue;
      const d = Math.hypot(cx - fx, cy - fy);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  },
  addTo(plate, ing) {
    if (!plate || plate.k !== 'plate' || !ing || ing.k === 'plate' || !plateOK(ing)) return false;
    if (plate.items.some((x) => x.k === ing.k) || plate.items.length >= 4) return false;
    plate.items.push(ing); return true;
  },
  onInput(s, d) {
    if (d.t !== 'act' || this.state !== 'play') return;
    const me = this.p[s]; if (!me) return;
    const st = this.stationFor(me); if (!st) return;
    const h = me.hold, it = st.item, before = JSON.stringify([h, it]);
    let chopped = false;
    switch (st.c) {
      case 'T': case 'L': case 'B': case 'M': {
        const ing = { k: KCRATE[st.c], st: 'raw' };
        if (!h) me.hold = ing;
        else if (h.k === 'plate') this.addTo(h, ing);
        break;
      }
      case 'P': if (!h) me.hold = { k: 'plate', items: [] }; break;
      case 'X': if (h) { if (h.k === 'plate') h.items = []; else me.hold = null; noise(0.15, 0.1, 700); } break;
      case 'W': if (h && h.k === 'plate') this.deliver(me, st); break;
      case 'K':
        if (!h) {
          if (it && it.st === 'raw' && (it.k === 'tomato' || it.k === 'lettuce')) { st.prog += 0.25; chopped = true; noise(0.05, 0.12, 2600); burst(st.x + 40, st.y + 30, it.k === 'tomato' ? '#ef4444' : '#4ade80', 5, 140, 3, 0.25); if (st.prog >= 0.99) { it.st = 'chopped'; st.prog = 0; tone(1046, 0.1, 'triangle', 0.06); } }
          else if (it) { me.hold = it; st.item = null; }
        } else if (h.k === 'plate') { if (it && this.addTo(h, it)) st.item = null; }
        else if (!it && (h.k === 'tomato' || h.k === 'lettuce' || h.k === 'bread' || h.k === 'meat')) { st.item = h; me.hold = null; st.prog = 0; }
        break;
      case 'S':
        if (!h) { if (it) { me.hold = it; st.item = null; st.prog = 0; } }
        else if (h.k === 'plate') { if (it && this.addTo(h, it)) { st.item = null; st.prog = 0; } }
        else if (!it && h.k === 'meat' && h.st === 'raw') { st.item = h; me.hold = null; st.prog = 0; noise(0.3, 0.06, 3000); }
        break;
      case 'C':
        if (!h) { if (it) { me.hold = it; st.item = null; } }
        else if (!it) { st.item = h; me.hold = null; }
        else if (it.k === 'plate' && h.k !== 'plate') { if (this.addTo(it, h)) me.hold = null; }
        else if (h.k === 'plate' && it.k !== 'plate') { if (this.addTo(h, it)) st.item = null; }
        break;
    }
    if (chopped || JSON.stringify([me.hold, st.item]) !== before) { toPlayer(s, 'vibe', chopped ? 15 : 25); if (!chopped) tone(520, 0.04, 'square', 0.03); }
    else tone(160, 0.06, 'square', 0.03);
  },
  deliver(me, st) {
    const have = me.hold.items.map((x) => x.k).sort().join(',');
    const idx = this.orders.findIndex((o) => KRECIPES[o.k].need.slice().sort().join(',') === have);
    if (idx < 0) { floatText('אין הזמנה כזו', st.x + 40, st.y + 120, '#ff8fa3', 26); tone(150, 0.25, 'sawtooth', 0.05); return; }
    const o = this.orders.splice(idx, 1)[0], R = KRECIPES[o.k], tip = Math.round(R.pts * 0.4 * (o.t / o.max));
    this.score += R.pts + tip; this.served++;
    me.hold = null;
    floatText(`+${R.pts + tip}`, st.x + 40, st.y + 130, GOLD, 40); SFX.goal(); burst(st.x + 40, st.y + 80, GOLD, 30, 380, 6, 0.7);
    this.S.forEach((s) => toPlayer(s, 'vibe', [40, 30, 40]));
    if (!this.orders.length) this.orderT = Math.min(this.orderT, 2);
  },
  update(dt) {
    if (this.state === 'intro') { countdown(this, dt); return; }
    this.goT = Math.max(0, this.goT - dt);
    if (this.state === 'end') { this.endT += dt; if (this.endT > 2.5) this.finish(); return; }
    this.time -= dt;
    if (this.time <= 10 && Math.ceil(this.time) !== this.tick) { this.tick = Math.ceil(this.time); if (this.tick > 0) tone(this.tick <= 3 ? 1200 : 800, 0.08, 'square', 0.05); }
    if (this.time <= 0) { this.state = 'end'; this.endT = 0; SFX.goal(); return; }
    this.orderT -= dt;
    const maxO = Math.min(5, 3 + Math.floor(this.S.length / 2));
    if (this.orderT <= 0 && this.orders.length < maxO) { this.newOrder(); this.orderT = Math.max(9, 22 - this.S.length * 3 - (KT.time - this.time) * 0.03); }
    for (const o of this.orders) o.t -= dt;
    for (const o of this.orders.filter((o) => o.t <= 0)) { this.score = Math.max(0, this.score - 15); this.missed++; floatText('הזמנה פוספסה −15', VW / 2, 200, '#ff6b6b', 34); tone(120, 0.5, 'sawtooth', 0.07); }
    this.orders = this.orders.filter((o) => o.t > 0);
    // כיריים
    for (const st of this.st) {
      if (st.c !== 'S' || !st.item) continue;
      const m = st.item;
      if (m.st === 'raw' || m.st === 'cooked') {
        st.prog += dt / 7;
        if (m.st === 'raw' && st.prog >= 1) { m.st = 'cooked'; tone(988, 0.12, 'triangle', 0.06); }
        if (m.st === 'cooked' && st.prog >= 2.1) { m.st = 'burnt'; noise(0.4, 0.12, 500); floatText('נשרף!', st.x + 40, st.y - 10, '#ff6b6b', 26); }
        if (Math.random() < dt * (m.st === 'cooked' ? 6 : 3)) parts.push({ x: st.x + 40 + rnd(-12, 12), y: st.y + 30, vx: rnd(-10, 10), vy: -60, life: 0.9, max: 0.9, col: m.st === 'cooked' && st.prog > 1.6 ? 'rgba(60,60,60,.6)' : 'rgba(230,230,230,.4)', size: rnd(5, 9), g: 0 });
      } else if (Math.random() < dt * 8) parts.push({ x: st.x + 40 + rnd(-14, 14), y: st.y + 30, vx: rnd(-14, 14), vy: -70, life: 1.2, max: 1.2, col: 'rgba(40,40,40,.7)', size: rnd(7, 12), g: 0 });
    }
    // תנועה
    for (const s of this.S) {
      const me = this.p[s];
      const [jx, jy] = isBot(s) ? [0, 0] : stickOf(s);
      me.vx = lerp(me.vx, jx * 360, Math.min(1, 12 * dt)); me.vy = lerp(me.vy, jy * 360, Math.min(1, 12 * dt));
      me.x += me.vx * dt; me.y += me.vy * dt;
      if (Math.hypot(jx, jy) > 0.25) me.face = Math.atan2(jy, jx);
      for (const R of this.solid) { if (Math.abs(R[0] + 40 - me.x) > 110 || Math.abs(R[1] + 40 - me.y) > 110) continue; const c = circRect(me.x, me.y, KT.r, R); if (c) { me.x += c[0]; me.y += c[1]; } }
    }
    for (let a = 0; a < this.S.length; a++) for (let b = a + 1; b < this.S.length; b++) {
      const A = this.p[this.S[a]], B = this.p[this.S[b]], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
      if (d < KT.r * 2 && d > 0.01) { const nx = dx / d, ny = dy / d, push = (KT.r * 2 - d) / 2; A.x -= nx * push; A.y -= ny * push; B.x += nx * push; B.y += ny * push; }
    }
  },
  starsGot() { return this.stars.filter((v) => this.score >= v).length; },
  finish() {
    const n = this.starsGot();
    showResults(-1, `${this.score} נקודות · ${'⭐'.repeat(n) || 'בלי כוכבים'} · ${this.served} מנות הוגשו`, 'kitchen', { coop: true, ok: n >= 1, slots: this.S });
  },
  draw() {
    bgGrad('#2a1a12', '#120a06');
    // רצפה
    for (let Y = 0; Y < KMAP.length; Y++) for (let X = 0; X < 15; X++) {
      ctx.fillStyle = (X + Y) % 2 ? '#e9e2d0' : '#d8cfb8'; ctx.fillRect(KT.x0 + X * KT.t, KT.y0 + Y * KT.t, KT.t, KT.t);
    }
    for (const st of this.st) drawStation(st);
    for (const st of this.st) if (st.item) drawFood(st.item, st.x + 40, st.y + 38, 1);
    // סימון התחנה שמול כל שף
    for (const s of this.S) { const st = this.stationFor(this.p[s]); if (st) { ctx.lineWidth = 4; ctx.strokeStyle = COL[s]; rr(st.x + 4, st.y + 4, KT.t - 8, KT.t - 8, 12); ctx.stroke(); } }
    for (const s of this.S) {
      const me = this.p[s];
      chef(me.x, me.y, KT.r, COL[s], me.face);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(me.x, me.y - KT.r - 4, 17, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(me.x - 9, me.y - KT.r - 11, 9, 0, Math.PI * 2); ctx.arc(me.x + 9, me.y - KT.r - 11, 9, 0, Math.PI * 2); ctx.arc(me.x, me.y - KT.r - 16, 10, 0, Math.PI * 2); ctx.fill();
      if (me.hold) drawFood(me.hold, me.x + Math.cos(me.face) * 30, me.y + Math.sin(me.face) * 30 - 6, 0.75);
      txt(pname(s), me.x, me.y + KT.r + 16, 15, '#1a1a1a', 'center', 800);
    }
    drawFx();
    // הזמנות
    this.orders.forEach((o, k) => {
      const R = KRECIPES[o.k], w = 230, x = VW - 40 - (k + 1) * (w + 12) + 12, y = 16, h = 120, low = o.t / o.max < 0.3;
      panel(x, y, w, h, 16, '#fffaf0', low && Math.floor(G.t * 4) % 2 ? '#ef4444' : '#c9a46b');
      txt(R.name, x + w / 2, y + 22, 22, '#3a2410', 'center', 900);
      R.need.forEach((n, j) => drawFood({ k: n, st: n === 'meat' ? 'cooked' : n === 'bread' ? 'raw' : 'chopped' }, x + w / 2 + (j - (R.need.length - 1) / 2) * 48, y + 66, 0.62));
      bar(x + 14, y + 98, w - 28, 10, o.t / o.max, low ? '#ef4444' : '#22c55e', 'rgba(0,0,0,.15)');
    });
    panel(24, 16, 300, 120, 18, 'rgba(10,8,4,.75)', GOLD);
    txt(`${this.score}`, 174, 54, 46, GOLD, 'center', 900);
    txt(`⏱ ${clockTxt(this.time)}`, 174, 96, 26, '#fff', 'center', 800);
    this.stars.forEach((v, k) => txt(this.score >= v ? '★' : '☆', 104 + k * 70, 124, 22, this.score >= v ? GOLD : 'rgba(255,255,255,.4)', 'center', 900));
    introOverlay(this, 'המטבח המטורף', ['הזמנות למעלה · הביאו צלחת עם כל המרכיבים לחלון ההגשה', '🥬🍅 חותכים על הקרש (לחיצות חוזרות) · 🥩 מניחים על הכיריים – ולא שורפים!', 'כפתור אחד לכל דבר: להרים, להניח, לחתוך · עובדים ביחד ומחלקים תפקידים']);
    if (this.state === 'end') banner('הזמן נגמר!', `${this.score} נקודות`, '#fff', 120);
    codeBadge();
  },
};
function drawStation(st) {
  const { x, y, c } = st, T = KT.t;
  ctx.fillStyle = '#6b4226'; ctx.fillRect(x, y, T, T);
  rr(x + 3, y + 3, T - 6, T - 10, 8); ctx.fillStyle = '#9b6b43'; ctx.fill();
  if (KCRATE[c]) {
    rr(x + 10, y + 12, T - 20, T - 26, 6); ctx.fillStyle = '#c08a53'; ctx.fill();
    ctx.strokeStyle = '#7a4f2a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 10, y + 30); ctx.lineTo(x + T - 10, y + 30); ctx.stroke();
    drawFood({ k: KCRATE[c], st: 'raw' }, x + T / 2, y + 42, 0.7);
  } else if (c === 'P') { for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(x + 40, y + 50 - k * 6, 26, 10, 0, 0, Math.PI * 2); ctx.fillStyle = k === 3 ? '#fff' : '#dfe3ea'; ctx.fill(); ctx.strokeStyle = '#b8bdc8'; ctx.lineWidth = 1.5; ctx.stroke(); } }
  else if (c === 'W') {
    rr(x + 4, y + 4, T - 8, T - 14, 8); ctx.fillStyle = '#facc15'; ctx.fill();
    txt('הגשה', x + T / 2, y + 26, 15, '#3a2410', 'center', 900);
    ctx.fillStyle = '#3a2410'; ctx.beginPath(); ctx.moveTo(x + T / 2, y + 36 + Math.sin(G.t * 5) * 3); ctx.lineTo(x + T / 2 - 12, y + 54); ctx.lineTo(x + T / 2 + 12, y + 54); ctx.fill();
  } else if (c === 'X') {
    ctx.beginPath(); ctx.arc(x + 40, y + 36, 24, 0, Math.PI * 2); ctx.fillStyle = '#374151'; ctx.fill();
    ctx.beginPath(); ctx.arc(x + 40, y + 36, 17, 0, Math.PI * 2); ctx.fillStyle = '#111827'; ctx.fill();
    txt('🗑', x + 40, y + 38, 20, '#fff');
  } else if (c === 'K') {
    rr(x + 10, y + 14, T - 20, T - 30, 6); ctx.fillStyle = '#f5f0e6'; ctx.fill();
    ctx.fillStyle = '#a3a3a3'; ctx.fillRect(x + T - 22, y + 20, 6, 30);
    if (st.item && st.prog > 0) bar(x + 8, y + T - 14, T - 16, 9, st.prog, '#22c55e');
  } else if (c === 'S') {
    rr(x + 6, y + 8, T - 12, T - 20, 8); ctx.fillStyle = '#1f2937'; ctx.fill();
    ctx.beginPath(); ctx.arc(x + 40, y + 38, 22, 0, Math.PI * 2); ctx.strokeStyle = st.item ? `rgba(255,${90 + Math.sin(G.t * 10) * 30},40,.9)` : '#4b5563'; ctx.lineWidth = 4; ctx.stroke();
    if (st.item && st.item.st !== 'burnt') { const k = st.prog; bar(x + 8, y + T - 14, T - 16, 9, k < 1 ? k : (k - 1) / 1.1, k < 1 ? '#f59e0b' : k > 1.6 ? '#ef4444' : '#22c55e'); }
  }
}
function drawFood(it, x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  if (it.k === 'plate') {
    ctx.beginPath(); ctx.ellipse(0, 4, 34, 15, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, 34, 15, 0, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.stroke();
    const n = it.items.length;
    const order = ['bread', 'meat', 'lettuce', 'tomato'];
    it.items.slice().sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k)).forEach((x2, j) => drawFood(x2, (j - (n - 1) / 2) * 15, -6 - j * 3, 0.55));
  } else if (it.k === 'tomato') {
    if (it.st === 'chopped') for (let j = -1; j <= 1; j++) { ctx.beginPath(); ctx.arc(j * 13, 0, 11, 0, Math.PI * 2); ctx.fillStyle = '#ef4444'; ctx.fill(); ctx.beginPath(); ctx.arc(j * 13, 0, 6, 0, Math.PI * 2); ctx.fillStyle = '#fca5a5'; ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fillStyle = '#ef4444'; ctx.fill(); ctx.fillStyle = '#16a34a'; star(0, -16, 8, 3, 5); ctx.fill(); ctx.beginPath(); ctx.arc(-6, -5, 5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill(); }
  } else if (it.k === 'lettuce') {
    if (it.st === 'chopped') for (let j = 0; j < 6; j++) { ctx.beginPath(); ctx.ellipse(Math.cos(j) * 14, Math.sin(j * 2) * 8, 9, 6, j, 0, Math.PI * 2); ctx.fillStyle = j % 2 ? '#4ade80' : '#22c55e'; ctx.fill(); }
    else { for (let j = 0; j < 5; j++) { ctx.beginPath(); ctx.ellipse(Math.cos(j * 1.25) * 7, Math.sin(j * 1.25) * 5, 14, 10, j * 1.25, 0, Math.PI * 2); ctx.fillStyle = j % 2 ? '#86efac' : '#22c55e'; ctx.fill(); } }
  } else if (it.k === 'bread') {
    ctx.beginPath(); ctx.ellipse(0, 0, 24, 15, 0, Math.PI, 0); ctx.lineTo(24, 4); ctx.lineTo(-24, 4); ctx.closePath(); ctx.fillStyle = '#d99a4e'; ctx.fill();
    ctx.fillStyle = '#fef3c7'; for (const [a, b] of [[-10, -6], [0, -10], [10, -5]]) { ctx.beginPath(); ctx.ellipse(a, b, 2.5, 1.5, 0.3, 0, Math.PI * 2); ctx.fill(); }
  } else if (it.k === 'meat') {
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 12, 0, 0, Math.PI * 2);
    ctx.fillStyle = it.st === 'raw' ? '#f472b6' : it.st === 'cooked' ? '#7c3f1d' : '#1c1917'; ctx.fill();
    if (it.st === 'cooked') { ctx.strokeStyle = '#4a2410'; ctx.lineWidth = 2; for (const o of [-8, 0, 8]) { ctx.beginPath(); ctx.moveTo(o - 5, -6); ctx.lineTo(o + 5, 6); ctx.stroke(); } }
  }
  ctx.restore();
}

// ============================================================
//  פרו: שוד הכספת – שיתופי. כל טלפון מקבל רמזים אחרים, רק ביחד יודעים איזה חוט לחתוך
// ============================================================
const HC = [
  { n: 'אדום', c: '#ef4444' }, { n: 'כחול', c: '#3b82f6' }, { n: 'ירוק', c: '#22c55e' },
  { n: 'צהוב', c: '#facc15' }, { n: 'לבן', c: '#f1f5f9' }, { n: 'שחור', c: '#27272a' },
];
const HV = { vaults: 5, strikes: 3, wires: [4, 5, 5, 6, 6], time: [85, 80, 75, 70, 65] };
function heistPuzzle(N) {
  const w = Array.from({ length: N + 1 }, () => Math.floor(Math.random() * HC.length)); w[0] = -1;
  const t = 1 + Math.floor(Math.random() * N), tc = w[t];
  const nb = (i, c) => w[i - 1] === c || (i < N && w[i + 1] === c);
  const pool = [], strong = [];
  const present = new Set(w.slice(1));
  for (const c of present) if (c !== tc) pool.push({ s: `החוט הנכון אינו ${HC[c].n}`, f: (i) => w[i] !== c });
  strong.push({ s: `החוט הנכון ${HC[tc].n}`, f: (i) => w[i] === tc });
  pool.push(t % 2 ? { s: 'מספר החוט הנכון אי־זוגי', f: (i) => i % 2 === 1 } : { s: 'מספר החוט הנכון זוגי', f: (i) => i % 2 === 0 });
  for (let k = 1; k < N; k++) pool.push(t > k ? { s: `מספר החוט הנכון גדול מ־${k}`, f: (i) => i > k } : { s: `מספר החוט הנכון הוא ${k} או פחות`, f: (i) => i <= k });
  pool.push(t === 1 || t === N ? { s: 'החוט הנכון נמצא באחד הקצוות', f: (i) => i === 1 || i === N } : { s: 'החוט הנכון לא נמצא בקצוות', f: (i) => i !== 1 && i !== N });
  for (const c of present) {
    if (nb(t, c)) pool.push({ s: `לחוט הנכון יש שכן ${HC[c].n}`, f: (i) => nb(i, c) });
    else pool.push({ s: `אין לחוט הנכון שכן ${HC[c].n}`, f: (i) => !nb(i, c) });
  }
  const cnt = w.slice(1).filter((c) => c === tc).length;
  pool.push(cnt === 1 ? { s: 'אין עוד חוט בצבע של החוט הנכון', f: (i) => w.slice(1).filter((c) => c === w[i]).length === 1 } : { s: 'יש עוד חוט בצבע של החוט הנכון', f: (i) => w.slice(1).filter((c) => c === w[i]).length > 1 });
  pool.sort(() => Math.random() - 0.5);
  let C = Array.from({ length: N }, (_, k) => k + 1);
  const picked = [];
  for (const cl of pool.concat(strong)) {
    const nc = C.filter(cl.f);
    if (nc.length < C.length) { picked.push(cl); C = nc; }
    if (C.length === 1) break;
  }
  const spare = pool.filter((p) => !picked.includes(p));
  return { w, t, picked, spare };
}
const Heist = {
  enter() {
    this.S = seatsFor(1);
    this.stateExtra = null; this.w = null;
    this.vault = 0; this.strikes = 0; this.loot = 0; this.opened = 0;
    this.state = 'intro'; this.it = 6.5; this.lastC = 9; this.goT = 0; this.endT = 0;
    this.alarm = 0; this.open = 0; this.phase = 'idle'; this.stars = Array.from({ length: 30 }, () => [rnd(0, VW), rnd(0, VH)]);
  },
  onPlay() { this.nextVault(); },
  humans() { return this.S.filter((s) => G.room[s]); },
  nextVault() {
    this.vault++;
    if (this.vault > HV.vaults) return this.end();
    const N = HV.wires[this.vault - 1];
    const P = heistPuzzle(N);
    this.w = P.w; this.t = P.t; this.cut = Array(N + 1).fill(false);
    const H = this.humans(), clues = P.picked.slice();
    while (clues.length < Math.max(H.length, 2) && P.spare.length) clues.push(P.spare.shift());
    clues.sort(() => Math.random() - 0.5);
    this.clues = {};
    H.forEach((s) => (this.clues[s] = []));
    clues.forEach((c, k) => { if (H.length) this.clues[H[k % H.length]].push(c.s); });
    this.allClues = clues.map((c) => c.s);
    this.max = HV.time[this.vault - 1] + (H.length <= 1 ? 15 : 0); this.time = this.max;
    this.phase = 'crack'; this.open = 0; this.pick = 0;
    this.stateExtra = { vault: this.vault, n: HV.vaults, wires: this.w.slice(1).map((c) => ({ c: HC[c].c, n: HC[c].n })), cut: this.cut.slice(1) };
    pushState();
    H.forEach((s) => this.sendClues(s));
    tone(660, 0.1, 'triangle', 0.07); setTimeout(() => tone(880, 0.12, 'triangle', 0.07), 120);
  },
  sendClues(s) { if (this.phase === 'crack' && this.clues && this.clues[s]) toPlayer(s, 'clue', { v: this.vault, list: this.clues[s] }); },
  onBack(s) { this.sendClues(s); },
  onJoin(s) {
    if (!this.S.includes(s)) { this.S.push(s); this.S.sort((a, b) => a - b); }
    if (this.phase === 'crack') {  // מחלקים לו עותק של רמז קיים כדי שישתתף
      this.clues[s] = [this.allClues[Math.floor(Math.random() * this.allClues.length)]];
      this.sendClues(s);
    }
  },
  onInput(s, d) {
    if (d.t !== 'cut' || this.state !== 'play' || this.phase !== 'crack') return;
    const i = d.i | 0; if (i < 1 || i >= this.w.length || this.cut[i]) return;
    this.cut[i] = true; this.stateExtra.cut = this.cut.slice(1); this.cutBy = s;
    const x = this.wireX(i);
    burst(x, 470, HC[this.w[i]].c, 14, 260, 4, 0.4); noise(0.08, 0.3, 4000);
    if (i === this.t) {
      this.phase = 'open'; this.open = 0; this.opened++;
      const gain = 1000 * this.vault + Math.round(this.time * 20);
      this.loot += gain; floatText(`+₪${gain.toLocaleString('he-IL')}`, VW / 2, 300, GOLD, 56);
      SFX.win(); this.S.forEach((p) => toPlayer(p, 'vibe', [60, 40, 60, 40, 200]));
    } else {
      this.strikes++; this.alarm = 1.6; this.time = Math.max(1, this.time - 12); G.shake = 10;
      floatText('אזעקה! −12 שניות', VW / 2, 300, '#ff4d4d', 50);
      for (let k = 0; k < 6; k++) setTimeout(() => tone(k % 2 ? 620 : 880, 0.14, 'sawtooth', 0.07), k * 150);
      this.S.forEach((p) => toPlayer(p, 'vibe', [300, 100, 300]));
      if (this.strikes >= HV.strikes) { this.phase = 'caught'; this.open = 0; }
    }
    pushState();
  },
  end() { this.state = 'end'; this.endT = 0; this.phase = 'done'; this.stateExtra = Object.assign({}, this.stateExtra, { over: true }); pushState(); },
  wireX(i) { const N = this.w.length - 1; return VW / 2 + ((N + 1) / 2 - i) * 120; },
  update(dt) {
    if (this.state === 'intro') { countdown(this, dt); return; }
    this.goT = Math.max(0, this.goT - dt); this.alarm = Math.max(0, this.alarm - dt);
    if (this.state === 'end') { this.endT += dt; if (this.endT > 2.5) this.finish(); return; }
    if (this.phase === 'crack') {
      this.time -= dt;
      if (this.time < 10 && Math.ceil(this.time) !== this.tick) { this.tick = Math.ceil(this.time); tone(1000, 0.06, 'square', 0.05); }
      if (this.time <= 0) {
        this.strikes++; floatText('השומרים הגיעו!', VW / 2, 300, '#ff4d4d', 54); this.alarm = 2; tone(200, 0.8, 'sawtooth', 0.08);
        this.phase = this.strikes >= HV.strikes ? 'caught' : 'lost'; this.open = 0; this.cut[this.t] = false;
      }
    } else if (this.phase === 'open' || this.phase === 'lost') {
      this.open += dt;
      if (this.phase === 'open' && Math.random() < 0.5) parts.push({ x: VW / 2 + rnd(-60, 60), y: 520, vx: rnd(-250, 250), vy: rnd(-520, -250), g: 700, life: 1.4, max: 1.4, col: Math.random() < 0.6 ? GOLD : '#4ade80', size: rnd(5, 9) });
      if (this.open > 3) this.nextVault();
    } else if (this.phase === 'caught') { this.open += dt; if (this.open > 2.5) this.end(); }
  },
  finish() {
    const ok = this.opened >= 3;
    showResults(-1, `נפרצו ${this.opened} מתוך ${HV.vaults} כספות · שלל: ₪${this.loot.toLocaleString('he-IL')}`, 'heist', { coop: true, ok, slots: this.S });
  },
  draw() {
    bgGrad('#101626', '#05070e');
    if (this.alarm > 0 && Math.floor(G.t * 8) % 2) { ctx.fillStyle = 'rgba(255,30,30,.18)'; ctx.fillRect(0, 0, VW, VH); }
    // לייזרים ברקע
    ctx.lineWidth = 2;
    for (let k = 0; k < 5; k++) { const y = 150 + k * 140 + Math.sin(G.t * 0.8 + k) * 30; ctx.strokeStyle = `rgba(255,40,60,${0.12 + 0.08 * Math.sin(G.t * 3 + k)})`; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(VW, y + Math.cos(G.t + k) * 40); ctx.stroke(); }
    // דלת הכספת
    const cx = VW / 2, cy = 470;
    if (this.w && this.phase !== 'idle') {
      const N = this.w.length - 1, x0 = this.wireX(N) - 90, x1 = this.wireX(1) + 90;
      const openK = this.phase === 'open' ? clamp(this.open / 0.9, 0, 1) : 0;
      // פנים הכספת (שלל)
      rr(x0 - 30, 170, x1 - x0 + 60, 600, 40); ctx.fillStyle = '#1a1405'; ctx.fill();
      for (let k = 0; k < 9; k++) { rr(cx - 160 + (k % 3) * 110, 300 + Math.floor(k / 3) * 70, 96, 54, 8); ctx.fillStyle = k % 2 ? '#eab308' : '#facc15'; ctx.fill(); }
      txt('₪', cx, 380, 120, 'rgba(120,80,0,.5)', 'center', 900);
      ctx.save(); ctx.translate(x0 - 30, 0); ctx.scale(1 - openK * 0.92, 1); ctx.translate(-(x0 - 30), 0);
      rr(x0 - 30, 170, x1 - x0 + 60, 600, 40); const dg = ctx.createLinearGradient(0, 170, 0, 770); dg.addColorStop(0, '#5b6478'); dg.addColorStop(1, '#2e3442'); ctx.fillStyle = dg; ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = '#8b93a7'; ctx.stroke();
      for (const [bx, by] of [[x0 - 4, 200], [x1 + 4, 200], [x0 - 4, 740], [x1 + 4, 740]]) { ctx.beginPath(); ctx.arc(bx, by, 10, 0, Math.PI * 2); ctx.fillStyle = '#a3aab9'; ctx.fill(); }
      // לוח חוטים
      rr(x0, 230, x1 - x0, 64, 12); ctx.fillStyle = '#111827'; ctx.fill();
      rr(x0, 650, x1 - x0, 64, 12); ctx.fillStyle = '#111827'; ctx.fill();
      txt(`כספת ${this.vault} מתוך ${HV.vaults}`, cx, 262, 26, '#e5e7eb', 'center', 800);
      for (let i = 1; i <= N; i++) {
        const x = this.wireX(i), col = HC[this.w[i]].c, wav = Math.sin(G.t * 2 + i) * 6;
        ctx.lineCap = 'round'; ctx.lineWidth = 22;
        const seg = (ya, yb) => { ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.moveTo(x + 4, ya + 4); ctx.bezierCurveTo(x + 30 + wav, (ya * 2 + yb) / 3, x - 30 - wav, (ya + yb * 2) / 3, x + 4, yb + 4); ctx.stroke(); ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x, ya); ctx.bezierCurveTo(x + 30 + wav, (ya * 2 + yb) / 3, x - 30 - wav, (ya + yb * 2) / 3, x, yb); ctx.stroke(); };
        if (!this.cut[i]) seg(294, 650);
        else { seg(294, 440); seg(510, 650); ctx.fillStyle = '#fcd34d'; star(x, 440, 10, 4, 6); ctx.fill(); star(x, 510, 10, 4, 6); ctx.fill(); }
        ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.arc(x, 682, 24, 0, Math.PI * 2); ctx.fillStyle = '#e5e7eb'; ctx.fill();
        txt(String(i), x, 684, 30, '#111827', 'center', 900);
      }
      ctx.restore();
    }
    drawFx();
    // HUD
    panel(24, 16, 340, 110, 20, 'rgba(10,12,30,.82)', GOLD);
    txt(`₪${this.loot.toLocaleString('he-IL')}`, 194, 52, 40, GOLD, 'center', 900);
    txt(`אזעקות: ${'🚨'.repeat(this.strikes)}${'⚪'.repeat(Math.max(0, HV.strikes - this.strikes))}`, 194, 96, 22, '#fff', 'center', 700);
    if (this.phase === 'crack') {
      const low = this.time < 15;
      panel(VW - 364, 16, 340, 110, 20, 'rgba(10,12,30,.82)', low ? '#ef4444' : 'rgba(255,255,255,.2)');
      txt(`⏱ ${clockTxt(this.time)}`, VW - 194, 54, 42, low ? '#ff6b6b' : '#fff', 'center', 900);
      bar(VW - 340, 96, 292, 12, this.time / this.max, low ? '#ef4444' : '#22c55e');
      txt('🗣 כל אחד רואה בטלפון רמזים אחרים – תגידו אותם בקול! חותכים בטלפון', VW / 2, 800, 24, '#c9cdf0', 'center', 700, 5);
      txt(`שחקנים: ${this.humans().map((s) => pname(s)).join(' · ') || '—'}`, VW / 2, 834, 20, '#7d84b3', 'center', 600);
    }
    if (this.phase === 'open') banner('הכספת נפרצה!', '', GOLD, 110);
    if (this.phase === 'lost') banner('השומרים בדרך – בורחים!', `החוט הנכון היה מספר ${this.t}`, '#ff6b6b', 76);
    if (this.phase === 'caught') banner('נתפסתם!', 'שלוש אזעקות – המשטרה כאן', '#ff6b6b', 120);
    introOverlay(this, 'שוד הכספת', ['בכל כספת חוטים צבעוניים – רק חוט אחד פותח אותה', 'כל טלפון מקבל רמזים סודיים אחרים · הקריאו אותם בקול ותחליטו ביחד', 'חוט לא נכון = אזעקה ופחות זמן · 3 אזעקות ונתפסתם', 'פרצו לפחות 3 מתוך 5 כספות כדי לנצח']);
    if (this.state === 'end' && this.phase === 'done') banner('הבריחה הצליחה?', `נפרצו ${this.opened} כספות`, '#fff', 100);
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
  G.t += dt;
  if (G.slowT > 0) { G.slowT -= dt; dt *= 0.3; }
  acc += dt;
  while (acc >= STEP) { if (G.scene) G.scene.update(STEP); updFx(STEP); acc -= STEP; }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, cv.width, cv.height);
  const sx = G.shake ? rnd(-G.shake, G.shake) : 0, sy = G.shake ? rnd(-G.shake, G.shake) : 0;
  ctx.setTransform(S, 0, 0, S, OX + sx * S, OY + sy * S);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, VW, VH); ctx.clip();
  if (G.scene) G.scene.draw();
  if (G.sceneName === 'menu' || G.sceneName === 'results') drawFx();
  if (!AC || AC.state !== 'running') { panel(VW - 330, VH - 50, 310, 36, 18, 'rgba(255,214,10,.15)', GOLD); txt('לחצו על המסך כדי להפעיל סאונד', VW - 175, VH - 32, 17, GOLD, 'center', 700); }
  ctx.restore();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__zira = { G, inp, startGame, showResults };
})();
