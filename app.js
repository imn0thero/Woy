const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.static('public'));
app.use(express.json());

const MESSAGES_FILE = path.join(__dirname, 'messages.json');

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

let connectedUsers = {};
let messages = [];
const MAX_USERS = 100;
const MESSAGE_EXPIRY_HOURS = 24;

// Load messages from file
function loadMessages() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
      messages = JSON.parse(data);
      console.log(`Loaded ${messages.length} messages from file`);
      cleanExpiredMessages();
    } else {
      messages = [];
      console.log('No existing messages file found, starting fresh');
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
          console.log(`Media dihapus: ${filePath}`);
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
    console.log(`Removed ${removedCount} expired messages`);
    saveMessages();
    io.emit('messages_cleaned', { removedCount });
  }
}

// Jalankan setiap jam
setInterval(cleanExpiredMessages, 60 * 60 * 1000);
loadMessages();

// ROUTES
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', upload.single('media'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  res.json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    path: `/uploads/${req.file.filename}`
  });
});

// SOCKET.IO
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (username) => {
    if (Object.keys(connectedUsers).length >= MAX_USERS) {
      socket.emit('room_full');
      return;
    }

    const isTaken = Object.values(connectedUsers).some(user => user.username === username);
    if (isTaken) {
      socket.emit('username_taken');
      return;
    }

    connectedUsers[socket.id] = {
      username,
      status: 'online',
      joinedAt: new Date()
    };

    socket.username = username;
    socket.emit('load_messages', messages);
    io.emit('user_list_update', Object.values(connectedUsers));
    socket.broadcast.emit('user_joined', username);
    console.log(`${username} joined`);
  });

  socket.on('new_message', (data) => {
    if (!socket.username) return;

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

    messages.forEach(deleteMediaFile);
    messages = [];
    saveMessages();
    io.emit('messages_cleared');
    console.log(`${socket.username} cleared messages`);
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      delete connectedUsers[socket.id];
      io.emit('user_list_update', Object.values(connectedUsers));
      socket.broadcast.emit('user_left', socket.username);
      console.log(`${socket.username} left`);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
