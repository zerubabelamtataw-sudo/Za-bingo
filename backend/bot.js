// ============================================================
// ZA BINGO — TELEGRAM BOT
// ============================================================
const TelegramBot = require('node-telegram-bot-api');
const db = require('./firebase');

// Replace with your bot token from @BotFather
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-miniapp-url.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const BONUS_CHANNEL = '@EdelBingoo';
const ADMIN_ID =
  process.env.ADMIN_ID || 'YOUR_ADMIN_TELEGRAM_ID';
  // ============================================================
// REFERRAL SYSTEM
// ============================================================

const REFERRAL_JOIN_BONUS = 20;
const REFERRAL_DEPOSIT_BONUS = 20;
const REFERRAL_MIN_DEPOSIT = 50;
  
function getEthiopiaTimeParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Addis_Ababa',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date());

  const result = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      result[part.type] = Number(part.value);
    }
  }

  return result;
}

// ============================================================
// ADMIN — SMS PARSERS
// ============================================================

function parseDepositSMS(text) {
  const amountMatch = text.match(/([\d,]+\.\d{2})\s*ብር/);
  const transactionMatch = text.match(
    /የሂሳብ እንቅስቃሴ ቁጥርዎ\s+([A-Z0-9]+)/
  );

  if (!amountMatch || !transactionMatch) {
    return null;
  }

  return {
    amount: Number(amountMatch[1].replace(/,/g, '')),
    transactionId: transactionMatch[1].toUpperCase()
  };
}
function parseCBEBirrDepositSMS(text) {
  const amountMatch = text.match(
    /you received\s+([\d,]+(?:\.\d{1,2})?)Br\./i
  );

  const transactionMatch = text.match(
    /Txn ID\s+([A-Z0-9]+)/i
  );

  if (!amountMatch || !transactionMatch) {
    return null;
  }

  return {
    amount: Number(amountMatch[1].replace(/,/g, '')),
    transactionId: transactionMatch[1].toUpperCase(),
    bank: 'CBE Birr',
    type: 'received'
  };
}

function parseWithdrawalSMS(text) {
  const amountMatch = text.match(/([\d,]+\.\d{2})\s*ብር/);
  const transactionMatch = text.match(
    /የሂሳብ እንቅስቃሴ ቁጥርዎ\s+([A-Z0-9]+)/
  );

  if (!amountMatch || !transactionMatch) {
    return null;
  }

  return {
    amount: Number(amountMatch[1].replace(/,/g, '')),
    transactionId: transactionMatch[1].toUpperCase()
  };
}
function parseCBEWithdrawalSMS(text) {
  const amountMatch = text.match(
    /successfully transferred ETB\s*([\d,]+(?:\.\d{2})?)/i
  );

  const receiverMatch = text.match(
    /to account\s+\d+\*+\d+\s+\(([^)]+)\)/i
  );

  const receiptMatch = text.match(
    /https:\/\/mbreciept\.cbe\.com\.et\/([A-Za-z0-9_-]+)/i
  );

  if (!amountMatch || !receiverMatch || !receiptMatch) {
    return null;
  }

  const receiverName = receiverMatch[1].trim();
  const firstName = receiverName.split(/\s+/)[0];

  return {
    amount: Number(amountMatch[1].replace(/,/g, '')),
    transactionId: receiptMatch[1],
    receiverName,
    receiverFirstName: firstName,
    bank: 'CBE'
  };
}

async function findPendingTransaction(type, amount, transactionId) {
  const snapshot = await db.ref('transactions').once('value');
  const transactions = snapshot.val() || {};

  // Check duplicate transaction ID first
  for (const transaction of Object.values(transactions)) {
    if (!transaction) continue;

    if (
      String(transaction.transactionId || '').toUpperCase() ===
      String(transactionId || '').toUpperCase()
    ) {
      console.log('⚠️ Duplicate transaction ID:', transactionId);

      if (transaction.telegramId) {
        await bot.sendMessage(
          transaction.telegramId,
          `⚠️ *Duplicate ${type === 'deposit' ? 'Deposit' : 'Withdrawal'}*\n\n` +
          `This transaction has already been processed.\n` +
          `No money was added to your balance.`,
          { parse_mode: 'Markdown' }
        );
      }

      return null;
    }
  }

  // Find pending transaction
  for (const [key, transaction] of Object.entries(transactions)) {
    if (!transaction) continue;

    if (
      transaction.type === type &&
      transaction.status === 'pending' &&
      Number(transaction.amount) === Number(amount)
    ) {
      return {
        key,
        ...transaction
      };
    }
  }

  return null;
}

async function storeOfficialDeposit(text, smsData) {
  const officialRef = db.ref(
    `officialDeposits/${smsData.transactionId}`
  );

  const existingSnapshot = await officialRef.once('value');
  const existing = existingSnapshot.val();

  if (existing) {
    console.log(
      `⚠️ Official deposit already stored: ${smsData.transactionId}`
    );
    return false;
  }

  const receivedAt = new Date();
const expiresAt = new Date(
  receivedAt.getTime() + 3 * 24 * 60 * 60 * 1000
);

await officialRef.set({
  type: 'deposit',
  amount: smsData.amount,
  transactionId: smsData.transactionId,
  sms: text,
  status: 'available',
  receivedAt: receivedAt.toISOString(),
  expiresAt: expiresAt.toISOString()
});

  console.log(
    `✅ Official deposit SMS saved: ${smsData.amount} Br → ${smsData.transactionId}`
  );

  return true;
}

// ============================================================
// EXPIRE OLD OFFICIAL DEPOSITS
// ============================================================

setInterval(async () => {
  try {
    const snapshot = await db.ref('officialDeposits').once('value');
    const deposits = snapshot.val() || {};

    const now = Date.now();

    for (const [transactionId, deposit] of Object.entries(deposits)) {
      if (!deposit) continue;

      if (
        deposit.status === 'available' &&
        deposit.expiresAt &&
        now > new Date(deposit.expiresAt).getTime()
      ) {
        await db.ref(`officialDeposits/${transactionId}`).update({
          status: 'expired',
          expiredAt: new Date().toISOString()
        });

        console.log(
          `⏰ Official deposit expired: ${transactionId}`
        );
      }
    }

  } catch (error) {
    console.error(
      '❌ Deposit expiration error:',
      error
    );
  }

}, 60 * 60 * 1000);

async function processWithdrawal(text, smsData) {
  const transaction = await findPendingTransaction(
    'withdrawal',
    smsData.amount,
    smsData.transactionId
  );

  if (!transaction) {
    console.log(
      '⚠️ No matching pending withdrawal:',
      smsData.amount,
      smsData.transactionId
    );
    return false;
  }

// CBE → match amount + first name
if (smsData.bank === 'CBE') {

  const requestName =
    String(transaction.firstName || '')
      .trim()
      .toLowerCase();

  const smsName =
    String(smsData.receiverFirstName || '')
      .trim()
      .toLowerCase();

  if (requestName !== smsName) {
    console.log(
      `❌ CBE name mismatch: ${requestName} ≠ ${smsName}`
    );
    return false;
  }
}

  const transactionRef = db.ref(
    `transactions/${transaction.key}`
  );

  const playerRef = db.ref(
    `players/${transaction.telegramId}`
  );

  const playerSnapshot = await playerRef.once('value');
  const player = playerSnapshot.val();

  if (!player) {
    console.log(
      '❌ Player not found:',
      transaction.telegramId
    );
    return false;
  }

  const currentBalance = Number(player.balance || 0);
  const amount = Number(transaction.amount);

  if (currentBalance < amount) {
    console.log(
      `❌ Insufficient balance for withdrawal: ${transaction.telegramId}`
    );

    await transactionRef.update({
      status: 'failed',
      failureReason: 'Insufficient balance',
      updatedAt: new Date().toISOString()
    });

    await bot.sendMessage(
      transaction.telegramId,
      `❌ Withdrawal failed.\n\nInsufficient balance.`
    );

    return false;
  }


  await transactionRef.update({
    status: 'approved',
    transactionId: smsData.transactionId,
    confirmedAt: new Date().toISOString(),
    confirmationSms: text
  });

  await bot.sendMessage(
    transaction.telegramId,
    `🧾 *ያዘዙት ወጪ ተረጋግጧል 💯*\n\n` +
    `Amount: ${amount} Br\n` +
    `Transaction ID: ${smsData.transactionId}\n\n` +
    `💰 Remaining balance: ${currentBalance} Br`,
    {
      parse_mode: 'Markdown'
    }
  );

  console.log(
    `✅ Withdrawal approved: ${amount} Br → ${transaction.telegramId}`
  );

  return true;
}

bot.on('message', async (msg) => {

  const forwardedText = msg.text;

  if (!forwardedText) return;

  // Only process forwarded SMS messages
  if (!forwardedText.match(/^From:\s*(?:\d+|CBEBirr|CBE)/i)) {
  return;
}

  console.log('\n📩 Forwarded SMS received:');
  console.log(forwardedText);

  try {

    // --------------------------------------------------------
    // CHECK SMS FORWARDER SENDER
    // --------------------------------------------------------

    const senderMatch = forwardedText.match(/^From:\s*(\d+|CBEBirr|CBE)/i);

    if (!senderMatch) {
      console.log('❌ SMS sender not found');
      return;
    }

    const sender = senderMatch[1];

   // TRUST TELEBIRR + CBE SMS SENDERS
if (
  sender !== '127' &&
  sender.toUpperCase() !== 'CBE' &&
  sender.toUpperCase() !== 'CBEBIRR'
) {
  console.log(
    `❌ Unauthorized SMS sender: ${sender}`
  );
  return;
}

console.log(`✅ Authorized SMS sender: ${sender}`);

    // --------------------------------------------------------
    // REMOVE FORWARDER HEADER
    // --------------------------------------------------------

    const smsText = forwardedText
  .replace(/^From:\s*(?:\d+|CBEBirr|CBE)\s*/i, '')
  .replace(/^Time:\s*[^\n\r]*/i, '')
  .trim();

    console.log('\n📨 Actual SMS:');
    console.log(smsText);

    // --------------------------------------------------------
    // DEPOSIT SMS
    // --------------------------------------------------------

    // --------------------------------------------------------
// DEPOSIT SMS — EXISTING FORMAT
// --------------------------------------------------------
if (
  smsText.includes('ተቀብለዋል') &&
  smsText.includes('የሂሳብ እንቅስቃሴ ቁጥርዎ')
) {

  const smsData = parseDepositSMS(smsText);

  if (!smsData) {
    console.log('❌ Could not parse deposit SMS');
    return;
  }

  await storeOfficialDeposit(smsText, smsData);

  return;
}

// --------------------------------------------------------
// CBE BIRR DEPOSIT SMS
// --------------------------------------------------------
if (
  /you received\s+[\d,]+(?:\.\d{1,2})?Br\./i.test(smsText) &&
  /Txn ID\s+[A-Z0-9]+/i.test(smsText)
) {

  const smsData = parseCBEBirrDepositSMS(smsText);

  if (!smsData) {
    console.log('❌ Could not parse CBE Birr deposit SMS');
    return;
  }

  await storeOfficialDeposit(smsText, smsData);

  return;
}

    // --------------------------------------------------------
    // WITHDRAWAL SMS
    // --------------------------------------------------------

    if (
      smsText.includes('ልከዋል') &&
      smsText.includes('የሂሳብ እንቅስቃሴ ቁጥርዎ')
    ) {

      const smsData = parseWithdrawalSMS(smsText);

      if (!smsData) {
        console.log('❌ Could not parse withdrawal SMS');
        return;
      }

      await processWithdrawal(smsText, smsData);

      return;
    }
    // --------------------------------------------------------
// CBE BANK WITHDRAWAL SMS
// --------------------------------------------------------

if (
  smsText.includes('A debit transaction of ETB') &&
  smsText.includes('mbreciept.cbe.com.et')
) {

  const smsData = parseCBEWithdrawalSMS(smsText);

  if (!smsData) {
    console.log('❌ Could not parse CBE withdrawal SMS');
    return;
  }

  await processWithdrawal(smsText, smsData);

  return;
}

    console.log('ℹ️ SMS format not recognized');

  } catch (error) {

    console.error(
      '❌ SMS processing error:',
      error
    );

  }
});

bot.setMyCommands([
  { command: 'play', description: 'Play Now' },
  { command: 'deposit', description: 'Deposit' },
  { command: 'withdraw', description: 'Withdraw' },
  { command: 'balance', description: 'Balance' },
  { command: 'instructions', description: 'Instructions' },
  { command: 'transfer', description: 'Transfer to a Player' },
  { command: 'profile', description: 'Profile' }
]);

bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);

  const snapshot = await db.ref(`players/${tgId}`).once('value');
  const player = snapshot.val();

  if (!player) {
    return bot.sendMessage(chatId, 'Please /start first.');
  }

  bot.sendMessage(
    chatId,
    `Balance: ${Number(player.balance || 0)} Br`
  );
});
bot.onText(/\/transfer/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);

  const snapshot = await db.ref(`players/${tgId}`).once('value');
  const player = snapshot.val();

  if (!player) {
    return bot.sendMessage(chatId, 'Please /start first.');
  }
const deposited = await hasMadeDeposit(tgId);

if (!deposited) {
  return bot.sendMessage(
    chatId,
    '❌ You must make at least one deposit before you can transfer money.'
  );
}
  bot.sendMessage(
    chatId,
    'የተቀባዩን ስልክ ቁጥር ያስገቡ፦'
  );

  transferSessions[chatId] = {
    step: 'phone',
    senderId: tgId
  };
});
bot.onText(/\/play/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);

  const snapshot = await db.ref(`players/${tgId}`).once('value');
  const player = snapshot.val();

  if (!player) {
    return bot.sendMessage(chatId, 'Please /start first.');
  }

  showMainMenu(chatId);
});

bot.onText(/\/deposit/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);

  const snapshot = await db.ref(`players/${tgId}`).once('value');
  const player = snapshot.val();

  if (!player) {
    return bot.sendMessage(chatId, 'Please /start first.');
  }

  handleDepositMenu(chatId, player);
});

bot.onText(/\/withdraw/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);

  const snapshot = await db.ref(`players/${tgId}`).once('value');
  const player = snapshot.val();

  if (!player) {
    return bot.sendMessage(chatId, 'Please /start first.');
  }

  const deposited = await hasMadeDeposit(tgId);

  if (!deposited) {
    return bot.sendMessage(
      chatId,
      `❌ *ገንዘብ ማውጣት አይችሉም*\n\n` +
      `ገንዘብ ማውጣት ከመቻልዎ በፊት ቢያንስ አንድ ጊዜ ዴፖዚት ማድረግ አለብዎት።`,
      { parse_mode: 'Markdown' }
    );
  }

  handleWithdrawMenu(chatId, player);
});

bot.onText(/\/profile/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);

  const snapshot = await db.ref(`players/${tgId}`).once('value');
  const player = snapshot.val();

  if (!player) {
    return bot.sendMessage(chatId, 'Please /start first.');
  }

  handleProfile(chatId, player);
});
let gameManager = null;

// ============================================================
// BOT COMMANDS
// ============================================================

// /start - Register user and show main menu
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
    // Referral code from /start ref_TELEGRAM_ID
  const referralCode = match && match[1]
    ? String(match[1]).trim()
    : null;

  let referrerId = null;

  if (
    referralCode &&
    referralCode.startsWith('ref_')
  ) {
    referrerId = referralCode.replace('ref_', '');
  }

  // Save user for future broadcasts
  broadcastUsers[String(chatId)] = true;

  const tgId = String(msg.from.id);
  const firstName = msg.from.first_name || 'Player';
  const username = msg.from.username || '';

  try {
    const playerRef = db.ref(`players/${tgId}`);
    const snapshot = await playerRef.once('value');
    let player = snapshot.val();

    if (!player) {
  // Register new player

  // Prevent self-referral
  if (referrerId === tgId) {
    referrerId = null;
  }

  // Make sure referrer actually exists
  if (referrerId) {
    const referrerSnapshot = await db
      .ref(`players/${referrerId}`)
      .once('value');

    if (!referrerSnapshot.exists()) {
      referrerId = null;
    }
  }

  player = {
    telegram_id: tgId,
    first_name: firstName,
    username: username,
    phone: '',
    balance: 30,
referralBonusBalance: 0,
games_played: 0,
games_won: 0,
    registration_date: new Date().toISOString(),

    // Referral information
    referredBy: referrerId || null,
    referralJoinRewardGiven: false,
    referralDepositRewardGiven: false
  };

      await playerRef.set(player);
            // ======================================================
      // REFERRAL JOIN BONUS
      // ======================================================

      if (referrerId) {

        const referrerRef =
          db.ref(`players/${referrerId}`);

        const referrerSnapshot =
          await referrerRef.once('value');

        const referrer =
          referrerSnapshot.val();

        if (referrer) {

          await referrerRef.child('referralBonusBalance').transaction(
  balance =>
    Number(balance || 0) +
    REFERRAL_JOIN_BONUS
);

          await referrerRef.update({
            [`referrals/${tgId}/joined`]: true,
            [`referrals/${tgId}/joinReward`]:
              REFERRAL_JOIN_BONUS,
            [`referrals/${tgId}/joinRewardAt`]:
              new Date().toISOString()
          });

          await bot.sendMessage(
            referrerId,
            `🎉 *Referral Bonus!*\n\n` +
            `${firstName} joined ZA Bingo using your referral link.\n\n` +
            `💰 You received *20 Br*!\n\n` +
            `🎁 If ${firstName} deposits at least 50 Br,\n` +
            `you will receive another *20 Br*!`,
            { parse_mode: 'Markdown' }
          );

          console.log(
            `🎁 Referral join bonus: ${referrerId} +20 Br`
          );
        }
      }

      bot.sendMessage(
        chatId,
        `👑 *እንኳን ደህና መጡ, ${firstName}!*\n\n` +
`🎁 *30 ብር ቦነስ ተሰጥቶዎታል!*\n\n` +
`🎱 *እድል Bingo — ይጫወቱ፣ ያሸንፉ! 🏆*\n\n` +
`💰 *ለጓደኞችዎ ያጋሩ — ከአንድ ሪፈራል እስከ 40 ብር!*\n\n` +
`📲 *ምዝገባዎን ለመጨረስ ስልክ ቁጥርዎን ያጋሩ።*\n\n` +
`****************👇👇👇****************`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [[
              {
                text: '📱 Share Contact',
                request_contact: true
              }
            ]],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        }
      );
    } else {
      showMainMenu(chatId);
    }

  } catch (error) {
    console.error('❌ /start error:', error);
    bot.sendMessage(
      chatId,
      '❌ Something went wrong. Please try again.'
    );
  }
});

// Handle contact sharing
bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);
  const phone = msg.contact.phone_number;

  try {
    await db.ref(`players/${tgId}/phone`).set(phone);

    bot.sendMessage(chatId,
  `✅ *የስልክ ቁጥርዎ ተመዝግቧል!*\n\n` +
  `🎱 *እንኳን ወደ እድል Bingo በደህና መጡ! 🏆*\n\n` +
  `🎮 *አሁን መጫወት ይችላሉ!*\n\n` +
  `📤 *ለማጋራት:* Bot 👉 Profile 👥\n\n` +
  `💰 *ለጓደኞችዎ ያጋሩ — ከአንድ ሪፈራል እስከ 40 ብር!*`,
  {
      reply_markup: {
        remove_keyboard: true
      }
    });

    showMainMenu(chatId);

  } catch (error) {
    console.error('❌ Contact save error:', error);

    bot.sendMessage(
      chatId,
      '❌ Could not save your phone number. Please try again.'
    );
  }
});

// ============================================================
// MAIN MENU
// ============================================================
function showMainMenu(chatId) {
  bot.sendMessage(chatId,
    ` *ZA BINGO*\n\n` +
    `Choose an option below:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: ' Play Now', web_app: { url: WEBAPP_URL } }],
          [{ text: ' Deposit', callback_data: 'menu_deposit' }],
          [{ text: ' Withdraw', callback_data: 'menu_withdraw' }],
          [{ text: ' Profile', callback_data: 'menu_profile' }],
        ]
      }
    }
  );
}

// ============================================================
// CALLBACK HANDLERS
// ============================================================
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const tgId = String(query.from.id);
  const data = query.data;

  const playerRef = db.ref(`players/${tgId}`);
const snapshot = await playerRef.once('value');
const player = snapshot.val();
  if (!player) {
    bot.answerCallbackQuery(query.id, { text: 'Please /start first' });
    return;
  }

  // Transfer confirmation
  if (data === 'transfer_cancel') {
    delete transferSessions[chatId];

    await bot.answerCallbackQuery(query.id, {
      text: 'Transfer cancelled'
    });

    await bot.sendMessage(
      chatId,
      'Transfer cancelled.'
    );

    return;
  }

  if (data === 'transfer_confirm') {
    const session = transferSessions[chatId];

    if (!session || session.step !== 'confirm') {
      await bot.answerCallbackQuery(query.id, {
        text: 'Transfer session expired'
      });
      return;
    }

    const amount = Number(session.amount);
    const senderId = tgId;
    const recipientId = session.recipientId;

    // Get both players again before changing balances
    const senderRef = db.ref(`players/${senderId}`);
    const recipientRef = db.ref(`players/${recipientId}`);

    const [senderSnap, recipientSnap] = await Promise.all([
      senderRef.once('value'),
      recipientRef.once('value')
    ]);

    const sender = senderSnap.val();
    const recipient = recipientSnap.val();

    if (!sender || !recipient) {
      delete transferSessions[chatId];

      await bot.answerCallbackQuery(query.id, {
        text: 'Player not found'
      });

      await bot.sendMessage(chatId, '❌ Transfer failed.');
      return;
    }

    const senderBalance = Number(sender.balance || 0);

    if (amount <= 0 || amount > senderBalance) {
      delete transferSessions[chatId];

      await bot.answerCallbackQuery(query.id, {
        text: 'Insufficient balance'
      });

      await bot.sendMessage(
        chatId,
        `❌ Insufficient balance.\n\nYour balance: ${senderBalance} Br`
      );

      return;
    }

    // Deduct from sender
    await senderRef.child('balance').set(senderBalance - amount);

    // Add to recipient
    const recipientBalance = Number(recipient.balance || 0);

    await recipientRef
      .child('balance')
      .set(recipientBalance + amount);

    // Save transaction
    const transactionRef = db.ref('transactions').push();

    await transactionRef.set({
      type: 'transfer',
      senderId: senderId,
      recipientId: recipientId,
      amount: amount,
      status: 'completed',
      createdAt: new Date().toISOString()
    });

    delete transferSessions[chatId];

    await bot.answerCallbackQuery(query.id, {
      text: 'Transfer successful'
    });

    // Sender confirmation
    await bot.sendMessage(
      chatId,
      `✅ Transfer successful!\n\n` +
      `To: ${recipient.first_name || 'Player'}\n` +
      `Phone: ${recipient.phone || 'N/A'}\n` +
      `Amount: ${amount} Br\n\n` +
      `Remaining balance: ${senderBalance - amount} Br`
    );

    // Recipient notification
    await bot.sendMessage(
      recipientId,
      `You received ${amount} Br from ${sender.first_name || 'Player'}.\n\n` +
      `Your new balance: ${recipientBalance + amount} Br`
    );

    return;
  }

  // Menu handlers
if (data === 'menu_deposit') {
  await bot.answerCallbackQuery(query.id);
  return handleDepositMenu(chatId, player);
}

if (data === 'menu_withdraw') {

  const deposited = await hasMadeDeposit(tgId);

  if (!deposited) {

    await bot.answerCallbackQuery(query.id, {
      text: '❌ You must make a deposit first',
      show_alert: true
    });

    await bot.sendMessage(
      chatId,
      `❌ *ገንዘብ ማውጣት አይችሉም*\n\n` +
      `ገንዘብ ማውጣት ከመቻልዎ በፊት ቢያንስ አንድ ጊዜ ዴፖዚት ማድረግ አለብዎት።`,
      { parse_mode: 'Markdown' }
    );

    return;
  }

  await bot.answerCallbackQuery(query.id);

  return handleWithdrawMenu(chatId, player);
}

if (data === 'menu_profile') {
  await bot.answerCallbackQuery(query.id);
  return handleProfile(chatId, player);
}
  // Deposit method selection
else if (data.startsWith('deposit_method_')) {
  const method = data.replace('deposit_method_', '');
  const session = depositSessions[chatId];

  if (!session || session.step !== 'method') {
    bot.sendMessage(chatId, '❌ Deposit session expired. Please start again.');
    return;
  }

  session.method = method;
  session.step = 'sms';

  if (method === 'telebirr') {
  bot.sendMessage(
    chatId,
    `💳 የቴሌብር አካውንት: \`0985661720\`\n\n` +
    `1️⃣ ከላይ ባለው የቴሌብር አካውንት ብር ያስገቡ\n\n` +
    `2️⃣ የምትልኩት የገንዘብ መጠን እና እዚህ ላይ እንዲሞላልዎ የምታስገቡት የብር መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ\n\n` +
    `3️⃣ ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዘ አጭር የጹሁፍ መልእክት (SMS) ከቴሌብር ይደርሳችኋል\n\n` +
    `4️⃣ የደረሳችሁን SMS ሙሉውን Copy በማድረግ ከታች ባለው የቴሌግራም የጹሁፍ ማስገቢያ ላይ Paste በማድረግ ይላኩት\n\n` +
    `⚠️ ማሳሰቢያ: የከፈላችሁበትን SMS ሙሉውን እዚህ ላይ ያስገቡት 👇👇👇`,
    { parse_mode: 'Markdown' }
  );
} else if (method === 'cbe') {
  bot.sendMessage(
    chatId,
`💳 CBE Birr አካውንት: \`0985661720\`\n\n` +
`1️⃣ ከላይ ባለው CBE Birr አካውንት ብር ያስገቡ\n\n` +
`2️⃣ የምትልኩት የገንዘብ መጠን እና እዚህ ላይ እንዲሞላልዎ የምታስገቡት የብር መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ\n\n` +
`3️⃣ ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዘ አጭር የጹሁፍ መልእክት (SMS) ከCBE Birr ይደርሳችኋል\n\n` +
`4️⃣ የደረሳችሁን SMS ሙሉውን Copy በማድረግ ከታች ባለው የቴሌግራም የጹሁፍ ማስገቢያ ላይ Paste በማድረግ ይላኩት\n\n` +
`⚠️ ማሳሰቢያ: በCBE Birr አካውንት ብቻ ብር መላካችሁን እርግጠኛ ይሁኑ\n` +
`የከፈላችሁበትን SMS ሙሉውን እዚህ ላይ ያስገቡት 👇👇👇`,
    { parse_mode: 'Markdown' }
  );
}
}
  // Withdraw method selection
  else if (data.startsWith('withdraw_method_')) {
    const method = data.replace('withdraw_method_', '');
    bot.sendMessage(chatId,
      ` *በ${method === 'telebirr' ? 'ቴሌ ብር' : 'CBE'} ለማውጣት*\n\n` +
`ማውጣት የፈለጉትን መጠን ያስገቡ 👇`,
      { parse_mode: 'Markdown' }
    );
    withdrawSessions[chatId] = { method, step: 'amount' };
  }
  
  // Admin: Approve withdrawal
  else if (data.startsWith('approve_withdraw_')) {
    const txnId = data.replace('approve_withdraw_', '');
    approveWithdrawal(query, txnId);
  }
  // Admin: Reject withdrawal
  else if (data.startsWith('reject_withdraw_')) {
    const txnId = data.replace('reject_withdraw_', '');
    rejectWithdrawal(query, txnId);
  }

  bot.answerCallbackQuery(query.id);
});

// ============================================================
// SESSION STORAGE (In production, use Redis or DB)
// ============================================================
const depositSessions = {};
const withdrawSessions = {};
const transferSessions = {};
// ============================================================
// BROADCAST USERS
// ============================================================
const broadcastUsers = {};
// ============================================================
// TEXT MESSAGE HANDLER (for amount input)
// ============================================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Save user for future broadcasts
  broadcastUsers[String(chatId)] = true;

  const tgId = String(msg.from.id);
  const text = msg.text;

  // Skip commands and contacts
  if (!text || text.startsWith('/') || msg.contact) return;

  const playerRef = db.ref(`players/${tgId}`);
const snapshot = await playerRef.once('value');
const player = snapshot.val();

  // Handle deposit amount
if (depositSessions[chatId] && depositSessions[chatId].step === 'amount') {
  const amount = parseFloat(text);

  if (isNaN(amount) || amount < 10) {
    bot.sendMessage(chatId, '❌ Minimum deposit is 10 Br. Enter amount:');
    return;
  }

  // Save amount and move to payment method
  depositSessions[chatId] = {
    step: 'method',
    amount: amount
  };

  bot.sendMessage(
    chatId,
    `ለማስገባት የፈለጉት: *${amount} Br*\n\nየመክፈያ አማራጭ ይምረጡ 👇:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: ' Telebirr', callback_data: 'deposit_method_telebirr' }],
          [{ text: ' CBE Birr', callback_data: 'deposit_method_cbe' }],
          [{ text: '🔙 Back', callback_data: 'back_to_menu' }]
        ]
      }
    }
  );

  return;
}

  // Handle deposit SMS
if (
  depositSessions[chatId] &&
  depositSessions[chatId].step === 'sms'
) {
  const session = depositSessions[chatId];
  const amount = Number(session.amount);
  const method = session.method;
  const sms = text.trim();



// ============================================================
// PLAYER CBE BIRR SMS
// ============================================================
if (method === 'cbe') {

  // English CBE
  let match = sms.match(
    /you have sent\s+([\d,]+(?:\.\d{1,2})?)Br\..*?Txn ID\s+([A-Z0-9]+)/i
  );

  // Amharic CBE
  if (!match) {
    match = sms.match(
      /([\d,]+(?:\.\d{1,2})?)Br\.\s+ለ.*?በደረሰኝ ቁጥር\s*([A-Z0-9]+)/i
    );
  }

  if (match) {
    smsData = {
      amount: Number(match[1].replace(/,/g, '')),
      transactionId: match[2].toUpperCase()
    };
  }
}


// PLAYER TELEBIRR SMS
if (method === 'telebirr') {

  // Amharic Telebirr
  let match = sms.match(
    /([\d,]+\.\d{2})\s*ብር[\s\S]*?የሂሳብ\s+እንቅስቃሴ\s+ቁጥርዎ\s+([A-Z0-9]+)/i
  );

  // English Telebirr
  if (!match) {
    match = sms.match(
      /You\s+have\s+transferred\s+ETB\s+([\d,]+\.\d{2})[\s\S]*?Your\s+transaction\s+number\s+is\s+([A-Z0-9]+)/i
    );
  }

  if (match) {
    smsData = {
      amount: Number(match[1].replace(/,/g, '')),
      transactionId: match[2].toUpperCase()
    };
  }
}

// Reject if parsing failed
if (!smsData) {
  bot.sendMessage(
    chatId,
    'ያስገቡት የትራንዛክሽን ቁጥር የተሳሳተ ነው። እባክዎ ሲከፍሉ የደረስዎትን የጹሁፍ መልዕክት(sms) ሙሉውን ኮፒ አርገው እዚህ ላይ ፔስት ያርጉት።'
  );
  return;
}

const smsAmount = Number(smsData.amount);

const transactionId =
  String(smsData.transactionId).toUpperCase();
  // Check that SMS amount matches the amount entered
  if (smsAmount !== amount) {
    bot.sendMessage(
      chatId,
      `❌ The SMS amount (${smsAmount} Br) does not match your deposit amount (${amount} Br).`
    );
    return;
  }

// Check official SMS saved by the main bot
  const officialRef = db.ref(
    `officialDeposits/${transactionId}`
  );

  const officialSnapshot =
    await officialRef.once('value');

  const official = officialSnapshot.val();

  if (!official || official.status !== 'available') {
    bot.sendMessage(
      chatId,
      '⏳ ይህን ክፍያ እስካሁን ማግኘት አልተቻለም። እባክዎ ትክክለኛውን የክፍያ SMS መልዕክት መድረሱን ያረጋግጡና እንደገና ይላኩ።'
    );
    return;
  }

  // Verify amount
  if (Number(official.amount) !== smsAmount) {
    bot.sendMessage(
      chatId,
      '❌ Payment verification failed.'
    );
    return;
  }

  // Check 3-day expiration
if (official.expiresAt) {
  if (Date.now() > new Date(official.expiresAt).getTime()) {
    bot.sendMessage(
      chatId,
      '❌ This payment SMS has expired.'
    );
    return;
  }
}

// Compare amount + transaction ID
if (
  Number(official.amount) !== smsAmount ||
  String(official.transactionId).toUpperCase() !==
    transactionId.toUpperCase()
) {
  bot.sendMessage(
    chatId,
    '❌ The SMS does not match the official payment record.'
  );
  return;
}

  // Create approved transaction
  const transactionRef =
    db.ref('transactions').push();

  await transactionRef.set({
    playerId: tgId,
    telegramId: tgId,
    type: 'deposit',
    amount: amount,
    status: 'approved',
    paymentMethod: method,
    sms: sms,
    transactionId: transactionId,
    officialDepositId: transactionId,
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString()
  });

  // Add money to player's balance
  const balanceRef = db.ref(
    `players/${tgId}/balance`
  );

  const balanceResult =
    await balanceRef.transaction(
      balance => Number(balance || 0) + amount
    );

  const newBalance =
    Number(balanceResult.snapshot.val() || 0);
      // ======================================================
  // REFERRAL DEPOSIT BONUS
  // B deposits 50+ Br for the first time
  // A gets another 20 Br
  // ======================================================

  const depositedPlayerSnapshot =
    await db.ref(`players/${tgId}`).once('value');

  const depositedPlayer =
    depositedPlayerSnapshot.val();

  const referrerIdForDeposit =
    depositedPlayer?.referredBy;

  if (
    referrerIdForDeposit &&
    amount >= REFERRAL_MIN_DEPOSIT &&
    depositedPlayer.referralDepositRewardGiven !== true
  ) {

    const referrerRef =
      db.ref(`players/${referrerIdForDeposit}`);

    const referrerSnapshot =
      await referrerRef.once('value');

    const referrer =
      referrerSnapshot.val();

    if (referrer) {

      // Give referrer second 20 Br
      await referrerRef.child('referralBonusBalance').transaction(
  balance =>
    Number(balance || 0) +
    REFERRAL_DEPOSIT_BONUS
);

      // Mark reward as permanently given
      await db.ref(`players/${tgId}`).update({
        referralDepositRewardGiven: true,
        referralDepositRewardAt:
          new Date().toISOString()
      });

      // Save referral record
      await referrerRef.update({
        [`referrals/${tgId}/depositReward`]:
          REFERRAL_DEPOSIT_BONUS,
        [`referrals/${tgId}/depositRewardAt`]:
          new Date().toISOString()
      });

      // Notify A
      await bot.sendMessage(
        referrerIdForDeposit,
        `🎉 *Referral Deposit Bonus!*\n\n` +
        `${depositedPlayer.first_name || 'Your referral'} ` +
        `made a deposit of *${amount} Br*.\n\n` +
        `💰 You received another *20 Br*!\n\n` +
        `🏆 Total referral bonus earned from this player: *40 Br*`,
        { parse_mode: 'Markdown' }
      );

      console.log(
        `🎁 Referral deposit bonus: ${referrerIdForDeposit} +20 Br`
      );
    }
  }

  // Mark official SMS as used
  await officialRef.update({
    status: 'used',
    usedBy: String(tgId),
    usedTransaction: transactionRef.key,
    usedAt: new Date().toISOString()
  });

  await bot.sendMessage(
  chatId,
  `🧾 *ሂሳብዎ ገብቷል*\n\n` +
  `Receiver phone:  ${player.phone || 'N/A'}\n` +
  `Amount:          ${amount.toFixed(2)} ETB\n` +
  `Reference:       ${transactionId}\n\n` +
  `💰 New balance:   ${newBalance.toFixed(2)} ETB`,
  { parse_mode: 'Markdown' }
);

  delete depositSessions[chatId];
  return;
}

// ============================================================
// HANDLE WITHDRAWAL
// ============================================================

if (withdrawSessions[chatId]) {

  const session = withdrawSessions[chatId];

  // ----------------------------------------------------------
  // STEP 1 — AMOUNT
  // ----------------------------------------------------------

  if (session.step === 'amount') {

    const amount = parseFloat(text);

    if (!Number.isFinite(amount) || amount <= 0) {
      await bot.sendMessage(
        chatId,
        '❌ የተሳሳተ መጠን ነው። እባክዎ የሚያወጡትን መጠን እንደገና ያስገቡ።'
      );
      return;
    }

    const balance = Number(player.balance || 0);

    if (amount > balance) {
      await bot.sendMessage(
        chatId,
        `❌ በቂ ቀሪ ሂሳብ የለዎትም።\n\n💰 ያለዎት ሂሳብ: ${balance} Br`
      );
      return;
    }

    session.amount = amount;
    session.step = 'phone';

    await bot.sendMessage(
      chatId,
      session.method === 'cbe'
        ? `🍂 ገንዘቡን የሚቀበሉበትን CBE አካውንት ቁጥር ያስገቡ 👇`
        : `📱 ገንዘቡን የሚቀበሉበትን የስልክ ቁጥር ያስገቡ 👇`
    );

    return;
  }


  // ----------------------------------------------------------
  // STEP 2 — PHONE / CBE ACCOUNT
  // ----------------------------------------------------------

  if (session.step === 'phone') {

    const input = text.trim();

    // --------------------------------------------------------
    // CBE → ACCOUNT NUMBER
    // --------------------------------------------------------

    if (session.method === 'cbe') {

      if (!/^\d+$/.test(input)) {
        await bot.sendMessage(
          chatId,
          `❌ የተሳሳተ የCBE አካውንት ቁጥር ነው።`
        );
        return;
      }

      session.phone = input;
      session.step = 'firstName';

      await bot.sendMessage(
        chatId,
        `👤 የመጀመሪያ ስምዎን ያስገቡ 👇`
      );

      return;
    }


    // --------------------------------------------------------
    // TELEBIRR → PHONE NUMBER
    // --------------------------------------------------------

    const normalizedPhone = input.replace(/\D/g, '');

    if (
      !(
        normalizedPhone.startsWith('09') &&
        normalizedPhone.length === 10
      ) &&
      !(
        normalizedPhone.startsWith('2519') &&
        normalizedPhone.length === 12
      )
    ) {
      await bot.sendMessage(
        chatId,
        `❌ የተሳሳተ የስልክ ቁጥር ነው።\n\n` +
        `ለምሳሌ፦ 09XXXXXXXX`
      );
      return;
    }

    session.phone = input;

    // Telebirr does not need first name.
    // Create the pending withdrawal below.
  }


  // ----------------------------------------------------------
  // STEP 3 — CBE FIRST NAME
  // ----------------------------------------------------------

  if (session.step === 'firstName') {

    const firstName = text.trim();

    if (!firstName) {
      await bot.sendMessage(
        chatId,
        `❌ እባክዎ የመጀመሪያ ስምዎን ያስገቡ።`
      );
      return;
    }

    session.firstName = firstName;
  }


  // ----------------------------------------------------------
  // ONLY CREATE REQUEST AFTER ALL REQUIRED INFORMATION
  // ----------------------------------------------------------

  if (
    session.method === 'cbe' &&
    (!session.phone || !session.firstName)
  ) {
    return;
  }

  if (
    session.method === 'telebirr' &&
    !session.phone
  ) {
    return;
  }


  const phone = session.phone;


  // ----------------------------------------------------------
  // CREATE PENDING WITHDRAWAL
  // ----------------------------------------------------------

  const transactionRef =
    db.ref('transactions').push();

  await transactionRef.set({
    playerId: tgId,
    telegramId: tgId,

    type: 'withdrawal',

    amount: Number(session.amount),

mainAmount: mainDeduct,
referralAmount: requestedAmount - mainDeduct,

status: 'pending',

    paymentMethod: session.method,

    withdrawalPhone: phone,

    firstName:
      session.method === 'cbe'
        ? session.firstName
        : '',

    createdAt: new Date().toISOString()
  });

// ============================================================
// WITHDRAWAL BALANCE CHECK
// ============================================================

const requestedAmount = Number(session.amount);

const mainBalance = Number(player.balance || 0);

const referralBonusBalance =
  Number(player.referralBonusBalance || 0);

const gamesWon =
  Number(player.games_won ?? player.gamesWon ?? 0);

// Main balance is always used first
let mainAmount = Math.min(
  requestedAmount,
  mainBalance
);

let referralAmount =
  requestedAmount - mainAmount;

// Referral money requires 10 wins
if (referralAmount > 0 && gamesWon < 10) {
  await bot.sendMessage(
    chatId,
    `🎁 Referral bonus is locked.\n\n` +
    `Referral balance: ${referralBonusBalance.toFixed(2)} Br\n` +
    `Games won: ${gamesWon}/10\n\n` +
    `🏆 You need 10 wins before you can withdraw your referral bonus.\n\n` +
    `💰 You can still withdraw from your main balance.`
  );

  return;
}

// Make sure referral balance is sufficient
if (referralAmount > referralBonusBalance) {
  await bot.sendMessage(
    chatId,
    `❌ Insufficient balance.\n\n` +
    `Main balance: ${mainBalance.toFixed(2)} Br\n` +
    `Referral balance: ${referralBonusBalance.toFixed(2)} Br`
  );

  return;
}
// ----------------------------------------------------------
// DEDUCT FROM MAIN BALANCE FIRST,
// THEN REFERRAL BONUS BALANCE
// ----------------------------------------------------------

let remainingAmount = requestedAmount;

// 1. Deduct from main balance first
const mainDeduct = Math.min(
  remainingAmount,
  mainBalance
);

let newBalance =
  mainBalance - mainDeduct;

remainingAmount -= mainDeduct;

// 2. Deduct the rest from referral bonus
let newReferralBonusBalance =
  referralBonusBalance;

if (remainingAmount > 0) {
  newReferralBonusBalance =
    referralBonusBalance - remainingAmount;
}

// 3. Save both balances
await db.ref(`players/${tgId}`).update({
  balance: newBalance,
  referralBonusBalance:
    newReferralBonusBalance
});


  // ----------------------------------------------------------
  // ADMIN NOTIFICATION
  // ----------------------------------------------------------

  await bot.sendMessage(
    ADMIN_ID,
    `💰 *New Withdrawal Request*\n\n` +
    `Player: ${player.first_name || 'Player'}\n` +
    `Username: @${player.username || 'N/A'}\n` +
    `Amount: ${Number(session.amount).toFixed(2)} Br\n` +
    `Method: ${
      session.method === 'telebirr'
        ? 'Telebirr'
        : 'CBE Birr'
    }\n` +
    `Phone/Account: ${phone}\n` +
    `${
      session.method === 'cbe'
        ? `First Name: ${session.firstName}\n`
        : ''
    }` +
    `Date: ${new Date().toLocaleString()}`,
    {
      parse_mode: 'Markdown'
    }
  );


  // ----------------------------------------------------------
  // PLAYER CONFIRMATION
  // ----------------------------------------------------------

  await bot.sendMessage(
    chatId,
    `🧾 *የገንዘብ ማውጣት ጥያቄዎ ተልኳል* ✅\n\n` +
    `💰 መጠን: ${Number(session.amount).toFixed(2)} Br\n` +
    `💳 መንገድ: ${
      session.method === 'telebirr'
        ? 'Telebirr'
        : 'CBE Birr'
    }\n` +
    `📱 ${
      session.method === 'cbe'
        ? 'አካውንት'
        : 'ስልክ'
    }: ${phone}\n\n` +
    `⏳ ሁኔታ: Pending\n` +
    `💰 Main balance: ${newBalance.toFixed(2)} Br\n` +
`🎁 Referral balance: ${newReferralBonusBalance.toFixed(2)} Br`,
    {
      parse_mode: 'Markdown'
    }
  );


  // ----------------------------------------------------------
  // CLEAR SESSION
  // ----------------------------------------------------------

  delete withdrawSessions[chatId];

  return;
}
  // ============================================================
// HANDLE PLAYER TRANSFER
// ============================================================

if (transferSessions[chatId]) {
  const session = transferSessions[chatId];

  // Step 1: Phone number
  if (session.step === 'phone') {
    const phone = text.trim();

    const playersSnapshot = await db.ref('players').once('value');
    const players = playersSnapshot.val() || {};

    let recipientId = null;
    let recipient = null;

    for (const [id, p] of Object.entries(players)) {
      if (!p) continue;

      const normalizePhone = (number) => {
  let phone = String(number || '').replace(/\D/g, '');

  if (phone.startsWith('251')) {
    phone = phone.slice(3);
  }

  if (phone.startsWith('0')) {
    phone = phone.slice(1);
  }

  return phone;
};

const savedPhone = normalizePhone(p.phone);
const enteredPhone = normalizePhone(phone);

if (savedPhone === enteredPhone) {
  recipientId = id;
  recipient = p;
  break;
}
    }

    if (!recipient) {
      bot.sendMessage(
        chatId,
        '❌ No player was found with this phone number.'
      );
      return;
    }

    if (recipientId === tgId) {
      bot.sendMessage(
        chatId,
        '❌ You cannot transfer money to yourself.'
      );
      return;
    }

    session.recipientId = recipientId;
    session.recipient = recipient;
    session.step = 'amount';

    bot.sendMessage(
      chatId,
      `Recipient: ${recipient.first_name || 'Player'}\n\n` +
      `Enter the amount to transfer:`
    );

    return;
  }

  // Step 2: Amount
  if (session.step === 'amount') {
    const amount = Number(text);

    if (!Number.isFinite(amount) || amount < 10) {
      bot.sendMessage(
        chatId,
        '❌ Invalid amount. Enter the amount again:'
      );
      return;
    }

    const balance = Number(player.balance || 0);

    if (amount > balance) {
      bot.sendMessage(
        chatId,
        `❌ Insufficient balance.\n\nYour balance: ${balance} Br`
      );
      return;
    }

    session.amount = amount;
    session.step = 'confirm';

    bot.sendMessage(
      chatId,
      `Transfer Confirmation\n\n` +
      `To: ${session.recipient.first_name || 'Player'}\n` +
      `Phone: ${session.recipient.phone}\n` +
      `Amount: ${amount} Br\n\n` +
      `Confirm this transfer?`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Confirm',
                callback_data: 'transfer_confirm'
              },
              {
                text: 'Cancel',
                callback_data: 'transfer_cancel'
              }
            ]
          ]
        }
      }
    );

    return;
  }
}
});

function isAdmin(telegramId) {
  return String(telegramId) === String(ADMIN_ID);
}

// ============================================================
// ADMIN — APPROVE WITHDRAWAL
// ============================================================

async function approveWithdrawal(query, txnId) {
  const chatId = query.message.chat.id;
  const adminId = String(query.from.id);

  if (!isAdmin(adminId)) {
    await bot.answerCallbackQuery(query.id, {
      text: '❌ Admin only',
      show_alert: true
    });
    return;
  }

  try {
    const transactionRef = db.ref(`transactions/${txnId}`);
    const snapshot = await transactionRef.once('value');
    const transaction = snapshot.val();

    if (!transaction) {
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Transaction not found',
        show_alert: true
      });
      return;
    }

    if (transaction.status !== 'pending') {
      await bot.answerCallbackQuery(query.id, {
        text: '⚠️ Already processed',
        show_alert: true
      });
      return;
    }

    const playerId = String(transaction.telegramId);
    const amount = Number(transaction.amount);

    const playerRef = db.ref(`players/${playerId}`);
    const playerSnapshot = await playerRef.once('value');
    const player = playerSnapshot.val();

    if (!player) {
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Player not found',
        show_alert: true
      });
      return;
    }

  

    await transactionRef.update({
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: adminId
    });

    await bot.sendMessage(
      playerId,
      `✅ *Withdrawal approved!*\n\n` +
      `Amount: ${amount} Br\n` +
      `Phone: ${transaction.withdrawalPhone || 'N/A'}\n\n` +
      `💰 Remaining balance: ${Number(player.balance || 0)} Br`,
      { parse_mode: 'Markdown' }
    );

    await bot.answerCallbackQuery(query.id, {
      text: '✅ Withdrawal approved'
    });

    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      {
        chat_id: chatId,
        message_id: query.message.message_id
      }
    );

    await bot.sendMessage(
      chatId,
      `✅ Withdrawal approved.\n\n` +
      `Player: ${player.first_name || 'Player'}\n` +
      `Amount: ${amount} Br`
    );

  } catch (error) {
    console.error('❌ Approve withdrawal error:', error);

    await bot.answerCallbackQuery(query.id, {
      text: '❌ Approval failed',
      show_alert: true
    });
  }
}

// ============================================================
// ADMIN — REJECT WITHDRAWAL
// ============================================================

async function rejectWithdrawal(query, txnId) {
  const chatId = query.message.chat.id;
  const adminId = String(query.from.id);

  if (!isAdmin(adminId)) {
    await bot.answerCallbackQuery(query.id, {
      text: '❌ Admin only',
      show_alert: true
    });
    return;
  }

  try {
    const transactionRef = db.ref(`transactions/${txnId}`);
    const snapshot = await transactionRef.once('value');
    const transaction = snapshot.val();

    if (!transaction) {
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Transaction not found',
        show_alert: true
      });
      return;
    }

    if (transaction.status !== 'pending') {
      await bot.answerCallbackQuery(query.id, {
        text: '⚠️ Already processed',
        show_alert: true
      });
      return;
    }

    await transactionRef.update({
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectedBy: adminId
    });

    await bot.sendMessage(
      transaction.telegramId,
      `❌ *Withdrawal rejected.*\n\n` +
      `Amount: ${transaction.amount} Br\n` +
      `Phone: ${transaction.withdrawalPhone || 'N/A'}`,
      { parse_mode: 'Markdown' }
    );

    await bot.answerCallbackQuery(query.id, {
      text: '❌ Withdrawal rejected'
    });

    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      {
        chat_id: chatId,
        message_id: query.message.message_id
      }
    );

    await bot.sendMessage(
      chatId,
      `❌ Withdrawal rejected.\n\n` +
      `Amount: ${transaction.amount} Br`
    );

  } catch (error) {
    console.error('❌ Reject withdrawal error:', error);

    await bot.answerCallbackQuery(query.id, {
      text: '❌ Rejection failed',
      show_alert: true
    });
  }
}

    

// ============================================================
// HANDLERS
// ============================================================
function handleDepositMenu(chatId, player) {
  bot.sendMessage(
    chatId,
    ` *ገንዘብ ለማስገባት*\n\n` +
    `ቀሪ ሂሳብ: ${player.balance} Br\n\n` +
    `ማስገባት የሚፈልጉትን መጠን ያስገቡ 👇 ( ዝቅተኛ 10 ብር):`,
    { parse_mode: 'Markdown' }
  );

  depositSessions[chatId] = {
    step: 'amount'
  };
}
// ============================================================
// CHECK WITHDRAWAL DEPOSIT REQUIREMENT
// Player must have at least ONE approved deposit
// ============================================================

async function hasMadeDeposit(telegramId) {
  const snapshot = await db
    .ref('transactions')
    .orderByChild('telegramId')
    .equalTo(String(telegramId))
    .once('value');

  const transactions = snapshot.val() || {};

  return Object.values(transactions).some(transaction =>
    transaction &&
    transaction.type === 'deposit' &&
    transaction.status === 'approved'
  );
}

function handleWithdrawMenu(chatId, player) {
  bot.sendMessage(chatId,
    ` *ገንዘብ ለማውጣት*\n\n` +
`ቀሪ ሂሳብዎ: ${player.balance} Br\n` +
`ገንዘብ የማውጫ መንገድ ይምረጡ 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: ' Telebirr', callback_data: 'withdraw_method_telebirr' }],
          [{ text: ' CBE', callback_data: 'withdraw_method_cbe' }],
          [{ text: '🔙 Back', callback_data: 'back_to_menu' }],
        ]
      }
    }
  );
}

function handleProfile(chatId, player) {
  // ============================================================
  // REFERRAL LINK
  // Format must match /start handler:
  // /start ref_TELEGRAM_ID
  // ============================================================

  const referralLink =
    `https://t.me/ZABingo_bot?start=ref_${player.telegram_id}`;

  const shareText =
    `🎱 Join Edel Bingo and get your bonus!\n\n` +
    `👉 ${referralLink}`;

  const shareLink =
    `https://t.me/share/url?url=${encodeURIComponent(referralLink)}` +
    `&text=${encodeURIComponent(shareText)}`;

  bot.sendMessage(
    chatId,
    `*Profile*\n\n` +
    `Name: ${player.first_name}\n` +
    `Username: @${player.username || 'N/A'}\n` +
    `Phone: ${player.phone || 'Not set'}\n` +
    `Balance: ${player.balance} Br\n` +
    `Games Played: ${player.games_played}\n` +
    `Games Won: ${player.gamesWon ?? player.games_won ?? 0}\n` +
    `Joined: ${player.registration_date}\n\n` +
    `🔗 *Referral link:*\n` +
    `[👉 የሬፈራል ሊንክዎን ይጫኑ](${referralLink})`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📤 Share Referral Link',
              url: shareLink
            }
          ]
        ]
      }
    }
  );
}

// ============================================================
// ADMIN FUNCTIONS
// ============================================================


// ============================================================
// GAME MANAGER INTEGRATION
// ============================================================
function setGameManager(gm) {
  gameManager = gm;
}

// ============================================================
// DAILY + WEEKLY BONUS SYSTEM
//
// DAILY  → Every day at 10:30 PM Ethiopia
// WEEKLY → Every Sunday at 10:30 PM Ethiopia
//
// RULES:
// Real player  → 1 actual win = 1 leaderboard win
// Sim player   → 3 actual wins = 1 leaderboard win
//
// Daily  → Top 3
// Weekly → Top 5
//
// IMPORTANT:
// winners/ is NEVER deleted.
// Announcement happens BEFORE reset.
// Daily and Weekly are separate.
// ============================================================

let lastDailyBonusDate = null;
let lastWeeklyBonusDate = null;
async function recordWeeklyWin(playerId, playerName) {
  const ref = db.ref(`leaderboards/weekly/${playerId}`);
  const snapshot = await ref.once('value');
  const current = snapshot.val() || {};

  await ref.set({
    playerId: String(playerId),
    playerName: playerName || 'Player',
    actualWins: Number(current.actualWins || 0) + 1,
    updatedAt: new Date().toISOString()
  });
}


// ============================================================
// ETHIOPIA DATE HELPER
// ============================================================

function getEthiopiaDate(date) {

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Addis_Ababa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(date));

  const p = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      p[part.type] = Number(part.value);
    }
  }

  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}


// ============================================================
// CONVERT ACTUAL WINS → LEADERBOARD WINS
// ============================================================

function calculateLeaderboardWins(playerId, actualWins) {

  // SIMULATED PLAYER
  if (String(playerId).startsWith('sim_')) {
    return Math.floor(actualWins / 3);
  }

  // REAL PLAYER
  return actualWins;
}


// ============================================================
// DAILY + WEEKLY CHECK
// ============================================================

setInterval(async () => {

  try {

    const now = getEthiopiaTimeParts();

    // ========================================================
    // ONLY RUN AT 10:30 PM ETHIOPIA TIME
    // ========================================================

    if (now.hour !== 22 || now.minute !== 30) {
      return;
    }

    const today =
      `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;


    // ========================================================
    // GET ALL WINNER HISTORY
    //
    // NEVER DELETE winners/
    // ========================================================

    const snapshot = await db.ref('winners').once('value');

    const data = snapshot.val() || {};

    const allWinners = Object.values(data);


    // ========================================================
    // DAILY LEADERBOARD
    // ========================================================

    if (lastDailyBonusDate !== today) {

      console.log('🏆 CALCULATING DAILY LEADERBOARD...');

      const dailyLeaderboard = {};


      // ------------------------------------------------------
      // FIND TODAY'S WINNERS
      // ------------------------------------------------------

      for (const winner of allWinners) {

        if (!winner.date) continue;

        const winnerDay =
          getEthiopiaDate(winner.date);

        if (winnerDay !== today) {
          continue;
        }

        const playerId =
          String(winner.playerId);


        if (!dailyLeaderboard[playerId]) {

          dailyLeaderboard[playerId] = {
            playerId,
            playerName:
              winner.playerName || 'Player',

            actualWins: 0,
            wins: 0
          };

        }

        dailyLeaderboard[playerId].actualWins++;
      }


      // ------------------------------------------------------
      // APPLY SIM 3:1 RULE
      // ------------------------------------------------------

      for (const player of Object.values(dailyLeaderboard)) {

        player.wins =
          calculateLeaderboardWins(
            player.playerId,
            player.actualWins
          );
      }


      // ------------------------------------------------------
      // TOP 3
      // ------------------------------------------------------

      const dailyTop3 =
        Object.values(dailyLeaderboard)
          .filter(player => player.wins > 0)
          .sort((a, b) => {

            if (b.wins !== a.wins) {
              return b.wins - a.wins;
            }

            return b.actualWins - a.actualWins;
          })
          .slice(0, 3);


      // ------------------------------------------------------
      // DISPLAY NAMES
      // ------------------------------------------------------

      const dailyNames = [
        dailyTop3[0]
          ? `${dailyTop3[0].playerName} (${dailyTop3[0].wins})`
          : 'No winner',

        dailyTop3[1]
          ? `${dailyTop3[1].playerName} (${dailyTop3[1].wins})`
          : 'No winner',

        dailyTop3[2]
          ? `${dailyTop3[2].playerName} (${dailyTop3[2].wins})`
          : 'No winner'
      ];


      // ======================================================
      // DAILY ANNOUNCEMENT
      // ======================================================

      const dailyMessage =
`🏆 የዕለታዊ ቦነስ ተሸላሚዎች 🏆

🥇 1ኛ ደረጃ — ${dailyNames[0]} 💰 500 ብር

🥈 2ኛ ደረጃ — ${dailyNames[1]} 💰 250 ብር

🥉 3ኛ ደረጃ — ${dailyNames[2]} 💰 100 ብር

🎉 አሸናፊዎች እንኳን ደስ አላችሁ!

🎱 ይጫወቱ ያሸንፉ ይሸለሙ!

🎁 የ30 ብር ቦነስ ያግኙ!

https://t.me/ZABingo_bot

❤️ Edel Bingo — መልካም ጨዋታ!`;


      // ------------------------------------------------------
      // POST FIRST
      // ------------------------------------------------------

      await bot.sendMessage(
        BONUS_CHANNEL,
        dailyMessage
      );

      console.log('✅ DAILY BONUS POSTED');


      // ------------------------------------------------------
      // RESET DAILY DATA ONLY
      //
      // winners/ IS NOT TOUCHED
      // ------------------------------------------------------

      await db.ref('leaderboards/daily').remove();

      lastDailyBonusDate = today;

      console.log(
        '🔄 DAILY LEADERBOARD RESET'
      );
    }


    // ========================================================
    // WEEKLY BONUS
    //
    // SUNDAY ONLY
    // WEEK = MONDAY → SUNDAY
    // ========================================================

    const todayDate =
      new Date(
        `${today}T12:00:00+03:00`
      );

    const dayOfWeek =
      todayDate.getDay();

    // Sunday = 0
    const isSunday =
      dayOfWeek === 0;


    if (
      isSunday &&
      lastWeeklyBonusDate !== today
    ) {

      console.log(
        '🏆 CALCULATING WEEKLY LEADERBOARD...'
      );


      // ------------------------------------------------------
      // FIND MONDAY OF CURRENT WEEK
      // ------------------------------------------------------

      const weekStart =
        new Date(todayDate);

      // Sunday → go back 6 days
      weekStart.setDate(
        weekStart.getDate() - 6
      );

      weekStart.setHours(
        0, 0, 0, 0
      );


      // ------------------------------------------------------
      // WEEKLY LEADERBOARD
      // ------------------------------------------------------

      const weeklyLeaderboard = {};


      for (const winner of allWinners) {

        if (!winner.date) continue;

        const winnerDate =
          new Date(winner.date);


        // Convert winner date to Ethiopia date
        const winnerDay =
          getEthiopiaDate(
            winner.date
          );


        const winnerEthiopiaDate =
          new Date(
            `${winnerDay}T12:00:00+03:00`
          );


        // Monday → Sunday
        if (
          winnerEthiopiaDate < weekStart ||
          winnerEthiopiaDate > todayDate
        ) {
          continue;
        }


        const playerId = String(winner.playerId);

if (!weeklyLeaderboard[playerId]) {
  weeklyLeaderboard[playerId] = {
    playerId: playerId,
    playerName: winner.playerName || 'Player',
    wins: 0,
    actualWins: 0
  };
}

// Count every actual win
weeklyLeaderboard[playerId].actualWins++;
      }


      // ------------------------------------------------------
      // APPLY SIM 3:1 RULE
      // ------------------------------------------------------

      for (
        const player
        of Object.values(weeklyLeaderboard)
      ) {

        player.wins =
          calculateLeaderboardWins(
            player.playerId,
            player.actualWins
          );
      }


      // ------------------------------------------------------
      // TOP 5
      // ------------------------------------------------------

      const weeklyTop5 =
        Object.values(weeklyLeaderboard)
          .filter(player => player.wins > 0)
          .sort((a, b) => {

            if (b.wins !== a.wins) {
              return b.wins - a.wins;
            }

            return b.actualWins - a.actualWins;
          })
          .slice(0, 5);


      // ------------------------------------------------------
      // DISPLAY NAMES
      // ------------------------------------------------------

      const weeklyNames = [];

      for (let i = 0; i < 5; i++) {

        if (weeklyTop5[i]) {

          weeklyNames.push(
            `${weeklyTop5[i].playerName} (${weeklyTop5[i].wins})`
          );

        } else {

          weeklyNames.push(
            'No winner'
          );

        }
      }








      // ------------------------------------------------------
      // RESET WEEKLY DATA ONLY
      //
      // winners/ IS NEVER TOUCHED
      // ------------------------------------------------------

      await db.ref('leaderboards/weekly').remove();

      lastWeeklyBonusDate = today;

      console.log(
        '🔄 WEEKLY LEADERBOARD RESET'
      );
    }

  } catch (error) {

    console.error(
      '❌ DAILY/WEEKLY BONUS ERROR:',
      error
    );

  }

}, 30 * 1000);
// ============================================================
// DAILY PROMOTIONAL ANNOUNCEMENT
// 2:00 PM + 8:00 PM ETHIOPIA TIME
// ============================================================

const PROMO_CHANNELS = [
  '@EdelBingoo',
  '@ethiotictok',
  '@Edelcrypto',
  '@Edelsportnews',
  '@ethiohotenew',
  '@yareddish'
];

const promoMessage = `
🏆 EDEL BINGO — DAILY BONUS 🏆
🎱 ይጫወቱ • ያሸንፉ • ይሸለሙ! 🎱
━━━━━━━━━━━━━━━━━━
🌟 የዕለታዊ ቦነስ ተሸላሚዎች 🌟
🥇 1ኛ ደረጃ — Player 1 💰 500 ብር
🥈 2ኛ ደረጃ — Player 2 💰 250 ብር
🥉 3ኛ ደረጃ — Player 3 💰 100 ብር
🎉 🎉
🔥 ብዙ ይጫወቱ
🏆 ብዙ ያሸንፉ
💰 ብዙ ይሸለሙ!
━━━━━━━━━━━━━━━━━━
🎁 30 ብር የመጫወቻ ቦነስ ያግኙ!
━━━━━━━━━━━━━━━━━━
🔥 ጓደኛዎን ይጋብዙ — እስከ 40 ብር ይሸለሙ! 🔥
👥 ጓደኛዎ በReferral Linkዎ ተጠቅሞ ሲቀላቀል
💰 20 ብር ያግኙ!
💳 ጓደኛዎ ቢያንስ 50 ብር ዴፖዚት ሲያደርግ
💰 ተጨማሪ 20 ብር ያግኙ!
🎉 ከአንድ ጓደኛ 40 ብር!
🔥 ብዙ ጓደኞችን ይጋብዙ — ብዙ ይሸለሙ!
━━━━━━━━━━━━━━━━━━
👉 አሁኑኑ ይጫወቱ:
https://t.me/ZABingo_bot

📢 ለተጨማሪ መረጃ የእኛን Telegram Channel ይቀላቀሉ! 👇

👉 https://t.me/EdelBingoo

❤️ Edel Bingo — መልካም ጨዋታ!
`;
let lastPromoDate = '';
let lastPromoHour = null;

setInterval(async () => {

  try {

    const now = getEthiopiaTimeParts();

    // Only 2:00 PM or 8:00 PM
    if (
      now.minute !== 0 ||
      (now.hour !== 14 && now.hour !== 20)
    ) {
      return;
    }

    const today =
      `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;

    // Prevent duplicate posts during the same hour
    if (
      lastPromoDate === today &&
      lastPromoHour === now.hour
    ) {
      return;
    }

    console.log(
      `📢 Sending promotional announcement at ${now.hour}:00`
    );

    // --------------------------------------------------------
    // POST TO CHANNEL
    // --------------------------------------------------------

    for (const channel of PROMO_CHANNELS) {
  try {
    await bot.sendMessage(channel, promoMessage);
  } catch (error) {
    console.error(`❌ Could not post to ${channel}:`, error.message);
  }
}

    console.log('✅ Promo posted to channel');

    // --------------------------------------------------------
    // SEND TO BOT USERS
    // --------------------------------------------------------

    for (const chatId of Object.keys(broadcastUsers)) {

      try {

        await bot.sendMessage(
          chatId,
          promoMessage
        );

      } catch (error) {

        console.error(
          `❌ Could not send promo to ${chatId}:`,
          error.message
        );

      }

    }

    lastPromoDate = today;
    lastPromoHour = now.hour;

    console.log('✅ Promo broadcast completed');

  } catch (error) {

    console.error(
      '❌ PROMO BROADCAST ERROR:',
      error
    );

  }

}, 30 * 1000);
module.exports = { bot };