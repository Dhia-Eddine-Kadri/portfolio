// ── SOLITAIRE (Klondike) ──────────────────────────────────────────────────
(function () {
  var SUITS = ['\u2660', '\u2665', '\u2666', '\u2663']; // ♠♥♦♣
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var stock = [],
    waste = [],
    foundations = [[], [], [], []],
    tableau = [[], [], [], [], [], [], []];
  var selected = null,
    selectedFrom = null,
    moves = 0,
    solTimer = null,
    solSecs = 0;
  var touchGhost = null,
    touchInfo = null,
    touchDragging = false,
    touchStartX = 0,
    touchStartY = 0,
    touchHandled = false;
  var hintTimer = null,
    hintSeq = [],
    hintSeqIdx = 0;
  var history = []; // undo stack

  function isRed(s) {
    return s === '\u2665' || s === '\u2666';
  }

  // ── Sound ──
  function playCardSound(type) {
    try {
      var ac = new (window.AudioContext || window.webkitAudioContext)();
      if (type === 'shuffle') {
        for (var b = 0; b < 8; b++)
          (function (bi) {
            setTimeout(function () {
              var buf = ac.createBuffer(1, ac.sampleRate * 0.06, ac.sampleRate),
                d = buf.getChannelData(0);
              for (var i = 0; i < d.length; i++)
                d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2) * 0.4;
              var src = ac.createBufferSource();
              src.buffer = buf;
              var f = ac.createBiquadFilter();
              f.type = 'bandpass';
              f.frequency.value = 3000 + Math.random() * 2000;
              f.Q.value = 0.5;
              var g = ac.createGain();
              g.gain.value = 0.35;
              src.connect(f);
              f.connect(g);
              g.connect(ac.destination);
              src.start();
            }, bi * 80);
          })(b);
      } else if (type === 'place') {
        var buf = ac.createBuffer(1, ac.sampleRate * 0.04, ac.sampleRate),
          d = buf.getChannelData(0);
        for (var i = 0; i < d.length; i++)
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3) * 0.5;
        var src = ac.createBufferSource();
        src.buffer = buf;
        var f = ac.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 1800;
        var g = ac.createGain();
        g.gain.value = 0.4;
        src.connect(f);
        f.connect(g);
        g.connect(ac.destination);
        src.start();
      } else if (type === 'flip') {
        var buf = ac.createBuffer(1, ac.sampleRate * 0.03, ac.sampleRate),
          d = buf.getChannelData(0);
        for (var i = 0; i < d.length; i++)
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2) * 0.3;
        var src = ac.createBufferSource();
        src.buffer = buf;
        var g = ac.createGain();
        g.gain.value = 0.3;
        src.connect(g);
        g.connect(ac.destination);
        src.start();
      } else if (type === 'win') {
        // Rising chime: 4 ascending tones
        var notes = [523, 659, 784, 1047];
        notes.forEach(function (freq, ni) {
          setTimeout(function () {
            var osc = ac.createOscillator(),
              g = ac.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            g.gain.setValueAtTime(0, ac.currentTime);
            g.gain.linearRampToValueAtTime(0.35, ac.currentTime + 0.04);
            g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.45);
            osc.connect(g);
            g.connect(ac.destination);
            osc.start();
            osc.stop(ac.currentTime + 0.5);
          }, ni * 130);
        });
      }
    } catch (e) {}
  }

  // ── Deck / Deal ──
  function shuffle(d) {
    for (var i = d.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = d[i];
      d[i] = d[j];
      d[j] = t;
    }
    return d;
  }

  function buildDeck() {
    var d = [];
    SUITS.forEach(function (s) {
      RANKS.forEach(function (r, i) {
        d.push({ suit: s, rank: r, value: i + 1, faceUp: false });
      });
    });
    return shuffle(d);
  }

  // ── Omniscient solver: checks if a deal is winnable with full card knowledge ──
  function quickSolvable(tab0, stk0) {
    try {
      // Encode cards as integers 0-51 (suit*13 + value-1)
      function sv(e) {
        return Math.floor(e / 13);
      }
      function vv(e) {
        return (e % 13) + 1;
      }
      function rv(e) {
        var s = sv(e);
        return s === 1 || s === 2;
      } // red: ♥=1,♦=2

      var tab = tab0.map(function (p) {
        return p.map(function (c) {
          return SUITS.indexOf(c.suit) * 13 + (c.value - 1);
        });
      });
      var stk = stk0.map(function (c) {
        return SUITS.indexOf(c.suit) * 13 + (c.value - 1);
      });
      var wst = [];
      var fnd = [0, 0, 0, 0];

      var visited = new Set();
      var nodes = 0;
      var LIMIT = 60000; // per-attempt cap — fast enough, still catches most solvable deals
      var MAXDEPTH = 160; // prevent call-stack overflow

      function key() {
        // Lightweight key: foundation counts + tableau sizes/tops + stock length + waste top
        var k = fnd[0] + '' + fnd[1] + '' + fnd[2] + '' + fnd[3];
        for (var i = 0; i < 7; i++) {
          var p = tab[i];
          k += '|' + (p.length ? p[p.length - 1] : '-');
          // include buried cards' count so different hidden layouts aren't conflated
          k += ':' + p.length;
        }
        k += '|s' + stk.length + 'w' + (wst.length ? wst[wst.length - 1] : '-');
        return k;
      }

      function dfs(depth) {
        if (nodes++ > LIMIT || depth > MAXDEPTH) return false;
        if (fnd[0] + fnd[1] + fnd[2] + fnd[3] === 52) return true;
        var k = key();
        if (visited.has(k)) return false;
        visited.add(k);

        // Auto-play safe foundations first (deterministic, no branching needed)
        var changed = true;
        while (changed) {
          changed = false;
          if (wst.length) {
            var wc = wst[wst.length - 1];
            if (vv(wc) === fnd[sv(wc)] + 1) {
              wst.pop();
              fnd[sv(wc)]++;
              changed = true;
            }
          }
          for (var t = 0; t < 7; t++) {
            if (!tab[t].length) continue;
            var tc = tab[t][tab[t].length - 1];
            if (vv(tc) === fnd[sv(tc)] + 1) {
              tab[t].pop();
              fnd[sv(tc)]++;
              changed = true;
            }
          }
        }
        if (fnd[0] + fnd[1] + fnd[2] + fnd[3] === 52) return true;

        var mvs = [];

        // Tableau → tableau
        for (var fr = 0; fr < 7; fr++) {
          if (!tab[fr].length) continue;
          var cs = tab[fr].length - 1;
          while (cs > 0) {
            var aa = tab[fr][cs - 1],
              bb = tab[fr][cs];
            if (vv(bb) === vv(aa) - 1 && rv(bb) !== rv(aa)) cs--;
            else break;
          }
          for (var ci2 = cs; ci2 < tab[fr].length; ci2++) {
            var card = tab[fr][ci2];
            for (var to2 = 0; to2 < 7; to2++) {
              if (fr === to2) continue;
              var ok = false;
              if (!tab[to2].length) ok = vv(card) === 13 && ci2 > 0;
              else {
                var tt2 = tab[to2][tab[to2].length - 1];
                ok = vv(card) === vv(tt2) - 1 && rv(card) !== rv(tt2);
              }
              if (ok) {
                var pr = (ci2 > 0 ? 40 : 15) + (tab[to2].length ? 10 : 0);
                mvs.push([pr, 2, fr, ci2, to2]);
              }
            }
          }
        }

        // Waste → tableau
        if (wst.length) {
          var wc2 = wst[wst.length - 1];
          for (var to3 = 0; to3 < 7; to3++) {
            var ok = false;
            if (!tab[to3].length) ok = vv(wc2) === 13;
            else {
              var tt3 = tab[to3][tab[to3].length - 1];
              ok = vv(wc2) === vv(tt3) - 1 && rv(wc2) !== rv(tt3);
            }
            if (ok) mvs.push([tab[to3].length ? 25 : 4, 3, to3]);
          }
        }

        // Draw / recycle
        if (stk.length) mvs.push([2, 4]);
        else if (wst.length > 1) mvs.push([1, 5]);

        mvs.sort(function (a, b) {
          return b[0] - a[0];
        });

        for (var mi = 0; mi < mvs.length; mi++) {
          var mv = mvs[mi],
            type = mv[1];
          // Save/restore state for each branch
          var fndSnap = fnd.slice();
          var tabSnap = tab.map(function (p) {
            return p.slice();
          });
          var stkSnap = stk.slice();
          var wstSnap = wst.slice();

          if (type === 2) {
            var seq = tab[mv[2]].splice(mv[3]);
            tab[mv[4]] = tab[mv[4]].concat(seq);
          } else if (type === 3) {
            var c3 = wst.pop();
            tab[mv[2]].push(c3);
          } else if (type === 4) {
            wst.push(stk.pop());
          } else if (type === 5) {
            // recycle: waste→stock (draw-1: waste reversed becomes new stock)
            while (wst.length) stk.push(wst.pop());
          }

          if (dfs(depth + 1)) return true;

          // Restore
          fnd = fndSnap;
          tab = tabSnap;
          stk = stkSnap;
          wst = wstSnap;
        }
        return false;
      }
      return dfs(0);
    } catch (e) {
      return false;
    }
  }

  function deal() {
    // Try up to 50 shuffles; use first one the solver confirms is winnable
    var chosenTab = null,
      chosenStk = null;
    var deadline = Date.now() + 1800; // 1800 ms total budget
    for (var attempt = 0; attempt < 200; attempt++) {
      if (Date.now() > deadline) break;
      var deckD = buildDeck();
      var tabD = [[], [], [], [], [], [], []];
      var copyD = deckD.slice();
      for (var tD = 0; tD < 7; tD++)
        for (var cD = 0; cD <= tD; cD++) {
          var cardD = copyD.pop();
          cardD.faceUp = cD === tD;
          tabD[tD].push(cardD);
        }
      var stkD = copyD.slice();
      if (quickSolvable(tabD, stkD)) {
        chosenTab = tabD;
        chosenStk = stkD;
        break;
      }
    }
    if (!chosenTab) {
      var deckD = buildDeck();
      var tabD = [[], [], [], [], [], [], []];
      var copyD = deckD.slice();
      for (var tD = 0; tD < 7; tD++)
        for (var cD = 0; cD <= tD; cD++) {
          var cardD = copyD.pop();
          cardD.faceUp = cD === tD;
          tabD[tD].push(cardD);
        }
      chosenTab = tabD;
      chosenStk = copyD.slice();
    }
    stock = chosenStk;
    waste = [];
    foundations = [[], [], [], []];
    tableau = chosenTab;
    selected = null;
    selectedFrom = null;
    moves = 0;
    solSecs = 0;
    hintSeq = [];
    hintSeqIdx = 0;
    history = [];
    var nb = document.getElementById('solNoMovesBanner');
    if (nb) nb.style.display = 'none';
    document.getElementById('solMoves').textContent = '0';
    document.getElementById('solTime').textContent = '0:00';
    clearInterval(solTimer);
    solTimer = setInterval(function () {
      solSecs++;
      var m = Math.floor(solSecs / 60),
        s = solSecs % 60;
      document.getElementById('solTime').textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
  }

  // ── Rules ──
  function canPlaceTab(card, pile) {
    if (!pile.length) return card.rank === 'K';
    var top = pile[pile.length - 1];
    return top.faceUp && card.value === top.value - 1 && isRed(card.suit) !== isRed(top.suit);
  }
  function canPlaceAnyFound(card) {
    for (var f = 0; f < 4; f++) if (canPlaceFound(card, foundations[f], f)) return f;
    return -1;
  }
  function canPlaceFound(card, pile, si) {
    if (card.suit !== SUITS[si]) return false;
    return pile.length === 0 ? card.rank === 'A' : card.value === pile[pile.length - 1].value + 1;
  }

  function checkWin() {
    if (
      foundations.every(function (f) {
        return f.length === 13;
      })
    ) {
      clearInterval(solTimer);
      history = [];
      updateUndoBtn();
      setTimeout(function () {
        _solWinOverlay(moves, 'window._klondikeNewGame');
      }, 300);
    }
  }

  // ── Undo ──
  function cloneCard(c) {
    return { suit: c.suit, rank: c.rank, value: c.value, faceUp: c.faceUp };
  }
  function captureState() {
    return {
      stock: stock.map(cloneCard),
      waste: waste.map(cloneCard),
      foundations: foundations.map(function (f) {
        return f.map(cloneCard);
      }),
      tableau: tableau.map(function (p) {
        return p.map(cloneCard);
      }),
      moves: moves,
      solSecs: solSecs
    };
  }
  function saveHistory() {
    history.push(captureState());
    if (history.length > 200) history.shift();
    updateUndoBtn();
  }
  function updateUndoBtn() {
    var btn = document.getElementById('solitaireUndo');
    if (btn) {
      btn.disabled = !history.length;
      btn.style.opacity = history.length ? '1' : '.4';
    }
  }
  function undo() {
    if (!history.length) return;
    var prev = history.pop();
    stock = prev.stock;
    waste = prev.waste;
    foundations = prev.foundations;
    tableau = prev.tableau;
    moves = prev.moves;
    solSecs = prev.solSecs;
    selected = null;
    selectedFrom = null;
    document.getElementById('solMoves').textContent = moves;
    var m = Math.floor(solSecs / 60),
      s = solSecs % 60;
    document.getElementById('solTime').textContent = m + ':' + (s < 10 ? '0' : '') + s;
    updateUndoBtn();
    clearHints();
    render();
  }

  // ── Auto-play safe cards to foundation ──
  // A card is "safe" when both opposite-color suits of value-1 are already on foundation
  // (meaning it can never be needed as a stepping stone on the tableau)
  function isSafeToFoundation(card) {
    if (card.value <= 2) return true; // Aces and 2s are always safe
    var needed = card.value - 1;
    var opposites = isRed(card.suit) ? ['\u2660', '\u2663'] : ['\u2665', '\u2666'];
    return opposites.every(function (os) {
      var fi = SUITS.indexOf(os);
      return fi >= 0 && foundations[fi].length >= needed;
    });
  }
  function autoPlaySafe() {
    var changed = true;
    while (changed) {
      changed = false;
      // Check waste
      if (waste.length && isSafeToFoundation(waste[waste.length - 1])) {
        var fi = canPlaceAnyFound(waste[waste.length - 1]);
        if (fi >= 0) {
          foundations[fi].push(waste.pop());
          moves++;
          changed = true;
          continue;
        }
      }
      // Check tableau tops
      for (var t = 0; t < 7; t++) {
        if (!tableau[t].length) continue;
        var top = tableau[t][tableau[t].length - 1];
        if (top.faceUp && isSafeToFoundation(top)) {
          var fi = canPlaceAnyFound(top);
          if (fi >= 0) {
            foundations[fi].push(tableau[t].pop());
            var tp = tableau[t];
            if (tp.length && !tp[tp.length - 1].faceUp) {
              tp[tp.length - 1].faceUp = true;
              playCardSound('flip');
            }
            moves++;
            changed = true;
            break;
          }
        }
      }
    }
  }

  // Auto-complete: when stock empty, waste empty, and all tableau face-up → animate cards to foundations
  var _acRunning = false;
  function canAutoComplete() {
    if (_acRunning) return false;
    if (stock.length || waste.length) return false;
    var hasCard = false;
    for (var t = 0; t < 7; t++) {
      for (var c = 0; c < tableau[t].length; c++) {
        var card = tableau[t][c];
        if (!card.faceUp) return false; // hidden card → not ready
        if (card.value < 10) return false; // card below 10 still on board → not ready
        hasCard = true;
      }
    }
    return hasCard;
  }
  function tryAutoComplete() {
    if (_acRunning || !canAutoComplete()) return;
    _acRunning = true;
    function step() {
      // Find lowest-value moveable card across all tableau tops
      var best = null,
        bestT = -1,
        bestFi = -1;
      for (var t = 0; t < 7; t++) {
        if (!tableau[t].length) continue;
        var top = tableau[t][tableau[t].length - 1];
        var fi = canPlaceAnyFound(top);
        if (fi >= 0 && (!best || top.value < best.value)) {
          best = top;
          bestT = t;
          bestFi = fi;
        }
      }
      if (!best) {
        _acRunning = false;
        render();
        checkWin();
        return;
      }
      // Snap source card before removing
      var cols = document.querySelectorAll('#solTable .sol-tab-pile');
      var srcEl = cols[bestT]
        ? cols[bestT].querySelector('.sol-card:last-child') ||
          cols[bestT].querySelectorAll('.sol-card')[
            cols[bestT].querySelectorAll('.sol-card').length - 1
          ] ||
          null
        : null;
      var srcRect = srcEl ? srcEl.getBoundingClientRect() : null;
      // Move card to foundation
      foundations[bestFi].push(tableau[bestT].pop());
      moves++;
      document.getElementById('solMoves').textContent = moves;
      playCardSound('place');
      render();
      // Fly animation to foundation slot
      if (srcRect) {
        var fndEls = document.querySelectorAll('#solTable .sol-pile-foundation');
        var dstEl = fndEls[bestFi] || null;
        if (dstEl)
          _solFly(
            srcRect,
            best.rank + ' ' + best.suit,
            'sol-card ' + (isRed(best.suit) ? 'red' : 'black'),
            '#solTable .sol-pile-foundation[data-idx="' + bestFi + '"]',
            260
          );
      }
      setTimeout(step, 180);
    }
    setTimeout(step, 200);
  }

  function hasAnyMove() {
    // Any stock card to draw or waste to recycle?
    if (stock.length || waste.length > 1) return true;
    // Any waste→foundation or waste→tableau?
    if (waste.length) {
      var wc = waste[waste.length - 1];
      if (canPlaceAnyFound(wc) >= 0) return true;
      for (var t = 0; t < 7; t++) if (canPlaceTab(wc, tableau[t])) return true;
    }
    // Any tableau move?
    for (var ti = 0; ti < 7; ti++) {
      var pile = tableau[ti];
      if (!pile.length) continue;
      var top = pile[pile.length - 1];
      if (!top.faceUp) continue;
      if (canPlaceAnyFound(top) >= 0) return true;
      for (var ci = pile.length - 1; ci >= 0; ci--) {
        if (!pile[ci].faceUp) break;
        for (var tj = 0; tj < 7; tj++) {
          if (ti === tj) continue;
          if (canPlaceTab(pile[ci], tableau[tj])) return true;
        }
      }
    }
    return false;
  }

  function checkNoMoves() {
    if (
      foundations.every(function (f) {
        return f.length === 13;
      })
    )
      return; // already won
    if (hasAnyMove()) return;
    clearInterval(solTimer);
    var banner = document.getElementById('solNoMovesBanner');
    if (banner) banner.style.display = 'flex';
  }

  function afterMove() {
    document.getElementById('solMoves').textContent = moves;
    render();
    checkWin();
    checkNoMoves();
    tryAutoComplete();
  }

  function removeSelected() {
    if (!selectedFrom) return;
    if (selectedFrom.type === 'waste') waste.pop();
    else if (selectedFrom.type === 'tableau') {
      tableau[selectedFrom.idx].splice(selectedFrom.cardIdx);
      var tp = tableau[selectedFrom.idx];
      if (tp.length && !tp[tp.length - 1].faceUp) {
        tp[tp.length - 1].faceUp = true;
        playCardSound('flip');
      }
    }
  }

  function tryPlace(dstType, dstIdx) {
    if (!selected || !selected.length) return false;
    if (dstType === 'tableau') {
      if (canPlaceTab(selected[0], tableau[dstIdx])) {
        saveHistory();
        removeSelected();
        selected.forEach(function (c) {
          tableau[dstIdx].push(c);
        });
        moves++;
        playCardSound('place');
        selected = null;
        selectedFrom = null;
        afterMove();
        return true;
      }
    } else if (dstType === 'foundation' && selected.length === 1) {
      if (canPlaceFound(selected[0], foundations[dstIdx], dstIdx)) {
        saveHistory();
        removeSelected();
        foundations[dstIdx].push(selected[0]);
        moves++;
        playCardSound('place');
        selected = null;
        selectedFrom = null;
        afterMove();
        return true;
      }
    }
    return false;
  }

  // ── Click handler ──
  function handleClick(type, idx, cardIdx) {
    clearHints();
    if (type === 'stock') {
      saveHistory();
      if (stock.length) {
        var c = stock.pop();
        c.faceUp = true;
        waste.push(c);
        playCardSound('place');
      } else {
        while (waste.length) {
          var wc = waste.pop();
          wc.faceUp = false;
          stock.push(wc);
        }
      }
      selected = null;
      selectedFrom = null;
      render();
      updateUndoBtn();
      return;
    }
    if (type === 'waste') {
      if (!waste.length) return;
      if (selected && selectedFrom && selectedFrom.type === 'waste') {
        selected = null;
        selectedFrom = null;
        render();
        return;
      }
      selected = [waste[waste.length - 1]];
      selectedFrom = { type: 'waste' };
      render();
      return;
    }
    if (type === 'foundation') {
      if (selected && selected.length === 1) {
        if (tryPlace('foundation', idx)) return;
      }
      selected = null;
      selectedFrom = null;
      render();
      return;
    }
    if (type === 'tableau') {
      var pile = tableau[idx];
      if (selected) {
        if (selectedFrom.type === 'tableau' && selectedFrom.idx === idx) {
          selected = null;
          selectedFrom = null;
          render();
          return;
        }
        if (tryPlace('tableau', idx)) return;
        if (cardIdx !== undefined && pile[cardIdx] && pile[cardIdx].faceUp) {
          selected = pile.slice(cardIdx);
          selectedFrom = { type: 'tableau', idx: idx, cardIdx: cardIdx };
          render();
          return;
        }
        selected = null;
        selectedFrom = null;
        render();
        return;
      }
      if (cardIdx === undefined || !pile[cardIdx] || !pile[cardIdx].faceUp) return;
      selected = pile.slice(cardIdx);
      selectedFrom = { type: 'tableau', idx: idx, cardIdx: cardIdx };
      render();
    }
  }

  // ── Double-click: auto-move to foundation ──
  function handleDblClick(type, idx, cardIdx) {
    clearHints();
    var card = null;
    if (type === 'waste' && waste.length) card = waste[waste.length - 1];
    if (type === 'tableau' && tableau[idx].length) {
      var p = tableau[idx];
      if (cardIdx === p.length - 1 && p[cardIdx].faceUp) card = p[cardIdx];
    }
    if (!card) return;
    var fi = canPlaceAnyFound(card);
    if (fi < 0) return;
    saveHistory();
    if (type === 'waste') waste.pop();
    else {
      tableau[idx].pop();
      var tp = tableau[idx];
      if (tp.length && !tp[tp.length - 1].faceUp) tp[tp.length - 1].faceUp = true;
    }
    foundations[fi].push(card);
    moves++;
    playCardSound('place');
    selected = null;
    selectedFrom = null;
    afterMove();
  }

  // ── Smart Hint System ──────────────────────────────────────────────────────
  // Returns all playable moves from the current live state, scored by priority.
  // Scores:  foundation=100, reveals face-down=60+, tableau move=20, stock draw=5
  function getAllMoves(stk, wst, fnd, tab) {
    var moves = [];

    // Waste top card
    if (wst.length) {
      var wc = wst[wst.length - 1];
      var fi = canPlaceAnyFoundS(wc, fnd);
      if (fi >= 0)
        moves.push({
          type: 'move',
          srcType: 'waste',
          dstType: 'foundation',
          dstIdx: fi,
          score: 100
        });
      for (var t = 0; t < 7; t++)
        if (canPlaceTabS(wc, tab[t]))
          moves.push({ type: 'move', srcType: 'waste', dstType: 'tableau', dstIdx: t, score: 30 });
    }

    // Tableau
    for (var ti = 0; ti < 7; ti++) {
      var pile = tab[ti];
      if (!pile.length) continue;
      // Top card → foundation
      var top = pile[pile.length - 1];
      if (top.faceUp) {
        var fi = canPlaceAnyFoundS(top, fnd);
        if (fi >= 0)
          moves.push({
            type: 'move',
            srcType: 'tableau',
            srcIdx: ti,
            srcCardIdx: pile.length - 1,
            dstType: 'foundation',
            dstIdx: fi,
            score: 100
          });
      }
      // Sequences → other tableau piles
      for (var ci = 0; ci < pile.length; ci++) {
        if (!pile[ci].faceUp) continue;
        var seq = pile.slice(ci);
        for (var tj = 0; tj < 7; tj++) {
          if (ti === tj) continue;
          if (canPlaceTabS(seq[0], tab[tj])) {
            // Ignore moving a lone King to another empty pile — never helps
            if (seq[0].rank === 'K' && ci === 0 && !tab[tj].length) continue;
            // Bonus if this reveals a face-down card
            var revealsHidden = ci > 0 && !pile[ci - 1].faceUp ? 60 : 0;
            // Bonus if clearing the pile entirely (makes empty col)
            var clearsCol = ci === 0 && tab[tj].length > 0 ? 10 : 0;
            moves.push({
              type: 'move',
              srcType: 'tableau',
              srcIdx: ti,
              srcCardIdx: ci,
              dstType: 'tableau',
              dstIdx: tj,
              score: 20 + revealsHidden + clearsCol
            });
          }
        }
      }
    }

    // Sort best first
    moves.sort(function (a, b) {
      return b.score - a.score;
    });
    return moves;
  }

  function canPlaceTabS(card, pile) {
    if (!pile.length) return card.rank === 'K';
    var top = pile[pile.length - 1];
    return top.faceUp && card.value === top.value - 1 && isRed(card.suit) !== isRed(top.suit);
  }
  function canPlaceAnyFoundS(card, fnd) {
    for (var f = 0; f < 4; f++) {
      var p = fnd[f];
      if (card.suit !== SUITS[f]) continue;
      if (p.length === 0 ? card.rank === 'A' : card.value === p[p.length - 1].value + 1) return f;
    }
    return -1;
  }

  // Simulate cycling the stock to find the next playable card — returns draw-count or -1
  function stockSearchHint() {
    // Build a combined list: current waste (top=end) + stock (bottom-first)
    var combined = waste.slice().reverse().concat(stock.slice().reverse());
    // We'll simulate: each draw puts the top of combined into waste
    var simWaste = waste.slice(),
      simStock = stock.slice();
    var drawn = 0,
      maxDraws = combined.length + 1;
    while (drawn <= maxDraws) {
      // Check waste top
      if (simWaste.length) {
        var wc = simWaste[simWaste.length - 1];
        var fi = canPlaceAnyFoundS(wc, foundations);
        if (fi >= 0) return { draws: drawn, card: wc, targetType: 'foundation', targetIdx: fi };
        for (var t = 0; t < 7; t++)
          if (canPlaceTabS(wc, tableau[t]))
            return { draws: drawn, card: wc, targetType: 'tableau', targetIdx: t };
      }
      // Draw next from stock (or recycle)
      if (simStock.length) {
        var c = simStock.pop();
        c = Object.assign({}, c, { faceUp: true });
        simWaste.push(c);
        drawn++;
      } else if (simWaste.length) {
        simStock = simWaste
          .slice()
          .reverse()
          .map(function (x) {
            return Object.assign({}, x, { faceUp: false });
          });
        simWaste = [];
        drawn++;
      } else break;
    }
    return null; // truly no solution through stock
  }

  function clearHints() {
    clearTimeout(hintTimer);
    var table = document.getElementById('solTable');
    if (table)
      table.querySelectorAll('.sol-hint-src,.sol-hint-dst').forEach(function (x) {
        x.classList.remove('sol-hint-src', 'sol-hint-dst');
      });
  }

  function applyHintHighlight(hint) {
    if (!hint) return;
    var table = document.getElementById('solTable');
    if (!table) return;
    var srcEl = null,
      dstEl = null;
    if (hint.srcType === 'waste') srcEl = table.querySelector('[data-type="waste"] .sol-card');
    else if (hint.srcType === 'tableau')
      srcEl = table.querySelector(
        '[data-type="tableau"][data-idx="' + hint.srcIdx + '"][data-ci="' + hint.srcCardIdx + '"]'
      );
    if (hint.dstType === 'foundation')
      dstEl = table.querySelector('[data-type="foundation"][data-idx="' + hint.dstIdx + '"]');
    else if (hint.dstType === 'tableau') {
      var tp = tableau[hint.dstIdx];
      dstEl = tp.length
        ? table.querySelector(
            '[data-type="tableau"][data-idx="' +
              hint.dstIdx +
              '"][data-ci="' +
              (tp.length - 1) +
              '"]'
          )
        : table.querySelector('.sol-tab-pile[data-idx="' + hint.dstIdx + '"]');
    }
    if (srcEl) srcEl.classList.add('sol-hint-src');
    if (dstEl) dstEl.classList.add('sol-hint-dst');
    hintTimer = setTimeout(clearHints, 2500);
  }

  function showHint() {
    clearHints();
    var moves = getAllMoves(stock, waste, foundations, tableau);
    if (moves.length) {
      // Cycle through all available hints so repeated presses show different options
      var hint = moves[hintSeqIdx % moves.length];
      hintSeqIdx++;
      applyHintHighlight(hint);
      return;
    }
    // No direct moves — search through stock
    var stockHint = stockSearchHint();
    if (!stockHint) {
      // Truly stuck
      showToast('No moves left', 'No solution found \u2014 try a New Game');
      return;
    }
    if (stockHint.draws === 0) {
      // Waste top is playable — just highlight it
      var fi = canPlaceAnyFoundS(stockHint.card, foundations);
      var t = -1;
      if (fi < 0)
        for (var tj = 0; tj < 7; tj++)
          if (canPlaceTabS(stockHint.card, tableau[tj])) {
            t = tj;
            break;
          }
      applyHintHighlight({
        srcType: 'waste',
        dstType: fi >= 0 ? 'foundation' : 'tableau',
        dstIdx: fi >= 0 ? fi : t,
        srcIdx: 0,
        srcCardIdx: waste.length - 1
      });
      return;
    }
    // Need to draw from stock N times — auto-draw one step and re-highlight stock
    showToast(
      'Draw from stock',
      'Click the stock pile \u2014 ' +
        stockHint.draws +
        ' draw' +
        (stockHint.draws > 1 ? 's' : '') +
        ' needed'
    );
    var stockEl = document.querySelector('#solTable [data-type="stock"]');
    if (stockEl) {
      stockEl.classList.add('sol-hint-src');
      hintTimer = setTimeout(clearHints, 2500);
    }
  }

  // ── HTML5 Drag & Drop ──
  function onDragStart(e) {
    var el = e.target.closest('[data-type]');
    if (!el) return;
    var type = el.dataset.type,
      idx = parseInt(el.dataset.idx) || 0,
      ci = el.dataset.ci;
    var cardIdx = ci === 'empty' || ci === undefined ? undefined : parseInt(ci);
    if (type === 'waste' && waste.length) {
      selected = [waste[waste.length - 1]];
      selectedFrom = { type: 'waste' };
    } else if (type === 'tableau' && cardIdx !== undefined) {
      var pile = tableau[idx];
      if (!pile[cardIdx] || !pile[cardIdx].faceUp) {
        e.preventDefault();
        return;
      }
      selected = pile.slice(cardIdx);
      selectedFrom = { type: 'tableau', idx: idx, cardIdx: cardIdx };
    } else {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'sol');
    setTimeout(function () {
      el.style.opacity = '.4';
    }, 0);
  }

  function onDragOver(e) {
    e.preventDefault();
    var el = e.target.closest('[data-type]');
    if (!el || !selected) return;
    var type = el.dataset.type,
      idx = parseInt(el.dataset.idx) || 0;
    var valid =
      (type === 'tableau' && canPlaceTab(selected[0], tableau[idx])) ||
      (type === 'foundation' &&
        selected.length === 1 &&
        canPlaceFound(selected[0], foundations[idx], idx));
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    if (valid) {
      el.classList.add('sol-drop-hover');
      e.dataTransfer.dropEffect = 'move';
    } else e.dataTransfer.dropEffect = 'none';
  }

  function onDragLeave(e) {
    var el = e.target.closest('[data-type]');
    if (el) el.classList.remove('sol-drop-hover');
  }

  function onDrop(e) {
    e.preventDefault();
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    var el = e.target.closest('[data-type]');
    if (!el || !selected) return;
    tryPlace(el.dataset.type, parseInt(el.dataset.idx) || 0);
  }

  function onDragEnd(e) {
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    selected = null;
    selectedFrom = null;
    render();
  }

  // ── Touch Drag ──
  function removeTouchGhost() {
    if (touchGhost) {
      touchGhost.remove();
      touchGhost = null;
    }
  }

  function onTouchStart(e) {
    var el = e.target.closest('[data-type]');
    if (!el) return;
    var type = el.dataset.type,
      idx = parseInt(el.dataset.idx) || 0,
      ci = el.dataset.ci;
    var cardIdx = ci === 'empty' || ci === undefined ? undefined : parseInt(ci);
    if (type === 'stock') return;
    touchInfo = { type: type, idx: idx, cardIdx: cardIdx };
    touchDragging = false;
    var t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  }

  function onTouchMove(e) {
    if (!touchInfo) return;
    var t = e.touches[0];
    var dx = t.clientX - touchStartX,
      dy = t.clientY - touchStartY;
    if (!touchDragging && Math.sqrt(dx * dx + dy * dy) < 10) return;
    if (!touchDragging) {
      touchDragging = true;
      var ti = touchInfo;
      if (ti.type === 'waste' && waste.length) {
        selected = [waste[waste.length - 1]];
        selectedFrom = { type: 'waste' };
      } else if (ti.type === 'tableau' && ti.cardIdx !== undefined) {
        var pile = tableau[ti.idx];
        if (!pile[ti.cardIdx] || !pile[ti.cardIdx].faceUp) {
          touchInfo = null;
          touchDragging = false;
          return;
        }
        selected = pile.slice(ti.cardIdx);
        selectedFrom = { type: 'tableau', idx: ti.idx, cardIdx: ti.cardIdx };
      } else {
        touchInfo = null;
        touchDragging = false;
        return;
      }
      var orig = e.target.closest('.sol-card');
      if (orig) {
        touchGhost = orig.cloneNode(true);
        touchGhost.style.cssText =
          'position:fixed;z-index:9999;pointer-events:none;opacity:.82;transform:rotate(4deg) scale(1.08);transition:none;width:62px;height:88px;border-radius:8px;';
        document.body.appendChild(touchGhost);
      }
      render();
    }
    e.preventDefault();
    if (touchGhost) {
      touchGhost.style.left = t.clientX - 31 + 'px';
      touchGhost.style.top = t.clientY - 50 + 'px';
    }
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    if (touchGhost) touchGhost.style.display = 'none';
    var under = document.elementFromPoint(t.clientX, t.clientY);
    if (touchGhost) touchGhost.style.display = '';
    if (under && selected) {
      var tEl = under.closest('[data-type]');
      if (tEl) {
        var tt = tEl.dataset.type,
          ti2 = parseInt(tEl.dataset.idx) || 0;
        var valid =
          (tt === 'tableau' && canPlaceTab(selected[0], tableau[ti2])) ||
          (tt === 'foundation' &&
            selected.length === 1 &&
            canPlaceFound(selected[0], foundations[ti2], ti2));
        if (valid) tEl.classList.add('sol-drop-hover');
      }
    }
  }

  function onTouchEnd(e) {
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    if (touchDragging) {
      var t = e.changedTouches[0];
      removeTouchGhost();
      var under = document.elementFromPoint(t.clientX, t.clientY);
      var placed = false;
      if (under && selected) {
        var tEl = under.closest('[data-type]');
        if (tEl) placed = tryPlace(tEl.dataset.type, parseInt(tEl.dataset.idx) || 0);
      }
      if (!placed) {
        selected = null;
        selectedFrom = null;
        render();
      }
    } else if (touchInfo && !touchDragging) {
      touchHandled = true;
      setTimeout(function () {
        touchHandled = false;
      }, 400);
      handleClick(touchInfo.type, touchInfo.idx, touchInfo.cardIdx);
    }
    touchInfo = null;
    touchDragging = false;
  }

  // ── Render ──
  function render(animate) {
    var table = document.getElementById('solTable');
    if (!table) return;
    table.innerHTML = '';
    var topRow = document.createElement('div');
    topRow.className = 'sol-top-row';

    // Stock
    var stockEl = makeEmpty();
    stockEl.style.cursor = 'pointer';
    stockEl.dataset.type = 'stock';
    stockEl.dataset.idx = '0';
    if (stock.length) {
      var fd = makeFaceDown();
      fd.dataset.type = 'stock';
      fd.dataset.idx = '0';
      stockEl.appendChild(fd);
    } else
      stockEl.innerHTML =
        '<div style="font-size:1.6rem;color:rgba(192,132,252,.35);line-height:88px;text-align:center">\u21BA</div>';
    topRow.appendChild(stockEl);

    // Waste
    var wasteEl = makeEmpty();
    wasteEl.dataset.type = 'waste';
    wasteEl.dataset.idx = '0';
    wasteEl.style.position = 'relative';
    var showCount = Math.min(3, waste.length);
    for (var wi = waste.length - showCount; wi < waste.length; wi++) {
      (function (wii, offset) {
        var wcard = waste[wii];
        var wel = makeCard(wcard);
        wel.style.position = 'absolute';
        wel.style.left = offset * 14 + 'px';
        wel.style.top = '0';
        wel.style.zIndex = offset + 1;
        if (wii === waste.length - 1) {
          wel.dataset.type = 'waste';
          wel.dataset.idx = '0';
          wel.dataset.ci = wii;
          if (selected && selectedFrom && selectedFrom.type === 'waste')
            wel.classList.add('selected');
        } else {
          wel.style.pointerEvents = 'none';
        }
        wasteEl.appendChild(wel);
      })(wi, wi - (waste.length - showCount));
    }
    wasteEl.style.width = showCount > 1 ? 28 + 62 + 'px' : '62px';
    topRow.appendChild(wasteEl);

    var sp = document.createElement('div');
    sp.style.flex = '1';
    topRow.appendChild(sp);

    // Foundations
    for (var f = 0; f < 4; f++)
      (function (fi) {
        var fEl = makeEmpty();
        fEl.classList.add('sol-pile-foundation');
        fEl.dataset.type = 'foundation';
        fEl.dataset.idx = fi;
        if (foundations[fi].length) {
          fEl.innerHTML = '';
          var fc = makeCard(foundations[fi][foundations[fi].length - 1]);
          fc.dataset.type = 'foundation';
          fc.dataset.idx = fi;
          fEl.appendChild(fc);
        } else {
          var sl = document.createElement('div');
          sl.style.cssText =
            'font-size:1.8rem;color:rgba(192,132,252,.22);line-height:88px;text-align:center;width:100%';
          sl.textContent = SUITS[fi];
          fEl.appendChild(sl);
        }
        topRow.appendChild(fEl);
      })(f);
    table.appendChild(topRow);

    // Tableau
    var tabRow = document.createElement('div');
    tabRow.className = 'sol-tableau';
    for (var t = 0; t < 7; t++)
      (function (ti) {
        var pileEl = document.createElement('div');
        pileEl.className = 'sol-tab-pile sol-pile';
        pileEl.dataset.type = 'tableau';
        pileEl.dataset.idx = ti;
        pileEl.dataset.ci = 'empty';
        var klTop = 0;
        tableau[ti].forEach(function (card, ci) {
          var cel = card.faceUp ? makeCard(card) : makeFaceDown();
          cel.dataset.type = 'tableau';
          cel.dataset.idx = ti;
          cel.dataset.ci = ci;
          cel.style.position = 'absolute';
          cel.style.top = klTop + 'px';
          cel.style.zIndex = ci + 1;
          if (animate) {
            cel.style.animation = 'solDeal .25s ease both';
            cel.style.animationDelay = (ti * 3 + ci) * 0.04 + 's';
          }
          if (
            card.faceUp &&
            selected &&
            selectedFrom &&
            selectedFrom.type === 'tableau' &&
            selectedFrom.idx === ti &&
            ci >= selectedFrom.cardIdx
          )
            cel.classList.add('selected');
          pileEl.appendChild(cel);
          klTop += card.faceUp ? 28 : 14;
        });
        pileEl.style.height = Math.max(88, klTop + 62) + 'px';
        tabRow.appendChild(pileEl);
      })(t);
    table.appendChild(tabRow);
  }

  function makeCard(card) {
    var el = document.createElement('div');
    el.className = 'sol-card ' + (isRed(card.suit) ? 'red' : 'black');
    el.draggable = true;
    el.innerHTML =
      '<div class="sol-card-rank">' +
      card.rank +
      '</div><div class="sol-card-suit">' +
      card.suit +
      '</div><div class="sol-card-center">' +
      card.suit +
      '</div>';
    return el;
  }
  function makeFaceDown() {
    var el = document.createElement('div');
    el.className = 'sol-card face-down';
    return el;
  }
  function makeEmpty() {
    var el = document.createElement('div');
    el.className = 'sol-pile-empty';
    return el;
  }

  function startWithShuffle() {
    deal();
    playCardSound('shuffle');
    var table = document.getElementById('solTable');
    if (table)
      table.innerHTML =
        '<div class="sol-shuffle-anim"><div class="sol-shuffle-deck"></div><div class="sol-shuffle-label">Shuffling\u2026</div></div>';
    setTimeout(function () {
      render(true);
    }, 700);
  }

  function klondikeTC() {
    removeTouchGhost();
    selected = null;
    selectedFrom = null;
    touchInfo = null;
    touchDragging = false;
    render();
  }
  window._klondikeCleanup = function () {
    var t = document.getElementById('solTable');
    if (!t) return;
    t.removeEventListener('dragstart', onDragStart);
    t.removeEventListener('dragover', onDragOver);
    t.removeEventListener('dragleave', onDragLeave);
    t.removeEventListener('drop', onDrop);
    t.removeEventListener('dragend', onDragEnd);
    t.removeEventListener('touchstart', onTouchStart);
    t.removeEventListener('touchmove', onTouchMove);
    t.removeEventListener('touchend', onTouchEnd);
    t.removeEventListener('touchcancel', klondikeTC);
  };
  window._klondikeHC = function (type, idx, ci) {
    if (!touchDragging) handleClick(type, idx, ci);
  };
  window._klondikeDC = function (type, idx, ci) {
    handleDblClick(type, idx, ci);
  };
  window._klondikeStart = function () {
    var table = document.getElementById('solTable');
    if (!table) return;
    document.getElementById('solGameTitle').textContent = 'Klondike';
    var hintBtn = document.getElementById('solitaireHint');
    if (hintBtn) hintBtn.style.display = '';
    window._klondikeCleanup();
    table.addEventListener('dragstart', onDragStart);
    table.addEventListener('dragover', onDragOver);
    table.addEventListener('dragleave', onDragLeave);
    table.addEventListener('drop', onDrop);
    table.addEventListener('dragend', onDragEnd);
    table.addEventListener('touchstart', onTouchStart, { passive: true });
    table.addEventListener('touchmove', onTouchMove, { passive: false });
    table.addEventListener('touchend', onTouchEnd, { passive: true });
    table.addEventListener('touchcancel', klondikeTC, { passive: true });
    startWithShuffle();
  };
  window._klondikeStop = function () {
    clearInterval(solTimer);
    removeTouchGhost();
  };
  window._klondikeUndo = undo;
  window._klondikeNewGame = function () {
    startWithShuffle();
  };
  window._klondikeHint = showHint;
})();

// ── SPIDER SOLITAIRE ─────────────────────────────────────────────────────
(function () {
  var ALL_SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var tableau = [],
    stock = [],
    foundations = [];
  var selected = null,
    selectedFrom = null,
    moves = 0,
    solTimer = null,
    solSecs = 0,
    history = [];
  var touchGhost = null,
    touchInfo = null,
    touchDragging = false,
    touchStartX = 0,
    touchStartY = 0,
    touchHandled = false;
  var suitMode = 1; // 1, 2, or 4 suits
  function isRed(s) {
    return s === '\u2665' || s === '\u2666';
  }
  function shuf(d) {
    for (var i = d.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = d[i];
      d[i] = d[j];
      d[j] = t;
    }
    return d;
  }
  function mk(s, r, i) {
    return { suit: s, rank: r, value: i + 1, faceUp: false };
  }
  function buildDeck() {
    var suits =
      suitMode === 1
        ? ['\u2660', '\u2660', '\u2660', '\u2660']
        : suitMode === 2
          ? ['\u2660', '\u2665', '\u2660', '\u2665']
          : ALL_SUITS;
    var d = [];
    for (var k = 0; k < 2; k++)
      suits.forEach(function (s) {
        RANKS.forEach(function (r, i) {
          d.push(mk(s, r, i));
        });
      });
    return shuf(d);
  }
  function deal() {
    var d = buildDeck();
    tableau = [[], [], [], [], [], [], [], [], [], []];
    stock = [];
    foundations = [];
    var idx = 0;
    for (var c = 0; c < 10; c++) {
      var n = c < 4 ? 6 : 5;
      for (var i = 0; i < n; i++) {
        var card = d[idx++];
        card.faceUp = i === n - 1;
        tableau[c].push(card);
      }
    }
    while (idx < d.length) stock.push(d[idx++]);
    selected = null;
    selectedFrom = null;
    moves = 0;
    solSecs = 0;
    history = [];
    var nb = document.getElementById('solNoMovesBanner');
    if (nb) nb.style.display = 'none';
  }
  function isMoveSeq(col, ci) {
    var p = tableau[col];
    if (ci >= p.length || !p[ci].faceUp) return false;
    for (var i = ci; i < p.length - 1; i++) {
      if (p[i].suit !== p[i + 1].suit || p[i].value !== p[i + 1].value + 1) return false;
    }
    return true;
  }
  function canPlace(card, pile) {
    return (
      !pile.length ||
      (pile[pile.length - 1].faceUp && card.value === pile[pile.length - 1].value - 1)
    );
  }
  function checkRuns() {
    for (var t = 0; t < 10; t++) {
      var p = tableau[t];
      if (p.length < 13) continue;
      var top = p.length - 1,
        s = p[top - 12];
      if (s.value !== 13) continue;
      var suit = s.suit,
        ok = true;
      for (var i = 0; i < 13; i++) {
        if (
          !p[top - 12 + i].faceUp ||
          p[top - 12 + i].suit !== suit ||
          p[top - 12 + i].value !== 13 - i
        ) {
          ok = false;
          break;
        }
      }
      if (ok) {
        foundations.push(suit);
        tableau[t] = p.slice(0, top - 12);
        if (tableau[t].length && !tableau[t][tableau[t].length - 1].faceUp)
          tableau[t][tableau[t].length - 1].faceUp = true;
        t--;
      }
    }
  }
  function clone(c) {
    return { suit: c.suit, rank: c.rank, value: c.value, faceUp: c.faceUp };
  }
  function save() {
    history.push({
      tab: tableau.map(function (p) {
        return p.map(clone);
      }),
      stk: stock.map(clone),
      fnd: foundations.slice(),
      mv: moves,
      sc: solSecs
    });
    if (history.length > 80) history.shift();
    updUndo();
  }
  function updUndo() {
    var b = document.getElementById('solitaireUndo');
    if (b) {
      b.disabled = !history.length;
      b.style.opacity = history.length ? '1' : '.4';
    }
  }
  function undo() {
    if (!history.length) return;
    var h = history.pop();
    tableau = h.tab;
    stock = h.stk;
    foundations = h.fnd;
    moves = h.mv;
    solSecs = h.sc;
    selected = null;
    selectedFrom = null;
    document.getElementById('solMoves').textContent = moves;
    updUndo();
    render();
  }
  function dealStock() {
    if (!stock.length) return;
    save();
    for (var t = 0; t < 10; t++) {
      if (!stock.length) break;
      var c = stock.pop();
      c.faceUp = true;
      tableau[t].push(c);
    }
    checkRuns();
    moves++;
    document.getElementById('solMoves').textContent = moves;
    render();
    checkWin();
  }
  function checkWin() {
    if (foundations.length === 8) {
      clearInterval(solTimer);
      history = [];
      updUndo();
      setTimeout(function () {
        _solWinOverlay(moves, 'window._spiderNewGame');
      }, 300);
    }
  }
  function tryPlace(di) {
    if (!selected || !selected.length) return false;
    if (!canPlace(selected[0], tableau[di])) return false;
    save();
    tableau[selectedFrom.idx].splice(selectedFrom.ci);
    var sp2 = tableau[selectedFrom.idx];
    if (sp2.length && !sp2[sp2.length - 1].faceUp) sp2[sp2.length - 1].faceUp = true;
    selected.forEach(function (c) {
      tableau[di].push(c);
    });
    checkRuns();
    moves++;
    selected = null;
    selectedFrom = null;
    document.getElementById('solMoves').textContent = moves;
    render();
    checkWin();
    return true;
  }
  function handleClick(type, idx, ci) {
    if (type === 'stock') {
      dealStock();
      return;
    }
    if (type !== 'tableau') return;
    if (ci === undefined) {
      if (selected) {
        tryPlace(idx);
        return;
      }
      selected = null;
      selectedFrom = null;
      render();
      return;
    }
    ci = parseInt(ci);
    var pile = tableau[idx];
    if (!pile[ci] || !pile[ci].faceUp) {
      selected = null;
      selectedFrom = null;
      render();
      return;
    }
    if (selected) {
      if (selectedFrom.idx === idx && selectedFrom.ci === ci) {
        render();
        return;
      } // same card: keep selected
      if (tryPlace(idx)) return;
      if (isMoveSeq(idx, ci)) {
        selected = pile.slice(ci);
        selectedFrom = { idx: idx, ci: ci };
        render();
        return;
      }
      selected = null;
      selectedFrom = null;
      render();
      return;
    }
    if (isMoveSeq(idx, ci)) {
      selected = pile.slice(ci);
      selectedFrom = { idx: idx, ci: ci };
      render();
    }
  }
  function makeCard(card) {
    var el = document.createElement('div');
    el.className = 'sol-card ' + (isRed(card.suit) ? 'red' : 'black');
    el.draggable = true;
    el.innerHTML =
      '<div class="sol-card-rank">' +
      card.rank +
      '</div><div class="sol-card-suit">' +
      card.suit +
      '</div><div class="sol-card-center">' +
      card.suit +
      '</div>';
    return el;
  }
  function makeFD() {
    var el = document.createElement('div');
    el.className = 'sol-card face-down';
    return el;
  }
  function render() {
    var table = document.getElementById('solTable');
    if (!table) return;
    table.innerHTML = '';
    table.className = 'sol-table';
    var topRow = document.createElement('div');
    topRow.className = 'sol-top-row';
    var se = document.createElement('div');
    se.className = 'sol-pile-empty';
    se.style.cursor = stock.length ? 'pointer' : 'default';
    se.style.position = 'relative';
    se.dataset.type = 'stock';
    se.dataset.idx = '0';
    if (stock.length) {
      var fd = makeFD();
      fd.dataset.type = 'stock';
      fd.dataset.idx = '0';
      se.appendChild(fd);
      var lb = document.createElement('div');
      lb.style.cssText =
        'position:absolute;bottom:3px;right:5px;font-size:.6rem;color:rgba(192,132,252,.7);font-weight:700';
      lb.textContent = Math.ceil(stock.length / 10) + 'x';
      se.appendChild(lb);
    } else {
      se.innerHTML =
        '<div style="font-size:1rem;color:rgba(192,132,252,.3);line-height:88px;text-align:center">\u2713</div>';
    }
    topRow.appendChild(se);
    var sp = document.createElement('div');
    sp.style.flex = '1';
    topRow.appendChild(sp);
    for (var f = 0; f < 8; f++) {
      var fe = document.createElement('div');
      fe.className = 'sol-pile-empty sol-pile-foundation';
      if (foundations[f] !== undefined) {
        var kc = document.createElement('div');
        kc.className = 'sol-card ' + (isRed(foundations[f]) ? 'red' : 'black');
        kc.innerHTML =
          '<div class="sol-card-rank">K</div><div class="sol-card-suit">' +
          foundations[f] +
          '</div><div class="sol-card-center">' +
          foundations[f] +
          '</div>';
        fe.appendChild(kc);
      } else {
        fe.innerHTML =
          '<div style="font-size:.9rem;color:rgba(192,132,252,.15);line-height:88px;text-align:center">\u2606</div>';
      }
      topRow.appendChild(fe);
    }
    table.appendChild(topRow);
    var tabRow = document.createElement('div');
    tabRow.className = 'sol-tableau';
    tabRow.style.gap = '6px';
    for (var t = 0; t < 10; t++)
      (function (ti) {
        var pe = document.createElement('div');
        pe.className = 'sol-tab-pile sol-pile';
        pe.style.width = '58px';
        pe.dataset.type = 'tableau';
        pe.dataset.idx = ti;
        pe.dataset.ci = 'empty';
        var spTop = 0;
        tableau[ti].forEach(function (card, ci2) {
          var cel = card.faceUp ? makeCard(card) : makeFD();
          cel.dataset.type = 'tableau';
          cel.dataset.idx = ti;
          cel.dataset.ci = ci2;
          cel.style.cssText =
            'position:absolute;top:' + spTop + 'px;z-index:' + (ci2 + 1) + ';width:58px';
          if (selected && selectedFrom && selectedFrom.idx === ti && ci2 >= selectedFrom.ci)
            cel.classList.add('selected');
          pe.appendChild(cel);
          spTop += card.faceUp ? 28 : 14;
        });
        pe.style.height = Math.max(88, spTop + 62) + 'px';
        tabRow.appendChild(pe);
      })(t);
    table.appendChild(tabRow);
  }
  // ── Drag & Drop ──
  function onDragStart(e) {
    var el = e.target.closest('[data-type]');
    if (!el || el.dataset.type !== 'tableau') return;
    var idx = parseInt(el.dataset.idx) || 0,
      ci = el.dataset.ci;
    if (!ci || ci === 'empty') {
      e.preventDefault();
      return;
    }
    ci = parseInt(ci);
    if (!isMoveSeq(idx, ci)) {
      e.preventDefault();
      return;
    }
    selected = tableau[idx].slice(ci);
    selectedFrom = { idx: idx, ci: ci };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'sol');
    setTimeout(function () {
      render();
    }, 0);
  }
  function onDragOver(e) {
    e.preventDefault();
    if (!selected) return;
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    var el = e.target.closest('[data-type="tableau"]');
    if (el) {
      var di = parseInt(el.dataset.idx) || 0;
      if (canPlace(selected[0], tableau[di])) {
        el.classList.add('sol-drop-hover');
        e.dataTransfer.dropEffect = 'move';
      } else e.dataTransfer.dropEffect = 'none';
    }
  }
  function onDragLeave(e) {
    if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget))
      document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
        x.classList.remove('sol-drop-hover');
      });
  }
  function onDrop(e) {
    e.preventDefault();
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    var el = e.target.closest('[data-type="tableau"]');
    if (!el || !selected) return;
    tryPlace(parseInt(el.dataset.idx) || 0);
  }
  function onDragEnd(e) {
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    selected = null;
    selectedFrom = null;
    render();
  }
  // ── Touch Drag ──
  function removeTG() {
    if (touchGhost) {
      touchGhost.remove();
      touchGhost = null;
    }
  }
  function onTS(e) {
    var el = e.target.closest('[data-type]');
    if (!el || el.dataset.type === 'stock') return;
    touchInfo = {
      type: el.dataset.type,
      idx: parseInt(el.dataset.idx) || 0,
      ci: el.dataset.ci === 'empty' ? undefined : el.dataset.ci
    };
    touchDragging = false;
    var t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  }
  function onTM(e) {
    if (!touchInfo) return;
    var t = e.touches[0];
    if (
      !touchDragging &&
      Math.sqrt(Math.pow(t.clientX - touchStartX, 2) + Math.pow(t.clientY - touchStartY, 2)) < 10
    )
      return;
    if (!touchDragging) {
      touchDragging = true;
      var ti = touchInfo;
      if (ti.type === 'tableau' && ti.ci !== undefined) {
        var ci = parseInt(ti.ci);
        if (!isMoveSeq(ti.idx, ci)) {
          touchInfo = null;
          touchDragging = false;
          return;
        }
        selected = tableau[ti.idx].slice(ci);
        selectedFrom = { idx: ti.idx, ci: ci };
      } else {
        touchInfo = null;
        touchDragging = false;
        return;
      }
      var orig = e.target.closest('.sol-card');
      if (orig) {
        touchGhost = orig.cloneNode(true);
        touchGhost.style.cssText =
          'position:fixed;z-index:9999;pointer-events:none;opacity:.82;transform:rotate(4deg) scale(1.08);transition:none;width:58px;height:88px;border-radius:8px;';
        document.body.appendChild(touchGhost);
      }
      render();
    }
    e.preventDefault();
    if (touchGhost) {
      touchGhost.style.left = t.clientX - 29 + 'px';
      touchGhost.style.top = t.clientY - 50 + 'px';
    }
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    if (touchGhost) touchGhost.style.display = 'none';
    var under = document.elementFromPoint(t.clientX, t.clientY);
    if (touchGhost) touchGhost.style.display = '';
    if (under && selected) {
      var tEl = under.closest('[data-type="tableau"]');
      if (tEl && canPlace(selected[0], tableau[parseInt(tEl.dataset.idx) || 0]))
        tEl.classList.add('sol-drop-hover');
    }
  }
  function onTE(e) {
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    if (touchDragging) {
      var t = e.changedTouches[0];
      removeTG();
      var under = document.elementFromPoint(t.clientX, t.clientY);
      var placed = false;
      if (under && selected) {
        var tEl = under.closest('[data-type="tableau"]');
        if (tEl) placed = tryPlace(parseInt(tEl.dataset.idx) || 0);
      }
      if (!placed) {
        selected = null;
        selectedFrom = null;
        render();
      }
    } else if (touchInfo && !touchDragging) {
      touchHandled = true;
      setTimeout(function () {
        touchHandled = false;
      }, 400);
      handleClick(touchInfo.type, touchInfo.idx, touchInfo.ci);
    }
    touchInfo = null;
    touchDragging = false;
  }
  function spiderTC() {
    removeTG();
    selected = null;
    selectedFrom = null;
    touchInfo = null;
    touchDragging = false;
    render();
  }

  // ── Hint System ──
  var spHintTimer = null,
    spHintIdx = 0;
  function spClearHints() {
    clearTimeout(spHintTimer);
    var t = document.getElementById('solTable');
    if (t)
      t.querySelectorAll('.sol-hint-src,.sol-hint-dst').forEach(function (x) {
        x.classList.remove('sol-hint-src', 'sol-hint-dst');
      });
  }
  function spApplyHint(h) {
    var t = document.getElementById('solTable');
    if (!t) return;
    var srcEl = t.querySelector(
      '[data-type="tableau"][data-idx="' + h.si + '"][data-ci="' + h.sci + '"]'
    );
    var dstPile = tableau[h.di];
    var dstEl = dstPile.length
      ? t.querySelector(
          '[data-type="tableau"][data-idx="' + h.di + '"][data-ci="' + (dstPile.length - 1) + '"]'
        )
      : t.querySelector('.sol-tab-pile[data-idx="' + h.di + '"]');
    if (srcEl) srcEl.classList.add('sol-hint-src');
    if (dstEl) dstEl.classList.add('sol-hint-dst');
    spHintTimer = setTimeout(spClearHints, 2500);
  }
  function spGetMoves() {
    var result = [];
    for (var si = 0; si < 10; si++) {
      var sp = tableau[si];
      // Find the highest face-up card that starts a valid moveable sequence
      for (var sci = 0; sci < sp.length; sci++) {
        if (!sp[sci].faceUp) continue;
        // Verify sequence from sci to end is a valid run (consecutive same suit or just consecutive)
        var seq = sp.slice(sci);
        var seqOk = true;
        for (var k = 1; k < seq.length; k++) {
          if (seq[k].value !== seq[k - 1].value - 1) {
            seqOk = false;
            break;
          }
        }
        if (!seqOk) continue;
        // Check each destination
        for (var di = 0; di < 10; di++) {
          if (di === si) continue;
          if (!canPlace(seq[0], tableau[di])) continue;
          // --- Score this move ---
          var score = 0;
          // 1. Does this complete a K→A same-suit run?
          var destAfter = tableau[di].concat(seq);
          if (destAfter.length >= 13) {
            var base = destAfter.length - 13;
            if (destAfter[base].value === 13) {
              var runSuit = destAfter[base].suit,
                runOk = true;
              for (var r = 0; r < 13; r++) {
                if (destAfter[base + r].suit !== runSuit || destAfter[base + r].value !== 13 - r) {
                  runOk = false;
                  break;
                }
              }
              if (runOk) score += 200;
            }
          }
          // 2. Reveals a face-down card?
          if (sci > 0 && !sp[sci - 1].faceUp) score += 80;
          else if (sci === 0 && sp.length > 0) score += 40; // clears whole column
          // 3. Entire moved sequence is same suit (keeps suits pure)
          var seqSameSuit = seq.every(function (c) {
            return c.suit === seq[0].suit;
          });
          if (seqSameSuit) score += 30;
          // 4. Destination top is same suit as seq bottom (extends same-suit run)
          if (
            tableau[di].length &&
            tableau[di][tableau[di].length - 1].suit === seq[seq.length - 1].suit
          )
            score += 20;
          // 5. Moving to empty column — only worth it for long sequences or kings
          if (!tableau[di].length) {
            if (seq[0].value === 13) score += 15;
            else score -= 20; // wasting empty column
          }
          // 6. Penalise breaking an existing same-suit run at source
          if (
            sci > 0 &&
            sp[sci - 1].faceUp &&
            sp[sci - 1].suit === sp[sci].suit &&
            sp[sci - 1].value === sp[sci].value + 1
          )
            score -= 25;
          // 7. Longer sequences are more valuable to place
          score += seq.length * 2;
          result.push({ si: si, sci: sci, di: di, score: score, seq: seq });
        }
      }
    }
    result.sort(function (a, b) {
      return b.score - a.score;
    });
    return result;
  }
  function spShowHint() {
    spClearHints();
    var hints = spGetMoves();
    if (hints.length) {
      spApplyHint(hints[spHintIdx % hints.length]);
      spHintIdx++;
      return;
    }
    // No tableau moves — suggest dealing from stock
    if (stock.length) {
      showToast('Deal from stock', 'No tableau moves \u2014 click the stock pile');
      var se = document.querySelector('#solTable [data-type="stock"]');
      if (se) {
        se.classList.add('sol-hint-src');
        spHintTimer = setTimeout(spClearHints, 2500);
      }
    } else {
      showToast('No moves', 'Stock is empty and no moves found \u2014 try New Game');
    }
  }
  window._spiderCleanup = function () {
    var t = document.getElementById('solTable');
    if (!t) return;
    t.removeEventListener('dragstart', onDragStart);
    t.removeEventListener('dragover', onDragOver);
    t.removeEventListener('dragleave', onDragLeave);
    t.removeEventListener('drop', onDrop);
    t.removeEventListener('dragend', onDragEnd);
    t.removeEventListener('touchstart', onTS);
    t.removeEventListener('touchmove', onTM);
    t.removeEventListener('touchend', onTE);
    t.removeEventListener('touchcancel', spiderTC);
  };
  window._spiderHC = function (type, idx, ci) {
    if (!touchHandled) handleClick(type, idx, ci);
  };
  window._spiderSetMode = function (n) {
    suitMode = n;
  };
  window._spiderStart = function () {
    var table = document.getElementById('solTable');
    if (!table) return;
    var titles = { 1: 'Spider — One Suit', 2: 'Spider — Two Suits', 4: 'Spider — Four Suits' };
    document.getElementById('solGameTitle').textContent = titles[suitMode] || 'Spider';
    var hb = document.getElementById('solitaireHint');
    if (hb) hb.style.display = '';
    spHintIdx = 0;
    window._spiderCleanup();
    table.addEventListener('dragstart', onDragStart);
    table.addEventListener('dragover', onDragOver);
    table.addEventListener('dragleave', onDragLeave);
    table.addEventListener('drop', onDrop);
    table.addEventListener('dragend', onDragEnd);
    table.addEventListener('touchstart', onTS, { passive: true });
    table.addEventListener('touchmove', onTM, { passive: false });
    table.addEventListener('touchend', onTE, { passive: true });
    table.addEventListener('touchcancel', spiderTC, { passive: true });
    deal();
    var tbl = document.getElementById('solTable');
    if (tbl)
      tbl.innerHTML =
        '<div class="sol-shuffle-anim"><div class="sol-shuffle-deck"></div><div class="sol-shuffle-label">Shuffling\u2026</div></div>';
    document.getElementById('solMoves').textContent = '0';
    var et = document.getElementById('solTime');
    if (et) et.textContent = '0:00';
    clearInterval(solTimer);
    solTimer = setInterval(function () {
      solSecs++;
      var m = Math.floor(solSecs / 60),
        s = solSecs % 60;
      var el = document.getElementById('solTime');
      if (el) el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
    setTimeout(function () {
      render();
    }, 700);
  };
  window._spiderStop = function () {
    clearInterval(solTimer);
    removeTG();
    spClearHints();
  };
  window._spiderUndo = undo;
  window._spiderHint = spShowHint;
  window._spiderNewGame = function () {
    spHintIdx = 0;
    window._spiderStart();
  };
})();

// ── SCORPION SOLITAIRE ───────────────────────────────────────────────────
(function () {
  var SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var tableau = [],
    stock = [],
    foundations = [];
  var selected = null,
    selectedFrom = null,
    moves = 0,
    solTimer = null,
    solSecs = 0,
    history = [];
  function isRed(s) {
    return s === '\u2665' || s === '\u2666';
  }
  function shuf(d) {
    for (var i = d.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = d[i];
      d[i] = d[j];
      d[j] = t;
    }
    return d;
  }
  function mk(s, r, i) {
    return { suit: s, rank: r, value: i + 1, faceUp: false };
  }
  function deal() {
    var d = [];
    SUITS.forEach(function (s) {
      RANKS.forEach(function (r, i) {
        d.push(mk(s, r, i));
      });
    });
    shuf(d);
    tableau = [];
    var idx = 0;
    // 7 columns: cols 0-3 have 7 cards (first 3 face-down), cols 4-6 have 7 cards (all face-up)
    for (var c = 0; c < 7; c++) {
      tableau.push([]);
      for (var i = 0; i < 7; i++) {
        var card = d[idx++];
        card.faceUp = c >= 4 || i >= 3;
        tableau[c].push(card);
      }
    }
    // remaining 3 cards go to stock
    stock = [];
    while (idx < d.length) stock.push(d[idx++]);
    foundations = [];
    selected = null;
    selectedFrom = null;
    moves = 0;
    solSecs = 0;
    history = [];
  }
  // In Scorpion, you can move a face-up card (and all cards on top of it)
  // onto a card of the same suit that is one rank higher
  function canPlace(card, pile) {
    if (!pile.length) return card.value === 13; // King to empty
    var top = pile[pile.length - 1];
    return top.faceUp && card.suit === top.suit && card.value === top.value - 1;
  }
  function checkRuns() {
    for (var t = 0; t < 7; t++) {
      var p = tableau[t];
      if (p.length < 13) continue;
      var base = p.length - 13;
      if (p[base].value !== 13) continue;
      var suit = p[base].suit,
        ok = true;
      for (var i = 0; i < 13; i++) {
        if (!p[base + i].faceUp || p[base + i].suit !== suit || p[base + i].value !== 13 - i) {
          ok = false;
          break;
        }
      }
      if (ok) {
        foundations.push(suit);
        tableau[t] = p.slice(0, base);
        if (tableau[t].length && !tableau[t][tableau[t].length - 1].faceUp)
          tableau[t][tableau[t].length - 1].faceUp = true;
        t--;
      }
    }
  }
  function clone(c) {
    return { suit: c.suit, rank: c.rank, value: c.value, faceUp: c.faceUp };
  }
  function save() {
    history.push({
      tab: tableau.map(function (p) {
        return p.map(clone);
      }),
      stk: stock.map(clone),
      fnd: foundations.slice(),
      mv: moves,
      sc: solSecs
    });
    if (history.length > 80) history.shift();
    updUndo();
  }
  function updUndo() {
    var b = document.getElementById('solitaireUndo');
    if (b) {
      b.disabled = !history.length;
      b.style.opacity = history.length ? '1' : '.4';
    }
  }
  function undo() {
    if (!history.length) return;
    var h = history.pop();
    tableau = h.tab;
    stock = h.stk;
    foundations = h.fnd;
    moves = h.mv;
    solSecs = h.sc;
    selected = null;
    selectedFrom = null;
    document.getElementById('solMoves').textContent = moves;
    updUndo();
    render();
  }
  function dealStock() {
    if (!stock.length) return;
    save();
    for (var t = 0; t < 3 && stock.length; t++) {
      var c = stock.pop();
      c.faceUp = true;
      tableau[t].push(c);
    }
    checkRuns();
    moves++;
    document.getElementById('solMoves').textContent = moves;
    render();
    checkWin();
  }
  function checkWin() {
    if (foundations.length === 4) {
      clearInterval(solTimer);
      history = [];
      updUndo();
      setTimeout(function () {
        _solWinOverlay(moves, 'window._scorpionNewGame');
      }, 300);
    }
  }
  function tryPlace(di) {
    if (!selected || !selected.length) return false;
    if (!canPlace(selected[0], tableau[di])) return false;
    save();
    tableau[selectedFrom.idx].splice(selectedFrom.ci);
    var sp = tableau[selectedFrom.idx];
    if (sp.length && !sp[sp.length - 1].faceUp) sp[sp.length - 1].faceUp = true;
    selected.forEach(function (c) {
      tableau[di].push(c);
    });
    checkRuns();
    moves++;
    selected = null;
    selectedFrom = null;
    document.getElementById('solMoves').textContent = moves;
    render();
    checkWin();
    return true;
  }
  function handleClick(type, idx, ci) {
    if (type === 'stock') {
      dealStock();
      return;
    }
    if (type !== 'tableau') return;
    if (ci === undefined) {
      if (selected) {
        tryPlace(idx);
        return;
      }
      selected = null;
      selectedFrom = null;
      render();
      return;
    }
    ci = parseInt(ci);
    var pile = tableau[idx];
    if (!pile[ci] || !pile[ci].faceUp) {
      selected = null;
      selectedFrom = null;
      render();
      return;
    }
    if (selected) {
      if (selectedFrom.idx === idx && selectedFrom.ci === ci) {
        render();
        return;
      }
      if (tryPlace(idx)) return;
      // pick new sequence
      selected = pile.slice(ci);
      selectedFrom = { idx: idx, ci: ci };
      render();
      return;
    }
    selected = pile.slice(ci);
    selectedFrom = { idx: idx, ci: ci };
    render();
  }
  function makeCard(card) {
    var el = document.createElement('div');
    el.className = 'sol-card ' + (isRed(card.suit) ? 'red' : 'black');
    el.draggable = true;
    el.innerHTML =
      '<div class="sol-card-rank">' +
      card.rank +
      '</div><div class="sol-card-suit">' +
      card.suit +
      '</div><div class="sol-card-center">' +
      card.suit +
      '</div>';
    return el;
  }
  function makeFD() {
    var el = document.createElement('div');
    el.className = 'sol-card face-down';
    return el;
  }
  function render() {
    var table = document.getElementById('solTable');
    if (!table) return;
    table.innerHTML = '';
    table.className = 'sol-table';
    var topRow = document.createElement('div');
    topRow.className = 'sol-top-row';
    var se = document.createElement('div');
    se.className = 'sol-pile-empty';
    se.style.cursor = stock.length ? 'pointer' : 'default';
    se.style.position = 'relative';
    se.dataset.type = 'stock';
    se.dataset.idx = '0';
    if (stock.length) {
      var fd = makeFD();
      fd.dataset.type = 'stock';
      fd.dataset.idx = '0';
      se.appendChild(fd);
      var lb = document.createElement('div');
      lb.style.cssText =
        'position:absolute;bottom:3px;right:5px;font-size:.6rem;color:rgba(192,132,252,.7);font-weight:700';
      lb.textContent = stock.length;
      se.appendChild(lb);
    } else {
      se.innerHTML =
        '<div style="font-size:1rem;color:rgba(192,132,252,.3);line-height:88px;text-align:center">\u2713</div>';
    }
    topRow.appendChild(se);
    var sp2 = document.createElement('div');
    sp2.style.flex = '1';
    topRow.appendChild(sp2);
    for (var f = 0; f < 4; f++) {
      var fe = document.createElement('div');
      fe.className = 'sol-pile-empty sol-pile-foundation';
      if (foundations[f] !== undefined) {
        var kc = document.createElement('div');
        kc.className = 'sol-card ' + (isRed(foundations[f]) ? 'red' : 'black');
        kc.innerHTML =
          '<div class="sol-card-rank">K</div><div class="sol-card-suit">' +
          foundations[f] +
          '</div><div class="sol-card-center">' +
          foundations[f] +
          '</div>';
        fe.appendChild(kc);
      } else {
        fe.innerHTML =
          '<div style="font-size:.9rem;color:rgba(192,132,252,.15);line-height:88px;text-align:center">\u2606</div>';
      }
      topRow.appendChild(fe);
    }
    table.appendChild(topRow);
    var tabRow = document.createElement('div');
    tabRow.className = 'sol-tableau';
    tabRow.style.gap = '6px';
    for (var t = 0; t < 7; t++)
      (function (ti) {
        var pe = document.createElement('div');
        pe.className = 'sol-tab-pile sol-pile';
        pe.style.width = '58px';
        pe.dataset.type = 'tableau';
        pe.dataset.idx = ti;
        pe.dataset.ci = 'empty';
        var scoTop = 0;
        tableau[ti].forEach(function (card, ci2) {
          var cel = card.faceUp ? makeCard(card) : makeFD();
          cel.dataset.type = 'tableau';
          cel.dataset.idx = ti;
          cel.dataset.ci = ci2;
          cel.style.cssText =
            'position:absolute;top:' + scoTop + 'px;z-index:' + (ci2 + 1) + ';width:58px';
          if (selected && selectedFrom && selectedFrom.idx === ti && ci2 >= selectedFrom.ci)
            cel.classList.add('selected');
          pe.appendChild(cel);
          scoTop += card.faceUp ? 28 : 14;
        });
        pe.style.height = Math.max(88, scoTop + 62) + 'px';
        tabRow.appendChild(pe);
      })(t);
    table.appendChild(tabRow);
  }
  // Drag & Drop
  function scoDragStart(e) {
    var el = e.target.closest('[data-type]');
    if (!el || el.dataset.type !== 'tableau') return;
    var idx = parseInt(el.dataset.idx) || 0,
      ci = el.dataset.ci;
    if (!ci || ci === 'empty') {
      e.preventDefault();
      return;
    }
    ci = parseInt(ci);
    if (!tableau[idx][ci] || !tableau[idx][ci].faceUp) {
      e.preventDefault();
      return;
    }
    selected = tableau[idx].slice(ci);
    selectedFrom = { idx: idx, ci: ci };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'sol');
    setTimeout(function () {
      render();
    }, 0);
  }
  function scoDragOver(e) {
    e.preventDefault();
    if (!selected) return;
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    var el = e.target.closest('[data-type="tableau"]');
    if (el) {
      var di = parseInt(el.dataset.idx) || 0;
      if (canPlace(selected[0], tableau[di])) {
        el.classList.add('sol-drop-hover');
        e.dataTransfer.dropEffect = 'move';
      } else e.dataTransfer.dropEffect = 'none';
    }
  }
  function scoDragLeave(e) {
    if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget))
      document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
        x.classList.remove('sol-drop-hover');
      });
  }
  function scoDrop(e) {
    e.preventDefault();
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    var el = e.target.closest('[data-type="tableau"]');
    if (!el || !selected) return;
    tryPlace(parseInt(el.dataset.idx) || 0);
  }
  function scoDragEnd(e) {
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    selected = null;
    selectedFrom = null;
    render();
  }
  // ── Scorpion Hint System ──
  var scoHintTimer = null,
    scoHintIdx = 0;
  function scoClearHints() {
    clearTimeout(scoHintTimer);
    var t = document.getElementById('solTable');
    if (t)
      t.querySelectorAll('.sol-hint-src,.sol-hint-dst').forEach(function (x) {
        x.classList.remove('sol-hint-src', 'sol-hint-dst');
      });
  }
  function scoApplyHint(h) {
    var t = document.getElementById('solTable');
    if (!t) return;
    var srcEl = t.querySelector(
      '[data-type="tableau"][data-idx="' + h.si + '"][data-ci="' + h.sci + '"]'
    );
    var dstPile = tableau[h.di];
    var dstEl = dstPile.length
      ? t.querySelector(
          '[data-type="tableau"][data-idx="' + h.di + '"][data-ci="' + (dstPile.length - 1) + '"]'
        )
      : t.querySelector('.sol-tab-pile[data-idx="' + h.di + '"]');
    if (srcEl) srcEl.classList.add('sol-hint-src');
    if (dstEl) dstEl.classList.add('sol-hint-dst');
    scoHintTimer = setTimeout(scoClearHints, 2500);
  }
  function scoGetMoves() {
    var result = [];
    for (var si = 0; si < 7; si++) {
      var sp = tableau[si];
      for (var sci = 0; sci < sp.length; sci++) {
        if (!sp[sci].faceUp) continue;
        var seq = sp.slice(sci);
        for (var di = 0; di < 7; di++) {
          if (di === si) continue;
          if (!canPlace(seq[0], tableau[di])) continue;
          var score = 0;
          // Reveals face-down card
          if (sci > 0 && !sp[sci - 1].faceUp) score += 80;
          else if (sci === 0 && sp.length > 0) score += 40;
          // Entire sequence is same suit
          var sameSuit = seq.every(function (c) {
            return c.suit === seq[0].suit;
          });
          if (sameSuit) score += 30;
          // Destination is same suit (extending a run)
          if (tableau[di].length && tableau[di][tableau[di].length - 1].suit === seq[0].suit)
            score += 25;
          // Complete a K→A run?
          var destAfter = tableau[di].concat(seq);
          if (destAfter.length >= 13) {
            var base = destAfter.length - 13;
            if (destAfter[base].value === 13) {
              var rs = destAfter[base].suit,
                rok = true;
              for (var r = 0; r < 13; r++) {
                if (destAfter[base + r].suit !== rs || destAfter[base + r].value !== 13 - r) {
                  rok = false;
                  break;
                }
              }
              if (rok) score += 200;
            }
          }
          // Empty column: only worth it for kings
          if (!tableau[di].length) {
            if (seq[0].value === 13) score += 15;
            else score -= 20;
          }
          // Penalise breaking a same-suit run
          if (
            sci > 0 &&
            sp[sci - 1].faceUp &&
            sp[sci - 1].suit === sp[sci].suit &&
            sp[sci - 1].value === sp[sci].value + 1
          )
            score -= 25;
          score += seq.length * 2;
          result.push({ si: si, sci: sci, di: di, score: score });
        }
      }
    }
    result.sort(function (a, b) {
      return b.score - a.score;
    });
    return result;
  }
  function scoShowHint() {
    scoClearHints();
    var hints = scoGetMoves();
    if (hints.length) {
      scoApplyHint(hints[scoHintIdx % hints.length]);
      scoHintIdx++;
      return;
    }
    if (stock.length) {
      showToast('Deal from stock', 'No tableau moves \u2014 click the stock pile');
      var se = document.querySelector('#solTable [data-type="stock"]');
      if (se) {
        se.classList.add('sol-hint-src');
        scoHintTimer = setTimeout(scoClearHints, 2500);
      }
    } else {
      showToast('No moves', 'Stock empty and no moves \u2014 try New Game');
    }
  }
  window._scorpionCleanup = function () {
    var t = document.getElementById('solTable');
    if (!t) return;
    t.removeEventListener('dragstart', scoDragStart);
    t.removeEventListener('dragover', scoDragOver);
    t.removeEventListener('dragleave', scoDragLeave);
    t.removeEventListener('drop', scoDrop);
    t.removeEventListener('dragend', scoDragEnd);
    scoClearHints();
  };
  window._scorpionHC = function (type, idx, ci) {
    handleClick(type, idx, ci);
  };
  window._scorpionStart = function () {
    var table = document.getElementById('solTable');
    if (!table) return;
    document.getElementById('solGameTitle').textContent = 'Scorpion';
    var hb = document.getElementById('solitaireHint');
    if (hb) hb.style.display = '';
    scoHintIdx = 0;
    window._scorpionCleanup();
    table.addEventListener('dragstart', scoDragStart);
    table.addEventListener('dragover', scoDragOver);
    table.addEventListener('dragleave', scoDragLeave);
    table.addEventListener('drop', scoDrop);
    table.addEventListener('dragend', scoDragEnd);
    deal();
    var tbl = document.getElementById('solTable');
    if (tbl)
      tbl.innerHTML =
        '<div class="sol-shuffle-anim"><div class="sol-shuffle-deck"></div><div class="sol-shuffle-label">Shuffling\u2026</div></div>';
    document.getElementById('solMoves').textContent = '0';
    var et = document.getElementById('solTime');
    if (et) et.textContent = '0:00';
    clearInterval(solTimer);
    solTimer = setInterval(function () {
      solSecs++;
      var m = Math.floor(solSecs / 60),
        s = solSecs % 60;
      var el = document.getElementById('solTime');
      if (el) el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
    setTimeout(function () {
      render();
    }, 700);
  };
  window._scorpionStop = function () {
    clearInterval(solTimer);
    scoClearHints();
  };
  window._scorpionUndo = undo;
  window._scorpionHint = scoShowHint;
  window._scorpionNewGame = function () {
    scoHintIdx = 0;
    window._scorpionStart();
  };
})();

// ── FREECELL SOLITAIRE ───────────────────────────────────────────────────
(function () {
  var SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var tableau = [],
    freecells = [null, null, null, null],
    foundations = [[], [], [], []];
  var selected = null,
    selectedFrom = null,
    moves = 0,
    solTimer = null,
    solSecs = 0,
    history = [];
  function isRed(s) {
    return s === '\u2665' || s === '\u2666';
  }
  function shuf(d) {
    for (var i = d.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = d[i];
      d[i] = d[j];
      d[j] = t;
    }
    return d;
  }
  function deal() {
    var d = [];
    SUITS.forEach(function (s) {
      RANKS.forEach(function (r, i) {
        d.push({ suit: s, rank: r, value: i + 1, faceUp: true });
      });
    });
    shuf(d);
    tableau = [[], [], [], [], [], [], [], []];
    freecells = [null, null, null, null];
    foundations = [[], [], [], []];
    for (var i = 0; i < d.length; i++) tableau[i % 8].push(d[i]);
    selected = null;
    selectedFrom = null;
    moves = 0;
    solSecs = 0;
    history = [];
    var nb = document.getElementById('solNoMovesBanner');
    if (nb) nb.style.display = 'none';
  }
  function canTab(card, pile) {
    if (!pile.length) return true;
    var top = pile[pile.length - 1];
    return card.value === top.value - 1 && isRed(card.suit) !== isRed(top.suit);
  }
  function canFound(card, fi) {
    var p = foundations[fi];
    if (card.suit !== SUITS[fi]) return false;
    return p.length === 0 ? card.value === 1 : card.value === p[p.length - 1].value + 1;
  }
  function canFoundAny(card) {
    for (var f = 0; f < 4; f++) if (canFound(card, f)) return f;
    return -1;
  }
  // Supermove: max cards moveable = (freeCells+1)*2^emptyColumns
  function maxMove(dstIsEmpty) {
    var fc = freecells.filter(function (x) {
      return x === null;
    }).length;
    var ec = tableau.filter(function (p) {
      return !p.length;
    }).length;
    if (dstIsEmpty) ec = Math.max(0, ec - 1);
    return (fc + 1) * Math.pow(2, ec);
  }
  // Get the valid moveable sequence from bottom of pile
  function getMoveSeq(col) {
    var p = tableau[col];
    if (!p.length) return [];
    var seq = [p[p.length - 1]];
    for (var i = p.length - 2; i >= 0; i--) {
      var top = seq[seq.length - 1],
        cur = p[i];
      if (cur.value === top.value + 1 && isRed(cur.suit) !== isRed(top.suit)) seq.push(cur);
      else break;
    }
    return seq.reverse();
  }
  function clone(c) {
    return c ? { suit: c.suit, rank: c.rank, value: c.value, faceUp: c.faceUp } : null;
  }
  function save() {
    history.push({
      tab: tableau.map(function (p) {
        return p.map(clone);
      }),
      fc: freecells.map(clone),
      fnd: foundations.map(function (p) {
        return p.map(clone);
      }),
      mv: moves,
      sc: solSecs
    });
    if (history.length > 80) history.shift();
    updUndo();
  }
  function updUndo() {
    var b = document.getElementById('solitaireUndo');
    if (b) {
      b.disabled = !history.length;
      b.style.opacity = history.length ? '1' : '.4';
    }
  }
  function undo() {
    if (!history.length) return;
    var h = history.pop();
    tableau = h.tab;
    freecells = h.fc;
    foundations = h.fnd;
    moves = h.mv;
    solSecs = h.sc;
    selected = null;
    selectedFrom = null;
    document.getElementById('solMoves').textContent = moves;
    updUndo();
    render();
  }
  function afterMove() {
    document.getElementById('solMoves').textContent = moves;
    render();
    checkWin();
  }
  function checkWin() {
    if (
      foundations.every(function (f) {
        return f.length === 13;
      })
    ) {
      clearInterval(solTimer);
      history = [];
      updUndo();
      setTimeout(function () {
        _solWinOverlay(moves, 'window._freecellNewGame');
      }, 300);
    }
  }
  function _fcSnap(sel) {
    var e = document.querySelector(sel);
    return e ? { r: e.getBoundingClientRect(), h: e.innerHTML, c: e.className } : null;
  }
  function tryPlace(dstType, dstIdx) {
    if (!selected) return false;
    var card = selected;
    var srcSel =
      selectedFrom.type === 'freecell'
        ? '#solTable [data-type="freecell"][data-idx="' + selectedFrom.idx + '"]'
        : '#solTable [data-type="tableau"][data-idx="' +
          selectedFrom.idx +
          '"] [data-ci="' +
          (tableau[selectedFrom.idx].length - 1) +
          '"]';
    var dstSel =
      dstType === 'foundation'
        ? '#solTable [data-type="foundation"][data-idx="' + dstIdx + '"]'
        : dstType === 'freecell'
          ? '#solTable [data-type="freecell"][data-idx="' + dstIdx + '"]'
          : '#solTable [data-type="tableau"][data-idx="' + dstIdx + '"]';
    var ss = _fcSnap(srcSel);
    if (dstType === 'foundation') {
      if (canFound(card, dstIdx)) {
        save();
        if (selectedFrom.type === 'tableau') tableau[selectedFrom.idx].pop();
        else freecells[selectedFrom.idx] = null;
        foundations[dstIdx].push(card);
        moves++;
        selected = null;
        selectedFrom = null;
        afterMove();
        if (ss) _solFly(ss.r, ss.h, ss.c, dstSel, 200);
        return true;
      }
    } else if (dstType === 'freecell') {
      if (freecells[dstIdx] === null && selectedFrom.type === 'tableau') {
        if (tableau[selectedFrom.idx][tableau[selectedFrom.idx].length - 1] === card) {
          save();
          tableau[selectedFrom.idx].pop();
          freecells[dstIdx] = card;
          moves++;
          selected = null;
          selectedFrom = null;
          afterMove();
          if (ss) _solFly(ss.r, ss.h, ss.c, dstSel, 200);
          return true;
        }
      }
    } else if (dstType === 'tableau') {
      var pile = tableau[dstIdx];
      if (selectedFrom.type === 'freecell') {
        if (canTab(card, pile)) {
          save();
          freecells[selectedFrom.idx] = null;
          pile.push(card);
          moves++;
          selected = null;
          selectedFrom = null;
          afterMove();
          if (ss) _solFly(ss.r, ss.h, ss.c, dstSel, 200);
          return true;
        }
      } else if (selectedFrom.type === 'tableau') {
        var seq = getMoveSeq(selectedFrom.idx);
        var moveCard = seq.length ? seq[0] : card;
        if (canTab(moveCard, pile)) {
          var limit = maxMove(!pile.length);
          var seqToMove = seq.length <= limit ? seq : [card];
          var srcStart = tableau[selectedFrom.idx].length - seqToMove.length;
          save();
          tableau[selectedFrom.idx].splice(srcStart);
          seqToMove.forEach(function (c) {
            pile.push(c);
          });
          moves++;
          selected = null;
          selectedFrom = null;
          afterMove();
          if (ss) _solFly(ss.r, ss.h, ss.c, dstSel, 200);
          return true;
        }
      }
    }
    return false;
  }
  function handleClick(type, idx, ci) {
    if (selected) {
      // Try to place
      if (tryPlace(type, idx)) return;
      // Re-select if clicking new card
      if (type === 'tableau' && ci !== undefined) {
        var p = tableau[idx];
        if (p.length && p[p.length - 1].faceUp) {
          selected = p[p.length - 1];
          selectedFrom = { type: 'tableau', idx: idx };
          render();
          return;
        }
      }
      if (type === 'freecell' && freecells[idx]) {
        selected = freecells[idx];
        selectedFrom = { type: 'freecell', idx: idx };
        render();
        return;
      }
      selected = null;
      selectedFrom = null;
      render();
      return;
    }
    if (type === 'tableau') {
      var p2 = tableau[idx];
      if (!p2.length) return;
      selected = p2[p2.length - 1];
      selectedFrom = { type: 'tableau', idx: idx };
      render();
    } else if (type === 'freecell') {
      if (!freecells[idx]) return;
      selected = freecells[idx];
      selectedFrom = { type: 'freecell', idx: idx };
      render();
    } else if (type === 'foundation') {
      return;
    }
  }
  function handleDbl(type, idx) {
    var card = null;
    if (type === 'tableau' && tableau[idx].length) card = tableau[idx][tableau[idx].length - 1];
    else if (type === 'freecell' && freecells[idx]) card = freecells[idx];
    if (!card) return;
    var fi = canFoundAny(card);
    if (fi < 0) return;
    save();
    if (type === 'tableau') tableau[idx].pop();
    else freecells[idx] = null;
    foundations[fi].push(card);
    moves++;
    selected = null;
    selectedFrom = null;
    afterMove();
  }
  function makeCard(card, sel) {
    var el = document.createElement('div');
    el.className = 'sol-card ' + (isRed(card.suit) ? 'red' : 'black') + (sel ? ' selected' : '');
    el.draggable = true;
    el.innerHTML =
      '<div class="sol-card-rank">' +
      card.rank +
      '</div><div class="sol-card-suit">' +
      card.suit +
      '</div><div class="sol-card-center">' +
      card.suit +
      '</div>';
    return el;
  }
  function makeEmpty(cls) {
    var el = document.createElement('div');
    el.className = 'sol-pile-empty' + (cls ? ' ' + cls : '');
    return el;
  }
  function render() {
    var table = document.getElementById('solTable');
    if (!table) return;
    table.innerHTML = '';
    table.className = 'sol-table';
    var topRow = document.createElement('div');
    topRow.className = 'sol-top-row';
    // 4 freecells
    for (var f = 0; f < 4; f++)
      (function (fi) {
        var fe = makeEmpty('sol-fc-cell');
        fe.dataset.type = 'freecell';
        fe.dataset.idx = fi;
        if (freecells[fi]) {
          var isSel =
            selected && selectedFrom && selectedFrom.type === 'freecell' && selectedFrom.idx === fi;
          var c = makeCard(freecells[fi], isSel);
          c.dataset.type = 'freecell';
          c.dataset.idx = fi;
          fe.appendChild(c);
        } else {
          fe.innerHTML =
            '<div style="font-size:.7rem;color:rgba(192,132,252,.25);text-align:center;line-height:88px">Free</div>';
        }
        topRow.appendChild(fe);
      })(f);
    var sp = document.createElement('div');
    sp.style.flex = '1';
    topRow.appendChild(sp);
    // 4 foundations
    for (var ff = 0; ff < 4; ff++)
      (function (fi) {
        var fe = makeEmpty('sol-pile-foundation');
        fe.dataset.type = 'foundation';
        fe.dataset.idx = fi;
        if (foundations[fi].length) {
          var top = foundations[fi][foundations[fi].length - 1];
          var c = makeCard(top, false);
          c.dataset.type = 'foundation';
          c.dataset.idx = fi;
          fe.appendChild(c);
        } else {
          fe.innerHTML =
            '<div style="font-size:1.6rem;color:rgba(192,132,252,.2);line-height:88px;text-align:center">' +
            SUITS[fi] +
            '</div>';
        }
        topRow.appendChild(fe);
      })(ff);
    table.appendChild(topRow);
    var tabRow = document.createElement('div');
    tabRow.className = 'sol-tableau';
    for (var t = 0; t < 8; t++)
      (function (ti) {
        var pe = document.createElement('div');
        pe.className = 'sol-tab-pile sol-pile';
        pe.dataset.type = 'tableau';
        pe.dataset.idx = ti;
        pe.dataset.ci = 'empty';
        var fcTop = 0;
        tableau[ti].forEach(function (card, ci) {
          var isSel =
            selected &&
            selectedFrom &&
            selectedFrom.type === 'tableau' &&
            selectedFrom.idx === ti &&
            ci === tableau[ti].length - 1;
          var cel = makeCard(card, isSel);
          cel.dataset.type = 'tableau';
          cel.dataset.idx = ti;
          cel.dataset.ci = ci;
          cel.style.cssText = 'position:absolute;top:' + fcTop + 'px;z-index:' + (ci + 1);
          pe.appendChild(cel);
          fcTop += card.faceUp ? 28 : 14;
        });
        pe.style.height = Math.max(88, fcTop + 62) + 'px';
        tabRow.appendChild(pe);
      })(t);
    table.appendChild(tabRow);
  }
  // ── FreeCell Drag & Drop ──
  function fcDragStart(e) {
    var el = e.target.closest('[data-type]');
    if (!el) return;
    var type = el.dataset.type,
      idx = parseInt(el.dataset.idx) || 0,
      ci = el.dataset.ci;
    if (type === 'freecell') {
      if (!freecells[idx]) {
        e.preventDefault();
        return;
      }
      selected = freecells[idx];
      selectedFrom = { type: 'freecell', idx: idx };
    } else if (type === 'tableau') {
      if (!ci || ci === 'empty') {
        e.preventDefault();
        return;
      }
      ci = parseInt(ci);
      var p = tableau[idx];
      if (!p[ci] || !p[ci].faceUp) {
        e.preventDefault();
        return;
      }
      selected = p[p.length - 1];
      selectedFrom = { type: 'tableau', idx: idx };
    } else {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'sol');
    setTimeout(function () {
      render();
    }, 0);
  }
  function fcDragOver(e) {
    e.preventDefault();
    if (!selected) return;
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    var el = e.target.closest('[data-type]');
    if (!el) return;
    var type = el.dataset.type,
      idx = parseInt(el.dataset.idx) || 0;
    var ok =
      (type === 'tableau' && canTab(selected, tableau[idx])) ||
      (type === 'freecell' && freecells[idx] === null && selectedFrom.type === 'tableau') ||
      (type === 'foundation' && canFound(selected, idx));
    if (ok) {
      el.classList.add('sol-drop-hover');
      e.dataTransfer.dropEffect = 'move';
    } else e.dataTransfer.dropEffect = 'none';
  }
  function fcDragLeave(e) {
    if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget))
      document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
        x.classList.remove('sol-drop-hover');
      });
  }
  function fcDrop(e) {
    e.preventDefault();
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    var el = e.target.closest('[data-type]');
    if (!el || !selected) return;
    tryPlace(el.dataset.type, parseInt(el.dataset.idx) || 0);
    selected = null;
    selectedFrom = null;
  }
  function fcDragEnd(e) {
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    selected = null;
    selectedFrom = null;
    render();
  }
  function fcTableClick(e) {
    var el = e.target.closest('[data-type]');
    if (!el) return;
    var type = el.dataset.type,
      idx = parseInt(el.dataset.idx) || 0,
      ci = el.dataset.ci;
    var cardIdx = ci === undefined || ci === 'empty' ? undefined : parseInt(ci);
    handleClick(type, idx, isNaN(cardIdx) ? undefined : cardIdx);
  }
  function fcTableDbl(e) {
    var el = e.target.closest('[data-type]');
    if (!el) return;
    var type = el.dataset.type,
      idx = parseInt(el.dataset.idx) || 0;
    handleDbl(type, idx);
  }
  window._freecellCleanup = function () {
    var t = document.getElementById('solTable');
    if (!t) return;
    t.removeEventListener('dragstart', fcDragStart);
    t.removeEventListener('dragover', fcDragOver);
    t.removeEventListener('dragleave', fcDragLeave);
    t.removeEventListener('drop', fcDrop);
    t.removeEventListener('dragend', fcDragEnd);
    t.removeEventListener('click', fcTableClick);
    t.removeEventListener('dblclick', fcTableDbl);
  };
  window._freecellHC = function () {}; // handled by fcTableClick direct listener
  window._freecellDC = function () {}; // handled by fcTableDbl direct listener
  window._freecellStart = function () {
    var table = document.getElementById('solTable');
    if (!table) return;
    window._freecellCleanup();
    table.addEventListener('dragstart', fcDragStart);
    table.addEventListener('dragover', fcDragOver);
    table.addEventListener('dragleave', fcDragLeave);
    table.addEventListener('drop', fcDrop);
    table.addEventListener('dragend', fcDragEnd);
    table.addEventListener('click', fcTableClick);
    table.addEventListener('dblclick', fcTableDbl);
    document.getElementById('solGameTitle').textContent = 'FreeCell';
    var hb = document.getElementById('solitaireHint');
    if (hb) hb.style.display = 'none';
    deal();
    var tbl = document.getElementById('solTable');
    if (tbl)
      tbl.innerHTML =
        '<div class="sol-shuffle-anim"><div class="sol-shuffle-deck"></div><div class="sol-shuffle-label">Shuffling\u2026</div></div>';
    document.getElementById('solMoves').textContent = '0';
    var et = document.getElementById('solTime');
    if (et) et.textContent = '0:00';
    clearInterval(solTimer);
    solTimer = setInterval(function () {
      solSecs++;
      var m = Math.floor(solSecs / 60),
        s = solSecs % 60;
      var el = document.getElementById('solTime');
      if (el) el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
    setTimeout(function () {
      render();
    }, 700);
  };
  window._freecellStop = function () {
    clearInterval(solTimer);
  };
  window._freecellUndo = undo;
  window._freecellNewGame = function () {
    window._freecellStart();
  };
})();

// ── Shared solitaire card-flight animator ────────────────────────────────
// fromRect : DOMRect of the source card (snapshot BEFORE render destroys it)
// html     : innerHTML of source card (to display rank/suit on the flying clone)
// cls      : className of source card
// destSel  : CSS selector to find destination element AFTER render (queried inside rAF)
//            Pass null to make the card shrink-and-fade (for removals)
// dur      : animation duration ms
function _solFly(fromRect, html, cls, destSel, dur) {
  if (!fromRect) return;
  dur = dur || 200;
  var fly = document.createElement('div');
  fly.className = cls || 'sol-card';
  fly.innerHTML = html || '';
  fly.style.cssText =
    'position:fixed;left:' +
    fromRect.left +
    'px;top:' +
    fromRect.top +
    'px;width:' +
    fromRect.width +
    'px;height:' +
    fromRect.height +
    'px;margin:0;z-index:9999;pointer-events:none;transition:left ' +
    dur +
    'ms cubic-bezier(.22,1,.36,1),top ' +
    dur +
    'ms cubic-bezier(.22,1,.36,1),width ' +
    dur +
    'ms,height ' +
    dur +
    'ms,opacity ' +
    dur +
    'ms,transform ' +
    dur +
    'ms;';
  document.body.appendChild(fly);
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (destSel) {
        var dst = document.querySelector(destSel);
        if (dst) {
          var r = dst.getBoundingClientRect();
          fly.style.left = r.left + 'px';
          fly.style.top = r.top + 'px';
          fly.style.width = r.width + 'px';
          fly.style.height = r.height + 'px';
        }
      } else {
        fly.style.opacity = '0';
        fly.style.transform = 'scale(0.25) rotate(12deg)';
      }
    });
  });
  setTimeout(function () {
    fly.remove();
  }, dur + 80);
}

function _solPlayWinSound() {
  try {
    var ac = new (window.AudioContext || window.webkitAudioContext)();
    var notes = [523, 659, 784, 1047];
    notes.forEach(function (freq, ni) {
      setTimeout(function () {
        var osc = ac.createOscillator(),
          g = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, ac.currentTime);
        g.gain.linearRampToValueAtTime(0.35, ac.currentTime + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.45);
        osc.connect(g);
        g.connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + 0.5);
      }, ni * 130);
    });
  } catch (e) {}
}

function _solWinOverlay(moves, newGameFn) {
  var table = document.getElementById('solTable');
  if (!table) return;
  if (table.querySelector('.sol-gameover-overlay')) return;
  table.style.position = 'relative';
  var ov = document.createElement('div');
  ov.className = 'sol-gameover-overlay';
  ov.innerHTML =
    '<div class="sol-gameover-title" style="color:#4ade80;font-size:2.8rem">\uD83C\uDF89 You Win!</div><div class="sol-gameover-sub">Completed in ' +
    moves +
    ' moves</div>';
  var playAgainBtn = document.createElement('button');
  playAgainBtn.className = 'sol-gameover-btn';
  playAgainBtn.textContent = 'Play Again';
  playAgainBtn.addEventListener('click', function () {
    if (typeof newGameFn === 'function') {
      newGameFn();
      return;
    }
    if (typeof newGameFn === 'string') {
      var fn = newGameFn.split('.').reduce(function (ctx, key) {
        return ctx && ctx[key];
      }, window);
      if (typeof fn === 'function') fn();
    }
  });
  ov.appendChild(playAgainBtn);
  table.appendChild(ov);
  _solPlayWinSound();
  for (var i = 0; i < 32; i++) {
    (function (i2) {
      setTimeout(function () {
        var c = document.createElement('div');
        c.style.cssText =
          'position:fixed;left:' +
          Math.random() * 100 +
          'vw;top:-20px;width:' +
          (8 + Math.random() * 8) +
          'px;height:' +
          (8 + Math.random() * 8) +
          'px;background:hsl(' +
          Math.random() * 360 +
          ',80%,60%);border-radius:2px;pointer-events:none;z-index:9999;animation:confettiDrop ' +
          (1.2 + Math.random() * 1.2) +
          's ease forwards';
        document.body.appendChild(c);
        setTimeout(function () {
          c.remove();
        }, 2600);
      }, i2 * 55);
    })(i);
  }
}

// ── PYRAMID SOLITAIRE ────────────────────────────────────────────────────
(function () {
  var SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  // pyramid[i] = card or null; 28 slots, row r has indices sum(0..r-1) to sum(0..r)-1
  var pyramid = [],
    stock = [],
    waste = [],
    removed = [];
  var sel1 = null,
    moves = 0,
    solTimer = null,
    solSecs = 0,
    history = [];
  // Row r starts at index r*(r+1)/2... wait, row r has r+1 cards, starts at r*(r+1)/2 - no
  // Row 0: 1 card (index 0), row 1: 2 cards (1-2), row 2: 3 (3-5), ..., row 6: 7 (21-27)
  // Index in row r, col c: r*(r+1)/2 + c... wait r*(r+1)/2 for row r starting index
  // Row 0 start = 0, row 1 start = 1, row 2 start = 3, row 3 start = 6, row 4 = 10, row 5 = 15, row 6 = 21
  function rowStart(r) {
    return (r * (r + 1)) / 2;
  }
  // Card at (r,c) is covered by (r+1,c) and (r+1,c+1)
  function isCovered(idx) {
    // Find row and col
    var r = 0;
    while (rowStart(r + 1) <= idx) r++;
    var c = idx - rowStart(r);
    if (r === 6) return false; // bottom row, never covered
    var i1 = rowStart(r + 1) + c,
      i2 = rowStart(r + 1) + c + 1;
    return pyramid[i1] !== null || pyramid[i2] !== null;
  }
  function isUncovered(idx) {
    return pyramid[idx] !== null && !isCovered(idx);
  }
  function cardValue(card) {
    return card.value;
  }
  function shuf(d) {
    for (var i = d.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = d[i];
      d[i] = d[j];
      d[j] = t;
    }
    return d;
  }

  // Greedy solver: returns number of moves to clear pyramid, or Infinity if stuck within limit
  function solverCanWin(pyr, stk) {
    var p = pyr.slice(),
      s = stk.slice().reverse(),
      w = [],
      m = 0,
      limit = 69;
    function rowStart2(r) {
      return (r * (r + 1)) / 2;
    }
    function isCov(idx, arr) {
      var r = 0;
      while (rowStart2(r + 1) <= idx) r++;
      var c = idx - rowStart2(r);
      if (r === 6) return false;
      var i1 = rowStart2(r + 1) + c,
        i2 = rowStart2(r + 1) + c + 1;
      return arr[i1] !== null || arr[i2] !== null;
    }
    function isUncov(idx, arr) {
      return arr[idx] !== null && !isCov(idx, arr);
    }
    function getUncov(arr) {
      var u = [];
      for (var i = 0; i < 28; i++) {
        if (isUncov(i, arr)) u.push(i);
      }
      return u;
    }
    function allGone(arr) {
      return arr.every(function (c) {
        return c === null;
      });
    }
    // Up to limit steps
    var cycleCheck = 0;
    while (m <= limit) {
      if (allGone(p)) return m;
      var u = getUncov(p);
      var moved = false;
      // Remove kings
      for (var i = 0; i < u.length; i++) {
        if (p[u[i]].value === 13) {
          p[u[i]] = null;
          m++;
          moved = true;
          break;
        }
      }
      if (moved) continue;
      // Remove waste king
      if (w.length && w[w.length - 1].value === 13) {
        w.pop();
        m++;
        continue;
      }
      // Find uncovered pair
      var uvals = {};
      for (var i = 0; i < u.length; i++) {
        var v = p[u[i]].value;
        if (uvals[13 - v] !== undefined) {
          p[u[i]] = null;
          p[uvals[13 - v]] = null;
          m++;
          moved = true;
          break;
        }
        uvals[v] = u[i];
      }
      if (moved) continue;
      // Waste + uncovered pair
      if (w.length) {
        var wv = w[w.length - 1].value;
        for (var i = 0; i < u.length; i++) {
          if (p[u[i]].value + wv === 13) {
            p[u[i]] = null;
            w.pop();
            m++;
            moved = true;
            break;
          }
        }
      }
      if (moved) continue;
      // Deal from stock
      if (s.length) {
        var c = s.pop();
        c.faceUp = true;
        w.push(c);
        m++;
      } else if (w.length) {
        // recycle once
        if (cycleCheck > 0) break;
        cycleCheck++;
        s = w.slice().reverse();
        w = [];
      } else break;
    }
    return allGone(p) ? m : Infinity;
  }

  function deal() {
    var d = [];
    SUITS.forEach(function (s) {
      RANKS.forEach(function (r, i) {
        d.push({ suit: s, rank: r, value: i + 1, faceUp: true });
      });
    });
    var attempts = 0;
    do {
      shuf(d);
      attempts++;
    } while (solverCanWin(d.slice(0, 28), d.slice(28)) > MAX_MOVES - 1 && attempts < 200);
    pyramid = d.slice(0, 28);
    stock = d.slice(28).reverse();
    waste = [];
    removed = [];
    sel1 = null;
    moves = 0;
    solSecs = 0;
    history = [];
    var nb = document.getElementById('solNoMovesBanner');
    if (nb) nb.style.display = 'none';
  }
  function isRed(s) {
    return s === '\u2665' || s === '\u2666';
  }
  function cloneCard(c) {
    return c ? { suit: c.suit, rank: c.rank, value: c.value, faceUp: c.faceUp } : null;
  }
  function save() {
    history.push({
      pyr: pyramid.map(cloneCard),
      stk: stock.map(cloneCard),
      wst: waste.map(cloneCard),
      rem: removed.slice(),
      mv: moves,
      sc: solSecs,
      s1: sel1
    });
    if (history.length > 80) history.shift();
    updUndo();
  }
  function updUndo() {
    var b = document.getElementById('solitaireUndo');
    if (b) {
      b.disabled = !history.length;
      b.style.opacity = history.length ? '1' : '.4';
    }
  }
  function undo() {
    if (!history.length) return;
    var h = history.pop();
    pyramid = h.pyr;
    stock = h.stk;
    waste = h.wst;
    removed = h.rem;
    moves = h.mv;
    solSecs = h.sc;
    sel1 = h.s1;
    document.getElementById('solMoves').textContent = moves;
    updUndo();
    render();
  }
  var MAX_MOVES = 70;
  function hasAnyMove() {
    if (stock.length || waste.length) return true;
    var uncov = [];
    for (var i = 0; i < 28; i++) {
      if (pyramid[i] && isUncovered(i)) uncov.push(pyramid[i].value);
    }
    var wv = waste.length ? waste[waste.length - 1].value : null;
    for (var i = 0; i < uncov.length; i++) {
      if (uncov[i] === 13) return true;
    }
    if (wv === 13) return true;
    var seen = {};
    for (var i = 0; i < uncov.length; i++) {
      if (seen[13 - uncov[i]]) return true;
      seen[uncov[i]] = true;
    }
    if (wv !== null) {
      for (var i = 0; i < uncov.length; i++) {
        if (uncov[i] + wv === 13) return true;
      }
    }
    return false;
  }
  function afterMove() {
    document.getElementById('solMoves').textContent = moves;
    render();
    if (checkWin()) return;
    if (moves >= MAX_MOVES) {
      showGameOver('70-move limit reached');
      return;
    }
    if (!hasAnyMove()) {
      showGameOver('No moves remaining');
    }
  }
  function showGameOver(reason) {
    clearInterval(solTimer);
    var table = document.getElementById('solTable');
    if (!table) return;
    if (table.querySelector('.sol-gameover-overlay')) return;
    table.style.position = 'relative';
    var ov = document.createElement('div');
    ov.className = 'sol-gameover-overlay';
    ov.innerHTML =
      '<div class="sol-gameover-title">Game Over</div><div class="sol-gameover-sub">' +
      (reason || '') +
      '</div>';
    var newGameBtn = document.createElement('button');
    newGameBtn.className = 'sol-gameover-btn';
    newGameBtn.textContent = 'New Game';
    newGameBtn.addEventListener('click', function () {
      if (typeof window._pyramidNewGame === 'function') {
        window._pyramidNewGame();
      }
    });
    ov.appendChild(newGameBtn);
    table.appendChild(ov);
  }
  function checkWin() {
    if (
      pyramid.every(function (c) {
        return c === null;
      })
    ) {
      clearInterval(solTimer);
      history = [];
      updUndo();
      setTimeout(function () {
        _solWinOverlay(moves, 'window._pyramidNewGame');
      }, 300);
      return true;
    }
    return false;
  }
  function _pyrSnap(sel) {
    var e = document.querySelector(sel);
    return e ? { r: e.getBoundingClientRect(), h: e.innerHTML, c: e.className } : null;
  }
  function tryRemovePair(i1, i2) {
    var c1 = pyramid[i1],
      c2 = pyramid[i2];
    if (!c1 || !c2) return false;
    if (c1.value + c2.value !== 13) return false;
    if (i1 === i2) return false;
    // i1 (first selected) must have been uncovered; i2 may be covered by i1 only
    if (!isUncovered(i1)) return false;
    var s1 = _pyrSnap('#solTable [data-type="pyramid"][data-idx="' + i1 + '"]');
    var s2 = _pyrSnap('#solTable [data-type="pyramid"][data-idx="' + i2 + '"]');
    save();
    pyramid[i1] = null;
    pyramid[i2] = null;
    moves++;
    sel1 = null;
    afterMove();
    if (s1) _solFly(s1.r, s1.h, s1.c, null, 220);
    if (s2) _solFly(s2.r, s2.h, s2.c, null, 220);
    return true;
  }
  function tryRemoveKing(idx) {
    var c = pyramid[idx];
    if (!c || c.value !== 13 || !isUncovered(idx)) return false;
    var s = _pyrSnap('#solTable [data-type="pyramid"][data-idx="' + idx + '"]');
    save();
    pyramid[idx] = null;
    moves++;
    sel1 = null;
    afterMove();
    if (s) _solFly(s.r, s.h, s.c, null, 220);
    return true;
  }
  function tryRemoveWithWaste(pyrIdx) {
    var pc = pyramid[pyrIdx],
      wc = waste.length ? waste[waste.length - 1] : null;
    if (!pc || !wc) return false;
    if (pc.value + wc.value !== 13) return false;
    if (!isUncovered(pyrIdx)) return false;
    var sp = _pyrSnap('#solTable [data-type="pyramid"][data-idx="' + pyrIdx + '"]');
    var sw = _pyrSnap('#solTable [data-type="waste"]');
    save();
    pyramid[pyrIdx] = null;
    waste.pop();
    moves++;
    sel1 = null;
    afterMove();
    if (sp) _solFly(sp.r, sp.h, sp.c, null, 220);
    if (sw) _solFly(sw.r, sw.h, sw.c, null, 220);
    return true;
  }
  function tryRemoveWasteKing() {
    var wc = waste.length ? waste[waste.length - 1] : null;
    if (!wc || wc.value !== 13) return false;
    var sw = _pyrSnap('#solTable [data-type="waste"]');
    save();
    waste.pop();
    moves++;
    sel1 = null;
    afterMove();
    if (sw) _solFly(sw.r, sw.h, sw.c, null, 220);
    return true;
  }
  function handleClick(type, idx) {
    if (type === 'stock') {
      if (stock.length) {
        var ss = _pyrSnap('#solTable [data-type="stock"]');
        save();
        var c = stock.pop();
        c.faceUp = true;
        waste.push(c);
        sel1 = null;
        moves++;
        document.getElementById('solMoves').textContent = moves;
        render();
        if (moves >= MAX_MOVES) {
          showGameOver('70-move limit reached');
          return;
        }
        if (!hasAnyMove()) {
          showGameOver('No moves remaining');
          return;
        }
        if (ss) _solFly(ss.r, '', 'sol-card face-down', '#solTable [data-type="waste"]', 200);
        // Flip animation on the newly dealt waste card
        setTimeout(function () {
          var we2 = document.querySelector('#solTable [data-type="waste"] .sol-card');
          if (we2) {
            we2.classList.add('sol-flip-anim');
            setTimeout(function () {
              we2.classList.remove('sol-flip-anim');
            }, 400);
          }
        }, 50);
      } else if (waste.length) {
        save();
        while (waste.length) {
          var wc2 = waste.pop();
          wc2.faceUp = false;
          stock.push(wc2);
        }
        sel1 = null;
        document.getElementById('solMoves').textContent = moves;
        render();
      }
      return;
    }
    if (type === 'waste') {
      var wc = waste.length ? waste[waste.length - 1] : null;
      if (!wc) return;
      if (wc.value === 13) {
        tryRemoveWasteKing();
        return;
      }
      if (sel1 !== null && sel1.type === 'pyramid') {
        var pc = pyramid[sel1.idx];
        if (pc && pc.value + wc.value === 13 && isUncovered(sel1.idx)) {
          var sp2 = _pyrSnap('#solTable [data-type="pyramid"][data-idx="' + sel1.idx + '"]');
          var sw2 = _pyrSnap('#solTable [data-type="waste"]');
          save();
          pyramid[sel1.idx] = null;
          waste.pop();
          moves++;
          sel1 = null;
          afterMove();
          if (sp2) _solFly(sp2.r, sp2.h, sp2.c, null, 220);
          if (sw2) _solFly(sw2.r, sw2.h, sw2.c, null, 220);
          return;
        }
      }
      sel1 = { type: 'waste' };
      render();
      return;
    }
    if (type === 'pyramid') {
      var pc2 = pyramid[idx];
      if (!pc2) return;
      var uncovIdx = isUncovered(idx);
      // First selection: must be uncovered; Kings remove immediately
      if (sel1 === null) {
        if (!uncovIdx) return;
        if (pc2.value === 13) {
          tryRemoveKing(idx);
          return;
        }
        sel1 = { type: 'pyramid', idx: idx };
        render();
        return;
      }
      if (sel1.type === 'pyramid') {
        if (sel1.idx === idx) {
          sel1 = null;
          render();
          return;
        }
        // Try to pair — second card may be covered (relaxed rule for end-game)
        if (tryRemovePair(sel1.idx, idx)) return;
        // Not a valid pair — if uncovered, select it instead
        if (uncovIdx) {
          sel1 = { type: 'pyramid', idx: idx };
          render();
        }
        return;
      }
      if (sel1.type === 'waste') {
        var wc3 = waste.length ? waste[waste.length - 1] : null;
        if (wc3 && pc2.value + wc3.value === 13) {
          var sp3 = _pyrSnap('#solTable [data-type="pyramid"][data-idx="' + idx + '"]');
          var sw3 = _pyrSnap('#solTable [data-type="waste"]');
          save();
          pyramid[idx] = null;
          waste.pop();
          moves++;
          sel1 = null;
          afterMove();
          if (sp3) _solFly(sp3.r, sp3.h, sp3.c, null, 220);
          if (sw3) _solFly(sw3.r, sw3.h, sw3.c, null, 220);
          return;
        }
        if (uncovIdx) {
          sel1 = { type: 'pyramid', idx: idx };
          render();
        }
        return;
      }
    }
  }
  function isRed2(s) {
    return s === '\u2665' || s === '\u2666';
  }
  function makeCardEl(card, extraCls) {
    var el = document.createElement('div');
    el.className =
      'sol-card ' + (isRed2(card.suit) ? 'red' : 'black') + (extraCls ? ' ' + extraCls : '');
    el.innerHTML =
      '<div class="sol-card-rank">' +
      card.rank +
      '</div><div class="sol-card-suit">' +
      card.suit +
      '</div><div class="sol-card-center">' +
      card.suit +
      '</div>';
    return el;
  }
  function render() {
    var table = document.getElementById('solTable');
    if (!table) return;
    table.innerHTML = '';
    table.className = 'sol-table sol-pyramid-table';

    // ── Outer layout: left panel + pyramid area ──
    var layout = document.createElement('div');
    layout.style.cssText = 'display:flex;gap:16px;align-items:flex-start;justify-content:center';

    // ── Left panel: selected-card holder + removed count ──
    var leftPanel = document.createElement('div');
    leftPanel.style.cssText =
      'display:flex;flex-direction:column;align-items:center;gap:8px;min-width:70px;padding-top:4px';
    var holderLabel = document.createElement('div');
    holderLabel.style.cssText =
      'font-size:.65rem;color:rgba(192,132,252,.5);text-align:center;letter-spacing:.04em';
    holderLabel.textContent = 'HELD';
    var holder = document.createElement('div');
    holder.className = 'sol-pile-empty';
    holder.style.cssText = 'width:62px;height:88px;position:relative;';
    if (sel1 && sel1.type === 'pyramid' && pyramid[sel1.idx]) {
      var hc = makeCardEl(pyramid[sel1.idx], 'selected');
      hc.style.cssText = 'width:100%;cursor:pointer;';
      hc.onclick = function () {
        sel1 = null;
        render();
      };
      holder.appendChild(hc);
    } else if (sel1 && sel1.type === 'waste' && waste.length) {
      var hc2 = makeCardEl(waste[waste.length - 1], 'selected');
      hc2.style.cssText = 'width:100%;cursor:pointer;';
      hc2.onclick = function () {
        sel1 = null;
        render();
      };
      holder.appendChild(hc2);
    } else {
      holder.innerHTML =
        '<div style="font-size:1.4rem;line-height:88px;text-align:center;color:rgba(192,132,252,.15)">?</div>';
    }
    var removedCount = document.createElement('div');
    removedCount.style.cssText = 'font-size:.65rem;color:rgba(192,132,252,.4);text-align:center';
    var gone =
      28 -
      pyramid.filter(function (c) {
        return c !== null;
      }).length;
    removedCount.textContent = gone + ' removed';
    leftPanel.appendChild(holderLabel);
    leftPanel.appendChild(holder);
    leftPanel.appendChild(removedCount);
    layout.appendChild(leftPanel);

    // ── Right: pyramid + bottom row ──
    var rightCol = document.createElement('div');
    rightCol.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px';

    var wrap = document.createElement('div');
    wrap.className = 'sol-pyramid-wrap';
    var CARD_W = 58,
      CARD_H = 82,
      COL_W = 62,
      ROW_H = 50;
    var totalW = 7 * COL_W;
    for (var r = 0; r < 7; r++) {
      var rowCards = r + 1;
      var rowLeft = Math.floor((totalW - rowCards * COL_W) / 2);
      for (var c = 0; c < rowCards; c++) {
        var idx2 = rowStart(r) + c;
        var card = pyramid[idx2];
        var el = document.createElement('div');
        el.style.cssText =
          'position:absolute;left:' +
          (rowLeft + c * COL_W) +
          'px;top:' +
          r * ROW_H +
          'px;width:' +
          CARD_W +
          'px';
        if (card) {
          var uncov = isUncovered(idx2);
          el.className = 'sol-card ' + (isRed2(card.suit) ? 'red' : 'black');
          var isSelected = sel1 && sel1.type === 'pyramid' && sel1.idx === idx2;
          var selCard = sel1 && sel1.type === 'pyramid' ? pyramid[sel1.idx] : null;
          var isPairWithSel = selCard && selCard.value + card.value === 13 && sel1.idx !== idx2;
          var wasteCard =
            sel1 && sel1.type === 'waste' && waste.length ? waste[waste.length - 1] : null;
          var isPairWithWaste = wasteCard && wasteCard.value + card.value === 13;
          if (isSelected) {
            el.classList.add('selected');
            el.style.transform = 'translateY(-6px)';
          } else if (isPairWithSel || isPairWithWaste) {
            el.classList.add('selected');
            el.style.opacity = '1';
          } else if (!uncov) {
            el.style.opacity = '.45';
            el.style.cursor = 'default';
          }
          // Clickable: always uncovered, OR covered but pairs with current selection
          if (uncov || (sel1 && (isPairWithSel || isPairWithWaste))) {
            (function (i2) {
              el.onclick = function () {
                handleClick('pyramid', i2);
              };
            })(idx2);
          }
          el.innerHTML =
            '<div class="sol-card-rank">' +
            card.rank +
            '</div><div class="sol-card-suit">' +
            card.suit +
            '</div><div class="sol-card-center">' +
            card.suit +
            '</div>';
          el.dataset.type = 'pyramid';
          el.dataset.idx = idx2;
        } else {
          el.className = 'sol-pyramid-empty';
        }
        wrap.appendChild(el);
      }
    }
    wrap.style.cssText =
      'position:relative;width:' + totalW + 'px;height:' + (7 * ROW_H + CARD_H) + 'px';
    rightCol.appendChild(wrap);

    // Stock + waste row
    var botRow = document.createElement('div');
    botRow.style.cssText = 'display:flex;gap:10px;align-items:flex-start';
    var se = document.createElement('div');
    se.className = 'sol-pile-empty';
    se.style.cursor = 'pointer';
    se.dataset.type = 'stock';
    se.dataset.idx = '0';
    se.onclick = function () {
      handleClick('stock', 0);
    };
    if (stock.length) {
      var fd = document.createElement('div');
      fd.className = 'sol-card face-down';
      se.appendChild(fd);
      var slbl = document.createElement('div');
      slbl.style.cssText =
        'text-align:center;font-size:.62rem;color:rgba(192,132,252,.45);margin-top:2px';
      slbl.textContent = stock.length + ' left';
      se.appendChild(slbl);
    } else {
      se.innerHTML =
        '<div style="font-size:1rem;color:rgba(192,132,252,.3);line-height:88px;text-align:center">\u21BA</div>';
    }
    botRow.appendChild(se);
    var we = document.createElement('div');
    we.className = 'sol-pile-empty';
    we.dataset.type = 'waste';
    we.dataset.idx = '0';
    we.onclick = function () {
      handleClick('waste', 0);
    };
    if (waste.length) {
      var wc4 = waste[waste.length - 1];
      var wcel = makeCardEl(wc4, sel1 && sel1.type === 'waste' ? 'selected' : '');
      if (sel1 && sel1.type === 'waste') wcel.style.transform = 'translateY(-6px)';
      wcel.dataset.type = 'waste';
      wcel.dataset.idx = '0';
      we.appendChild(wcel);
    } else {
      we.innerHTML =
        '<div style="font-size:.8rem;color:rgba(192,132,252,.2);line-height:88px;text-align:center">Waste</div>';
    }
    botRow.appendChild(we);
    rightCol.appendChild(botRow);
    layout.appendChild(rightCol);
    table.appendChild(layout);
  }
  window._pyramidCleanup = function () {};
  window._pyramidHC = function () {};
  window._pyramidStart = function () {
    var table = document.getElementById('solTable');
    if (!table) return;
    document.getElementById('solGameTitle').textContent = 'Pyramid';
    var hb = document.getElementById('solitaireHint');
    if (hb) hb.style.display = 'none';
    deal();
    table.innerHTML =
      '<div class="sol-shuffle-anim"><div class="sol-shuffle-deck"></div><div class="sol-shuffle-label">Shuffling\u2026</div></div>';
    document.getElementById('solMoves').textContent = '0';
    var et = document.getElementById('solTime');
    if (et) et.textContent = '0:00';
    clearInterval(solTimer);
    solTimer = setInterval(function () {
      solSecs++;
      var m = Math.floor(solSecs / 60),
        s = solSecs % 60;
      var el = document.getElementById('solTime');
      if (el) el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
    setTimeout(function () {
      render();
    }, 700);
  };
  window._pyramidStop = function () {
    clearInterval(solTimer);
  };
  window._pyramidUndo = undo;
  window._pyramidNewGame = function () {
    window._pyramidStart();
  };
})();

// ── TRI-PEAKS SOLITAIRE ──────────────────────────────────────────────────
(function () {
  var SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  // 28 peak cards + 24 stock
  // Indices 0-27, layout:
  // Row0: 0,1,2  (peak tops)
  // Row1: 3,4,5,6,7,8  (2 per peak)
  // Row2: 9,10,11,12,13,14,15,16,17  (3 per peak)
  // Row3 (base): 18,19,20,21,22,23,24,25,26,27  (10)
  // Coverage: card at idx is covered by cards below it (higher row indices)
  var COVERS = {
    0: [3, 4],
    1: [5, 6],
    2: [7, 8],
    3: [9, 10],
    4: [10, 11],
    5: [12, 13],
    6: [13, 14],
    7: [15, 16],
    8: [16, 17],
    9: [18, 19],
    10: [19, 20],
    11: [20, 21],
    12: [21, 22],
    13: [22, 23],
    14: [23, 24],
    15: [24, 25],
    16: [25, 26],
    17: [26, 27]
  };
  // Position (col-offset) for rendering — each unit = card width (60px) + gap
  // Row3 has 10 cards spanning full width; peaks are centered above
  var COLS = 10; // base width in card units
  var POS = [
    // Row 0: peak tops — peak1 at col1.5, peak2 at col4.5, peak3 at col7.5 (0-indexed center)
    { r: 0, c: 1.5 },
    { r: 0, c: 4.5 },
    { r: 0, c: 7.5 },
    // Row 1
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 1, c: 4 },
    { r: 1, c: 5 },
    { r: 1, c: 7 },
    { r: 1, c: 8 },
    // Row 2
    { r: 2, c: 0.5 },
    { r: 2, c: 1.5 },
    { r: 2, c: 2.5 },
    { r: 2, c: 3.5 },
    { r: 2, c: 4.5 },
    { r: 2, c: 5.5 },
    { r: 2, c: 6.5 },
    { r: 2, c: 7.5 },
    { r: 2, c: 8.5 },
    // Row 3 (base)
    { r: 3, c: 0 },
    { r: 3, c: 1 },
    { r: 3, c: 2 },
    { r: 3, c: 3 },
    { r: 3, c: 4 },
    { r: 3, c: 5 },
    { r: 3, c: 6 },
    { r: 3, c: 7 },
    { r: 3, c: 8 },
    { r: 3, c: 9 }
  ];
  var peaks = [],
    stock = [],
    waste = [];
  var moves = 0,
    solTimer = null,
    solSecs = 0,
    history = [];
  function shuf(d) {
    for (var i = d.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = d[i];
      d[i] = d[j];
      d[j] = t;
    }
    return d;
  }
  function deal() {
    var d = [];
    SUITS.forEach(function (s) {
      RANKS.forEach(function (r, i) {
        d.push({ suit: s, rank: r, value: i + 1 });
      });
    });
    shuf(d);
    peaks = d.slice(0, 28).map(function (c, i) {
      return { suit: c.suit, rank: c.rank, value: c.value, removed: false, faceUp: true };
    });
    stock = d.slice(28).map(function (c) {
      return { suit: c.suit, rank: c.rank, value: c.value, removed: false, faceUp: false };
    });
    waste = [];
    moves = 0;
    solSecs = 0;
    history = [];
    var nb = document.getElementById('solNoMovesBanner');
    if (nb) nb.style.display = 'none';
  }
  function isRed(s) {
    return s === '\u2665' || s === '\u2666';
  }
  function isCov(idx) {
    var coverers = COVERS[idx];
    if (!coverers) return false;
    return coverers.some(function (ci) {
      return !peaks[ci].removed;
    });
  }
  function isUncov(idx) {
    return !peaks[idx].removed && !isCov(idx);
  }
  function seq(v1, v2) {
    var diff = Math.abs(v1 - v2);
    return diff === 1 || diff === 12;
  } // A-K wrapping
  function wasteTop() {
    return waste.length ? waste[waste.length - 1] : null;
  }
  function clone2(c) {
    return { suit: c.suit, rank: c.rank, value: c.value, removed: c.removed, faceUp: c.faceUp };
  }
  function save() {
    history.push({
      pk: peaks.map(clone2),
      stk: stock.map(clone2),
      wst: waste.map(clone2),
      mv: moves,
      sc: solSecs
    });
    if (history.length > 80) history.shift();
    updUndo();
  }
  function updUndo() {
    var b = document.getElementById('solitaireUndo');
    if (b) {
      b.disabled = !history.length;
      b.style.opacity = history.length ? '1' : '.4';
    }
  }
  function undo() {
    if (!history.length) return;
    var h = history.pop();
    peaks = h.pk;
    stock = h.stk;
    waste = h.wst;
    moves = h.mv;
    solSecs = h.sc;
    document.getElementById('solMoves').textContent = moves;
    updUndo();
    render();
  }
  function afterMove() {
    // Reveal newly uncovered cards
    for (var i = 0; i < 28; i++) {
      if (!peaks[i].removed && !isCov(i)) peaks[i].faceUp = true;
    }
    document.getElementById('solMoves').textContent = moves;
    render();
    checkWin();
  }
  function checkWin() {
    if (
      peaks.every(function (c) {
        return c.removed;
      })
    ) {
      clearInterval(solTimer);
      history = [];
      updUndo();
      setTimeout(function () {
        _solWinOverlay(moves, 'window._tripeaksNewGame');
      }, 300);
    }
  }
  function _triSnap(sel) {
    var e = document.querySelector(sel);
    return e ? { r: e.getBoundingClientRect(), h: e.innerHTML, c: e.className } : null;
  }
  function handleClick(type, idx) {
    if (type === 'stock') {
      if (stock.length) {
        var ss = _triSnap('#solTable [data-type="stock"]');
        save();
        var c = stock.pop();
        c.faceUp = true;
        waste.push(c);
        document.getElementById('solMoves').textContent = moves;
        render();
        if (ss)
          _solFly(ss.r, '', 'sol-card face-down', '#solTable [data-type="waste-display"]', 180);
      }
      return;
    }
    if (type === 'peak') {
      if (peaks[idx].removed || !isUncov(idx)) return;
      var sp = _triSnap('#solTable [data-type="peak"][data-idx="' + idx + '"]');
      var wt = wasteTop();
      if (!wt) {
        save();
        waste.push(peaks[idx]);
        peaks[idx].removed = true;
        moves++;
        afterMove();
        if (sp) _solFly(sp.r, sp.h, sp.c, '#solTable [data-type="waste-display"]', 180);
        return;
      }
      if (seq(peaks[idx].value, wt.value)) {
        save();
        waste.push(peaks[idx]);
        peaks[idx].removed = true;
        moves++;
        afterMove();
        if (sp) _solFly(sp.r, sp.h, sp.c, '#solTable [data-type="waste-display"]', 180);
      }
    }
  }
  function render() {
    var table = document.getElementById('solTable');
    if (!table) return;
    table.innerHTML = '';
    table.className = 'sol-table';
    var CW = 58,
      CH = 82,
      GAP = 4,
      ROW_H = 56;
    var totalW = COLS * (CW + GAP) - GAP;
    var wrap = document.createElement('div');
    wrap.style.cssText =
      'position:relative;width:' + totalW + 'px;height:' + (4 * ROW_H + CH) + 'px;margin:0 auto';
    for (var i = 0; i < 28; i++) {
      if (peaks[i].removed) continue;
      var pos = POS[i];
      var left = pos.c * (CW + GAP),
        top = pos.r * ROW_H;
      var el = document.createElement('div');
      el.style.cssText =
        'position:absolute;left:' +
        left +
        'px;top:' +
        top +
        'px;width:' +
        CW +
        'px;height:' +
        CH +
        'px';
      var uncov = isUncov(i);
      el.className = 'sol-card ' + (isRed(peaks[i].suit) ? 'red' : 'black');
      if (!uncov) {
        el.style.opacity = '.55';
        el.style.cursor = 'default';
      } else {
        var wt2 = wasteTop();
        el.dataset.type = 'peak';
        el.dataset.idx = i;
        (function (pi) {
          el.onclick = function () {
            handleClick('peak', pi);
          };
        })(i);
      }
      el.innerHTML =
        '<div class="sol-card-rank">' +
        peaks[i].rank +
        '</div><div class="sol-card-suit">' +
        peaks[i].suit +
        '</div><div class="sol-card-center">' +
        peaks[i].suit +
        '</div>';
      wrap.appendChild(el);
    }
    table.appendChild(wrap);
    var botRow = document.createElement('div');
    botRow.style.cssText = 'display:flex;gap:10px;margin-top:12px;align-items:flex-start';
    var se = document.createElement('div');
    se.className = 'sol-pile-empty';
    se.dataset.type = 'stock';
    se.dataset.idx = '0';
    se.style.cursor = 'pointer';
    se.onclick = function () {
      handleClick('stock', 0);
    };
    if (stock.length) {
      var fd = document.createElement('div');
      fd.className = 'sol-card face-down';
      fd.dataset.type = 'stock';
      fd.dataset.idx = '0';
      se.appendChild(fd);
      var lb = document.createElement('div');
      lb.style.cssText =
        'text-align:center;font-size:.65rem;color:rgba(192,132,252,.5);margin-top:2px';
      lb.textContent = stock.length + ' left';
      se.appendChild(lb);
    } else {
      se.innerHTML =
        '<div style="font-size:1rem;color:rgba(192,132,252,.3);line-height:88px;text-align:center">\u2205</div>';
    }
    botRow.appendChild(se);
    var we = document.createElement('div');
    we.className = 'sol-pile-empty';
    we.dataset.type = 'waste-display';
    var wt3 = wasteTop();
    if (wt3) {
      var wcel = document.createElement('div');
      wcel.className = 'sol-card ' + (isRed(wt3.suit) ? 'red' : 'black');
      wcel.innerHTML =
        '<div class="sol-card-rank">' +
        wt3.rank +
        '</div><div class="sol-card-suit">' +
        wt3.suit +
        '</div><div class="sol-card-center">' +
        wt3.suit +
        '</div>';
      we.appendChild(wcel);
    } else {
      we.innerHTML =
        '<div style="font-size:.8rem;color:rgba(192,132,252,.2);line-height:88px;text-align:center">Waste</div>';
    }
    botRow.appendChild(we);
    var rem = document.createElement('span');
    rem.style.cssText =
      'color:rgba(192,132,252,.5);font-size:.8rem;align-self:center;margin-left:8px';
    rem.textContent =
      peaks.filter(function (c) {
        return !c.removed;
      }).length + ' peak cards left';
    botRow.appendChild(rem);
    table.appendChild(botRow);
  }
  window._tripeaksCleanup = function () {};
  window._tripeaksHC = function () {};
  window._tripeaksStart = function () {
    var table = document.getElementById('solTable');
    if (!table) return;
    document.getElementById('solGameTitle').textContent = 'Tri-Peaks';
    var hb = document.getElementById('solitaireHint');
    if (hb) hb.style.display = 'none';
    deal();
    table.innerHTML =
      '<div class="sol-shuffle-anim"><div class="sol-shuffle-deck"></div><div class="sol-shuffle-label">Shuffling\u2026</div></div>';
    document.getElementById('solMoves').textContent = '0';
    var et = document.getElementById('solTime');
    if (et) et.textContent = '0:00';
    clearInterval(solTimer);
    solTimer = setInterval(function () {
      solSecs++;
      var m = Math.floor(solSecs / 60),
        s = solSecs % 60;
      var el = document.getElementById('solTime');
      if (el) el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
    setTimeout(function () {
      render();
    }, 700);
  };
  window._tripeaksStop = function () {
    clearInterval(solTimer);
  };
  window._tripeaksUndo = undo;
  window._tripeaksNewGame = function () {
    window._tripeaksStart();
  };
})();

// ── VEGAS SOLITAIRE (Draw-3 Klondike) ────────────────────────────────────
(function () {
  var SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var tableau = [],
    stock = [],
    waste = [],
    foundations = [[], [], [], []];
  var selected = null,
    selectedFrom = null,
    moves = 0,
    solTimer = null,
    solSecs = 0,
    history = [];
  var redeals = 0,
    MAX_REDEALS = 2; // Vegas: 3 passes through deck total
  function isRed(s) {
    return s === '\u2665' || s === '\u2666';
  }
  function shuf(d) {
    for (var i = d.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = d[i];
      d[i] = d[j];
      d[j] = t;
    }
    return d;
  }
  function deal() {
    var d = [];
    SUITS.forEach(function (s) {
      RANKS.forEach(function (r, i) {
        d.push({ suit: s, rank: r, value: i + 1, faceUp: false });
      });
    });
    shuf(d);
    tableau = [[], [], [], [], [], [], []];
    stock = [];
    waste = [];
    foundations = [[], [], [], []];
    var idx = 0;
    for (var c = 0; c < 7; c++) {
      for (var i = 0; i <= c; i++) {
        var card = d[idx++];
        card.faceUp = i === c;
        tableau[c].push(card);
      }
    }
    while (idx < d.length) stock.push(d[idx++]);
    selected = null;
    selectedFrom = null;
    moves = 0;
    solSecs = 0;
    history = [];
    redeals = 0;
    var nb = document.getElementById('solNoMovesBanner');
    if (nb) nb.style.display = 'none';
  }
  function canTab(card, pile) {
    if (!pile.length) return card.value === 13;
    var top = pile[pile.length - 1];
    return top.faceUp && card.value === top.value - 1 && isRed(card.suit) !== isRed(top.suit);
  }
  function canFound(card, fi) {
    var p = foundations[fi];
    if (card.suit !== SUITS[fi]) return false;
    return p.length === 0 ? card.value === 1 : card.value === p[p.length - 1].value + 1;
  }
  function canFoundAny(card) {
    for (var f = 0; f < 4; f++) if (canFound(card, f)) return f;
    return -1;
  }
  function cloneCard(c) {
    return c ? { suit: c.suit, rank: c.rank, value: c.value, faceUp: c.faceUp } : null;
  }
  function save() {
    history.push({
      tab: tableau.map(function (p) {
        return p.map(cloneCard);
      }),
      stk: stock.map(cloneCard),
      wst: waste.map(cloneCard),
      fnd: foundations.map(function (p) {
        return p.map(cloneCard);
      }),
      mv: moves,
      sc: solSecs,
      sel: selected ? cloneCard(selected) : null,
      selF: selectedFrom ? JSON.parse(JSON.stringify(selectedFrom)) : null,
      rd: redeals
    });
    if (history.length > 80) history.shift();
    updUndo();
  }
  function updUndo() {
    var b = document.getElementById('solitaireUndo');
    if (b) {
      b.disabled = !history.length;
      b.style.opacity = history.length ? '1' : '.4';
    }
  }
  function undo() {
    if (!history.length) return;
    var h = history.pop();
    tableau = h.tab;
    stock = h.stk;
    waste = h.wst;
    foundations = h.fnd;
    moves = h.mv;
    solSecs = h.sc;
    selected = h.sel;
    selectedFrom = h.selF;
    redeals = h.rd;
    document.getElementById('solMoves').textContent = moves;
    updUndo();
    render();
  }
  function afterMove() {
    document.getElementById('solMoves').textContent = moves;
    render();
    checkWin();
  }
  function checkWin() {
    if (
      foundations.every(function (f) {
        return f.length === 13;
      })
    ) {
      clearInterval(solTimer);
      history = [];
      updUndo();
      setTimeout(function () {
        _solWinOverlay(moves, 'window._vegasNewGame');
      }, 300);
    }
  }
  function handleClick(type, idx, ci) {
    if (type === 'stock') {
      // Draw 3 from stock to waste
      if (stock.length) {
        save();
        var drawn = Math.min(3, stock.length);
        for (var i = 0; i < drawn; i++) {
          var c = stock.pop();
          c.faceUp = true;
          waste.push(c);
        }
        selected = null;
        selectedFrom = null;
        document.getElementById('solMoves').textContent = moves;
        render();
      } else if (redeals < MAX_REDEALS) {
        save();
        redeals++;
        while (waste.length) {
          var wc = waste.pop();
          wc.faceUp = false;
          stock.push(wc);
        }
        selected = null;
        document.getElementById('solMoves').textContent = moves;
        render();
      }
      return;
    }
    if (type === 'waste') {
      if (!waste.length) return;
      var wtop = waste[waste.length - 1];
      if (selected) {
        // try to place selected onto waste? No — waste is source only
        selected = null;
        selectedFrom = null;
        render();
        return;
      }
      selected = wtop;
      selectedFrom = { type: 'waste', idx: 0 };
      render();
      return;
    }
    if (type === 'foundation') {
      if (selected) {
        if (canFound(selected, idx)) {
          save();
          if (selectedFrom.type === 'waste') waste.pop();
          else if (selectedFrom.type === 'tableau') {
            tableau[selectedFrom.idx].pop();
            if (
              tableau[selectedFrom.idx].length &&
              !tableau[selectedFrom.idx][tableau[selectedFrom.idx].length - 1].faceUp
            )
              tableau[selectedFrom.idx][tableau[selectedFrom.idx].length - 1].faceUp = true;
          }
          foundations[idx].push(selected);
          moves++;
          selected = null;
          selectedFrom = null;
          afterMove();
        } else {
          selected = null;
          selectedFrom = null;
          render();
        }
      } else {
        if (foundations[idx].length) {
          selected = foundations[idx][foundations[idx].length - 1];
          selectedFrom = { type: 'foundation', idx: idx };
          render();
        }
      }
      return;
    }
    if (type === 'tableau') {
      var pile = tableau[idx];
      if (selected) {
        // Try to place
        var seq = selected._seq || [selected];
        // Same card clicked again — keep selected
        if (
          selectedFrom.type === 'tableau' &&
          selectedFrom.idx === idx &&
          selectedFrom.cardIdx === ci
        ) {
          render();
          return;
        }
        if (canTab(seq[0], pile)) {
          save();
          if (selectedFrom.type === 'waste') {
            waste.pop();
          } else if (selectedFrom.type === 'foundation') {
            foundations[selectedFrom.idx].pop();
          } else if (selectedFrom.type === 'tableau') {
            var src = tableau[selectedFrom.idx];
            var seqLen = seq.length;
            tableau[selectedFrom.idx] = src.slice(0, src.length - seqLen);
            if (
              tableau[selectedFrom.idx].length &&
              !tableau[selectedFrom.idx][tableau[selectedFrom.idx].length - 1].faceUp
            )
              tableau[selectedFrom.idx][tableau[selectedFrom.idx].length - 1].faceUp = true;
          }
          seq.forEach(function (card) {
            pile.push(card);
          });
          moves++;
          selected = null;
          selectedFrom = null;
          afterMove();
        } else {
          selected = null;
          selectedFrom = null;
          render();
        }
      } else {
        if (!pile.length || ci === undefined) return;
        var clickedCard = pile[ci];
        if (!clickedCard || !clickedCard.faceUp) return;
        // Build sequence from ci to end
        var seqCards = pile.slice(ci);
        var valid = true;
        for (var j = 1; j < seqCards.length; j++) {
          if (
            seqCards[j].value !== seqCards[j - 1].value - 1 ||
            isRed(seqCards[j].suit) === isRed(seqCards[j - 1].suit)
          ) {
            valid = false;
            break;
          }
        }
        if (!valid && ci !== pile.length - 1) {
          return;
        }
        selected = seqCards[0];
        selected._seq = seqCards;
        selectedFrom = { type: 'tableau', idx: idx, cardIdx: ci };
        render();
      }
      return;
    }
  }
  function handleDblClick(type, idx, ci) {
    var card = null;
    if (type === 'waste' && waste.length) card = waste[waste.length - 1];
    else if (type === 'tableau' && tableau[idx].length) {
      var p = tableau[idx];
      card = p[p.length - 1];
    }
    if (!card) return;
    var fi = canFoundAny(card);
    if (fi < 0) return;
    save();
    if (type === 'waste') waste.pop();
    else tableau[idx].pop();
    if (type === 'tableau' && tableau[idx].length && !tableau[idx][tableau[idx].length - 1].faceUp)
      tableau[idx][tableau[idx].length - 1].faceUp = true;
    foundations[fi].push(card);
    moves++;
    selected = null;
    selectedFrom = null;
    afterMove();
  }
  function makeCard(card) {
    var el = document.createElement('div');
    el.className = 'sol-card ' + (isRed(card.suit) ? 'red' : 'black');
    el.draggable = true;
    el.innerHTML =
      '<div class="sol-card-rank">' +
      card.rank +
      '</div><div class="sol-card-suit">' +
      card.suit +
      '</div><div class="sol-card-center">' +
      card.suit +
      '</div>';
    return el;
  }
  function makeFD() {
    var el = document.createElement('div');
    el.className = 'sol-card face-down';
    return el;
  }
  function makeEmpty() {
    var el = document.createElement('div');
    el.className = 'sol-pile-empty';
    return el;
  }
  function render() {
    var table = document.getElementById('solTable');
    if (!table) return;
    table.innerHTML = '';
    table.className = 'sol-table';
    var topRow = document.createElement('div');
    topRow.className = 'sol-top-row';
    // Stock
    var stockEl = makeEmpty();
    stockEl.style.cursor = 'pointer';
    stockEl.dataset.type = 'stock';
    stockEl.dataset.idx = '0';
    if (stock.length) {
      var sfd = makeFD();
      sfd.dataset.type = 'stock';
      sfd.dataset.idx = '0';
      stockEl.appendChild(sfd);
    } else if (redeals < MAX_REDEALS) {
      stockEl.innerHTML =
        '<div style="font-size:1.6rem;color:rgba(192,132,252,.35);line-height:88px;text-align:center">\u21BA</div>';
      stockEl.dataset.type = 'stock';
      stockEl.dataset.idx = '0';
    } else {
      stockEl.innerHTML =
        '<div style="font-size:.7rem;color:rgba(239,68,68,.5);line-height:88px;text-align:center">No<br>redeals</div>';
    }
    var rdLabel = document.createElement('div');
    rdLabel.style.cssText =
      'text-align:center;font-size:.6rem;color:rgba(192,132,252,.4);margin-top:2px';
    rdLabel.textContent = 'Redeals: ' + (MAX_REDEALS - redeals);
    stockEl.appendChild(rdLabel);
    topRow.appendChild(stockEl);
    // Waste — show top 3 fanned
    var wasteEl = makeEmpty();
    wasteEl.dataset.type = 'waste';
    wasteEl.dataset.idx = '0';
    wasteEl.style.position = 'relative';
    var showCount = Math.min(3, waste.length);
    for (var wi = waste.length - showCount; wi < waste.length; wi++) {
      (function (wii, offset) {
        var wel = makeCard(waste[wii]);
        wel.style.position = 'absolute';
        wel.style.left = offset * 14 + 'px';
        wel.style.top = '0';
        wel.style.zIndex = offset + 1;
        if (wii === waste.length - 1) {
          wel.dataset.type = 'waste';
          wel.dataset.idx = '0';
          wel.dataset.ci = wii;
          if (selected && selectedFrom && selectedFrom.type === 'waste')
            wel.classList.add('selected');
        } else {
          wel.style.pointerEvents = 'none';
        }
        wasteEl.appendChild(wel);
      })(wi, wi - (waste.length - showCount));
    }
    wasteEl.style.width = showCount > 1 ? 28 + 62 + 'px' : '62px';
    topRow.appendChild(wasteEl);
    var sp = document.createElement('div');
    sp.style.flex = '1';
    topRow.appendChild(sp);
    // Foundations
    for (var f = 0; f < 4; f++)
      (function (fi) {
        var fEl = makeEmpty();
        fEl.classList.add('sol-pile-foundation');
        fEl.dataset.type = 'foundation';
        fEl.dataset.idx = fi;
        if (foundations[fi].length) {
          var fc = makeCard(foundations[fi][foundations[fi].length - 1]);
          fc.dataset.type = 'foundation';
          fc.dataset.idx = fi;
          fEl.appendChild(fc);
        } else {
          var sl = document.createElement('div');
          sl.style.cssText =
            'font-size:1.8rem;color:rgba(192,132,252,.22);line-height:88px;text-align:center;width:100%';
          sl.textContent = SUITS[fi];
          fEl.appendChild(sl);
        }
        topRow.appendChild(fEl);
      })(f);
    table.appendChild(topRow);
    // Tableau
    var tabRow = document.createElement('div');
    tabRow.className = 'sol-tableau';
    for (var t = 0; t < 7; t++)
      (function (ti) {
        var pileEl = document.createElement('div');
        pileEl.className = 'sol-tab-pile sol-pile';
        pileEl.dataset.type = 'tableau';
        pileEl.dataset.idx = ti;
        pileEl.dataset.ci = 'empty';
        var vTop = 0;
        tableau[ti].forEach(function (card, ci) {
          var cel = card.faceUp ? makeCard(card) : makeFD();
          cel.dataset.type = 'tableau';
          cel.dataset.idx = ti;
          cel.dataset.ci = ci;
          cel.style.position = 'absolute';
          cel.style.top = vTop + 'px';
          cel.style.zIndex = ci + 1;
          if (
            card.faceUp &&
            selected &&
            selectedFrom &&
            selectedFrom.type === 'tableau' &&
            selectedFrom.idx === ti &&
            ci >= selectedFrom.cardIdx
          )
            cel.classList.add('selected');
          pileEl.appendChild(cel);
          vTop += card.faceUp ? 28 : 14;
        });
        pileEl.style.height = Math.max(88, vTop + 62) + 'px';
        tabRow.appendChild(pileEl);
      })(t);
    table.appendChild(tabRow);
  }
  // ── Drag & Drop ──
  function vegDragStart(e) {
    var el = e.target.closest('[data-type]');
    if (!el) return;
    var type = el.dataset.type,
      idx = parseInt(el.dataset.idx) || 0,
      ci = el.dataset.ci;
    if (type === 'waste') {
      if (!waste.length) {
        e.preventDefault();
        return;
      }
      var wtop = waste[waste.length - 1];
      selected = wtop;
      selected._seq = [wtop];
      selectedFrom = { type: 'waste', idx: 0 };
    } else if (type === 'tableau') {
      if (ci === undefined || ci === 'empty') {
        e.preventDefault();
        return;
      }
      ci = parseInt(ci);
      var pile = tableau[idx];
      if (!pile[ci] || !pile[ci].faceUp) {
        e.preventDefault();
        return;
      }
      var seqCards = pile.slice(ci);
      var valid = true;
      for (var j = 1; j < seqCards.length; j++) {
        if (
          seqCards[j].value !== seqCards[j - 1].value - 1 ||
          isRed(seqCards[j].suit) === isRed(seqCards[j - 1].suit)
        ) {
          valid = false;
          break;
        }
      }
      if (!valid && ci !== pile.length - 1) {
        e.preventDefault();
        return;
      }
      selected = seqCards[0];
      selected._seq = seqCards;
      selectedFrom = { type: 'tableau', idx: idx, cardIdx: ci };
    } else {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'sol');
    setTimeout(function () {
      render();
    }, 0);
  }
  function vegDragOver(e) {
    e.preventDefault();
    if (!selected) return;
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    var el = e.target.closest('[data-type]');
    if (!el) return;
    var type = el.dataset.type,
      idx = parseInt(el.dataset.idx) || 0;
    var seq = selected._seq || [selected];
    var valid =
      (type === 'tableau' && canTab(seq[0], tableau[idx])) ||
      (type === 'foundation' && seq.length === 1 && canFound(seq[0], idx));
    if (valid) {
      el.classList.add('sol-drop-hover');
      e.dataTransfer.dropEffect = 'move';
    } else e.dataTransfer.dropEffect = 'none';
  }
  function vegDragLeave(e) {
    var el = e.target.closest('[data-type]');
    if (el) el.classList.remove('sol-drop-hover');
  }
  function vegDrop(e) {
    e.preventDefault();
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    var el = e.target.closest('[data-type]');
    if (!el || !selected) return;
    var type = el.dataset.type,
      idx = parseInt(el.dataset.idx) || 0;
    var seq = selected._seq || [selected];
    if (type === 'tableau' && canTab(seq[0], tableau[idx])) {
      save();
      if (selectedFrom.type === 'waste') waste.pop();
      else if (selectedFrom.type === 'tableau') {
        var src = tableau[selectedFrom.idx];
        tableau[selectedFrom.idx] = src.slice(0, src.length - seq.length);
        if (
          tableau[selectedFrom.idx].length &&
          !tableau[selectedFrom.idx][tableau[selectedFrom.idx].length - 1].faceUp
        )
          tableau[selectedFrom.idx][tableau[selectedFrom.idx].length - 1].faceUp = true;
      }
      seq.forEach(function (card) {
        tableau[idx].push(card);
      });
      moves++;
      selected = null;
      selectedFrom = null;
      afterMove();
    } else if (type === 'foundation' && seq.length === 1 && canFound(seq[0], idx)) {
      save();
      if (selectedFrom.type === 'waste') waste.pop();
      else if (selectedFrom.type === 'tableau') {
        var src2 = tableau[selectedFrom.idx];
        tableau[selectedFrom.idx] = src2.slice(0, src2.length - 1);
        if (
          tableau[selectedFrom.idx].length &&
          !tableau[selectedFrom.idx][tableau[selectedFrom.idx].length - 1].faceUp
        )
          tableau[selectedFrom.idx][tableau[selectedFrom.idx].length - 1].faceUp = true;
      }
      foundations[idx].push(seq[0]);
      moves++;
      selected = null;
      selectedFrom = null;
      afterMove();
    } else {
      selected = null;
      selectedFrom = null;
      render();
    }
  }
  function vegDragEnd(e) {
    document.querySelectorAll('.sol-drop-hover').forEach(function (x) {
      x.classList.remove('sol-drop-hover');
    });
    selected = null;
    selectedFrom = null;
    render();
  }
  window._vegasCleanup = function () {
    var t = document.getElementById('solTable');
    if (!t) return;
    t.removeEventListener('dragstart', vegDragStart);
    t.removeEventListener('dragover', vegDragOver);
    t.removeEventListener('dragleave', vegDragLeave);
    t.removeEventListener('drop', vegDrop);
    t.removeEventListener('dragend', vegDragEnd);
  };
  window._vegasHC = function (type, idx, ci) {
    handleClick(type, idx, ci);
  };
  window._vegasDC = function (type, idx, ci) {
    handleDblClick(type, idx, ci);
  };
  window._vegasStart = function () {
    var table = document.getElementById('solTable');
    if (!table) return;
    document.getElementById('solGameTitle').textContent = 'Vegas';
    window._vegasCleanup();
    table.addEventListener('dragstart', vegDragStart);
    table.addEventListener('dragover', vegDragOver);
    table.addEventListener('dragleave', vegDragLeave);
    table.addEventListener('drop', vegDrop);
    table.addEventListener('dragend', vegDragEnd);
    var hb = document.getElementById('solitaireHint');
    if (hb) hb.style.display = 'none';
    deal();
    var tbl = document.getElementById('solTable');
    if (tbl)
      tbl.innerHTML =
        '<div class="sol-shuffle-anim"><div class="sol-shuffle-deck"></div><div class="sol-shuffle-label">Shuffling\u2026</div></div>';
    document.getElementById('solMoves').textContent = '0';
    var et = document.getElementById('solTime');
    if (et) et.textContent = '0:00';
    clearInterval(solTimer);
    solTimer = setInterval(function () {
      solSecs++;
      var m = Math.floor(solSecs / 60),
        s = solSecs % 60;
      var el = document.getElementById('solTime');
      if (el) el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
    setTimeout(function () {
      render();
    }, 700);
  };
  window._vegasStop = function () {
    clearInterval(solTimer);
  };
  window._vegasUndo = undo;
  window._vegasNewGame = function () {
    window._vegasStart();
  };
})();

// ── SOLITAIRE VARIANT DISPATCHER ─────────────────────────────────────────
(function () {
  var currentVariant = null;
  var VARIANTS = {
    klondike: {
      start: function () {
        window._klondikeStart && _klondikeStart();
      },
      stop: function () {
        window._klondikeStop && _klondikeStop();
      },
      newGame: function () {
        window._klondikeNewGame && _klondikeNewGame();
      },
      undo: function () {
        window._klondikeUndo && _klondikeUndo();
      }
    },
    spider: {
      start: function () {
        window._spiderSetMode && _spiderSetMode(1);
        window._spiderStart && _spiderStart();
      },
      stop: function () {
        window._spiderStop && _spiderStop();
      },
      newGame: function () {
        window._spiderNewGame && _spiderNewGame();
      },
      undo: function () {
        window._spiderUndo && _spiderUndo();
      }
    },
    spider1: {
      start: function () {
        window._spiderSetMode && _spiderSetMode(1);
        window._spiderStart && _spiderStart();
      },
      stop: function () {
        window._spiderStop && _spiderStop();
      },
      newGame: function () {
        window._spiderNewGame && _spiderNewGame();
      },
      undo: function () {
        window._spiderUndo && _spiderUndo();
      }
    },
    spider2: {
      start: function () {
        window._spiderSetMode && _spiderSetMode(2);
        window._spiderStart && _spiderStart();
      },
      stop: function () {
        window._spiderStop && _spiderStop();
      },
      newGame: function () {
        window._spiderNewGame && _spiderNewGame();
      },
      undo: function () {
        window._spiderUndo && _spiderUndo();
      }
    },
    spider4: {
      start: function () {
        window._spiderSetMode && _spiderSetMode(4);
        window._spiderStart && _spiderStart();
      },
      stop: function () {
        window._spiderStop && _spiderStop();
      },
      newGame: function () {
        window._spiderNewGame && _spiderNewGame();
      },
      undo: function () {
        window._spiderUndo && _spiderUndo();
      }
    },
    scorpion: {
      start: function () {
        window._scorpionStart && _scorpionStart();
      },
      stop: function () {
        window._scorpionStop && _scorpionStop();
      },
      newGame: function () {
        window._scorpionNewGame && _scorpionNewGame();
      },
      undo: function () {
        window._scorpionUndo && _scorpionUndo();
      }
    },
    freecell: {
      start: function () {
        window._freecellStart && _freecellStart();
      },
      stop: function () {
        window._freecellStop && _freecellStop();
      },
      newGame: function () {
        window._freecellNewGame && _freecellNewGame();
      },
      undo: function () {
        window._freecellUndo && _freecellUndo();
      }
    },
    pyramid: {
      start: function () {
        window._pyramidStart && _pyramidStart();
      },
      stop: function () {
        window._pyramidStop && _pyramidStop();
      },
      newGame: function () {
        window._pyramidNewGame && _pyramidNewGame();
      },
      undo: function () {
        window._pyramidUndo && _pyramidUndo();
      }
    },
    tripeaks: {
      start: function () {
        window._tripeaksStart && _tripeaksStart();
      },
      stop: function () {
        window._tripeaksStop && _tripeaksStop();
      },
      newGame: function () {
        window._tripeaksNewGame && _tripeaksNewGame();
      },
      undo: function () {
        window._tripeaksUndo && _tripeaksUndo();
      }
    },
    vegas: {
      start: function () {
        window._vegasStart && _vegasStart();
      },
      stop: function () {
        window._vegasStop && _vegasStop();
      },
      newGame: function () {
        window._vegasNewGame && _vegasNewGame();
      },
      undo: function () {
        window._vegasUndo && _vegasUndo();
      }
    }
  };
  function stopCurrent() {
    if (currentVariant && VARIANTS[currentVariant]) VARIANTS[currentVariant].stop();
  }
  function hideAllPickers() {
    var ids = ['solVariantPicker', 'solSpiderPicker'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }
  window._solShowPicker = function () {
    stopCurrent();
    currentVariant = null;
    hideAllPickers();
    var picker = document.getElementById('solVariantPicker'),
      area = document.getElementById('solGameArea');
    if (picker) picker.style.display = '';
    if (area) area.style.display = 'none';
    var table = document.getElementById('solTable');
    if (table) table.innerHTML = '';
  };
  window._solShowSpiderPicker = function () {
    hideAllPickers();
    var sp = document.getElementById('solSpiderPicker');
    if (sp) sp.style.display = '';
    var area = document.getElementById('solGameArea');
    if (area) area.style.display = 'none';
  };
  window._solStartVariant = function (v) {
    if (!VARIANTS[v]) return;
    stopCurrent();
    [
      window._klondikeCleanup,
      window._spiderCleanup,
      window._freecellCleanup,
      window._pyramidCleanup,
      window._tripeaksCleanup,
      window._scorpionCleanup,
      window._vegasCleanup
    ].forEach(function (fn) {
      if (typeof fn === 'function') fn();
    });
    currentVariant = v;
    hideAllPickers();
    var area = document.getElementById('solGameArea');
    if (area) area.style.display = '';
    VARIANTS[v].start();
  };
  window._solStart = function () {
    if (currentVariant) VARIANTS[currentVariant].start();
    else window._solShowPicker();
  };
  window._solStop = function () {
    stopCurrent();
  };
  // Wire variant picker cards
  var grid = document.getElementById('solVariantPicker');
  if (grid) {
    grid.querySelectorAll('.sol-vc').forEach(function (el) {
      el.addEventListener('click', function () {
        if (el.id === 'solSpiderMenuBtn') {
          window._solShowSpiderPicker();
        } else {
          window._solStartVariant(el.dataset.variant);
        }
      });
    });
  }
  // Spider sub-picker
  var spGrid = document.getElementById('solSpiderPicker');
  if (spGrid) {
    spGrid.querySelectorAll('.sol-spc').forEach(function (el) {
      el.addEventListener('click', function () {
        window._solStartVariant(el.dataset.variant);
      });
    });
    var spBack = document.getElementById('solSpiderPickerBack');
    if (spBack)
      spBack.addEventListener('click', function () {
        window._solShowPicker();
      });
  }
  // Back button in picker → hub
  var pb = document.getElementById('solPickerBack');
  if (pb)
    pb.addEventListener('click', function () {
      var sga = document.getElementById('gamesPlaySolitaire');
      if (sga) sga.style.display = 'none';
      var hub = document.getElementById('gamesHub');
      if (hub) hub.style.display = '';
    });
  // Game area buttons
  var sng = document.getElementById('solitaireNewGame');
  if (sng)
    sng.addEventListener('click', function () {
      if (currentVariant && VARIANTS[currentVariant]) VARIANTS[currentVariant].newGame();
    });
  var snmb = document.getElementById('solNoMovesNewGame');
  if (snmb)
    snmb.addEventListener('click', function () {
      if (currentVariant && VARIANTS[currentVariant]) VARIANTS[currentVariant].newGame();
    });
  var sub = document.getElementById('solitaireUndo');
  if (sub) {
    sub.addEventListener('click', function () {
      if (currentVariant && VARIANTS[currentVariant]) VARIANTS[currentVariant].undo();
    });
    sub.disabled = true;
    sub.style.opacity = '.4';
  }
  var shb = document.getElementById('solitaireHint');
  if (shb)
    shb.addEventListener('click', function () {
      var hintFns = {
        klondike: window._klondikeHint,
        spider: window._spiderHint,
        spider1: window._spiderHint,
        spider2: window._spiderHint,
        spider4: window._spiderHint,
        scorpion: window._scorpionHint
      };
      var fn = hintFns[currentVariant];
      if (typeof fn === 'function') fn();
    });
  // Single capture-phase click dispatcher — fires before any element handlers, can't be double-called
  var _solLastClick = 0;
  document.addEventListener(
    'click',
    function (e) {
      if (!currentVariant) return;
      var now = Date.now();
      if (now - _solLastClick < 50) {
        return;
      }
      _solLastClick = now;
      var area = document.getElementById('solGameArea');
      if (!area || area.style.display === 'none') return;
      var table = document.getElementById('solTable');
      if (!table || !table.contains(e.target)) return;
      var el = e.target.closest('[data-type]');
      if (!el) return;
      var type = el.dataset.type,
        idx = parseInt(el.dataset.idx) || 0,
        ci = el.dataset.ci;
      var cardIdx = ci === undefined || ci === 'empty' ? undefined : parseInt(ci);
      var fn = {
        klondike: window._klondikeHC,
        spider: window._spiderHC,
        spider1: window._spiderHC,
        spider2: window._spiderHC,
        spider4: window._spiderHC,
        scorpion: window._scorpionHC,
        freecell: window._freecellHC,
        pyramid: window._pyramidHC,
        tripeaks: window._tripeaksHC,
        vegas: window._vegasHC
      }[currentVariant];
      if (fn) fn(type, idx, isNaN(cardIdx) ? undefined : cardIdx);
    },
    true
  );
  document.addEventListener(
    'dblclick',
    function (e) {
      if (!currentVariant) return;
      var area = document.getElementById('solGameArea');
      if (!area || area.style.display === 'none') return;
      var table = document.getElementById('solTable');
      if (!table || !table.contains(e.target)) return;
      var el = e.target.closest('[data-type]');
      if (!el) return;
      var type = el.dataset.type,
        idx = parseInt(el.dataset.idx) || 0;
      var fn = {
        klondike: window._klondikeDC,
        freecell: window._freecellDC,
        vegas: window._vegasDC
      }[currentVariant];
      if (fn) fn(type, idx);
    },
    true
  );
})();
