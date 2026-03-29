# SlendyTubIA — Servidor Multiplayer

## Despliegue en Render.com

### Pasos:

1. Sube estos archivos a un repositorio GitHub:
   - `server.js`
   - `package.json`
   - `render.yaml`

2. Ve a https://render.com → New → Web Service

3. Conecta tu repositorio GitHub

4. Render detectará automáticamente `render.yaml` y configurará:
   - Build: `npm install`
   - Start: `node server.js`
   - Puerto: 3000

5. El servidor quedará en:
   `https://mygame-u5c9.onrender.com`

## Verificar que funciona

Visita: `https://mygame-u5c9.onrender.com/health`

Debes ver algo como:
```json
{
  "status": "ok",
  "rooms": 0,
  "players": 0,
  "uptime": "42s"
}
```

## Eventos Socket.IO implementados

### Cliente → Servidor
| Evento | Descripción |
|--------|-------------|
| `create_room` | Crear sala nueva |
| `join_room` | Unirse a sala por código |
| `list_rooms` | Pedir lista de salas públicas |
| `leave_room` | Salir de la sala |
| `start_game` | Host inicia la partida |
| `player_update` | Enviar posición/estado del jugador (20fps) |
| `lobby_chat` | Mensaje en el lobby |
| `game_chat` | Mensaje en la partida |
| `grab_player` | Killer agarra a un sobreviviente |
| `escaped_grab` | Sobreviviente se liberó |
| `second_instinct` | Killer activa visión de rayos X |
| `player_died` | Jugador murió |
| `custard_collected` | Custard recogida (activa victoria de sobrevivientes) |
| `lms_event` | Último sobreviviente |

### Servidor → Cliente
| Evento | Descripción |
|--------|-------------|
| `room_created` | Sala creada con éxito |
| `room_joined` | Unido a la sala |
| `room_error` | Error al unirse/crear |
| `rooms_list` | Lista de salas públicas |
| `player_joined` | Nuevo jugador en el lobby |
| `player_left` | Jugador salió |
| `lobby_chat` | Mensaje de chat del lobby |
| `game_chat` | Mensaje de chat in-game |
| `game_start` | Partida iniciada con roles asignados |
| `players_update` | Posiciones de todos los jugadores (20fps) |
| `grab_start` | Te están agarrando |
| `grab_released` | Liberado del agarrón |
| `grab_health` | Tu vida mientras te ahorca |
| `second_instinct_active` | Killer activó visión X |
| `survivors_win` | Sobrevivientes ganaron la ronda |
| `killer_phase2` | Killer entra en Fase 2 |
| `lms_event` | Último sobreviviente — reproducir LMS |
| `player_died` | Jugador eliminado |
| `custard_update` | Total de custards recogidas |
| `game_over` | Fin de partida |

## Estructura de sala
```
room = {
  code: "ABC123",          // código único de 6 chars
  hostId: "socketId",      // quien puede iniciar la partida
  public: true,            // visible en la lista pública
  phase: "lobby"|"playing"|"ended",
  killerPhase: 1 | 2,      // fase del killer (2 = más fuerte)
  players: { [id]: Player },
  custardCollected: 0,     // para activar victoria sobrevivientes
  aliveCount: 0,
  grabTarget: null         // id del jugador actualmente agarrado
}
```
