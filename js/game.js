// ═══════════════════════════════════════
// CANVAS 2D SETUP
// ═══════════════════════════════════════
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const TILE = 40; // pixels per world unit

function resizeCanvas() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  ctx.imageSmoothingEnabled = false;
}
resizeCanvas();
addEventListener('resize', resizeCanvas);

// ═══════════════════════════════════════
// SPRITE LOADER
// ═══════════════════════════════════════
const SPRITES = { cat: {}, enemy: {}, boss: {}, item: {}, loaded: false };

// Data-driven enemy sprite definitions: enemyName → { folder, prefix, count }
const ENEMY_SPRITE_DEFS = {
  '슬라임':       { folder: 'slime/common', prefix: 'slime', count: 5 },
  '다크슬라임':   { folder: 'slime/dark', prefix: 'darkslime', count: 5 },
  '우주쥐1':      { folder: 'mouse/mouse1', prefix: 'mouse1-', count: 3 },
  '우주쥐2':      { folder: 'mouse/mouse2', prefix: 'mouse2-', count: 2 },
  '우주개1':      { folder: 'dog/dog1', prefix: 'dog1-', count: 4 },
};

const BOSS_SPRITE_DEFS = {
};

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { console.warn('Failed to load:', src); resolve(null); };
    img.src = src;
  });
}

async function loadSprites() {
  const promises = [];
  // Cat sprites: 5 dirs x 5 frames
  const catDirs = ['F', 'FR', 'R', 'BR', 'B'];
  for (const dir of catDirs) {
    SPRITES.cat[dir] = [];
    for (let i = 1; i <= 5; i++) {
      const p = loadImg(`img/chacter/${dir}${i}.png`);
      promises.push(p.then(img => { SPRITES.cat[dir][i - 1] = img; }));
    }
  }
  // Cat idle sprites: 5 dirs x 1 frame each
  SPRITES.cat.idle = {};
  for (const dir of catDirs) {
    const p = loadImg(`img/chacter/idle/${dir}.png`);
    promises.push(p.then(img => { SPRITES.cat.idle[dir] = img; }));
  }
  // Enemy sprites (data-driven)
  for (const [name, def] of Object.entries(ENEMY_SPRITE_DEFS)) {
    SPRITES.enemy[name] = [];
    for (let i = 1; i <= def.count; i++) {
      const p = loadImg(`img/enemy/${def.folder}/${def.prefix}${i}.png`);
      promises.push(p.then(img => { SPRITES.enemy[name][i - 1] = img; }));
    }
  }
  // Boss sprites (data-driven)
  for (const [name, def] of Object.entries(BOSS_SPRITE_DEFS)) {
    SPRITES.boss[name] = [];
    for (let i = 1; i <= def.count; i++) {
      const p = loadImg(`img/enemy/${def.folder}/${def.prefix}${i}.png`);
      promises.push(p.then(img => { SPRITES.boss[name][i - 1] = img; }));
    }
  }
  // Item sprites
  const itemDefs = { churu: 'img/item/churu2.png' };
  for (const [name, src] of Object.entries(itemDefs)) {
    const p = loadImg(src);
    promises.push(p.then(img => { SPRITES.item[name] = img; }));
  }
  await Promise.all(promises);
  SPRITES.loaded = true;
}

// Direction mapping: G.facing (atan2) → sprite direction + flip
function getSpriteDir(facing) {
  // Normalize to [0, 2π)
  let a = ((facing % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  // Determine flip (left side = mirror right side)
  const flip = a > Math.PI; // angles π~2π = left side
  if (flip) a = Math.PI * 2 - a; // mirror to right side
  // Map angle to direction (right side: 0=F, π/4=FR, π/2=R, 3π/4=BR, π=B)
  const eighth = Math.PI / 8;
  let dir;
  if (a < eighth) dir = 'F';
  else if (a < 3 * eighth) dir = 'FR';
  else if (a < 5 * eighth) dir = 'R';
  else if (a < 7 * eighth) dir = 'BR';
  else dir = 'B';
  return { dir, flip };
}

function getSpriteFrame(time, isMoving, fps) {
  if (!isMoving) return 0;
  return Math.floor(time * (fps || 8)) % 5;
}

// Offscreen canvas for sprite tinting (avoids source-atop on main canvas)
const _spriteCanvas = document.createElement('canvas');
const _spriteCtx = _spriteCanvas.getContext('2d');

// Start loading sprites immediately
loadSprites();

// ═══════════════════════════════════════
// STORAGE ABSTRACTION (DB 전환 대비)
// ═══════════════════════════════════════
const Storage = {
  _backend: 'local', // 'local' | 'remote'
  _cache: {},
  _dirty: new Set(),

  _keys: {
    padMode: 'catsu_padMode',
    currency: 'catsu_tunaCan',
    upgrades: 'catsu_upgrades',
    records: 'catSurvivorRecords',
  },

  _defaults: {
    padMode: 'right',
    currency: 0,
    upgrades: {},
    records: { bestWave: 0, bestKills: 0, bestLevel: 0, plays: 0, bestTime: 0, cleared: false },
  },

  _parse: {
    padMode: v => v || 'right',
    currency: v => parseInt(v) || 0,
    upgrades: v => { try { return JSON.parse(v) || {} } catch { return {} } },
    records: v => { try { return JSON.parse(v) || Storage._defaults.records } catch { return { ...Storage._defaults.records } } },
  },

  _serialize: {
    padMode: v => v,
    currency: v => String(v),
    upgrades: v => JSON.stringify(v),
    records: v => JSON.stringify(v),
  },

  get(key) {
    if (key in this._cache) return this._cache[key];
    try {
      const raw = localStorage.getItem(this._keys[key]);
      const val = raw !== null ? this._parse[key](raw) : (typeof this._defaults[key] === 'object' ? JSON.parse(JSON.stringify(this._defaults[key])) : this._defaults[key]);
      this._cache[key] = val;
      return val;
    } catch { return typeof this._defaults[key] === 'object' ? JSON.parse(JSON.stringify(this._defaults[key])) : this._defaults[key]; }
  },

  set(key, val) {
    this._cache[key] = val;
    try { localStorage.setItem(this._keys[key], this._serialize[key](val)); } catch {}
    // remote sync hook: 나중에 DB 저장 시 여기에 추가
    // if (this._backend === 'remote') this._syncToServer(key, val);
  },

  // 편의 메서드
  addCurrency(amt) { const cur = this.get('currency') + amt; this.set('currency', cur); return cur; },
};

// ═══════════════════════════════════════
// MOBILE DETECTION & TOUCH CONTROLS
// ═══════════════════════════════════════
const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
let touchMX = 0, touchMZ = 0;
let joystickActive = false;
let padMode = Storage.get('padMode');
let ultAutoUse = localStorage.getItem('catsu_ultAutoUse') !== 'false'; // default: auto
let vibrationOn = localStorage.getItem('catsu_vibration') !== 'false'; // default: on
let mobFadeOn = localStorage.getItem('catsu_mobFade') === 'true'; // 30웨이브 이후 몹 반투명
let bossRedOn = localStorage.getItem('catsu_bossRed') === 'true'; // 보스 공격 빨간색 통일

function doVibrate(ms) {
  if (!vibrationOn) return;
  try {
    const H = window.Capacitor?.Plugins?.Haptics;
    if (H) { H.vibrate({ duration: ms }); return; }
  } catch (_) {}
  if (navigator.vibrate) navigator.vibrate(ms);
}
let difficulty = 'normal'; // 'normal' or 'hard'

// ═══════════════════════════════════════
// CHARACTER SYSTEM
// ═══════════════════════════════════════
const DEFAULT_CAT_COLORS = { body: '#ffcc88', belly: '#ffeecc', ear: '#ffaabb', tail: '#ffcc88', stripe: '#aa7744' };

function getSelectedChar() {
  return { id: 'default', colors: DEFAULT_CAT_COLORS, applyPassive: () => {} };
}

// ═══════════════════════════════════════
// CAT COLOR CUSTOMIZATION
// ═══════════════════════════════════════
const CAT_COLORS = [
  { id: 'default', name: '기본', preview: '#ffcc88', filter: '', price: 0 },
  { id: 'gray', name: '회색', preview: '#999999', filter: 'saturate(0) brightness(0.95)', price: 30 },
  { id: 'black', name: '검정', preview: '#3a3a3a', filter: 'saturate(0.2) brightness(0.45)', price: 50 },
  { id: 'blue', name: '파랑', preview: '#6688dd', filter: 'hue-rotate(200deg) saturate(0.85)', price: 80 },
  { id: 'pink', name: '핑크', preview: '#ff88bb', filter: 'hue-rotate(320deg) saturate(0.9)', price: 80 },
];

let selectedCatColor = localStorage.getItem('catsu_catColor') || 'default';

function getUnlockedColors() {
  try { return JSON.parse(localStorage.getItem('catsu_unlockedColors')) || ['default']; }
  catch { return ['default']; }
}
function saveUnlockedColors(arr) {
  localStorage.setItem('catsu_unlockedColors', JSON.stringify(arr));
}

function getCatColorFilter() {
  const c = CAT_COLORS.find(c => c.id === selectedCatColor);
  return (c && c.filter) ? c.filter : '';
}

function setCatColor(colorId) {
  const unlocked = getUnlockedColors();
  if (!unlocked.includes(colorId)) return;
  selectedCatColor = colorId;
  localStorage.setItem('catsu_catColor', colorId);
  renderCharacterSelect();
}

function buyCatColor(colorId) {
  const color = CAT_COLORS.find(c => c.id === colorId);
  if (!color) return;
  const unlocked = getUnlockedColors();
  if (unlocked.includes(colorId)) { setCatColor(colorId); return; }
  const cur = loadCurrency();
  if (cur < color.price) return;
  saveCurrency(cur - color.price);
  unlocked.push(colorId);
  saveUnlockedColors(unlocked);
  selectedCatColor = colorId;
  localStorage.setItem('catsu_catColor', colorId);
  updateMainCurrency();
  renderCharacterSelect();
}

function renderCharacterSelect() {
  const colorEl = document.getElementById('colorSelect');
  if (!colorEl) return;
  const unlocked = getUnlockedColors();
  const cur = loadCurrency();
  colorEl.innerHTML = `<div class="color-select-label">색상</div><div class="color-opts">` + CAT_COLORS.map(c => {
    const owned = unlocked.includes(c.id);
    const selected = c.id === selectedCatColor;
    const canBuy = !owned && cur >= c.price;
    const cls = `color-opt${selected ? ' active' : ''}${!owned ? ' locked' : ''}${canBuy ? ' buyable' : ''}`;
    const onclick = owned ? `setCatColor('${c.id}')` : `buyCatColor('${c.id}')`;
    const label = owned ? c.name : `🐟${c.price}`;
    return `<button class="${cls}" data-color="${c.id}" onclick="${onclick}" title="${owned ? c.name : c.name + ' (🐟' + c.price + ')'}">
      <span class="color-swatch" style="background:${c.preview}"></span>
      ${!owned ? `<span class="color-price">${label}</span>` : ''}
    </button>`;
  }).join('') + `</div>`;
}

let gameMode = 'normal'; // 'normal', 'hard', 'endless'

// ═══════════════════════════════════════
// DAILY CHALLENGE SYSTEM
// ═══════════════════════════════════════
class SeededRandom {
  constructor(seed) { this.seed = seed; }
  next() { this.seed = (this.seed * 16807 + 0) % 2147483647; return this.seed / 2147483647; }
  nextInt(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }
}

function getTodaySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

const DAILY_MODIFIERS = [
  { id: 'glass_cannon', name: '유리대포', icon: '🔫', desc: 'ATK 2배, HP 절반', apply: s => { s.atk *= 2; s.maxHp = Math.floor(s.maxHp * 0.5); s.hp = s.maxHp; } },
  { id: 'bullet_hell', name: '탄막지옥', icon: '💥', desc: '적 투사체 2배', apply: s => { s._dailyProjMul = 2; } },
  { id: 'giant_slayer', name: '거인 학살', icon: '🗿', desc: '적 HP 3배, XP 2배', apply: s => { s._dailyHpMul = 3; s.xpMul *= 2; } },
  { id: 'poverty', name: '빈곤', icon: '💸', desc: 'XP 오브 없음, 킬 시에만 XP', apply: s => { s._dailyNoXpOrbs = true; } },
  { id: 'speed_freak', name: '속도광', icon: '⚡', desc: '이속 1.5배, 적 속도 1.3배', apply: s => { s.moveSpd *= 1.5; s._dailySpdMul = 1.3; } },
];

function getTodayModifiers() {
  const rng = new SeededRandom(getTodaySeed());
  const count = rng.nextInt(2, 3);
  const pool = [...DAILY_MODIFIERS];
  const picked = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = rng.nextInt(0, pool.length - 1);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

function getDailyRecord() {
  try {
    const data = JSON.parse(localStorage.getItem('catsu_dailyRecords') || '{}');
    return data[getTodaySeed()] || null;
  } catch { return null; }
}

function saveDailyRecord() {
  try {
    const data = JSON.parse(localStorage.getItem('catsu_dailyRecords') || '{}');
    const seed = getTodaySeed();
    const prev = data[seed] || { bestWave: 0 };
    if (G.wave > prev.bestWave) {
      data[seed] = { bestWave: G.wave, kills: G.kills, level: G.level };
      // Keep only last 7 days
      const keys = Object.keys(data).map(Number).sort().reverse();
      if (keys.length > 7) { for (const k of keys.slice(7)) delete data[k]; }
      localStorage.setItem('catsu_dailyRecords', JSON.stringify(data));
      return true;
    }
    return false;
  } catch { return false; }
}

function updateDailyInfo() {
  const panel = document.getElementById('dailyInfo');
  if (!panel) return;
  const mods = getTodayModifiers();
  const record = getDailyRecord();
  const seed = getTodaySeed();
  const dateStr = `${String(Math.floor(seed / 10000))}.${String(Math.floor((seed % 10000) / 100)).padStart(2, '0')}.${String(seed % 100).padStart(2, '0')}`;
  panel.innerHTML = `
    <div class="daily-date">📅 ${dateStr}</div>
    <div class="daily-mods">${mods.map(m => `<span class="daily-mod">${m.icon} ${m.name}</span>`).join('')}</div>
    ${record ? `<div class="daily-record">🏆 최고 Wave ${record.bestWave}</div>` : '<div class="daily-record">기록 없음</div>'}
  `;
}

let preBannedCards = [];
let preStarterCard = null;

// ═══════════════════════════════════════
// UPGRADE SHOP (영구 강화)
// ═══════════════════════════════════════
const UPGRADES = [
  { id: 'hp', name: '최대 HP', icon: '❤️', desc: 'HP +20', cat: '기본 능력치', maxLv: 5, costs: [15, 30, 60, 120, 250], apply: (s, lv) => { s.maxHp += lv * 20; s.hp = s.maxHp } },
  { id: 'atk', name: '투사체 ATK', icon: '⚔️', desc: 'ATK +3', cat: '기본 능력치', maxLv: 5, costs: [20, 45, 90, 180, 360], apply: (s, lv) => { s.atk += lv * 3 } },
  { id: 'spd', name: '이동속도', icon: '💨', desc: '이속 +0.2', cat: '기본 능력치', maxLv: 3, costs: [20, 50, 100], apply: (s, lv) => { s.moveSpd += lv * 0.2 } },
  { id: 'def', name: '방어력', icon: '🛡️', desc: '피해감소 +3%', cat: '기본 능력치', maxLv: 3, costs: [35, 80, 170], apply: (s, lv) => { s.damageReduce += lv * 3 } },
  { id: 'regen', name: '체력 재생', icon: '💚', desc: '초당 HP +0.5', cat: '기본 능력치', maxLv: 3, costs: [25, 55, 120], apply: (s, lv) => { s.regen += lv * 0.5 } },
  { id: 'xp', name: '경험치 획득', icon: '🔍', desc: '경험치 +10%', cat: '유틸', maxLv: 3, costs: [15, 35, 80], apply: (s, lv) => { s.xpMul += lv * 0.1 } },
  { id: 'magnet', name: '자석 범위', icon: '🧲', desc: '자석 +20%', cat: '유틸', maxLv: 3, costs: [10, 25, 55], apply: (s, lv) => { for (let i = 0; i < lv; i++) s.magnetRange *= 1.2 } },
  { id: 'aspd', name: '공격속도', icon: '⚡', desc: '공속 +8%', cat: '스킬', maxLv: 3, costs: [30, 70, 160], apply: (s, lv) => { for (let i = 0; i < lv; i++) s.atkSpd *= 1.08 } },
  { id: 'crit', name: '치명타 확률', icon: '😼', desc: '크리 +3%', cat: '스킬', maxLv: 3, costs: [30, 70, 150], apply: (s, lv) => { s.critChance += lv * 3 } },
  { id: 'lifesteal', name: '흡혈', icon: '🩸', desc: '흡혈 +1%', cat: '스킬', maxLv: 3, costs: [40, 90, 200], apply: (s, lv) => { s.lifesteal += lv } },
  { id: 'dodge', name: '회피 확률', icon: '🐈', desc: '회피 +2%', cat: '스킬', maxLv: 3, costs: [35, 80, 180], apply: (s, lv) => { s.dodgeChance += lv * 2 } },
  { id: 'projcount', name: '투사체 수', icon: '🏹', desc: '투사체 +1', cat: '빌드', maxLv: 2, costs: [80, 250], apply: (s, lv) => { s.projCount += lv } },
  { id: 'orbdmg', name: '위성 기본뎀', icon: '🌟', desc: '위성뎀 +5', cat: '빌드', maxLv: 3, costs: [25, 60, 130], apply: (s, lv) => { s.orbBaseDmg += lv * 5 } },
  { id: 'dronedmg', name: '드론 기본뎀', icon: '🛸', desc: '드론뎀 +5', cat: '빌드', maxLv: 3, costs: [25, 60, 130], apply: (s, lv) => { s.droneBaseDmg += lv * 5 } },
];

// ═══════════════════════════════════════
// ACHIEVEMENTS (기록 달성 보상)
// ═══════════════════════════════════════
const ACHIEVEMENTS = [
  { id: 'wave10',  icon: '🌊', name: 'Wave 10 돌파', desc: 'ATK +2',         check: r => r.bestWave >= 10, apply: s => { s.atk += 2 } },
  { id: 'wave20',  icon: '🌊', name: 'Wave 20 돌파', desc: 'HP +20',         check: r => r.bestWave >= 20, apply: s => { s.maxHp += 20; s.hp = s.maxHp } },
  { id: 'wave30',  icon: '🌊', name: 'Wave 30 돌파', desc: '피해감소 +3%',   check: r => r.bestWave >= 30, apply: s => { s.damageReduce += 3 } },
  { id: 'wave40',  icon: '🌊', name: 'Wave 40 돌파', desc: '공속 +8%',       check: r => r.bestWave >= 40, apply: s => { s.atkSpd *= 1.08 } },
  { id: 'clear',   icon: '🏆', name: '첫 클리어',    desc: 'ATK +5, HP +40', check: r => r.cleared,        apply: s => { s.atk += 5; s.maxHp += 40; s.hp = s.maxHp } },
  { id: 'kill100', icon: '💀', name: '100킬 달성',   desc: '경험치 +5%',     check: r => r.bestKills >= 100, apply: s => { s.xpMul += 0.05 } },
  { id: 'kill300', icon: '💀', name: '300킬 달성',   desc: '크리뎀 +0.2x',   check: r => r.bestKills >= 300, apply: s => { s.critDmgMul += 0.2 } },
  { id: 'kill500', icon: '💀', name: '500킬 달성',   desc: '흡혈 +2%',       check: r => r.bestKills >= 500, apply: s => { s.lifesteal += 2 } },
  { id: 'lv15',    icon: '📈', name: 'Lv.15 달성',   desc: '자석 +20%',      check: r => r.bestLevel >= 15, apply: s => { s.magnetRange *= 1.2 } },
  { id: 'lv25',    icon: '📈', name: 'Lv.25 달성',   desc: 'HP재생 +0.5/s',  check: r => r.bestLevel >= 25, apply: s => { s.regen += 0.5 } },
];

function applyAchievements(state) {
  const r = loadRecords();
  for (const a of ACHIEVEMENTS) {
    if (a.check(r)) a.apply(state);
  }
}

function loadUpgrades() { return Storage.get('upgrades'); }
function saveUpgrades(u) { Storage.set('upgrades', u); }

function loadCurrency() { return Storage.get('currency'); }
function saveCurrency(amt) { Storage.set('currency', amt); }
function addCurrency(amt) { return Storage.addCurrency(amt); }

function applyUpgrades(state) {
  const u = loadUpgrades();
  for (const up of UPGRADES) {
    const lv = u[up.id] || 0;
    if (lv > 0) up.apply(state, lv);
  }
}

function buyUpgrade(id) {
  const up = UPGRADES.find(u => u.id === id);
  if (!up) return;
  const u = loadUpgrades();
  const lv = u[up.id] || 0;
  if (lv >= up.maxLv) return;
  const cost = up.costs[lv];
  const cur = loadCurrency();
  if (cur < cost) return;
  saveCurrency(cur - cost);
  u[up.id] = lv + 1;
  saveUpgrades(u);
  renderUpgradeShop();
  updateMainCurrency();
}

function resetUpgrades() {
  const u = loadUpgrades();
  let refund = 0;
  for (const up of UPGRADES) {
    const lv = u[up.id] || 0;
    for (let i = 0; i < lv; i++) refund += up.costs[i];
  }
  if (refund === 0) return;
  saveUpgrades({});
  addCurrency(refund);
  renderUpgradeShop();
  updateMainCurrency();
}

function showUpgradeShop() {
  document.getElementById('upgradeOverlay').classList.remove('hidden');
  document.getElementById('startOverlay').classList.add('hidden');
  renderUpgradeShop();
}

function hideUpgradeShop() {
  document.getElementById('upgradeOverlay').classList.add('hidden');
  document.getElementById('startOverlay').classList.remove('hidden');
  showStartRecords();
  updateMainCurrency();
}

function renderUpgradeShop() {
  const body = document.getElementById('shopBody');
  const cur = loadCurrency();
  const u = loadUpgrades();
  document.getElementById('shopCurrency').textContent = `🐟 ${cur}`;

  let html = '';
  let lastCat = '';
  for (const up of UPGRADES) {
    if (up.cat !== lastCat) {
      lastCat = up.cat;
      html += `<div class="shop-cat-header">${up.cat}</div>`;
    }
    const lv = u[up.id] || 0;
    const isMax = lv >= up.maxLv;
    const cost = isMax ? 0 : up.costs[lv];
    const canAfford = cur >= cost;
    const lvText = `Lv.${lv}/${up.maxLv}`;
    const totalVal = up.desc;

    let btnClass = 'shop-buy-btn';
    let btnText = '';
    if (isMax) { btnClass += ' maxed'; btnText = 'MAX'; }
    else if (!canAfford) { btnClass += ' cant-afford'; btnText = `🐟 ${cost}`; }
    else { btnText = `🐟 ${cost}`; }

    html += `<div class="shop-item">`;
    html += `<div class="shop-item-icon">${up.icon}</div>`;
    html += `<div class="shop-item-info">`;
    html += `<div class="shop-item-name">${up.name}</div>`;
    html += `<div class="shop-item-desc">${totalVal} (레벨당)</div>`;
    html += `<div class="shop-item-lv"><span class="lv-cur">${lvText}</span></div>`;
    html += `</div>`;
    html += `<button class="${btnClass}" ${isMax ? 'disabled' : ''} onclick="buyUpgrade('${up.id}')">${btnText}</button>`;
    html += `</div>`;
  }
  body.innerHTML = html;
}

function updateMainCurrency() {
  const cur = loadCurrency();
  const el = document.getElementById('mainCurrency');
  if (el) el.textContent = cur > 0 ? `🐟 참치캔: ${cur}` : '';
}

let _settClickCount = 0, _settClickTimer = 0;
function onSettingsTitleClick() {
  clearTimeout(_settClickTimer);
  _settClickCount++;
  _settClickTimer = setTimeout(() => { _settClickCount = 0; }, 2000);
  if (_settClickCount >= 5) {
    _settClickCount = 0;
    const btn = document.getElementById('testModeBtn');
    btn.style.display = btn.style.display === 'none' ? 'block' : 'none';
  }
}

function startTestMode() {
  gameMode = 'endless';
  document.getElementById('settingsOverlay').classList.add('hidden');
  startGame();
  G.testMode = true;
  G.difficulty = 'normal';
  // 테스트모드: 즉시 카드 선택 UI 열기
  setTimeout(() => showTestCards(), 300);
}

let _testTab = 'all';
function showTestCards() {
  G.paused = true;
  const overlay = document.getElementById('testCardOverlay');
  overlay.style.display = 'block';
  renderTestTabs();
  renderTestCardList();
}

function closeTestCards() {
  document.getElementById('testCardOverlay').style.display = 'none';
  G.paused = false;
}

function renderTestTabs() {
  const tabs = document.getElementById('testCardTabs');
  const labels = { all: '전체', proj: '🔫 투사체', orb: '🌀 위성', drone: '🤖 드론', general: '⭐ 일반' };
  tabs.innerHTML = Object.entries(labels).map(([k, v]) =>
    `<button onclick="_testTab='${k}';renderTestCardList()" style="padding:4px 10px;border:none;border-radius:6px;font-size:12px;background:${_testTab===k?'#ffdd44':'#333'};color:${_testTab===k?'#000':'#fff'}">${v}</button>`
  ).join('');
}

function renderTestCardList() {
  const list = document.getElementById('testCardList');
  const filtered = _testTab === 'all' ? CARDS : CARDS.filter(c => c.build === _testTab);
  list.innerHTML = filtered.map(c => {
    const cnt = G.cardCounts[c.id] || 0;
    const ms = c.maxStack || (c.unique ? 1 : c.rarity === 'legendary' ? 1 : c.rarity === 'epic' ? 2 : c.rarity === 'rare' ? 3 : 5);
    const maxed = cnt >= ms;
    return `<div onclick="${maxed ? '' : `testPickCard('${c.id}')`}" style="width:90px;padding:6px;border-radius:8px;text-align:center;font-size:11px;cursor:${maxed?'default':'pointer'};opacity:${maxed?'0.4':'1'};background:${
      c.rarity==='legendary'?'#4a3000':c.rarity==='epic'?'#2a1040':c.rarity==='rare'?'#1a2a40':'#222'
    };border:1px solid ${c.rarity==='legendary'?'#fbbf24':c.rarity==='epic'?'#a855f7':c.rarity==='rare'?'#3b82f6':'#555'}">
      <div style="font-size:22px">${c.icon}</div>
      <div style="color:#fff;font-weight:bold">${c.name}</div>
      <div style="color:#aaa;font-size:9px">${cnt}/${ms}</div>
    </div>`;
  }).join('');
}

function testPickCard(id) {
  const c = CARDS.find(x => x.id === id);
  if (!c) return;
  const ms = c.maxStack || (c.unique ? 1 : c.rarity === 'legendary' ? 1 : c.rarity === 'epic' ? 2 : c.rarity === 'rare' ? 3 : 5);
  if ((G.cardCounts[c.id] || 0) >= ms) return;
  pickCard(c);
  G.paused = true; // pickCard이 paused를 false로 바꾸므로 다시 true
  document.getElementById('testCardOverlay').style.display = 'block';
  renderTestCardList();
}

function showSettings() {
  SFX.init();
  document.getElementById('settingsOverlay').classList.remove('hidden');
  document.getElementById('startOverlay').classList.add('hidden');
  updateSettingsIcons();
}

function hideSettings() {
  document.getElementById('settingsOverlay').classList.add('hidden');
  document.getElementById('startOverlay').classList.remove('hidden');
}

function updateSettingsIcons() {
  const icon = document.getElementById('settVolIcon');
  if (icon) icon.textContent = SFX.muted ? '🔇' : '🔊';
  const mode = ultAutoUse ? 'auto' : 'manual';
  document.querySelectorAll('[data-ult]').forEach(b => b.classList.toggle('active', b.dataset.ult === mode));
  document.querySelectorAll('[data-vib]').forEach(b => b.classList.toggle('active', (b.dataset.vib === 'on') === vibrationOn));
  document.querySelectorAll('[data-mobfade]').forEach(b => b.classList.toggle('active', (b.dataset.mobfade === 'on') === mobFadeOn));
  document.querySelectorAll('[data-bossred]').forEach(b => b.classList.toggle('active', (b.dataset.bossred === 'on') === bossRedOn));
}

function syncSliders() {
  const sv = document.getElementById('settVolSlider');
  const pv = document.getElementById('volSlider');
  const sb = document.getElementById('settBgmSlider');
  const pb = document.getElementById('bgmSlider');
  if (sv && pv) pv.value = sv.value;
  if (sb && pb) pb.value = sb.value;
}

function setPadMode(mode) {
  padMode = mode;
  Storage.set('padMode', mode);
  const tc = document.getElementById('touchControls');
  tc.classList.remove('pad-left', 'pad-right', 'pad-float');
  tc.classList.add('pad-' + mode);
  // Update button active states
  document.querySelectorAll('.pad-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.pad === mode);
  });
  // Hide float joystick when switching away
  if (mode !== 'float') {
    const fj = document.getElementById('floatJoystick');
    if (fj) fj.style.display = 'none';
  }
}

if (isMobile) {
  const tc = document.getElementById('touchControls');
  tc.classList.add('active', 'pad-' + padMode);
  // Set initial button state
  document.querySelectorAll('.pad-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.pad === padMode);
  });
  // Sync ult & vibration button states
  const ultM = ultAutoUse ? 'auto' : 'manual';
  document.querySelectorAll('[data-ult]').forEach(b => b.classList.toggle('active', b.dataset.ult === ultM));
  document.querySelectorAll('[data-vib]').forEach(b => b.classList.toggle('active', (b.dataset.vib === 'on') === vibrationOn));

  canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  // ── Fixed joystick (left/right modes) ──
  const jZone = document.getElementById('joystickZone');
  const jKnob = document.getElementById('joystickKnob');
  let jTouchId = null;
  let jCenterX = 0, jCenterY = 0;
  const jMaxDist = 26;

  jZone.addEventListener('touchstart', e => {
    if (padMode === 'float') return;
    e.preventDefault();
    const t = e.changedTouches[0];
    jTouchId = t.identifier;
    const rect = jZone.getBoundingClientRect();
    jCenterX = rect.left + rect.width / 2;
    jCenterY = rect.top + rect.height / 2;
    joystickActive = true;
    updateFixedJoystick(t.clientX, t.clientY, jKnob);
  }, { passive: false });

  jZone.addEventListener('touchmove', e => {
    if (padMode === 'float') return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === jTouchId) { updateFixedJoystick(t.clientX, t.clientY, jKnob); break; }
    }
  }, { passive: false });

  const endFixed = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === jTouchId) {
        jTouchId = null; joystickActive = false; touchMX = 0; touchMZ = 0;
        jKnob.style.transform = 'translate(-50%, -50%)'; break;
      }
    }
  };
  jZone.addEventListener('touchend', endFixed);
  jZone.addEventListener('touchcancel', endFixed);

  function updateFixedJoystick(cx, cy, knob) {
    let dx = cx - jCenterX, dy = cy - jCenterY;
    const dist = Math.hypot(dx, dy);
    if (dist > jMaxDist) { dx = dx / dist * jMaxDist; dy = dy / dist * jMaxDist; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    touchMX = dx / jMaxDist; touchMZ = dy / jMaxDist;
  }

  // ── Float joystick (appears wherever you touch) ──
  const floatEl = document.getElementById('floatJoystick');
  const floatKnob = document.getElementById('floatKnob');
  let fTouchId = null, fCenterX = 0, fCenterY = 0;
  const fMaxDist = 36;

  canvas.addEventListener('touchstart', e => {
    if (padMode !== 'float' || fTouchId !== null) return;
    const t = e.changedTouches[0];
    fTouchId = t.identifier;
    fCenterX = t.clientX; fCenterY = t.clientY;
    floatEl.style.display = 'block';
    floatEl.style.left = (fCenterX - 45) + 'px';
    floatEl.style.top = (fCenterY - 45) + 'px';
    floatKnob.style.transform = 'translate(-50%, -50%)';
    joystickActive = true;
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (padMode !== 'float') return;
    for (const t of e.changedTouches) {
      if (t.identifier === fTouchId) {
        let dx = t.clientX - fCenterX, dy = t.clientY - fCenterY;
        const dist = Math.hypot(dx, dy);
        if (dist > fMaxDist) { dx = dx / dist * fMaxDist; dy = dy / dist * fMaxDist; }
        floatKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        touchMX = dx / fMaxDist; touchMZ = dy / fMaxDist;
        break;
      }
    }
  }, { passive: false });

  const endFloat = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === fTouchId) {
        fTouchId = null; joystickActive = false; touchMX = 0; touchMZ = 0;
        floatEl.style.display = 'none';
        floatKnob.style.transform = 'translate(-50%, -50%)';
        break;
      }
    }
  };
  canvas.addEventListener('touchend', endFloat);
  canvas.addEventListener('touchcancel', endFloat);
}

function touchSkillQ(e) { e.preventDefault(); }
function touchSkillE(e) { e.preventDefault(); }

// Camera
let camX = 0, camY = 0;
let camLeadX = 0, camLeadY = 0; // look-ahead offset
function worldToScreen(wx, wy) {
  return [Math.round((wx - camX) * TILE + canvas.width / 2), Math.round((wy - camY) * TILE + canvas.height / 2)];
}

// ═══════════════════════════════════════
// 2D DRAWING HELPERS
// ═══════════════════════════════════════
function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}
function hexStr(hex) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r},${g},${b})`;
}
function hexStrA(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function drawCircle(sx, sy, r, color) {
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawRing(sx, sy, r, color, lw) {
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
}

// ═══════════════════════════════════════
// 2D CAT DRAWING (with animations)
// ═══════════════════════════════════════
// Cat animation state
const catAnim = {
  atkFlash: 0,     // attack flash timer (shrinks to 0)
  hitFlash: 0,     // damage flash timer
  idleAction: 0,   // 0=normal, 1=stretch, 2=yawn, 3=look-around
  idleTimer: 0,    // countdown to next idle action
  squish: 0,       // body squish for landing/attack
  breathe: 0,      // breathing phase
  pawSwipe: 0,     // paw attack animation
};

function updateCatAnim(dt, isMoving) {
  catAnim.breathe += dt;
  if (catAnim.atkFlash > 0) catAnim.atkFlash = Math.max(0, catAnim.atkFlash - dt);
  if (catAnim.hitFlash > 0) catAnim.hitFlash = Math.max(0, catAnim.hitFlash - dt);
  if (catAnim.pawSwipe > 0) catAnim.pawSwipe = Math.max(0, catAnim.pawSwipe - dt);
  if (catAnim.squish > 0) catAnim.squish = Math.max(0, catAnim.squish - dt * 6);

  // Idle actions
  if (!isMoving) {
    catAnim.idleTimer -= dt;
    if (catAnim.idleTimer <= 0) {
      catAnim.idleAction = Math.floor(Math.random() * 4);
      catAnim.idleTimer = 3 + Math.random() * 4;
    }
  } else {
    catAnim.idleAction = 0;
    catAnim.idleTimer = 2 + Math.random() * 2;
  }
}

function triggerCatAttack() { catAnim.atkFlash = 0.15; catAnim.pawSwipe = 0.25; catAnim.squish = 0.3; }
function triggerCatHit() {
  catAnim.hitFlash = 0.2; catAnim.squish = 0.2;
  doVibrate(80);
}

function drawCat(sx, sy, facing, time, isMoving) {
  // Sprite-based rendering
  if (!SPRITES.loaded || !SPRITES.cat.F || !SPRITES.cat.F[0]) {
    return drawCatProcedural(sx, sy, facing, time, isMoving);
  }
  const { dir, flip } = getSpriteDir(facing);
  let sprite;
  if (isMoving) {
    const frame = getSpriteFrame(time, true, 8);
    sprite = SPRITES.cat[dir] && SPRITES.cat[dir][frame];
  } else {
    sprite = SPRITES.cat.idle && SPRITES.cat.idle[dir];
    if (!sprite) sprite = SPRITES.cat[dir] && SPRITES.cat[dir][0]; // fallback to walk frame 0
  }
  if (!sprite) return drawCatProcedural(sx, sy, facing, time, isMoving);

  const isHit = catAnim.hitFlash > 0;
  const S = TILE * 0.38;
  const w = TILE * 1.4;
  const h = TILE * 1.4;

  ctx.save();
  ctx.translate(sx, sy);

  // Shadow
  ctx.save();
  ctx.scale(1, 0.5);
  drawCircle(0, S * 1.2, S * 0.9, 'rgba(0,0,0,0.15)');
  ctx.restore();

  // Wings (부활 보유 시)
  if (G.extraLife > 0) {
    const wingFlap = Math.sin(time * (isMoving ? 8 : 3)) * 0.3;
    const wingAlpha = 0.5 + Math.sin(time * 2) * 0.15;
    ctx.save();
    ctx.globalAlpha = wingAlpha;
    ctx.translate(0, -S * 0.3);
    // Left wing
    ctx.save();
    ctx.scale(-1, 1);
    ctx.rotate(wingFlap - 0.2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-S * 1.8, -S * 1.2, -S * 2.2, -S * 0.2);
    ctx.quadraticCurveTo(-S * 1.6, -S * 0.1, -S * 1.2, S * 0.3);
    ctx.quadraticCurveTo(-S * 0.6, S * 0.1, 0, 0);
    ctx.closePath();
    const wgL = ctx.createLinearGradient(0, -S, -S * 2, 0);
    wgL.addColorStop(0, 'rgba(255,255,255,0.8)');
    wgL.addColorStop(0.5, 'rgba(200,220,255,0.5)');
    wgL.addColorStop(1, 'rgba(150,180,255,0.2)');
    ctx.fillStyle = wgL;
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,220,255,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    // Right wing
    ctx.save();
    ctx.rotate(-(wingFlap - 0.2));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-S * 1.8, -S * 1.2, -S * 2.2, -S * 0.2);
    ctx.quadraticCurveTo(-S * 1.6, -S * 0.1, -S * 1.2, S * 0.3);
    ctx.quadraticCurveTo(-S * 0.6, S * 0.1, 0, 0);
    ctx.closePath();
    const wgR = ctx.createLinearGradient(0, -S, -S * 2, 0);
    wgR.addColorStop(0, 'rgba(255,255,255,0.8)');
    wgR.addColorStop(0.5, 'rgba(200,220,255,0.5)');
    wgR.addColorStop(1, 'rgba(150,180,255,0.2)');
    ctx.fillStyle = wgR;
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,220,255,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    // Wing sparkle particles
    if (Math.random() < 0.15) {
      const sa = Math.random() * Math.PI * 2;
      spawnP(G.px + Math.cos(sa) * 0.8, G.pz + Math.sin(sa) * 0.8, Math.cos(sa) * 0.5, -1.5, 0xccddff);
    }
  }

  // Bounce & squish
  const breathScale = Math.sin(catAnim.breathe * 2) * 0.5;
  const bounce = isMoving ? Math.sin(time * 12) * 2 : breathScale;
  const squishAmt = catAnim.squish;
  const scX = (1 + squishAmt * 0.15) * (flip ? -1 : 1);
  const scY = 1 - squishAmt * 0.1;

  // Draw sprite (use offscreen canvas for tint effects)
  ctx.save();
  ctx.translate(0, bounce - h * 0.15);
  ctx.scale(scX, scY);

  const _colorFilter = getCatColorFilter();
  if (isHit) {
    const pw = Math.ceil(w), ph = Math.ceil(h);
    _spriteCanvas.width = pw; _spriteCanvas.height = ph;
    _spriteCtx.clearRect(0, 0, pw, ph);
    _spriteCtx.globalAlpha = 1;
    _spriteCtx.filter = _colorFilter || 'none';
    _spriteCtx.globalCompositeOperation = 'source-over';
    _spriteCtx.drawImage(sprite, 0, 0, pw, ph);
    _spriteCtx.filter = 'none';
    _spriteCtx.globalCompositeOperation = 'source-atop';
    _spriteCtx.globalAlpha = Math.min(1, catAnim.hitFlash * 3);
    _spriteCtx.fillStyle = 'rgba(255,50,50,0.6)';
    _spriteCtx.fillRect(0, 0, pw, ph);
    ctx.drawImage(_spriteCanvas, Math.round(-pw / 2), Math.round(-ph / 2), pw, ph);
  } else if (_colorFilter) {
    const pw = Math.ceil(w), ph = Math.ceil(h);
    _spriteCanvas.width = pw; _spriteCanvas.height = ph;
    _spriteCtx.clearRect(0, 0, pw, ph);
    _spriteCtx.filter = _colorFilter;
    _spriteCtx.drawImage(sprite, 0, 0, pw, ph);
    _spriteCtx.filter = 'none';
    ctx.drawImage(_spriteCanvas, Math.round(-pw / 2), Math.round(-ph / 2), pw, ph);
  } else {
    ctx.drawImage(sprite, Math.round(-w / 2), Math.round(-h / 2), w, h);
  }
  ctx.restore();

  ctx.restore();
}

function drawCatProcedural(sx, sy, facing, time, isMoving) {
  ctx.save();
  const _colorFilter = getCatColorFilter();
  if (_colorFilter) ctx.filter = _colorFilter;
  ctx.translate(sx, sy);
  ctx.rotate(-facing);

  // Hit flash - red tint overlay
  const isHit = catAnim.hitFlash > 0;
  const isAtk = catAnim.atkFlash > 0;

  // Squish & stretch effect
  const squishAmt = catAnim.squish;
  const squishX = 1 + squishAmt * 0.15;
  const squishY = 1 - squishAmt * 0.1;
  ctx.scale(squishX, squishY);

  // Bounce: running = fast, idle = breathing
  const breathScale = Math.sin(catAnim.breathe * 2) * 0.5;
  const bounce = isMoving ? Math.sin(time * 12) * 2.5 : breathScale;
  ctx.translate(0, bounce);

  const S = TILE * 0.38;
  const charColors = getSelectedChar().colors;

  // Shadow (scales with bounce)
  ctx.save();
  ctx.scale(1, 0.5);
  const shadowScale = 1 - Math.abs(bounce) * 0.02;
  drawCircle(0, S * 1.8, S * 0.9 * shadowScale, 'rgba(0,0,0,0.15)');
  ctx.restore();

  // Wings (부활 보유 시) - procedural
  if (G.extraLife > 0) {
    const wf = Math.sin(time * (isMoving ? 8 : 3)) * 0.3;
    const wa = 0.5 + Math.sin(time * 2) * 0.15;
    ctx.save(); ctx.globalAlpha = wa; ctx.translate(0, -S * 0.2);
    for (let side = -1; side <= 1; side += 2) {
      ctx.save(); ctx.scale(side, 1); ctx.rotate(wf - 0.2);
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-S * 1.8, -S * 1.2, -S * 2.2, -S * 0.2);
      ctx.quadraticCurveTo(-S * 1.6, -S * 0.1, -S * 1.2, S * 0.3);
      ctx.quadraticCurveTo(-S * 0.6, S * 0.1, 0, 0); ctx.closePath();
      const wg = ctx.createLinearGradient(0, -S, -S * 2, 0);
      wg.addColorStop(0, 'rgba(255,255,255,0.8)'); wg.addColorStop(0.5, 'rgba(200,220,255,0.5)'); wg.addColorStop(1, 'rgba(150,180,255,0.2)');
      ctx.fillStyle = wg; ctx.fill(); ctx.strokeStyle = 'rgba(200,220,255,0.4)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // Tail (more expressive)
  ctx.save();
  const tailBase = isMoving ? 8 : (catAnim.idleAction === 1 ? 4 : 2);
  const tailAmp = isMoving ? 0.5 : (catAnim.idleAction === 3 ? 0.6 : 0.35);
  const tailWag = Math.sin(time * tailBase) * tailAmp;
  ctx.translate(0, S * 0.7);
  ctx.rotate(tailWag);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  const tailCurve = Math.sin(time * 3) * S * 0.3;
  ctx.quadraticCurveTo(S * 0.6, S * 0.6, S * 0.3 + tailCurve, S * 1.2);
  ctx.strokeStyle = isHit ? '#ff8888' : charColors.tail;
  ctx.lineWidth = S * 0.28;
  ctx.lineCap = 'round';
  ctx.stroke();
  drawCircle(S * 0.3 + tailCurve, S * 1.2, S * 0.16, isHit ? '#ffaaaa' : charColors.belly);
  ctx.restore();

  // Legs (full walk cycle with stretch animation)
  if (isMoving) {
    const freq = 12;
    const legF = Math.sin(time * freq);
    const legB = Math.cos(time * freq);
    const reach = S * 0.35;
    // Front left, back right (paired), Front right, back left (paired)
    drawCircle(-S * 0.4, -S * 0.3 + legF * reach, S * 0.19, isHit ? '#ffaaaa' : charColors.belly);
    drawCircle(S * 0.4, S * 0.3 + legF * reach, S * 0.19, isHit ? '#ffaaaa' : charColors.belly);
    drawCircle(S * 0.4, -S * 0.3 + legB * reach, S * 0.19, isHit ? '#ffaaaa' : charColors.belly);
    drawCircle(-S * 0.4, S * 0.3 + legB * reach, S * 0.19, isHit ? '#ffaaaa' : charColors.belly);
  } else if (catAnim.idleAction === 1) {
    // Stretch pose: front legs extended
    const stretchT = Math.sin(time * 1.5) * 0.3 + 0.7;
    drawCircle(-S * 0.5, -S * 0.5 * stretchT, S * 0.18, charColors.belly);
    drawCircle(S * 0.5, -S * 0.5 * stretchT, S * 0.18, charColors.belly);
    drawCircle(-S * 0.35, S * 0.35, S * 0.18, charColors.belly);
    drawCircle(S * 0.35, S * 0.35, S * 0.18, charColors.belly);
  } else {
    // Idle: gentle toe-kneading
    const knead = Math.sin(time * 2) * S * 0.04;
    drawCircle(-S * 0.4, S * 0.3 + knead, S * 0.18, charColors.belly);
    drawCircle(S * 0.4, S * 0.3 - knead, S * 0.18, charColors.belly);
    drawCircle(-S * 0.4, -S * 0.3 - knead, S * 0.18, charColors.belly);
    drawCircle(S * 0.4, -S * 0.3 + knead, S * 0.18, charColors.belly);
  }

  // Paw swipe effect (attack animation)
  if (catAnim.pawSwipe > 0) {
    const swipeP = catAnim.pawSwipe / 0.25;
    const swipeAngle = (1 - swipeP) * Math.PI * 0.6;
    ctx.save();
    ctx.translate(-S * 0.5, -S * 0.6);
    ctx.rotate(-swipeAngle);
    // Paw
    drawCircle(S * 0.6, 0, S * 0.22, '#ffdd88');
    // Claw lines
    ctx.strokeStyle = 'rgba(255,255,200,0.7)';
    ctx.lineWidth = 1.5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(S * 0.6, i * S * 0.08);
      ctx.lineTo(S * 0.85, i * S * 0.15);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Body
  const bodyColor = isHit ? '#ff9988' : (isAtk ? '#ffdd88' : charColors.body);
  drawCircle(0, 0, S, bodyColor);
  // Belly (breathing effect)
  const bellyPulse = Math.sin(catAnim.breathe * 2) * S * 0.03;
  drawCircle(0, S * 0.05, S * 0.55 + bellyPulse, isHit ? '#ffccbb' : charColors.belly);

  // Stripe pattern on body
  ctx.save();
  ctx.globalAlpha = 0.08;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(-S * 0.4, i * S * 0.25);
    ctx.quadraticCurveTo(0, i * S * 0.25 - S * 0.1, S * 0.4, i * S * 0.25);
    ctx.strokeStyle = charColors.stripe;
    ctx.lineWidth = S * 0.12;
    ctx.stroke();
  }
  ctx.restore();

  // Head
  const headY = -S * 0.85;
  const headR = S * 0.75;
  drawCircle(0, headY, headR, isHit ? '#ff9988' : charColors.body);

  // Ears (more animated)
  const earFlop = isMoving ? Math.sin(time * 12) * 0.15 : (catAnim.idleAction === 3 ? Math.sin(time * 3) * 0.2 : Math.sin(time * 1.5) * 0.05);
  // Left ear
  ctx.save();
  ctx.translate(-headR * 0.55, headY - headR * 0.5);
  ctx.rotate(-0.3 + earFlop);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-headR * 0.3, -headR * 0.55);
  ctx.lineTo(headR * 0.2, -headR * 0.15);
  ctx.closePath();
  ctx.fillStyle = isHit ? '#ff9988' : charColors.body;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-headR * 0.02, -headR * 0.05);
  ctx.lineTo(-headR * 0.2, -headR * 0.4);
  ctx.lineTo(headR * 0.1, -headR * 0.12);
  ctx.closePath();
  ctx.fillStyle = charColors.ear;
  ctx.fill();
  ctx.restore();
  // Right ear
  ctx.save();
  ctx.translate(headR * 0.55, headY - headR * 0.5);
  ctx.rotate(0.3 - earFlop);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(headR * 0.3, -headR * 0.55);
  ctx.lineTo(-headR * 0.2, -headR * 0.15);
  ctx.closePath();
  ctx.fillStyle = isHit ? '#ff9988' : charColors.body;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(headR * 0.02, -headR * 0.05);
  ctx.lineTo(headR * 0.2, -headR * 0.4);
  ctx.lineTo(-headR * 0.1, -headR * 0.12);
  ctx.closePath();
  ctx.fillStyle = charColors.ear;
  ctx.fill();
  ctx.restore();

  // Cheeks (pulse when hit)
  const cheekR = headR * 0.22 + (isHit ? Math.sin(time * 30) * headR * 0.04 : 0);
  drawCircle(-headR * 0.5, headY + headR * 0.25, cheekR, '#ffbbbb');
  drawCircle(headR * 0.5, headY + headR * 0.25, cheekR, '#ffbbbb');

  // Eyes (expressive based on state)
  const blinkPhase = Math.sin(time * 0.7);
  const isBlinking = blinkPhase > 0.97;
  const hpRatio = G.hp / G.maxHp;
  let eyeH = isBlinking ? 0.3 : 1;
  let pupilSize = headR * 0.12;
  let eyeWhite = '#fff';

  if (catAnim.idleAction === 2 && !isMoving) {
    // Yawn: eyes squeezed shut
    eyeH = 0.2 + Math.sin(time * 1.2) * 0.1;
  } else if (isAtk) {
    // Attack: fierce eyes
    eyeH = 0.7;
    pupilSize = headR * 0.14;
  } else if (hpRatio < 0.3) {
    // Low HP: worried eyes
    pupilSize = headR * 0.08;
  }

  // Left eye
  ctx.save();
  ctx.translate(-headR * 0.28, headY - headR * 0.05);
  ctx.scale(1, eyeH);
  drawCircle(0, 0, headR * 0.2, eyeWhite);
  drawCircle(0, headR * 0.02, pupilSize, isHit ? '#ff2244' : '#2a1a30');
  drawCircle(-headR * 0.06, -headR * 0.06, headR * 0.05, '#fff');
  ctx.restore();
  // Right eye
  ctx.save();
  ctx.translate(headR * 0.28, headY - headR * 0.05);
  ctx.scale(1, eyeH);
  drawCircle(0, 0, headR * 0.2, eyeWhite);
  drawCircle(0, headR * 0.02, pupilSize, isHit ? '#ff2244' : '#2a1a30');
  drawCircle(headR * 0.06, -headR * 0.06, headR * 0.05, '#fff');
  ctx.restore();

  // Nose
  drawCircle(0, headY + headR * 0.2, headR * 0.08, '#ffaabb');

  // Mouth (expressive)
  if (catAnim.idleAction === 2 && !isMoving) {
    // Yawn: open mouth
    const yawnOpen = (Math.sin(time * 1.2) + 1) * 0.5;
    ctx.beginPath();
    ctx.ellipse(0, headY + headR * 0.35, headR * 0.12, headR * 0.1 * yawnOpen, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ff8899';
    ctx.fill();
  } else if (isAtk) {
    // Attack: open mouth with fangs
    ctx.beginPath();
    ctx.moveTo(-headR * 0.12, headY + headR * 0.3);
    ctx.lineTo(0, headY + headR * 0.42);
    ctx.lineTo(headR * 0.12, headY + headR * 0.3);
    ctx.closePath();
    ctx.fillStyle = '#ff6688';
    ctx.fill();
  } else {
    // Normal W mouth
    ctx.beginPath();
    ctx.moveTo(-headR * 0.15, headY + headR * 0.32);
    ctx.lineTo(0, headY + headR * 0.38);
    ctx.lineTo(headR * 0.15, headY + headR * 0.32);
    ctx.strokeStyle = '#885566';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Whiskers
  ctx.strokeStyle = 'rgba(200,180,160,0.3)';
  ctx.lineWidth = 0.8;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(side * headR * 0.35, headY + headR * 0.22 + i * headR * 0.08);
      ctx.lineTo(side * headR * 0.8, headY + headR * 0.18 + i * headR * 0.12);
      ctx.stroke();
    }
  }

  // Hit flash overlay
  if (isHit) {
    ctx.save();
    ctx.globalAlpha = catAnim.hitFlash * 3;
    ctx.globalCompositeOperation = 'overlay';
    drawCircle(0, -S * 0.3, S * 1.3, 'rgba(255,50,50,0.4)');
    ctx.restore();
  }

  // Attack flash glow
  if (isAtk) {
    ctx.save();
    ctx.globalAlpha = catAnim.atkFlash * 5;
    drawCircle(0, -S * 0.3, S * 1.5, 'rgba(255,220,100,0.15)');
    ctx.restore();
  }

  ctx.restore();
}

// ═══════════════════════════════════════
// 2D ENEMY DRAWING
// ═══════════════════════════════════════
function drawEnemy(e, time) {
  const [sx, sy] = worldToScreen(e.x, e.z);
  const size = e.def.size * TILE * 0.9;
  const color = hexStr(e.def.bodyColor);
  const eyeColor = hexStr(e.def.eyeColor);
  const bob = e.frozenTimer > 0 ? 0 : Math.sin(time * 4) * 2;

  ctx.save();
  // 30웨이브 이후 일반몹 반투명 (보스/엘리트 제외)
  if (mobFadeOn && G.wave >= 30 && !e.isBoss && !e.isElite) ctx.globalAlpha = 0.3;
  ctx.translate(sx, sy + bob);

  // Shadow
  ctx.save();
  ctx.scale(1, 0.4);
  drawCircle(0, size * 0.4, size * 0.7, 'rgba(0,0,0,0.12)');
  ctx.restore();

  // Glow for elite/boss
  if (e.isElite) {
    drawCircle(0, 0, size + 4, 'rgba(255,68,68,0.2)');
  }
  if (e.isBoss) {
    drawCircle(0, 0, size + 8, hexStrA(e.def.eyeColor, 0.15));
  }

  // Sprite rendering (data-driven)
  const enemySpr = SPRITES.loaded && SPRITES.enemy[e.def.name];
  const bossSpr = SPRITES.loaded && e.isBoss && SPRITES.boss[e.def.name];
  const sprArr = bossSpr || enemySpr;
  if (sprArr && sprArr[0]) {
    const frameCount = sprArr.length;
    const frame = Math.floor(time * 6) % frameCount;
    const spr = sprArr[frame];
    if (spr) {
      const sw = e.def.size * TILE * 2.6;
      const sh = sw;
      // 이동 방향에 따라 스프라이트 좌우 반전 (왼쪽 이동 시 flip)
      const dx = G.px - e.x;
      const flip = dx < 0 ? -1 : 1;
      ctx.save();
      ctx.scale(flip, 1);
      ctx.drawImage(spr, Math.round(-sw / 2), Math.round(-sh / 2), Math.round(sw), Math.round(sh));
      ctx.restore();
    }
  } else {
    // Body (procedural)
    if (e.def.shape === 'sphere') {
      drawCircle(0, 0, size, color);
      drawCircle(-size * 0.25, -size * 0.25, size * 0.3, 'rgba(255,255,255,0.15)');
    } else if (e.def.shape === 'box') {
      ctx.fillStyle = color;
      const s = size * 0.85;
      ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(-s, -s, s * 2, s);
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(-size * 0.7, size * 0.5);
      ctx.lineTo(size * 0.7, size * 0.5);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Eyes (procedural only)
    const eyeY = e.def.shape === 'cone' ? -size * 0.1 : -size * 0.15;
    drawCircle(-size * 0.3, eyeY, size * 0.22, '#fff');
    drawCircle(size * 0.3, eyeY, size * 0.22, '#fff');
    drawCircle(-size * 0.3, eyeY, size * 0.13, eyeColor);
    drawCircle(size * 0.3, eyeY, size * 0.13, eyeColor);
  }

  // Boss crown
  if (e.isBoss) {
    ctx.beginPath();
    const cy = -size - 6;
    ctx.moveTo(-size * 0.5, cy);
    ctx.lineTo(-size * 0.35, cy - 12);
    ctx.lineTo(-size * 0.1, cy - 4);
    ctx.lineTo(0, cy - 16);
    ctx.lineTo(size * 0.1, cy - 4);
    ctx.lineTo(size * 0.35, cy - 12);
    ctx.lineTo(size * 0.5, cy);
    ctx.closePath();
    ctx.fillStyle = '#ffd700';
    ctx.fill();
    ctx.strokeStyle = '#ffa500';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Hit flash
  if (e._flashTimer > 0) {
    drawCircle(0, 0, size, 'rgba(255,255,255,0.4)');
  }

  // Frozen tint
  if (e.frozenTimer > 0 || G.timestopActive > 0) {
    drawCircle(0, 0, size, 'rgba(34,68,170,0.3)');
  }

  // HP bar
  if (e.hp < e.maxHp) {
    const bw = size * 1.8;
    const bh = 4;
    const by = -size - (e.isBoss ? 22 : 10);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-bw / 2, by, bw, bh);
    const hpPct = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = e.isBoss ? '#ff3333' : '#ff5555';
    ctx.fillRect(-bw / 2, by, bw * hpPct, bh);
  }

  // Drone marker indicator
  if (e.markedTimer > 0) {
    const mPulse = 0.6 + Math.sin(time * 8) * 0.4;
    ctx.save();
    ctx.globalAlpha = mPulse;
    // Red diamond above enemy
    const my = -size - (e.isBoss ? 30 : 16);
    ctx.fillStyle = '#ff3344';
    ctx.beginPath();
    ctx.moveTo(0, my - 6); ctx.lineTo(4, my); ctx.lineTo(0, my + 6); ctx.lineTo(-4, my);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ffaa44'; ctx.lineWidth = 1; ctx.stroke();
    // Red ring around enemy
    ctx.beginPath(); ctx.arc(0, 0, size + 3, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,51,68,${mPulse * 0.5})`; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// ═══════════════════════════════════════
// 2D GROUND
// ═══════════════════════════════════════
const WORLD_MIN = -14, WORLD_MAX = 14;
const WORLD_RADIUS = 14;

const MAP_THEMES = [
  { id: 'normal', name: '평원', icon: '🌿', desc: '', dark: '#2a2040', light: '#231a38', effect: null, flash: null },
  { id: 'lava', name: '용암 지대', icon: '🌋', desc: '가장자리에서 화염 피해!', dark: '#3a1a0a', light: '#2d150a', effect: 'lava', flash: 'rgba(255,60,0,0.3)' },
  { id: 'snow', name: '설원', icon: '❄️', desc: '이동속도 감소!', dark: '#1a2a3a', light: '#152535', effect: 'snow', flash: 'rgba(100,200,255,0.3)' },
  { id: 'dark', name: '어둠', icon: '🌙', desc: '시야가 제한된다!', dark: '#1a1025', light: '#140e20', effect: 'darkness', flash: 'rgba(100,50,200,0.3)' },
];

function showMapAnnounce(theme) {
  if (!theme.desc && !theme.flash) return; // 평원은 알림 스킵
  const el = document.getElementById('mapAnnounce');
  document.getElementById('mapIcon').textContent = theme.icon;
  document.getElementById('mapName').textContent = theme.name;
  document.getElementById('mapDesc').textContent = theme.desc;
  el.className = 'map-announce theme-' + theme.id;
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => el.classList.remove('show'), 2500);
  // Screen flash
  if (theme.flash) {
    const flash = document.createElement('div');
    flash.className = 'map-flash';
    flash.style.background = theme.flash;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 900);
  }
}

function drawGround() {
  const theme = G.mapTheme || MAP_THEMES[0];
  const [cx, cy] = worldToScreen(0, 0);
  const clipR = WORLD_RADIUS * TILE;

  // Clip to circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, clipR, 0, Math.PI * 2);
  ctx.clip();

  // Tile floor (circular)
  const startX = Math.floor((camX - canvas.width / TILE / 2) / 2) * 2;
  const startY = Math.floor((camY - canvas.height / TILE / 2) / 2) * 2;
  const endX = Math.ceil((camX + canvas.width / TILE / 2) / 2) * 2;
  const endY = Math.ceil((camY + canvas.height / TILE / 2) / 2) * 2;

  for (let x = startX; x <= endX; x += 2) {
    for (let y = startY; y <= endY; y += 2) {
      if (Math.hypot(x, y) > WORLD_RADIUS + 1) continue;
      const [sx, sy] = worldToScreen(x, y);
      const isDark = (Math.abs(x) + Math.abs(y)) % 4 === 0;
      ctx.fillStyle = isDark ? theme.dark : theme.light;
      ctx.fillRect(sx - TILE + 1, sy - TILE + 1, TILE * 2 - 2, TILE * 2 - 2);
    }
  }

  ctx.restore();

  // World boundary indicator (circle)
  ctx.strokeStyle = theme.effect === 'lava' ? 'rgba(255,80,0,0.12)' : 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, clipR, 0, Math.PI * 2);
  ctx.stroke();

  // Lava vignette effect
  if (theme.effect === 'lava') {
    const grd = ctx.createRadialGradient(canvas.width/2, canvas.height/2, canvas.width*0.3, canvas.width/2, canvas.height/2, canvas.width*0.7);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(255,40,0,0.15)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Draw spawn warnings
  for (const sw of G.spawnWarns || []) {
    const [sx, sy] = worldToScreen(sw.x, sw.z);
    const progress = 1 - sw.timer / sw.maxTimer;
    const alpha = 0.15 + progress * 0.35;
    const r = (0.8 + progress * 0.4) * TILE;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = sw.isElite ? `rgba(255,50,50,${alpha})` : `rgba(255,100,50,${alpha * 0.7})`;
    ctx.fill();
    // Ring
    ctx.beginPath();
    ctx.arc(sx, sy, r, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * progress);
    ctx.strokeStyle = sw.isElite ? `rgba(255,80,80,${alpha + 0.2})` : `rgba(255,150,50,${alpha + 0.1})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// ═══════════════════════════════════════
// ENEMIES
// ═══════════════════════════════════════
const ENEMY_DEFS = [
  { name: '슬라임', bodyColor: 0x88ee88, eyeColor: 0x226622, shape: 'sphere', size: .35, hp: 20, speed: 1.8, damage: 5, xp: 10 },
  { name: '우주쥐1', bodyColor: 0x9966cc, eyeColor: 0xff4444, shape: 'cone', size: .45, hp: 15, speed: 3, damage: 4, xp: 12 },
  { name: '버섯', bodyColor: 0xee8866, eyeColor: 0x442200, shape: 'sphere', size: .4, hp: 35, speed: 1.2, damage: 8, xp: 15 },
  { name: '유령', bodyColor: 0xccccff, eyeColor: 0x4444aa, shape: 'sphere', size: .38, hp: 25, speed: 2.2, damage: 6, xp: 14 },
  { name: '우주개1', bodyColor: 0xaa9988, eyeColor: 0xff6600, shape: 'box', size: .45, hp: 60, speed: .9, damage: 12, xp: 25 },
  { name: '다크슬라임', bodyColor: 0x553366, eyeColor: 0xff00ff, shape: 'sphere', size: .42, hp: 45, speed: 2, damage: 10, xp: 20 },
  { name: '불렘', bodyColor: 0xff6633, eyeColor: 0xffff00, shape: 'sphere', size: .48, hp: 70, speed: 1.5, damage: 14, xp: 30 },
  { name: '스켈레톤', bodyColor: 0xddddbb, eyeColor: 0xff0000, shape: 'box', size: .35, hp: 30, speed: 2.5, damage: 7, xp: 18 },
  { name: '우주쥐2', bodyColor: 0x448844, eyeColor: 0xaaff00, shape: 'sphere', size: .45, hp: 50, speed: 2.8, damage: 9, xp: 22 },
  { name: '크리스탈 골렘', bodyColor: 0x66ccff, eyeColor: 0xffffff, shape: 'box', size: .55, hp: 120, speed: .7, damage: 20, xp: 40 },
  { name: '화염 정령', bodyColor: 0xff4400, eyeColor: 0xffff88, shape: 'cone', size: .38, hp: 65, speed: 2.3, damage: 16, xp: 35 },
  { name: '그림자 암살자', bodyColor: 0x221133, eyeColor: 0xcc00ff, shape: 'cone', size: .3, hp: 40, speed: 3.5, damage: 22, xp: 28 },
  { name: '메두사', bodyColor: 0x99bb66, eyeColor: 0xff2255, shape: 'sphere', size: .44, hp: 90, speed: 1.6, damage: 18, xp: 38 },
  { name: '지옥 기사', bodyColor: 0x880000, eyeColor: 0xff8800, shape: 'box', size: .5, hp: 150, speed: 1.8, damage: 25, xp: 50 },
  { name: '공허 촉수', bodyColor: 0x330066, eyeColor: 0xaa55ff, shape: 'sphere', size: .46, hp: 100, speed: 2.0, damage: 20, xp: 45 },
  { name: '붉은 용아병', bodyColor: 0xcc2200, eyeColor: 0xffdd00, shape: 'cone', size: .4, hp: 80, speed: 2.6, damage: 24, xp: 42 },
];

// ═══════════════════════════════════════
// BOSSES
// ═══════════════════════════════════════
// damage = 최대HP 비례 % (접촉 시 1타 데미지)
const BOSS_DEFS = [
  { wave: 5, name: '슬라임 킹', bodyColor: 0x44dd44, eyeColor: 0xff0000, shape: 'sphere', size: 1.0, hp: 800, speed: 1.2, dmgPct: 16, xp: 200, special: 'summon', specialCD: 6 },
  { wave: 10, name: '다크 드래곤', bodyColor: 0x8833aa, eyeColor: 0xff4444, shape: 'cone', size: 1.1, hp: 2000, speed: 1.0, dmgPct: 22, xp: 500, special: 'fireball', specialCD: 4 },
  { wave: 15, name: '언데드 로드', bodyColor: 0xccccaa, eyeColor: 0xff0000, shape: 'box', size: 1.0, hp: 4000, speed: 1.4, dmgPct: 24, xp: 1000, special: 'summon_elite', specialCD: 8 },
  { wave: 20, name: '카오스 데몬', bodyColor: 0xff2200, eyeColor: 0xffff00, shape: 'sphere', size: 1.3, hp: 8000, speed: 1.5, dmgPct: 26, xp: 2000, special: 'charge', specialCD: 5 },
  { wave: 25, name: '어둠의 군주', bodyColor: 0x220044, eyeColor: 0xff00ff, shape: 'sphere', size: 1.5, hp: 15000, speed: 1.6, dmgPct: 29, xp: 3500, special: 'dark_lord', specialCD: 4 },
  { wave: 30, name: '크리스탈 타이탄', bodyColor: 0x44aaff, eyeColor: 0xffffff, shape: 'box', size: 1.6, hp: 25000, speed: 1.3, dmgPct: 30, xp: 5000, special: 'crystal_storm', specialCD: 5 },
  { wave: 35, name: '불사조 군주', bodyColor: 0xff6600, eyeColor: 0xffff44, shape: 'cone', size: 1.4, hp: 40000, speed: 1.8, dmgPct: 34, xp: 7000, special: 'phoenix_rain', specialCD: 4 },
  { wave: 40, name: '공허의 심연', bodyColor: 0x110022, eyeColor: 0xcc44ff, shape: 'sphere', size: 1.8, hp: 60000, speed: 1.5, dmgPct: 36, xp: 10000, special: 'void_zone', specialCD: 5 },
  { wave: 45, name: '천상의 심판자', bodyColor: 0xffffee, eyeColor: 0xff0044, shape: 'cone', size: 1.6, hp: 90000, speed: 2.0, dmgPct: 38, xp: 15000, special: 'judgment', specialCD: 4 },
  { wave: 50, name: '세계의 종말 - 냥토스', bodyColor: 0x000000, eyeColor: 0xff0000, shape: 'sphere', size: 2.0, hp: 150000, speed: 1.8, dmgPct: 40, xp: 30000, special: 'apocalypse', specialCD: 4 },
];

function getBossForWave(wave) {
  if (wave % 5 !== 0) return null;
  const idx = Math.min(Math.floor(wave / 5) - 1, BOSS_DEFS.length - 1);
  const base = BOSS_DEFS[idx];
  const cycle = Math.floor(wave / 5) > BOSS_DEFS.length ? Math.floor(wave / 5) - BOSS_DEFS.length : 0;
  return { ...base, wave, hp: base.hp * Math.pow(2, cycle), dmgPct: base.dmgPct + cycle * 5, xp: base.xp * Math.pow(2, cycle) };
}

function spawnBoss(bossDef) {
  const a = Math.random() * Math.PI * 2, d = 12;
  const x = G.px + Math.cos(a) * d, z = G.pz + Math.sin(a) * d;
  const hard = G.difficulty === 'hard';
  const isEndless = G.gameMode === 'endless';
  const bHp = bossDef.hp * ((hard || isEndless) ? 3.0 : 1);
  const bDmgPct = bossDef.dmgPct * (hard ? 1.3 : 1);
  const bDmg = Math.max(20, G.maxHp * bDmgPct / 100);
  const enemy = { def: bossDef, x, z, hp: bHp, maxHp: bHp, speed: bossDef.speed * (hard ? 1.15 : 1), damage: bDmg, dmgPct: bDmgPct, xp: bossDef.xp, hitTimer: 0, slowTimer: 0, frozenTimer: 0, dead: false, _orbHit: 0, _flashTimer: 0, isBoss: true, specialTimer: bossDef.specialCD * (hard ? 0.8 : 1), special: bossDef.special, specialCD: bossDef.specialCD * (hard ? 0.8 : 1), chargeTimer: 0, chargeVX: 0, chargeVZ: 0, dmgReduce: hard ? 0.35 : 0.25 };
  G.enemies.push(enemy);
  G.currentBoss = enemy;
  showBossAnnouncement(bossDef.name);
}

function showBossAnnouncement(name) {
  const el = document.getElementById('bossAnnounce');
  el.textContent = '⚠️ ' + name + ' 출현!';
  el.classList.add('show');
  SFX.play('boss');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function executeBossSpecial(boss) {
  const sp = boss.special;
  // 어둠의 군주: 4패턴 중 랜덤 2개 선택 실행
  if (sp === 'dark_lord') {
    const patterns = ['summon', 'fireball', 'summon_elite', 'charge'];
    const shuffled = patterns.sort(() => Math.random() - 0.5);
    boss._dlPatterns = [shuffled[0], shuffled[1]];
  }
  if (sp === 'summon' || (sp === 'dark_lord' && boss._dlPatterns && boss._dlPatterns.includes('summon'))) {
    const cnt = 3 + Math.floor(G.wave / 5);
    for (let i = 0; i < cnt; i++) {
      const a = Math.random() * Math.PI * 2;
      const maxT = Math.min(Math.floor(G.wave / 2), ENEMY_DEFS.length - 1);
      const def = ENEMY_DEFS[Math.floor(Math.random() * (maxT + 1))];
      const hpS = 1 + (G.wave - 1) * .25;
      const x = boss.x + Math.cos(a) * 3, z = boss.z + Math.sin(a) * 3;
      G.enemies.push({ def, x, z, hp: def.hp * hpS, maxHp: def.hp * hpS, speed: def.speed, damage: def.damage, xp: def.xp, hitTimer: 0, slowTimer: 0, frozenTimer: 0, dead: false, _orbHit: 0, _flashTimer: 0 });
    }
    for (let i = 0; i < 8; i++) { const a = Math.random() * Math.PI * 2; spawnP(boss.x + Math.cos(a) * 1.5, boss.z + Math.sin(a) * 1.5, Math.cos(a) * 3, Math.sin(a) * 3, 0x44dd44); }
  }
  if (sp === 'fireball' || (sp === 'dark_lord' && boss._dlPatterns && boss._dlPatterns.includes('fireball'))) {
    const cnt = 3 + Math.floor(G.wave / 4);
    for (let i = 0; i < cnt; i++) {
      setTimeout(() => {
        if (boss.dead || G.over) return;
        const a = Math.atan2(G.px - boss.x, G.pz - boss.z) + (Math.random() - .5) * .6;
        G.bossProjectiles.push({ x: boss.x, z: boss.z, vx: Math.sin(a) * 8, vz: Math.cos(a) * 8, damage: boss.damage * .5, life: 3, color: 0xff4400 });
      }, i * 200);
    }
  }
  if (sp === 'summon_elite' || (sp === 'dark_lord' && boss._dlPatterns && boss._dlPatterns.includes('summon_elite'))) {
    for (let i = 0; i < 2 + Math.floor(G.wave / 10); i++) {
      const a = Math.random() * Math.PI * 2;
      const def = ENEMY_DEFS[Math.min(Math.floor(G.wave / 2), ENEMY_DEFS.length - 1)];
      const x = boss.x + Math.cos(a) * 3, z = boss.z + Math.sin(a) * 3;
      const hpS = (1 + (G.wave - 1) * .25) * 2;
      const dmgS = (1 + (G.wave - 1) * .15) * 1.5;
      G.enemies.push({ def: { ...def, name: '엘리트 ' + def.name }, x, z, hp: def.hp * hpS, maxHp: def.hp * hpS, speed: def.speed * 1.3, damage: def.damage * dmgS, xp: def.xp * 3, hitTimer: 0, slowTimer: 0, frozenTimer: 0, dead: false, _orbHit: 0, _flashTimer: 0, isElite: true });
    }
    for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2; spawnP(boss.x + Math.cos(a) * 1, boss.z + Math.sin(a) * 1, Math.cos(a) * 2, Math.sin(a) * 2, 0xff4444); }
  }
  if (sp === 'charge' || (sp === 'dark_lord' && boss._dlPatterns && boss._dlPatterns.includes('charge'))) {
    const dx = G.px - boss.x, dz = G.pz - boss.z, d = Math.hypot(dx, dz);
    if (d > 0) { boss.chargeVX = (dx / d) * 15; boss.chargeVZ = (dz / d) * 15; boss.chargeTimer = .5; }
    for (let i = 0; i < 10; i++) { const a = (Math.PI * 2 / 10) * i; spawnP(boss.x + Math.cos(a) * 1.5, boss.z + Math.sin(a) * 1.5, Math.cos(a) * 2, Math.sin(a) * 2, 0xff2200); }
  }

  // ── Wave 30+ Unique Boss Specials ──

  // 크리스탈 타이탄: 크리스탈 폭풍 - 8방향 나선형 탄막 + 지면 결빙
  if (sp === 'crystal_storm') {
    const arms = 8;
    for (let burst = 0; burst < 3; burst++) {
      setTimeout(() => {
        if (boss.dead || G.over) return;
        for (let i = 0; i < arms; i++) {
          const a = (Math.PI * 2 / arms) * i + burst * 0.15;
          G.bossProjectiles.push({ x: boss.x, z: boss.z, vx: Math.sin(a) * 6, vz: Math.cos(a) * 6, damage: boss.damage * .35, life: 3.5, color: 0x44aaff });
        }
        // Freezing nova
        for (const e2 of G.enemies) { if (!e2.dead && !e2.isBoss && Math.hypot(e2.x - boss.x, e2.z - boss.z) < 6) e2.speed *= 0.7; }
        G.novaRings.push({ x: boss.x, z: boss.z, r: 0, maxR: 6 * TILE, life: 0.4, color: 0x66ccff });
      }, burst * 400);
    }
    // Ground ice zones
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 5;
      G.bossZones.push({ x: boss.x + Math.cos(a) * d, z: boss.z + Math.sin(a) * d, radius: 2, life: 4, damage: boss.damage * .2, color: 0x44aaff, type: 'slow' });
    }
    for (let i = 0; i < 12; i++) { const a = Math.random() * Math.PI * 2; spawnP(boss.x + Math.cos(a) * 2, boss.z + Math.sin(a) * 2, Math.cos(a) * 4, Math.sin(a) * 4, 0x88ddff); }
  }

  // 불사조 군주: 불비 - 플레이어 주변에 시간차 폭발 장판 + 자기 회복
  if (sp === 'phoenix_rain') {
    const cnt = 6 + Math.floor(G.wave / 8);
    for (let i = 0; i < cnt; i++) {
      setTimeout(() => {
        if (boss.dead || G.over) return;
        const tx = G.px + (Math.random() - .5) * 10, tz = G.pz + (Math.random() - .5) * 10;
        G.bossZones.push({ x: tx, z: tz, radius: 1.8, life: 1.5, damage: boss.damage * .6, color: 0xff4400, type: 'explode', warn: 0.8 });
      }, i * 150);
    }
    // Self-heal 2% (max 3 times)
    if (!boss._healCount) boss._healCount = 0;
    if (boss._healCount < 3) { boss.hp = Math.min(boss.maxHp, boss.hp + boss.maxHp * 0.02); boss._healCount++; }
    for (let i = 0; i < 8; i++) { const a = Math.random() * Math.PI * 2; spawnP(boss.x + Math.cos(a), boss.z + Math.sin(a), Math.cos(a) * 2, Math.sin(a) * 2, 0xff8800); }
    G.novaRings.push({ x: boss.x, z: boss.z, r: 0, maxR: 3 * TILE, life: 0.5, color: 0x44ff44 });
  }

  // 공허의 심연: 공허 장판 - 플레이어 위치에 거대 장판 + 흡인 효과
  if (sp === 'void_zone') {
    // Large void zone at player position
    G.bossZones.push({ x: G.px, z: G.pz, radius: 3.5, life: 6, damage: boss.damage * .3, color: 0x6600aa, type: 'pull', pullStr: 3, warn: 5 });
    // Ring of projectiles outward then curving in
    const ringCnt = 12;
    for (let i = 0; i < ringCnt; i++) {
      const a = (Math.PI * 2 / ringCnt) * i;
      G.bossProjectiles.push({ x: boss.x, z: boss.z, vx: Math.sin(a) * 5, vz: Math.cos(a) * 5, damage: boss.damage * .4, life: 3, color: 0x8833cc });
    }
    for (let i = 0; i < 15; i++) { const a = Math.random() * Math.PI * 2; spawnP(G.px + Math.cos(a) * 2, G.pz + Math.sin(a) * 2, Math.cos(a), Math.sin(a), 0x8833cc); }
    G.novaRings.push({ x: G.px, z: G.pz, r: 0, maxR: 3.5 * TILE, life: 0.6, color: 0x6600aa });
    // Also summon a few elites
    for (let i = 0; i < 3; i++) {
      const ea = Math.random() * Math.PI * 2;
      const def = ENEMY_DEFS[Math.min(Math.floor(G.wave / 2), ENEMY_DEFS.length - 1)];
      const hpS2 = (1 + (G.wave - 1) * .25) * 2;
      G.enemies.push({ def: { ...def, name: '공허 ' + def.name }, x: boss.x + Math.cos(ea) * 4, z: boss.z + Math.sin(ea) * 4, hp: def.hp * hpS2, maxHp: def.hp * hpS2, speed: def.speed * 1.4, damage: def.damage * 2, xp: def.xp * 3, hitTimer: 0, slowTimer: 0, frozenTimer: 0, dead: false, _orbHit: 0, _flashTimer: 0, isElite: true });
    }
  }

  // 천상의 심판자: 심판의 빛 - 십자 레이저 + 회전 + 순간이동
  if (sp === 'judgment') {
    // Teleport near player
    const ta = Math.random() * Math.PI * 2, td = 5 + Math.random() * 3;
    boss.x = G.px + Math.cos(ta) * td;
    boss.z = G.pz + Math.sin(ta) * td;
    // Cross laser zones
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i;
      for (let d = 1; d <= 8; d++) {
        G.bossZones.push({ x: boss.x + Math.cos(a) * d, z: boss.z + Math.sin(a) * d, radius: 0.8, life: 1.8, damage: boss.damage * .7, color: 0xffee44, type: 'explode', warn: 1.0 });
      }
    }
    // Radial burst after delay
    setTimeout(() => {
      if (boss.dead || G.over) return;
      const burstCnt = 16;
      for (let i = 0; i < burstCnt; i++) {
        const a = (Math.PI * 2 / burstCnt) * i;
        G.bossProjectiles.push({ x: boss.x, z: boss.z, vx: Math.sin(a) * 7, vz: Math.cos(a) * 7, damage: boss.damage * .5, life: 2.5, color: 0xffdd00 });
      }
      G.novaRings.push({ x: boss.x, z: boss.z, r: 0, maxR: 8 * TILE, life: 0.5, color: 0xffee44 });
    }, 1200);
    for (let i = 0; i < 20; i++) { const a = Math.random() * Math.PI * 2; spawnP(boss.x + Math.cos(a) * 1, boss.z + Math.sin(a) * 1, Math.cos(a) * 5, Math.sin(a) * 5, 0xffffaa); }
  }

  // 냥토스: 종말의 의식 - 모든 패턴 강화 + 전방위 탄막 + 장판 + 소환 + 돌진
  if (sp === 'apocalypse') {
    // Phase 1: Spiral barrage
    const spiralArms = 5;
    for (let burst = 0; burst < 5; burst++) {
      setTimeout(() => {
        if (boss.dead || G.over) return;
        for (let i = 0; i < spiralArms; i++) {
          const a = (Math.PI * 2 / spiralArms) * i + burst * 0.3;
          G.bossProjectiles.push({ x: boss.x, z: boss.z, vx: Math.sin(a) * 7, vz: Math.cos(a) * 7, damage: boss.damage * .4, life: 4, color: 0xff0000 });
          G.bossProjectiles.push({ x: boss.x, z: boss.z, vx: Math.sin(a + Math.PI) * 5, vz: Math.cos(a + Math.PI) * 5, damage: boss.damage * .3, life: 3, color: 0x8800ff });
        }
      }, burst * 250);
    }
    // Phase 2: Void zones around player
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 / 5) * i, d = 4;
      G.bossZones.push({ x: G.px + Math.cos(a) * d, z: G.pz + Math.sin(a) * d, radius: 2.5, life: 5, damage: boss.damage * .4, color: 0x440000, type: 'pull', pullStr: 2, warn: 4 });
    }
    // Phase 3: Elite summons
    for (let i = 0; i < 4; i++) {
      const ea = Math.random() * Math.PI * 2;
      const def = ENEMY_DEFS[ENEMY_DEFS.length - 1];
      const hpS2 = (1 + (G.wave - 1) * .25) * 2.5;
      G.enemies.push({ def: { ...def, name: '종말의 ' + def.name }, x: boss.x + Math.cos(ea) * 5, z: boss.z + Math.sin(ea) * 5, hp: def.hp * hpS2, maxHp: def.hp * hpS2, speed: def.speed * 1.5, damage: def.damage * 2.5, xp: def.xp * 4, hitTimer: 0, slowTimer: 0, frozenTimer: 0, dead: false, _orbHit: 0, _flashTimer: 0, isElite: true });
    }
    // Phase 4: Charge
    setTimeout(() => {
      if (boss.dead || G.over) return;
      const dx = G.px - boss.x, dz = G.pz - boss.z, d = Math.hypot(dx, dz);
      if (d > 0) { boss.chargeVX = (dx / d) * 20; boss.chargeVZ = (dz / d) * 20; boss.chargeTimer = .6; }
    }, 1500);
    // Self-heal 1% (max 3 times)
    if (!boss._healCount) boss._healCount = 0;
    if (boss._healCount < 3) { boss.hp = Math.min(boss.maxHp, boss.hp + boss.maxHp * 0.01); boss._healCount++; }
    G.novaRings.push({ x: boss.x, z: boss.z, r: 0, maxR: 8 * TILE, life: 0.6, color: 0xff0000 });
    G.novaRings.push({ x: boss.x, z: boss.z, r: 0, maxR: 5 * TILE, life: 0.4, color: 0x8800ff });
    for (let i = 0; i < 20; i++) { const a = Math.random() * Math.PI * 2; spawnP(boss.x + Math.cos(a) * 2, boss.z + Math.sin(a) * 2, Math.cos(a) * 5, Math.sin(a) * 5, 0xff2200); }
  }
}

function updateBossHUD() {
  const container = document.getElementById('bossHpBar');
  const inner = document.getElementById('bossHpInner');
  const nameEl = document.getElementById('bossName');
  const boss = G.currentBoss;
  if (boss && !boss.dead) {
    container.classList.add('show');
    inner.style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%';
    nameEl.textContent = '👑 ' + boss.def.name;
  } else {
    container.classList.remove('show');
    G.currentBoss = null;
  }
}

// ═══════════════════════════════════════
// DRONE SYSTEM (소환수 → 드론)
// ═══════════════════════════════════════
function updateDrones(dt) {
  const normalCount = G.droneCount || 0;
  const eliteCount = G.droneEliteCount || 0;
  const targetCount = normalCount + eliteCount;
  // Rebuild drone list if count or types changed
  if (G.drones.length !== targetCount || G._dronesDirty) {
    const oldTimers = G.drones.map(d => d.atkTimer);
    G.drones = [];
    for (let i = 0; i < normalCount; i++) {
      const type = (G.droneTypes && G.droneTypes[i]) ? G.droneTypes[i] : 'missile';
      G.drones.push({ angle: 0, isElite: false, type, atkTimer: oldTimers[i] || 0, burstTimer: 0 });
    }
    for (let i = 0; i < eliteCount; i++) {
      G.drones.push({ angle: 0, isElite: true, type: 'elite', atkTimer: oldTimers[normalCount + i] || 0, burstTimer: 0 });
    }
    G._dronesDirty = false;
  }

  const total = G.drones.length;
  for (let i = 0; i < total; i++) {
    const dr = G.drones[i];
    // Orbit around player (invincible, like orbitals but larger radius)
    const baseAngle = (Math.PI * 2 / Math.max(total, 1)) * i;
    dr.angle = baseAngle + G.playTime * 0.8;
    const radius = 1.8 + (dr.isElite ? 0.3 : 0);
    dr.x = G.px + Math.cos(dr.angle) * radius;
    dr.z = G.pz + Math.sin(dr.angle) * radius;

    // Find nearest enemy (limited range)
    let nearest = null, nd = 7;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - dr.x, e.z - dr.z);
      if (d < nd) { nd = d; nearest = e; }
    }

    dr.atkTimer -= dt;
    if (dr.atkTimer <= 0 && nearest) {
      const baseDmg = (G.droneBaseDmg || 15) * (dr.isElite ? 1.6 : 1);
      const dmg = baseDmg * (G.droneAtkMul || 1);
      const ultMul = G.ultDroneActive > 0 ? 5 : 1;
      const atkCD = (dr.isElite ? 0.8 : 1.2) / ((G.droneAspdMul || 1) * ultMul);
      dr.atkTimer = atkCD;

      if (dr.type === 'missile' || dr.type === 'elite') {
        // Homing missile
        fireDroneMissile(dr, nearest, dmg);
      } else if (dr.type === 'laser') {
        // Instant laser beam
        fireDroneLaser(dr, nearest, dmg);
      } else if (dr.type === 'tesla') {
        // Chain lightning to nearby enemies
        fireDroneTesla(dr, nearest, dmg);
      } else {
        // Default: missile
        fireDroneMissile(dr, nearest, dmg);
      }
    }
  }

  // Update drone missiles
  for (let i = G.droneMissiles.length - 1; i >= 0; i--) {
    const m = G.droneMissiles[i];
    m.life -= dt;
    if (m.life <= 0 || !m.target || m.target.dead) {
      // Explode if AoE
      if (G.droneAoE && m.target && !m.target.dead) {
        for (const e of G.enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.x - m.x, e.z - m.z) < 2 * (G.droneAoERadius || 1)) damageEnemy(e, m.dmg * 0.4, false, m.armorPen);
        }
        for (let k = 0; k < 4; k++) { const a = Math.random() * Math.PI * 2; spawnP(m.x + Math.cos(a)*.3, m.z + Math.sin(a)*.3, Math.cos(a)*2, Math.sin(a)*2, 0xff6600); }
      }
      G.droneMissiles.splice(i, 1); continue;
    }
    // Homing towards target
    const dx = m.target.x - m.x, dz = m.target.z - m.z, d = Math.hypot(dx, dz);
    if (d < 0.5) {
      // Hit
      damageEnemy(m.target, m.dmg, false, m.armorPen);
      if (G.droneMarker && m.target && !m.target.dead) m.target.markedTimer = 3;
      spawnP(m.x, m.z, (Math.random()-.5)*2, (Math.random()-.5)*2, m.color || 0xff8844);
      if (G.droneAoE) {
        for (const e of G.enemies) {
          if (e === m.target || e.dead) continue;
          if (Math.hypot(e.x - m.x, e.z - m.z) < 2 * (G.droneAoERadius || 1)) damageEnemy(e, m.dmg * 0.4, false, m.armorPen);
        }
        for (let k = 0; k < 4; k++) { const a = Math.random() * Math.PI * 2; spawnP(m.x + Math.cos(a)*.3, m.z + Math.sin(a)*.3, Math.cos(a)*2, Math.sin(a)*2, 0xff6600); }
      }
      G.droneMissiles.splice(i, 1);
    } else {
      const spd = 10 * dt;
      m.x += (dx / d) * spd; m.z += (dz / d) * spd;
      m.angle = Math.atan2(dx, dz);
    }
  }
}

function fireDroneMissile(dr, target, dmg) {
  G.droneMissiles.push({ x: dr.x, z: dr.z, target, dmg, life: 2.5, angle: 0, color: dr.isElite ? 0xff4400 : 0xff8844, armorPen: G.droneArmorPen || 0 });
}

function fireDroneLaser(dr, target, dmg) {
  // Instant damage + visual beam
  const pen = G.droneArmorPen || 0;
  damageEnemy(target, dmg * 1.3, false, pen);
  if (G.droneMarker && !target.dead) target.markedTimer = 3;
  if (G.droneAoE) {
    for (const e of G.enemies) {
      if (e === target || e.dead) continue;
      if (Math.hypot(e.x - target.x, e.z - target.z) < 1.5 * (G.droneAoERadius || 1)) damageEnemy(e, dmg * 0.5, false, pen);
    }
  }
  G.droneBeams.push({ x1: dr.x, z1: dr.z, x2: target.x, z2: target.z, life: 0.15, color: '#44ffaa' });
  spawnP(target.x, target.z, 0, 0, 0x44ffaa);
}

function fireDroneTesla(dr, target, dmg) {
  // Chain to up to 3 enemies
  const pen = G.droneArmorPen || 0;
  const hit = new Set();
  let cur = target;
  const chainMax = 3;
  for (let c = 0; c < chainMax && cur; c++) {
    damageEnemy(cur, dmg * (c === 0 ? 1 : 0.6), false, pen);
    if (G.droneMarker && !cur.dead) cur.markedTimer = 3;
    hit.add(cur);
    G.droneBeams.push({ x1: c === 0 ? dr.x : cur.x, z1: c === 0 ? dr.z : cur.z, x2: cur.x, z2: cur.z, life: 0.2, color: '#88ccff' });
    spawnP(cur.x, cur.z, 0, 0, 0x88ccff);
    // Find next closest
    let next = null, nd2 = 3;
    for (const e of G.enemies) {
      if (e.dead || hit.has(e)) continue;
      const d = Math.hypot(e.x - cur.x, e.z - cur.z);
      if (d < nd2) { nd2 = d; next = e; }
    }
    cur = next;
  }
}

function drawDrone(dr, time) {
  const [sx, sy] = worldToScreen(dr.x, dr.z);
  const S = TILE * (dr.isElite ? 0.3 : 0.22);
  const bob = Math.sin(time * 8 + dr.angle * 3) * 2;
  ctx.save();
  ctx.translate(sx, sy + bob);

  // Glow
  ctx.globalAlpha = 0.2;
  const glowCol = dr.isElite ? '#ff6600' : dr.type === 'laser' ? '#44ffaa' : dr.type === 'tesla' ? '#88ccff' : '#ff8844';
  drawCircle(0, 0, S * 2, glowCol);
  ctx.globalAlpha = 1;

  // Body (hexagonal drone shape)
  const bodyCol = dr.isElite ? '#ff8833' : dr.type === 'laser' ? '#33cc88' : dr.type === 'tesla' ? '#6699ff' : '#ff9955';
  ctx.beginPath();
  for (let j = 0; j < 6; j++) {
    const a = (Math.PI * 2 / 6) * j - Math.PI / 6;
    const px = Math.cos(a) * S, py = Math.sin(a) * S;
    j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fillStyle = bodyCol; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.stroke();

  // Center eye/core
  const coreCol = dr.isElite ? '#ffdd00' : '#ffffff';
  drawCircle(0, 0, S * 0.35, coreCol);

  // Propeller lines (spinning)
  ctx.globalAlpha = 0.3;
  for (let j = 0; j < 3; j++) {
    const pa = time * 15 + (Math.PI * 2 / 3) * j;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(pa) * S * 1.4, Math.sin(pa) * S * 1.4);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Elite badge
  if (dr.isElite) {
    ctx.fillStyle = '#ffd700';
    ctx.font = `bold ${S * 0.8}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', 0, -S * 1.3);
  }
  ctx.restore();
}

function drawDroneMissile(m, time) {
  const [sx, sy] = worldToScreen(m.x, m.z);
  ctx.save(); ctx.translate(sx, sy);
  ctx.rotate(-m.angle);
  // Missile body
  const c = m.color || 0xff8844;
  const col = '#' + c.toString(16).padStart(6, '0');
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(0, -4); ctx.lineTo(-2, 3); ctx.lineTo(2, 3); ctx.closePath(); ctx.fill();
  // Trail
  ctx.globalAlpha = 0.4;
  drawCircle(0, 5, 2, col); drawCircle(0, 8, 1.5, col);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawDroneBeam(beam) {
  const [x1, y1] = worldToScreen(beam.x1, beam.z1);
  const [x2, y2] = worldToScreen(beam.x2, beam.z2);
  ctx.save();
  ctx.globalAlpha = Math.min(1, beam.life * 6);
  ctx.strokeStyle = beam.color; ctx.lineWidth = 2; ctx.shadowColor = beam.color; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ═══════════════════════════════════════
// CARDS (balanced build system)
// ═══════════════════════════════════════
// 빌드: 투사체 / 위성 / 소환수 / 방어·범용
const CARDS = [
  // ══════════ COMMON (기초 카드) ══════════
  // 범용 (build: 'general')
  { id: 'spd1', name: '민첩한 발놀림', icon: '💨', desc: '이동속도 +1', rarity: 'common', build: 'general', tag: 'buff', descFn: s => `이동속도 +1 (${s.moveSpd} → ${s.moveSpd+1})`, apply: s => { s.moveSpd += 1 } },
  { id: 'hp1', name: '생선 간식', icon: '🐟', desc: '최대HP +60, 전체 회복', rarity: 'common', build: 'general', tag: 'buff', descFn: s => `최대HP +60 (${s.maxHp} → ${s.maxHp+60}), 전체 회복`, apply: s => { s.maxHp += 60; s.hp = s.maxHp } },
  { id: 'catnap', name: '낮잠', icon: '💤', desc: '3초간 피격 없으면 초당 HP 2% 회복', rarity: 'common', build: 'general', tag: 'buff', unique: true, apply: s => { s.catNap = true } },
  { id: 'xpboost', name: '호기심 냥', icon: '🔍', desc: '경험치 획득량 +25%', rarity: 'common', build: 'general', tag: 'buff', descFn: s => `경험치 획득량 +25% (현재 ${Math.round(((s.xpMul||1)-1)*100)}% → ${Math.round(((s.xpMul||1)-1)*100+25)}%)`, apply: s => { s.xpMul = (s.xpMul || 1) + 0.25 } },
  // 투사체 (build: 'proj')
  { id: 'atk1', name: '날카로운 발톱', icon: '🐾', desc: '투사체 ATK +12', rarity: 'common', build: 'proj', tag: 'buff', descFn: s => `투사체 ATK +12 (${Math.floor(s.atk)} → ${Math.floor(s.atk+12)})`, apply: s => { s.atk += 12 } },
  { id: 'aspd1', name: '빠른 앞발', icon: '⚡', desc: '공격속도 +15%', rarity: 'common', build: 'proj', tag: 'buff', apply: s => { s.atkSpd *= 1.15 } },
  // 위성 (build: 'orb')
  { id: 'small_orbit', name: '저궤도 별', icon: '✨', desc: '저궤도 위성 +1 (근접, 빠른 회전)', rarity: 'common', build: 'orb', tag: 'add', descFn: s => `저궤도 위성 +1 (${s.innerOrbitals||0} → ${(s.innerOrbitals||0)+1})`, apply: s => { s.innerOrbitals = (s.innerOrbitals || 0) + 1 } },
  { id: 'orbit_power', name: '별의 기운', icon: '🌠', desc: '위성 기본뎀 +12, 데미지 +20%', rarity: 'common', build: 'orb', tag: 'buff', descFn: s => `위성 기본뎀 +12 (${s.orbBaseDmg||15} → ${(s.orbBaseDmg||15)+12}), 데미지 +20% (${Math.round(((s.orbDmgMul||1)-1)*100)}% → ${Math.round(((s.orbDmgMul||1)+0.2-1)*100)}%)`, apply: s => { s.orbBaseDmg = (s.orbBaseDmg || 15) + 12; s.orbDmgMul = (s.orbDmgMul || 1) + 0.2 } },
  // 드론 (build: 'drone')
  { id: 'drone_basic', name: '미사일 드론', icon: '🛸', desc: '미사일 드론 +1', rarity: 'common', build: 'drone', tag: 'add', descFn: s => `미사일 드론 +1 (${s.droneCount||0} → ${(s.droneCount||0)+1})`, apply: s => { s.droneCount = (s.droneCount || 0) + 1; s.droneTypes.push('missile') } },
  { id: 'drone_power', name: '드론 강화', icon: '🔧', desc: '드론 ATK +25%, 기본뎀 +15', rarity: 'common', build: 'drone', tag: 'buff', descFn: s => `드론 ATK +25% (${Math.round(((s.droneAtkMul||1)-1)*100)}% → ${Math.round(((s.droneAtkMul||1)+0.25-1)*100)}%), 기본뎀 +15 (${s.droneBaseDmg||15} → ${(s.droneBaseDmg||15)+15})`, apply: s => { s.droneAtkMul = (s.droneAtkMul || 1) + 0.25; s.droneBaseDmg = (s.droneBaseDmg || 15) + 15 } },

  // ══════════ RARE (성장 카드) ══════════
  // 범용
  { id: 'magnet', name: '참치 자석', icon: '🧲', desc: '경험치 흡수 범위 +60%', rarity: 'rare', build: 'general', tag: 'buff', apply: s => { s.magnetRange *= 1.6 } },
  { id: 'dodge', name: '고양이 반사신경', icon: '🐈', desc: '10% 확률로 회피', rarity: 'rare', build: 'general', tag: 'buff', descFn: s => `회피 확률 +10% (${s.dodgeChance||0}% → ${(s.dodgeChance||0)+10}%)`, apply: s => { s.dodgeChance = (s.dodgeChance || 0) + 10 } },
  // 투사체
  { id: 'pierce', name: '관통의 눈', icon: '🔱', desc: '투사체 관통 +1회', rarity: 'rare', build: 'proj', tag: 'buff', descFn: s => `관통 +1회 (${s.pierce} → ${s.pierce+1}회)`, apply: s => { s.pierce += 1 } },
  { id: 'crit', name: '치명적 앙냥', icon: '😼', desc: '치명타 확률 +15%', rarity: 'rare', build: 'proj', tag: 'buff', descFn: s => `치명타 확률 +15% (${s.critChance}% → ${s.critChance+15}%)`, apply: s => { s.critChance += 15 } },
  { id: 'size', name: '거대 별', icon: '⭐', desc: '투사체 크기 +50%, 데미지 +35%, 위성 공격력 +20%', rarity: 'rare', build: 'proj', tag: 'buff', descFn: s => `투사체 크기 +50%, ATK +35% (${Math.floor(s.atk)} → ${Math.floor(s.atk*1.35)}), 위성뎀 +20%`, apply: s => { s.projSize += .5; s.atk = Math.floor(s.atk * 1.35); s.orbDmgMul = (s.orbDmgMul||1) + 0.2 } },
  { id: 'bounce', name: '바운스 별', icon: '🏀', desc: '튕김 시 분열 +1발', rarity: 'rare', build: 'proj', tag: 'add', descFn: s => `튕김 시 분열 투사체 +1발 (${s.bounceSplit||0} → ${(s.bounceSplit||0)+1}발)`, apply: s => { s.bounce = 1; s.bounceSplit = (s.bounceSplit || 0) + 1 } },
  { id: 'multishot', name: '멀티샷', icon: '🎯', desc: '투사체 +1개', rarity: 'rare', build: 'proj', tag: 'add', descFn: s => `투사체 +1개 (${s.projCount} → ${s.projCount+1}발)`, apply: s => { s.projCount += 1 } },
  // 위성
  { id: 'star_veil', name: '별의 장막', icon: '🌌', desc: '피해감소 +5%, 주변 적 둔화 장막', rarity: 'rare', build: 'orb', tag: 'buff', descFn: s => `피해감소 +5% (${s.damageReduce||0}% → ${(s.damageReduce||0)+5}%), 장막 범위 +1`, apply: s => { s.damageReduce = (s.damageReduce || 0) + 5; s.starVeil = (s.starVeil || 0) + 1 } },
  { id: 'orb_size', name: '거대 위성', icon: '🔮', desc: '위성 크기 +20%', rarity: 'rare', build: 'orb', tag: 'buff', descFn: s => `위성 크기 +20% (${Math.round(((s.orbSizeMul||1)-1)*100)}% → ${Math.round(((s.orbSizeMul||1)+0.2-1)*100)}%)`, apply: s => { s.orbSizeMul = (s.orbSizeMul || 1) + 0.2 } },
  { id: 'orb_speed', name: '가속 궤도', icon: '🌀', desc: '위성 회전속도 +40%', rarity: 'rare', build: 'orb', tag: 'buff', descFn: s => `회전속도 +40% (${Math.round(((s.orbSpeedMul||1)-1)*100)}% → ${Math.round(((s.orbSpeedMul||1)+0.4-1)*100)}%)`, apply: s => { s.orbSpeedMul = (s.orbSpeedMul || 1) + 0.4 } },
  { id: 'orb_multi', name: '고궤도 별무리', icon: '🌌', desc: '고궤도 위성 +2 (넓은 범위)', rarity: 'rare', build: 'orb', tag: 'add', descFn: s => `고궤도 위성 +2 (${s.orbitals} → ${s.orbitals+2})`, apply: s => { s.orbitals += 2 } },
  { id: 'orb_dmg', name: '별의 분노', icon: '💢', desc: '위성 데미지 +35%, 기본뎀 +10', rarity: 'rare', build: 'orb', tag: 'buff', descFn: s => `위성 데미지 +35% (${Math.round(((s.orbDmgMul||1)-1)*100)}% → ${Math.round(((s.orbDmgMul||1)+0.35-1)*100)}%), 기본뎀 +10`, apply: s => { s.orbDmgMul = (s.orbDmgMul || 1) + 0.35; s.orbBaseDmg = (s.orbBaseDmg || 15) + 10 } },
  // 소환수
  { id: 'drone_laser', name: '레이저 드론', icon: '💚', desc: '레이저 드론 +1 (즉발 빔)', rarity: 'rare', build: 'drone', tag: 'add', descFn: s => { const cnt = (s.droneTypes||['missile']).filter(t=>t==='laser').length; return `레이저 드론 +1 (현재 ${cnt}기)`; }, apply: s => { s.droneCount = (s.droneCount || 0) + 1; s.droneTypes.push('laser') } },
  { id: 'drone_tesla', name: '테슬라 드론', icon: '⚡', desc: '테슬라 드론 +1 (연쇄 번개)', rarity: 'rare', build: 'drone', tag: 'add', descFn: s => { const cnt = (s.droneTypes||['missile']).filter(t=>t==='tesla').length; return `테슬라 드론 +1 (현재 ${cnt}기)`; }, apply: s => { s.droneCount = (s.droneCount || 0) + 1; s.droneTypes.push('tesla') } },
  { id: 'drone_speed', name: '고속 모듈', icon: '🏎️', desc: '드론 공격속도 +30%', rarity: 'rare', build: 'drone', tag: 'buff', descFn: s => `드론 공속 +30% (${Math.round(((s.droneAspdMul||1)-1)*100)}% → ${Math.round(((s.droneAspdMul||1)+0.3-1)*100)}%)`, apply: s => { s.droneAspdMul = (s.droneAspdMul || 1) + 0.3 } },
  { id: 'drone_extra', name: '추가 미사일', icon: '🎇', desc: '미사일 드론 +1', rarity: 'rare', build: 'drone', tag: 'add', descFn: s => { const cnt = (s.droneTypes||[]).filter(t=>t==='missile').length; return `미사일 드론 +1 (현재 ${cnt}기)`; }, apply: s => { s.droneCount = (s.droneCount || 0) + 1; s.droneTypes.push('missile') } },
  { id: 'drone_dmg', name: '중무장 모듈', icon: '🔩', desc: '드론 ATK +35%, 기본뎀 +12', rarity: 'rare', build: 'drone', tag: 'buff', descFn: s => `드론 ATK +35% (${Math.round(((s.droneAtkMul||1)-1)*100)}% → ${Math.round(((s.droneAtkMul||1)+0.35-1)*100)}%), 기본뎀 +12`, apply: s => { s.droneAtkMul = (s.droneAtkMul || 1) + 0.35; s.droneBaseDmg = (s.droneBaseDmg || 15) + 12 } },
  // 방어
  { id: 'lifesteal_small', name: '작은 흡혈', icon: '💧', desc: '흡혈 +1%', rarity: 'common', build: 'general', tag: 'buff', descFn: s => `흡혈 +1% (${s.lifesteal}% → ${s.lifesteal+1}%)`, apply: s => { s.lifesteal += 1 } },

  // ══════════ EPIC (핵심 카드) ══════════
  // 범용
  { id: 'lifesteal', name: '뱀파이어 냥', icon: '🩸', desc: '흡혈 +5%', rarity: 'epic', build: 'general', tag: 'buff', descFn: s => `흡혈 +5% (${s.lifesteal}% → ${s.lifesteal+5}%)`, apply: s => { s.lifesteal += 5 } },
  { id: 'nova', name: '슈퍼 야옹', icon: '🌊', desc: '전방위 충격파', rarity: 'epic', build: 'general', tag: 'add', descFn: s => `전방위 충격파 (${s.hasNova?Math.max(2,(s.novaInterval||5)-1):5}초 간격)`, apply: s => { s.novaInterval = Math.max(2, (s.novaInterval || 5) - 1); s.hasNova = true } },
  // 투사체
  { id: 'chain', name: '연쇄 번개', icon: '⛓️', desc: '연쇄 +2', rarity: 'epic', build: 'proj', tag: 'buff', descFn: s => `명중 시 연쇄 +2마리 (${s.chainCount||0} → ${(s.chainCount||0)+2}마리)`, apply: s => { s.chainCount = (s.chainCount || 0) + 2 } },
  { id: 'frozen', name: '얼음 발바닥', icon: '🧊', desc: '공격이 적 1.5초 감속', rarity: 'epic', build: 'proj', tag: 'buff', apply: s => { s.slowOnHit = true } },
  { id: 'reaper', name: '죽음의 낫', icon: '💀', desc: '즉사', rarity: 'epic', build: 'proj', tag: 'buff', descFn: s => `HP ${(s.executeThresh||0)+(s.executeThresh?5:10)}% 이하 적 즉사 (${s.executeThresh||0}% → ${(s.executeThresh||0)+(s.executeThresh?5:10)}%)`, apply: s => { s.executeThresh = (s.executeThresh || 0) + (s.executeThresh ? 5 : 10) } },
  { id: 'circle_shot', name: '원형 탄막', icon: '🌸', desc: '원형 투사체 +8발', rarity: 'epic', build: 'proj', tag: 'add', descFn: s => `원형 투사체 +8발 (${s.circleShot||0} → ${(s.circleShot||0)+8}발)`, apply: s => { s.circleShot = (s.circleShot || 0) + 8 } },
  { id: 'laser', name: '냥냥 레이저', icon: '🔴', desc: '관통 레이저', rarity: 'epic', build: 'proj', tag: 'add', descFn: s => `관통 레이저 발사 (${s.hasLaser?Math.max(1,(s.laserInterval||3)-0.5).toFixed(1):3}초 간격)`, apply: s => { s.hasLaser = true; s.laserInterval = Math.max(1, (s.laserInterval || 3) - 0.5) } },
  // 위성
  { id: 'orbit', name: '수호의 별', icon: '🌟', desc: '저궤도 +2, 고궤도 +2, 기본뎀 +8', rarity: 'epic', build: 'orb', tag: 'add', descFn: s => `저궤도 +2 (${s.innerOrbitals||0} → ${(s.innerOrbitals||0)+2}), 고궤도 +2 (${s.orbitals} → ${s.orbitals+2}), 기본뎀 +8`, apply: s => { s.innerOrbitals = (s.innerOrbitals || 0) + 2; s.orbitals += 2; s.orbBaseDmg = (s.orbBaseDmg || 15) + 8 } },
  { id: 'fire_orbit', name: '화염 위성', icon: '☄️', desc: '불꽃 위성 +2개, 기본뎀 +10', rarity: 'epic', build: 'orb', tag: 'add', descFn: s => `불꽃 위성 +2 (${s.fireOrbitals||0} → ${(s.fireOrbitals||0)+2}), 기본뎀 +10`, apply: s => { s.fireOrbitals = (s.fireOrbitals || 0) + 2; s.orbBaseDmg = (s.orbBaseDmg || 15) + 10 } },
  { id: 'ice_orbit', name: '얼음 위성', icon: '❄️', desc: '얼음 위성 +2개, 기본뎀 +10', rarity: 'epic', build: 'orb', tag: 'add', descFn: s => `얼음 위성 +2 (${s.iceOrbitals||0} → ${(s.iceOrbitals||0)+2}), 기본뎀 +10`, apply: s => { s.iceOrbitals = (s.iceOrbitals || 0) + 2; s.orbBaseDmg = (s.orbBaseDmg || 15) + 10 } },
  { id: 'lightning_orbit', name: '번개 위성', icon: '⚡', desc: '번개 위성 +2개, 기본뎀 +10', rarity: 'epic', build: 'orb', tag: 'add', descFn: s => `번개 위성 +2 (${s.lightningOrbitals||0} → ${(s.lightningOrbitals||0)+2}), 기본뎀 +10`, apply: s => { s.lightningOrbitals = (s.lightningOrbitals || 0) + 2; s.orbBaseDmg = (s.orbBaseDmg || 15) + 10 } },
  { id: 'orb_resonance', name: '별의 맥동', icon: '💫', desc: '4초마다 위성 충격파 발동! 범위 내 적 데미지+둔화 (위성 수 비례)', rarity: 'epic', build: 'orb', tag: 'buff', unique: true, apply: s => { s.orbPulse = true; s.orbDmgMul = (s.orbDmgMul || 1) + 0.2 } },
  { id: 'orb_shoot', name: '별의 비', icon: '🌠', desc: '3초마다 위성 개수만큼 별이 주변에 쏟아져 광역 데미지 (위성뎀 ×1.2)', rarity: 'epic', build: 'orb', tag: 'add', unique: true, descFn: s => `별의 비 (${(s.orbShootInterval||3).toFixed(1)}초 간격, 반경 8)`, apply: s => { s.orbShoot = true; s.orbShootInterval = Math.max(1.5, (s.orbShootInterval || 3)); s.orbDmgMul = (s.orbDmgMul || 1) + 0.15 } },
  // 소환수
  { id: 'drone_elite', name: '정예 드론', icon: '🔥', desc: '정예 드론 +1 (강화 미사일)', rarity: 'epic', build: 'drone', tag: 'add', descFn: s => `정예 드론 +1 (${s.droneEliteCount||0} → ${(s.droneEliteCount||0)+1})`, apply: s => { s.droneEliteCount = (s.droneEliteCount || 0) + 1 } },
  { id: 'drone_aoe', name: '폭발 탄두', icon: '💣', desc: '드론 공격 시 범위 폭발', rarity: 'epic', build: 'drone', tag: 'buff', unique: true, apply: s => { s.droneAoE = true } },
  { id: 'drone_overclock', name: '오버클럭', icon: '⏫', desc: '드론 공속 +50%, ATK +30%', rarity: 'epic', build: 'drone', tag: 'buff', descFn: s => `드론 공속 +50% (${Math.round(((s.droneAspdMul||1)-1)*100)}% → ${Math.round(((s.droneAspdMul||1)+0.5-1)*100)}%), ATK +30%`, apply: s => { s.droneAspdMul = (s.droneAspdMul || 1) + 0.5; s.droneAtkMul = (s.droneAtkMul || 1) + 0.3 } },
  { id: 'drone_swarm', name: '드론 편대', icon: '🛩️', desc: '미사일 +1, 레이저 +1', rarity: 'epic', build: 'drone', tag: 'add', descFn: s => `미사일 +1, 레이저 +1 (총 드론 ${(s.droneCount||0)+(s.droneEliteCount||0)} → ${(s.droneCount||0)+(s.droneEliteCount||0)+2}기)`, apply: s => { s.droneCount = (s.droneCount || 0) + 2; s.droneTypes.push('missile','laser') } },
  { id: 'drone_armor_break', name: '표적 지정 시스템', icon: '🎯', desc: '드론 공격 적에게 표적 디버프 3초! 표적은 받는 데미지 +25%', rarity: 'epic', build: 'drone', tag: 'buff', unique: true, apply: s => { s.droneMarker = true; s.droneAtkMul = (s.droneAtkMul || 1) + 0.2 } },
  // 빌드 특화 확률 카드
  { id: 'proj_affinity', name: '투사체 집중', icon: '🎯', desc: '투사체 빌드 집중! 항상 1장 투사체 카드 보장', rarity: 'epic', build: 'proj', tag: 'buff', unique: true, group: 'affinity', apply: s => { s.focusBuild = 'proj' } },
  { id: 'orb_affinity', name: '위성 집중', icon: '🪐', desc: '위성 빌드 집중! 항상 1장 위성 카드 보장', rarity: 'epic', build: 'orb', tag: 'buff', unique: true, group: 'affinity', apply: s => { s.focusBuild = 'orb' } },
  { id: 'drone_affinity', name: '드론 집중', icon: '🛸', desc: '드론 빌드 집중! 항상 1장 드론 카드 보장', rarity: 'epic', build: 'drone', tag: 'buff', unique: true, group: 'affinity', apply: s => { s.focusBuild = 'drone' } },

  // ══════════ LEGENDARY (빌드 완성) ══════════
  // 범용
  { id: 'ninelife', name: '아홉 개의 목숨', icon: '💎', desc: '부활 +1, HP +100', rarity: 'legendary', build: 'general', tag: 'buff', descFn: s => `사망 시 부활 +1 (${s.extraLife} → ${s.extraLife+1}회), HP +100`, apply: s => { s.extraLife += 1; s.maxHp += 100; s.hp = s.maxHp } },
  { id: 'timestop', name: '시간 정지 야옹', icon: '⏳', desc: '10초마다 3초간 적 전원 정지', rarity: 'legendary', build: 'general', tag: 'add', unique: true, apply: s => { s.hasTimestop = true; s.timestopInterval = 10; s.timestopTimer = 10 } },
  { id: 'ghost_cat', name: '유령 고양이', icon: '👻', desc: '피격 시 1.5초 무적+이속 2배 (쿨 8초)', rarity: 'legendary', build: 'general', tag: 'buff', unique: true, apply: s => { s.ghostCat = true; s.ghostCd = 0 } },
  // 투사체
  { id: 'berserk', name: '광폭 고양이', icon: '🔥', desc: 'HP 낮을수록 ATK 최대 2배', rarity: 'legendary', build: 'proj', tag: 'buff', unique: true, apply: s => { s.berserk = true } },
  { id: 'proj_master', name: '궁극의 사수', icon: '🎆', desc: '투사체 +3, 관통 +2, 투사체ATK +30', rarity: 'legendary', build: 'proj', tag: 'add', unique: true, descFn: s => `투사체 ${s.projCount}→${s.projCount+3}발, 관통 ${s.pierce}→${s.pierce+2}회, 투사체ATK +30`, apply: s => { s.projCount += 3; s.pierce += 2; s.atk += 30 } },
  // 위성
  { id: 'orbit_master', name: '행성 파괴자', icon: '🪐', desc: '모든 위성 2배, 기본뎀 +20, 데미지 +50%', rarity: 'legendary', build: 'orb', tag: 'add', unique: true, descFn: s => `위성 ${s.orbitals}→${s.orbitals*2}개, 기본뎀 +20, 데미지 +50%`, apply: s => { s.orbitals *= 2; s.fireOrbitals = (s.fireOrbitals||0)*2; s.iceOrbitals = (s.iceOrbitals||0)*2; s.lightningOrbitals = (s.lightningOrbitals||0)*2; s.orbBaseDmg = (s.orbBaseDmg||15)+20; s.orbDmgMul = (s.orbDmgMul||1)+0.5 } },
  // 소환수
  { id: 'drone_master', name: '드론 함대', icon: '🚀', desc: '드론 전원 2배, ATK +100%', rarity: 'legendary', build: 'drone', tag: 'add', unique: true, descFn: s => `드론 ${(s.droneCount||0)+(s.droneEliteCount||0)}→${((s.droneCount||0)+(s.droneEliteCount||0))*2}기, ATK +100%`, apply: s => { s.droneCount = (s.droneCount||0)*2; s.droneEliteCount = (s.droneEliteCount||0)*2; s.droneAtkMul = (s.droneAtkMul||1)+1.0; s.droneTypes = [...s.droneTypes, ...s.droneTypes] } },

  // ══════════ ULTIMATE (빌드 궁극기 - 1개만 선택) ══════════
  { id: 'ult_proj', name: '별의 폭풍', icon: '🌠', desc: '50초마다 전방위 별폭풍 발동', rarity: 'legendary', build: 'proj', tag: 'add', unique: true, group: 'ultimate', apply: s => { s.hasUltProj = true; s.ultProjTimer = 50 } },
  { id: 'ult_orb', name: '별의 보호막', icon: '💫', desc: '50초마다 모든 위성 개수 × 0.1초 무적', rarity: 'legendary', build: 'orb', tag: 'add', unique: true, group: 'ultimate', apply: s => { s.hasUltOrb = true; s.ultOrbTimer = 50 } },
  { id: 'ult_drone', name: '오메가 스트라이크', icon: '🎯', desc: '50초마다 전 드론 일제 사격 (3초간 5배속)', rarity: 'legendary', build: 'drone', tag: 'add', unique: true, group: 'ultimate', apply: s => { s.hasUltDrone = true; s.ultDroneTimer = 50 } },

  // ══════════ UTILITY (미사용 변수 활용) ══════════
  { id: 'thorns1', name: '가시 갑옷', icon: '🦔', desc: '피격 시 ATK×50% 반사, 피해감소 +3%', rarity: 'rare', build: 'general', tag: 'buff', unique: true, descFn: s => `반사 ${s.thorns} → ${+(s.thorns+0.5).toFixed(1)}, 피해감소 ${s.damageReduce||0}% → ${(s.damageReduce||0)+3}%`, apply: s => { s.thorns += 0.5; s.damageReduce = (s.damageReduce || 0) + 3 } },
  { id: 'thorns2', name: '가시 요새', icon: '🏰', desc: '반사 +50%, 피해감소 +3%', rarity: 'epic', build: 'general', tag: 'buff', unique: true, descFn: s => `thorns ${s.thorns} → ${+(s.thorns+0.5).toFixed(1)}, 피해감소 ${s.damageReduce}% → ${s.damageReduce+3}%`, apply: s => { s.thorns += 0.5; s.damageReduce += 3 } },
  { id: 'split_proj', name: '분열탄', icon: '💥', desc: '투사체 명중 시 2갈래 분열 (40% 데미지)', rarity: 'epic', build: 'proj', tag: 'buff', unique: true, apply: s => { s.splitOnHit = true } },
  { id: 'regen1', name: '자연 회복', icon: '🌿', desc: '초당 HP 0.5 재생', rarity: 'common', build: 'general', tag: 'buff', descFn: s => `재생 ${s.regen}/s → ${+(s.regen+0.5).toFixed(1)}/s`, apply: s => { s.regen += 0.5 } },
  { id: 'regen2', name: '재생의 축복', icon: '✨', desc: '재생 +1/s, 최대HP +30', rarity: 'rare', build: 'general', tag: 'buff', descFn: s => `재생 ${s.regen}/s → ${+(s.regen+1).toFixed(1)}/s, HP ${s.maxHp} → ${s.maxHp+30}`, apply: s => { s.regen += 1; s.maxHp += 30; s.hp = Math.min(s.hp + 30, s.maxHp) } },
];

// ═══════════════════════════════════════
// SYNERGY SYSTEM
// ═══════════════════════════════════════
const SYNERGIES = [
  // ── 2-card combos ──
  { id: 'flame_frenzy', name: '화염 폭주', icon: '🔥', required: ['fire_orbit', 'frozen'], desc: '위성뎀 +30%, 화상 2배', apply: s => { s.orbDmgMul = (s.orbDmgMul || 1) + 0.3; s.burnDmgMul = (s.burnDmgMul || 1) + 1.0 } },
  { id: 'elec_storm', name: '전기 폭풍', icon: '⚡', required: ['lightning_orbit', 'chain'], desc: '체인 +2, 번개뎀 +50%', apply: s => { s.chainCount += 2; s.lightOrbDmgMul = (s.lightOrbDmgMul || 1) + 0.5 } },
  { id: 'iron_wall', name: '철벽 방어', icon: '🛡️', required: ['thorns1', 'star_veil'], desc: '피해감소 +10%, 반사 +0.3', apply: s => { s.damageReduce += 10; s.thorns += 0.3 } },
  { id: 'precision', name: '정밀 사격', icon: '🎯', required: ['crit', 'reaper'], desc: '크리뎀 +0.5, 처형 +5%', apply: s => { s.critDmgMul += 0.5; s.executeThresh += 5 } },
  { id: 'drone_legion', name: '드론 군단', icon: '🌀', required: ['drone_master', 'drone_aoe'], desc: '드론 공속 +30%, AoE 1.5배', apply: s => { s.droneAspdMul = (s.droneAspdMul || 1) + 0.3; s.droneAoERadius = (s.droneAoERadius || 1) * 1.5 } },
  // ── 3-card combos (Type A: 멀티카드 시너지) ──
  { id: 'elemental_master', name: '원소 마스터', icon: '🌈', required: ['fire_orbit', 'ice_orbit', 'lightning_orbit'], desc: '원소 위성이 카오스 위성으로 합체! (화상+둔화+체인, 뎀 2배)', apply: s => { s.chaosOrbitals = (s.fireOrbitals||0) + (s.iceOrbitals||0) + (s.lightningOrbitals||0); s.fireOrbitals = 0; s.iceOrbitals = 0; s.lightningOrbitals = 0; s.orbDmgMul = (s.orbDmgMul || 1) + 0.3 } },
  { id: 'glass_cannon', name: '유리 대포', icon: '💎', required: ['berserk', 'crit', 'reaper'], desc: 'ATK 1.5배, 크리뎀 +0.5, 피해감소 -15%', apply: s => { s.atk = Math.floor(s.atk * 1.5); s.critDmgMul += 0.5; s.damageReduce = Math.max(0, s.damageReduce - 15) } },
  { id: 'immortal_cat', name: '불멸의 냥', icon: '😇', required: ['ninelife', 'regen2', 'lifesteal'], desc: '재생 +3/s, 흡혈 +5%, 최대HP +150', apply: s => { s.regen += 3; s.lifesteal += 5; s.maxHp += 150; s.hp += 150 } },
  { id: 'bullet_hell', name: '탄막 지옥', icon: '🎆', required: ['multishot', 'circle_shot', 'chain'], desc: '투사체 +3, 원형탄 +6, 체인 +3', apply: s => { s.projCount += 3; s.circleShot = (s.circleShot || 0) + 6; s.chainCount += 3 } },
  { id: 'space_fleet', name: '우주 함대', icon: '🚀', required: ['drone_master', 'drone_overclock', 'drone_swarm'], desc: '드론 ATK +100%, 공속 +60%', apply: s => { s.droneAtkMul = (s.droneAtkMul || 1) + 1.0; s.droneAspdMul = (s.droneAspdMul || 1) + 0.6 } },
  { id: 'fortress', name: '난공불락', icon: '🏯', required: ['thorns2', 'star_veil', 'dodge'], desc: '반사 +1.0, 피해감소 +15%, 회피 +5%', apply: s => { s.thorns += 1.0; s.damageReduce += 15; s.dodgeChance += 5 } },
  // ── Cross-build synergies (크로스 빌드) ──
  { id: 'orbital_strike', name: '궤도 폭격', icon: '☄️', required: ['orb_resonance', 'drone_aoe'], desc: '위성 맥동이 드론 폭발도 유발! 맥동 범위 +50%, 드론 AoE +50%', apply: s => { s.orbPulseDroneSync = true; s.droneAoERadius = (s.droneAoERadius || 1) * 1.5 } },
  { id: 'hunter_instinct', name: '사냥 본능', icon: '🐆', required: ['drone_armor_break', 'reaper'], desc: '표적 적 즉사 문턱 2배! 처형 +8%', apply: s => { s.markerExecuteBonus = true; s.executeThresh += 8 } },
  { id: 'star_barrage', name: '유성우', icon: '🌠', required: ['orbit', 'multishot'], desc: '투사체가 위성을 통과하면 위성뎀 50% 추가! 투사체 +2', apply: s => { s.projOrbBoost = true; s.projCount += 2 } },
  { id: 'magnetic_field', name: '자기장', icon: '🧲', required: ['lightning_orbit', 'drone_tesla'], desc: '번개 위성+테슬라가 공명! 둘 다 체인 +2, 감전 적 이속 -50%', apply: s => { s.chainCount += 2; s.lightOrbDmgMul = (s.lightOrbDmgMul || 1) + 0.3; s.teslaChainBonus = 2 } },
  { id: 'frozen_arsenal', name: '빙결 병기', icon: '🥶', required: ['ice_orbit', 'frozen'], desc: '둔화 적에게 모든 데미지 +35%, 얼음 위성 +2', apply: s => { s.slowDmgBonus = true; s.iceOrbitals = (s.iceOrbitals || 0) + 2 } },
  { id: 'overcharge', name: '과부하', icon: '💥', required: ['drone_overclock', 'chain'], desc: '드론 킬 시 주변 연쇄폭발! 드론 공속 +20%', apply: s => { s.droneChainExplode = true; s.droneAspdMul = (s.droneAspdMul || 1) + 0.2 } },
];

// ═══════════════════════════════════════
// TYPE B: EVOLUTION SYSTEM (만렙 진화)
// ═══════════════════════════════════════
const EVOLUTIONS = [
  { cardId: 'atk1', name: '파멸의 발톱', icon: '🐾💀', desc: 'ATK +50, 크리확률 +10%', apply: s => { s.atk += 50; s.critChance += 10 } },
  { cardId: 'aspd1', name: '섬광의 연타', icon: '⚡💨', desc: '공속 +40%, 투사체 +1', apply: s => { s.atkSpd *= 1.4; s.projCount += 1 } },
  { cardId: 'spd1', name: '질풍 고양이', icon: '💨🌪️', desc: '이동속도 +5, 회피 +20%', apply: s => { s.moveSpd += 5; s.dodgeChance += 20 } },
  { cardId: 'hp1', name: '철갑 생선', icon: '🐟🛡️', desc: '최대HP +200, 피해감소 +8%', apply: s => { s.maxHp += 200; s.hp += 200; s.damageReduce += 8 } },
  { cardId: 'small_orbit', name: '별의 군주', icon: '✨👑', desc: '저궤도 위성 +5, 위성뎀 +40%', apply: s => { s.innerOrbitals = (s.innerOrbitals || 0) + 5; s.orbDmgMul = (s.orbDmgMul || 1) + 0.4 } },
  { cardId: 'drone_basic', name: '군단장 드론', icon: '🛸⭐', desc: '미사일 드론 +3, ATK +50%', apply: s => { s.droneCount += 3; for (let i = 0; i < 3; i++) s.droneTypes.push('missile'); s.droneAtkMul = (s.droneAtkMul||1) + 0.5 } },
  { cardId: 'regen1', name: '생명의 나무', icon: '🌿🌳', desc: '재생 +5/s, 최대HP +100', apply: s => { s.regen += 5; s.maxHp += 100; s.hp += 100 } },
  { cardId: 'lifesteal_small', name: '흡혈 군주', icon: '💧🩸', desc: '흡혈 +8%, ATK +20', apply: s => { s.lifesteal += 8; s.atk += 20 } },
  { cardId: 'orbit_power', name: '초신성', icon: '🌠💥', desc: '위성 기본뎀 +40, 뎀 +60%', apply: s => { s.orbBaseDmg = (s.orbBaseDmg || 15) + 40; s.orbDmgMul = (s.orbDmgMul || 1) + 0.6 } },
  { cardId: 'drone_power', name: '오버드라이브', icon: '🔧🔥', desc: '드론 ATK +80%, 기본뎀 +40', apply: s => { s.droneAtkMul = (s.droneAtkMul || 1) + 0.8; s.droneBaseDmg = (s.droneBaseDmg || 15) + 40 } },
  { cardId: 'catnap', name: '깊은 잠', icon: '💤😴', desc: '미피격 회복 2%→5%, 1.5초로 단축, 최대HP +80', apply: s => { s.napHealRate = 0.05; s.napDelay = 1.5; s.maxHp += 80; s.hp += 80 } },
];

// ═══════════════════════════════════════
// TYPE C: BUILD ALL-IN BONUSES (올인 보너스)
// ═══════════════════════════════════════
const BUILD_BONUSES = [
  { build: 'proj', tiers: [
    { count: 6, id: 'proj_6', name: '사수의 각성', icon: '🏹✨', desc: 'ATK +30%, 관통 +1', apply: s => { s.atk = Math.floor(s.atk * 1.3); s.pierce += 1 } },
    { count: 10, id: 'proj_10', name: '별의 폭군', icon: '🏹🔥', desc: 'ATK +60%, 투사체 +2, 크리 +15%', apply: s => { s.atk = Math.floor(s.atk * 1.6); s.projCount += 2; s.critChance += 15 } },
  ]},
  { build: 'orb', tiers: [
    { count: 6, id: 'orb_6', name: '별의 수호자', icon: '🌟✨', desc: '위성뎀 +40%, 크기 +15%', apply: s => { s.orbDmgMul = (s.orbDmgMul || 1) + 0.4; s.orbSizeMul = (s.orbSizeMul || 1) + 0.15 } },
    { count: 10, id: 'orb_10', name: '은하의 지배자', icon: '🌟🔥', desc: '위성뎀 +80%, 위성 +5, 회전속도 +50%', apply: s => { s.orbDmgMul = (s.orbDmgMul || 1) + 0.8; s.orbitals += 5; s.orbSpeedMul = (s.orbSpeedMul || 1) + 0.5 } },
  ]},
  { build: 'drone', tiers: [
    { count: 6, id: 'drone_6', name: '전술 지휘관', icon: '🛸✨', desc: '드론 ATK +40%, 공속 +30%', apply: s => { s.droneAtkMul = (s.droneAtkMul || 1) + 0.4; s.droneAspdMul = (s.droneAspdMul || 1) + 0.3 } },
    { count: 10, id: 'drone_10', name: '기계 군주', icon: '🛸🔥', desc: '드론 ATK +100%, 공속 +60%, 드론 +3', apply: s => { s.droneAtkMul = (s.droneAtkMul || 1) + 1.0; s.droneAspdMul = (s.droneAspdMul || 1) + 0.6; s.droneCount += 3; for (let i = 0; i < 3; i++) s.droneTypes.push('missile') } },
  ]},
  { build: 'general', tiers: [
    { count: 6, id: 'general_6', name: '만능 고양이', icon: '🎴✨', desc: '최대HP +150, ATK +25, 이속 +3, 재생 +1/s', apply: s => { s.maxHp += 150; s.hp += 150; s.atk += 25; s.moveSpd += 3; s.regen += 1 } },
    { count: 10, id: 'general_10', name: '전설의 냥이', icon: '🎴🔥', desc: '전 데미지 +50%, HP ×1.5, 재생 +3/s, 회피 +10%', apply: s => { s.atk = Math.floor(s.atk * 1.5); s.orbDmgMul = (s.orbDmgMul||1) + 0.5; s.droneAtkMul = (s.droneAtkMul||1) + 0.5; s.maxHp = Math.floor(s.maxHp * 1.5); s.hp = Math.min(s.hp + Math.floor(s.maxHp * 0.5), s.maxHp); s.regen += 3; s.dodgeChance += 10 } },
  ]},
];

function checkSynergies() {
  if (!G.activeSynergies) G.activeSynergies = new Set();
  // Type A: Card synergies
  for (const syn of SYNERGIES) {
    if (G.activeSynergies.has(syn.id)) continue;
    if (syn.required.every(id => G.pickedCards.has(id))) {
      G.activeSynergies.add(syn.id);
      syn.apply(G);
      showDmg(G.px, G.pz - 1, syn.icon + ' ' + syn.name + '!', 0xffd700, 18, true, 1500);
      showDmg(G.px, G.pz - 0.5, syn.desc, 0xfbbf24, 12, true, 1500);
    }
  }
  // Type B: Evolution (maxStack reached)
  for (const evo of EVOLUTIONS) {
    const evoId = 'evo_' + evo.cardId;
    if (G.activeSynergies.has(evoId)) continue;
    const card = CARDS.find(c => c.id === evo.cardId);
    if (!card) continue;
    const ms = card.maxStack || (card.unique ? 1 : card.rarity === 'legendary' ? 1 : card.rarity === 'epic' ? 2 : card.rarity === 'rare' ? 3 : 5);
    if ((G.cardCounts[evo.cardId] || 0) >= ms) {
      G.activeSynergies.add(evoId);
      evo.apply(G);
      showDmg(G.px, G.pz - 1.5, '⬆️ 진화!', 0xff44ff, 20, true, 1500);
      showDmg(G.px, G.pz - 1, evo.icon + ' ' + evo.name, 0xff88ff, 16, true, 1500);
      showDmg(G.px, G.pz - 0.5, evo.desc, 0xddaaff, 12, true, 1500);
    }
  }
  // Type C: Build all-in bonuses
  const buildCounts = { proj: 0, orb: 0, drone: 0, general: 0 };
  for (const [id, cnt] of Object.entries(G.cardCounts)) {
    const card = CARDS.find(c => c.id === id);
    if (card) buildCounts[card.build] = (buildCounts[card.build] || 0) + cnt;
  }
  for (const bb of BUILD_BONUSES) {
    for (const tier of bb.tiers) {
      if (G.activeSynergies.has(tier.id)) continue;
      if (buildCounts[bb.build] >= tier.count) {
        G.activeSynergies.add(tier.id);
        tier.apply(G);
        showDmg(G.px, G.pz - 1.5, '🏆 올인 보너스!', 0x44ffaa, 20, true, 1500);
        showDmg(G.px, G.pz - 1, tier.icon + ' ' + tier.name, 0x66ffcc, 16, true, 1500);
        showDmg(G.px, G.pz - 0.5, tier.desc, 0xaaffdd, 12, true, 1500);
      }
    }
  }
}

function pickWeighted(pool, used) {
  const total = pool.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return null;
  for (let t = 0; t < 50; t++) {
    let roll = Math.random() * total, cum = 0;
    for (const entry of pool) {
      cum += entry.weight;
      if (roll < cum) {
        if (!used.has(entry.card.id)) { used.add(entry.card.id); return entry.card; }
        break;
      }
    }
  }
  return null;
}

// Rarity weights: first roll rarity, then pick card from that rarity
const RARITY_WEIGHTS = { common: 55, rare: 25, epic: 15, legendary: 5 };

function getRandomCards(n) {
  // Build available pool grouped by rarity
  const byRarity = { common: [], rare: [], epic: [], legendary: [] };
  for (const c of CARDS) {
    if (c.unique && G.pickedCards && G.pickedCards.has(c.id)) continue;
    if (c.group && G.pickedGroups && G.pickedGroups.has(c.group)) continue;
    if (G.bannedCards && G.bannedCards.has(c.id)) continue;
    const ms = c.maxStack || (c.unique ? 1 : c.rarity === 'legendary' ? 1 : c.rarity === 'epic' ? 2 : c.rarity === 'rare' ? 3 : 5);
    if ((G.cardCounts[c.id] || 0) >= ms) continue;
    byRarity[c.rarity].push(c);
  }

  // Wave 10 이하: 레전더리 제외
  if (G.wave <= 10) byRarity.legendary = [];

  // Build flat pool with rarity-first weighting
  const available = [];
  for (const [rarity, cards] of Object.entries(byRarity)) {
    if (cards.length === 0) continue;
    const perCard = RARITY_WEIGHTS[rarity] / cards.length;
    for (const c of cards) available.push({ card: c, weight: perCard });
  }

  const r = [], used = new Set();

  // If focusBuild is set (집중카드 picked), guarantee 1 slot from that build
  if (G.focusBuild) {
    const buildPool = available.filter(e => e.card.build === G.focusBuild);
    const pick = pickWeighted(buildPool, used);
    if (pick) r.push(pick);
  }

  // Fill remaining slots from full pool
  while (r.length < n) {
    const pick = pickWeighted(available, used);
    if (pick) r.push(pick);
    else break;
  }

  // Shuffle
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// ═══════════════════════════════════════
// CARD CODEX (도감)
// ═══════════════════════════════════════
const BUILD_LABELS = { proj: '🏹 투사체', orb: '🌟 위성', drone: '🛸 드론', general: '🎴 범용' };
const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
const RARITY_LABELS = { common: '일반', rare: '레어', epic: '에픽', legendary: '전설' };

let codexActiveBuild = 'all';

function showCardCodex() {
  const overlay = document.getElementById('cardCodexOverlay');
  overlay.classList.remove('hidden');
  document.getElementById('startOverlay').classList.add('hidden');

  // Build tabs + combo tab
  const tabsEl = document.getElementById('codexTabs');
  const builds = ['all', 'proj', 'orb', 'drone', 'general', 'combos'];
  const tabLabels = { all: '📋 전체', ...BUILD_LABELS, combos: '🔗 콤보' };
  tabsEl.innerHTML = builds.map(b =>
    `<button class="codex-tab${codexActiveBuild === b ? ' active' : ''}" onclick="setCodexTab('${b}')">${tabLabels[b]}</button>`
  ).join('');

  renderCodexCards();
}

function hideCardCodex() {
  document.getElementById('cardCodexOverlay').classList.add('hidden');
  document.getElementById('startOverlay').classList.remove('hidden');
}

// ═══════════════════════════════════════
// PROGRESSION VIEWER (성장 현황)
// ═══════════════════════════════════════
function showProgression() {
  const overlay = document.getElementById('progressionOverlay');
  overlay.classList.remove('hidden');
  document.getElementById('startOverlay').classList.add('hidden');
  renderProgression();
}

function hideProgression() {
  document.getElementById('progressionOverlay').classList.add('hidden');
  document.getElementById('startOverlay').classList.remove('hidden');
}

function renderProgression() {
  const body = document.getElementById('progressionBody');
  const r = loadRecords();
  const unlocked = ACHIEVEMENTS.filter(a => a.check(r)).length;
  let html = '';

  html += `<div class="prog-plays">${unlocked} / ${ACHIEVEMENTS.length} 달성</div>`;

  for (const a of ACHIEVEMENTS) {
    const done = a.check(r);
    html += `<div class="prog-item${done ? ' unlocked' : ''}">`;
    html += `<span class="prog-item-icon">${a.icon}</span>`;
    html += `<span class="prog-item-info"><span class="prog-item-name">${a.name}</span><span class="prog-item-req">${a.desc}</span></span>`;
    html += `<span class="prog-item-status">${done ? '✅' : '🔒'}</span>`;
    html += `</div>`;
  }

  body.innerHTML = html;
}

function setCodexTab(build) {
  codexActiveBuild = build;
  // Update tab active state
  document.querySelectorAll('.codex-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  renderCodexCards();
}

function renderCodexCards() {
  const body = document.getElementById('codexBody');

  if (codexActiveBuild === 'combos') {
    let html = '';
    // Type A: Synergies
    html += `<div class="codex-rarity-section"><div class="codex-rarity-header" style="color:#ffd700">🔗 시너지 조합 <span class="codex-rarity-count">${SYNERGIES.length}종</span></div>`;
    html += `<div class="codex-grid">`;
    for (const syn of SYNERGIES) {
      const reqNames = syn.required.map(id => { const c = CARDS.find(x => x.id === id); return c ? c.icon + c.name : id; }).join(' + ');
      html += `<div class="codex-card" style="border-color:rgba(255,215,0,.3)"><div class="codex-card-icon">${syn.icon}</div><div class="codex-card-info">`;
      html += `<div class="codex-card-name" style="color:#ffd700">${syn.name}</div>`;
      html += `<div class="codex-card-desc" style="color:#bbb;font-size:10px">${reqNames}</div>`;
      html += `<div class="codex-card-desc">${syn.desc}</div>`;
      html += `</div></div>`;
    }
    html += `</div></div>`;
    // Type B: Evolutions
    html += `<div class="codex-rarity-section"><div class="codex-rarity-header" style="color:#ff88ff">⬆️ 만렙 진화 <span class="codex-rarity-count">${EVOLUTIONS.length}종</span></div>`;
    html += `<div class="codex-grid">`;
    for (const evo of EVOLUTIONS) {
      const card = CARDS.find(c => c.id === evo.cardId);
      const ms = card ? (card.maxStack || (card.unique ? 1 : card.rarity === 'legendary' ? 1 : card.rarity === 'epic' ? 2 : card.rarity === 'rare' ? 3 : 5)) : '?';
      html += `<div class="codex-card" style="border-color:rgba(255,68,255,.3)"><div class="codex-card-icon">${evo.icon}</div><div class="codex-card-info">`;
      html += `<div class="codex-card-name" style="color:#ff88ff">${evo.name}</div>`;
      html += `<div class="codex-card-desc" style="color:#bbb;font-size:10px">${card ? card.icon + card.name : evo.cardId} ★${ms} 달성 시</div>`;
      html += `<div class="codex-card-desc">${evo.desc}</div>`;
      html += `</div></div>`;
    }
    html += `</div></div>`;
    // Type C: Build All-in
    html += `<div class="codex-rarity-section"><div class="codex-rarity-header" style="color:#66ffcc">🏆 올인 보너스 <span class="codex-rarity-count">${BUILD_BONUSES.reduce((s,b)=>s+b.tiers.length,0)}종</span></div>`;
    html += `<div class="codex-grid">`;
    for (const bb of BUILD_BONUSES) {
      const bLabel = BUILD_LABELS[bb.build] || bb.build;
      for (const tier of bb.tiers) {
        html += `<div class="codex-card" style="border-color:rgba(68,255,170,.3)"><div class="codex-card-icon">${tier.icon}</div><div class="codex-card-info">`;
        html += `<div class="codex-card-name" style="color:#66ffcc">${tier.name}</div>`;
        html += `<div class="codex-card-desc" style="color:#bbb;font-size:10px">${bLabel} 카드 ${tier.count}장 이상</div>`;
        html += `<div class="codex-card-desc">${tier.desc}</div>`;
        html += `</div></div>`;
      }
    }
    html += `</div></div>`;
    body.innerHTML = html;
    return;
  }

  const filtered = codexActiveBuild === 'all' ? CARDS : CARDS.filter(c => c.build === codexActiveBuild);

  // Group by rarity
  const groups = {};
  for (const r of RARITY_ORDER) groups[r] = [];
  for (const c of filtered) groups[c.rarity].push(c);

  let html = '';
  for (const r of RARITY_ORDER) {
    if (groups[r].length === 0) continue;
    html += `<div class="codex-rarity-section">`;
    html += `<div class="codex-rarity-header rarity-${r}">${RARITY_LABELS[r]} <span class="codex-rarity-count">${groups[r].length}장</span></div>`;
    html += `<div class="codex-grid">`;
    for (const c of groups[r]) {
      const buildLabel = BUILD_LABELS[c.build] || '';
      html += `<div class="codex-card rarity-border-${r}">`;
      html += `<div class="codex-card-icon">${c.icon}</div>`;
      html += `<div class="codex-card-info">`;
      html += `<div class="codex-card-name">${c.name}</div>`;
      html += `<div class="codex-card-desc">${c.desc}</div>`;
      html += `<div class="codex-card-meta"><span class="codex-card-build">${buildLabel}</span>${c.unique ? '<span class="codex-card-unique">1회</span>' : ''}</div>`;
      html += `</div></div>`;
    }
    html += `</div></div>`;
  }
  body.innerHTML = html;
}

// ═══════════════════════════════════════
// GAME STATE
// ═══════════════════════════════════════
let G = {};
const keys = {};

function initState() {
  G = {
    started: false, over: false, paused: false, testMode: false, difficulty: gameMode === 'hard' ? 'hard' : 'normal', gameMode: gameMode,
    hp: 200, maxHp: 200, atk: 10, atkSpd: 1, moveSpd: 3.5,
    range: 6, projCount: 1, projSize: 1, pierce: 0,
    critChance: 5, critDmgMul: 2, lifesteal: 0,
    magnetRange: 2.5, orbitals: 0,
    hasNova: false, novaInterval: 5, novaTimer: 0,
    slowOnHit: false, berserk: false, extraLife: 0,
    bounce: 0, bounceSplit: 0, circleShot: 0, damageReduce: 0, regen: 0, xpMul: 1,
    dodgeChance: 0, thorns: 0, chainCount: 0,
    executeThresh: 0, splitOnHit: false, activeSynergies: new Set(), burnDmgMul: 1, lightOrbDmgMul: 1,
    hasTimestop: false, timestopInterval: 10, timestopTimer: 10, timestopActive: 0,
    ghostCat: false, ghostCd: 0, ghostActive: 0,
    catNap: false, napTimer: 0,
    innerOrbitals: 0, fireOrbitals: 0, iceOrbitals: 0, lightningOrbitals: 0, starVeil: 0,
    orbSizeMul: 1, orbSpeedMul: 1, orbDmgMul: 1, orbBaseDmg: 15,
    orbShoot: false, orbShootInterval: 3, orbShootTimer: 0, orbStarRains: [],
    hasLaser: false, laserInterval: 3, laserTimer: 0, laserBeams: [],
    // Drone system
    drones: [], droneMissiles: [], droneBeams: [],
    droneCount: 0, droneEliteCount: 0,
    droneAtkMul: 1, droneAspdMul: 1, droneBaseDmg: 15, droneAoE: false,
    droneTypes: [],  // 'missile', 'laser', 'tesla'
    pickedCards: new Set(), pickedGroups: new Set(), bannedCards: new Set(preBannedCards), focusBuild: null, playTime: 0, cardCounts: {},
    hasUltProj: false, ultProjTimer: 15, ultProjActive: 0,
    hasUltOrb: false, ultOrbTimer: 20,
    hasUltDrone: false, ultDroneTimer: 18, ultDroneActive: 0,
    ultReady: false,
    bossProjectiles: [], bossZones: [], currentBoss: null, _bossRushWait: false, _bossRushTimer: 0, mapTheme: MAP_THEMES[0],
    level: 1, xp: 0, xpNeeded: 30, kills: 0, wave: 1,
    waveTimer: 0, waveInterval: 20, spawnTimer: 0,
    atkTimer: 0, enemies: [], projectiles: [], xpOrbs: [], particles: [], drops: [], spawnWarns: [], _magnetPulse: 0,
    invincibleTimer: 0,
    px: 0, pz: 0, facing: 0,
    // VFX
    novaRings: [], // {x,z,r,maxR,life}
    shakeTimer: 0, shakeX: 0, shakeY: 0,
    // Daily challenge fields
    _dailyProjMul: 1, _dailyHpMul: 1, _dailySpdMul: 1, _dailyNoXpOrbs: false,
  };
  applyUpgrades(G);
  applyAchievements(G);
  const charDef = getSelectedChar();
  charDef.applyPassive(G);
  G.charId = charDef.id;
  // Apply daily challenge modifiers
  if (G.gameMode === 'daily') {
    const mods = getTodayModifiers();
    for (const mod of mods) mod.apply(G);
  }
  // Apply starter card
  if (preStarterCard) {
    const card = CARDS.find(c => c.id === preStarterCard);
    if (card) { card.apply(G); G.pickedCards.add(card.id); if (card.group) G.pickedGroups.add(card.group); G.cardCounts[card.id] = (G.cardCounts[card.id] || 0) + 1; checkSynergies(); }
  }
}

function activateUlt(type) {
  G.ultReady = false;
  if (type === 'proj') {
    G.ultProjTimer = 50; G.ultProjActive = 2;
    G.novaRings.push({ x: G.px, z: G.pz, r: 0, maxR: 7 * TILE, life: 0.5, color: 0xfbbf24 });
    for (let i = 0; i < 16; i++) { const a = (Math.PI * 2 / 16) * i; spawnP(G.px + Math.cos(a) * 1.5, G.pz + Math.sin(a) * 1.5, Math.cos(a) * 4, Math.sin(a) * 4, 0xfbbf24); }
  } else if (type === 'orb') {
    G.ultOrbTimer = 50;
    const totalOrbs = (G.innerOrbitals||0) + G.orbitals + (G.fireOrbitals||0) + (G.iceOrbitals||0) + (G.lightningOrbitals||0) + (G.chaosOrbitals||0);
    const shieldDur = totalOrbs * 0.1;
    G.invincibleTimer = Math.max(G.invincibleTimer, shieldDur);
    showDmg(G.px, G.pz, `💫 무적 ${shieldDur.toFixed(1)}초!`, 0xffdd44, 18, true, 1500);
    G.novaRings.push({ x: G.px, z: G.pz, r: 0, maxR: 4 * TILE, life: 0.5, color: 0xffdd44 });
    for (let i = 0; i < 12; i++) { const a = (Math.PI * 2 / 12) * i; spawnP(G.px + Math.cos(a) * 1.2, G.pz + Math.sin(a) * 1.2, Math.cos(a) * 3, Math.sin(a) * 3, 0xffdd44); }
    G.shakeTimer = 0.15;
  } else if (type === 'drone') {
    G.ultDroneTimer = 50; G.ultDroneActive = 3;
    for (let i = 0; i < 8; i++) { const a = Math.random() * Math.PI * 2; spawnP(G.px + Math.cos(a) * 2, G.pz + Math.sin(a) * 2, Math.cos(a) * 3, Math.sin(a) * 3, 0x66ffaa); }
  }
  SFX.play('shoot');
}

function triggerUlt() {
  if (!G.ultReady) return;
  if (G.hasUltProj) activateUlt('proj');
  else if (G.hasUltOrb) activateUlt('orb');
  else if (G.hasUltDrone) activateUlt('drone');
}

function setVibration(on) {
  vibrationOn = on;
  localStorage.setItem('catsu_vibration', on ? 'true' : 'false');
  document.querySelectorAll('[data-vib]').forEach(b => b.classList.toggle('active', (b.dataset.vib === 'on') === on));
  if (on) doVibrate(40); // test vibration
}

function setMobFade(on) {
  mobFadeOn = on;
  localStorage.setItem('catsu_mobFade', on ? 'true' : 'false');
  document.querySelectorAll('[data-mobfade]').forEach(b => b.classList.toggle('active', (b.dataset.mobfade === 'on') === on));
}

function setBossRed(on) {
  bossRedOn = on;
  localStorage.setItem('catsu_bossRed', on ? 'true' : 'false');
  document.querySelectorAll('[data-bossred]').forEach(b => b.classList.toggle('active', (b.dataset.bossred === 'on') === on));
}

function setUltMode(mode) {
  ultAutoUse = mode === 'auto';
  localStorage.setItem('catsu_ultAutoUse', ultAutoUse ? 'true' : 'false');
  document.querySelectorAll('[data-ult]').forEach(b => b.classList.toggle('active', b.dataset.ult === mode));
  // Auto로 전환 시 이미 준비된 궁극기 즉시 발동
  if (ultAutoUse && G.ultReady) {
    if (G.hasUltProj) activateUlt('proj');
    else if (G.hasUltOrb) activateUlt('orb');
    else if (G.hasUltDrone) activateUlt('drone');
  }
}

addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'Escape') { togglePause(); return; }
  if (G.started && !G.over && !G.paused) {
    if (e.key === ' ') { triggerUlt(); e.preventDefault(); }
  }
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false });

// ═══════════════════════════════════════
// SPAWN / COMBAT
// ═══════════════════════════════════════
const MAX_ENEMIES = 150;
function spawnEnemy() {
  if (G.enemies.length >= MAX_ENEMIES) return;
  const w = G.wave;
  const hard = G.difficulty === 'hard';
  const maxT = Math.min(Math.floor(w / 2), ENEMY_DEFS.length - 1);
  const def = ENEMY_DEFS[Math.floor(Math.random() * (maxT + 1))];
  const lateHpMul = w > 30 ? 1 + (w - 30) * (hard ? 0.12 : 0.10) : 1;
  const lateDmgMul = w > 30 ? 1 + (w - 30) * (hard ? 0.05 : 0.04) : 1;
  const hpS = (1 + (w - 1) * .25 + Math.pow(Math.max(0, w - 8), 1.5) * .1) * lateHpMul * (hard ? 1.8 : 1);
  const dmgS = (1 + (w - 1) * .10 + Math.pow(Math.max(0, w - 10), 1.05) * .04) * lateDmgMul * (hard ? 1.5 : 1);
  const isElite = w >= (hard ? 5 : 8) && Math.random() < Math.min(hard ? .40 : .3, (w - (hard ? 5 : 8)) * (hard ? .05 : .04));
  const eliteMul = isElite ? (hard ? 2.2 : 2) : 1;
  // Spawn inside map edge (circular)
  const a = Math.random() * Math.PI * 2;
  const spawnR = WORLD_RADIUS - 1 - Math.random() * 3;
  const x = Math.cos(a) * spawnR, z = Math.sin(a) * spawnR;
  const spdMul = isElite ? 1.3 : 1;
  const dmgReduce = hard ? 0.10 : 0;
  const dailyHpMul = G._dailyHpMul || 1;
  const dailySpdMul = G._dailySpdMul || 1;
  const warnTime = 0.7;
  G.spawnWarns.push({ x, z, timer: warnTime, maxTimer: warnTime, isElite, enemyData: { def: isElite ? { ...def, name: '엘리트 ' + def.name } : def, x, z, hp: def.hp * hpS * eliteMul * dailyHpMul, maxHp: def.hp * hpS * eliteMul * dailyHpMul, speed: def.speed * spdMul * (hard ? 1.1 : 1) * dailySpdMul, damage: def.damage * dmgS * eliteMul, xp: Math.floor(def.xp * (isElite ? 3 : 1)), hitTimer: 0, slowTimer: 0, frozenTimer: 0, dead: false, _orbHit: 0, _flashTimer: 0, isElite, dmgReduce } });
}

function spawnXpOrb(x, z, amt) {
  if (G._dailyNoXpOrbs) return;
  G.xpOrbs.push({ x, z, amount: amt, life: 60 });
}

// ─ Drop Items ─
const DROP_DEFS = [
  { id: 'churu', name: '츄르', icon: '🍬', weight: 60, sprite: 'churu',
    apply() { const heal = G.maxHp * 0.15; G.hp = Math.min(G.maxHp, G.hp + heal); showDmg(G.px, G.pz, `+${Math.floor(heal)}HP`, 0x4ade80, 14, true); } },
  { id: 'magnet', name: '자석', icon: '🧲', weight: 40, sprite: null,
    apply() { G._magnetPulse = 3; showDmg(G.px, G.pz, 'MAGNET!', 0x60a5fa, 14, true); } },
];
const DROP_TOTAL_W = DROP_DEFS.reduce((s, d) => s + d.weight, 0);

function trySpawnDrop(x, z, isBoss) {
  const chance = isBoss ? 1.0 : 0.015; // boss=100%, normal=1.5%
  if (Math.random() > chance) return;
  let r = Math.random() * DROP_TOTAL_W, pick = DROP_DEFS[0];
  for (const d of DROP_DEFS) { r -= d.weight; if (r <= 0) { pick = d; break; } }
  G.drops.push({ def: pick, x, z, life: 12 });
}

function fireAtNearest() {
  if (!G.enemies.length) return;
  let nearest = null, nd = G.range;
  for (const e of G.enemies) { if (e.dead) continue; const d = Math.hypot(e.x - G.px, e.z - G.pz); if (d < nd) { nd = d; nearest = e; } }
  if (!nearest) return;
  SFX.play('shoot');
  const ba = Math.atan2(nearest.x - G.px, nearest.z - G.pz);
  const cnt = G.projCount;
  const distRatio = Math.min(nd / G.range, 1);
  const spread = cnt > 1 ? .08 + .18 * distRatio : 0;
  for (let i = 0; i < cnt; i++) {
    const ao = cnt > 1 ? (i / (cnt - 1) - .5) * spread * 2 : 0;
    const ang = ba + ao;
    const col = [0xffdd44, 0xff88aa, 0x88ddff, 0xaaffaa, 0xffaaff][i % 5];
    let isCrit = Math.random() * 100 < G.critChance;
    let dmg = G.atk;
    if (G.berserk) dmg *= 1 + (1 - G.hp / G.maxHp);
    if (isCrit) dmg *= G.critDmgMul;
    G.projectiles.push({ x: G.px, z: G.pz, vx: Math.sin(ang) * 14, vz: Math.cos(ang) * 14, damage: dmg, isCrit, pierce: G.pierce, bounce: G.bounce, bounceSplit: G.bounceSplit || 0, life: 2, hitEnemies: new Set(), color: col, size: 0.8 + G.projSize * 0.5 });
  }
}

// ═══════════════════════════════════════
// (Skills removed)
// ═══════════════════════════════════════

function updateSkillHUD() {}

function damageEnemy(e, dmg, isCrit, armorPen) {
  if (e.markedTimer > 0) dmg *= 1.25;
  if (G.slowDmgBonus && e.slowTimer > 0) dmg *= 1.35;
  // 위성 개수 비례 보스 추가 데미지 (위성 1개당 +8%, 최대 +200%)
  if (e.isBoss) {
    const totalOrbs = (G.innerOrbitals||0) + (G.orbitals||0) + (G.fireOrbitals||0) + (G.iceOrbitals||0) + (G.lightningOrbitals||0) + (G.chaosOrbitals||0);
    if (totalOrbs > 0) dmg *= 1 + Math.min(2.0, totalOrbs * 0.08);
  }
  if (e.dmgReduce) { const pen = armorPen || 0; dmg *= (1 - Math.max(0, e.dmgReduce - pen / 100)); }
  e.hp -= dmg;
  e._flashTimer = 0.08;
  if (G.lifesteal > 0) {
    const lsCap = G.maxHp * 0.08 * (G._dt || 0.016); // 초당 maxHp 8% 캡
    if ((G._lsHealed || 0) < lsCap) {
      const lsMul = G.hp / G.maxHp > .7 ? 0.25 : 0.4;
      let heal = dmg * G.lifesteal / 100 * lsMul;
      heal = Math.min(heal, lsCap - (G._lsHealed || 0));
      G.hp = Math.min(G.maxHp, G.hp + heal);
      G._lsHealed = (G._lsHealed || 0) + heal;
    }
  }
  if (G.slowOnHit) e.slowTimer = 1;

  if (G.executeThresh > 0 && e.hp > 0) {
    const exeThresh = (G.markerExecuteBonus && e.markedTimer > 0) ? G.executeThresh * 2 : G.executeThresh;
    if (e.hp / e.maxHp < exeThresh / 100) {
      e.hp = 0;
      showDmg(e.x, e.z, (e.markedTimer > 0 ? '🎯 ' : '') + 'EXECUTE!', 0xef4444, 16);
    }
  }

  showDmg(e.x, e.z, Math.floor(dmg), isCrit ? 0xfbbf24 : 0xffffff, isCrit ? 16 : 12);

  // Chain lightning
  if (G.chainCount > 0) {
    let last = e, chained = new Set([e]);
    for (let c = 0; c < G.chainCount; c++) {
      let best = null, bd = 3;
      for (const o of G.enemies) { if (o.dead || chained.has(o)) continue; const d = Math.hypot(o.x - last.x, o.z - last.z); if (d < bd) { bd = d; best = o; } }
      if (best) {
        chained.add(best);
        if (best.markedTimer > 0) best.hp -= dmg * .5 * 1.25; else best.hp -= dmg * .5;
        best._flashTimer = 0.08;
        showDmg(best.x, best.z, Math.floor(dmg * .5), 0xffe14d, 11);
        for (let i = 0; i < 2; i++) spawnP(best.x, best.z, 0, 0, 0xffe14d);
        if (best.hp <= 0 && !best.dead) {
          best.dead = true; G.kills++; SFX.play('kill');
          spawnXpOrb(best.x, best.z, Math.floor(best.xp * (G.xpMul || 1)));
          trySpawnDrop(best.x, best.z, best.isBoss);
          const pc = G.particles.length < 60 ? 4 : 2;
          for (let k = 0; k < pc; k++) { const a2 = Math.random() * Math.PI * 2; spawnP(best.x, best.z, Math.cos(a2) * 2, Math.sin(a2) * 2, best.def.bodyColor); }
        }
        last = best;
      }
    }
  }

  if (e.hp <= 0 && !e.dead) {
    e.dead = true; G.kills++; SFX.play('kill');
    spawnXpOrb(e.x, e.z, Math.floor(e.xp * (G.xpMul || 1)));
    trySpawnDrop(e.x, e.z, e.isBoss);
    // 과부하: 표적 적 사망 시 연쇄폭발
    if (G.droneChainExplode && e.markedTimer > 0 && !e.isBoss) {
      const explR = 2.5;
      const explDmg = (G.droneBaseDmg || 15) * (G.droneAtkMul || 1) * 0.6;
      for (const o of G.enemies) { if (o.dead || o === e) continue; if (Math.hypot(o.x - e.x, o.z - e.z) < explR) { o.hp -= explDmg; o._flashTimer = 0.08; showDmg(o.x, o.z, Math.floor(explDmg), 0xff8844, 11); } }
      G.novaRings.push({ x: e.x, z: e.z, r: 0, maxR: explR * TILE, life: 0.25, color: 0xff6622 });
      for (let k = 0; k < 6; k++) { const a2 = Math.random() * Math.PI * 2; spawnP(e.x + Math.cos(a2) * 0.5, e.z + Math.sin(a2) * 0.5, Math.cos(a2) * 3, Math.sin(a2) * 3, 0xff8844); }
    }
    if (e.isBoss) {
      for (let i = 0; i < 5; i++) spawnXpOrb(e.x + (Math.random() - .5) * 2, e.z + (Math.random() - .5) * 2, Math.floor(e.xp * (G.xpMul || 1) * .2));
      for (let i = 0; i < 20; i++) { const a = Math.random() * Math.PI * 2; spawnP(e.x + Math.cos(a), e.z + Math.sin(a), Math.cos(a) * 4, Math.sin(a) * 4, 0xffd700); }
      G.shakeTimer = 0.2;
      // Win check
      if (G.gameMode !== 'endless' && G.gameMode !== 'bossrush' && G.wave >= CLEAR_WAVE) { gameWin(); return; }
    }
    const pCount = G.particles.length < 60 ? 4 : 2;
    for (let i = 0; i < pCount; i++) { const a = Math.random() * Math.PI * 2; spawnP(e.x, e.z, Math.cos(a) * 2, Math.sin(a) * 2, e.def.bodyColor); }
  }
}

// ─ Damage numbers ─
const _dmgPool = []; const _dmgActive = []; const MAX_DMG_NUMS = 25;
function showDmg(wx, wz, txt, color, size = 12, force = false, duration = 700) {
  if (!force && _dmgActive.length >= MAX_DMG_NUMS) return;
  const [sx, sy] = worldToScreen(wx, wz);
  let el = _dmgPool.pop();
  if (!el) { el = document.createElement('div'); el.className = 'dmg-num'; }
  el.textContent = txt;
  el.style.left = sx + 'px';
  el.style.top = (sy - 20) + 'px';
  const [r, g, b] = hexToRgb(color);
  el.style.color = `rgb(${r},${g},${b})`;
  el.style.fontSize = size + 'px';
  el.style.animationDuration = duration + 'ms';
  el.style.animation = 'none'; el.offsetHeight; el.style.animation = '';
  document.body.appendChild(el); _dmgActive.push(el);
  setTimeout(() => { el.remove(); const idx = _dmgActive.indexOf(el); if (idx >= 0) _dmgActive.splice(idx, 1); if (_dmgPool.length < 30) _dmgPool.push(el); }, duration);
}

// ─ 2D Particles (simplified) ─
const MAX_PARTICLES = 80;
function spawnP(x, z, vx, vz, color) {
  if (G.particles.length >= MAX_PARTICLES) return;
  G.particles.push({ x, z, vx, vz, life: 1, decay: 0.03 + Math.random() * 0.02, color, size: 2 + Math.random() * 3 });
}

// ═══════════════════════════════════════
// CARDS UI
// ═══════════════════════════════════════
function showCards() {
  G.paused = true;
  const cards = getRandomCards(3);
  document.getElementById('cardOverlay').classList.add('show');
  const slots = document.getElementById('cardSlots'); slots.innerHTML = '';
  for (const c of cards) {
    const div = document.createElement('div'); div.className = `card card-${c.rarity}`;
    const displayDesc = c.descFn ? c.descFn(G) : c.desc;
    const buildLabel = BUILD_LABELS[c.build] || '';
    const ms = c.maxStack || (c.unique ? 1 : c.rarity === 'legendary' ? 1 : c.rarity === 'epic' ? 2 : c.rarity === 'rare' ? 3 : 5);
    const cur = G.cardCounts[c.id] || 0;
    const stars = ms <= 1 ? '' : '<div class="card-stars">' + '<span class="filled">★</span>'.repeat(cur) + '☆'.repeat(ms - cur) + '</div>';
    div.innerHTML = `<div class="card-rarity rarity-${c.rarity}">${c.rarity.toUpperCase()}</div><div class="card-build build-${c.build}">${buildLabel}</div><div class="card-icon">${c.icon}</div><div class="card-name">${c.name}</div>${stars}<div class="card-desc">${displayDesc}</div>`;
    div.onclick = () => pickCard(c); slots.appendChild(div);
  }
}
function pickCard(c) { SFX.play('card'); c.apply(G); if (c.unique) G.pickedCards.add(c.id); if (c.group) G.pickedGroups.add(c.group); G.pickedCards.add(c.id); G.cardCounts[c.id] = (G.cardCounts[c.id] || 0) + 1; G._dronesDirty = true; checkSynergies(); G.paused = false; document.getElementById('cardOverlay').classList.remove('show'); updateHUD(); }

function gainXP(amt) {
  if (G.testMode) return;
  G.xp += amt;
  while (G.xp >= G.xpNeeded) { G.xp -= G.xpNeeded; G.level++; const xpMult = G.level <= 15 ? 1.3 : G.level <= 25 ? 1.15 : G.level <= 30 ? 1.08 : G.level <= 40 ? 1.35 : 1.05; G.xpNeeded = Math.floor(G.xpNeeded * xpMult); SFX.play('levelup'); showCards(); }
}

function triggerRevival() {
  // Big nova ring
  G.novaRings.push({ x: G.px, z: G.pz, r: 0, maxR: 6 * TILE, life: 0.6, color: 0xfbbf24 });
  G.novaRings.push({ x: G.px, z: G.pz, r: 0, maxR: 3 * TILE, life: 0.4, color: 0xffffff });
  // Lots of golden particles
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 2 + Math.random() * 4;
    spawnP(G.px + Math.cos(a) * 0.5, G.pz + Math.sin(a) * 0.5, Math.cos(a) * spd, Math.sin(a) * spd, [0xfbbf24, 0xffffff, 0xfde68a][i % 3]);
  }
  // Push enemies away
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dx = e.x - G.px, dz = e.z - G.pz, d = Math.hypot(dx, dz);
    if (d < 5 && d > 0.1) { e.x += (dx / d) * 3; e.z += (dz / d) * 3; }
  }
  // Screen shake + text
  G.shakeTimer = 0.3;
  showDmg(G.px, G.pz, 'REVIVE!', 0xfbbf24, 20);
  SFX.play('levelup');
  updateHUD();
}

function updateHUD() {
  document.getElementById('hpBar').style.width = Math.max(0, G.hp / G.maxHp * 100) + '%';
  document.getElementById('xpBar').style.width = (G.xp / G.xpNeeded * 100) + '%';
  document.getElementById('levelText').textContent = `Lv.${G.level}`;
  document.getElementById('killText').textContent = G.kills;
  const modeIcon = G.gameMode === 'hard' ? ' 💀' : G.gameMode === 'endless' ? ' ♾️' : G.gameMode === 'daily' ? ' 📅' : G.gameMode === 'bossrush' ? ' ⚔️' : '';
  if (G.gameMode === 'bossrush') {
    document.getElementById('waveText').textContent = `BOSS ${G.wave}${modeIcon}`;
  } else {
    document.getElementById('waveText').textContent = `WAVE ${G.wave}${modeIcon}`;
  }
  let statParts = [`ATK ${Math.floor(G.atk)}`];
  if (G.orbitals + (G.innerOrbitals||0) + (G.fireOrbitals||0) + (G.iceOrbitals||0) + (G.lightningOrbitals||0) + (G.chaosOrbitals||0) > 0) statParts.push(`ORB ${Math.floor(G.orbBaseDmg)}`);
  if ((G.droneCount||0) + (G.droneEliteCount||0) > 0) statParts.push(`DRN ${Math.floor(G.droneBaseDmg)}`);
  statParts.push(`SPD ${G.moveSpd.toFixed(0)}`);
  const stEl = document.getElementById('statText');
  if (stEl) stEl.textContent = statParts.join(' · ');
  // Combo icons
  const ci = document.getElementById('comboIcons');
  if (ci && G.activeSynergies && G.activeSynergies.size > 0) {
    let comboHtml = '';
    for (const syn of SYNERGIES) {
      if (G.activeSynergies.has(syn.id)) comboHtml += `<span class="combo-tag synergy" title="${syn.desc}">${syn.icon} ${syn.name}</span>`;
    }
    for (const evo of EVOLUTIONS) {
      if (G.activeSynergies.has('evo_' + evo.cardId)) comboHtml += `<span class="combo-tag evolution" title="${evo.desc}">${evo.icon} ${evo.name}</span>`;
    }
    for (const bb of BUILD_BONUSES) {
      for (const tier of bb.tiers) {
        if (G.activeSynergies.has(tier.id)) comboHtml += `<span class="combo-tag allin" title="${tier.desc}">${tier.icon} ${tier.name}</span>`;
      }
    }
    ci.innerHTML = comboHtml;
  } else if (ci) { ci.innerHTML = ''; }
  // Stage progress bar
  const sbFill = document.getElementById('stageBarFill');
  const sbText = document.getElementById('stageBarText');
  if (sbFill) {
    if (G.gameMode === 'endless' || G.gameMode === 'bossrush') {
      sbFill.style.width = '100%';
      if (sbText) sbText.textContent = G.gameMode === 'bossrush' ? `BOSS ${G.wave}` : `WAVE ${G.wave}`;
    } else {
      const pct = Math.min(100, G.wave / CLEAR_WAVE * 100);
      sbFill.style.width = pct + '%';
      if (sbText) sbText.textContent = `${G.wave} / ${CLEAR_WAVE}`;
    }
  }
  const elHud = document.getElementById('extraLifeHud');
  if (G.extraLife > 0) { elHud.textContent = '💎'.repeat(G.extraLife) + ` x${G.extraLife}`; elHud.classList.remove('hidden'); }
  else { elHud.classList.add('hidden'); }
  // Ultimate indicator
  const ultEl = document.getElementById('ultIndicator');
  const hasUlt = G.hasUltProj || G.hasUltOrb || G.hasUltDrone;
  if (hasUlt && ultEl) {
    ultEl.classList.remove('hidden');
    const icon = G.hasUltProj ? '🌠' : G.hasUltOrb ? '💫' : '🎯';
    const active = (G.hasUltProj && G.ultProjActive > 0) || (G.hasUltDrone && G.ultDroneActive > 0);
    let cdText;
    if (active) { cdText = '⚡ ACTIVE'; ultEl.className = 'ult-indicator active'; }
    else if (G.ultReady) { cdText = ultAutoUse ? 'AUTO' : (isMobile ? 'TAP!' : 'SPACE'); ultEl.className = 'ult-indicator ready'; }
    else {
      const timer = G.hasUltProj ? G.ultProjTimer : G.hasUltOrb ? G.ultOrbTimer : G.ultDroneTimer;
      cdText = timer.toFixed(1) + 's'; ultEl.className = 'ult-indicator';
    }
    document.getElementById('ultIcon').textContent = icon;
    document.getElementById('ultCd').textContent = cdText;
  } else if (ultEl) { ultEl.classList.add('hidden'); }
}

// ═══════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════
let lastTime = 0;

function animate(ts) {
  requestAnimationFrame(animate);

  // Clear
  ctx.fillStyle = '#1a1025';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!G.started || G.over) return;
  if (!lastTime) lastTime = ts;
  const dt = Math.min((ts - lastTime) / 1000, .05); lastTime = ts;
  if (G.paused) { drawScene(ts * 0.001); return; }
  const time = ts * .001;

  // ─ Lifesteal cap reset ─
  G._dt = dt; G._lsHealed = 0;

  // ─ Play Timer ─
  G.playTime += dt;
  document.getElementById('timerText').textContent = formatTime(G.playTime);

  // ─ Player movement (keyboard + touch joystick) ─
  let mx = 0, mz = 0;
  if (keys['w'] || keys['arrowup']) mz -= 1;
  if (keys['s'] || keys['arrowdown']) mz += 1;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  // Touch joystick input
  if (joystickActive) { mx += touchMX; mz += touchMZ; }
  const isMoving = !!(mx || mz);
  const playerSnowMul = G.mapTheme && G.mapTheme.effect === 'snow' ? 0.9 : 1;
  const playerZoneSlowMul = G._zoneSlowed ? 0.5 : 1;
  G._zoneSlowed = false; // reset each frame, re-set by boss slow zones
  const ghostSpdMul = G.ghostActive > 0 ? 2 : 1;
  if (mx || mz) { const l = Math.hypot(mx, mz); mx /= l; mz /= l; G.px += mx * G.moveSpd * playerSnowMul * playerZoneSlowMul * ghostSpdMul * dt; G.pz += mz * G.moveSpd * playerSnowMul * playerZoneSlowMul * ghostSpdMul * dt; G.facing = Math.atan2(mx, mz); const pDist = Math.hypot(G.px, G.pz); if (pDist > WORLD_RADIUS - 1) { G.px *= (WORLD_RADIUS - 1) / pDist; G.pz *= (WORLD_RADIUS - 1) / pDist; } }

  // Cat animation update
  updateCatAnim(dt, isMoving);

  // Invincibility
  if (G.invincibleTimer > 0) G.invincibleTimer -= dt;

  // Stat caps
  if (G.dodgeChance > 75) G.dodgeChance = 75;
  if (G.damageReduce > 50) G.damageReduce = 50;
  if (G.moveSpd > 15) G.moveSpd = 15;

  // Regen
  if (G.regen > 0) G.hp = Math.min(G.maxHp, G.hp + G.regen * dt);
  // Cat Nap (낮잠 - 미피격 시 HP %/s 회복)
  if (G.catNap) {
    G.napTimer += dt;
    const napDelay = G.napDelay || 3;
    const napRate = G.napHealRate || 0.02;
    if (G.napTimer >= napDelay && G.hp < G.maxHp) {
      G.hp = Math.min(G.maxHp, G.hp + G.maxHp * napRate * dt);
    }
  }
  // Heal aura (heal1 evolution)
  if (G.healAuraTick) { G._healAuraT = (G._healAuraT || 0) + dt; if (G._healAuraT >= G.healAuraTick) { G._healAuraT = 0; G.hp = Math.min(G.maxHp, G.hp + G.maxHp * 0.15); } }

  // Attack
  G.atkTimer -= dt;
  if (G.atkTimer <= 0) {
    G.atkTimer = 1 / G.atkSpd; fireAtNearest(); triggerCatAttack();
    // Circle shot (원형 탄막)
    if (G.circleShot > 0) {
      const cnt = G.circleShot;
      for (let ci = 0; ci < cnt; ci++) {
        const ang = (Math.PI * 2 / cnt) * ci;
        let dmg = G.atk * 0.4;
        if (G.berserk) dmg *= 1 + (1 - G.hp / G.maxHp);
        const isCrit = Math.random() * 100 < G.critChance;
        if (isCrit) dmg *= G.critDmgMul;
        G.projectiles.push({ x: G.px, z: G.pz, vx: Math.sin(ang) * 10, vz: Math.cos(ang) * 10, damage: dmg, isCrit, pierce: 0, bounce: 0, bounceSplit: 0, life: 1.2, hitEnemies: new Set(), color: 0xff88cc, size: 0.5 + G.projSize * 0.3 });
      }
    }
  }

  // Nova
  if (G.hasNova) {
    G.novaTimer -= dt; if (G.novaTimer <= 0) {
      G.novaTimer = G.novaInterval;
      for (const e of G.enemies) { if (e.dead) continue; if (Math.hypot(e.x - G.px, e.z - G.pz) < 5) damageEnemy(e, G.atk * .8, false); }
      G.novaRings.push({ x: G.px, z: G.pz, r: 0, maxR: 5 * TILE, life: 0.3, color: 0x88ddff });
      for (let i = 0; i < 10; i++) { const a = (Math.PI * 2 / 10) * i; spawnP(G.px + Math.cos(a) * 2, G.pz + Math.sin(a) * 2, Math.cos(a) * 3, Math.sin(a) * 3, 0x88ddff); }
    }
  }

  // Timestop
  if (G.hasTimestop) {
    if (G.timestopActive > 0) { G.timestopActive -= dt; }
    else {
      G.timestopTimer -= dt; if (G.timestopTimer <= 0) {
        G.timestopTimer = G.timestopInterval; G.timestopActive = 3;
        for (let i = 0; i < 12; i++) { const a = Math.random() * Math.PI * 2; spawnP(G.px + Math.cos(a) * 3, G.pz + Math.sin(a) * 3, 0, 0, 0xc084fc); }
      }
    }
  }

  // Ghost Cat (유령 고양이) - 쿨다운 감소
  if (G.ghostCat) {
    if (G.ghostActive > 0) { G.ghostActive -= dt; G.invincibleTimer = Math.max(G.invincibleTimer, G.ghostActive); }
    if (G.ghostCd > 0) G.ghostCd -= dt;
  }

  // Ultimate: Star Storm (투사체)
  if (G.hasUltProj) {
    if (G.ultProjActive > 0) {
      G.ultProjActive -= dt;
      G._ultProjSpawn = (G._ultProjSpawn || 0) - dt;
      if (G._ultProjSpawn <= 0) {
        G._ultProjSpawn = 0.1;
        for (let ui = 0; ui < 3; ui++) {
          const a = Math.random() * Math.PI * 2;
          let dmg = G.atk * 1.2;
          if (G.berserk) dmg *= 1 + (1 - G.hp / G.maxHp);
          const isCrit = Math.random() * 100 < G.critChance;
          if (isCrit) dmg *= G.critDmgMul;
          G.projectiles.push({ x: G.px, z: G.pz, vx: Math.sin(a) * 12, vz: Math.cos(a) * 12, damage: dmg, isCrit, pierce: 1, bounce: 0, bounceSplit: 0, life: 2, hitEnemies: new Set(), color: 0xfbbf24, size: 1.0 + G.projSize * 0.3 });
        }
      }
    } else if (!G.ultReady) {
      G.ultProjTimer -= dt;
      if (G.ultProjTimer <= 0) {
        if (ultAutoUse) { activateUlt('proj'); } else { G.ultReady = true; G.ultProjTimer = 0; }
      }
    }
  }

  // Ultimate: Supernova (위성)
  if (G.hasUltOrb) {
    if (!G.ultReady) {
      G.ultOrbTimer -= dt;
      if (G.ultOrbTimer <= 0) {
        if (ultAutoUse) { activateUlt('orb'); } else { G.ultReady = true; G.ultOrbTimer = 0; }
      }
    }
  }

  // Ultimate: Omega Strike (드론)
  if (G.hasUltDrone) {
    if (G.ultDroneActive > 0) {
      G.ultDroneActive -= dt;
    } else if (!G.ultReady) {
      G.ultDroneTimer -= dt;
      if (G.ultDroneTimer <= 0) {
        if (ultAutoUse) { activateUlt('drone'); } else { G.ultReady = true; G.ultDroneTimer = 0; }
      }
    }
  }

  // ─ Wave / Spawn ─
  if (G.gameMode === 'bossrush') {
    // Boss Rush: boss-only mode
    if (!G.currentBoss || G.currentBoss.dead) {
      if (!G._bossRushWait) { G._bossRushWait = true; G._bossRushTimer = G.wave === 1 ? 0 : 10; }
      G._bossRushTimer -= dt;
      if (G._bossRushTimer <= 0) {
        G._bossRushWait = false;
        const bossIdx = (G.wave - 1) % BOSS_DEFS.length;
        const cycle = Math.floor((G.wave - 1) / BOSS_DEFS.length);
        const base = BOSS_DEFS[bossIdx];
        const bossDef = { ...base, wave: G.wave, hp: base.hp * 3 * Math.pow(2.5, cycle), dmgPct: base.dmgPct + cycle * 5, xp: base.xp * Math.pow(2, cycle) };
        spawnBoss(bossDef);
        // Guarantee level-up XP between bosses
        if (G.wave > 1) gainXP(G.xpNeeded * 0.8);
        G.wave++;
      }
    }
  } else {
    const waveInterval = Math.max(12, 20 - G.wave * .5);
    G.waveTimer += dt; if (G.waveTimer >= waveInterval) { G.waveTimer = 0; G.wave++; const bossDef = getBossForWave(G.wave); if (bossDef) spawnBoss(bossDef); }
    const sr = Math.max(.25, 1.5 - G.wave * .08); G.spawnTimer -= dt;
    if (G.spawnTimer <= 0) { G.spawnTimer = sr; const cnt = Math.min(1 + Math.floor(G.wave / 2), 8); for (let i = 0; i < cnt; i++) spawnEnemy(); }
  }

  // ─ Map Theme ─
  if (G.wave > 1) {
    const themeIdx = Math.floor((G.wave - 1) / 10) % MAP_THEMES.length;
    if (G.mapTheme !== MAP_THEMES[themeIdx]) {
      G.mapTheme = MAP_THEMES[themeIdx];
      showMapAnnounce(G.mapTheme);
    }
  }
  // Lava effect: edge damage
  if (G.mapTheme && G.mapTheme.effect === 'lava') {
    if (Math.hypot(G.px, G.pz) > WORLD_RADIUS - 2) {
      G._lavaTick = (G._lavaTick || 0) + dt;
      if (G._lavaTick >= 1) { G._lavaTick = 0; const lavaDmg = Math.max(8, Math.floor(G.maxHp * 0.05)); G.hp -= lavaDmg; showDmg(G.px, G.pz, `🔥${lavaDmg}`, 0xff4400, 12); }
    } else { G._lavaTick = 0; }
  }

  // ─ Spawn Warnings → Enemies ─
  for (let i = G.spawnWarns.length - 1; i >= 0; i--) {
    const sw = G.spawnWarns[i];
    sw.timer -= dt;
    if (sw.timer <= 0) {
      G.enemies.push(sw.enemyData);
      G.spawnWarns.splice(i, 1);
    }
  }

  // ─ Enemies ─
  const isFrozen = G.timestopActive > 0;
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const e = G.enemies[i];
    if (e.dead) { G.enemies.splice(i, 1); continue; }
    if (e._orbHit > 0) e._orbHit -= dt;
    if (e._flashTimer > 0) e._flashTimer -= dt;
    if (e.markedTimer > 0) e.markedTimer -= dt;
    if (!isFrozen) {
      if (e.slowTimer > 0) e.slowTimer -= dt;
      const spd = (e.slowTimer > 0 ? e.speed * .4 : e.speed) * (G.mapTheme && G.mapTheme.effect === 'snow' ? 0.8 : 1);
      const dx = G.px - e.x, dz = G.pz - e.z, dist = Math.hypot(dx, dz);
      if (dist > .5) { e.x += (dx / dist) * spd * dt; e.z += (dz / dist) * spd * dt; }
      // Boss
      if (e.isBoss) {
        e.specialTimer -= dt;
        // Red warning sign 1s before attack
        if (e.specialTimer <= 1.0 && e.specialTimer > 0) { e._warnActive = true; }
        if (e.specialTimer <= 0) { e.specialTimer = e.specialCD; e._warnActive = false; executeBossSpecial(e); }
        if (e.chargeTimer > 0) {
          e.chargeTimer -= dt; e.x += e.chargeVX * dt; e.z += e.chargeVZ * dt;
          if (Math.hypot(e.x - G.px, e.z - G.pz) < 1.5 && G.invincibleTimer <= 0) {
            if (!(G.dodgeChance > 0 && Math.random() * 100 < G.dodgeChance)) {
              let dmg = e.damage * 1.5 * (1 - (G.damageReduce || 0) / 100); dmg = Math.min(dmg, G.maxHp * (G.difficulty === 'hard' ? .9 : .85)); G.hp -= dmg; G.invincibleTimer = .5;
              showDmg(G.px, G.pz, Math.floor(dmg), 0xff4444, 16);
              G.shakeTimer = 0.1; G.napTimer = 0; SFX.play('hurt'); triggerCatHit();
              if (G.hp <= 0) { if (G.extraLife > 0) { G.extraLife--; G.hp = G.maxHp; G.invincibleTimer = 2; triggerRevival(); } else { gameOver(); return; } }
            }
          }
          for (let j = 0; j < 1; j++) spawnP(e.x + (Math.random() - .5), e.z + (Math.random() - .5), 0, 0, 0xff4400);
        }
      }
      // Damage player
      if (dist < .8) {
        e.hitTimer -= dt; if (e.hitTimer <= 0) {
          e.hitTimer = 1; if (G.invincibleTimer <= 0) {
            if (G.dodgeChance > 0 && Math.random() * 100 < G.dodgeChance) { showDmg(G.px, G.pz, 'DODGE!', 0x67e8f9, 14); }
            else {
              let dmg = e.damage * (1 - (G.damageReduce || 0) / 100);
              const _mobCap = G.wave >= 50 ? 0.5 : G.wave >= 40 ? 0.4 : 0.3;
              dmg = Math.min(dmg, G.maxHp * _mobCap);
              G.hp -= dmg; G.invincibleTimer = .3; SFX.play('hurt'); triggerCatHit();
              G.shakeTimer = 0.08; G.napTimer = 0;
              if (G.ghostCat && G.ghostCd <= 0) { G.ghostActive = 1.5; G.ghostCd = 8; G.invincibleTimer = 1.5; showDmg(G.px, G.pz, '👻 유령화!', 0xaabbff, 16); }
              if (G.thorns > 0) { for (const o of G.enemies) { if (o.dead) continue; if (Math.hypot(o.x - G.px, o.z - G.pz) < 3) damageEnemy(o, G.atk * G.thorns, false); } }
              if (G.hp <= 0) {
                if (G.extraLife > 0) {
                  G.extraLife--; G.hp = G.maxHp; G.invincibleTimer = 2; triggerRevival();
                } else { gameOver(); return; }
              }
            }
          }
        }
      }
    }
  }

  // ─ Projectiles ─
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.life -= dt;
    if (p.life <= 0) { G.projectiles.splice(i, 1); continue; }
    for (const e of G.enemies) {
      if (e.dead || p.hitEnemies.has(e)) continue;
      if (Math.hypot(e.x - p.x, e.z - p.z) < .4 + G.projSize * .25) {
        p.hitEnemies.add(e);
        let pDmg = p.damage;
        if (G.projOrbBoost) pDmg += G.orbBaseDmg * 0.5 * (G.orbDmgMul || 1);
        damageEnemy(e, pDmg, p.isCrit);
        if (p.pierce > 0) { p.pierce--; }
        else if (p.bounce > 0) {
          // Bounce split: spawn bounceSplit projectiles toward nearby enemies
          const splitCount = p.bounceSplit || 1;
          const nearby = [];
          for (const o of G.enemies) { if (o.dead || p.hitEnemies.has(o)) continue; const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < 8) nearby.push({ e: o, d }); }
          nearby.sort((a, b) => a.d - b.d);
          for (let si = 0; si < splitCount; si++) {
            const a = si < nearby.length ? Math.atan2(nearby[si].e.x - p.x, nearby[si].e.z - p.z) : Math.random() * Math.PI * 2;
            G.projectiles.push({ x: p.x, z: p.z, vx: Math.sin(a) * 14, vz: Math.cos(a) * 14, damage: p.damage * 0.7, isCrit: p.isCrit, pierce: 0, bounce: 0, bounceSplit: 0, life: 1.2, hitEnemies: new Set([...p.hitEnemies]), color: p.color, size: p.size * 0.85 });
          }
          spawnP(p.x, p.z, 0, 0, 0x88ddff);
          G.projectiles.splice(i, 1);
          break;
        }
        else if (G.splitOnHit && !p.isSplit) {
          const angle = Math.atan2(p.vx, p.vz);
          for (let si = -1; si <= 1; si += 2) {
            const sa = angle + si * Math.PI / 4;
            G.projectiles.push({ x: p.x, z: p.z, vx: Math.sin(sa) * 12, vz: Math.cos(sa) * 12, damage: p.damage * 0.4, isCrit: false, pierce: 0, bounce: 0, bounceSplit: 0, life: 0.6, hitEnemies: new Set([...p.hitEnemies]), color: 0xff8844, size: (p.size || 1) * 0.7, isSplit: true });
          }
          spawnP(p.x, p.z, 0, 0, 0xff8844); G.projectiles.splice(i, 1); break;
        }
        else { spawnP(p.x, p.z, 0, 0, 0xffdd44); G.projectiles.splice(i, 1); break; }
      }
    }
  }

  // ─ Boss Projectiles ─
  for (let i = G.bossProjectiles.length - 1; i >= 0; i--) {
    const bp = G.bossProjectiles[i];
    bp.x += bp.vx * dt; bp.z += bp.vz * dt; bp.life -= dt;
    if (bp.life <= 0) { G.bossProjectiles.splice(i, 1); continue; }
    if (Math.hypot(bp.x - G.px, bp.z - G.pz) < .7) {
      if (G.invincibleTimer <= 0) {
        if (G.dodgeChance > 0 && Math.random() * 100 < G.dodgeChance) { showDmg(G.px, G.pz, 'DODGE!', 0x67e8f9, 14); }
        else {
          let dmg = bp.damage * (1 - (G.damageReduce || 0) / 100); dmg = Math.min(dmg, G.maxHp * (G.difficulty === 'hard' ? .9 : .85)); G.hp -= dmg; G.invincibleTimer = .3;
          showDmg(G.px, G.pz, Math.floor(dmg), 0xff4444, 14); G.shakeTimer = 0.08; G.napTimer = 0; SFX.play('hurt'); triggerCatHit();
          if (G.thorns > 0) { for (const o of G.enemies) { if (o.dead) continue; if (Math.hypot(o.x - G.px, o.z - G.pz) < 3) damageEnemy(o, G.atk * G.thorns, false); } }
          if (G.hp <= 0) { if (G.extraLife > 0) { G.extraLife--; G.hp = G.maxHp; G.invincibleTimer = 2; triggerRevival(); } else { gameOver(); return; } }
        }
      }
      G.bossProjectiles.splice(i, 1);
    }
  }

  // ─ Boss Zones (장판) ─
  for (let i = G.bossZones.length - 1; i >= 0; i--) {
    const bz = G.bossZones[i];
    bz.life -= dt;
    // Explode type: trigger explosion right before removal
    if (bz.type === 'explode' && !bz._exploded && bz.life <= (bz.warn || 0)) {
      bz._exploded = true;
      const d = Math.hypot(bz.x - G.px, bz.z - G.pz);
      if (d < bz.radius * 1.2 && G.invincibleTimer <= 0) {
        if (!(G.dodgeChance > 0 && Math.random() * 100 < G.dodgeChance)) {
          let dmg = bz.damage * (1 - (G.damageReduce || 0) / 100);
          dmg = Math.min(dmg, G.maxHp * (G.difficulty === 'hard' ? .9 : .85));
          G.hp -= dmg; G.invincibleTimer = .3; G.napTimer = 0;
          showDmg(G.px, G.pz, Math.floor(dmg), 0xff4444, 16); G.shakeTimer = 0.1; SFX.play('hurt'); triggerCatHit();
          if (G.hp <= 0) { if (G.extraLife > 0) { G.extraLife--; G.hp = G.maxHp; G.invincibleTimer = 2; triggerRevival(); } else { gameOver(); return; } }
        } else { showDmg(G.px, G.pz, 'DODGE!', 0x67e8f9, 14); }
      }
      G.novaRings.push({ x: bz.x, z: bz.z, r: 0, maxR: bz.radius * TILE, life: 0.3, color: bz.color });
    }
    if (bz.life <= 0) { G.bossZones.splice(i, 1); continue; }
    const isWarning = bz.warn && bz.life > bz.warn;
    // Pull effect (공허) — clamp player position (only after warn)
    if (bz.type === 'pull' && !isWarning) {
      const dx = bz.x - G.px, dz = bz.z - G.pz, d = Math.hypot(dx, dz);
      if (d < bz.radius * 1.5 && d > 0.2) {
        const str = bz.pullStr * dt;
        G.px += (dx / d) * str; G.pz += (dz / d) * str;
        const pullDist = Math.hypot(G.px, G.pz); if (pullDist > WORLD_RADIUS - 1) { G.px *= (WORLD_RADIUS - 1) / pullDist; G.pz *= (WORLD_RADIUS - 1) / pullDist; }
      }
    }
    // Slow effect (결빙) — slow player in zone (only after warn)
    if (bz.type === 'slow' && !isWarning) {
      const d = Math.hypot(bz.x - G.px, bz.z - G.pz);
      if (d < bz.radius) { G._zoneSlowed = true; }
    }
    // Damage tick (every 0.5s based on life)
    if (!isWarning && bz.type !== 'explode') {
      const d = Math.hypot(bz.x - G.px, bz.z - G.pz);
      if (d < bz.radius && G.invincibleTimer <= 0) {
        if (!bz._tickTimer || bz._tickTimer <= 0) {
          bz._tickTimer = 0.5;
          let dmg = bz.damage * (1 - (G.damageReduce || 0) / 100);
          dmg = Math.min(dmg, G.maxHp * (G.difficulty === 'hard' ? .9 : .85));
          G.hp -= dmg; G.invincibleTimer = .15; G.napTimer = 0;
          showDmg(G.px, G.pz, Math.floor(dmg), 0xff4444, 12); G.shakeTimer = 0.05; SFX.play('hurt'); triggerCatHit();
          if (G.hp <= 0) { if (G.extraLife > 0) { G.extraLife--; G.hp = G.maxHp; G.invincibleTimer = 2; triggerRevival(); } else { gameOver(); return; } }
        }
      }
    }
    if (bz._tickTimer > 0) bz._tickTimer -= dt;
  }

  // ─ XP Orbs ─
  if (G._magnetPulse > 0) G._magnetPulse -= dt;
  for (let i = G.xpOrbs.length - 1; i >= 0; i--) {
    const o = G.xpOrbs[i];
    o.life -= dt;
    const d = Math.hypot(G.px - o.x, G.pz - o.z);
    // Auto-pull if orb is outside world bounds
    const outOfBounds = Math.hypot(o.x, o.z) > WORLD_RADIUS;
    // Pull within magnet range, during magnet pulse, or if out of bounds
    if (d < G.magnetRange || G._magnetPulse > 0 || outOfBounds) { const s = G._magnetPulse > 0 ? 18 : outOfBounds ? 12 : 8; o.x += (G.px - o.x) / Math.max(d, 0.1) * s * dt; o.z += (G.pz - o.z) / Math.max(d, 0.1) * s * dt; }
    if (d < .6) { gainXP(o.amount); G.xpOrbs.splice(i, 1); continue; }
    if (o.life <= 0) { G.xpOrbs.splice(i, 1); continue; }
  }

  // ─ Drops ─
  for (let i = G.drops.length - 1; i >= 0; i--) {
    const dr = G.drops[i];
    dr.life -= dt;
    const d = Math.hypot(G.px - dr.x, G.pz - dr.z);
    if (d < 1.2) { dr.def.apply(); G.drops.splice(i, 1); continue; }
    if (dr.life <= 0) { G.drops.splice(i, 1); continue; }
  }

  // ─ Particles ─
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.vx *= 0.95; p.vz *= 0.95;
    p.life -= p.decay;
    if (p.life <= 0) { G.particles.splice(i, 1); }
  }

  // Nova rings
  for (let i = G.novaRings.length - 1; i >= 0; i--) {
    const nr = G.novaRings[i];
    nr.life -= dt;
    nr.r += (nr.maxR / 0.3) * dt;
    if (nr.life <= 0) { G.novaRings.splice(i, 1); }
  }

  // Screen shake
  if (G.shakeTimer > 0) {
    G.shakeTimer -= dt;
    G.shakeX = (Math.random() - 0.5) * 8;
    G.shakeY = (Math.random() - 0.5) * 8;
  } else {
    G.shakeX = 0; G.shakeY = 0;
  }

  // ─ Camera follow with look-ahead ─
  const leadDist = isMobile ? 3.5 : 1.5; // tiles ahead
  const leadSmooth = 4; // smoothing speed
  const targetLeadX = mx * leadDist;
  const targetLeadY = mz * leadDist;
  camLeadX += (targetLeadX - camLeadX) * leadSmooth * dt;
  camLeadY += (targetLeadY - camLeadY) * leadSmooth * dt;
  camX += (G.px + camLeadX - camX) * 3 * dt;
  camY += (G.pz + camLeadY - camY) * 3 * dt;

  // ─ RENDER ─
  drawScene(time, isMoving);
  updateDrones(dt);
  // Update drone beams
  for (let i = G.droneBeams.length - 1; i >= 0; i--) { G.droneBeams[i].life -= dt; if (G.droneBeams[i].life <= 0) G.droneBeams.splice(i, 1); }
  updateHUD(); updateSkillHUD(); updateBossHUD();

  // ═ Orbital shared multipliers ═
  const _oSz = G.orbSizeMul || 1;
  const _oSp = G.orbSpeedMul || 1;
  const _oHit = 0.65 * _oSz; // hitbox radius
  const totalOrbs = G.orbitals + (G.innerOrbitals||0) + (G.fireOrbitals||0) + (G.iceOrbitals||0) + (G.lightningOrbitals||0) + (G.chaosOrbitals||0);
  const orbHitCD = Math.max(0.08, 0.3 / (1 + totalOrbs * 0.06) / (G.orbSpeedMul || 1));
  // Pre-filter: only check enemies within orbital reach (~4 units from player)
  const _oMaxDist = 3.5 + _oHit;
  const _nearbyEn = G.enemies.filter(e => !e.dead && Math.hypot(e.x - G.px, e.z - G.pz) < _oMaxDist);

  // Inner orbitals (저궤도, 반경 1.4, 빠른 회전)
  for (let i = 0; i < (G.innerOrbitals||0); i++) {
    const a = time * 5.0 * _oSp + (Math.PI * 2 / G.innerOrbitals) * i;
    const ox = G.px + Math.cos(a) * 1.4, oz = G.pz + Math.sin(a) * 1.4;
    for (const e of _nearbyEn) {
      if (e.dead) continue;
      if (Math.hypot(e.x - ox, e.z - oz) < _oHit) {
        if (e._orbHit <= 0) { damageEnemy(e, G.orbBaseDmg * 0.8 * (G.orbDmgMul||1) * _oSz, false); e._orbHit = orbHitCD; }
      }
    }
  }
  // Outer orbitals (고궤도, 반경 2.5)
  for (let i = 0; i < G.orbitals; i++) {
    const a = time * 3.5 * _oSp + (Math.PI * 2 / G.orbitals) * i;
    const ox = G.px + Math.cos(a) * 2.5, oz = G.pz + Math.sin(a) * 2.5;
    for (const e of _nearbyEn) {
      if (e.dead) continue;
      if (Math.hypot(e.x - ox, e.z - oz) < _oHit) {
        if (e._orbHit <= 0) { damageEnemy(e, G.orbBaseDmg * 0.7 * (G.orbDmgMul||1) * _oSz, false); e._orbHit = orbHitCD; }
      }
    }
  }
  // Fire orbitals (high dmg + burn DoT)
  for (let i = 0; i < (G.fireOrbitals || 0); i++) {
    const a = time * 3.3 * _oSp + (Math.PI * 2 / G.fireOrbitals) * i + Math.PI * 0.5;
    const ox = G.px + Math.cos(a) * 2.2, oz = G.pz + Math.sin(a) * 2.2;
    for (const e of _nearbyEn) {
      if (e.dead) continue;
      if (Math.hypot(e.x - ox, e.z - oz) < _oHit) {
        if (e._orbHit <= 0) { damageEnemy(e, G.orbBaseDmg * 0.9 * (G.orbDmgMul||1) * _oSz, false); e._orbHit = orbHitCD; e.burnTimer = 2.5; }
      }
    }
  }
  // Ice orbitals (slow enemies)
  for (let i = 0; i < (G.iceOrbitals || 0); i++) {
    const a = time * 2.8 * _oSp + (Math.PI * 2 / G.iceOrbitals) * i + Math.PI;
    const ox = G.px + Math.cos(a) * 2.8, oz = G.pz + Math.sin(a) * 2.8;
    for (const e of _nearbyEn) {
      if (e.dead) continue;
      if (Math.hypot(e.x - ox, e.z - oz) < _oHit) {
        if (e._orbHit <= 0) { damageEnemy(e, G.orbBaseDmg * 0.5 * (G.orbDmgMul||1) * _oSz, false); e._orbHit = orbHitCD; e.slowTimer = Math.max(e.slowTimer, 2.0); }
      }
    }
  }
  // Lightning orbitals (chain shock)
  for (let i = 0; i < (G.lightningOrbitals || 0); i++) {
    const a = time * 4.0 * _oSp + (Math.PI * 2 / G.lightningOrbitals) * i + Math.PI * 1.5;
    const ox = G.px + Math.cos(a) * 2.0, oz = G.pz + Math.sin(a) * 2.0;
    for (const e of _nearbyEn) {
      if (e.dead) continue;
      if (Math.hypot(e.x - ox, e.z - oz) < _oHit) {
        if (e._orbHit <= 0) {
          damageEnemy(e, G.orbBaseDmg * 0.6 * (G.orbDmgMul||1) * (G.lightOrbDmgMul || 1) * _oSz, false); e._orbHit = orbHitCD;
          let best = null, bd = 3.5;
          for (const o of G.enemies) { if (o.dead || o === e) continue; const d = Math.hypot(o.x - e.x, o.z - e.z); if (d < bd) { bd = d; best = o; } }
          if (best) { damageEnemy(best, G.orbBaseDmg * .3 * (G.orbDmgMul||1) * (G.lightOrbDmgMul || 1) * _oSz, false); spawnP(best.x, best.z, 0, 0, 0x88ddff); }
        }
      }
    }
  }
  // Star Veil (별의 장막 - 주변 적 둔화 오라)
  if (G.starVeil > 0) {
    const veilR = 2.5 + G.starVeil * 0.5;
    for (const e of _nearbyEn) {
      if (e.dead) continue;
      if (Math.hypot(e.x - G.px, e.z - G.pz) < veilR) {
        e.slowTimer = Math.max(e.slowTimer || 0, 0.5);
        e.slowAmt = Math.max(e.slowAmt || 0, 0.35);
      }
    }
  }
  // Chaos orbitals (원소 마스터 합체)
  for (let i = 0; i < (G.chaosOrbitals || 0); i++) {
    const a = time * 3.8 * _oSp + (Math.PI * 2 / G.chaosOrbitals) * i;
    const ox = G.px + Math.cos(a) * 2.3, oz = G.pz + Math.sin(a) * 2.3;
    for (const e of _nearbyEn) {
      if (e.dead) continue;
      if (Math.hypot(e.x - ox, e.z - oz) < _oHit * 1.2) {
        if (e._orbHit <= 0) {
          const chaosDmg = G.orbBaseDmg * 1.2 * (G.orbDmgMul||1) * _oSz;
          damageEnemy(e, chaosDmg, false);
          e._orbHit = orbHitCD;
          e.burnTimer = 2.5;
          e.slowTimer = Math.max(e.slowTimer || 0, 1.5);
          // Chain to 1 nearby
          let best = null, bd = 3;
          for (const o of G.enemies) { if (o.dead || o === e) continue; const d2 = Math.hypot(o.x - e.x, o.z - e.z); if (d2 < bd) { bd = d2; best = o; } }
          if (best) { damageEnemy(best, chaosDmg * .4, false); best.burnTimer = 1.5; spawnP(best.x, best.z, 0, 0, 0xff88ff); }
        }
      }
    }
  }

  // Orbital Pulse (별의 맥동)
  if (G.orbPulse) {
    G._orbPulseTimer = (G._orbPulseTimer || 0) - dt;
    if (G._orbPulseTimer <= 0) {
      G._orbPulseTimer = 4;
      const pulseDmg = G.orbBaseDmg * totalOrbs * 0.4 * (G.orbDmgMul || 1);
      const pulseR = 3.5 + totalOrbs * 0.15;
      for (const e of G.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - G.px, e.z - G.pz);
        if (d < pulseR) {
          damageEnemy(e, pulseDmg, false);
          // Slow
          e.slowTimer = Math.max(e.slowTimer || 0, 2.5);
          e.slowAmt = Math.max(e.slowAmt || 0, 0.5);
        }
      }
      const effectR = G.orbPulseDroneSync ? pulseR * 1.5 : pulseR;
      G.novaRings.push({ x: G.px, z: G.pz, r: 0, maxR: effectR * TILE, life: 0.4, color: G.orbPulseDroneSync ? 0xff8844 : 0xaa88ff });
      for (let i = 0; i < 12; i++) { const a = Math.random() * Math.PI * 2; spawnP(G.px + Math.cos(a) * 1.5, G.pz + Math.sin(a) * 1.5, Math.cos(a) * 3, Math.sin(a) * 3, G.orbPulseDroneSync ? 0xff6622 : 0xcc99ff); }
      // 궤도 폭격: 맥동 시 드론 일제 발사
      if (G.orbPulseDroneSync && G.drones) {
        for (const dr of G.drones) {
          let nearest = null, nd = 12;
          for (const e2 of G.enemies) { if (e2.dead) continue; const d2 = Math.hypot(e2.x - dr.x, e2.z - dr.z); if (d2 < nd) { nd = d2; nearest = e2; } }
          if (nearest) { const dDmg = (G.droneBaseDmg || 15) * (G.droneAtkMul || 1); fireDroneMissile(dr, nearest, dDmg); }
        }
      }
    }
  }

  // Star Rain (별의 비 - 광역 공격)
  if (G.orbShoot && totalOrbs > 0) {
    G.orbShootTimer -= dt;
    if (G.orbShootTimer <= 0) {
      G.orbShootTimer = G.orbShootInterval;
      const starCount = totalOrbs;
      const starDmg = G.orbBaseDmg * 1.2 * (G.orbDmgMul || 1) * _oSz;
      const radius = 8;
      for (let i = 0; i < starCount; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * radius;
        const tx = G.px + Math.cos(a) * d, tz = G.pz + Math.sin(a) * d;
        G.orbStarRains.push({ x: tx, z: tz, dmg: starDmg, life: 0.5, maxLife: 0.5, radius: 2.0, hit: false });
      }
      SFX.play('levelup');
    }
    // Update star rain zones
    for (let i = G.orbStarRains.length - 1; i >= 0; i--) {
      const s = G.orbStarRains[i];
      s.life -= dt;
      if (s.life <= 0) { G.orbStarRains.splice(i, 1); continue; }
      // 착탄 시 광역 데미지 (life가 절반 이하일 때 1회)
      if (!s.hit && s.life <= s.maxLife * 0.5) {
        s.hit = true;
        for (const e of G.enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.x - s.x, e.z - s.z) < s.radius) {
            damageEnemy(e, s.dmg, false);
          }
        }
        for (let k = 0; k < 4; k++) { const pa = Math.random() * Math.PI * 2; spawnP(s.x + Math.cos(pa) * 0.3, s.z + Math.sin(pa) * 0.3, Math.cos(pa) * 2, Math.sin(pa) * 2, 0xffdd44); }
      }
    }
  }

  // Burn DoT tick
  for (const e of G.enemies) {
    if (e.dead || !e.burnTimer || e.burnTimer <= 0) continue;
    e.burnTimer -= dt;
    e._burnTick = (e._burnTick || 0) - dt;
    if (e._burnTick <= 0) { e._burnTick = 0.4; damageEnemy(e, G.orbBaseDmg * 0.5 * (G.orbDmgMul||1) * (G.burnDmgMul || 1), false); spawnP(e.x, e.z, (Math.random()-.5)*2, (Math.random()-.5)*2, 0xff6633); }
  }
  // Laser
  if (G.hasLaser) {
    G.laserTimer -= dt;
    if (G.laserTimer <= 0) {
      G.laserTimer = G.laserInterval;
      let nearest = null, nd = G.range + 5;
      for (const e of G.enemies) { if (e.dead) continue; const d = Math.hypot(e.x - G.px, e.z - G.pz); if (d < nd) { nd = d; nearest = e; } }
      if (nearest) {
        const ang = Math.atan2(nearest.x - G.px, nearest.z - G.pz);
        const laserLen = 16;
        G.laserBeams.push({ x: G.px, z: G.pz, ang, len: laserLen, life: 0.35, maxLife: 0.35 });
        for (const e of G.enemies) {
          if (e.dead) continue;
          const ex = e.x - G.px, ez = e.z - G.pz;
          const proj = ex * Math.sin(ang) + ez * Math.cos(ang);
          if (proj < 0 || proj > laserLen) continue;
          const perpDist = Math.abs(ex * Math.cos(ang) - ez * Math.sin(ang));
          if (perpDist < 0.7) damageEnemy(e, G.atk * 1.5, Math.random() * 100 < G.critChance);
        }
        for (let j = 0; j < 6; j++) { const d = Math.random() * laserLen; spawnP(G.px + Math.sin(ang)*d+(Math.random()-.5)*.3, G.pz + Math.cos(ang)*d+(Math.random()-.5)*.3, (Math.random()-.5)*2, (Math.random()-.5)*2, 0xff4444); }
      }
    }
  }
  // Update laser beams
  for (let i = G.laserBeams.length - 1; i >= 0; i--) { G.laserBeams[i].life -= dt; if (G.laserBeams[i].life <= 0) G.laserBeams.splice(i, 1); }
}

function drawScene(time, isMoving) {
  ctx.save();
  ctx.translate(G.shakeX, G.shakeY);

  // Ground
  drawGround();

  // Boss Zones (장판)
  for (const bz of G.bossZones) {
    if (bossRedOn) bz.color = 0xff2200;
    const [zx, zy] = worldToScreen(bz.x, bz.z);
    const r = bz.radius * TILE;
    if (zx < -r || zx > canvas.width + r || zy < -r || zy > canvas.height + r) continue;
    const lifeAlpha = Math.min(1, bz.life / 0.5);
    const isWarning = bz.warn && bz.life > bz.warn;
    if (isWarning) {
      // Warning: pulsing ring
      const pulse = 0.3 + Math.sin(bz.life * 12) * 0.3;
      ctx.save(); ctx.globalAlpha = pulse;
      drawRing(zx, zy, r, hexStr(bz.color), 2);
      drawRing(zx, zy, r * 0.5, hexStr(bz.color), 1);
      ctx.restore();
    } else {
      // Active zone
      const grad = ctx.createRadialGradient(zx, zy, 0, zx, zy, r);
      const c = bz.color;
      const cr = (c >> 16) & 0xff, cg = (c >> 8) & 0xff, cb = c & 0xff;
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},${0.35 * lifeAlpha})`);
      grad.addColorStop(0.7, `rgba(${cr},${cg},${cb},${0.15 * lifeAlpha})`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(zx, zy, r, 0, Math.PI * 2); ctx.fill();
      // Edge ring
      ctx.save(); ctx.globalAlpha = 0.5 * lifeAlpha;
      drawRing(zx, zy, r, hexStr(bz.color), 1.5);
      ctx.restore();
    }
  }

  // XP Orbs (color/size by amount)
  for (const o of G.xpOrbs) {
    const [sx, sy] = worldToScreen(o.x, o.z);
    if (sx < -20 || sx > canvas.width + 20 || sy < -20 || sy > canvas.height + 20) continue;
    // Tier: small(≤10) / medium(≤30) / large(≤80) / epic(>80)
    const amt = o.amount;
    const tier = amt <= 10 ? 0 : amt <= 30 ? 1 : amt <= 80 ? 2 : 3;
    const colors = ['170,136,255', '100,200,255', '52,211,153', '251,191,36'];
    const fills = ['#aa88ff', '#64c8ff', '#34d399', '#fbbf24'];
    const sizes = [3, 5, 6, 8];
    const glowR = [8, 10, 13, 16];
    const col = colors[tier], fill = fills[tier], sz = sizes[tier], gr = glowR[tier];
    const bobY = Math.sin(time * 4 + o.x) * 3;
    const glow = ctx.createRadialGradient(sx, sy + bobY, 0, sx, sy + bobY, gr);
    glow.addColorStop(0, `rgba(${col},0.6)`);
    glow.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy + bobY, gr, 0, Math.PI * 2);
    ctx.fill();
    // Diamond shape
    ctx.save();
    ctx.translate(sx, sy + bobY);
    ctx.rotate(time * 3);
    ctx.beginPath();
    ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.8, 0); ctx.lineTo(0, sz); ctx.lineTo(-sz * 0.8, 0);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  // Drop Items
  for (const dr of G.drops) {
    const [sx, sy] = worldToScreen(dr.x, dr.z);
    if (sx < -20 || sx > canvas.width + 20 || sy < -20 || sy > canvas.height + 20) continue;
    const bobY = Math.sin(time * 5 + dr.x) * 4;
    const blink = dr.life < 3 ? (Math.floor(time * 8) % 2 === 0 ? 1 : 0.3) : 1;
    const pulseR = 22 + Math.sin(time * 4 + dr.x * 2) * 8;
    const pulseA = 0.35 + Math.sin(time * 3 + dr.x) * 0.2;
    const glowColor = dr.def.id === 'churu' ? '76,217,100' : '96,165,250';
    ctx.save();
    ctx.globalAlpha = blink;
    // Outer glow pulse
    const glow = ctx.createRadialGradient(sx, sy + bobY, 0, sx, sy + bobY, pulseR);
    glow.addColorStop(0, `rgba(${glowColor},${pulseA})`);
    glow.addColorStop(1, `rgba(${glowColor},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sx, sy + bobY, pulseR, 0, Math.PI * 2); ctx.fill();
    const spr = dr.def.sprite && SPRITES.item[dr.def.sprite];
    if (spr) {
      const sz = 28;
      ctx.drawImage(spr, sx - sz / 2, sy + bobY - sz / 2, sz, sz);
    } else {
      // Placeholder: colored circle with icon
      drawCircle(sx, sy + bobY, 8, `rgba(${glowColor},0.9)`);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(dr.def.icon, sx, sy + bobY);
    }
    ctx.restore();
  }

  // Particles
  for (const p of G.particles) {
    const [sx, sy] = worldToScreen(p.x, p.z);
    if (sx < -20 || sx > canvas.width + 20 || sy < -20 || sy > canvas.height + 20) continue;
    ctx.globalAlpha = Math.max(0, p.life);
    drawCircle(sx, sy, p.size * p.life, hexStr(p.color));
    ctx.globalAlpha = 1;
  }

  // Boss red warning signs (before enemies so it renders below)
  for (const e of G.enemies) {
    if (!e.isBoss || e.dead || !e._warnActive) continue;
    const [bsx, bsy] = worldToScreen(e.x, e.z);
    const warnProgress = Math.max(0, 1.0 - e.specialTimer);  // 0→1 over 1 second
    const pulse = 0.4 + Math.sin(time * 14) * 0.3;
    const warnR = TILE * (2.5 + warnProgress * 1.5);
    // Expanding red ring
    ctx.save();
    ctx.globalAlpha = pulse * warnProgress;
    ctx.strokeStyle = '#ff2222';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(bsx, bsy, warnR, 0, Math.PI * 2); ctx.stroke();
    // Inner fill
    const wGrad = ctx.createRadialGradient(bsx, bsy, 0, bsx, bsy, warnR);
    wGrad.addColorStop(0, `rgba(255,0,0,${0.15 * warnProgress})`);
    wGrad.addColorStop(1, 'rgba(255,0,0,0)');
    ctx.fillStyle = wGrad;
    ctx.fill();
    // Exclamation mark
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ff4444';
    ctx.font = `bold ${Math.round(18 + warnProgress * 8)}px Nunito`;
    ctx.textAlign = 'center';
    ctx.fillText('⚠', bsx, bsy - TILE * 1.5);
    ctx.restore();
  }

  // Enemies (sorted by z for layering)
  const sortedEnemies = G.enemies.filter(e => !e.dead).sort((a, b) => a.z - b.z);
  for (const e of sortedEnemies) {
    const [sx, sy] = worldToScreen(e.x, e.z);
    if (sx < -TILE * 3 || sx > canvas.width + TILE * 3 || sy < -TILE * 3 || sy > canvas.height + TILE * 3) continue;
    drawEnemy(e, time);
  }

  // Projectiles
  for (const p of G.projectiles) {
    const [sx, sy] = worldToScreen(p.x, p.z);
    if (sx < -20 || sx > canvas.width + 20 || sy < -20 || sy > canvas.height + 20) continue;
    const r = 4 * p.size;
    // Glow
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2);
    glow.addColorStop(0, hexStrA(p.color, 0.4));
    glow.addColorStop(1, hexStrA(p.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 2, 0, Math.PI * 2);
    ctx.fill();
    // Star shape
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(time * 10);
    ctx.beginPath();
    for (let j = 0; j < 5; j++) {
      const a1 = (Math.PI * 2 / 5) * j - Math.PI / 2;
      const a2 = a1 + Math.PI / 5;
      ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
      ctx.lineTo(Math.cos(a2) * r * 0.4, Math.sin(a2) * r * 0.4);
    }
    ctx.closePath();
    ctx.fillStyle = hexStr(p.color);
    ctx.fill();
    ctx.restore();
  }

  // Boss Projectiles
  for (const bp of G.bossProjectiles) {
    const [sx, sy] = worldToScreen(bp.x, bp.z);
    if (sx < -20 || sx > canvas.width + 20 || sy < -20 || sy > canvas.height + 20) continue;
    const bpColor = bossRedOn ? 0xff2200 : bp.color;
    const bpR = (bpColor >> 16) & 0xff, bpG2 = (bpColor >> 8) & 0xff, bpB = bpColor & 0xff;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 14);
    glow.addColorStop(0, `rgba(${bpR},${bpG2},${bpB},0.6)`);
    glow.addColorStop(1, `rgba(${bpR},${bpG2},${bpB},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, 14, 0, Math.PI * 2);
    ctx.fill();
    drawCircle(sx, sy, 6, hexStr(bpColor));
    drawCircle(sx - 1, sy - 1, 3, bossRedOn ? '#ff6600' : '#ffaa00');
  }

  // ═ Orbital rendering multipliers ═
  const _rSz = (G.orbSizeMul || 1);
  const _rSp = (G.orbSpeedMul || 1);

  // Inner orbitals (저궤도 — 작고 빠름)
  for (let i = 0; i < (G.innerOrbitals || 0); i++) {
    const a = time * 5.0 * _rSp + (Math.PI * 2 / G.innerOrbitals) * i;
    const ox = G.px + Math.cos(a) * 1.4, oz = G.pz + Math.sin(a) * 1.4;
    const [sx, sy] = worldToScreen(ox, oz);
    const gr = 10 * _rSz;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
    glow.addColorStop(0, 'rgba(200,255,150,0.5)'); glow.addColorStop(1, 'rgba(200,255,150,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, gr, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(time * 6 * _rSp);
    const ir = 5 * _rSz, ii = 2 * _rSz;
    ctx.beginPath();
    for (let j = 0; j < 4; j++) { const a1 = (Math.PI*2/4)*j - Math.PI/4; const a2 = a1 + Math.PI/4; ctx.lineTo(Math.cos(a1)*ir, Math.sin(a1)*ir); ctx.lineTo(Math.cos(a2)*ii, Math.sin(a2)*ii); }
    ctx.closePath(); ctx.fillStyle = '#bbff66'; ctx.fill(); ctx.restore();
  }
  // Outer orbitals (고궤도 — 크고 느림)
  for (let i = 0; i < G.orbitals; i++) {
    const a = time * 3.5 * _rSp + (Math.PI * 2 / G.orbitals) * i;
    const ox = G.px + Math.cos(a) * 2.5, oz = G.pz + Math.sin(a) * 2.5;
    const [sx, sy] = worldToScreen(ox, oz);
    const gr = 14 * _rSz;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
    glow.addColorStop(0, 'rgba(255,221,68,0.5)'); glow.addColorStop(1, 'rgba(255,221,68,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, gr, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(time * 4 * _rSp);
    const sr = 7 * _rSz, si = 3 * _rSz;
    ctx.beginPath();
    for (let j = 0; j < 4; j++) { const a1 = (Math.PI*2/4)*j - Math.PI/4; const a2 = a1 + Math.PI/4; ctx.lineTo(Math.cos(a1)*sr, Math.sin(a1)*sr); ctx.lineTo(Math.cos(a2)*si, Math.sin(a2)*si); }
    ctx.closePath(); ctx.fillStyle = '#ffdd44'; ctx.fill(); ctx.restore();
  }
  // Fire orbitals
  for (let i = 0; i < (G.fireOrbitals || 0); i++) {
    const a = time * 3.3 * _rSp + (Math.PI * 2 / G.fireOrbitals) * i + Math.PI * 0.5;
    const ox = G.px + Math.cos(a) * 2.2, oz = G.pz + Math.sin(a) * 2.2;
    const [sx, sy] = worldToScreen(ox, oz);
    const gr = 12 * _rSz;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
    glow.addColorStop(0, 'rgba(255,100,30,0.6)'); glow.addColorStop(1, 'rgba(255,100,30,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, gr, 0, Math.PI * 2); ctx.fill();
    drawCircle(sx, sy, 5 * _rSz, '#ff6622'); drawCircle(sx - 1, sy - 1, 3 * _rSz, '#ffaa44');
  }
  // Ice orbitals
  for (let i = 0; i < (G.iceOrbitals || 0); i++) {
    const a = time * 2.8 * _rSp + (Math.PI * 2 / G.iceOrbitals) * i + Math.PI;
    const ox = G.px + Math.cos(a) * 2.8, oz = G.pz + Math.sin(a) * 2.8;
    const [sx, sy] = worldToScreen(ox, oz);
    const gr = 12 * _rSz;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
    glow.addColorStop(0, 'rgba(100,200,255,0.6)'); glow.addColorStop(1, 'rgba(100,200,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, gr, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(time * 3 * _rSp);
    const ds = 6 * _rSz;
    ctx.beginPath(); ctx.moveTo(0, -ds); ctx.lineTo(ds*0.67, 0); ctx.lineTo(0, ds); ctx.lineTo(-ds*0.67, 0); ctx.closePath();
    ctx.fillStyle = '#88ddff'; ctx.fill(); ctx.restore();
  }
  // Lightning orbitals
  for (let i = 0; i < (G.lightningOrbitals || 0); i++) {
    const a = time * 4.0 * _rSp + (Math.PI * 2 / G.lightningOrbitals) * i + Math.PI * 1.5;
    const ox = G.px + Math.cos(a) * 2.0, oz = G.pz + Math.sin(a) * 2.0;
    const [sx, sy] = worldToScreen(ox, oz);
    const gr = 10 * _rSz;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
    glow.addColorStop(0, 'rgba(255,255,100,0.6)'); glow.addColorStop(1, 'rgba(255,255,100,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, gr, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(time * 6 * _rSp);
    const ls = _rSz;
    ctx.beginPath(); ctx.moveTo(-2*ls, -6*ls); ctx.lineTo(2*ls, -2*ls); ctx.lineTo(0, -1*ls); ctx.lineTo(3*ls, 6*ls); ctx.lineTo(-1*ls, 1*ls); ctx.lineTo(1*ls, 0); ctx.closePath();
    ctx.fillStyle = '#ffff44'; ctx.fill(); ctx.restore();
  }
  // Star Veil (별의 장막 오라)
  if (G.starVeil > 0) {
    const [vcx, vcy] = worldToScreen(G.px, G.pz);
    const veilR = (2.5 + G.starVeil * 0.5) * TILE;
    const pulse = 1 + Math.sin(time * 2) * 0.05;
    const vr = veilR * pulse;
    const veilGrad = ctx.createRadialGradient(vcx, vcy, vr * 0.3, vcx, vcy, vr);
    veilGrad.addColorStop(0, 'rgba(120,100,220,0)');
    veilGrad.addColorStop(0.7, 'rgba(120,100,220,0.06)');
    veilGrad.addColorStop(1, 'rgba(150,120,255,0.15)');
    ctx.fillStyle = veilGrad; ctx.beginPath(); ctx.arc(vcx, vcy, vr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(150,120,255,${0.2 + Math.sin(time * 3) * 0.1})`;
    ctx.lineWidth = 1.5; ctx.stroke();
  }
  // Chaos orbitals (무지개빛)
  for (let i = 0; i < (G.chaosOrbitals || 0); i++) {
    const a = time * 3.8 * _rSp + (Math.PI * 2 / G.chaosOrbitals) * i;
    const ox = G.px + Math.cos(a) * 2.3, oz = G.pz + Math.sin(a) * 2.3;
    const [sx, sy] = worldToScreen(ox, oz);
    const gr = 15 * _rSz;
    // Rainbow hue shift per orb
    const hue = ((time * 60 + i * 60) % 360);
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
    glow.addColorStop(0, `hsla(${hue},100%,70%,0.6)`); glow.addColorStop(1, `hsla(${hue},100%,70%,0)`);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, gr, 0, Math.PI * 2); ctx.fill();
    // Spinning 6-pointed star
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(time * 5 * _rSp);
    const cr = 8 * _rSz, ci = 4 * _rSz;
    ctx.beginPath();
    for (let j = 0; j < 6; j++) { const a1 = (Math.PI*2/6)*j; const a2 = a1 + Math.PI/6; ctx.lineTo(Math.cos(a1)*cr, Math.sin(a1)*cr); ctx.lineTo(Math.cos(a2)*ci, Math.sin(a2)*ci); }
    ctx.closePath(); ctx.fillStyle = `hsl(${hue},100%,75%)`; ctx.fill();
    ctx.strokeStyle = `hsl(${(hue+180)%360},100%,85%)`; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }

  // Laser beams
  for (const lb of G.laserBeams) {
    const alpha = Math.max(0, lb.life / lb.maxLife);
    const [sx, sy] = worldToScreen(lb.x, lb.z);
    const ex = lb.x + Math.sin(lb.ang) * lb.len, ez = lb.z + Math.cos(lb.ang) * lb.len;
    const [esx, esy] = worldToScreen(ex, ez);
    // Outer glow
    ctx.save(); ctx.globalAlpha = alpha * 0.3;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(esx, esy);
    ctx.strokeStyle = '#ff2222'; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.stroke();
    // Core beam
    ctx.globalAlpha = alpha * 0.8;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(esx, esy);
    ctx.strokeStyle = '#ff6666'; ctx.lineWidth = 6; ctx.stroke();
    // Inner white core
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(esx, esy);
    ctx.strokeStyle = '#ffcccc'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  // Nova rings
  for (const nr of G.novaRings) {
    const [sx, sy] = worldToScreen(nr.x, nr.z);
    const alpha = Math.max(0, nr.life / 0.4);
    drawRing(sx, sy, nr.r, hexStrA(nr.color, alpha * 0.6), 3);
  }

  // Drones
  for (const dr of G.drones) drawDrone(dr, time);
  for (const m of G.droneMissiles) drawDroneMissile(m, time);
  for (const b of G.droneBeams) drawDroneBeam(b);
  // Star Rain (별의 비)
  for (const s of G.orbStarRains || []) {
    const [sx2, sy2] = worldToScreen(s.x, s.z);
    const t = 1 - s.life / s.maxLife;
    ctx.save();
    if (t < 0.5) {
      // 낙하 중: 위에서 내려오는 별
      const fallY = sy2 - (1 - t * 2) * 40;
      ctx.globalAlpha = 0.6 + t;
      drawCircle(sx2, fallY, 3, '#ffee66');
      ctx.globalAlpha = 0.2; drawCircle(sx2, fallY, 6, '#ffdd44');
    } else {
      // 착탄: 충격파 원
      const impactT = (t - 0.5) * 2;
      const r = s.radius * TILE * impactT;
      ctx.globalAlpha = 0.5 * (1 - impactT);
      ctx.beginPath(); ctx.arc(sx2, sy2, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,221,68,0.3)'; ctx.fill();
      ctx.strokeStyle = '#ffdd44'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
  }

  // Cat (player)
  const [psx, psy] = worldToScreen(G.px, G.pz);
  const visible = G.invincibleTimer <= 0 || Math.floor(time * 20) % 2 === 0;
  if (visible) {
    if (G.ghostActive > 0) {
      ctx.save(); ctx.globalAlpha = 0.35 + Math.sin(time * 10) * 0.15;
      drawCat(psx, psy, G.facing, time, isMoving);
      ctx.restore();
      // Ghost afterimage
      const trailA = Math.sin(time * 8) * 0.12;
      ctx.save(); ctx.globalAlpha = trailA;
      drawCat(psx - Math.sin(G.facing) * 8, psy - Math.cos(G.facing) * 8, G.facing, time, isMoving);
      ctx.restore();
    } else {
      drawCat(psx, psy, G.facing, time, isMoving);
    }
  }

  // Player HP bar (below character)
  {
    const hpPct = Math.max(0, G.hp / G.maxHp);
    const bw = 36, bh = 5;
    const bx = psx - bw / 2, by = psy + TILE * 0.55;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.roundRect(bx - 1, by - 1, bw + 2, bh + 2, 3); ctx.fill();
    ctx.fillStyle = hpPct > 0.5 ? '#4ade80' : hpPct > 0.25 ? '#fbbf24' : '#ef4444';
    ctx.beginPath(); ctx.roundRect(bx, by, bw * hpPct, bh, 2); ctx.fill();
  }

  // Range indicator (subtle)
  drawRing(psx, psy, G.range * TILE, 'rgba(255,255,255,0.03)', 1);

  // Boss off-screen indicator
  for (const e of G.enemies) {
    if (e.dead || !e.isBoss) continue;
    const [bsx, bsy] = worldToScreen(e.x, e.z);
    const pad = 50;
    if (bsx >= pad && bsx <= canvas.width - pad && bsy >= pad && bsy <= canvas.height - pad) continue;
    // Boss is off-screen → draw arrow at edge
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const ang = Math.atan2(bsy - cy, bsx - cx);
    // Clamp to screen edge with padding
    const edgePad = 40;
    let ix = cx + Math.cos(ang) * 9999, iy = cy + Math.sin(ang) * 9999;
    // Clamp X
    if (ix < edgePad) { const t = (edgePad - cx) / (ix - cx); ix = edgePad; iy = cy + (iy - cy) * t; }
    else if (ix > canvas.width - edgePad) { const t = (canvas.width - edgePad - cx) / (ix - cx); ix = canvas.width - edgePad; iy = cy + (iy - cy) * t; }
    // Clamp Y
    if (iy < edgePad) { const t = (edgePad - cy) / (iy - cy); iy = edgePad; ix = cx + (ix - cx) * t; }
    else if (iy > canvas.height - edgePad) { const t = (canvas.height - edgePad - cy) / (iy - cy); iy = canvas.height - edgePad; ix = cx + (ix - cx) * t; }
    // Pulsing glow
    const pulse = 0.6 + Math.sin(time * 4) * 0.4;
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(ang);
    // Glow circle
    const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
    grd.addColorStop(0, `rgba(255,60,60,${0.4 * pulse})`);
    grd.addColorStop(1, 'rgba(255,60,60,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
    // Arrow triangle
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-6, -8);
    ctx.lineTo(-6, 8);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,80,80,${pulse})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,200,200,${pulse * 0.8})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Skull emoji
    ctx.rotate(-ang); // un-rotate for upright text
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = pulse;
    ctx.fillText('💀', 0, -18);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Dark map: fog of war (limited vision)
  if (G.mapTheme && G.mapTheme.effect === 'darkness') {
    const [cx2, cy2] = worldToScreen(G.px, G.pz);
    const visionR = TILE * 6;
    const fogGrad = ctx.createRadialGradient(cx2, cy2, visionR * 0.6, cx2, cy2, visionR);
    fogGrad.addColorStop(0, 'rgba(10,5,20,0)');
    fogGrad.addColorStop(1, 'rgba(10,5,20,0.85)');
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.restore();
}

// ═══════════════════════════════════════
// SOUND ENGINE (Web Audio API procedural)
// ═══════════════════════════════════════
const SFX = {
  ctx: null, masterGain: null, bgmGain: null, muted: false,
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(this.ctx.destination);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.3;
    this.bgmGain.connect(this.ctx.destination);
  },
  play(type) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const ac = this.ctx;
    try {
      if (type === 'shoot') {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(440, t + 0.08);
        g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        o.connect(g); g.connect(this.masterGain); o.start(t); o.stop(t + 0.08);
      } else if (type === 'hit') {
        const buf = ac.createBuffer(1, ac.sampleRate * 0.06, ac.sampleRate);
        const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const s = ac.createBufferSource(); const g = ac.createGain();
        s.buffer = buf; g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        s.connect(g); g.connect(this.masterGain); s.start(t);
      } else if (type === 'kill') {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(600, t); o.frequency.exponentialRampToValueAtTime(200, t + 0.15);
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        o.connect(g); g.connect(this.masterGain); o.start(t); o.stop(t + 0.15);
      } else if (type === 'levelup') {
        [523, 659, 784].forEach((f, i) => {
          const o = ac.createOscillator(); const g = ac.createGain();
          o.type = 'square'; o.frequency.value = f;
          g.gain.setValueAtTime(0.08, t + i * 0.1); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.15);
          o.connect(g); g.connect(this.masterGain); o.start(t + i * 0.1); o.stop(t + i * 0.1 + 0.15);
        });
      } else if (type === 'card') {
        [660, 880].forEach((f, i) => {
          const o = ac.createOscillator(); const g = ac.createGain();
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.1, t + i * 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.12);
          o.connect(g); g.connect(this.masterGain); o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.12);
        });
      } else if (type === 'boss') {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.6);
        g.gain.setValueAtTime(0.15, t); g.gain.linearRampToValueAtTime(0, t + 0.6);
        o.connect(g); g.connect(this.masterGain); o.start(t); o.stop(t + 0.6);
        const o2 = ac.createOscillator(); const g2 = ac.createGain();
        o2.type = 'square'; o2.frequency.value = 220;
        g2.gain.setValueAtTime(0, t + 0.1); g2.gain.linearRampToValueAtTime(0.1, t + 0.15); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        o2.connect(g2); g2.connect(this.masterGain); o2.start(t + 0.1); o2.stop(t + 0.5);
      } else if (type === 'hurt') {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.type = 'square'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.12);
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        o.connect(g); g.connect(this.masterGain); o.start(t); o.stop(t + 0.12);
      } else if (type === 'gameover') {
        [400, 350, 300, 200].forEach((f, i) => {
          const o = ac.createOscillator(); const g = ac.createGain();
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.1, t + i * 0.2); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.2 + 0.3);
          o.connect(g); g.connect(this.masterGain); o.start(t + i * 0.2); o.stop(t + i * 0.2 + 0.3);
        });
      } else if (type === 'win') {
        [523, 659, 784, 1047].forEach((f, i) => {
          const o = ac.createOscillator(); const g = ac.createGain();
          o.type = 'square'; o.frequency.value = f;
          g.gain.setValueAtTime(0.1, t + i * 0.15); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.3);
          o.connect(g); g.connect(this.masterGain); o.start(t + i * 0.15); o.stop(t + i * 0.15 + 0.3);
        });
      }
    } catch (e) {}
  },
  // BGM
  bgmPlaying: false, bgmInterval: null,
  startBgm() {
    if (!this.ctx || this.bgmPlaying) return;
    this.bgmPlaying = true;
    const notes = [262,294,330,349,392,349,330,294, 262,330,392,523,392,330,294,262];
    let idx = 0;
    this.bgmInterval = setInterval(() => {
      if (this.muted || !this.bgmPlaying) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'square'; o.frequency.value = notes[idx % notes.length] * (G.currentBoss && !G.currentBoss.dead ? 0.8 : 1);
      g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g); g.connect(this.bgmGain); o.start(t); o.stop(t + 0.14);
      idx++;
    }, 180);
  },
  stopBgm() { this.bgmPlaying = false; if (this.bgmInterval) { clearInterval(this.bgmInterval); this.bgmInterval = null; } }
};

function setVolume(v) { if (SFX.masterGain) SFX.masterGain.gain.value = v / 100; }
function setBgmVolume(v) { if (SFX.bgmGain) SFX.bgmGain.gain.value = v / 100; }
function toggleMute() {
  SFX.muted = !SFX.muted;
  document.getElementById('volIcon').textContent = SFX.muted ? '🔇' : '🔊';
}

// ═══════════════════════════════════════
// RECORDS
// ═══════════════════════════════════════
function loadRecords() { return Storage.get('records'); }
function saveRecords(r) { Storage.set('records', r); }
function showStartRecords() {
  const r = loadRecords();
  const el = document.getElementById('startRecords');
  let text = '';
  if (r.plays > 0) {
    const aCount = ACHIEVEMENTS.filter(a => a.check(r)).length;
    const bonusText = aCount > 0 ? ` · 📈 업적 ${aCount}개` : '';
    const endlessText = r.endlessBest ? ` · ♾️ ${r.endlessBest}` : '';
    text = `🏆 최고 Wave ${r.bestWave} · ${r.bestKills}킬 · Lv.${r.bestLevel} · ${r.plays}회${r.cleared ? ' · ✅' : ''}${endlessText}${bonusText}`;
  }
  el.textContent = text;
  updateMainCurrency();
  updateModeSelector();
}
function updateRecords(isWin) {
  const r = loadRecords();
  r.plays++;
  let isNew = false;
  if (G.gameMode === 'endless') {
    if (!r.endlessBest) r.endlessBest = 0;
    if (G.wave > r.endlessBest) { r.endlessBest = G.wave; isNew = true; }
  }
  if (G.gameMode === 'bossrush') {
    if (!r.bossrushBest) r.bossrushBest = 0;
    if (G.wave > r.bossrushBest) { r.bossrushBest = G.wave; isNew = true; }
  }
  if (G.wave > r.bestWave) { r.bestWave = G.wave; isNew = true; }
  if (G.kills > r.bestKills) { r.bestKills = G.kills; isNew = true; }
  if (G.level > r.bestLevel) { r.bestLevel = G.level; isNew = true; }
  if (G.playTime > r.bestTime) r.bestTime = G.playTime;
  if (isWin) r.cleared = true;
  if (G.gameMode === 'daily') saveDailyRecord();
  saveRecords(r);
  return isNew;
}

function formatTime(s) { const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

function getPickedCardIcons() {
  if (!G.pickedCards) return '';
  let html = '';
  for (const id of G.pickedCards) {
    const card = CARDS.find(c => c.id === id);
    if (card) html += `<div class="win-card-icon" title="${card.name}">${card.icon}</div>`;
  }
  return html;
}

// ═══════════════════════════════════════
// PAUSE / GAME FLOW
// ═══════════════════════════════════════
const CLEAR_WAVE = 50;

function togglePause() {
  if (!G.started || G.over) return;
  if (document.getElementById('cardOverlay').classList.contains('show')) return;
  G.paused = !G.paused;
  document.getElementById('pauseOverlay').classList.toggle('show', G.paused);
  const tcb = document.getElementById('testCardBtn');
  if (tcb) tcb.style.display = G.testMode ? 'block' : 'none';
  if (G.paused) { SFX.stopBgm(); updatePauseBuildInfo(); } else SFX.startBgm();
}
function updatePauseBuildInfo() {
  const el = document.getElementById('pauseBuildInfo');
  if (!el || !G.cardCounts) return;
  let html = '';
  // Cards by build
  const byBuild = { proj: [], orb: [], drone: [], general: [] };
  for (const [id, cnt] of Object.entries(G.cardCounts)) {
    const card = CARDS.find(c => c.id === id);
    if (card) { if (!byBuild[card.build]) byBuild[card.build] = []; byBuild[card.build].push({ card, cnt }); }
  }
  for (const [build, items] of Object.entries(byBuild)) {
    if (items.length === 0) continue;
    const total = items.reduce((s, i) => s + i.cnt, 0);
    html += `<div class="pbi-section">${BUILD_LABELS[build]} (${total})</div><div class="pbi-cards">`;
    for (const { card, cnt } of items) html += `<span class="pbi-card">${card.icon} ${card.name}${cnt > 1 ? `<span class="pbi-cnt">x${cnt}</span>` : ''}</span>`;
    html += `</div>`;
  }
  // Active combos
  if (G.activeSynergies && G.activeSynergies.size > 0) {
    html += `<div class="pbi-section">🔗 활성 콤보</div><div class="pbi-cards">`;
    for (const syn of SYNERGIES) { if (G.activeSynergies.has(syn.id)) html += `<span class="pbi-combo synergy">${syn.icon} ${syn.name} — ${syn.desc}</span>`; }
    for (const evo of EVOLUTIONS) { if (G.activeSynergies.has('evo_' + evo.cardId)) html += `<span class="pbi-combo evolution">${evo.icon} ${evo.name} — ${evo.desc}</span>`; }
    for (const bb of BUILD_BONUSES) { for (const tier of bb.tiers) { if (G.activeSynergies.has(tier.id)) html += `<span class="pbi-combo allin">${tier.icon} ${tier.name} — ${tier.desc}</span>`; } }
    html += `</div>`;
  }
  el.innerHTML = html;
}
function resumeGame() { G.paused = false; document.getElementById('pauseOverlay').classList.remove('show'); SFX.startBgm(); }
function restartFromPause() { document.getElementById('pauseOverlay').classList.remove('show'); restartGame(); }
function restartFromWin() { document.getElementById('winOverlay').classList.add('hidden'); initState(); G.started = true; lastTime = 0; updateHUD(); SFX.startBgm(); }
function goToMainMenu() {
  G.over = true; G.started = false; G.paused = false;
  SFX.stopBgm();
  document.getElementById('pauseOverlay').classList.remove('show');
  document.getElementById('startOverlay').classList.remove('hidden');
  showStartRecords();
  updateMainCurrency();
}
function goToMainFromResult(overlayId) {
  document.getElementById(overlayId).classList.add('hidden');
  G.started = false;
  document.getElementById('startOverlay').classList.remove('hidden');
  showStartRecords();
  updateMainCurrency();
}

function setGameMode(mode) {
  const r = loadRecords();
  if (mode === 'endless' && !r.cleared) return;
  if (mode === 'bossrush' && r.bestWave < 25) return; // locked until wave 25
  gameMode = mode;
  difficulty = mode === 'hard' ? 'hard' : 'normal';
  document.querySelectorAll('.mode-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  const dailyInfo = document.getElementById('dailyInfo');
  if (dailyInfo) dailyInfo.classList.toggle('hidden', mode !== 'daily');
  if (mode === 'daily') updateDailyInfo();
}

function updateModeSelector() {
  const r = loadRecords();
  const endlessBtn = document.getElementById('endlessBtn');
  if (endlessBtn) {
    const locked = !r.cleared;
    endlessBtn.classList.toggle('locked', locked);
    const lockIcon = endlessBtn.querySelector('.mode-lock');
    if (lockIcon) lockIcon.style.display = locked ? 'inline' : 'none';
  }
  const bossrushBtn = document.getElementById('bossrushBtn');
  if (bossrushBtn) {
    const brLocked = r.bestWave < 25;
    bossrushBtn.classList.toggle('locked', brLocked);
    const brLockIcon = bossrushBtn.querySelector('.mode-lock');
    if (brLockIcon) brLockIcon.style.display = brLocked ? 'inline' : 'none';
  }
}

function startGame() {
  SFX.init();
  document.getElementById('startOverlay').classList.add('hidden');
  initState();
  G.started = true;
  lastTime = 0;
  updateHUD();
  const modeIcon = G.gameMode === 'hard' ? ' 💀' : G.gameMode === 'endless' ? ' ♾️' : G.gameMode === 'daily' ? ' 📅' : G.gameMode === 'bossrush' ? ' ⚔️' : '';
  document.getElementById('waveText').textContent = G.gameMode === 'bossrush' ? `BOSS 1${modeIcon}` : `WAVE 1${modeIcon}`;
  SFX.startBgm();
}

function calcEarnedCurrency() {
  const hardMul = G.difficulty === 'hard' ? 2.0 : 1.0;
  return Math.floor((G.wave * 2 + G.kills * 0.5 + G.level) * hardMul);
}

function gameOver() {
  G.over = true;
  SFX.stopBgm(); SFX.play('gameover');
  const isNew = updateRecords(false);
  const earned = calcEarnedCurrency();
  const total = addCurrency(earned);
  document.getElementById('goWave').textContent = G.wave;
  document.getElementById('goKills').textContent = G.kills;
  document.getElementById('goLevel').textContent = G.level;
  document.getElementById('goTime').textContent = formatTime(G.playTime);
  document.getElementById('goCards').innerHTML = getPickedCardIcons();
  document.getElementById('goEarned').textContent = `+${earned} 🐟`;
  document.getElementById('goTotal').textContent = `보유: ${total} 🐟`;
  const nr = document.getElementById('goNewRecord');
  nr.classList.toggle('hidden', !isNew);
  document.getElementById('gameOverOverlay').classList.remove('hidden');
}

function gameWin() {
  G.over = true;
  SFX.stopBgm(); SFX.play('win');
  const isNew = updateRecords(true);
  const earned = calcEarnedCurrency() + (G.difficulty === 'hard' ? 50 : 20); // clear bonus
  const total = addCurrency(earned);
  document.getElementById('winKills').textContent = G.kills;
  document.getElementById('winLevel').textContent = G.level;
  document.getElementById('winTime').textContent = formatTime(G.playTime);
  document.getElementById('winCards').innerHTML = getPickedCardIcons();
  document.getElementById('winEarned').textContent = `+${earned} 🐟`;
  document.getElementById('winTotal').textContent = `보유: ${total} 🐟`;
  const nr = document.getElementById('winNewRecord');
  nr.classList.toggle('hidden', !isNew);
  document.getElementById('winOverlay').classList.remove('hidden');
}

function restartGame() {
  document.getElementById('gameOverOverlay').classList.add('hidden');
  initState(); G.started = true; lastTime = 0; updateHUD();
  SFX.startBgm();
}

// ═══════════════════════════════════════
// CARD BAN/PICK CONFIG
// ═══════════════════════════════════════
let configTab = 'all';

function showCardConfig() {
  preBannedCards = [...preBannedCards]; // keep existing
  document.getElementById('cardConfigOverlay').classList.remove('hidden');
  renderCardConfig();
}

function hideCardConfig() {
  document.getElementById('cardConfigOverlay').classList.add('hidden');
}

function renderCardConfig() {
  const tabs = document.getElementById('configTabs');
  const body = document.getElementById('configBody');
  if (!tabs || !body) return;

  // Tabs
  const builds = ['all', 'proj', 'orb', 'drone', 'general'];
  const labels = { all: '🎴 전체', proj: '🏹 투사체', orb: '🌟 위성', drone: '🛸 드론', general: '📦 범용' };
  tabs.innerHTML = builds.map(b =>
    `<button class="codex-tab${configTab === b ? ' active' : ''}" onclick="setConfigTab('${b}')">${labels[b]}</button>`
  ).join('');

  // Cards
  const filtered = configTab === 'all' ? CARDS : CARDS.filter(c => c.build === configTab);
  body.innerHTML = filtered.map(c => {
    const isBanned = preBannedCards.includes(c.id);
    const isStarter = preStarterCard === c.id;
    return `<div class="config-card ${isBanned ? 'banned' : ''} ${isStarter ? 'starter' : ''} rarity-border-${c.rarity}">
      <span class="config-card-icon">${c.icon}</span>
      <span class="config-card-info">
        <span class="config-card-name">${c.name}</span>
        <span class="config-card-desc">${c.desc}</span>
      </span>
      <span class="config-card-actions">
        <button class="config-ban-btn ${isBanned ? 'active' : ''}" onclick="toggleBan('${c.id}')" title="밴">🚫</button>
        <button class="config-pick-btn ${isStarter ? 'active' : ''}" onclick="setStarter('${c.id}')" title="시작카드">⭐</button>
      </span>
    </div>`;
  }).join('');

  updateConfigStatus();
}

function setConfigTab(tab) {
  configTab = tab;
  renderCardConfig();
}

function toggleBan(cardId) {
  const idx = preBannedCards.indexOf(cardId);
  if (idx >= 0) {
    preBannedCards.splice(idx, 1);
  } else {
    if (preBannedCards.length >= 3) return; // max 3 bans
    if (preStarterCard === cardId) preStarterCard = null; // can't ban starter
    preBannedCards.push(cardId);
  }
  renderCardConfig();
}

function setStarter(cardId) {
  if (preStarterCard === cardId) {
    preStarterCard = null;
  } else {
    if (preBannedCards.includes(cardId)) {
      preBannedCards = preBannedCards.filter(id => id !== cardId); // unban if banned
    }
    preStarterCard = cardId;
  }
  renderCardConfig();
}

function resetCardConfig() {
  preBannedCards = [];
  preStarterCard = null;
  renderCardConfig();
}

function updateConfigStatus() {
  const banCount = document.getElementById('banCount');
  const starterStatus = document.getElementById('starterStatus');
  if (banCount) banCount.textContent = `밴: ${preBannedCards.length}/3`;
  if (starterStatus) {
    const card = preStarterCard ? CARDS.find(c => c.id === preStarterCard) : null;
    starterStatus.textContent = card ? `시작: ${card.icon} ${card.name}` : '시작 카드: 미선택';
  }
}

renderCharacterSelect();
showStartRecords();
updateDailyInfo();
initState(); animate(0);