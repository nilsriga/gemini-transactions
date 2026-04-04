/**
 * Crypto utility for encrypting and decrypting data using a key derived from the Google Auth token.
 * Uses Web Crypto API (AES-GCM).
 */
const CryptoManager = {
    /**
     * Derives a cryptographic key from a password string.
     * @param {string} password - The Google Auth token or user ID.
     * @param {Uint8Array} salt - Salt for PBKDF2.
     * @returns {Promise<CryptoKey>}
     */
    async deriveKey(password, salt) {
        const encoder = new TextEncoder();
        const baseKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    },

    /**
     * Encrypts data.
     * @param {string} data - Plaintext string.
     * @param {string} password - The Google Auth token or user ID.
     * @returns {Promise<string>} - Base64 encoded JSON string containing salt, iv, and ciphertext.
     */
    async encrypt(data, password) {
        const encoder = new TextEncoder();
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await this.deriveKey(password, salt);
        
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoder.encode(data)
        );

        const result = {
            salt: btoa(String.fromCharCode(...salt)),
            iv: btoa(String.fromCharCode(...iv)),
            ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
        };
        return JSON.stringify(result);
    },

    /**
     * Decrypts data.
     * @param {string} encryptedJson - The encrypted JSON string.
     * @param {string} password - The Google Auth token or user ID.
     * @returns {Promise<string>} - Decrypted plaintext string.
     */
    async decrypt(encryptedJson, password) {
        try {
            const { salt, iv, ciphertext } = JSON.parse(encryptedJson);
            const saltArr = new Uint8Array(atob(salt).split('').map(c => c.charCodeAt(0)));
            const ivArr = new Uint8Array(atob(iv).split('').map(c => c.charCodeAt(0)));
            const cipherArr = new Uint8Array(atob(ciphertext).split('').map(c => c.charCodeAt(0)));

            const key = await this.deriveKey(password, saltArr);
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: ivArr },
                key,
                cipherArr
            );

            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error('Decryption failed', e);
            throw new Error('Incorrect key or corrupted data');
        }
    }
};

window.CryptoManager = CryptoManager;
