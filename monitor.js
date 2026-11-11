const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TAILNET = "-"; 
const API_KEY = process.env.TAILSCALE_API_KEY;

const STATE_FILE = path.join(__dirname, 'state.json');
const OFFSET_FILE = path.join(__dirname, 'offset.json');

console.log("Script started successfully.");

async function main() {
    if (!API_KEY) {
        console.error("ERROR: TAILSCALE_API_KEY is missing!");
        return;
    }

    const credentials = Buffer.from(`${API_KEY}:`).toString('base64');
    const url = `https://api.tailscale.com/api/v2/tailnet/${TAILNET}/devices`;

    console.log("Fetching devices from Tailscale...");
    const response = await fetch(url, {
        headers: { 'Authorization': `Basic ${credentials}` }
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`Tailscale API error: ${response.status} - ${errText}`);
        return;
    }

    const data = await response.json();
    console.log(`Fetched devices count: ${data.devices ? data.devices.length : 0}`);

    // Проверка входящих команд Telegram
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
                        let report = "📊 *Статус устройств Tailscale:*\n\n";
                        for (const dev of (data.devices || [])) {
                            let name = (dev.name || dev.displayName || dev.hostname || dev.id).split('.')[0];
                            report += `${dev.online ? "🟢" : "🔴"} *${name}*\n`;
                        }
                        
                        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: chatId, text: report, parse_mode: 'Markdown' })
                        });
                    }
                }
            }
        }
    }
    console.log("Script finished successfully.");
}

main().catch(err => console.error("Unhandled error:", err));
