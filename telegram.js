require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { useMultiFileAuthState, makeWASocket, Browsers, delay } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const startBot = require('./index.js'); // Tumhara main bot

const token = process.env.TELEGRAM_BOT_TOKEN;
if(!token) throw new Error('TELEGRAM_BOT_TOKEN missing in.env');

const bot = new TelegramBot(token, {polling: true});
const SESSION_DIR = process.env.SESSION_DIR || './sessions/';

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

bot.onText(/\/pair (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const number = match[1].replace(/[^0-9]/g, ''); // 923436259742

  if(!number || number.length < 10){
    return bot.sendMessage(chatId, '❌ Format: /pair 923436259742')
  }

  bot.sendMessage(chatId, `⏳ ${number} ke liye pairing code bana raha hu...`);

  const sessionPath = path.join(SESSION_DIR, number);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop')
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    await delay(1500);
    try {
      const code = await sock.requestPairingCode(number);
      bot.sendMessage(chatId,
`✅ *WhatsApp Pairing Code:* \`${code}\`

*Steps:*
1. WhatsApp > 3 dots > *Linked Devices*
2. *Link a Device* > *Link with phone number instead*
3. Ye code dalo: ${code}`, {parse_mode: 'Markdown'});
    } catch(e){
      return bot.sendMessage(chatId, `❌ Error: ${e.message}`);
    }
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if(connection === 'open'){
      bot.sendMessage(chatId, `✅ ${number} WhatsApp se connect ho gaya!\n\nAb is number pe.menu likho.`);
      startBot({ sock, number }); // index.js chal gaya
    }
    if(connection === 'close' && lastDisconnect?.error?.output?.statusCode!== 401){
      sock.end();
    }
  });
});

console.log('✅ Telegram Bot Connected. Use /pair number');