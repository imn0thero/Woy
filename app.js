const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.static('public'));
app.use(express.json());

const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const KEYS_FILE = path.join(__dirname, 'keys.json');

// Setup multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'public/uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|pdf|doc|docx|txt|mp3|wav|ogg|webm|m4a/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed!'));
    }
  }
});

// Variables
let connectedUsers = {};
let messages = [];
let authorizedUsers = [];
let userPublicKeys = {};
const MAX_USERS = 2; // Dibatasi hanya 2 user
const MESSAGE_EXPIRY_HOURS = 24;

// Generate server keypair untuk verifikasi
const { publicKey: serverPublicKey, privateKey: serverPrivateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

// Load authorized users from file
function loadAuthorizedUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      authorizedUsers = JSON.parse(data);
      console.log(`💕 Loaded ${authorizedUsers.length} authorized users`);
    } else {
      // Buat file users.json default jika tidak ada
      authorizedUsers = [
        { username: "Azz" },
        { username: "Queen" }
      ];
      saveAuthorizedUsers();
      console.log('💕 Created default users.json file');
    }
  } catch (error) {
    console.error('Error loading authorized users:', error);
    authorizedUsers = [
      { username: "Azz" },
      { username: "Queen" }
    ];
  }
}

// Save authorized users to file
function saveAuthorizedUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(authorizedUsers, null, 2));
  } catch (error) {
    console.error('Error saving authorized users:', error);
  }
}

// Load public keys from file
function loadPublicKeys() {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const data = fs.readFileSync(KEYS_FILE, 'utf8');
      userPublicKeys = JSON.parse(data);
      console.log(`🔑 Loaded public keys for ${Object.keys(userPublicKeys).length} users`);
    } else {
      userPublicKeys = {};
      console.log('🔑 No existing keys file found, starting fresh');
    }
  } catch (error) {
    console.error('Error loading public keys:', error);
    userPublicKeys = {};
  }
}

// Save public keys to file
function savePublicKeys() {
  try {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(userPublicKeys, null, 2));
  } catch (error) {
    console.error('Error saving public keys:', error);
  }
}

// Check if username is authorized
function isUserAuthorized(username) {
  return authorizedUsers.some(user => user.username === username);
}

// Load messages from file
function loadMessages() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
      messages = JSON.parse(data);
      console.log(`💕 Loaded ${messages.length} encrypted messages from file`);
      cleanExpiredMessages();
    } else {
      messages = [];
      console.log('💕 No existing messages file found, starting fresh');
    }
  } catch (error) {
    console.error('Error loading messages:', error);
    messages = [];
  }
}

// Save messages to file
function saveMessages() {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (error) {
    console.error('Error saving messages:', error);
  }
}

// Fungsi untuk menghapus file media
function deleteMediaFile(message) {
  if (message.media && message.media.path) {
    const filePath = path.join(__dirname, 'public', message.media.path);
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error(`Gagal menghapus file ${filePath}:`, err);
        } else {
          console.log(`💕 Media dihapus: ${filePath}`);
        }
      });
    }
  }
}

// Hapus pesan > 24 jam + file media
function cleanExpiredMessages() {
  const now = new Date();
  const newMessages = [];

  for (const message of messages) {
    const ageInHours = (now - new Date(message.timestamp)) / (1000 * 60 * 60);
    if (ageInHours < MESSAGE_EXPIRY_HOURS) {
      newMessages.push(message);
    } else {
      deleteMediaFile(message);
    }
  }

  const removedCount = messages.length - newMessages.length;
  messages = newMessages;

  if (removedCount > 0) {
    console.log(`💕 Removed ${removedCount} expired encrypted messages`);
    saveMessages();
    io.emit('messages_cleaned', { removedCount });
  }
}

// Fungsi untuk membuat signature pesan dari server
function createServerSignature(message) {
  try {
    const sign = crypto.createSign('SHA256');
    sign.write(JSON.stringify({
      id: message.id,
      username: message.username,
      timestamp: message.timestamp
    }));
    sign.end();
    return sign.sign(serverPrivateKey, 'base64');
  } catch (error) {
    console.error('Error creating server signature:', error);
    return null;
  }
}

// Initialize
loadAuthorizedUsers();
loadMessages();
loadPublicKeys();

// Jalankan pembersihan setiap jam
setInterval(cleanExpiredMessages, 60 * 60 * 1000);

// ROUTES
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', upload.single('media'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  console.log(`💕 File uploaded: ${req.file.originalname}`);
  res.json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    path: `/uploads/${req.file.filename}`
  });
});

// Route untuk mendapatkan server public key
app.get('/server-key', (req, res) => {
  res.json({ serverPublicKey });
});

// SOCKET.IO
io.on('connection', (socket) => {
  console.log('💕 User connected:', socket.id);

  // Kirim server public key ke client yang baru terhubung
  socket.emit('server_public_key', { serverPublicKey });

  // Register public key dari client
  socket.on('register_public_key', (data) => {
    if (!socket.username) return;
    
    console.log(`🔑 Registering public key for ${socket.username}`);
    userPublicKeys[socket.username] = data.publicKey;
    savePublicKeys();
    
    // Broadcast ke semua user bahwa ada update kunci publik
    io.emit('public_key_update', { 
      username: socket.username, 
      publicKey: data.publicKey 
    });
    
    console.log(`🔑 Public key registered for ${socket.username}`);
  });

  socket.on('join', (username) => {
    // Cek apakah username ada di users.json
    if (!isUserAuthorized(username)) {
      socket.emit('unauthorized');
      console.log(`💔 Unauthorized access attempt: ${username}`);
      return;
    }

    // Cek apakah sudah mencapai batas maksimal user (2 user)
    if (Object.keys(connectedUsers).length >= MAX_USERS) {
      socket.emit('room_full');
      console.log(`💔 Room full, rejected: ${username}`);
      return;
    }

    // Cek apakah username sudah digunakan
    const isTaken = Object.values(connectedUsers).some(user => user.username === username);
    if (isTaken) {
      socket.emit('username_taken');
      console.log(`💔 Username taken: ${username}`);
      return;
    }

    connectedUsers[socket.id] = {
      username,
      status: 'online',
      joinedAt: new Date()
    };

    socket.username = username;
    
    // Load messages dan kirim semua public key yang ada
    socket.emit('load_messages', messages);
    socket.emit('all_public_keys', userPublicKeys);
    
    // Update user list
    io.emit('user_list_update', Object.values(connectedUsers));
    socket.broadcast.emit('user_joined', username);
    
    console.log(`💕 ${username} joined the romantic chat (authorized & encrypted)`);
  });

  socket.on('new_message', (data) => {
    if (!socket.username) return;

    console.log(`💕 Encrypted message from ${socket.username}`);

    // Untuk pesan terenkripsi
    if (data.type === 'encrypted') {
      const message = {
        id: Date.now() + Math.random(),
        username: socket.username,
        // Pesan sudah terenkripsi di client side
        encryptedContent: data.encryptedContent,
        // Kunci pesan terenkripsi untuk setiap recipient
        encryptedKeys: data.encryptedKeys,
        media: data.media || null,
        timestamp: new Date(),
        type: 'encrypted'
      };

      // Tambahkan signature server untuk verifikasi
      message.serverSignature = createServerSignature(message);

      messages.push(message);
      saveMessages();
      io.emit('message_received', message);
      
      console.log(`🔒 Encrypted message saved with ${Object.keys(data.encryptedKeys || {}).length} recipient keys`);
    } 
    // Untuk pesan biasa (fallback)
    else {
      const message = {
        id: Date.now() + Math.random(),
        username: socket.username,
        text: data.text,
        media: data.media || null,
        timestamp: new Date(),
        type: data.type || 'text'
      };

      messages.push(message);
      saveMessages();
      io.emit('message_received', message);
      
      console.log(`💕 Regular message from ${socket.username}`);
    }
  });

  socket.on('typing', (isTyping) => {
    if (!socket.username) return;
    socket.broadcast.emit('user_typing', {
      username: socket.username,
      isTyping
    });
  });

  socket.on('clear_messages', () => {
    if (!socket.username) return;

    console.log(`💕 ${socket.username} clearing all encrypted messages`);
    
    // Hapus file media dari semua pesan
    messages.forEach(deleteMediaFile);
    messages = [];
    saveMessages();
    io.emit('messages_cleared');
    
    console.log(`💕 All encrypted messages cleared by ${socket.username}`);
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      delete connectedUsers[socket.id];
      io.emit('user_list_update', Object.values(connectedUsers));
      socket.broadcast.emit('user_left', socket.username);
      console.log(`💔 ${socket.username} left the romantic chat`);
    } else {
      console.log('💔 Anonymous user disconnected:', socket.id);
    }
  });

  // Handle connection errors
  socket.on('error', (error) => {
    console.error('💔 Socket error:', error);
  });
});

// Handle server errors
server.on('error', (error) => {
  console.error('💔 Server error:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n💕 Shutting down romantic chat server gracefully...');
  
  // Save current state
  saveMessages();
  saveAuthorizedUsers();
  savePublicKeys();
  
  server.close(() => {
    console.log('💕 Romantic chat server closed. Goodbye lovers! 💕');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n💕 Received SIGTERM, shutting down gracefully...');
  
  // Save current state
  saveMessages();
  saveAuthorizedUsers();
  savePublicKeys();
  
  server.close(() => {
    console.log('💕 Romantic chat server terminated. Until we meet again! 💕');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`💕💕💕 Romantic Encrypted Chat Server running on port ${PORT} 💕💕💕`);
  console.log(`🔒 End-to-End Encryption: ENABLED`);
  console.log(`👥 Max Users: ${MAX_USERS}`);
  console.log(`⏰ Message Expiry: ${MESSAGE_EXPIRY_HOURS} hours`);
  console.log(`💖 Authorized Users: ${authorizedUsers.map(u => u.username).join(', ')}`);
  console.log('💕 Server ready for romantic conversations! 💕');
});
