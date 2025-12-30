require('dotenv').config();
require('./setting/config');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const { sleep } = require('./utils');
const { BOT_TOKEN } = require('./token');
const { autoLoadPairs } = require('./autoload');

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const adminFilePath = path.join(__dirname, 'itsmemirza', 'admin.json');
let adminIDs = [];

// Store for user tracking
const userFilePath = path.join(__dirname, 'itsmemirza', 'users.json');
let userIDs = new Set();

// Bot statistics
const statsFilePath = path.join(__dirname, 'itsmemirza', 'stats.json');
let botStats = {
  totalConnections: 0,
  totalUsers: 0,
  dailyConnections: 0,
  lastReset: new Date().toDateString()
};

// Premium video URLs
const VIDEO_URLS = [
  'https://files.catbox.moe/vl80h8.mp4',
  'https://files.catbox.moe/vl80h8.mp4',
  'https://files.catbox.moe/vl80h8.mp4',
  'https://files.catbox.moe/vl80h8.mp4'
];

const getRandomVideoUrl = () => {
  return VIDEO_URLS[Math.floor(Math.random() * VIDEO_URLS.length)];
};

// No channel requirements - all removed
const REQUIRED_GROUP = '';
const REQUIRED_CHANNELS = [];

// Only owner link kept
const OWNER_LINK = 'https://t.me/mirzaowner';

// Auto-create directories
const ensureDirectories = async () => {
  const dirs = [
    path.join(__dirname, 'itsmemirza'),
    path.join(__dirname, 'itsmemirza', 'pairing'),
    path.join(__dirname, 'allfunc')
  ];
  
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      // Directory exists, ignore
    }
  }
};

// Utility functions
const exists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const loadAdminIDs = async () => {
  const ownerID = '923290386637';
  const defaultAdmins = [ownerID];

  if (!(await exists(adminFilePath))) {
    await fs.writeFile(adminFilePath, JSON.stringify(defaultAdmins, null, 2));
    adminIDs = defaultAdmins;
    console.log('✅ ᴄʀᴇᴀᴛᴇᴅ ᴀᴅᴍɪɴ.ᴊsᴏɴ');
  } else {
    try {
      const raw = await fs.readFile(adminFilePath, 'utf8');
      adminIDs = JSON.parse(raw);
    } catch (err) {
      console.error('❌ ᴇʀʀᴏʀ ʟᴏᴀᴅɪɴɢ ᴀᴅᴍɪɴ.ᴊsᴏɴ:', err);
      adminIDs = defaultAdmins;
    }
  }
  console.log('📥 ʟᴏᴀᴅᴇᴅ ᴀᴅᴍɪɴ ɪᴅs:', adminIDs);
};

const loadUserIDs = async () => {
  if (await exists(userFilePath)) {
    try {
      const raw = await fs.readFile(userFilePath, 'utf8');
      const users = JSON.parse(raw);
      userIDs = new Set(users);
      console.log(`📥 ʟᴏᴀᴅᴇᴅ ${userIDs.size} ᴜsᴇʀs`);
    } catch (err) {
      console.error('❌ ᴇʀʀᴏʀ ʟᴏᴀᴅɪɴɢ ᴜsᴇʀs.ᴊsᴏɴ:', err);
      userIDs = new Set();
    }
  }
};

const saveUserIDs = async () => {
  try {
    await fs.writeFile(userFilePath, JSON.stringify([...userIDs], null, 2));
  } catch (err) {
    console.error('❌ ᴇʀʀᴏʀ sᴀᴠɪɴɢ ᴜsᴇʀs.ᴊsᴏɴ:', err);
  }
};

const loadStats = async () => {
  if (await exists(statsFilePath)) {
    try {
      const raw = await fs.readFile(statsFilePath, 'utf8');
      botStats = JSON.parse(raw);
      
      const today = new Date().toDateString();
      if (botStats.lastReset !== today) {
        botStats.dailyConnections = 0;
        botStats.lastReset = today;
        await saveStats();
      }
    } catch (err) {
      console.error('❌ ᴇʀʀᴏʀ ʟᴏᴀᴅɪɴɢ sᴛᴀᴛs.ᴊsᴏɴ:', err);
    }
  }
};

const saveStats = async () => {
  try {
    await fs.writeFile(statsFilePath, JSON.stringify(botStats, null, 2));
  } catch (err) {
    console.error('❌ ᴇʀʀᴏʀ sᴀᴠɪɴɢ sᴛᴀᴛs.ᴊsᴏɴ:', err);
  }
};

const trackUser = async (userId) => {
  const userIdStr = userId.toString();
  if (!userIDs.has(userIdStr)) {
    userIDs.add(userIdStr);
    botStats.totalUsers++;
    await saveUserIDs();
    await saveStats();
    console.log(`➕ ɴᴇᴡ ᴜsᴇʀ ᴛʀᴀᴄᴋᴇᴅ: ${userIdStr}`);
  }
};

const checkMembership = async (userId) => {
  // No membership check required - everyone allowed
  return {
    hasJoinedGroup: true,
    hasJoinedAllChannels: true,
    hasJoinedAll: true,
    unjoinedChannels: [],
    unjoinedGroup: false
  };
};

const requireMembership = (handler) => {
  return async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    await trackUser(userId);
    
    // No membership check - everyone can access
    return handler(msg, match);
  };
};

// State management
let isShuttingDown = false;
let isAutoLoadRunning = false;

const runAutoLoad = async () => {
  if (isAutoLoadRunning || isShuttingDown) return;
  isAutoLoadRunning = true;

  try {
    console.log('⏱️ ɪɴɪᴛɪᴀʟɪᴢɪɴɢ ᴀᴜᴛᴏ-ʟᴏᴀᴅ');
    await autoLoadPairs();
    console.log('✅ ᴀᴜᴛᴏ-ʟᴏᴀᴅ ᴄᴏᴍᴘʟᴇᴛᴇᴅ');
  } catch (e) {
    console.error('❌ ᴀᴜᴛᴏ-ʟᴏᴀᴅ ғᴀɪʟᴇᴅ:', e);
  } finally {
    isAutoLoadRunning = false;
  }
};

const startAutoLoadLoop = () => {
  runAutoLoad();
  setInterval(runAutoLoad, 60 * 60 * 1000);
};

const gracefulShutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`🛑 ʀᴇᴄᴇɪᴠᴇᴅ ${signal}. sʜᴜᴛᴛɪɴɢ ᴅᴏᴡɴ...`);
  bot.stopPolling();
  console.log('✅ ʙᴏᴛ sᴛᴏᴘᴘᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ');
  process.exit(0);
};

// ========================
// COMMAND HANDLING
// ========================

// Initial welcome screen 
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  await trackUser(userId);
  
  const welcomeText = `࿊═══════════════════࿊

   【 ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ Owner MirZa 】

࿊═══════════════════࿊`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✰ sᴛᴀʀᴛ ʙᴏᴛ ✰', callback_data: 'show_main_menu' }]
      ]
    }
  };
  
  try {
    const videoUrl = getRandomVideoUrl();
    await bot.sendVideo(chatId, videoUrl, {
      caption: welcomeText,
      ...keyboard,
      supports_streaming: true
    });
  } catch (error) {
    console.error('ᴇʀʀᴏʀ sᴇɴᴅɪɴɢ ᴠɪᴅᴇᴏ:', error);
    await bot.sendMessage(chatId, welcomeText, keyboard);
  }
});

// /help command
bot.onText(/\/help/, requireMembership((msg) => {
  const chatId = msg.chat.id;
  const helpText = `࿊═══════════════════࿊
┃┌─〔 ᴄᴏᴍᴍᴀɴᴅ ʟɪsᴛ 〕
┃
┃ ➩ /connect <ɴᴜᴍʙᴇʀ>
┃   • ᴘᴀɪʀ ʏᴏᴜʀ ᴅᴇᴠɪᴄᴇ
┃
┃ ➩ /delpair <ɴᴜᴍʙᴇʀ>
┃   • ʀᴇᴍᴏᴠᴇ ᴘᴀɪʀɪɴɢ
┃
┃ ➩ /sessionid
┃   • ɢᴇᴛ sᴇssɪᴏɴ ɪᴅ
┃
┃ ➩ /ping
┃   • ᴄʜᴇᴄᴋ ʀᴇsᴘᴏɴsᴇ
┃
┃ ➩ /report <ᴍᴇssᴀɢᴇ>
┃   • ʀᴇᴘᴏʀᴛ ɪssᴜᴇs
┃
┃ ➩ /help
┃   • sʜᴏᴡ ᴛʜɪs ᴍᴇɴᴜ
┃└────────────
࿊═══════════════════࿊`;

  bot.sendMessage(chatId, helpText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🏠 ᴍᴀɪɴ ᴍᴇɴᴜ', callback_data: 'show_main_menu' }]
      ]
    }
  });
}));

// /ping command
bot.onText(/\/ping/, requireMembership(async (msg) => {
  const chatId = msg.chat.id;
  const start = Date.now();
  
  const sentMsg = await bot.sendMessage(chatId, `࿊═══════════════════࿊\n✰ ᴄᴀʟᴄᴜʟᴀᴛɪɴɢ... ✰\n࿊═══════════════════࿊`);
  
  const latency = Date.now() - start;
  
  let status = '🟢 ᴇxᴄᴇʟʟᴇɴᴛ';
  if (latency > 200) status = '🟡 ɢᴏᴏᴅ';
  if (latency > 500) status = '🟠 ғᴀɪʀ';
  if (latency > 1000) status = '🔴 sʟᴏᴡ';
  
  await bot.editMessageText(
    `࿊═══════════════════࿊\n┃┌─〔 ᴘɪɴɢ ʀᴇsᴜʟᴛ 〕\n┃ ➩ ${latency}ᴍs\n┃ ➩ ${status}\n┃└────────────\n࿊═══════════════════࿊`,
    {
      chat_id: chatId,
      message_id: sentMsg.message_id
    }
  );
}));

// /sessionid command
bot.onText(/\/sessions/, requireMembership(async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  try {
    const pairingPath = path.join(__dirname, 'itsmemirza', 'pairing');
    
    if (!(await exists(pairingPath))) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ɴᴏ sᴇssɪᴏɴ 〕\n┃ ➩ ʏᴏᴜ ʜᴀᴠᴇɴ'ᴛ ᴘᴀɪʀᴇᴅ\n┃ ➩ ᴜsᴇ /connect\n┃└────────────\n࿊═══════════════════࿊`);
    }

    const entries = await fs.readdir(pairingPath, { withFileTypes: true });
    const userSessions = entries.filter(entry => entry.isDirectory() && entry.name.includes('@s.whatsapp.net'));

    if (userSessions.length === 0) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ɴᴏ sᴇssɪᴏɴ 〕\n┃ ➩ ʏᴏᴜ ʜᴀᴠᴇɴ'ᴛ ᴘᴀɪʀᴇᴅ\n┃ ➩ ᴜsᴇ /connect\n┃└────────────\n࿊═══════════════════࿊`);
    }

    const sessionList = userSessions.map((session, index) => {
      const phoneNumber = session.name.split('@')[0];
      return `┃ ➩ ${index + 1}. +${phoneNumber}`;
    }).join('\n');

    bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ʏᴏᴜʀ sᴇssɪᴏɴs 〕\n┃ ➩ ᴛᴏᴛᴀʟ: ${userSessions.length}\n┃\n${sessionList}\n┃└────────────\n࿊═══════════════════࿊`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 ᴍᴀɪɴ ᴍᴇɴᴜ', callback_data: 'show_main_menu' }]
        ]
      }
    });
  } catch (error) {
    console.error('sᴇssɪᴏɴɪᴅ ᴇʀʀᴏʀ:', error);
    bot.sendMessage(chatId, `࿊═══════════════════࿊\n✰ ᴇʀʀᴏʀ ✰\n࿊═══════════════════࿊`);
  }
}));

// /status command (ADMIN ONLY)
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴀᴄᴄᴇss ᴅᴇɴɪᴇᴅ 〕\n┃ ➩ ᴀᴅᴍɪɴ ᴏɴʟʏ 🔒\n┃└────────────\n࿊═══════════════════࿊`);
  }
  
  try {
    const pairingPath = path.join(__dirname, 'itsmemirza', 'pairing');
    let pairedCount = 0;
    
    if (await exists(pairingPath)) {
      const entries = await fs.readdir(pairingPath, { withFileTypes: true });
      pairedCount = entries.filter(entry => entry.isDirectory() && entry.name.includes('@s.whatsapp.net')).length;
    }
    
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    
    const statusText = `࿊═══════════════════࿊
┃┌─〔 sᴛᴀᴛɪsᴛɪᴄs 〕
┃ ➩ sᴛᴀᴛᴜs: 🟢 ᴏɴʟɪɴᴇ
┃ ➩ ᴜᴘᴛɪᴍᴇ: ${hours}ʜ ${minutes}ᴍ
┃ ➩ ᴍᴇᴍᴏʀʏ: ${memoryUsage}ᴍʙ
┃
┃ ➩ ᴜsᴇʀs: ${userIDs.size}
┃ ➩ ᴘᴀɪʀs: ${pairedCount}/50
┃ ➩ ᴛᴏᴅᴀʏ: ${botStats.dailyConnections}
┃ ➩ ᴛᴏᴛᴀʟ: ${botStats.totalConnections}
┃└────────────
࿊═══════════════════࿊`;

    bot.sendMessage(chatId, statusText, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 ʀᴇғʀᴇsʜ', callback_data: 'bot_status' }]
        ]
      }
    });
  } catch (error) {
    console.error('sᴛᴀᴛᴜs ᴇʀʀᴏʀ:', error);
    bot.sendMessage(chatId, `࿊═══════════════════࿊\n✰ ᴇʀʀᴏʀ ✰\n࿊═══════════════════࿊`);
  }
});

// Handle bare /connect
bot.onText(/^\/connect\s*$/, requireMembership((msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `࿊═══════════════════࿊\n┃┌─〔 ᴄᴏɴɴᴇᴄᴛ ɢᴜɪᴅᴇ 〕\n┃ ➩ ᴜsᴀɢᴇ:\n┃   /connect <ɴᴜᴍʙᴇʀ>\n┃\n┃ ➩ ᴇxᴀᴍᴘʟᴇ:\n┃   /connect 923290386637\n┃└────────────\n࿊═══════════════════࿊`
  );
}));

// Enhanced /connect command
bot.onText(/\/connect (.+)/, requireMembership(async (msg, match) => {
  const chatId = msg.chat.id;
  const text = match[1].trim();

  try {
    if (!text || /[a-z]/i.test(text)) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴇʀʀᴏʀ 〕\n┃ ➩ ɪɴᴠᴀʟɪᴅ ɪɴᴘᴜᴛ\n┃ ➩ ᴏɴʟʏ ɴᴜᴍʙᴇʀs\n┃└────────────\n࿊═══════════════════࿊`);
    }

    if (!/^\d{7,15}(\|\d{1,10})?$/.test(text)) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴇʀʀᴏʀ 〕\n┃ ➩ ɪɴᴠᴀʟɪᴅ ғᴏʀᴍᴀᴛ\n┃└────────────\n࿊═══════════════════࿊`);
    }

    if (text.startsWith('0')) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴇʀʀᴏʀ 〕\n┃ ➩ ʀᴇᴍᴏᴠᴇ ʟᴇᴀᴅɪɴɢ 0\n┃└────────────\n࿊═══════════════════࿊`);
    }

    const countryCode = text.slice(0, 3);
    if (["252", "202"].includes(countryCode)) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴜɴsᴜᴘᴘᴏʀᴛᴇᴅ 〕\n┃ ➩ ᴄᴏᴜɴᴛʀʏ +${countryCode}\n┃└────────────\n࿊═══════════════════࿊`);
    }

    const pairingFolder = path.join(__dirname, 'itsmemirza', 'pairing');
    if (!(await exists(pairingFolder))) {
      await fs.mkdir(pairingFolder, { recursive: true });
    }

    const files = await fs.readdir(pairingFolder);
    const pairedCount = files.filter(file => file.endsWith('@s.whatsapp.net')).length;
    
    if (pairedCount >= 50) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ʟɪᴍɪᴛ ʀᴇᴀᴄʜᴇᴅ 〕\n┃ ➩ ᴘᴀɪʀɪɴɢ ʟɪᴍɪᴛ: ${pairedCount}/50\n┃\n┃ ➩ sᴏʟᴜᴛɪᴏɴs:\n┃   • ᴜsᴇ /report\n┃   • ᴛʀʏ ᴏᴛʜᴇʀ sᴇʀᴠᴇʀs\n┃   • ᴄᴏɴᴛᴀᴄᴛ ᴏᴡɴᴇʀ\n┃└────────────\n࿊═══════════════════࿊`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📝 ʀᴇᴘᴏʀᴛ', callback_data: 'report_guide' }]
          ]
        }
      });
    }

    const processingMsg = await bot.sendMessage(chatId, 
      `࿊═══════════════════࿊\n┃┌─〔 ᴘʀᴏᴄᴇssɪɴɢ 〕\n┃ ➩ ⏳ ɪɴɪᴛɪᴀʟɪᴢɪɴɢ...\n┃ ➩ 📱 ᴄᴏɴɴᴇᴄᴛɪɴɢ...\n┃ ➩ 🔐 sᴇᴄᴜʀɪɴɢ...\n┃└────────────\n࿊═══════════════════࿊`
    );

    const startpairing = require('./pair.js');
    const Xreturn = text.split("|")[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net";
    
    await startpairing(Xreturn);
    await sleep(4000);

    const pairingFile = path.join(pairingFolder, 'pairing.json');
    const cu = await fs.readFile(pairingFile, 'utf-8');
    const cuObj = JSON.parse(cu);
    delete require.cache[require.resolve('./pair.js')];

    botStats.totalConnections++;
    botStats.dailyConnections++;
    await saveStats();

    const senderNumber = text.split("|")[0].replace(/[^0-9]/g, '');
    const whatsappFormat = senderNumber + "@s.whatsapp.net";
    const lidFormat = senderNumber + "@lid";

    const ownerPath = path.join(__dirname, 'allfunc', 'owner.json');
    let ownerData = [];

    try {
      const ownerFile = await fs.readFile(ownerPath, 'utf-8');
      ownerData = JSON.parse(ownerFile);
    } catch (err) {
      console.log("⚠️ ᴄʀᴇᴀᴛɪɴɢ ɴᴇᴡ ᴏᴡɴᴇʀ.ᴊsᴏɴ");
      ownerData = [];
    }

    let isNew = false;
    if (!ownerData.includes(whatsappFormat)) {
      ownerData.push(whatsappFormat);
      isNew = true;
    }
    if (!ownerData.includes(lidFormat)) {
      ownerData.push(lidFormat);
      isNew = true;
    }

    if (isNew) {
      await fs.writeFile(ownerPath, JSON.stringify(ownerData, null, 2));
      console.log("✅ sᴀᴠᴇᴅ ɴᴇᴡ ᴏᴡɴᴇʀ:", senderNumber);
    }

    await bot.deleteMessage(chatId, processingMsg.message_id);

    bot.sendMessage(chatId, 
      `࿊═══════════════════࿊\n┃┌─〔 sᴜᴄᴄᴇss ✰ 〕\n┃\n┃ ➩ ᴄᴏᴅᴇ: ${cuObj.code}\n┃ ➩ ɴᴜᴍʙᴇʀ: +${senderNumber}\n┃ ➩ ᴏᴡɴᴇʀ: ${isNew ? '✅ ɢʀᴀɴᴛᴇᴅ' : 'ℹ️ ᴀʟʀᴇᴀᴅʏ sᴇᴛ'}\n┃\n┃┌─〔 ɴᴇxᴛ sᴛᴇᴘs 〕\n┃ ➩ 1. ᴏᴘᴇɴ ᴡʜᴀᴛsᴀᴘᴘ\n┃ ➩ 2. ʟɪɴᴋᴇᴅ ᴅᴇᴠɪᴄᴇs\n┃ ➩ 3. ʟɪɴᴋ ᴡɪᴛʜ ɴᴜᴍʙᴇʀ\n┃ ➩ 4. ᴇɴᴛᴇʀ ᴄᴏᴅᴇ\n┃└────────────\n࿊═══════════════════࿊`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🏠 ᴍᴀɪɴ ᴍᴇɴᴜ', callback_data: 'show_main_menu' }]
          ]
        }
      }
    );

  } catch (error) {
    console.error('❌ ᴄᴏɴɴᴇᴄᴛɪᴏɴ ᴇʀʀᴏʀ:', error);
    bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴇʀʀᴏʀ 〕\n┃ ➩ ${error.message}\n┃└────────────\n࿊═══════════════════࿊`);
  }
}));

// Handle bare /delpair
bot.onText(/^\/delpair\s*$/, requireMembership((msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴅᴇʟᴇᴛᴇ ɢᴜɪᴅᴇ 〕\n┃ ➩ ᴜsᴀɢᴇ:\n┃   /delpair <ɴᴜᴍʙᴇʀ>\n┃\n┃ ➩ ᴇxᴀᴍᴘʟᴇ:\n┃   /delpair 923290386637\n┃└────────────\n࿊═══════════════════࿊`);
}));

// Enhanced /delpair command
bot.onText(/\/delpair (.+)/, requireMembership(async (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1].trim();

  try {
    if (!input || /[a-z]/i.test(input) || !/^\d{7,15}$/.test(input) || input.startsWith('0')) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ɪɴᴠᴀʟɪᴅ 〕\n┃ ➩ ᴜsᴇ ᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ\n┃└────────────\n࿊═══════════════════࿊`);
    }

    const jidSuffix = `${input}@s.whatsapp.net`;
    const pairingPath = path.join(__dirname, 'itsmemirza', 'pairing');

    if (!(await exists(pairingPath))) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ɴᴏᴛ ғᴏᴜɴᴅ 〕\n┃ ➩ ɴᴏ ᴘᴀɪʀᴇᴅ ᴅᴇᴠɪᴄᴇs\n┃└────────────\n࿊═══════════════════࿊`);
    }

    const entries = await fs.readdir(pairingPath, { withFileTypes: true });
    const matched = entries.find(entry => entry.isDirectory() && entry.name.endsWith(jidSuffix));

    if (!matched) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ɴᴏᴛ ғᴏᴜɴᴅ 〕\n┃ ➩ +${input} ɴᴏᴛ ᴘᴀɪʀᴇᴅ\n┃└────────────\n࿊═══════════════════࿊`);
    }

    const targetPath = path.join(pairingPath, matched.name);
    await fs.rm(targetPath, { recursive: true, force: true });

    bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴅᴇʟᴇᴛᴇᴅ ✰ 〕\n┃ ➩ +${input} ʀᴇᴍᴏᴠᴇᴅ\n┃ ➩ sᴜᴄᴄᴇssғᴜʟʟʏ\n┃└────────────\n࿊═══════════════════࿊`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 ᴍᴀɪɴ ᴍᴇɴᴜ', callback_data: 'show_main_menu' }]
        ]
      }
    });
  } catch (err) {
    console.error('ᴅᴇʟᴘᴀɪʀ ᴇʀʀᴏʀ:', err);
    bot.sendMessage(chatId, `࿊═══════════════════࿊\n✰ ᴇʀʀᴏʀ ✰\n࿊═══════════════════࿊`);
  }
}));

// Admin commands
bot.onText(/\/listpair$/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴀᴄᴄᴇss ᴅᴇɴɪᴇᴅ 〕\n┃ ➩ ᴀᴅᴍɪɴ ᴏɴʟʏ 🔒\n┃└────────────\n࿊═══════════════════࿊`);
  }
  
  bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴄᴏɴғɪʀᴍ 〕\n┃ ➩ /listpair confirm\n┃└────────────\n࿊═══════════════════࿊`);
});

bot.onText(/\/listpair (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const confirmation = match[1].trim().toLowerCase();

  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴀᴄᴄᴇss ᴅᴇɴɪᴇᴅ 〕\n┃ ➩ ᴀᴅᴍɪɴ ᴏɴʟʏ 🔒\n┃└────────────\n࿊═══════════════════࿊`);
  }

  if (confirmation !== 'confirm') {
    return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴄᴏɴғɪʀᴍ 〕\n┃ ➩ /listpair confirm\n┃└────────────\n࿊═══════════════════࿊`);
  }

  try {
    const pairingPath = path.join(__dirname, 'itsmemirza', 'pairing');
    
    if (!(await exists(pairingPath))) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴇᴍᴘᴛʏ 〕\n┃ ➩ ɴᴏ ᴘᴀɪʀᴇᴅ ᴅᴇᴠɪᴄᴇs\n┃└────────────\n࿊═══════════════════࿊`);
    }

    const entries = await fs.readdir(pairingPath, { withFileTypes: true });
    const pairedDevices = entries.filter(entry => entry.isDirectory() && entry.name.includes('@s.whatsapp.net')).map(entry => entry.name);

    if (pairedDevices.length === 0) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴇᴍᴘᴛʏ 〕\n┃ ➩ ɴᴏ ᴘᴀɪʀᴇᴅ ᴅᴇᴠɪᴄᴇs\n┃└────────────\n࿊═══════════════════࿊`);
    }

    const deviceList = pairedDevices.map((device, index) => {
      const phoneNumber = device.split('@')[0];
      return `┃ ➩ ${index + 1}. +${phoneNumber}`;
    }).join('\n');

    bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴘᴀɪʀᴇᴅ ᴅᴇᴠɪᴄᴇs 〕\n┃ ➩ ᴛᴏᴛᴀʟ: ${pairedDevices.length}/50\n┃\n${deviceList}\n┃└────────────\n࿊═══════════════════࿊`);
  } catch (err) {
    console.error('ʟɪsᴛᴘᴀɪʀ ᴇʀʀᴏʀ:', err);
    bot.sendMessage(chatId, `࿊═══════════════════࿊\n✰ ᴇʀʀᴏʀ ✰\n࿊═══════════════════࿊`);
  }
});

// /autoload command (admin)
bot.onText(/\/autoload (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const confirmation = match[1].trim().toLowerCase();
  
  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴀᴄᴄᴇss ᴅᴇɴɪᴇᴅ 〕\n┃ ➩ ᴀᴅᴍɪɴ ᴏɴʟʏ 🔒\n┃└────────────\n࿊═══════════════════࿊`);
  }
  
  if (confirmation !== 'confirm') {
    return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴄᴏɴғɪʀᴍ 〕\n┃ ➩ /autoload confirm\n┃└────────────\n࿊═══════════════════࿊`);
  }
  
  console.log('ᴍᴀɴᴜᴀʟ ᴀᴜᴛᴏ-ʟᴏᴀᴅ ᴛʀɪɢɢᴇʀᴇᴅ');
  autoLoadPairs()
    .then(() => bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 sᴜᴄᴄᴇss 〕\n┃ ➩ ᴄᴏᴍᴘʟᴇᴛᴇᴅ\n┃└────────────\n࿊═══════════════════࿊`))
    .catch(e => bot.sendMessage(chatId, `࿊═══════════════════࿊\n✰ ᴇʀʀᴏʀ ✰\n࿊═══════════════════࿊`));
});

// /report command
bot.onText(/^\/report$/, requireMembership((msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `࿊═══════════════════࿊\n┃┌─〔 ʀᴇᴘᴏʀᴛ 〕\n┃ ➩ ᴜsᴀɢᴇ:\n┃   /report <ᴍᴇssᴀɢᴇ>\n┃\n┃ ➩ ᴇxᴀᴍᴘʟᴇ:\n┃   /report ʙᴏᴛ ɴᴏᴛ ʀᴇsᴘᴏɴᴅɪɴɢ\n┃└────────────\n࿊═══════════════════࿊`
  );
}));

bot.onText(/\/report (.+)/, requireMembership(async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username ? `@${msg.from.username}` : 'ɴᴏ ᴜsᴇʀɴᴀᴍᴇ';
  const firstName = msg.from.first_name || 'ᴜsᴇʀ';
  const reportMessage = match[1].trim();

  if (!reportMessage) {
    return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴇʀʀᴏʀ 〕\n┃ ➩ ᴘʀᴏᴠɪᴅᴇ ᴍᴇssᴀɢᴇ\n┃└────────────\n࿊═══════════════════࿊`);
  }

  try {
    const reportText = `࿊═══════════════════࿊\n┃┌─〔 ɴᴇᴡ ʀᴇᴘᴏʀᴛ 〕\n┃ ➩ ғʀᴏᴍ: ${firstName}\n┃ ➩ ᴜsᴇʀɴᴀᴍᴇ: ${username}\n┃ ➩ ɪᴅ: ${userId}\n┃\n┃ ➩ ᴍᴇssᴀɢᴇ:\n┃   ${reportMessage}\n┃└────────────\n࿊═══════════════════࿊`;

    let sentCount = 0;
    for (const adminId of adminIDs) {
      try {
        await bot.sendMessage(adminId, reportText, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💬 ʀᴇᴘʟʏ', callback_data: `reply_${userId}` }]
            ]
          }
        });
        sentCount++;
      } catch (e) {
        console.error(`ғᴀɪʟᴇᴅ ᴛᴏ sᴇɴᴅ ʀᴇᴘᴏʀᴛ ᴛᴏ ${adminId}:`, e.message);
      }
    }

    if (sentCount > 0) {
      bot.sendMessage(
        chatId,
        `࿊═══════════════════࿊\n┃┌─〔 sᴇɴᴛ ✰ 〕\n┃ ➩ ʀᴇᴘᴏʀᴛ sᴇɴᴛ ᴛᴏ ᴀᴅᴍɪɴs\n┃ ➩ ᴛʜᴇʏ ᴡɪʟʟ ʀᴇsᴘᴏɴᴅ sᴏᴏɴ\n┃└────────────\n࿊═══════════════════࿊`
      );
      console.log(chalk.green(`📨 ʀᴇᴘᴏʀᴛ ғʀᴏᴍ ${userId} sᴇɴᴛ`));
    } else {
      bot.sendMessage(chatId, `࿊═══════════════════࿊\n✰ ғᴀɪʟᴇᴅ ✰\n࿊═══════════════════࿊`);
    }
  } catch (error) {
    console.error('ʀᴇᴘᴏʀᴛ ᴇʀʀᴏʀ:', error);
    bot.sendMessage(chatId, `࿊═══════════════════࿊\n✰ ᴇʀʀᴏʀ ✰\n࿊═══════════════════࿊`);
  }
}));

// /cleansession (admin)
bot.onText(/\/cleansession$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴀᴄᴄᴇss ᴅᴇɴɪᴇᴅ 〕\n┃ ➩ ᴀᴅᴍɪɴ ᴏɴʟʏ 🔒\n┃└────────────\n࿊═══════════════════࿊`);
  }
  
  try {
    const pairingPath = path.join(__dirname, 'itsmemirza', 'pairing');
    
    if (!(await exists(pairingPath))) {
      return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴇᴍᴘᴛʏ 〕\n┃ ➩ ɴᴏ sᴇssɪᴏɴs\n┃└────────────\n࿊═══════════════════࿊`);
    }

    const entries = await fs.readdir(pairingPath, { withFileTypes: true });
    let cleaned = 0;
    let kept = 0;

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'pairing.json') continue;
      
      const sessionPath = path.join(pairingPath, entry.name);
      const credsPath = path.join(sessionPath, 'creds.json');
      
      let isValid = false;
      if (await exists(credsPath)) {
        try {
          const creds = JSON.parse(await fs.readFile(credsPath, 'utf8'));
          isValid = !!(creds.me && creds.me.id && creds.registered);
        } catch (e) {
          isValid = false;
        }
      }
      
      if (!isValid) {
        await fs.rm(sessionPath, { recursive: true, force: true });
        console.log(`🗑️ ᴄʟᴇᴀɴᴇᴅ: ${entry.name}`);
        cleaned++;
      } else {
        kept++;
      }
    }

    bot.sendMessage(
      chatId, 
      `࿊═══════════════════࿊\n┃┌─〔 ᴄʟᴇᴀɴᴇᴅ 〕\n┃ ➩ ʀᴇᴍᴏᴠᴇᴅ: ${cleaned}\n┃ ➩ ᴋᴇᴘᴛ: ${kept}\n┃└────────────\n࿊═══════════════════࿊`
    );
  } catch (err) {
    console.error('ᴄʟᴇᴀɴsᴇssɪᴏɴ ᴇʀʀᴏʀ:', err);
    bot.sendMessage(chatId, `࿊═══════════════════࿊\n✰ ᴇʀʀᴏʀ ✰\n࿊═══════════════════࿊`);
  }
});

// /broadcast (admin)
bot.onText(/\/broadcast$/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴀᴄᴄᴇss ᴅᴇɴɪᴇᴅ 〕\n┃ ➩ ᴀᴅᴍɪɴ ᴏɴʟʏ 🔒\n┃└────────────\n࿊═══════════════════࿊`);
  }
  bot.sendMessage(
    chatId,
    `࿊═══════════════════࿊\n┃┌─〔 ʙʀᴏᴀᴅᴄᴀsᴛ 〕\n┃ ➩ ᴜsᴀɢᴇ:\n┃   /broadcast <ᴍᴇssᴀɢᴇ>\n┃\n┃ ➩ ᴜsᴇʀs: ${userIDs.size}\n┃└────────────\n࿊═══════════════════࿊`
  );
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const message = match[1].trim();

  if (!adminIDs.includes(userId)) {
    return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴀᴄᴄᴇss ᴅᴇɴɪᴇᴅ 〕\n┃ ➩ ᴀᴅᴍɪɴ ᴏɴʟʏ 🔒\n┃└────────────\n࿊═══════════════════࿊`);
  }

  if (!message) {
    return bot.sendMessage(chatId, `࿊═══════════════════࿊\n✰ ᴘʀᴏᴠɪᴅᴇ ᴍᴇssᴀɢᴇ ✰\n࿊═══════════════════࿊`);
  }

  const totalUsers = userIDs.size;
  
  if (totalUsers === 0) {
    return bot.sendMessage(chatId, `࿊═══════════════════࿊\n┃┌─〔 ᴇᴍᴘᴛʏ 〕\n┃ ➩ ɴᴏ ᴜsᴇʀs\n┃└────────────\n࿊═══════════════════࿊`);
  }

  const statusMsg = await bot.sendMessage(
    chatId,
    `࿊═══════════════════࿊\n┃┌─〔 ʙʀᴏᴀᴅᴄᴀsᴛɪɴɢ 〕\n┃ ➩ sᴛᴀʀᴛɪɴɢ...\n┃ ➩ ᴛᴏᴛᴀʟ: ${totalUsers}\n┃ ➩ sᴇɴᴛ: 0\n┃└────────────\n࿊═══════════════════࿊`
  );

  let sent = 0;
  let failed = 0;
  const users = [...userIDs];

  for (let i = 0; i < users.length; i++) {
    try {
      await bot.sendMessage(
        users[i],
        `࿊═══════════════════࿊\n┃┌─〔 ᴀɴɴᴏᴜɴᴄᴇᴍᴇɴᴛ 〕\n┃\n${message}\n┃\n┃└────────────\n࿊═══════════════════࿊`
      );
      sent++;
      
      if (i % 10 === 0 || i === users.length - 1) {
        try {
          await bot.editMessageText(
            `࿊═══════════════════࿊\n┃┌─〔 ʙʀᴏᴀᴅᴄᴀsᴛɪɴɢ 〕\n┃ ➩ ᴛᴏᴛᴀʟ: ${totalUsers}\n┃ ➩ sᴇɴᴛ: ${sent}\n┃ ➩ ғᴀɪʟᴇᴅ: ${failed}\n┃ ➩ ${Math.round((i + 1) / users.length * 100)}%\n┃└────────────\n࿊═══════════════════࿊`,
            {
              chat_id: chatId,
              message_id: statusMsg.message_id
            }
          );
        } catch (e) {}
      }
      
      await sleep(100);
      
    } catch (error) {
      failed++;
      console.log(`ғᴀɪʟᴇᴅ ᴛᴏ sᴇɴᴅ ᴛᴏ ${users[i]}: ${error.message}`);
      
      if (error.response && error.response.body && error.response.body.error_code === 403) {
        userIDs.delete(users[i]);
        await saveUserIDs();
      }
    }
  }

  await bot.editMessageText(
    `࿊═══════════════════࿊\n┃┌─〔 ᴄᴏᴍᴘʟᴇᴛᴇᴅ ✰ 〕\n┃ ➩ ᴛᴏᴛᴀʟ: ${totalUsers}\n┃ ➩ sᴇɴᴛ: ${sent}\n┃ ➩ ғᴀɪʟᴇᴅ: ${failed}\n┃ ➩ ʀᴀᴛᴇ: ${Math.round(sent / totalUsers * 100)}%\n┃└────────────\n࿊═══════════════════࿊`,
    {
      chat_id: chatId,
      message_id: statusMsg.message_id
    }
  );

  console.log(chalk.green(`✅ ʙʀᴏᴀᴅᴄᴀsᴛ ᴄᴏᴍᴘʟᴇᴛᴇᴅ: ${sent}/${totalUsers}`));
});

// Handle unrecognized commands
bot.on('message', async (msg) => {
  if (msg.text && msg.text.startsWith('/')) {
    const command = msg.text.split(' ')[0];
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const validCommands = [
      '/start', '/connect', '/delpair', '/autoload', '/listpair',
      '/broadcast', '/report', '/help', '/status', '/ping',
      '/cleansession', '/sessions'
    ];

    if (!validCommands.includes(command)) {
      await trackUser(userId);
      
      bot.sendMessage(
        chatId,
        `࿊═══════════════════࿊\n┃┌─〔 ᴜɴᴋɴᴏᴡɴ 〕\n┃ ➩ ᴄᴏᴍᴍᴀɴᴅ ɴᴏᴛ ғᴏᴜɴᴅ\n┃ ➩ ᴜsᴇ /help\n┃└────────────\n࿊═══════════════════࿊`,
        { 
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏠 ᴍᴇɴᴜ', callback_data: 'show_main_menu' }]
            ]
          }
        }
      );
    }
  }
});

// Handle admin replies
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  if (adminIDs.includes(userId) && msg.reply_to_message) {
    const replyToText = msg.reply_to_message.text;
    
    if (replyToText && replyToText.includes('ɴᴇᴡ ʀᴇᴘᴏʀᴛ')) {
      const userIdMatch = replyToText.match(/ɪᴅ: (\d+)/);
      
      if (userIdMatch && userIdMatch[1]) {
        const targetUserId = userIdMatch[1];
        const adminReply = msg.text;
        
        try {
          await bot.sendMessage(
            targetUserId,
            `࿊═══════════════════࿊\n┃┌─〔 ᴀᴅᴍɪɴ ʀᴇᴘʟʏ 〕\n┃\n${adminReply}\n┃\n┃└────────────\n࿊═══════════════════࿊`
          );
          
          bot.sendMessage(chatId, `࿊═══════════════════࿊\n✰ sᴇɴᴛ ✰\n࿊═══════════════════࿊`);
          
          console.log(chalk.green(`📬 ᴀᴅᴍɪɴ ${userId} ʀᴇᴘʟɪᴇᴅ ᴛᴏ ${targetUserId}`));
        } catch (error) {
          console.error('ᴇʀʀᴏʀ sᴇɴᴅɪɴɢ ᴀᴅᴍɪɴ ʀᴇᴘʟʏ:', error);
          bot.sendMessage(chatId, `࿊═══════════════════࿊\n✰ ғᴀɪʟᴇᴅ ✰\n࿊═══════════════════࿊`);
        }
      }
    }
  }
});

// Callback handler
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;
  const chatId = msg.chat.id;

  await trackUser(userId);

  if (data === 'show_main_menu') {
    await bot.answerCallbackQuery(callbackQuery.id);
    
    const firstName = callbackQuery.from.first_name || 'ᴜsᴇʀ';
    const timeOfDay = new Date().getHours();
    let greeting = 'ɢᴏᴏᴅ ᴇᴠᴇɴɪɴɢ';
    let greetingEmoji = '🌙';
    if (timeOfDay < 12) {
      greeting = 'ɢᴏᴏᴅ ᴍᴏʀɴɪɴɢ';
      greetingEmoji = '🌅';
    } else if (timeOfDay < 18) {
      greeting = 'ɢᴏᴏᴅ ᴀғᴛᴇʀɴᴏᴏɴ';
      greetingEmoji = '☀️';
    }
    
    let botUsername;
    try {
      botUsername = (await bot.getMe()).username;
    } catch (e) {
      botUsername = 'ЅΙᒪᐯΞᎡ-Τech-MD';
    }
    
    const mainMenu = `࿊═══════════════════࿊

${greetingEmoji} ${greeting}, ${firstName}!

ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ Owner MirZa - ʏᴏᴜʀ ғᴀsᴛᴇsᴛ
ᴡʜᴀᴛsᴀᴘᴘ ᴘᴀɪʀɪɴɢ sᴏʟᴜᴛɪᴏɴ! ɢᴇᴛ ʏᴏᴜʀ
ᴄᴏᴅᴇ ɪɴ sᴇᴄᴏɴᴅs ᴀɴᴅ sᴛᴀʀᴛ ʙᴜɪʟᴅɪɴɢ! ✨

࿊═══════════════════࿊

┃┌─〔 ʙᴏᴛ ɪɴғᴏ 〕
┃ ➩ ʙᴏᴛ ɴᴀᴍᴇ: Owner MirZa
┃ ➩ ᴜsᴇʀɴᴀᴍᴇ: @${botUsername}
┃ ➩ ᴠᴇʀsɪᴏɴ: 2.0 ✮
┃ ➩ ᴏᴡɴᴇʀ: @Mirza
┃└────────────

┃┌─〔 Owner MirZa ᴅᴇsᴄʀɪᴘᴛɪᴏɴ 〕
┃ ➩ Owner MirZa MD ɪs ᴀ ғᴀsᴛ,
┃ sᴇᴄᴜʀᴇ, ᴀɴᴅ ʀᴇʟɪᴀʙʟᴇ
┃ ᴡʜᴀᴛsᴀᴘᴘ ᴘᴀɪʀɪɴɢ sʏsᴛᴇᴍ.
┃ ᴇᴀsʏ ᴛᴏ ᴜsᴇ, ʟɪɢʜᴛᴡᴇɪɢʜᴛ,
┃ ᴀɴᴅ ᴘᴏᴡᴇʀᴇᴅ ʙʏ
┃ ➩ @Mirza
┃└────────────

┃┌─〔 ᴄᴏᴍᴍᴀɴᴅs 〕
┃ ➩ /connect - ᴘᴀɪʀ ᴅᴇᴠɪᴄᴇ
┃ ➩ /delpair - ʀᴇᴍᴏᴠᴇ ᴘᴀɪʀ
┃ ➩ /sessionid - ɢᴇᴛ sᴇssɪᴏɴ
┃ ➩ /ping - ᴄʜᴇᴄᴋ sᴘᴇᴇᴅ
┃ ➩ /report - ʀᴇᴘᴏʀᴛ ɪssᴜᴇ
┃ ➩ /help - sʜᴏᴡ ʜᴇʟᴘ
┃└────────────

࿊═══════════════════࿊`;

    try {
      // Delete the video message
      await bot.deleteMessage(chatId, msg.message_id);
      
      // Send new text message with menu
      await bot.sendMessage(chatId, mainMenu, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '⚡ ᴄᴏɴɴᴇᴄᴛ', url: `https://t.me/${botUsername}?start=connect` },
              { text: '❓ ʜᴇʟᴘ', callback_data: 'help_callback' }
            ],
            [{ text: '👨‍💻 ᴏᴡɴᴇʀ', url: OWNER_LINK }]
          ]
        }
      });
    } catch (error) {
      console.error('ᴇʀʀᴏʀ sʜᴏᴡɪɴɢ ᴍᴀɪɴ ᴍᴇɴᴜ:', error);
      // If delete fails, just send the menu anyway
      try {
        await bot.sendMessage(chatId, mainMenu, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '⚡ ᴄᴏɴɴᴇᴄᴛ', url: `https://t.me/${botUsername}?start=connect` },
                { text: '❓ ʜᴇʟᴘ', callback_data: 'help_callback' }
              ],
              [{ text: '👨‍💻 ᴏᴡɴᴇʀ', url: OWNER_LINK }]
            ]
          }
        });
      } catch (e) {
        console.error('ғᴀɪʟᴇᴅ ᴛᴏ sᴇɴᴅ ᴍᴇɴᴜ:', e);
      }
    }
  }
  
  else if (data === 'help_callback') {
    await bot.answerCallbackQuery(callbackQuery.id);
    
    const helpText = `࿊═══════════════════࿊
┃┌─〔 ᴄᴏᴍᴍᴀɴᴅ ʟɪsᴛ 〕
┃
┃ ➩ /connect <ɴᴜᴍʙᴇʀ>
┃   • ᴘᴀɪʀ ʏᴏᴜʀ ᴅᴇᴠɪᴄᴇ
┃
┃ ➩ /delpair <ɴᴜᴍʙᴇʀ>
┃   • ʀᴇᴍᴏᴠᴇ ᴘᴀɪʀɪɴɢ
┃
┃ ➩ /sessionid
┃   • ɢᴇᴛ sᴇssɪᴏɴ ɪᴅ
┃
┃ ➩ /ping
┃   • ᴄʜᴇᴄᴋ ʀᴇsᴘᴏɴsᴇ
┃
┃ ➩ /report <ᴍᴇssᴀɢᴇ>
┃   • ʀᴇᴘᴏʀᴛ ɪssᴜᴇs
┃
┃ ➩ /help
┃   • sʜᴏᴡ ᴛʜɪs ᴍᴇɴᴜ
┃└────────────
࿊═══════════════════࿊`;

    await bot.editMessageText(helpText, {
      chat_id: chatId,
      message_id: msg.message_id,
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 ʙᴀᴄᴋ', callback_data: 'show_main_menu' }]
        ]
      }
    });
  }
  
  else if (data === 'report_guide') {
    await bot.answerCallbackQuery(callbackQuery.id);
    
    await bot.editMessageText(
      `࿊═══════════════════࿊\n┃┌─〔 ʀᴇᴘᴏʀᴛ ɢᴜɪᴅᴇ 〕\n┃ ➩ ᴜsᴀɢᴇ:\n┃   /report <ᴍᴇssᴀɢᴇ>\n┃\n┃ ➩ ᴇxᴀᴍᴘʟᴇ:\n┃   /report ʙᴏᴛ ɴᴏᴛ ᴡᴏʀᴋɪɴɢ\n┃\n┃ ➩ sᴇɴᴛ ᴅɪʀᴇᴄᴛʟʏ ᴛᴏ ᴏᴡɴᴇʀ\n┃└────────────\n࿊═══════════════════࿊`,
      {
        chat_id: chatId,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 ʙᴀᴄᴋ', callback_data: 'show_main_menu' }]
          ]
        }
      }
    );
  }
  
  else if (data === 'bot_status') {
    if (!adminIDs.includes(userId.toString())) {
      return bot.answerCallbackQuery(callbackQuery.id, { 
        text: '⚠️ ᴀᴅᴍɪɴ ᴏɴʟʏ', 
        show_alert: true 
      });
    }
    
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'ʟᴏᴀᴅɪɴɢ...' });
    
    try {
      const pairingPath = path.join(__dirname, 'itsmemirza', 'pairing');
      let pairedCount = 0;
      
      if (await exists(pairingPath)) {
        const entries = await fs.readdir(pairingPath, { withFileTypes: true });
        pairedCount = entries.filter(entry => entry.isDirectory() && entry.name.includes('@s.whatsapp.net')).length;
      }
      
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      
      const statusText = `࿊═══════════════════࿊
┃┌─〔 sᴛᴀᴛɪsᴛɪᴄs 〕
┃ ➩ sᴛᴀᴛᴜs: 🟢 ᴏɴʟɪɴᴇ
┃ ➩ ᴜᴘᴛɪᴍᴇ: ${hours}ʜ ${minutes}ᴍ
┃ ➩ ᴍᴇᴍᴏʀʏ: ${memoryUsage}ᴍʙ
┃
┃ ➩ ᴜsᴇʀs: ${userIDs.size}
┃ ➩ ᴘᴀɪʀs: ${pairedCount}/50
┃ ➩ ᴛᴏᴅᴀʏ: ${botStats.dailyConnections}
┃ ➩ ᴛᴏᴛᴀʟ: ${botStats.totalConnections}
┃└────────────
࿊═══════════════════࿊`;

      await bot.editMessageText(statusText, {
        chat_id: chatId,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 ʀᴇғʀᴇsʜ', callback_data: 'bot_status' }]
          ]
        }
      });
    } catch (error) {
      console.error('sᴛᴀᴛᴜs ᴇʀʀᴏʀ:', error);
      await bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ ᴇʀʀᴏʀ', show_alert: true });
    }
  }
  
  else if (data.startsWith('reply_')) {
    const targetUserId = data.replace('reply_', '');
    
    await bot.answerCallbackQuery(callbackQuery.id, { 
      text: 'ʀᴇᴘʟʏ ᴛᴏ ᴛʜᴇ ᴍᴇssᴀɢᴇ', 
      show_alert: true 
    });
    
    await bot.sendMessage(
      chatId,
      `࿊═══════════════════࿊\n┃┌─〔 ʀᴇᴘʟʏ ᴍᴏᴅᴇ 〕\n┃ ➩ ʀᴇᴘʟʏ ᴛᴏ ᴛʜᴇ ʀᴇᴘᴏʀᴛ\n┃ ᴍᴇssᴀɢᴇ ᴀʙᴏᴠᴇ\n┃\n┃ ➩ ᴜsᴇʀ ɪᴅ: ${targetUserId}\n┃└────────────\n࿊═══════════════════࿊`,
      {
        reply_to_message_id: msg.message_id
      }
    );
  }
});

// Initialize and start
(async () => {
  await ensureDirectories();
  await loadAdminIDs();
  await loadUserIDs();
  await loadStats();
  // startAutoLoadLoop(); // Uncomment if needed
  
  const restartCount = parseInt(process.env.RESTART_COUNT || '0', 10);
  console.log(chalk.cyan(`\n࿊═══════════════════════════࿊`));
  console.log(chalk.cyan(`│                              │`));
  console.log(chalk.green(`│      Owner MirZa ʙᴏᴛ ᴠ2.0       │`));
  console.log(chalk.yellow(`│         ᴏᴡɴᴇʀ: @Mirza           │`));
  console.log(chalk.cyan(`│                              │`));
  console.log(chalk.cyan(`࿊═══════════════════════════࿊\n`));
  
  console.log(chalk.green('✅ ʙᴏᴛ ɪs ʀᴜɴɴɪɴɢ...'));
  console.log(chalk.yellow(`♻️  ʀᴇsᴛᴀʀᴛ #${restartCount + 1}`));
  process.env.RESTART_COUNT = String(restartCount + 1);
  
  console.log(chalk.blue('\n📊 sᴛᴀᴛs:'));
  console.log(chalk.white(`   👥 ᴜsᴇʀs: ${userIDs.size}`));
  console.log(chalk.white(`   📱 ᴄᴏɴɴᴇᴄᴛɪᴏɴs: ${botStats.totalConnections}`));
  
  console.log(chalk.cyan('\n🔗 ᴏᴡɴᴇʀ ʟɪɴᴋ:'));
  console.log(chalk.white(`   👨‍💻 ${OWNER_LINK}`));
  
  console.log(chalk.green('\n✅ ɴᴏ ᴄʜᴀɴɴᴇʟ ʀᴇǫᴜɪʀᴇᴍᴇɴᴛs - ᴇᴠᴇʀʏᴏɴᴇ ᴀʟʟᴏᴡᴇᴅ!'));
  console.log(chalk.cyan('\n࿊═══════════════════════════࿊\n'));
})();

// Shutdown handlers
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('message', (msg) => {
  if (msg === 'shutdown') gracefulShutdown('PM2_SHUTDOWN');
});