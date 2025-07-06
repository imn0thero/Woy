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
    
    // Encryption variables
    let userKeyPair = null;
    let serverPublicKey = null;
    let userPublicKeys = {};
    
    // Initialize
    init();
    
    // Crypto Functions
    async function generateKeyPair() {
        try {
            const keyPair = await crypto.subtle.generateKey(
                {
                    name: "RSA-OAEP",
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: "SHA-256"
                },
                true,
                ["encrypt", "decrypt"]
            );
            
            return keyPair;
        } catch (error) {
            console.error('Error generating key pair:', error);
            return null;
        }
    }
    
    async function exportPublicKey(publicKey) {
        try {
            const exported = await crypto.subtle.exportKey("spki", publicKey);
            return arrayBufferToBase64(exported);
        } catch (error) {
            console.error('Error exporting public key:', error);
            return null;
        }
    }
    
    async function importPublicKey(publicKeyData) {
        try {
            const keyData = base64ToArrayBuffer(publicKeyData);
            return await crypto.subtle.importKey(
                "spki",
                keyData,
                {
                    name: "RSA-OAEP",
                    hash: "SHA-256"
                },
                false,
                ["encrypt"]
            );
        } catch (error) {
            console.error('Error importing public key:', error);
            return null;
        }
    }
    
    async function encryptMessage(message, publicKey) {
        try {
            const encoded = new TextEncoder().encode(message);
            const encrypted = await crypto.subtle.encrypt(
                {
                    name: "RSA-OAEP"
                },
                publicKey,
                encoded
            );
            
            return arrayBufferToBase64(encrypted);
        } catch (error) {
            console.error('Error encrypting message:', error);
            return null;
        }
    }
    
    async function decryptMessage(encryptedMessage, privateKey) {
        try {
            const encryptedData = base64ToArrayBuffer(encryptedMessage);
            const decrypted = await crypto.subtle.decrypt(
                {
                    name: "RSA-OAEP"
                },
                privateKey,
                encryptedData
            );
            
            return new TextDecoder().decode(decrypted);
        } catch (error) {
            console.error('Error decrypting message:', error);
            return null;
        }
    }
    
    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    
    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }
    
    // Generate random AES key for message encryption
    async function generateAESKey() {
        return await crypto.subtle.generateKey(
            {
                name: "AES-GCM",
                length: 256
            },
            true,
            ["encrypt", "decrypt"]
        );
    }
    
    async function encryptWithAES(message, key) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(message);
        
        const encrypted = await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            key,
            encoded
        );
        
        return {
            data: arrayBufferToBase64(encrypted),
            iv: arrayBufferToBase64(iv)
        };
    }
    
    async function decryptWithAES(encryptedData, key, iv) {
        const data = base64ToArrayBuffer(encryptedData);
        const ivArray = base64ToArrayBuffer(iv);
        
        const decrypted = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: ivArray
            },
            key,
            data
        );
        
        return new TextDecoder().decode(decrypted);
    }
    
    async function exportAESKey(key) {
        const exported = await crypto.subtle.exportKey("raw", key);
        return arrayBufferToBase64(exported);
    }
    
    async function importAESKey(keyData) {
        const keyBuffer = base64ToArrayBuffer(keyData);
        return await crypto.subtle.importKey(
            "raw",
            keyBuffer,
            "AES-GCM",
            false,
            ["decrypt"]
        );
    }
    
    // Functions
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
    
    async function joinChat() {
        const username = usernameInput.value.trim();
        
        if (!username) {
            showLoginError('Silakan masukkan nama pengguna');
            return;
        }
        
        // Generate user key pair
        showLoginError('🔑 Mempersiapkan enkripsi...');
        userKeyPair = await generateKeyPair();
        
        if (!userKeyPair) {
            showLoginError('Gagal mempersiapkan enkripsi. Refresh dan coba lagi.');
            return;
        }
        
        // Connect to socket
        socket = io();
        
        // Socket events
        socket.on('connect', function() {
            socket.emit('join', username);
        });
        
        socket.on('server_public_key', async function(data) {
            console.log('🔑 Received server public key');
            serverPublicKey = data.serverPublicKey;
            
            // Register our public key
            const publicKeyData = await exportPublicKey(userKeyPair.publicKey);
            if (publicKeyData) {
                socket.emit('register_public_key', { publicKey: publicKeyData });
                console.log('🔑 Sent our public key to server');
            }
        });
        
        socket.on('all_public_keys', function(keys) {
            console.log('🔑 Received all public keys:', Object.keys(keys));
            userPublicKeys = keys;
        });
        
        socket.on('public_key_update', function(data) {
            console.log('🔑 Public key update for:', data.username);
            userPublicKeys[data.username] = data.publicKey;
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
        
        currentUser = username;
        loginScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');
        messageInput.focus();
    }
    
    function showLoginError(message) {
        loginError.textContent = message;
        if (!message.includes('🔑')) {
            usernameInput.classList.add('error');
            
            setTimeout(() => {
                usernameInput.classList.remove('error');
            }, 1000);
        }
    }
    
    async function sendMessage() {
        const text = messageInput.value.trim();
        
        if (!text && !currentMedia) return;
        
        try {
            // Generate AES key for this message
            const aesKey = await generateAESKey();
            
            // Encrypt message with AES
            const messageToEncrypt = JSON.stringify({
                text: text,
                media: currentMedia,
                timestamp: new Date().toISOString()
            });
            
            const encryptedContent = await encryptWithAES(messageToEncrypt, aesKey);
            const exportedAESKey = await exportAESKey(aesKey);
            
            // Encrypt AES key for each online user
            const encryptedKeys = {};
            const onlineUsers = Array.from(onlineUsersList.children).map(li => 
                li.textContent.replace(' (Kamu)', '')
            );
            
            for (const username of onlineUsers) {
                if (userPublicKeys[username]) {
                    const userPublicKey = await importPublicKey(userPublicKeys[username]);
                    if (userPublicKey) {
                        encryptedKeys[username] = await encryptMessage(exportedAESKey, userPublicKey);
                    }
                }
            }
            
            const messageData = {
                type: 'encrypted',
                encryptedContent: encryptedContent,
                encryptedKeys: encryptedKeys,
                media: currentMedia
            };
            
            socket.emit('new_message', messageData);
            
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
            console.error('Error sending encrypted message:', error);
            showSystemMessage('❌ Gagal mengirim pesan terenkripsi');
        }
    }
    
    async function displayMessage(message) {
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
            try {
                // Check if we have the encrypted key for this message
                if (message.encryptedKeys && message.encryptedKeys[currentUser]) {
                    // Decrypt AES key
                    const encryptedAESKey = message.encryptedKeys[currentUser];
                    const decryptedAESKey = await decryptMessage(encryptedAESKey, userKeyPair.privateKey);
                    
                    if (decryptedAESKey) {
                        // Import AES key
                        const aesKey = await importAESKey(decryptedAESKey);
                        
                        // Decrypt message content
                        const decryptedContent = await decryptWithAES(
                            message.encryptedContent.data, 
                            aesKey, 
                            message.encryptedContent.iv
                        );
                        
                        const messageData = JSON.parse(decryptedContent);
                        
                        // Display decrypted text
                        if (messageData.text) {
                            contentEl.innerHTML += formatMessageText(messageData.text);
                        }
                        
                        // Display media if present
                        if (messageData.media) {
                            displayMediaContent(contentEl, messageData.media);
                        }
                        
                        // Add encryption indicator
                        const encryptionIcon = document.createElement('span');
                        encryptionIcon.innerHTML = ' 🔒';
                        encryptionIcon.style.fontSize = '12px';
                        encryptionIcon.style.opacity = '0.7';
                        encryptionIcon.title = 'Pesan terenkripsi end-to-end';
                        contentEl.appendChild(encryptionIcon);
                        
                    } else {
                        contentEl.innerHTML = '🔒 <em>Gagal mendekripsi pesan</em>';
                    }
                } else {
                    contentEl.innerHTML = '🔒 <em>Pesan terenkripsi (kunci tidak tersedia)</em>';
                }
            } catch (error) {
                console.error('Error decrypting message:', error);
                contentEl.innerHTML = '🔒 <em>Error mendekripsi pesan</em>';
            }
        } 
        // Handle regular messages (fallback)
        else {
            if (message.text) {
                contentEl.innerHTML += formatMessageText(message.text);
            }
            
            if (message.media) {
                displayMediaContent(contentEl, message.media);
            }
        }
        
        messagesContainer.appendChild(messageEl);
    }
    
    function displayMediaContent(contentEl, media) {
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
        // Replace URLs with clickable links
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
            li.textContent = user.username;
            
            if (user.username === currentUser) {
                li.classList.add('current-user');
                li.textContent += ' (Kamu)';
            }
            
            // Add encryption status
            const encryptionStatus = document.createElement('span');
            if (userPublicKeys[user.username]) {
                encryptionStatus.innerHTML = ' 🔒';
                encryptionStatus.title = 'Enkripsi aktif';
            } else {
                encryptionStatus.innerHTML = ' ⚠️';
                encryptionStatus.title = 'Enkripsi belum siap';
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
