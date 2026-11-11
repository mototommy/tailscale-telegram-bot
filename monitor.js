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
            // Сразу сдвигаем offset на самый последний update_id, 
            // чтобы закрыть всю пачку входящих сообщений разом
            const lastUpdate = tgData.result[tgData.result.length - 1];
            fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset: lastUpdate.update_id + 1 }, null, 2));

            // Ищем самое последнее сообщение с нужной командой, игнорируя дубли в текущей пачке
            let latestCommandChatId = null;
            for (const update of tgData.result) {
                if (update.message && update.message.text) {
                    const text = update.message.text.trim();
                    if (text.startsWith('/status') || text.startsWith('/devices')) {
                        latestCommandChatId = update.message.chat.id;
                    }
                }
            }

            // Отправляем ответ ровно один раз — на самое последнее обращение
            if (latestCommandChatId) {
                let report = "📊 *Текущий статус устройств Tailscale:*\n\n";
                for (const dev of devicesStatusList) {
                    report += `${dev.online ? "🟢" : "🔴"} *${dev.name}*\n`;
                }
                await sendTelegramMessage(report, latestCommandChatId);
            }
        }
    }
