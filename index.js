require('dotenv').config();
const axios = require('axios');
const express = require('express');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// Configuración
const URL_CRIPTO_USD = "https://criptoya.com/api/USDT/USD/500";
const URL_CRIPTO_ARS = "https://criptoya.com/api/USDT/ARS/500";
const IGNORED = ["kucoinp2p", "banexcoin", "xapo", "x4t"];
const POLL_INTERVAL = 60 * 1000; // 60 segundos
const THRESHOLD = 1.020;
const THRESHOLD_ARS_DIFF = 0.005; // 0.5%

// --- Funciones auxiliares ---
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

// --- Consulta USDT/USD ---
async function getLowestTotalAsk() {
    try {
        const res = await axios.get(URL_CRIPTO_USD);
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
        console.log("Error consultando CriptoYa USD:", err);
        return { bestPrice: null, bestExchange: null };
    }
}

// --- Consulta USDT/ARS ---
async function checkArsBidAnomaly() {
    try {
        const res = await axios.get(URL_CRIPTO_ARS);
        const entries = Object.entries(res.data).filter(([ex]) => !IGNORED.includes(ex));

        // Extraer precios válidos
        const bids = entries
            .map(([exchange, val]) => ({ exchange, price: val.totalBid }))
            .filter(e => e.price && e.price > 0);

        if (bids.length < 2) return;

        // Encontrar el máximo
        const sorted = bids.sort((a, b) => b.price - a.price);
        const best = sorted[0];
        const others = sorted.slice(1);

        // Promedio del resto
        const avgOthers = others.reduce((acc, e) => acc + e.price, 0) / others.length;

        const diffRatio = (best.price - avgOthers) / avgOthers;

        console.log(`[${new Date().toLocaleTimeString()}] Mejor bid ARS: ${best.exchange} = ${best.price.toFixed(2)} | Promedio resto = ${avgOthers.toFixed(2)} | Diff = ${(diffRatio * 100).toFixed(3)}%`);

        if (diffRatio >= THRESHOLD_ARS_DIFF) {
            await sendTelegramMessage(
                `📈 <b>Alerta USDT/ARS:</b>\n` +
                `💵 <b>${best.exchange}</b> tiene un totalBid anómalo de <b>${best.price.toFixed(2)} ARS</b>\n` +
                `🧮 Promedio resto: ${avgOthers.toFixed(2)} ARS\n` +
                `📊 Diferencia: ${(diffRatio * 100).toFixed(2)}%`
            );
        }

    } catch (err) {
        console.log("Error consultando CriptoYa ARS:", err);
    }
}

// --- Monitoreo USDT/USD ---
let lastPrice = null;
let lastExchange = null;

async function monitorLoop() {
    const { bestPrice, bestExchange } = await getLowestTotalAsk();
    if (!bestPrice) return;

    console.log(`[${new Date().toLocaleTimeString()}] Mejor cotización USD: ${bestExchange} totalAsk = ${bestPrice}`);

    // Enviar alerta solo si está por debajo o igual al umbral
    if (bestPrice > THRESHOLD) {
        console.log(`[${new Date().toLocaleTimeString()}] Precio ${bestPrice} > umbral ${THRESHOLD} — no se enviará mensaje`);
        lastPrice = bestPrice;
        lastExchange = bestExchange;
        return;
    }

    if (bestPrice <= THRESHOLD) {
        await sendTelegramMessage(
            `⚡ <b>ALERTA:</b> El USDT bajó de ${THRESHOLD}\n` +
            `💰 Mejor cotización: <b>${bestExchange}</b> a <b>${bestPrice.toFixed(4)}</b> USD`
        );
    } else if (bestPrice !== lastPrice || bestExchange !== lastExchange) {
        await sendTelegramMessage(
            `💰 La mejor cotización del USDT es de <b>${bestExchange}</b> a <b>${bestPrice.toFixed(4)}</b> USD`
        );
    }

    lastPrice = bestPrice;
    lastExchange = bestExchange;
}

// --- Loop principal ---
setInterval(async () => {
    await monitorLoop();
    await checkArsBidAnomaly();
}, POLL_INTERVAL);

// Express keep-alive
app.get('/', (req, res) => res.send("✅ CriptoYA Alert Bot corriendo"));
app.listen(3000, () => console.log("Servidor Express escuchando en puerto 3000"));
