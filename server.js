const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const FIREBASE_URL = "https://icy-tower-rejumped-default-rtdb.europe-west1.firebasedatabase.app";
const PORT = process.env.PORT || 8080;

app.get('/crossdomain.xml', (req, res) => {
    console.log("[HTTP] Serving crossdomain.xml");
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0"?>
<!DOCTYPE cross-domain-policy SYSTEM "http://www.adobe.com/xml/dtds/cross-domain-policy.dtd">
<cross-domain-policy>
    <site-control permitted-cross-domain-policies="all"/>
    <allow-access-from domain="*" to-ports="*" secure="false"/>
    <allow-http-request-headers-from domain="*" headers="*"/>
</cross-domain-policy>`);
});

const proxyToFirebase = (method, path, body, res) => {
    const https = require('https');
    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const req = https.request(FIREBASE_URL + path, options, (firebaseRes) => {
        let data = '';
        firebaseRes.on('data', (chunk) => data += chunk);
        firebaseRes.on('end', () => {
            res.status(firebaseRes.statusCode).set('Access-Control-Allow-Origin', '*');
            try {
                const json = JSON.parse(data);
                res.json(json);
            } catch (e) {
                res.send(data);
            }
        });
    });

    req.on('error', (e) => {
        console.error("Firebase Error:", e.message);
        res.status(500).json({ error: e.message });
    });

    if (body) {
        req.write(JSON.stringify(body));
    }
    req.end();
};

app.get('/api/lobbies.json', (req, res) => {
    proxyToFirebase('GET', '/lobbies.json', null, res);
});

app.post('/api/lobbies/:id.json', (req, res) => {
    const method = req.query['x-http-method-override'] || 'POST';
    const query = req.query['x-http-method-override'] ? `?x-http-method-override=${req.query['x-http-method-override']}` : '';
    proxyToFirebase('POST', `/lobbies/${req.params.id}.json${query}`, req.body, res);
});

app.get('/api/lobbies/:id.json', (req, res) => {
    proxyToFirebase('GET', `/lobbies/${req.params.id}.json`, null, res);
});


const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const rooms = {};


const deleteFirebaseLobby = (lobbyCode) => {
    const https = require('https');
    const options = {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const req = https.request(FIREBASE_URL + `/lobbies/${lobbyCode}.json`, options, (firebaseRes) => {
        let data = '';
        firebaseRes.on('data', (chunk) => data += chunk);
        firebaseRes.on('end', () => {
            if (firebaseRes.statusCode === 200 || firebaseRes.statusCode === 204) {
                console.log(`[Firebase] Lobby ${lobbyCode} deleted successfully`);
            } else {
                console.log(`[Firebase] Delete lobby ${lobbyCode} returned status ${firebaseRes.statusCode}`);
            }
        });
    });

    req.on('error', (e) => {
        console.error(`[Firebase] Delete lobby ${lobbyCode} error:`, e.message);
    });

    req.end();
};

wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    ws.room = null;
    ws.pid = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'join') {
                ws.room = data.room;
                ws.pid = data.player_id;

                if (!rooms[ws.room]) rooms[ws.room] = [];
                rooms[ws.room].push(ws);

                console.log(`[WS] ${ws.pid} joined ${ws.room}`);

                broadcastToRoom(ws.room, {
                    type: 'player_joined',
                    player_id: ws.pid
                }, ws);

                const existing = rooms[ws.room].filter(c => c !== ws).map(c => c.pid);
                if (existing.length > 0) {
                    ws.send(JSON.stringify({
                        type: 'existing_players',
                        players: existing
                    }));
                }
            }
            else if (data.type === 'sync') {
                if (ws.room) {
                    data.player_id = ws.pid;
                    broadcastToRoom(ws.room, data, ws);
                }
            }
            else if (data.type === 'ping') { }
            else {
                if (ws.room) broadcastToRoom(ws.room, data, ws);
            }

        } catch (e) {
            console.error('[WS] Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        if (ws.room && rooms[ws.room]) {
            console.log(`[WS] ${ws.pid} left room ${ws.room}`);
            rooms[ws.room] = rooms[ws.room].filter(client => client !== ws);

            broadcastToRoom(ws.room, {
                type: 'player_left',
                player_id: ws.pid
            });

            if (rooms[ws.room].length === 0) {
                const roomCode = ws.room;
                delete rooms[roomCode];
                console.log(`[WS] Room ${roomCode} deleted (empty)`);
                // Delete from Firebase as well
                deleteFirebaseLobby(roomCode);
            }
        }
    });
});

function broadcastToRoom(room, data, sender = null) {
    if (rooms[room]) {
        const msg = JSON.stringify(data);
        let count = 0;
        rooms[room].forEach(client => {
            if (client !== sender && client.readyState === WebSocket.OPEN) {
                client.send(msg);
                count++;
            }
        });
        // if (data.type === 'sync') console.log(`[WS] Broadcast sync to ${count} clients in ${room}`);
    } else {
        console.log(`[WS] Broadcast failed: Room ${room} not found`);
    }
}

server.listen(PORT, () => {
    console.log(`
    ========================================
    ITFB PROXY + RELAY SERVER STARTED
    ========================================
    HTTP Proxy: http://localhost:${PORT}/api/
    Crossdomain: http://localhost:${PORT}/crossdomain.xml
    WebSocket: ws://localhost:${PORT}
    ========================================
    `);
});
