import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs, { existsSync, mkdirSync, rmSync } from 'fs';
import path, { dirname } from 'path';
import chalk from 'chalk';
import syntaxerror from 'syntax-error';
import { parsePhoneNumber as PhoneNumber } from 'awesome-phonenumber';
import readline from 'readline';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { smsg } from './lib/myfunc.js';
import { compileAll } from './lib/compile.js';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, jidDecode, jidNormalizedUser, makeCacheableSignalKeyStore, delay } from '@whiskeysockets/baileys';
import NodeCache from 'node-cache';
import pino from 'pino';
import config from './config.js';
import store from './lib/lightweight_store.js';
import SaveCreds from './lib/session.js';
import { server, PORT } from './lib/server.js';
import express from 'express';
import { printLog } from './lib/print.js';
import { writeErrorLog } from './lib/logger.js';
import { handleMessages, handleGroupParticipantUpdate, handleStatus, handleCall } from './lib/messageHandler.js';
import commandHandler from './lib/commandHandler.js';

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function startBot({ number }) {
    const phoneNumber = number || config.pairingNumber || config.ownerNumber || "923436259742";
    store.readFromFile();
    setInterval(() => store.writeToFile(), config.storeWriteInterval || 10000);
    setInterval(() => { if (global.gc) { global.gc(); console.log('🧹 Garbage collection completed'); } }, 60000);
    setInterval(() => { const used = process.memoryUsage().rss / 1024 / 1024; if (used > 400) { printLog('warning', 'RAM too high (>400MB), restarting bot...'); process.exit(1); } }, 30000);

    const DATA_DEFAULTS = { 'owner.json': [], 'banned.json': [], 'premium.json': [], 'warnings.json': {}, 'notes.json': {}, 'autoAi.json': {}, 'messageCount.json': { isPublic: true, messageCount: {} }, 'userGroupData.json': { users: [], groups: [], antilink: {}, antibadword: {}, warnings: {}, sudo: [], welcome: {}, goodbye: {}, chatbot: {}, autoReaction: false }, 'autoStatus.json': { enabled: false }, 'autoread.json': { enabled: false }, 'autotyping.json': { enabled: false }, 'pmblocker.json': { enabled: false }, 'anticall.json': { enabled: false }, 'stealthMode.json': { enabled: false }, 'autoBio.json': { enabled: false, customBio: null }, 'autoReaction.json': { enabled: false }, 'antidelete.json': { enabled: false }, 'antilink.json': {}, 'antibadword.json': {}, };
    fs.mkdirSync('./data', { recursive: true });
    for (const [file, def] of Object.entries(DATA_DEFAULTS)) { const fp = `./data/${file}`; if (!fs.existsSync(fp)) fs.writeFileSync(fp, JSON.stringify(def, null, 2)); }

    let owner = []; try { owner = JSON.parse(fs.readFileSync('./data/owner.json', 'utf-8')); } catch { owner = []; }
    global.botname = config.botName || "M-RIZWAN-MD"; global.themeemoji = "•";
    const pairingCode = TG_TOKEN? false :!process.argv.includes("--qr-code");
    const useMobile = process.argv.includes("--mobile");

    let rl = null; let rlClosed = false;
    if (process.stdin.isTTY &&!config.pairingNumber) { rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.on('close', () => { rlClosed = true; }); }
    const question = (text) => { if (rl &&!rlClosed) { return new Promise((resolve) => rl.question(text, resolve)); } else { return Promise.resolve(config.ownerNumber || phoneNumber); } };
    process.on('exit', () => { if (rl &&!rlClosed) rl.close(); });
    process.on('SIGINT', () => { if (rl &&!rlClosed) rl.close(); process.exit(0); });

    function ensureSessionDirectory() { const sessionPath = path.join(__dirname, 'session', phoneNumber); if (!existsSync(sessionPath)) { mkdirSync(sessionPath, { recursive: true }); } return sessionPath; }

    function hasValidSession() {
        try {
            const credsPath = path.join(__dirname, 'session', phoneNumber, 'creds.json');
            if (!existsSync(credsPath)) return false;
            const fileContent = fs.readFileSync(credsPath, 'utf8');
            if (!fileContent || fileContent.trim().length === 0) {
                printLog('warning', 'creds.json exists but is empty');
                return false;
            }
            try {
                const creds = JSON.parse(fileContent);
                if (!creds.noiseKey ||!creds.signedIdentityKey ||!creds.signedPreKey) {
                    printLog('warning', 'creds.json is missing required fields');
                    return false;
                }
                if (creds.registered === false) {
                    printLog('warning', 'Session not registered. Clearing for fresh pairing...');
                    try { rmSync(path.join(__dirname, 'session', phoneNumber), { recursive: true, force: true }); } catch (_e) { }
                    return false;
                }
                printLog('success', 'Valid and registered session credentials found');
                return true;
            } catch (_parseError) {
                printLog('warning', 'creds.json contains invalid JSON');
                return false;
            }
        } catch (error) {
            printLog('error', `Error checking session validity: ${error.message}`);
            return false;
        }
    }

    async function initializeSession() { 
    ensureSessionDirectory(); 
    const txt = config.sessionId; 
    
    if (!txt) { 
        if (hasValidSession()) { 
            printLog('success', 'Existing session found. Using saved credentials'); 
            return true; 
        } 
        return false; 
    } 
    
    if (hasValidSession()) return true; 
    
    try { 
        await SaveCreds(txt); 
        await delay(2000); 
        if (hasValidSession()) { 
            printLog('success', 'Session file verified and valid'); 
            await delay(1000); 
            return true; 
        } else { 
            printLog('error', 'Session file not valid after download'); 
            return false; 
        } 
    } catch (error) { 
        printLog('error', `Error downloading session: ${error.message}`); 
        return false; 
    } 
}

    async function startQasimDev() {
        try {
            const { version } = await fetchLatestBaileysVersion();
            ensureSessionDirectory(); await delay(1000);
            const { state, saveCreds } = await useMultiFileAuthState(`./session/${phoneNumber}`);
            const _saveCreds = async () => { ensureSessionDirectory(); await saveCreds(); };
            const msgRetryCounterCache = new NodeCache();
            const ghostMode = await store.getSetting('global', 'stealthMode');
            const isGhostActive = ghostMode && ghostMode.enabled;

            const QasimDev = makeWASocket({
                version, logger: pino({ level: 'silent' }), browser: Browsers.macOS('Chrome'),
                auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })), },
                markOnlineOnConnect:!isGhostActive, generateHighQualityLinkPreview: true, syncFullHistory: false,
                getMessage: async (key) => { const jid = jidNormalizedUser(key.remoteJid); const msg = await store.loadMessage(jid, key.id); return msg?.message || ""; },
                msgRetryCounterCache, defaultQueryTimeoutMs: 60000, connectTimeoutMs: 60000, keepAliveIntervalMs: 10000,
            });

            QasimDev.store = store;
            const originalSendPresenceUpdate = QasimDev.sendPresenceUpdate;
            const originalReadMessages = QasimDev.readMessages;
            const originalSendReceipt = QasimDev.sendReceipt;

            QasimDev.sendPresenceUpdate = async function (...args) { const ghostMode = await store.getSetting('global', 'stealthMode'); if (ghostMode && ghostMode.enabled) { printLog('info', '👻 Blocked presence update (stealth mode)'); return; } return originalSendPresenceUpdate.apply(this, args); };
            QasimDev.readMessages = async function (...args) { const ghostMode = await store.getSetting('global', 'stealthMode'); if (ghostMode && ghostMode.enabled) return; return originalReadMessages.apply(this, args); };
            if (originalSendReceipt) { QasimDev.sendReceipt = async function (...args) { const ghostMode = await store.getSetting('global', 'stealthMode'); if (ghostMode && ghostMode.enabled) return; return originalSendReceipt.apply(this, args); }; }

            const originalQuery = QasimDev.query;
            QasimDev.query = async function (node,...args) { const ghostMode = await store.getSetting('global', 'stealthMode'); if (ghostMode && ghostMode.enabled) { if (node && node.tag === 'receipt') return; if (node && node.attrs && (node.attrs.type === 'read' || node.attrs.type === 'read-self')) return; } return originalQuery.apply(this, [node,...args]); };

            QasimDev.isGhostMode = async () => { const ghostMode = await store.getSetting('global', 'stealthMode'); return ghostMode && ghostMode.enabled; };
            QasimDev.ev.on('creds.update', _saveCreds); store.bind(QasimDev.ev);

            QasimDev.ev.on('messages.upsert', async (chatUpdate) => {
                try {
                    const mek = chatUpdate.messages[0]; if (!mek.message) return;
                    mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage')? mek.message.ephemeralMessage.message : mek.message;
                    if (mek.key && mek.key.remoteJid === 'status@broadcast') { await handleStatus(QasimDev, chatUpdate); return; }
                    if (!QasimDev.public &&!mek.key.fromMe && chatUpdate.type === 'notify') { const isGroup = mek.key?.remoteJid?.endsWith('@g.us'); if (!isGroup) return; }
                    if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;
                    if (QasimDev?.msgRetryCounterCache) { QasimDev.msgRetryCounterCache.clear(); }
                    try { await handleMessages(QasimDev, chatUpdate); } catch (err) {
                        printLog('error', `Error in handleMessages: ${err.message}`);
                        if (mek.key && mek.key.remoteJid) {
                            await QasimDev.sendMessage(mek.key.remoteJid, {
                                text: '❌ An error occurred while processing your message.',
                                contextInfo: {
                                    forwardingScore: 1,
                                    isForwarded: true,
                                    forwardedNewsletterMessageInfo: {
                                        newsletterJid: '120363392988761810@newsletter',
                                        newsletterName: 'M RIZWAN',
                                        serverMessageId: -1
                                    }
                                }
                            }).catch(console.error);
                        }
                    }
                } catch (err) { printLog('error', `Error in messages.upsert: ${err.message}`); }
            });

            QasimDev.decodeJid = (jid) => { if (!jid) return jid; if (/:\d+@/gi.test(jid)) { const decode = jidDecode(jid) || {}; return decode.user && decode.server && `${decode.user }@${ decode.server}` || jid; } else return jid; };
            QasimDev.ev.on('contacts.update', (update) => { for (const contact of update) { const id = QasimDev.decodeJid(contact.id); if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }; } });
            QasimDev.getName = (jid, withoutContact = false) => { const id = QasimDev.decodeJid(jid); withoutContact = QasimDev.withoutContact || withoutContact; let v; if (id.endsWith("@g.us")) return new Promise(async (resolve) => { v = store.contacts[id] || {}; if (!(v.name || v.subject)) v = QasimDev.groupMetadata(id) || {}; resolve(v.name || v.subject || PhoneNumber(`+${ id.replace('@s.whatsapp.net', '')}`).number?.international); }); else v = id === '0@s.whatsapp.net'? { id, name: 'WhatsApp' } : id === QasimDev.decodeJid(QasimDev.user.id)? QasimDev.user : (store.contacts[id] || {}); return (withoutContact? '' : v.name) || v.subject || v.verifiedName || PhoneNumber(`+${ jid.replace('@s.whatsapp.net', '')}`).number?.international; };

            QasimDev.public = true; QasimDev.serializeM = (m) => smsg(QasimDev, m, store);
            const isRegistered = state.creds?.registered === true;

            if (pairingCode &&!isRegistered) {
                if (useMobile) throw new Error('Cannot use pairing code with mobile api');
                let phoneNumberInput = phoneNumber; phoneNumberInput = phoneNumberInput.replace(/[^0-9]/g, '');
                const pn = PhoneNumber(`+${ phoneNumberInput}`); if (!pn.valid) { printLog('error', 'Invalid phone number format'); if (rl &&!rlClosed) rl.close(); process.exit(1); }

                const doPairing = async (num, attempt = 1) => {
                    try {
                        let code = await QasimDev.requestPairingCode(num);
                        code = code?.match(/.{1,4}/g)?.join("-") || code;
                        console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)));
                        printLog('success', `Pairing code generated: ${code}`);
                        if (rl &&!rlClosed) { rl.close(); rl = null; }
                    } catch (error) {
                        if (attempt < 3) {
                            try { rmSync(`./session/${num}`, { recursive: true, force: true }); } catch (_e) { }
                            await delay(3000); startQasimDev();
                        } else {
                            printLog('error', 'All 3 pairing attempts failed. Please restart manually.');
                        }
                    }
                };
                setTimeout(() => doPairing(phoneNumberInput), 3000);

            } else if (isRegistered) {
                if (rl &&!rlClosed) { rl.close(); rl = null; }
            } else {
                printLog('warning', 'Waiting for connection to establish...');
                if (rl &&!rlClosed) { rl.close(); rl = null; }
            }

            QasimDev.ev.on('connection.update', async (s) => {
                const { connection, lastDisconnect, qr } = s;
                if (qr) {
                    if (!pairingCode) {
                        try { console.log(await QRCode.toString(qr, { type: 'terminal', small: true })); } catch (_e) { console.log('QR:', qr); }
                    }
                }
                if (connection === "open") {
                    printLog('success', 'Bot connected successfully!');
                    try { const setbioModule = await import('./plugins/setbio.js'); const startAutoBio = setbioModule.startAutoBio || setbioModule.default?.startAutoBio; if (typeof startAutoBio === 'function') startAutoBio(QasimDev); } catch (e) { printLog('error', `Failed to start auto bio: ${e.message}`); }
                    const ghostMode = await store.getSetting('global', 'stealthMode'); if (ghostMode && ghostMode.enabled) { printLog('info', '👻 STEALTH MODE ACTIVE'); }
                    printLog('success', `Connected to => ${ JSON.stringify(QasimDev.user, null, 2)}`);

                    // YEH WALA FIX KIYA HAI
                    try {
                        const botNumber = `${QasimDev.user.id.split(':')[0] }@s.whatsapp.net`;
                        const ghostStatus = (ghostMode && ghostMode.enabled)? '\n👻 Stealth Mode: ACTIVE' : '';

                        const connMsg = `🤖 Bot Connected Successfully!

⏰ Time: ${new Date().toLocaleString()}
✅ Status: Online and Ready!${ghostStatus}

✅ Make sure to join below channel`;

                        await QasimDev.sendMessage(botNumber, {
                            text: connMsg,
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363392988761810@newsletter',
                                    newsletterName: 'M RIZWAN',
                                    serverMessageId: -1
                                }
                            }
                        });
                    } catch (error) {
                        printLog('error', `Failed to send connection message: ${error.message}`);
                    }

                    await delay(1999); try { owner = JSON.parse(fs.readFileSync('./data/owner.json', 'utf-8')); } catch (_e) { }
                    printLog('info', `[ ${config.botName || 'M-RIZWAN-MD'} ]`); printLog('info', `WA NUMBER : ${owner[0] || config.ownerNumber || ''}`); printLog('success', `Bot Connected Successfully!`); printLog('info', `Plugins : ${commandHandler.commands.size}`); printLog('info', `Prefixes : ${config.prefixes.join(', ')}`); printLog('store', `Backend : ${store.getStats().backend}`); console.log();
                }
                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode; const shouldReconnect = statusCode!== DisconnectReason.loggedOut && statusCode!== 401;
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) { try { rmSync(`./session/${phoneNumber}`, { recursive: true, force: true }); } catch (_e) { } await delay(3000); startQasimDev(); return; }
                    if (shouldReconnect) { printLog('connection', 'Reconnecting in 5 seconds...'); await delay(5000); startQasimDev(); }
                }
            });

            QasimDev.ev.on('call', async (calls) => { await handleCall(QasimDev, calls); });
            QasimDev.ev.on('group-participants.update', async (update) => { await handleGroupParticipantUpdate(QasimDev, update); });
            QasimDev.ev.on('status.update', async (status) => { await handleStatus(QasimDev, status); });
            QasimDev.ev.on('messages.reaction', async (reaction) => { await handleStatus(QasimDev, reaction); });

            return QasimDev;
        } catch (error) {
            printLog('error', `Error in startQasimDev: ${error.message}`);
            if (rl &&!rlClosed) {
                rl.close();
                rl = null;
            }
            await delay(5000);
            startQasimDev();
        }
    }

    await compileAll(); await commandHandler.loadCommands(); printLog('info', 'Starting M RIZWAN MD BOT...'); await initializeSession(); await delay(3000);
    return await startQasimDev().catch((error) => {
        printLog('error', `Fatal error: ${error.message}`);
        if (rl &&!rlClosed) {
            rl.close();
        }
        process.exit(1);
    });
}

// ======= WEB + TELEGRAM + WHATSAPP 1 SATH =======
const app = express();
app.use(express.static('public'));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/active', (req, res) => {
    try {
        const folders = fs.existsSync('./session')? fs.readdirSync('./session').length : 0;
        res.json({ count: folders });
    } catch {
        res.json({ count: 0 });
    }
});

app.post('/code', async (req, res) => {
    const number = req.body.number?.replace(/\D/g, '');
    if(!number || number.length < 10) return res.json({ error: "Valid number daalo" });
    try {
        const sock = await startBot({ number });
        await delay(2000);
        const code = await sock.requestPairingCode(number);
        res.json({ code });
        sock.ev.on('connection.update', (u) => {
            if(u.connection === 'open'){
                printLog('success', `✅ ${number} Web se connect ho gaya`);
            }
        });
    } catch(e){
        res.json({ error: e.message });
    }
});

server.on('request', app);
server.listen(PORT, async () => {
    printLog('success', `🌐 Web Panel Live: Port ${PORT}`);

    if(TG_TOKEN){
        const bot = new TelegramBot(TG_TOKEN, {polling: true});
        const runningBots = new Map();
        const OWNER_NAME = 'M RIZWAN';
        const CHANNEL_LINK = 'https://whatsapp.com/channel/0029Vb4Jh4wHgZWirfaYva0H';
        const BOT_DP = 'https://files.catbox.moe/ai8ndm.jpeg';
        const OWNER_ID = 7395977969;
        const OWNER_WHATSAPP = '923436259742';

        bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const isOwner = msg.from.id === OWNER_ID;
            const menu = `🤖 *M-RIZWAN-MD BOT* 🤖\n\n👑 *Owner:* ${OWNER_NAME}\n📢 *Channel:* ${CHANNEL_LINK}\n💬 *Contact:* /contact\n*Commands:*\n/pair 92300xxxxxxx → WhatsApp connect karo\n/delpair 92300xxxxxxx → Session delete karo\n/contact → Owner se direct baat karo\n/help → Saare commands dekho\n${isOwner? '/bots → Connected bots dekho\n/status number → Bot status\n/restart number → Bot restart' : ''}\n\n_Developer: ${OWNER_NAME}_`;
            try {
                await bot.sendPhoto(chatId, BOT_DP, { caption: menu, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📢 Join Channel', url: CHANNEL_LINK }],[{ text: '💬 Contact Owner', url: `https://wa.me/${OWNER_WHATSAPP}` }]] } });
            } catch {
                await bot.sendMessage(chatId, menu, { parse_mode: 'Markdown' });
            }
        });

        bot.onText(/\/help/, async (msg) => {
            const isOwner = msg.from.id === OWNER_ID;
            const help = `*Available Commands:*\n/pair number → WhatsApp connect\n/delpair number → Session delete\n/contact → Owner se direct WhatsApp chat\n/help → Ye menu\n${isOwner? '/bots → Connected bots list\n/status number → Bot ka status\n/restart number → Bot restart' : ''}\n\n_Only owner can use admin commands_`;
            bot.sendMessage(msg.chat.id, help, {parse_mode: 'Markdown'});
        });

        bot.onText(/\/contact/, async (msg) => {
            bot.sendMessage(msg.chat.id, `💬 Owner se direct baat karne ke liye click karo:`, { reply_markup: { inline_keyboard: [[{ text: '📱 WhatsApp pe Message karo', url: `https://wa.me/${OWNER_WHATSAPP}?text=Salam%20M%20RIZWAN%20Bot%20se%20aa%20raha%20hu` }]] } });
        });

        bot.onText(/\/pair (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const number = match[1].replace(/[^0-9]/g, '');
            if(!number || number.length < 10) return bot.sendMessage(chatId, '❌ Format: `/pair 923436259742`', {parse_mode: 'Markdown'});
            if(runningBots.has(number)) return bot.sendMessage(chatId, `✅ ${number} already connected hai.`);
            bot.sendMessage(chatId, `⏳ ${number} ke liye code bana raha hu...`);
            try {
                const sock = await startBot({ number });
                runningBots.set(number, sock);
                if (!sock.authState.creds.registered) {
                    await delay(1500);
                    const code = await sock.requestPairingCode(number);
                    bot.sendMessage(chatId, `✅ *Code:* \`${code}\`\n\nWhatsApp > 3 dots > Linked Devices > Link with phone number`, {parse_mode: 'Markdown'});
                }
                sock.ev.on('connection.update', (u) => {
                    if(u.connection === 'open'){
                        bot.sendMessage(chatId, `✅ ${number} Connect ho gaya!\nAb.menu likho.`);
                    }
                });
            } catch(e){
                bot.sendMessage(chatId, `❌ Error: ${e.message}`);
            }
        });

        bot.onText(/\/delpair (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const number = match[1].replace(/[^0-9]/g, '');
            if(!number || number.length < 10) return bot.sendMessage(chatId, '❌ Format: `/delpair 923436259742`', {parse_mode: 'Markdown'});
            try {
                const sessionPath = `./session/${number}`;
                if (existsSync(sessionPath)) {
                    rmSync(sessionPath, { recursive: true, force: true });
                    runningBots.delete(number);
                    bot.sendMessage(chatId, `🗑️ ${number} ka session delete ho gaya.\nAb dobara /pair kar sakte ho.`);
                } else {
                    bot.sendMessage(chatId, `⚠️ ${number} ka koi session mila hi nahi.`);
                }
            } catch(e) {
                bot.sendMessage(chatId, `❌ Error: ${e.message}`);
            }
        });

        bot.onText(/\/bots/, async (msg) => {
            const chatId = msg.chat.id;
            if(msg.from.id!== OWNER_ID) { return bot.sendMessage(chatId, '❌ Ye command sirf owner ke liye hai.'); }
            if(runningBots.size === 0) { return bot.sendMessage(chatId, '📊 Abhi koi bot connected nahi hai.'); }
            let text = `📊 *Connected Bots:* ${runningBots.size}\n\n`;
            for(const [num, sock] of runningBots) {
                const status = sock.user? '✅ Online' : '⏳ Connecting';
                const name = sock.user?.name || 'Unknown';
                text += `• ${num} → ${status}\n Name: ${name}\n\n`;
            }
            bot.sendMessage(chatId, text, {parse_mode: 'Markdown'});
        });

        bot.onText(/\/status (.+)/, async (msg, match) => {
            if(msg.from.id!== OWNER_ID) return bot.sendMessage(msg.chat.id, '❌ Ye command sirf owner ke liye hai.');
            const number = match[1].replace(/[^0-9]/g, '');
            const sock = runningBots.get(number);
            if(!sock) return bot.sendMessage(msg.chat.id, '❌ Bot active nahi hai.');
            const status = sock.user? `✅ Online\nName: ${sock.user.name}\nID: ${sock.user.id}` : '⏳ Connecting';
            bot.sendMessage(msg.chat.id, `📱 *${number}*\n${status}`, {parse_mode: 'Markdown'});
        });

        bot.onText(/\/restart (.+)/, async (msg, match) => {
            if(msg.from.id!== OWNER_ID) return bot.sendMessage(msg.chat.id, '❌ Ye command sirf owner ke liye hai.');
            const number = match[1].replace(/[^0-9]/g, '');
            const sock = runningBots.get(number);
            if(!sock) return bot.sendMessage(msg.chat.id, '⚠️ Bot active nahi hai.');
            try {
                sock.ws.close();
                runningBots.delete(number);
                bot.sendMessage(msg.chat.id, `🔄 ${number} restart command bhej di.\nDobara /pair ${number} karo.`);
            } catch(e) {
                bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
            }
        });

        printLog('success', '✅ Telegram Bot Connected. /start likho menu ke liye');
    } else {
        startBot({}).catch((error) => { printLog('error', `Fatal error: ${error.message}`); process.exit(1); });
    }
});
// ======= KHATAM =======

// Baqi cleanup code same
const sessionDir = path.join(process.cwd(), 'session');
setInterval(() => {
    if (!fs.existsSync(sessionDir)) return;
    fs.readdir(sessionDir, (err, files) => {
        if (err) return;
        for (const file of files) {
            if (file === 'creds.json') continue;
            if (file.startsWith('app-state-sync-key-')) continue;
            fs.unlink(path.join(sessionDir, file), () => { });
        }
    });
}, 3 * 60 * 1000);

const customTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(customTemp)) fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

setInterval(() => {
    fs.readdir(customTemp, (err, files) => {
        if (err) return;
        for (const file of files) {
            const filePath = path.join(customTemp, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && Date.now() - stats.mtimeMs > 3 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => { });
                }
            });
        }
    });
}, 1 * 60 * 60 * 1000);

const folders = [
    path.join(__dirname, './lib'),
    path.join(__dirname, './plugins')
];

folders.forEach(folder => {
    if (!fs.existsSync(folder)) return;
    fs.readdirSync(folder)
   .filter(file => file.endsWith('.js'))
   .forEach(file => {
        const filePath = path.join(folder, file);
        try {
            const code = fs.readFileSync(filePath, 'utf-8');
            const err = syntaxerror(code, file, {
                sourceType: 'module',
                allowAwaitOutsideFunction: true
            });
            if (err) {
                console.error(chalk.red(`❌ Syntax error in ${filePath}:\n${err}`));
            }
        } catch (e) {
            console.error(chalk.yellow(`⚠️ Cannot read file ${filePath}:\n${e}`));
        }
    });
});

process.on('uncaughtException', (err) => {
    printLog('error', `Uncaught Exception: ${err.message}`);
    console.error(err.stack);
    writeErrorLog({
        type: 'uncaughtException',
        error: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString()
    });
});

process.on('unhandledRejection', (err) => {
    printLog('error', `Unhandled Rejection: ${err.message}`);
    console.error(err.stack);
    writeErrorLog({
        type: 'unhandledRejection',
        error: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString()
    });
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        printLog('error', `Address localhost:${PORT} in use`);
        writeErrorLog({
            type: 'serverError',
            error: `Address localhost:${PORT} in use`,
            timestamp: new Date().toISOString()
        });
        server.close();
    } else {
        printLog('error', `Server error: ${error.message}`);
        writeErrorLog({
            type: 'serverError',
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
    }
});