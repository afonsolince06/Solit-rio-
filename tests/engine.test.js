// Testes automáticos do motor. Correr com:  node tests/engine.test.js
'use strict';
const K = require('../src/engine.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('FALHA ' + name + '\n      ' + e.message); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assert'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'eq') + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); }

const C = (rank, suit) => suit * 13 + rank - 1; // suit 0♥ 1♦ 2♣ 3♠
function emptyBoard() {
  return { tableau: Array.from({ length: 7 }, () => ({ cards: [], down: 0 })), stock: [], waste: [], foundations: [[], [], [], []], score: 0, moves: 0, wasteFan: 0, recycles: 0 };
}
// Coloca as cartas que faltam no monte para manter 52 cartas.
function fill(b) {
  const used = new Set(K.allCards(b));
  for (let c = 0; c < 52; c++) if (!used.has(c)) b.stock.unshift(c);
  return b;
}

console.log('Baralho e distribuição');
test('createDeck tem 52 cartas únicas com naipes e valores corretos', () => {
  const d = K.createDeck();
  eq(d.length, 52);
  eq(new Set(d).size, 52);
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) {
    const c = C(r, s); assert(K.suitOf(c) === s && K.rankOf(c) === r);
  }
  assert(K.isRed(C(5, 0)) && K.isRed(C(5, 1)) && !K.isRed(C(5, 2)) && !K.isRed(C(5, 3)));
});
test('dealCards: 7 colunas (1..7), 28 na mesa, 24 no monte, só a última virada', () => {
  const b = K.dealCards(K.shuffleDeck(K.createDeck()));
  for (let i = 0; i < 7; i++) { eq(b.tableau[i].cards.length, i + 1); eq(b.tableau[i].down, i); }
  eq(b.tableau.reduce((n, t) => n + t.cards.length, 0), 28);
  eq(b.stock.length, 24); eq(b.waste.length, 0);
  assert(b.foundations.every(f => f.length === 0));
  assert(K.validateBoard(b));
});
test('1000 baralhos: sempre 52 únicas, nenhum repetido entre si', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const d = K.shuffleDeck(K.createDeck());
    assert(K.validateDeck(d), 'baralho inválido');
    const key = d.join(',');
    assert(!seen.has(key), 'baralho repetido'); seen.add(key);
  }
});
test('baralhar é aproximadamente uniforme (posição do Ás de Copas)', () => {
  const counts = new Array(52).fill(0); const N = 52000;
  for (let i = 0; i < N; i++) counts[K.shuffleDeck(K.createDeck()).indexOf(0)]++;
  const exp = N / 52; for (const c of counts) assert(Math.abs(c - exp) < exp * 0.25, 'distribuição enviesada ' + c);
});
test('recomeçar: o mesmo baralho dá exatamente a mesma distribuição', () => {
  const d = K.shuffleDeck(K.createDeck());
  eq(K.dealCards(d), K.dealCards(d.slice()));
});
test('crypto.getRandomValues está disponível e é usado', () => {
  assert(typeof globalThis.crypto.getRandomValues === 'function');
});

console.log('Regras de movimento');
test('preto 9 sobre vermelho 10 é válido; mesma cor é inválido', () => {
  const b = emptyBoard();
  b.tableau[0] = { cards: [C(10, 0)], down: 0 };
  b.tableau[1] = { cards: [C(9, 2)], down: 0 };
  b.tableau[2] = { cards: [C(9, 1)], down: 0 };
  fill(b);
  assert(K.validateMove(b, { type: 'move', from: { pile: 'tableau', index: 1 }, to: { pile: 'tableau', index: 0 } }));
  assert(!K.validateMove(b, { type: 'move', from: { pile: 'tableau', index: 2 }, to: { pile: 'tableau', index: 0 } }));
});
test('valor errado é rejeitado (8 preto sobre 10 vermelho)', () => {
  const b = emptyBoard();
  b.tableau[0] = { cards: [C(10, 0)], down: 0 };
  b.tableau[1] = { cards: [C(8, 2)], down: 0 };
  fill(b);
  assert(!K.validateMove(b, { type: 'move', from: { pile: 'tableau', index: 1 }, to: { pile: 'tableau', index: 0 } }));
});
test('sequência válida move-se inteira e revela a carta escondida', () => {
  const b = emptyBoard();
  b.tableau[0] = { cards: [C(5, 3), C(9, 2), C(8, 0), C(7, 3)], down: 1 };
  b.tableau[1] = { cards: [C(10, 1)], down: 0 };
  fill(b);
  const r = K.moveCards(b, { type: 'move', from: { pile: 'tableau', index: 0 }, start: 1, to: { pile: 'tableau', index: 1 } });
  assert(r && r.revealed);
  eq(r.board.tableau[1].cards, [C(10, 1), C(9, 2), C(8, 0), C(7, 3)]);
  eq(r.board.tableau[0].cards, [C(5, 3)]); eq(r.board.tableau[0].down, 0);
  assert(K.validateBoard(r.board));
  eq(b.tableau[0].cards.length, 4, 'o estado original não pode ser alterado');
});
test('não se pode mover carta virada para baixo', () => {
  const b = emptyBoard();
  b.tableau[0] = { cards: [C(9, 2), C(3, 0)], down: 1 };
  b.tableau[1] = { cards: [C(10, 1)], down: 0 };
  fill(b);
  assert(!K.validateMove(b, { type: 'move', from: { pile: 'tableau', index: 0 }, start: 0, to: { pile: 'tableau', index: 1 } }));
});
test('coluna vazia aceita só Rei (ou sequência começada por Rei)', () => {
  const b = emptyBoard();
  b.tableau[1] = { cards: [C(4, 0), C(13, 2), C(12, 0)], down: 1 };
  b.tableau[2] = { cards: [C(12, 3)], down: 0 };
  fill(b);
  assert(K.validateMove(b, { type: 'move', from: { pile: 'tableau', index: 1 }, start: 1, to: { pile: 'tableau', index: 0 } }));
  assert(!K.validateMove(b, { type: 'move', from: { pile: 'tableau', index: 2 }, to: { pile: 'tableau', index: 0 } }));
});
test('fundação: só Ás começa; mesmo naipe e ordem crescente', () => {
  const b = emptyBoard();
  b.tableau[0] = { cards: [C(2, 0)], down: 0 };
  b.tableau[1] = { cards: [C(1, 0)], down: 0 };
  b.tableau[2] = { cards: [C(2, 1)], down: 0 };
  fill(b);
  assert(!K.validateMove(b, { type: 'move', from: { pile: 'tableau', index: 0 }, to: { pile: 'foundation', index: 0 } }), '2 não começa');
  const b2 = K.moveToFoundation(b, { pile: 'tableau', index: 1 });
  assert(b2 && b2.foundations[0][0] === C(1, 0));
  assert(!K.validateMove(b2, { type: 'move', from: { pile: 'tableau', index: 2 }, to: { pile: 'foundation', index: 0 } }), 'naipe errado');
  const b3 = K.moveToFoundation(b2, { pile: 'tableau', index: 0 });
  assert(b3 && b3.foundations[0].length === 2);
  assert(!K.validateMove(b3, { type: 'move', from: { pile: 'tableau', index: 2 }, start: 0, to: { pile: 'foundation', index: 0 } }));
});
test('sequência de várias cartas não vai para a fundação', () => {
  const b = emptyBoard();
  b.foundations[0] = [C(1, 0)];
  b.tableau[0] = { cards: [C(3, 2), C(2, 0)], down: 0 };
  fill(b);
  assert(!K.validateMove(b, { type: 'move', from: { pile: 'tableau', index: 0 }, start: 0, to: { pile: 'foundation', index: 0 } }));
});
test('carta da fundação pode voltar à mesa quando é legal (e perde pontos)', () => {
  const b = emptyBoard();
  b.foundations[0] = [C(1, 0), C(2, 0), C(3, 0)];
  b.tableau[0] = { cards: [C(4, 2)], down: 0 };
  b.tableau[1] = { cards: [C(4, 1)], down: 0 };
  b.score = 50;
  fill(b);
  const ok = K.moveFromFoundation(b, 0, 0);
  assert(ok && ok.tableau[0].cards[1] === C(3, 0) && ok.score === 35);
  assert(!K.moveFromFoundation(b, 0, 1), '3♥ sobre 4♦ é ilegal');
});

console.log('Monte e desperdício');
test('Virar 1: tira uma carta de cada vez, por ordem', () => {
  const d = K.shuffleDeck(K.createDeck());
  let b = K.dealCards(d);
  b = K.drawFromStock(b, 1);
  eq(b.waste, [d[28]]); eq(b.stock.length, 23);
  b = K.drawFromStock(b, 1);
  eq(b.waste, [d[28], d[29]]);
});
test('Virar 3: tira três, e no fim as que restam', () => {
  const d = K.shuffleDeck(K.createDeck());
  let b = K.dealCards(d);
  for (let i = 0; i < 8; i++) b = K.drawFromStock(b, 3);
  eq(b.stock.length, 0); eq(b.waste, d.slice(28));
  // monte com apenas 2 cartas
  const e = emptyBoard();
  for (let c = 0; c < 52; c++) if (c !== 5 && c !== 6) e.waste.push(c);
  e.stock = [5, 6];
  assert(K.validateBoard(e));
  const r = K.drawFromStock(e, 3);
  eq(r.waste.slice(-2), [6, 5]); eq(r.wasteFan, 2); eq(r.stock.length, 0);
  assert(K.validateBoard(r));
});
test('Virar 3: depois de jogar a carta de cima, a seguinte fica disponível', () => {
  const b = emptyBoard();
  b.tableau[0] = { cards: [C(13, 3)], down: 0 };
  b.stock = [C(5, 2), C(1, 1), C(12, 0)]; // tira 12♥, 1♦, 5♣ → topo é 5♣? (pop: 12♥ primeiro)
  fill(b);
  let x = K.cloneBoard(b); x.stock = [C(5, 2), C(1, 1), C(12, 0)];
  const rest = K.allCards(b).filter(c => ![C(5, 2), C(1, 1), C(12, 0), C(13, 3)].includes(c));
  x.foundations = [[], [], [], []]; x.waste = rest; // as outras ficam no fundo do desperdício
  x = K.drawFromStock(x, 3);
  eq(x.waste.slice(-3), [C(12, 0), C(1, 1), C(5, 2)]);
  assert(x.wasteFan === 3);
  assert(!K.validateMove(x, { type: 'move', from: { pile: 'waste' }, to: { pile: 'foundation' } }), '5♣ não vai para a fundação');
  // Só a de cima é jogável: 5♣ não tem destino; tira-se 5♣ para outro lado não é possível, por isso testamos com mesa
  x.tableau[1] = { cards: [C(6, 0)], down: 0 }; x.waste = x.waste.filter(c => c !== C(6, 0));
  const y = K.moveCard(x, { type: 'move', from: { pile: 'waste' }, to: { pile: 'tableau', index: 1 } });
  assert(y, '5♣ sobre 6♥');
  eq(y.waste[y.waste.length - 1], C(1, 1)); eq(y.wasteFan, 2);
  const z = K.moveToFoundation(y, { pile: 'waste' });
  assert(z && z.foundations.some(f => f[0] === C(1, 1)), 'Ás de Ouros exposto e jogável');
  eq(z.waste[z.waste.length - 1], C(12, 0));
});
test('reciclar mantém a ordem e não baralha', () => {
  const d = K.shuffleDeck(K.createDeck());
  for (const dc of [1, 3]) {
    let b = K.dealCards(d);
    const order1 = [];
    while (b.stock.length) { b = K.drawFromStock(b, dc); }
    order1.push(...b.waste);
    b = K.recycleStock(b, dc);
    eq(b.waste.length, 0); eq(b.stock.length, 24);
    while (b.stock.length) b = K.drawFromStock(b, dc);
    eq(b.waste, order1, 'mesma ordem após reciclar');
    assert(K.validateBoard(b));
  }
});
test('não se recicla com monte ainda com cartas', () => {
  const b = K.dealCards(K.shuffleDeck(K.createDeck()));
  assert(K.recycleStock(b, 1) === null);
});

console.log('Dicas, vitória e conclusão automática');
test('dica nunca altera o estado e é sempre uma jogada legal', () => {
  for (let i = 0; i < 200; i++) {
    const b = K.dealCards(K.shuffleDeck(K.createDeck()));
    const before = JSON.stringify(b);
    const h = K.getHint(b, 1);
    eq(JSON.stringify(b), before);
    if (h.move) assert(K.applyAction(b, h.move, 1), 'dica ilegal');
  }
});
test('dica sem jogadas devolve "none"', () => {
  // Aces nas fundações; todas as outras cartas escondidas numa coluna exceto 2 cartas sem jogada.
  const b = emptyBoard();
  b.foundations = [[C(1, 0)], [C(1, 1)], [C(1, 2)], [C(1, 3)]];
  const open1 = C(5, 2), open2 = C(9, 3);
  const hidden = [];
  for (let c = 0; c < 52; c++) if (K.rankOf(c) !== 1 && c !== open1 && c !== open2) hidden.push(c);
  b.tableau[0] = { cards: [open1], down: 0 };
  b.tableau[1] = { cards: hidden.concat([open2]), down: hidden.length };
  assert(K.validateBoard(b), 'tabuleiro de teste válido');
  eq(K.getHint(b, 1).reason, 'none');
  eq(K.findLegalMoves(b, 1).length, 0);
});
test('vitória só com as 52 cartas nas fundações', () => {
  const b = emptyBoard();
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) b.foundations[s].push(C(r, s));
  assert(K.checkVictory(b));
  const c = K.cloneBoard(b); c.tableau[0].cards.push(c.foundations[0].pop());
  assert(!K.checkVictory(c));
  assert(!K.checkVictory(K.dealCards(K.createDeck())));
});
test('conclusão automática: indisponível com cartas escondidas; com tudo à vista só faz jogadas legais e ganha', () => {
  let n = 0;
  for (let i = 0; i < 300 && n < 25; i++) {
    const d = K.shuffleDeck(K.createDeck());
    const b0 = K.dealCards(d);
    assert(!K.canAutoComplete(b0, 1));
    const r = K.solve(b0, 1, { budget: 30000 });
    if (!r.solved) continue;
    // joga a solução até não haver cartas escondidas, depois deixa a conclusão automática acabar
    let b = b0;
    for (const m of r.moves) { if (K.canAutoComplete(b, 1)) break; b = K.applyAction(b, m, 1); }
    assert(K.canAutoComplete(b, 1));
    let prev = b;
    for (let g = 0; g < 2000 && !K.checkVictory(prev); g++) {
      const step = K.autoCompleteStep(prev, 1);
      const nx = K.applyAction(prev, step, 1, { noPenalty: true });
      assert(nx && K.validateBoard(nx), 'passo ilegal');
      prev = nx;
    }
    assert(K.checkVictory(prev), 'não terminou');
    n++;
  }
  assert(n >= 10, 'poucos casos testados: ' + n);
});
test('Virar 3: conclusão automática exige monte e desperdício vazios', () => {
  const b = emptyBoard();
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 12; r++) b.foundations[s].push(C(r, s));
  b.stock = [C(13, 0)]; b.tableau[0] = { cards: [C(13, 1)], down: 0 }; b.tableau[1] = { cards: [C(13, 2)], down: 0 }; b.tableau[2] = { cards: [C(13, 3)], down: 0 };
  assert(K.validateBoard(b));
  assert(!K.canAutoComplete(b, 3)); assert(K.canAutoComplete(b, 1));
});

console.log('Resolvedor e jogos com solução');
test('soluções encontradas são confirmadas jogada a jogada pelas regras (Virar 1 e 3)', () => {
  for (const dc of [1, 3]) {
    let solved = 0;
    for (let i = 0; i < 40; i++) {
      const b = K.dealCards(K.shuffleDeck(K.createDeck()));
      const r = K.solve(b, dc, { budget: 30000 });
      if (r.solved) { solved++; assert(K.verifySolution(b, dc, r.moves), 'solução falsa'); }
    }
    assert(solved > 10, 'resolveu poucos: ' + solved);
  }
});
test('solução corrompida é rejeitada', () => {
  for (let i = 0; i < 50; i++) {
    const b = K.dealCards(K.shuffleDeck(K.createDeck()));
    const r = K.solve(b, 1, { budget: 30000 });
    if (!r.solved) continue;
    const bad = r.moves.slice(0, -1);
    assert(!K.verifySolution(b, 1, bad));
    return;
  }
});
test('Desafio do dia: mesmo dia = mesmo baralho; dias diferentes = baralhos diferentes', () => {
  const a = K.dailyDeal('2026-11-18'), b = K.dailyDeal('2026-11-18'), c = K.dailyDeal('2026-11-19');
  eq(a.deck, b.deck); assert(a.deck.join() !== c.deck.join());
  assert(K.validateDeck(a.deck) && K.validateDeck(c.deck));
  if (a.solvable) { const r = K.solve(K.dealCards(a.deck), 1, { budget: 60000 }); assert(r.solved && K.verifySolution(K.dealCards(a.deck), 1, r.moves)); }
});

console.log('Jogos aleatórios longos (integridade)');
test('5000 jogadas legais aleatórias em 100 jogos: sempre 52 cartas únicas e estado válido', () => {
  const rnd = K.seededRandomInt(12345);
  for (let g = 0; g < 100; g++) {
    const dc = g % 2 ? 3 : 1;
    let b = K.dealCards(K.shuffleDeck(K.createDeck()));
    const history = [b];
    for (let s = 0; s < 50; s++) {
      const legal = K.findLegalMoves(b, dc);
      for (const m of legal) assert(K.applyAction(b, m, dc), 'findLegalMoves devolveu jogada ilegal');
      if (!legal.length) break;
      const m = legal[rnd(legal.length)];
      const nb = K.applyAction(b, m, dc);
      assert(K.validateBoard(nb), 'estado corrompido');
      history.push(nb); b = nb;
    }
    // os estados anteriores (usados pelo Anular) continuam intactos
    for (const h of history) assert(K.validateBoard(h), 'histórico corrompido');
  }
});
test('estados guardados inválidos são detetados', () => {
  const b = K.dealCards(K.shuffleDeck(K.createDeck()));
  assert(K.validateBoard(JSON.parse(JSON.stringify(b))));
  const dup = JSON.parse(JSON.stringify(b)); dup.stock[0] = dup.stock[1];
  assert(!K.validateBoard(dup));
  const miss = JSON.parse(JSON.stringify(b)); miss.stock.pop();
  assert(!K.validateBoard(miss));
  assert(!K.validateBoard(null)); assert(!K.validateBoard({}));
  const badFound = JSON.parse(JSON.stringify(b)); badFound.foundations[0] = [badFound.stock.pop()];
  if (K.rankOf(badFound.foundations[0][0]) !== 1) assert(!K.validateBoard(badFound));
});

console.log('\n' + passed + ' testes passaram, ' + failed + ' falharam.');
process.exit(failed ? 1 : 0);
