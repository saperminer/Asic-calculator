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
    
    // fetch с таймаутом
    async function fetchWithTimeout(url, timeout = 8000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`Статус ${response.status}`);
            return response;
        } finally {
            clearTimeout(timer);
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
        calcBtn.textContent = '⏳ Загрузка данных сети...';
        
        try {
            let btcPrice, dailyBTC;
            
            // === Способ 1: WhatToMine (готовый доход) ===
            try {
                const wtmResponse = await fetchWithTimeout('https://whattomine.com/coins/1.json');
                const wtmData = await wtmResponse.json();
                btcPrice = parseFloat(wtmData.exchange_rate);
                // estimated_rewards — дневной доход в BTC за 1 TH/s
                const rewardPerTH = parseFloat(wtmData.estimated_rewards);
                dailyBTC = hashrate * rewardPerTH;  // умножаем на наш хешрейт
            } catch (wtmError) {
                // === Способ 2: Mempool + CoinGecko (запасной) ===
                console.warn('WhatToMine недоступен, пробуем запасной метод');
                const [diffResponse, priceResponse] = await Promise.all([
                    fetchWithTimeout('https://mempool.space/api/v1/difficulty-adjustment'),
                    fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd')
                ]);
                const diffData = await diffResponse.json();
                const difficulty = diffData.difficulty;
                const priceData = await priceResponse.json();
                btcPrice = priceData.bitcoin.usd;
                
                const blockSubsidy = 3.125;
                const poolFee = 0.98;
                dailyBTC = (hashrate * 1e12 * blockSubsidy * 86400 * poolFee) /
                           (difficulty * Math.pow(2, 32));
            }
            
            // Расчёт дохода и прибыли
            const dailyIncome = dailyBTC * btcPrice;
            const dailyCost = (power / 1000) * 24 * tariff;
            const dailyProfit = dailyIncome - dailyCost;
            
            // Окупаемость
            let roiText = '—';
            if (dailyProfit > 0) {
                const days = Math.ceil(price / dailyProfit);
                roiText = days < 365 ? `${days} дн.` : `${(days/365).toFixed(1)} лет`;
            } else {
                roiText = '⚠️ Убыток';
            }
            
            // Вывод в карточки
            document.getElementById('dailyIncome').textContent  = `$${dailyIncome.toFixed(2)}`;
            document.getElementById('dailyCost').textContent    = `$${dailyCost.toFixed(2)}`;
            document.getElementById('dailyProfit').textContent   = `$${dailyProfit.toFixed(2)}`;
            document.getElementById('roi').textContent          = roiText;
            
            // График
            drawChart(dailyProfit, price, tariff, power);
            
        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
            alert('Не удалось загрузить данные.\nВозможно, нет интернета или нужен VPN.\nПопробуйте позже.');
            document.getElementById('dailyIncome').textContent  = '$—';
            document.getElementById('dailyCost').textContent    = '$—';
            document.getElementById('dailyProfit').textContent   = '$—';
            document.getElementById('roi').textContent          = 'Ошибка';
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
    
    // Автозапуск при загрузке
    calculate();
});
