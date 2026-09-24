/**
 * ZA Bingo Telegram Bot
 * Production Bot Implementation
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./firebase');

// ==========================================
// 1. IMPORTS & CONFIGURATION
// ==========================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID ? String(process.env.ADMIN_ID).trim() : null;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://example.com';
const BONUS_CHANNEL = '@EdelBingoo';

const TELEBIRR_ACCOUNT = process.env.TELEBIRR_ACCOUNT || '09XXXXXXXX (ZA Bingo)';
const CBE_ACCOUNT = process.env.CBE_ACCOUNT || '1000XXXXXXXX (ZA Bingo)';

if (!BOT_TOKEN) {
  console.error('[FATAL] TELEGRAM_BOT_TOKEN is missing in environment variables.');
}

// In-memory user conversation sessions
// Key: telegramId (string), Value: { action, step, data, createdAt }
const sessions = new Map();

// ==========================================
// 2. BOT INITIALIZATION
// ==========================================

const bot = new TelegramBot(BOT_TOKEN, {
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
// 3. UTILITY FUNCTIONS
// ==========================================

function getSession(userId) {
  const id = String(userId);
  return sessions.get(id) || null;
}

function setSession(userId, data) {
  const id = String(userId);
  sessions.set(id, { ...data, updatedAt: Date.now() });
}

function clearSession(userId) {
  const id = String(userId);
  sessions.delete(id);
}

/**
 * Normalizes Ethiopian phone numbers to canonical 12-digit format: 2519XXXXXXXX or 2517XXXXXXXX
 */
function normalizeEthiopianPhone(input) {
  if (!input) return null;
  let cleaned = String(input).replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  // 09XXXXXXXX or 07XXXXXXXX (10 digits)
  if (/^0[79]\d{8}$/.test(cleaned)) {
    return '251' + cleaned.substring(1);
  }

  // 9XXXXXXXX or 7XXXXXXXX (9 digits)
  if (/^[79]\d{8}$/.test(cleaned)) {
    return '251' + cleaned;
  }

  // 2519XXXXXXXX or 2517XXXXXXXX (12 digits)
  if (/^251[79]\d{8}$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

function formatPhoneDisplay(normalized) {
  if (!normalized || normalized.length !== 12) return normalized;
  return `0${normalized.substring(3)}`;
}

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return `${num.toFixed(2)} Br`;
}

function generateTxId(prefix = 'TX') {
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

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🎮 Play ZA Bingo', web_app: { url: WEBAPP_URL } }],
      [
        { text: '💰 Deposit', callback_data: 'nav_deposit' },
        { text: '💸 Withdraw', callback_data: 'nav_withdraw' }
      ],
      [
        { text: '💳 Balance', callback_data: 'nav_balance' },
        { text: '🔄 Transfer', callback_data: 'nav_transfer' }
      ],
      [
        { text: '👤 Profile', callback_data: 'nav_profile' },
        { text: '📖 How to Play', callback_data: 'nav_instructions' }
      ],
      [{ text: '🎁 Bonus Channel', url: `https://t.me/${BONUS_CHANNEL.replace('@', '')}` }]
    ]
  };
}

function getCancelKeyboard(extraCallback = 'cancel_action') {
  return {
    inline_keyboard: [[{ text: '❌ Cancel', callback_data: extraCallback }]]
  };
}

// ==========================================
// 4. PLAYER FUNCTIONS
// ==========================================

async function getOrCreatePlayer(user) {
  const telegramId = String(user.id);
  const playerRef = db.ref(`players/${telegramId}`);
  const snapshot = await playerRef.once('value');

  if (snapshot.exists()) {
    const existing = snapshot.val();
    const updates = {};
    if (user.username && user.username !== existing.username) {
      updates.username = user.username;
    }
    if (user.first_name && user.first_name !== existing.firstName) {
      updates.firstName = user.first_name;
    }
    if (user.last_name && user.last_name !== existing.lastName) {
      updates.lastName = user.last_name;
    }
    if (Object.keys(updates).length > 0) {
      await playerRef.update(updates);
    }
    return { ...existing, ...updates, telegramId };
  }

  const newPlayer = {
    telegramId,
    username: user.username || '',
    firstName: user.first_name || '',
    lastName: user.last_name || '',
    balance: 0,
    referralBonusBalance: 0,
    gamesWon: 0,
    phone: '',
    createdAt: Date.now(),
    lastActiveAt: Date.now()
  };

  await playerRef.set(newPlayer);
  return newPlayer;
}

async function getPlayer(telegramId) {
  const snapshot = await db.ref(`players/${String(telegramId)}`).once('value');
  if (!snapshot.exists()) return null;
  return { ...snapshot.val(), telegramId: String(telegramId) };
}

async function findActivePlayerByPhone(normalizedPhone) {
  const snapshot = await db.ref('players').orderByChild('phone').equalTo(normalizedPhone).once('value');
  if (!snapshot.exists()) return null;

  const data = snapshot.val();
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  const firstKey = keys[0];
  return { ...data[firstKey], telegramId: firstKey };
}

/**
 * Safely alters player balance using an atomic Firebase transaction
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
      // Abort transaction if insufficient funds
      return;
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

// ==========================================
// 5. SMS PARSERS
// ==========================================

/**
 * Parses Telebirr Received SMS
 * Rejects "sent" transactions (ልከዋል)
 * Requires received indicator (ተቀብለዋል or credited/received)
 */
function parseTelebirrSMS(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  // If text is purely digits or too short, reject
  if (/^\d+$/.test(trimmed) || trimmed.length < 15) {
    return null;
  }

  const isAmharicSent = trimmed.includes('ልከዋል');
  const isAmharicReceived = trimmed.includes('ተቀብለዋል');

  // If Amharic sent wording is found and no received wording, strictly reject
  if (isAmharicSent && !isAmharicReceived) {
    return { error: 'SENT_SMS_NOT_RECEIVED' };
  }

  const lower = trimmed.toLowerCase();
  const isEnglishReceived =
    lower.includes('received') ||
    lower.includes('credited') ||
    lower.includes('you have received') ||
    lower.includes('deposited');

  const isEnglishSent =
    lower.includes('you transferred') ||
    lower.includes('you have paid') ||
    lower.includes('you have sent');

  if (isEnglishSent && !isEnglishReceived) {
    return { error: 'SENT_SMS_NOT_RECEIVED' };
  }

  if (!isAmharicReceived && !isEnglishReceived) {
    return null;
  }

  // Extract Amount: e.g. "100.00 ብር" or "ETB 150.00" or "100.00 ETB" or "ብር 50"
  let amount = null;
  const amountPatterns = [
    /(\d+(?:\.\d{1,2})?)\s*(?:ETB|ብር|birr)/i,
    /(?:ETB|ብር|birr)\s*(\d+(?:\.\d{1,2})?)/i,
    /(?:amount|ገንዘብ)[\s:]*(\d+(?:\.\d{1,2})?)/i
  ];

  for (const regex of amountPatterns) {
    const match = trimmed.match(regex);
    if (match && match[1]) {
      const val = parseFloat(match[1]);
      if (val > 0) {
        amount = val;
        break;
      }
    }
  }

  // Extract Transaction/Reference ID
  let transactionId = null;
  const txPatterns = [
    /(?:የግብይት ቁጥር|transaction\s*(?:id|no|number)?|txn\s*(?:id|no)?|ref(?:\.|\s*no)?)\s*[:：\-]?\s*([A-Za-z0-9]{6,25})/i,
    /([A-Z0-9]{8,18})\s*(?:is your transaction|የግብይት ቁጥር)/i,
    /\b([A-Z0-9]{10,16})\b/
  ];

  for (const regex of txPatterns) {
    const match = trimmed.match(regex);
    if (match && match[1]) {
      // Must contain at least one letter and one number or long alphanumeric string
      const candidate = match[1].trim().toUpperCase();
      if (candidate.length >= 6) {
        transactionId = candidate;
        break;
      }
    }
  }

  if (!amount || !transactionId) {
    return null;
  }

  return {
    provider: 'telebirr',
    amount,
    transactionId
  };
}

/**
 * Parses CBE Birr Received SMS
 */
function parseCbeBirrSMS(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  if (/^\d+$/.test(trimmed) || trimmed.length < 15) {
    return null;
  }

  const lower = trimmed.toLowerCase();

  const isReceived =
    trimmed.includes('ተቀብለዋል') ||
    lower.includes('credited with') ||
    lower.includes('you have received') ||
    lower.includes('deposited into your account') ||
    lower.includes('transferred to your account') ||
    lower.includes('cbebirr') ||
    lower.includes('cbe birr');

  const isSent =
    (trimmed.includes('ልከዋል') && !trimmed.includes('ተቀብለዋል')) ||
    (lower.includes('debited from your account') && !lower.includes('credited'));

  if (isSent) {
    return { error: 'SENT_SMS_NOT_RECEIVED' };
  }

  if (!isReceived) {
    return null;
  }

  // Amount extraction
  let amount = null;
  const amountPatterns = [
    /(?:ETB|ብር)\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/i,
    /(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:ETB|ብር)/i,
    /(?:credited with|amount:)\s*(?:ETB)?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/i
  ];

  for (const regex of amountPatterns) {
    const match = trimmed.match(regex);
    if (match && match[1]) {
      const cleanVal = match[1].replace(/,/g, '');
      const val = parseFloat(cleanVal);
      if (val > 0) {
        amount = val;
        break;
      }
    }
  }

  // CBE Transaction/Reference ID extraction
  let transactionId = null;
  const txPatterns = [
    /(?:txn\s*(?:id|no)?|transaction\s*(?:id|no|number)?|ref\s*(?:id|no|number)?|የግብይት ቁጥር)\s*[:：\-]?\s*([A-Za-z0-9]{6,25})/i,
    /(?:FT|TT|CBE)[0-9A-Z]{8,20}/i,
    /\b([0-9A-Z]{9,20})\b/
  ];

  for (const regex of txPatterns) {
    const match = trimmed.match(regex);
    if (match && match[1]) {
      transactionId = match[1].trim().toUpperCase();
      break;
    } else if (match && match[0]) {
      transactionId = match[0].trim().toUpperCase();
      break;
    }
  }

  if (!amount || !transactionId) {
    return null;
  }

  return {
    provider: 'cbe_birr',
    amount,
    transactionId
  };
}

/**
 * Universal SMS processor for deposit
 */
function parseDepositSMS(text, expectedProvider) {
  if (expectedProvider === 'telebirr') {
    const res = parseTelebirrSMS(text);
    if (res) return res;
    // Fallback to CBE parser in case user pasted CBE into Telebirr by mistake
    return parseCbeBirrSMS(text);
  }

  if (expectedProvider === 'cbe_birr') {
    const res = parseCbeBirrSMS(text);
    if (res) return res;
    return parseTelebirrSMS(text);
  }

  // Any provider
  return parseTelebirrSMS(text) || parseCbeBirrSMS(text);
}

// ==========================================
// 6. DEPOSIT FUNCTIONS
// ==========================================

async function processDepositSMS(chatId, userId, smsText) {
  const session = getSession(userId);
  const provider = session && session.data ? session.data.provider : 'telebirr';

  const parsed = parseDepositSMS(smsText, provider);

  if (!parsed) {
    await bot.sendMessage(
      chatId,
      '⚠️ *Invalid SMS format*\n\n' +
        'We could not extract the deposit details from your message.\n' +
        'Please forward or paste the **complete, unmodified confirmation SMS** you received.\n\n' +
        'Make sure it contains the received amount and transaction reference number.',
      { parse_mode: 'Markdown', reply_markup: getCancelKeyboard('cancel_deposit') }
    );
    return;
  }

  if (parsed.error === 'SENT_SMS_NOT_RECEIVED') {
    await bot.sendMessage(
      chatId,
      '❌ *Invalid SMS Type*\n\n' +
        'The SMS you sent indicates money was **sent (ልከዋል)** rather than **received (ተቀብለዋል)** by the recipient account.\n' +
        'Please ensure you made the transfer and paste the actual receipt message.',
      { parse_mode: 'Markdown', reply_markup: getCancelKeyboard('cancel_deposit') }
    );
    return;
  }

  const { amount, transactionId, provider: actualProvider } = parsed;
  const externalTxId = String(transactionId).trim().toUpperCase();

  // Atomically claim the external transaction ID to prevent duplicate deposits
  const claimRef = db.ref(`claimed_deposit_txids/${externalTxId}`);
  let alreadyClaimed = false;

  const claimResult = await claimRef.transaction((current) => {
    if (current) {
      alreadyClaimed = true;
      return; // Abort: already used
    }
    return {
      claimedBy: String(userId),
      claimedAt: Date.now(),
      amount
    };
  });

  if (!claimResult.committed || alreadyClaimed) {
    clearSession(userId);
    await bot.sendMessage(
      chatId,
      `❌ *Duplicate Transaction*\n\n` +
        `Transaction ID \`${externalTxId}\` has already been credited or is currently processed.\n` +
        `If you believe this is an error, please contact our support team.`,
      { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
    );
    return;
  }

  // Credit player balance atomically
  const creditResult = await atomicBalanceUpdate(userId, 'balance', amount);

  if (!creditResult.success) {
    // Release claimed ID if crediting failed
    await claimRef.remove().catch((e) => console.error('[Claim rollback failed]', e));
    clearSession(userId);
    await bot.sendMessage(
      chatId,
      '❌ An unexpected error occurred while crediting your wallet. Please try again or contact support.',
      { reply_markup: getMainMenuKeyboard() }
    );
    return;
  }

  // Record completed deposit transaction
  const internalTxId = generateTxId('DEP');
  const transactionRecord = {
    id: internalTxId,
    telegramId: String(userId),
    type: 'deposit',
    provider: actualProvider,
    externalTxId,
    amount,
    status: 'approved',
    source: 'external_sms',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await db.ref(`transactions/${internalTxId}`).set(transactionRecord);

  // Clear session
  clearSession(userId);

  await bot.sendMessage(
    chatId,
    `✅ *Deposit Successful!*\n\n` +
      `💳 *Credited:* ${formatCurrency(amount)}\n` +
      `🆔 *Ref:* \`${externalTxId}\`\n` +
      `💰 *New Balance:* ${formatCurrency(creditResult.newBalance)}\n\n` +
      `Your wallet has been topped up. Good luck playing ZA Bingo! 🎱`,
    { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
  );
}

// ==========================================
// 7. WITHDRAWAL FUNCTIONS
// ==========================================

async function createWithdrawalRequest(chatId, userId) {
  const session = getSession(userId);
  if (!session || !session.data) {
    clearSession(userId);
    return;
  }

  const { source, amount, accountInfo, method } = session.data;
  const numAmount = Number(amount);

  if (!numAmount || numAmount <= 0) {
    await bot.sendMessage(chatId, '❌ Invalid amount. Withdrawal cancelled.', {
      reply_markup: getMainMenuKeyboard()
    });
    clearSession(userId);
    return;
  }

  const player = await getPlayer(userId);
  if (!player) {
    await bot.sendMessage(chatId, '❌ Player profile not found.');
    clearSession(userId);
    return;
  }

  // Check referral conditions
  if (source === 'referralBonusBalance') {
    const gamesWon = getGamesWonCount(player);
    if (gamesWon < 10) {
      await bot.sendMessage(
        chatId,
        `❌ *Withdrawal Requirement Not Met*\n\n` +
          `To withdraw from your Referral Bonus Balance, you must have won at least *10 games*.\n` +
          `Current games won: *${gamesWon}/10*.\n\n` +
          `Play more games to unlock your referral bonus!`,
        { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
      );
      clearSession(userId);
      return;
    }
  }

  // Pre-check balance
  const currentBalance = Number(player[source]) || 0;
  if (currentBalance < numAmount) {
    await bot.sendMessage(
      chatId,
      `❌ *Insufficient Balance*\n\n` +
        `Requested: ${formatCurrency(numAmount)}\n` +
        `Available: ${formatCurrency(currentBalance)}`,
      { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
    );
    clearSession(userId);
    return;
  }

  // Create pending transaction in Firebase
  const txId = generateTxId('WTH');
  const txRecord = {
    id: txId,
    telegramId: String(userId),
    username: player.username || '',
    firstName: player.firstName || '',
    type: 'withdrawal',
    source, // 'balance' or 'referralBonusBalance'
    amount: numAmount,
    status: 'pending',
    paymentMethod: method || 'telebirr',
    destinationAccount: accountInfo,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await db.ref(`transactions/${txId}`).set(txRecord);
  clearSession(userId);

  await bot.sendMessage(
    chatId,
    `⏳ *Withdrawal Request Submitted!*\n\n` +
      `🆔 *Request ID:* \`${txId}\`\n` +
      `💰 *Amount:* ${formatCurrency(numAmount)}\n` +
      `📂 *Source:* ${source === 'balance' ? 'Main Balance' : 'Referral Bonus'}\n` +
      `🏦 *Account:* \`${accountInfo}\`\n` +
      `⚡ *Status:* Pending admin approval\n\n` +
      `You will receive a notification as soon as the admin processes your request.`,
    { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
  );

  // Notify Admin
  if (ADMIN_ID) {
    const adminMsg =
      `🔔 *NEW WITHDRAWAL REQUEST*\n\n` +
      `🆔 *ID:* \`${txId}\`\n` +
      `👤 *User:* ${player.firstName || 'Player'} (@${player.username || 'N/A'})\n` +
      `🆔 *TG ID:* \`${userId}\`\n` +
      `💰 *Amount:* ${formatCurrency(numAmount)}\n` +
      `📂 *Source:* \`${source}\`\n` +
      `🏦 *Method:* ${method}\n` +
      `📱 *Destination:* \`${accountInfo}\``;

    const adminKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `admin_approve_${txId}` },
          { text: '❌ Reject', callback_data: `admin_reject_${txId}` }
        ]
      ]
    };

    bot.sendMessage(ADMIN_ID, adminMsg, {
      parse_mode: 'Markdown',
      reply_markup: adminKeyboard
    }).catch((err) => console.error('[Admin Notify Error]', err.message));
  }
}

// ==========================================
// 8. ADMIN ACTIONS (WITHDRAWAL APPROVAL/REJECTION)
// ==========================================

async function handleAdminWithdrawalAction(adminChatId, adminUserId, txId, isApproved) {
  // Strict admin check
  if (String(adminUserId) !== String(ADMIN_ID)) {
    console.warn(`[UNAUTHORIZED ADMIN ATTEMPT] User: ${adminUserId}`);
    return;
  }

  const txRef = db.ref(`transactions/${txId}`);

  // Atomically lock and transition status from 'pending' to 'approved' or 'rejected'
  let txData = null;
  let alreadyProcessed = false;

  const txStatusResult = await txRef.transaction((current) => {
    if (!current) return;
    if (current.status !== 'pending') {
      alreadyProcessed = true;
      return; // Do not touch if already approved or rejected
    }

    txData = { ...current };
    return {
      ...current,
      status: isApproved ? 'approved' : 'rejected',
      processedAt: Date.now(),
      processedBy: String(adminUserId)
    };
  });

  if (alreadyProcessed || !txStatusResult.committed || !txData) {
    await bot.sendMessage(
      adminChatId,
      `⚠️ Transaction \`${txId}\` has already been processed or is not in pending state.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const { telegramId, amount, source, destinationAccount } = txData;

  if (isApproved) {
    // Atomically deduct balance
    const deduction = await atomicBalanceUpdate(telegramId, source, -amount, {
      preventNegative: true
    });

    if (!deduction.success) {
      // Rollback transaction status back to rejected or keep rejected due to insufficient balance
      await txRef.update({
        status: 'rejected',
        rejectionReason: 'Insufficient balance at time of processing',
        updatedAt: Date.now()
      });

      await bot.sendMessage(
        adminChatId,
        `❌ *Approval Failed*: User \`${telegramId}\` has insufficient balance. Transaction rejected automatically.`,
        { parse_mode: 'Markdown' }
      );

      await bot.sendMessage(
        telegramId,
        `❌ *Withdrawal Rejected*\n\n` +
          `Your withdrawal request \`${txId}\` for ${formatCurrency(amount)} was rejected due to insufficient funds.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      return;
    }

    await bot.sendMessage(
      adminChatId,
      `✅ *Withdrawal Approved*\n\n` +
        `🆔 *TX ID:* \`${txId}\`\n` +
        `👤 *Player:* \`${telegramId}\`\n` +
        `💰 *Amount:* ${formatCurrency(amount)}\n` +
        `📱 *To Account:* \`${destinationAccount}\`\n` +
        `💳 *New Balance:* ${formatCurrency(deduction.newBalance)}`,
      { parse_mode: 'Markdown' }
    );

    // Notify player
    await bot.sendMessage(
      telegramId,
      `🎉 *Withdrawal Approved & Sent!*\n\n` +
        `Your withdrawal request of *${formatCurrency(amount)}* has been approved and paid to \`${destinationAccount}\`.\n` +
        `Thank you for playing ZA Bingo! 🎱`,
      { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
    ).catch(() => {});
  } else {
    // Rejected
    await bot.sendMessage(
      adminChatId,
      `🚫 *Withdrawal Rejected*\n\nTX ID: \`${txId}\`\nAmount: ${formatCurrency(amount)}`,
      { parse_mode: 'Markdown' }
    );

    // Notify player
    await bot.sendMessage(
      telegramId,
      `❌ *Withdrawal Rejected*\n\n` +
        `Your withdrawal request \`${txId}\` for *${formatCurrency(amount)}* has been rejected by admin.\n` +
        `No funds were deducted. If you have questions, please reach out to support.`,
      { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
    ).catch(() => {});
  }
}

// ==========================================
// 9. TRANSFER FUNCTIONS
// ==========================================

async function executeTransfer(chatId, senderId) {
  const session = getSession(senderId);
  if (!session || !session.data) {
    clearSession(senderId);
    return;
  }

  const { recipientId, recipientPhone, amount } = session.data;
  const numAmount = Number(amount);

  if (numAmount < 10) {
    await bot.sendMessage(chatId, '❌ Minimum transfer amount is 10 Br.', {
      reply_markup: getMainMenuKeyboard()
    });
    clearSession(senderId);
    return;
  }

  if (String(senderId) === String(recipientId)) {
    await bot.sendMessage(chatId, '❌ You cannot transfer funds to your own account.', {
      reply_markup: getMainMenuKeyboard()
    });
    clearSession(senderId);
    return;
  }

  // Prevent duplicate callback execution
  if (session.transferring) {
    return;
  }
  session.transferring = true;

  // Step 1: Atomically deduct from sender
  const deductResult = await atomicBalanceUpdate(senderId, 'balance', -numAmount, {
    preventNegative: true
  });

  if (!deductResult.success) {
    clearSession(senderId);
    await bot.sendMessage(
      chatId,
      '❌ *Transfer Failed: Insufficient Balance*\n\nPlease deposit or enter a smaller amount.',
      { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
    );
    return;
  }

  // Step 2: Atomically credit recipient
  const creditResult = await atomicBalanceUpdate(recipientId, 'balance', numAmount);

  if (!creditResult.success) {
    // Rollback sender deduction
    await atomicBalanceUpdate(senderId, 'balance', numAmount);
    clearSession(senderId);
    await bot.sendMessage(chatId, '❌ Transfer failed during crediting. Balance has been restored.', {
      reply_markup: getMainMenuKeyboard()
    });
    return;
  }

  // Step 3: Record transaction records
  const transferTxId = generateTxId('TRF');
  const now = Date.now();

  const txData = {
    id: transferTxId,
    type: 'transfer',
    amount: numAmount,
    senderId: String(senderId),
    recipientId: String(recipientId),
    recipientPhone: recipientPhone || '',
    status: 'approved',
    createdAt: now,
    updatedAt: now
  };

  await db.ref(`transactions/${transferTxId}`).set(txData);

  clearSession(senderId);

  // Notify sender
  await bot.sendMessage(
    chatId,
    `✅ *Transfer Completed!*\n\n` +
      `💸 *Amount Sent:* ${formatCurrency(numAmount)}\n` +
      `📱 *Recipient:* \`${formatPhoneDisplay(recipientPhone)}\`\n` +
      `💰 *Your Remaining Balance:* ${formatCurrency(deductResult.newBalance)}\n` +
      `🆔 *Ref:* \`${transferTxId}\``,
    { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
  );

  // Notify recipient
  await bot.sendMessage(
    recipientId,
    `🎁 *You Received a Transfer!*\n\n` +
      `💰 *Amount:* ${formatCurrency(numAmount)}\n` +
      `💳 *New Balance:* ${formatCurrency(creditResult.newBalance)}\n` +
      `🆔 *Ref:* \`${transferTxId}\``,
    { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
  ).catch(() => {});
}

// ==========================================
// 10. TELEGRAM COMMAND HANDLERS
// ==========================================

// /start
bot.onText(/\/start/, async (msg) => {
  try {
    const player = await getOrCreatePlayer(msg.from);
    clearSession(msg.from.id);

    const welcome =
      `🎉 *Welcome to ZA Bingo, ${msg.from.first_name || 'Player'}!*\n\n` +
      `Ethiopia's premier real-time Telegram Bingo platform! 🇪🇹🎱\n\n` +
      `💰 *Main Balance:* ${formatCurrency(player.balance)}\n` +
      `🎁 *Referral Bonus:* ${formatCurrency(player.referralBonusBalance)}\n` +
      `🏆 *Games Won:* ${getGamesWonCount(player)}\n\n` +
      `Join thousands of winners! Tap *Play ZA Bingo* below to jump into the action.`;

    await bot.sendMessage(msg.chat.id, welcome, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard()
    });
  } catch (error) {
    console.error('[Error /start]', error);
  }
});

// /play
bot.onText(/\/play/, async (msg) => {
  try {
    await getOrCreatePlayer(msg.from);
    await bot.sendMessage(
      msg.chat.id,
      `🎱 *Ready to Play ZA Bingo?*\n\nClick the button below to launch the game inside Telegram!`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎮 Launch ZA Bingo Web App', web_app: { url: WEBAPP_URL } }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('[Error /play]', error);
  }
});

// /balance
bot.onText(/\/balance/, async (msg) => {
  try {
    const player = await getOrCreatePlayer(msg.from);
    await bot.sendMessage(
      msg.chat.id,
      `💳 *Your Wallet Balance*\n\n` +
        `💵 *Main Balance:* ${formatCurrency(player.balance)}\n` +
        `🎁 *Referral Bonus:* ${formatCurrency(player.referralBonusBalance)}\n` +
        `🏆 *Games Won:* ${getGamesWonCount(player)}\n\n` +
        `Use buttons below to deposit or cash out!`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💰 Deposit', callback_data: 'nav_deposit' },
              { text: '💸 Withdraw', callback_data: 'nav_withdraw' }
            ],
            [{ text: '🔙 Back to Menu', callback_data: 'nav_menu' }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('[Error /balance]', error);
  }
});

// /profile
bot.onText(/\/profile/, async (msg) => {
  try {
    const player = await getOrCreatePlayer(msg.from);
    const phoneDisplay = player.phone ? formatPhoneDisplay(player.phone) : 'Not registered';

    await bot.sendMessage(
      msg.chat.id,
      `👤 *Player Profile*\n\n` +
        `🆔 *Telegram ID:* \`${player.telegramId}\`\n` +
        `👤 *Name:* ${player.firstName} ${player.lastName || ''}\n` +
        `📱 *Registered Phone:* \`${phoneDisplay}\`\n` +
        `💰 *Main Balance:* ${formatCurrency(player.balance)}\n` +
        `🎁 *Referral Bonus:* ${formatCurrency(player.referralBonusBalance)}\n` +
        `🏆 *Games Won:* ${getGamesWonCount(player)}\n` +
        `📢 *Bonus Channel:* ${BONUS_CHANNEL}`,
      {
        parse_mode: 'Markdown',
        reply_markup: getMainMenuKeyboard()
      }
    );
  } catch (error) {
    console.error('[Error /profile]', error);
  }
});

// /instructions
bot.onText(/\/instructions/, async (msg) => {
  try {
    await bot.sendMessage(
      msg.chat.id,
      `📖 *How to Play ZA Bingo*\n\n` +
        `1. *Deposit Funds:* Use /deposit to load money via Telebirr or CBE Birr.\n` +
        `2. *Enter a Room:* Click /play to open the Web App and select your stake card.\n` +
        `3. *Daub the Numbers:* Numbers are drawn in real-time. Cover your rows and columns!\n` +
        `4. *Claim Bingo:* Shout Bingo before time runs out to take the pot!\n` +
        `5. *Withdraw Winnings:* Cash out anytime directly back to your Telebirr or CBE account.\n\n` +
        `🎁 *Referral Bonus:* Invite friends to earn bonus cash. Win 10 games to unlock referral withdrawals!`,
      {
        parse_mode: 'Markdown',
        reply_markup: getMainMenuKeyboard()
      }
    );
  } catch (error) {
    console.error('[Error /instructions]', error);
  }
});

// /deposit
bot.onText(/\/deposit/, async (msg) => {
  try {
    await getOrCreatePlayer(msg.from);
    clearSession(msg.from.id);

    await bot.sendMessage(
      msg.chat.id,
      `💰 *Deposit Funds*\n\nSelect your preferred payment method:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 Telebirr', callback_data: 'deposit_telebirr' }],
            [{ text: '🏦 CBE Birr', callback_data: 'deposit_cbe' }],
            [{ text: '❌ Cancel', callback_data: 'cancel_action' }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('[Error /deposit]', error);
  }
});

// /withdraw
bot.onText(/\/withdraw/, async (msg) => {
  try {
    const player = await getOrCreatePlayer(msg.from);
    clearSession(msg.from.id);

    await bot.sendMessage(
      msg.chat.id,
      `💸 *Withdrawal*\n\n` +
        `Select the balance source you would like to withdraw from:\n\n` +
        `💵 *Main Balance:* ${formatCurrency(player.balance)}\n` +
        `🎁 *Referral Bonus:* ${formatCurrency(player.referralBonusBalance)} *(Requires 10 wins)*`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💵 Main Balance', callback_data: 'withdraw_src_balance' }],
            [{ text: '🎁 Referral Bonus', callback_data: 'withdraw_src_referral' }],
            [{ text: '❌ Cancel', callback_data: 'cancel_action' }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('[Error /withdraw]', error);
  }
});

// /transfer
bot.onText(/\/transfer/, async (msg) => {
  try {
    await getOrCreatePlayer(msg.from);
    setSession(msg.from.id, {
      action: 'transfer',
      step: 'AWAITING_RECIPIENT_PHONE',
      data: {}
    });

    await bot.sendMessage(
      msg.chat.id,
      `🔄 *Transfer Money*\n\n` +
        `Transfer balance instantly to another ZA Bingo player.\n\n` +
        `Please enter the **Ethiopian phone number** of the recipient:\n` +
        `*(e.g., 0912345678 or 251912345678)*`,
      {
        parse_mode: 'Markdown',
        reply_markup: getCancelKeyboard('cancel_transfer')
      }
    );
  } catch (error) {
    console.error('[Error /transfer]', error);
  }
});

// ==========================================
// 11. INLINE CALLBACK QUERY ROUTER
// ==========================================

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  try {
    await bot.answerCallbackQuery(query.id);

    // --- NAVIGATION CALLBACKS ---
    if (data === 'nav_menu') {
      clearSession(userId);
      const player = await getOrCreatePlayer(query.from);
      await bot.sendMessage(
        chatId,
        `🏠 *Main Menu*\n\nBalance: ${formatCurrency(player.balance)}`,
        { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
      );
      return;
    }

    if (data === 'nav_deposit') {
      await bot.sendMessage(
        chatId,
        `💰 *Choose Deposit Method:*`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📱 Telebirr', callback_data: 'deposit_telebirr' }],
              [{ text: '🏦 CBE Birr', callback_data: 'deposit_cbe' }],
              [{ text: '❌ Cancel', callback_data: 'cancel_action' }]
            ]
          }
        }
      );
      return;
    }

    if (data === 'nav_withdraw') {
      const player = await getOrCreatePlayer(query.from);
      await bot.sendMessage(
        chatId,
        `💸 *Choose Withdrawal Source:*\n\n` +
          `💵 Main Balance: ${formatCurrency(player.balance)}\n` +
          `🎁 Referral Bonus: ${formatCurrency(player.referralBonusBalance)} *(Requires 10 wins)*`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💵 Main Balance', callback_data: 'withdraw_src_balance' }],
              [{ text: '🎁 Referral Bonus', callback_data: 'withdraw_src_referral' }],
              [{ text: '❌ Cancel', callback_data: 'cancel_action' }]
            ]
          }
        }
      );
      return;
    }

    if (data === 'nav_balance') {
      const player = await getOrCreatePlayer(query.from);
      await bot.sendMessage(
        chatId,
        `💳 *Your Wallet Balance*\n\n` +
          `💵 *Main Balance:* ${formatCurrency(player.balance)}\n` +
          `🎁 *Referral Bonus:* ${formatCurrency(player.referralBonusBalance)}\n` +
          `🏆 *Games Won:* ${getGamesWonCount(player)}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '💰 Deposit', callback_data: 'nav_deposit' },
                { text: '💸 Withdraw', callback_data: 'nav_withdraw' }
              ],
              [{ text: '🔙 Back to Menu', callback_data: 'nav_menu' }]
            ]
          }
        }
      );
      return;
    }

    if (data === 'nav_transfer') {
      setSession(userId, {
        action: 'transfer',
        step: 'AWAITING_RECIPIENT_PHONE',
        data: {}
      });
      await bot.sendMessage(
        chatId,
        `🔄 *Transfer Money*\n\nPlease enter the recipient's **Ethiopian phone number**:\n*(e.g., 0912345678)*`,
        { parse_mode: 'Markdown', reply_markup: getCancelKeyboard('cancel_transfer') }
      );
      return;
    }

    if (data === 'nav_profile') {
      const player = await getOrCreatePlayer(query.from);
      await bot.sendMessage(
        chatId,
        `👤 *Player Profile*\n\n` +
          `🆔 Telegram ID: \`${player.telegramId}\`\n` +
          `💰 Main Balance: ${formatCurrency(player.balance)}\n` +
          `🎁 Referral Bonus: ${formatCurrency(player.referralBonusBalance)}\n` +
          `🏆 Games Won: ${getGamesWonCount(player)}`,
        { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
      );
      return;
    }

    if (data === 'nav_instructions') {
      await bot.sendMessage(
        chatId,
        `📖 *ZA Bingo Instructions*\n\n` +
          `1. Top up with /deposit.\n` +
          `2. Open the Web App using the *Play ZA Bingo* button.\n` +
          `3. Score winning patterns and win Birr!\n` +
          `4. Withdraw winnings directly to your Telebirr or CBE account.`,
        { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
      );
      return;
    }

    // --- CANCELLATION ---
    if (data.startsWith('cancel_')) {
      clearSession(userId);
      await bot.sendMessage(chatId, '❌ Action cancelled.', {
        reply_markup: getMainMenuKeyboard()
      });
      return;
    }

    // --- DEPOSIT SELECTION ---
    if (data === 'deposit_telebirr') {
      setSession(userId, {
        action: 'deposit',
        step: 'AWAITING_SMS',
        data: { provider: 'telebirr' }
      });

      await bot.sendMessage(
        chatId,
        `📱 *Deposit via Telebirr*\n\n` +
          `1. Transfer the desired amount to our Telebirr account:\n` +
          `   👉 \`${TELEBIRR_ACCOUNT}\`\n\n` +
          `2. Once transferred, **copy and paste the complete confirmation SMS** you receive into this chat.\n\n` +
          `⚠️ *Notice:* Only received-money confirmation SMS will be accepted.`,
        { parse_mode: 'Markdown', reply_markup: getCancelKeyboard('cancel_deposit') }
      );
      return;
    }

    if (data === 'deposit_cbe') {
      setSession(userId, {
        action: 'deposit',
        step: 'AWAITING_SMS',
        data: { provider: 'cbe_birr' }
      });

      await bot.sendMessage(
        chatId,
        `🏦 *Deposit via CBE Birr*\n\n` +
          `1. Transfer the desired amount to our CBE account:\n` +
          `   👉 \`${CBE_ACCOUNT}\`\n\n` +
          `2. Once transferred, **copy and paste the complete confirmation SMS** you receive into this chat.\n\n` +
          `⚠️ *Notice:* Forwarded SMS with 'From:' / 'Time:' lines are supported.`,
        { parse_mode: 'Markdown', reply_markup: getCancelKeyboard('cancel_deposit') }
      );
      return;
    }

    // --- WITHDRAWAL SELECTION ---
    if (data === 'withdraw_src_balance' || data === 'withdraw_src_referral') {
      const source = data === 'withdraw_src_balance' ? 'balance' : 'referralBonusBalance';
      const player = await getPlayer(userId);

      if (source === 'referralBonusBalance') {
        const gamesWon = getGamesWonCount(player);
        if (gamesWon < 10) {
          await bot.sendMessage(
            chatId,
            `❌ *Referral Bonus Locked*\n\nYou need at least *10 games won* to withdraw referral bonus.\n` +
              `Current wins: *${gamesWon}/10*.`,
            { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
          );
          return;
        }
      }

      const available = player ? player[source] || 0 : 0;
      if (available <= 0) {
        await bot.sendMessage(
          chatId,
          `❌ You have 0.00 Br in this balance.`,
          { reply_markup: getMainMenuKeyboard() }
        );
        return;
      }

      setSession(userId, {
        action: 'withdrawal',
        step: 'AWAITING_AMOUNT',
        data: { source, available }
      });

      await bot.sendMessage(
        chatId,
        `💸 *Withdrawal from ${source === 'balance' ? 'Main Balance' : 'Referral Bonus'}*\n\n` +
          `Available: *${formatCurrency(available)}*\n\n` +
          `Please enter the **amount in Birr** you wish to withdraw:`,
        { parse_mode: 'Markdown', reply_markup: getCancelKeyboard('cancel_withdraw') }
      );
      return;
    }

    // --- TRANSFER CONFIRMATION ---
    if (data === 'confirm_transfer') {
      await executeTransfer(chatId, userId);
      return;
    }

    // --- ADMIN ACTIONS (SECURED) ---
    if (data.startsWith('admin_approve_') || data.startsWith('admin_reject_')) {
      if (String(userId) !== String(ADMIN_ID)) {
        console.warn(`[UNAUTHORIZED ACCESS] Attempt by user ${userId} to trigger admin callback.`);
        await bot.answerCallbackQuery(query.id, {
          text: '⛔ Unauthorized. Admin access only.',
          show_alert: true
        });
        return;
      }

      const isApprove = data.startsWith('admin_approve_');
      const txId = data.replace(isApprove ? 'admin_approve_' : 'admin_reject_', '');

      await handleAdminWithdrawalAction(chatId, userId, txId, isApprove);
      return;
    }
  } catch (err) {
    console.error('[Callback Error]', err);
  }
});

// ==========================================
// 12. TEXT & SESSION MESSAGE HANDLER
// ==========================================

bot.on('message', async (msg) => {
  // Ignore command messages here (handled by onText)
  if (!msg.text || msg.text.startsWith('/')) {
    return;
  }

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();

  const session = getSession(userId);
  if (!session) {
    return;
  }

  try {
    // --- 1. DEPOSIT FLOW ---
    if (session.action === 'deposit' && session.step === 'AWAITING_SMS') {
      await processDepositSMS(chatId, userId, text);
      return;
    }

    // --- 2. WITHDRAWAL FLOW ---
    if (session.action === 'withdrawal') {
      if (session.step === 'AWAITING_AMOUNT') {
        const amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) {
          await bot.sendMessage(
            chatId,
            '⚠️ Please enter a valid positive number for the amount.',
            { reply_markup: getCancelKeyboard('cancel_withdraw') }
          );
          return;
        }

        if (amount > session.data.available) {
          await bot.sendMessage(
            chatId,
            `⚠️ Amount exceeds available balance (${formatCurrency(session.data.available)}). Please enter a smaller amount:`,
            { reply_markup: getCancelKeyboard('cancel_withdraw') }
          );
          return;
        }

        session.data.amount = amount;
        session.step = 'AWAITING_ACCOUNT_INFO';
        setSession(userId, session);

        await bot.sendMessage(
          chatId,
          `🏦 *Receiving Account Information*\n\n` +
            `Please enter your **Telebirr or CBE account/phone number** where you want to receive the ${formatCurrency(amount)}:`,
          { parse_mode: 'Markdown', reply_markup: getCancelKeyboard('cancel_withdraw') }
        );
        return;
      }

      if (session.step === 'AWAITING_ACCOUNT_INFO') {
        session.data.accountInfo = text;
        session.data.method = text.length <= 13 && /^[0-9+]+$/.test(text) ? 'Telebirr' : 'CBE/Bank';
        await createWithdrawalRequest(chatId, userId);
        return;
      }
    }

    // --- 3. TRANSFER FLOW ---
    if (session.action === 'transfer') {
      if (session.step === 'AWAITING_RECIPIENT_PHONE') {
        const normalized = normalizeEthiopianPhone(text);
        if (!normalized) {
          await bot.sendMessage(
            chatId,
            '⚠️ *Invalid phone number format*\n\nPlease enter a valid Ethiopian phone number (e.g. 0912345678 or 251912345678):',
            { parse_mode: 'Markdown', reply_markup: getCancelKeyboard('cancel_transfer') }
          );
          return;
        }

        // Find recipient in database
        const recipient = await findActivePlayerByPhone(normalized);

        if (!recipient) {
          await bot.sendMessage(
            chatId,
            `❌ No ZA Bingo player found registered with phone \`${formatPhoneDisplay(normalized)}\`.\n` +
              `Please ensure your friend has started @ZA_Bingo_Bot.`,
            { parse_mode: 'Markdown', reply_markup: getCancelKeyboard('cancel_transfer') }
          );
          return;
        }

        if (String(recipient.telegramId) === String(userId)) {
          await bot.sendMessage(
            chatId,
            `❌ You cannot transfer funds to yourself.`,
            { reply_markup: getMainMenuKeyboard() }
          );
          clearSession(userId);
          return;
        }

        session.data.recipientId = recipient.telegramId;
        session.data.recipientPhone = normalized;
        session.data.recipientName = recipient.firstName || 'Player';
        session.step = 'AWAITING_TRANSFER_AMOUNT';
        setSession(userId, session);

        await bot.sendMessage(
          chatId,
          `👤 *Recipient:* ${session.data.recipientName} (\`${formatPhoneDisplay(normalized)}\`)\n\n` +
            `Please enter the amount in Birr to transfer *(Minimum 10 Br)*:`,
          { parse_mode: 'Markdown', reply_markup: getCancelKeyboard('cancel_transfer') }
        );
        return;
      }

      if (session.step === 'AWAITING_TRANSFER_AMOUNT') {
        const amount = parseFloat(text);
        if (isNaN(amount) || amount < 10) {
          await bot.sendMessage(
            chatId,
            '⚠️ Minimum transfer amount is 10 Br. Please enter 10 or more:',
            { reply_markup: getCancelKeyboard('cancel_transfer') }
          );
          return;
        }

        const sender = await getPlayer(userId);
        const senderBalance = sender ? sender.balance || 0 : 0;

        if (amount > senderBalance) {
          await bot.sendMessage(
            chatId,
            `❌ *Insufficient Balance*\n\nYour balance: ${formatCurrency(senderBalance)}\nRequired: ${formatCurrency(amount)}`,
            { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
          );
          clearSession(userId);
          return;
        }

        session.data.amount = amount;
        session.step = 'CONFIRMATION';
        setSession(userId, session);

        await bot.sendMessage(
          chatId,
          `⚠️ *Confirm Transfer*\n\n` +
            `👤 *Recipient:* ${session.data.recipientName}\n` +
            `📱 *Phone:* \`${formatPhoneDisplay(session.data.recipientPhone)}\`\n` +
            `💸 *Amount:* ${formatCurrency(amount)}\n\n` +
            `Are you sure you want to proceed?`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Confirm & Send', callback_data: 'confirm_transfer' }],
                [{ text: '❌ Cancel', callback_data: 'cancel_transfer' }]
              ]
            }
          }
        );
        return;
      }
    }
  } catch (error) {
    console.error('[Message Handler Error]', error);
    await bot.sendMessage(chatId, '❌ An unexpected error occurred. Please try again later.');
  }
});

// ==========================================
// 13. PROCESS ERROR HANDLING & CLEAN EXIT
// ==========================================

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});

console.log('[ZA Bingo Bot] Initialized successfully and listening for events.');

module.exports = bot;