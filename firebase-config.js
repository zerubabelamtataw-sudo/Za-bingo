import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCMfDNAWQtrJGijQLUC5KQWi5hVTgEvJTo",
  authDomain: "zabingo-d2ed5.firebaseapp.com",
  databaseURL: "https://zabingo-d2ed5-default-rtdb.firebaseio.com/",
  projectId: "zabingo-d2ed5",
  storageBucket: "zabingo-d2ed5.firebasestorage.app",
  messagingSenderId: "75991744418",
  appId: "1:75991744418:web:70afa1b06418ddc50ffcfb",
  measurementId: "G-PJD0H9SY9Z"
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);