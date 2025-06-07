import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Upload folder setup
const uploadFolder = './uploads';
if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, name + ext);
  }
});
const upload = multer({ storage });

/** User data management **/
const usersFile = './users.json';
let users = {};
if (fs.existsSync(usersFile)) {
  users = JSON.parse(fs.readFileSync(usersFile));
}

function saveUsers() {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

/** Messages data: memory store **/
const messages = {}; // { chatId: [ { from, to, text?, media?, time } ] }

function getChatId(user1, user2) {
  return [user1, user2].sort().join('|');
}

// Track online users: username -> socket.id
const onlineUsers = {};

// Track chat deletions (only for self delete)
const deletedChatsByUser = {}; // { username: { chatId: true } }

io.on('connection', socket => {
  let currentUser = null;

  // Login event
  socket.on('login', async ({ username, password }) => {
    if (!username || !password) {
      socket.emit('loginResult', { success: false, message: 'Username dan password wajib diisi' });
      return;
    }
    const user = users[username];
    if (!user) {
      socket.emit('loginResult', { success: false, message: 'User tidak ditemukan' });
      return;
    }
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      socket.emit('loginResult', { success: false, message: 'Password salah' });
      return;
    }

    currentUser = username;
    onlineUsers[username] = socket.id;

    // Kirim list online user
    io.emit('onlineUsers', Object.keys(onlineUsers));

    // Kirim chatList ke client (filter chat yg dihapus sendiri)
    const userDeletedChats = deletedChatsByUser[currentUser] || {};
    const chatList = Object.keys(messages)
      .filter(chatId => chatId.includes(currentUser) && !userDeletedChats[chatId])
      .map(chatId => {
        const other = chatId.split('|').find(u => u !== currentUser);
        const lastMsg = messages[chatId].slice(-1)[0];
        return { user: other, lastMsg: lastMsg ? (lastMsg.text || '[Media]') : '' };
      });

    socket.emit('loginResult', { success: true, user: currentUser });
    socket.emit('chatList', chatList);
  });

  // Signup event
  socket.on('signup', async ({ username, password }) => {
    if (!username || !password) {
      socket.emit('signupResult', { success: false, message: 'Username dan password wajib diisi' });
      return;
    }
    if (users[username]) {
      socket.emit('signupResult', { success: false, message: 'Username sudah digunakan' });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    users[username] = { username, passwordHash };
    saveUsers();
    socket.emit('signupResult', { success: true });
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (currentUser) {
      delete onlineUsers[currentUser];
      io.emit('onlineUsers', Object.keys(onlineUsers));
    }
  });

  // Start private chat - kirim history pesan
  socket.on('startChat', (otherUser) => {
    if (!currentUser || !otherUser) return;
    const chatId = getChatId(currentUser, otherUser);

    // Filter deleted chats for currentUser
    const userDeletedChats = deletedChatsByUser[currentUser] || {};
    if (userDeletedChats[chatId]) {
      socket.emit('chatMessages', []);
      return;
    }

    const chatHistory = messages[chatId] || [];
    socket.emit('chatMessages', chatHistory);
  });

  // Send message
  socket.on('sendMessage', ({ to, text, media }) => {
    if (!currentUser || !to) return;
    const chatId = getChatId(currentUser, to);

    if (!messages[chatId]) messages[chatId] = [];

    const msg = {
      from: currentUser,
      to,
      time: Date.now(),
      ...(text ? { text } : {}),
      ...(media ? { media } : {})
    };
    messages[chatId].push(msg);

    // Kirim pesan realtime ke 2 user jika online
    [currentUser, to].forEach(user => {
      const sockId = onlineUsers[user];
      if (sockId) {
        io.to(sockId).emit('newMessage', { chatId, message: msg });
      }
    });

    // Update chatList ke kedua user
    [currentUser, to].forEach(user => {
      const sockId = onlineUsers[user];
      if (sockId) {
        const userDeletedChats = deletedChatsByUser[user] || {};
        const chatList = Object.keys(messages)
          .filter(cId => cId.includes(user) && !userDeletedChats[cId])
          .map(cId => {
            const other = cId.split('|').find(u => u !== user);
            const lastMsg = messages[cId].slice(-1)[0];
            return { user: other, lastMsg: lastMsg ? (lastMsg.text || '[Media]') : '' };
          });
        io.to(sockId).emit('chatList', chatList);
      }
    });
  });

  // Delete chat
  socket.on('deleteChat', ({ withUser, deleteForAll }) => {
    if (!currentUser || !withUser) return;
    const chatId = getChatId(currentUser, withUser);

    if (deleteForAll) {
      // Delete all messages for both
      delete messages[chatId];

      [currentUser, withUser].forEach(user => {
        const sockId = onlineUsers[user];
        if (sockId) {
          // Refresh chatList
          const userDeletedChats = deletedChatsByUser[user] || {};
          const chatList = Object.keys(messages)
            .filter(cId => cId.includes(user) && !userDeletedChats[cId])
            .map(cId => {
              const other = cId.split('|').find(u => u !== user);
              const lastMsg = messages[cId].slice(-1)[0];
              return { user: other, lastMsg: lastMsg ? (lastMsg.text || '[Media]') : '' };
            });
          io.to(sockId).emit('chatList', chatList);
          // Notify chat deleted
          io.to(sockId).emit('chatDeleted', { chatId, byUser: currentUser });
        }
      });
    } else {
      // Delete only for current user
      if (!deletedChatsByUser[currentUser]) deletedChatsByUser[currentUser] = {};
      deletedChatsByUser[currentUser][chatId] = true;

      // Refresh chatList currentUser
      const userDeletedChats = deletedChatsByUser[currentUser];
      const chatList = Object.keys(messages)
        .filter(cId => cId.includes(currentUser) && !userDeletedChats[cId])
        .map(cId => {
          const other = cId.split('|').find(u => u !== currentUser);
          const lastMsg = messages[cId].slice(-1)[0];
          return { user: other, lastMsg: lastMsg ? (lastMsg.text || '[Media]') : '' };
        });

      socket.emit('chatList', chatList);
      socket.emit('chatDeleted', { chatId, byUser: currentUser });
    }
  });
});

// File upload route for media
app.post('/upload', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
