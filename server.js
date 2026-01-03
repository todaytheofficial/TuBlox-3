const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());

// --- БАЗА ДАННЫХ ---
const USERS_FILE = 'users.json';
let users = {};

if (fs.existsSync(USERS_FILE)) {
    try { users = JSON.parse(fs.readFileSync(USERS_FILE)); } catch(e) {}
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// --- АВТОРИЗАЦИЯ ---
app.get('/api/me', (req, res) => {
    const username = req.cookies['username'];
    if (username && users[username]) res.json({ user: username });
    else res.status(401).json({ error: 'Not logged in' });
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.send('Missing fields');
    if (users[username]) return res.send('User already exists');
    users[username] = { password, skinColor: '#ff9900' };
    saveUsers();
    res.cookie('username', username);
    res.redirect('/');
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!users[username] || users[username].password !== password) return res.send('Invalid credentials');
    res.cookie('username', username);
    res.redirect('/');
});

// --- ЛОГИКА ИГРЫ ---

let games = [
    {
        id: 'parkour_1',
        name: 'Factory Parkour',
        author: 'Admin',
        desc: 'Сложный паркур с новой физикой.',
        visits: 0, online: 0, image: 'logo.png'
    },
    {
        id: 'pvp_arena',
        name: 'Sword PVP Arena',
        author: 'Admin',
        desc: 'Дерись на мечах! (ЛКМ / Tap to attack)',
        visits: 0, online: 0, image: 'logo.png'
    }
];

let sessions = {}; 

io.on('connection', (socket) => {
    socket.emit('updateGameList', games);

    socket.on('joinGame', ({ gameId, username }) => {
        const isAlreadyPlaying = Object.values(sessions).some(s => s.username === username && s.gameId === gameId);
        socket.join(gameId);
        // Добавляем hp: 100 для PvP
        sessions[socket.id] = { 
            id: socket.id, gameId, username, 
            counted: !isAlreadyPlaying, 
            x:0, y:10, z:0, rot:0, 
            hp: 100, maxHp: 100 
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
        if (game) {
            game.image = image;
            io.emit('updateGameList', games);
        }
    });

      socket.on('resetCharacter', () => {
        const s = sessions[socket.id];
        if (s && s.hp > 0) {
            s.hp = 0;
            // Сообщаем всем, что он умер (для анимации)
            io.to(s.gameId).emit('playerDied', { id: s.id });
            
            // Сообщаем о смерти в чат
            io.to(s.gameId).emit('chatMessage', { user: 'System', text: `☠️ ${s.username} reset their character.` });

            // Запускаем таймер респауна (3 секунды лежим разваленным)
            setTimeout(() => {
                if (sessions[socket.id]) { // Проверка, не вышел ли он
                    const s = sessions[socket.id];
                    s.hp = 100;
                    s.x = 0; s.y = 10; s.z = 0;
                    io.to(s.gameId).emit('respawnPlayer', { id: s.id, x: 0, y: 10, z: 0, hp: 100 });
                }
            }, 3000);
        }
    });

    socket.on('playerMovement', (data) => {
        const s = sessions[socket.id];
        if (s) {
            s.x = data.x; s.y = data.y; s.z = data.z; s.rot = data.rot;
            // Передаем действие (аттаку) другим
            socket.to(s.gameId).emit('playerMoved', { 
                id: socket.id, x: s.x, y: s.y, z: s.z, rot: s.rot, 
                action: data.action // 'attack' или null
            });
        }
    });

// === ЛОГИКА БОЯ (SERVER DEBUG) ===
    socket.on('playerHit', (targetId) => {
        const attacker = sessions[socket.id];
        const victim = sessions[targetId];

        // 1. Проверяем, существуют ли игроки
        if (!attacker || !victim) {
            console.log(`[FAIL] Attacker or Victim not found. ID: ${socket.id} -> ${targetId}`);
            return;
        }

        // 2. Проверяем, в одной ли они игре
        if (attacker.gameId !== victim.gameId) {
            console.log(`[FAIL] Different rooms: ${attacker.username}(${attacker.gameId}) vs ${victim.username}(${victim.gameId})`);
            return;
        }

        // 3. Проверяем, не бьет ли сам себя
        if (attacker.id === victim.id) {
             console.log(`[FAIL] ${attacker.username} hit themselves.`);
             return;
        }

        // --- ЕСЛИ ВСЕ ОК, НАНОСИМ УРОН ---
        
        console.log(`[HIT] ${attacker.username} hit ${victim.username}. Old HP: ${victim.hp}`);
        
        victim.hp -= 15; // Снимаем 15 хп

        // Отправляем ВСЕМ в комнате (чтобы и жертва, и атакующий видели обновление)
        io.to(victim.gameId).emit('updateHP', { id: victim.id, hp: victim.hp });

        // Проверка на смерть
            if (victim.hp <= 0) {
                io.to(victim.gameId).emit('chatMessage', { user: 'System', text: `⚔️ ${victim.username} was slain by ${attacker.username}!` });
                
                // Сначала анимация смерти
                io.to(victim.gameId).emit('playerDied', { id: victim.id });

                // Респаун через 3 секунды
                setTimeout(() => {
                    if (sessions[victim.id]) {
                        const v = sessions[victim.id];
                        v.hp = 100; v.x = 0; v.y = 10; v.z = 0;
                        io.to(v.gameId).emit('respawnPlayer', { id: v.id, x: 0, y: 10, z: 0, hp: 100 });
                    }
                }, 3000);
            }
    });
    // =================

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

http.listen(3000, () => { console.log('Server running: http://localhost:3000'); });