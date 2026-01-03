const socket = io();
const container = document.getElementById('games-container');

socket.on('updateGameList', (games) => {
    container.innerHTML = ''; // Очищаем

    // Сортировка: Сначала по Онлайну (убывание), потом по Визитам
    games.sort((a, b) => b.online - a.online || b.visits - a.visits);

    games.forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card';
        card.innerHTML = `
            <img src="${game.image}" alt="game icon">
            <div class="card-info">
                <h3>${game.name}</h3>
                <p class="author">Author: ${game.author}</p>
                <p class="desc">${game.desc}</p>
                <div class="stats">
                    <span>Visits: ${game.visits}</span>
                    <span class="online-badge">Online: ${game.online}</span>
                </div>
                <button onclick="playGame('${game.id}')">Play</button>
            </div>
        `;
        container.appendChild(card);
    });
});

function playGame(id) {
    window.location.href = `game.html?id=${id}`;
}