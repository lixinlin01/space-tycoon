const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 初始化資料庫
const db = new sqlite3.Database('./.data/tycoon.db');

// 定義商品與初始價格、波動率
const ITEMS = {
    'rations': { name: '太空口糧', basePrice: 20, volatility: 0.1 },
    'titanium': { name: '鈦合金', basePrice: 150, volatility: 0.25 },
    'quantum_chip': { name: '量子晶片', basePrice: 800, volatility: 0.5 },
    'antimatter': { name: '反物質', basePrice: 3000, volatility: 0.8 }
};

// 市場事件庫
const EVENTS = [
    { desc: "星際航線穩定，市場無劇烈波動。", effect: null },
    { desc: "【突發】反物質儲存槽爆炸，產能大減！反物質價格暴漲。", effect: { target: 'antimatter', multiplier: 2.5 } },
    { desc: "【新聞】新鈦礦星被發現，鈦合金供過於求。", effect: { target: 'titanium', multiplier: 0.4 } },
    { desc: "【科技】量子運算技術突破，晶片需求大增。", effect: { target: 'quantum_chip', multiplier: 1.8 } },
    { desc: "【危機】星際海盜封鎖航線，民生必需品上漲。", effect: { target: 'rations', multiplier: 1.5 } }
];

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY, name TEXT, credits INTEGER, day INTEGER, 
        market_state TEXT, inventory TEXT, event_log TEXT, is_finished BOOLEAN DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, net_worth INTEGER, date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

function generateMarket(oldMarket = null, eventEffect = null) {
    const market = {};
    for (const [key, data] of Object.entries(ITEMS)) {
        let oldPrice = oldMarket ? oldMarket[key].price : data.basePrice;
        let change = 1 + (Math.random() * data.volatility * 2 - data.volatility);
        let newPrice = Math.round(oldPrice * change);
        if (eventEffect && eventEffect.target === key) {
            newPrice = Math.round(newPrice * eventEffect.multiplier);
        }
        newPrice = Math.max(newPrice, 5); 
        market[key] = { name: data.name, price: newPrice, oldPrice: oldPrice };
    }
    return market;
}

app.post('/api/start', (req, res) => {
    const { name } = req.body;
    const id = Date.now().toString();
    const initCredits = 5000;
    const initMarket = generateMarket();
    const initInventory = { 'rations': 0, 'titanium': 0, 'quantum_chip': 0, 'antimatter': 0 };
    
    db.run(`INSERT INTO players (id, name, credits, day, market_state, inventory, event_log) 
            VALUES (?, ?, ?, 1, ?, ?, ?)`,
        [id, name, initCredits, JSON.stringify(initMarket), JSON.stringify(initInventory), "遊戲開始，給你 5000 信用點啟動資金。"],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, message: '系統初始化成功' });
        }
    );
});

app.get('/api/game/:id', (req, res) => {
    db.get(`SELECT * FROM players WHERE id = ?`, [req.params.id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: '找不到玩家' });
        res.json({
            name: row.name, credits: row.credits, day: row.day,
            market: JSON.parse(row.market_state), inventory: JSON.parse(row.inventory),
            eventLog: row.event_log, isFinished: row.is_finished
        });
    });
});

app.post('/api/trade', (req, res) => {
    const { id, itemId, action, qty } = req.body;
    const quantity = parseInt(qty);
    if (quantity <= 0) return res.status(400).json({ error: '數量必須大於 0' });

    db.get(`SELECT * FROM players WHERE id = ? AND is_finished = 0`, [id], (err, player) => {
        if (err || !player) return res.status(400).json({ error: '無效的交易狀態' });
        
        let credits = player.credits;
        let inventory = JSON.parse(player.inventory);
        let market = JSON.parse(player.market_state);
        let price = market[itemId].price;

        if (action === 'buy') {
            const cost = price * quantity;
            if (credits < cost) return res.status(400).json({ error: '信用點不足' });
            credits -= cost;
            inventory[itemId] += quantity;
        } else if (action === 'sell') {
            if (inventory[itemId] < quantity) return res.status(400).json({ error: '庫存不足' });
            const revenue = price * quantity;
            credits += revenue;
            inventory[itemId] -= quantity;
        }

        db.run(`UPDATE players SET credits = ?, inventory = ? WHERE id = ?`,
            [credits, JSON.stringify(inventory), id], (err) => {
                if (err) return res.status(500).json({ error: '交易失敗' });
                res.json({ message: '交易成功', credits, inventory });
            });
    });
});

app.post('/api/next-day', (req, res) => {
    db.get(`SELECT * FROM players WHERE id = ? AND is_finished = 0`, [req.body.id], (err, player) => {
        if (err || !player) return res.status(400).json({ error: '無效的操作' });

        if (player.day >= 30) {
            let inventory = JSON.parse(player.inventory);
            let market = JSON.parse(player.market_state);
            let netWorth = player.credits;
            for (let key in inventory) netWorth += inventory[key] * market[key].price;
            
            db.run(`UPDATE players SET is_finished = 1 WHERE id = ?`, [player.id]);
            db.run(`INSERT INTO leaderboard (name, net_worth) VALUES (?, ?)`, [player.name, netWorth]);
            return res.json({ finished: true, netWorth });
        }

        const event = EVENTS[Math.floor(Math.random() * EVENTS.length)];
        const oldMarket = JSON.parse(player.market_state);
        const newMarket = generateMarket(oldMarket, event.effect);

        db.run(`UPDATE players SET day = day + 1, market_state = ?, event_log = ? WHERE id = ?`,
            [JSON.stringify(newMarket), event.desc, player.id], (err) => {
                res.json({ message: '進入下一天', day: player.day + 1, event: event.desc });
            });
    });
});

app.get('/api/leaderboard', (req, res) => {
    db.all(`SELECT name, net_worth FROM leaderboard ORDER BY net_worth DESC LIMIT 10`, [], (err, rows) => {
        res.json(rows || []);
    });
});

app.listen(3000, () => console.log('Space Tycoon Server running on http://localhost:3000'));