const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const rooms = new Map();

// 🆕 Liste de mots pour le mode Pictionary
const WORDS = [
    "cat", "dog", "house", "sun", "moon",
    "tree", "car", "plane", "boat", "flower",
    "star", "fish", "bird", "mountain", "cloud",
    "pizza", "book", "phone", "dolphin", "elephant",
    "panda", "koala", "penguin", "taco", "sushi",
    "cake", "ice cream", "fruit", "guitar", "hat",
    "trump", "beyonce", "einstein", "harry", "frida",
    "magic", "unicorn", "dragon", "robot", "fairy",
    "monster", "yeti", "storm", "love", "joy",
    "fear", "dream", "rainbow", "cactus", "pillow",
    "skate", "dance", "swim", "jump", "sing",
    "explore", "firework", "balloon", "rocket", "candy",
    "leaf", "river", "ocean", "desert", "iceberg"
];

// 🆕 Fonction pour tirer un mot aléatoire
function getRandomWord() {
    return WORDS[Math.floor(Math.random() * WORDS.length)];
}

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
                        // Données pour PVP_DRAW
                        currentRound: 0,  // Sera initialisé à 1 lors du join
                        drawerIsHost: true,
                        currentWord: ""  // 🆕 Mot actuel
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
                    
                    if (room.mode === 'PVP_DRAW') {
                        // 🔥 Initialiser la première manche
                        room.currentRound = 1;
                        room.drawerIsHost = true;
                        room.currentWord = getRandomWord();  // 🆕 Le serveur choisit le mot
                        
                        console.log('🎲 Mot choisi par le serveur:', room.currentWord);
                        
                        // Envoyer les infos de manche à TOUS les joueurs (host + join)
                        room.players.forEach(player => {
                            player.send(JSON.stringify({ 
                                type: 'game_start',
                                mode: room.mode,
                                round: room.currentRound,
                                drawerIsHost: room.drawerIsHost,
                                word: room.currentWord  // 🆕 Envoyer le mot
                            }));
                        });
                        console.log('📤 Manche 1 démarrée - Drawer: HOST - Mot:', room.currentWord);
                    } else {
                        // Mode classique (Paint)
                        room.players.forEach(player => {
                            player.send(JSON.stringify({ 
                                type: 'game_start',
                                mode: room.mode
                            }));
                        });
                    }
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
                
                // 🆕 Fin de manche (envoyé par le HOST)
                case 'round_finished':
                    const finishRoom = rooms.get(message.room);
                    if (finishRoom && finishRoom.mode === 'PVP_DRAW') {
                        finishRoom.currentRound++;
                        finishRoom.drawerIsHost = (finishRoom.currentRound % 2 === 1);
                        finishRoom.currentWord = getRandomWord();  // 🆕 Nouveau mot pour la nouvelle manche
                        
                        console.log('✅ Manche terminée - Nouvelle manche:', finishRoom.currentRound);
                        console.log('🎲 Nouveau mot:', finishRoom.currentWord);
                        
                        // Envoyer aux deux joueurs
                        finishRoom.players.forEach(player => {
                            player.send(JSON.stringify({
                                type: 'round_changed',
                                round: finishRoom.currentRound,
                                drawerIsHost: finishRoom.drawerIsHost,
                                word: finishRoom.currentWord  // 🆕 Envoyer le nouveau mot
                            }));
                        });
                    }
                    break;
                
                // ❌ SUPPRIMER le case 'next_round' (remplacé par 'round_finished')
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