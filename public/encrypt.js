// public/encrypt.js
class EncryptionManager {
    constructor() {
        this.keyPair = null;
        this.publicKeyPEM = null;
        this.initialized = false;
    }

    async init() {
        try {
            console.log("Initializing encryption...");
            
            // Check if Web Crypto API is supported
            if (!window.crypto || !window.crypto.subtle) {
                console.error("Web Crypto API not supported");
                throw new Error('Web Crypto API tidak didukung di browser ini. Gunakan browser modern seperti Chrome, Firefox, atau Edge terbaru.');
            }
            
            // Generate key pair
            await this.generateKeyPair();
            this.initialized = true;
            console.log("Encryption initialized successfully");
            return true;
        } catch (error) {
            console.error('Initialization error:', error);
            return false;
        }
    }

    async generateKeyPair() {
        try {
            console.log("Generating key pair...");
            // Generate RSA-OAEP key pair
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
            
            // Export public key to PEM format
            const publicKeyExported = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
            const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyExported)));
            this.publicKeyPEM = `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64}\n-----END PUBLIC KEY-----`;
            this.keyPair = keyPair;
            
            console.log('🔒 Encryption keys generated successfully');
            return true;
        } catch (error) {
            console.error('Key generation error:', error);
            throw error;
        }
    }

    async encryptForRecipient(message, recipientPublicKey) {
        try {
            const pemHeader = "-----BEGIN PUBLIC KEY-----";
            const pemFooter = "-----END PUBLIC KEY-----";
            const pemContents = recipientPublicKey.substring(
                pemHeader.length,
                recipientPublicKey.length - pemFooter.length
            ).replace(/\s/g, '');
            
            const binaryDer = atob(pemContents);
            const binaryDerArray = new Uint8Array(binaryDer.length);
            for (let i = 0; i < binaryDer.length; i++) {
                binaryDerArray[i] = binaryDer.charCodeAt(i);
            }
            
            const recipientKey = await window.crypto.subtle.importKey(
                "spki", 
                binaryDerArray.buffer,
                { name: "RSA-OAEP", hash: "SHA-256" },
                false, 
                ["encrypt"]
            );
            
            // Generate symmetric key for message encryption
            const symmetricKey = await window.crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                true, 
                ["encrypt", "decrypt"]
            );
            
            const encoder = new TextEncoder();
            const messageBytes = encoder.encode(message);
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            
            // Encrypt message with symmetric key
            const encryptedMessage = await window.crypto.subtle.encrypt(
                { name: "AES-GCM", iv: iv },
                symmetricKey, 
                messageBytes
            );
            
            // Encrypt symmetric key with recipient's public key
            const rawSymmetricKey = await window.crypto.subtle.exportKey("raw", symmetricKey);
            const encryptedSymmetricKey = await window.crypto.subtle.encrypt(
                { name: "RSA-OAEP" },
                recipientKey, 
                rawSymmetricKey
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

    async decryptMessage(encryptedContent, encryptedKey) {
        try {
            const encryptedKeyArray = new Uint8Array(encryptedKey);
            const decryptedSymmetricKey = await window.crypto.subtle.decrypt(
                { name: "RSA-OAEP" },
                this.keyPair.privateKey,
                encryptedKeyArray.buffer
            );
            
            const symmetricKey = await window.crypto.subtle.importKey(
                "raw", 
                decryptedSymmetricKey,
                { name: "AES-GCM", length: 256 },
                false, 
                ["decrypt"]
            );
            
            const iv = new Uint8Array(encryptedContent.iv);
            const encryptedMessageArray = new Uint8Array(encryptedContent.encryptedMessage);
            
            const decryptedMessage = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                symmetricKey, 
                encryptedMessageArray.buffer
            );
            
            const decoder = new TextDecoder();
            return decoder.decode(decryptedMessage);
        } catch (error) {
            console.error("Decryption failed:", error);
            return null;
        }
    }

    getPublicKeyPEM() {
        return this.publicKeyPEM;
    }
    
    isInitialized() {
        return this.initialized;
    }
}

// Create singleton instance
const encryptionManager = new EncryptionManager();
console.log("EncryptionManager class loaded");
