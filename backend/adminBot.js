// ============================================================
// ZA BINGO — ADMIN BOT
// Automatic Deposit + Withdrawal Confirmation
// ============================================================

const TelegramBot = require('node-telegram-bot-api');
const { bot: playerBot } = require('./bot');
const db = require('./firebase');

// ============================================================
// CONFIG
// ============================================================

const BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ ADMIN_BOT_TOKEN is missing from .env');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true
});

console.log('🤖 ZA Bingo Admin Bot started');

// ============================================================
// SMS PARSERS
// ============================================================

// Deposit example:
// ... 200.00 ብር ... የሂሳብ እንቅስቃሴ ቁጥርዎ DH70L9NHPK ...

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
    transactionId: transactionMatch[1]
  };
}

// Withdrawal example:
// ... 17.00 ብር ... ልከዋል። የሂሳብ እንቅስቃሴ ቁጥርዎ DHC7Q0NFI5 ...

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
    transactionId: transactionMatch[1]
  };
}

// ============================================================
// FIND PENDING TRANSACTION + PREVENT DUPLICATE SMS
// ============================================================

async function findPendingTransaction(type, amount, transactionId) {
  const snapshot = await db.ref('transactions').once('value');
  const transactions = snapshot.val() || {};

  // CHECK DUPLICATE FIRST
  for (const transaction of Object.values(transactions)) {
    if (!transaction) continue;

    if (
      String(transaction.transactionId || '').toUpperCase() ===
      String(transactionId || '').toUpperCase()
    ) {
      console.log(
        '⚠️ Duplicate transaction ID:',
        transactionId
      );

      if (transaction.telegramId) {
        await playerBot.sendMessage(
  transaction.telegramId,
          `⚠️ *Duplicate ${type === 'deposit' ? 'Deposit' : 'Withdrawal'}*\n\n` +
          `This transaction has already been processed.\n` +
          `No money was added to your balance.`,
          {
            parse_mode: 'Markdown'
          }
        );
      }

      return null;
    }
  }

  // FIND PENDING TRANSACTION
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

// ============================================================
// PROCESS DEPOSIT
// ============================================================

async function processDeposit(text, smsData) {
  const transaction = await findPendingTransaction(
    'deposit',
    smsData.amount,
    smsData.transactionId
  );

  if (!transaction) {
    console.log(
      '⚠️ No matching pending deposit:',
      smsData.amount,
      smsData.transactionId
    );
    return false;
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

  const newBalance =
    Number(player.balance || 0) +
    Number(transaction.amount);

  await playerRef.update({
    balance: newBalance
  });

  await transactionRef.update({
    status: 'approved',
    transactionId: smsData.transactionId,
    confirmedAt: new Date().toISOString(),
    confirmationSms: text
  });

  await playerBot.sendMessage(
    transaction.telegramId,
    `✅ *Deposit Confirmed!*\n\n` +
    `Amount: ${transaction.amount} Br\n` +
    `Transaction ID: ${smsData.transactionId}\n\n` +
    `💰 New balance: ${newBalance} Br`,
    {
      parse_mode: 'Markdown'
    }
  );

  console.log(
    `✅ Deposit approved: ${transaction.amount} Br → ${transaction.telegramId}`
  );

  return true;
}

// ============================================================
// PROCESS WITHDRAWAL
// ============================================================

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

    await playerBot.sendMessage(
      transaction.telegramId,
      `❌ Withdrawal failed.\n\nInsufficient balance.`
    );

    return false;
  }

  const newBalance = currentBalance - amount;

  await playerRef.update({
    balance: newBalance
  });

  await transactionRef.update({
    status: 'approved',
    transactionId: smsData.transactionId,
    confirmedAt: new Date().toISOString(),
    confirmationSms: text
  });

  await playerBot.sendMessage(
    transaction.telegramId,
    `✅ *Withdrawal Confirmed!*\n\n` +
    `Amount: ${amount} Br\n` +
    `Transaction ID: ${smsData.transactionId}\n\n` +
    `💰 Remaining balance: ${newBalance} Br`,
    {
      parse_mode: 'Markdown'
    }
  );

  console.log(
    `✅ Withdrawal approved: ${amount} Br → ${transaction.telegramId}`
  );

  return true;
}

// ============================================================
// RECEIVE SMS FROM SMS FORWARDER
// ============================================================

bot.on('message', async (msg) => {

  const text = msg.text;

  if (!text) return;

  console.log('\n📩 SMS received:');
  console.log(text);

  try {

    // --------------------------------------------------------
    // DEPOSIT SMS
    // --------------------------------------------------------

    if (
      text.includes('ተቀብለዋል') &&
      text.includes('የሂሳብ እንቅስቃሴ ቁጥርዎ')
    ) {

      const smsData = parseDepositSMS(text);

      if (!smsData) {
        console.log('❌ Could not parse deposit SMS');
        return;
      }

      await processDeposit(text, smsData);

      return;
    }

    // --------------------------------------------------------
    // WITHDRAWAL SMS
    // --------------------------------------------------------

    if (
      text.includes('ልከዋል') &&
      text.includes('የሂሳብ እንቅስቃሴ ቁጥርዎ')
    ) {

      const smsData = parseWithdrawalSMS(text);

      if (!smsData) {
        console.log('❌ Could not parse withdrawal SMS');
        return;
      }

      await processWithdrawal(text, smsData);

      return;
    }

    console.log('ℹ️ SMS format not recognized');

  } catch (error) {

    console.error('❌ Admin Bot error:', error);

  }
});

// ============================================================
// ADMIN BOT STATUS
// ============================================================

bot.on('polling_error', (error) => {
  console.error('❌ Admin Bot polling error:', error.message);
});

module.exports = bot;