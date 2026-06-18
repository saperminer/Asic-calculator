document.addEventListener('DOMContentLoaded', function() {

    // Переключение моделей
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
    window.difficultyChartInstance = null;
    window.hashrateChartInstance = null;

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
            document.getElementById('btcUsd').textContent = '$' + data.bitcoin.usd.toLocaleString();
            document.getElementById('btcRub').textContent = '₽' + data.bitcoin.rub.toLocaleString();
        } catch (e) {
            console.warn('Курс BTC не обновлён:', e.message);
            document.getElementById('btcUsd').textContent = '$—';
            document.getElementById('btcRub').textContent = '₽—';
        }
    }

    // Получение сложности и вычисление хешрейта сети из blocks/tip
    async function getNetworkData() {
        const resp = await fetchWithTimeout('https://mempool.space/api/blocks/tip');
        const data = await resp.json();
        if (!Array.isArray(data) || data.length === 0 || !data[0].difficulty) {
            throw new Error('Не удалось получить сложность');
        }
        const difficulty = data[0].difficulty;
        // Хешрейт сети = difficulty * 2^32 / 600 (H/s)
        const hashrateH = difficulty * Math.pow(2, 32) / 600;
        return { difficulty, hashrateH };
    }

    // Обновление карточек сети и графиков прогноза
    async function updateNetworkStats() {
        try {
            const { difficulty, hashrateH } = await getNetworkData();

            // Хешрейт в EH/s
            const hrEH = (hashrateH / 1e18).toFixed(2);
            document.getElementById('networkHashrate').textContent = hrEH + ' EH/s';

            // Сложность в Т
            const diffT = (difficulty / 1e12).toFixed(2);
            document.getElementById('networkDifficulty').textContent = diffT + ' T';

            // Прогнозные графики
            const growthPercent = parseFloat(document.getElementById('diffGrowth').value) || 3;
            drawForecastCharts(difficulty, hashrateH, growthPercent);

        } catch (e) {
            console.warn('Сетевые показатели не обновлены:', e.message);
            document.getElementById('networkHashrate').textContent = '—';
            document.getElementById('networkDifficulty').textContent = '—';
        }
    }

    // Построение прогнозных графиков сложности и хешрейта
    function drawForecastCharts(currentDiff, currentHashrate, growthPercent) {
        const months = 12;
        const labels = [];
        const diffValues = [];
        const hrValues = [];
        const growthFactor = 1 + growthPercent / 100;

        let diff = currentDiff;
        let hr = currentHashrate;
        for (let i = 0; i <= months; i++) {
            const date = new Date();
            date.setMonth(date.getMonth() + i);
            labels.push(date.toLocaleDateString('ru', { month: 'short', year: '2-digit' }));
            diffValues.push(diff / 1e12); // в Т
            hrValues.push(hr / 1e18);     // в EH/s
            diff *= growthFactor;
            hr *= growthFactor;
        }

        // График сложности
        const diffCtx = document.getElementById('difficultyChart').getContext('2d');
        if (window.difficultyChartInstance) window.difficultyChartInstance.destroy();
        window.difficultyChartInstance = new Chart(diffCtx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Сложность (T)',
                    data: diffValues,
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

        // График хешрейта
        const hrCtx = document.getElementById('hashrateChart').getContext('2d');
        if (window.hashrateChartInstance) window.hashrateChartInstance.destroy();
        window.hashrateChartInstance = new Chart(hrCtx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Хешрейт (EH/s)',
                    data: hrValues,
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
    }

    // Основная функция расчёта
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

        // Сброс значений
        document.getElementById('monthlyIncome').textContent  = '$—';
        document.getElementById('monthlyCost').textContent    = '$—';
        document.getElementById('monthlyProfit').textContent   = '$—';
        document.getElementById('roi').textContent          = '—';

        try {
            let btcPrice, dailyBTC;

            // 1. Пробуем WhatToMine (может не работать из-за CORS)
            try {
                const resp = await fetchWithTimeout('https://whattomine.com/coins/1.json');
                const data = await resp.json();
                btcPrice = parseFloat(data.exchange_rate);
                const rewardPerTH = parseFloat(data.estimated_rewards);
                dailyBTC = hashrate * rewardPerTH;
            } catch (wtmError) {
                // 2. Запасной: наша сложность + CoinGecko
                const { difficulty } = await getNetworkData();
                const priceResp = await fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
                const priceData = await priceResp.json();
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

            // Месячные значения
            const monthlyIncome = dailyBTC * btcPrice * 30;
            const monthlyCost = (power / 1000) * 24 * tariff * 30;
            const monthlyProfit = monthlyIncome - monthlyCost;

            // Окупаемость в удобном формате
            let roiText = '—';
            if (monthlyProfit > 0) {
                const months = price / monthlyProfit;
                if (months < 1) {
                    roiText = Math.ceil(months * 30) + ' дн.';
                } else if (months <= 12) {
                    roiText = months.toFixed(1) + ' мес.';
                } else {
                    roiText = (months / 12).toFixed(1) + ' лет';
                }
            } else {
                roiText = '⚠️ Убыток';
            }

            // Заполняем карточки
            document.getElementById('monthlyIncome').textContent  = `$${monthlyIncome.toFixed(2)}`;
            document.getElementById('monthlyCost').textContent    = `$${monthlyCost.toFixed(2)}`;
            document.getElementById('monthlyProfit').textContent   = `$${monthlyProfit.toFixed(2)}`;
            document.getElementById('roi').textContent          = roiText;

            // График окупаемости (использует месячную прибыль)
            drawProfitChart(monthlyProfit, price, tariff, power);

            // Сначала сетевые показатели с прогнозом, потом курс BTC
            await updateNetworkStats();
            updateBtcRate();

        } catch (error) {
            console.error(error);
            alert('Ошибка: ' + error.message + '\n\nПроверьте интернет и обход DPI.');
            document.getElementById('monthlyIncome').textContent  = '$—';
            document.getElementById('monthlyCost').textContent    = '$—';
            document.getElementById('monthlyProfit').textContent   = '$—';
            document.getElementById('roi').textContent          = 'Ошибка';
        } finally {
            calcBtn.disabled = false;
            calcBtn.textContent = originalText;
        }
    }

    // График окупаемости (накопленная прибыль против затрат)
    function drawProfitChart(monthlyProfit, price, tariff, power) {
        const ctx = document.getElementById('profitChart').getContext('2d');
        if (chart) chart.destroy();

        const months = 24;
        const labels = [];
        const cumulative = [];
        const electricity = [];
        let total = -price;

        for (let i = 0; i <= months; i++) {
            labels.push(i === 0 ? 'Старт' : `${i} мес`);
            const decay = Math.pow(0.97, i);   // снижение дохода из-за роста сложности
            const currentMonthlyProfit = monthlyProfit * decay;
            total += currentMonthlyProfit;
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
