// ============================================================
// ZA BINGO — SERVER (Express API + Game Manager)
// ============================================================

const express = require('express');
const cors = require('cors');
const { initDB, getDB } = require('./database');
const GameManager = require('./gameManager');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ============================================================
// Initialize Database FIRST
// ============================================================

initDB();

// Load bot AFTER database is ready
const bot = require('./bot');

// Initialize game manager
const gameManager = new GameManager();

// Share gameManager with bot
bot.setGameManager(gameManager);


// ============================================================
// PLAYER ENDPOINTS
// ============================================================

app.get('/api/player', (req, res) => {
  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;

  if (!tgId) {
    return res.status(400).json({ error: 'Missing telegram_id' });
  }

  const db = getDB();

  let player = db
    .prepare('SELECT * FROM players WHERE telegram_id = ?')
    .get(tgId);

  if (!player) {

    const firstName = req.query.first_name || 'Player';
    const username = req.query.username || '';

    const result = db.prepare(`
      INSERT INTO players
      (telegram_id, first_name, username)
      VALUES (?, ?, ?)
    `).run(
      tgId,
      firstName,
      username
    );

    player = db
      .prepare('SELECT * FROM players WHERE id = ?')
      .get(result.lastInsertRowid);
  }

  res.json({
    success: true,
    player
  });
});


app.put('/api/player/phone', (req,res)=>{

  const tgId = req.headers['x-telegram-id'];
  const {phone} = req.body;

  if(!tgId || !phone){
    return res.status(400).json({
      error:"Missing fields"
    });
  }

  const db=getDB();

  db.prepare(
    'UPDATE players SET phone=? WHERE telegram_id=?'
  ).run(phone,tgId);


  res.json({
    success:true
  });

});


// ============================================================
// ROOMS
// ============================================================

app.get('/api/rooms',(req,res)=>{

  res.json({
    success:true,
    rooms:gameManager.getAllRooms()
  });

});


app.post('/api/rooms/:roomId/join',(req,res)=>{

 const tgId=req.headers['x-telegram-id'];

 const result=gameManager.joinRoom(
   req.params.roomId,
   tgId,
   req.body.cartelaIndices
 );

 res.json(result);

});


// ============================================================
// GAME
// ============================================================

app.get('/api/game/:roomId',(req,res)=>{

 const game=gameManager.getGameState(
   req.params.roomId,
   req.headers['x-telegram-id']
 );

 res.json({
   success:true,
   game
 });

});


app.post('/api/game/:roomId/bingo',(req,res)=>{

 const result=gameManager.claimBingo(
   req.params.roomId,
   req.headers['x-telegram-id']
 );

 res.json(result);

});


// ============================================================
// TRANSACTIONS
// ============================================================

app.get('/api/transactions',(req,res)=>{

 const db=getDB();

 const player=db.prepare(
 'SELECT id FROM players WHERE telegram_id=?'
 ).get(req.headers['x-telegram-id']);


 if(!player){
   return res.json([]);
 }


 const transactions=db.prepare(
 'SELECT * FROM transactions WHERE player_id=?'
 ).all(player.id);


 res.json({
   success:true,
   transactions
 });

});


// ============================================================
// HEALTH
// ============================================================

app.get('/api/health',(req,res)=>{

 res.json({
   status:"ok"
 });

});


// ============================================================
// START
// ============================================================

app.listen(PORT,()=>{

 console.log(
 `✅ ZA Bingo server running on port ${PORT}`
 );

});
