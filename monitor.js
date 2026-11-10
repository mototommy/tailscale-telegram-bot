const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TAILNET = "mototommy36@gmail.com";
const API_KEY = process.env.TAILSCALE_API_KEY;

const STATE_FILE = path.join(__dirname, 'state.json');

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: text, parse_mode: "Markdown" })
  });
}

async function run() {
  let previousState = {};
  if (fs.existsSync(STATE_FILE)) {
    try {
      previousState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      previousState = {};
    }
  }

  const response = await fetch(`https://api.tailscale.com/api/v2/tailnet/${TAILNET}/devices`, {
    headers: { "Authorization": `Bearer ${API_KEY}` }
  });

  if (!response.ok) {
    console.error("Failed to fetch Tailscale API:", await response.text());
    return;
  }

  const data = await response.json();
  const devices = data.devices || [];
  const currentState = {};

  for (const device of devices) {
    const deviceId = device.id;
    const deviceName = (device.name || "").split(".")[0];
    
    const lastSeen = new Date(device.lastSeen);
    const now = new Date();
    const diffMinutes = (now - lastSeen) / (1000 * 60);
    const isOnline = device.clientConnected !== undefined ? device.clientConnected : (diffMinutes < 3);

    const currentStatusStr = isOnline ? "online" : "offline";
    currentState[deviceId] = currentStatusStr;

    const prevStatus = previousState[deviceId];
    console.log(`[Check] ${deviceName} | prev: ${prevStatus} | curr: ${currentStatusStr}`);

    if (prevStatus && prevStatus !== currentStatusStr) {
      console.log(`--> Sending Telegram alert for ${deviceName}: ${currentStatusStr}`);
      const statusText = isOnline ? "🟢 Устройство в сети (Online)" : "🔴 Устройство отключилось (Offline)";
      const text = `⚙️ *Tailscale Monitor*\nУстройство: *${deviceName}*\nСтатус: ${statusText}`;
      await sendTelegram(text);
    }
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2));
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
