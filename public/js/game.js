const socket = io();

const SETTINGS = { mouseSens: 0.002, moveSpeed: 45.0, jumpForce: 160.0, gravity: 700.0, reachDistance: 8.0 };
let camera, scene, renderer;
let playerGroup, playerModel;
let otherPlayers = {}; let limbs = {}; let colliders = []; let debrisList = []; 
let currentUser = 'Guest';
let input = { f: false, b: false, l: false, r: false };
let velocity = new THREE.Vector3();
let onGround = false; let isJumping = false;
const params = new URLSearchParams(window.location.search);
const gameId = params.get('id') || 'pvp_arena';
const isPvpMode = (gameId === 'pvp_arena'); 

let hp = 100; let isDead = false; let isMenuOpen = false; let isAttacking = false; let attackCooldown = false; let currentSlot = 1; let hasWeapon = isPvpMode; 
let camDist = 25; let camRotX = 0; let camRotY = 0.5; let prevTime = performance.now();

// --- FIX: Используем d.username вместо d.user ---
fetch('/api/me')
    .then(r => r.json())
    .then(d => { currentUser = d.username; initGame(); }) 
    .catch(() => initGame());

const chatInput = document.getElementById('chat-input');
if(chatInput) {
    chatInput.addEventListener('keydown', (e) => {
        if(e.key === 'Enter' && chatInput.value) { 
            socket.emit('sendChat', chatInput.value); chatInput.value=''; chatInput.blur(); 
        } e.stopPropagation(); 
    });
}

function initGame() {
    socket.emit('joinGame', { gameId, username: currentUser });

    scene = new THREE.Scene(); scene.background = new THREE.Color(0x87CEEB); scene.fog = new THREE.Fog(0x87CEEB, 20, 600);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffaa00, 0.8); sun.position.set(50, 100, 50); sun.castShadow = true; scene.add(sun);

    loadLevel(gameId);
    setupMenuSystem(); setupNetwork();
    
    if (!isPvpMode) {
        if(document.getElementById('inventory-bar')) document.getElementById('inventory-bar').style.display = 'none';
        if(document.getElementById('health-container')) document.getElementById('health-container').style.display = 'none';
        if(document.getElementById('btn-action')) document.getElementById('btn-action').style.display = 'none';
    } else { setupInventoryUI(); }

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; 
    document.body.appendChild(renderer.domElement);

    setupControls(); setTimeout(captureThumbnail, 2000); animate();
}

function createFaceTexture() {
    const canvas = document.createElement('canvas'); canvas.width=128; canvas.height=128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle='#ffcc99'; ctx.fillRect(0,0,128,128); 
    ctx.fillStyle='black'; ctx.fillRect(35,45,15,15); ctx.fillRect(78,45,15,15);
    ctx.lineWidth=6; ctx.beginPath(); ctx.arc(64,70,25,0.2*Math.PI,0.8*Math.PI); ctx.stroke();
    const faceTex = new THREE.CanvasTexture(canvas); faceTex.magFilter = THREE.NearestFilter;
    return faceTex;
}

function buildCoolSword() {
    const swordGroup = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 0.4), new THREE.MeshPhongMaterial({ color: 0x333333 }));
    handle.position.y = 0.5; swordGroup.add(handle);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 0.6), new THREE.MeshPhongMaterial({ color: 0xffd700 }));
    guard.position.y = 1.3; swordGroup.add(guard);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.5, 0.2), new THREE.MeshPhongMaterial({ color: 0x00ffff, emissive: 0x0044aa, shininess: 100 }));
    blade.position.y = 4.1; swordGroup.add(blade);
    swordGroup.rotation.x = Math.PI / 2; swordGroup.position.set(0, -4.5, 1.0); 
    return swordGroup;
}

function createPlayerModel(outfit) {
    const group = new THREE.Group();
    const model = new THREE.Group();
    group.add(model);

    // FIX: Обработка если outfit null
    const sColor = (outfit && outfit.shirtColor) ? outfit.shirtColor : '#cc4444';
    const pColor = (outfit && outfit.pantsColor) ? outfit.pantsColor : '#3366cc';
    const hatType = (outfit && outfit.hatType) ? outfit.hatType : 'hat_none';

    const skinMat = new THREE.MeshPhongMaterial({ color: 0xffcc99 });
    const sweaterMat = new THREE.MeshPhongMaterial({ color: sColor }); 
    const jeansMat = new THREE.MeshPhongMaterial({ color: pColor });   
    const hatMat = new THREE.MeshPhongMaterial({ color: 0x111111 });
    const faceMat = new THREE.MeshBasicMaterial({ map: createFaceTexture() });

    const body = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 2.5), sweaterMat); 
    body.position.y = 7.5; body.castShadow = true; model.add(body);

    const headMaterials = [skinMat, skinMat, skinMat, skinMat, faceMat, skinMat];
    const head = new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.5, 3.5), headMaterials); 
    head.position.y = 11.5; head.castShadow = true; model.add(head);

    // FIX: Шляпа только если она есть
    if (hatType === 'hat_top' || hatType === 'tophat') {
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.2, 12), hatMat);
        brim.position.y = 1.8; head.add(brim);
        const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 12), hatMat);
        hatTop.position.y = 2.9; head.add(hatTop);
    }

    function limb(x, y, mat) {
        const p = new THREE.Object3D(); p.position.set(x, y, 0);
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 5, 1.5), mat); 
        m.position.y = -2.5; m.castShadow = true; p.add(m); model.add(p); return { pivot: p };
    }
    const lL = limb(-1.2, 5, jeansMat); const lR = limb(1.2, 5, jeansMat);
    const aL = limb(-2.8, 9.5, sweaterMat); const aR = limb(2.8, 9.5, sweaterMat);

    let sword = null;
    if (isPvpMode) { sword = buildCoolSword(); sword.visible = true; aR.pivot.add(sword); }
    
    // Сохраняем цвета для эффекта смерти
    group.userData = { sColor, pColor, hatType };

    return { group, model, limbs: { legL:lL.pivot, legR:lR.pivot, armL:aL.pivot, armR:aR.pivot, sword } };
}

function addOtherPlayer(info) {
    const p = createPlayerModel(info.outfit);
    const mesh = p.group;
    const cvs = document.createElement('canvas'); const ctx = cvs.getContext('2d');
    ctx.font='Bold 24px Arial'; ctx.fillStyle='white'; ctx.textAlign='center'; ctx.shadowColor="black"; ctx.shadowBlur=4;
    ctx.fillText(info.username, 150, 30);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cvs), transparent: true }));
    sprite.position.set(0, 17, 0); sprite.scale.set(15, 8, 1); mesh.add(sprite);
    mesh.position.set(info.x, info.y, info.z);
    scene.add(mesh);
    otherPlayers[info.id] = { 
        username: info.username, mesh: mesh, model: p.model, limbs: p.limbs,
        targetPos: new THREE.Vector3(info.x, info.y, info.z), targetRot: 0, isMoving: false, hasWeapon: isPvpMode,
        outfit: info.outfit
    };
}

function loadLevel(id) {
    colliders = []; 
    function box(x, y, z, w, h, d, c) {
        const geo = new THREE.BoxGeometry(w, h, d); const mat = new THREE.MeshPhongMaterial({ color: c });
        const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = true;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.1 }));
        m.add(edges); scene.add(m); colliders.push(new THREE.Box3().setFromObject(m));
    }
    if (id === 'parkour_1') {
        box(0, -5, 0, 20, 2, 20, 0x444444); box(0, 0, 20, 6, 1, 6, 0xffaa00); box(0, 2, 35, 6, 1, 6, 0xffaa00);
        box(0, 4, 50, 6, 1, 6, 0xffaa00); box(0, 4, 70, 2, 1, 25, 0x333333); box(0, 8, 90, 8, 1, 8, 0x555555); 
        box(10, 11, 90, 4, 1, 4, 0x00aaff); box(18, 14, 90, 4, 1, 4, 0x00aaff); box(26, 17, 90, 4, 1, 4, 0x00aaff);
        box(45, 17, 90, 15, 2, 15, 0x222222); 
        const goal = new THREE.Mesh(new THREE.BoxGeometry(4,4,4), new THREE.MeshBasicMaterial({color:0x00ff00}));
        goal.position.set(45, 22, 90); scene.add(goal);
    } else { 
        box(0, -5, 0, 120, 2, 120, 0x333333); box(0, 5, -60, 120, 20, 2, 0x222222); box(0, 5, 60, 120, 20, 2, 0x222222);
        box(-60, 5, 0, 2, 20, 120, 0x222222); box(60, 5, 0, 2, 20, 120, 0x222222);
        box(-30, 0, -30, 10, 8, 10, 0x884444); box(30, 0, 30, 10, 8, 10, 0x884444); box(0, 2, 0, 20, 4, 20, 0x666666);
    }
}

function resolveCollision(pos, radius, height) {
    const box = new THREE.Box3();
    box.set(new THREE.Vector3(pos.x - radius * 0.8, pos.y, pos.z - radius * 0.8), new THREE.Vector3(pos.x + radius * 0.8, pos.y + height, pos.z + radius * 0.8));
    for (let c of colliders) { if (box.intersectsBox(c)) return true; }
    return false;
}

// --- FIX: Анимация смерти с цветами ---
class Debris {
    constructor(mesh, velocity) { this.mesh = mesh; this.velocity = velocity; scene.add(this.mesh); }
    update(delta) {
        this.velocity.y -= 20.0 * delta; this.mesh.position.add(this.velocity.clone().multiplyScalar(delta));
        this.mesh.rotation.x += this.velocity.z * delta; this.mesh.rotation.z += this.velocity.x * delta;
        if (this.mesh.position.y < -5) { this.mesh.position.y = -5; this.velocity.y *= -0.5; this.velocity.x *= 0.9; }
    }
}

function breakPlayerApart(pos, outfit = null) {
    const sC = outfit ? outfit.shirtColor : '#cc4444';
    const pC = outfit ? outfit.pantsColor : '#3366cc';
    const hatType = outfit ? outfit.hatType : 'hat_none';

    const parts = [
        { s:[3.5,3.5,3.5], p:[0,6.5,0], c:0xffcc99 }, 
        { s:[4,5,2.5], p:[0,2.5,0], c:sC },           
        { s:[1.5,5,1.5], p:[-1.2,0,0], c:pC },        
        { s:[1.5,5,1.5], p:[1.2,0,0], c:pC },         
        { s:[1.5,5,1.5], p:[-2.8,4.5,0], c:sC },      
        { s:[1.5,5,1.5], p:[2.8,4.5,0], c:sC }        
    ];
    parts.forEach(p => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...p.s), new THREE.MeshPhongMaterial({color:p.c}));
        mesh.position.set(pos.x+p.p[0], pos.y+p.p[1], pos.z+p.p[2]);
        const vel = new THREE.Vector3((Math.random()-0.5)*10, 5+Math.random()*10, (Math.random()-0.5)*10);
        debrisList.push(new Debris(mesh, vel));
    });
    
    // Спавним шляпу, только если она была
    if (hatType === 'hat_top' || hatType === 'tophat') {
        const hat = new THREE.Mesh(new THREE.CylinderGeometry(1.6,1.6,2,12), new THREE.MeshPhongMaterial({color:0x111111}));
        hat.position.set(pos.x, pos.y+8, pos.z);
        debrisList.push(new Debris(hat, new THREE.Vector3(0, 10, 0)));
    }
    setTimeout(() => { debrisList.forEach(d => scene.remove(d.mesh)); debrisList=[]; }, 2900);
}

function setupMenuSystem() {
    document.addEventListener('keydown', (e) => { if (e.code === 'Escape') toggleMenu(!isMenuOpen); });
    const menuBtn = document.getElementById('btn-open-menu');
    if (menuBtn) {
        menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(true); });
        menuBtn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); toggleMenu(true); }, { passive: false });
    }
    const resume = document.getElementById('btn-resume'); if(resume) resume.onclick = () => toggleMenu(false);
    const leave = document.getElementById('btn-leave'); if(leave) leave.onclick = () => window.location.href = '/';
    const reset = document.getElementById('btn-reset'); if(reset) reset.onclick = () => { toggleMenu(false); socket.emit('resetCharacter'); };
}

function toggleMenu(show) {
    isMenuOpen = show;
    const menu = document.getElementById('esc-menu');
    if(menu) menu.style.display = show ? 'flex' : 'none';
    if (show) { document.exitPointerLock(); updatePlayerListUI(); } else { document.body.requestPointerLock().catch(e => {}); }
}

function updatePlayerListUI() {
    const list = document.getElementById('player-list-ul'); if(!list) return;
    list.innerHTML = '';
    const addRow = (name) => {
        const li = document.createElement('li'); li.className = 'player-row';
        li.innerHTML = `<div class="player-avatar-preview" style="background: #ffcc99;"></div><span class="player-name">${name}</span>`;
        list.appendChild(li);
    };
    addRow(currentUser + " (You)");
    Object.values(otherPlayers).forEach(p => addRow(p.username || "Player"));
}

function setupInventoryUI() {
    if (!isPvpMode) return; 
    const slots = document.querySelectorAll('.slot');
    slots.forEach(slot => slot.addEventListener('mousedown', (e) => { e.preventDefault(); selectSlot(parseInt(slot.dataset.key)); }, { passive: false }));
    document.addEventListener('keydown', (e) => { if(['1','2','3'].includes(e.key)) selectSlot(parseInt(e.key)); });
}

function selectSlot(num) {
    if (!isPvpMode) return;
    currentSlot = num;
    document.querySelectorAll('.slot').forEach(s => s.classList.remove('active'));
    const btn = document.querySelector(`.slot[data-key="${num}"]`);
    if(btn) btn.classList.add('active');
    hasWeapon = (num === 1);
    if(limbs.sword) limbs.sword.visible = hasWeapon;
    socket.emit('playerMovement', { x: playerGroup.position.x, y: playerGroup.position.y, z: playerGroup.position.z, rot: playerModel.rotation.y, action: 'equip_change', weapon: hasWeapon });
}

function updateHealthBar(hpVal) {
    const fill = document.getElementById('health-bar-fill');
    const percent = Math.max(0, Math.min(100, hpVal));
    if(fill) { fill.style.width = percent + '%'; fill.style.background = percent > 60 ? '#00ff00' : (percent > 30 ? 'orange' : 'red'); }
    const label = document.getElementById('health-label'); if(label) label.innerText = `Health: ${percent}`;
    if (percent < 100 && percent < hp) { document.body.style.boxShadow = "inset 0 0 50px rgba(255,0,0,0.5)"; setTimeout(() => document.body.style.boxShadow = "none", 100); }
}

function setupNetwork() {
    socket.on('currentPlayers', (serverPlayers) => {
        if(playerGroup) scene.remove(playerGroup);
        const myData = serverPlayers[socket.id];
        if(myData) {
            const p = createPlayerModel(myData.outfit);
            playerGroup = p.group; playerModel = p.model; limbs = p.limbs;
            playerGroup.position.set(myData.x, myData.y, myData.z);
            // Сохраняем одежду для анимации смерти
            playerGroup.userData.outfit = myData.outfit;
            scene.add(playerGroup);
        }
        for (let id in serverPlayers) { if (id !== socket.id) addOtherPlayer(serverPlayers[id]); }
    });
    socket.on('newPlayer', p => addOtherPlayer(p));
    socket.on('playerMoved', p => {
        if(otherPlayers[p.id]) {
            const pl = otherPlayers[p.id];
            pl.targetPos.set(p.x, p.y, p.z); pl.targetRot = p.rot; pl.isMoving = true;
            if(pl.moveTimeout) clearTimeout(pl.moveTimeout); pl.moveTimeout = setTimeout(()=>pl.isMoving=false, 100);
            if(p.action === 'attack') playAttackAnimation(pl.limbs);
            if(p.action === 'equip_change') { pl.hasWeapon = p.weapon; if(pl.limbs.sword) pl.limbs.sword.visible = p.weapon; }
        }
    });
    socket.on('updateHP', data => { if(data.id === socket.id) { updateHealthBar(data.hp); hp = data.hp; } });
    
    // FIX: СМЕРТЬ с правильной одеждой
    socket.on('playerDied', data => {
        if(data.id === socket.id) {
            isDead = true; playerGroup.visible = false; hp=0; updateHealthBar(0);
            breakPlayerApart(playerGroup.position, playerGroup.userData.outfit);
        } else if(otherPlayers[data.id]) {
            otherPlayers[data.id].mesh.visible = false;
            breakPlayerApart(otherPlayers[data.id].mesh.position, otherPlayers[data.id].outfit);
        }
    });

    socket.on('respawnPlayer', data => {
        if(data.id===socket.id){ 
            playerGroup.visible=true; playerGroup.position.set(data.x,data.y,data.z); velocity.set(0,0,0); hp=100; updateHealthBar(100); isDead=false;
        } else if(otherPlayers[data.id]) {
            otherPlayers[data.id].mesh.visible = true; otherPlayers[data.id].mesh.position.set(data.x,data.y,data.z);
        }
    });
    socket.on('removePlayer', id => { if(otherPlayers[id]) { scene.remove(otherPlayers[id].mesh); delete otherPlayers[id]; updatePlayerListUI(); }});
    socket.on('chatMessage', msg => { const m = document.getElementById('messages'); if(m) { m.innerHTML += `<div><b style="color:#ff8800">${msg.user}:</b> ${msg.text}</div>`; m.scrollTop = m.scrollHeight; } });
}

function performAttack() {
    if (!isPvpMode || !hasWeapon || isAttacking || attackCooldown || isMenuOpen || isDead) return;
    isAttacking = true; attackCooldown = true;
    playAttackAnimation(limbs);
    socket.emit('playerMovement', { x: playerGroup.position.x, y: playerGroup.position.y, z: playerGroup.position.z, rot: playerModel.rotation.y, action: 'attack' });
    checkHit(); setTimeout(() => isAttacking = false, 400); setTimeout(() => attackCooldown = false, 600);
}

function checkHit() {
    const myPos = playerGroup.position; const lookDir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerModel.rotation.y);
    let hitId = null; let minDist = SETTINGS.reachDistance;
    for (let id in otherPlayers) {
        const other = otherPlayers[id]; const dist = myPos.distanceTo(other.mesh.position);
        if (dist < minDist) {
            const dirToEnemy = other.mesh.position.clone().sub(myPos).normalize();
            if (lookDir.angleTo(dirToEnemy) < 1.5) { hitId = id; minDist = dist; }
        }
    }
    if (hitId) socket.emit('playerHit', hitId);
}

function playAttackAnimation(limbSet) {
    if (!limbSet.sword) return; 
    const startRot = -1.2; const windupRot = -2.0; const slashRot = -0.2; let progress = 0; const speed = 0.15;
    function frame() {
        progress += speed;
        if (progress <= 1.0) {
            let currentAngle;
            if (progress < 0.3) currentAngle = startRot + (windupRot - startRot) * (progress/0.3);
            else currentAngle = windupRot + (slashRot - windupRot) * Math.pow((progress-0.3)/0.7, 2);
            limbSet.armR.rotation.x = currentAngle; requestAnimationFrame(frame);
        }
    } frame();
}

function animateLimbs(limbSet, time, isMoving, isJumping, hasSwordEquipped) {
    if (isAttacking && limbSet === limbs) return; 
    if (isMoving) { const s = time * 0.015; limbSet.legL.rotation.x = Math.sin(s) * 0.8; limbSet.legR.rotation.x = -Math.sin(s) * 0.8; } 
    else { limbSet.legL.rotation.x = 0; limbSet.legR.rotation.x = 0; }
    if (isJumping) { limbSet.armL.rotation.x = -Math.PI; limbSet.armR.rotation.x = -Math.PI; } 
    else {
        limbSet.armL.rotation.x = isMoving ? -Math.sin(time * 0.015) * 0.8 : 0;
        if (hasSwordEquipped && limbSet.sword) { limbSet.armR.rotation.x = -1.2 + Math.sin(time * 0.005) * 0.05; limbSet.armR.rotation.z = 0.2; } 
        else { limbSet.armR.rotation.x = isMoving ? Math.sin(time * 0.015) * 0.8 : 0; limbSet.armR.rotation.z = 0; }
    }
}

function captureThumbnail() { renderer.render(scene, camera); socket.emit('updateThumbnail', { gameId: gameId, image: renderer.domElement.toDataURL('image/jpeg', 0.5) }); }

function setupControls() {
    document.body.addEventListener('click', (event) => {
        if(event.target.closest('.ui-btn') || event.target.closest('#chat-input') || isMenuOpen) return;
        if(document.pointerLockElement !== document.body) { document.body.requestPointerLock().catch(e => {}); } else { performAttack(); }
    });
    document.addEventListener('mousemove', e => {
        if(document.pointerLockElement === document.body) {
            camRotX -= e.movementX * SETTINGS.mouseSens; camRotY -= e.movementY * SETTINGS.mouseSens; camRotY = Math.max(0.1, Math.min(1.5, camRotY));
        }
    });
    let tx=0, ty=0;
    document.addEventListener('touchstart', e => { if(e.touches.length===1){tx=e.touches[0].clientX; ty=e.touches[0].clientY;} }, { passive: false });
    document.addEventListener('touchmove', e => { if(!document.pointerLockElement && tx!==0) { camRotX -= (e.touches[0].clientX - tx)*0.005; camRotY -= (e.touches[0].clientY - ty)*0.005; tx=e.touches[0].clientX; ty=e.touches[0].clientY; } }, { passive: false });
    const key = (c, s) => {
        if(c==='KeyW') input.f=s; if(c==='KeyS') input.b=s; if(c==='KeyA') input.l=s; if(c==='KeyD') input.r=s;
        if(c==='Space' && s && onGround) { velocity.y = SETTINGS.jumpForce; onGround=false; isJumping=true; }
    };
    document.addEventListener('keydown', e=>key(e.code,true)); document.addEventListener('keyup', e=>key(e.code,false));
    const btn = (id,k) => { const b=document.getElementById(id); if(b){ b.addEventListener('touchstart',(e)=>{e.preventDefault();input[k]=true}, { passive: false }); b.addEventListener('touchend',(e)=>{e.preventDefault();input[k]=false}, { passive: false }); }};
    btn('btn-up','f'); btn('btn-down','b'); btn('btn-left','l'); btn('btn-right','r');
    const jb=document.getElementById('btn-jump'); if(jb) jb.addEventListener('touchstart',(e)=>{e.preventDefault(); if(onGround){velocity.y=SETTINGS.jumpForce;onGround=false;isJumping=true;}}, { passive: false });
    const ab=document.getElementById('btn-action'); if(ab) ab.addEventListener('touchstart', (e)=>{ e.preventDefault(); performAttack(); }, { passive: false });
}

function animate() {
    requestAnimationFrame(animate); const time = performance.now(); const delta = Math.min((time - prevTime) / 1000, 0.1); debrisList.forEach(d => d.update(delta));
    if (isMenuOpen || isDead || !playerGroup) { prevTime = time; renderer.render(scene, camera); return; }
    velocity.y -= SETTINGS.gravity * delta; playerGroup.position.y += velocity.y * delta;
    if (resolveCollision(playerGroup.position, 2, 5)) { if(velocity.y < 0) { playerGroup.position.y -= velocity.y * delta; velocity.y=0; onGround=true; isJumping=false; } else if(velocity.y > 0) { playerGroup.position.y -= velocity.y * delta; velocity.y=0; } } else onGround=false;
    if(playerGroup.position.y < -30) { velocity.set(0,0,0); playerGroup.position.set(0,10,0); hp=100; updateHealthBar(100); }
    const zIn = Number(input.f) - Number(input.b); const xIn = Number(input.l) - Number(input.r);
    if (zIn !== 0 || xIn !== 0) {
        const angle = camRotX + Math.atan2(-xIn, -zIn); const vx = Math.sin(angle) * SETTINGS.moveSpeed * delta; const vz = Math.cos(angle) * SETTINGS.moveSpeed * delta;
        playerGroup.position.x += vx; if (resolveCollision(playerGroup.position, 2, 4)) playerGroup.position.x -= vx;
        playerGroup.position.z += vz; if (resolveCollision(playerGroup.position, 2, 4)) playerGroup.position.z -= vz;
        let rotDiff = angle - playerModel.rotation.y; while (rotDiff > Math.PI) rotDiff -= Math.PI*2; while (rotDiff < -Math.PI) rotDiff += Math.PI*2; playerModel.rotation.y += rotDiff * 0.4;
    }
    const tX = playerGroup.position.x + camDist * Math.sin(camRotX) * Math.cos(camRotY); const tZ = playerGroup.position.z + camDist * Math.cos(camRotX) * Math.cos(camRotY); const tY = playerGroup.position.y + camDist * Math.sin(camRotY);
    camera.position.lerp(new THREE.Vector3(tX, tY, tZ), 0.5); camera.lookAt(playerGroup.position.x, playerGroup.position.y + 6, playerGroup.position.z);
    if (zIn!==0 || xIn!==0 || Math.abs(velocity.y)>0) { socket.emit('playerMovement', { x: playerGroup.position.x, y: playerGroup.position.y, z: playerGroup.position.z, rot: playerModel.rotation.y, action: null }); }
    animateLimbs(limbs, time, (zIn!==0||xIn!==0)&&onGround, isJumping, hasWeapon);
    Object.values(otherPlayers).forEach(p => { p.mesh.position.lerp(p.targetPos, 0.2); p.model.rotation.y = p.targetRot; animateLimbs(p.limbs, time, p.isMoving, false, p.hasWeapon); });
    prevTime = time; renderer.render(scene, camera);
}
window.addEventListener('resize', () => { camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth,window.innerHeight); });