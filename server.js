const { Server } = require('socket.io');

// Créer serveur Socket.io sur port 3000
const io = new Server(3000, {
  cors: {
    origin: "*",  // Accepter toutes les origines (pour tests)
    methods: ["GET", "POST"]
  }
});

// Stockage des rooms
const rooms = {};

// Générer code aléatoire (5 caractères)
function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

console.log('🚀 Serveur démarré sur port 3000');
console.log('En attente de connexions...\n');

// Quand un client se connecte
io.on('connection', (socket) => {
  console.log('✅ Client connecté:', socket.id);
  
  // CRÉER UNE ROOM
  socket.on('create_room', () => {
    const code = generateCode();
    rooms[code] = {
      host: socket.id,
      players: [socket.id],
      createdAt: Date.now()
    };
    
    socket.join(code);
    socket.emit('room_created', { code });
    
    console.log('🏠 Room créée:', code, 'par', socket.id);
  });
  
  // REJOINDRE UNE ROOM
  socket.on('join_room', ({ code }) => {
    console.log('🔍 Tentative de rejoindre:', code, 'par', socket.id);
    
    if (!rooms[code]) {
      socket.emit('error', { msg: 'Room introuvable' });
      console.log('❌ Room', code, 'introuvable');
      return;
    }
    
    if (rooms[code].players.length >= 2) {
      socket.emit('error', { msg: 'Room pleine' });
      console.log('❌ Room', code, 'pleine');
      return;
    }
    
    rooms[code].players.push(socket.id);
    socket.join(code);
    
    console.log('✅ Joueur 2 a rejoint room', code);
    
    // Notifier les deux joueurs que la partie peut commencer
    io.to(code).emit('game_start', {
      players: rooms[code].players
    });
    
    console.log('🎮 Partie lancée dans room', code);
  });
  
  // MOUVEMENT JOUEUR
  socket.on('player_move', (data) => {
    // Relayer aux autres dans la room
    socket.to(data.room).emit('opponent_move', {
      position: data.position,
      rotation: data.rotation
    });
  });
  
  // PEINTURE JOUEUR
  socket.on('player_paint', (data) => {
    // Relayer aux autres dans la room
    socket.to(data.room).emit('opponent_paint', {
      position: data.position,
      color: data.color
    });
  });
  
  // DÉCONNEXION
  socket.on('disconnect', () => {
    console.log('❌ Client déconnecté:', socket.id);
    
    // TODO: Nettoyer les rooms (plus tard)
    for (const code in rooms) {
      const index = rooms[code].players.indexOf(socket.id);
      if (index > -1) {
        console.log('🧹 Nettoyage room', code);
        // Notifier l'autre joueur
        socket.to(code).emit('opponent_disconnected');
        delete rooms[code];
      }
    }
  });
});