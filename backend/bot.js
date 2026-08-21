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
function getEthiopiaTime() {
  return new Date(
    new Date().toLocaleString('en-US', {
      timeZone: 'Africa/Addis_Ababa'
    })
  );
}
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

  bot.sendMessage(
    chatId,
    'Enter the recipient’s phone number:'
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
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);
  const firstName = msg.from.first_name || 'Player';
  const username = msg.from.username || '';

  try {
    const playerRef = db.ref(`players/${tgId}`);
    const snapshot = await playerRef.once('value');
    let player = snapshot.val();

    if (!player) {
      // Register new player
      player = {
        telegram_id: tgId,
        first_name: firstName,
        username: username,
        phone: '',
        balance: 30,
        games_played: 0,
        games_won: 0,
        registration_date: new Date().toISOString()
      };

      await playerRef.set(player);

      bot.sendMessage(
        chatId,
        `👑 *እንኳን ደና መጡ, ${firstName}!*\n\n` +
        `You received *30 Br* welcome bonus!\n` +
        `Play Bingo and win real prizes!\n\n` +
        `Share your contact to complete registration.`,
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

    bot.sendMessage(chatId, '✅ Phone number saved! Welcome aboard!', {
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
    `የቴሌብር አካውንት: \`0985661720\`።\n\n` +
    `ከላይ ባለው የቴሌብር አካውንት ብር ያስገቡ።\n\n` +
    `2. የምትልኩት የገንዘብ መጠን እና እዚ ላይ እንዲሞላልዎ የምታስገቡት የብር መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ።\n\n` +
    `3. ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዝ አጭር የጹሁፍ መልክት(sms) ከቴሌብር ይደርሳችኋል።\n\n` +
    `4. የደረሳችሁን አጭር የጹሁፍ መለክት(sms) ሙሉዉን ኮፒ(copy) በማረግ ከታሽ ባለው የቴሌግራም የጹሁፍ ማስገቢአው ላይ ፔስት(paste) በማረግ ይላኩት።\n\n` +
    `ማሳሰቢያ፡ የከፈለችሁበትን አጭር የጹሁፍ መለክት(sms) እዚ ላይ ያስገቡት 👇👇👇`,
    { parse_mode: 'Markdown' }
  );
} else if (method === 'cbe') {
  bot.sendMessage(
    chatId,
    `Cbe birr አካውንት: \`0985661720\`።\n\n` +
    `ከላይ ባለው Cbe birr ብር ያስገቡ።\n\n` +
    `2. የምትልኩት የገንዘብ መጠን እና እዚ ላይ እንዲሞላልዎ የምታስገቡት የብር መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ።\n\n` +
    `3. ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዝ አጭር የጹሁፍ መልክት(sms) ከCbe birr ይደርሳችኋል።\n\n` +
    `4. የደረሳችሁን አጭር የጹሁፍ መለክት(sms) ሙሉዉን ኮፒ(copy) በማረግ ከታሽ ባለው የቴሌግራም የጹሁፍ ማስገቢአው ላይ ፔስት(paste) በማረግ ይላኩት።\n\n` +
    `ማሳሰቢያ፡ በCbe birr አካውንት ብቻ ብር መላካችሁን እርግጠኛ ይሁኑ። የከፈለችሁበትን አጭር የጹሁፍ መለክት(sms) እዚ ላይ ያስገቡት 👇👇👇`,
    { parse_mode: 'Markdown' }
  );
}
}
  // Withdraw method selection
  else if (data.startsWith('withdraw_method_')) {
    const method = data.replace('withdraw_method_', '');
    bot.sendMessage(chatId,
      ` *በ${method === 'telebirr' ? 'ቴሌ ብር' : 'CBE Birr'} ለማውጣት*\n\n` +
`ማውጣት የፈለጉትን መጠን ያስገቡ 👇`,
      { parse_mode: 'Markdown' }
    );
    withdrawSessions[chatId] = { method, step: 'amount' };
  }
  
  // Admin: Approve withdrawal
  else if (data.startsWith('approve_withdraw_')) {
    const txnId = parseInt(data.replace('approve_withdraw_', ''));
    approveWithdrawal(query, txnId);
  }
  // Admin: Reject withdrawal
  else if (data.startsWith('reject_withdraw_')) {
    const txnId = parseInt(data.replace('reject_withdraw_', ''));
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
// TEXT MESSAGE HANDLER (for amount input)
// ============================================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
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

  // Parse the SMS pasted by the player
  const amountMatch = sms.match(/([\d,]+\.\d{2})\s*ብር/);
  const transactionMatch = sms.match(
    /የሂሳብ እንቅስቃሴ ቁጥርዎ\s+([A-Z0-9]+)/
  );

  if (!amountMatch || !transactionMatch) {
    bot.sendMessage(
  chatId,
  'ያስገቡት የትራንዛክሽን ቁጥር የተሳሳተ ነው። እባክዎ ሲከፍሉ የደረስዎትን የጹሁፍ መልክት(sms) ሙሉውን ኮፒ አርገው እዚህ ላይ ፔስት ያርጉት።'
);
    return;
  }

  const smsAmount = Number(
    amountMatch[1].replace(/,/g, '')
  );

  const transactionId =
    transactionMatch[1].toUpperCase();

  // Check that SMS amount matches the amount entered
  if (smsAmount !== amount) {
    bot.sendMessage(
      chatId,
      `❌ The SMS amount (${smsAmount} Br) does not match your deposit amount (${amount} Br).`
    );
    return;
  }

  // Check official SMS saved by adminBot.js
  const officialRef = db.ref(
    `officialDeposits/${transactionId}`
  );

  const officialSnapshot =
    await officialRef.once('value');

  const official = officialSnapshot.val();

  if (!official || official.status !== 'available') {
    bot.sendMessage(
      chatId,
      '⏳ We could not find this payment yet. Please make sure the official payment SMS has arrived and try again.'
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

  // Compare player's SMS with official SMS
  const normalizeSMS = value =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

  if (
    normalizeSMS(official.sms) !==
    normalizeSMS(sms)
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

  // Handle withdraw amount
if (
  withdrawSessions[chatId] &&
  withdrawSessions[chatId].step === 'amount'
) {
  const amount = parseFloat(text);

  if (isNaN(amount) || amount <= 0) {
    bot.sendMessage(
      chatId,
      '❌ Invalid amount. Enter amount:'
    );
    return;
  }

  const balance = Number(player.balance || 0);

  if (amount > balance) {
    bot.sendMessage(
      chatId,
      `❌ Insufficient balance. You have ${balance} Br.`
    );
    return;
  }

  const session = withdrawSessions[chatId];

  // Create pending withdrawal transaction
  const transactionRef = db.ref('transactions').push();

  await transactionRef.set({
    playerId: tgId,
    telegramId: tgId,
    type: 'withdrawal',
    amount: amount,
    status: 'pending',
    paymentMethod: session.method,
    createdAt: new Date().toISOString()
  });
  
  // Deduct withdrawal amount immediately
await db.ref(`players/${tgId}/balance`).transaction(
  balance => Number(balance || 0) - amount
);

  const ADMIN_ID =
    process.env.ADMIN_ID || 'YOUR_ADMIN_TELEGRAM_ID';

  bot.sendMessage(
    ADMIN_ID,
    ` *New Withdrawal Request*\n\n` +
    `Player: ${player.first_name || 'Player'}\n` +
    `Username: @${player.username || 'N/A'}\n` +
    `Amount: ${amount} Br\n` +
    `Method: ${session.method}\n` +
    `Phone: ${player.phone || 'Not set'}\n` +
    `Date: ${new Date().toLocaleString()}`,
    {
      parse_mode: 'Markdown'
    }
  );

  bot.sendMessage(
    chatId,
    `🧾 *የገንዘብ ማውጣት ጥያቄ አስገብተዋል *\n\n` +
`Amount:          ${amount.toFixed(2)} ETB\n` +
`Payment method:  ${session.method === 'telebirr' ? 'Telebirr' : 'CBE Birr'}\n` +
`Status:          Pending approval`
  );

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

    if (!Number.isFinite(amount) || amount <= 0) {
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
          [{ text: ' CBE Birr', callback_data: 'withdraw_method_cbe' }],
          [{ text: '🔙 Back', callback_data: 'back_to_menu' }],
        ]
      }
    }
  );
}

function handleProfile(chatId, player) {
  bot.sendMessage(chatId,
    ` *Profile*\n\n` +
    `Name: ${player.first_name}\n` +
    `Username: @${player.username || 'N/A'}\n` +
    `Phone: ${player.phone || 'Not set'}\n` +
    `Balance: ${player.balance} Br\n` +
    `Games Played: ${player.games_played}\n` +
    `Games Won: ${player.games_won}\n` +
    `Joined: ${player.registration_date}`,
    { parse_mode: 'Markdown' }
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
// DAILY BONUS — 9:00 PM ETHIOPIA TIME
// ============================================================

setInterval(async () => {
  const now = getEthiopiaTime();

  if (now.getHours() !== 21 || now.getMinutes() !== 0) {
    return;
  }

  console.log('🏆 Running daily bonus announcement...');

  // We will add the winner calculation here next.
}, 30 * 1000);

module.exports = { bot, setGameManager }