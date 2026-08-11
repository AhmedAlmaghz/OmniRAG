import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.MCP_OAUTH_ENCRYPTION_KEY || 'omnirag-mcp-encryption-secret-key-2026-08-32-bits!'; // 32 bytes fallback

/**
 * Encrypt sensitive OAuth tokens using AES-256-GCM
 */
export function encryptToken(plainText: string): string {
  if (!plainText) return '';
  try {
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'mcp-salt', 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('Token encryption failed:', err);
    return plainText; // Fallback
  }
}

/**
 * Decrypt sensitive OAuth tokens
 */
export function decryptToken(encryptedText: string): string {
  if (!encryptedText || !encryptedText.includes(':')) return encryptedText;
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return encryptedText;

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const key = crypto.scryptSync(ENCRYPTION_KEY, 'mcp-salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('Token decryption failed:', err);
    return encryptedText;
  }
}
