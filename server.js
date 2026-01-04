require('dotenv').config(); 
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

// 1. Раздаем статику (CSS, JS, Картинки) из папки public
app.use(express.static(path.join(__dirname, 'public')));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());

// --- MYSQL ---
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
    if (err) {
        console.error('❌ Ошибка БД:', err.code);
    } else {
        console.log('✅ MySQL подключен!');
        connection.release();
    }
});

// --- МАРШРУТИЗАЦИЯ (VIEWS) ---
// Так как HTML теперь не в public, мы должны отправлять их вручную

// Главная страница (Вход)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Страница игры
app.get('/game.html', (req, res) => {
    // Проверка: если не залогинен, кидаем на главную (защита)
    const username = req.cookies['username'];
    if (!username) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'views', 'game.html'));
});

// Если у тебя есть register.html, добавь это:
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});


// Маршрут Профиля (http://localhost:3000/profile/1)
app.get('/profile/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'profile.html'));
});

// --- API ---

// Получить текущего пользователя (с ID)
app.get('/api/me', (req, res) => {
    const username = req.cookies['username'];
    if (!username) return res.status(401).json({ error: 'Not logged in' });
    
    db.query('SELECT id, username FROM users WHERE username = ?', [username], (err, results) => {
        if (err || results.length === 0) return res.status(401).json({ error: 'User not found' });
        res.json({ id: results[0].id, user: results[0].username });
    });
});


// Получить данные профиля по ID (публичные)
app.get('/api/user/:id', (req, res) => {
    const userId = req.params.id;
    db.query('SELECT id, username, created_at FROM users WHERE id = ?', [userId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(results[0]);
    });
});


app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.send('Missing fields');

    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        if (results.length > 0) return res.send('User already exists');
        db.query('INSERT INTO users (username, password, skinColor) VALUES (?, ?, ?)', 
            [username, password, '#ff9900'], (err) => {
            if (err) return res.send('Database error');
            res.cookie('username', username);
            res.redirect('/');
        });
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
        if (results.length > 0) {
            res.cookie('username', username);
            res.redirect('/');
        } else {
            res.send('Invalid credentials');
        }
    });
});



// --- ИГРОВАЯ ЛОГИКА (SOCKET.IO) ---
let games = [
    { id: 'parkour_1', name: 'Factory Parkour', author: 'Admin', desc: 'Hardcore Parkour.', visits: 0, online: 0, image: 'logo.png' },
    { id: 'pvp_arena', name: 'Sword PVP Arena', author: 'Admin', desc: 'Fight!', visits: 0, online: 0, image: 'logo.png' }
];

let sessions = {}; 

io.on('connection', (socket) => {
    socket.emit('updateGameList', games);

    socket.on('joinGame', ({ gameId, username }) => {
        const isAlreadyPlaying = Object.values(sessions).some(s => s.username === username && s.gameId === gameId);
        socket.join(gameId);
        sessions[socket.id] = { 
            id: socket.id, gameId, username, counted: !isAlreadyPlaying, 
            x:0, y:10, z:0, rot:0, hp: 100 
        };

        const game = games.find(g => g.id === gameId);
        if (game) {
            if (!isAlreadyPlaying) { game.online++; game.visits++; }
            io.emit('updateGameList', games);
            
            const playersInRoom = {};
            Object.values(sessions).forEach(s => { if (s.gameId === gameId) playersInRoom[s.id] = s; });
            socket.emit('currentPlayers', playersInRoom);
            socket.to(gameId).emit('newPlayer', sessions[socket.id]);
            io.to(gameId).emit('chatMessage', { user: 'System', text: `${username} joined.` });
        }
    });

    socket.on('updateThumbnail', ({ gameId, image }) => {
        const game = games.find(g => g.id === gameId);
        if (game) { game.image = image; io.emit('updateGameList', games); }
    });

    socket.on('resetCharacter', () => {
        const s = sessions[socket.id];
        if (s && s.hp > 0) {
            s.hp = 0;
            io.to(s.gameId).emit('playerDied', { id: s.id });
            io.to(s.gameId).emit('chatMessage', { user: 'System', text: `☠️ ${s.username} reset.` });
            setTimeout(() => {
                if (sessions[socket.id]) {
                    const s = sessions[socket.id];
                    s.hp = 100; s.x = 0; s.y = 10; s.z = 0;
                    io.to(s.gameId).emit('respawnPlayer', { id: s.id, x: 0, y: 10, z: 0, hp: 100 });
                }
            }, 3000);
        }
    });

    socket.on('playerMovement', (data) => {
        const s = sessions[socket.id];
        if (s) {
            s.x = data.x; s.y = data.y; s.z = data.z; s.rot = data.rot;
            socket.to(s.gameId).emit('playerMoved', { 
                id: socket.id, x: s.x, y: s.y, z: s.z, rot: s.rot, action: data.action, weapon: data.weapon 
            });
        }
    });

    socket.on('playerHit', (targetId) => {
        const attacker = sessions[socket.id];
        const victim = sessions[targetId];
        if (attacker && victim && attacker.gameId === victim.gameId && attacker.id !== victim.id) {
            victim.hp -= 15;
            io.to(victim.gameId).emit('updateHP', { id: victim.id, hp: victim.hp });
            if (victim.hp <= 0) {
                io.to(victim.gameId).emit('playerDied', { id: victim.id });
                io.to(victim.gameId).emit('chatMessage', { user: 'System', text: `⚔️ ${victim.username} was slain by ${attacker.username}!` });
                setTimeout(() => {
                    if (sessions[victim.id]) {
                        const v = sessions[victim.id];
                        v.hp = 100; v.x = 0; v.y = 10; v.z = 0;
                        io.to(v.gameId).emit('respawnPlayer', { id: v.id, x: 0, y: 10, z: 0, hp: 100 });
                    }
                }, 3000);
            }
        }
    });

    socket.on('sendChat', (msg) => {
        const s = sessions[socket.id];
        if (s) io.to(s.gameId).emit('chatMessage', { user: s.username, text: msg });
    });

    socket.on('disconnect', () => {
        const s = sessions[socket.id];
        if (s) {
            const game = games.find(g => g.id === s.gameId);
            io.to(s.gameId).emit('removePlayer', socket.id);
            if (game && s.counted) {
                const still = Object.values(sessions).some(ss => ss.username === s.username && ss.gameId === s.gameId && ss !== s);
                if (!still) game.online = Math.max(0, game.online - 1);
            }
            delete sessions[socket.id];
            io.emit('updateGameList', games);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`🚀 Server running on port ${PORT}`); });