// ============================================================
// ZA BINGO — GAME MANAGER
// ============================================================
const { getDB } = require('./database');

class GameManager {
  constructor() {
    this.rooms = {
      '5br': this.createRoomData('5br', '5 Br', 5),
      '10br': this.createRoomData('10br', '10 Br', 10),
      '20br': this.createRoomData('20br', '20 Br', 20),
    };
    
    // Start auto-draw timers for all rooms
    Object.keys(this.rooms).forEach(roomId => {
      this.startDrawLoop(roomId);
    });
    
    console.log('✅ Game Manager initialized');
  }

  // ---- Room Factory ----
  createRoomData(id, name, entryFee) {
    return {
      id,
      name,
      entryFee,
      prize: 0,
      players: [],           // Array of telegram_ids
      playerCartelas: {},    // { telegram_id: [cartelaIndex, ...] }
      reservedCartelas: new Set(),
      status: 'waiting',     // waiting | countdown | playing | winner
      joined: {},
      winners: [],
      calledNumbers: [],
      markedNumbers: {},     // { telegram_id: Set of numbers }
      countdown: 25,
      countdownInterval: null,
      drawInterval: null,
      totalCartelas: 0,
    };
  }

  // ---- Public: Get room data for API ----
  getRoom(roomId) {
    const room = this.rooms[roomId];
    if (!room) return null;
    return {
      id: room.id,
      name: room.name,
      entryFee: room.entryFee,
      prize: room.prize,
      players: room.players.length,
      status: room.status,
      winners: room.winners,
    };
  }

  // ---- Public: Get all rooms ----
  getAllRooms() {
    const result = {};
    for (const [id, room] of Object.entries(this.rooms)) {
      result[id] = this.getRoom(id);
    }
    return result;
  }

  // ---- Public: Get game state for a player ----
  getGameState(roomId, tgId) {
    const room = this.rooms[roomId];
    if (!room) return null;
    return {
      roomId: room.id,
      status: room.status,
      calledNumbers: room.calledNumbers.slice(-10), // Last 10 calls
      calledCount: room.calledNumbers.length,
      countdown: room.countdown,
      prize: room.prize,
      players: room.players.length,
      myMarkedNumbers: room.markedNumbers[tgId] ? Array.from(room.markedNumbers[tgId]) : [],
      myCartelas: room.playerCartelas[tgId] || [],
      winners: room.winners,
    };
  }

  // ---- Public: Join room ----
  joinRoom(roomId, tgId, cartelaIndices) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, error: 'Room not found' };
    if (room.status === 'playing') return { success: false, error: 'Game in progress' };
    if (room.players.includes(tgId)) return { success: false, error: 'Already joined' };
    if (cartelaIndices.length < 1 || cartelaIndices.length > 4) {
      return { success: false, error: 'Select 1-4 cartelas' };
    }

    // Check for duplicate cartelas
    for (const idx of cartelaIndices) {
      if (room.reservedCartelas.has(idx)) {
        return { success: false, error: `Cartela #${idx + 1} already taken` };
      }
    }

    const db = getDB();
    const player = db.prepare('SELECT * FROM players WHERE telegram_id = ?').get(tgId);
    if (!player) return { success: false, error: 'Player not registered' };

    const totalFee = room.entryFee * cartelaIndices.length;
    if (player.balance < totalFee) {
      return { success: false, error: `Insufficient balance. Need ${totalFee} Br` };
    }

    // Deduct balance
    db.prepare('UPDATE players SET balance = balance - ? WHERE telegram_id = ?').run(totalFee, tgId);

    // Record transaction
    db.prepare(
      'INSERT INTO transactions (player_id, type, amount, status, description) VALUES (?, ?, ?, ?, ?)'
    ).run(player.id, 'entry_fee', -totalFee, 'approved', `Joined ${room.name}`);

    // Join room
    room.players.push(tgId);
    room.prize += totalFee;
    room.playerCartelas[tgId] = cartelaIndices;
    room.markedNumbers[tgId] = new Set();
    cartelaIndices.forEach(idx => room.reservedCartelas.add(idx));
    room.totalCartelas += cartelaIndices.length;

    // Start countdown if we have 2+ players
    if (room.players.length >= 2 && room.status === 'waiting') {
      this.startCountdown(roomId);
    }

    const updatedPlayer = db.prepare('SELECT balance FROM players WHERE telegram_id = ?').get(tgId);
    return { success: true, message: 'Joined!', balance: updatedPlayer.balance };
  }

  // ---- Public: Leave room ----
  leaveRoom(roomId, tgId) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, error: 'Room not found' };
    if (!room.players.includes(tgId)) return { success: false, error: 'Not in room' };
    if (room.status === 'playing') return { success: false, error: 'Game in progress' };

    const cartelas = room.playerCartelas[tgId] || [];
    const refund = room.entryFee * cartelas.length;

    const db = getDB();
    const player = db.prepare('SELECT * FROM players WHERE telegram_id = ?').get(tgId);

    // Refund
    db.prepare('UPDATE players SET balance = balance + ? WHERE telegram_id = ?').run(refund, tgId);
    db.prepare(
      'INSERT INTO transactions (player_id, type, amount, status, description) VALUES (?, ?, ?, ?, ?)'
    ).run(player.id, 'refund', refund, 'approved', `Left ${room.name}`);

    // Clean room
    room.players = room.players.filter(id => id !== tgId);
    room.prize -= refund;
    cartelas.forEach(idx => room.reservedCartelas.delete(idx));
    room.totalCartelas -= cartelas.length;
    delete room.playerCartelas[tgId];
    delete room.markedNumbers[tgId];

    // Reset if empty
    if (room.players.length === 0) {
      this.resetRoom(roomId);
    } else if (room.players.length < 2 && room.status === 'countdown') {
      this.stopCountdown(roomId);
      room.status = 'waiting';
    }

    const updatedPlayer = db.prepare('SELECT balance FROM players WHERE telegram_id = ?').get(tgId);
    return { success: true, message: `Refunded ${refund} Br`, balance: updatedPlayer.balance };
  }

  // ---- Public: Mark/unmark a number ----
  markNumber(roomId, tgId, number, marked) {
    const room = this.rooms[roomId];
    if (!room) return { markedNumbers: [] };
    if (!room.markedNumbers[tgId]) room.markedNumbers[tgId] = new Set();
    
    if (marked) {
      room.markedNumbers[tgId].add(number);
    } else {
      room.markedNumbers[tgId].delete(number);
    }
    
    return { markedNumbers: Array.from(room.markedNumbers[tgId]) };
  }

  // ---- Public: Claim BINGO ----
  claimBingo(roomId, tgId) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, error: 'Room not found' };
    if (room.status !== 'playing') return { success: false, error: 'Game not active' };
    if (room.winners.length > 0) return { success: false, error: 'Winner already declared' };
    if (room.calledNumbers.length < 5) return { success: false, error: 'Not enough numbers called' };

    const playerCartelas = room.playerCartelas[tgId] || [];
    const markedSet = room.markedNumbers[tgId] || new Set();
    
    // Check if any cartela is complete (all numbers on cartela are called & marked)
    // This is a simplified check — in production, validate against actual cartela data
    const winAmount = (room.prize * 0.85);
    
    const db = getDB();
    const player = db.prepare('SELECT * FROM players WHERE telegram_id = ?').get(tgId);
    
    // Award winner
    db.prepare('UPDATE players SET balance = balance + ?, games_played = games_played + 1, games_won = games_won + 1 WHERE telegram_id = ?')
      .run(winAmount, tgId);
    
    db.prepare(
      'INSERT INTO transactions (player_id, type, amount, status, description) VALUES (?, ?, ?, ?, ?)'
    ).run(player.id, 'winning_prize', winAmount, 'approved', `Won ${room.name}`);
    
    db.prepare(
      'INSERT INTO game_history (player_id, room_id, room_name, result, prize, cartela_indices) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(player.id, roomId, room.name, 'win', winAmount, JSON.stringify(playerCartelas));

    // Record losers
    room.players.filter(id => id !== tgId).forEach(loserId => {
      const loser = db.prepare('SELECT * FROM players WHERE telegram_id = ?').get(loserId);
      if (loser) {
        db.prepare('UPDATE players SET games_played = games_played + 1 WHERE telegram_id = ?').run(loserId);
        db.prepare(
          'INSERT INTO game_history (player_id, room_id, room_name, result, prize) VALUES (?, ?, ?, ?, ?)'
        ).run(loser.id, roomId, room.name, 'lose', 0);
      }
    });

    room.winners = [{ playerId: tgId, playerName: player.first_name, amount: winAmount }];
    room.status = 'winner';

    // Reset after 5 seconds
    setTimeout(() => this.resetRoom(roomId), 5000);

    const updatedPlayer = db.prepare('SELECT * FROM players WHERE telegram_id = ?').get(tgId);
    return {
      success: true,
      winner: true,
      winnerName: player.first_name,
      amount: winAmount,
      balance: updatedPlayer.balance,
      cartelaNumber: playerCartelas[0] + 1,
    };
  }

  // ---- Countdown Management ----
  startCountdown(roomId) {
    const room = this.rooms[roomId];
    if (!room) return;
    room.status = 'countdown';
    room.countdown = 25;
    
    if (room.countdownInterval) clearInterval(room.countdownInterval);
    
    room.countdownInterval = setInterval(() => {
      room.countdown--;
      
      if (room.countdown <= 0) {
        clearInterval(room.countdownInterval);
        room.countdownInterval = null;
        this.startGame(roomId);
      }
    }, 1000);
  }

  stopCountdown(roomId) {
    const room = this.rooms[roomId];
    if (!room) return;
    if (room.countdownInterval) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = null;
    }
    room.countdown = 25;
  }

  // ---- Game Management ----
  startGame(roomId) {
    const room = this.rooms[roomId];
    if (!room) return;
    room.status = 'playing';
    room.calledNumbers = [];
    room.winners = [];
    console.log(`🎮 Game started in ${room.name}`);
  }

  startDrawLoop(roomId) {
    // Draw loop runs every 3 seconds but only draws when game is 'playing'
    setInterval(() => {
      const room = this.rooms[roomId];
      if (!room || room.status !== 'playing') return;
      if (room.calledNumbers.length >= 75) {
        this.resetRoom(roomId);
        return;
      }
      this.drawNumber(roomId);
    }, 3000);
  }

  drawNumber(roomId) {
    const room = this.rooms[roomId];
    if (!room || room.status !== 'playing') return;
    if (room.winners.length > 0) return;

    let num;
    let attempts = 0;
    do {
      num = Math.floor(Math.random() * 75) + 1;
      attempts++;
    } while (room.calledNumbers.includes(num) && attempts < 100);

    if (!room.calledNumbers.includes(num)) {
      room.calledNumbers.push(num);
    }
  }

  // ---- Reset Room ----
  resetRoom(roomId) {
    const room = this.rooms[roomId];
    if (!room) return;
    
    // Clear intervals
    if (room.countdownInterval) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = null;
    }

    // Reset state
    room.players = [];
    room.prize = 0;
    room.status = 'waiting';
    room.playerCartelas = {};
    room.reservedCartelas = new Set();
    room.markedNumbers = {};
    room.winners = [];
    room.calledNumbers = [];
    room.countdown = 25;
    room.totalCartelas = 0;
    
    console.log(`🔄 Room ${room.name} reset`);
  }
}

module.exports = GameManager;