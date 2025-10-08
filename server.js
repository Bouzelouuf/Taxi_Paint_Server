const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const rooms = new Map();

function generateCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Route santé
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        rooms: rooms.size,
        connections: wss.clients.size
    });
});

// WebSocket
wss.on('connection', (ws) => {
    console.log('✅ Client connecté');
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log('📩 Reçu:', message);
            
            switch (message.type) {
                case 'create_room':
                    const code = generateCode();
                    rooms.set(code, {
                        host: ws,
                        players: [ws],
                        createdAt: Date.now()
                    });
                    
                    ws.roomCode = code;
                    ws.send(JSON.stringify({ 
                        type: 'room_created', 
                        code: code 
                    }));
                    
                    console.log('🏠 Room créée:', code);
                    break;
                
                case 'join_room':
                    const room = rooms.get(message.code);
                    
                    if (!room) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            msg: 'Room introuvable' 
                        }));
                        return;
                    }
                    
                    if (room.players.length >= 2) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            msg: 'Room pleine' 
                        }));
                        return;
                    }
                    
                    room.players.push(ws);
                    ws.roomCode = message.code;
                    
                    // Notifier les 2 joueurs
                    room.players.forEach(player => {
                        player.send(JSON.stringify({ 
                            type: 'game_start' 
                        }));
                    });
                    
                    console.log('✅ Joueur 2 rejoint room', message.code);
                    console.log('🎮 Partie lancée');
                    break;
                
                case 'player_move':
                    // Relayer aux autres
                    const moveRoom = rooms.get(message.room);
                    if (moveRoom) {
                        moveRoom.players.forEach(player => {
                            if (player !== ws && player.readyState === WebSocket.OPEN) {
                                player.send(JSON.stringify({
                                    type: 'opponent_move',
                                    position: message.position,
                                    rotation: message.rotation
                                }));
                            }
                        });
                    }
                    break;
                
                case 'player_paint':
                    // Relayer aux autres
                    const paintRoom = rooms.get(message.room);
                    if (paintRoom) {
                        paintRoom.players.forEach(player => {
                            if (player !== ws && player.readyState === WebSocket.OPEN) {
                                player.send(JSON.stringify({
                                    type: 'opponent_paint',
                                    position: message.position,
                                    color: message.color
                                }));
                            }
                        });
                    }
                    break;
            }
        } catch (error) {
            console.error('❌ Erreur parsing:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('❌ Client déconnecté');
        
        // Nettoyer les rooms
        if (ws.roomCode) {
            const room = rooms.get(ws.roomCode);
            if (room) {
                room.players = room.players.filter(p => p !== ws);
                if (room.players.length === 0) {
                    rooms.delete(ws.roomCode);
                    console.log('🧹 Room supprimée:', ws.roomCode);
                } else {
                    // Notifier l'autre joueur
                    room.players.forEach(p => {
                        if (p.readyState === WebSocket.OPEN) {
                            p.send(JSON.stringify({ 
                                type: 'opponent_disconnected' 
                            }));
                        }
                    });
                }
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`✅ Serveur WebSocket démarré sur port ${PORT}`);
});