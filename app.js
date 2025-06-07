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

// --- Folder & file setup ---
const uploadsDir = './uploads';
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const usersFile = './users.json';
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify({}, null, 2));

const messagesFile = './messages.json';
if (!fs.existsSync(messagesFile)) fs.writeFileSync(messagesFile, JSON.stringify({}, null, 2));

// --- Multer config for uploads ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, name + ext);
  }
});
const upload = multer({ storage });

// --- Load users and messages ---
let users = JSON.parse(fs.readFileSync(usersFile));
let messages = JSON.parse(fs.readFileSync(messagesFile)); // { chatId: [ messages ] }

function saveUsers() {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}
function saveMessages() {
  fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));
}

function getChatId(user1, user2) {
  return [user1, user2].sort().join('|');
}

// --- In-memory user tracking ---
const onlineUsers = {};
const deletedChatsByUser = {}; // { username: { chatId: true } }

io.on('connection', socket => {
  let currentUser = null;

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
    io.emit('onlineUsers', Object.keys(onlineUsers));

    const userDeleted = deletedChatsByUser[currentUser] || {};
    const chatList = Object.keys(messages)
      .filter(chatId => chatId.includes(currentUser) && !userDeleted[chatId])
      .map(chatId => {
        const other = chatId.split('|').find(u => u !== currentUser);
        const lastMsg = messages[chatId].slice(-1)[0];
        return { user: other, lastMsg: lastMsg ? (lastMsg.text || '[Media]') : '' };
      });

    socket.emit('loginResult', { success: true, user: currentUser });
    socket.emit('chatList', chatList);
  });

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

  socket.on('disconnect', () => {
    if (currentUser) {
      delete onlineUsers[currentUser];
      io.emit('onlineUsers', Object.keys(onlineUsers));
    }
  });

  socket.on('startChat', (otherUser) => {
    if (!currentUser || !otherUser) return;
    const chatId = getChatId(currentUser, otherUser);
    const deleted = deletedChatsByUser[currentUser] || {};
    if (deleted[chatId]) {
      socket.emit('chatMessages', []);
      return;
    }
    const chatHistory = messages[chatId] || [];
    socket.emit('chatMessages', chatHistory);
  });

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
    saveMessages();

    [currentUser, to].forEach(user => {
      const sockId = onlineUsers[user];
      if (sockId) {
        io.to(sockId).emit('newMessage', { chatId, message: msg });

        const deleted = deletedChatsByUser[user] || {};
        const chatList = Object.keys(messages)
          .filter(id => id.includes(user) && !deleted[id])
          .map(id => {
            const other = id.split('|').find(u => u !== user);
            const last = messages[id].slice(-1)[0];
            return { user: other, lastMsg: last ? (last.text || '[Media]') : '' };
          });
        io.to(sockId).emit('chatList', chatList);
      }
    });
  });

  socket.on('deleteChat', ({ withUser, deleteForAll }) => {
    if (!currentUser || !withUser) return;
    const chatId = getChatId(currentUser, withUser);

    if (deleteForAll) {
      delete messages[chatId];
      saveMessages();

      [currentUser, withUser].forEach(user => {
        const sockId = onlineUsers[user];
        const deleted = deletedChatsByUser[user] || {};
        const chatList = Object.keys(messages)
          .filter(id => id.includes(user) && !deleted[id])
          .map(id => {
            const other = id.split('|').find(u => u !== user);
            const last = messages[id].slice(-1)[0];
            return { user: other, lastMsg: last ? (last.text || '[Media]') : '' };
          });
        if (sockId) {
          io.to(sockId).emit('chatList', chatList);
          io.to(sockId).emit('chatDeleted', { chatId, byUser: currentUser });
        }
      });
    } else {
      if (!deletedChatsByUser[currentUser]) deletedChatsByUser[currentUser] = {};
      deletedChatsByUser[currentUser][chatId] = true;

      const chatList = Object.keys(messages)
        .filter(id => id.includes(currentUser) && !deletedChatsByUser[currentUser][id])
        .map(id => {
          const other = id.split('|').find(u => u !== currentUser);
          const last = messages[id].slice(-1)[0];
          return { user: other, lastMsg: last ? (last.text || '[Media]') : '' };
        });

      socket.emit('chatList', chatList);
      socket.emit('chatDeleted', { chatId, byUser: currentUser });
    }
  });
});

app.post('/upload', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
