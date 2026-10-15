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

let slot = -1, myName = '', mode = '', joined = false, lastCode = '';

// ---------- מסך הצטרפות ----------
const qs = new URLSearchParams(location.search);
$('#code').value = (qs.get('c') || '').toUpperCase().slice(0, 4);
$('#name').value = store.get('zira-name') || '';
$('#code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
if ($('#code').value) setTimeout(() => $('#name').focus(), 50);

function show(id) { $$('.view').forEach((v) => v.classList.toggle('on', v.id === id)); }

$('#joinBtn').addEventListener('click', async () => {
  await enableMotion();
  join($('#code').value.trim(), $('#name').value.trim());
});
$('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });

function join(code, name) {
  $('#err').textContent = '';
  if (code.length !== 4) { $('#err').textContent = 'הקוד הוא 4 אותיות'; return; }
  socket.emit('player:join', { code, name }, (r) => {
    if (r.error) { $('#err').textContent = r.error; return; }
    slot = r.slot; myName = r.name; joined = true; lastCode = code;
    store.set('zira-name', name);
    document.documentElement.style.setProperty('--me', COLORS[slot]);
    $$('.me').forEach((el) => (el.textContent = myName));
    keepAwake(); goFull();
    applyState(r.state || { mode: 'menu' });
  });
}
socket.on('connect', () => { if (joined && lastCode) join(lastCode, myName); });
socket.on('host:gone', () => { joined = false; show('gone'); });
socket.on('state', applyState);
socket.on('to', ({ ev, d }) => {
  if (ev === 'vibe') vibe(d);
  if (ev === 'meter') setMeter(d);
});

function applyState(s) {
  if (!s) return;
  const prev = mode; mode = s.mode;
  releaseAll();
  if (mode === 'menu') show('menu');
  else if (mode === 'race') { show('race'); if (prev !== 'race') cal = null; }
  else if (mode === 'box') { show('box'); setMeter({ v: 0, sta: 100 }); }
  else if (mode === 'hockey') show('hockey');
  else if (mode === 'results') {
    show('results');
    const w = s.w;
    $('#resEmoji').textContent = w === slot ? '🏆' : w < 0 ? '🤝' : '😤';
    $('#resTitle').textContent = w === slot ? 'ניצחת!' : w < 0 ? 'תיקו!' : 'הפעם לא…';
    $('#resSub').textContent = w === slot ? 'כל הכבוד, אלוף/ה' : w < 0 ? 'שוב, ותכריעו' : 'בואו נעשה עוד סיבוב';
  }
}

// ---------- עזרים ----------
const send = (d) => joined && socket.emit('input', d);
function vibe(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }
let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && joined) keepAwake(); });
function goFull() { try { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen && /Android/i.test(navigator.userAgent)) el.requestFullscreen().catch(() => {}); } catch (e) {} }

const releasers = [];
function hold(el, cb) {
  let active = null;
  const on = (e) => { e.preventDefault(); active = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch (_) {} el.classList.add('on'); vibe(8); cb(true); };
  const off = (e) => { if (active === null || (e && e.pointerId !== active)) return; active = null; el.classList.remove('on'); cb(false); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  releasers.push(() => { if (active !== null) { active = null; el.classList.remove('on'); cb(false); } });
}
function tap(el, cb) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 110); vibe(12); cb(); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
function releaseAll() { releasers.forEach((r) => r()); }
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

// תפריט
$$('.game').forEach((b) => b.addEventListener('click', () => { vibe(15); send({ t: 'menu', g: b.dataset.g }); }));
$('#again').addEventListener('click', () => send({ t: 'again' }));
$('#toMenu').addEventListener('click', () => send({ t: 'next' }));
// יציאה – לחיצה כפולה
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
$('#cal').addEventListener('click', () => { cal = motionOK ? rawAngle() : null; vibe(30); flash($('#cal'), 'כויל ✓'); });
$('#flip').addEventListener('click', () => { flip = -flip; store.set('zira-flip', String(flip)); vibe(30); flash($('#flip'), 'הופך ✓'); });
$('#smode').addEventListener('click', () => setBtnMode(!btnMode));
function setBtnMode(v) {
  btnMode = v; $('#raceWrap').classList.toggle('btnmode', v);
  $('#smode').textContent = v ? 'הטיה' : 'כפתורים';
  $('#rhint').textContent = v ? 'היגוי עם החצים · גז ובלם בצדדים' : 'החזיקו לרוחב וסובבו כמו הגה';
}
function flash(el, s) { const o = el.textContent; el.textContent = s; setTimeout(() => (el.textContent = o), 900); }
// אם אין חיישן אחרי שנייה – עוברים לכפתורים
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

// ---------- לולאת שליחה ----------
let lastSent = '';
setInterval(() => {
  if (!joined) return;
  let d = null;
  if (mode === 'race') d = { steer: +steerNow().toFixed(3), gas, brake };
  else if (mode === 'hockey') d = { x: +hx.toFixed(4), y: +hy.toFixed(4), down: hdown };
  if (!d) return;
  const k = JSON.stringify(d);
  if (k === lastSent && Math.random() < 0.8) return; // חוסך תעבורה כשאין שינוי
  lastSent = k; socket.volatile.emit('axis', d);
}, 25);

// הגה מסתובב על המסך
(function wheelLoop() {
  if (mode === 'race' && !btnMode) $('#wheel').style.transform = `rotate(${steerNow() * 100}deg)`;
  requestAnimationFrame(wheelLoop);
})();
})();
