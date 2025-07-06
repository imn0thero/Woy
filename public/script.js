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
    
    // Crypto variables
    let keyPair = null; // Menyimpan keypair RSA kita
    let privateKey = null; // Private key kita
    let publicKey = null; // Public key kita
    let serverPublicKey = null; // Public key server
    let userPublicKeys = {}; // Menyimpan public key semua user
    
    // Initialize
    init();
    
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
        
        // Generate keys when the page loads
        generateUserKeys();
    }
    
    // Generate RSA key pair for user
    async function generateUserKeys() {
        try {
            keyPair = await window.crypto.subtle.generateKey(
                {
                    name: "RSA-OAEP",
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: "SHA-256",
                },
                true,
                ["encrypt", "decrypt"]
            );
            
            privateKey = keyPair.privateKey;
            publicKey = keyPair.publicKey;
            
            // Export public key to send to server
            const exportedPublicKey = await window.crypto.subtle.exportKey(
                "spki",
                publicKey
            );
            
            const publicKeyBase64 = arrayBufferToBase64(exportedPublicKey);
            
            console.log("🔑 Kunci enkripsi berhasil dibuat");
        } catch (error) {
            console.error("Gagal membuat kunci enkripsi:", error);
        }
    }
    
    // Helper for Base64 conversion
    function arrayBufferToBase64(buffer) {
        const binary = String.fromCharCode.apply(null, new Uint8Array(buffer));
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
    
    // Generate a symmetric key for message encryption
    async function generateMessageKey() {
        return await window.crypto.subtle.generateKey(
            {
                name: "AES-GCM",
                length: 256
            },
            true,
            ["encrypt", "decrypt"]
        );
    }
    
    // Encrypt message with symmetric key
    async function encryptMessage(messageKey, message) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoder = new TextEncoder();
        const messageData = encoder.encode(message);
        
        const encryptedData = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            messageKey,
            messageData
        );
        
        // Return IV + encrypted data in Base64
        const combinedArray = new Uint8Array(iv.length + encryptedData.byteLength);
        combinedArray.set(iv, 0);
        combinedArray.set(new Uint8Array(encryptedData), iv.length);
        
        return arrayBufferToBase64(combinedArray.buffer);
    }
    
    // Decrypt message with symmetric key
    async function decryptMessage(messageKey, encryptedMessage) {
        try {
            const encryptedData = base64ToArrayBuffer(encryptedMessage);
            const iv = encryptedData.slice(0, 12);
            const actualEncrypted = encryptedData.slice(12);
            
            const decryptedData = await window.crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: new Uint8Array(iv)
                },
                messageKey,
                actualEncrypted
            );
            
            const decoder = new TextDecoder();
            return decoder.decode(decryptedData);
        } catch (error) {
            console.error("Gagal mendekripsi pesan:", error);
            return "[Pesan tidak dapat didekripsi]";
        }
    }
    
    // Encrypt symmetric key with recipient's public key
    async function encryptKey(recipientPublicKey, messageKey) {
        try {
            // Import recipient's public key
            const importedPublicKey = await window.crypto.subtle.importKey(
                "spki",
                base64ToArrayBuffer(recipientPublicKey),
                {
                    name: "RSA-OAEP",
                    hash: "SHA-256"
                },
                false,
                ["encrypt"]
            );
            
            // Export symmetric key
            const exportedKey = await window.crypto.subtle.exportKey(
                "raw",
                messageKey
            );
            
            // Encrypt symmetric key with recipient's public key
            const encryptedKey = await window.crypto.subtle.encrypt(
                {
                    name: "RSA-OAEP"
                },
                importedPublicKey,
                exportedKey
            );
            
            return arrayBufferToBase64(encryptedKey);
        } catch (error) {
            console.error("Gagal mengenkripsi kunci untuk penerima:", error);
            return null;
        }
    }
    
    // Decrypt symmetric key with our private key
    async function decryptKey(encryptedKey) {
        try {
            const decryptedKeyBuffer = await window.crypto.subtle.decrypt(
                {
                    name: "RSA-OAEP"
                },
                privateKey,
                base64ToArrayBuffer(encryptedKey)
            );
            
            // Import the symmetric key
            return await window.crypto.subtle.importKey(
                "raw",
                decryptedKeyBuffer,
                {
                    name: "AES-GCM",
                    length: 256
                },
                false,
                ["decrypt"]
            );
        } catch (error) {
            console.error("Gagal mendekripsi kunci:", error);
            return null;
        }
    }
    
    // Verify server signature
    async function verifyServerSignature(message, signature) {
        try {
            if (!serverPublicKey) {
                console.error("Server public key tidak tersedia");
                return false;
            }
            
            // Import server's public key
            const importedServerKey = await window.crypto.subtle.importKey(
                "spki",
                base64ToArrayBuffer(serverPublicKey),
                {
                    name: "RSA-PKCS1-v1_5",
                    hash: "SHA-256"
                },
                false,
                ["verify"]
            );
            
            // Data to verify
            const encoder = new TextEncoder();
            const data = encoder.encode(JSON.stringify({
                id: message.id,
                username: message.username,
                timestamp: message.timestamp
            }));
            
            // Verify signature
            return await window.crypto.subtle.verify(
                {
                    name: "RSA-PKCS1-v1_5"
                },
                importedServerKey,
                base64ToArrayBuffer(signature),
                data
            );
        } catch (error) {
            console.error("Gagal memverifikasi tanda tangan server:", error);
            return false;
        }
    }
    
    function joinChat() {
        const username = usernameInput.value.trim();
        
        if (!username) {
            showLoginError('Silakan masukkan nama pengguna');
            return;
        }
        
        // Connect to socket
        socket = io();
        
        // Socket events
        socket.on('connect', function() {
            socket.emit('join', username);
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
        
        socket.on('server_public_key', async function(data) {
            serverPublicKey = data.serverPublicKey;
            console.log("🔑 Menerima kunci publik dari server");
            
            // Export our public key
            const exportedPublicKey = await window.crypto.subtle.exportKey(
                "spki",
                publicKey
            );
            
            // Send our public key to server
            socket.emit('register_public_key', {
                publicKey: arrayBufferToBase64(exportedPublicKey)
            });
        });
        
        socket.on('all_public_keys', function(keys) {
            userPublicKeys = keys;
            console.log(`🔑 Menerima ${Object.keys(keys).length} kunci publik pengguna`);
        });
        
        socket.on('public_key_update', function(data) {
            userPublicKeys[data.username] = data.publicKey;
            console.log(`🔑 Update kunci publik dari ${data.username}`);
        });
        
        socket.on('load_messages', function(messages) {
            messagesContainer.innerHTML = '';
            messages.forEach(displayMessage);
            scrollToBottom();
        });
        
        socket.on('message_received', function(message) {
            displayMessage(message);
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
        usernameInput.classList.add('error');
        
        setTimeout(() => {
            usernameInput.classList.remove('error');
        }, 1000);
    }
    
    async function sendMessage() {
        const text = messageInput.value.trim();
        
        if (!text && !currentMedia) return;
        
        try {
            // Check if encryption is possible (we have other users' public keys)
            const recipients = Object.keys(userPublicKeys);
            
            // If we have recipients, use encrypted messages
            if (recipients.length > 0) {
                // Generate symmetric key for this message
                const messageKey = await generateMessageKey();
                
                // Encrypt the message content
                let encryptedContent = await encryptMessage(messageKey, 
                    JSON.stringify({
                        text: text,
                        media: currentMedia
                    })
                );
                
                // Encrypt the symmetric key for each recipient
                const encryptedKeys = {};
                for (const username of recipients) {
                    if (userPublicKeys[username]) {
                        encryptedKeys[username] = await encryptKey(userPublicKeys[username], messageKey);
                    }
                }
                
                // Send encrypted message to server
                socket.emit('new_message', {
                    type: 'encrypted',
                    encryptedContent: encryptedContent,
                    encryptedKeys: encryptedKeys,
                    media: currentMedia
                });
            } 
            // Fallback to unencrypted message if no recipients
            else {
                socket.emit('new_message', {
                    text: text,
                    type: currentMedia ? 'media' : 'text',
                    media: currentMedia
                });
            }
            
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
            console.error("Gagal mengirim pesan terenkripsi:", error);
            alert("Gagal mengirim pesan terenkripsi. Silakan coba lagi.");
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
            // Verify server signature if available
            if (message.serverSignature) {
                const isValid = await verifyServerSignature(message, message.serverSignature);
                if (!isValid) {
                    contentEl.innerHTML = '<div class="encrypted-warning"><i class="fas fa-exclamation-triangle"></i> Pesan tidak terverifikasi!</div>';
                    messagesContainer.appendChild(messageEl);
                    return;
                }
            }
            
            // Try to decrypt message if we have the key
            if (message.encryptedKeys && message.encryptedKeys[currentUser]) {
                try {
                    // Decrypt symmetric key
                    const messageKey = await decryptKey(message.encryptedKeys[currentUser]);
                    
                    if (messageKey) {
                        // Decrypt message content
                        const decryptedContent = await decryptMessage(messageKey, message.encryptedContent);
                        const messageData = JSON.parse(decryptedContent);
                        
                        // Display the message text
                        if (messageData.text) {
                            contentEl.innerHTML = formatMessageText(messageData.text);
                        }
                        
                        // Add media if present in the decrypted content
                        if (message.media) {
                            addMediaToMessage(contentEl, message.media);
                        }
                    } else {
                        contentEl.innerHTML = '<div class="encrypted-message"><i class="fas fa-lock"></i> Pesan terenkripsi</div>';
                    }
                } catch (error) {
                    console.error("Gagal mendekripsi pesan:", error);
                    contentEl.innerHTML = '<div class="encrypted-message"><i class="fas fa-lock"></i> Pesan terenkripsi</div>';
                }
            } else {
                // We don't have the key for this message
                contentEl.innerHTML = '<div class="encrypted-message"><i class="fas fa-lock"></i> Pesan terenkripsi</div>';
            }
        } 
        // Handle regular messages (fallback)
        else {
            if (message.text) {
                contentEl.innerHTML = formatMessageText(message.text);
            }
            
            // Add media if present
            if (message.media) {
                addMediaToMessage(contentEl, message.media);
            }
        }
        
        messagesContainer.appendChild(messageEl);
    }
    
    function addMediaToMessage(contentEl, media) {
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
