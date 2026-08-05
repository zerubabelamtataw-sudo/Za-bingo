const db = require('./firebase');

function generateCartelas() {
  const rooms = ['5br', '10br', '20br'];

  rooms.forEach(roomId => {
    const cartelas = {};

    for (let i = 1; i <= 150; i++) {
      cartelas[i] = {
        id: i,
        numbers: generateBingoCard()
      };
    }

    db.ref(`rooms/${roomId}/cartelas`).set(cartelas);

    console.log(`✅ ${roomId}: 150 cartelas created`);
  });
}

function generateBingoCard() {
  return {
    B: randomNumbers(1, 15, 5),
    I: randomNumbers(16, 30, 5),
    N: randomNumbers(31, 45, 5),
    G: randomNumbers(46, 60, 5),
    O: randomNumbers(61, 75, 5)
  };
}

function randomNumbers(min, max, count) {
  const nums = [];

  while (nums.length < count) {
    const n = Math.floor(Math.random() * (max - min + 1)) + min;
    if (!nums.includes(n)) nums.push(n);
  }

  return nums.sort((a, b) => a - b);
}

generateCartelas();
