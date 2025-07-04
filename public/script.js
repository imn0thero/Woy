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
    alert('Username tidak diizinkan! Hanya user yang terdaftar yang bisa masuk.');
    // Redirect atau tampilkan pesan error
        });
        
        socket.on('username_taken', function() {
            showLoginError('Nama pengguna sudah digunakan, silakan pilih yang lain');
        });
        
        socket.on('room_full', function() {
            showLoginError('Chat room penuh, silakan coba lagi nanti');
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
    
    function sendMessage() {
        const text = messageInput.value.trim();
        
        if (!text && !currentMedia) return;
        
        const messageData = {
            text: text,
            type: currentMedia ? 'media' : 'text',
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
    }
    
    function displayMessage(message) {
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
        
        if (message.text) {
            contentEl.innerHTML += formatMessageText(message.text);
        }
        
        // Add media if present
        if (message.media) {
            const mediaPath = message.media.path;
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
                link.textContent = message.media.originalName || 'Download File';
                
                const fileIcon = document.createElement('i');
                fileIcon.className = 'fas fa-file';
                fileIcon.style.marginRight = '5px';
                
                link.prepend(fileIcon);
                contentEl.appendChild(document.createElement('br'));
                contentEl.appendChild(link);
            }
        }
        
        messagesContainer.appendChild(messageEl);
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
