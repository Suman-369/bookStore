import nacl from 'tweetnacl';

/**
 * End-to-End Encryption Utilities for Node.js Backend
 * Uses TweetNaCl.js (libsodium) with Curve25519 + ChaCha20-Poly1305
 */

// Convert between base64 and Buffer
export const base64ToBuffer = (base64String) => {
  return Buffer.from(base64String, 'base64');
};

export const bufferToBase64 = (buffer) => {
  return buffer.toString('base64');
};

// Convert between base64 and Uint8Array
export const base64ToUint8Array = (base64String) => {
  return new Uint8Array(base64ToBuffer(base64String));
};

export const uint8ArrayToBase64 = (uint8Array) => {
  return bufferToBase64(Buffer.from(uint8Array));
};

/**
 * Validate a user's keypair
 * Returns true if both public and secret keys are valid
 */
export const validateKeyPair = (publicKeyBase64, secretKeyBase64) => {
  try {
    if (!publicKeyBase64 || !secretKeyBase64) return false;
    
    const publicKeyBuffer = base64ToBuffer(publicKeyBase64);
    const secretKeyBuffer = base64ToBuffer(secretKeyBase64);

    // Validate key lengths
    if (publicKeyBuffer.length !== nacl.box.publicKeyLength) return false;
    if (secretKeyBuffer.length !== nacl.box.secretKeyLength) return false;

    return true;
  } catch (error) {
    console.error('Key validation error:', error);
    return false;
  }
};

/**
 * Validate a public key
 */
export const validatePublicKey = (publicKeyBase64) => {
  try {
    if (!publicKeyBase64) return false;
    const publicKeyBuffer = base64ToBuffer(publicKeyBase64);
    return publicKeyBuffer.length === nacl.box.publicKeyLength;
  } catch (error) {
    console.error('Public key validation error:', error);
    return false;
  }
};

/**
 * Decrypt the symmetric key with recipient's secret key
 * Used on server for validation (not for actual decryption)
 */
export const decryptSymmetricKeyServer = (
  encryptedKeyBase64,
  senderPublicKeyBase64,
  recipientSecretKeyBase64,
  nonceBase64
) => {
  try {
    const encryptedKey = base64ToUint8Array(encryptedKeyBase64);
    const senderPublicKey = base64ToUint8Array(senderPublicKeyBase64);
    const recipientSecretKey = base64ToUint8Array(recipientSecretKeyBase64);
    const nonce = base64ToUint8Array(nonceBase64);

    const decrypted = nacl.box.open(
      encryptedKey,
      nonce,
      senderPublicKey,
      recipientSecretKey
    );

    if (!decrypted) {
      throw new Error('Key decryption failed - authentication failed');
    }

    return uint8ArrayToBase64(decrypted);
  } catch (error) {
    console.error('Key decryption error:', error);
    throw new Error('Failed to decrypt symmetric key');
  }
};

/**
 * Verify a message signature
 * Used on server to authenticate messages
 */
export const verifySignatureServer = (
  message,
  signatureBase64,
  publicKeyBase64
) => {
  try {
    const messageUint8 = new TextEncoder().encode(message);
    const signature = base64ToUint8Array(signatureBase64);
    const publicKey = base64ToUint8Array(publicKeyBase64);
    return nacl.sign.detached.verify(messageUint8, signature, publicKey);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
};

/**
 * Test encryption/decryption (for debugging)
 */
export const testE2EE = () => {
  try {
    // Generate test keypairs
    const alice = nacl.box.keyPair();
    const bob = nacl.box.keyPair();

    const message = 'Hello, E2EE!';
    const messageUint8 = new TextEncoder().encode(message);

    // Generate nonce
    const nonce = nacl.randomBytes(nacl.box.nonceLength);

    // Alice encrypts message to Bob
    const encrypted = nacl.box(
      messageUint8,
      nonce,
      bob.publicKey,
      alice.secretKey
    );

    // Bob decrypts message from Alice
    const decrypted = nacl.box.open(
      encrypted,
      nonce,
      alice.publicKey,
      bob.secretKey
    );

    const decryptedMessage = new TextDecoder().decode(decrypted);

    return {
      success: decryptedMessage === message,
      originalMessage: message,
      decryptedMessage,
    };
  } catch (error) {
    console.error('E2EE test error:', error);
    return { success: false, error: error.message };
  }
};
