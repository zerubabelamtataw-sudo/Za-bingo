// ============================================================
// ZA BINGO — COMPLETE APP (75-BOARD + WINNER POPUP + ALL FIXES)
// ============================================================
(function() {
  'use strict';

  // ---- Telegram fallback ----
  if (typeof TelegramApp === 'undefined') {
    window.TelegramApp = {
      showAlert: function(msg) { alert(msg); },
      showConfirm: function(msg, cb) { cb(confirm(msg)); },
      getUser: function() { return { id: 123456789, first_name: 'Test', username: 'test' }; }
    };
  }

  // ---- Generate 150 cartelas ----
  function mulberry32(a) {
    return function() {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const rng = mulberry32(20240803);

  function shuffleArray(arr, rngFn) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rngFn() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function generateCartelas(count) {
    const COL_RANGES = [
      [1, 15], [16, 30], [31, 45], [46, 60], [61, 75]
    ];
    const cartelas = [];
    const seen = new Set();
    let attempts = 0;
    while (cartelas.length < count && attempts < 500000) {
      attempts++;
      const colPicks = COL_RANGES.map(([min, max]) => {
        const pool = Array.from({ length: max - min + 1 }, (_, i) => min + i);
        return shuffleArray(pool, rng).slice(0, 5);
      });
      const grid = [];
      for (let row = 0; row < 5; row++) {
        const rowData = [];
        for (let col = 0; col < 5; col++) {
          if (row === 2 && col === 2) rowData.push(null);
          else rowData.push(colPicks[col][row]);
        }
        grid.push(rowData);
      }
      const key = grid.flat().map(v => v === null ? 'F' : v).join(',');
      if (!seen.has(key)) {
        seen.add(key);
        cartelas.push(grid);
      }
    }
    return cartelas;
  }

  // ---- DOM refs ----
  const $ = id => document.getElementById(id);
  const pages = {
    game: document.getElementById('page-game'),
    profile: document.getElementById('page-profile'),
    wallet: document.getElementById('page-wallet'),
    history: document.getElementById('page-history'),
  };
  const screenRooms = document.getElementById('screen-rooms');
  const screenGame = document.getElementById('screen-game');
  const roomCards = document.getElementById('room-cards');
  const cartelaGrid = document.getElementById('cartela-grid-container');
  const selectPerCartela = document.getElementById('select-per-cartela');
  const selectFee = document.getElementById('select-fee');
  const selectConfirm = document.getElementById('select-confirm-btn');
  const selectCancel = document.getElementById('select-cancel-btn');
  const gameActive = document.getElementById('game-active');
  const cartelasContainer = document.getElementById('game-cartelas-container');
  const bingoBtn = document.getElementById('game-bingo-btn');
  const currentCall = document.getElementById('current-call');
  const gamePrizeLabel = document.getElementById('game-prize-label');
  const boardEl = document.getElementById('number-board');
  const overlay = document.getElementById('countdown-overlay');
  const popupCountdown = document.getElementById('popup-countdown');
  const popupPlayers = document.getElementById('popup-players');
  const popupWinAmount = document.getElementById('popup-win-amount');
  const popupCancel = document.getElementById('popup-cancel-btn');
  const headerBalance = document.getElementById('header-balance');
  // Winner popup
  const winnerOverlay = document.getElementById('winner-overlay');
  const winnerCartela = document.getElementById('winner-cartela');
  const winnerPlayerName = document.getElementById('winner-player-name');
  const winnerAmountDisplay = document.getElementById('winner-amount-display');
  const winnerCloseBtn = document.getElementById('winner-close-btn');

  // ---- State ----
  const state = {
    player: {
      id: null,
      name: 'Player',
      username: 'player',
      phone: '',
      balance: 0,
      gamesPlayed: 0,
      gamesWon: 0,
    },
    rooms: {
      '5br': { id: '5br', name: '5 Br', entryFee: 5, prize: 0, players: [], status: 'waiting', joined: false, reservedCartelas: new Set(), playerCartelas: {}, winners: [] },
      '10br': { id: '10br', name: '10 Br', entryFee: 10, prize: 0, players: [], status: 'waiting', joined: false, reservedCartelas: new Set(), playerCartelas: {}, winners: [] },
      '20br': { id: '20br', name: '20 Br', entryFee: 20, prize: 0, players: [], status: 'waiting', joined: false, reservedCartelas: new Set(), playerCartelas: {}, winners: [] },
    },
    allCartelas: [],
    selectedRoomId: null,
    selectedCartelaIndices: [],
    currentRoom: null,
    cartelas: [],
    calledNumbers: [],
    markedNumbers: new Set(),
    countdown: 25,
    isGameActive: false,
    isBingoAvailable: false,
    winner: null,
    winningCartelaIndex: null,
    history: [],
    transactions: [],
    countdownInterval: null,
    drawInterval: null,
  };

  state.allCartelas = generateCartelas(150);

  function updateHeader() {
    headerBalance.textContent = state.player.balance + ' Br';
  }

  function navigateTo(page) {
    Object.keys(pages).forEach(key => {
      pages[key].classList.remove('active');
    });
    pages[page].classList.add('active');
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });
    if (page === 'game') {
      if (!state.currentRoom) {
        screenRooms.style.display = 'block';
        screenGame.style.display = 'none';
      }
      renderRooms();
    }
    if (page === 'profile') updateProfileUI();
    if (page === 'wallet') updateWalletUI();
    if (page === 'history') updateHistoryUI();
  }

  // ---- Render Rooms ----
  function renderRooms() {
    let html = '';
    for (const [id, room] of Object.entries(state.rooms)) {
      const statusColor = room.status === 'waiting' ? '#f39c12' :
                          room.status === 'countdown' ? '#3498db' :
                          room.status === 'playing' ? '#2ecc71' : '#e74c3c';
      html += `
        <div class="room-card" data-room="${id}">
          <div class="room-info">
            <h3>${room.name}</h3>
            <p>Prize: ${room.prize} Br · Players: ${room.players.length} · Stake: ${room.entryFee} Br per cartela</p>
          </div>
          <div class="room-action">
            <span class="room-status" style="background:${statusColor}30;color:${statusColor}">${room.status.toUpperCase()}</span>
          </div>
        </div>
      `;
    }
    roomCards.innerHTML = html;
    roomCards.querySelectorAll('.room-card').forEach(card => {
      card.addEventListener('click', function() {
        const roomId = this.dataset.room;
        openCartelaSelection(roomId);
      });
    });
  }

  // ---- Cartela Selection ----
  function openCartelaSelection(roomId) {
    state.selectedRoomId = roomId;
    state.selectedCartelaIndices = [];
    const room = state.rooms[roomId];
    if (!room.reservedCartelas) room.reservedCartelas = new Set();
    updateSelectInfo();
    screenRooms.style.display = 'none';
    screenGame.style.display = 'block';
    document.getElementById('cartela-selection').style.display = 'block';
    gameActive.style.display = 'none';
    renderCartelaSelection();
  }

  function updateSelectInfo() {
    const room = state.rooms[state.selectedRoomId];
    const count = state.selectedCartelaIndices.length;
    selectPerCartela.textContent = room.entryFee;
    selectFee.textContent = room.entryFee * count;
  }

  function renderCartelaSelection() {
    const room = state.rooms[state.selectedRoomId];
    let html = '';
    for (let i = 0; i < state.allCartelas.length; i++) {
      const isReserved = room.reservedCartelas.has(i);
      const isSelected = state.selectedCartelaIndices.includes(i);
      const cls = 'cartela-select-item' + (isSelected ? ' selected' : '') + (isReserved ? ' disabled' : '');
      html += `<div class="${cls}" data-index="${i}">${i+1}</div>`;
    }
    cartelaGrid.innerHTML = html;
    cartelaGrid.querySelectorAll('.cartela-select-item:not(.disabled)').forEach(el => {
      el.addEventListener('click', function() {
        const idx = parseInt(this.dataset.index);
        const pos = state.selectedCartelaIndices.indexOf(idx);
        if (pos > -1) {
          state.selectedCartelaIndices.splice(pos, 1);
        } else {
          if (state.selectedCartelaIndices.length >= 4) {
            TelegramApp.showAlert('Maximum 4 cartelas.');
            return;
          }
          state.selectedCartelaIndices.push(idx);
        }
        updateSelectInfo();
        renderCartelaSelection();
      });
    });
  }

  // ---- Build 75-number board ----
  function buildBoard() {
    const rows = [
      { label: 'B', cls: 'b', nums: Array.from({length:15}, (_,i) => i+1) },
      { label: 'I', cls: 'i', nums: Array.from({length:15}, (_,i) => i+16) },
      { label: 'N', cls: 'n', nums: Array.from({length:15}, (_,i) => i+31) },
      { label: 'G', cls: 'g', nums: Array.from({length:15}, (_,i) => i+46) },
      { label: 'O', cls: 'o', nums: Array.from({length:15}, (_,i) => i+61) }
    ];
    let html = '';
    rows.forEach(row => {
      html += `<div class="board-row">`;
      html += `<span class="row-label ${row.cls}">${row.label}</span>`;
      row.nums.forEach(n => {
        html += `<div class="board-cell" data-n="${n}">${n}</div>`;
      });
      html += `</div>`;
    });
    boardEl.innerHTML = html;
  }

  // ---- Render board ----
  function renderBoard() {
    boardEl.querySelectorAll('.board-cell').forEach(el => {
      const n = parseInt(el.dataset.n);
      el.classList.remove('called', 'marked');
      if (state.calledNumbers.includes(n)) el.classList.add('called');
      if (state.markedNumbers.has(n)) el.classList.add('marked');
    });
  }

  // ---- Render cartelas ----
  function renderCartelas() {
    if (!state.cartelas || state.cartelas.length === 0) {
      cartelasContainer.innerHTML = '<p style="text-align:center;color:var(--text-secondary)">No cartela loaded.</p>';
      return;
    }
    let html = '';
    state.cartelas.forEach((grid) => {
      html += `<div class="cartela-box"><div class="cartela-grid">`;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const val = grid[r][c];
          let cls = 'cartela-cell';
          if (val === null) cls += ' free';
          if (val !== null && state.calledNumbers.includes(val)) cls += ' called';
          if (state.markedNumbers && state.markedNumbers.has(val)) cls += ' marked';
          html += `<div class="${cls}">${val === null ? '★' : val}</div>`;
        }
      }
      html += `</div></div>`;
    });
    cartelasContainer.innerHTML = html;
  }

  // ---- Render current call & prize ----
  function renderGameHeader() {
    if (state.calledNumbers.length === 0) {
      currentCall.textContent = '—';
      currentCall.className = 'current-call';
    } else {
      const last = state.calledNumbers[state.calledNumbers.length - 1];
      let prefix = '';
      let cls = '';
      if (last <= 15) { prefix = 'B'; cls = 'b'; }
      else if (last <= 30) { prefix = 'I'; cls = 'i'; }
      else if (last <= 45) { prefix = 'N'; cls = 'n'; }
      else if (last <= 60) { prefix = 'G'; cls = 'g'; }
      else { prefix = 'O'; cls = 'o'; }
      currentCall.textContent = prefix + last;
      currentCall.className = 'current-call ' + cls;
    }
    // Update prize
    const room = state.rooms[state.currentRoom];
    if (room) {
      let totalCartelas = 0;
      for (const pid in room.playerCartelas) {
        totalCartelas += room.playerCartelas[pid].length;
      }
      const winAmount = (room.entryFee * totalCartelas) * 0.85;
      gamePrizeLabel.textContent = 'ደራሽ: ' + winAmount.toFixed(2) + ' Br';
    }
  }

  // ---- Full UI update ----
  function updateGameUI() {
    renderBoard();
    renderCartelas();
    renderGameHeader();
    if (state.calledNumbers.length >= 5 && !state.isBingoAvailable) {
      state.isBingoAvailable = true;
      bingoBtn.disabled = false;
    }
  }

  // ---- Enhanced BINGO Check (rows, columns, diagonals, 4 corners) ----
  function checkCartelaComplete(grid) {
    // Check rows
    for (let r = 0; r < 5; r++) {
      let rowComplete = true;
      for (let c = 0; c < 5; c++) {
        const val = grid[r][c];
        if (val !== null && !state.markedNumbers.has(val)) {
          rowComplete = false;
          break;
        }
      }
      if (rowComplete) return true;
    }

    // Check columns
    for (let c = 0; c < 5; c++) {
      let colComplete = true;
      for (let r = 0; r < 5; r++) {
        const val = grid[r][c];
        if (val !== null && !state.markedNumbers.has(val)) {
          colComplete = false;
          break;
        }
      }
      if (colComplete) return true;
    }

    // Check diagonals
    let diag1 = true;
    for (let i = 0; i < 5; i++) {
      const val = grid[i][i];
      if (val !== null && !state.markedNumbers.has(val)) {
        diag1 = false;
        break;
      }
    }
    if (diag1) return true;

    let diag2 = true;
    for (let i = 0; i < 5; i++) {
      const val = grid[i][4 - i];
      if (val !== null && !state.markedNumbers.has(val)) {
        diag2 = false;
        break;
      }
    }
    if (diag2) return true;

    // Check four corners
    const corners = [grid[0][0], grid[0][4], grid[4][0], grid[4][4]];
    const cornersComplete = corners.every(val => val === null || state.markedNumbers.has(val));
    if (cornersComplete) return true;

    return false;
  }

  // ---- Confirm Selection ----
  selectConfirm.addEventListener('click', function() {
    const room = state.rooms[state.selectedRoomId];
    const count = state.selectedCartelaIndices.length;
    if (count === 0) {
      TelegramApp.showAlert('Select at least 1 cartela.');
      return;
    }
    const totalFee = room.entryFee * count;
    if (state.player.balance < totalFee) {
      TelegramApp.showAlert('Insufficient balance! Need ' + totalFee + ' Br.');
      return;
    }

    for (const idx of state.selectedCartelaIndices) {
      if (room.reservedCartelas.has(idx)) {
        TelegramApp.showAlert('Cartela #' + (idx + 1) + ' was already taken. Please reselect.');
        state.selectedCartelaIndices = [];
        renderCartelaSelection();
        updateSelectInfo();
        return;
      }
    }

fetch(`/api/rooms/${state.selectedRoomId}/join`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-telegram-id': state.player.id
  },
  body: JSON.stringify({
    cartelaIndices: state.selectedCartelaIndices
  })
})
.then(res => res.json())
.then(data => {
  if (!data.success) {
    TelegramApp.showAlert(data.error);
    return;
  }

  state.currentRoom = state.selectedRoomId;
  room.joined = true;
  
  showCountdownPopup();
  document.getElementById('cartela-selection').style.display = 'none';
  gameActive.style.display = 'block';

  if (boardEl.children.length === 0) {
    buildBoard();
  }

  updateHeader();
  renderRooms();
  updateGameUI();
});

    state.cartelas = data.cartelas || [];
    state.calledNumbers = [];
    state.markedNumbers = new Set();
    state.countdown = 25;
    state.isGameActive = false;
    state.isBingoAvailable = false;
    state.winner = null;
    state.winningCartelaIndex = null;
    room.winners = [];

    updateHeader();
    showCountdownPopup();
    document.getElementById('cartela-selection').style.display = 'none';
    gameActive.style.display = 'block';
    if (boardEl.children.length === 0) {
      buildBoard();
    }

    if (room.players.length >= 2) {
      room.status = 'countdown';
      
    }

    renderRooms();
    updateGameUI();
  });

  selectCancel.addEventListener('click', function() {
    screenGame.style.display = 'none';
    screenRooms.style.display = 'block';
    renderRooms();
  });

  // ---- Countdown Popup ----
  function showCountdownPopup() {
    overlay.classList.add('show');
    updateCountdownPopup();
  }

function syncGameState() {
  if (!state.currentRoom) return;

  fetch(`/api/game/${state.currentRoom}`, {
    headers: {
      'x-telegram-id': state.player.id
    }
  })
  .then(res => res.json())
  .then(data => {
    if (!data.success) return;

    const game = data.game;

    state.countdown = game.countdown || 0;
state.calledNumbers = game.calledNumbers || [];
    const room = state.rooms[state.currentRoom];
    if (room) {
      room.status = game.status;
      room.players = game.players || room.players;
    }

    updateCountdownPopup();
    renderRooms();
  })
  .catch(err => console.log(err));
}

  function updateCountdownPopup() {
    const room = state.rooms[state.currentRoom];
    if (!room) return;
    popupPlayers.textContent = room.players.length;
    let totalCartelas = 0;
    for (const pid in room.playerCartelas) {
      totalCartelas += room.playerCartelas[pid].length;
    }
    const totalStake = room.entryFee * totalCartelas;
    const winAmount = totalStake * 0.85;
    popupWinAmount.textContent = winAmount.toFixed(2) + ' Br';
    popupCountdown.textContent = state.countdown;
  }

  function hideCountdownPopup() {
    overlay.classList.remove('show');
  }

  // ---- Cancel Popup ----
  popupCancel.addEventListener('click', function() {
    const room = state.rooms[state.currentRoom];
    if (!room) {
      TelegramApp.showAlert('No room to cancel.');
      return;
    }
    if (state.countdown <= 0 || (room.status !== 'waiting' && room.status !== 'countdown')) {
      TelegramApp.showAlert('Cannot cancel, game is starting.');
      return;
    }

    const playerCartelas = room.playerCartelas?.[state.player.id] || [];
    const refund = room.entryFee * playerCartelas.length;
    state.player.balance += refund;
    room.prize -= refund;

    room.players = room.players.filter(id => id !== state.player.id);
    delete room.playerCartelas[state.player.id];
    playerCartelas.forEach(idx => {
      room.reservedCartelas.delete(idx);
    });
    room.joined = false;

    if (room.players.length === 0) {
      room.status = 'waiting';
      room.prize = 0;
      room.reservedCartelas = new Set();
      room.playerCartelas = {};
      room.winners = [];
    } else if (room.players.length < 2 && (room.status === 'countdown' || room.status === 'waiting')) {
      room.status = 'waiting';
      if (state.countdownInterval) {
        clearInterval(state.countdownInterval);
        state.countdownInterval = null;
      }
    }

    state.currentRoom = null;
    state.cartelas = [];
    state.calledNumbers = [];
    state.markedNumbers = new Set();
    state.countdown = 0;
    state.isGameActive = false;
    state.isBingoAvailable = false;
    state.winner = null;
    state.winningCartelaIndex = null;

    updateHeader();
    hideCountdownPopup();
    gameActive.style.display = 'none';
    document.getElementById('cartela-selection').style.display = 'block';
    screenGame.style.display = 'none';
    screenRooms.style.display = 'block';
    renderRooms();
    TelegramApp.showAlert('Refunded ' + refund + ' Br.');
  });

  // ---- Countdown & Game ----
  function startCountdown() {
    if (state.countdownInterval) clearInterval(state.countdownInterval);
    // state.countdown = 25;
    const room = state.rooms[state.currentRoom];
    // room.status = 'countdown';

    state.countdownInterval = setInterval(() => {
  syncGameState();
}, 1000);
  }

  function startGame() {
    const room = state.rooms[state.currentRoom];
    if (!room) return;
    room.status = 'playing';
    state.isGameActive = true;
    state.calledNumbers = [];
    state.isBingoAvailable = false;
    state.winner = null;
    state.winningCartelaIndex = null;
    room.winners = [];

    if (state.drawInterval) clearInterval(state.drawInterval);
    // Server controls number drawing

    updateGameUI();
  }

  function drawNumber() {
    const room = state.rooms[state.currentRoom];
    if (!room || room.status !== 'playing') {
      clearInterval(state.drawInterval);
      state.drawInterval = null;
      return;
    }

    if (room.winners && room.winners.length > 0) {
      clearInterval(state.drawInterval);
      state.drawInterval = null;
      return;
    }

    let num;
    let attempts = 0;
    do {
      num = Math.floor(Math.random() * 75) + 1;
      attempts++;
    } while (state.calledNumbers.includes(num) && attempts < 100);

    if (!state.calledNumbers.includes(num)) {
      state.calledNumbers.push(num);
      if (state.calledNumbers.length >= 5) {
        state.isBingoAvailable = true;
      }
    }

    updateGameUI();

    if (state.calledNumbers.length >= 75) {
      clearInterval(state.drawInterval);
      state.drawInterval = null;
      room.status = 'waiting';
      state.isGameActive = false;
    }
  }

  // ---- Board click toggle ----
  boardEl.addEventListener('click', function(e) {
    const el = e.target.closest('.board-cell');
    if (!el) return;
    const num = parseInt(el.dataset.n);
    if (!state.calledNumbers.includes(num)) return;

    if (state.markedNumbers.has(num)) {
      state.markedNumbers.delete(num);
    } else {
      state.markedNumbers.add(num);
    }
    updateGameUI();
  });

  // ---- BINGO ----
  bingoBtn.addEventListener('click', function() {
    if (!state.isBingoAvailable) return;
    const room = state.rooms[state.currentRoom];
    if (!room) return;

    if (room.winners && room.winners.length > 0) {
      TelegramApp.showAlert('A winner has already been declared for this round!');
      return;
    }

    const winningIndices = [];
    for (let idx = 0; idx < state.cartelas.length; idx++) {
      if (checkCartelaComplete(state.cartelas[idx])) {
        winningIndices.push(idx);
      }
    }

    if (winningIndices.length === 0) {
      TelegramApp.showAlert('No complete pattern found on your cartelas.');
      return;
    }

    const firstWinningIdx = winningIndices[0];
    state.winner = state.player.name;
    state.winningCartelaIndex = firstWinningIdx;

    let totalCartelas = 0;
    for (const pid in room.playerCartelas) {
      totalCartelas += room.playerCartelas[pid].length;
    }
    const totalPot = room.entryFee * totalCartelas;

    const winAmount = (totalPot * 0.85) / winningIndices.length;
    state.player.balance += winAmount * winningIndices.length;
    state.player.gamesPlayed += 1;
    state.player.gamesWon += 1;
    state.isBingoAvailable = false;
    room.status = 'winner';

    if (!room.winners) room.winners = [];
    room.winners.push({
      playerId: state.player.id,
      playerName: state.player.name,
      cartelaIndex: firstWinningIdx,
      cartelaNumber: state.selectedCartelaIndices[firstWinningIdx] + 1,
      amount: winAmount,
      winningIndices: winningIndices
    });

    state.history.push({
      room: room.name,
      prize: winAmount * winningIndices.length,
      result: 'win',
      date: new Date().toLocaleString()
    });
    state.transactions.push({
      type: 'win',
      amount: winAmount * winningIndices.length,
      desc: 'Won ' + room.name,
      date: new Date().toLocaleString()
    });

    updateHeader();
    updateGameUI();

    winnerCartela.textContent = '#' + (state.selectedCartelaIndices[firstWinningIdx] + 1);
    winnerPlayerName.textContent = state.player.name;
    winnerAmountDisplay.textContent = (winAmount * winningIndices.length).toFixed(2) + ' Br';
    winnerOverlay.classList.add('show');

    if (state.drawInterval) {
      clearInterval(state.drawInterval);
      state.drawInterval = null;
    }
  });

  // ---- Winner popup close ----
  winnerCloseBtn.addEventListener('click', function() {
    winnerOverlay.classList.remove('show');
    resetRoom();
  });

  // ---- Reset Room ----
  function resetRoom() {
    const room = state.rooms[state.currentRoom];
    if (!room) return;
    room.players = [];
    room.prize = 0;
    room.status = 'waiting';
    room.joined = false;
    room.reservedCartelas = new Set();
    room.playerCartelas = {};
    room.winners = [];
    state.currentRoom = null;
    state.cartelas = [];
    state.calledNumbers = [];
    state.markedNumbers = new Set();
    state.countdown = 0;
    state.isGameActive = false;
    state.isBingoAvailable = false;
    state.winner = null;
    state.winningCartelaIndex = null;

    if (state.countdownInterval) {
      clearInterval(state.countdownInterval);
      state.countdownInterval = null;
    }
    if (state.drawInterval) {
      clearInterval(state.drawInterval);
      state.drawInterval = null;
    }

    screenGame.style.display = 'none';
    screenRooms.style.display = 'block';
    gameActive.style.display = 'none';
    document.getElementById('cartela-selection').style.display = 'block';
    boardEl.innerHTML = '';
    renderRooms();
  }

  // ---- Profile ----
  function updateProfileUI() {
    document.getElementById('profile-name').textContent = state.player.name;
    document.getElementById('profile-username').textContent = '@' + state.player.username;
    document.getElementById('profile-tgid').textContent = state.player.id || '-';
    document.getElementById('profile-phone').value = state.player.phone || '';
    document.getElementById('profile-played').textContent = state.player.gamesPlayed;
    document.getElementById('profile-won').textContent = state.player.gamesWon;
    document.getElementById('profile-balance').textContent = state.player.balance + ' Br';
  }

  document.getElementById('profile-save-btn').addEventListener('click', function() {
    const phone = document.getElementById('profile-phone').value.trim();
    if (!phone) {
      TelegramApp.showAlert('Enter a phone number.');
      return;
    }
    state.player.phone = phone;
    TelegramApp.showAlert('Phone saved.');
    updateProfileUI();
  });

  document.getElementById('profile-logout-btn').addEventListener('click', function() {
    TelegramApp.showConfirm('Logout?', function(ok) {
      if (ok) {
        state.player.name = 'Guest';
        state.player.balance = 0;
        state.player.gamesPlayed = 0;
        state.player.gamesWon = 0;
        state.player.phone = '';
        updateHeader();
        updateProfileUI();
        navigateTo('game');
      }
    });
  });

  // ---- Wallet ----
  function updateWalletUI() {
    document.getElementById('wallet-balance-amount').textContent = state.player.balance + ' Br';
    const list = document.getElementById('transaction-list');
    if (state.transactions.length === 0) {
      list.innerHTML = '<p class="empty-msg">No transactions.</p>';
    } else {
      list.innerHTML = state.transactions.map(t => `
        <div class="transaction-item">
          <span>${t.desc}</span>
          <span class="txn-amount ${t.amount >= 0 ? 'positive' : 'negative'}">${t.amount >= 0 ? '+' : ''}${t.amount} Br</span>
        </div>
      `).join('');
    }
  }

  document.getElementById('deposit-verify-btn').addEventListener('click', function() {
    const method = document.querySelector('input[name="deposit-method"]:checked');
    if (!method) { TelegramApp.showAlert('Select a payment method.'); return; }
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    if (!amount || amount <= 0) { TelegramApp.showAlert('Enter valid amount.'); return; }
    const sms = document.getElementById('deposit-sms').value.trim();
    if (!sms) { TelegramApp.showAlert('Paste SMS confirmation.'); return; }

    const statusEl = document.getElementById('deposit-status');
    statusEl.textContent = 'Verifying...';
    statusEl.className = 'status-msg';

    setTimeout(function() {
      state.player.balance += amount;
      state.transactions.push({
        type: 'deposit',
        amount: amount,
        desc: 'Deposit via ' + method.value,
        date: new Date().toLocaleString()
      });
      updateHeader();
      updateWalletUI();
      statusEl.textContent = '✅ Verified! ' + amount + ' Br added.';
      statusEl.className = 'status-msg success';
      document.getElementById('deposit-amount').value = '';
      document.getElementById('deposit-sms').value = '';
      document.querySelector('input[name="deposit-method"]:checked').checked = false;
    }, 1000);
  });

  document.getElementById('withdraw-btn').addEventListener('click', function() {
    const method = document.querySelector('input[name="withdraw-method"]:checked');
    if (!method) { TelegramApp.showAlert('Select a payment method.'); return; }
    const phone = document.getElementById('withdraw-phone').value.trim();
    if (!phone) { TelegramApp.showAlert('Enter phone number.'); return; }
    TelegramApp.showConfirm('Withdraw all balance?', function(ok) {
      if (ok) {
        const amount = state.player.balance;
        if (amount <= 0) { TelegramApp.showAlert('No balance to withdraw.'); return; }
        const statusEl = document.getElementById('withdraw-status');
        statusEl.textContent = 'Processing...';
        statusEl.className = 'status-msg';

        setTimeout(function() {
          state.player.balance = 0;
          state.transactions.push({
            type: 'withdraw',
            amount: -amount,
            desc: 'Withdraw via ' + method.value,
            date: new Date().toLocaleString()
          });
          updateHeader();
          updateWalletUI();
          statusEl.textContent = '✅ Withdrawal requested for ' + amount + ' Br to ' + phone;
          statusEl.className = 'status-msg success';
          document.getElementById('withdraw-phone').value = '';
          document.querySelector('input[name="withdraw-method"]:checked').checked = false;
        }, 1000);
      }
    });
  });

  // ---- History ----
  function updateHistoryUI() {
    const list = document.getElementById('history-list');
    if (state.history.length === 0) {
      list.innerHTML = '<p class="empty-msg">No games played.</p>';
    } else {
      list.innerHTML = state.history.map(h => `
        <div class="history-item">
          <span>${h.room}</span>
          <span class="history-result ${h.result}">${h.result === 'win' ? 'Win' : 'Lose'} ${h.prize.toFixed(2)} Br</span>
          <span>${h.date}</span>
        </div>
      `).join('');
    }
  }

  // ---- Bottom Nav ----
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', function() {
      navigateTo(this.dataset.page);
    });
  });

  // ---- Init ----
  function init() {
  let tgUser = null;

  if (window.Telegram && Telegram.WebApp) {
    const tg = Telegram.WebApp;

    tg.ready();
    tg.expand();

    tgUser = tg.initDataUnsafe?.user || null;
  }

  if (tgUser) {
    state.player.id = tgUser.id;
    state.player.name = tgUser.first_name || 'Player';
    state.player.username = tgUser.username || 'player';
  } else {
    state.player.id = null;
    state.player.name = 'Guest';
    state.player.username = 'guest';
  }
  
  fetch(`/api/player?tg_id=${state.player.id}&first_name=${encodeURIComponent(state.player.name)}&username=${encodeURIComponent(state.player.username)}`)
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      state.player = {
        ...state.player,
        ...data.player
      };

      updateHeader();
      updateProfileUI();
      updateWalletUI();
    }
  });

  updateHeader();
  loadRooms();
  updateProfileUI();
  updateWalletUI();
  updateHistoryUI();
  navigateTo('game');
}

function loadRooms() {
  fetch('/api/rooms')
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        state.rooms = data.rooms;
        renderRooms();
      }
    })
    .catch(err => console.log(err));
}

  init();

})();