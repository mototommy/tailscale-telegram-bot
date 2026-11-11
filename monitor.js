const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TAILNET = "-"; 
const API_KEY = process.env.TAILSCALE_API_KEY;

const STATE_FILE = path.join(__dirname, 'state.json');
const OFFSET_FILE = path.join(__dirname, 'offset.json');

async function sendTelegramMessage(text, customChatId = CHAT_ID) {
    if (!BOT_TOKEN || !customChatId) return;
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: customChatId, text: text, parse_mode: 'Markdown' })
        });
    } catch (err) {
        console.error("Error sending Telegram message:", err);
    }
}

async function main() {
    if (!API_KEY) {
        console.error("TAILSCALE_API_KEY is missing!");
        return;
    }

    const credentials = Buffer.from(`${API_KEY}:`).toString('base64');
    const url = `https://api.tailscale.com/api/v2/tailnet/${TAILNET}/devices`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Basic ${credentials}` }
    });

    if (!response.ok) {
        console.error(`Tailscale API error: ${response.status}`);
        return;
    }

    const data = await response.json();
    const devices = data.devices || [];

    let previousState = {};
    if (fs.existsSync(STATE_FILE)) {
        try {
            previousState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (e) { previousState = {}; }
    }

    let currentState = {};
    let devicesStatusList = [];
    const now = new Date();

    for (const device of devices) {
        const deviceId = device.id;
        let rawName = device.name || device.displayName || device.hostname || deviceId;
        if (rawName.includes('.')) rawName = rawName.split('.')[0];
        const hostname = rawName;
        
        // Корректная проверка онлайн-статуса (с учетом 7 минут lastSeen)
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
        
        currentState[deviceId] = { hostname, online: isOnline };
        devicesStatusList.push({ name: hostname, online: isOnline });

        const prevDeviceState = previousState[deviceId];
        const prevStatus = prevDeviceState ? prevDeviceState.online : undefined;

        // Отправка уведомления об изменении статуса
        if (prevStatus !== undefined && prevStatus !== isOnline) {
            const emoji = isOnline ? "🟢" : "🔴";
            const statusText = isOnline ? "подключилось к сети" : "отключилось от сети";
            await sendTelegramMessage(`${emoji} Устройство *${hostname}* ${statusText}.`);
        }
    }

    fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2));

    // Обработка входящих команд /status
    if (BOT_TOKEN) {
        let offset = 0;
        if (fs.existsSync(OFFSET_FILE)) {
            try {
                offset = JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf8')).offset || 0;
            } catch (e) { offset = 0; }
        }

        const tgUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=1`;
        const tgRes = await fetch(tgUrl);
        const tgData = await tgRes.json();

        if (tgData.ok && tgData.result && tgData.result.length > 0) {
            const lastUpdateId = tgData.result[tgData.result.length - 1].update_id;
            fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset: lastUpdateId + 1 }, null, 2));

            for (const update of tgData.result) {
                if (update.message && update.message.text) {
                    const text = update.message.text.trim();
                    const chatId = update.message.chat.id;

                    if (text.startsWith('/status') || text.startsWith('/devices')) {
                        let report = "📊 *Текущий статус устройств Tailscale:*\n\n";
                        for (const dev of devicesStatusList) {
                            report += `${dev.online ? "🟢" : "🔴"} *${dev.name}*\n`;
                        }
                        await sendTelegramMessage(report, chatId);
                    }
                }
            }
        }
    }
    console.log("Monitor check completed successfully.");
}

main().catch(err => console.error("Error:", err));
