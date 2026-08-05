// ============================================================
// ZA BINGO — FIREBASE REALTIME DATABASE
// ============================================================

const admin = require("firebase-admin");

// Firebase service account from Render environment variables
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

// Realtime Database reference
const db = admin.database();

console.log("✅ Firebase Realtime Database connected");

module.exports = db;
