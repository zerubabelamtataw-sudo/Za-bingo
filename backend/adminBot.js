'use strict';

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

const token = process.env.ADMIN_BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '');

if (!token) {
  throw new Error('ADMIN_BOT_TOKEN is missing');
}

const db = admin.database();

const adminBot = new TelegramBot(token, {
  polling: true
});

function isAdmin(msg) {
  return String(msg.from?.id) === ADMIN_ID;
}

// ============================================================
// STATE
// ============================================================

const waitingForPhone = new Set();
const waitingForAmount = new Map();
const selectedPlayers = new Map();

// ============================================================
// ADMIN PANEL
// ============================================================

function showAdminPanel(chatId) {
  return adminBot.sendMessage(chatId, '🏠 ADMIN PANEL', {
    reply_markup: {
      keyboard: [
        ['👤 Players', '💰 Balances'],
        ['📩 Official SMS', '👁 View Deposit'],
['✅ Approved']
      ],
      resize_keyboard: true
    }
  });
}

// ============================================================
// PLAYERS MENU
// ============================================================

function showPlayersMenu(chatId) {
  return adminBot.sendMessage(chatId, '👤 PLAYERS', {
    reply_markup: {
      keyboard: [
        ['🔎 Find Player'],
        ['🏠 ADMIN PANEL']
      ],
      resize_keyboard: true
    }
  });
}

// ============================================================
// PLAYER ACTION MENU
// ============================================================

function showPlayerActions(chatId) {
  return adminBot.sendMessage(chatId, '👤 MANAGE PLAYER', {
    reply_markup: {
      keyboard: [
        ['➕ Add Main', '➖ Remove Main'],
        ['🎁 Add Bonus', '➖ Remove Bonus'],
        ['📋 Transactions'],
        ['👤 Players', '🏠 ADMIN PANEL']
      ],
      resize_keyboard: true
    }
  });
}

// ============================================================
// PHONE NORMALIZATION
// ============================================================

function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');

  if (digits.startsWith('251')) {
    digits = digits.slice(3);
  }

  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  return digits;
}

// ============================================================
// FIND PLAYER
// ============================================================

async function askForPlayerPhone(chatId) {
  waitingForPhone.add(String(chatId));

  await adminBot.sendMessage(
    chatId,
    '🔎 FIND PLAYER\n\nSend the player phone number.',
    {
      reply_markup: {
        keyboard: [
          ['❌ Cancel']
        ],
        resize_keyboard: true
      }
    }
  );
}

async function findPlayerByPhone(chatId, phone) {
  try {
    const searchPhone = normalizePhone(phone);

    if (!searchPhone) {
      await adminBot.sendMessage(
        chatId,
        '❌ Invalid phone number.'
      );
      return;
    }

    const snapshot = await db.ref('players').once('value');
    const players = snapshot.val() || {};

    let foundPlayer = null;
    let foundId = null;

    for (const [playerId, player] of Object.entries(players)) {
      if (!player || typeof player !== 'object') continue;

      const playerPhone = normalizePhone(
        player.phone ||
        player.phoneNumber ||
        player.mobile ||
        ''
      );

      if (playerPhone === searchPhone) {
        foundPlayer = player;
        foundId = playerId;
        break;
      }
    }

    if (!foundPlayer) {
      await adminBot.sendMessage(
        chatId,
        `❌ No player found for:\n${phone}`
      );
      return;
    }

    selectedPlayers.set(String(chatId), foundId);

    await sendPlayerProfile(chatId, foundId, foundPlayer);

  } catch (error) {
    console.error('❌ Find player error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to search for player.'
    );
  }
}

// ============================================================
// PLAYER PROFILE
// ============================================================

async function sendPlayerProfile(chatId, playerId, player) {
  const mainBalance = Number(player.balance || 0);
  const bonusBalance = Number(
    player.referralBonusBalance || 0
  );

  const totalBalance = mainBalance + bonusBalance;

  const status =
    player.status ||
    (player.blocked ? 'blocked' : 'active');

  await adminBot.sendMessage(
    chatId,
    `👤 *PLAYER FOUND*\n\n` +
    `📱 Phone: ${player.phone || player.phoneNumber || 'N/A'}\n` +
    `🆔 Telegram ID: ${playerId}\n` +
    `💰 Main Balance: ${mainBalance.toFixed(2)} Br\n` +
    `🎁 Bonus Balance: ${bonusBalance.toFixed(2)} Br\n` +
    `💵 Combined: ${totalBalance.toFixed(2)} Br\n` +
    `📌 Status: ${status}`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          ['➕ Add Main', '➖ Remove Main'],
          ['🎁 Add Bonus', '➖ Remove Bonus'],
          ['📋 Transactions'],
          ['👤 Players', '🏠 ADMIN PANEL']
        ],
        resize_keyboard: true
      }
    }
  );
}

// ============================================================
// BALANCE ACTION
// ============================================================

function startBalanceAction(chatId, action) {
  const playerId = selectedPlayers.get(String(chatId));

  if (!playerId) {
    return adminBot.sendMessage(
      chatId,
      '❌ Find a player first.'
    );
  }

  waitingForAmount.set(String(chatId), action);

  let message = '';

  if (action === 'addMain') {
    message = '➕ ADD MAIN\n\nSend the amount in Br.';
  }

  if (action === 'removeMain') {
    message = '➖ REMOVE MAIN\n\nSend the amount in Br.';
  }

  if (action === 'addBonus') {
    message = '🎁 ADD BONUS\n\nSend the amount in Br.';
  }

  if (action === 'removeBonus') {
    message = '➖ REMOVE BONUS\n\nSend the amount in Br.';
  }

  return adminBot.sendMessage(chatId, message, {
    reply_markup: {
      keyboard: [
        ['❌ Cancel']
      ],
      resize_keyboard: true
    }
  });
}

// ============================================================
// APPLY BALANCE CHANGE
// ============================================================

async function applyBalanceChange(chatId, amountText) {
  const chatKey = String(chatId);
  const action = waitingForAmount.get(chatKey);
  const playerId = selectedPlayers.get(chatKey);

  if (!action || !playerId) {
    return;
  }

  const amount = Number(
    String(amountText).replace(/,/g, '')
  );

  if (!Number.isFinite(amount) || amount <= 0) {
    await adminBot.sendMessage(
      chatId,
      '❌ Enter a valid positive amount.'
    );
    return;
  }

  try {
    const playerRef = db.ref(`players/${playerId}`);
    const snapshot = await playerRef.once('value');
    const player = snapshot.val();

    if (!player) {
      waitingForAmount.delete(chatKey);

      await adminBot.sendMessage(
        chatId,
        '❌ Player no longer exists.'
      );
      return;
    }

    const oldMain = Number(player.balance || 0);
    const oldBonus = Number(
      player.referralBonusBalance || 0
    );

    let newMain = oldMain;
    let newBonus = oldBonus;
    let balanceType = '';

    if (action === 'addMain') {
      newMain += amount;
      balanceType = 'main';
    }

    if (action === 'removeMain') {
      if (oldMain < amount) {
        await adminBot.sendMessage(
          chatId,
          `❌ Insufficient main balance.\n\nCurrent: ${oldMain.toFixed(2)} Br`
        );
        return;
      }

      newMain -= amount;
      balanceType = 'main';
    }

    if (action === 'addBonus') {
      newBonus += amount;
      balanceType = 'bonus';
    }

    if (action === 'removeBonus') {
      if (oldBonus < amount) {
        await adminBot.sendMessage(
          chatId,
          `❌ Insufficient bonus balance.\n\nCurrent: ${oldBonus.toFixed(2)} Br`
        );
        return;
      }

      newBonus -= amount;
      balanceType = 'bonus';
    }

    await playerRef.update({
      balance: newMain,
      referralBonusBalance: newBonus
    });

    const transactionRef = db.ref('transactions').push();

    await transactionRef.set({
      type: action,
      source: 'admin_bot',
      playerId: playerId,
      amount: amount,
      balanceType: balanceType,
      previousMainBalance: oldMain,
      newMainBalance: newMain,
      previousBonusBalance: oldBonus,
      newBonusBalance: newBonus,
      status: 'completed',
      adminId: ADMIN_ID,
      createdAt: Date.now()
    });

    waitingForAmount.delete(chatKey);

    await adminBot.sendMessage(
      chatId,
      `✅ BALANCE UPDATED\n\n` +
      `🆔 Player: ${playerId}\n` +
      `💰 Main: ${newMain.toFixed(2)} Br\n` +
      `🎁 Bonus: ${newBonus.toFixed(2)} Br\n` +
      `💵 Combined: ${(newMain + newBonus).toFixed(2)} Br`
    );

    const updatedSnapshot = await playerRef.once('value');
    const updatedPlayer = updatedSnapshot.val();

    await sendPlayerProfile(
      chatId,
      playerId,
      updatedPlayer
    );

  } catch (error) {
    console.error('❌ Balance change error:', error);

    waitingForAmount.delete(chatKey);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to update balance.'
    );
  }
}

// ============================================================
// BALANCE TOTALS
// ============================================================

async function showBalanceTotals(chatId) {
  try {
    const snapshot = await db.ref('players').once('value');
    const players = snapshot.val() || {};

    let realMain = 0;
    let realBonus = 0;
    let simMain = 0;
    let simBonus = 0;

    for (const player of Object.values(players)) {
      if (!player || typeof player !== 'object') continue;

      const main = Number(player.balance || 0);
      const bonus = Number(
        player.referralBonusBalance || 0
      );

      const isSim = player.isSimulated === true;

      if (isSim) {
        simMain += main;
        simBonus += bonus;
      } else {
        realMain += main;
        realBonus += bonus;
      }
    }

    const realTotal = realMain + realBonus;
    const simTotal = simMain + simBonus;

    const allMain = realMain + simMain;
    const allBonus = realBonus + simBonus;
    const allTotal = allMain + allBonus;

    await adminBot.sendMessage(
      chatId,
      `💰 *BALANCE TOTALS*\n\n` +

      `👤 *REAL PLAYERS*\n` +
      `Main: ${realMain.toFixed(2)} Br\n` +
      `Bonus: ${realBonus.toFixed(2)} Br\n` +
      `Total: ${realTotal.toFixed(2)} Br\n\n` +

      `🤖 *SIM PLAYERS*\n` +
      `Main: ${simMain.toFixed(2)} Br\n` +
      `Bonus: ${simBonus.toFixed(2)} Br\n` +
      `Total: ${simTotal.toFixed(2)} Br\n\n` +

      `🔥 *ALL PLAYERS*\n` +
      `Main: ${allMain.toFixed(2)} Br\n` +
      `Bonus: ${allBonus.toFixed(2)} Br\n` +
      `TOTAL: ${allTotal.toFixed(2)} Br`,
      {
        parse_mode: 'Markdown'
      }
    );

  } catch (error) {
    console.error('❌ Admin balance totals error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to load balance totals.'
    );
  }
}
// ============================================================
// PLAYER TRANSACTIONS
// ============================================================

async function showPlayerTransactions(chatId) {
  const playerId = selectedPlayers.get(String(chatId));

  if (!playerId) {
    await adminBot.sendMessage(
      chatId,
      '❌ Find a player first.'
    );
    return;
  }

  try {
    const snapshot = await db.ref('transactions').once('value');
    const transactions = snapshot.val() || {};

    const playerTransactions = Object.entries(transactions)
      .filter(([_, tx]) =>
        tx &&
        String(tx.playerId || '') === String(playerId)
      )
      .sort((a, b) =>
        Number(b[1].createdAt || 0) -
        Number(a[1].createdAt || 0)
      )
      .slice(0, 20);

    if (playerTransactions.length === 0) {
      await adminBot.sendMessage(
        chatId,
        `📋 TRANSACTIONS\n\nNo transactions found for:\n${playerId}`
      );
      return;
    }

    let message = `📋 *TRANSACTIONS*\n\n🆔 ${playerId}\n\n`;

    for (const [txId, tx] of playerTransactions) {
      const amount = Number(tx.amount || 0);
      const type = tx.type || 'unknown';
      const status = tx.status || 'unknown';

      message +=
        `• ${type}\n` +
        `  Amount: ${amount.toFixed(2)} Br\n` +
        `  Status: ${status}\n` +
        `  ID: ${txId}\n\n`;
    }

    await adminBot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });

  } catch (error) {
    console.error('❌ Transactions error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to load transactions.'
    );
  }
}
// ============================================================
// OFFICIAL SMS - PENDING
// ============================================================

async function showPendingOfficialSMS(chatId) {
  try {
    const snapshot = await db.ref('officialDeposits').once('value');
    const deposits = snapshot.val() || {};

    const pending = Object.entries(deposits)
      .filter(([_, deposit]) =>
        deposit &&
        deposit.status === 'available'
      )
      .sort((a, b) =>
        new Date(b[1].receivedAt || 0) -
        new Date(a[1].receivedAt || 0)
      );

    if (pending.length === 0) {
      await adminBot.sendMessage(
        chatId,
        '📩 OFFICIAL SMS\n\nNo pending deposits.'
      );
      return;
    }

    let message = `📩 *PENDING OFFICIAL SMS*\n\n`;

    pending.slice(0, 20).forEach(([transactionId, deposit], index) => {
      message +=
        `${index + 1}. 💰 ${Number(deposit.amount || 0).toFixed(2)} Br\n` +
        `🆔 ${transactionId}\n` +
        `🕒 ${deposit.receivedAt || 'N/A'}\n\n`;
    });

    await adminBot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });

  } catch (error) {
    console.error('❌ Pending official SMS error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to load official SMS.'
    );
  }
}

// ============================================================
// VIEW DEPOSIT
// ============================================================

async function viewOfficialDeposit(chatId, transactionId) {
  try {
    const snapshot = await db.ref(`officialDeposits/${transactionId}`).once('value');
    const deposit = snapshot.val();

    if (!deposit) {
      await adminBot.sendMessage(chatId, '❌ Deposit not found.');
      return;
    }

    await adminBot.sendMessage(
      chatId,
      `📩 *DEPOSIT DETAILS*\n\n` +
      `💰 Amount: ${Number(deposit.amount || 0).toFixed(2)} Br\n` +
      `🆔 Transaction ID: ${transactionId}\n` +
      `📌 Status: ${deposit.status || 'N/A'}\n` +
      `🕒 Received: ${deposit.receivedAt || 'N/A'}\n\n` +
      `📨 *SMS:*\n${deposit.sms || 'N/A'}`,
      {
        parse_mode: 'Markdown'
      }
    );

  } catch (error) {
    console.error('❌ View deposit error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to load deposit.'
    );
  }
}


// ============================================================
// MESSAGE HANDLER
// ============================================================

adminBot.on('message', async (msg) => {
  if (!isAdmin(msg)) return;

  try {
    const chatId = msg.chat.id;
    const chatKey = String(chatId);
    const text = msg.text;

    if (!text) return;

    // ----------------------------
    // START
    // ----------------------------

    if (text === '/start') {
      waitingForPhone.delete(chatKey);
      waitingForAmount.delete(chatKey);
      selectedPlayers.delete(chatKey);

      await showAdminPanel(chatId);
      return;
    }

    // ----------------------------
    // ADMIN PANEL
    // ----------------------------

    if (text === '🏠 ADMIN PANEL') {
      waitingForPhone.delete(chatKey);
      waitingForAmount.delete(chatKey);

      await showAdminPanel(chatId);
      return;
    }

    // ----------------------------
    // PLAYERS
    // ----------------------------

    if (text === '👤 Players') {
      waitingForPhone.delete(chatKey);
      waitingForAmount.delete(chatKey);

      await showPlayersMenu(chatId);
      return;
    }

    // ----------------------------
    // FIND PLAYER
    // ----------------------------

    if (text === '🔎 Find Player') {
      waitingForAmount.delete(chatKey);

      await askForPlayerPhone(chatId);
      return;
    }

    // ----------------------------
    // BALANCE ACTIONS
    // ----------------------------

    if (text === '➕ Add Main') {
      await startBalanceAction(chatId, 'addMain');
      return;
    }

    if (text === '➖ Remove Main') {
      await startBalanceAction(chatId, 'removeMain');
      return;
    }

    if (text === '🎁 Add Bonus') {
      await startBalanceAction(chatId, 'addBonus');
      return;
    }

    if (text === '➖ Remove Bonus') {
      await startBalanceAction(chatId, 'removeBonus');
      return;
    }
    if (text === '📋 Transactions') {
  await showPlayerTransactions(chatId);
  return;
}

    // ----------------------------
    // CANCEL
    // ----------------------------

    if (text === '❌ Cancel') {
      waitingForPhone.delete(chatKey);
      waitingForAmount.delete(chatKey);

      await showPlayersMenu(chatId);
      return;
    }

    // ----------------------------
    // AMOUNT INPUT
    // ----------------------------

    if (waitingForAmount.has(chatKey)) {
      await applyBalanceChange(chatId, text);
      return;
    }

    // ----------------------------
    // PHONE SEARCH
    // ----------------------------

    if (waitingForPhone.has(chatKey)) {
      waitingForPhone.delete(chatKey);

      await findPlayerByPhone(chatId, text);
      return;
    }

    // ----------------------------
    // BALANCES
    // ----------------------------

    if (text === '💰 Balances') {
      await showBalanceTotals(chatId);
      return;
    }
    if (text === '📩 Official SMS') {
  await showPendingOfficialSMS(chatId);
  return;
}

  } catch (error) {
    console.error('❌ Admin bot error:', error);
  }
});

console.log('✅ Admin bot started');

module.exports = { adminBot };