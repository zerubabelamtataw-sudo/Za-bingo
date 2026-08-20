'use strict';

/**
 * server.js
 * Bingo Express API — integrates Firebase Admin SDK + GamesManager
 *
 * ENV vars expected:
 *   FIREBASE_SERVICE_ACCOUNT  – JSON string of serviceAccountKey.json
 *   PORT                      – (optional) default 3000
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const { GamesManager } = require('./gameManager');
require('./bot');
require('./adminBot');
// ── Firebase init (graceful if credentials missing) ───────────────────────────
let db = null;
try {
  const admin = require('firebase-admin');
  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    // Try loading from file for local dev
    serviceAccount = require('./serviceAccountKey.json');
  }

  if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

db = admin.database();
console.log('✅ Firebase Realtime Database connected');
  console.log('✅ Firebase connected');
} catch (e) {
  console.warn('⚠️  Firebase not configured — running in-memory mode:', e.message);
}

// ── App setup ─────────────────────────────────────────────────────────────────
const app    = express();
const gm     = new GamesManager(db);
gm.addSimulatedPlayers('5br');
const PORT   = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).send('ZA Bingo server is alive');
});

// ============================================================
// ADMIN LOGIN
// ============================================================

app.post('/api/admin/login', (req, res) => {

  const { password } = req.body || {};
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(500).json({
      success: false,
      message: 'ADMIN_PASSWORD is not configured'
    });
  }

  if (!password || password !== adminPassword) {
    return res.status(401).json({
      success: false,
      message: 'Invalid admin password'
    });
  }

  res.json({
    success: true,
    message: 'Admin login successful'
  });

});

// ============================================================
// ADMIN — ADD BALANCE
// ============================================================

app.post('/api/admin/add-balance', async (req, res) => {

  try {

    const { password, playerId, amount } = req.body || {};

    const adminPassword = process.env.ADMIN_PASSWORD;

    // Check admin password
    if (!adminPassword || password !== adminPassword) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Validate player ID
    if (!playerId) {
      return res.status(400).json({
        success: false,
        message: 'Player ID required'
      });
    }

    // Validate amount
    const addAmount = Number(amount);

    if (!Number.isFinite(addAmount) || addAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Firebase is not connected'
      });
    }

    const playerRef = db.ref(`players/${playerId}`);

    const snapshot = await playerRef.once('value');
    const player = snapshot.val();

    if (!player) {
      return res.status(404).json({
        success: false,
        message: 'Player not found'
      });
    }

    const currentBalance = Number(player.balance || 0);
    const newBalance = currentBalance + addAmount;

    await playerRef.update({
      balance: newBalance
    });

    // Save admin transaction
    const transactionRef = db.ref('transactions').push();

    await transactionRef.set({
      type: 'admin_add_balance',
      playerId: String(playerId),
      amount: addAmount,
      previousBalance: currentBalance,
      newBalance: newBalance,
      status: 'completed',
      createdAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      message: 'Balance added successfully',
      previousBalance: currentBalance,
      newBalance: newBalance
    });

  } catch (error) {

    console.error('❌ Admin add balance error:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error'
    });

  }

});

// ── Helper ────────────────────────────────────────────────────────────────────
const ok  = (res, data)  => res.json({ success: true,  ...data });
const err = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg });

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/cartelas — return all 150 cartelas
app.get('/api/cartelas', async (req, res) => {
  try {
    const cartelas = await gm.getCartelas();
    ok(res, { cartelas });
  } catch (e) { err(res, e.message); }
});

// GET /api/rooms — list all 3 rooms
app.get('/api/rooms', (req, res) => {
  ok(res, { rooms: gm.getAllRooms() });
});

// GET /api/rooms/:roomId — single room state
app.get('/api/rooms/:roomId', (req, res) => {
  const room = gm.getRoom(req.params.roomId);
  if (!room) return err(res, 'Room not found', 404);
  ok(res, { room: room.toJSON() });
});

// POST /api/player — get or create player
// body: { playerId, name }
app.post('/api/player', async (req, res) => {
  const { playerId, name, username } = req.body || {};

  if (!playerId) {
    return err(res, 'Telegram player ID required');
  }

  try {
    const player = await gm.getOrCreatePlayer(
  String(playerId),
  name || 'Player',
  username || ''
);

    ok(res, { player });
  } catch (e) {
    err(res, e.message);
  }
});

// GET /api/player/:playerId
app.get('/api/player/:playerId', async (req, res) => {
  try {
    const player = await gm.getOrCreatePlayer(req.params.playerId, 'Player');
    ok(res, { player });
  } catch (e) { err(res, e.message); }
});

// POST /api/rooms/:roomId/join
// body: { playerId, cartelaIds: string[] }
app.post('/api/rooms/:roomId/join', async (req, res) => {
  const { playerId, cartelaIds } = req.body || {};
  if (!playerId || !Array.isArray(cartelaIds)) {
    return err(res, 'playerId and cartelaIds[] required');
  }
  try {
    const player = await gm.getOrCreatePlayer(playerId, 'Player');
    const room   = await gm.joinRoom(req.params.roomId, player, cartelaIds);
    ok(res, { room });
  } catch (e) { err(res, e.message); }
});

// POST /api/rooms/:roomId/cancel-countdown
// body: { playerId }
app.post('/api/rooms/:roomId/cancel-countdown', async (req, res) => {
  const { playerId } = req.body || {};

  if (!playerId) {
    return err(res, 'playerId required');
  }

  try {
    const room = await gm.cancelCountdown(
      req.params.roomId,
      playerId
    );

    ok(res, { room });
  } catch (e) {
    err(res, e.message);
  }
});

// GET /api/game/:roomId — alias for room state (frontend polling)
app.get('/api/game/:roomId', (req, res) => {
  const room = gm.getRoom(req.params.roomId);
  if (!room) return err(res, 'Room not found', 404);
  ok(res, { game: room.toJSON() });
});

// POST /api/rooms/:roomId/bingo
// body: { playerId, cartelaId }
app.post('/api/rooms/:roomId/bingo', async (req, res) => {
  const { playerId, cartelaId } = req.body || {};
  if (!playerId || !cartelaId) return err(res, 'playerId and cartelaId required');
  try {
    const result = await gm.claimBingo(req.params.roomId, playerId, cartelaId);
    ok(res, { game: result, winner: result.winner });
  } catch (e) { err(res, e.message); }
});

// Catch-all → serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🎱 Bingo server running on http://localhost:${PORT}`);
});

module.exports = app;