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

const COUNTDOWN_SECONDS = 25;
const DRAW_INTERVAL_MS  = 3000;
const WINNER_SHARE      = 0.85;

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
    this.status          = 'waiting';   // waiting | countdown | playing | winner
    this.players         = [];          // [{ id, name, balance }]
    this.playerCartelas  = {};          // { playerId: [cartelaObj, …] }
    this.reservedCartelas = new Set();  // cartelaIds reserved for this room
    this.calledNumbers   = [];
    this.pot             = 0;
    this.winner          = null;        // { playerId, playerName, cartelaId, amount }
    this.countdownStart  = null;
    this._countdownTimer = null;
    this._drawTimer      = null;
    this._gameStartTime  = null;
  }

  // Public snapshot for API
  toJSON() {
    return {
      id:             this.id,
      name:           this.name,
      entryFee:       this.entryFee,
      status:         this.status,
      playerCount:    this.players.length,
      players:        this.players.map(p => ({ id: p.id, name: p.name })),
      calledNumbers:  this.calledNumbers,
      pot:            this.pot,
      winner:         this.winner,
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

  async getOrCreatePlayer(playerId, name) {
    if (this.db) {
      const ref = this.db.ref(`players/${playerId}`);
const snap = await ref.once('value');

if (snap.exists()) {
  return { id: playerId, ...snap.val() };
}

const player = {
  name,
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
  if (this.db) {
    const ref = this.db.ref(`players/${playerId}`);
    const snap = await ref.once('value');

    if (!snap.exists()) return;

    const data = snap.val();
    const balance = (data.balance || 0) + delta;
    const history = [...(data.history || []), historyEntry];

    await ref.update({
      balance,
      history
    });

    return {
      id: playerId,
      ...data,
      balance,
      history
    };
  }

  if (this._players && this._players[playerId]) {
    const p = this._players[playerId];
    p.balance += delta;
    p.history.push(historyEntry);
    return p;
  }
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

    room.players.push({ id: player.id, name: player.name, balance: player.balance - totalFee });
    room.playerCartelas[player.id] = selected;
    room.pot += totalFee;

    // Start 25-second countdown when the FIRST player joins
if (room.players.length === 1 && room.status === 'waiting') {
  this._startCountdown(room);
}

    return room.toJSON();
  }

  // ── countdown → game ──────────────────────────────────────────────────────

  _startCountdown(room) {
    room.status         = 'countdown';
    room.countdownStart = Date.now();

    room._countdownTimer = setTimeout(() => {
      this._startGame(room);
    }, COUNTDOWN_SECONDS * 1000);
  }

  _startGame(room) {
    room.status         = 'playing';
    room.calledNumbers  = [];
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
    }, DRAW_INTERVAL_MS);
  }

  // ── bingo claim ───────────────────────────────────────────────────────────

  async claimBingo(roomId, playerId, cartelaId) {
    const room = this.rooms[roomId];
    if (!room) throw new Error('Room not found');
    if (room.status !== 'playing') throw new Error('Game not in progress');
    if (room.winner) throw new Error('Winner already declared');

    const playerCartelas = room.playerCartelas[playerId];
    if (!playerCartelas) throw new Error('You are not in this room');

    const cartela = playerCartelas.find(c => c.id === cartelaId);
    if (!cartela) throw new Error('Cartela not yours');

    const valid = checkBingo(cartela.grid, room.calledNumbers);
    if (!valid) throw new Error('No valid BINGO pattern');

    // Stop drawing
    clearInterval(room._drawTimer);

    const player  = room.players.find(p => p.id === playerId);
    const winAmt  = Math.floor(room.pot * WINNER_SHARE);

    room.winner = {
      playerId,
      playerName: player.name,
      cartelaId,
      cartelaNumber: cartela.number,
      amount: winAmt,
      calledCount: room.calledNumbers.length,
    };
    room.status = 'winner';

    // Credit winner
    await this.updatePlayerBalance(playerId, winAmt, {
      type: 'win', roomId, amount: winAmt, cartelaId, date: new Date().toISOString(),
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

    // Auto-reset after 15s
    setTimeout(() => this._resetRoom(room), 5000);

    return room.toJSON();
  }

  _resetRoom(room) {
    clearInterval(room._drawTimer);
    clearTimeout(room._countdownTimer);
    room.reset();
  }

  // ── getters ───────────────────────────────────────────────────────────────

  getRoom(roomId)  { return this.rooms[roomId] || null; }
  getAllRooms()     { return Object.values(this.rooms).map(r => r.toJSON()); }
}

module.exports = { GamesManager, ROOMS_CONFIG };