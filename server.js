// ══════════════════════════════════════════════════════════════════════
//   SlendyTubIA — Servidor Multiplayer Completo
//   Stack: Node.js + Express + Socket.IO
//   Deploy: Render.com  →  https://mygame-u5c9.onrender.com
//
//   EVENTOS ESCUCHADOS DEL CLIENTE:
//     create_room, join_room, list_rooms, leave_room
//     start_game, player_update, lobby_chat, game_chat
//     grab_player, escaped_grab, second_instinct, lms_event, player_died
//
//   EVENTOS EMITIDOS AL CLIENTE:
//     room_created, room_joined, room_error, rooms_list
//     player_joined, player_left
//     lobby_chat, game_chat
//     game_start, players_update
//     grab_start, grab_released, grab_health
//     second_instinct_active
//     survivors_win, killer_phase2
//     lms_event, game_over
// ══════════════════════════════════════════════════════════════════════

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const crypto     = require('crypto');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 10000;

// ── Servir el cliente HTML (opcional) ───────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    const idx = path.join(__dirname, 'public', 'index.html');
    res.sendFile(idx, err => {
        if (err) res.send('<h2>SlendyTubIA Server Running ✅</h2>');
    });
});

// ── Estructura de datos ──────────────────────────────────────────────
/*
  rooms[code] = {
      code,
      hostId,
      hostName,
      public: true,
      phase: 'lobby' | 'playing' | 'ended',
      killerPhase: 1 | 2,
      players: {
          [socketId]: {
              id, name, character, skin, avatarUrl,
              pos: {x,y,z}, yaw, health, dead, isKiller
          }
      },
      custardCollected: 0,   // cuántos custards recogieron los sobrevivientes
      aliveCount: 0,
      grabTarget: null,      // id del jugador actualmente agarrado
      grabInterval: null
  }
*/
const rooms = {};

// ── Utilidades ────────────────────────────────────────────────────────
function generateCode(len = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
    // Garantizar unicidad
    return rooms[code] ? generateCode(len) : code;
}

function roomPublicData(room) {
    return {
        code:        room.code,
        hostName:    room.players[room.hostId]?.name || 'Host',
        playerCount: Object.keys(room.players).length,
        phase:       room.phase
    };
}

function getPublicRooms() {
    return Object.values(rooms)
        .filter(r => r.public && r.phase === 'lobby' && Object.keys(r.players).length < 7)
        .map(roomPublicData);
}

function cleanRoom(code) {
    const room = rooms[code];
    if (!room) return;
    if (room.grabInterval) clearInterval(room.grabInterval);
    if (room.updateInterval) clearInterval(room.updateInterval);
    delete rooms[code];
    console.log(`[Room ${code}] Eliminada`);
}

function broadcastPlayerUpdate(room) {
    // Enviar posiciones a todos los jugadores de la sala
    const data = {};
    Object.entries(room.players).forEach(([id, p]) => {
        data[id] = {
            id, name: p.name, avatarUrl: p.avatarUrl,
            character: p.character, skin: p.skin,
            pos: p.pos, yaw: p.yaw, health: p.health,
            dead: p.dead, isKiller: p.isKiller
        };
    });
    io.to(room.code).emit('players_update', data);
}

function checkSurvivorsWin(room) {
    // Sobrevivientes ganan si recolectan 10 custards O derrotan al killer (HP = 0)
    if (room.custardCollected >= 10) {
        io.to(room.code).emit('survivors_win');
        // Killer entra en fase 2
        if (room.killerPhase < 2) {
            room.killerPhase = 2;
            io.to(room.code).emit('killer_phase2');
            room.custardCollected = 0; // resetear para siguiente ronda
            console.log(`[Room ${room.code}] Killer entró en fase 2`);
        } else {
            // Fase 2 ya activa — sobrevivientes ganan definitivamente
            endGame(room, 'survivors');
        }
    }
}

function checkAllDead(room) {
    const survivors = Object.values(room.players).filter(p => !p.isKiller && !p.dead);
    const killer    = Object.values(room.players).find(p => p.isKiller);

    if (survivors.length === 0) {
        endGame(room, 'killer');
        return;
    }
    if (survivors.length === 1 && killer) {
        // Evento LMS
        const survivor = survivors[0];
        io.to(room.code).emit('lms_event', { survivorId: survivor.id });
        console.log(`[Room ${room.code}] LMS: ${survivor.name}`);
    }
}

function endGame(room, winners) {
    room.phase = 'ended';
    if (room.grabInterval) { clearInterval(room.grabInterval); room.grabInterval = null; }
    if (room.updateInterval) { clearInterval(room.updateInterval); room.updateInterval = null; }
    io.to(room.code).emit('game_over', {
        winners,
        msg: winners === 'killer' ? 'El killer elimino a todos.' : 'Los sobrevivientes escaparon.'
    });
    console.log(`[Room ${room.code}] Fin de partida — ganador: ${winners}`);
    // Limpiar sala después de 30s
    setTimeout(() => cleanRoom(room.code), 30000);
}

// ── Socket.IO ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[+] Conectado: ${socket.id}`);

    // ── Crear sala ─────────────────────────────────────────────
    socket.on('create_room', ({ name, character, skin, avatarUrl }) => {
        const code = generateCode();
        const player = {
            id: socket.id, name: name || 'Host',
            character: character || 'walter',
            skin: skin || 'default',
            avatarUrl: avatarUrl || '',
            pos: { x: 0, y: 10, z: 0 }, yaw: 0,
            health: 250, dead: false, isKiller: false, isHost: true
        };
        rooms[code] = {
            code, hostId: socket.id, public: true,
            phase: 'lobby', killerPhase: 1,
            players: { [socket.id]: player },
            custardCollected: 0, aliveCount: 0,
            grabTarget: null, grabInterval: null, updateInterval: null
        };
        socket.join(code);
        socket.roomCode = code;
        socket.emit('room_created', {
            code, players: rooms[code].players, isHost: true
        });
        console.log(`[Room ${code}] Creada por ${name}`);
    });

    // ── Unirse a sala ──────────────────────────────────────────
    socket.on('join_room', ({ code, name, character, skin, avatarUrl }) => {
        const room = rooms[code];
        if (!room) { socket.emit('room_error', { msg: 'Sala no encontrada: ' + code }); return; }
        if (room.phase !== 'lobby') { socket.emit('room_error', { msg: 'La partida ya comenzó' }); return; }
        if (Object.keys(room.players).length >= 7) { socket.emit('room_error', { msg: 'Sala llena (7/7)' }); return; }

        const player = {
            id: socket.id, name: name || 'Player_' + socket.id.substring(0,4),
            character: character || 'walter',
            skin: skin || 'default',
            avatarUrl: avatarUrl || '',
            pos: { x: Math.random()*20-10, y: 10, z: Math.random()*20-10 }, yaw: 0,
            health: 250, dead: false, isKiller: false, isHost: false
        };
        room.players[socket.id] = player;
        socket.join(code);
        socket.roomCode = code;
        socket.playerNick = player.name; // guardar nick para chat y voz
        io.to(code).emit('player_joined', {
            player, players: room.players
        });
        // Al nuevo jugador: confirmar unión
        socket.emit('room_joined', {
            code, players: room.players, isHost: false
        });
        console.log(`[Room ${code}] ${name} se unió (${Object.keys(room.players).length}/7)`);
    });

    // ── Lista de salas públicas ────────────────────────────────
    socket.on('list_rooms', () => {
        socket.emit('rooms_list', getPublicRooms());
    });

    // ── Salir de sala ─────────────────────────────────────────
    socket.on('leave_room', ({ code }) => {
        handleLeave(socket, code);
    });

    // ── Iniciar partida ───────────────────────────────────────
    socket.on('start_game', ({ code }) => {
        const room = rooms[code];
        if (!room || room.hostId !== socket.id) return;
        const playerIds = Object.keys(room.players);
        if (playerIds.length < 2) return;

        room.phase = 'playing';

        // Asignar killer aleatoriamente
        const killerIdx = Math.floor(Math.random() * playerIds.length);
        const killerId  = playerIds[killerIdx];
        playerIds.forEach(id => {
            room.players[id].isKiller = (id === killerId);
            room.players[id].health   = 250;
            room.players[id].dead     = false;
        });
        room.aliveCount = playerIds.length - 1; // excluir killer

        io.to(code).emit('game_start', {
            players: room.players,
            killerPlayerId: killerId
        });

        // Broadcast de posiciones cada 50ms
        room.updateInterval = setInterval(() => {
            if (room.phase !== 'playing') return;
            broadcastPlayerUpdate(room);
        }, 50);

        console.log(`[Room ${code}] Partida iniciada — Killer: ${room.players[killerId].name}`);
    });

    // ── Actualización de posición del jugador ─────────────────
    socket.on('player_update', ({ code, pos, yaw, health, dead }) => {
        const room = rooms[code];
        if (!room || !room.players[socket.id]) return;
        const p = room.players[socket.id];
        p.pos = pos; p.yaw = yaw;
        if (typeof health === 'number') p.health = health;
        if (typeof dead   === 'boolean') p.dead  = dead;
    });

    // ── Chat lobby ────────────────────────────────────────────
    // El cliente envía { nick, msg } — usamos nick del payload
    // También guardamos nick en el socket para fallback
    socket.on('lobby_chat', (data) => {
        const msg  = (data.msg  || '').toString().substring(0, 120).trim();
        const nick = (data.nick || socket.playerNick || 'Anon').toString().substring(0, 20);
        if (!msg) return;
        const code = socket.roomCode;
        if (!code) return;
        // Guardar nick en el socket
        socket.playerNick = nick;
        // Broadcast a todos en la sala (incluyendo el emisor)
        io.to(code).emit('lobby_chat', { nick, msg });
        console.log(`[${code}] Chat lobby <${nick}>: ${msg}`);
    });

    // ── Chat in-game ──────────────────────────────────────────
    socket.on('ingame_chat', (data) => {
        const msg  = (data.msg  || '').toString().substring(0, 100).trim();
        const nick = (data.nick || socket.playerNick || 'Anon').toString().substring(0, 20);
        if (!msg) return;
        const code = socket.roomCode;
        if (!code) return;
        socket.playerNick = nick;
        io.to(code).emit('ingame_chat', { nick, msg });
    });

    // También manejar el evento game_chat (alias del anterior)
    socket.on('game_chat', (data) => {
        const msg  = (data.msg  || '').toString().substring(0, 100).trim();
        const nick = (data.nick || data.name || socket.playerNick || 'Anon').toString().substring(0, 20);
        if (!msg) return;
        const code = data.code || socket.roomCode;
        if (!code) return;
        io.to(code).emit('ingame_chat', { nick, msg });
        io.to(code).emit('game_chat',   { nick, msg });
    });

    // ── Voz WebRTC — señalización P2P ────────────────────────
    // offer: un cliente inicia conexión con otro
    socket.on('voice_offer', ({ to, offer }) => {
        if (!to || !offer) return;
        io.to(to).emit('voice_offer', { from: socket.id, offer });
    });

    // answer: el receptor responde
    socket.on('voice_answer', ({ to, answer }) => {
        if (!to || !answer) return;
        io.to(to).emit('voice_answer', { from: socket.id, answer });
    });

    // ICE candidates
    socket.on('voice_ice', ({ to, candidate }) => {
        if (!to || !candidate) return;
        io.to(to).emit('voice_ice', { from: socket.id, candidate });
    });

    // Indicador de quién está hablando
    socket.on('voice_speaking', ({ speaking }) => {
        const code = socket.roomCode;
        const nick = socket.playerNick || 'Anon';
        if (!code) return;
        // Broadcast a todos EXCEPTO el emisor
        socket.to(code).emit('voice_speaking', {
            from: socket.id,
            nick,
            speaking: !!speaking
        });
    });

    // ── Agarrón del killer ────────────────────────────────────
    socket.on('grab_player', ({ code, targetId }) => {
        const room = rooms[code];
        if (!room || !room.players[socket.id]?.isKiller) return;
        if (room.grabTarget) return; // ya hay alguien agarrado

        const target = room.players[targetId];
        if (!target || target.dead) return;

        room.grabTarget = targetId;
        io.to(code).emit('grab_start', { targetId });

        // Drain de vida cada 100ms
        room.grabInterval = setInterval(() => {
            if (!rooms[code] || !room.grabTarget) return;
            const t = room.players[room.grabTarget];
            if (!t || t.dead) { releaseGrab(room, code); return; }
            t.health = Math.max(0, t.health - 2); // 20hp/seg
            io.to(code).emit('grab_health', { targetId: room.grabTarget, health: t.health });
            if (t.health <= 0) {
                t.dead = true;
                io.to(code).emit('player_died', { playerId: room.grabTarget });
                releaseGrab(room, code);
                room.aliveCount = Math.max(0, room.aliveCount - 1);
                checkAllDead(room);
            }
        }, 100);
        console.log(`[Room ${code}] Killer agarró a ${target.name}`);
    });

    // ── Escape del agarrón ────────────────────────────────────
    socket.on('escaped_grab', ({ code }) => {
        const room = rooms[code];
        if (!room || room.grabTarget !== socket.id) return;
        releaseGrab(room, code);
        console.log(`[Room ${code}] ${room.players[socket.id]?.name} escapó del agarrón`);
    });

    // ── Segundo instinto ──────────────────────────────────────
    socket.on('second_instinct', ({ code }) => {
        const room = rooms[code];
        if (!room || !room.players[socket.id]?.isKiller) return;
        io.to(code).emit('second_instinct_active', { playerId: socket.id });
        console.log(`[Room ${code}] Segundo Instinto activado`);
    });

    // ── Jugador muere ─────────────────────────────────────────
    socket.on('player_died', ({ code }) => {
        const room = rooms[code];
        if (!room || !room.players[socket.id]) return;
        room.players[socket.id].dead = true;
        io.to(code).emit('player_died', { playerId: socket.id });
        room.aliveCount = Math.max(0, room.aliveCount - 1);
        checkAllDead(room);
    });

    // ── Evento LMS desde cliente ──────────────────────────────
    socket.on('lms_event', ({ code, survivorId }) => {
        io.to(code).emit('lms_event', { survivorId });
    });

    // ── Custard recolectado ───────────────────────────────────
    socket.on('custard_collected', ({ code }) => {
        const room = rooms[code];
        if (!room) return;
        room.custardCollected++;
        io.to(code).emit('custard_update', { total: room.custardCollected });
        checkSurvivorsWin(room);
    });

    // ── Desconexión ───────────────────────────────────────────
    socket.on('disconnect', () => {
        console.log(`[-] Desconectado: ${socket.id}`);
        const code = socket.roomCode;
        if (code) handleLeave(socket, code);
    });
});

// ── Helpers ───────────────────────────────────────────────────────────
function releaseGrab(room, code) {
    if (room.grabInterval) { clearInterval(room.grabInterval); room.grabInterval = null; }
    const prev = room.grabTarget;
    room.grabTarget = null;
    if (prev) io.to(code).emit('grab_released', { targetId: prev });
}

function handleLeave(socket, code) {
    const room = rooms[code];
    if (!room || !room.players[socket.id]) return;
    const name = room.players[socket.id].name;
    socket.leave(code);
    socket.roomCode = null;
    delete room.players[socket.id];

    // Si se fue el killer activo, liberar agarrón
    if (room.grabTarget === socket.id) releaseGrab(room, code);

    // Si quedó vacía, eliminar sala
    if (Object.keys(room.players).length === 0) {
        cleanRoom(code);
        return;
    }

    // Si era el host, transferir host al siguiente jugador
    if (room.hostId === socket.id) {
        room.hostId = Object.keys(room.players)[0];
        room.players[room.hostId].isHost = true;
    }

    io.to(code).emit('player_left', { playerId: socket.id, players: room.players });
    if (room.phase === 'playing') checkAllDead(room);
    console.log(`[Room ${code}] ${name} salió (${Object.keys(room.players).length} restantes)`);
}

// ── Health check ──────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
    status: 'ok',
    rooms:   Object.keys(rooms).length,
    players: Object.values(rooms).reduce((acc, r) => acc + Object.keys(r.players).length, 0),
    uptime:  Math.floor(process.uptime()) + 's'
}));

// ── Iniciar servidor ──────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`✅ SlendyTubIA Server corriendo en puerto ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
});
