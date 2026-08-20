// ============================================================
// ZA BINGO — ADMIN PAGE
// ============================================================

import { db } from './firebase-config.js';
import {
  ref,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";


// ============================================================
// ADMIN LOGIN
// ============================================================

const loginScreen = document.getElementById('loginScreen');
const adminDashboard = document.getElementById('adminDashboard');

document.getElementById('loginBtn').addEventListener('click', async () => {

  const password = document.getElementById('adminPassword').value;
  const message = document.getElementById('loginMessage');

  if (!password) {
    message.textContent = 'Enter admin password.';
    return;
  }

  try {

    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      message.textContent = '❌ Invalid admin password.';
      return;
    }

    loginScreen.style.display = 'none';
    adminDashboard.style.display = 'block';

  } catch (error) {

    console.error('Admin login error:', error);

    message.textContent =
      '❌ Could not connect to the server.';

  }

});
// ============================================================
// PLAYERS
// ============================================================

const playersRef = ref(db, 'players');

let allPlayers = {};

onValue(playersRef, (snapshot) => {

  allPlayers = snapshot.val() || {};

  renderPlayers(allPlayers);

  let count = 0;
  let totalBalance = 0;

  Object.values(allPlayers).forEach(player => {

    if (!player) return;

    count++;
    totalBalance += Number(player.balance || 0);

  });

  document.getElementById('playersCount').textContent = count;

  document.getElementById('totalBalance').textContent =
    `${totalBalance.toFixed(2)} Br`;

});


// ============================================================
// RENDER PLAYERS
// ============================================================

function renderPlayers(players) {

  const list = document.getElementById('playersList');

  list.innerHTML = '';

  Object.entries(players).forEach(([id, player]) => {

    if (!player) return;

    const div = document.createElement('div');

    div.style.padding = '12px';
    div.style.borderBottom = '1px solid #263044';

    div.innerHTML = `
      <strong>${player.first_name || 'Player'}</strong><br>
      ID: ${id}<br>
      Username: @${player.username || 'N/A'}<br>
      Phone: ${player.phone || 'N/A'}<br>
      Balance: ${Number(player.balance || 0).toFixed(2)} Br
    `;

    list.appendChild(div);

  });

}


// ============================================================
// PLAYER SEARCH
// ============================================================

document.getElementById('playerSearch').addEventListener('input', (event) => {

  const search = event.target.value
    .toLowerCase()
    .trim();

  if (!search) {
    renderPlayers(allPlayers);
    return;
  }

  const filtered = {};

  Object.entries(allPlayers).forEach(([id, player]) => {

    if (!player) return;

    const name = String(player.first_name || '').toLowerCase();
    const username = String(player.username || '').toLowerCase();
    const phone = String(player.phone || '');

const normalizePhone = (value) => {

  value = value.replace(/\D/g, '');

  if (value.startsWith('0')) {
    return '251' + value.substring(1);
  }

  if (value.startsWith('251')) {
    return value;
  }

  return value;
};

const searchPhone = normalizePhone(search);
const playerPhone = normalizePhone(phone);

if (
  id.toLowerCase().includes(search) ||
  name.includes(search) ||
  username.includes(search) ||
  playerPhone.includes(searchPhone)
) {
  filtered[id] = player;
}

  });

  renderPlayers(filtered);

});


// ============================================================
// LOGOUT
// ============================================================

document.getElementById('logoutBtn').addEventListener('click', () => {

  adminDashboard.style.display = 'none';
  loginScreen.style.display = 'flex';

  document.getElementById('adminPassword').value = '';
  document.getElementById('loginMessage').textContent = '';

});
// ============================================================
// ADMIN — ADD BALANCE
// ============================================================

document.getElementById('addBalanceBtn').addEventListener('click', async () => {

  const playerId =
    document.getElementById('balancePlayerId').value.trim();

  const amount =
    Number(document.getElementById('balanceAmount').value);

  const message =
    document.getElementById('balanceMessage');

  if (!playerId) {
    message.textContent = '❌ Enter Player ID.';
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    message.textContent = '❌ Enter a valid amount.';
    return;
  }

  const password =
    document.getElementById('adminPassword').value;

  try {

    const response = await fetch('/api/admin/add-balance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        password,
        playerId,
        amount
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      message.textContent =
        `❌ ${result.message || 'Failed to add balance.'}`;
      return;
    }

    message.textContent =
      `✅ Added ${amount.toFixed(2)} Br. New balance: ${result.newBalance.toFixed(2)} Br`;

    document.getElementById('balanceAmount').value = '';

  } catch (error) {

    console.error('Add balance error:', error);

    message.textContent =
      '❌ Could not connect to server.';
  }

});
// ============================================================
// ADMIN — DEPOSITS
// ============================================================

const transactionsRef = ref(db, 'transactions');

onValue(transactionsRef, (snapshot) => {

  const transactions = snapshot.val() || {};

  const depositsList =
    document.getElementById('depositsList');

  let count = 0;

  depositsList.innerHTML = '';

  Object.entries(transactions).forEach(([id, transaction]) => {

    if (!transaction) return;

    if (transaction.type !== 'deposit') return;

    count++;

    const div = document.createElement('div');

    div.style.padding = '12px';
    div.style.borderBottom = '1px solid #263044';

    div.innerHTML = `
      <strong>Deposit: ${Number(transaction.amount || 0).toFixed(2)} Br</strong><br>
      Player: ${transaction.playerId || transaction.telegramId || 'N/A'}<br>
      Method: ${transaction.paymentMethod || 'N/A'}<br>
      Status: ${transaction.status || 'N/A'}<br>
      Transaction ID: ${transaction.transactionId || 'N/A'}<br>
      Date: ${transaction.createdAt || 'N/A'}
    `;

    depositsList.appendChild(div);

  });

  document.getElementById('depositCount').textContent = count;

});
// ============================================================
// ADMIN — WITHDRAWALS
// ============================================================

onValue(transactionsRef, (snapshot) => {

  const transactions = snapshot.val() || {};

  const withdrawalsList =
    document.getElementById('withdrawalsList');

  let count = 0;

  withdrawalsList.innerHTML = '';

  Object.entries(transactions).forEach(([id, transaction]) => {

    if (!transaction) return;

    if (transaction.type !== 'withdrawal') return;

    count++;

    const div = document.createElement('div');

    div.style.padding = '12px';
    div.style.borderBottom = '1px solid #263044';

    div.innerHTML = `
      <strong>
        Withdrawal: ${Number(transaction.amount || 0).toFixed(2)} Br
      </strong><br>

      Player:
      ${transaction.playerId || transaction.telegramId || 'N/A'}<br>

      Method:
      ${transaction.paymentMethod || 'N/A'}<br>

      Status:
      ${transaction.status || 'N/A'}<br>

      Transaction ID:
      ${transaction.transactionId || 'Pending'}<br>

      Date:
      ${transaction.createdAt || 'N/A'}
    `;

    withdrawalsList.appendChild(div);

  });

  document.getElementById('withdrawalCount').textContent = count;

});
// ============================================================
// ADMIN — ALL TRANSACTIONS
// ============================================================

onValue(transactionsRef, (snapshot) => {

  const transactions = snapshot.val() || {};

  const transactionsList =
    document.getElementById('transactionsList');

  transactionsList.innerHTML = '';

  Object.entries(transactions).forEach(([id, transaction]) => {

    if (!transaction) return;

    const div = document.createElement('div');

    div.style.padding = '12px';
    div.style.borderBottom = '1px solid #263044';

    div.innerHTML = `
      <strong>
        ${transaction.type || 'Transaction'}
      </strong><br>

      Player:
      ${transaction.playerId || transaction.telegramId || 'N/A'}<br>

      Amount:
      ${Number(transaction.amount || 0).toFixed(2)} Br<br>

      Status:
      ${transaction.status || 'N/A'}<br>

      Transaction ID:
      ${transaction.transactionId || 'N/A'}<br>

      Date:
      ${transaction.createdAt || 'N/A'}
    `;

    transactionsList.appendChild(div);

  });

});
// ============================================================
// ADMIN — BOTTOM NAVIGATION
// ============================================================

const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');

navItems.forEach((navItem) => {

  navItem.addEventListener('click', () => {

    const targetTab = navItem.dataset.tab;

    // Remove active from all navigation buttons
    navItems.forEach(item => {
      item.classList.remove('active');
    });

    // Hide all tabs
    tabContents.forEach(tab => {
      tab.classList.remove('active');
    });

    // Activate selected navigation button
    navItem.classList.add('active');

    // Show selected tab
    const selectedTab =
      document.getElementById(targetTab);

    if (selectedTab) {
      selectedTab.classList.add('active');
    }

  });

});