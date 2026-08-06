// ============================================================
// ZA BINGO — SEED CARTELAS TO FIREBASE
// ============================================================

const db = require('./firebase');

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}


function generateCartela(id) {

  const ranges = {
    B: [1, 15],
    I: [16, 30],
    N: [31, 45],
    G: [46, 60],
    O: [61, 75]
  };


  const numbers = {};


  Object.keys(ranges).forEach(letter => {

    const min = ranges[letter][0];
    const max = ranges[letter][1];


    let pool = [];

    for(let i=min;i<=max;i++){
      pool.push(i);
    }


    shuffle(pool);


    numbers[letter] = pool.slice(0,5);

  });


  // Free center space
  numbers.N[2] = 0;


  return {
    id,
    numbers
  };
}



async function seedRoom(roomId){

  const cartelas = {};

  for(let i=0;i<150;i++){

    cartelas[i] = generateCartela(i);

  }


  await db.ref(`rooms/${roomId}/cartelas`).set(cartelas);


  console.log(
    `✅ ${roomId} seeded with 150 cartelas`
  );

}



async function seed(){

  await seedRoom('5br');
  await seedRoom('10br');
  await seedRoom('20br');


  console.log('🎉 All cartelas created');


  process.exit();

}


seed().catch(err=>{

  console.error(
    "❌ Seed failed:",
    err
  );

  process.exit(1);

});
