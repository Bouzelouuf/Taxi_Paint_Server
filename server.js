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
                    const mode = message.mode || 'PVP_PAINT';
                    
                    console.log('🎮 Room créée :', code, 'Mode :', mode);
                    
                    rooms.set(code, {
                        host: ws,
                        players: [ws],
                        mode: mode,
                        createdAt: Date.now(),
                        // 🆕 Données spécifiques PVP_DRAW
                        currentRound: 0,
                        maxRounds: 3,
                        drawerIsHost: true,
                        hostScore: 0,
                        joinScore: 0
                    });
                    
                    ws.roomCode = code;
                    ws.isHost = true;
                    
                    ws.send(JSON.stringify({ 
                        type: 'room_created', 
                        code: code,
                        mode: mode
                    }));
                    break;
                
                case 'join_room':
                    const room = rooms.get(message.code);
                    
                    if (!room) {
                        ws.send(JSON.stringify({ type: 'error', msg: 'Room not found' }));
                        return;
                    }
                    
                    room.players.push(ws);
                    ws.roomCode = message.code;
                    ws.isHost = false;
                    
                    console.log('✅ Join room :', message.code, '- Mode :', room.mode);
                    
                    // 🔥 ENVOYER LE MODE AUX DEUX JOUEURS
                    room.players.forEach(player => {
                        player.send(JSON.stringify({ 
                            type: 'game_start',
                            mode: room.mode
                        }));
                    });
                    break;
                
                case 'player_move':
                    relayToOthers(ws, message.room, {
                        type: 'opponent_move',
                        position: message.position,
                        rotation: message.rotation
                    });
                    break;
                
                case 'player_paint':
                    relayToOthers(ws, message.room, {
                        type: 'opponent_paint',
                        position: message.position,
                        color: message.color
                    });
                    break;
                
                // 🆕 GESTION PICTIONARY
                case 'start_round':
                    const roundRoom = rooms.get(message.room);
                    if (roundRoom) {
                        roundRoom.currentRound = message.round;
                        roundRoom.drawerIsHost = message.drawerIsHost;
                        
                        console.log('🎨 Manche', message.round, '- Drawer:', roundRoom.drawerIsHost ? 'Host' : 'Join');
                        
                        // Envoyer aux deux joueurs
                        roundRoom.players.forEach(player => {
                            player.send(JSON.stringify({
                                type: 'round_started',
                                round: message.round,
                                drawerIsHost: message.drawerIsHost,
                                word: player.isHost === roundRoom.drawerIsHost ? message.word : null
                            }));
                        });
                    }
                    break;
                
                case 'guess_word':
                    const guessRoom = rooms.get(message.room);
                    if (guessRoom) {
                        console.log('🔍 Guess reçu:', message.guess, '- Correct:', message.correct);
                        
                        if (message.correct) {
                            // Mettre à jour les scores
                            if (ws.isHost) {
                                guessRoom.hostScore++;
                            } else {
                                guessRoom.joinScore++;
                            }
                            
                            // Notifier les deux joueurs
                            guessRoom.players.forEach(player => {
                                player.send(JSON.stringify({
                                    type: 'round_ended',
                                    guesserWon: true,
                                    hostScore: guessRoom.hostScore,
                                    joinScore: guessRoom.joinScore
                                }));
                            });
                        }
                    }
                    break;
                
                case 'end_match':
                    const matchRoom = rooms.get(message.room);
                    if (matchRoom) {
                        matchRoom.players.forEach(player => {
                            player.send(JSON.stringify({
                                type: 'match_ended',
                                hostScore: matchRoom.hostScore,
                                joinScore: matchRoom.joinScore
                            }));
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
        
        if (ws.roomCode) {
            const room = rooms.get(ws.roomCode);
            if (room) {
                room.players = room.players.filter(p => p !== ws);
                if (room.players.length === 0) {
                    rooms.delete(ws.roomCode);
                    console.log('🧹 Room supprimée:', ws.roomCode);
                } else {
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

// Fonction helper pour relayer aux autres joueurs
function relayToOthers(sender, roomCode, data) {
    const room = rooms.get(roomCode);
    if (room) {
        room.players.forEach(player => {
            if (player !== sender && player.readyState === WebSocket.OPEN) {
                player.send(JSON.stringify(data));
            }
        });
    }
}

server.listen(PORT, () => {
    console.log(`✅ Serveur WebSocket démarré sur port ${PORT}`);
});