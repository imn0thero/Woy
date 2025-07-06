document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM Content loaded");
    
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
    const progressFill = document.querySelector('.progress-fill');
    
    // Variables
    let socket;
    let currentUser;
    let currentMedia = null;
    let typingTimeout;
    let publicKeys = {};
    let myUsername = null;
    let serverPublicKey = null;
    
    // Initialize
    initApp();
    
    // Functions
    async function initApp() {
        console.log("Initializing application...");
        
        // Check elements
        if (!keyGenerationScreen) console.error("keyGenerationScreen element not found!");
        if (!loginScreen) console.error("loginScreen element not found!");
        if (!progressFill) console.error("progressFill element not found!");
        
        // Animate progress bar
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += 5;
            if (progress > 95) progress = 95;
            if (progressFill) progressFill.style.width = `${progress}%`;
        }, 100);

        try {
            // Initialize encryption
            console.log("Starting encryption initialization");
            const initialized = await encryptionManager.init();
            
            if (initialized) {
                console.log("Encryption initialized successfully, transitioning to login screen");
                
                // Complete progress bar
                if (progressFill) progressFill.style.width = '100%';
                
                // Clear interval
                clearInterval(progressInterval);
                
                // Hide key generation screen after short delay
                setTimeout(() => {
                    console.log("Showing login screen");
                    if (keyGenerationScreen) keyGenerationScreen.style.display = "none";
                    if (loginScreen) loginScreen.classList.remove("hidden");
                    if (usernameInput) usernameInput.focus();
                }, 500);
                
                // Setup event listeners
                setupEventListeners();
            } else {
                throw new Error('Gagal inisialisasi enkripsi');
            }
        } catch (error) {
            console.error('Initialization error:', error);
            // Stop progress animation
            clearInterval(progressInterval);
            
            // Show error on key generation screen
            if (keyGenerationScreen) {
                const keyGenContainer = keyGenerationScreen.querySelector('.key-generation-container');
                if (keyGenContainer) {
                    keyGenContainer.innerHTML = `
                        <div class="error-icon">❌</div>
                        <h2>Gagal Mengaktifkan Enkripsi</h2>
                        <p>${error.message || 'Terjadi kesalahan saat menginisialisasi enkripsi. Pastikan Anda menggunakan browser modern.'}</p>
                        <button id="retry-btn" class="retry-button">Coba Lagi</button>
                    `;
                    
                    // Add retry button listener
                    const retryBtn = document.getElementById('retry-btn');
                    if (retryBtn) {
                        retryBtn.addEventListener('click', () => {
                            window.location.reload();
                        });
                    }
                }
            }
        }
    }
    
    // Sisa kode tetap sama
    // ...
    
    function setupEventListeners() {
        console.log("Setting up event listeners");
        // Enter key for login
        if (usernameInput) {
            usernameInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter' && usernameInput.value.trim()) {
                    joinChat();
                }
            });
        }
        
        // Join button click
        if (joinBtn) {
            joinBtn.addEventListener('click', function() {
                if (usernameInput && usernameInput.value.trim()) {
                    joinChat();
                }
            });
        }
        
        // Auto-resize message input
        if (messageInput) {
            messageInput.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = (this.scrollHeight) + 'px';
                
                // Enable/disable send button
                if (sendBtn) sendBtn.disabled = !this.value.trim() && !currentMedia;
                
                // Typing indicator
                if (this.value.trim() && socket) {
                    clearTimeout(typingTimeout);
                    socket.emit('typing', true);
                    
                    typingTimeout = setTimeout(() => {
                        if (socket) socket.emit('typing', false);
                    }, 2000);
                } else {
                    clearTimeout(typingTimeout);
                    if (socket) socket.emit('typing', false);
                }
            });
        }
        
        // Rest of your event listeners...
    }

    // Rest of your functions...
});
