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
    
    document.getElementById('calculateBtn').addEventListener('click', calculate);
    
    let chart = null;
    
    async function calculate() {
        const hashrate  = parseFloat(document.getElementById('hashrate').value);
        const power     = parseFloat(document.getElementById('power').value);
        const tariff    = parseFloat(document.getElementById('electricity').value);
        const price     = parseFloat(document.getElementById('devicePrice').value);
        
        if (!hashrate || !power || !tariff || !price) {
            alert('Заполните все поля!');
            return;
        }
        
        try {
            const [difficultyResponse, priceData] = await Promise.all([
                fetch('https://mempool.space/api/v1/difficulty-adjustment').then(r => r.json()),
                fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd').then(r => r.json())
            ]);
            
            const difficulty = 87200000000000;
            const btcPrice = priceData.bitcoin.usd;
            
            const blockSubsidy   = 3.125;
            const blocksPerDay   = 144;
            const poolFee        = 0.98;
            
            const hashRateTH     = hashrate * 1000000000000;
            const dailyBTC       = (hashRateTH * blockSubsidy * blocksPerDay * poolFee) / 
                                   (difficulty * Math.pow(2, 32));
            const dailyIncome    = dailyBTC * btcPrice;
            
            const dailyCost      = (power / 1000) * 24 * tariff;
            const dailyProfit    = dailyIncome - dailyCost;
            
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
            
            drawChart(dailyProfit, price, tariff, power);
            
        } catch (error) {
            console.error('Ошибка:', error);
            alert('Не удалось загрузить данные сети. Проверьте интернет.');
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
                        borderColor: '#00ff88',
                        backgroundColor: 'rgba(0,255,136,0.1)',
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Накопленные затраты на ЭЭ ($)',
                        data: electricity,
                        borderColor: '#ff4444',
                        backgroundColor: 'rgba(255,68,68,0.1)',
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { labels: { color: 'white' } }
                },
                scales: {
                    x: { ticks: { color: 'white' } },
                    y: { ticks: { color: 'white' } }
                }
            }
        });
    }
    
    calculate();
});
