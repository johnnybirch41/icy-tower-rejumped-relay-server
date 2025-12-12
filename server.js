const WebSocket = require('ws');
const http = require('http');
const PORT = process.env.PORT || 8080;
// Create HTTP server (required for Render health checks)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Icy Tower Rejumped Relay Server is Running!\n');
});
// Create WebSocket server
const wss = new WebSocket.Server({ server });
// Store active rooms
const rooms = new Map();
wss.on('connection', (ws) => {
    // console.log('New client connected');
    ws.isAlive = true;
    ws.lastHeartbeat = Date.now();
    ws.on('message', (data) => {
        try {
            // Expecting JSON packets
            const message = JSON.parse(data);
            switch (message.type) {
                case 'join':
                    handleJoin(ws, message);
                    break;
                case 'start_game': // New handler
                    // Broadcast to everyone including sender (so host knows it sent?)
                    // Actually host calls startGame() locally. Just broadcast to others.
                    broadcast(ws.room, { type: 'start_game' }, ws);
                    break;
                case 'sync':
                    handleSync(ws, message);
                    break;
                case 'leave':
                    handleLeave(ws);
                    break;
                case 'ping': // Keep-alive from client
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
                default:
                // console.log('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });
    ws.on('pong', () => {
        ws.isAlive = true;
        ws.lastHeartbeat = Date.now();
    });
    ws.on('close', () => {
        handleLeave(ws);
    });
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});
function handleJoin(ws, message) {
    const { room, player_id } = message;
    if (!rooms.has(room)) {
        rooms.set(room, new Map());
    }
    const roomClients = rooms.get(room);
    // Add client to room
    ws.room = room;
    ws.player_id = player_id;
    roomClients.set(player_id, ws);
    console.log(`Player ${player_id} joined room ${room}`);
    // Notify others
    broadcast(room, {
        type: 'player_joined',
        player_id: player_id
    }, ws);
    // Send existing players to new client
    const existingPlayers = [];
    roomClients.forEach((client, id) => {
        if (id !== player_id && client.readyState === WebSocket.OPEN) {
            existingPlayers.push(id);
        }
    });
    if (existingPlayers.length > 0) {
        ws.send(JSON.stringify({
            type: 'existing_players',
            players: existingPlayers
        }));
    }
}
function handleSync(ws, message) {
    if (!ws.room) return;
    // Re-broadcast sync frame to everyone else in the room
    // We strip unnecessary metadata to save bandwidth if needed, but for now passing through is fine
    broadcast(ws.room, {
        type: 'sync',
        id: ws.player_id,
        x: message.x,       // position x
        y: message.y,       // position y
        vx: message.vx,     // velocity x
        vy: message.vy,     // velocity y
        f: message.f,       // current frame (animation)
        s: message.s        // scale/facing (-1 or 1)
    }, ws);
}
function handleLeave(ws) {
    if (!ws.room) return;
    const roomClients = rooms.get(ws.room);
    if (roomClients) {
        roomClients.delete(ws.player_id);
        // Notify others
        broadcast(ws.room, {
            type: 'player_left',
            player_id: ws.player_id
        }, ws);
        if (roomClients.size === 0) {
            rooms.delete(ws.room);
        }
    }
}
function broadcast(room, message, excludeWs = null) {
    const roomClients = rooms.get(room);
    if (!roomClients) return;
    const messageStr = JSON.stringify(message);
    roomClients.forEach((client) => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
}
// Start server
server.listen(PORT, () => {
    console.log(`Relay Server running on port ${PORT}`);
});
// Basic cleanup interval for zombie connections
const PING_INTERVAL = 30000;
const TIMEOUT = 40000;
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (Date.now() - ws.lastHeartbeat > TIMEOUT) {
            ws.terminate();
        }
    });
}, PING_INTERVAL);
