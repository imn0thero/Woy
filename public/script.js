document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
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
    
    // Variables
    let socket;
    let currentUser;
    let currentMedia = null;
    let typingTimeout;
    let typingStatus = false;
    
    // Encryption variables
    let userKeyPair = null;
    let serverPublicKey = null;
    let userPublicKeys = {};
    
    // Initialize
    init();
    
    // === CRYPTO FUNCTIONS ===
    
    // Generate consistent key pair for username
    async function generateOrRestoreKeyPair(username) {
        try {
            showLoginError('🔑 Mempersiapkan enkripsi...');
            
            // Try to load existing key pair from localStorage
            const storedKeyPair = loadKeyPairFromStorage(username);
            if (storedKeyPair) {
                console.log('🔑 Using stored key pair for', username);
                return storedKeyPair;
            }
            
            // Generate new key pair
            showLoginError('🔑 Membuat kunci enkripsi baru...');
            const keyPair = await window.crypto.subtle.generateKey(
                {
                    name: "RSA-OAEP",
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: "SHA-256"
                },
                true, // extractable
                ["encrypt", "decrypt"]
            );
            
            // Export keys to store them
            const publicKeyData = await exportKey(keyPair.publicKey, "spki");
            const privateKeyData = await exportKey(keyPair.privateKey, "pkcs8");
            
            // Save to localStorage
            saveKeyPairToStorage(username, publicKeyData, privateKeyData);
            
            console.log('🔑 Generated and saved new key pair for', username);
            return {
                publicKey: keyPair.publicKey,
                privateKey: keyPair.privateKey,
                publicKeyData: publicKeyData,
                privateKeyData: privateKeyData
            };
            
        } catch (error) {
            console.error('Error generating/restoring key pair:', error);
            throw error;
        }
    }
    
    // Export key to base64 string
    async function exportKey(key, format) {
        try {
            const exported = await window.crypto.subtle.exportKey(format, key);
            return arrayBufferToBase64(exported);
        } catch (error) {
            console.error('Error exporting key:', error);
            return null;
        }
    }
    
    // Import key from base64 string
    async function importKey(keyData, format, keyUsages) {
        try {
            const keyBuffer = base64ToArrayBuffer(keyData);
            return await window.crypto.subtle.importKey(
                format,
                keyBuffer,
                {
                    name: "RSA-OAEP",
                    hash: "SHA-256"
                },
                format === "pkcs8", // extractable only for private keys
                keyUsages
            );
        } catch (error) {
            console.error('Error importing key:', error);
            return null;
        }
    }
    
    // Save key pair to localStorage
    function saveKeyPairToStorage(username, publicKeyData, privateKeyData) {
        try {
            const keyPairData = {
                username: username,
                publicKey: publicKeyData,
                privateKey: privateKeyData,
                timestamp: Date.now(),
                version: "1.0"
            };
            
            localStorage.setItem(`chat_keypair_${username}`, JSON.stringify(keyPairData));
            console.log('💾 Key pair saved to localStorage for', username);
            return true;
        } catch (error) {
            console.error('Error saving key pair to storage:', error);
            return false;
        }
    }
    
    // Load key pair from localStorage
    function loadKeyPairFromStorage(username) {
        try {
            const storedData = localStorage.getItem(`chat_keypair_${username}`);
            if (!storedData) {
                console.log('📭 No stored key pair found for', username);
                return null;
            }
            
            const keyPairData = JSON.parse(storedData);
            
            // Validate data
            if (keyPairData.username !== username || !keyPairData.publicKey || !keyPairData.privateKey) {
                console.warn('⚠️ Invalid stored key pair data for', username);
                localStorage.removeItem(`chat_keypair_${username}`);
                return null;
            }
            
            return restoreKeyPairFromData(keyPairData);
            
        } catch (error) {
            console.error('Error loading key pair from storage:', error);
            // Clean up corrupted data
            localStorage.removeItem(`chat_keypair_${username}`);
            return null;
        }
    }
    
    // Restore key pair objects from stored data
    async function restoreKeyPairFromData(keyPairData) {
        try {
            const publicKey = await importKey(keyPairData.publicKey, "spki", ["encrypt"]);
            const privateKey = await importKey(keyPairData.privateKey, "pkcs8", ["decrypt"]);
            
            if (!publicKey || !privateKey) {
                throw new Error('Failed to import stored keys');
            }
            
            return {
                publicKey: publicKey,
                privateKey: privateKey,
                publicKeyData: keyPairData.publicKey,
                privateKeyData: keyPairData.privateKey
            };
        } catch (error) {
            console.error('Error restoring key pair from data:', error);
            return null;
        }
    }
    
    // Import public key from other users
    async function importPublicKey(publicKeyData) {
        try {
            if (!publicKeyData) return null;
            return await importKey(publicKeyData, "spki", ["encrypt"]);
        } catch (error) {
            console.error('Error importing public key:', error);
            return null;
        }
    }
    
    // Convert ArrayBuffer to Base64
    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    
    // Convert Base64 to ArrayBuffer
    function base64ToArrayBuffer(base64) {
        try {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes.buffer;
        } catch (error) {
            console.error('Error converting base64 to ArrayBuffer:', error);
            return null;
        }
    }
    
    // === AES ENCRYPTION FOR MESSAGE CONTENT ===
    
    async function generateAESKey() {
        return await window.crypto.subtle.generateKey(
            {
                name: "AES-GCM",
                length: 256
            },
            true,
            ["encrypt", "decrypt"]
        );
    }
    
    async function encryptWithAES(text, key) {
        try {
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encoder = new TextEncoder();
            const data = encoder.encode(text);
            
            const encrypted = await window.crypto.subtle.encrypt(
                { name: "AES-GCM", iv: iv },
                key,
                data
            );
            
            return {
                encrypted: arrayBufferToBase64(encrypted),
                iv: arrayBufferToBase64(iv)
            };
        } catch (error) {
            console.error('Error encrypting with AES:', error);
            return null;
        }
    }
    
    async function decryptWithAES(encryptedData, iv, key) {
        try {
            const encryptedBuffer = base64ToArrayBuffer(encryptedData);
            const ivBuffer = base64ToArrayBuffer(iv);
            
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: ivBuffer },
                key,
                encryptedBuffer
            );
            
            return new TextDecoder().decode(decrypted);
        } catch (error) {
            console.error('Error decrypting with AES:', error);
            return null;
        }
    }
    
    async function exportAESKey(key) {
        try {
            const exported = await window.crypto.subtle.exportKey("raw", key);
            return arrayBufferToBase64(exported);
        } catch (error) {
            console.error('Error exporting AES key:', error);
            return null;
        }
    }
    
    async function importAESKey(keyData) {
        try {
            const keyBuffer = base64ToArrayBuffer(keyData);
            return await window.crypto.subtle.importKey(
                "raw",
                keyBuffer,
                { name: "AES-GCM", length: 256 },
                false,
                ["decrypt"]
            );
        } catch (error) {
            console.error('Error importing AES key:', error);
            return null;
        }
    }
    
    // === RSA ENCRYPTION FOR AES KEYS ===
    
    async function encryptText(text, publicKey) {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(text);
            
            const encrypted = await window.crypto.subtle.encrypt(
                { name: "RSA-OAEP" },
                publicKey,
                data
            );
            
            return arrayBufferToBase64(encrypted);
        } catch (error) {
            console.error('Error encrypting text:', error);
            return null;
        }
    }
    
    async function decryptText(encryptedText, privateKey) {
        try {
            const data = base64ToArrayBuffer(encryptedText);
            
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "RSA-OAEP" },
                privateKey,
                data
            );
            
            return new TextDecoder().decode(decrypted);
        } catch (error) {
            console.error('Error decrypting text:', error);
            return null;
        }
    }
    
    // === MAIN FUNCTIONS ===
    
    function init() {
        // Focus username input
        usernameInput.focus();
        
        // Enter key for login
        usernameInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && usernameInput.value.trim()) {
                joinChat();
            }
        });
        
        // Join button click
        joinBtn.addEventListener('click', function() {
            if (usernameInput.value.trim()) {
                joinChat();
            }
        });
        
        // Auto-resize message input
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            
            // Enable/disable send button
            sendBtn.disabled = !this.value.trim() && !currentMedia;
            
            // Typing indicator
            handleTyping(this.value.trim());
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
    
    function handleTyping(isTyping) {
        if (isTyping && !typingStatus) {
            clearTimeout(typingTimeout);
            socket && socket.emit('typing', true);
            typingStatus = true;
            
            typingTimeout = setTimeout(() => {
                socket && socket.emit('typing', false);
                typingStatus = false;
            }, 2000);
        } else if (!isTyping && typingStatus) {
            clearTimeout(typingTimeout);
            socket && socket.emit('typing', false);
            typingStatus = false;
        }
    }
    
    async function joinChat() {
        const username = usernameInput.value.trim();
        
        if (!username) {
            showLoginError('Silakan masukkan nama pengguna');
            return;
        }
        
        try {
            // Generate or restore key pair first
            const keyPairResult = await generateOrRestoreKeyPair(username);
            userKeyPair = keyPairResult;
            
            showLoginError('🌐 Menghubungkan ke server...');
            
            // Connect to socket
            socket = io();
            
            // Setup socket event handlers
            setupSocketEvents(username);
            
            // Wait for connection and join
            socket.emit('join', username);
            
        } catch (error) {
            console.error('Error joining chat:', error);
            showLoginError('Gagal bergabung ke chat. Silakan refresh dan coba lagi.');
        }
    }
    
    function setupSocketEvents(username) {
        socket.on('connect', function() {
            console.log('🌐 Connected to server');
        });
        
        socket.on('connect_error', function(error) {
            console.error('🌐 Connection error:', error);
            showLoginError('Gagal terhubung ke server. Coba lagi.');
        });
        
        // Key exchange events
        socket.on('server_public_key', async function(data) {
            console.log('🔑 Received server public key');
            serverPublicKey = data.serverPublicKey;
            
            // Register our public key
            if (userKeyPair && userKeyPair.publicKeyData) {
                socket.emit('register_public_key', { publicKey: userKeyPair.publicKeyData });
                console.log('🔑 Registered our public key with server');
            }
        });
        
        socket.on('all_public_keys', function(keys) {
            console.log('🔑 Received public keys for users:', Object.keys(keys));
            userPublicKeys = keys;
        });
        
        socket.on('public_key_update', function(data) {
            console.log('🔑 Public key update for:', data.username);
            userPublicKeys[data.username] = data.publicKey;
        });
        
        // Authentication responses
        socket.on('unauthorized', function() {
            showLoginError('❌ Username tidak diizinkan! Hanya user terdaftar yang bisa masuk.');
        });
        
        socket.on('username_taken', function() {
            showLoginError('❌ Username sudah digunakan, pilih yang lain');
        });
        
        socket.on('room_full', function() {
            showLoginError('❌ Chat room penuh, coba lagi nanti');
        });
        
        // Success - show chat screen
        socket.on('load_messages', async function(messages) {
            console.log(`📥 Loading ${messages.length} messages`);
            
            // Clear login screen and show chat
            currentUser = username;
            loginScreen.classList.add('hidden');
            chatScreen.classList.remove('hidden');
            messageInput.focus();
            
            // Load all messages
            messagesContainer.innerHTML = '';
            for (const message of messages) {
                await displayMessage(message);
            }
            scrollToBottom();
        });
        
        socket.on('message_received', async function(message) {
            await displayMessage(message);
            scrollToBottom();
        });
        
        // User events
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
            showSystemMessage('🧹 Semua pesan telah dihapus');
        });
        
        socket.on('user_joined', function(username) {
            showSystemMessage(`💕 ${username} bergabung dalam chat`);
        });
        
        socket.on('user_left', function(username) {
            showSystemMessage(`💔 ${username} meninggalkan chat`);
        });
    }
    
    async function sendMessage() {
        const text = messageInput.value.trim();
        
        if (!text && !currentMedia) return;
        
        try {
            // Prepare message data
            const messageData = {
                text: text || '',
                media: currentMedia || null,
                timestamp: new Date().toISOString()
            };
            
            // Generate AES key for this message
            const aesKey = await generateAESKey();
            
            // Encrypt message content with AES
            const messageString = JSON.stringify(messageData);
            const encryptedContent = await encryptWithAES(messageString, aesKey);
            
            if (!encryptedContent) {
                throw new Error('Failed to encrypt message content');
            }
            
            // Export AES key to encrypt with RSA
            const rawAesKey = await exportAESKey(aesKey);
            if (!rawAesKey) {
                throw new Error('Failed to export AES key');
            }
            
            // Encrypt AES key for all online users (including self)
            const encryptedKeys = {};
            const onlineUsers = getOnlineUsers();
            
            console.log('🔐 Encrypting for users:', onlineUsers);
            
            for (const username of onlineUsers) {
                try {
                    let publicKeyData;
                    
                    // Use our own public key for our messages
                    if (username === currentUser) {
                        publicKeyData = userKeyPair.publicKeyData;
                    } else {
                        publicKeyData = userPublicKeys[username];
                    }
                    
                    if (publicKeyData) {
                        const publicKey = await importPublicKey(publicKeyData);
                        if (publicKey) {
                            const encryptedKey = await encryptText(rawAesKey, publicKey);
                            if (encryptedKey) {
                                encryptedKeys[username] = encryptedKey;
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Error encrypting for user ${username}:`, error);
                }
            }
            
            // Send encrypted message
            socket.emit('new_message', {
                type: 'encrypted',
                encryptedContent: encryptedContent,
                encryptedKeys: encryptedKeys,
                media: currentMedia
            });
            
            console.log('📤 Encrypted message sent');
            
            // Reset input
            resetMessageInput();
            
        } catch (error) {
            console.error('❌ Error sending encrypted message:', error);
            showSystemMessage('❌ Gagal mengirim pesan terenkripsi');
        }
    }
    
    function getOnlineUsers() {
        return Array.from(onlineUsersList.children).map(li => {
            let username = li.textContent;
            // Clean up the username from extra text
            username = username.replace(/\s*\(Kamu\).*$/, '');
            username = username.replace(/\s*[🔒⚠️].*$/, '');
            return username.trim();
        });
    }
    
    function resetMessageInput() {
        messageInput.value = '';
        messageInput.style.height = 'auto';
        currentMedia = null;
        attachmentPreview.innerHTML = '';
        sendBtn.disabled = true;
        
        // Reset typing
        clearTimeout(typingTimeout);
        if (typingStatus) {
            socket.emit('typing', false);
            typingStatus = false;
        }
        
        messageInput.focus();
    }
    
    async function displayMessage(message) {
        try {
            const template = document.getElementById('message-template');
            const messageEl = document.importNode(template.content, true).querySelector('.message');
            
            // Check if own message
            if (message.username === currentUser) {
                messageEl.classList.add('own');
            }
            
            // Set username and time
            messageEl.querySelector('.message-username').textContent = message.username;
            
            const timestamp = new Date(message.timestamp);
            const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            messageEl.querySelector('.message-time').textContent = timeString;
            
            // Set content
            const contentEl = messageEl.querySelector('.message-content');
            
            // Handle encrypted messages
            if (message.type === 'encrypted') {
                await displayEncryptedMessage(message, contentEl);
            }
            // Handle regular messages (fallback)
            else {
                displayRegularMessage(message, contentEl);
            }
            
            messagesContainer.appendChild(messageEl);
            
        } catch (error) {
            console.error('❌ Error displaying message:', error);
        }
    }
    
    async function displayEncryptedMessage(message, contentEl) {
        try {
            // Check if we have the encrypted key for this message
            const encryptedKey = message.encryptedKeys && message.encryptedKeys[currentUser];
            
            if (!encryptedKey) {
                contentEl.innerHTML = '🔒 <em>Pesan terenkripsi (kunci tidak tersedia)</em>';
                console.warn('⚠️ No encryption key available for current user');
                return;
            }
            
            if (!userKeyPair || !userKeyPair.privateKey) {
                contentEl.innerHTML = '🔒 <em>Tidak dapat membaca pesan (kunci pribadi tidak tersedia)</em>';
                console.error('⚠️ No private key available');
                return;
            }
            
            // Decrypt AES key using RSA private key
            const decryptedAesKeyRaw = await decryptText(encryptedKey, userKeyPair.privateKey);
            if (!decryptedAesKeyRaw) {
                throw new Error('Failed to decrypt AES key');
            }
            
            // Import AES key
            const decryptedAesKey = await importAESKey(decryptedAesKeyRaw);
            if (!decryptedAesKey) {
                throw new Error('Failed to import AES key');
            }
            
            // Decrypt message content using AES
            const decryptedContent = await decryptWithAES(
                message.encryptedContent.encrypted,
                message.encryptedContent.iv,
                decryptedAesKey
            );
            
            if (!decryptedContent) {
                throw new Error('Failed to decrypt message content');
            }
            
            // Parse decrypted content
            const messageData = JSON.parse(decryptedContent);
            
            // Display text
            if (messageData.text) {
                contentEl.innerHTML += formatMessageText(messageData.text);
            }
            
            // Display media
            if (messageData.media) {
                displayMediaContent(contentEl, messageData.media);
            }
            
            // Add encryption indicator
            const encryptionIcon = document.createElement('span');
            encryptionIcon.innerHTML = ' 🔒';
            encryptionIcon.style.fontSize = '12px';
            encryptionIcon.style.opacity = '0.7';
            encryptionIcon.style.color = '#4caf50';
            encryptionIcon.title = 'Pesan terenkripsi end-to-end';
            contentEl.appendChild(encryptionIcon);
            
        } catch (error) {
            console.error('❌ Error decrypting message:', error);
            contentEl.innerHTML = '🔒 <em>Gagal mendekripsi pesan</em>';
        }
    }
    
    function displayRegularMessage(message, contentEl) {
        if (message.text) {
            contentEl.innerHTML += formatMessageText(message.text);
        }
        
        if (message.media) {
            displayMediaContent(contentEl, message.media);
        }
    }
    
    function displayMediaContent(contentEl, media) {
        if (!media || !media.path) return;
        
        const mediaPath = media.path;
        const fileExt = mediaPath.split('.').pop().toLowerCase();
        
        // Images
        if (['jpg', 'jpeg', 'png', 'gif'].includes(fileExt)) {
            const img = document.createElement('img');
            img.src = mediaPath;
            img.alt = 'Image';
            img.loading = 'lazy';
            contentEl.appendChild(img);
        }
        // Videos
        else if (['mp4', 'mov', 'avi', 'webm'].includes(fileExt)) {
            const video = document.createElement('video');
            video.src = mediaPath;
            video.controls = true;
            contentEl.appendChild(video);
        }
        // Audio
        else if (['mp3', 'wav', 'ogg', 'm4a'].includes(fileExt)) {
            const audio = document.createElement('audio');
            audio.src = mediaPath;
            audio.controls = true;
            contentEl.appendChild(audio);
        }
        // Documents
        else {
            const link = document.createElement('a');
            link.href = mediaPath;
            link.target = '_blank';
            link.textContent = media.originalName || 'Download File';
            
            const fileIcon = document.createElement('i');
            fileIcon.className = 'fas fa-file';
            fileIcon.style.marginRight = '5px';
            
            link.prepend(fileIcon);
            contentEl.appendChild(document.createElement('br'));
            contentEl.appendChild(link);
        }
    }
    
    function formatMessageText(text) {
        return text.replace(
            /(https?:\/\/[^\s]+)/g, 
            '<a href="\$1" target="_blank">$1</a>'
        ).replace(/\n/g, '<br>');
    }
    
    function showSystemMessage(text) {
        const messageEl = document.createElement('div');
        messageEl.className = 'system-message';
        messageEl.textContent = text;
        messagesContainer.appendChild(messageEl);
        scrollToBottom();
    }
    
    function showLoginError(message) {
        loginError.textContent = message;
        if (!message.includes('🔑') && !message.includes('🌐') && message !== '') {
            usernameInput.classList.add('error');
            setTimeout(() => {
                usernameInput.classList.remove('error');
            }, 1000);
        }
    }
    
    // === FILE HANDLING ===
    
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
        .then(response => {
            if (!response.ok) {
                throw new Error('Upload failed');
            }
            return response.json();
        })
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
    
    // === UI FUNCTIONS ===
    
    function updateOnlineUsers(users) {
        onlineUsersList.innerHTML = '';
        onlineCount.textContent = users.length;
        usersCount.textContent = `(${users.length})`;
        
        users.forEach(user => {
            const li = document.createElement('li');
            li.textContent = user.username;
            
            if (user.username === currentUser) {
                li.classList.add('current-user');
                li.textContent += ' (Kamu)';
            }
            
            // Add encryption status
            const encryptionStatus = document.createElement('span');
            if (userPublicKeys[user.username] || user.username === currentUser) {
                encryptionStatus.innerHTML = ' 🔒';
                encryptionStatus.title = 'Enkripsi aktif';
                encryptionStatus.style.color = '#4caf50';
            } else {
                encryptionStatus.innerHTML = ' ⚠️';
                encryptionStatus.title = 'Enkripsi belum siap';
                encryptionStatus.style.color = '#ff9800';
            }
            encryptionStatus.style.fontSize = '12px';
            li.appendChild(encryptionStatus);
            
            onlineUsersList.appendChild(li);
        });
    }
    
    function confirmClearMessages() {
        if (confirm('Hapus semua pesan? Tindakan ini tidak dapat dibatalkan.')) {
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
