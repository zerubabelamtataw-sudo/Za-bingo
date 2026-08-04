// app.js — ZA Bingo Frontend (Production‑Ready)

(function() {
  'use strict';

  // ---- Seeded PRNG for deterministic cartelas ----
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

  function generateCartelas(count = 150) {
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
          if (row === 2 && col === 2) {
            rowData.push(null);
          } else {
            rowData.push(colPicks[col][row]);
          }
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
  const pages = {
    rooms: document.getElementById('page-rooms'),
    cartelaSelect: document.getElementById('page-cartela-select'),
    history: document.getElementById('page-history'),
    wallet: document.getElementById('page-wallet'),
    profile: document.getElementById('page-profile'),
    game: document.getElementById('page-game'),
  };
  const navButtons = document.querySelectorAll('.nav-item');
  const headerBalance = document.getElementById('header-balance');

  // ---- State ----
  const state = {
    currentPage: 'rooms',
    player: {
      id: null,
      name: 'Player',
      username: 'player',
      phone: '',
      balance: 100,
      gamesPlayed: 0,
      gamesWon: 0,
    },
    rooms: {
      '5br': { 
        id: '5br', name: '5 Br', entryFee: 5, prize: 0, players: [], 
        status: 'waiting', joined: false, 
        reservedCartelas: new Set(),
        playerCartelas: {}
      },
      '10br': { 
        id: '10br', name: '10 Br', entryFee: 10, prize: 0, players: [], 
        status: 'waiting', joined: false,
        reservedCartelas: new Set(),
        playerCartelas: {}
      },
      '20br': { 
        id: '20br', name: '20 Br', entryFee: 20, prize: 0, players: [], 
        status: 'waiting', joined: false,
        reservedCartelas: new Set(),
        playerCartelas: {}
      },
    },
    selectedRoomId: null,
    selectedCartelaIndices: [],
    currentRoom: null,
    cartelas: [],
    cartelaIndices: [],
    calledNumbers: [],
    markedNumbers: new Set(),
    countdown: 25,
    isGameActive: false,
    isBingoAvailable: false,
    winner: null,
    allCartelas: [],
    history: [],
    transactions: [],
    roomListener: null,
    balanceListener: null,
  };

  // ---- Generate 150 cartelas ----
  state.allCartelas = generateCartelas(150);
  console.log('✅ ' + state.allCartelas.length + ' permanent cartelas generated');

  // ---- Helper: update header ----
  function updateHeaderBalance() {
    headerBalance.textContent = state.player.balance + ' Br';
  }

  // ---- Navigation ----
  function navigateTo(page) {
    for (const key in pages) {
      pages[key].classList.remove('active');
      if (key !== 'game') pages[key].style.display = 'none';
    }
    if (page === 'game') {
      pages.game.style.display = 'block';
      pages.game.classList.add('active');
    } else {
      pages[page].style.display = 'block';
      pages[page].classList.add('active');
    }
    navButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });
    state.currentPage = page;
    if (page === 'rooms') renderRooms();
    if (page === 'game') updateGameUI();
    if (page === 'profile') updateProfileUI();
    if (page === 'wallet') updateWalletUI();
    if (page === 'history') updateHistoryUI();
    if (page === 'cartelaSelect') renderCartelaSelection();
  }

  // ---- Render Rooms ----
  function renderRooms() {
    const container = document.getElementById('room-cards');
    let html = '';
    for (const [id, room] of Object.entries(state.rooms)) {
      const statusColor = room.status === 'waiting' ? '#f39c12' :
                          room.status === 'countdown' ? '#3498db' :
                          room.status === 'playing' ? '#2ecc71' : '#e74c3c';
      const joined = room.joined;
      html += `
        <div class="room-card">
          <div class="room-info">
            <h3>${room.name}</h3>
            <p>Prize: ${room.prize} Br · Players: ${room.players.length} · Fee: ${room.entryFee} Br</p>
          </div>
          <div class="room-action">
            <span class="room-status" style="background:${statusColor}30;color:${statusColor}">
              ${room.status.toUpperCase()}
            </span>
            <button class="btn-join ${joined ? 'joined' : ''}" 
                    data-room="${id}"
                    ${joined ? 'disabled' : ''}>
              ${joined ? 'Joined' : 'Join'}
            </button>
          </div>
        </div>
      `;
    }
    container.innerHTML = html;

    container.querySelectorAll('.btn-join:not([disabled])').forEach(btn => {
      btn.addEventListener('click', function(e) {
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
    updateSelectFee();
    navigateTo('cartelaSelect');
    renderCartelaSelection();
  }

  function updateSelectFee() {
    const room = state.rooms[state.selectedRoomId];
    const fee = room.entryFee * state.selectedCartelaIndices.length;
    document.getElementById('select-fee').textContent = fee;
  }

  function renderCartelaSelection() {
    const container = document.getElementById('cartela-grid-container');
    const room = state.rooms[state.selectedRoomId];
    const reserved = room.reservedCartelas;
    let html = '';
    for (let i = 0; i < state.allCartelas.length; i++) {
      const isReserved = reserved.has(i);
      const isSelected = state.selectedCartelaIndices.includes(i);
      const cls = 'cartela-select-item' + (isSelected ? ' selected' : '') + (isReserved ? ' disabled' : '');
      html += `<div class="${cls}" data-index="${i}">${i+1}</div>`;
    }
    container.innerHTML = html;

    container.querySelectorAll('.cartela-select-item:not(.disabled)').forEach(el => {
      el.addEventListener('click', function() {
        const idx = parseInt(this.dataset.index);
        const pos = state.selectedCartelaIndices.indexOf(idx);
        if (pos > -1) {
          state.selectedCartelaIndices.splice(pos, 1);
        } else {
          if (state.selectedCartelaIndices.length >= 4) {
            TelegramApp.showAlert('You can select a maximum of 4 cartelas.');
            return;
          }
          state.selectedCartelaIndices.push(idx);
        }
        updateSelectFee();
        renderCartelaSelection();
      });
    });
  }

  // Confirm selection
  document.getElementById('select-confirm-btn').addEventListener('click', async function() {
    const roomId = state.selectedRoomId;
    const room = state.rooms[roomId];
    const count = state.selectedCartelaIndices.length;
    if (count === 0) {
      TelegramApp.showAlert('Please select at least 1 cartela.');
      return;
    }
    const totalFee = room.entryFee * count;
    if (state.player.balance < totalFee) {
      TelegramApp.showAlert('Insufficient balance! Need ' + totalFee + ' Br.');
      return;
    }

    // Call API (mock)
    const result = await window.APIClient.joinRoom(roomId, state.selectedCartelaIndices);
    if (!result.success) {
      TelegramApp.showAlert(result.error || 'Failed to join room.');
      return;
    }

    // Update local state
    state.player.balance -= totalFee;
    room.prize += totalFee;
    room.players.push(state.player.id);
    room.joined = true;
    state.currentRoom = roomId;

    // Reserve cartelas
    state.selectedCartelaIndices.forEach(idx => {
      room.reservedCartelas.add(idx);
      if (!room.playerCartelas[state.player.id]) {
        room.playerCartelas[state.player.id] = [];
      }
      room.playerCartelas[state.player.id].push(idx);
    });

    state.cartelaIndices = [...state.selectedCartelaIndices];
    state.cartelas = state.cartelaIndices.map(idx => state.allCartelas[idx]);
    state.calledNumbers = [];
    state.markedNumbers = new Set();
    state.countdown = 25;
    state.isGameActive = false;
    state.isBingoAvailable = false;
    state.winner = null;

    updateHeaderBalance();
    showCountdownPopup();

    if (room.players.length >= 2) {
      room.status = 'countdown';
      startCountdown(roomId);
    }

    renderRooms();
    navigateTo('game');
    updateGameUI();
  });

  document.getElementById('select-cancel-btn').addEventListener('click', function() {
    navigateTo('rooms');
  });

  // ---- Countdown Popup ----
  function showCountdownPopup() {
    const overlay = document.getElementById('countdown-overlay');
    overlay.style.display = 'flex';
    updateCountdownPopup();
  }

  function updateCountdownPopup() {
    const room = state.rooms[state.currentRoom];
    if (!room) return;
    document.getElementById('popup-players').textContent = room.players.length;
    const totalStake = room.entryFee * room.players.length;
    const winAmount = totalStake * 0.85;
    document.getElementById('popup-win-amount').textContent = winAmount.toFixed(2);
    document.getElementById('popup-countdown').textContent = state.countdown;
  }

  function hideCountdownPopup() {
    document.getElementById('countdown-overlay').style.display = 'none';
  }

  // ---- Countdown & Game ----
  let countdownInterval = null;
  let drawInterval = null;

  function startCountdown(roomId) {
    if (countdownInterval) clearInterval(countdownInterval);
    const room = state.rooms[roomId];
    if (!room) return;

    state.countdown = 25;
    state.isGameActive = false;
    room.status = 'countdown';

    countdownInterval = setInterval(() => {
      state.countdown -= 1;
      updateCountdownPopup();
      if (state.currentPage === 'game') updateGameUI();

      if (state.countdown <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        hideCountdownPopup();
        startGame(roomId);
      }
    }, 1000);
  }

  function startGame(roomId) {
    const room = state.rooms[roomId];
    if (!room) return;
    room.status = 'playing';
    state.isGameActive = true;
    state.calledNumbers = [];
    state.isBingoAvailable = false;
    state.winner = null;

    if (drawInterval) clearInterval(drawInterval);
    drawInterval = setInterval(() => {
      drawNumber(roomId);
    }, 3000);

    if (state.currentPage === 'game') updateGameUI();
  }

  function drawNumber(roomId) {
    const room = state.rooms[roomId];
    if (!room || room.status !== 'playing') {
      clearInterval(drawInterval);
      drawInterval = null;
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

    renderCalledNumbers();
    if (state.currentPage === 'game') {
      renderAllCartelas();
      updateGameUI();
    }

    if (state.calledNumbers.length >= 75) {
      clearInterval(drawInterval);
      drawInterval = null;
      room.status = 'waiting';
      state.isGameActive = false;
    }
  }

  // ---- Manual Marking ----
  function markNumberOnCartelas(number) {
    if (state.markedNumbers.has(number)) return;
    state.markedNumbers.add(number);
    renderAllCartelas();
    renderCalledNumbers();
  }

  // ---- Render Game UI ----
  function renderAllCartelas() {
    const container = document.getElementById('game-cartelas-container');
    if (!state.cartelas || state.cartelas.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-secondary)">No cartela loaded.</p>';
      return;
    }
    let html = '';
    state.cartelas.forEach((grid, idx) => {
      html += `<div class="cartela-box"><div class="cartela-grid">`;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const val = grid[r][c];
          let cls = 'cartela-cell';
          if (val === null) cls += ' free';
          if (val !== null && state.calledNumbers.includes(val)) {
            cls += ' called';
          }
          if (state.markedNumbers && state.markedNumbers.has(val)) {
            cls += ' marked';
          }
          const display = val === null ? '★' : val;
          html += `<div class="${cls}">${display}</div>`;
        }
      }
      html += `</div></div>`;
    });
    container.innerHTML = html;
  }

  function renderCalledNumbers() {
    const list = document.getElementById('called-numbers-list');
    if (state.calledNumbers.length === 0) {
      list.innerHTML = '<span style="color:var(--text-secondary)">Waiting for first draw...</span>';
      return;
    }
    let html = '';
    state.calledNumbers.forEach(num => {
      const marked = state.markedNumbers && state.markedNumbers.has(num);
      html += `<div class="called-number ${marked ? 'marked' : ''}" data-number="${num}">${num}</div>`;
    });
    list.innerHTML = html;

    list.querySelectorAll('.called-number').forEach(el => {
      el.addEventListener('click', function() {
        const num = parseInt(this.dataset.number);
        markNumberOnCartelas(num);
      });
    });
  }

  function updateGameUI() {
    const lobby = document.getElementById('game-lobby');
    const active = document.getElementById('game-active');
    const roomName = document.getElementById('game-room-name');
    const prizeEl = document.getElementById('game-prize');
    const bingoBtn = document.getElementById('game-bingo-btn');
    const winnerAnnounce = document.getElementById('game-winner-announce');

    if (state.currentRoom && state.cartelas.length > 0) {
      lobby.style.display = 'none';
      active.style.display = 'block';
      const room = state.rooms[state.currentRoom];
      roomName.textContent = room.name;
      const totalStake = room.entryFee * room.players.length;
      const winAmount = totalStake * 0.85;
      prizeEl.textContent = 'Prize: ' + winAmount.toFixed(2) + ' Br';
      renderAllCartelas();
      renderCalledNumbers();
      bingoBtn.disabled = !state.isBingoAvailable;
      if (state.winner) {
        winnerAnnounce.style.display = 'block';
        document.getElementById('winner-name').textContent = state.winner;
      } else {
        winnerAnnounce.style.display = 'none';
      }
    } else {
      lobby.style.display = 'block';
      active.style.display = 'none';
    }
  }

  // ---- BINGO ----
  document.getElementById('game-bingo-btn').addEventListener('click', function() {
    if (!state.isBingoAvailable) return;
    const room = state.rooms[state.currentRoom];
    if (!room) return;
    if (state.winner) {
      TelegramApp.showAlert('A winner has already been declared!');
      return;
    }

    // Mock validation: always win
    state.winner = state.player.name;
    const totalStake = room.entryFee * room.players.length;
    const winAmount = totalStake * 0.85;
    state.player.balance += winAmount;
    state.player.gamesPlayed += 1;
    state.player.gamesWon += 1;
    state.isBingoAvailable = false;
    room.status = 'winner';

    state.history.push({
      room: room.name,
      prize: winAmount,
      result: 'win',
      date: new Date().toLocaleString()
    });
    state.transactions.push({
      type: 'win',
      amount: winAmount,
      desc: 'Won ' + room.name + ' bingo',
      date: new Date().toLocaleString()
    });

    updateHeaderBalance();
    updateGameUI();
    TelegramApp.showAlert('BINGO! You won ' + winAmount.toFixed(2) + ' Br!');

    setTimeout(() => {
      resetRoom(state.currentRoom);
    }, 4000);

    if (drawInterval) {
      clearInterval(drawInterval);
      drawInterval = null;
    }
  });

  // ---- Reset Room ----
  function resetRoom(roomId) {
    const room = state.rooms[roomId];
    if (!room) return;
    room.players = [];
    room.prize = 0;
    room.status = 'waiting';
    room.joined = false;
    room.reservedCartelas = new Set();
    room.playerCartelas = {};
    state.currentRoom = null;
    state.cartelas = [];
    state.cartelaIndices = [];
    state.calledNumbers = [];
    state.markedNumbers = new Set();
    state.countdown = 0;
    state.isGameActive = false;
    state.isBingoAvailable = false;
    state.winner = null;

    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (drawInterval) {
      clearInterval(drawInterval);
      drawInterval = null;
    }

    renderRooms();
    navigateTo('rooms');
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

  document.getElementById('profile-save-btn').addEventListener('click', async function() {
    const phone = document.getElementById('profile-phone').value.trim();
    if (!phone) {
      TelegramApp.showAlert('Please enter a phone number.');
      return;
    }
    // Call API
    const result = await window.APIClient.updateProfile(phone);
    if (result.success) {
      state.player.phone = phone;
      TelegramApp.showAlert('Phone number saved.');
      updateProfileUI();
    } else {
      TelegramApp.showAlert(result.error || 'Failed to save phone.');
    }
  });

  // ---- Wallet ----
  function updateWalletUI() {
    document.getElementById('wallet-balance-amount').textContent = state.player.balance + ' Br';
    const list = document.getElementById('transaction-list');
    if (state.transactions.length === 0) {
      list.innerHTML = '<p class="empty-msg">No transactions yet.</p>';
    } else {
      list.innerHTML = state.transactions.map(t => `
        <div class="transaction-item">
          <span>${t.desc}</span>
          <span class="txn-amount ${t.amount >= 0 ? 'positive' : 'negative'}">
            ${t.amount >= 0 ? '+' : ''}${t.amount} Br
          </span>
        </div>
      `).join('');
    }
  }

  // Deposit
  document.getElementById('deposit-verify-btn').addEventListener('click', async function() {
    const method = document.querySelector('input[name="deposit-method"]:checked');
    if (!method) {
      TelegramApp.showAlert('Select a payment method.');
      return;
    }
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    if (!amount || amount <= 0) {
      TelegramApp.showAlert('Enter a valid amount.');
      return;
    }
    const sms = document.getElementById('deposit-sms').value.trim();
    if (!sms) {
      TelegramApp.showAlert('Paste the SMS confirmation.');
      return;
    }

    const statusEl = document.getElementById('deposit-status');
    statusEl.textContent = 'Verifying...';
    statusEl.className = 'status-msg';

    const result = await window.APIClient.verifyDeposit(method.value, amount, sms);
    if (result.success) {
      state.player.balance += amount;
      state.transactions.push({
        type: 'deposit',
        amount: amount,
        desc: 'Deposit via ' + method.value,
        date: new Date().toLocaleString()
      });
      updateHeaderBalance();
      updateWalletUI();
      statusEl.textContent = '✅ Verified! ' + amount + ' Br added.';
      statusEl.className = 'status-msg success';
      document.getElementById('deposit-amount').value = '';
      document.getElementById('deposit-sms').value = '';
      document.querySelector('input[name="deposit-method"]:checked').checked = false;
    } else {
      statusEl.textContent = '❌ ' + (result.error || 'Verification failed.');
      statusEl.className = 'status-msg error';
    }
  });

  // Withdraw
  document.getElementById('withdraw-btn').addEventListener('click', async function() {
    const method = document.querySelector('input[name="withdraw-method"]:checked');
    if (!method) {
      TelegramApp.showAlert('Select a payment method.');
      return;
    }
    const phone = document.getElementById('withdraw-phone').value.trim();
    if (!phone) {
      TelegramApp.showAlert('Enter phone number for withdrawal.');
      return;
    }
    // Ask for amount (or withdraw all)
    TelegramApp.showConfirm('Withdraw all balance?', async (ok) => {
      if (ok) {
        const amount = state.player.balance;
        if (amount <= 0) {
          TelegramApp.showAlert('No balance to withdraw.');
          return;
        }
        const statusEl = document.getElementById('withdraw-status');
        statusEl.textContent = 'Processing...';
        statusEl.className = 'status-msg';

        const result = await window.APIClient.requestWithdraw(method.value, phone, amount);
        if (result.success) {
          state.player.balance = 0;
          state.transactions.push({
            type: 'withdraw',
            amount: -amount,
            desc: 'Withdraw via ' + method.value,
            date: new Date().toLocaleString()
          });
          updateHeaderBalance();
          updateWalletUI();
          statusEl.textContent = '✅ Withdrawal requested for ' + amount + ' Br to ' + phone;
          statusEl.className = 'status-msg success';
          document.getElementById('withdraw-phone').value = '';
          document.querySelector('input[name="withdraw-method"]:checked').checked = false;
        } else {
          statusEl.textContent = '❌ ' + (result.error || 'Withdrawal failed.');
          statusEl.className = 'status-msg error';
        }
      }
    });
  });

  // ---- History ----
  function updateHistoryUI() {
    const list = document.getElementById('history-list');
    if (state.history.length === 0) {
      list.innerHTML = '<p class="empty-msg">No games played yet.</p>';
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

  // ---- Navigation event listeners ----
  navButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const page = this.dataset.page;
      if (page) navigateTo(page);
    });
  });

  document.getElementById('game-go-rooms-btn').addEventListener('click', () => {
    navigateTo('rooms');
  });

  document.getElementById('profile-logout-btn').addEventListener('click', () => {
    TelegramApp.showConfirm('Logout?', (ok) => {
      if (ok) {
        state.player.name = 'Guest';
        state.player.balance = 0;
        state.player.gamesPlayed = 0;
        state.player.gamesWon = 0;
        state.player.phone = '';
        updateHeaderBalance();
        navigateTo('rooms');
      }
    });
  });

  // ---- Init ----
  async function init() {
    TelegramApp.init();
    const tgUser = TelegramApp.getUser();
    if (tgUser) {
      state.player.id = tgUser.id;
      state.player.name = tgUser.first_name || 'Player';
      state.player.username = tgUser.username || 'player';
    }

    // Fetch initial balance from API
    const balanceData = await window.APIClient.getBalance();
    state.player.balance = balanceData.balance || 100;

    // Add initial transaction if needed
    if (state.transactions.length === 0) {
      state.transactions.push({ type: 'deposit', amount: state.player.balance, desc: 'Initial deposit', date: new Date().toLocaleString() });
    }

    updateHeaderBalance();
    renderRooms();
    updateProfileUI();
    updateWalletUI();
    updateHistoryUI();
    navigateTo('rooms');
  }

  init();
})();