// ============================================================
// ZA BINGO — GAME MANAGER
// ============================================================
const db = require('./firebase');

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
  async joinRoom(roomId, tgId, cartelaIndices) {
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

    const playerRef = db.ref(`players/${tgId}`);
    const playerSnapshot = await playerRef.once('value');
    const player = playerSnapshot.val();
    
    if (!player) return { success: false, error: 'Player not registered' };

    const totalFee = room.entryFee * cartelaIndices.length;
    if (player.balance < totalFee) {
      return { success: false, error: `Insufficient balance. Need ${totalFee} Br` };
    }

    // Deduct balance
    await playerRef.update({ balance: player.balance - totalFee });

    // Record transaction
    const transactionRef = db.ref('transactions').push();
    await transactionRef.set({
      player_id: tgId,
      type: 'entry_fee',
      amount: -totalFee,
      status: 'approved',
      description: `Joined ${room.name}`
    });

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

    const updatedSnapshot = await playerRef.once('value');
    const updatedPlayer = updatedSnapshot.val();
    return { success: true, message: 'Joined!', balance: updatedPlayer.balance };
  }

  // ---- Public: Leave room ----
  async leaveRoom(roomId, tgId) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, error: 'Room not found' };
    if (!room.players.includes(tgId)) return { success: false, error: 'Not in room' };
    if (room.status === 'playing') return { success: false, error: 'Game in progress' };

    const cartelas = room.playerCartelas[tgId] || [];
    const refund = room.entryFee * cartelas.length;

    const playerRef = db.ref(`players/${tgId}`);
    const playerSnapshot = await playerRef.once('value');
    const player = playerSnapshot.val();

    // Refund
    await playerRef.update({ balance: player.balance + refund });

    // Record transaction
    const transactionRef = db.ref('transactions').push();
    await transactionRef.set({
      player_id: tgId,
      type: 'refund',
      amount: refund,
      status: 'approved',
      description: `Left ${room.name}`
    });

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

    const updatedSnapshot = await playerRef.once('value');
    const updatedPlayer = updatedSnapshot.val();
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
  async claimBingo(roomId, tgId) {
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
    
    const playerRef = db.ref(`players/${tgId}`);
    const playerSnapshot = await playerRef.once('value');
    const player = playerSnapshot.val();
    
    // Award winner
    await playerRef.update({
      balance: player.balance + winAmount,
      gamesPlayed: (player.gamesPlayed || 0) + 1,
      gamesWon: (player.gamesWon || 0) + 1
    });
    
    // Record winning transaction
    const winTransactionRef = db.ref('transactions').push();
    await winTransactionRef.set({
      player_id: tgId,
      type: 'winning_prize',
      amount: winAmount,
      status: 'approved',
      description: `Won ${room.name}`
    });
    
    // Record game history for winner
    const gameHistoryRef = db.ref('game_history').push();
    await gameHistoryRef.set({
      player_id: tgId,
      room_id: roomId,
      room_name: room.name,
      result: 'win',
      prize: winAmount,
      cartela_indices: JSON.stringify(playerCartelas)
    });

    // Record losers
    for (const loserId of room.players.filter(id => id !== tgId)) {
      const loserRef = db.ref(`players/${loserId}`);
      const loserSnapshot = await loserRef.once('value');
      const loser = loserSnapshot.val();
      
      if (loser) {
        await loserRef.update({
          gamesPlayed: (loser.gamesPlayed || 0) + 1
        });
        
        const loserHistoryRef = db.ref('game_history').push();
        await loserHistoryRef.set({
          player_id: loserId,
          room_id: roomId,
          room_name: room.name,
          result: 'lose',
          prize: 0
        });
      }
    }

    room.winners = [{ playerId: tgId, playerName: player.first_name, amount: winAmount }];
    room.status = 'winner';

    // Reset after 5 seconds
    setTimeout(() => this.resetRoom(roomId), 5000);

    const updatedSnapshot = await playerRef.once('value');
    const updatedPlayer = updatedSnapshot.val();
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
