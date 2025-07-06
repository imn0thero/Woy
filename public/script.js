document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const keyGenerationScreen = document.getElementById('key-generation-screen');
    const loginScreen = document.getElementById('login-screen');
    const chatScreen = document.getElementById('chat-screen');
    const usernameInput = document.getElementById('username-input');
    const joinBtn = document.getElementById('join-btn');
    const loginError = document.getElementById('login-error');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const messagesContainer = document.getElementById('messages');
    const fileInput = document.getElementById('file-input');
    const attachmentPreview = document.getElementById('attachment-preview');
    const onlineUsersList = document.getElementById('online-users-list');
    const onlineCount = document.getElementById('online-count');
    const usersCount = document.getElementById('users-count');
    const clearMessagesBtn = document.getElementById('clear-messages-btn');
    const typingIndicator = document.getElementById('typing-indicator');
    const typingUsername = document.getElementById('typing-username');
    const onlineUsersToggle = document.getElementById('online-users-toggle');
    const onlineUsersPanel = document.getElementById('online-users-panel');
    const closeUsersBtn = document.getElementById('close-users-btn');
    
    // Encryption Variables
    let myKeyPair = null;
    let myUsername = null;
    let publicKeys = {};
    let serverPublicKey = null;
    let isKeysReady = false;
    
    // Other Variables
    let socket;
    let currentUser;
    let currentMedia = null;
    let typingTimeout;
    
    // Initialize
    init();
    
    // Functions
    async function init() {
        try {
            // Generate encryption keys
            await generateKeyPair();
            
            // Hide key generation screen, show login
            keyGenerationScreen.classList.add('hidden');
            loginScreen.classList.remove('hidden');
            isKeysReady = true;
            
            // Focus username input
            usernameInput.focus();
            
            // Setup event listeners
            setupEventListeners();
            
        } catch (error) {
            console.error('Failed to initialize encryption:', error);
            alert('Gagal menginisialisasi enkripsi. Silakan refresh halaman.');
        }
    }
    
    // Generate RSA key pair untuk enkripsi
    async function generateKeyPair() {
        const keyPair = await window.crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256",
            },
            true,
            ["encrypt", "decrypt"]
        );
        
        const publicKeyExported = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
        const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyExported)));
        const publicKeyPEM = `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64}\n-----END PUBLIC KEY-----`;
        
        myKeyPair = { keyPair, publicKeyPEM };
        console.log('🔒 Encryption keys generated successfully');
    }
    
    // Enkripsi pesan untuk recipient tertentu
    async function encryptForRecipient(message, recipientPublicKey) {
        try {
            const pemHeader = "-----BEGIN PUBLIC KEY-----";
            const pemFooter = "-----END PUBLIC KEY-----";
            const pemContents = recipientPublicKey.substring(
                pemHeader.length,
                recipientPublicKey.length - pemFooter.length
            ).replace(/\s/g, '');
            
            const binaryDer = window.atob(pemContents);
            const binaryDerArray = new Uint8Array(binaryDer.length);
            for (let i = 0; i < binaryDer.length; i++) {
                binaryDerArray[i] = binaryDer.charCodeAt(i);
            }
            
            const recipientKey = await window.crypto.subtle.importKey(
                "spki", binaryDerArray.buffer,
                { name: "RSA-OAEP", hash: "SHA-256" },
                false, ["encrypt"]
            );
            
            // Generate symmetric key untuk enkripsi pesan
            const symmetricKey = await window.crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                true, ["encrypt", "decrypt"]
            );
            
            const encoder = new TextEncoder();
            const messageBytes = encoder.encode(message);
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            
            // Enkripsi pesan dengan symmetric key
            const encryptedMessage = await window.crypto.subtle.encrypt(
                { name: "AES-GCM", iv: iv },
                symmetricKey, messageBytes
            );
            
            // Enkripsi symmetric key dengan public key recipient
            const rawSymmetricKey = await window.crypto.subtle.exportKey("raw", symmetricKey);
            const encryptedSymmetricKey = await window.crypto.subtle.encrypt(
                { name: "RSA-OAEP" },
                recipientKey, rawSymmetricKey
            );
            
            return {
                iv: Array.from(iv),
                encryptedMessage: Array.from(new Uint8Array(encryptedMessage)),
                encryptedSymmetricKey: Array.from(new Uint8Array(encryptedSymmetricKey))
            };
        } catch (error) {
            console.error('Encryption failed:', error);
            throw error;
        }
    }
    
    // Dekripsi pesan
    async function decryptMessage(encryptedContent, encryptedKey) {
        try {
            const encryptedKeyArray = new Uint8Array(encryptedKey);
            const decryptedSymmetricKey = await window.crypto.subtle.decrypt(
                { name: "RSA-OAEP" },
                myKeyPair.keyPair.privateKey,
                encryptedKeyArray.buffer
            );
            
            const symmetricKey = await window.crypto.subtle.importKey(
                "raw", decryptedSymmetricKey,
                { name: "AES-GCM", length: 256 },
                false, ["decrypt"]
            );
            
            const iv = new Uint8Array(encryptedContent.iv);
            const encryptedMessageArray = new Uint8Array(encryptedContent.encryptedMessage);
            
            const decryptedMessage = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                symmetricKey, encryptedMessageArray.buffer
            );
            
            const decoder = new TextDecoder();
            return decoder.decode(decryptedMessage);
        } catch (error) {
            console.error("Decryption failed:", error);
            return null;
        }
    }
    
    function setupEventListeners() {
        // Enter key for login
        usernameInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && usernameInput.value.trim() && isKeysReady) {
                joinChat();
            }
        });
        
        // Join button click
        joinBtn.addEventListener('click', function() {
            if (usernameInput.value.trim() && isKeysReady) {
                joinChat();
            } else if (!isKeysReady) {
                showLoginError('Kunci enkripsi masih diproses. Harap tunggu...');
            }
        });
        
        // Auto-resize message input
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            
            // Enable/disable send button
            sendBtn.disabled = !this.value.trim() && !currentMedia;
            
            // Typing indicator
            if (this.value.trim()) {
                clearTimeout(typingTimeout);
                socket.emit('typing', true);
                
                typingTimeout = setTimeout(() => {
                    socket.emit('typing', false);
                }, 2000);
            } else {
                clearTimeout(typingTimeout);
                socket.emit('typing', false);
            }
        });
        
        // Send message on Enter (but Shift+Enter for new line)
        messageInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!sendBtn.disabled) {
                    sendMessage();
                }
            }
        });
        
        // Send button click
        sendBtn.addEventListener('click', sendMessage);
        
        // File input change
        fileInput.addEventListener('change', handleFileSelect);
        
        // Clear messages button
        clearMessagesBtn.addEventListener('click', confirmClearMessages);
        
        // Toggle online users panel
        onlineUsersToggle.addEventListener('click', toggleOnlineUsers);
        closeUsersBtn.addEventListener('click', toggleOnlineUsers);
        
        // Handle window resize
        window.addEventListener('resize', handleResize);
    }
    
    function joinChat() {
        const username = usernameInput.value.trim();
        
        if (!username) {
            showLoginError('Silakan masukkan nama pengguna');
            return;
        }
        
        if (!isKeysReady) {
            showLoginError('Kunci enkripsi belum siap. Harap tunggu...');
            return;
        }
        
        // Connect to socket
        socket = io();
        
        // Setup socket events
        setupSocketEvents(username);
        
        // Join room
        socket.emit('join', username);
    }
    
    function setupSocketEvents(username) {
        socket.on('connect', function() {
            console.log('🔌 Connected to server');
        });

        socket.on('server_public_key', (data) => {
            serverPublicKey = data.serverPublicKey;
            console.log('🔑 Received server public key');
        });

        socket.on('all_public_keys', (keys) => {
            publicKeys = keys;
            console.log('🔑 Received public keys for users:', Object.keys(publicKeys));
        });

        socket.on('public_key_update', (data) => {
            publicKeys[data.username] = data.publicKey;
            console.log(`🔑 Updated public key for ${data.username}`);
        });
        
        socket.on('unauthorized', () => {
            showLoginError('Username tidak diizinkan! Hanya user yang terdaftar yang bisa masuk.');
        });
        
        socket.on('username_taken', function() {
            showLoginError('Nama pengguna sudah digunakan, silakan pilih yang lain');
        });
        
        socket.on('room_full', function() {
            showLoginError('Chat room penuh, silakan coba lagi nanti');
        });
        
        socket.on('load_messages', async function(messages) {
            currentUser = username;
            myUsername = username;
            
            // Register public key
            socket.emit('register_public_key', {
                publicKey: myKeyPair.publicKeyPEM
            });
            
            loginScreen.classList.add('hidden');
            chatScreen.classList.remove('hidden');
            
            // Load and decrypt messages
            messagesContainer.innerHTML = '';
            for (const message of messages) {
                await displayMessage(message);
            }
            scrollToBottom();
            messageInput.focus();
        });
        
        socket.on('message_received', async function(message) {
            await displayMessage(message);
            scrollToBottom();
        });
        
        socket.on('user_list_update', function(users) {
            updateOnlineUsers(users);
        });
        
        socket.on('user_typing', function(data) {
            if (data.isTyping) {
                typingUsername.textContent = data.username;
                typingIndicator.classList.remove('hidden');
            } else {
                typingIndicator.classList.add('hidden');
            }
        });
        
        socket.on('messages_cleared', function() {
            messagesContainer.innerHTML = '';
            showSystemMessage('Semua pesan telah dihapus');
        });
        
        socket.on('user_joined', function(username) {
            showSystemMessage(`${username} bergabung dalam chat`);
        });
        
        socket.on('user_left', function(username) {
            showSystemMessage(`${username} meninggalkan chat`);
        });
    }
    
    function showLoginError(message) {
        loginError.textContent = message;
        usernameInput.classList.add('error');
        
        setTimeout(() => {
            usernameInput.classList.remove('error');
        }, 1000);
    }
    
    async function sendMessage() {
        const text = messageInput.value.trim();
        
        if (!text && !currentMedia) return;
        
        try {
            await sendEncryptedMessage(text, currentMedia);
            
            // Reset input
            messageInput.value = '';
            messageInput.style.height = 'auto';
            currentMedia = null;
            attachmentPreview.innerHTML = '';
            sendBtn.disabled = true;
            
            // Reset typing
            clearTimeout(typingTimeout);
            socket.emit('typing', false);
            
            // Focus input
            messageInput.focus();
        } catch (error) {
            console.error('Failed to send message:', error);
            alert('Gagal mengirim pesan terenkripsi. Silakan coba lagi.');
        }
    }
    
    async function sendEncryptedMessage(messageText, mediaData = null) {
        if (!myUsername || !myKeyPair) return;
        
        try {
            const messageObj = {
                text: messageText,
                media: mediaData,
                timestamp: new Date()
            };
            
            const encryptedKeys = {};
            
            // Enkripsi untuk diri sendiri
            const encryptedContent = await encryptForRecipient(JSON.stringify(messageObj), myKeyPair.publicKeyPEM);
            encryptedKeys[myUsername] = encryptedContent.encryptedSymmetricKey;
            
            // Enkripsi untuk setiap user lain
            for (const username in publicKeys) {
                if (username !== myUsername && publicKeys[username]) {
                    try {
                        const encryptedForUser = await encryptForRecipient(JSON.stringify(messageObj), publicKeys[username]);
                        encryptedKeys[username] = encryptedForUser.encryptedSymmetricKey;
                    } catch (error) {
                        console.error(`Failed to encrypt for ${username}:`, error);
                    }
                }
            }
            
            socket.emit('new_message', {
                encryptedContent: {
                    iv: encryptedContent.iv,
                    encryptedMessage: encryptedContent.encryptedMessage
                },
                encryptedKeys: encryptedKeys,
                media: mediaData,
                type: 'encrypted'
            });
            
        } catch (error) {
            console.error('Failed to send encrypted message:', error);
            throw error;
        }
    }
    
    async function displayMessage(message) {
        const template = document.getElementById('message-template');
        const messageEl = document.importNode(template.content, true).querySelector('.message');
        
        // Check if own message
        if (message.username === currentUser) {
            messageEl.classList.add('own');
        }
        
        // Add encrypted class
        if (message.type === 'encrypted') {
            messageEl.classList.add('encrypted-message');
        }
        
        // Set username and time
        messageEl.querySelector('.message-username').textContent = message.username;
        
        const timestamp = new Date(message.timestamp);
        const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageEl.querySelector('.message-time').textContent = timeString;
        
        // Set content
        const contentEl = messageEl.querySelector('.message-content');
        let messageText = '';
        let mediaContent = '';
        
        if (message.type === 'encrypted') {
            if (message.encryptedKeys && message.encryptedKeys[myUsername]) {
                try {
                    const decryptedContent = await decryptMessage(
                        message.encryptedContent,
                        message.encryptedKeys[myUsername]
                    );
                    
                    if (decryptedContent) {
                        const parsedContent = JSON.parse(decryptedContent);
                        messageText = parsedContent.text || '';
                        if (parsedContent.media) {
                            mediaContent = createMediaContent(parsedContent.media);
                        }
                    } else {
                        messageText = '❌ Gagal mendekripsi pesan';
                        messageEl.classList.add('decrypt-error');
                    }
                } catch (error) {
                    messageText = '❌ Error dekripsi pesan';
                    messageEl.classList.add('decrypt-error');
                }
            } else {
                messageText = '🔒 Pesan terenkripsi - tidak ada kunci';
                messageEl.classList.add('decrypt-error');
            }
        } else {
            messageText = message.text || '';
            if (message.media) {
                mediaContent = createMediaContent(message.media);
            }
        }
        
        if (messageText) {
            contentEl.innerHTML = formatMessageText(messageText);
        }
        
        if (mediaContent) {
            contentEl.innerHTML += mediaContent;
        }
        
        messagesContainer.appendChild(messageEl);
    }
    
    function createMediaContent(media) {
        if (!media || !media.path) return '';
        
        const mediaPath = media.path;
        const fileExt = mediaPath.split('.').pop().toLowerCase();
        
        // Images
        if (['jpg', 'jpeg', 'png', 'gif'].includes(fileExt)) {
            return `<img src="${mediaPath}" alt="Image" loading="lazy">`;
        }
        // Videos
        else if (['mp4', 'mov', 'avi', 'webm'].includes(fileExt)) {
            return `<video src="${mediaPath}" controls></video>`;
        }
        // Audio
        else if (['mp3', 'wav', 'ogg', 'm4a'].includes(fileExt)) {
            return `<audio src="${mediaPath}" controls></audio>`;
        }
        // Documents
        else {
            const fileName = media.originalName || 'Download File';
            return `<br><a href="${mediaPath}" target="_blank"><i class="fas fa-file"></i> ${fileName}</a>`;
        }
    }
    
    function formatMessageText(text) {
        // Replace URLs with clickable links
        return text.replace(
            /(https?:\/\/[^\s]+)/g, 
            '<a href="\$1" target="_blank">$1</a>'
        ).replace(/\n/g, '<br>');
    }
    
    function showSystemMessage(text) {
        const messageEl = document.createElement('div');
        messageEl.className = 'system-message';
        messageEl.innerHTML = `<i class="fas fa-info-circle"></i> ${text}`;
        messagesContainer.appendChild(messageEl);
        scrollToBottom();
    }
    
    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        // Check file size (max 50MB)
        if (file.size > 50 * 1024 * 1024) {
            alert('File terlalu besar. Maksimal 50MB.');
            fileInput.value = '';
            return;
        }
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            attachmentPreview.innerHTML = '';
            
            const previewItem = document.createElement('div');
            previewItem.className = 'attachment-item';
            
            // Check file type
            const fileType = file.type.split('/')[0];
            
            if (fileType === 'image') {
                const img = document.createElement('img');
                img.src = e.target.result;
                previewItem.appendChild(img);
            } else {
                const icon = document.createElement('div');
                icon.className = 'file-icon';
                
                if (fileType === 'video') {
                    icon.innerHTML = '<i class="fas fa-file-video"></i>';
                } else if (fileType === 'audio') {
                    icon.innerHTML = '<i class="fas fa-file-audio"></i>';
                } else {
                    icon.innerHTML = '<i class="fas fa-file"></i>';
                }
                
                const fileName = document.createElement('div');
                fileName.className = 'file-name';
                fileName.textContent = file.name.length > 20 ? 
                    file.name.substring(0, 17) + '...' : file.name;
                
                previewItem.appendChild(icon);
                previewItem.appendChild(fileName);
            }
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-attachment';
            removeBtn.innerHTML = '<i class="fas fa-times"></i>';
            removeBtn.addEventListener('click', function() {
                attachmentPreview.innerHTML = '';
                fileInput.value = '';
                currentMedia = null;
                sendBtn.disabled = !messageInput.value.trim();
            });
            
            previewItem.appendChild(removeBtn);
            attachmentPreview.appendChild(previewItem);
            
            // Upload file to server
            uploadFile(file);
        };
        
        reader.readAsDataURL(file);
    }
    
    function uploadFile(file) {
        const formData = new FormData();
        formData.append('media', file);
        
        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            currentMedia = {
                path: data.path,
                originalName: data.originalName,
                size: data.size
            };
            sendBtn.disabled = false;
        })
        .catch(error => {
            console.error('Error uploading file:', error);
            alert('Gagal mengunggah file. Silakan coba lagi.');
            attachmentPreview.innerHTML = '';
            fileInput.value = '';
        });
    }
    
    function updateOnlineUsers(users) {
        onlineUsersList.innerHTML = '';
        onlineCount.textContent = users.length;
        usersCount.textContent = `(${users.length})`;
        
        users.forEach(user => {
            const li = document.createElement('li');
            li.innerHTML = `
                <i class="fas fa-user-circle"></i>
                ${user.username}
                ${user.username === currentUser ? ' (Kamu)' : ''}
                <i class="fas fa-shield-alt encryption-icon" title="Enkripsi Aktif"></i>
            `;
            
            if (user.username === currentUser) {
                li.classList.add('current-user');
            }
            
            onlineUsersList.appendChild(li);
        });
    }
    
    function confirmClearMessages() {
        if (confirm('Hapus semua pesan terenkripsi? Tindakan ini tidak dapat dibatalkan.')) {
            socket.emit('clear_messages');
        }
    }
    
    function toggleOnlineUsers() {
        const isMobile = window.innerWidth <= 768;
        
        if (isMobile) {
            onlineUsersPanel.classList.toggle('active');
        } else {
            onlineUsersPanel.classList.toggle('hidden-mobile');
            adjustMessagesContainer();
        }
    }
    
    function handleResize() {
        const isMobile = window.innerWidth <= 768;
        
        if (isMobile) {
            onlineUsersPanel.classList.remove('active');
            onlineUsersPanel.classList.add('hidden-mobile');
        } else {
            adjustMessagesContainer();
        }
    }
    
    function adjustMessagesContainer() {
        if (window.innerWidth > 768) {
            const isPanelVisible = !onlineUsersPanel.classList.contains('hidden-mobile');
            document.getElementById('messages-container').style.marginLeft = 
                isPanelVisible ? '250px' : '0';
        } else {
            document.getElementById('messages-container').style.marginLeft = '0';
        }
    }
    
    function scrollToBottom() {
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 50);
    }
});
