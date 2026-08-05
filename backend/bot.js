const TelegramBot = require('node-telegram-bot-api');
const database = require('./firebase');

// Initialize the bot with polling
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Reference to Firebase database
const db = database;

// Payment methods configuration
const PAYMENT_METHODS = {
  telebirr: { name: '📱 Telebirr', number: '0985661720' },
  cbebirr: { name: '🏦 CBE Birr', number: '0985661720' }
};

// Welcome bonus amount
const WELCOME_BONUS = 30;

// Minimum transaction amounts
const MIN_DEPOSIT = 50;
const MIN_WITHDRAWAL = 50;

// Bot state to track user interactions
const userStates = {};

/**
 * Helper function to get user state
 */
function getUserState(telegramId) {
  if (!userStates[telegramId]) {
    userStates[telegramId] = {};
  }
  return userStates[telegramId];
}

/**
 * Helper function to clear user state
 */
function clearUserState(telegramId) {
  delete userStates[telegramId];
}

/**
 * Check if user exists in Firebase
 */
async function checkUserExists(telegramId) {
  try {
    const snapshot = await db.ref(`players/${telegramId}`).once('value');
    return snapshot.exists();
  } catch (error) {
    console.error('Error checking user existence:', error);
    throw error;
  }
}

/**
 * Get player data from Firebase
 */
async function getPlayerData(telegramId) {
  try {
    const snapshot = await db.ref(`players/${telegramId}`).once('value');
    return snapshot.val();
  } catch (error) {
    console.error('Error getting player data:', error);
    throw error;
  }
}

/**
 * Create new player in Firebase with welcome bonus
 */
async function createPlayer(playerData) {
  try {
    const playerRef = db.ref(`players/${playerData.telegram_id}`);
    await playerRef.set({
      ...playerData,
      balance: WELCOME_BONUS,
      gamesPlayed: 0,
      gamesWon: 0,
      registrationDate: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error creating player:', error);
    throw error;
  }
}

/**
 * Save transaction to Firebase
 */
async function saveTransaction(transactionData) {
  try {
    const transactionRef = db.ref('transactions').push();
    const transactionId = transactionRef.key;
    
    await transactionRef.set({
      ...transactionData,
      transactionId,
      createdAt: new Date().toISOString()
    });
    
    return transactionId;
  } catch (error) {
    console.error('Error saving transaction:', error);
    throw error;
  }
}

/**
 * Show main menu to user
 */
function showMainMenu(chatId) {
  const keyboard = {
    reply_markup: {
      keyboard: [
        ['🎮 Play Bingo'],
        ['💰 Deposit', '💸 Withdraw'],
        ['📖 Instructions', '📞 Contact Support']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
  
  bot.sendMessage(chatId, '🎉 *Welcome to ZA Bingo!*\n\nPlease select an option:', {
    ...keyboard,
    parse_mode: 'Markdown'
  });
}

/**
 * Handle /start command
 */
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  
  try {
    // Check if user already exists
    const userExists = await checkUserExists(telegramId);
    
    if (userExists) {
      // Existing user - go directly to main menu
      showMainMenu(chatId);
    } else {
      // New user - request contact sharing
      const keyboard = {
        reply_markup: {
          keyboard: [
            [{
              text: '📱 Share Your Contact',
              request_contact: true
            }]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      };
      
      bot.sendMessage(
        chatId,
        '👋 *Welcome to ZA Bingo!*\n\nPlease share your contact to get started and receive your welcome bonus of 30 Br! 🎁',
        {
          ...keyboard,
          parse_mode: 'Markdown'
        }
      );
      
      // Set user state to awaiting contact
      const state = getUserState(telegramId);
      state.awaitingContact = true;
    }
  } catch (error) {
    console.error('Error in /start handler:', error);
    bot.sendMessage(chatId, '❌ An error occurred. Please try again later.');
  }
});

/**
 * Handle contact sharing
 */
bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  
  try {
    const state = getUserState(telegramId);
    
    if (!state.awaitingContact) {
      return;
    }
    
    // Extract contact info
    const contact = msg.contact;
    
    // Ensure the contact belongs to the user
    if (contact.user_id !== telegramId) {
      bot.sendMessage(chatId, '❌ Please share your own contact number.');
      return;
    }
    
    // Create player data
    const playerData = {
      telegram_id: telegramId,
      first_name: msg.from.first_name || 'Unknown',
      username: msg.from.username || 'Unknown',
      phone: contact.phone_number.replace('+', '') // Remove + prefix if present
    };
    
    // Save player to Firebase
    await createPlayer(playerData);
    
    // Clear state
    clearUserState(telegramId);
    
    // Send welcome message with bonus info
    await bot.sendMessage(
      chatId,
      `✅ *Registration successful!*\n\n🎁 You have received a welcome bonus of *${WELCOME_BONUS} Br*!\n\nYour phone number: *${contact.phone_number}*`,
      { parse_mode: 'Markdown' }
    );
    
    // Show main menu
    showMainMenu(chatId);
    
  } catch (error) {
    console.error('Error handling contact:', error);
    bot.sendMessage(chatId, '❌ An error occurred during registration. Please try again.');
  }
});

/**
 * Handle menu button presses
 */
bot.on('message', async (msg) => {
  // Ignore commands and contacts
  if (msg.text && msg.text.startsWith('/') || msg.contact) {
    return;
  }
  
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const text = msg.text;
  
  if (!text) return;
  
  try {
    switch (text) {
      case '🎮 Play Bingo':
        await handlePlayBingo(chatId, telegramId);
        break;
        
      case '💰 Deposit':
        await handleDeposit(chatId, telegramId);
        break;
        
      case '💸 Withdraw':
        await handleWithdraw(chatId, telegramId);
        break;
        
      case '📖 Instructions':
        await handleInstructions(chatId);
        break;
        
      case '📞 Contact Support':
        await handleContactSupport(chatId);
        break;
        
      case '✅ I Have Paid':
        await handlePaymentConfirmation(chatId, telegramId);
        break;
        
      case '📱 Telebirr':
        await handleDepositMethodSelection(chatId, telegramId, 'telebirr');
        break;
        
      case '🏦 CBE Birr':
        await handleDepositMethodSelection(chatId, telegramId, 'cbebirr');
        break;
        
      case '📱 Telebirr (Withdraw)':
        await handleWithdrawMethodSelection(chatId, telegramId, 'telebirr');
        break;
        
      case '🏦 CBE Birr (Withdraw)':
        await handleWithdrawMethodSelection(chatId, telegramId, 'cbebirr');
        break;
        
      default:
        // Handle state-based text inputs
        await handleStateBasedInput(chatId, telegramId, text);
        break;
    }
  } catch (error) {
    console.error('Error handling message:', error);
    bot.sendMessage(chatId, '❌ An error occurred. Please try again later.');
  }
});

/**
 * Handle Play Bingo button
 */
async function handlePlayBingo(chatId, telegramId) {
  try {
    // Check if user exists
    const userExists = await checkUserExists(telegramId);
    
    if (!userExists) {
      bot.sendMessage(chatId, '❌ Please register first by sending /start');
      return;
    }
    
    const webAppUrl = process.env.WEBAPP_URL;
    
    if (!webAppUrl) {
      bot.sendMessage(chatId, '❌ Web app URL not configured.');
      return;
    }
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🎮 Open Bingo Game',
            web_app: { url: webAppUrl }
          }
        ]]
      }
    };
    
    bot.sendMessage(chatId, '🎮 Click below to open the Bingo game:', keyboard);
    
  } catch (error) {
    console.error('Error in Play Bingo:', error);
    throw error;
  }
}

/**
 * Handle Deposit button
 */
async function handleDeposit(chatId, telegramId) {
  try {
    // Check if user exists
    const userExists = await checkUserExists(telegramId);
    
    if (!userExists) {
      bot.sendMessage(chatId, '❌ Please register first by sending /start');
      return;
    }
    
    // Show payment methods
    const keyboard = {
      reply_markup: {
        keyboard: [
          ['📱 Telebirr'],
          ['🏦 CBE Birr'],
          ['🔙 Back']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    };
    
    bot.sendMessage(
      chatId,
      '💰 *Select Payment Method*\n\nChoose your preferred payment method:',
      {
        ...keyboard,
        parse_mode: 'Markdown'
      }
    );
    
    // Set state for deposit flow
    const state = getUserState(telegramId);
    state.flow = 'deposit';
    state.step = 'select_method';
    
  } catch (error) {
    console.error('Error in Deposit handler:', error);
    throw error;
  }
}

/**
 * Handle deposit method selection
 */
async function handleDepositMethodSelection(chatId, telegramId, method) {
  try {
    const paymentMethod = PAYMENT_METHODS[method];
    
    if (!paymentMethod) {
      bot.sendMessage(chatId, '❌ Invalid payment method.');
      return;
    }
    
    const state = getUserState(telegramId);
    state.flow = 'deposit';
    state.step = 'show_payment_info';
    state.paymentMethod = method;
    
    const keyboard = {
      reply_markup: {
        keyboard: [
          ['✅ I Have Paid'],
          ['🔙 Back']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    };
    
    bot.sendMessage(
      chatId,
      `💳 *${paymentMethod.name} Payment*\n\n` +
      `Please send your payment to:\n` +
      `📞 *${paymentMethod.number}*\n\n` +
      `*Minimum deposit: ${MIN_DEPOSIT} Br*\n\n` +
      `After making the payment, click "I Have Paid" to submit your deposit.`,
      {
        ...keyboard,
        parse_mode: 'Markdown'
      }
    );
    
  } catch (error) {
    console.error('Error in deposit method selection:', error);
    throw error;
  }
}

/**
 * Handle payment confirmation button
 */
async function handlePaymentConfirmation(chatId, telegramId) {
  try {
    const state = getUserState(telegramId);
    
    if (state.flow !== 'deposit' || state.step !== 'show_payment_info') {
      return;
    }
    
    state.step = 'enter_amount';
    
    const keyboard = {
      reply_markup: {
        keyboard: [
          ['🔙 Back']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    };
    
    bot.sendMessage(
      chatId,
      `💰 Please enter the deposit amount:\n\n` +
      `*Minimum deposit: ${MIN_DEPOSIT} Br*`,
      {
        ...keyboard,
        parse_mode: 'Markdown'
      }
    );
    
  } catch (error) {
    console.error('Error in payment confirmation:', error);
    throw error;
  }
}

/**
 * Handle Withdraw button
 */
async function handleWithdraw(chatId, telegramId) {
  try {
    // Check if user exists and get balance
    const playerData = await getPlayerData(telegramId);
    
    if (!playerData) {
      bot.sendMessage(chatId, '❌ Please register first by sending /start');
      return;
    }
    
    const balance = playerData.balance || 0;
    
    // Check minimum withdrawal
    if (balance < MIN_WITHDRAWAL) {
      bot.sendMessage(
        chatId,
        `❌ *Insufficient Balance*\n\n` +
        `Your current balance: *${balance} Br*\n` +
        `Minimum withdrawal: *${MIN_WITHDRAWAL} Br*\n\n` +
        `Please deposit more funds to withdraw.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Show withdrawal payment methods
    const keyboard = {
      reply_markup: {
        keyboard: [
          ['📱 Telebirr (Withdraw)'],
          ['🏦 CBE Birr (Withdraw)'],
          ['🔙 Back']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    };
    
    bot.sendMessage(
      chatId,
      `💸 *Withdraw Funds*\n\n` +
      `Your balance: *${balance} Br*\n` +
      `Minimum withdrawal: *${MIN_WITHDRAWAL} Br*\n\n` +
      `Select withdrawal method:`,
      {
        ...keyboard,
        parse_mode: 'Markdown'
      }
    );
    
    // Set state for withdrawal flow
    const state = getUserState(telegramId);
    state.flow = 'withdraw';
    state.step = 'select_method';
    
  } catch (error) {
    console.error('Error in Withdraw handler:', error);
    throw error;
  }
}

/**
 * Handle withdrawal method selection
 */
async function handleWithdrawMethodSelection(chatId, telegramId, method) {
  try {
    const state = getUserState(telegramId);
    state.flow = 'withdraw';
    state.step = 'enter_phone';
    state.paymentMethod = method;
    
    const paymentMethodName = method === 'telebirr' ? 'Telebirr' : 'CBE Birr';
    
    const keyboard = {
      reply_markup: {
        keyboard: [
          ['🔙 Back']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    };
    
    bot.sendMessage(
      chatId,
      `📱 Please enter your *${paymentMethodName}* phone number:\n\n` +
      `Format: 09XXXXXXXX`,
      {
        ...keyboard,
        parse_mode: 'Markdown'
      }
    );
    
  } catch (error) {
    console.error('Error in withdrawal method selection:', error);
    throw error;
  }
}

/**
 * Handle state-based text inputs
 */
async function handleStateBasedInput(chatId, telegramId, text) {
  const state = getUserState(telegramId);
  
  if (text === '🔙 Back') {
    clearUserState(telegramId);
    showMainMenu(chatId);
    return;
  }
  
  // Handle deposit amount input
  if (state.flow === 'deposit' && state.step === 'enter_amount') {
    await handleDepositAmountInput(chatId, telegramId, text);
    return;
  }
  
  // Handle withdrawal phone input
  if (state.flow === 'withdraw' && state.step === 'enter_phone') {
    await handleWithdrawPhoneInput(chatId, telegramId, text);
    return;
  }
  
  // Handle withdrawal amount input
  if (state.flow === 'withdraw' && state.step === 'enter_amount') {
    await handleWithdrawAmountInput(chatId, telegramId, text);
    return;
  }
}

/**
 * Handle deposit amount input
 */
async function handleDepositAmountInput(chatId, telegramId, text) {
  try {
    const amount = parseFloat(text);
    
    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, '❌ Please enter a valid amount.');
      return;
    }
    
    if (amount < MIN_DEPOSIT) {
      bot.sendMessage(
        chatId,
        `❌ Minimum deposit is *${MIN_DEPOSIT} Br*.\nPlease enter a larger amount.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    const state = getUserState(telegramId);
    
    // Save transaction to Firebase
    const transactionData = {
      telegram_id: telegramId,
      type: 'deposit',
      paymentMethod: state.paymentMethod,
      amount: amount,
      status: 'pending'
    };
    
    const transactionId = await saveTransaction(transactionData);
    
    // Clear state
    clearUserState(telegramId);
    
    // Send confirmation
    await bot.sendMessage(
      chatId,
      `✅ *Deposit Request Submitted!*\n\n` +
      `Amount: *${amount} Br*\n` +
      `Method: *${PAYMENT_METHODS[state.paymentMethod].name}*\n` +
      `Transaction ID: *${transactionId}*\n` +
      `Status: *Pending*\n\n` +
      `Your deposit will be processed shortly. Thank you! 🎉`,
      { parse_mode: 'Markdown' }
    );
    
    // Show main menu
    showMainMenu(chatId);
    
  } catch (error) {
    console.error('Error in deposit amount input:', error);
    throw error;
  }
}

/**
 * Handle withdrawal phone input
 */
async function handleWithdrawPhoneInput(chatId, telegramId, text) {
  try {
    // Validate phone number format (basic Ethiopian phone format)
    const phoneRegex = /^09[0-9]{8}$/;
    
    if (!phoneRegex.test(text)) {
      bot.sendMessage(
        chatId,
        '❌ Invalid phone number format.\nPlease enter a valid Ethiopian phone number: *09XXXXXXXX*',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    const state = getUserState(telegramId);
    state.phone = text;
    state.step = 'enter_amount';
    
    const keyboard = {
      reply_markup: {
        keyboard: [
          ['🔙 Back']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    };
    
    // Get current balance
    const playerData = await getPlayerData(telegramId);
    const balance = playerData.balance || 0;
    
    bot.sendMessage(
      chatId,
      `💰 Please enter the withdrawal amount:\n\n` +
      `Current balance: *${balance} Br*\n` +
      `Minimum withdrawal: *${MIN_WITHDRAWAL} Br*`,
      {
        ...keyboard,
        parse_mode: 'Markdown'
      }
    );
    
  } catch (error) {
    console.error('Error in withdrawal phone input:', error);
    throw error;
  }
}

/**
 * Handle withdrawal amount input
 */
async function handleWithdrawAmountInput(chatId, telegramId, text) {
  try {
    const amount = parseFloat(text);
    const state = getUserState(telegramId);
    
    // Get current balance
    const playerData = await getPlayerData(telegramId);
    const balance = playerData.balance || 0;
    
    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, '❌ Please enter a valid amount.');
      return;
    }
    
    if (amount < MIN_WITHDRAWAL) {
      bot.sendMessage(
        chatId,
        `❌ Minimum withdrawal is *${MIN_WITHDRAWAL} Br*.\nPlease enter a larger amount.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    if (amount > balance) {
      bot.sendMessage(
        chatId,
        `❌ *Insufficient Balance*\n\n` +
        `Your balance: *${balance} Br*\n` +
        `Requested amount: *${amount} Br*`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Save transaction to Firebase
    const transactionData = {
      telegram_id: telegramId,
      type: 'withdraw',
      paymentMethod: state.paymentMethod,
      phone: state.phone,
      amount: amount,
      status: 'pending'
    };
    
    const transactionId = await saveTransaction(transactionData);
    
    // Clear state
    clearUserState(telegramId);
    
    // Send confirmation
    await bot.sendMessage(
      chatId,
      `✅ *Withdrawal Request Submitted!*\n\n` +
      `Amount: *${amount} Br*\n` +
      `Method: *${state.paymentMethod === 'telebirr' ? 'Telebirr' : 'CBE Birr'}*\n` +
      `Phone: *${state.phone}*\n` +
      `Transaction ID: *${transactionId}*\n` +
      `Status: *Pending*\n\n` +
      `Your withdrawal will be processed shortly. Thank you! 🎉`,
      { parse_mode: 'Markdown' }
    );
    
    // Show main menu
    showMainMenu(chatId);
    
  } catch (error) {
    console.error('Error in withdrawal amount input:', error);
    throw error;
  }
}

/**
 * Handle Instructions button
 */
async function handleInstructions(chatId) {
  const instructions = `📖 *ZA BINGO RULES*\n\n` +
    `*የጨዋታ ህጎች*\n\n` +
    `1️⃣ እያንዳንዱ ተጫዋች *የቢንጎ ካርድ* ይቀበላል\n\n` +
    `2️⃣ ቁጥሮች በዘፈቀደ ይመረጣሉ እና ይጠራሉ\n\n` +
    `3️⃣ በካርድዎ ላይ ያለውን ተዛማጅ ቁጥር *ምልክት ያድርጉበት*\n\n` +
    `4️⃣ *አሸናፊ ለመሆን*:\n` +
    `   • *አግድም* መስመር ይሙሉ\n` +
    `   • *ቁልቁል* መስመር ይሙሉ\n` +
    `   • *ሰያፍ* መስመር ይሙሉ\n\n` +
    `5️⃣ *ሙሉ ካርድ* በመሙላትም ማሸነፍ ይችላሉ\n\n` +
    `6️⃣ አሸናፊ ሲሆኑ *"BINGO!"* ይጮሁ! 📢\n\n` +
    `🎯 *ሽልማቶች*\n` +
    `• በሚያሸንፉበት ጨዋታ መሰረት የተለያዩ ሽልማቶችን ያገኛሉ\n\n` +
    `*መልካም ጨዋታ!* 🎉`;
  
  bot.sendMessage(chatId, instructions, {
    parse_mode: 'Markdown'
  });
}

/**
 * Handle Contact Support button
 */
async function handleContactSupport(chatId) {
  const supportMessage = `📞 *Contact Support*\n\n` +
    `*የደንበኞች ድጋፍ*\n\n` +
    `📱 *Phone:* 0985661720\n` +
    `📧 *Email:* support@zabingo.com\n` +
    `⏰ *Hours:* Monday - Saturday\n` +
    `  8:00 AM - 8:00 PM\n\n` +
    `*ለእርዳታ እና ጥያቄዎች*:\n` +
    `• የቴሌግራም መልእክት ይላኩ\n` +
    `• በስልክ ይደውሉ\n` +
    `• ኢሜል ይላኩ\n\n` +
    `*እኛ እርስዎን ለመርዳት ዝግጁ ነን!* 🤝`;
  
  bot.sendMessage(chatId, supportMessage, {
    parse_mode: 'Markdown'
  });
}

/**
 * Handle callback queries (if needed for inline keyboards)
 */
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  
  // Acknowledge the callback query
  bot.answerCallbackQuery(callbackQuery.id).catch(err => {
    console.error('Error answering callback query:', err);
  });
});

/**
 * Handle polling errors
 */
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

/**
 * Handle webhook errors (if using webhooks instead of polling)
 */
bot.on('webhook_error', (error) => {
  console.error('Webhook error:', error);
});

/**
 * Graceful shutdown
 */
process.on('SIGINT', () => {
  console.log('Shutting down bot...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down bot...');
  bot.stopPolling();
  process.exit(0);
});

let gameManager;

bot.setGameManager = (manager) => {
  gameManager = manager;
};

// Export the bot instance
module.exports = bot;
