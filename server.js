const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- State Management ---
let users = {};
let messageHistory = [];

// --- File Upload Setup (Multer) ---
const uploadDir = 'public/uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const safeFilename = file.originalname.replace(/[^a-zA-Z0-9-._]/g, '');
        cb(null, Date.now() + '-' + safeFilename);
    }
});
const upload = multer({ storage: storage });

// --- Middleware & Routes ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }
    res.json({ filePath: `/uploads/${req.file.filename}` });
});

// --- Socket.IO Connection Logic ---
io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    // --- Join Logic ---
    socket.on('join', (username) => {
        const cleanUsername = username.trim();
        if (!cleanUsername || cleanUsername.length > 15) {
            return socket.emit('join-error', { message: 'Username must be 1-15 characters.' });
        }
        const isTaken = Object.values(users).some(u => u.name.toLowerCase() === cleanUsername.toLowerCase());
        if (isTaken) {
            return socket.emit('join-error', { message: 'Username is taken.' });
        }

        users[socket.id] = { id: socket.id, name: cleanUsername };
        socket.emit('join-success', { user: users[socket.id], history: messageHistory });
        io.emit('update-users', { users: Object.values(users) });
        socket.broadcast.emit('system-message', `${cleanUsername} has joined.`);
    });

    // --- Message Logic ---
    socket.on('chat message', (msg) => {
        if (!users[socket.id]) return;

        const messageData = {
            id: Date.now(),
            type: msg.type, // 'text' or 'file'
            content: msg.content,
            user: users[socket.id],
            replyTo: msg.replyTo,
            timestamp: new Date()
        };

        messageHistory.push(messageData);
        if (messageHistory.length > 200) messageHistory.shift(); // Keep history manageable
        
        io.emit('chat message', messageData);
    });
    
    // --- Delete Message Logic ---
    socket.on('delete message', (messageId) => {
        const msgIndex = messageHistory.findIndex(m => m.id === messageId);
        if (msgIndex !== -1) {
            // Security check: only allow user to delete their own messages
            if (messageHistory[msgIndex].user.id === socket.id) {
                messageHistory.splice(msgIndex, 1);
                io.emit('message deleted', messageId);
            }
        }
    });

    // --- Typing & Disconnect Logic ---
    socket.on('typing', () => {
        if (!users[socket.id]) return;
        socket.broadcast.emit('typing-status', { user: users[socket.id], isTyping: true });
    });
    socket.on('stop-typing', () => {
        if (!users[socket.id]) return;
        socket.broadcast.emit('typing-status', { user: users[socket.id], isTyping: false });
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            console.log(`${user.name} disconnected`);
            delete users[socket.id];
            io.emit('system-message', `${user.name} has left.`);
            io.emit('update-users', { users: Object.values(users) });
            socket.broadcast.emit('typing-status', { user: { id: socket.id }, isTyping: false });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));