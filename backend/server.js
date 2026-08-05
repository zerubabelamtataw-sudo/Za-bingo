// ============================================================
// ZA BINGO — SERVER (Firebase + Express API)
// ============================================================

const express = require('express');
const cors = require('cors');
const db = require('./firebase');
const GameManager = require('./gameManager');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
const path = require('path');

app.use(express.static(path.join(__dirname, '..')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});


// Load bot after Firebase is ready
const bot = require('./bot');

const gameManager = new GameManager();

bot.setGameManager(gameManager);


// ============================================================
// PLAYER
// ============================================================

app.get('/api/player', async (req,res)=>{

  const tgId = req.headers['x-telegram-id'] || req.query.tg_id;

  if(!tgId){
    return res.status(400).json({
      error:"Missing telegram_id"
    });
  }


  const playerRef = db.ref(`players/${tgId}`);

  const snapshot = await playerRef.once('value');

  let player = snapshot.val();


  if(!player){

    player = {
      telegram_id: tgId,
      first_name: req.query.first_name || "Player",
      username: req.query.username || "",
      phone:"",
      balance:100,
      games_played:0,
      games_won:0,
      registration_date:new Date().toISOString()
    };


    await playerRef.set(player);

  }


  res.json({
    success:true,
    player
  });

});



// Update phone

app.put('/api/player/phone', async(req,res)=>{

 const tgId=req.headers['x-telegram-id'];
 const phone=req.body.phone;


 if(!tgId || !phone){
   return res.status(400).json({
     error:"Missing fields"
   });
 }


 await db.ref(`players/${tgId}/phone`).set(phone);


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
app.post('/api/rooms/:roomId/leave',(req,res)=>{

 const tgId=req.headers['x-telegram-id'];

 const result=gameManager.leaveRoom(
   req.params.roomId,
   tgId
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

app.get('/api/transactions',async(req,res)=>{


 const tgId=req.headers['x-telegram-id'];


 if(!tgId){
   return res.status(400).json({
     error:"Missing telegram_id"
   });
 }


 const snapshot=await db
 .ref(`transactions/${tgId}`)
 .once('value');


 res.json({
   success:true,
   transactions:snapshot.val() || {}
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
