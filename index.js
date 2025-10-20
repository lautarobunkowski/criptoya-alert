require('dotenv').config();
const axios = require('axios');
const express = require('express');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// Configuración general
const URL_CRIPTO_USD = "https://criptoya.com/api/USDT/USD/500";
const URL_CRIPTO_ARS = "https://criptoya.com/api/USDT/ARS/500";
const IGNORED = ["kucoinp2p", "banexcoin", "xapo", "x4t"];
const POLL_INTERVAL = 60 * 1000; // 60 segundos
const THRESHOLD_USD = 1.020;
const THRESHOLD_ARS_DIFF = 0.005; // 0.5%
const COOLDOWN_MINUTES = 30 * 60 * 1000; // 30 minutos

// --- Función de envío a Telegram ---
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
let lastArsExchange = null;
let lastArsPrice = null;
let lastArsAlertTime = 0;

async function checkArsBidAnomaly() {
    try {
        const res = await axios.get(URL_CRIPTO_ARS);
        const entries = Object.entries(res.data).filter(([ex]) => !IGNORED.includes(ex));

        const bids = entries
            .map(([exchange, val]) => ({ exchange, price: val.totalBid }))
            .filter(e => e.price && e.price > 0);

        if (bids.length < 2) return;

        const sorted = bids.sort((a, b) => b.price - a.price);
        const best = sorted[0];
        const others = sorted.slice(1);
        const avgOthers = others.reduce((acc, e) => acc + e.price, 0) / others.length;

        const diffRatio = (best.price - avgOthers) / avgOthers;
        const now = Date.now();
        const timeSinceLast = now - lastArsAlertTime;

        console.log(`[${new Date().toLocaleTimeString()}] Mejor bid ARS: ${best.exchange} = ${best.price.toFixed(2)} | Promedio resto = ${avgOthers.toFixed(2)} | Diff = ${(diffRatio * 100).toFixed(3)}%`);

        if (diffRatio >= THRESHOLD_ARS_DIFF) {
            const priceChanged = Math.abs(best.price - (lastArsPrice || 0)) > 0.01;

            if (
                best.exchange !== lastArsExchange ||
                priceChanged ||
                timeSinceLast >= COOLDOWN_MINUTES
            ) {
                await sendTelegramMessage(
                    `📈 <b>Alerta USDT/ARS:</b>\n` +
                    `💵 <b>${best.exchange}</b> tiene un totalBid anómalo de <b>${best.price.toFixed(2)} ARS</b>\n` +
                    `🧮 Promedio resto: ${avgOthers.toFixed(2)} ARS\n` +
                    `📊 Diferencia: ${(diffRatio * 100).toFixed(2)}%`
                );
                lastArsExchange = best.exchange;
                lastArsPrice = best.price;
                lastArsAlertTime = now;
            }
        } else {
            // Si ya no hay diferencia significativa, resetea
            lastArsExchange = null;
            lastArsPrice = null;
        }

    } catch (err) {
        console.log("Error consultando CriptoYa ARS:", err);
    }
}

// --- Monitoreo USDT/USD ---
let lastUsdPrice = null;
let lastUsdExchange = null;
let lastUsdAlertTime = 0;

async function monitorUsdLoop() {
    const { bestPrice, bestExchange } = await getLowestTotalAsk();
    if (!bestPrice) return;

    console.log(`[${new Date().toLocaleTimeString()}] Mejor cotización USD: ${bestExchange} totalAsk = ${bestPrice}`);

    // Si subió por encima del umbral, se resetea el estado
    if (bestPrice > THRESHOLD_USD) {
        lastUsdPrice = bestPrice;
        lastUsdExchange = bestExchange;
        return;
    }

    const now = Date.now();
    const timeSinceLastAlert = now - lastUsdAlertTime;

    // Si el precio es igual al último, no enviar nada
    if (bestPrice === lastUsdPrice && bestPrice <= THRESHOLD_USD) {
        console.log(`[${new Date().toLocaleTimeString()}] Precio igual (${bestPrice}) — no se envía alerta`);
        return;
    }

    // Si el precio bajó más, enviar alerta inmediata
    if (bestPrice < lastUsdPrice && bestPrice <= THRESHOLD_USD) {
        await sendTelegramMessage(
            `⚡ <b>USDT bajó aún más:</b>\n💰 <b>${bestExchange}</b> → <b>${bestPrice.toFixed(4)}</b> USD (umbral ${THRESHOLD_USD})`
        );
        lastUsdAlertTime = now;
    }
    // Si sigue bajo pero cambió levemente, enviar cada 30 minutos
    else if (bestPrice <= THRESHOLD_USD && timeSinceLastAlert >= COOLDOWN_MINUTES) {
        await sendTelegramMessage(
            `💰 <b>USDT sigue bajo:</b> <b>${bestExchange}</b> a <b>${bestPrice.toFixed(4)}</b> USD`
        );
        lastUsdAlertTime = now;
    }

    lastUsdPrice = bestPrice;
    lastUsdExchange = bestExchange;
}

// --- Loop principal ---
setInterval(async () => {
    await monitorUsdLoop();
    await checkArsBidAnomaly();
}, POLL_INTERVAL);

// Express keep-alive
app.get('/', (req, res) => res.send("✅ CriptoYA Alert Bot corriendo"));
app.listen(3000, () => console.log("Servidor Express escuchando en puerto 3000"));
