/*
 * Solitário da Avó — motor de regras Klondike (sem interface).
 * Funciona no browser (global `Klondike`) e no Node (module.exports).
 *
 * Cartas são inteiros 0..51:  naipe = floor(c/13)  (0 ♥, 1 ♦, 2 ♣, 3 ♠)
 *                              valor = c % 13 + 1  (1 = Ás ... 13 = Rei)
 *
 * "board" é o estado do tabuleiro (imutável: cada jogada devolve um novo objeto):
 *   tableau:     7 × { cards: [...], down: n }   (as primeiras `down` cartas estão viradas para baixo)
 *   stock:       monte (topo = último elemento)
 *   waste:       cartas viradas (topo = último elemento)
 *   foundations: 4 pilhas (base = Ás)
 *   score, moves, wasteFan (quantas cartas da última tiragem continuam à vista), recycles
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Klondike = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SUIT_SYMBOLS = ['♥', '♦', '♣', '♠'];
  var RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var RANK_NAMES = ['', 'Ás', 'Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito', 'Nove', 'Dez', 'Valete', 'Dama', 'Rei'];
  var SUIT_NAMES = ['Copas', 'Ouros', 'Paus', 'Espadas'];

  function suitOf(c) { return (c / 13) | 0; }
  function rankOf(c) { return (c % 13) + 1; }
  function isRed(c) { return c < 26; }
  function cardName(c) { return RANK_NAMES[rankOf(c)] + ' de ' + SUIT_NAMES[suitOf(c)]; }

  /* ---------------- Aleatoriedade ---------------- */

  function getCrypto() {
    var g = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : {});
    return g.crypto && typeof g.crypto.getRandomValues === 'function' ? g.crypto : null;
  }

  // Inteiro uniforme em [0, n) — crypto.getRandomValues com rejeição (sem enviesamento).
  function cryptoRandomInt(n) {
    var c = getCrypto();
    if (c) {
      var buf = new Uint32Array(1);
      var limit = Math.floor(0x100000000 / n) * n;
      var x;
      do { c.getRandomValues(buf); x = buf[0]; } while (x >= limit);
      return x % n;
    }
    return Math.floor(Math.random() * n);
  }

  // Gerador determinístico (para o Desafio do dia).
  function seededRandomInt(seed) {
    var a = seed >>> 0;
    return function (n) {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      var r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(r * n);
    };
  }

  function hashString(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  function randomId() {
    var s = '';
    for (var i = 0; i < 6; i++) s += String(cryptoRandomInt(10));
    return s;
  }

  /* ---------------- Baralho e distribuição ---------------- */

  function createDeck() {
    var d = [];
    for (var i = 0; i < 52; i++) d.push(i);
    return d;
  }

  // Fisher–Yates.
  function shuffleDeck(deck, randInt) {
    randInt = randInt || cryptoRandomInt;
    var a = deck.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function dealCards(deck) {
    var tableau = [];
    for (var i = 0; i < 7; i++) tableau.push({ cards: [], down: 0 });
    var k = 0;
    for (var row = 0; row < 7; row++) {
      for (var col = row; col < 7; col++) tableau[col].cards.push(deck[k++]);
    }
    for (i = 0; i < 7; i++) tableau[i].down = tableau[i].cards.length - 1;
    return {
      tableau: tableau,
      stock: deck.slice(28).reverse(), // a primeira carta tirada é deck[28]
      waste: [],
      foundations: [[], [], [], []],
      score: 0,
      moves: 0,
      wasteFan: 0,
      recycles: 0
    };
  }

  function cloneBoard(b) {
    return {
      tableau: b.tableau.map(function (t) { return { cards: t.cards.slice(), down: t.down }; }),
      stock: b.stock.slice(),
      waste: b.waste.slice(),
      foundations: b.foundations.map(function (f) { return f.slice(); }),
      score: b.score,
      moves: b.moves,
      wasteFan: b.wasteFan,
      recycles: b.recycles
    };
  }

  /* ---------------- Regras ---------------- */

  function canStackOnTableau(card, col) {
    if (col.cards.length === 0) return rankOf(card) === 13;
    var top = col.cards[col.cards.length - 1];
    if (col.down >= col.cards.length) return false;
    return isRed(top) !== isRed(card) && rankOf(top) === rankOf(card) + 1;
  }

  function canStackOnFoundation(card, pile) {
    if (pile.length === 0) return rankOf(card) === 1;
    var top = pile[pile.length - 1];
    return suitOf(top) === suitOf(card) && rankOf(card) === rankOf(top) + 1;
  }

  function isValidSequence(cards) {
    for (var i = 1; i < cards.length; i++) {
      var a = cards[i - 1], b = cards[i];
      if (isRed(a) === isRed(b) || rankOf(a) !== rankOf(b) + 1) return false;
    }
    return true;
  }

  // Fundação indicada para uma carta (mesmo naipe, ou a primeira vazia para um Ás). -1 se nenhuma.
  function foundationTargetFor(board, card) {
    var r = rankOf(card), s = suitOf(card);
    for (var i = 0; i < 4; i++) {
      var p = board.foundations[i];
      if (p.length && suitOf(p[0]) === s) return canStackOnFoundation(card, p) ? i : -1;
    }
    if (r !== 1) return -1;
    for (i = 0; i < 4; i++) if (board.foundations[i].length === 0) return i;
    return -1;
  }

  function foundationRankBySuit(board) {
    var r = [0, 0, 0, 0];
    for (var i = 0; i < 4; i++) {
      var p = board.foundations[i];
      if (p.length) r[suitOf(p[0])] = p.length;
    }
    return r;
  }

  // Seguro = nenhuma carta que ainda esteja em jogo poderia precisar desta carta na mesa.
  function isSafeToFoundation(board, card) {
    var r = rankOf(card);
    if (r <= 2) return true;
    var fr = foundationRankBySuit(board);
    var opp = isRed(card) ? [2, 3] : [0, 1];
    return fr[opp[0]] >= r - 1 && fr[opp[1]] >= r - 1;
  }

  // Cartas que sairiam com esta jogada (ou null se a origem for inválida).
  function getMovingCards(board, from, start) {
    if (!from) return null;
    if (from.pile === 'tableau') {
      var col = board.tableau[from.index];
      if (!col) return null;
      if (start == null) start = col.cards.length - 1;
      if (start < col.down || start < 0 || start >= col.cards.length) return null;
      var cards = col.cards.slice(start);
      return isValidSequence(cards) ? cards : null;
    }
    if (from.pile === 'waste') return board.waste.length ? [board.waste[board.waste.length - 1]] : null;
    if (from.pile === 'foundation') {
      var p = board.foundations[from.index];
      return p && p.length ? [p[p.length - 1]] : null;
    }
    return null;
  }

  function resolveMove(board, move) {
    if (!move || move.type !== 'move' || !move.from || !move.to) return null;
    var m = { type: 'move', from: { pile: move.from.pile, index: move.from.index || 0 }, to: { pile: move.to.pile, index: move.to.index }, start: move.start };
    if (m.from.pile === 'tableau' && m.start == null) {
      var c = board.tableau[m.from.index];
      if (!c) return null;
      m.start = c.cards.length - 1;
    }
    if (m.from.pile !== 'tableau') m.start = null;
    if (m.to.pile === 'foundation' && m.to.index == null) {
      var cards = getMovingCards(board, m.from, m.start);
      if (!cards || cards.length !== 1) return null;
      var fi = foundationTargetFor(board, cards[0]);
      if (fi < 0) return null;
      m.to.index = fi;
    }
    return m;
  }

  function validateMove(board, move) {
    var m = resolveMove(board, move);
    if (!m) return false;
    var cards = getMovingCards(board, m.from, m.start);
    if (!cards || !cards.length) return false;
    if (m.to.pile === 'foundation') {
      if (m.from.pile === 'foundation') return false;
      var pile = board.foundations[m.to.index];
      return !!pile && cards.length === 1 && canStackOnFoundation(cards[0], pile);
    }
    if (m.to.pile === 'tableau') {
      if (m.from.pile === 'tableau' && m.from.index === m.to.index) return false;
      var col = board.tableau[m.to.index];
      return !!col && canStackOnTableau(cards[0], col);
    }
    return false;
  }

  function revealTopCard(col) {
    if (col.cards.length > 0 && col.down >= col.cards.length) {
      col.down = col.cards.length - 1;
      return true;
    }
    return false;
  }

  // Aplica uma jogada de cartas. Devolve { board, revealed } ou null se for ilegal.
  function moveCards(board, move) {
    if (!validateMove(board, move)) return null;
    var m = resolveMove(board, move);
    var b = cloneBoard(board);
    var cards, revealed = false;
    if (m.from.pile === 'tableau') {
      var col = b.tableau[m.from.index];
      cards = col.cards.splice(m.start);
      revealed = revealTopCard(col);
      if (revealed) b.score += 5;
    } else if (m.from.pile === 'waste') {
      cards = [b.waste.pop()];
      b.wasteFan = Math.max(0, b.wasteFan - 1);
    } else {
      cards = [b.foundations[m.from.index].pop()];
    }
    if (m.to.pile === 'foundation') {
      b.foundations[m.to.index].push(cards[0]);
      if (m.from.pile !== 'foundation') b.score += 10;
    } else {
      Array.prototype.push.apply(b.tableau[m.to.index].cards, cards);
      if (m.from.pile === 'waste') b.score += 5;
      if (m.from.pile === 'foundation') b.score = Math.max(0, b.score - 15);
    }
    b.moves += 1;
    return { board: b, revealed: revealed, move: m, cards: cards };
  }

  function moveCard(board, move) { var r = moveCards(board, move); return r && r.board; }
  function moveSequence(board, move) { return moveCard(board, move); }
  function moveToFoundation(board, from, start) {
    return moveCard(board, { type: 'move', from: from, start: start, to: { pile: 'foundation' } });
  }
  function moveFromFoundation(board, foundationIndex, tableauIndex) {
    return moveCard(board, { type: 'move', from: { pile: 'foundation', index: foundationIndex }, to: { pile: 'tableau', index: tableauIndex } });
  }

  function drawFromStock(board, drawCount) {
    if (!board.stock.length) return null;
    var b = cloneBoard(board);
    var n = Math.min(drawCount || 1, b.stock.length);
    for (var i = 0; i < n; i++) b.waste.push(b.stock.pop());
    b.wasteFan = n;
    b.moves += 1;
    return b;
  }

  // Volta a pôr o desperdício no monte, mantendo a ordem (sem baralhar).
  function recycleStock(board, drawCount, noPenalty) {
    if (board.stock.length || !board.waste.length) return null;
    var b = cloneBoard(board);
    b.stock = b.waste.slice().reverse();
    b.waste = [];
    b.wasteFan = 0;
    b.recycles += 1;
    b.moves += 1;
    if (!noPenalty && drawCount === 1) b.score = Math.max(0, b.score - 100);
    return b;
  }

  // Toque no monte: tira cartas ou recicla.
  function tapStock(board, drawCount, noPenalty) {
    return board.stock.length ? drawFromStock(board, drawCount) : recycleStock(board, drawCount, noPenalty);
  }

  // Aplica qualquer ação (jogada ou toque no monte).
  function applyAction(board, action, drawCount, opts) {
    if (!action) return null;
    if (action.type === 'stock') return tapStock(board, drawCount, opts && opts.noPenalty);
    return moveCard(board, action);
  }

  function checkVictory(board) {
    for (var i = 0; i < 4; i++) if (board.foundations[i].length !== 13) return false;
    return true;
  }

  /* ---------------- Procura de jogadas ---------------- */

  function findLegalMoves(board, drawCount) {
    var out = [];
    var i, j;
    for (i = 0; i < 7; i++) {
      var col = board.tableau[i];
      for (var s = col.down; s < col.cards.length; s++) {
        var from = { pile: 'tableau', index: i };
        if (s === col.cards.length - 1) {
          var fi = foundationTargetFor(board, col.cards[s]);
          if (fi >= 0) out.push({ type: 'move', from: from, start: s, to: { pile: 'foundation', index: fi } });
        }
        for (j = 0; j < 7; j++) {
          if (j === i) continue;
          var mv = { type: 'move', from: from, start: s, to: { pile: 'tableau', index: j } };
          if (validateMove(board, mv)) out.push(mv);
        }
      }
    }
    if (board.waste.length) {
      var w = board.waste[board.waste.length - 1];
      var wf = foundationTargetFor(board, w);
      if (wf >= 0) out.push({ type: 'move', from: { pile: 'waste', index: 0 }, to: { pile: 'foundation', index: wf } });
      for (j = 0; j < 7; j++) {
        var wm = { type: 'move', from: { pile: 'waste', index: 0 }, to: { pile: 'tableau', index: j } };
        if (validateMove(board, wm)) out.push(wm);
      }
    }
    for (i = 0; i < 4; i++) {
      if (!board.foundations[i].length) continue;
      for (j = 0; j < 7; j++) {
        var fm = { type: 'move', from: { pile: 'foundation', index: i }, to: { pile: 'tableau', index: j } };
        if (validateMove(board, fm)) out.push(fm);
      }
    }
    if (board.stock.length || board.waste.length) out.push({ type: 'stock' });
    return out;
  }

  // Classifica a utilidade de uma jogada (maior = melhor). 0 = inútil (não sugerir).
  function rateMove(board, m) {
    if (m.type === 'stock') return 1;
    var cards = getMovingCards(board, m.from, m.start);
    if (!cards) return -1;
    var card = cards[0];
    if (m.to.pile === 'foundation') return isSafeToFoundation(board, card) ? 100 : 70;
    if (m.from.pile === 'foundation') return 0;
    var dest = board.tableau[m.to.index];
    if (m.from.pile === 'waste') return dest.cards.length === 0 ? 55 : 60;
    // tableau -> tableau
    var col = board.tableau[m.from.index];
    if (m.start === col.down && col.down > 0) return 90 + (col.down / 100); // revela carta escondida
    if (m.start === 0) {
      if (rankOf(card) === 13) return 0; // Rei de coluna vazia para coluna vazia: inútil
      return 80; // esvazia uma coluna
    }
    if (m.start > col.down) {
      // expõe uma carta que pode ir já para a fundação?
      var under = col.cards[m.start - 1];
      if (foundationTargetFor(board, under) >= 0) return 50;
    }
    return 0;
  }

  // Melhor jogada para uma carta tocada (origem fixa). Devolve a jogada ou null.
  function bestMoveFrom(board, from, start) {
    var cards = getMovingCards(board, from, start);
    if (!cards) return null;
    var candidates = [];
    if (cards.length === 1 && from.pile !== 'foundation') {
      var fi = foundationTargetFor(board, cards[0]);
      if (fi >= 0) candidates.push({ type: 'move', from: from, start: start, to: { pile: 'foundation', index: fi } });
    }
    var firstEmptyTried = false;
    for (var j = 0; j < 7; j++) {
      if (from.pile === 'tableau' && from.index === j) continue;
      var isEmpty = board.tableau[j].cards.length === 0;
      if (isEmpty && firstEmptyTried) continue;
      var mv = { type: 'move', from: from, start: start, to: { pile: 'tableau', index: j } };
      if (validateMove(board, mv)) { candidates.push(mv); if (isEmpty) firstEmptyTried = true; }
    }
    if (!candidates.length) return null;
    var best = null, bestScore = -Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var sc = rateMove(board, c);
      if (sc <= 0) sc = 10; // a pessoa tocou na carta: qualquer jogada legal serve
      if (c.to.pile === 'tableau' && board.tableau[c.to.index].cards.length === 0) sc -= 1; // preferir colunas com cartas
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    return best;
  }

  // Algum cartão do monte/desperdício pode ser jogado já?
  function stockHasPlayable(board) {
    var all = board.stock.concat(board.waste);
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (foundationTargetFor(board, c) >= 0) return true;
      for (var j = 0; j < 7; j++) if (canStackOnTableau(c, board.tableau[j])) return true;
    }
    return false;
  }

  // Dica heurística: { move, reason } ou { move: null, reason }.
  function getHint(board, drawCount) {
    var moves = findLegalMoves(board, drawCount);
    var best = null, bestScore = 0;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (m.type === 'stock') continue;
      var sc = rateMove(board, m);
      if (sc > bestScore) { bestScore = sc; best = m; }
    }
    if (best) return { move: best, reason: 'move' };
    if ((board.stock.length || board.waste.length) && stockHasPlayable(board)) {
      return { move: { type: 'stock' }, reason: board.stock.length ? 'draw' : 'recycle' };
    }
    return { move: null, reason: 'none' };
  }

  /* ---------------- Conclusão automática ---------------- */

  // Só quando todas as cartas da mesa estão viradas para cima — a partir daí a vitória é garantida:
  // a carta de menor valor ainda em jogo está sempre acessível (Virar 1: o monte pode ser percorrido).
  function canAutoComplete(board, drawCount) {
    if (checkVictory(board)) return false;
    for (var i = 0; i < 7; i++) if (board.tableau[i].down > 0) return false;
    if (drawCount !== 1 && (board.stock.length || board.waste.length)) return false;
    return true;
  }

  // Um passo legal da conclusão automática (ou null).
  function autoCompleteStep(board, drawCount) {
    var best = null, bestRank = 99;
    for (var i = 0; i < 7; i++) {
      var col = board.tableau[i];
      if (!col.cards.length) continue;
      var c = col.cards[col.cards.length - 1];
      if (foundationTargetFor(board, c) >= 0 && rankOf(c) < bestRank) {
        bestRank = rankOf(c);
        best = { type: 'move', from: { pile: 'tableau', index: i }, start: col.cards.length - 1, to: { pile: 'foundation' } };
      }
    }
    if (board.waste.length) {
      var w = board.waste[board.waste.length - 1];
      if (foundationTargetFor(board, w) >= 0 && rankOf(w) < bestRank) {
        best = { type: 'move', from: { pile: 'waste', index: 0 }, to: { pile: 'foundation' } };
      }
    }
    if (best) return best;
    if (board.stock.length || board.waste.length) return { type: 'stock' };
    return null;
  }

  // Executa a conclusão automática completa (para testes). Devolve a lista de estados.
  function autoComplete(board, drawCount) {
    if (!canAutoComplete(board, drawCount)) return null;
    var states = [];
    var b = board;
    for (var guard = 0; guard < 2000 && !checkVictory(b); guard++) {
      var step = autoCompleteStep(b, drawCount);
      if (!step) break;
      b = applyAction(b, step, drawCount, { noPenalty: true });
      if (!b) break;
      states.push(b);
    }
    return states;
  }

  /* ---------------- Verificação de integridade ---------------- */

  function allCards(board) {
    var out = [];
    board.tableau.forEach(function (t) { out.push.apply(out, t.cards); });
    out.push.apply(out, board.stock);
    out.push.apply(out, board.waste);
    board.foundations.forEach(function (f) { out.push.apply(out, f); });
    return out;
  }

  function isIntegerCard(c) { return typeof c === 'number' && c >= 0 && c < 52 && (c | 0) === c; }

  // Verifica a estrutura completa de um tabuleiro (para cargas guardadas e testes).
  function validateBoard(board) {
    try {
      if (!board || !Array.isArray(board.tableau) || board.tableau.length !== 7) return false;
      if (!Array.isArray(board.stock) || !Array.isArray(board.waste)) return false;
      if (!Array.isArray(board.foundations) || board.foundations.length !== 4) return false;
      var cards = allCards(board);
      if (cards.length !== 52) return false;
      var seen = {};
      for (var i = 0; i < cards.length; i++) {
        if (!isIntegerCard(cards[i]) || seen[cards[i]]) return false;
        seen[cards[i]] = 1;
      }
      for (i = 0; i < 7; i++) {
        var t = board.tableau[i];
        if (!Array.isArray(t.cards) || typeof t.down !== 'number' || t.down < 0) return false;
        if (t.cards.length && t.down >= t.cards.length) return false;
        if (!t.cards.length && t.down !== 0) return false;
        if (!isValidSequence(t.cards.slice(t.down))) return false;
      }
      for (i = 0; i < 4; i++) {
        var f = board.foundations[i];
        for (var k = 0; k < f.length; k++) {
          if (rankOf(f[k]) !== k + 1 || suitOf(f[k]) !== suitOf(f[0])) return false;
        }
      }
      if (typeof board.score !== 'number' || typeof board.moves !== 'number') return false;
      return true;
    } catch (e) { return false; }
  }

  function validateDeck(deck) {
    if (!Array.isArray(deck) || deck.length !== 52) return false;
    var seen = {};
    for (var i = 0; i < 52; i++) {
      if (!isIntegerCard(deck[i]) || seen[deck[i]]) return false;
      seen[deck[i]] = 1;
    }
    return true;
  }

  /* ---------------- Resolvedor (prova que um jogo tem solução) ---------------- */
  // Procura em profundidade com memória de estados. Não usa a interface. A solução
  // encontrada é depois confirmada jogada a jogada com as regras acima (verifySolution).

  function solve(board, drawCount, opts) {
    opts = opts || {};
    var budget = opts.budget || 60000;
    var cols = board.tableau.map(function (t) { return t.cards.slice(); });
    var downs = board.tableau.map(function (t) { return t.down; });
    var stock = board.stock.slice();
    var waste = board.waste.slice();
    var found = [0, 0, 0, 0];
    board.foundations.forEach(function (f) { if (f.length) found[suitOf(f[0])] = f.length; });
    var visited = new Set();
    var nodes = 0, aborted = false;
    var path = [];
    var dc = drawCount || 1;

    function canF(c) { return found[suitOf(c)] === rankOf(c) - 1; }
    function safeF(c) {
      var r = rankOf(c);
      if (found[suitOf(c)] !== r - 1) return false;
      if (r <= 2) return true;
      return isRed(c) ? (found[2] >= r - 1 && found[3] >= r - 1) : (found[0] >= r - 1 && found[1] >= r - 1);
    }
    function canT(c, j) {
      var col = cols[j];
      if (!col.length) return rankOf(c) === 13;
      var top = col[col.length - 1];
      return isRed(top) !== isRed(c) && rankOf(top) === rankOf(c) + 1;
    }
    function reveal(i) { if (cols[i].length && downs[i] >= cols[i].length) downs[i] = cols[i].length - 1; }

    function save() { return [cols.map(function (c) { return c.slice(); }), downs.slice(), stock.slice(), waste.slice(), found.slice()]; }
    function restore(s) { cols = s[0]; downs = s[1]; stock = s[2]; waste = s[3]; found = s[4]; }

    function key() {
      var parts = new Array(7);
      for (var i = 0; i < 7; i++) {
        var s = String.fromCharCode(65 + downs[i]);
        var c = cols[i];
        for (var j = 0; j < c.length; j++) s += String.fromCharCode(48 + c[j]);
        parts[i] = s;
      }
      parts.sort();
      var k = parts.join(',') + '|';
      for (i = 0; i < stock.length; i++) k += String.fromCharCode(48 + stock[i]);
      k += '|';
      for (i = 0; i < waste.length; i++) k += String.fromCharCode(48 + waste[i]);
      return k;
    }

    function apply(m) {
      if (m.k === 'TF') { var c = cols[m.i].pop(); found[suitOf(c)]++; reveal(m.i); path.push({ type: 'move', from: { pile: 'tableau', index: m.i }, to: { pile: 'foundation' } }); }
      else if (m.k === 'WF') { var w = waste.pop(); found[suitOf(w)]++; path.push({ type: 'move', from: { pile: 'waste', index: 0 }, to: { pile: 'foundation' } }); }
      else if (m.k === 'TT') { var mv = cols[m.i].splice(m.s); Array.prototype.push.apply(cols[m.j], mv); reveal(m.i); path.push({ type: 'move', from: { pile: 'tableau', index: m.i }, start: m.s, to: { pile: 'tableau', index: m.j } }); }
      else if (m.k === 'WT') { cols[m.j].push(waste.pop()); path.push({ type: 'move', from: { pile: 'waste', index: 0 }, to: { pile: 'tableau', index: m.j } }); }
      else if (m.k === 'S') {
        if (stock.length) { var n = Math.min(dc, stock.length); for (var q = 0; q < n; q++) waste.push(stock.pop()); }
        else { stock = waste.reverse(); waste = []; }
        path.push({ type: 'stock' });
      }
    }

    function autoplay() {
      var changed = true;
      while (changed) {
        changed = false;
        for (var i = 0; i < 7; i++) {
          var c = cols[i];
          if (c.length && safeF(c[c.length - 1])) { apply({ k: 'TF', i: i }); changed = true; }
        }
        if (waste.length && safeF(waste[waste.length - 1])) { apply({ k: 'WF' }); changed = true; }
      }
    }

    function gen() {
      var ms = [], i, j, c, s;
      for (i = 0; i < 7; i++) { c = cols[i]; if (c.length && canF(c[c.length - 1])) ms.push({ k: 'TF', i: i }); }
      if (waste.length && canF(waste[waste.length - 1])) ms.push({ k: 'WF' });
      // revelar cartas escondidas
      for (i = 0; i < 7; i++) {
        c = cols[i]; if (!c.length) continue;
        s = downs[i];
        if (s > 0) {
          var emptyDone = false;
          for (j = 0; j < 7; j++) {
            if (j === i || !canT(c[s], j)) continue;
            if (!cols[j].length) { if (emptyDone) continue; emptyDone = true; }
            ms.push({ k: 'TT', i: i, s: s, j: j });
          }
        }
      }
      // carta do desperdício para a mesa
      if (waste.length) {
        var w = waste[waste.length - 1], ed = false;
        for (j = 0; j < 7; j++) {
          if (!canT(w, j)) continue;
          if (!cols[j].length) { if (ed) continue; ed = true; }
          ms.push({ k: 'WT', j: j });
        }
      }
      // esvaziar colunas (sem ser Rei na base)
      for (i = 0; i < 7; i++) {
        c = cols[i];
        if (!c.length || downs[i] !== 0 || rankOf(c[0]) === 13) continue;
        for (j = 0; j < 7; j++) if (j !== i && cols[j].length && canT(c[0], j)) ms.push({ k: 'TT', i: i, s: 0, j: j });
      }
      // mover parte de uma sequência para libertar carta para a fundação
      for (i = 0; i < 7; i++) {
        c = cols[i];
        for (s = downs[i] + 1; s < c.length; s++) {
          if (!canF(c[s - 1])) continue;
          for (j = 0; j < 7; j++) if (j !== i && cols[j].length && canT(c[s], j)) ms.push({ k: 'TT', i: i, s: s, j: j });
        }
      }
      if (stock.length || waste.length) ms.push({ k: 'S' });
      return ms;
    }

    function dfs() {
      if (found[0] + found[1] + found[2] + found[3] === 52) return true;
      if (++nodes > budget) { aborted = true; return false; }
      var k = key();
      if (visited.has(k)) return false;
      visited.add(k);
      var ms = gen();
      for (var x = 0; x < ms.length; x++) {
        var snap = save(), pl = path.length;
        apply(ms[x]);
        autoplay();
        if (dfs()) return true;
        if (aborted) return false;
        restore(snap); path.length = pl;
      }
      return false;
    }

    autoplay();
    var ok = dfs();
    return { solved: ok, moves: ok ? path.slice() : null, nodes: nodes, aborted: aborted };
  }

  // Confirma uma solução com as regras oficiais do motor.
  function verifySolution(board, drawCount, moves) {
    var b = board;
    for (var i = 0; i < moves.length; i++) {
      b = applyAction(b, moves[i], drawCount);
      if (!b || !validateBoard(b)) return false;
    }
    return checkVictory(b);
  }

  // Procura uma jogada de dica com o resolvedor (null se não conseguir a tempo).
  function solverHint(board, drawCount, budget) {
    var r = solve(board, drawCount, { budget: budget || 15000 });
    if (r.solved && r.moves.length && verifySolution(board, drawCount, r.moves)) return r.moves[0];
    return null;
  }

  // Data -> baralho determinístico do Desafio do dia (com prova de solução quando possível).
  function dailyDeal(dateStr, budget) {
    var seed = hashString('solitario-da-avo:' + dateStr);
    var firstDeck = null;
    for (var k = 0; k < 12; k++) {
      var deck = shuffleDeck(createDeck(), seededRandomInt((seed + Math.imul(k, 2654435761)) >>> 0));
      if (!firstDeck) firstDeck = deck;
      var b = dealCards(deck);
      var r = solve(b, 1, { budget: budget || 60000 });
      if (r.solved && verifySolution(b, 1, r.moves)) return { deck: deck, solvable: true };
    }
    return { deck: firstDeck, solvable: false };
  }

  return {
    SUIT_SYMBOLS: SUIT_SYMBOLS, RANK_LABELS: RANK_LABELS, RANK_NAMES: RANK_NAMES, SUIT_NAMES: SUIT_NAMES,
    suitOf: suitOf, rankOf: rankOf, isRed: isRed, cardName: cardName,
    cryptoRandomInt: cryptoRandomInt, seededRandomInt: seededRandomInt, hashString: hashString, randomId: randomId,
    createDeck: createDeck, shuffleDeck: shuffleDeck, dealCards: dealCards, cloneBoard: cloneBoard,
    canStackOnTableau: canStackOnTableau, canStackOnFoundation: canStackOnFoundation, isValidSequence: isValidSequence,
    foundationTargetFor: foundationTargetFor, isSafeToFoundation: isSafeToFoundation, getMovingCards: getMovingCards,
    resolveMove: resolveMove, validateMove: validateMove, moveCards: moveCards, moveCard: moveCard, moveSequence: moveSequence,
    moveToFoundation: moveToFoundation, moveFromFoundation: moveFromFoundation, revealTopCard: revealTopCard,
    drawFromStock: drawFromStock, recycleStock: recycleStock, tapStock: tapStock, applyAction: applyAction,
    checkVictory: checkVictory, findLegalMoves: findLegalMoves, rateMove: rateMove, bestMoveFrom: bestMoveFrom,
    getHint: getHint, canAutoComplete: canAutoComplete, autoCompleteStep: autoCompleteStep, autoComplete: autoComplete,
    allCards: allCards, validateBoard: validateBoard, validateDeck: validateDeck,
    solve: solve, verifySolution: verifySolution, solverHint: solverHint, dailyDeal: dailyDeal
  };
});
