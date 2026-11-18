# Solitário da Avó

Paciência (Klondike) para jogar no telemóvel, com cartas e botões grandes, toda em português de Portugal.
Funciona sem Internet depois de aberta, sem contas, sem anúncios e sem servidor.

## Como pôr o jogo no telemóvel Android da avó (grátis, sem conta para ela)

Este repositório já traz a versão pronta a instalar na pasta `docs/`. Basta ligar o GitHub Pages uma vez:

1. No GitHub, abra este repositório e toque em **Settings** (Definições).
2. No menu da esquerda, escolha **Pages**.
3. Em **Branch**, escolha o ramo onde está o jogo (por exemplo `main` ou `claude/laughing-mccarthy-1zpkzg`), a pasta **/docs**, e carregue em **Save**.
4. Espere 1 a 2 minutos. Aparece um endereço do género `https://O-SEU-NOME.github.io/Solit-rio-/`.
   - O repositório tem de ser **público** para o GitHub Pages ser gratuito.
5. No telemóvel da avó, abra esse endereço no **Chrome**.
6. Toque nos **três pontinhos** (⋮, em cima à direita) e escolha **Instalar aplicação** (em alguns telemóveis aparece **Adicionar ao ecrã principal**). Confirme em **Instalar**.
   - Às vezes o próprio Chrome mostra em baixo um aviso «Adicionar Solitário ao ecrã principal»: também serve.
7. Aparece um ícone «Solitário» no ecrã e na lista de aplicações. Abre em ecrã inteiro e funciona mesmo sem Internet.
   - Na versão instalada, o botão **voltar** do Android fecha os menus em vez de sair do jogo.

Num telemóvel Samsung com o navegador **Samsung Internet**: toque em **☰** (em baixo à direita) → **Adicionar página a** → **Ecrã principal**.

No iPhone: abra no **Safari** → **Partilhar** → **Adicionar ao ecrã principal**.

O jogo guarda-se sozinho no próprio telemóvel. Se os dados do site forem apagados no navegador (ou a aplicação for desinstalada), o jogo guardado e as estatísticas também se apagam.
Não há sincronização entre aparelhos: cada telemóvel tem o seu jogo.

## O que o jogo tem

- Regras completas de Klondike: 52 cartas, 7 colunas, monte e desperdício, 4 fundações, Virar 1 ou Virar 3, reciclagem do monte sem baralhar.
- Baralhar verdadeiramente aleatório (Fisher–Yates com `crypto.getRandomValues`).
- **Jogos com solução garantida** (opção predefinida): antes de dar as cartas, um resolvedor encontra uma solução e essa solução é confirmada jogada a jogada pelas regras do jogo. Se não conseguir confirmar a tempo, o jogo é dado como «ao acaso» e isso é dito à jogadora.
- Tocar numa carta move-a sozinha para o melhor sítio; também se pode arrastar; ou escolher «Escolho o destino» nas Definições.
- Anular sem limite, Dica (sempre uma jogada real), Recomeçar o mesmo jogo, Concluir automaticamente quando todas as cartas estão à vista.
- Guarda automaticamente o jogo, as definições e as estatísticas.
- Desafio do dia (o mesmo baralho durante o dia inteiro) com calendário dos dias concluídos.
- Definições: modo de jogo, tamanho das letras, cor da mesa, verso das cartas, som, animações, mão dominante, pontuação, tempo.

## Para quem quiser mexer no código

- `src/engine.js` — regras do jogo e resolvedor (sem interface).
- `src/app.js`, `src/style.css`, `src/shell.html` — interface.
- `node build.js` — gera `dist/solitario-da-avo.html` (versão Artifact do Claude) e `docs/` (versão instalável).
- `node tests/engine.test.js` — testes automáticos das regras.
