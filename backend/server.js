// ============================================================
// ZA BINGO — SERVER (Express API + Game Manager)
// ============================================================
const express = require('express');
const cors = require('cors');
const { initDB, getDB } = require('./database');
const GameManager = require('./gameManager');
const bot = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database & game manager
initDB();
const gameManager = new GameManager();

// Share gameManager with bot
bot.setGameManager(gameManager);

// ============================================================
// HELPER: Extract player from Telegram initData (simplified)
// In production, validate the hash from Telegram.WebApp.initData
// ============================================================
function extractPlayer(req) {
  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;
  if (!tgId) return null;
  const db = getDB();
  return db.prepare('SELECT * FROM players WHERE telegram_id = ?').get(tgId);
}

// ============================================================
// PLAYER ENDPOINTS
// ============================================================

// Register / Get player profile
app.get('/api/player', (req, res) => {
  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;
  if (!tgId) return res.status(400).json({ error: 'Missing telegram_id' });
  
  const db = getDB();
  let player = db.prepare('SELECT * FROM players WHERE telegram_id = ?').get(tgId);
  
  if (!player) {
    // Auto-register with basic info
    const firstName = req.query.first_name || 'Player';
    const username = req.query.username || '';
    const result = db.prepare(
      'INSERT INTO players (telegram_id, first_name, username, balance, games_played, games_won, registration_date) VALUES (?, ?, ?, 100, 0, 0, datetime("now"))'
    ).run(tgId, firstName, username);
    player = db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
  }
  
  res.json({ success: true, player });
});

// Update player phone
app.put('/api/player/phone', (req, res) => {
  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;
  const { phone } = req.body;
  if (!tgId || !phone) return res.status(400).json({ error: 'Missing fields' });
  
  const db = getDB();
  db.prepare('UPDATE players SET phone = ? WHERE telegram_id = ?').run(phone, tgId);
  const player = db.prepare('SELECT * FROM players WHERE telegram_id = ?').get(tgId);
  res.json({ success: true, player });
});

// Get balance
app.get('/api/player/balance', (req, res) => {
  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;
  if (!tgId) return res.status(400).json({ error: 'Missing telegram_id' });
  
  const db = getDB();
  const player = db.prepare('SELECT balance FROM players WHERE telegram_id = ?').get(tgId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json({ success: true, balance: player.balance });
});

// ============================================================
// ROOM ENDPOINTS
// ============================================================

// Get all rooms status
app.get('/api/rooms', (req, res) => {
  const rooms = gameManager.getAllRooms();
  res.json({ success: true, rooms });
});

// Get single room status
app.get('/api/rooms/:roomId', (req, res) => {
  const room = gameManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ success: true, room });
});

// Join room
app.post('/api/rooms/:roomId/join', (req, res) => {
  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;
  const { cartelaIndices } = req.body;
  if (!tgId || !cartelaIndices || !Array.isArray(cartelaIndices)) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  
  const result = gameManager.joinRoom(req.params.roomId, tgId, cartelaIndices);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, message: result.message, balance: result.balance });
});

// Leave room
app.post('/api/rooms/:roomId/leave', (req, res) => {
  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;
  if (!tgId) return res.status(400).json({ error: 'Missing telegram_id' });
  
  const result = gameManager.leaveRoom(req.params.roomId, tgId);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, message: result.message, balance: result.balance });
});

// ============================================================
// GAME ENDPOINTS
// ============================================================

// Get current game state for a room
app.get('/api/game/:roomId', (req, res) => {
  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;
  const gameState = gameManager.getGameState(req.params.roomId, tgId);
  if (!gameState) return res.status(404).json({ error: 'Game not found' });
  res.json({ success: true, game: gameState });
});

// Mark a number on the board
app.post('/api/game/:roomId/mark', (req, res) => {
  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;
  const { number, marked } = req.body;
  if (!tgId || number === undefined) return res.status(400).json({ error: 'Missing fields' });
  
  const result = gameManager.markNumber(req.params.roomId, tgId, number, marked);
  res.json({ success: true, markedNumbers: result.markedNumbers });
});

// Submit BINGO claim
app.post('/api/game/:roomId/bingo', (req, res) => {
  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;
  if (!tgId) return res.status(400).json({ error: 'Missing telegram_id' });
  
  const result = gameManager.claimBingo(req.params.roomId, tgId);
  res.json(result);
});

// ============================================================
// TRANSACTION / HISTORY ENDPOINTS
// ============================================================

// Get player transactions
app.get('/api/transactions', (req, res) => {
  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;
  if (!tgId) return res.status(400).json({ error: 'Missing telegram_id' });
  
  const db = getDB();
  const player = db.prepare('SELECT id FROM players WHERE telegram_id = ?').get(tgId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  
  const transactions = db.prepare(
    'SELECT * FROM transactions WHERE player_id = ? ORDER BY date DESC LIMIT 50'
  ).all(player.id);
  res.json({ success: true, transactions });
});

// Get player game history
app.get('/api/history', (req, res) => {
  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;
  if (!tgId) return res.status(400).json({ error: 'Missing telegram_id' });
  
  const db = getDB();
  const player = db.prepare('SELECT id FROM players WHERE telegram_id = ?').get(tgId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  
  const history = db.prepare(
    'SELECT * FROM game_history WHERE player_id = ? ORDER BY date DESC LIMIT 50'
  ).all(player.id);
  res.json({ success: true, history });
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', rooms: gameManager.getAllRooms().length });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`✅ ZA Bingo server running on port ${PORT}`);
  console.log(`🤖 Telegram bot starting...`);
});