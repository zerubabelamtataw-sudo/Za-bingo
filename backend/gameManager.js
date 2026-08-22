'use strict';

/**
 * gamesManager.js
 * Manages all 3 Bingo room states: waiting → countdown → playing → winner
 */

const ROOMS_CONFIG = [
  { id: '5br',  name: '5 Br Room',  entryFee: 5  },
  { id: '10br', name: '10 Br Room', entryFee: 10 },
  { id: '20br', name: '20 Br Room', entryFee: 20 },
];

const COUNTDOWN_SECONDS = 30;
const DRAW_INTERVAL_MS  = 4000;
const WINNER_SHARE      = 0.85;

const SIMULATED_PLAYERS = [
  '@fano',
  '🤘',
  'ማሜ',
  'neqelu',
  'Rasta',
  'Mimi',
  'Mati',
  'ኢብሮ',
  'ትራምፕ',
  'lala',
  'Tare',
  'በሌ',
  'yoni',
  'Maje',
  'Yaaa',
  'Debela',
  'Taye',
  'Ggz',
  'Dave',
  'መካሽ',
  'cr7',
  'Dangote',
  '@mente',
  'Messi',
  'Runner',
  'Here we go',
  'deme',
  '@fifi',
  'Adu',
  'ደላላው'
];

// ── helpers ──────────────────────────────────────────────────────────────────

function generateCartela() {
  const cols = [
    { letter: 'B', min: 1,  max: 15 },
    { letter: 'I', min: 16, max: 30 },
    { letter: 'N', min: 31, max: 45 },
    { letter: 'G', min: 46, max: 60 },
    { letter: 'O', min: 61, max: 75 },
  ];

  const grid = [];
  for (let col = 0; col < 5; col++) {
    const { min, max } = cols[col];
    const pool = [];
    for (let n = min; n <= max; n++) pool.push(n);
    pool.sort(() => Math.random() - 0.5);
    grid.push(pool.slice(0, 5));
  }

  // Transpose to row-major [[row0], [row1], …] then set FREE center
  const rows = [];
  for (let r = 0; r < 5; r++) {
    rows.push([grid[0][r], grid[1][r], grid[2][r], grid[3][r], grid[4][r]]);
  }
  rows[2][2] = 'FREE';
  return rows;
}

function checkBingo(cartela, calledNumbers) {
  const called = new Set(calledNumbers);

  const marked = (r, c) => {
    const v = cartela[r][c];
    return v === 'FREE' || called.has(v);
  };

  // rows
  for (let r = 0; r < 5; r++) {
    if ([0,1,2,3,4].every(c => marked(r, c))) return true;
  }
  // columns
  for (let c = 0; c < 5; c++) {
    if ([0,1,2,3,4].every(r => marked(r, c))) return true;
  }
  // diagonals
  if ([0,1,2,3,4].every(i => marked(i, i))) return true;
  if ([0,1,2,3,4].every(i => marked(i, 4-i))) return true;
  // 4 corners
  if (marked(0,0) && marked(0,4) && marked(4,0) && marked(4,4)) return true;

  return false;
}

// ── Room class ────────────────────────────────────────────────────────────────

class Room {
  constructor(config) {
    this.id       = config.id;
    this.name     = config.name;
    this.entryFee = config.entryFee;
    this.reset();
  }

reset() {
  this.status           = 'waiting';   // waiting | countdown | playing | winner
  this.players          = [];           // [{ id, name, balance }]
  this.playerCartelas   = {};           // { playerId: [cartelaObj, …] }
  this.burnedCartelas   = new Set();    // cartelas burned by invalid BINGO
  this.reservedCartelas = new Set();    // cartelaIds reserved for this room
  this.calledNumbers    = [];
  this.pot              = 0;
  this.winner           = null;         // { playerId, playerName, cartelaId, amount }
  this.countdownStart   = null;
  this._countdownTimer  = null;
  this._drawTimer       = null;
  this._gameStartTime   = null;
}

// Public snapshot for API
toJSON() {
  return {
    id: this.id,
    name: this.name,
    entryFee: this.entryFee,
    status: this.status,
    playerCount: this.players.length,
    players: this.players.map(p => ({
  id: p.id,
  name: p.name,
  cartelaIds: (this.playerCartelas[p.id] || []).map(c => c.id)
})),
    calledNumbers: this.calledNumbers,
    pot: this.pot,
    winner: this.winner,
    countdownStart: this.countdownStart,
    countdownSeconds: COUNTDOWN_SECONDS,
  };
}
}
// ── GamesManager ─────────────────────────────────────────────────────────────

class GamesManager {
  constructor(db) {
    this.db = db;   // Firebase Realtime Database instance
    this.rooms = {};
    this._cartelaCache = null;
    this.simPlayerSettings = {
  '5br': 10,
  '10br': 3,
  '20br': 1
};

    for (const cfg of ROOMS_CONFIG) {
      this.rooms[cfg.id] = new Room(cfg);
    }
  }

  // ── cartelas ──────────────────────────────────────────────────────────────

  async getCartelas() {
  if (this._cartelaCache) return this._cartelaCache;

  if (!this.db) {
    throw new Error('Firebase Realtime Database is not connected');
  }

  const snap = await this.db.ref('rooms/10br/cartelas').once('value');
  const data = snap.val();

  if (!data) {
    throw new Error('No cartelas found in Firebase Realtime Database');
  }

  this._cartelaCache = Object.entries(data).map(([id, value]) => {
    const numbers = value.numbers;

    const grid = [];

    for (let r = 0; r < 5; r++) {
      grid.push([
        numbers.B[r],
        numbers.I[r],
        numbers.N[r] === 0 ? 'FREE' : numbers.N[r],
        numbers.G[r],
        numbers.O[r]
      ]);
    }

    return {
      id: String(id),
      number: Number(id),
      grid
    };
  });

  return this._cartelaCache;
}

  // ── player ────────────────────────────────────────────────────────────────

  async getOrCreatePlayer(playerId, name, username = '') {
    if (this.db) {
      const ref = this.db.ref(`players/${playerId}`);
const snap = await ref.once('value');

if (snap.exists()) {
  return { id: playerId, ...snap.val() };
}

const player = {
  name,
  username: '',
  balance: 100,
  history: []
};

await ref.set(player);

return { id: playerId, ...player };
    }
    // memory fallback
    if (!this._players) this._players = {};
    if (!this._players[playerId]) {
      this._players[playerId] = { id: playerId, name, balance: 100, history: [] };
    }
    return this._players[playerId];
  }

  async updatePlayerBalance(playerId, delta, historyEntry) {

  // ─────────────────────────────────────────────
  // SIMULATED PLAYER
  // ─────────────────────────────────────────────
  if (String(playerId).startsWith('sim_')) {

    // Find the simulated player in any active room
    for (const room of Object.values(this.rooms)) {

      const simPlayer = room.players.find(
        p => String(p.id) === String(playerId)
      );

      if (simPlayer) {

        simPlayer.balance =
          Number(simPlayer.balance || 0) + Number(delta || 0);

        // ONLY wins are counted.
        // Simulated games are NOT counted as gamesPlayed.
        if (historyEntry?.type === 'win') {
  simPlayer.gamesWon =
    Number(simPlayer.gamesWon || 0) + 1;

  simPlayer.tournamentWins =
    Math.floor(simPlayer.gamesWon / 3);
}

        return {
          id: playerId,
          ...simPlayer
        };
      }
    }

    throw new Error(`Simulated player ${playerId} not found`);
  }

  // ─────────────────────────────────────────────
  // REAL PLAYER
  // ─────────────────────────────────────────────
  if (this.db) {

    const ref = this.db.ref(`players/${playerId}`);
    const snap = await ref.once('value');

    if (!snap.exists()) {
      throw new Error(`Player ${playerId} not found`);
    }

    const data = snap.val();

    const balance =
      Number(data.balance || 0) + Number(delta || 0);

    const history =
      [...(data.history || []), historyEntry];

    const updates = {
      balance,
      history
    };

    // ONLY increment gamesWon when the transaction is a win.
    // Do NOT increment gamesPlayed here.
    if (historyEntry?.type === 'win') {
      updates.gamesWon =
        Number(data.gamesWon || 0) + 1;
    }

    await ref.update(updates);

    return {
      id: playerId,
      ...data,
      ...updates
    };
  }

  // ─────────────────────────────────────────────
  // MEMORY FALLBACK
  // ─────────────────────────────────────────────
  if (this._players && this._players[playerId]) {

    const p = this._players[playerId];

    p.balance =
      Number(p.balance || 0) + Number(delta || 0);

    p.history.push(historyEntry);

    if (historyEntry?.type === 'win') {
      p.gamesWon =
        Number(p.gamesWon || 0) + 1;
    }

    return p;
  }

  throw new Error(`Player ${playerId} not found`);
}
  // ── join ──────────────────────────────────────────────────────────────────

  async joinRoom(roomId, player, cartelaIds) {
    const room = this.rooms[roomId];
    if (!room) throw new Error('Room not found');
    if (room.status !== 'waiting' && room.status !== 'countdown') {
      throw new Error('Room is not accepting players right now');
    }
    if (room.players.find(p => p.id === player.id)) {
      throw new Error('Already in this room');
    }
    if (cartelaIds.length === 0 || cartelaIds.length > 4) {
      throw new Error('Select 1–4 cartelas');
    }

    // Reserve cartelas
    const cartelas = await this.getCartelas();
    const selected = [];
    for (const cid of cartelaIds) {
      if (room.reservedCartelas.has(cid)) throw new Error(`Cartela ${cid} already taken`);
      const c = cartelas.find(x => x.id === cid);
      if (!c) throw new Error(`Cartela ${cid} not found`);
      selected.push(c);
    }
    for (const c of selected) room.reservedCartelas.add(c.id);

    // Deduct fee (per cartela)
    const totalFee = room.entryFee * cartelaIds.length;
    if (player.balance < totalFee) throw new Error('Insufficient balance');

    await this.updatePlayerBalance(player.id, -totalFee, {
      type: 'join', roomId, amount: -totalFee, date: new Date().toISOString(),
    });

    room.players.push({
  id: String(player.id),
  name: player.name || `Player ${player.id}`,
  username: player.username || '',
  balance: player.balance - totalFee
});
    room.playerCartelas[player.id] = selected;
    room.pot += totalFee;

    // Start the 25-second countdown when the second player joins
if (room.players.length === 2 && room.status === 'waiting') {
  this._startCountdown(room);
}

return room.toJSON();
  }

async addSimulatedPlayers(roomId = '5br') {
  const room = this.rooms[roomId];
  if (!room) throw new Error('Room not found');

  if (room.status !== 'waiting') return;

  const cartelas = await this.getCartelas();

  // ─────────────────────────────────────────────
  // RANDOM NUMBER OF SIMULATED PLAYERS: 10–15
  // ─────────────────────────────────────────────
  const baseCount = {
  '5br': this.simPlayerSettings?.['5br'] ?? 10,
  '10br': this.simPlayerSettings?.['10br'] ?? 3,
  '20br': this.simPlayerSettings?.['20br'] ?? 1
}[roomId] || 0;

const minSimPlayers = Math.max(0, baseCount - 1);
const maxSimPlayers = baseCount + 2;

const playerCount =
  minSimPlayers +
  Math.floor(Math.random() * (maxSimPlayers - minSimPlayers + 1));

  // Randomly choose which simulated players participate
  const players = [...SIMULATED_PLAYERS];

  players.sort(() => Math.random() - 0.5);

  const selectedPlayers = players.slice(0, playerCount);

  // ─────────────────────────────────────────────
  // RANDOM CARTELAS: 2–4 PER PLAYER
  // ─────────────────────────────────────────────
  for (let i = 0; i < selectedPlayers.length; i++) {

    // Random arrival delay: 0.5–1.5 seconds
    const delay = 500 + Math.floor(Math.random() * 1000);

    await new Promise(resolve => setTimeout(resolve, delay));

    // Stop if game has already started
    if (room.status === 'playing' || room.status === 'winner') {
      break;
    }

    const name = selectedPlayers[i];
    const originalIndex = SIMULATED_PLAYERS.indexOf(name);
    const playerId = `sim_${originalIndex + 1}`;

    // Prevent duplicate player
    if (room.players.some(p => p.id === playerId)) {
      continue;
    }

    // Each simulated player gets 2–4 cartelas
    const count = 2 + Math.floor(Math.random() * 3);

    // Get cartelas that are not already reserved
    const available = cartelas.filter(
      c => !room.reservedCartelas.has(c.id)
    );

    // Shuffle ALL available cartelas
    available.sort(() => Math.random() - 0.5);

    // Pick random cartelas from #1–#150
    const selected = available.slice(0, count);

    if (selected.length < count) {
      console.error(
        `❌ Not enough cartelas for ${name}`
      );
      break;
    }

    // Reserve selected cartelas
    selected.forEach(c => {
      room.reservedCartelas.add(c.id);
    });

    // Add simulated player
    room.players.push({
  id: playerId,
  name,
  username: '',
  balance: 999999,
  gamesWon: 0
});

    room.playerCartelas[playerId] = selected;

    // Add their cartela fees to pot
    room.pot += room.entryFee * count;

    console.log(
      `🤖 ${name} joined ${room.id} with ${count} cartelas:`,
      selected.map(c => `#${c.number}`).join(', ')
    );

    // Start 25-second countdown when second player joins
    if (
      room.players.length === 2 &&
      room.status === 'waiting'
    ) {
      this._startCountdown(room);
    }
  }

  console.log(
    `🎮 ${room.id}: ${room.players.length} simulated/real players in game`
  );
}
// ── countdown → game ──────────────────────────────────────────────────────

_startCountdown(room) {
  room.status = 'countdown';

  // Store the exact time the 25-second countdown begins
  room.countdownStart = Date.now();

  room._countdownTimer = setTimeout(() => {
    // Make sure the room is still counting down
    if (room.status === 'countdown') {
      this._startGame(room);
    }
  }, COUNTDOWN_SECONDS * 1000);
}

async cancelCountdown(roomId, playerId) {
  const room = this.rooms[roomId];

  if (!room) throw new Error('Room not found');

  if (room.status !== 'countdown') {
    throw new Error('Game is not in countdown');
  }

  const player = room.players.find(
    p => String(p.id) === String(playerId)
  );

  if (!player) {
    throw new Error('You are not in this room');
  }

// Get this player's cartelas
const playerCartelas = room.playerCartelas[playerId] || [];

// Release their cartelas
for (const cartela of playerCartelas) {
  room.reservedCartelas.delete(cartela.id);
}

// Calculate and refund their entry fee
const refundAmount = room.entryFee * playerCartelas.length;

await this.updatePlayerBalance(playerId, refundAmount, {
  type: 'cancel',
  roomId,
  amount: refundAmount,
  date: new Date().toISOString(),
});

// Remove player from the room
room.players = room.players.filter(
  p => String(p.id) !== String(playerId)
);

// Remove their cartelas from the room
delete room.playerCartelas[playerId];

// Remove their fee from the pot
room.pot -= refundAmount;

  this.addSimulatedPlayers(room.id).catch(err => {
    console.error('❌ Failed to restart simulated players:', err);
  });

  return room.toJSON();
}

_startGame(room) {
  room.status = 'playing';
  room.calledNumbers = [];
  room._gameStartTime = Date.now();

  const numbers = [];
  for (let n = 1; n <= 75; n++) numbers.push(n);

  numbers.sort(() => Math.random() - 0.5);

  let idx = 0;

  room._drawTimer = setInterval(() => {
    if (room.status !== 'playing') {
      clearInterval(room._drawTimer);
      return;
    }

    if (idx >= numbers.length) {
      clearInterval(room._drawTimer);
      return;
    }

    room.calledNumbers.push(numbers[idx++]);

    // Check simulated players for automatic Bingo
    this._checkSimulatedBingo(room);

  }, DRAW_INTERVAL_MS);
}

_checkSimulatedBingo(room) {
  if (room.status !== 'playing' || room.winner) return;

  for (const player of room.players) {

    // Only simulated players
    if (!String(player.id).startsWith('sim_')) continue;

    const cartelas = room.playerCartelas[player.id] || [];

    for (const cartela of cartelas) {

      const valid = checkBingo(
        cartela.grid,
        room.calledNumbers
      );

      if (valid) {

        // Automatically claim Bingo
        this.claimBingo(
          room.id,
          player.id,
          cartela.id
        ).catch(err => {
          console.error(
            `❌ Simulated Bingo error for ${player.name}:`,
            err.message
          );
        });

        return;
      }
    }
  }
}

  // ── bingo claim ───────────────────────────────────────────────────────────

  async claimBingo(roomId, playerId, cartelaId) {
    const room = this.rooms[roomId];
    if (!room) throw new Error('Room not found');
    if (room.status !== 'playing') throw new Error('Game not in progress');
    if (room.burnedCartelas.has(cartelaId)) {
  throw new Error('Cartela is burned');
}
    if (room.winner) throw new Error('Winner already declared');

    const playerCartelas = room.playerCartelas[playerId];
    if (!playerCartelas) throw new Error('You are not in this room');

    const cartela = playerCartelas.find(c => c.id === cartelaId);
    if (!cartela) throw new Error('Cartela not yours');

    const valid = checkBingo(cartela.grid, room.calledNumbers);
    if (!valid) {
  room.burnedCartelas.add(cartelaId);
  throw new Error('Invalid BINGO');
}

    // Stop drawing
    clearInterval(room._drawTimer);

    const player = room.players.find(
  p => String(p.id) === String(playerId)
);

if (!player) {
  throw new Error('Player not found in room');
}

const playerName = player.username || player.name || `Player ${playerId}`;

const winAmt = Math.floor(room.pot * WINNER_SHARE);

room.winner = {
  playerId,
  playerName,
  cartelaId,
  cartelaNumber: cartela.number,
  cartelaGrid: cartela.grid,
  amount: winAmt,
};
    room.status = 'winner';


// ALWAYS schedule reset immediately
setTimeout(() => {
  console.log(`🔄 AUTO RESET: ${room.id}`);
  this._resetRoom(room);
}, 5000);

// Credit winner
await this.updatePlayerBalance(playerId, winAmt, {
  type: 'win',
  roomId,
  amount: winAmt,
  cartelaId,
  date: new Date().toISOString(),
});

// Store in Firebase
if (this.db) {
  const winnerRef = this.db.ref('winners').push();

  await winnerRef.set({
    ...room.winner,
    roomId,
    pot: room.pot,
    date: new Date().toISOString()
  });
}

    return room.toJSON();
  }

  _resetRoom(room) {
  clearInterval(room._drawTimer);
  clearTimeout(room._countdownTimer);
  clearTimeout(room._resetTimer);

  console.log(`🔄 BEFORE RESET: ${room.id} = ${room.status}`);

room.reset();

console.log(`✅ AFTER RESET: ${room.id} = ${room.status}`);

  this.addSimulatedPlayers(room.id).catch(err => {
    console.error('❌ Failed to restart simulated players:', err);
  });
}

  // ── tournament leaderboard ────────────────────────────────────────────────

 // ── DAILY + WEEKLY LEADERBOARDS ─────────────────────────────────────────

async getDailyLeaderboard() {
  if (!this.db) return [];

  const snap = await this.db.ref('winners').once('value');
  const data = snap.val() || {};

  const now = getEthiopiaTimeParts();

  const today =
    `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;

  const leaderboard = {};

  for (const winner of Object.values(data)) {

    if (!winner.date || !winner.playerId) continue;

    const winnerDate = new Date(winner.date);

    if (Number.isNaN(winnerDate.getTime())) continue;

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Addis_Ababa',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(winnerDate);

    const dateParts = {};

    for (const part of parts) {
      if (part.type !== 'literal') {
        dateParts[part.type] = part.value;
      }
    }

    const winnerDay =
      `${dateParts.year}-${dateParts.month}-${dateParts.day}`;

    if (winnerDay !== today) continue;

    const playerId = String(winner.playerId);

    if (!leaderboard[playerId]) {
      leaderboard[playerId] = {
        id: playerId,
        name: winner.playerName || 'Player',
        actualWins: 0
      };
    }

    leaderboard[playerId].actualWins += 1;
  }

  const players = Object.values(leaderboard);

  for (const player of players) {

    if (player.id.startsWith('sim_')) {
      // Simulated players: 3 real wins = 1 leaderboard win
      player.wins = Math.floor(player.actualWins / 3);
    } else {
      // Real players: every win counts
      player.wins = player.actualWins;
    }

    delete player.actualWins;
  }

  return players
    .filter(player => player.wins > 0)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 10);
}


async getWeeklyLeaderboard() {
  if (!this.db) return [];

  const snap = await this.db.ref('winners').once('value');
  const data = snap.val() || {};

  const now = getEthiopiaTimeParts();

  // Ethiopia week: Monday → Sunday
  const currentDate = new Date(
    Date.UTC(now.year, now.month - 1, now.day)
  );

  const day = currentDate.getUTCDay();

  // Sunday = 0, Monday = 1
  const daysFromMonday = day === 0 ? 6 : day - 1;

  const weekStart = new Date(currentDate);
  weekStart.setUTCDate(
    currentDate.getUTCDate() - daysFromMonday
  );

  const leaderboard = {};

  for (const winner of Object.values(data)) {
    if (!winner.date) continue;

    const winnerDate = new Date(winner.date);

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Addis_Ababa',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(winnerDate);

    const dateParts = {};

    for (const part of parts) {
      if (part.type !== 'literal') {
        dateParts[part.type] = Number(part.value);
      }
    }

    const winnerDay = new Date(
      Date.UTC(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day
      )
    );

    const diff =
      winnerDay.getTime() - weekStart.getTime();

    const daysDifference =
      diff / (1000 * 60 * 60 * 24);

    // Only this Monday → Sunday
    if (daysDifference < 0 || daysDifference > 6) {
      continue;
    }

    const playerId = String(winner.playerId);

    if (!leaderboard[playerId]) {
      leaderboard[playerId] = {
        id: playerId,
        name: winner.playerName || 'Player',
        wins: 0,
        actualWins: 0
      };
    }

    leaderboard[playerId].actualWins += 1;
  }

  // SIM PLAYERS: 3 actual wins = 1 leaderboard win
  for (const player of Object.values(leaderboard)) {
    if (String(player.id).startsWith('sim_')) {
      player.wins = Math.floor(player.actualWins / 3);
    } else {
      player.wins = player.actualWins;
    }

    delete player.actualWins;
  }

  return Object.values(leaderboard)
    .filter(player => player.wins > 0)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 5);
}

   // ── TOURNAMENT LEADERBOARD ──────────────────────────────────────────────

  async getTournamentLeaderboard(type = 'daily') {

    if (type === 'weekly') {
      return await this.getWeeklyLeaderboard();
    }

    return await this.getDailyLeaderboard();
  }

  // ── getters ─────────────────────────────────────────────────────────────

  getRoom(roomId) {
    return this.rooms[roomId] || null;
  }

  getAllRooms() {
    return Object.values(this.rooms).map(r => r.toJSON());
  }

}

module.exports = { GamesManager, ROOMS_CONFIG };