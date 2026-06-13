const app = {
    playerId: null,
    gameState: null,
    
    planetDB: {
        'rations': { name: '農業星 Demeter', risk: '極低 (安全避險)', vol: '10%', desc: '溫室覆蓋率達 90% 的農業行星，氣候由 AI 嚴格控制。雖然投資回報率低，但在市場動盪時是最好的資金避風港。', color: '#4ade80', bg: 'linear-gradient(45deg, #064e3b, #4ade80)' },
        'titanium': { name: '礦業星 Titania', risk: '中等 (工業週期)', vol: '25%', desc: '地表被巨大鑽探機覆蓋的重工業星球。鈦合金的價格高度依賴全星系的星艦製造成本與軍工政策。', color: '#94a3b8', bg: 'linear-gradient(45deg, #1e293b, #94a3b8)' },
        'quantum_chip': { name: '科技星 Silicon-9', risk: '高 (技術突破)', vol: '50%', desc: '整顆星球就是一台超級電腦，閃爍著霓虹光芒。晶片良率與新技術發表會導致價格劇烈震盪，是投機客的最愛。', color: '#38bdf8', bg: 'linear-gradient(45deg, #0c4a6e, #38bdf8)' },
        'antimatter': { name: '邊界星 Void-X', risk: '極高 (致命危險)', vol: '80%', desc: '位於黑洞邊緣，利用引力極端提煉反物質的危險星球。隨時可能發生提煉廠爆炸事件，可能讓你一夜暴富或瞬間破產。', color: '#f43f5e', bg: 'linear-gradient(45deg, #881337, #f43f5e)' }
    },

    init: async function() { 
        // 【修復 1】嘗試從瀏覽器暫存讀取玩家 ID，避免 F5 重新整理後進度消失
        const savedId = localStorage.getItem('space_tycoon_player_id');
        if (savedId) {
            this.playerId = savedId;
            this.switchScreen('gameScreen');
            this.refreshGameData();
        } else {
            this.loadLeaderboard(); 
        }
    },
    
    loadLeaderboard: async function() {
        try {
            const res = await fetch('/api/leaderboard');
            const data = await res.json();
            const list = document.getElementById('startLeaderboardList');
            list.innerHTML = data.map((p, i) => `<li><span>#${i+1} ${p.name}</span> <span class="text-success">$${p.net_worth}</span></li>`).join('');
        } catch (e) { console.error("Leaderboard fetch failed"); }
    },

    startGame: async function() {
        const name = document.getElementById('playerNameInput').value.trim();
        if (!name) return this.showToast('請輸入交易員代號！', 'error');
        try {
            const res = await fetch('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
            const data = await res.json();
            this.playerId = data.id;
            
            // 【修復 2】新開局時，把 ID 存進瀏覽器
            localStorage.setItem('space_tycoon_player_id', this.playerId);
            
            this.switchScreen('gameScreen');
            this.refreshGameData();
            this.showToast('身分驗證成功，連線至星際交易網', 'success');
        } catch (e) { this.showToast('系統連線失敗', 'error'); }
    },

    // 【修復 3】新增伺服器失憶處理機制 (踢回首頁)
    forceLogout: function() {
        this.playerId = null;
        this.gameState = null;
        localStorage.removeItem('space_tycoon_player_id');
        
        // 這裡假設你的登入畫面 ID 是 startScreen，請確認你的 HTML
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const startScreen = document.getElementById('startScreen') || document.querySelector('.screen');
        if(startScreen) startScreen.classList.add('active');
        
        this.loadLeaderboard();
        this.showToast('伺服器資料已重置，請重新開始新局', 'error');
    },

    refreshGameData: async function() {
        if (!this.playerId) return;
        try {
            const res = await fetch(`/api/game/${this.playerId}`);
            // 如果伺服器回報 400 或找不到人，啟動防呆機制
            if (!res.ok) return this.forceLogout();
            
            this.gameState = await res.json();
            if (this.gameState.isFinished) return this.showEndScreen();
            this.renderUI();
        } catch (e) {
            console.error(e);
        }
    },

    renderUI: function() {
        const { name, credits, day, market, inventory, eventLog } = this.gameState;
        document.getElementById('uiName').innerText = name;
        document.getElementById('uiDay').innerText = `${day}/30`;
        document.getElementById('uiCredits').innerText = credits.toLocaleString();
        
        let netWorth = credits;
        for (const key in inventory) { netWorth += inventory[key] * market[key].price; }
        document.getElementById('uiNetWorth').innerText = netWorth.toLocaleString();
        document.getElementById('eventLog').innerText = `> ${eventLog}`;

        const invHtml = Object.keys(inventory).map(key => `
            <div class="inv-item" id="inv_${key}">
                <div class="inv-item-name">${market[key].name}</div>
                <div class="inv-item-qty">${inventory[key]} <span style="font-size:0.8rem; color:var(--text-muted)">單位</span></div>
            </div>
        `).join('');
        document.getElementById('inventoryGrid').innerHTML = invHtml;

        const marketHtml = Object.keys(market).map(key => {
            const item = market[key];
            const diff = item.price - item.oldPrice;
            let trendHtml = '<span class="text-muted">-</span>';
            if (diff > 0) trendHtml = `<span class="text-success">▲ +${diff}</span>`;
            if (diff < 0) trendHtml = `<span class="text-danger">▼ ${diff}</span>`;

            return `
                <tr>
                    <td><strong>${item.name}</strong></td>
                    <td class="price-tag">$${item.price.toLocaleString()}</td>
                    <td>${trendHtml}</td>
                    <td>
                        <div class="action-group">
                            <input type="number" id="qty_${key}" class="qty-input" value="1" min="1">
                            <button class="btn btn-outline-success" onclick="app.trade('${key}', 'buy')">買入</button>
                            <button class="btn btn-outline-danger" onclick="app.trade('${key}', 'sell')">賣出</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        document.getElementById('marketBody').innerHTML = marketHtml;

        this.renderPlanets();
    },

    renderPlanets: function() {
        const grid = document.getElementById('planetGrid');
        if (grid.innerHTML !== "") return;
        
        const html = Object.keys(this.planetDB).map(key => {
            const p = this.planetDB[key];
            return `
                <div class="planet-container" onclick="app.openModal('${key}')">
                    <div class="planet" style="color: ${p.color}; background: ${p.bg};"></div>
                    <div class="planet-name text-primary">${this.gameState.market[key].name}</div>
                </div>
            `;
        }).join('');
        grid.innerHTML = html;
    },

    openModal: function(itemId) {
        const p = this.planetDB[itemId];
        document.getElementById('modalTitle').innerText = p.name;
        document.getElementById('modalResCode').innerText = itemId.toUpperCase();
        document.getElementById('modalRisk').innerText = p.risk;
        document.getElementById('modalVol').innerText = p.vol;
        document.getElementById('modalDesc').innerText = p.desc;
        
        const modal = document.getElementById('cyberModal');
        modal.classList.remove('hidden');
    },

    closeModal: function() {
        document.getElementById('cyberModal').classList.add('hidden');
    },

    trade: async function(itemId, action) {
        // 【修復 4】強制把輸入的數值轉換為整數 (Number)，避免丟字串給後端導致 400 錯誤
        const qtyInput = document.getElementById(`qty_${itemId}`).value;
        const qty = parseInt(qtyInput, 10);

        if (isNaN(qty) || qty <= 0) return this.showToast('請輸入有效的數量！', 'error');

        try {
            const res = await fetch('/api/trade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: this.playerId, itemId, action, qty })
            });
            const data = await res.json();
            
            // 如果後端回報錯誤，拋出訊息
            if (!res.ok) {
                if (res.status === 400 && !data.error) throw new Error('連線遺失，請重新整理網頁');
                throw new Error(data.error || '交易失敗');
            }
            
            this.showToast(`${action === 'buy'?'買入':'賣出'}成功！`, 'success');
            this.refreshGameData(); 
        } catch (e) { this.showToast(e.message, 'error'); }
    },

    nextDay: async function() {
        try {
            const res = await fetch('/api/next-day', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: this.playerId })
            });
            
            // 【修復 5】過夜時也檢查伺服器狀態
            if (!res.ok) return this.forceLogout();

            const data = await res.json();
            
            if (data.finished) {
                this.gameState.netWorth = data.netWorth;
                this.showEndScreen();
                // 遊戲結束，清空暫存，下一把重新開始
                localStorage.removeItem('space_tycoon_player_id');
            } else {
                this.triggerDayAnimation(); 
                this.showToast(`已進入第 ${data.day} 天`, 'primary');
                this.refreshGameData();
            }
        } catch (e) { this.showToast('系統操作失敗', 'error'); }
    },

    triggerDayAnimation: function() {
        const symbols = ['+$', '▲', '▼', '%', '!!'];
        const colors = ['#38bdf8', '#10b981', '#f59e0b', '#ef4444'];
        
        for(let i = 0; i < 15; i++) {
            const particle = document.createElement('div');
            particle.className = 'resource-particle';
            particle.innerText = symbols[Math.floor(Math.random() * symbols.length)];
            particle.style.color = colors[Math.floor(Math.random() * colors.length)];
            
            particle.style.left = (Math.random() * 80 + 10) + 'vw';
            particle.style.bottom = (Math.random() * 20 + 20) + 'vh';
            
            document.body.appendChild(particle);
            setTimeout(() => particle.remove(), 1500);
        }
    },

    switchScreen: function(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    },

    showEndScreen: function() {
        this.switchScreen('endScreen');
        document.getElementById('finalNetWorth').innerText = this.gameState.netWorth ? this.gameState.netWorth.toLocaleString() : "結算中...";
    },

    showToast: function(message, type = 'primary') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerText = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

window.onload = () => app.init();
