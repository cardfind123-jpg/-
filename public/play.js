'use strict';
// ============================================================
//  זירה – השלט בטלפון
// ============================================================
(() => {
const socket = io({ transports: ['websocket', 'polling'] });
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const COLORS = ['#ff4d6d', '#2ec5ff'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
// איזה מסך שלט מתאים לכל משחק
const VIEW = { menu: 'menu', race: 'race', box: 'box', hockey: 'hockey', tanks: 'stick', sumo: 'stick', bomb: 'stick', soccer: 'soccer', volley: 'soccer', results: 'results' };
const ACT_LABEL = { tanks: 'אש!', sumo: 'הדיפה', bomb: 'ספרינט' };

let slot = -1, myName = '', mode = '', joined = false, lastCode = '', autoTry = true;

// ---------- הצטרפות ----------
const qs = new URLSearchParams(location.search);
$('#code').value = (qs.get('c') || '').toUpperCase().slice(0, 4);
$('#name').value = store.get('zira-name') || '';
$('#code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });

function show(id) { $$('.view').forEach((v) => v.classList.toggle('on', v.id === id)); }

$('#joinBtn').addEventListener('click', async () => {
  await enableMotion();
  join($('#code').value.trim(), $('#name').value.trim());
});
$('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });

function join(code, name, silent) {
  $('#err').textContent = '';
  if (code.length !== 4) { if (!silent) $('#err').textContent = 'הקוד הוא 4 אותיות'; return; }
  const token = store.get('zira-tok-' + code) || '';
  socket.emit('player:join', { code, name, token }, (r) => {
    if (r.error) { if (!silent) $('#err').textContent = r.error; return; }
    slot = r.slot; myName = r.name; joined = true; lastCode = code;
    store.set('zira-name', name || r.name);
    if (r.token) store.set('zira-tok-' + code, r.token);
    document.documentElement.style.setProperty('--me', COLORS[slot]);
    $$('.me').forEach((el) => (el.textContent = myName));
    keepAwake(); goFull();
    applyState(r.state || { mode: 'menu' });
  });
}
socket.on('connect', () => {
  if (joined && lastCode) join(lastCode, myName, true);
  else if (autoTry) {
    // רענון הדף / חזרה מנעילת מסך – מצטרפים אוטומטית לאותו מקום
    autoTry = false;
    const code = $('#code').value.trim(), name = $('#name').value.trim();
    if (code && name && store.get('zira-tok-' + code)) join(code, name, true);
  }
});
socket.on('host:gone', () => { joined = false; show('gone'); });
socket.on('state', applyState);
socket.on('to', ({ ev, d }) => {
  if (ev === 'vibe') vibe(d);
  if (ev === 'meter') setMeter(d);
  if (ev === 'boost') setBoost(d);
});

function applyState(s) {
  if (!s) return;
  const prev = mode; mode = s.mode;
  releaseAll(); resetStick();
  show(VIEW[mode] || 'menu');
  if (mode === 'race' && prev !== 'race') { cal = null; setBoost({ v: 0.6 }); }
  if (mode === 'box') setMeter({ v: 0, sta: 100 });
  if (ACT_LABEL[mode]) $('#actBtn').textContent = ACT_LABEL[mode];
  if (mode === 'soccer' || mode === 'volley') $('#sKick').textContent = mode === 'volley' ? 'הנחתה' : 'בעיטה';
  if (mode === 'results') {
    const t = s.tour, fin = s.final, w = fin ? s.champ : s.w, won = w === slot;
    $('#resEmoji').textContent = won ? '🏆' : w < 0 ? '🤝' : '😤';
    $('#resTitle').textContent = fin ? (won ? 'אלוף/ת הטורניר!' : w < 0 ? 'תיקו בטורניר!' : 'הטורניר נגמר') : won ? 'ניצחת!' : w < 0 ? 'תיקו!' : 'הפעם לא…';
    $('#resSub').textContent = t ? `טורניר: ${t.pts[slot]} : ${t.pts[1 - slot]} · משחק ${t.k} מתוך ${t.n}` : won ? 'כל הכבוד, אלוף/ה' : 'בואו נעשה עוד סיבוב';
    $('#again').style.display = t ? 'none' : '';
    $('#toMenu').textContent = t && !fin ? `למשחק הבא: ${s.next}` : 'לתפריט המשחקים';
  }
}

// ---------- עזרים ----------
const send = (d) => joined && socket.emit('input', d);
function vibe(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }
let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } } catch (e) {} }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { if (joined) keepAwake(); if (!socket.connected) socket.connect(); }
});
function goFull() { try { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen && /Android/i.test(navigator.userAgent)) el.requestFullscreen().catch(() => {}); } catch (e) {} }

const releasers = [];
function hold(el, cb) {
  let active = null;
  const on = (e) => { e.preventDefault(); active = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch (_) {} el.classList.add('on'); vibe(8); cb(true); };
  const off = (e) => { if (active === null || (e && e.pointerId !== active)) return; active = null; el.classList.remove('on'); cb(false); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
  releasers.push(() => { if (active !== null) { active = null; el.classList.remove('on'); cb(false); } });
}
function tap(el, cb) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 110); vibe(12); cb(); });
}
function releaseAll() { releasers.forEach((r) => r()); }
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

// תפריט ותוצאות
$$('.game, .tourBtn').forEach((b) => b.addEventListener('click', () => { vibe(15); send({ t: 'menu', g: b.dataset.g }); }));
$('#again').addEventListener('click', () => send({ t: 'again' }));
$('#toMenu').addEventListener('click', () => send({ t: 'next' }));
$$('.quit').forEach((q) => {
  let armed = 0;
  q.addEventListener('click', () => {
    if (Date.now() - armed < 2500) { send({ t: 'quit' }); q.classList.remove('arm'); q.textContent = '✕ יציאה'; armed = 0; return; }
    armed = Date.now(); q.classList.add('arm'); q.textContent = 'לצאת? לחצו שוב';
    setTimeout(() => { if (Date.now() - armed >= 2400) { q.classList.remove('arm'); q.textContent = '✕ יציאה'; } }, 2500);
  });
});

// ---------- חיישני תנועה ----------
let motionOK = false, motionOn = false;
const g = { x: 0, y: 0, z: 0 };
async function enableMotion() {
  if (motionOn) return;
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') return;
    }
    window.addEventListener('devicemotion', onMotion);
    motionOn = true;
  } catch (e) {}
}
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  motionOK = true; g.x = a.x; g.y = a.y; g.z = a.z;
  if (mode === 'box' && punchMotion && e.acceleration && e.acceleration.x != null) detectPunch(e.acceleration);
}

// ---------- מרוץ ----------
let cal = null, flip = +(store.get('zira-flip') || 1), btnMode = false, gas = false, brake = false, bl = false, br = false;
const rawAngle = () => Math.atan2(g.x, g.y);
function tiltSteer() {
  if (!motionOK) return 0;
  if (cal === null) cal = rawAngle();
  let d = rawAngle() - cal;
  while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  let s = clamp((-d * flip) / 0.6, -1, 1);
  if (Math.abs(s) < 0.04) s = 0;
  return s;
}
function steerNow() { return btnMode || !motionOK ? (br ? 1 : 0) - (bl ? 1 : 0) : tiltSteer(); }
hold($('#gas'), (v) => (gas = v));
hold($('#brake'), (v) => (brake = v));
hold($('#left'), (v) => (bl = v));
hold($('#right'), (v) => (br = v));
tap($('#boost'), () => send({ t: 'boost' }));
$('#cal').addEventListener('click', () => { cal = motionOK ? rawAngle() : null; vibe(30); flash($('#cal'), 'כויל ✓'); });
$('#flip').addEventListener('click', () => { flip = -flip; store.set('zira-flip', String(flip)); vibe(30); flash($('#flip'), 'הופך ✓'); });
$('#smode').addEventListener('click', () => setBtnMode(!btnMode));
function setBtnMode(v) {
  btnMode = v; $('#raceWrap').classList.toggle('btnmode', v);
  $('#smode').textContent = v ? 'הטיה' : 'כפתורים';
  $('#rhint').textContent = v ? 'היגוי עם החצים · גז ובלם בצדדים' : 'החזיקו לרוחב וסובבו כמו הגה';
}
function setBoost({ v = 0 } = {}) { $('#boostFill').style.width = clamp(v, 0, 1) * 100 + '%'; $('#boost').classList.toggle('ready', v >= 1); }
function flash(el, s) { const o = el.textContent; el.textContent = s; setTimeout(() => (el.textContent = o), 900); }
setInterval(() => { if (mode === 'race' && !motionOK && !btnMode) setBtnMode(true); }, 1500);

// ---------- אגרוף ----------
let punchMotion = false, lastPunch = 0;
tap($('#bJab'), () => send({ t: 'jab' }));
tap($('#bHook'), () => send({ t: 'hook' }));
tap($('#bDodge'), () => send({ t: 'dodge' }));
tap($('#bSuper'), () => send({ t: 'super' }));
hold($('#bBlock'), (v) => send({ t: 'block', v }));
$('#punchMode').addEventListener('click', async () => {
  await enableMotion();
  punchMotion = !punchMotion;
  $('#punchMode').textContent = 'אגרוף בתנועה: ' + (punchMotion ? 'פועל' : 'כבוי');
  if (punchMotion && !motionOK) setTimeout(() => { if (!motionOK) { punchMotion = false; $('#punchMode').textContent = 'אין חיישן תנועה'; } }, 1200);
});
function detectPunch(a) {
  const m = Math.hypot(a.x, a.y, a.z), now = Date.now();
  if (now - lastPunch < 380) return;
  if (m > 28) { lastPunch = now; send({ t: 'hook' }); vibe(20); }
  else if (m > 17) { lastPunch = now; send({ t: 'jab' }); vibe(12); }
}
function setMeter({ v = 0, sta = 100 } = {}) {
  $('#superFill').style.width = clamp(v, 0, 100) + '%';
  $('#bSuper').classList.toggle('ready', v >= 100);
  $('#staFill').style.height = clamp(sta, 0, 100) + '%';
}

// ---------- הוקי ----------
const pad = $('#pad'), dot = $('#dot');
let hx = 0.5, hy = 0.5, hdown = false, padId = null;
function padMove(e) {
  const r = pad.getBoundingClientRect();
  hx = clamp((e.clientX - r.left) / r.width, 0, 1); hy = clamp((e.clientY - r.top) / r.height, 0, 1);
  dot.style.left = hx * 100 + '%'; dot.style.top = hy * 100 + '%';
}
pad.addEventListener('pointerdown', (e) => { e.preventDefault(); padId = e.pointerId; try { pad.setPointerCapture(e.pointerId); } catch (_) {} hdown = true; pad.classList.add('touch'); padMove(e); });
pad.addEventListener('pointermove', (e) => { if (e.pointerId === padId) padMove(e); });
const padUp = (e) => { if (e.pointerId !== padId) return; padId = null; hdown = false; pad.classList.remove('touch'); };
pad.addEventListener('pointerup', padUp); pad.addEventListener('pointercancel', padUp);

// ---------- ג׳ויסטיק (טנקים, סומו) ----------
const sZone = $('#stickZone'), sBase = $('#sBase'), sKnob = $('#sKnob');
let sId = null, sOx = 0, sOy = 0, jx = 0, jy = 0;
function resetStick() { sId = null; jx = jy = 0; sBase.style.left = sKnob.style.left = '50%'; sBase.style.top = sKnob.style.top = '50%'; sKnob.style.transform = ''; }
sZone.addEventListener('pointerdown', (e) => {
  e.preventDefault(); sId = e.pointerId; try { sZone.setPointerCapture(e.pointerId); } catch (_) {}
  const r = sZone.getBoundingClientRect(); sOx = e.clientX; sOy = e.clientY;
  const lx = e.clientX - r.left + 'px', ly = e.clientY - r.top + 'px';
  sBase.style.left = sKnob.style.left = lx; sBase.style.top = sKnob.style.top = ly; sKnob.style.transform = ''; jx = jy = 0;
});
sZone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== sId) return;
  let dx = e.clientX - sOx, dy = e.clientY - sOy; const R = 64, m = Math.hypot(dx, dy);
  if (m > R) { dx *= R / m; dy *= R / m; }
  jx = dx / R; jy = dy / R; sKnob.style.transform = `translate(${dx}px,${dy}px)`;
});
const sUp = (e) => { if (e.pointerId !== sId) return; resetStick(); };
sZone.addEventListener('pointerup', sUp); sZone.addEventListener('pointercancel', sUp);
tap($('#actBtn'), () => send({ t: 'act' }));

// ---------- כדורגל ----------
let sl = false, sr = false;
hold($('#sL'), (v) => (sl = v));
hold($('#sR'), (v) => (sr = v));
tap($('#sJump'), () => send({ t: 'jump' }));
tap($('#sKick'), () => send({ t: 'kick' }));

// ---------- לולאת שליחה ----------
let lastSent = '';
setInterval(() => {
  if (!joined) return;
  let d = null;
  if (mode === 'race') d = { steer: +steerNow().toFixed(3), gas, brake };
  else if (mode === 'hockey') d = { x: +hx.toFixed(4), y: +hy.toFixed(4), down: hdown };
  else if (mode === 'tanks' || mode === 'sumo' || mode === 'bomb') d = { jx: +jx.toFixed(3), jy: +jy.toFixed(3) };
  else if (mode === 'soccer' || mode === 'volley') d = { l: sl, r: sr };
  if (!d) return;
  const k = JSON.stringify(d);
  if (k === lastSent && Math.random() < 0.8) return;
  lastSent = k; socket.volatile.emit('axis', d);
}, 25);

(function wheelLoop() {
  if (mode === 'race' && !btnMode) $('#wheel').style.transform = `rotate(${steerNow() * 100}deg)`;
  requestAnimationFrame(wheelLoop);
})();
})();
