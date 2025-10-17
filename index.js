require('dotenv').config();
const axios = require('axios');
const express = require('express');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const URL_CRIPTO = "https://criptoya.com/api/USDT/USD/500";
const IGNORED = ["kucoinp2p", "banexcoin", "xapo", "x4t"];
const POLL_INTERVAL = 60 * 1000; // 60 segundos
const THRESHOLD = 1.020;

async function getLowestTotalAsk() {
    try {
        const res = await axios.get(URL_CRIPTO);
        let bestPrice = null;
        let bestExchange = null;

        for (const [exchange, val] of Object.entries(res.data)) {
            if (IGNORED.includes(exchange)) continue;
            const price = val.totalAsk;
            if (!price || price === 0) continue;
            if (bestPrice === null || price < bestPrice) {
                bestPrice = price;
                bestExchange = exchange;
            }
        }
        return { bestPrice, bestExchange };
    } catch (err) {
        console.log("Error consultando CriptoYa:", err);
        return { bestPrice: null, bestExchange: null };
    }
}

async function sendTelegramMessage(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text,
            parse_mode: "HTML"
        });
    } catch (err) {
        console.log("Error enviando Telegram:", err);
    }
}

let lastPrice = null;
let lastExchange = null;

async function monitorLoop() {
    const { bestPrice, bestExchange } = await getLowestTotalAsk();
    if (!bestPrice) return;

    console.log(`[${new Date().toLocaleTimeString()}] Mejor cotización: ${bestExchange} totalAsk = ${bestPrice}`);

    // No enviar nada si el precio es estrictamente mayor que el umbral (solo enviar si es igual o menor)
    if (bestPrice > THRESHOLD) {
        console.log(`[${new Date().toLocaleTimeString()}] Precio ${bestPrice} > umbral ${THRESHOLD} — no se enviará mensaje`);
        lastPrice = bestPrice;
        lastExchange = bestExchange;
        return;
    }

    if (bestPrice <= THRESHOLD) {
        await sendTelegramMessage(`⚡ <b>ALERTA:</b> El USDT bajó de ${THRESHOLD}\n💰 Mejor cotización: <b>${bestExchange}</b> a <b>${bestPrice.toFixed(4)}</b> USD`);
    } else if (bestPrice !== lastPrice || bestExchange !== lastExchange) {
        await sendTelegramMessage(`💰 La mejor cotización del USDT es de <b>${bestExchange}</b> a <b>${bestPrice.toFixed(4)}</b> USD`);
    }

    lastPrice = bestPrice;
    lastExchange = bestExchange;
}

// Loop cada minuto
setInterval(monitorLoop, POLL_INTERVAL);

// Express keep-alive
app.get('/', (req, res) => res.send("✅ CriptoYA Alert Bot corriendo"));
app.listen(3000, () => console.log("Servidor Express escuchando en puerto 3000"));
