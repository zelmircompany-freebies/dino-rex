/* ================================================================
   DINO REX — игровой движок
   Автор: ZELMIR COMPANY
   Архитектура:
     - SaveManager   — LocalStorage (прогресс, покупки, настройки)
     - AudioManager  — звуки и музыка через WebAudio (генерируются, без файлов)
     - Characters    — процедурные пиксель-спрайты персонажей
     - World/Obstacles — генерация мира и препятствий
     - Player        — физика персонажа, состояния анимации
     - GameEngine    — игровой цикл, режимы, столкновения
     - UI            — переключение экранов, привязка событий
   ================================================================ */

'use strict';

/* ================================================================
   1. КОНСТАНТЫ И КОНФИГ
   ================================================================ */

const CONFIG = {
  STORAGE_KEY: 'dinorex_save_v1',

  // базовые физические параметры (px в "игровых" единицах, масштабируются под canvas)
  GRAVITY: 2200,
  JUMP_VELOCITY: -820,
  GROUND_Y_RATIO: 0.78, // доля высоты канваса, где земля

  BASE_SPEED: 380,
  MAX_SPEED: 900,
  SPEED_RAMP: 4.2, // прирост скорости в px/s каждую секунду

  SCORE_PER_SEC: 10,

  MODES: {
    classic: {
      id: 'classic',
      title: 'Классика',
      desc: 'Автобег, прыжки через препятствия — как в оригинале, но с трицератопсом.',
      tag: 'Стандарт',
      speedMult: 1,
      spawnMult: 1,
      difficultyRamp: 1,
      auto: true
    },
    hardcore: {
      id: 'hardcore',
      title: 'Усложнённая классика',
      desc: 'Выше скорость, больше препятствий, безопасные зоны — редкость. Для смелых.',
      tag: 'Хардкор',
      speedMult: 1.35,
      spawnMult: 1.55,
      difficultyRamp: 1.9,
      auto: true
    },
    platformer: {
      id: 'platformer',
      title: 'Платформер',
      desc: 'Свободное движение и настоящие платформы в воздухе — прыгайте по ним, набирайте высоту и обходите препятствия.',
      tag: 'Новое',
      speedMult: 1,
      spawnMult: 1,
      difficultyRamp: 1.1,
      auto: false
    }
  },

  THEMES: ['classic', 'invert', 'sepia'],

  CHARACTERS: [
    { id: 'triceratops', name: 'Трицератопс', price: 0, desc: 'Стартовый герой. Крепкий панцирь и три рога.' },
    { id: 'stego', name: 'Стегозавр', price: 500, desc: 'Пластины на спине. Скоро в игре.' },
    { id: 'ptero', name: 'Птеродактиль', price: 1200, desc: 'Летающий герой. Скоро в игре.' },
    { id: 'raptor', name: 'Раптор', price: 2000, desc: 'Быстрый и юркий. Скоро в игре.' }
  ],

  UPGRADES: [
    {
      id: 'startSpeed', name: 'Стартовая скорость', icon: '⚡',
      desc: 'Увеличивает начальную скорость бега.',
      maxLevel: 5, baseCost: 150, costMult: 1.6
    },
    {
      id: 'scoreBoost', name: 'Множитель очков', icon: '★',
      desc: 'Больше очков за каждый пройденный метр.',
      maxLevel: 5, baseCost: 200, costMult: 1.7
    },
    {
      id: 'shield', name: 'Щит', icon: '🛡',
      desc: 'Поглощает одно столкновение за забег.',
      maxLevel: 3, baseCost: 400, costMult: 2.1
    },
    {
      id: 'magnetTime', name: 'Время бонусов', icon: '⏱',
      desc: 'Увеличивает длительность подобранных бонусов.',
      maxLevel: 4, baseCost: 180, costMult: 1.55
    },
    {
      id: 'coinGain', name: 'Прирост монет', icon: '⛁',
      desc: 'Больше монет за каждый забег.',
      maxLevel: 5, baseCost: 220, costMult: 1.65
    }
  ]
};

/* ================================================================
   2. SAVE MANAGER — LocalStorage
   ================================================================ */

const SaveManager = {
  _default(){
    return {
      coins: 0,
      bestScore: { classic: 0, hardcore: 0, platformer: 0 },
      ownedCharacters: ['triceratops'],
      equippedCharacter: 'triceratops',
      upgrades: {}, // { upgradeId: level }
      settings: {
        music: true,
        sfx: true,
        volume: 70,
        theme: 'classic',
        controlsHint: true,
        jumpKey: 'Space',
        haptics: true
      },
      selectedMode: 'classic'
    };
  },

  data: null,

  load(){
    try{
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      if(!raw){ this.data = this._default(); this.save(); return this.data; }
      const parsed = JSON.parse(raw);
      // мердж с дефолтом на случай новых полей в будущих версиях
      this.data = Object.assign(this._default(), parsed);
      this.data.settings = Object.assign(this._default().settings, parsed.settings || {});
      this.data.bestScore = Object.assign(this._default().bestScore, parsed.bestScore || {});
      return this.data;
    }catch(e){
      console.warn('Save load failed, using defaults', e);
      this.data = this._default();
      return this.data;
    }
  },

  save(){
    try{
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(this.data));
    }catch(e){ console.warn('Save failed', e); }
  },

  reset(){
    this.data = this._default();
    this.save();
  },

  upgradeLevel(id){
    return this.data.upgrades[id] || 0;
  }
};

/* ================================================================
   3. AUDIO MANAGER — синтез звуков через WebAudio (без внешних файлов)
   ================================================================ */

const AudioManager = {
  ctx: null,
  musicNodes: null,
  musicPlaying: false,

  init(){
    if(this.ctx) return;
    try{
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }catch(e){ console.warn('WebAudio unavailable', e); }
  },

  _resume(){
    if(this.ctx && this.ctx.state === 'suspended'){ this.ctx.resume(); }
  },

  get volume(){
    return (SaveManager.data.settings.volume / 100);
  },

  playTone(freq, duration, type = 'square', gainMult = 1){
    if(!this.ctx || !SaveManager.data.settings.sfx) return;
    this._resume();
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(this.volume * 0.18 * gainMult, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration);
  },

  jump(){ this.playTone(520, 0.14, 'square', 1); },
  hit(){ this.playTone(110, 0.35, 'sawtooth', 1.3); },
  coin(){ this.playTone(880, 0.09, 'triangle', 0.8); setTimeout(()=>this.playTone(1200,0.09,'triangle',0.6), 60); },
  score100(){ this.playTone(660, 0.12, 'square', 0.7); },
  click(){ this.playTone(340, 0.05, 'square', 0.5); },
  buy(){ this.playTone(500,0.08,'triangle',0.6); setTimeout(()=>this.playTone(760,0.1,'triangle',0.6), 70); },

  // простая процедурная фоновая музыка (лёгкий arpeggio-луп), только пока в игре
  startMusic(){
    if(!this.ctx || !SaveManager.data.settings.music || this.musicPlaying) return;
    this._resume();
    this.musicPlaying = true;
    this._musicStep = 0;
    const notes = [220, 261.6, 329.6, 261.6, 220, 196, 220, 261.6];
    this._musicInterval = setInterval(()=>{
      if(!this.musicPlaying) return;
      const f = notes[this._musicStep % notes.length];
      this.playTone(f, 0.22, 'triangle', 0.28);
      this._musicStep++;
    }, 260);
  },

  stopMusic(){
    this.musicPlaying = false;
    if(this._musicInterval){ clearInterval(this._musicInterval); this._musicInterval = null; }
  }
};

/* ================================================================
   4. УТИЛИТЫ
   ================================================================ */

const Utils = {
  rand(min, max){ return Math.random() * (max - min) + min; },
  randInt(min, max){ return Math.floor(this.rand(min, max + 1)); },
  clamp(v, min, max){ return Math.max(min, Math.min(max, v)); },
  lerp(a, b, t){ return a + (b - a) * t; },
  choice(arr){ return arr[Math.floor(Math.random() * arr.length)]; },
  formatScore(n){ return Math.floor(n).toString().padStart(5, '0'); },
  vibrate(ms){
    if(SaveManager.data.settings.haptics && navigator.vibrate){
      try{ navigator.vibrate(ms); }catch(e){}
    }
  }
};

/* ================================================================
   5. СПРАЙТЫ ПЕРСОНАЖЕЙ — процедурный пиксель-арт
   Рисуем трицератопса на пиксельной сетке (как оригинальный Dino),
   с несколькими кадрами анимации бега + прыжок + приседание + смерть.
   Каждый кадр — матрица 0/1, масштабируется под pixelSize.
   ================================================================ */

const Sprites = {
  // 34x18 сетка, процедурно сгенерирована для ровного силуэта.
  // Голова СЛЕВА (герой бежит вправо): зубчатый воротник, 2 надглазничных рога,
  // носовой рог, бочкообразное тело, короткий хвост.
  triceratops: {
    run: [
      [
      "0000000100110110110110000000000000",
      "0001000110111111111110000000000000",
      "0000100011111111111111000000000000",
      "0000110011111111111111000000000000",
      "0000111001111111111111000000000000",
      "0000011101111111111111000000000000",
      "0000000001111110111111000000000000",
      "0000000001111111111111000000000000",
      "1110000001111111111111110000000000",
      "1111110000000000111111111111110000",
      "1100111111000000111111111111111100",
      "0000000000000000111111111111111100",
      "0000000000000000000111111111111100",
      "0000000000000000000111111111111111",
      "0000000000000000000111111111111110",
      "0000000000000000000011111111111000",
      "0000000000000000000001111001111000",
      "0000000000000000000001111000000000"
      ],
      [
      "0000000100110110110110000000000000",
      "0001000110111111111110000000000000",
      "0000100011111111111111000000000000",
      "0000110011111111111111000000000000",
      "0000111001111111111111000000000000",
      "0000011101111111111111000000000000",
      "0000000001111110111111000000000000",
      "0000000001111111111111000000000000",
      "1110000001111111111111110000000000",
      "1111110000000000111111111111110000",
      "1100111111000000111111111111111100",
      "0000000000000000111111111111111100",
      "0000000000000000000111111111111100",
      "0000000000000000000111111111111111",
      "0000000000000000000111111111111110",
      "0000000000000000000111111111111110",
      "0000000000000000000111100000011110",
      "0000000000000000000000000000011110"
      ]
    ],
    jump: [
      "0000000100110110110110000000000000",
      "0001000110111111111110000000000000",
      "0000100011111111111111000000000000",
      "0000110011111111111111000000000000",
      "0000111001111111111111000000000000",
      "0000011101111111111111000000000000",
      "0000000001111110111111000000000000",
      "0000000001111111111111000000000000",
      "1110000001111111111111110000000000",
      "1111110000000000111111111111110000",
      "1100111111000000111111111111111100",
      "0000000000000000111111111111111100",
      "0000000000000000000111111111111100",
      "0000000000000000000111111111111111",
      "0000000000000000000111111111111110",
      "0000000000000000000011111111111000",
      "0000000000000000000001111001111000",
      "0000000000000000000000000000000000"
    ],
    duck: [
      "0000000000000000000000000000000000",
      "0000000000000000000000000000000000",
      "0000000000000000000000000000000000",
      "0000000100110110110110000000000000",
      "0001000110111111111110000000000000",
      "0000100011111111111111000000000000",
      "0000110011111111111111000000000000",
      "0000111001111111111111000000000000",
      "0000011101111111111111000000000000",
      "0000000001111110111111000000000000",
      "0000000001111111111111000000000000",
      "1110000001111111111111110000000000",
      "1111110000000000111111111111110000",
      "1100111111000000111111111111111100",
      "0000000000000000111111111111111100",
      "0000000000000000000111111111111100",
      "0000000000000000000111111111111111",
      "0000000000000000000111111111111110"
    ],
    dead: [
      "0000000000000000000000000000000000",
      "0000000000000000000000000000000000",
      "0000000011100000000000111000000000",
      "0000000011100011111000111000000000",
      "0000000000000011111000000000000000",
      "0000000000000000000000000000000000",
      "0000000000111111111111110000000000",
      "0000001111111111111111111111000000",
      "0000001111111111111111111111000000",
      "0000001111111111111111111111000000",
      "0000001111111111111111111111000000",
      "0000001111111111111111111111000000",
      "0000001111111111111111111111000000",
      "0000001111111111111111111111000000",
      "0000000001111111111111111000000000",
      "0000000000000000000000000000000000",
      "0000000000000000000000000000000000",
      "0000000000000000000000000000000000"
    ]
  }
};

// Рисует спрайт (0/1 матрица) на canvas 2d context
function drawSprite(ctx, matrix, x, y, pixelSize, color){
  ctx.fillStyle = color;
  for(let row = 0; row < matrix.length; row++){
    const line = matrix[row];
    for(let col = 0; col < line.length; col++){
      if(line[col] === '1'){
        ctx.fillRect(
          Math.round(x + col * pixelSize),
          Math.round(y + row * pixelSize),
          pixelSize + 0.5,
          pixelSize + 0.5
        );
      }
    }
  }
}

function spriteDims(matrix, pixelSize){
  return { w: matrix[0].length * pixelSize, h: matrix.length * pixelSize };
}

/* ================================================================
   6. ПРЕПЯТСТВИЯ И МИР
   Пиксель-паттерны препятствий пустыни: кактусы (неск. видов),
   птицы (2 кадра полёта), камни, ямы.
   ================================================================ */

const ObstacleSprites = {
  cactusSmall: [
    "00100",
    "00100",
    "10101",
    "10101",
    "11111",
    "01110",
    "01110",
    "01110"
  ],
  cactusBig: [
    "001000",
    "001010",
    "101010",
    "101010",
    "111111",
    "011110",
    "011110",
    "011110",
    "011110",
    "011110"
  ],
  cactusCluster: [
    "0010010100",
    "0010010100",
    "1010111101",
    "1010111101",
    "1111111111",
    "0111111110",
    "0111111110",
    "0111111110"
  ],
  rock: [
    "0011100",
    "0111110",
    "1111111",
    "1111111",
    "1111111"
  ],
  birdUp: [
    "0010000100",
    "0111011100",
    "1111111111",
    "0011111100",
    "0001110000"
  ],
  birdDown: [
    "0000000000",
    "0011111100",
    "1111111111",
    "0111011100",
    "0010000100"
  ]
};

// типы препятствий с метаданными (высота хитбокса относительно земли и т.д.)
const OBSTACLE_TYPES = [
  { key: 'cactusSmall', kind: 'ground', weight: 3, pixel: 6 },
  { key: 'cactusBig', kind: 'ground', weight: 2, pixel: 6 },
  { key: 'cactusCluster', kind: 'ground', weight: 2, pixel: 6 },
  { key: 'rock', kind: 'ground', weight: 2, pixel: 6 },
  { key: 'pit', kind: 'pit', weight: 1, pixel: 6 },       // яма — рисуется отдельно
  { key: 'bird', kind: 'air', weight: 2, pixel: 6 }        // птица — 3 варианта высоты
];

/* ================================================================
   7. ИГРОВОЙ ДВИЖОК
   ================================================================ */

class GameEngine {
  constructor(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.running = false;
    this.paused = false;
    this.mode = CONFIG.MODES.classic;

    this.reset();
    this._bindResize();
  }

  _bindResize(){
    const resize = () => {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.viewW = rect.width;
      this.viewH = rect.height;
      this.groundY = this.viewH * CONFIG.GROUND_Y_RATIO;
      // масштаб пикселя спрайта относительно высоты экрана — держим героя ~18% высоты
      this.pixelSize = Utils.clamp(this.viewH * 0.019, 3.2, 8.5);
    };
    resize();
    window.addEventListener('resize', resize);
    this._resizeFn = resize;
  }

  reset(){
    this.elapsed = 0;
    this.score = 0;
    this.coinsCollected = 0;
    this.speed = CONFIG.BASE_SPEED;
    this.obstacles = [];
    this.particles = [];
    this.coins = [];
    this.platforms = [];
    this.clouds = this._initClouds();
    this.groundOffset = 0;
    this.spawnTimer = 0;
    this.nextSpawnGap = 1.1;
    this.platformTimer = 0;
    this.nextPlatformGap = 2.2;
    this.shakeTime = 0;
    this.usedShield = false;
    this.hasShield = SaveManager.upgradeLevel('shield') > 0;
    this.player = this._initPlayer();
    this.state = 'ready'; // ready -> countdown -> playing -> dead
    this.timeScaleFlash = 0;
  }

  _initClouds(){
    const arr = [];
    for(let i=0;i<5;i++){
      arr.push({ x: Utils.rand(0,1000), y: Utils.rand(20,120), scale: Utils.rand(0.6,1.3), speed: Utils.rand(0.15,0.4) });
    }
    return arr;
  }

  _initPlayer(){
    const startSpeedLvl = SaveManager.upgradeLevel('startSpeed');
    return {
      x: 70,
      y: 0,
      vy: 0,
      w: 0, h: 0,
      onGround: true,
      ducking: false,
      state: 'run', // run | jump | duck | dead
      runFrame: 0,
      runTimer: 0,
      // для платформера: горизонтальное перемещение
      vx: 0,
      facing: 1,
      lane: 0,
      startBoost: startSpeedLvl * 22
    };
  }

  setMode(modeId){
    this.mode = CONFIG.MODES[modeId] || CONFIG.MODES.classic;
  }

  /* ---------------- ЗАПУСК / ОСТАНОВКА ---------------- */

  start(){
    this.reset();
    this._resizeFn();
    this.running = true;
    this.paused = false;
    this.state = 'countdown';
    this._countdownStart = performance.now();
    this._lastT = performance.now();
    this.speed = CONFIG.BASE_SPEED + this.player.startBoost;
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(this._loop.bind(this));
    AudioManager.startMusic();
  }

  stop(){
    this.running = false;
    cancelAnimationFrame(this._raf);
    AudioManager.stopMusic();
  }

  pause(){ this.paused = true; AudioManager.stopMusic(); }
  resume(){ this.paused = false; this._lastT = performance.now(); AudioManager.startMusic(); cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame(this._loop.bind(this)); }

  /* ---------------- ВВОД ---------------- */

  inputJump(){
    if(this.state !== 'playing') return;
    const p = this.player;
    if(p.onGround && p.state !== 'dead'){
      p.vy = CONFIG.JUMP_VELOCITY;
      p.onGround = false;
      p.state = 'jump';
      p.ducking = false;
      AudioManager.jump();
      Utils.vibrate(12);
    }
  }

  inputDuckStart(){
    if(this.state !== 'playing') return;
    const p = this.player;
    if(p.onGround){ p.ducking = true; p.state = 'duck'; }
    else { p.vy = Math.max(p.vy, 260); } // быстрое падение в прыжке
  }
  inputDuckEnd(){
    const p = this.player;
    if(p.onGround && p.ducking){ p.ducking = false; p.state = 'run'; }
  }

  inputMoveX(dir){ // только для платформера: -1, 0, 1
    if(this.mode.id !== 'platformer') return;
    this.player.moveDir = dir;
  }

  /* ---------------- ГЛАВНЫЙ ЦИКЛ ---------------- */

  _loop(now){
    if(!this.running) return;
    if(this.paused){ this._raf = requestAnimationFrame(this._loop.bind(this)); return; }

    let dt = (now - this._lastT) / 1000;
    dt = Math.min(dt, 0.05); // защита от скачков (напр. сворачивание вкладки)
    this._lastT = now;

    if(this.state === 'countdown'){
      const t = (now - this._countdownStart) / 1000;
      if(t >= 1.4){ this.state = 'playing'; }
      this._render(dt, t);
      this._raf = requestAnimationFrame(this._loop.bind(this));
      return;
    }

    if(this.state === 'playing'){
      this._update(dt);
    }

    this._render(dt, 0);
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  /* ---------------- ОБНОВЛЕНИЕ ЛОГИКИ ---------------- */

  _update(dt){
    this.elapsed += dt;

    // нарастание скорости
    const ramp = CONFIG.SPEED_RAMP * this.mode.difficultyRamp;
    this.speed = Utils.clamp(this.speed + ramp * dt, CONFIG.BASE_SPEED, CONFIG.MAX_SPEED * this.mode.speedMult);

    // очки
    const scoreLvl = SaveManager.upgradeLevel('scoreBoost');
    const scoreMult = 1 + scoreLvl * 0.15;
    this.score += CONFIG.SCORE_PER_SEC * scoreMult * dt;

    this._updatePlayer(dt);
    this._updateWorldScroll(dt);
    this._updateObstacles(dt);
    this._updateCoinsPickups(dt);
    this._updateParticles(dt);
    this._checkCollisions();

    if(Math.floor(this.score) % 100 === 0 && Math.floor(this.score) > 0 && !this._scoreFlagged){
      this._scoreFlagged = true;
    } else if(Math.floor(this.score) % 100 !== 0){
      this._scoreFlagged = false;
    }
  }

  _updatePlayer(dt){
    const p = this.player;
    if(p.state === 'dead') return;

    const isPlatformer = this.mode.id === 'platformer';

    // платформер: свободное горизонтальное движение
    if(isPlatformer){
      const targetVx = (p.moveDir || 0) * 340;
      p.vx = Utils.lerp(p.vx, targetVx, Math.min(1, dt*10));
      p.x += p.vx * dt;
      p.x = Utils.clamp(p.x, 30, this.viewW * 0.62);
    }

    // --- гравитация + приземление на платформы (только platformer) ---
    if(isPlatformer){
      p.vy += CONFIG.GRAVITY * dt;
      const isFalling = p.vy >= 0; // используем обновлённую скорость: падаем ли мы в этом кадре
      const nextY = p.y + p.vy * dt;

      const feetX = p.x + 12*this.pixelSize;
      const footWidth = 8*this.pixelSize;
      // допуск по глубине проникновения — щадящее приземление, чтобы точный
      // покадровый тайминг не требовался (иначе платформер физически непроходим
      // при высоких скоростях мира и длинной траектории прыжка)
      const landingTolerance = Math.max(26, Math.abs(p.vy) * dt * 1.6);

      // ищем самую высокую платформу под ногами, на которую мы приземляемся в этом кадре
      let bestLandingY = null; // в координатах p.y (0 = земля, отрицательное = выше земли)
      if(isFalling){
        for(const plat of this.platforms){
          if(feetX + footWidth <= plat.x || feetX >= plat.x + plat.w) continue;
          const platTopY = -(this.groundY - plat.y); // высота ВЕРХНЕГО края платформы над землёй
          // приземляемся, если герой в этом кадре проходит через полосу [platTopY - tol, platTopY + tol] сверху вниз
          if(nextY >= platTopY - landingTolerance && p.y <= platTopY + landingTolerance){
            if(bestLandingY === null || platTopY < bestLandingY){ bestLandingY = platTopY; }
          }
        }
      }

      let landed = false;
      if(bestLandingY !== null){
        p.y = bestLandingY;
        landed = true;
      } else if(nextY >= 0){
        p.y = 0;
        landed = true;
      } else {
        p.y = nextY;
      }

      if(landed){
        p.vy = 0;
        p.onGround = true;
        p.state = p.ducking ? 'duck' : 'run';
      } else {
        p.onGround = false;
        p.state = 'jump';
      }
    } else {
      // раннер-режимы: только уровень земли
      if(!p.onGround || p.y < 0){
        p.vy += CONFIG.GRAVITY * dt;
        p.y += p.vy * dt;
        if(p.y >= 0){
          p.y = 0;
          p.vy = 0;
          p.onGround = true;
          p.state = p.ducking ? 'duck' : 'run';
        } else {
          p.state = 'jump';
        }
      }
    }

    // анимация бега
    if(p.state === 'run'){
      p.runTimer += dt;
      const frameDur = Utils.clamp(0.16 - (this.speed - CONFIG.BASE_SPEED) * 0.00012, 0.06, 0.16);
      if(p.runTimer >= frameDur){
        p.runTimer = 0;
        p.runFrame = 1 - p.runFrame;
      }
    }
  }

  _updateWorldScroll(dt){
    this.groundOffset -= this.speed * dt;
    if(this.groundOffset < -64) this.groundOffset += 64;

    for(const c of this.clouds){
      c.x -= this.speed * c.speed * dt * 0.12;
      if(c.x < -100){ c.x = this.viewW + Utils.rand(50,200); c.y = Utils.rand(20, this.viewH*0.35); }
    }
  }

  _updateObstacles(dt){
    // спавн препятствий
    this.spawnTimer += dt;
    if(this.spawnTimer >= this.nextSpawnGap){
      this.spawnTimer = 0;
      this._spawnObstacle();
      const difficulty = Utils.clamp(this.elapsed / 45, 0, 1); // 0..1 за 45 сек
      const baseGap = Utils.lerp(1.35, 0.62, difficulty) / this.mode.spawnMult;
      this.nextSpawnGap = baseGap * Utils.rand(0.75, 1.25);
    }

    for(const o of this.obstacles){ o.x -= this.speed * dt; }
    this.obstacles = this.obstacles.filter(o => o.x > -160);

    // спавн монет-бонусов иногда
    this._coinSpawnTimer = (this._coinSpawnTimer || 0) + dt;
    if(this._coinSpawnTimer > Utils.rand(3.5, 6)){
      this._coinSpawnTimer = 0;
      this._spawnCoin();
    }

    // платформы — только в режиме "Платформер"
    if(this.mode.id === 'platformer'){
      this.platformTimer += dt;
      if(this.platformTimer >= this.nextPlatformGap){
        this.platformTimer = 0;
        this._spawnPlatform();
        this.nextPlatformGap = Utils.rand(1.6, 2.6);
      }
      for(const pl of this.platforms){ pl.x -= this.speed * dt; }
      this.platforms = this.platforms.filter(pl => pl.x > -220);
    }
  }

  _spawnPlatform(){
    // высота над землёй (в пикселях) и ширина платформы.
    // Апекс прыжка героя ~150px при базовой скорости — держим платформы заметно
    // ниже апекса, чтобы окно приземления на спуске было широким и комфортным
    // для реального игрока (не только для покадрово точного тайминга).
    const h = Utils.choice([55, 75, 95]);
    const w = Utils.rand(140, 240);
    this.platforms.push({
      x: this.viewW + 60,
      y: this.groundY - h,   // верхний край платформы в экранных координатах
      w,
      h: 14
    });
  }

  _spawnObstacle(){
    // в платформере земляные препятствия/ямы встречаются реже — акцент на платформах
    const isPlatformer = this.mode.id === 'platformer';
    const pool = isPlatformer
      ? OBSTACLE_TYPES.filter(t => t.kind !== 'pit')
      : OBSTACLE_TYPES;

    const totalWeight = pool.reduce((s,t)=>s + (isPlatformer && t.kind==='ground' ? t.weight*0.5 : t.weight), 0);
    let r = Math.random() * totalWeight;
    let chosen = pool[0];
    for(const t of pool){
      const w = isPlatformer && t.kind==='ground' ? t.weight*0.5 : t.weight;
      if(r < w){ chosen = t; break; }
      r -= w;
    }

    // в режиме platformer птицы и ямы ведут себя иначе — упростим: всегда используем полный набор
    const x = this.viewW + 40;

    if(chosen.kind === 'ground'){
      const matrix = ObstacleSprites[chosen.key];
      const dims = spriteDims(matrix, this.pixelSize);
      this.obstacles.push({
        type: chosen.key, kind: 'ground', x, matrix,
        w: dims.w, h: dims.h
      });
    } else if(chosen.kind === 'pit'){
      const w = Utils.rand(70, 130);
      this.obstacles.push({ type:'pit', kind:'pit', x, w, h: 20 });
    } else if(chosen.kind === 'air'){
      // высота над землёй в пикселях (не доля экрана!):
      //  low  — на уровне тела бегущего героя -> нужно ПРИСЕСТЬ
      //  high — выше макс. высоты прыжка героя -> можно пробежать под ней
      const heightRoll = Utils.rand(0,1);
      const duckLevel = 18 * this.pixelSize * 0.55;   // высота головы во время бега/приседа
      const highLevel = 18 * this.pixelSize * 1.75;   // выше апекса прыжка — безопасно пробежать
      const flyOffset = heightRoll < 0.55 ? duckLevel : highLevel;
      const dims = spriteDims(ObstacleSprites.birdUp, this.pixelSize);
      this.obstacles.push({
        type:'bird', kind:'air', x, w: dims.w, h: dims.h,
        flyOffset, animT: 0
      });
    }
  }

  _spawnCoin(){
    const heights = [0.35, 0.55, 0.15];
    this.coins.push({
      x: this.viewW + 40,
      heightRatio: Utils.choice(heights),
      collected: false,
      bobT: Math.random()*10
    });
  }

  _updateCoinsPickups(dt){
    for(const c of this.coins){ c.x -= this.speed * dt; c.bobT += dt*4; }
    this.coins = this.coins.filter(c => c.x > -40 && !c.collected);
  }

  _updateParticles(dt){
    for(const p of this.particles){ p.life -= dt; p.x += p.vx*dt; p.y += p.vy*dt; p.vy += 900*dt; }
    this.particles = this.particles.filter(p=>p.life>0);
  }

  _spawnBurst(x,y,color,count=8){
    for(let i=0;i<count;i++){
      this.particles.push({
        x,y, vx: Utils.rand(-140,140), vy: Utils.rand(-260,-60),
        life: Utils.rand(0.3,0.6), color, size: Utils.rand(2,4)
      });
    }
  }

  /* ---------------- КОЛЛИЗИИ ---------------- */

  _getPlayerHitbox(){
    const p = this.player;
    const groundH = 18 * this.pixelSize;
    let h = p.ducking ? groundH*0.6 : groundH;
    let w = p.ducking ? 32*this.pixelSize : 24*this.pixelSize;
    const x = p.x;
    const y = this.groundY + p.y - h;
    // небольшой инсет для честного, но приятного фидбека
    return { x: x + w*0.15, y: y + h*0.1, w: w*0.7, h: h*0.82 };
  }

  _checkCollisions(){
    const p = this.player;
    if(p.state === 'dead') return;
    const hb = this._getPlayerHitbox();

    // земляные препятствия и ямы
    for(const o of this.obstacles){
      if(o.kind === 'ground'){
        const ox = o.x, oy = this.groundY - o.h, ow = o.w, oh = o.h;
        if(this._rectsOverlap(hb, {x:ox,y:oy,w:ow,h:oh})){
          this._onHit();
          return;
        }
      } else if(o.kind === 'pit'){
        // яма: срабатывает только если герой реально на уровне земли (p.y===0), а не стоит на платформе
        if(p.onGround && !p.ducking && p.y === 0){
          const playerFeetX = p.x + 11*this.pixelSize;
          if(playerFeetX > o.x && playerFeetX < o.x + o.w){
            this._onHit();
            return;
          }
        }
      } else if(o.kind === 'air'){
        const airBox = { x:o.x, y: this.groundY - o.flyOffset - o.h, w:o.w, h:o.h };
        if(this._rectsOverlap(hb, airBox)){
          this._onHit();
          return;
        }
      }
    }

    // монеты
    for(const c of this.coins){
      if(c.collected) continue;
      const cy = this.groundY - this.groundY*c.heightRatio;
      const dx = (c.x) - (p.x + 11*this.pixelSize);
      const dy = cy - (this.groundY + p.y - 9*this.pixelSize);
      if(Math.abs(dx) < 26 && Math.abs(dy) < 26){
        c.collected = true;
        this.coinsCollected++;
        AudioManager.coin();
        this._spawnBurst(p.x+20, cy, getComputedColor('--ink'), 6);
      }
    }
  }

  _rectsOverlap(a,b){
    return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
  }

  _onHit(){
    if(this.hasShield && !this.usedShield){
      this.usedShield = true;
      this.hasShield = false;
      this.shakeTime = 0.15;
      AudioManager.click();
      Utils.vibrate(20);
      // убираем ближайшее препятствие как "поглощённое" щитом — визуальный фидбек
      this._spawnBurst(this.player.x+20, this.groundY-20, getComputedColor('--ink'), 14);
      return;
    }
    this.player.state = 'dead';
    this.state = 'dead';
    this.shakeTime = 0.35;
    AudioManager.hit();
    Utils.vibrate([30,40,30]);
    AudioManager.stopMusic();
    this._spawnBurst(this.player.x+20, this.groundY-20, getComputedColor('--ink'), 16);
    if(this.onGameOver) this.onGameOver();
  }

  /* ---------------- ОТРИСОВКА ---------------- */

  _render(dt, countdownT){
    const ctx = this.ctx;
    const w = this.viewW, h = this.viewH;

    ctx.save();
    if(this.shakeTime > 0){
      this.shakeTime -= dt;
      const mag = 6 * (this.shakeTime>0?1:0);
      ctx.translate(Utils.rand(-mag,mag), Utils.rand(-mag,mag));
    }

    ctx.clearRect(-20,-20,w+40,h+40);
    const bg = getComputedColor('--bg');
    ctx.fillStyle = bg;
    ctx.fillRect(-20,-20,w+40,h+40);

    this._drawClouds();
    this._drawGround();
    this._drawPlatforms();
    this._drawCoins();
    this._drawObstacles();
    this._drawParticles();
    this._drawPlayer();

    ctx.restore();

    if(this.state === 'countdown'){
      this._drawCountdownNumber(countdownT);
    }
  }

  _drawClouds(){
    const ctx = this.ctx;
    const color = getComputedColor('--ink-soft');
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.55;
    for(const c of this.clouds){
      const s = c.scale * this.pixelSize * 0.6;
      // классическая пиксельная форма облака: три "ступени" блоков
      ctx.fillRect(c.x + 4*s, c.y, 10*s, 3*s);
      ctx.fillRect(c.x, c.y + 3*s, 18*s, 3*s);
      ctx.fillRect(c.x + 2*s, c.y - 2*s, 8*s, 3*s);
    }
    ctx.globalAlpha = 1;
  }

  _drawGround(){
    const ctx = this.ctx;
    const ink = getComputedColor('--ink');
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, this.groundY);
    ctx.lineTo(this.viewW, this.groundY);
    ctx.stroke();

    // текстура земли (пунктир, двигается)
    ctx.fillStyle = getComputedColor('--ink-soft');
    const step = 24;
    for(let x = this.groundOffset; x < this.viewW; x += step){
      ctx.fillRect(x, this.groundY+4, 10, 2);
    }
    // ямы вырезают землю визуально
    for(const o of this.obstacles){
      if(o.kind === 'pit'){
        ctx.fillStyle = getComputedColor('--bg');
        ctx.fillRect(o.x, this.groundY-2, o.w, 8);
        ctx.strokeStyle = ink;
        ctx.beginPath();
        ctx.moveTo(o.x, this.groundY);
        ctx.lineTo(o.x+8, this.groundY+10);
        ctx.lineTo(o.x+o.w-8, this.groundY+10);
        ctx.lineTo(o.x+o.w, this.groundY);
        ctx.stroke();
      }
    }
  }

  _drawPlatforms(){
    if(this.mode.id !== 'platformer') return;
    const ctx = this.ctx;
    const ink = getComputedColor('--ink');
    for(const pl of this.platforms){
      ctx.fillStyle = ink;
      ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
      // лёгкая штриховка сверху для объёма
      ctx.fillStyle = getComputedColor('--bg');
      for(let x = pl.x+4; x < pl.x+pl.w-4; x += 10){
        ctx.fillRect(x, pl.y+3, 4, 2);
      }
    }
  }

  _drawObstacles(){
    const ctx = this.ctx;
    const ink = getComputedColor('--ink');
    for(const o of this.obstacles){
      if(o.kind === 'ground'){
        drawSprite(ctx, o.matrix, o.x, this.groundY - o.h, this.pixelSize, ink);
      } else if(o.kind === 'air'){
        o.animT += 0.016;
        const frame = Math.floor(o.animT*6)%2===0 ? ObstacleSprites.birdUp : ObstacleSprites.birdDown;
        const y = this.groundY - o.flyOffset - o.h;
        drawSprite(ctx, frame, o.x, y, this.pixelSize, ink);
      }
    }
  }

  _drawCoins(){
    const ctx = this.ctx;
    const ink = getComputedColor('--ink');
    for(const c of this.coins){
      if(c.collected) continue;
      const y = this.groundY - this.groundY*c.heightRatio + Math.sin(c.bobT)*4;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, y, 8, 0, Math.PI*2);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.font = '9px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('c', c.x, y+3);
    }
  }

  _drawParticles(){
    const ctx = this.ctx;
    for(const p of this.particles){
      ctx.globalAlpha = Utils.clamp(p.life*2, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  _drawPlayer(){
    const ctx = this.ctx;
    const p = this.player;
    const ink = getComputedColor('--ink');
    const ps = this.pixelSize;

    let matrix;
    if(p.state === 'dead') matrix = Sprites.triceratops.dead;
    else if(p.state === 'jump') matrix = Sprites.triceratops.jump;
    else if(p.state === 'duck') matrix = Sprites.triceratops.duck;
    else matrix = Sprites.triceratops.run[p.runFrame];

    const dims = spriteDims(matrix, ps);
    const drawX = p.x;
    const drawY = this.groundY + p.y - dims.h;
    drawSprite(ctx, matrix, drawX, drawY, ps, ink);

    // индикатор щита
    if(this.hasShield && !this.usedShield){
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.5 + Math.sin(this.elapsed*6)*0.2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(drawX+dims.w/2, drawY+dims.h/2, Math.max(dims.w,dims.h)*0.68, 0, Math.PI*2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  _drawCountdownNumber(t){
    const el = document.getElementById('run-countdown');
    let text = '';
    if(t < 0.45) text = '3';
    else if(t < 0.9) text = '2';
    else if(t < 1.35) text = '1';
    if(text !== el.textContent){
      el.textContent = text;
      // перезапуск CSS-анимации на новой цифре
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }
    if(t >= 1.35) el.classList.remove('show');
  }
}

// получить вычисленный цвет CSS-переменной (для canvas-отрисовки в текущей теме)
let _colorCache = {};
let _colorCacheTheme = null;
function getComputedColor(varName){
  const theme = document.documentElement.getAttribute('data-theme') || 'classic';
  if(theme !== _colorCacheTheme){ _colorCache = {}; _colorCacheTheme = theme; }
  if(_colorCache[varName]) return _colorCache[varName];
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  _colorCache[varName] = val || '#1a1a1a';
  return _colorCache[varName];
}

/* ================================================================
   8. АНИМАЦИЯ ГЕРОЯ В ГЛАВНОМ МЕНЮ (idle)
   Лёгкое дыхание, покачивание головы и хвоста — рисуется поверх
   того же спрайта трицератопса с процедурными смещениями.
   ================================================================ */

class HeroIdleAnimator {
  constructor(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    this.running = false;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize(){
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
    this.viewW = rect.width; this.viewH = rect.height;
    this.pixelSize = Utils.clamp(this.viewH * 0.032, 4, 12);
  }

  start(){
    if(this.running) return;
    this.running = true;
    this._last = performance.now();
    this._loop(this._last);
  }
  stop(){ this.running = false; cancelAnimationFrame(this._raf); }

  _loop(now){
    if(!this.running) return;
    const dt = Math.min((now - this._last)/1000, 0.05);
    this._last = now;
    this.t += dt;
    this._render();
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  _render(){
    const ctx = this.ctx;
    const w = this.viewW, h = this.viewH;
    ctx.clearRect(0,0,w,h);

    const ink = getComputedColor('--ink');
    const inkSoft = getComputedColor('--ink-soft');

    // лёгкая земляная линия-подставка
    const groundY = h*0.82;
    ctx.strokeStyle = inkSoft;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w*0.1, groundY);
    ctx.lineTo(w*0.9, groundY);
    ctx.stroke();

    const breathe = Math.sin(this.t * 1.6) * 2.4; // вертикальное дыхание
    const sway = Math.sin(this.t * 0.9) * 3;       // покачивание всей фигуры

    const matrix = Sprites.triceratops.run[0];
    const dims = spriteDims(matrix, this.pixelSize);
    const x = w/2 - dims.w/2 + sway;
    const y = groundY - dims.h + breathe;

    ctx.save();
    ctx.translate(x + dims.w/2, y + dims.h*0.6);
    ctx.rotate(Math.sin(this.t*0.9)*0.01);
    ctx.translate(-(x + dims.w/2), -(y + dims.h*0.6));
    drawSprite(ctx, matrix, x, y, this.pixelSize, ink);
    ctx.restore();

    // мягкая тень
    ctx.fillStyle = inkSoft;
    ctx.globalAlpha = 0.25;
    const shadowW = dims.w*0.7 + Math.sin(this.t*1.6)*4;
    ctx.beginPath();
    ctx.ellipse(w/2+sway, groundY+6, shadowW/2, 5, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/* ================================================================
   9. UI CONTROLLER — экраны, привязки, витрина/апгрейды/режимы
   ================================================================ */

const UI = {
  engine: null,
  heroAnim: null,
  currentScreen: 'menu',
  runBestForMode: 0,

  init(){
    SaveManager.load();
    this._applyTheme();
    this._applySettingsToControls();
    this._bindGlobalControls();
    this._bindMenuButtons();
    this._bindBackButtons();
    this._buildShop();
    this._buildUpgrades();
    this._buildModes();
    this._buildThemeOptions();
    this._bindSettingsInputs();
    this._bindGameControls();
    this._updateHudStats();

    this.heroAnim = new HeroIdleAnimator(document.getElementById('hero-canvas'));
    this.heroAnim.start();

    this.engine = new GameEngine(document.getElementById('game-canvas'));
    this.engine.onGameOver = () => this._onGameOver();

    this._updateModeLabel();
  },

  /* ---------- Навигация по экранам ---------- */

  showScreen(id){
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    const el = document.getElementById('screen-' + id);
    el.classList.add('active-screen');
    this.currentScreen = id;

    if(id === 'menu'){
      this.heroAnim.start();
      this._updateHudStats();
    } else {
      this.heroAnim.stop();
    }
    AudioManager.click();
  },

  _bindBackButtons(){
    document.querySelectorAll('[data-back]').forEach(btn => {
      btn.addEventListener('click', () => this.showScreen('menu'));
    });
  },

  _bindMenuButtons(){
    document.getElementById('btn-play').addEventListener('click', () => this.startGame());
    document.getElementById('btn-shop').addEventListener('click', () => { this._buildShop(); this.showScreen('shop'); });
    document.getElementById('btn-upgrades').addEventListener('click', () => { this._buildUpgrades(); this.showScreen('upgrades'); });
    document.getElementById('btn-modes').addEventListener('click', () => this.showScreen('modes'));
    document.getElementById('btn-news').addEventListener('click', () => this.showScreen('news'));
    document.getElementById('btn-settings').addEventListener('click', () => this.showScreen('settings'));
    document.getElementById('btn-donate').addEventListener('click', () => {
      window.open('https://www.donationalerts.com/r/zelmirai', '_blank', 'noopener,noreferrer');
    });
  },

  _bindGlobalControls(){
    // разблокировка WebAudio по первому взаимодействию (требование браузеров)
    const unlock = () => { AudioManager.init(); document.removeEventListener('pointerdown', unlock); };
    document.addEventListener('pointerdown', unlock);
  },

  /* ---------- Тема ---------- */

  _applyTheme(){
    document.documentElement.setAttribute('data-theme', SaveManager.data.settings.theme);
  },

  _buildThemeOptions(){
    const wrap = document.getElementById('theme-options');
    const labels = { classic: 'Классика', invert: 'Инверт', sepia: 'Пустыня' };
    wrap.innerHTML = '';
    CONFIG.THEMES.forEach(themeId => {
      const opt = document.createElement('button');
      opt.className = 'theme-option' + (SaveManager.data.settings.theme === themeId ? ' active' : '');
      opt.innerHTML = `<div class="theme-swatch swatch-${themeId}"></div><span>${labels[themeId]}</span>`;
      opt.addEventListener('click', () => {
        SaveManager.data.settings.theme = themeId;
        SaveManager.save();
        this._applyTheme();
        _colorCache = {};
        this._buildThemeOptions();
        AudioManager.click();
      });
      wrap.appendChild(opt);
    });
  },

  /* ---------- HUD данные (монеты/рекорд) в меню ---------- */

  _updateHudStats(){
    document.getElementById('hud-coins').textContent = SaveManager.data.coins;
    const mode = SaveManager.data.selectedMode;
    document.getElementById('hud-best').textContent = Utils.formatScore(SaveManager.data.bestScore[mode] || 0);
    document.getElementById('shop-coins').textContent = SaveManager.data.coins;
    document.getElementById('upgrades-coins').textContent = SaveManager.data.coins;
  },

  _updateModeLabel(){
    const mode = CONFIG.MODES[SaveManager.data.selectedMode];
    document.getElementById('current-mode-label').textContent = mode.title;
  },

  /* ---------- Магазин персонажей ---------- */

  _buildShop(){
    const grid = document.getElementById('shop-grid');
    grid.innerHTML = '';
    CONFIG.CHARACTERS.forEach(char => {
      const owned = SaveManager.data.ownedCharacters.includes(char.id);
      const equipped = SaveManager.data.equippedCharacter === char.id;
      const implemented = char.id === 'triceratops';

      const card = document.createElement('div');
      card.className = 'shop-card' + (equipped ? ' equipped' : '') + (!implemented ? ' locked' : '');

      const canvas = document.createElement('canvas');
      canvas.width = 200; canvas.height = 120;
      card.appendChild(canvas);

      const name = document.createElement('div');
      name.className = 'shop-card-name';
      name.textContent = char.name;
      card.appendChild(name);

      const desc = document.createElement('div');
      desc.className = 'shop-card-desc';
      desc.textContent = char.desc;
      card.appendChild(desc);

      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary shop-card-btn';

      if(!implemented){
        btn.textContent = 'Скоро';
        btn.disabled = true;
      } else if(equipped){
        btn.textContent = 'Выбран';
        btn.disabled = true;
      } else if(owned){
        btn.textContent = 'Выбрать';
        btn.addEventListener('click', () => {
          SaveManager.data.equippedCharacter = char.id;
          SaveManager.save();
          AudioManager.buy();
          this._buildShop();
        });
      } else {
        btn.textContent = char.price === 0 ? 'Получить бесплатно' : `Купить · ${char.price}`;
        btn.addEventListener('click', () => {
          if(char.price > 0 && SaveManager.data.coins < char.price) return;
          SaveManager.data.coins -= char.price;
          SaveManager.data.ownedCharacters.push(char.id);
          SaveManager.data.equippedCharacter = char.id;
          SaveManager.save();
          AudioManager.buy();
          this._buildShop();
          this._updateHudStats();
        });
      }
      card.appendChild(btn);

      if(char.price === 0 && !owned){
        const badge = document.createElement('div');
        badge.className = 'shop-card-badge';
        badge.textContent = 'FREE';
        card.appendChild(badge);
      }

      grid.appendChild(card);

      // рисуем маленького персонажа (только для реализованного трицератопса — иначе силуэт-заглушка)
      const ctx = canvas.getContext('2d');
      if(implemented){
        const ps = 6;
        const m = Sprites.triceratops.run[0];
        const dims = spriteDims(m, ps);
        drawSprite(ctx, m, (canvas.width-dims.w)/2, (canvas.height-dims.h)/2, ps, getComputedColor('--ink'));
      } else {
        ctx.fillStyle = getComputedColor('--ink-soft');
        ctx.font = '11px Inter'; ctx.textAlign='center';
        ctx.fillText('В разработке', canvas.width/2, canvas.height/2);
        ctx.strokeStyle = getComputedColor('--line-soft');
        ctx.strokeRect(60,30,80,60);
      }
    });
  },

  /* ---------- Улучшения ---------- */

  _buildUpgrades(){
    const list = document.getElementById('upgrades-list');
    list.innerHTML = '';
    CONFIG.UPGRADES.forEach(up => {
      const level = SaveManager.upgradeLevel(up.id);
      const maxed = level >= up.maxLevel;
      const cost = Math.round(up.baseCost * Math.pow(up.costMult, level));

      const card = document.createElement('div');
      card.className = 'upgrade-card';

      card.innerHTML = `
        <div class="upgrade-icon">${up.icon}</div>
        <div class="upgrade-info">
          <div class="upgrade-name">${up.name}</div>
          <div class="upgrade-desc">${up.desc}</div>
          <div class="upgrade-levels">
            ${Array.from({length: up.maxLevel}).map((_,i)=>`<div class="upgrade-pip${i<level?' filled':''}"></div>`).join('')}
          </div>
        </div>
        <div class="upgrade-action">
          <div class="upgrade-cost">${maxed ? 'МАКС' : cost + ' монет'}</div>
          <button class="btn btn-secondary upgrade-buy-btn" ${maxed || SaveManager.data.coins < cost ? 'disabled' : ''}>
            ${maxed ? 'Готово' : 'Улучшить'}
          </button>
        </div>
      `;

      const btn = card.querySelector('.upgrade-buy-btn');
      if(!maxed){
        btn.addEventListener('click', () => {
          if(SaveManager.data.coins < cost) return;
          SaveManager.data.coins -= cost;
          SaveManager.data.upgrades[up.id] = level + 1;
          SaveManager.save();
          AudioManager.buy();
          this._buildUpgrades();
          this._updateHudStats();
        });
      }

      list.appendChild(card);
    });
  },

  /* ---------- Режимы игры ---------- */

  _buildModes(){
    const grid = document.getElementById('modes-grid');
    grid.innerHTML = '';
    Object.values(CONFIG.MODES).forEach(mode => {
      const card = document.createElement('div');
      card.className = 'mode-card' + (SaveManager.data.selectedMode === mode.id ? ' selected' : '');
      card.innerHTML = `
        <div class="mode-tag">${mode.tag}</div>
        <div class="mode-title">${mode.title}</div>
        <div class="mode-desc">${mode.desc}</div>
      `;
      card.addEventListener('click', () => {
        SaveManager.data.selectedMode = mode.id;
        SaveManager.save();
        this._buildModes();
        this._updateModeLabel();
        this._updateHudStats();
        AudioManager.click();
      });
      grid.appendChild(card);
    });
  },

  /* ---------- Настройки ---------- */

  _applySettingsToControls(){
    const s = SaveManager.data.settings;
    document.getElementById('toggle-music').setAttribute('aria-checked', s.music);
    document.getElementById('toggle-sfx').setAttribute('aria-checked', s.sfx);
    document.getElementById('range-volume').value = s.volume;
    document.getElementById('toggle-controls-hint').setAttribute('aria-checked', s.controlsHint);
    document.getElementById('select-jump-key').value = s.jumpKey;
    document.getElementById('toggle-haptics').setAttribute('aria-checked', s.haptics);
  },

  _bindSettingsInputs(){
    const toggle = (id, key) => {
      document.getElementById(id).addEventListener('click', (e) => {
        const el = e.currentTarget;
        const newVal = el.getAttribute('aria-checked') !== 'true';
        el.setAttribute('aria-checked', newVal);
        SaveManager.data.settings[key] = newVal;
        SaveManager.save();
        AudioManager.click();
        if(key === 'music' && !newVal) AudioManager.stopMusic();
      });
    };
    toggle('toggle-music', 'music');
    toggle('toggle-sfx', 'sfx');
    toggle('toggle-controls-hint', 'controlsHint');
    toggle('toggle-haptics', 'haptics');

    document.getElementById('range-volume').addEventListener('input', (e) => {
      SaveManager.data.settings.volume = parseInt(e.target.value, 10);
      SaveManager.save();
    });

    document.getElementById('select-jump-key').addEventListener('change', (e) => {
      SaveManager.data.settings.jumpKey = e.target.value;
      SaveManager.save();
    });

    document.getElementById('btn-reset-progress').addEventListener('click', () => {
      if(confirm('Сбросить весь прогресс? Это действие необратимо.')){
        SaveManager.reset();
        this._applyTheme();
        this._applySettingsToControls();
        this._buildShop();
        this._buildUpgrades();
        this._buildThemeOptions();
        this._updateHudStats();
      }
    });
  },

  /* ---------- Игровой процесс: запуск/пауза/game over ---------- */

  startGame(){
    this.showScreen('game');
    const modeId = SaveManager.data.selectedMode;
    this.engine.setMode(modeId);
    document.getElementById('hud-mode-banner').textContent = CONFIG.MODES[modeId].title.toUpperCase();
    document.getElementById('hud-run-best').textContent = Utils.formatScore(SaveManager.data.bestScore[modeId] || 0);
    document.getElementById('overlay-pause').classList.remove('show');
    document.getElementById('overlay-gameover').classList.remove('show');

    const touchControls = document.getElementById('touch-controls');
    touchControls.className = 'touch-controls ' + (modeId === 'platformer' ? 'mode-platformer' : 'mode-runner');

    const hint = document.getElementById('controls-hint');
    hint.style.display = SaveManager.data.settings.controlsHint ? 'block' : 'none';
    hint.textContent = modeId === 'platformer'
      ? '← → движение · Пробел/▲ — прыжок · ↓ — присесть'
      : 'Пробел / тап — прыжок · ↓ — присесть';

    this.engine.start();
    this._scoreLoop();
  },

  _scoreLoop(){
    cancelAnimationFrame(this._scoreRaf);
    const tick = () => {
      if(this.currentScreen !== 'game') return;
      document.getElementById('hud-current-score').textContent = Utils.formatScore(this.engine.score);
      this._scoreRaf = requestAnimationFrame(tick);
    };
    tick();
  },

  _onGameOver(){
    const modeId = SaveManager.data.selectedMode;
    const finalScore = Math.floor(this.engine.score);
    const prevBest = SaveManager.data.bestScore[modeId] || 0;
    const isNewRecord = finalScore > prevBest;
    if(isNewRecord) SaveManager.data.bestScore[modeId] = finalScore;

    const coinGainLvl = SaveManager.upgradeLevel('coinGain');
    const coinMult = 1 + coinGainLvl * 0.2;
    const earnedCoins = Math.round((this.engine.coinsCollected * 5 + Math.floor(finalScore/10)) * coinMult);
    SaveManager.data.coins += earnedCoins;
    SaveManager.save();

    setTimeout(() => {
      document.getElementById('gameover-score').textContent = finalScore;
      document.getElementById('gameover-best').textContent = SaveManager.data.bestScore[modeId];
      document.getElementById('gameover-coins').textContent = '+' + earnedCoins;
      document.getElementById('gameover-new-record').classList.toggle('show', isNewRecord);
      document.getElementById('overlay-gameover').classList.add('show');
    }, 550);
  },

  /* ---------- Управление (клавиатура + тач) ---------- */

  _bindGameControls(){
    // клавиатура
    window.addEventListener('keydown', (e) => {
      if(this.currentScreen !== 'game') return;
      const jumpKey = SaveManager.data.settings.jumpKey;
      if(e.code === jumpKey || e.code === 'Space' || e.code === 'ArrowUp'){
        e.preventDefault();
        this.engine.inputJump();
      }
      if(e.code === 'ArrowDown'){ e.preventDefault(); this.engine.inputDuckStart(); }
      if(e.code === 'ArrowLeft'){ this.engine.inputMoveX(-1); }
      if(e.code === 'ArrowRight'){ this.engine.inputMoveX(1); }
      if(e.code === 'Escape'){ this._togglePause(); }
    });
    window.addEventListener('keyup', (e) => {
      if(this.currentScreen !== 'game') return;
      if(e.code === 'ArrowDown'){ this.engine.inputDuckEnd(); }
      if(e.code === 'ArrowLeft' || e.code === 'ArrowRight'){ this.engine.inputMoveX(0); }
    });

    // тач/клик по канвасу — прыжок (для классики/хардкора)
    const canvas = document.getElementById('game-canvas');
    canvas.addEventListener('pointerdown', () => {
      if(this.engine.mode.id !== 'platformer'){ this.engine.inputJump(); }
    });

    // сенсорные кнопки
    const jumpBtn = document.getElementById('btn-touch-jump');
    jumpBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.engine.inputJump(); });

    const duckBtn = document.getElementById('btn-touch-duck');
    duckBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.engine.inputDuckStart(); });
    duckBtn.addEventListener('pointerup', () => this.engine.inputDuckEnd());
    duckBtn.addEventListener('pointerleave', () => this.engine.inputDuckEnd());

    const leftBtn = document.getElementById('btn-touch-left');
    leftBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.engine.inputMoveX(-1); });
    leftBtn.addEventListener('pointerup', () => this.engine.inputMoveX(0));
    leftBtn.addEventListener('pointerleave', () => this.engine.inputMoveX(0));

    const rightBtn = document.getElementById('btn-touch-right');
    rightBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.engine.inputMoveX(1); });
    rightBtn.addEventListener('pointerup', () => this.engine.inputMoveX(0));
    rightBtn.addEventListener('pointerleave', () => this.engine.inputMoveX(0));

    // пауза
    document.getElementById('btn-pause').addEventListener('click', () => this._togglePause());
    document.getElementById('btn-resume').addEventListener('click', () => this._togglePause());
    document.getElementById('btn-restart-from-pause').addEventListener('click', () => {
      document.getElementById('overlay-pause').classList.remove('show');
      this.engine.paused = false;
      this.startGame();
    });
    document.getElementById('btn-menu-from-pause').addEventListener('click', () => {
      document.getElementById('overlay-pause').classList.remove('show');
      this.engine.stop();
      this.showScreen('menu');
    });

    // game over
    document.getElementById('btn-restart').addEventListener('click', () => {
      document.getElementById('overlay-gameover').classList.remove('show');
      this.startGame();
    });
    document.getElementById('btn-gameover-menu').addEventListener('click', () => {
      document.getElementById('overlay-gameover').classList.remove('show');
      this.engine.stop();
      this.showScreen('menu');
      this._updateHudStats();
    });

    // скрытие подсказки управления через несколько секунд
    let hintTimer = null;
    const origStart = this.startGame.bind(this);
  },

  _togglePause(){
    if(this.engine.state !== 'playing' && this.engine.state !== 'countdown') return;
    const overlay = document.getElementById('overlay-pause');
    if(this.engine.paused){
      overlay.classList.remove('show');
      this.engine.resume();
    } else {
      this.engine.pause();
      overlay.classList.add('show');
    }
  }
};

/* ================================================================
   10. BOOT / ЗАПУСК ПРИЛОЖЕНИЯ
   ================================================================ */

function bootSequence(){
  const fill = document.getElementById('boot-bar-fill');
  const status = document.getElementById('boot-status');
  const bootScreen = document.getElementById('boot-screen');

  const steps = [
    { pct: 18, text: 'Загрузка ресурсов…' },
    { pct: 42, text: 'Подготовка спрайтов…' },
    { pct: 66, text: 'Инициализация звука…' },
    { pct: 86, text: 'Восстановление сохранений…' },
    { pct: 100, text: 'Готово' }
  ];

  let i = 0;
  const advance = () => {
    if(i >= steps.length){
      setTimeout(() => {
        bootScreen.classList.add('hidden');
        UI.init();
      }, 250);
      return;
    }
    const step = steps[i];
    fill.style.width = step.pct + '%';
    status.textContent = step.text;
    i++;
    setTimeout(advance, 260 + Math.random()*180);
  };
  advance();
}

document.addEventListener('DOMContentLoaded', bootSequence);

// Предохранитель: если вкладка свернута во время игры — ставим на паузу
document.addEventListener('visibilitychange', () => {
  if(document.hidden && UI.engine && UI.engine.running && !UI.engine.paused && UI.engine.state==='playing'){
    UI._togglePause();
  }
});
