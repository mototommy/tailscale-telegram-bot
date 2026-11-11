const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TAILNET = "-"; 
const API_KEY = process.env.TAILSCALE_API_KEY;

const STATE_FILE = path.join(__dirname, 'state.json');
const OFFSET_FILE = path.join(__dirname, 'offset.json'); // Для запоминания прочитанных сообщений Telegram

async function sendTelegramMessage(text, customChatId = CHAT_ID) {
    if (!BOT_TOKEN || !customChatId) {
        console.log("Telegram credentials missing, skipping message:", text);
        return;
    }
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: customChatId, text: text, parse_mode: 'Markdown' })
        });
        if (!response.ok) {
            console.error("Failed to send Telegram message:", await response.text());
        }
    } catch (err) {
        console.error("Error sending Telegram message:", err);
    }
}

// Проверка входящих команд от пользователя в Telegram
async function handleIncomingCommands(devicesStatusList) {
    if (!BOT_TOKEN) return;

    let offset = 0;
    if (fs.existsSync(OFFSET_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf8'));
            offset = data.offset || 0;
        } catch (e) {
            offset = 0;
        }
    }

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=1`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.ok && data.result && data.result.length > 0) {
            for (const update of data.result) {
                offset = update.update_id + 1;

                if (update.message && update.message.text) {
                    const text = update.message.text.trim();
                    const chatId = update.message.chat.id;

                    // Если пришла команда /status или /devices (можно писать с именем бота /status@your_bot)
                    if (text.startsWith('/status') || text.startsWith('/devices')) {
                        let report = "📊 *Текущий статус устройств Tailscale:*\n\n";
                        for (const dev of devicesStatusList) {
                            const emoji = dev.online ? "🟢" : "🔴";
                            report += `${emoji} *${dev.name}*\n`;
                        }
                        await sendTelegramMessage(report, chatId);
                    }
                }
            }
            fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset }, null, 2));
        }
    } catch (err) {
        console.error("Error fetching Telegram updates:", err);
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

    let previousState = {};
    if (fs.existsSync(STATE_FILE)) {
        try {
            previousState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (e) {
            previousState = {};
        }
    }

    let currentState = {};
    let devicesStatusList = [];
    const now = new Date();

    for (const device of devices) {
        const deviceId = device.id;
        
        let rawName = device.name || device.displayName || device.hostname || deviceId;
        if (rawName.includes('.')) {
            rawName = rawName.split('.')[0];
        }
        const hostname = rawName;
        
        let isOnline = false;
        if (device.online === true) {
            isOnline = true;
        } else if (device.lastSeen) {
            const lastSeenDate = new Date(device.lastSeen);
            const diffMinutes = (now - lastSeenDate) / 1000 / 60;
            if (diffMinutes <= 7) {
                isOnline = true;
            }
        }
        
        currentState[deviceId] = {
            hostname: hostname,
            online: isOnline
        };

        devicesStatusList.push({ name: hostname, online: isOnline });

        const prevDeviceState = previousState[deviceId];
        const prevStatus = prevDeviceState ? prevDeviceState.online : undefined;

        console.log(`[Check] ${hostname} (${deviceId}) | prev: ${prevStatus} | curr: ${isOnline}`);

        if (prevStatus !== undefined && prevStatus !== isOnline) {
            const emoji = isOnline ? "🟢" : "🔴";
            const statusText = isOnline ? "подключилось к сети" : "отключилось от сети";
            await sendTelegramMessage(`${emoji} Устройство *${hostname}* ${statusText}.`);
        }
    }

    fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2));

    // Проверяем, не запросил ли пользователь статус командой
    await handleIncomingCommands(devicesStatusList);
}

checkDevices();
