/**
 * ZA Bingo - Admin Telegram Bot
 * Production-Ready Management & Monitoring Bot
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

// ==========================================
// 1. IMPORTS & CONFIGURATION
// ==========================================

const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID ? String(process.env.ADMIN_ID).trim() : null;
const BONUS_CHANNEL = '@EdelBingoo';

if (!ADMIN_BOT_TOKEN) {
  console.error('[FATAL] ADMIN_BOT_TOKEN is missing in environment variables.');
}

if (!ADMIN_ID) {
  console.error('[FATAL] ADMIN_ID is missing in environment variables.');
}

// Database Connection
let db;
try {
  db = require('./firebase.js');
} catch (e) {
  try {
    db = require('./firebase');
  } catch (err) {
    console.error('[FATAL] Failed to load Firebase database reference:', err.message);
  }
}

// ==========================================
// 2. BOT INITIALIZATION
// ==========================================

const bot = new TelegramBot(ADMIN_BOT_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: { timeout: 10 }
  }
});

bot.on('polling_error', (error) => {
  console.error('[Polling Error]', error.code || error.message);
});

// ==========================================
// 3. SECURITY & ADMIN VERIFICATION
// ==========================================

/**
 * Validates whether the given user ID matches the authorized ADMIN_ID
 */
function isAuthorizedAdmin(userId) {
  if (!ADMIN_ID || !userId) return false;
  return String(userId).trim() === ADMIN_ID;
}

/**
 * Guard function for commands and messages
 */
async function guardAdminMessage(msg) {
  const userId = msg.from ? msg.from.id : null;
  if (!isAuthorizedAdmin(userId)) {
    console.warn(`[SECURITY] Unauthorized message attempt from Telegram ID: ${userId}`);
    await bot.sendMessage(
      msg.chat.id,
      '⛔ *Access Denied*\n\nThis bot is strictly reserved for authorized administrators of ZA Bingo.',
      { parse_mode: 'Markdown' }
    ).catch(() => {});
    return false;
  }
  return true;
}

/**
 * Guard function for callback queries
 */
async function guardAdminCallback(query) {
  const userId = query.from ? query.from.id : null;
  if (!isAuthorizedAdmin(userId)) {
    console.warn(`[SECURITY] Unauthorized callback attempt from Telegram ID: ${userId}`);
    await bot.answerCallbackQuery(query.id, {
      text: '⛔ Unauthorized. Admin access only.',
      show_alert: true
    }).catch(() => {});
    return false;
  }
  return true;
}

// ==========================================
// 4. SESSION UTILITIES
// ==========================================

// In-memory admin session storage with TTL expiration (15 minutes)
const sessions = new Map();
const SESSION_TTL_MS = 15 * 60 * 1000;

function getSession(userId) {
  const id = String(userId);
  const session = sessions.get(id);
  if (!session) return null;

  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return session;
}

function setSession(userId, data) {
  const id = String(userId);
  sessions.set(id, {
    ...data,
    updatedAt: Date.now(),
    createdAt: (sessions.get(id) && sessions.get(id).createdAt) || Date.now()
  });
}

function clearSession(userId) {
  const id = String(userId);
  sessions.delete(id);
}

// ==========================================
// 5. FIREBASE & UTILITY FUNCTIONS
// ==========================================

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return `${num.toFixed(2)} Br`;
}

function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  } catch {
    return 'N/A';
  }
}

function generateTxId(prefix = 'ADM') {
  const time = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `${prefix}_${time}_${rand}`;
}

function getGamesWonCount(playerData) {
  if (!playerData) return 0;
  if (typeof playerData.gamesWon === 'number') return playerData.gamesWon;
  if (typeof playerData.games_won === 'number') return playerData.games_won;
  return 0;
}

/**
 * Safely executes atomic balance changes using Firebase transactions
 */
async function atomicBalanceUpdate(telegramId, field, delta, options = {}) {
  const validFields = ['balance', 'referralBonusBalance'];
  if (!validFields.includes(field)) {
    throw new Error(`Invalid balance field: ${field}`);
  }

  const targetRef = db.ref(`players/${String(telegramId)}/${field}`);
  let previousValue = 0;
  let finalValue = 0;

  const result = await targetRef.transaction((current) => {
    const currVal = typeof current === 'number' ? current : 0;
    previousValue = currVal;
    const newVal = currVal + delta;

    if (options.preventNegative && newVal < 0) {
      return; // Abort: insufficient funds
    }

    finalValue = Math.round(newVal * 100) / 100;
    return finalValue;
  });

  if (!result.committed) {
    return { success: false, reason: 'INSUFFICIENT_FUNDS_OR_ABORTED' };
  }

  return {
    success: true,
    previousBalance: previousValue,
    newBalance: finalValue
  };
}

async function getPlayer(telegramId) {
  const snapshot = await db.ref(`players/${String(telegramId)}`).once('value');
  if (!snapshot.exists()) return null;
  return { ...snapshot.val(), telegramId: String(telegramId) };
}

// ==========================================
// 6. MAIN MENU
// ==========================================

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '👥 Players', callback_data: 'nav_players' },
        { text: '🎮 Game Rooms', callback_data: 'nav_rooms' }
      ],
      [
        { text: '💰 Transactions', callback_data: 'nav_transactions' },
        { text: '💸 Withdrawals', callback_data: 'nav_withdrawals' }
      ],
      [
        { text: '🏆 Winners', callback_data: 'nav_winners' },
        { text: '📊 Statistics', callback_data: 'nav_stats' }
      ],
      [
        { text: '📢 Bonus / Channel', callback_data: 'nav_bonus' },
        { text: '⚙️ System Status', callback_data: 'nav_system' }
      ]
    ]
  };
}

async function sendMainMenu(chatId, messageId = null) {
  const text =
    `👑 *ZA Bingo — Admin Control Center*\n\n` +
    `Welcome, Admin! Select a management module below to view live data and control platform operations:`;

  const options = {
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard()
  };

  if (messageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...options
      });
      return;
    } catch {
      // Fallback to sending new message if edit fails
    }
  }

  await bot.sendMessage(chatId, text, options);
}

// ==========================================
// 7. PLAYER MANAGEMENT
// ==========================================

async function renderPlayersMenu(chatId, messageId = null) {
  const text =
    `👥 *Player Management*\n\n` +
    `Choose an action to browse or search registered players:`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📋 View Recent Players', callback_data: 'players_list_recent' },
        { text: '🔍 Search Player', callback_data: 'players_search_prompt' }
      ],
      [{ text: '🔙 Back to Menu', callback_data: 'nav_main_menu' }]
    ]
  };

  const options = { parse_mode: 'Markdown', reply_markup: keyboard };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
      return;
    } catch {}
  }
  await bot.sendMessage(chatId, text, options);
}

async function renderRecentPlayers(chatId, messageId = null) {
  const snapshot = await db.ref('players').limitToLast(10).once('value');
  const playersData = snapshot.val() || {};
  const keys = Object.keys(playersData).reverse();

  if (keys.length === 0) {
    const keyboard = {
      inline_keyboard: [[{ text: '🔙 Back to Players', callback_data: 'nav_players' }]]
    };
    await bot.sendMessage(chatId, 'ℹ️ No registered players found in database.', {
      reply_markup: keyboard
    });
    return;
  }

  const buttons = keys.map((id) => {
    const p = playersData[id];
    const name = p.firstName || p.username || `User ${id}`;
    const bal = formatCurrency(p.balance || 0);
    return [{ text: `👤 ${name} (${bal})`, callback_data: `player_view_${id}` }];
  });

  buttons.push([{ text: '🔙 Back to Players', callback_data: 'nav_players' }]);

  const text = `📋 *Recent Players (Last ${keys.length})*\n\nSelect a player below to inspect or manage:`;
  const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
      return;
    } catch {}
  }
  await bot.sendMessage(chatId, text, options);
}

async function renderPlayerDetails(chatId, telegramId, messageId = null) {
  const player = await getPlayer(telegramId);
  if (!player) {
    await bot.sendMessage(chatId, `❌ Player \`${telegramId}\` not found in database.`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Back', callback_data: 'nav_players' }]]
      }
    });
    return;
  }

  const text =
    `👤 *Player Details*\n\n` +
    `• *First Name:* ${player.firstName || 'N/A'}\n` +
    `• *Last Name:* ${player.lastName || 'N/A'}\n` +
    `• *Username:* ${player.username ? '@' + player.username : 'N/A'}\n` +
    `• *Telegram ID:* \`${player.telegramId}\`\n` +
    `• *Phone:* \`${player.phone || 'Not registered'}\`\n` +
    `• *Main Balance:* *${formatCurrency(player.balance)}*\n` +
    `• *Referral Bonus:* *${formatCurrency(player.referralBonusBalance)}*\n` +
    `• *Games Won:* *${getGamesWonCount(player)}*\n` +
    `• *Registered:* ${formatDate(player.createdAt)}\n` +
    `• *Last Active:* ${formatDate(player.lastActiveAt)}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '💰 Add Balance', callback_data: `p_act_add_bal_${telegramId}` },
        { text: '💸 Remove Balance', callback_data: `p_act_rem_bal_${telegramId}` }
      ],
      [
        { text: '🎁 Add Referral Bonus', callback_data: `p_act_add_ref_${telegramId}` },
        { text: '🧾 Transactions', callback_data: `p_act_txs_${telegramId}` }
      ],
      [
        { text: '🗑️ Delete Player', callback_data: `p_act_del_confirm_${telegramId}` }
      ],
      [
        { text: '🔙 Back to Players', callback_data: 'nav_players' }
      ]
    ]
  };

  const options = { parse_mode: 'Markdown', reply_markup: keyboard };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
      return;
    } catch {}
  }
  await bot.sendMessage(chatId, text, options);
}

// Search players by ID, phone, username, or name
async function searchPlayers(query) {
  const snapshot = await db.ref('players').once('value');
  const allPlayers = snapshot.val() || {};
  const q = String(query).trim().toLowerCase();

  const results = [];
  for (const id of Object.keys(allPlayers)) {
    const p = allPlayers[id];
    const username = (p.username || '').toLowerCase();
    const firstName = (p.firstName || '').toLowerCase();
    const lastName = (p.lastName || '').toLowerCase();
    const phone = (p.phone || '').toLowerCase();

    if (
      id.toLowerCase().includes(q) ||
      username.includes(q.replace('@', '')) ||
      firstName.includes(q) ||
      lastName.includes(q) ||
      phone.includes(q)
    ) {
      results.push({ ...p, telegramId: id });
    }
    if (results.length >= 10) break;
  }
  return results;
}

// ==========================================
// 8. WITHDRAWAL MANAGEMENT
// ==========================================

async function renderWithdrawals(chatId, messageId = null) {
  const snapshot = await db.ref('transactions')
    .orderByChild('type')
    .equalTo('withdrawal')
    .limitToLast(30)
    .once('value');

  const data = snapshot.val() || {};
  const withdrawals = Object.values(data).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const pending = withdrawals.filter((w) => w.status === 'pending');
  const processed = withdrawals.filter((w) => w.status !== 'pending').slice(0, 5);

  let text = `💸 *Withdrawal Requests*\n\n`;

  if (pending.length === 0) {
    text += `✅ *No pending withdrawal requests.*\n\n`;
  } else {
    text += `⚠️ *Pending Approvals (${pending.length}):*\n\n`;
  }

  const buttons = [];

  // Show pending withdrawals with Approve / Reject buttons
  for (const item of pending) {
    const sourceLabel = item.source === 'referralBonusBalance' ? 'Referral Bonus' : 'Main Balance';
    text +=
      `🆔 *ID:* \`${item.id}\`\n` +
      `👤 *Player:* ${item.firstName || 'Player'} (@${item.username || 'N/A'})\n` +
      `🆔 *TG ID:* \`${item.telegramId}\`\n` +
      `💰 *Amount:* *${formatCurrency(item.amount)}*\n` +
      `📂 *Source:* ${sourceLabel}\n` +
      `🏦 *Method:* ${item.paymentMethod || 'Telebirr/CBE'}\n` +
      `📱 *Account:* \`${item.destinationAccount || 'N/A'}\`\n` +
      `📅 *Requested:* ${formatDate(item.createdAt)}\n` +
      `⚡ *Status:* ⏳ *PENDING*\n\n`;

    buttons.push([
      { text: `✅ Approve ${item.id}`, callback_data: `w_app_${item.id}` },
      { text: `❌ Reject ${item.id}`, callback_data: `w_rej_${item.id}` }
    ]);
  }

  // Display recent processed history
  if (processed.length > 0) {
    text += `📜 *Recently Processed:*\n`;
    for (const item of processed) {
      const statusIcon = item.status === 'approved' ? '✅' : '❌';
      text += `• \`${item.id}\` | ${formatCurrency(item.amount)} | ${statusIcon} ${item.status.toUpperCase()}\n`;
    }
  }

  buttons.push([{ text: '🔄 Refresh', callback_data: 'nav_withdrawals' }]);
  buttons.push([{ text: '🔙 Back to Menu', callback_data: 'nav_main_menu' }]);

  const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
      return;
    } catch {}
  }
  await bot.sendMessage(chatId, text, options);
}

/**
 * Atomic withdrawal processing to strictly prevent double processing
 */
async function processWithdrawalDecision(chatId, txId, isApproved) {
  const txRef = db.ref(`transactions/${txId}`);

  let txData = null;
  let alreadyProcessed = false;

  // Step 1: Atomically claim and lock transaction status
  const txResult = await txRef.transaction((current) => {
    if (!current) return;
    if (current.status !== 'pending') {
      alreadyProcessed = true;
      return; // Already approved or rejected
    }

    txData = { ...current };
    return {
      ...current,
      status: isApproved ? 'approved' : 'rejected',
      processedAt: Date.now(),
      processedBy: ADMIN_ID
    };
  });

  if (alreadyProcessed || !txResult.committed || !txData) {
    await bot.sendMessage(
      chatId,
      `⚠️ Withdrawal request \`${txId}\` has already been processed or is no longer pending.`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Withdrawals', callback_data: 'nav_withdrawals' }]] } }
    );
    return;
  }

  const { telegramId, amount, source, destinationAccount } = txData;
  const balanceField = source === 'referralBonusBalance' ? 'referralBonusBalance' : 'balance';

  if (isApproved) {
    // Step 2: Atomically deduct player balance safely with negative prevention
    const deduction = await atomicBalanceUpdate(telegramId, balanceField, -amount, {
      preventNegative: true
    });

    if (!deduction.success) {
      // Revert status to rejected if balance was insufficient at processing time
      await txRef.update({
        status: 'rejected',
        rejectionReason: 'Insufficient player balance at approval time',
        updatedAt: Date.now()
      });

      await bot.sendMessage(
        chatId,
        `❌ *Approval Aborted:* Player \`${telegramId}\` has insufficient balance. Request \`${txId}\` was rejected automatically.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Withdrawals', callback_data: 'nav_withdrawals' }]] } }
      );

      // Notify player safely
      await bot.sendMessage(
        telegramId,
        `❌ *Withdrawal Update*\n\nYour withdrawal request \`${txId}\` for *${formatCurrency(amount)}* could not be processed due to insufficient account balance.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      return;
    }

    await bot.sendMessage(
      chatId,
      `✅ *Withdrawal Approved Successfully!*\n\n` +
        `🆔 *TX ID:* \`${txId}\`\n` +
        `👤 *Player:* \`${telegramId}\`\n` +
        `💰 *Deducted:* *${formatCurrency(amount)}*\n` +
        `📱 *Destination:* \`${destinationAccount}\`\n` +
        `💳 *Remaining Balance:* *${formatCurrency(deduction.newBalance)}*`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Withdrawals', callback_data: 'nav_withdrawals' }]] } }
    );

    // Notify player
    await bot.sendMessage(
      telegramId,
      `🎉 *Withdrawal Approved!*\n\n` +
        `Your withdrawal of *${formatCurrency(amount)}* has been approved and processed to your account \`${destinationAccount}\`.\n` +
        `Thank you for playing ZA Bingo! 🇪🇹🎱`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  } else {
    // Rejected
    await bot.sendMessage(
      chatId,
      `🚫 *Withdrawal Rejected*\n\nRequest ID: \`${txId}\`\nAmount: ${formatCurrency(amount)}`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Withdrawals', callback_data: 'nav_withdrawals' }]] } }
    );

    // Notify player
    await bot.sendMessage(
      telegramId,
      `❌ *Withdrawal Request Rejected*\n\n` +
        `Your withdrawal request \`${txId}\` for *${formatCurrency(amount)}* was declined by the administrator.\n` +
        `No funds were deducted. Please contact support if you need assistance.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
}

// ==========================================
// 9. TRANSACTIONS MANAGEMENT
// ==========================================

async function renderTransactionsMenu(chatId, filter = 'all', messageId = null) {
  let queryRef = db.ref('transactions').limitToLast(25);
  if (filter !== 'all') {
    queryRef = db.ref('transactions').orderByChild('type').equalTo(filter).limitToLast(25);
  }

  const snapshot = await queryRef.once('value');
  const data = snapshot.val() || {};
  const txList = Object.values(data).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  let text = `💰 *Transactions Log (${filter.toUpperCase()})*\n\n`;

  if (txList.length === 0) {
    text += `_No transactions found under this filter._\n`;
  } else {
    for (const t of txList.slice(0, 15)) {
      const dateStr = formatDate(t.createdAt).substring(5, 16);
      const icon =
        t.type === 'deposit' ? '📥' :
        t.type === 'withdrawal' ? '📤' :
        t.type === 'transfer' ? '🔄' : '⚙️';

      text += `${icon} \`${t.id || 'N/A'}\` | *${formatCurrency(t.amount)}*\n`;
      text += `   • *Type:* ${t.type} | *Status:* ${t.status || 'approved'}\n`;
      text += `   • *User:* \`${t.telegramId || t.senderId || 'N/A'}\` | *Date:* ${dateStr}\n\n`;
    }
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: filter === 'all' ? '🔘 All' : 'All', callback_data: 'tx_filter_all' },
        { text: filter === 'deposit' ? '🔘 Deposits' : 'Deposits', callback_data: 'tx_filter_deposit' }
      ],
      [
        { text: filter === 'withdrawal' ? '🔘 Withdrawals' : 'Withdrawals', callback_data: 'tx_filter_withdrawal' },
        { text: filter === 'transfer' ? '🔘 Transfers' : 'Transfers', callback_data: 'tx_filter_transfer' }
      ],
      [{ text: '🔙 Back to Menu', callback_data: 'nav_main_menu' }]
    ]
  };

  const options = { parse_mode: 'Markdown', reply_markup: keyboard };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
      return;
    } catch {}
  }
  await bot.sendMessage(chatId, text, options);
}

// ==========================================
// 10. GAME ROOMS MONITORING
// ==========================================

async function renderGameRooms(chatId, messageId = null) {
  // Read rooms from Firebase (supports 'rooms' or 'game_rooms')
  let snapshot = await db.ref('rooms').once('value');
  if (!snapshot.exists()) {
    snapshot = await db.ref('game_rooms').once('value');
  }

  const roomsData = snapshot.val() || {};

  // Standard ZA Bingo rooms
  const targetRooms = [
    { id: 'room_5', name: '5 Br Room', stake: 5 },
    { id: 'room_10', name: '10 Br Room', stake: 10 },
    { id: 'room_20', name: '20 Br Room', stake: 20 }
  ];

  let text = `🎮 *Live Game Rooms Monitoring*\n\n`;

  for (const r of targetRooms) {
    const live = roomsData[r.id] || {};
    const playersCount = live.players ? Object.keys(live.players).length : (live.playerCount || 0);
    const status = live.status || 'Waiting for players';
    const pot = live.pot || (playersCount * r.stake);
    const state = live.gameState || live.state || 'Idle';

    text +=
      `🎱 *${r.name}*\n` +
      `• *Stake:* ${r.stake} Br\n` +
      `• *Active Players:* ${playersCount}\n` +
      `• *Current Pot:* *${formatCurrency(pot)}*\n` +
      `• *Status:* ${status}\n` +
      `• *Game State:* ${state}\n\n`;
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: '🔄 Refresh Rooms', callback_data: 'nav_rooms' }],
      [{ text: '🔙 Back to Menu', callback_data: 'nav_main_menu' }]
    ]
  };

  const options = { parse_mode: 'Markdown', reply_markup: keyboard };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
      return;
    } catch {}
  }
  await bot.sendMessage(chatId, text, options);
}

// ==========================================
// 11. WINNERS
// ==========================================

async function renderWinners(chatId, messageId = null) {
  let snapshot = await db.ref('winners').limitToLast(15).once('value');
  if (!snapshot.exists()) {
    snapshot = await db.ref('game_winners').limitToLast(15).once('value');
  }

  const data = snapshot.val() || {};
  const winnersList = Object.values(data).sort((a, b) => (b.timestamp || b.createdAt || 0) - (a.timestamp || a.createdAt || 0));

  let text = `🏆 *Recent Game Winners*\n\n`;

  if (winnersList.length === 0) {
    text += `_No recent game winners recorded._\n`;
  } else {
    for (const w of winnersList.slice(0, 10)) {
      const prize = formatCurrency(w.prize || w.amount || 0);
      const name = w.firstName || w.playerName || w.username || `Player ${w.telegramId || ''}`;
      const room = w.roomName || (w.stake ? `${w.stake} Br Room` : 'Bingo Room');
      const date = formatDate(w.timestamp || w.createdAt);

      text +=
        `🥇 *${name}* won *${prize}*\n` +
        `   • *TG ID:* \`${w.telegramId || 'N/A'}\`\n` +
        `   • *Room:* ${room}\n` +
        `   • *Date:* ${date}\n\n`;
    }
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: '🔄 Refresh', callback_data: 'nav_winners' }],
      [{ text: '🔙 Back to Menu', callback_data: 'nav_main_menu' }]
    ]
  };

  const options = { parse_mode: 'Markdown', reply_markup: keyboard };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
      return;
    } catch {}
  }
  await bot.sendMessage(chatId, text, options);
}

// ==========================================
// 12. STATISTICS
// ==========================================

async function renderStatistics(chatId, messageId = null) {
  // Fetch players summary
  const playersSnap = await db.ref('players').once('value');
  const players = playersSnap.val() || {};
  const playerIds = Object.keys(players);

  const totalPlayers = playerIds.length;
  let totalMainBalance = 0;
  let totalReferralBalance = 0;
  let totalGamesWon = 0;
  let activePlayers = 0;

  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  for (const id of playerIds) {
    const p = players[id];
    totalMainBalance += Number(p.balance) || 0;
    totalReferralBalance += Number(p.referralBonusBalance) || 0;
    totalGamesWon += getGamesWonCount(p);

    if (p.lastActiveAt && (now - p.lastActiveAt) <= (ONE_DAY_MS * 3)) {
      activePlayers++;
    }
  }

  // Fetch transactions summary
  const txSnap = await db.ref('transactions').once('value');
  const txData = txSnap.val() || {};
  const txList = Object.values(txData);

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let pendingWithdrawals = 0;

  for (const t of txList) {
    if (t.type === 'deposit' && (t.status === 'approved' || !t.status)) {
      totalDeposits += Number(t.amount) || 0;
    }
    if (t.type === 'withdrawal') {
      if (t.status === 'pending') {
        pendingWithdrawals++;
      } else if (t.status === 'approved') {
        totalWithdrawals += Number(t.amount) || 0;
      }
    }
  }

  const text =
    `📊 *ZA Bingo — Platform Statistics*\n\n` +
    `👥 *User Metrics:*\n` +
    `• Total Registered Players: *${totalPlayers}*\n` +
    `• Active Players (Last 72h): *${activePlayers}*\n` +
    `• Total Games Won: *${totalGamesWon}*\n\n` +
    `💰 *Financial Balances:*\n` +
    `• Total Main Balance Held: *${formatCurrency(totalMainBalance)}*\n` +
    `• Total Referral Bonus Held: *${formatCurrency(totalReferralBalance)}*\n\n` +
    `💳 *Cash Flow:*\n` +
    `• Total Approved Deposits: *${formatCurrency(totalDeposits)}*\n` +
    `• Total Approved Withdrawals: *${formatCurrency(totalWithdrawals)}*\n` +
    `• Pending Withdrawal Requests: *${pendingWithdrawals}*\n` +
    `• Total Transactions Logged: *${txList.length}*`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🔄 Refresh Statistics', callback_data: 'nav_stats' }],
      [{ text: '🔙 Back to Menu', callback_data: 'nav_main_menu' }]
    ]
  };

  const options = { parse_mode: 'Markdown', reply_markup: keyboard };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
      return;
    } catch {}
  }
  await bot.sendMessage(chatId, text, options);
}

// ==========================================
// 13. BONUS / CHANNEL
// ==========================================

async function renderBonusChannel(chatId, messageId = null) {
  const channelHandle = BONUS_CHANNEL.replace('@', '');
  const text =
    `📢 *ZA Bingo Official Channel*\n\n` +
    `• *Configured Channel:* ${BONUS_CHANNEL}\n` +
    `• *Link:* https://t.me/${channelHandle}\n\n` +
    `You can post game updates, daily bonus codes, or maintenance notices directly.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🌐 Open Channel', url: `https://t.me/${channelHandle}` }],
      [{ text: '✍️ Broadcast Announcement', callback_data: 'bonus_broadcast_prompt' }],
      [{ text: '🔙 Back to Menu', callback_data: 'nav_main_menu' }]
    ]
  };

  const options = { parse_mode: 'Markdown', reply_markup: keyboard };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
      return;
    } catch {}
  }
  await bot.sendMessage(chatId, text, options);
}

// ==========================================
// 14. SYSTEM STATUS
// ==========================================

async function renderSystemStatus(chatId, messageId = null) {
  // Test Firebase connectivity safely
  let dbStatus = 'Operational ✅';
  try {
    const testRef = db.ref('.info/connected');
    const snap = await testRef.once('value');
    if (snap.val() === false) {
      dbStatus = 'Connecting... ⚠️';
    }
  } catch (err) {
    dbStatus = 'Error ❌';
  }

  // Count pending withdrawals
  const pendingSnap = await db.ref('transactions')
    .orderByChild('status')
    .equalTo('pending')
    .once('value');

  const pendingCount = pendingSnap.val() ? Object.keys(pendingSnap.val()).length : 0;
  const activeSessionsCount = sessions.size;

  const text =
    `⚙️ *System Status & Health*\n\n` +
    `• *Admin Bot:* Online & Polling 🟢\n` +
    `• *Firebase RTDB:* ${dbStatus}\n` +
    `• *Admin ID Status:* Configured & Enforced 🛡️\n` +
    `• *Server Time (UTC):* ${new Date().toISOString().replace('T', ' ').substring(0, 19)}\n` +
    `• *Active Admin Sessions:* ${activeSessionsCount}\n` +
    `• *Pending Withdrawals Queue:* *${pendingCount}*\n` +
    `• *Node.js Runtime:* ${process.version}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🔄 Refresh Status', callback_data: 'nav_system' }],
      [{ text: '🔙 Back to Menu', callback_data: 'nav_main_menu' }]
    ]
  };

  const options = { parse_mode: 'Markdown', reply_markup: keyboard };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
      return;
    } catch {}
  }
  await bot.sendMessage(chatId, text, options);
}

// ==========================================
// 15. CALLBACK ROUTER
// ==========================================

bot.on('callback_query', async (query) => {
  // Absolute security verification
  if (!(await guardAdminCallback(query))) {
    return;
  }

  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId = query.from.id;
  const data = query.data;

  try {
    await bot.answerCallbackQuery(query.id);

    // Navigation routes
    if (data === 'nav_main_menu') {
      clearSession(userId);
      await sendMainMenu(chatId, messageId);
      return;
    }

    if (data === 'nav_players') {
      clearSession(userId);
      await renderPlayersMenu(chatId, messageId);
      return;
    }

    if (data === 'players_list_recent') {
      await renderRecentPlayers(chatId, messageId);
      return;
    }

    if (data === 'players_search_prompt') {
      setSession(userId, { action: 'SEARCH_PLAYER' });
      await bot.sendMessage(
        chatId,
        `🔍 *Search Player*\n\nEnter a Telegram ID, Phone Number, Username, or Name to search:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'nav_players' }]]
          }
        }
      );
      return;
    }

    if (data.startsWith('player_view_')) {
      const targetId = data.replace('player_view_', '');
      await renderPlayerDetails(chatId, targetId, messageId);
      return;
    }

    if (data === 'nav_withdrawals') {
      await renderWithdrawals(chatId, messageId);
      return;
    }

    if (data.startsWith('w_app_')) {
      const txId = data.replace('w_app_', '');
      await processWithdrawalDecision(chatId, txId, true);
      return;
    }

    if (data.startsWith('w_rej_')) {
      const txId = data.replace('w_rej_', '');
      await processWithdrawalDecision(chatId, txId, false);
      return;
    }

    if (data === 'nav_transactions') {
      await renderTransactionsMenu(chatId, 'all', messageId);
      return;
    }

    if (data.startsWith('tx_filter_')) {
      const filter = data.replace('tx_filter_', '');
      await renderTransactionsMenu(chatId, filter, messageId);
      return;
    }

    if (data === 'nav_rooms') {
      await renderGameRooms(chatId, messageId);
      return;
    }

    if (data === 'nav_winners') {
      await renderWinners(chatId, messageId);
      return;
    }

    if (data === 'nav_stats') {
      await renderStatistics(chatId, messageId);
      return;
    }

    if (data === 'nav_bonus') {
      await renderBonusChannel(chatId, messageId);
      return;
    }

    if (data === 'bonus_broadcast_prompt') {
      setSession(userId, { action: 'BROADCAST_ANNOUNCEMENT' });
      await bot.sendMessage(
        chatId,
        `✍️ *Broadcast Announcement*\n\nEnter the message text you wish to broadcast to players / channel:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'nav_bonus' }]]
          }
        }
      );
      return;
    }

    if (data === 'nav_system') {
      await renderSystemStatus(chatId, messageId);
      return;
    }

    // Player action callbacks
    if (data.startsWith('p_act_add_bal_')) {
      const targetId = data.replace('p_act_add_bal_', '');
      setSession(userId, { action: 'ADD_BALANCE', targetId });
      await bot.sendMessage(
        chatId,
        `💰 *Add Balance to Player \`${targetId}\`*\n\nEnter the amount in Birr to credit:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Cancel', callback_data: `player_view_${targetId}` }]]
          }
        }
      );
      return;
    }

    if (data.startsWith('p_act_rem_bal_')) {
      const targetId = data.replace('p_act_rem_bal_', '');
      setSession(userId, { action: 'REMOVE_BALANCE', targetId });
      await bot.sendMessage(
        chatId,
        `💸 *Remove Balance from Player \`${targetId}\`*\n\nEnter the amount in Birr to deduct:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Cancel', callback_data: `player_view_${targetId}` }]]
          }
        }
      );
      return;
    }

    if (data.startsWith('p_act_add_ref_')) {
      const targetId = data.replace('p_act_add_ref_', '');
      setSession(userId, { action: 'ADD_REFERRAL_BONUS', targetId });
      await bot.sendMessage(
        chatId,
        `🎁 *Add Referral Bonus to Player \`${targetId}\`*\n\nEnter bonus amount in Birr:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Cancel', callback_data: `player_view_${targetId}` }]]
          }
        }
      );
      return;
    }

    if (data.startsWith('p_act_txs_')) {
      const targetId = data.replace('p_act_txs_', '');
      const snapshot = await db.ref('transactions')
        .orderByChild('telegramId')
        .equalTo(targetId)
        .limitToLast(10)
        .once('value');

      const txs = Object.values(snapshot.val() || {}).reverse();
      let text = `🧾 *Recent Transactions for Player \`${targetId}\`:*\n\n`;

      if (txs.length === 0) {
        text += `_No recorded transactions for this player._`;
      } else {
        for (const t of txs) {
          text += `• \`${t.id || 'N/A'}\` | ${t.type} | *${formatCurrency(t.amount)}* | ${t.status || 'approved'}\n`;
        }
      }

      await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Back to Player', callback_data: `player_view_${targetId}` }]]
        }
      });
      return;
    }

    if (data.startsWith('p_act_del_confirm_')) {
      const targetId = data.replace('p_act_del_confirm_', '');
      await bot.sendMessage(
        chatId,
        `⚠️ *Delete this player permanently?*\n\n` +
          `Player ID: \`${targetId}\`\n\n` +
          `This action is irreversible and will remove their profile and wallet balance from the database.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🗑️ Yes, Delete', callback_data: `p_act_del_execute_${targetId}` }],
              [{ text: '❌ Cancel', callback_data: `player_view_${targetId}` }]
            ]
          }
        }
      );
      return;
    }

    if (data.startsWith('p_act_del_execute_')) {
      const targetId = data.replace('p_act_del_execute_', '');
      await db.ref(`players/${targetId}`).remove();

      // Record audit transaction
      const auditId = generateTxId('DEL');
      await db.ref(`transactions/${auditId}`).set({
        id: auditId,
        type: 'admin_delete_player',
        telegramId: targetId,
        adminId: ADMIN_ID,
        createdAt: Date.now(),
        status: 'approved'
      });

      await bot.sendMessage(
        chatId,
        `🗑️ Player \`${targetId}\` has been permanently deleted.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Players Menu', callback_data: 'nav_players' }]] } }
      );
      return;
    }
  } catch (error) {
    console.error('[Callback Router Error]', error);
  }
});

// ==========================================
// 16. TEXT & SESSION HANDLER
// ==========================================

bot.on('message', async (msg) => {
  if (!(await guardAdminMessage(msg))) {
    return;
  }

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || '').trim();

  // /start command
  if (text === '/start') {
    clearSession(userId);
    await sendMainMenu(chatId);
    return;
  }

  const session = getSession(userId);
  if (!session) {
    return;
  }

  try {
    // 1. Search player session
    if (session.action === 'SEARCH_PLAYER') {
      const results = await searchPlayers(text);
      clearSession(userId);

      if (results.length === 0) {
        await bot.sendMessage(
          chatId,
          `🔍 No players found matching "*${text}*".`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔍 Search Again', callback_data: 'players_search_prompt' }],
                [{ text: '🔙 Back to Players', callback_data: 'nav_players' }]
              ]
            }
          }
        );
        return;
      }

      const buttons = results.map((p) => [
        {
          text: `👤 ${p.firstName || p.username || 'User'} (${formatCurrency(p.balance)})`,
          callback_data: `player_view_${p.telegramId}`
        }
      ]);

      buttons.push([{ text: '🔙 Back to Players', callback_data: 'nav_players' }]);

      await bot.sendMessage(
        chatId,
        `🔍 *Search Results for "${text}":*`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
      );
      return;
    }

    // 2. Add balance session
    if (session.action === 'ADD_BALANCE') {
      const amount = parseFloat(text);
      const targetId = session.targetId;

      if (isNaN(amount) || amount <= 0) {
        await bot.sendMessage(chatId, '⚠️ Please enter a valid positive number for the amount:');
        return;
      }

      const updateResult = await atomicBalanceUpdate(targetId, 'balance', amount);
      clearSession(userId);

      if (!updateResult.success) {
        await bot.sendMessage(chatId, '❌ Failed to update balance atomically.', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Player', callback_data: `player_view_${targetId}` }]] }
        });
        return;
      }

      // Record audit transaction
      const txId = generateTxId('ADM_CREDIT');
      await db.ref(`transactions/${txId}`).set({
        id: txId,
        telegramId: targetId,
        adminId: ADMIN_ID,
        amount,
        type: 'admin_credit',
        status: 'approved',
        previousBalance: updateResult.previousBalance,
        newBalance: updateResult.newBalance,
        createdAt: Date.now()
      });

      await bot.sendMessage(
        chatId,
        `✅ *Balance Added Successfully!*\n\n` +
          `• *Player ID:* \`${targetId}\`\n` +
          `• *Credited:* *${formatCurrency(amount)}*\n` +
          `• *New Balance:* *${formatCurrency(updateResult.newBalance)}*\n` +
          `• *Audit TX:* \`${txId}\``,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 View Player', callback_data: `player_view_${targetId}` }]] }
        }
      );
      return;
    }

    // 3. Remove balance session
    if (session.action === 'REMOVE_BALANCE') {
      const amount = parseFloat(text);
      const targetId = session.targetId;

      if (isNaN(amount) || amount <= 0) {
        await bot.sendMessage(chatId, '⚠️ Please enter a valid positive number for the amount:');
        return;
      }

      const updateResult = await atomicBalanceUpdate(targetId, 'balance', -amount, {
        preventNegative: true
      });
      clearSession(userId);

      if (!updateResult.success) {
        await bot.sendMessage(
          chatId,
          `❌ Cannot remove balance: Player does not have sufficient funds. Balance cannot become negative.`,
          {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Player', callback_data: `player_view_${targetId}` }]] }
          }
        );
        return;
      }

      // Record audit transaction
      const txId = generateTxId('ADM_DEBIT');
      await db.ref(`transactions/${txId}`).set({
        id: txId,
        telegramId: targetId,
        adminId: ADMIN_ID,
        amount,
        type: 'admin_debit',
        status: 'approved',
        previousBalance: updateResult.previousBalance,
        newBalance: updateResult.newBalance,
        createdAt: Date.now()
      });

      await bot.sendMessage(
        chatId,
        `✅ *Balance Deducted Successfully!*\n\n` +
          `• *Player ID:* \`${targetId}\`\n` +
          `• *Deducted:* *${formatCurrency(amount)}*\n` +
          `• *New Balance:* *${formatCurrency(updateResult.newBalance)}*\n` +
          `• *Audit TX:* \`${txId}\``,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 View Player', callback_data: `player_view_${targetId}` }]] }
        }
      );
      return;
    }

    // 4. Add referral bonus session
    if (session.action === 'ADD_REFERRAL_BONUS') {
      const amount = parseFloat(text);
      const targetId = session.targetId;

      if (isNaN(amount) || amount <= 0) {
        await bot.sendMessage(chatId, '⚠️ Please enter a valid positive bonus amount:');
        return;
      }

      const updateResult = await atomicBalanceUpdate(targetId, 'referralBonusBalance', amount);
      clearSession(userId);

      if (!updateResult.success) {
        await bot.sendMessage(chatId, '❌ Failed to update referral bonus atomically.');
        return;
      }

      const txId = generateTxId('ADM_REF');
      await db.ref(`transactions/${txId}`).set({
        id: txId,
        telegramId: targetId,
        adminId: ADMIN_ID,
        amount,
        type: 'admin_referral_credit',
        status: 'approved',
        previousBalance: updateResult.previousBalance,
        newBalance: updateResult.newBalance,
        createdAt: Date.now()
      });

      await bot.sendMessage(
        chatId,
        `✅ *Referral Bonus Added!*\n\n` +
          `• *Player ID:* \`${targetId}\`\n` +
          `• *Bonus Credited:* *${formatCurrency(amount)}*\n` +
          `• *New Referral Balance:* *${formatCurrency(updateResult.newBalance)}*`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 View Player', callback_data: `player_view_${targetId}` }]] }
        }
      );
      return;
    }

    // 5. Broadcast announcement session
    if (session.action === 'BROADCAST_ANNOUNCEMENT') {
      clearSession(userId);
      await bot.sendMessage(
        chatId,
        `📢 *Announcement Preview:*\n\n${text}\n\n_Note: To broadcast to @EdelBingoo directly, ensure the bot is added as an administrator to the channel._`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'nav_main_menu' }]]
          }
        }
      );
      return;
    }
  } catch (err) {
    console.error('[Admin Message Processing Error]', err);
    await bot.sendMessage(chatId, '❌ An unexpected error occurred while processing your request.');
  }
});

// ==========================================
// 17. PROCESS ERROR HANDLING & CLEAN EXIT
// ==========================================

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});

console.log('[ZA Bingo Admin Bot] Initialized successfully and monitoring events for ADMIN_ID.');

module.exports = bot;