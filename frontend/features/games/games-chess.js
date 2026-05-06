// ── CHESS ─────────────────────────────────────────────────────────────────
(function () {
  // ── Glyphs & constants ────────────────────────────────────────────────
  var G = {
    wK: '♔',
    wQ: '♕',
    wR: '♖',
    wB: '♗',
    wN: '♘',
    wP: '♙',
    bK: '♚',
    bQ: '♛',
    bR: '♜',
    bB: '♝',
    bN: '♞',
    bP: '♟'
  };
  var PV = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
  var FILES = 'abcdefgh';
  var PST = {
    P: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [50, 50, 50, 50, 50, 50, 50, 50],
      [10, 10, 20, 30, 30, 20, 10, 10],
      [5, 5, 10, 25, 25, 10, 5, 5],
      [0, 0, 0, 20, 20, 0, 0, 0],
      [5, -5, -10, 0, 0, -10, -5, 5],
      [5, 10, 10, -20, -20, 10, 10, 5],
      [0, 0, 0, 0, 0, 0, 0, 0]
    ],
    N: [
      [-50, -40, -30, -30, -30, -30, -40, -50],
      [-40, -20, 0, 0, 0, 0, -20, -40],
      [-30, 0, 10, 15, 15, 10, 0, -30],
      [-30, 5, 15, 20, 20, 15, 5, -30],
      [-30, 0, 15, 20, 20, 15, 0, -30],
      [-30, 5, 10, 15, 15, 10, 5, -30],
      [-40, -20, 0, 5, 5, 0, -20, -40],
      [-50, -40, -30, -30, -30, -30, -40, -50]
    ],
    B: [
      [-20, -10, -10, -10, -10, -10, -10, -20],
      [-10, 0, 0, 0, 0, 0, 0, -10],
      [-10, 0, 5, 10, 10, 5, 0, -10],
      [-10, 5, 5, 10, 10, 5, 5, -10],
      [-10, 0, 10, 10, 10, 10, 0, -10],
      [-10, 10, 10, 10, 10, 10, 10, -10],
      [-10, 5, 0, 0, 0, 0, 5, -10],
      [-20, -10, -10, -10, -10, -10, -10, -20]
    ],
    R: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [5, 10, 10, 10, 10, 10, 10, 5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [0, 0, 0, 5, 5, 0, 0, 0]
    ],
    Q: [
      [-20, -10, -10, -5, -5, -10, -10, -20],
      [-10, 0, 0, 0, 0, 0, 0, -10],
      [-10, 0, 5, 5, 5, 5, 0, -10],
      [-5, 0, 5, 5, 5, 5, 0, -5],
      [0, 0, 5, 5, 5, 5, 0, -5],
      [-10, 5, 5, 5, 5, 5, 0, -10],
      [-10, 0, 5, 0, 0, 0, 0, -10],
      [-20, -10, -10, -5, -5, -10, -10, -20]
    ],
    K: [
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-20, -30, -30, -40, -40, -30, -30, -20],
      [-10, -20, -20, -20, -20, -20, -20, -10],
      [20, 20, 0, 0, 0, 0, 20, 20],
      [20, 30, 10, 0, 0, 10, 30, 20]
    ]
  };
  var DIFFS = [
    {
      id: 1,
      name: 'Beginner',
      sub: '~400',
      elo: 400,
      depth: 0,
      color: '#34d399',
      border: 'rgba(52,211,153,.3)'
    },
    {
      id: 2,
      name: 'Easy',
      sub: '~800',
      elo: 800,
      depth: 1,
      color: '#60a5fa',
      border: 'rgba(96,165,250,.3)'
    },
    {
      id: 3,
      name: 'Medium',
      sub: '~1200',
      elo: 1200,
      depth: 2,
      color: '#a78bfa',
      border: 'rgba(167,139,250,.3)'
    },
    {
      id: 4,
      name: 'Hard',
      sub: '~1600',
      elo: 1600,
      depth: 3,
      color: '#f472b6',
      border: 'rgba(244,114,182,.3)'
    },
    {
      id: 5,
      name: 'Expert',
      sub: '~2000',
      elo: 2000,
      depth: 4,
      color: '#fb923c',
      border: 'rgba(251,146,60,.3)'
    }
  ];

  // ── Game state ────────────────────────────────────────────────────────
  var board, turn, sel, validMvs, ep, castling, gameOver, aiThinking;
  var playerColor, gameMode, botDepth, botElo;
  var capW, capB, lastFr, lastTo, moveHistory, halfMove, fullMove;
  var premoveSel, premove; // premove: {fr,fc,tr,tc,sp} queued while opponent thinks
  var onlineWs, onlineRoom, onlineColor, onlineConnected;
  var chessStats; // {rating,wins,draws,losses,botRecords:{1:..,2:..,3:..,4:..,5:..}}

  // ── Stats persistence ─────────────────────────────────────────────────
  function loadStats() {
    try {
      var s = JSON.parse(localStorage.getItem('ss_chess_stats') || '{}');
      chessStats = {
        rating: s.rating || 1200,
        wins: s.wins || 0,
        draws: s.draws || 0,
        losses: s.losses || 0,
        botRecords: s.botRecords || {
          1: { w: 0, d: 0, l: 0 },
          2: { w: 0, d: 0, l: 0 },
          3: { w: 0, d: 0, l: 0 },
          4: { w: 0, d: 0, l: 0 },
          5: { w: 0, d: 0, l: 0 }
        }
      };
    } catch (e) {
      chessStats = {
        rating: 1200,
        wins: 0,
        draws: 0,
        losses: 0,
        botRecords: {
          1: { w: 0, d: 0, l: 0 },
          2: { w: 0, d: 0, l: 0 },
          3: { w: 0, d: 0, l: 0 },
          4: { w: 0, d: 0, l: 0 },
          5: { w: 0, d: 0, l: 0 }
        }
      };
    }
  }
  function saveStats() {
    try {
      localStorage.setItem('ss_chess_stats', JSON.stringify(chessStats));
    } catch (e) {}
  }
  function calcElo(myRating, oppRating, result, k) {
    var exp = 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
    return Math.round(myRating + k * (result - exp));
  }
  function recordResult(result, oppElo, isBot, diffId) {
    // result: 1=win,0.5=draw,0=loss
    var k = isBot ? 24 : 20;
    var newRating = calcElo(chessStats.rating, oppElo, result, k);
    chessStats.rating = Math.max(100, newRating);
    if (result === 1) {
      chessStats.wins++;
      if (isBot && diffId) chessStats.botRecords[diffId].w++;
    } else if (result === 0.5) {
      chessStats.draws++;
      if (isBot && diffId) chessStats.botRecords[diffId].d++;
    } else {
      chessStats.losses++;
      if (isBot && diffId) chessStats.botRecords[diffId].l++;
    }
    saveStats();
    renderRatings();
  }

  // ── Board logic ───────────────────────────────────────────────────────
  function np(color, type) {
    return { color: color, type: type };
  }
  function cloneBoard(b) {
    return b.map(function (r) {
      return r.map(function (c) {
        return c ? { color: c.color, type: c.type } : null;
      });
    });
  }
  function cloneCs(cs) {
    return { wK: cs.wK, wQ: cs.wQ, bK: cs.bK, bQ: cs.bQ };
  }

  function initBoard() {
    board = [];
    for (var r = 0; r < 8; r++) {
      board.push([]);
      for (var c = 0; c < 8; c++) board[r].push(null);
    }
    var bk = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    for (var c2 = 0; c2 < 8; c2++) {
      board[0][c2] = np('b', bk[c2]);
      board[1][c2] = np('b', 'P');
      board[6][c2] = np('w', 'P');
      board[7][c2] = np('w', bk[c2]);
    }
    turn = 'w';
    sel = null;
    validMvs = [];
    ep = null;
    castling = { wK: true, wQ: true, bK: true, bQ: true };
    gameOver = false;
    aiThinking = false;
    capW = [];
    capB = [];
    lastFr = null;
    lastTo = null;
    moveHistory = [];
    halfMove = 0;
    fullMove = 1;
    premoveSel = null;
    premove = null;
  }

  function pMoves(r, c, brd, ep2) {
    var p = brd[r][c];
    if (!p) return [];
    var ms = [],
      col = p.color,
      opp = col === 'w' ? 'b' : 'w';
    function add(tr, tc, sp) {
      if (tr < 0 || tr > 7 || tc < 0 || tc > 7) return false;
      var t = brd[tr][tc];
      if (t && t.color === col) return false;
      ms.push({ r: tr, c: tc, sp: sp || null });
      return !t;
    }
    function slide(dr, dc) {
      var nr = r + dr,
        nc = c + dc;
      while (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
        var t = brd[nr][nc];
        if (t) {
          if (t.color !== col) ms.push({ r: nr, c: nc, sp: null });
          break;
        }
        ms.push({ r: nr, c: nc, sp: null });
        nr += dr;
        nc += dc;
      }
    }
    if (p.type === 'P') {
      var d = col === 'w' ? -1 : 1,
        sr = col === 'w' ? 6 : 1;
      if (r + d >= 0 && r + d <= 7 && !brd[r + d][c]) {
        ms.push({ r: r + d, c: c, sp: r + d === 0 || r + d === 7 ? 'promo' : null });
        if (r === sr && !brd[r + 2 * d][c]) ms.push({ r: r + 2 * d, c: c, sp: 'double' });
      }
      [-1, 1].forEach(function (dc2) {
        var nc2 = c + dc2;
        if (nc2 < 0 || nc2 > 7) return;
        if (r + d >= 0 && r + d <= 7 && brd[r + d][nc2] && brd[r + d][nc2].color === opp)
          ms.push({ r: r + d, c: nc2, sp: r + d === 0 || r + d === 7 ? 'promo' : null });
        if (ep2 && r + d === ep2.r && nc2 === ep2.c) ms.push({ r: r + d, c: nc2, sp: 'ep' });
      });
    } else if (p.type === 'N') {
      [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1]
      ].forEach(function (m) {
        add(r + m[0], c + m[1]);
      });
    } else if (p.type === 'B') {
      [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1]
      ].forEach(function (d) {
        slide(d[0], d[1]);
      });
    } else if (p.type === 'R') {
      [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1]
      ].forEach(function (d) {
        slide(d[0], d[1]);
      });
    } else if (p.type === 'Q') {
      [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1]
      ].forEach(function (d) {
        slide(d[0], d[1]);
      });
    } else if (p.type === 'K') {
      [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1]
      ].forEach(function (d) {
        add(r + d[0], c + d[1]);
      });
      var kr = col === 'w' ? 7 : 0;
      if (r === kr && c === 4) {
        if (
          castling[col + 'K'] &&
          !brd[kr][5] &&
          !brd[kr][6] &&
          brd[kr][7] &&
          brd[kr][7].type === 'R'
        )
          ms.push({ r: kr, c: 6, sp: 'ck' });
        if (
          castling[col + 'Q'] &&
          !brd[kr][3] &&
          !brd[kr][2] &&
          !brd[kr][1] &&
          brd[kr][0] &&
          brd[kr][0].type === 'R'
        )
          ms.push({ r: kr, c: 2, sp: 'cq' });
      }
    }
    return ms;
  }

  function applyMv(brd, fr, fc, tr, tc, sp, ep2, cs) {
    var nb = cloneBoard(brd),
      nc = cloneCs(cs),
      nep = null;
    var p = nb[fr][fc];
    nb[tr][tc] = p;
    nb[fr][fc] = null;
    if (sp === 'promo') nb[tr][tc] = { color: p.color, type: 'Q' };
    if (sp === 'ep') {
      var cr = p.color === 'w' ? tr + 1 : tr - 1;
      nb[cr][tc] = null;
    }
    if (sp === 'double') nep = { r: (fr + tr) / 2, c: fc };
    if (sp === 'ck') {
      nb[fr][5] = nb[fr][7];
      nb[fr][7] = null;
    }
    if (sp === 'cq') {
      nb[fr][3] = nb[fr][0];
      nb[fr][0] = null;
    }
    if (p.type === 'K') {
      if (p.color === 'w') {
        nc.wK = false;
        nc.wQ = false;
      } else {
        nc.bK = false;
        nc.bQ = false;
      }
    }
    if (p.type === 'R') {
      if (fr === 7 && fc === 7) nc.wK = false;
      if (fr === 7 && fc === 0) nc.wQ = false;
      if (fr === 0 && fc === 7) nc.bK = false;
      if (fr === 0 && fc === 0) nc.bQ = false;
    }
    return { b: nb, ep: nep, cs: nc };
  }

  function inCheck(brd, color, ep2) {
    var kr = -1,
      kc = -1;
    for (var r = 0; r < 8; r++)
      for (var c = 0; c < 8; c++)
        if (brd[r][c] && brd[r][c].color === color && brd[r][c].type === 'K') {
          kr = r;
          kc = c;
        }
    if (kr < 0) return true;
    var opp = color === 'w' ? 'b' : 'w';
    for (var r2 = 0; r2 < 8; r2++)
      for (var c2 = 0; c2 < 8; c2++) {
        if (!brd[r2][c2] || brd[r2][c2].color !== opp) continue;
        var ms = pMoves(r2, c2, brd, ep2);
        for (var i = 0; i < ms.length; i++) if (ms[i].r === kr && ms[i].c === kc) return true;
      }
    return false;
  }

  function legalMvs(r, c, brd, ep2, cs) {
    var col = brd[r][c].color;
    return pMoves(r, c, brd, ep2).filter(function (mv) {
      if (mv.sp === 'ck' || mv.sp === 'cq') {
        if (inCheck(brd, col, ep2)) return false;
        var mid = mv.sp === 'ck' ? 5 : 3;
        var res = applyMv(brd, r, c, r, mid, null, ep2, cs);
        if (inCheck(res.b, col, res.ep)) return false;
      }
      var res = applyMv(brd, r, c, mv.r, mv.c, mv.sp, ep2, cs);
      return !inCheck(res.b, col, res.ep);
    });
  }

  function allLegal(color, brd, ep2, cs) {
    var ms = [];
    for (var r = 0; r < 8; r++)
      for (var c = 0; c < 8; c++) {
        if (!brd[r][c] || brd[r][c].color !== color) continue;
        var pm = legalMvs(r, c, brd, ep2, cs);
        pm.forEach(function (mv) {
          ms.push({ fr: r, fc: c, tr: mv.r, tc: mv.c, sp: mv.sp });
        });
      }
    return ms;
  }

  // ── Algebraic notation ────────────────────────────────────────────────
  function toAlg(fr, fc, tr, tc, sp, brd) {
    var p = brd[fr][fc];
    if (!p) return '';
    if (sp === 'ck') return 'O-O';
    if (sp === 'cq') return 'O-O-O';
    var from = FILES[fc] + (8 - fr);
    var to = FILES[tc] + (8 - tr);
    var cap = brd[tr][tc] || sp === 'ep' ? 'x' : '';
    var suffix = sp === 'promo' ? '=Q' : '';
    if (p.type === 'P') return (cap ? FILES[fc] + 'x' : '') + to + suffix;
    return p.type + cap + to + suffix;
  }

  // ── Evaluation & AI ───────────────────────────────────────────────────
  function evalBoard(brd) {
    var s = 0;
    for (var r = 0; r < 8; r++)
      for (var c = 0; c < 8; c++) {
        var p = brd[r][c];
        if (!p) continue;
        var pr = p.color === 'w' ? r : 7 - r;
        var v = PV[p.type] + (PST[p.type] ? PST[p.type][pr][c] : 0);
        s += p.color === 'w' ? v : -v;
      }
    return s;
  }

  function minimax(brd, depth, alpha, beta, isMax, ep2, cs) {
    if (depth === 0) return evalBoard(brd);
    var color = isMax ? 'w' : 'b';
    var ms = allLegal(color, brd, ep2, cs);
    if (!ms.length) return inCheck(brd, color, ep2) ? (isMax ? -90000 : 90000) : 0;
    if (isMax) {
      var best = -Infinity;
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        var res = applyMv(brd, m.fr, m.fc, m.tr, m.tc, m.sp, ep2, cs);
        var s = minimax(res.b, depth - 1, alpha, beta, false, res.ep, res.cs);
        if (s > best) best = s;
        if (s > alpha) alpha = s;
        if (beta <= alpha) break;
      }
      return best;
    } else {
      var best = Infinity;
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        var res = applyMv(brd, m.fr, m.fc, m.tr, m.tc, m.sp, ep2, cs);
        var s = minimax(res.b, depth - 1, alpha, beta, true, res.ep, res.cs);
        if (s < best) best = s;
        if (s < beta) beta = s;
        if (beta <= alpha) break;
      }
      return best;
    }
  }

  function bestAI(brd, ep2, cs, depth, color) {
    var ms = allLegal(color, brd, ep2, cs);
    if (!ms.length) return null;
    if (depth === 0) {
      return ms[Math.floor(Math.random() * ms.length)];
    } // beginner: random
    ms.sort(function (a, b) {
      return (brd[b.tr][b.tc] ? 1 : 0) - (brd[a.tr][a.tc] ? 1 : 0);
    });
    var isMax = color === 'w';
    var bestScore = isMax ? -Infinity : Infinity,
      bestMv = ms[0];
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i],
        res = applyMv(brd, m.fr, m.fc, m.tr, m.tc, m.sp, ep2, cs);
      var s = minimax(res.b, depth - 1, -Infinity, Infinity, !isMax, res.ep, res.cs);
      if (isMax ? s > bestScore : s < bestScore) {
        bestScore = s;
        bestMv = m;
      }
    }
    return bestMv;
  }

  // ── Piece images (cburnett set — same quality as chess.com) ──────────
  var pImgs = {};
  var pImgsReady = false;
  var pImgKeys = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
  function loadPieceImgs() {
    var done = 0;
    pImgKeys.forEach(function (k) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      // Lichess open CDN — cburnett piece set (GPL, beautiful quality)
      img.src = 'https://lichess1.org/assets/piece/cburnett/' + k + '.svg';
      img.onload = function () {
        pImgs[k] = img;
        done++;
        if (done === 12) {
          pImgsReady = true;
          render();
        }
      };
      img.onerror = function () {
        done++;
        if (done === 12) {
          pImgsReady = true;
          render();
        }
      };
    });
  }

  // ── Canvas render ─────────────────────────────────────────────────────
  function render() {
    var canvas = document.getElementById('chessBoard');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var SIZE = canvas.width; // 480 — internal resolution
    var SQ = SIZE / 8; // 60px per square
    var flip = playerColor === 'b';
    // Find king in check
    var checkSq = null;
    if (!gameOver) {
      for (var r = 0; r < 8; r++)
        for (var c = 0; c < 8; c++)
          if (
            board[r][c] &&
            board[r][c].color === turn &&
            board[r][c].type === 'K' &&
            inCheck(board, turn, ep)
          ) {
            checkSq = { r: r, c: c };
          }
    }
    // Precompute premove legal hints (outside loop for performance)
    var pmHints = [];
    if (premoveSel && !premove && board[premoveSel.r] && board[premoveSel.r][premoveSel.c]) {
      pmHints = legalMvs(premoveSel.r, premoveSel.c, board, ep, castling);
    }
    ctx.clearRect(0, 0, SIZE, SIZE);
    for (var ri = 0; ri < 8; ri++) {
      for (var ci = 0; ci < 8; ci++) {
        var row = flip ? 7 - ri : ri,
          col = flip ? 7 - ci : ci;
        var x = ci * SQ,
          y = ri * SQ;
        var light = (row + col) % 2 === 0;
        // Base square — chess.com green theme
        ctx.fillStyle = light ? '#EEEED2' : '#769656';
        ctx.fillRect(x, y, SQ, SQ);
        // Selected highlight
        var isSel = sel && sel.r === row && sel.c === col;
        var isMoved =
          (lastFr && lastFr.r === row && lastFr.c === col) ||
          (lastTo && lastTo.r === row && lastTo.c === col);
        if (isSel) {
          ctx.fillStyle = 'rgba(246,246,105,0.78)';
          ctx.fillRect(x, y, SQ, SQ);
        } else if (isMoved) {
          ctx.fillStyle = light ? 'rgba(205,210,106,0.7)' : 'rgba(170,162,58,0.72)';
          ctx.fillRect(x, y, SQ, SQ);
        }
        // Check — radial red glow
        if (checkSq && checkSq.r === row && checkSq.c === col) {
          var cg = ctx.createRadialGradient(
            x + SQ / 2,
            y + SQ / 2,
            SQ * 0.1,
            x + SQ / 2,
            y + SQ / 2,
            SQ * 0.62
          );
          cg.addColorStop(0, 'rgba(255,0,0,.93)');
          cg.addColorStop(0.55, 'rgba(231,0,0,.6)');
          cg.addColorStop(1, 'transparent');
          ctx.fillStyle = cg;
          ctx.fillRect(x, y, SQ, SQ);
        }
        // Premove highlights (blue)
        var isPmSel = premoveSel && premoveSel.r === row && premoveSel.c === col;
        var isPmDst =
          premove &&
          ((premove.fr === row && premove.fc === col) ||
            (premove.tr === row && premove.tc === col));
        if (isPmSel || isPmDst) {
          ctx.fillStyle = 'rgba(80,110,255,0.65)';
          ctx.fillRect(x, y, SQ, SQ);
        }
        // Valid-move indicators (current turn) + premove hints (blue dots when premove source selected)
        var isValid = validMvs.some(function (m) {
          return m.r === row && m.c === col;
        });
        var isPmHint = pmHints.some(function (m) {
          return m.r === row && m.c === col;
        });
        if (isValid || isPmHint) {
          var alpha = isValid ? 0.38 : 0.5,
            dotAlpha = isValid ? 0.22 : 0.45,
            dotColor = isValid ? '#000' : 'rgba(80,110,255,1)';
          if (board[row][col]) {
            // Capture ring
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = isValid ? '#000' : 'rgba(80,110,255,1)';
            ctx.lineWidth = SQ * 0.115;
            ctx.beginPath();
            ctx.arc(x + SQ / 2, y + SQ / 2, SQ * 0.465, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          } else {
            // Dot
            ctx.save();
            ctx.globalAlpha = dotAlpha;
            ctx.fillStyle = dotColor;
            ctx.beginPath();
            ctx.arc(x + SQ / 2, y + SQ / 2, SQ * 0.16, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
        // Piece
        var piece = board[row][col];
        if (piece) drawPiece(ctx, piece, x, y, SQ);
        // Board coordinates (chess.com style — inside squares)
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.font = 'bold ' + Math.round(SQ * 0.185) + 'px "Nunito",sans-serif';
        if (ci === 0) {
          ctx.fillStyle = light ? '#769656' : '#EEEED2';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(String(8 - row), x + SQ * 0.05, y + SQ * 0.04);
        }
        if (ri === 7) {
          ctx.fillStyle = light ? '#769656' : '#EEEED2';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText(FILES[col], x + SQ * 0.95, y + SQ * 0.97);
        }
      }
    }
    renderCaps();
  }

  function drawPiece(ctx, piece, x, y, SQ) {
    var key = piece.color + piece.type;
    if (pImgs[key]) {
      // SVG piece from Lichess CDN — beautiful quality
      ctx.drawImage(pImgs[key], x + SQ * 0.03, y + SQ * 0.03, SQ * 0.94, SQ * 0.94);
      return;
    }
    // Fallback: Unicode glyph with canvas shadows (used until images load)
    var glyph = G[key];
    var fs = Math.round(SQ * 0.72);
    ctx.font = fs + 'px "Segoe UI Symbol","Apple Color Emoji","Noto Emoji",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (piece.color === 'w') {
      ctx.shadowColor = 'rgba(0,0,0,.98)';
      ctx.shadowBlur = SQ * 0.1;
      ctx.shadowOffsetY = SQ * 0.035;
      ctx.fillStyle = '#fff';
      ctx.fillText(glyph, x + SQ / 2, y + SQ / 2 + SQ * 0.03);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.lineWidth = SQ * 0.038;
      ctx.strokeText(glyph, x + SQ / 2, y + SQ / 2 + SQ * 0.03);
    } else {
      ctx.shadowColor = 'rgba(0,0,0,.55)';
      ctx.shadowBlur = SQ * 0.08;
      ctx.shadowOffsetY = SQ * 0.025;
      ctx.fillStyle = '#1a0a2e';
      ctx.fillText(glyph, x + SQ / 2, y + SQ / 2 + SQ * 0.03);
    }
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  function renderCaps() {
    function show(elId, caps, color) {
      var el = document.getElementById(elId);
      if (!el) return;
      var sorted = caps.slice().sort(function (a, b) {
        return PV[b] - PV[a];
      });
      el.innerHTML = sorted
        .map(function (t) {
          return '<span>' + G[color + t] + '</span>';
        })
        .join('');
    }
    // capW = pieces white captured (black pieces), show above board (opponent side)
    // capB = pieces black captured (white pieces), show below board (player side area)
    if (playerColor === 'w') {
      show('chessCapsTop', capW, 'b');
      show('chessCapsBottom', capB, 'w');
    } else {
      show('chessCapsTop', capB, 'w');
      show('chessCapsBottom', capW, 'b');
    }
  }

  function renderRatings() {
    var el = document.getElementById('chessRatingBig');
    if (el) el.textContent = chessStats.rating;
    var ew = document.getElementById('chessWins');
    if (ew) ew.textContent = chessStats.wins;
    var ed = document.getElementById('chessDraws');
    if (ed) ed.textContent = chessStats.draws;
    var el2 = document.getElementById('chessLosses');
    if (el2) el2.textContent = chessStats.losses;
    var ebr = document.getElementById('chessBotRecords');
    if (ebr) {
      ebr.innerHTML = DIFFS.map(function (d) {
        var rec = chessStats.botRecords[d.id] || { w: 0, d: 0, l: 0 };
        return (
          '<div class="chess-bot-record"><span class="chess-bot-record-name" style="color:' +
          d.color +
          '">' +
          d.name +
          '</span><span class="chess-bot-record-stats">' +
          rec.w +
          'W / ' +
          rec.d +
          'D / ' +
          rec.l +
          'L</span></div>'
        );
      }).join('');
    }
    var eb = document.getElementById('chessEloBottom');
    if (eb) eb.textContent = 'Rating: ' + chessStats.rating;
  }

  function renderMoves() {
    var el = document.getElementById('chessMovesList');
    if (!el) return;
    el.innerHTML = '';
    for (var i = 0; i < moveHistory.length; i += 2) {
      var num = document.createElement('div');
      num.className = 'chess-mv-num';
      num.textContent = i / 2 + 1 + '.';
      el.appendChild(num);
      var mw = document.createElement('div');
      mw.className = 'chess-mv-w';
      mw.textContent = moveHistory[i] || '';
      el.appendChild(mw);
      var mb = document.createElement('div');
      mb.className = 'chess-mv-b';
      mb.textContent = moveHistory[i + 1] || '';
      el.appendChild(mb);
    }
    el.scrollTop = el.scrollHeight;
  }

  function setStatus(txt, color) {
    var el = document.getElementById('chessGameStatus');
    if (el) {
      el.textContent = txt;
      if (color) el.style.color = color;
      else el.style.color = '';
    }
  }

  function showOverlay(title, sub, showNewGame) {
    var ov = document.getElementById('chessBoardOverlay');
    var ot = document.getElementById('chessOverlayTitle');
    var os = document.getElementById('chessOverlaySub');
    var ng = document.getElementById('chessOverlayNewGame');
    if (ov) ov.style.display = 'flex';
    if (ot) ot.textContent = title;
    if (os) os.textContent = sub;
    if (ng) ng.style.display = showNewGame === false ? 'none' : '';
  }
  function hideOverlay() {
    var ov = document.getElementById('chessBoardOverlay');
    if (ov) ov.style.display = 'none';
  }

  function checkGameEnd() {
    var ms = allLegal(turn, board, ep, castling);
    if (!ms.length) {
      gameOver = true;
      var resign = document.getElementById('chessResignBtn');
      if (resign) resign.style.display = 'none';
      if (inCheck(board, turn, ep)) {
        var winner = turn !== playerColor;
        var title = winner ? 'You Win! 🎉' : 'You Lost';
        var sub = (turn === 'w' ? 'Black' : 'White') + ' wins by checkmate';
        showOverlay(title, sub, false);
        setStatus(title, winner ? '#34d399' : '#ef4444');
        recordResult(
          winner ? 1 : 0,
          botElo || chessStats.rating,
          gameMode === 'bot',
          botDepth
            ? DIFFS.find(function (d) {
                return d.depth === botDepth - 1;
              }) || null
            : null
        );
        if (gameMode === 'bot') {
          var diffObj = DIFFS.find(function (d) {
            return d.depth === (botDepth || 1) - 1;
          });
          recordResult(
            winner ? 1 : 0,
            diffObj ? diffObj.elo : 1200,
            true,
            diffObj ? diffObj.id : 1
          );
        }
      } else {
        showOverlay('Stalemate', "It's a draw!");
        setStatus('Draw', 'rgba(255,255,255,.5)');
        if (gameMode === 'bot') {
          var diffObj = DIFFS.find(function (d) {
            return d.depth === (botDepth || 1) - 1;
          });
          recordResult(0.5, diffObj ? diffObj.elo : 1200, true, diffObj ? diffObj.id : 1);
        }
      }
      return true;
    }
    if (inCheck(board, turn, ep)) {
      setStatus(turn === playerColor ? '⚠️ Check! Your move' : 'Check!', '#fb923c');
    } else {
      setStatus(turn === playerColor ? 'Your turn' : "Opponent's turn", '');
    }
    return false;
  }

  // ── Move execution ────────────────────────────────────────────────────
  function execMove(fr, fc, tr, tc, sp, byPlayer) {
    var alg = toAlg(fr, fc, tr, tc, sp, board);
    var cap = board[tr][tc];
    if (sp === 'ep') {
      var cr = board[fr][fc].color === 'w' ? tr + 1 : tr - 1;
      cap = board[cr][tc];
    }
    if (cap) {
      if (board[fr][fc].color === 'w') capW.push(cap.type);
      else capB.push(cap.type);
    }
    var res = applyMv(board, fr, fc, tr, tc, sp, ep, castling);
    board = res.b;
    ep = res.ep;
    castling = res.cs;
    lastFr = { r: fr, c: fc };
    lastTo = { r: tr, c: tc };
    sel = null;
    validMvs = [];
    moveHistory.push(alg);
    turn = turn === 'w' ? 'b' : 'w';
    render();
    renderMoves();
    // Online: broadcast
    if (gameMode === 'online' && byPlayer && onlineWs && onlineConnected) {
      wsBroadcast({ type: 'move', fr: fr, fc: fc, tr: tr, tc: tc, sp: sp });
    }
    if (!checkGameEnd() && gameMode === 'bot' && turn !== playerColor && !gameOver) {
      aiThinking = true;
      setStatus('AI thinking…', 'rgba(192,132,252,.8)');
      setTimeout(
        function () {
          var depth = botDepth || 1;
          var aiColor = playerColor === 'w' ? 'b' : 'w';
          var mv = bestAI(board, ep, castling, depth, aiColor);
          aiThinking = false;
          if (mv) {
            execMove(mv.fr, mv.fc, mv.tr, mv.tc, mv.sp, false);
            if (!gameOver) tryPremove();
          } else {
            gameOver = true;
            showOverlay('You Win! 🎉', 'No moves for opponent', false);
          }
        },
        120 + (botDepth || 1) * 60
      );
    }
  }

  // ── Click handler ─────────────────────────────────────────────────────
  function handleSqClick(row, col) {
    if (gameOver) return;
    var myColor = gameMode === 'online' ? onlineColor : playerColor;
    var isMyTurn = gameMode === 'online' ? turn === onlineColor : turn === playerColor;
    // Not my turn — handle premove queue
    if (!isMyTurn) {
      if (gameMode === 'bot' || gameMode === 'online') {
        var piece2 = board[row][col];
        // Clicking own piece: set premove source
        if (piece2 && piece2.color === myColor) {
          premoveSel = { r: row, c: col };
          premove = null;
          render();
          return;
        }
        // Clicking destination after selecting a premove source
        if (premoveSel) {
          // Store premove (validation happens when turn arrives)
          premove = { fr: premoveSel.r, fc: premoveSel.c, tr: row, tc: col };
          render();
          return;
        }
      }
      return;
    }
    if (aiThinking) return;
    var piece = board[row][col];
    if (sel && validMvs.length) {
      var mv = null;
      for (var i = 0; i < validMvs.length; i++)
        if (validMvs[i].r === row && validMvs[i].c === col) {
          mv = validMvs[i];
          break;
        }
      if (mv) {
        execMove(sel.r, sel.c, row, col, mv.sp, true);
        return;
      }
    }
    if (piece && piece.color === turn) {
      sel = { r: row, c: col };
      validMvs = legalMvs(row, col, board, ep, castling);
      render();
      return;
    }
    sel = null;
    validMvs = [];
    render();
  }

  // ── Try queued premove ────────────────────────────────────────────────
  function tryPremove() {
    if (!premove || gameOver) return;
    var pm = premove;
    premoveSel = null;
    premove = null;
    var myColor = gameMode === 'online' ? onlineColor : playerColor;
    // Premove source piece must still belong to player
    var p = board[pm.fr] && board[pm.fr][pm.fc];
    if (!p || p.color !== myColor) {
      render();
      return;
    }
    // Check if the move is legal in the new position
    var legal = legalMvs(pm.fr, pm.fc, board, ep, castling);
    var mv = null;
    for (var i = 0; i < legal.length; i++)
      if (legal[i].r === pm.tr && legal[i].c === pm.tc) {
        mv = legal[i];
        break;
      }
    if (mv) {
      execMove(pm.fr, pm.fc, pm.tr, pm.tc, mv.sp, true);
    } else {
      render();
    } // premove was illegal — silently discard
  }

  // ── UI tabs ───────────────────────────────────────────────────────────
  function showTab(name) {
    ['Play', 'Moves', 'Ratings'].forEach(function (t) {
      var tab = document.getElementById('chessTab' + t);
      var body = document.getElementById('chessBody' + t);
      var active = t.toLowerCase() === name.toLowerCase();
      if (tab) {
        if (active) tab.classList.add('chess-ptab-active');
        else tab.classList.remove('chess-ptab-active');
      }
      if (body) body.style.display = active ? '' : 'none';
    });
    if (name === 'Ratings') renderRatings();
    if (name === 'Moves') renderMoves();
  }

  function showPlaySubPanel(name) {
    // name: null=show mode btns, 'bot', 'online', 'waiting'
    var modeEl = document.querySelector('.chess-mode-btns');
    var botEl = document.getElementById('chessBotPanel');
    var onlEl = document.getElementById('chessOnlinePanel');
    var waitEl = document.getElementById('chessWaitingPanel');
    if (modeEl) modeEl.style.display = !name ? 'flex' : 'none';
    if (botEl) botEl.style.display = name === 'bot' ? '' : 'none';
    if (onlEl) onlEl.style.display = name === 'online' ? '' : 'none';
    if (waitEl) waitEl.style.display = name === 'waiting' ? '' : 'none';
  }

  function buildDiffGrid() {
    var grid = document.getElementById('chessDiffGrid');
    if (!grid || grid._built) return;
    grid._built = true;
    DIFFS.forEach(function (d) {
      var btn = document.createElement('button');
      btn.className = 'chess-diff-btn';
      btn.style.color = d.color;
      btn.style.borderColor = d.border;
      btn.innerHTML =
        '<span style="font-size:1.1rem">' +
        '⭐'.repeat(Math.min(d.id, 3)) +
        '</span><div style="flex:1"><div>' +
        d.name +
        '</div><div style="font-size:.65rem;opacity:.6;font-weight:700">' +
        d.sub +
        ' Elo</div></div>';
      btn.addEventListener('click', function () {
        startBotGame(d);
      });
      grid.appendChild(btn);
    });
  }

  // ── Game start helpers ────────────────────────────────────────────────
  function setPlayerBars(youName, youElo, oppName, oppElo) {
    var nb = document.getElementById('chessNameBottom');
    if (nb) nb.textContent = youName;
    var eb = document.getElementById('chessEloBottom');
    if (eb) eb.textContent = 'Rating: ' + youElo;
    var nt = document.getElementById('chessNameTop');
    if (nt) nt.textContent = oppName;
    var et = document.getElementById('chessEloTop');
    if (et) et.textContent = 'Rating: ' + oppElo;
    var ab = document.getElementById('chessAvBottom');
    if (ab) ab.textContent = playerColor === 'w' ? '♔' : '♚';
    var at = document.getElementById('chessAvTop');
    if (at) at.textContent = playerColor === 'w' ? '♚' : '♔';
  }

  function startBotGame(diff) {
    initBoard();
    playerColor = 'w';
    gameMode = 'bot';
    botDepth = diff.depth + 1;
    botElo = diff.elo;
    hideOverlay();
    showPlaySubPanel(null);
    showTab('Moves');
    var resign = document.getElementById('chessResignBtn');
    if (resign) resign.style.display = '';
    setPlayerBars('You', chessStats.rating, diff.name + ' Bot', diff.elo);
    render();
    setStatus('Your turn', '');
  }

  // ── Online play (Supabase Realtime broadcast) ─────────────────────────
  function genCode() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
  }

  function wsConnect(roomCode, asColor) {
    onlineRoom = roomCode;
    onlineColor = asColor;
    onlineConnected = false;
    var wsUrl =
      'wss://wprfkjeiawxlcnitsfdr.supabase.co/realtime/v1/websocket?apikey=' +
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwcmZramVpYXd4bGNuaXRzZmRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMjAyMzUsImV4cCI6MjA4OTc5NjIzNX0.LbJKG8J_jd2oKYAmQg0ycb-LBnQM1ItlseOLMT_24jc' +
      '&vsn=1.0.0';
    try {
      onlineWs = new WebSocket(wsUrl);
    } catch (e) {
      showToast('Connection failed', 'Could not connect to online server');
      return;
    }
    var hbInterval;
    var joinRef = '' + Date.now();
    onlineWs.onopen = function () {
      // Join broadcast channel
      onlineWs.send(
        JSON.stringify({
          event: 'phx_join',
          topic: 'realtime:chess:' + roomCode,
          payload: { config: { broadcast: { self: false } } },
          ref: joinRef,
          join_ref: joinRef
        })
      );
      hbInterval = setInterval(function () {
        if (onlineWs && onlineWs.readyState === 1)
          onlineWs.send(
            JSON.stringify({ event: 'heartbeat', topic: 'phoenix', payload: {}, ref: 'hb' })
          );
      }, 25000);
    };
    onlineWs.onmessage = function (e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.event === 'phx_reply' && msg.payload && msg.payload.status === 'ok') {
          onlineConnected = true;
          if (asColor === 'w') {
            // Host: signal ready, start game immediately
            wsBroadcast({ type: 'start', hostColor: 'w' });
            startOnlineGame('w', roomCode);
          }
        }
        if (msg.event === 'broadcast' && msg.payload && msg.payload.payload) {
          var data = msg.payload.payload;
          if (data.type === 'start' && asColor === 'b') {
            // Guest receives start signal
            startOnlineGame('b', roomCode);
          }
          if (data.type === 'move' && !gameOver) {
            var m = data;
            execMove(m.fr, m.fc, m.tr, m.tc, m.sp, false);
            if (!gameOver) tryPremove();
          }
          if (data.type === 'resign') {
            if (!gameOver) {
              gameOver = true;
              showOverlay('You Win! 🎉', 'Opponent resigned');
              recordResult(1, chessStats.rating, false, null);
            }
          }
        }
        if (msg.event === 'phx_error' || msg.event === 'phx_close') {
          wsDisconnect();
        }
      } catch (err) {}
    };
    onlineWs.onclose = function () {
      clearInterval(hbInterval);
      onlineConnected = false;
      if (!gameOver && gameMode === 'online') {
        showToast('Disconnected', 'Opponent left the game');
      }
    };
    onlineWs.onerror = function () {
      showToast('Connection error', 'Could not reach online server');
    };
  }

  function wsBroadcast(data) {
    if (!onlineWs || onlineWs.readyState !== 1) return;
    onlineWs.send(
      JSON.stringify({
        event: 'broadcast',
        topic: 'realtime:chess:' + onlineRoom,
        payload: data,
        ref: '' + Date.now()
      })
    );
  }

  function wsDisconnect() {
    if (onlineWs) {
      try {
        onlineWs.close();
      } catch (e) {}
      onlineWs = null;
    }
    onlineConnected = false;
  }

  function startOnlineGame(color, roomCode) {
    initBoard();
    playerColor = color;
    gameMode = 'online';
    botDepth = null;
    botElo = null;
    hideOverlay();
    showPlaySubPanel(null);
    showTab('Moves');
    var resign = document.getElementById('chessResignBtn');
    if (resign) resign.style.display = '';
    setPlayerBars(
      'You (' + (color === 'w' ? 'White' : 'Black') + ')',
      chessStats.rating,
      'Opponent',
      '?'
    );
    render();
    setStatus(color === 'w' ? 'Your turn' : 'Waiting for white…', '');
    var wc = document.getElementById('chessRoomCodeDisplay');
    if (wc) wc.textContent = '';
    showPlaySubPanel(null);
  }

  // ── Wire everything ───────────────────────────────────────────────────
  window._chessInit = function () {
    loadStats();
    initBoard();
    var boardEl = document.getElementById('chessBoard');
    if (boardEl && !boardEl._cw) {
      boardEl._cw = true;
      boardEl.addEventListener('click', function (e) {
        var rect = boardEl.getBoundingClientRect();
        var scaleX = boardEl.width / rect.width,
          scaleY = boardEl.height / rect.height;
        var px = (e.clientX - rect.left) * scaleX,
          py = (e.clientY - rect.top) * scaleY;
        var SQ = boardEl.width / 8;
        var flip = playerColor === 'b';
        var ci = Math.floor(px / SQ),
          ri = Math.floor(py / SQ);
        if (ci < 0 || ci > 7 || ri < 0 || ri > 7) return;
        var col = flip ? 7 - ci : ci,
          row = flip ? 7 - ri : ri;
        handleSqClick(row, col);
      });
    }
    loadPieceImgs();
    // Tabs
    function wireTab(id, name) {
      var el = document.getElementById(id);
      if (el && !el._cw) {
        el._cw = true;
        el.addEventListener('click', function () {
          showTab(name);
        });
      }
    }
    wireTab('chessTabPlay', 'Play');
    wireTab('chessTabMoves', 'Moves');
    wireTab('chessTabRatings', 'Ratings');
    // Mode buttons
    var mb = document.getElementById('chessModeBot');
    if (mb && !mb._cw) {
      mb._cw = true;
      mb.addEventListener('click', function () {
        buildDiffGrid();
        showPlaySubPanel('bot');
      });
    }
    var mo = document.getElementById('chessModeOnline');
    if (mo && !mo._cw) {
      mo._cw = true;
      mo.addEventListener('click', function () {
        showPlaySubPanel('online');
      });
    }
    // Bot back
    var bb = document.getElementById('chessBotBack');
    if (bb && !bb._cw) {
      bb._cw = true;
      bb.addEventListener('click', function () {
        showPlaySubPanel(null);
      });
    }
    // Online back
    var ob = document.getElementById('chessOnlineBack');
    if (ob && !ob._cw) {
      ob._cw = true;
      ob.addEventListener('click', function () {
        showPlaySubPanel(null);
      });
    }
    // Create game
    var cg = document.getElementById('chessCreateBtn');
    if (cg && !cg._cw) {
      cg._cw = true;
      cg.addEventListener('click', function () {
        var code = genCode();
        var cd = document.getElementById('chessRoomCodeDisplay');
        if (cd) cd.textContent = code;
        showPlaySubPanel('waiting');
        wsConnect(code, 'w');
      });
    }
    // Join game
    var jg = document.getElementById('chessJoinBtn');
    if (jg && !jg._cw) {
      jg._cw = true;
      jg.addEventListener('click', function () {
        var inp = document.getElementById('chessJoinInput');
        var code = (inp && inp.value.trim().toUpperCase()) || '';
        if (code.length < 4) {
          showToast('Invalid code', 'Please enter a valid room code');
          return;
        }
        wsConnect(code, 'b');
      });
    }
    // Cancel waiting
    var cw = document.getElementById('chessCancelWait');
    if (cw && !cw._cw) {
      cw._cw = true;
      cw.addEventListener('click', function () {
        wsDisconnect();
        showPlaySubPanel(null);
      });
    }
    // Resign
    var rg = document.getElementById('chessResignBtn');
    if (rg && !rg._cw) {
      rg._cw = true;
      rg.addEventListener('click', function () {
        if (!gameOver) {
          if (gameMode === 'online') wsBroadcast({ type: 'resign' });
          gameOver = true;
          showOverlay('Game Over', 'You resigned');
          rg.style.display = 'none';
          if (gameMode === 'bot') {
            var diffObj = DIFFS.find(function (d) {
              return d.depth === (botDepth || 1) - 1;
            });
            recordResult(0, diffObj ? diffObj.elo : 1200, true, diffObj ? diffObj.id : 1);
          } else if (gameMode === 'online') recordResult(0, chessStats.rating, false, null);
        }
      });
    }
    // New game from overlay
    var ong = document.getElementById('chessOverlayNewGame');
    if (ong && !ong._cw) {
      ong._cw = true;
      ong.addEventListener('click', function () {
        hideOverlay();
        wsDisconnect();
        initBoard();
        showPlaySubPanel(null);
        showTab('Play');
        var resign2 = document.getElementById('chessResignBtn');
        if (resign2) resign2.style.display = 'none';
        render();
        setStatus('', '');
      });
    }
    // Show default state
    showPlaySubPanel(null);
    showTab('Play');
    render();
    renderRatings();
  };

  window._chessStop = function () {
    wsDisconnect();
    gameOver = true;
    aiThinking = false;
  };
})();
