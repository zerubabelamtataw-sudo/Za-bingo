/**
 * app.js — Bingo Frontend
 * Communicates with Express backend; NO local cartela generation.
 */

'use strict';
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const API = 'https://za-bingo-5a7e.onrender.com';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  player:           null,        // { id, name, balance, history }
  allCartelas:      [],          // fetched from /api/cartelas
  selectedRoom:     null,        // room id string
  selectedCartelas: [],          // cartelaId strings chosen in lobby
  activeRoomId:     null,        // room we've joined
  myCartelas:       [],          // cartela objects for current game
  calledNumbers:    [],          // current game's called numbers
  markedCells:      {},          // { cartelaId: Set<number|'FREE'> }
  gameStatus:       'waiting',
  pollTimer:        null,
  lastCalledCount:  0,
  bingoDetected:    {},          // { cartelaId: bool }
};

// ── Utils ──────────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function letterFor(n) {
  if (n <= 15) return 'B';
  if (n <= 30) return 'I';
  if (n <= 45) return 'N';
  if (n <= 60) return 'G';
  return 'O';
}

function uid() {
  return 'player_' + Math.random().toString(36).slice(2, 10);
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
  $('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'API error');
  return data;
}

// ── Persistence ───────────────────────────────────────────────────────────────
function saveLocal(key, val) {
  try { localStorage.setItem(`bingo_${key}`, JSON.stringify(val)); } catch {}
}
function loadLocal(key) {
  try { return JSON.parse(localStorage.getItem(`bingo_${key}`)); } catch { return null; }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  $(`page-${name}`).classList.add('active');
  $(`page-${name}`).style.display = 'block';
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.page === name);
  });
    if (name === 'profile') renderProfile();
  if (name === 'history') renderHistory();
  if (name === 'lobby')   refreshRooms();
  if (name === 'game')    renderMyCartelas();
}

// ── Setup ─────────────────────────────────────────────────────────────────────


async function initApp() {
  updateHUD();
  $('navTabs').style.display = 'flex';
  $('playerHud').style.display = 'flex';
  await loadCartelas();
  showPage('lobby');
  startLobbyPoll();
}

function updateHUD() {
  if (!state.player) return;
  $('hudName').textContent = state.player.name;
  $('hudBalance').textContent = `${state.player.balance} Br`;
}

// ── Cartelas (fetched once) ───────────────────────────────────────────────────
async function loadCartelas() {
  try {
    const data = await apiFetch('/api/cartelas');
    state.allCartelas = data.cartelas;
    renderCartelaGrid();
  } catch (e) { toast('Failed to load cartelas: ' + e.message, 'error'); }
}

function renderCartelaGrid(reservedIds = []) {
  const reserved = new Set(reservedIds);
  const grid     = $('cartelaGrid');
  grid.innerHTML  = '';
  for (const c of state.allCartelas) {
    const el = document.createElement('div');
    el.className = 'cartela-item';
    el.textContent = c.number;
    el.dataset.id  = c.id;
    if (reserved.has(c.id)) el.classList.add('reserved');
    if (state.selectedCartelas.includes(c.id)) el.classList.add('selected');
    el.addEventListener('click', () => toggleCartela(c.id, el));
    grid.appendChild(el);
  }
}

function toggleCartela(id, el) {
  if (el.classList.contains('reserved')) return;
  const idx = state.selectedCartelas.indexOf(id);
  if (idx === -1) {
    if (state.selectedCartelas.length >= 4) {
      toast('Max 4 cartelas per game', 'error'); return;
    }
    state.selectedCartelas.push(id);
    el.classList.add('selected');
  } else {
    state.selectedCartelas.splice(idx, 1);
    el.classList.remove('selected');
  }
  $('selectedCount').textContent = `${state.selectedCartelas.length} cartela${state.selectedCartelas.length !== 1 ? 's' : ''} selected`;
  $('joinBtn').disabled = state.selectedCartelas.length === 0 || !state.selectedRoom;
}

// ── Rooms ─────────────────────────────────────────────────────────────────────
let lobbyPollInterval = null;

function startLobbyPoll() {
  refreshRooms();
  lobbyPollInterval = setInterval(refreshRooms, 3000);
}

async function refreshRooms() {
  try {
    const data = await apiFetch('/api/rooms');
    renderRoomCards(data.rooms);
    // Update reserved cartelas for selected room
    if (state.selectedRoom) {
  const room = data.rooms.find(r => r.id === state.selectedRoom);

  if (room) {
    const reserved = (room.players || [])
      .flatMap(p => p.cartelaIds || [])
      .map(String);

    renderCartelaGrid(reserved);
  }
}
  } catch {}
}

function renderRoomCards(rooms) {
  const container = $('roomCards');
  container.innerHTML = '';
  for (const room of rooms) {
    const el = document.createElement('div');
    el.className = `room-card room-${room.entryFee}${state.selectedRoom === room.id ? ' selected' : ''}`;
    el.dataset.id = room.id;

    const statusClass = `status-${room.status}`;
    let statusText = {
  waiting: 'Waiting',
  countdown: 'Starting…',
  playing: 'Playing',
  winner: 'Finished'
}[room.status] || room.status;


    el.innerHTML = `
      <div class="room-card-header">
        <div class="room-card-name">${room.name}</div>
        <div class="room-fee">${room.entryFee} Br</div>
      </div>
      <div class="room-meta">
        <span>👥 ${room.playerCount} players</span>
        <span>💰 Pot: ${room.pot} Br</span>
        <span class="room-status-badge ${statusClass}">${statusText}</span>
      </div>p
    `;
    if (room.status === 'playing' || room.status === 'winner') {
  el.classList.add('locked');

  el.addEventListener('click', () => {
    toast('This room is currently locked. Please choose another room.', 'error');
  });
} else {
  el.addEventListener('click', () => selectRoom(room, el));
}
    container.appendChild(el);
  }
}

setInterval(() => {
  if (document.getElementById('page-lobby')?.classList.contains('active')) {
    refreshRooms();
  }
}, 1000);
function selectRoom(room, el) {
  state.selectedRoom = room.id;

  // Highlight selected room
  document.querySelectorAll('.room-card')
    .forEach(c => c.classList.remove('selected'));

  el.classList.add('selected');

  // Hide Rooms
  $('page-lobby').style.display = 'none';
  $('page-lobby').classList.remove('active');

  // Show Cartelas
  $('page-cartelas').style.display = 'block';
  $('page-cartelas').classList.add('active');

  // Reset cartela selection
  state.selectedCartelas = [];
  renderCartelaGrid();

  $('selectedCount').textContent = '0 cartelas selected';
  $('joinBtn').disabled = true;
}

// ── Join ──────────────────────────────────────────────────────────────────────
$('joinBtn').addEventListener('click', async () => {
  if (!state.selectedRoom) { toast('Select a room', 'error'); return; }
  if (state.selectedCartelas.length === 0) { toast('Select at least 1 cartela', 'error'); return; }

  const btn = $('joinBtn');
  btn.disabled = true;
  btn.textContent = 'Joining…';

  try {
    const data = await apiFetch(`/api/rooms/${state.selectedRoom}/join`, {
      method: 'POST',
      body: JSON.stringify({
        playerId:   state.player.id,
        cartelaIds: state.selectedCartelas,
      }),
    });

    // Deduct balance locally (backend already did it)
    const fee = data.room.entryFee * state.selectedCartelas.length;
    state.player.balance -= fee;
    updateHUD();

    state.activeRoomId = state.selectedRoom;

applyGameState(data.room);

state.myCartelas = state.allCartelas.filter(
  c => state.selectedCartelas.includes(c.id)
);
    state.markedCells  = {};
    state.bingoDetected= {};
    for (const c of state.myCartelas) {
      state.markedCells[c.id] = new Set(['FREE']);
    }

    toast(`Joined ${data.room.name}! Good luck 🍀`, 'success');
    if (lobbyPollInterval) clearInterval(lobbyPollInterval);
    buildCalledGrid();
    renderMyCartelas();
    showPage('game');
    startGamePoll();
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Join Room →';
  }
});

// ── Called-numbers grid (BINGO rows) ─────────────────────────────────────────
function buildCalledGrid() {
  const grid = $('calledGrid');
  grid.innerHTML = '';

  const letters = [
    { letter: 'B', start: 1,  end: 15 },
    { letter: 'I', start: 16, end: 30 },
    { letter: 'N', start: 31, end: 45 },
    { letter: 'G', start: 46, end: 60 },
    { letter: 'O', start: 61, end: 75 }
  ];

  for (const group of letters) {
    const row = document.createElement('div');
    row.className = 'called-row';

    const letter = document.createElement('div');
    letter.className = `called-row-letter ${group.letter}`;
    letter.textContent = group.letter;
    row.appendChild(letter);

    for (let n = group.start; n <= group.end; n++) {
      const el = document.createElement('div');
      el.className = 'cn-cell';
      el.id = `cn-${n}`;
      el.textContent = n;
      row.appendChild(el);
    }

    grid.appendChild(row);
  }
}

function updateCalledGrid(calledNumbers) {
  const prev = state.lastCalledCount;
  for (const n of calledNumbers) {
    const el = $(`cn-${n}`);
    if (el && !el.classList.contains('called')) {
      el.classList.add('called', letterFor(n));
    }
  }

  if (calledNumbers.length > prev) {
    const latest = calledNumbers[calledNumbers.length - 1];
    $('lastCalledWrap').style.display = 'block';
    const numEl = $('lastCalledNum');
    numEl.textContent  = `${letterFor(latest)} ${latest}`;
    numEl.style.color  = `var(--${letterFor(latest)})`;
    numEl.style.animation = 'none';
    numEl.offsetHeight;
    numEl.style.animation = '';
    state.lastCalledCount = calledNumbers.length;

    // Auto-mark cartela cells
    autoMarkCartelas(calledNumbers);
  }
}

// ── My Cartelas ───────────────────────────────────────────────────────────────
function renderMyCartelas() {
  const container = $('myCartelas');
  if (!state.myCartelas.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">🎴</div><div>Join a room to see your cartelas</div></div>';
    return;
  }
  container.innerHTML = '';
  for (const cartela of state.myCartelas) {
    container.appendChild(buildCartelaCard(cartela));
  }
}

const LETTERS = ['B', 'I', 'N', 'G', 'O'];

function buildCartelaCard(cartela) {
  const card = document.createElement('div');
  card.className = 'cartela-card';
  card.id = `card-${cartela.id}`;

  card.innerHTML = `
    <div class="cartela-card-header">
      <div class="cartela-card-title">Cartela #${cartela.number}</div>
      <span id="bingo-indicator-${cartela.id}" style="display:none;color:var(--gold);font-weight:700;font-size:.85rem">★ BINGO!</span>
    </div>
    <div class="bingo-grid" id="grid-${cartela.id}"></div>
    <button class="claim-bingo-btn" id="claimBtn-${cartela.id}" onclick="claimBingo('${cartela.id}')">
      🎉 CLAIM BINGO!
    </button>
  `;

  const gridEl = card.querySelector(`#grid-${cartela.id}`);

  // Header row
  for (const letter of LETTERS) {
    const h = document.createElement('div');
    h.className = `bingo-header-cell letter-${letter}`;
    h.textContent = letter;
    gridEl.appendChild(h);
  }

  // Number cells (row-major: cartela.grid = [[row0], [row1], …])
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const val = cartela.grid[r][c];
      const cell = document.createElement('div');
      cell.className = 'bingo-cell';
      cell.dataset.val = val;
      cell.dataset.row = r;
      cell.dataset.col = c;

      if (val === 'FREE') {
        cell.classList.add('free', 'marked');
        cell.textContent = 'FREE';
      } else {
        cell.textContent = val;
        cell.addEventListener('click', () => toggleCell(cartela.id, cell, val));
      }
      gridEl.appendChild(cell);
    }
  }

  return card;
}

function toggleCell(cartelaId, cell, val) {
  if (state.gameStatus !== 'playing') return;
  const called = new Set(state.calledNumbers);
  if (!called.has(Number(val))) {
    toast(`${val} hasn't been called yet`, 'error'); return;
  }
  const marked = state.markedCells[cartelaId];
  if (marked.has(val)) {
    marked.delete(val);
    cell.classList.remove('marked', 'auto-marked');
  } else {
    marked.add(val);
    cell.classList.add('marked');
  }
  checkBingoLocal(cartelaId);
}

function autoMarkCartelas(calledNumbers) {
  const called = new Set(calledNumbers);
  for (const cartela of state.myCartelas) {
    const marked = state.markedCells[cartela.id];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const val = cartela.grid[r][c];
        if (val === 'FREE') continue;
        if (called.has(val) && !marked.has(val)) {
          marked.add(val);
          const gridEl = document.querySelector(`#grid-${cartela.id}`);
          if (gridEl) {
            const cells = gridEl.querySelectorAll('.bingo-cell');
            // cells index: 5 header + r*5 + c (0-indexed in grid, but header is also in DOM via flex)
            // We stored row/col in dataset:
            cells.forEach(cell => {
              if (Number(cell.dataset.row) === r && Number(cell.dataset.col) === c) {
                cell.classList.add('auto-marked');
              }
            });
          }
        }
      }
    }
    checkBingoLocal(cartela.id);
  }
}

// ── Local BINGO check ─────────────────────────────────────────────────────────
function checkBingoLocal(cartelaId) {
  const cartela = state.myCartelas.find(c => c.id === cartelaId);
  if (!cartela) return;
  const marked = state.markedCells[cartelaId];

  const isMarked = (r, c) => {
    const v = cartela.grid[r][c];
    return v === 'FREE' || marked.has(v);
  };

  let bingo = false;
  for (let i = 0; i < 5; i++) {
    if ([0,1,2,3,4].every(j => isMarked(i, j))) { bingo = true; break; }
    if ([0,1,2,3,4].every(j => isMarked(j, i))) { bingo = true; break; }
  }
  if (!bingo && [0,1,2,3,4].every(i => isMarked(i, i))) bingo = true;
  if (!bingo && [0,1,2,3,4].every(i => isMarked(i, 4-i))) bingo = true;
  if (!bingo && isMarked(0,0) && isMarked(0,4) && isMarked(4,0) && isMarked(4,4)) bingo = true;

  const claimBtn = $(`claimBtn-${cartelaId}`);
  const indicator = $(`bingo-indicator-${cartelaId}`);
  if (bingo && !state.bingoDetected[cartelaId] && state.gameStatus === 'playing') {
    state.bingoDetected[cartelaId] = true;
    if (claimBtn) claimBtn.classList.add('visible');
    if (indicator) indicator.style.display = 'inline';
    // Highlight winning cells
    highlightBingoCells(cartela, isMarked);
    toast('🎉 BINGO detected! Click to claim!', 'success');
  } else if (!bingo) {
    state.bingoDetected[cartelaId] = false;
    if (claimBtn) claimBtn.classList.remove('visible');
    if (indicator) indicator.style.display = 'none';
  }
}

function highlightBingoCells(cartela, isMarked) {
  const gridEl = document.querySelector(`#grid-${cartela.id}`);
  if (!gridEl) return;
  // rows
  for (let r = 0; r < 5; r++) {
    if ([0,1,2,3,4].every(c => isMarked(r, c))) {
      gridEl.querySelectorAll('.bingo-cell').forEach(cell => {
        if (Number(cell.dataset.row) === r) cell.classList.add('bingo-hit');
      });
    }
  }
  // cols
  for (let c = 0; c < 5; c++) {
    if ([0,1,2,3,4].every(r => isMarked(r, c))) {
      gridEl.querySelectorAll('.bingo-cell').forEach(cell => {
        if (Number(cell.dataset.col) === c) cell.classList.add('bingo-hit');
      });
    }
  }
  // diag
  if ([0,1,2,3,4].every(i => isMarked(i, i))) {
    gridEl.querySelectorAll('.bingo-cell').forEach(cell => {
      if (cell.dataset.row === cell.dataset.col) cell.classList.add('bingo-hit');
    });
  }
  if ([0,1,2,3,4].every(i => isMarked(i, 4-i))) {
    gridEl.querySelectorAll('.bingo-cell').forEach(cell => {
      const r = Number(cell.dataset.row), c = Number(cell.dataset.col);
      if (r + c === 4) cell.classList.add('bingo-hit');
    });
  }
}

// ── Claim BINGO (server) ──────────────────────────────────────────────────────
async function claimBingo(cartelaId) {
  if (!state.activeRoomId) return;
  const btn = $(`claimBtn-${cartelaId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }

  try {
    const data = await apiFetch(`/api/rooms/${state.activeRoomId}/bingo`, {
      method: 'POST',
      body: JSON.stringify({ playerId: state.player.id, cartelaId }),
    });
    // Winner! The poll will pick it up, but show immediately
    handleWinner(data.winner);
  } catch (e) {
    toast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🎉 CLAIM BINGO!'; }
  }
}
window.claimBingo = claimBingo;

// ── Game Polling ──────────────────────────────────────────────────────────────
function startGamePoll() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(pollGame, 1000);
}

async function pollGame() {
  if (!state.activeRoomId) return;
  try {
    const data = await apiFetch(`/api/game/${state.activeRoomId}`);
    const game = data.game;
    applyGameState(game);
  } catch {}
}

function applyGameState(game) {
  state.gameStatus  = game.status;
  state.calledNumbers = game.calledNumbers || [];
  
  // ── 25 SECOND POPUP COUNTDOWN ───────────────────────────────
const countdownOverlay = $('countdownOverlay');
const popupCountdown = $('popupCountdown');
const popupPlayerCount = $('popupPlayerCount');
const popupPrize = $('popupPrize');
const cancelCountdownBtn = $('cancelCountdownBtn');
if (
(game.status === 'waiting' && game.playerCount === 1) ||
(game.status === 'countdown' && game.countdownStart)
) {

const COUNTDOWN_SECONDS = 25;

let remaining = 25;

if (game.status === 'countdown' && game.countdownStart) {
const elapsed = (Date.now() - game.countdownStart) / 1000;
remaining = Math.max(
0,
COUNTDOWN_SECONDS - elapsed
);
}

if (countdownOverlay) {
countdownOverlay.classList.add('visible');
}

if (popupCountdown) {
popupCountdown.textContent = Math.ceil(remaining);
}

// Live player count
if (popupPlayerCount) {
popupPlayerCount.textContent = game.playerCount || 0;
}
console.log("GAME DATA:", game);
// Live prize
if (popupPrize) {
popupPrize.textContent = game.pot || 0;
}

} else {

if (countdownOverlay) {
countdownOverlay.classList.remove('visible');
}

}

if (cancelCountdownBtn) {
  cancelCountdownBtn.onclick = async () => {
    try {
      cancelCountdownBtn.disabled = true;

      const response = await fetch(
  `${API}/api/rooms/${state.activeRoomId}/cancel-countdown`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            playerId: state.player.id
          })
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to cancel countdown');
      }
      state.activeRoomId = null;
state.selectedRoom = null;
state.selectedCartelas = [];

await loadPlayer();
showPage('lobby');
refreshRooms();

      countdownOverlay.classList.remove('visible');

state.activeRoomId = null;
state.selectedRoom = null;
state.selectedCartelas = [];
state.myCartelas = [];

clearInterval(state.pollTimer);

await refreshPlayer();

showPage('lobby');
startLobbyPoll();
renderCartelaGrid();

cancelCountdownBtn.disabled = false;

    } catch (error) {
      console.error('Cancel countdown error:', error);
      cancelCountdownBtn.disabled = false;
    }
  };
}

  // Status bar
  $('infoRoomName').textContent = game.name;
  $('infoStatus').textContent = {
    waiting: 'Waiting', countdown: 'Starting…', playing: 'Playing', winner: 'Winner!'
  }[game.status] || game.status;
  $('infoPot').textContent = `${game.pot} Br`;
  $('infoPlayers').textContent = game.playerCount;
  $('infoCalled').textContent = `${game.calledNumbers.length}/75`;

  // Player chips
  const list = $('gamePlayersList');
  list.innerHTML = '';
  for (const p of (game.players || [])) {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    chip.textContent = p.id === state.player.id ? `★ ${p.name}` : p.name;
    list.appendChild(chip);
  }


  // Called numbers grid
  updateCalledGrid(game.calledNumbers);

  // Winner state
  if (game.status === 'winner' && game.winner) {
    clearInterval(state.pollTimer);
    handleWinner(game.winner);
  }
}

function handleWinner(winner) {
  if (!winner) return;
  const isMe = winner.playerId === state.player?.id;

  $('popupWinnerName').textContent = winner.playerName;
  $('popupCartelaDetail').textContent =
    `Cartela #${winner.cartelaNumber} · ${winner.calledCount} numbers called`;
  $('popupAmount').textContent =
    isMe
      ? `+${winner.amount} Br 🎉`
      : `${winner.playerName} won ${winner.amount} Br`;

  $('popupAmount').style.color =
    isMe ? 'var(--green)' : 'var(--muted)';

  $('winnerOverlay').classList.add('visible');

  // Return to Rooms after 2 seconds
  setTimeout(() => {
    $('winnerOverlay').classList.remove('visible');

    // Reset game state
    state.activeRoomId     = null;
    state.myCartelas       = [];
    state.calledNumbers    = [];
    state.markedCells      = {};
    state.bingoDetected    = {};
    state.selectedCartelas = [];
    state.selectedRoom     = null;
    state.lastCalledCount  = 0;

    clearInterval(state.pollTimer);

    // Refresh player balance from server
    refreshPlayer();

    // Return to Rooms
    showPage('lobby');
    startLobbyPoll();
    renderCartelaGrid();

  }, 2000);

  if (isMe) {
    state.player.balance += winner.amount;
    updateHUD();
    toast(`You won ${winner.amount} Br! 🏆`, 'success');
  }
}

async function refreshPlayer() {
  try {
    const data = await apiFetch(`/api/player/${state.player.id}`);
    state.player = data.player;
    updateHUD();
  } catch {}
}

// ── Profile ───────────────────────────────────────────────────────────────────
function renderProfile() {
  if (!state.player) return;

  const player = state.player;

  // Profile header
  const playerName = player.first_name || 'Player';

  $('profileAvatar').textContent =
    playerName[0]?.toUpperCase() || '😀';

  $('profileName').textContent =
    playerName;

  $('profileBalance').textContent =
    `${player.balance ?? 0} Br`;

  // Player information
  $('playerName').textContent =
    player.first_name || 'N/A';

  $('playerId').textContent =
    player.telegram_id || 'N/A';

  $('playerPhone').textContent =
    player.phone || 'N/A';

  $('playerUsername').textContent =
    player.username ? `@${String(player.username).replace(/^@/, '')}` : 'N/A';

  $('playerBalance').textContent =
    `${player.balance ?? 0} Br`;

  $('gamesPlayed').textContent =
    player.gamesPlayed ?? 0;

  $('gamesWon').textContent =
    player.gamesWon ?? 0;

  // History
  const history = player.history || [];
  const tbody = $('historyBody');

  if (!history.length) {
    tbody.innerHTML =
      '<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--muted)">No history yet</td></tr>';
    return;
  }

  tbody.innerHTML = '';

  for (const entry of [...history].reverse()) {
    const tr = document.createElement('tr');

    const isWin = Number(entry.amount) > 0;

    const date = entry.date
      ? new Date(entry.date).toLocaleDateString('en-ET', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—';

    tr.innerHTML = `
      <td>${entry.type === 'win' ? '🏆 Win' : '🎮 Join'}</td>
      <td>${entry.roomId || '—'}</td>
      <td class="${isWin ? 'amount-win' : 'amount-loss'}">
        ${isWin ? '+' : ''}${entry.amount ?? 0} Br
      </td>
      <td style="color:var(--muted);font-size:.8rem">${date}</td>
    `;

    tbody.appendChild(tr);
  }
}

function renderHistory() {
  if (!state.player) return;

  const history = state.player.history || [];
  const tbody = $('historyPageBody');

  if (!history.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center;padding:32px;color:var(--muted)">
          No history yet
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';

  for (const entry of [...history].reverse()) {
    const tr = document.createElement('tr');
    const isWin = entry.amount > 0;

    const date = new Date(entry.date).toLocaleDateString('en-ET', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    tr.innerHTML = `
      <td>${entry.type === 'win' ? 'Win' : 'Join'}</td>
      <td>${entry.roomId || '—'}</td>
      <td class="${isWin ? 'amount-win' : 'amount-loss'}">
        ${isWin ? '+' : ''}${entry.amount} Br
      </td>
      <td style="color:var(--muted);font-size:.8rem">${date}</td>
    `;

    tbody.appendChild(tr);
  }
}

// ── Nav ────────────────────────────────────────────────────────────────────────
$('backToRoomsBtn').addEventListener('click', () => {
  $('page-cartelas').classList.remove('active');
  $('page-cartelas').style.display = 'none';

  $('page-lobby').classList.add('active');

  state.selectedRoom = null;
  state.selectedCartelas = [];

  renderCartelaGrid();

  $('selectedCount').textContent = '0 cartelas selected';
  $('joinBtn').disabled = true;
});
document.querySelectorAll('.nav-tab').forEach(tab => {
  
  tab.addEventListener('click', () => showPage(tab.dataset.page));
});

// ── Auto-restore Telegram session ─────────────────────────────────────────────
(async () => {
  const telegramUser = tg?.initDataUnsafe?.user;

  if (!telegramUser) {
    toast('Please open the game through Telegram', 'error');
    return;
  }

  const playerId = String(telegramUser.id);
  const playerName =
    telegramUser.first_name ||
    telegramUser.username ||
    'Player';

  try {
    const data = await apiFetch('/api/player', {
      method: 'POST',
      body: JSON.stringify({
        playerId,
        name: playerName
      }),
    });

    state.player = data.player;
    initApp();
  } catch (e) {
    toast('Could not load your Telegram account: ' + e.message, 'error');
  }
})();