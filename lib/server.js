import express from 'express';
import { createServer } from 'http';
import config from '../config.js';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import fs from 'fs';

const packageInfo = {
    name: config.botName || 'M-RIZWAN-MD',
    version: config.version || '6.0.0',
    description: config.description || 'WhatsApp Bot',
    author: config.author || 'M RIZWAN'
};

const app = express();
const server = createServer(app);
const PORT = config.port || 3000;

app.use(express.json());

// ========== HOME + PAIRING PAGE ==========
app.get('/', (req, res) => {
    const uptimeSeconds = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const uptimeString = `${hours}h ${minutes}m ${seconds}s`;

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${packageInfo.name.toUpperCase()} Pairing</title>
        <style>
            :root { --primary: #25d366; --bg: #0f172a; --card-bg: rgba(30, 41, 59, 0.7); }
            body { margin: 0; padding: 20px; background: var(--bg); color: white; font-family: 'Inter', system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
            .container { background: var(--card-bg); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); padding: 30px; border-radius: 24px; width: 90%; max-width: 420px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
            .status-badge { display: inline-flex; align-items: center; background: rgba(37, 211, 102, 0.1); color: var(--primary); padding: 5px 15px; border-radius: 50px; font-size: 0.8rem; font-weight: bold; margin-bottom: 20px; }
            .dot { height: 8px; width: 8px; background: var(--primary); border-radius: 50%; margin-right: 8px; box-shadow: 0 0 10px var(--primary); }
            h1 { margin: 0; font-size: 1.8rem; letter-spacing: 1px; background:linear-gradient(90deg,#25d366,#00d9f5); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
            .desc { color: #94a3b8; margin: 10px 0 25px 0; font-size: 0.9rem; }
            input { width: 100%; padding: 14px; margin: 10px 0; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; background: rgba(0,0,0,0.2); color: white; outline: none; font-size: 16px; }
            button { width: 100%; padding: 14px; margin-top: 15px; border: none; border-radius: 12px; background: linear-gradient(90deg,#25d366,#00d9f5); color: #000; font-weight: bold; font-size: 16px; cursor: pointer; transition: 0.3s; }
            button:disabled{opacity:0.6;cursor:not-allowed}
            button:hover { transform: scale(1.02); }
            #result { margin-top: 20px; padding: 15px; border-radius: 12px; background: rgba(37, 211, 102, 0.1); display: none; }
            .code { font-size: 26px; font-weight: bold; letter-spacing: 4px; color: var(--primary); }
            .grid { display: grid; gap: 12px; margin: 20px 0; }
            .item { background: rgba(0,0,0,0.2); padding: 10px; border-radius: 10px; display: flex; justify-content: space-between; }
            .label { color: #64748b; font-size: 0.75rem; text-transform: uppercase; font-weight: 800; }
            .val { font-weight: 600; font-family: monospace; color: #f1f5f9; }
            .footer { margin-top: 25px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1) }
            .footer a { display: block; margin: 8px 0; color: #25d366; text-decoration: none; font-size: 14px }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="status-badge"><span class="dot"></span> SYSTEM ONLINE</div>
            <h1>${packageInfo.name.toUpperCase()}</h1>
            <p class="desc">Enter WhatsApp number to get pairing code</p>
            
            <input type="number" id="number" placeholder="9234xxxxxxxxx">
            <button id="btn" onclick="getPair()">Get Pairing Code</button>
            
            <div id="result">
                <p>Your Pairing Code:</p>
                <p class="code" id="code"></p>
                <p style="font-size:12px;color:#94a3b8">WhatsApp > 3 Dots > Linked Devices > Link with Code</p>
            </div>

            <div class="grid">
                <div class="item"><span class="label">Version</span><span class="val">${packageInfo.version}</span></div>
                <div class="item"><span class="label">Author</span><span class="val">${packageInfo.author}</span></div>
                <div class="item"><span class="label">Uptime</span><span class="val">${uptimeString}</span></div>
            </div>

            <div class="footer">
                <a href="https://wa.me/923436259742" target="_blank">📞 Owner Contact</a>
                <a href="https://whatsapp.com/channel/0029Vb4Jh4wHgZWirfaYva0H" target="_blank">📢 Join Channel</a>
            </div>
            <footer style="margin-top:15px;font-size:0.7rem;color:#475569">POWERED BY M RIZWAN</footer>
        </div>

        <script>
        async function getPair(){
            const btn = document.getElementById('btn');
            const number = document.getElementById('number').value;
            if(!number) return alert('Please enter number');
            btn.innerText = 'Generating...';
            btn.disabled = true;
            const res = await fetch('/pair',{method:'POST',headers:{'Content-Type':'application/json'}, body:JSON.stringify({number})});
            const data = await res.json();
            btn.innerText = 'Get Pairing Code';
            btn.disabled = false;
            if(data.code){
                document.getElementById('result').style.display='block';
                document.getElementById('code').innerText=data.code;
            } else {
                alert(data.error || 'Error');
            }
        }
        </script>
    </body>
    </html>
    `);
});

// ========== REAL PAIRING API FIXED 100% ==========
app.post('/pair', async (req, res) => {
    const { number } = req.body;
    if(!number) return res.status(400).json({ error: 'Number required' });

    const sessionPath = `./sessions/session_${number}`;

    // purana session delete
    if(fs.existsSync(sessionPath)){
        fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRCodeMessage: false,
            browser: ['M-RIZWAN-MD', 'Chrome', '1.0.0']
        });

        let sent = false; // 2 baar response na jaye is liye

        const sendResponse = (data) => {
            if(!sent){
                sent = true;
                res.json(data); // <-- YAHI web pe bhejega
            }
        }

        setTimeout(async () => {
            try{
                if(!sock.authState.creds.registered){
                    const code = await sock.requestPairingCode(number);
                    const formattedCode = code?.match(/.{1,4}/g)?.join("-");
                    // console.log hata diya. direct web pe bhejo
                    sendResponse({ code: formattedCode }); 
                    setTimeout(() => sock.ws.close(), 1000);
                }else{
                    sendResponse({ error: 'Already connected' });
                }
            }catch(e){
                sendResponse({ error: 'Code generate failed. 10 sec baad try karo' });
            }
        }, 3000);

        sock.ev.on('creds.update', saveCreds);

    } catch (error) {
        if(!sent) res.status(500).json({ error: error.message });
    }
});

// ========== HEALTH CHECK ==========
app.get('/health', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        memory: {
            rss: `${Math.round(mem.rss / 1024 / 1024) }MB`,
            heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024) }MB`,
            heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024) }MB`
        },
        version: packageInfo.version,
        bot: packageInfo.name,
        timestamp: new Date().toISOString()
    });
});

export { app, server, PORT };
