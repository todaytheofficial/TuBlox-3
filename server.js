require('dotenv').config(); 
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());

// --- ITEMS ---
const ITEMS = {
    'shirt_green': { id: 'shirt_green', type: 'shirt', name: 'Green Hoodie', author: 'TuBlox', price: 15, color: '#33cc33' },
    'shirt_black': { id: 'shirt_black', type: 'shirt', name: 'Void Shirt',   author: 'TuBlox', price: 50, color: '#111111' },
    'shirt_blue':  { id: 'shirt_blue',  type: 'shirt', name: 'Ocean Top',    author: 'TuBlox', price: 20, color: '#3366cc' },
    'pants_black': { id: 'pants_black', type: 'pants', name: 'Black Slacks', author: 'TuBlox', price: 10, color: '#111111' },
    'pants_khaki': { id: 'pants_khaki', type: 'pants', name: 'Khaki Cargo',  author: 'TuBlox', price: 15, color: '#aa8855' },
    'hat_top':     { id: 'hat_top',     type: 'hat',   name: 'Top Hat',      author: 'TuBlox', price: 100, model: 'tophat' }
};

const db = mysql.createPool({
    host: process.env.MYSQL_ADDON_HOST,
    user: process.env.MYSQL_ADDON_USER,
    password: process.env.MYSQL_ADDON_PASSWORD,
    database: process.env.MYSQL_ADDON_DB,
    port: process.env.MYSQL_ADDON_PORT,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
});

db.getConnection((err, connection) => {
    if (err) console.error('❌ DB Error:', err.message);
    else {
        console.log('✅ MySQL подключен!');
        // ВАЖНО: hatType по умолчанию теперь 'hat_none'
        const createQuery = `
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                password VARCHAR(255) NOT NULL,
                tubux INT DEFAULT 100,
                skinColor VARCHAR(50) DEFAULT '#ff9900',
                inventory TEXT, 
                shirtColor VARCHAR(50) DEFAULT '#cc4444',
                pantsColor VARCHAR(50) DEFAULT '#3366cc',
                hatType VARCHAR(50) DEFAULT 'hat_none', 
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        connection.query(createQuery, () => {
            const cols = ["tubux INT DEFAULT 100", "inventory TEXT", "shirtColor VARCHAR(50) DEFAULT '#cc4444'", "pantsColor VARCHAR(50) DEFAULT '#3366cc'", "hatType VARCHAR(50) DEFAULT 'hat_none'"];
            cols.forEach(col => connection.query(`ALTER TABLE users ADD COLUMN ${col}`, (e) => {}));
        });
        connection.release();
    }
});

// --- ROUTES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/game.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'game.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/profile/:id', (req, res) => res.sendFile(path.join(__dirname, 'views', 'profile.html')));
app.get('/marketplace.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'marketplace.html')));

// --- API ---
app.get('/api/me', (req, res) => {
    const username = req.cookies['username'];
    if (!username) return res.status(401).json({ error: 'Not logged in' });
    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        if (err || results.length === 0) return res.status(401).json({ error: 'User not found' });
        res.json(results[0]);
    });
});

app.get('/api/user/:id', (req, res) => {
    db.query('SELECT id, username, created_at, tubux, inventory, shirtColor, pantsColor, hatType FROM users WHERE id = ?', [req.params.id], (err, results) => {
        if (results.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(results[0]);
    });
});

app.get('/api/items', (req, res) => res.json(ITEMS));

app.post('/api/buy', (req, res) => {
    const { itemId } = req.body;
    const username = req.cookies['username'];
    const item = ITEMS[itemId];
    if(!username || !item) return res.status(400).send('Error');

    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        const user = results[0];
        let inventory = user.inventory ? user.inventory.split(',') : [];
        
        if (inventory.includes(itemId)) return res.send('Already owned');
        if (user.tubux < item.price) return res.send('Not enough Tubux');

        const newBalance = user.tubux - item.price;
        inventory.push(itemId);
        
        db.query('UPDATE users SET tubux = ?, inventory = ? WHERE id = ?', 
            [newBalance, inventory.join(','), user.id], () => res.send('Bought!'));
    });
});

app.post('/api/equip', (req, res) => {
    const { itemId, type } = req.body;
    const username = req.cookies['username'];
    
    // Сброс одежды (Default items)
    if(itemId.startsWith('def_')) {
        let field = '', val = '';
        if(type==='shirt') {field='shirtColor'; val='#cc4444';}
        if(type==='pants') {field='pantsColor'; val='#3366cc';}
        if(type==='hat')   {field='hatType'; val='hat_none';} // Снимаем шляпу
        db.query(`UPDATE users SET ${field} = ? WHERE username = ?`, [val, username], () => res.send('Equipped'));
        return;
    }

    const item = ITEMS[itemId];
    if(!item) return res.status(400).send('Item error');
    
    let updateField = ''; let updateValue = '';
    if (item.type === 'shirt') { updateField = 'shirtColor'; updateValue = item.color; }
    if (item.type === 'pants') { updateField = 'pantsColor'; updateValue = item.color; }
    if (item.type === 'hat')   { updateField = 'hatType'; updateValue = item.model; }

    db.query(`UPDATE users SET ${updateField} = ? WHERE username = ?`, [updateValue, username], () => res.send('Equipped'));
});

app.post('/change-password', (req, res) => {
    const { oldPass, newPass } = req.body;
    const username = req.cookies['username'];
    db.query('UPDATE users SET password = ? WHERE username = ? AND password = ?', [newPass, username, oldPass], (err, result) => {
        if (result.affectedRows > 0) res.send('Success'); else res.send('Wrong password');
    });
});

app.post('/logout', (req, res) => { res.clearCookie('username'); res.redirect('/login.html'); });
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        if(results.length > 0) return res.send('User exists');
        db.query("INSERT INTO users (username, password, tubux, inventory) VALUES (?, ?, 100, '')", [username, password], () => {
            res.cookie('username', username); res.redirect('/');
        });
    });
});
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
        if(results.length > 0) { res.cookie('username', username); res.redirect('/'); } else res.send('Invalid');
    });
});

// --- SOCKET ---
let games = [
    { id: 'parkour_1', name: 'Factory Parkour', author: 'Admin', desc: 'Hardcore Parkour.', visits: 0, online: 0, image: 'logo.png' },
    { id: 'pvp_arena', name: 'Sword PVP Arena', author: 'Admin', desc: 'Fight!', visits: 0, online: 0, image: 'logo.png' }
];
let sessions = {};

io.on('connection', (socket) => {
    socket.emit('updateGameList', games);
    socket.on('joinGame', ({ gameId, username }) => {
        socket.join(gameId);
        db.query('SELECT shirtColor, pantsColor, hatType FROM users WHERE username = ?', [username], (err, res) => {
            // Если в базе пусто, берем дефолт. Шляпа по дефолту NONE
            const outfit = res[0] || { shirtColor: '#cc4444', pantsColor: '#3366cc', hatType: 'hat_none' };
            sessions[socket.id] = { id: socket.id, gameId, username, x:0, y:10, z:0, rot:0, hp: 100, outfit: outfit };
            const game = games.find(g => g.id === gameId);
            if(game) { game.online++; io.emit('updateGameList', games); }
            const playersInRoom = {};
            Object.values(sessions).forEach(s => { if (s.gameId === gameId) playersInRoom[s.id] = s; });
            socket.emit('currentPlayers', playersInRoom);
            socket.to(gameId).emit('newPlayer', sessions[socket.id]);
        });
    });
    socket.on('playerMovement', (d) => { if(sessions[socket.id]) { const s=sessions[socket.id]; s.x=d.x; s.y=d.y; s.z=d.z; s.rot=d.rot; socket.to(s.gameId).emit('playerMoved', {id:socket.id, ...d}); }});
    socket.on('playerHit', (targetId) => {
        const attacker = sessions[socket.id]; const victim = sessions[targetId];
        if (attacker && victim && attacker.gameId === victim.gameId) {
            victim.hp -= 15;
            io.to(victim.gameId).emit('updateHP', { id: victim.id, hp: victim.hp });
            if (victim.hp <= 0) {
                io.to(victim.gameId).emit('playerDied', { id: victim.id });
                setTimeout(() => { if(sessions[victim.id]) { const v = sessions[victim.id]; v.hp = 100; v.x = 0; v.y = 10; v.z = 0; io.to(v.gameId).emit('respawnPlayer', { id: v.id, x: 0, y: 10, z: 0, hp: 100 }); } }, 3000);
            }
        }
    });
    socket.on('sendChat', (msg) => { const s=sessions[socket.id]; if(s) io.to(s.gameId).emit('chatMessage', {user:s.username, text:msg}); });
    socket.on('disconnect', () => { 
        if(sessions[socket.id]) {
            const s = sessions[socket.id];
            const game = games.find(g => g.id === s.gameId);
            if(game) game.online--;
            io.to(s.gameId).emit('removePlayer', socket.id);
            delete sessions[socket.id];
            io.emit('updateGameList', games);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('🚀 Server OK'));