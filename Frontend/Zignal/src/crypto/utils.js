/**
 * crypto/utils.js — Utilidades de bajo nivel para criptografia
 *
 * Funciones puras sin dependencias de React.
 * Usadas por x3dh.js y ratchet.js.
 */

// ── Codificacion Base64 ───────────────────────────────────────

/**
 * Convierte un Uint8Array a string Base64 (URL-safe sin padding).
 * Usado para serializar claves y ciphertexts en JSON.
 */
export function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Convierte un string Base64 (URL-safe o estandar) a Uint8Array.
 */
export function base64ToBytes(b64) {
  // Normalizar URL-safe a estandar
  const std = b64.replace(/-/g, '+').replace(/_/g, '/')
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ── Codificacion Hexadecimal ──────────────────────────────────

/** Convierte Uint8Array a string hexadecimal. */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Convierte string hexadecimal a Uint8Array. */
export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Retorna los primeros N bytes de una clave como string hex.
 * Usado para mostrar en el DiagnosticPanel sin exponer la clave completa.
 *
 * @param {Uint8Array} bytes
 * @param {number}     [len=8]   Cuantos bytes mostrar
 */
export function shortHex(bytes, len = 8) {
  if (!bytes) return '—'
  return bytesToHex(bytes.slice(0, len)) + '…'
}

// ── Concatenacion de bytes ────────────────────────────────────

/**
 * Concatena multiples Uint8Arrays en uno solo.
 * Usado para armar el IKM en X3DH: DH1 || DH2 || DH3 [|| DH4]
 */
export function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const out   = new Uint8Array(total)
  let offset  = 0
  for (const arr of arrays) {
    out.set(arr, offset)
    offset += arr.length
  }
  return out
}

// ── Bytes aleatorios ──────────────────────────────────────────

/**
 * Genera N bytes criptograficamente aleatorios.
 * Usa la Web Crypto API nativa del navegador.
 */
export function getRandomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n))
}

// ── Nonce estructurado (secc. 7 del documento de diseño) ──────
/**
 * Construye el nonce de 96 bits (12 bytes) para AES-GCM.
 *
 * Estructura:
 *   [0..3]  Contador de giro DH (uint32 big-endian)  — 32 bits
 *   [4..7]  Padding cero                              — 32 bits
 *   [8..11] Numero de mensaje en cadena simetrica     — 32 bits
 *
 * La combinacion (dhStep, msgNumber) es unica dentro de una sesion
 * porque dhStep aumenta monotonicamente y msgNumber se resetea a 0
 * en cada nuevo giro DH. Garantiza nonces unicos por clave de mensaje.
 *
 * @param {number} dhRatchetStep   Paso del ratchet DH actual
 * @param {number} messageNumber   Numero del mensaje en la cadena simetrica actual
 */
export function buildNonce(dhRatchetStep, messageNumber) {
  const nonce = new Uint8Array(12)
  const view  = new DataView(nonce.buffer)
  view.setUint32(0, dhRatchetStep & 0xFFFFFFFF, false)  // big-endian
  view.setUint32(4, 0,                          false)  // padding
  view.setUint32(8, messageNumber & 0xFFFFFFFF, false)  // big-endian
  return nonce
}

// ── Comparacion en tiempo constante ──────────────────────────
/**
 * Compara dos Uint8Arrays en tiempo constante para evitar
 * ataques de timing al verificar MACs.
 */
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}
