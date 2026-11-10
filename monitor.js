const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
// Укажите ваш tailnet (обычно это имя домена из панели Tailscale или ваш логин/email до @)
// Если у вас личный аккаунт, попробуйте указать вашу часть почты до @: "mototommy" 
// Либо используйте специальный псевдоним "-" если поддерживается, но для tailnet лучше указывать имя точно из панели.
const TAILNET = "mototommy"; 
const API_KEY = process.env.TAILSCALE_API_KEY;

const STATE_FILE = path.join(__dirname, 'state.json');

async function sendTelegramMessage(text) {
    if (!BOT_TOKEN || !CHAT_ID) {
        console.log("Telegram credentials missing, skipping message:", text);
        return;
    }
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text: text, parse_mode: 'Markdown' })
        });
        if (!response.ok) {
            console.error("Failed to send Telegram message:", await response.text());
        }
    } catch (err) {
        console.error("Error sending Telegram message:", err);
    }
}

async function checkDevices() {
    if (!API_KEY) {
        console.error("TAILSCALE_API_KEY is missing!");
        process.exit(1);
    }

    const credentials = Buffer.from(`${API_KEY}:`).toString('base64');
    const url = `https://api.tailscale.com/api/v2/tailnet/${TAILNET}/devices`;

    let response;
    try {
        response = await fetch(url, {
            headers: { 'Authorization': `Basic ${credentials}` }
        });
    } catch (err) {
        console.error("Network error fetching Tailscale devices:", err);
        process.exit(1);
    }

    if (!response.ok) {
        const errText = await response.text();
        console.error(`Tailscale API error: ${response.status} ${response.statusText} - ${errText}`);
        process.exit(1);
    }

    const data = await response.json();
    const devices = data.devices || [];

    let currentState = {};
    if (fs.existsSync(STATE_FILE)) {
        try {
            currentState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (e) {
            currentState = {};
        }
    }

    let previousState = {};
    if (fs.existsSync(STATE_FILE)) {
        try {
            previousState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (e) {
            previousState = {};
        }
    }

    const now = new Date();

    for (const device of devices) {
        const hostname = device.hostname || device.name;
        
        // Корректная проверка онлайн-статуса: 
        // Устройство считается онлайн, если поле online равно true ИЛИ lastSeen было менее чем 7 минут назад.
        let isOnline = false;
        if (device.online === true) {
            isOnline = true;
        } else if (device.lastSeen) {
            const lastSeenDate = new Date(device.lastSeen);
            const diffMinutes = (now - lastSeenDate) / 1000 / 60;
            // Если устройство выходило на связь за последние 7 минут (при интервале крона в 5 минут)
            if (diffMinutes <= 7) {
                isOnline = true;
            }
        }
        
        const prevStatus = previousState[hostname];
        console.log(`[Check] ${hostname} | prev: ${prevStatus} | curr: ${isOnline} (lastSeen: ${device.lastSeen})`);

        currentState[hostname] = isOnline;

        // Если состояние изменилось (и это не самый первый запуск, когда prevStatus еще undefined)
        if (prevStatus !== undefined && prevStatus !== isOnline) {
            const emoji = isOnline ? "🟢" : "🔴";
            const statusText = isOnline ? "подключилось к сети" : "отключилось от сети";
            await sendTelegramMessage(`${emoji} Устройство *${hostname}* ${statusText}.`);
        }
    }

    fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2));
}

checkDevices();
