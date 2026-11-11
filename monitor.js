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

    // Запрашиваем обновления с небольшой защитой
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=1`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.ok && data.result && data.result.length > 0) {
            // Сразу сдвигаем offset по самому последнему обновлению, 
            // чтобы при любых повторных запусках эти сообщения больше никогда не читались
            const lastUpdateId = data.result[data.result.length - 1].update_id;
            fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset: lastUpdateId + 1 }, null, 2));

            for (const update of data.result) {
                if (update.message && update.message.text) {
                    const text = update.message.text.trim();
                    const chatId = update.message.chat.id;

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
        }
    } catch (err) {
        console.error("Error fetching Telegram updates:", err);
    }
}
