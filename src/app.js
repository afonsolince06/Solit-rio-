/* Solitário da Avó — interface. O estado do jogo vive em `game`; o DOM é só desenho. */
(function () {
  'use strict';
  var K = window.Klondike;
  var STORE_KEY = 'solitario-da-avo:v1';
  var SOLVER_BUDGET = 30000;

  var reduceMotionOS = false;
  try { reduceMotionOS = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  var DEFAULTS = {
    drawCount: 1, newGameType: 'solucao', tapMode: 'auto', cardSize: 'grande', table: 'verde', back: 'azul',
    sound: false, anim: reduceMotionOS ? 'reduzidas' : 'normais', hand: 'direita', showScore: true, showTime: false
  };
  var ALLOWED = {
    drawCount: [1, 3], newGameType: ['solucao', 'acaso'], tapMode: ['auto', 'escolher'], cardSize: ['normal', 'grande', 'muito'],
    table: ['verde', 'azul', 'bordo'], back: ['azul', 'vermelho'], sound: [true, false], anim: ['normais', 'reduzidas'],
    hand: ['direita', 'esquerda'], showScore: [true, false], showTime: [true, false]
  };
  var STATS0 = { played: 0, won: 0, bestTime: null, bestScore: null, curStreak: 0, bestStreak: 0 };

  var settings = Object.assign({}, DEFAULTS);
  var stats = Object.assign({}, STATS0);
  var daily = { done: {} };
  var game = null; // { meta, board, history, elapsed, won }

  var ui = { selected: null, hint: null, busy: false, press: null, drag: null, dims: null, loc: {}, els: {}, slots: {}, toastTimer: 0, hintTimer: 0 };

  var boardEl = document.getElementById('board');
  var statusEl = document.getElementById('status');
  var toastEl = document.getElementById('toast');
  var overlayEl = document.getElementById('overlay');
  var sheetEl = document.getElementById('sheet');
  var busyEl = document.getElementById('busy');
  var winEl = document.getElementById('win');
  var autoBtn = document.getElementById('autoBtn');
  var toolbar = document.getElementById('toolbar');
  var root = document.documentElement;

  function dc() { return game.meta.drawCount; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); }
  function animMs(n) { return settings.anim === 'reduzidas' || (reduceMotionOS && settings.anim !== 'normais') ? 0 : n; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtTime(s) {
    if (s == null) return '—';
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  }
  function fmtDate(str) { var p = str.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  /* ================= Guardar e carregar ================= */

  function saveGame() {
    try {
      var data = {
        v: 1, settings: settings, stats: stats, daily: daily,
        game: game && { meta: game.meta, board: game.board, history: game.history.slice(-300), elapsed: game.elapsed, won: game.won }
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) { /* sem armazenamento: o jogo continua a funcionar */ }
  }

  function loadGame() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return { ok: false, empty: true }; }
    if (!raw) return { ok: false, empty: true };
    var data;
    try { data = JSON.parse(raw); } catch (e) { return { ok: false, corrupt: true }; }
    if (!data || typeof data !== 'object') return { ok: false, corrupt: true };
    // Definições: só valores conhecidos.
    if (data.settings) Object.keys(DEFAULTS).forEach(function (k) {
      if (ALLOWED[k].indexOf(data.settings[k]) >= 0) settings[k] = data.settings[k];
    });
    if (data.stats) Object.keys(STATS0).forEach(function (k) {
      var v = data.stats[k];
      if (v === null || (typeof v === 'number' && isFinite(v) && v >= 0)) stats[k] = v;
    });
    if (data.daily && data.daily.done && typeof data.daily.done === 'object') daily.done = data.daily.done;
    if (data.daily && data.daily.cache) daily.cache = data.daily.cache;
    var g = data.game;
    if (!g) return { ok: false, empty: true };
    var m = g.meta;
    if (!m || !K.validateDeck(m.deck) || [1, 3].indexOf(m.drawCount) < 0 || !K.validateBoard(g.board)) return { ok: false, corrupt: true };
    var hist = Array.isArray(g.history) ? g.history : [];
    var firstBad = -1;
    for (var i = hist.length - 1; i >= 0; i--) if (!K.validateBoard(hist[i])) { firstBad = i; break; }
    if (firstBad >= 0) hist = hist.slice(firstBad + 1); // guarda só a parte válida do histórico
    game = {
      meta: {
        id: String(m.id || K.randomId()), deck: m.deck, drawCount: m.drawCount, kind: ['random', 'solvable', 'daily'].indexOf(m.kind) >= 0 ? m.kind : 'random',
        solvable: !!m.solvable, date: m.date || null, counted: !!m.counted, winCounted: !!m.winCounted
      },
      board: g.board, history: hist, elapsed: typeof g.elapsed === 'number' && g.elapsed >= 0 ? Math.floor(g.elapsed) : 0,
      won: !!g.won && K.checkVictory(g.board)
    };
    return { ok: true };
  }

  /* ================= Som (sintetizado, sem ficheiros) ================= */

  var actx = null;
  function sound(kind) {
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var t = actx.currentTime;
      if (kind === 'win') {
        [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(f, t + i * 0.14, 0.35, 0.12); });
        return;
      }
      if (kind === 'reveal') { tone(740, t, 0.12, 0.06); }
      // pequeno "tac" de carta: ruído filtrado
      var len = 0.06, buf = actx.createBuffer(1, Math.floor(actx.sampleRate * len), actx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      var src = actx.createBufferSource(); src.buffer = buf;
      var bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = kind === 'flip' ? 2600 : 1700; bp.Q.value = 0.8;
      var g = actx.createGain(); g.gain.value = 0.35;
      src.connect(bp); bp.connect(g); g.connect(actx.destination); src.start(t);
    } catch (e) {}
  }
  function tone(f, t, dur, vol) {
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + 0.05);
  }

  /* ================= Desenho das cartas ================= */

  var FACE_ART = {
    13: '<path d="M10 21 12 9l5 6 3-9 3 9 5-6 2 12Z" fill="#e2ad1b" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><rect x="10" y="21" width="20" height="3" rx="1" fill="currentColor"/>',
    12: '<path d="M11 22c1-5 1-8 0-11 3 2 5 2 9-4 4 6 6 6 9 4-1 3-1 6 0 11Z" fill="#e2ad1b" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="20" cy="6" r="2" fill="currentColor"/><circle cx="11" cy="10" r="1.6" fill="currentColor"/><circle cx="29" cy="10" r="1.6" fill="currentColor"/>',
    11: '<path d="M9 21c2-7 6-10 13-10 4 0 7 2 9 6l-4 4Z" fill="#e2ad1b" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M24 11c3-5 7-6 10-5-3 1-5 3-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
  };
  function cardInner(c) {
    var r = K.rankOf(c), s = K.SUIT_SYMBOLS[K.suitOf(c)], lab = K.RANK_LABELS[r];
    var mid;
    if (r >= 11) {
      mid = '<svg viewBox="0 0 40 52" aria-hidden="true"><rect x="2" y="2" width="36" height="48" rx="4" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".55"/>' +
        FACE_ART[r] + '<text x="20" y="43" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="20" fill="currentColor">' + lab + '</text></svg>';
    } else {
      mid = '<span class="pip' + (r === 1 ? ' ace' : '') + '">' + s + '</span>';
    }
    return '<div class="face"><div class="idx"><span class="r' + (r === 10 ? ' ten' : '') + '">' + lab + '</span><span class="s">' + s + '</span></div>' +
      '<div class="mid">' + mid + '</div></div><div class="back"></div>';
  }
  function miniCard(c, w) {
    var h = Math.round(w * 1.4);
    return '<div class="card up mini' + (K.isRed(c) ? ' red' : '') + '" style="--cw:' + w + 'px;--ch:' + h + 'px;--cr:' + Math.round(w * .09) + 'px;--fi:' + Math.round(w * .36) + 'px;width:' + w + 'px;height:' + h + 'px" aria-label="' + esc(K.cardName(c)) + '">' + cardInner(c) + '</div>';
  }
  function miniStack(cards, w) {
    var h = Math.round(w * 1.4), off = Math.round(w * .5);
    var html = '<div style="position:relative;width:' + w + 'px;height:' + (h + off * (cards.length - 1)) + 'px">';
    cards.forEach(function (c, i) { html += '<div style="position:absolute;left:0;top:' + (i * off) + 'px">' + miniCard(c, w) + '</div>'; });
    return html + '</div>';
  }
  function miniBack(w) {
    var h = Math.round(w * 1.4);
    return '<div class="card mini" style="--cw:' + w + 'px;--ch:' + h + 'px;--cr:' + Math.round(w * .09) + 'px;width:' + w + 'px;height:' + h + 'px"><div class="back"></div></div>';
  }

  function buildBoard() {
    boardEl.innerHTML = '';
    var mk = function (cls, key, html) {
      var d = document.createElement('div'); d.className = 'slot ' + cls; d.dataset.slot = key; if (html) d.innerHTML = html;
      boardEl.appendChild(d); ui.slots[key] = d;
    };
    mk('stock', 'stock');
    mk('waste', 'waste');
    for (var i = 0; i < 4; i++) mk('found', 'f' + i, 'A');
    for (i = 0; i < 7; i++) mk('tab', 't' + i, 'K');
    for (var c = 0; c < 52; c++) {
      var el = document.createElement('div');
      el.className = 'card' + (K.isRed(c) ? ' red' : '');
      el.dataset.c = c;
      el.innerHTML = cardInner(c);
      boardEl.appendChild(el);
      ui.els[c] = el;
    }
  }

  /* ================= Medidas ================= */

  function computeDims() {
    var W = boardEl.clientWidth, H = boardEl.clientHeight;
    var gap = Math.max(3, Math.min(12, Math.round(W * 0.012)));
    var maxW = { normal: 92, grande: 104, muito: 118 }[settings.cardSize];
    var cw = Math.floor((W - gap * 8) / 7);
    cw = Math.max(28, Math.min(cw, maxW, Math.floor(H / 7.0)));
    var ch = Math.round(cw * 1.4);
    var fi = Math.max(12, Math.round(cw * { normal: .32, grande: .38, muito: .44 }[settings.cardSize]));
    var fu = Math.round(fi * 1.22 + cw * 0.05);
    var fd = Math.max(6, Math.round(ch * 0.12));
    var used = cw * 7 + gap * 6;
    var x0 = Math.round((W - used) / 2);
    var colX = []; for (var i = 0; i < 7; i++) colX.push(x0 + i * (cw + gap));
    var topY = Math.max(4, gap);
    var tabY = topY + ch + Math.round(gap * 2.2) + 4;
    // Destra: monte à direita (mais perto do polegar). Canhota: monte à esquerda.
    var left = settings.hand === 'direita';
    var d = {
      W: W, H: H, gap: gap, cw: cw, ch: ch, fi: fi, fu: fu, fd: fd, colX: colX, topY: topY, tabY: tabY,
      stockX: left ? colX[6] : colX[0], wasteX: left ? colX[5] : colX[1], fanDir: left ? -1 : 1, fanOff: Math.round(cw * 0.4),
      fX: left ? [colX[0], colX[1], colX[2], colX[3]] : [colX[3], colX[4], colX[5], colX[6]]
    };
    boardEl.style.setProperty('--cw', cw + 'px');
    boardEl.style.setProperty('--ch', ch + 'px');
    boardEl.style.setProperty('--cr', Math.max(4, Math.round(cw * 0.09)) + 'px');
    boardEl.style.setProperty('--fi', fi + 'px');
    return d;
  }

  function columnOffsets(col, d) {
    var n = col.cards.length, down = col.down, up = n - down;
    var fd = d.fd, fu = d.fu, ch = d.ch;
    var avail = d.H - d.tabY - 6;
    var need = down * fd + Math.max(0, up - 1) * fu + ch;
    if (need > avail && up > 1) {
      var minFu = Math.max(14, d.fi * 1.02);
      fu = Math.max(minFu, (avail - ch - down * fd) / (up - 1));
      need = down * fd + (up - 1) * fu + ch;
      if (need > avail && down > 0) fd = Math.max(3, (avail - ch - (up - 1) * fu) / down);
      need = down * fd + (up - 1) * fu + ch;
      if (need > avail) fu = Math.max(8, (avail - ch - down * fd) / (up - 1));
    } else if (need > avail && down > 0) {
      fd = Math.max(3, (avail - ch) / down);
    }
    var ys = [], y = d.tabY;
    for (var i = 0; i < n; i++) { ys.push(Math.round(y)); y += i < down ? fd : fu; }
    return ys;
  }

  /* ================= Render ================= */

  function setPos(el, x, y) { el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)'; }

  function render(opts) {
    opts = opts || {};
    var d = ui.dims, b = game.board;
    var pos = {}, loc = {};
    b.stock.forEach(function (c, i) { pos[c] = { x: d.stockX, y: d.topY, z: 10 + i, up: false }; loc[c] = { pile: 'stock', pos: i }; });
    var wl = b.waste.length;
    var fan = dc() === 3 ? Math.min(wl, Math.max(1, b.wasteFan)) : Math.min(wl, 1);
    b.waste.forEach(function (c, i) {
      var k = i - (wl - fan);
      pos[c] = { x: d.wasteX + (k > 0 ? k * d.fanOff * d.fanDir : 0), y: d.topY, z: 10 + i, up: true };
      loc[c] = { pile: 'waste', pos: i, top: i === wl - 1 };
    });
    b.foundations.forEach(function (f, fi) {
      f.forEach(function (c, i) { pos[c] = { x: d.fX[fi], y: d.topY, z: 10 + i, up: true }; loc[c] = { pile: 'foundation', index: fi, pos: i, top: i === f.length - 1 }; });
    });
    b.tableau.forEach(function (col, ti) {
      var ys = columnOffsets(col, d);
      col.cards.forEach(function (c, i) { pos[c] = { x: d.colX[ti], y: ys[i], z: 10 + i, up: i >= col.down }; loc[c] = { pile: 'tableau', index: ti, pos: i }; });
    });
    ui.loc = loc;

    // ranhuras
    setPos(ui.slots.stock, d.stockX, d.topY);
    setPos(ui.slots.waste, d.wasteX, d.topY);
    for (var i = 0; i < 4; i++) setPos(ui.slots['f' + i], d.fX[i], d.topY);
    for (i = 0; i < 7; i++) setPos(ui.slots['t' + i], d.colX[i], d.tabY);
    ui.slots.stock.innerHTML = !b.stock.length && b.waste.length
      ? '<svg class="recycle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-label="Voltar a usar as cartas"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>' : '';

    var dealing = opts.deal && animMs(1);
    for (var c = 0; c < 52; c++) {
      var p = pos[c], el = ui.els[c];
      if (!p) continue; // nunca deve acontecer (52 cartas garantidas)
      var key = p.x + ',' + p.y;
      var moved = el._key !== undefined && el._key !== key;
      el._key = key;
      if (dealing) {
        el.style.transitionDelay = (loc[c].pile === 'tableau' ? (loc[c].pos * 7 + loc[c].index) * 28 : 0) + 'ms';
      } else el.style.transitionDelay = '';
      el.style.zIndex = moved && !dealing ? 300 + p.z : p.z;
      if (moved && !dealing) {
        (function (el, z) { clearTimeout(el._zt); el._zt = setTimeout(function () { el.style.zIndex = z; }, animMs(260) + 20); })(el, p.z);
      }
      setPos(el, p.x, p.y);
      el.classList.toggle('up', p.up);
      el.setAttribute('aria-label', p.up ? K.cardName(c) : 'Carta virada para baixo');
    }
    renderMarks();
    updateStatus();
  }

  function renderMarks() {
    for (var c = 0; c < 52; c++) ui.els[c].classList.remove('sel', 'hint', 'ok', 'hintdst');
    Object.keys(ui.slots).forEach(function (k) { ui.slots[k].classList.remove('ok', 'hintdst'); });
    if (ui.selected) {
      ui.selected.cards.forEach(function (c) { ui.els[c].classList.add('sel'); });
      ui.selected.targets.forEach(function (t) { targetEl(t).classList.add('ok'); });
    }
    if (ui.hint) {
      ui.hint.src.forEach(function (el) { el.classList.add('hint'); });
      if (ui.hint.dst) ui.hint.dst.classList.add('hintdst');
    }
  }

  // Elemento a destacar para um destino (carta de cima ou ranhura vazia).
  function targetEl(t) {
    var b = game.board, pile = t.pile === 'tableau' ? b.tableau[t.index].cards : b.foundations[t.index];
    if (pile.length) return ui.els[pile[pile.length - 1]];
    return ui.slots[(t.pile === 'tableau' ? 't' : 'f') + t.index];
  }

  function updateStatus() {
    var html = '';
    if (game.meta.kind === 'daily') html += '<span class="pill gold">Desafio do dia</span>';
    else if (game.meta.solvable) html += '<span class="pill gold">Com solução</span>';
    if (settings.showScore) html += '<span class="pill">Pontos ' + game.board.score + '</span>';
    if (settings.showTime) html += '<span class="pill" id="clock">' + fmtTime(game.elapsed) + '</span>';
    statusEl.innerHTML = html;
    toolbar.querySelector('[data-act="undo"]').disabled = !game.history.length || game.won;
    autoBtn.hidden = !(K.canAutoComplete(game.board, dc()) && !game.won && !ui.busy);
  }

  function relayout() {
    if (!game) { ui.dims = computeDims(); return; }
    root.classList.add('no-anim');
    ui.dims = computeDims();
    render();
    void boardEl.offsetHeight;
    requestAnimationFrame(function () { root.classList.remove('no-anim'); });
  }

  /* ================= Mensagens ================= */

  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () { toastEl.hidden = true; }, ms || 3200);
  }
  function hideToast() { clearTimeout(ui.toastTimer); toastEl.hidden = true; }
  function shake(cards) {
    cards.forEach(function (c) {
      var el = ui.els[c]; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
      setTimeout(function () { el.classList.remove('shake'); }, 420);
    });
  }
  function clearHint() { if (ui.hint) { ui.hint = null; clearTimeout(ui.hintTimer); renderMarks(); } }

  /* ================= Jogadas ================= */

  function perform(action, opts) {
    if (game.won) return false;
    var b = game.board, res;
    if (action.type === 'stock') {
      var nb = K.applyAction(b, action, dc(), opts);
      res = nb ? { board: nb, revealed: false } : null;
    } else res = K.moveCards(b, action);
    if (!res) return false;
    game.history.push(b);
    if (game.history.length > 2000) game.history.shift();
    game.board = res.board;
    ui.selected = null; ui.hint = null;
    if (!game.meta.counted) { game.meta.counted = true; stats.played += 1; }
    sound(res.revealed ? 'reveal' : action.type === 'stock' ? 'flip' : 'move');
    var won = K.checkVictory(game.board);
    if (won) onWin();
    render();
    saveGame();
    return true;
  }

  function onWin() {
    game.won = true;
    var m = game.meta;
    if (!m.winCounted) {
      m.winCounted = true;
      stats.won += 1;
      stats.curStreak += 1;
      stats.bestStreak = Math.max(stats.bestStreak, stats.curStreak);
      if (stats.bestTime == null || game.elapsed < stats.bestTime) stats.bestTime = game.elapsed;
      if (stats.bestScore == null || game.board.score > stats.bestScore) stats.bestScore = game.board.score;
    }
    if (m.kind === 'daily' && m.date && !daily.done[m.date]) daily.done[m.date] = { time: game.elapsed, score: game.board.score };
    hideToast();
    setTimeout(function () { sound('win'); showWin(); }, animMs(500) + 150);
  }

  function fromOf(loc) {
    if (loc.pile === 'tableau') return { from: { pile: 'tableau', index: loc.index }, start: loc.pos };
    if (loc.pile === 'waste') return { from: { pile: 'waste', index: 0 }, start: null };
    if (loc.pile === 'foundation') return { from: { pile: 'foundation', index: loc.index }, start: null };
    return null;
  }

  function legalTargets(from, start) {
    var out = [], b = game.board;
    for (var i = 0; i < 4; i++) {
      var m = { type: 'move', from: from, start: start, to: { pile: 'foundation', index: i } };
      if (K.validateMove(b, m)) out.push(m.to);
    }
    for (i = 0; i < 7; i++) {
      var t = { type: 'move', from: from, start: start, to: { pile: 'tableau', index: i } };
      if (K.validateMove(b, t)) out.push(t.to);
    }
    return out;
  }

  function tapStock() {
    var b = game.board;
    if (!b.stock.length && !b.waste.length) { toast('O monte está vazio.'); return; }
    perform({ type: 'stock' });
  }

  // Interpreta o sítio tocado/arrastado.
  function hitTarget(e) {
    var cardEl = e.target.closest && e.target.closest('.card');
    if (cardEl && boardEl.contains(cardEl)) {
      var c = +cardEl.dataset.c, loc = ui.loc[c];
      return { kind: 'card', c: c, loc: loc };
    }
    var slotEl = e.target.closest && e.target.closest('.slot');
    if (slotEl) {
      var k = slotEl.dataset.slot;
      if (k === 'stock') return { kind: 'stock' };
      if (k === 'waste') return { kind: 'waste' };
      if (k[0] === 'f') return { kind: 'pile', pile: 'foundation', index: +k.slice(1) };
      return { kind: 'pile', pile: 'tableau', index: +k.slice(1) };
    }
    // espaço vazio por baixo de uma coluna
    var r = boardEl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, d = ui.dims;
    if (y > d.tabY - d.gap) {
      for (var i = 0; i < 7; i++) if (x >= d.colX[i] - d.gap / 2 && x <= d.colX[i] + d.cw + d.gap / 2) return { kind: 'pile', pile: 'tableau', index: i };
    }
    return { kind: 'none' };
  }

  function destOf(t) {
    if (t.kind === 'pile') return { pile: t.pile, index: t.index };
    if (t.kind === 'card' && t.loc) {
      if (t.loc.pile === 'tableau') return { pile: 'tableau', index: t.loc.index };
      if (t.loc.pile === 'foundation') return { pile: 'foundation', index: t.loc.index };
    }
    return null;
  }

  function handleTap(t) {
    hideToast();
    clearHint();
    if (t.kind === 'stock' || (t.kind === 'card' && t.loc.pile === 'stock')) { ui.selected = null; tapStock(); return; }
    if (t.kind === 'waste') { if (!game.board.waste.length) return; t = { kind: 'card', c: game.board.waste[game.board.waste.length - 1], loc: ui.loc[game.board.waste[game.board.waste.length - 1]] }; }

    // Modo "escolho o destino": segundo toque escolhe o destino.
    if (ui.selected) {
      var dest = destOf(t);
      var sel = ui.selected;
      if (t.kind === 'card' && sel.cards.indexOf(t.c) >= 0) {
        // tocar outra vez na carta escolhida = jogada automática
        var auto = K.bestMoveFrom(game.board, sel.from, sel.start);
        ui.selected = null;
        if (!auto || !perform(auto)) { renderMarks(); shake(sel.cards); }
        return;
      }
      if (dest) {
        var mv = { type: 'move', from: sel.from, start: sel.start, to: dest };
        if (K.validateMove(game.board, mv)) { perform(mv); return; }
      }
      ui.selected = null; renderMarks();
      if (t.kind !== 'card') return;
    }

    if (t.kind !== 'card') return;
    var loc = t.loc;
    if (loc.pile === 'waste') loc = ui.loc[game.board.waste[game.board.waste.length - 1]];
    if (loc.pile === 'foundation' && !loc.top) return;
    if (loc.pile === 'tableau' && loc.pos < game.board.tableau[loc.index].down) {
      // carta virada para baixo: não faz nada (no modo escolher, conta como destino já tratado acima)
      return;
    }
    var f = fromOf(loc);
    var cards = K.getMovingCards(game.board, f.from, f.start);
    if (!cards) return;

    if (settings.tapMode === 'auto') {
      var best = K.bestMoveFrom(game.board, f.from, f.start);
      if (best) perform(best);
      else { shake(cards); toast('Esta carta não pode ir para lado nenhum agora.', 2200); }
      return;
    }
    var targets = legalTargets(f.from, f.start);
    if (!targets.length) { shake(cards); toast('Esta carta não pode ir para lado nenhum agora.', 2200); return; }
    ui.selected = { from: f.from, start: f.start, cards: cards, targets: targets };
    renderMarks();
  }

  /* ================= Arrastar ================= */

  function onDown(e) {
    if (ui.busy || !game || game.won || e.button > 0) return;
    if (ui.press) {
      // um toque anterior ficou sem fim (dedo perdido): cancela-o em segurança
      if (ui.press.drag) ui.press.drag.base.forEach(function (o) { ui.els[o.c].classList.remove('dragging'); });
      ui.press = null; render();
    }
    var t = hitTarget(e);
    ui.press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: t, drag: null };
    if (t.kind === 'card' && t.loc) {
      var loc = t.loc, ok = false;
      if (loc.pile === 'tableau') ok = loc.pos >= game.board.tableau[loc.index].down;
      else if (loc.pile === 'waste' || loc.pile === 'foundation') ok = loc.top;
      if (ok) {
        var f = fromOf(loc), cards = K.getMovingCards(game.board, f.from, f.start);
        if (cards) ui.press.cand = { from: f.from, start: f.start, cards: cards };
      }
    }
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function onMove(e) {
    var p = ui.press;
    if (!p || p.id !== e.pointerId) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.drag) {
      if (!p.cand || Math.hypot(dx, dy) < 9) return;
      hideToast(); clearHint(); ui.selected = null; renderMarks();
      p.drag = { base: p.cand.cards.map(function (c) { var el = ui.els[c]; var m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform); return { c: c, x: +m[1], y: +m[2] }; }) };
      p.drag.base.forEach(function (o, i) { var el = ui.els[o.c]; el.classList.add('dragging'); el.style.zIndex = 900 + i; el.style.transitionDelay = ''; });
    }
    e.preventDefault();
    p.drag.base.forEach(function (o) { setPos(ui.els[o.c], o.x + dx, o.y + dy); });
    // destaca o destino válido debaixo do dedo
    var tgt = dropTarget(p, dx, dy);
    Object.keys(ui.slots).forEach(function (k) { ui.slots[k].classList.remove('ok'); });
    for (var c = 0; c < 52; c++) if (p.cand.cards.indexOf(c) < 0) ui.els[c].classList.remove('ok');
    if (tgt) targetEl(tgt).classList.add('ok');
  }

  function dropTarget(p, dx, dy) {
    var d = ui.dims, lead = p.drag.base[0];
    var rx = lead.x + dx, ry = lead.y + dy, rw = d.cw, rh = d.ch;
    var best = null, bestArea = 0;
    var cands = [];
    for (var i = 0; i < 4; i++) cands.push({ to: { pile: 'foundation', index: i }, x: d.fX[i] - d.gap, y: d.topY - d.gap, w: d.cw + 2 * d.gap, h: d.ch + 2 * d.gap });
    for (i = 0; i < 7; i++) cands.push({ to: { pile: 'tableau', index: i }, x: d.colX[i] - d.gap / 2, y: d.tabY - d.gap * 2, w: d.cw + d.gap, h: d.H - d.tabY + d.gap * 2 });
    cands.forEach(function (c) {
      var ox = Math.max(0, Math.min(rx + rw, c.x + c.w) - Math.max(rx, c.x));
      var oy = Math.max(0, Math.min(ry + rh, c.y + c.h) - Math.max(ry, c.y));
      var area = ox * oy;
      if (area <= bestArea) return;
      var mv = { type: 'move', from: p.cand.from, start: p.cand.start, to: c.to };
      if (K.validateMove(game.board, mv)) { best = c.to; bestArea = area; }
    });
    return best;
  }

  function onUp(e) {
    var p = ui.press;
    if (!p || p.id !== e.pointerId) return;
    ui.press = null;
    try { boardEl.releasePointerCapture(e.pointerId); } catch (err) {}
    if (p.drag) {
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      var tgt = e.type === 'pointercancel' ? null : dropTarget(p, dx, dy);
      p.drag.base.forEach(function (o) { ui.els[o.c].classList.remove('dragging'); });
      var done = tgt && perform({ type: 'move', from: p.cand.from, start: p.cand.start, to: tgt });
      if (!done) { render(); } // volta ao sítio
      return;
    }
    if (e.type === 'pointercancel') return;
    handleTap(p.t);
  }

  /* ================= Botões ================= */

  function undo() {
    if (ui.busy || game.won) return;
    hideToast(); clearHint(); ui.selected = null;
    if (!game.history.length) { toast('Não há jogadas para anular.'); return; }
    game.board = game.history.pop();
    sound('move');
    render(); saveGame();
  }

  function hint() {
    if (ui.busy || game.won) return;
    ui.selected = null;
    clearHint();
    var b = game.board, move = null, reason = null;
    try { move = K.solverHint(b, dc(), 12000); } catch (e) { move = null; }
    if (move) reason = move.type === 'stock' ? (b.stock.length ? 'draw' : 'recycle') : 'move';
    else { var h = K.getHint(b, dc()); move = h.move; reason = h.reason; }
    if (!move) { renderMarks(); toast('Não encontro jogadas que ajudem. Pode tocar em «Anular» ou começar um jogo novo.', 5000); return; }
    var src = [], dst = null, msg;
    if (move.type === 'stock') {
      src = b.stock.length ? [ui.els[b.stock[b.stock.length - 1]]] : [];
      dst = b.stock.length ? null : ui.slots.stock;
      msg = reason === 'draw' ? 'Toque no monte para virar ' + (dc() === 3 ? 'mais cartas.' : 'uma carta.') : 'Toque no monte para voltar a usar as cartas.';
    } else {
      var m = K.resolveMove(b, move), cards = K.getMovingCards(b, m.from, m.start);
      src = cards.map(function (c) { return ui.els[c]; });
      dst = targetEl(m.to);
      var art = function (c) { return K.rankOf(c) === 12 ? 'a ' : 'o '; };
      var name = art(cards[0]) + K.cardName(cards[0]);
      if (m.to.pile === 'foundation') msg = 'Leve ' + name + ' para cima.';
      else {
        var tc = b.tableau[m.to.index].cards;
        msg = tc.length ? 'Ponha ' + name + ' em cima d' + art(tc[tc.length - 1]) + K.cardName(tc[tc.length - 1]) + '.' : 'Ponha ' + name + ' na coluna vazia.';
      }
      msg = msg.charAt(0).toUpperCase() + msg.slice(1);
    }
    ui.hint = { src: src, dst: dst };
    renderMarks();
    toast(msg, 4500);
    clearTimeout(ui.hintTimer);
    ui.hintTimer = setTimeout(clearHint, 4500);
  }

  async function runAutoComplete() {
    if (ui.busy || !K.canAutoComplete(game.board, dc())) return;
    ui.busy = true; autoBtn.hidden = true; closeSheet(); hideToast(); clearHint();
    var guard = 0;
    while (!game.won && guard++ < 1000) {
      var step = K.autoCompleteStep(game.board, dc());
      if (!step || !perform(step, { noPenalty: true })) break;
      await wait(animMs(170) || 25);
    }
    ui.busy = false;
    updateStatus();
  }

  /* ================= Jogos novos ================= */

  function showBusy(text) { document.getElementById('busyText').textContent = text; busyEl.hidden = false; }
  function hideBusy() { busyEl.hidden = true; }

  async function makeDeal(type, drawCount) {
    var prev = game && game.meta.deck.join(',');
    function fresh() { var d; do { d = K.shuffleDeck(K.createDeck()); } while (d.join(',') === prev); return d; }
    if (type === 'acaso') return { deck: fresh(), solvable: false, kind: 'random' };
    showBusy('A baralhar as cartas…');
    await nextFrame();
    var t0 = Date.now();
    try {
      for (var i = 0; i < 60 && Date.now() - t0 < 7000; i++) {
        var deck = fresh(), b = K.dealCards(deck);
        var r = K.solve(b, drawCount, { budget: SOLVER_BUDGET });
        if (r.solved && K.verifySolution(b, drawCount, r.moves)) return { deck: deck, solvable: true, kind: 'solvable' };
        if (i % 2 === 1) await nextFrame();
      }
    } finally { hideBusy(); }
    return { deck: fresh(), solvable: false, kind: 'random' };
  }

  function abandonCurrent() {
    // Um jogo começado e não ganho conta como perdido para a sequência de vitórias.
    if (game && game.meta.counted && !game.won) stats.curStreak = 0;
  }

  function startGame(deal, drawCount, extra) {
    abandonCurrent();
    game = {
      meta: Object.assign({ id: K.randomId(), deck: deal.deck, drawCount: drawCount, kind: deal.kind, solvable: deal.solvable, date: null, counted: false, winCounted: false }, extra || {}),
      board: K.dealCards(deal.deck), history: [], elapsed: 0, won: false
    };
    ui.selected = null; ui.hint = null;
    winEl.hidden = true;
    dealAnimation();
    saveGame();
    if (!deal.solvable && deal.kind !== 'random') toast('Jogo pronto.');
  }

  function dealAnimation() {
    var d = ui.dims;
    root.classList.add('no-anim');
    for (var c = 0; c < 52; c++) { var el = ui.els[c]; el.classList.remove('up'); setPos(el, d.stockX, d.topY); el._key = undefined; el.style.zIndex = 10; }
    void boardEl.offsetHeight;
    root.classList.remove('no-anim');
    render({ deal: true });
    setTimeout(function () { for (var c = 0; c < 52; c++) ui.els[c].style.transitionDelay = ''; }, 1500);
  }

  async function newGame(skipConfirm) {
    if (ui.busy) return;
    closeSheet();
    if (!skipConfirm && game && game.board.moves > 0 && !game.won) {
      var ok = await confirmBox('Começar um jogo novo?', 'O jogo que está a jogar fica sem terminar.', 'Sim, jogo novo', 'Não');
      if (!ok) return;
    }
    ui.busy = true;
    try {
      var drawCount = settings.drawCount;
      var deal = await makeDeal(settings.newGameType, drawCount);
      startGame(deal, drawCount);
      if (settings.newGameType === 'solucao' && !deal.solvable) toast('Desta vez não consegui confirmar a solução. Este jogo é ao acaso.', 4500);
    } finally { ui.busy = false; updateStatus(); }
  }

  async function restartGame() {
    if (ui.busy) return;
    closeSheet();
    var ok = await confirmBox('Recomeçar este jogo?', 'As cartas voltam exatamente à posição do início.', 'Sim, recomeçar', 'Não');
    if (!ok) return;
    game.board = K.dealCards(game.meta.deck);
    game.history = []; game.won = false; game.elapsed = 0;
    winEl.hidden = true;
    ui.selected = null; ui.hint = null;
    dealAnimation(); saveGame();
  }

  async function startDaily() {
    if (ui.busy) return;
    var date = todayStr();
    if (game && game.meta.kind === 'daily' && game.meta.date === date && !game.won) { closeSheet(); return; }
    closeSheet();
    if (game && game.board.moves > 0 && !game.won) {
      var ok = await confirmBox('Jogar o desafio de hoje?', 'O jogo que está a jogar fica sem terminar.', 'Sim, jogar', 'Não');
      if (!ok) return;
    }
    ui.busy = true;
    try {
      var deal;
      if (daily.cache && daily.cache.date === date && K.validateDeck(daily.cache.deck)) deal = daily.cache;
      else {
        showBusy('A preparar o desafio de hoje…');
        await nextFrame();
        try { var r = K.dailyDeal(date, 60000); deal = { date: date, deck: r.deck, solvable: r.solvable }; }
        finally { hideBusy(); }
        daily.cache = deal;
      }
      startGame({ deck: deal.deck.slice(), solvable: deal.solvable, kind: 'daily' }, 1, { date: date });
    } finally { ui.busy = false; updateStatus(); }
  }

  /* ================= Painéis ================= */

  var sheetOnClose = null;
  function openSheet(html, onClose) {
    sheetEl.innerHTML = html;
    overlayEl.hidden = false;
    sheetEl.scrollTop = 0;
    sheetOnClose = onClose || null;
    var f = sheetEl.querySelector('[data-focus]') || sheetEl.querySelector('button');
    if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
  }
  function closeSheet() {
    if (overlayEl.hidden) return;
    overlayEl.hidden = true; sheetEl.innerHTML = '';
    var cb = sheetOnClose; sheetOnClose = null;
    if (cb) cb();
  }
  function head(title) { return '<div class="head"><h2>' + title + '</h2><button class="x-btn" type="button" data-close>Fechar</button></div>'; }

  function confirmBox(title, text, yes, no) {
    return new Promise(function (resolve) {
      var done = false;
      openSheet('<h2>' + esc(title) + '</h2><p>' + esc(text) + '</p><div class="btn-row"><button class="big-btn" type="button" data-yes>' + esc(yes || 'Sim') + '</button><button class="big-btn light" type="button" data-no data-focus style="justify-content:center">' + esc(no || 'Não') + '</button></div>',
        function () { if (!done) { done = true; resolve(false); } });
      sheetEl.querySelector('[data-yes]').onclick = function () { done = true; closeSheet(); resolve(true); };
      sheetEl.querySelector('[data-no]').onclick = function () { closeSheet(); };
    });
  }

  function openMenu() {
    if (ui.busy) return;
    var canAuto = K.canAutoComplete(game.board, dc()) && !game.won;
    var info = (game.meta.kind === 'daily' ? 'Desafio do dia ' + fmtDate(game.meta.date) : 'Jogo n.º ' + game.meta.id) +
      ' · ' + (game.meta.solvable ? 'com solução garantida' : 'ao acaso') + ' · virar ' + dc() + (dc() === 1 ? ' carta' : ' cartas');
    openSheet(head('Menu') +
      '<p class="note">' + esc(info) + '</p>' +
      '<div class="stack">' +
      '<button class="big-btn light" type="button" data-a="restart"><span class="ic">↺</span>Recomeçar este jogo</button>' +
      '<button class="big-btn light" type="button" data-a="auto"' + (canAuto ? '' : ' disabled') + '><span class="ic">✓</span>Concluir automaticamente</button>' +
      (canAuto ? '' : '<p class="note">Fica disponível quando todas as cartas da mesa estiverem viradas para cima' + (dc() === 3 ? ' e o monte estiver vazio' : '') + '.</p>') +
      '<button class="big-btn light" type="button" data-a="daily"><span class="ic">📅</span>Desafio do dia</button>' +
      '<button class="big-btn light" type="button" data-a="stats"><span class="ic">🏆</span>Estatísticas</button>' +
      '<button class="big-btn light" type="button" data-a="settings"><span class="ic">⚙︎</span>Definições</button>' +
      '<button class="big-btn light" type="button" data-a="help"><span class="ic">?</span>Como jogar</button>' +
      '</div>');
    sheetEl.querySelectorAll('[data-a]').forEach(function (btn) {
      btn.onclick = function () {
        var a = btn.dataset.a;
        if (a === 'restart') restartGame();
        else if (a === 'auto') runAutoComplete();
        else if (a === 'daily') openDaily();
        else if (a === 'stats') openStats();
        else if (a === 'settings') openSettings();
        else if (a === 'help') openHelp();
      };
    });
  }

  function seg(key, label, options, note) {
    var html = '<div class="setting"><div class="lbl">' + label + '</div><div class="seg" role="group" aria-label="' + esc(label) + '">';
    options.forEach(function (o) {
      html += '<button type="button" data-k="' + key + '" data-v="' + esc(JSON.stringify(o[0])) + '" aria-pressed="' + (settings[key] === o[0]) + '">' + o[1] + '</button>';
    });
    return html + '</div>' + (note ? '<p class="note" style="margin-top:8px!important">' + note + '</p>' : '') + '</div>';
  }

  function openSettings() {
    var startDraw = settings.drawCount;
    var html = head('Definições') +
      seg('drawCount', 'Modo de jogo', [[1, 'Virar 1 carta'], [3, 'Virar 3 cartas']], 'Muda a partir do próximo jogo.') +
      seg('newGameType', 'Jogos novos', [['solucao', 'Sempre com solução'], ['acaso', 'Totalmente ao acaso']], '«Com solução»: antes de dar as cartas, o jogo confirma que é possível ganhar.') +
      seg('tapMode', 'Ao tocar numa carta', [['auto', 'Vai sozinha'], ['escolher', 'Escolho o destino']], '«Escolho o destino»: toque na carta e depois no sítio para onde a quer levar.') +
      seg('cardSize', 'Tamanho das letras das cartas', [['normal', 'Normal'], ['grande', 'Grande'], ['muito', 'Muito grande']]) +
      seg('table', 'Cor da mesa', [['verde', 'Verde clássico'], ['azul', 'Azul'], ['bordo', 'Bordô']]) +
      seg('back', 'Verso das cartas', [['azul', 'Azul'], ['vermelho', 'Vermelho']]) +
      seg('sound', 'Som', [[true, 'Ligado'], [false, 'Desligado']]) +
      seg('anim', 'Animações', [['normais', 'Normais'], ['reduzidas', 'Reduzidas']]) +
      seg('hand', 'Mão dominante', [['direita', 'Direita'], ['esquerda', 'Esquerda']], 'Muda o monte de lado, para ficar mais perto da mão com que joga.') +
      seg('showScore', 'Pontuação', [[true, 'Mostrar'], [false, 'Ocultar']]) +
      seg('showTime', 'Tempo', [[true, 'Mostrar'], [false, 'Ocultar']]) +
      '<div style="height:8px"></div><button class="big-btn" type="button" data-close>Fechar</button>';
    openSheet(html, function () {
      if (settings.drawCount !== startDraw && game.board.moves === 0 && game.meta.kind !== 'daily' && !game.won) newGame(true);
    });
    sheetEl.querySelectorAll('[data-k]').forEach(function (btn) {
      btn.onclick = function () {
        var k = btn.dataset.k, v = JSON.parse(btn.dataset.v);
        settings[k] = v;
        sheetEl.querySelectorAll('[data-k="' + k + '"]').forEach(function (b2) { b2.setAttribute('aria-pressed', String(b2 === btn)); });
        applySettings();
        if (k === 'sound' && v) sound('move');
        saveGame();
      };
    });
  }

  function applySettings() {
    root.dataset.table = settings.table;
    root.dataset.back = settings.back;
    root.dataset.anim = settings.anim;
    root.dataset.hand = settings.hand;
    if (game) relayout();
  }

  function openStats() {
    var pct = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
    var tile = function (n, l) { return '<div class="stat"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; };
    openSheet(head('Estatísticas') +
      '<div class="stats">' +
      tile(stats.played, 'Jogos realizados') + tile(stats.won, 'Jogos ganhos') +
      tile(pct + '%', 'Percentagem de vitórias') + tile(fmtTime(stats.bestTime), 'Melhor tempo') +
      tile(stats.bestScore == null ? '—' : stats.bestScore, 'Melhor pontuação') + tile(stats.bestStreak, 'Maior sequência de vitórias') +
      '</div><p class="note">Sequência atual: ' + stats.curStreak + (stats.curStreak === 1 ? ' vitória seguida.' : ' vitórias seguidas.') + ' Um jogo conta como realizado a partir da primeira jogada.</p>' +
      '<div class="stack"><button class="big-btn" type="button" data-close data-focus>Fechar</button>' +
      '<button class="big-btn light" type="button" data-reset style="justify-content:center">Apagar estatísticas</button></div>');
    sheetEl.querySelector('[data-reset]').onclick = async function () {
      var ok = await confirmBox('Apagar as estatísticas?', 'Os números voltam a zero. O jogo atual não é afetado.', 'Sim, apagar', 'Não');
      if (ok) { stats = Object.assign({}, STATS0); if (game.meta.counted) { game.meta.counted = false; } saveGame(); }
      openStats();
    };
  }

  var calMonth = null;
  function openDaily() {
    var now = new Date(), today = todayStr(now);
    if (!calMonth) calMonth = { y: now.getFullYear(), m: now.getMonth() };
    var y = calMonth.y, m = calMonth.m;
    var first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
    var startDow = (first.getDay() + 6) % 7; // segunda-feira primeiro
    var monthName = first.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
    var cal = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map(function (d) { return '<div class="dow">' + d + '</div>'; }).join('');
    for (var i = 0; i < startDow; i++) cal += '<div class="d blank"></div>';
    var count = 0;
    for (var d = 1; d <= days; d++) {
      var ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var done = !!daily.done[ds]; if (done) count++;
      cal += '<div class="d' + (done ? ' done' : '') + (ds === today ? ' today' : '') + (ds > today ? ' future' : '') + '" aria-label="' + d + (done ? ', concluído' : '') + '">' + (done ? '✓' : d) + '</div>';
    }
    var todayDone = !!daily.done[today];
    var playing = game.meta.kind === 'daily' && game.meta.date === today && !game.won;
    var isCurMonth = y === now.getFullYear() && m === now.getMonth();
    openSheet(head('Desafio do dia') +
      '<p>Todos os dias há um jogo novo, igual para o dia inteiro. Modo: virar 1 carta.</p>' +
      (todayDone ? '<p><b>Já concluiu o desafio de hoje. Muito bem!</b></p>' : '') +
      '<div class="stack"><button class="big-btn gold" type="button" data-play data-focus>' + (playing ? 'Continuar o desafio de hoje' : todayDone ? 'Jogar outra vez o desafio de hoje' : 'Jogar o desafio de hoje') + '</button></div>' +
      '<h3>Desafios concluídos</h3>' +
      '<div class="cal-nav"><button class="x-btn" type="button" data-prev aria-label="Mês anterior">‹</button><div class="m">' + esc(monthName) + '</div><button class="x-btn" type="button" data-next aria-label="Mês seguinte"' + (isCurMonth ? ' disabled style="opacity:.35"' : '') + '>›</button></div>' +
      '<div class="cal">' + cal + '</div><p class="note">' + count + (count === 1 ? ' desafio concluído' : ' desafios concluídos') + ' neste mês.</p>' +
      '<button class="big-btn" type="button" data-close>Fechar</button>');
    sheetEl.querySelector('[data-play]').onclick = startDaily;
    sheetEl.querySelector('[data-prev]').onclick = function () { calMonth.m--; if (calMonth.m < 0) { calMonth.m = 11; calMonth.y--; } openDaily(); };
    sheetEl.querySelector('[data-next]').onclick = function () { if (isCurMonth) return; calMonth.m++; if (calMonth.m > 11) { calMonth.m = 0; calMonth.y++; } openDaily(); };
  }

  function openHelp() {
    var C = function (r, s) { return s * 13 + r - 1; };
    var w = 44;
    var step = function (n, text, demo) { return '<div class="help-step"><div class="num">' + n + '</div><p>' + text + '</p>' + (demo ? '<div class="demo">' + demo + '</div>' : '') + '</div>'; };
    openSheet(head('Como jogar') +
      '<p><b>Objetivo:</b> pôr as 52 cartas nos quatro lugares de cima, uma pilha para cada naipe, do Ás ao Rei.</p>' +
      step(1, 'Na mesa, arrume as cartas <b>do Rei para o Ás</b>, sempre <b>vermelha sobre preta</b> ou <b>preta sobre vermelha</b>.', miniStack([C(13, 3), C(12, 0), C(11, 2)], w)) +
      step(2, 'Os <b>Ases</b> vão para os <b>lugares de cima</b>.', miniCard(C(1, 0), w)) +
      step(3, 'Em cima, cada naipe cresce do Ás ao Rei: <b>Ás, 2, 3…</b> sempre do mesmo naipe.', '<div class="mini-row">' + miniCard(C(1, 1), 34) + miniCard(C(2, 1), 34) + miniCard(C(3, 1), 34) + '</div>') +
      step(4, 'Numa <b>coluna vazia</b> só pode pôr um <b>Rei</b>.', miniCard(C(13, 0), w)) +
      step(5, 'Toque no <b>monte</b> (as cartas de costas, no canto de cima) para virar mais cartas. Quando acabar, toque outra vez para voltar a usá-las.', miniBack(w)) +
      step(6, 'Ganha quando os <b>quatro naipes</b> estiverem completos em cima.', miniCard(C(13, 2), w)) +
      '<h3>Para mover as cartas</h3>' +
      '<p>Basta <b>tocar numa carta</b>: ela vai sozinha para o melhor sítio. Também pode <b>arrastá-la com o dedo</b>.</p>' +
      '<p>Enganou-se? Toque em <b>Anular</b>. Não sabe o que fazer? Toque em <b>Dica</b>. O jogo fica guardado sozinho: pode fechar e voltar quando quiser.</p>' +
      '<button class="big-btn" type="button" data-close data-focus>Percebi</button>');
  }

  function showWin() {
    var conf = '';
    if (animMs(1)) {
      var sym = ['♥', '♦', '♣', '♠'];
      for (var i = 0; i < 28; i++) {
        var red = i % 4 < 2;
        conf += '<span class="confetti" style="left:' + Math.round(Math.random() * 96) + '%;color:' + (red ? '#e03a4e' : '#fff') + ';animation-duration:' + (3.5 + Math.random() * 3).toFixed(2) + 's;animation-delay:' + (Math.random() * 2).toFixed(2) + 's">' + sym[i % 4] + '</span>';
      }
    }
    var sum = 'Pontos: ' + game.board.score + ' · Tempo: ' + fmtTime(game.elapsed) + ' · Jogadas: ' + game.board.moves;
    winEl.innerHTML = conf + '<div class="win-box" role="dialog" aria-modal="true"><h2>Parabéns! Ganhou! 🎉</h2><p class="sum">' + sum + '</p>' +
      (game.meta.kind === 'daily' ? '<p class="sum">Desafio do dia concluído ✓</p>' : '') +
      '<div class="stack"><button class="big-btn gold" type="button" data-again>Jogar novamente</button><button class="big-btn light" type="button" data-stats style="justify-content:center">Ver estatísticas</button></div></div>';
    winEl.hidden = false;
    winEl.querySelector('[data-again]').onclick = function () { winEl.hidden = true; newGame(true); };
    winEl.querySelector('[data-stats]').onclick = function () { winEl.hidden = true; openStats(); };
    updateStatus();
  }

  function welcomeBack() {
    openSheet('<h2>Olá de novo!</h2><p>O seu jogo ficou guardado.</p><div class="stack">' +
      '<button class="big-btn gold" type="button" data-close data-focus>Continuar</button>' +
      '<button class="big-btn light" type="button" data-new style="justify-content:center">Novo jogo</button></div>');
    sheetEl.querySelector('[data-new]').onclick = function () { closeSheet(); newGame(true); };
  }

  /* ================= Início ================= */

  function bind() {
    boardEl.addEventListener('pointerdown', onDown);
    boardEl.addEventListener('pointermove', onMove);
    boardEl.addEventListener('pointerup', onUp);
    boardEl.addEventListener('pointercancel', onUp);
    boardEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('touchmove', function (e) { if (!e.target.closest || !e.target.closest('.sheet')) e.preventDefault(); }, { passive: false });
    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      var a = btn.dataset.act;
      if (a === 'new') newGame(false);
      else if (a === 'undo') undo();
      else if (a === 'hint') hint();
      else if (a === 'menu') openMenu();
    });
    autoBtn.addEventListener('click', runAutoComplete);
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl || (e.target.closest && e.target.closest('[data-close]'))) closeSheet();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSheet();
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
    });
    var rt = 0;
    var onResize = function () { clearTimeout(rt); rt = setTimeout(relayout, 80); };
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(boardEl);
    document.addEventListener('visibilitychange', function () { if (document.hidden) saveGame(); });
    window.addEventListener('pagehide', saveGame);
    setInterval(function () {
      if (!game || game.won || document.hidden || !game.meta.counted) return;
      game.elapsed += 1;
      var clock = document.getElementById('clock');
      if (clock) clock.textContent = fmtTime(game.elapsed);
      if (game.elapsed % 10 === 0) saveGame();
    }, 1000);
  }

  async function init() {
    buildBoard();
    var res = loadGame();
    applySettings();
    ui.dims = computeDims();
    bind();
    if (res.ok) {
      root.classList.add('no-anim');
      render();
      requestAnimationFrame(function () { root.classList.remove('no-anim'); });
      if (game.won) showWin();
      else if (game.board.moves > 0) welcomeBack();
    } else {
      // Primeira vez (ou dados ilegíveis): começa já um jogo.
      await newGame(true);
      if (res.corrupt) toast('Não foi possível recuperar o jogo anterior. Começámos um jogo novo.', 5000);
      else openHelpFirstTime();
    }
  }

  function openHelpFirstTime() {
    openSheet('<h2>Bem-vinda ao Solitário da Avó</h2><p>Toque numa carta para a mover. Toque no monte, em cima à ' + (settings.hand === 'direita' ? 'direita' : 'esquerda') + ', para virar mais cartas.</p><p>Os botões grandes em baixo servem para começar um jogo novo, anular uma jogada ou pedir uma dica.</p><div class="stack"><button class="big-btn gold" type="button" data-close data-focus>Começar a jogar</button><button class="big-btn light" type="button" data-help style="justify-content:center">Ver como se joga</button></div>');
    sheetEl.querySelector('[data-help]').onclick = openHelp;
  }

  // Para testes automáticos no browser.
  window.__solitario = { get game() { return game; }, get settings() { return settings; }, get stats() { return stats; }, perform: perform, undo: undo, render: render };

  init();
})();
