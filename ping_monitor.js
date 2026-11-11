const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const STATE_FILE = 'ping_state.json';
const OFFLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 минут

// Базовый список объектов (базовая подсеть для каждого)
const sites = [
  { name: 'АЗС ЄВРО5 — Алюминиевая', baseIp: '10.1.1' },
  { name: 'АЗС ЄВРО5 — Вознесенка', baseIp: '10.2.1' },
  { name: 'АЗС ЄВРО5 — Истомина', baseIp: '10.3.1' },
  { name: 'АЗС ЄВРО5 — Метро', baseIp: '10.7.1' },
  { name: 'АЗС ЄВРО5 — Михайловка', baseIp: '10.8.1' },
  { name: 'АЗС ЄВРО5 — Дизелист', baseIp: '10.9.1' },
  { name: 'АЗС ЄВРО5 — Победа', baseIp: '10.10.1' },
  { name: 'АЗС ЄВРО5 — Каширка', baseIp: '10.13.1' },
  { name: 'АЗС ЄВРО5 — Космическая', baseIp: '10.14.1' },
  { name: 'АЗС ЄВРО5 — Украинская', baseIp: '10.15.1' },
  { name: 'АЗС ЄВРО5 — Рекордная', baseIp: '10.16.1' },
  { name: 'АЗС ЄВРО5 — Каховская', baseIp: '10.17.1' },
  { name: 'АЗС ЄВРО5 — Зачиняева', baseIp: '10.18.1' }
];

// Автоматически формируем список всех касс (200 и 201) для каждого объекта
const devices = [];
sites.forEach((site, siteIndex) => {
  [200, 201].forEach((hostSuffix, hostIndex) => {
    devices.push({
      id: `site_${siteIndex}_pos_${hostSuffix}`,
      objectName: site.name,
      name: `Касса ${hostIndex + 1}`,
      ip: `${site.baseIp}.${hostSuffix}`
    });
  });
});

function sendTelegram(text) {
  return new Promise((resolve) => {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return resolve();

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'Markdown' });

    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve());
    });

    req.on('error', () => resolve());
    req.write(data);
    req.end();
  });
}

function checkPing(ip) {
  return new Promise((resolve) => {
    exec(`ping -c 1 -W 2 ${ip}`, (error) => {
      resolve(!error);
    });
  });
}

async function main() {
  const isReportRequested = process.argv.includes('--report');

  // Если это запрос отчета, мы просто опрашиваем устройства и шлем итоговую сводку,
  // не трогая файл состояния и не отправляя аварийные уведомления.
  if (isReportRequested) {
    let reportLines = ["📊 *Текущий статус всех касс:*"];
    
    // Делаем параллельный или последовательный опрос для отчета
    for (const dev of devices) {
      const isOnline = await checkPing(dev.ip);
      const icon = isOnline ? "🟢" : "🔴";
      reportLines.push(`${icon} *${dev.objectName}* (${dev.name}): ${isOnline ? 'В сети' : 'Не в сети'}`);
    }

    await sendTelegram(reportLines.join('\n'));
    return;
  }

  // --- Штатный фоновый режим (каждые 10 минут) ---
  let state = {};
  if (fs.existsSync(STATE_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      state = {};
    }
  }

  const now = Date.now();

  for (const dev of devices) {
    const isOnline = await checkPing(dev.ip);
    let devState = state[dev.id] || { isOnline: true, downSince: null, notifiedOffline: false };

    if (!isOnline) {
      if (devState.isOnline) {
        devState.isOnline = false;
        devState.downSince = now;
        devState.notifiedOffline = false;
      } else {
        const offlineDuration = now - devState.downSince;
        if (!devState.notifiedOffline && offlineDuration >= OFFLINE_THRESHOLD_MS) {
          await sendTelegram(`⚠️ Объект: ${dev.objectName}\nОбнаружена потеря связи с устройством "${dev.name}" (${dev.ip}) на протяжении 10 минут.`);
          devState.notifiedOffline = true;
        }
      }
    } else {
      if (!devState.isOnline) {
        if (devState.notifiedOffline) {
          await sendTelegram(`✅ Объект: ${dev.objectName}\nСвязь с устройством "${dev.name}" (${dev.ip}) возобновлена.`);
        }
      }
      devState.isOnline = true;
      devState.downSince = null;
      devState.notifiedOffline = false;
    }

    state[dev.id] = devState;
  }

  // Сохраняем состояние только в фоновом режиме
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

main().catch(console.error);
