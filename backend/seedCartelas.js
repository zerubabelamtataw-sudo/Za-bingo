// ============================================================
// ZA BINGO — SEED CARTELAS TO FIREBASE
// ============================================================

const db = require("./firebase");

// ------------------------------
// Shuffle Helper
// ------------------------------
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ------------------------------
// Generate One Bingo Cartela
// ------------------------------
function generateCartela(id) {
  const ranges = {
    B: [1, 15],
    I: [16, 30],
    N: [31, 45],
    G: [46, 60],
    O: [61, 75]
  };

  const numbers = {};

  for (const letter of Object.keys(ranges)) {
    const [min, max] = ranges[letter];

    const pool = [];

    for (let i = min; i <= max; i++) {
      pool.push(i);
    }

    shuffle(pool);

    numbers[letter] = pool.slice(0, 5);
  }

  // Free center space
  numbers.N[2] = 0;

  return {
    id,
    numbers
  };
}

// ------------------------------
// Seed One Room
// ------------------------------
async function seedRoom(roomId) {
  console.log(`📦 Seeding ${roomId}...`);

  const cartelas = {};

  for (let i = 0; i < 150; i++) {
    cartelas[i] = generateCartela(i);
  }

  await db.ref(`rooms/${roomId}/cartelas`).set(cartelas);

  console.log(`✅ ${roomId} seeded with 150 cartelas`);
}

// ------------------------------
// Main Seeder
// ------------------------------
async function seed() {
  console.log("🚀 Starting ZA Bingo Cartela Seeder...");

  await seedRoom("5br");
  await seedRoom("10br");
  await seedRoom("20br");

  console.log("🎉 All cartelas successfully uploaded to Firebase.");
}

// ------------------------------
// Run
// ------------------------------
seed()
  .then(() => {
    console.log("✅ Seeder finished successfully.");
  })
  .catch((err) => {
    console.error("❌ Seeder failed:");
    console.error(err);
    process.exitCode = 1;
  });
