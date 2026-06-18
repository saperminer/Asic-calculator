document.addEventListener('DOMContentLoaded', function() {

    document.getElementById('modelSelect').addEventListener('change', function() {
        const models = {
            't21':   { hashrate: 190, power: 3610 },
            's21':   { hashrate: 200, power: 3500 },
            's19':   { hashrate: 141, power: 3010 },
            'custom': { hashrate: 0, power: 0 }
        };
        const m = models[this.value];
        if (m.hashrate > 0) {
            document.getElementById('hashrate').value = m.hashrate;
            document.getElementById('power').value = m.power;
        }
    });

    const calcBtn = document.getElementById('calculateBtn');
    calcBtn.addEventListener('click', calculate);

    let chart = null;

    // Запрос с таймаутом
    function fetchWithTimeout(url, timeout = 8000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Таймаут')), timeout);
            fetch(url)
                .then(r => {
                    clearTimeout(timer);
                    if (!r.ok) reject(new Error(`HTTP ${r.status}`));
                    else resolve(r);
                })
                .catch(e => {
                    clearTimeout(timer);
                    reject(e);
                });
        });
    }

    // Обновление виджета курса BTC
    async function updateBtcRate() {
        try {
            const resp = await fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,rub');
            const data = await resp.json();
            const usd = data.bitcoin.usd;
            const rub = data.bitcoin.rub;
            document.getElementById('btcUsd').textContent = '$' + usd.toLocaleString();
            document.getElementById('btcRub').textContent = '₽' + rub.toLocaleString();
        } catch (e) {
            console.warn('Не удалось обновить курс BTC:', e.message);
            document.getElementById('btcUsd').textContent = '$—';
            document.getElementById('btcRub').textContent = '₽—';
        }
    }

    async function calculate() {
        const hashrate  = parseFloat(document.getElementById('hashrate').value);
        const power     = parseFloat(document.getElementById('power').value);
        const tariff    = parseFloat(document.getElementById('electricity').value);
        const price     = parseFloat(document.getElementById('devicePrice').value);

        if (!hashrate || !power || !tariff || !price) {
            alert('Заполните все поля!');
            return;
        }

        const originalText = calcBtn.textContent;
        calcBtn.disabled = true;
        calcBtn.textContent = '⏳ Загрузка данных...';

        document.getElementById('dailyIncome').textContent  = '$—';
        document.getElementById('dailyCost').textContent    = '$—';
        document.getElementById('dailyProfit').textContent   = '$—';
        document.getElementById('roi').textContent          = '—';

        try {
            let btcPrice, dailyBTC;

            // 1. Пробуем WhatToMine (вероятно, не сработает из-за CORS)
            try {
                const resp = await fetchWithTimeout('https://whattomine.com/coins/1.json');
                const data = await resp.json();
                btcPrice = parseFloat(data.exchange_rate);
                const rewardPerTH = parseFloat(data.estimated_rewards);
                dailyBTC = hashrate * rewardPerTH;
            } catch (wtmError) {
                // 2. Запасной: Mempool + CoinGecko
                const [diffResp, priceResp] = await Promise.all([
                    fetchWithTimeout('https://mempool.space/api/blocks/tip'),
                    fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd')
                ]);

                const diffData = await diffResp.json();
                const priceData = await priceResp.json();

                if (!Array.isArray(diffData) || diffData.length === 0 || !diffData[0].difficulty) {
                    throw new Error('Mempool не вернул difficulty в массиве');
                }
                const difficulty = diffData[0].difficulty;

                btcPrice = priceData.bitcoin?.usd;
                if (!btcPrice) throw new Error('CoinGecko не вернул курс');

                const blockSubsidy = 3.125;
                const poolFee = 0.98;
                dailyBTC = (hashrate * 1e12 * blockSubsidy * 86400 * poolFee) /
                           (difficulty * Math.pow(2, 32));
            }

            if (isNaN(btcPrice) || isNaN(dailyBTC) || btcPrice <= 0 || dailyBTC <= 0) {
                throw new Error('Некорректные данные');
            }

            const dailyIncome = dailyBTC * btcPrice;
            const dailyCost = (power / 1000) * 24 * tariff;
            const dailyProfit = dailyIncome - dailyCost;

            let roiText = '—';
            if (dailyProfit > 0) {
                const days = Math.ceil(price / dailyProfit);
                roiText = days < 365 ? `${days} дн.` : `${(days/365).toFixed(1)} лет`;
            } else {
                roiText = '⚠️ Убыток';
            }

            document.getElementById('dailyIncome').textContent  = `$${dailyIncome.toFixed(2)}`;
            document.getElementById('dailyCost').textContent    = `$${dailyCost.toFixed(2)}`;
            document.getElementById('dailyProfit').textContent   = `$${dailyProfit.toFixed(2)}`;
            document.getElementById('roi').textContent          = roiText;
// Обновление сетевых показателей
async function updateNetworkStats() {
    try {
        const [hashResp, diffResp] = await Promise.all([
            fetchWithTimeout('https://mempool.space/api/v1/hashrate/pool/3d'),
            fetchWithTimeout('https://mempool.space/api/v1/difficulty-adjustment')
        ]);
        const hashData = await hashResp.json();
        const diffData = await diffResp.json();

        // Хешрейт сети в EH/s (mempool даёт хешрейт в H/s, переводим)
        const hashrateEH = (hashData.hashrate / 1e18).toFixed(2);
        document.getElementById('networkHashrate').textContent = hashrateEH + ' EH/s';

        // Сложность в триллионах (T)
        const difficultyT = (diffData.difficulty / 1e12).toFixed(2);
        document.getElementById('networkDifficulty').textContent = difficultyT + ' T';

        // Строим графики с теми же данными (если нужно, можем загрузить историю)
        await drawDifficultyChart();
        await drawHashrateChart();
    } catch (e) {
        console.warn('Не удалось обновить сетевые показатели:', e.message);
        document.getElementById('networkHashrate').textContent = '—';
        document.getElementById('networkDifficulty').textContent = '—';
    }
}

// График сложности за 12 месяцев (используем историю из mempool)
async function drawDifficultyChart() {
    try {
        const resp = await fetchWithTimeout('https://mempool.space/api/v1/difficulty/history?range=12m');
        const data = await resp.json();
        const ctx = document.getElementById('difficultyChart').getContext('2d');
        if (window.difficultyChartInstance) window.difficultyChartInstance.destroy();

        const labels = data.map(p => {
            const d = new Date(p.time * 1000);
            return d.toLocaleDateString('ru', { month: 'short', year: '2-digit' });
        });
        const values = data.map(p => p.difficulty / 1e12); // в Т

        window.difficultyChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Сложность (T)',
                    data: values,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245,158,11,0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: '#6c757d', maxTicksLimit: 6 } },
                    y: { ticks: { color: '#6c757d' } }
                }
            }
        });
    } catch (e) {
        console.warn('Не удалось построить график сложности:', e.message);
    }
}

// График хешрейта за 3 месяца
async function drawHashrateChart() {
    try {
        const resp = await fetchWithTimeout('https://mempool.space/api/v1/hashrate/pool/3m');
        const data = await resp.json();
        const ctx = document.getElementById('hashrateChart').getContext('2d');
        if (window.hashrateChartInstance) window.hashrateChartInstance.destroy();

        const labels = data.map(p => {
            const d = new Date(p.timestamp * 1000);
            return d.toLocaleDateString('ru', { month: 'short', year: '2-digit' });
        });
        const values = data.map(p => p.avgHashrate / 1e18); // EH/s

        window.hashrateChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Хешрейт (EH/s)',
                    data: values,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16,185,129,0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: '#6c757d', maxTicksLimit: 6 } },
                    y: { ticks: { color: '#6c757d' } }
                }
            }
        });
    } catch (e) {
        console.warn('Не удалось построить график хешрейта:', e.message);
    }
                                                                                           }
            drawChart(dailyProfit, price, tariff, power);

            // Обновляем курс после успешного расчёта
            updateBtcRate();

        } catch (error) {
            console.error(error);
            alert('Ошибка: ' + error.message + '\n\nПроверьте интернет и обход DPI.');
        } finally {
            calcBtn.disabled = false;
            calcBtn.textContent = originalText;
        }
    }

    function drawChart(dailyProfit, price, tariff, power) {
        const ctx = document.getElementById('profitChart').getContext('2d');
        if (chart) chart.destroy();

        const months = 24;
        const labels = [];
        const cumulative = [];
        const electricity = [];
        let total = -price;

        for (let i = 0; i <= months; i++) {
            labels.push(i === 0 ? 'Старт' : `${i} мес`);
            const decay = Math.pow(0.97, i);
            const monthlyProfit = dailyProfit * decay * 30;
            total += monthlyProfit;
            cumulative.push(parseFloat(total.toFixed(0)));
            const monthlyCost = (power / 1000) * 24 * tariff * 30;
            electricity.push(parseFloat((monthlyCost * (i+1)).toFixed(0)));
        }

        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Накопленная прибыль ($)',
                        data: cumulative,
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37,99,235,0.1)',
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Накопленные затраты на ЭЭ ($)',
                        data: electricity,
                        borderColor: '#dc3545',
                        backgroundColor: 'rgba(220,53,69,0.1)',
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { labels: { color: '#212529' } }
                },
                scales: {
                    x: { ticks: { color: '#6c757d' } },
                    y: { ticks: { color: '#6c757d' } }
                }
            }
        });
    }

    // Первичная загрузка
    updateBtcRate();
    calculate();
});
