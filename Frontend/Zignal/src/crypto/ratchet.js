/**
 * crypto/ratchet.js — Algoritmo de Doble Ratchet
 *
 * Implementa el flujo de la seccion 5 y figura 3 del documento:
 *
 *   Fase 1 — Ratchet DH: Alice envia primer mensaje con DHs_A
 *   Fase 2 — Ratchet simetrico: una MK por mensaje via KDF_CK
 *   Fase 3 — Ratchet DH: Bob responde con nuevo DHs_B
 *   Fase 4 — Protecciones: replay, orden, alteracion
 *
 * KDFs:
 *   KDF_RK(rk, dh)  = HKDF(salt=rk, ikm=dh, info="ZignalRatchet") -> [RK', CK]
 *   KDF_CK(ck)      = HMAC-SHA256(ck, 0x02) -> CK' ; HMAC-SHA256(ck, 0x01) -> MK
 *
 * Cifrado:
 *   AES-256-GCM(key=MK, nonce=buildNonce(dhStep, msgNum), plaintext, aad=header+AD)
 *
 * Este modulo es PURO (sin estado global ni React).
 * El estado del ratchet se pasa por parametro y se devuelve actualizado.
 */

import { x25519 }       from '@noble/curves/ed25519.js'
import { hkdf }         from '@noble/hashes/hkdf.js'
import { hmac }         from '@noble/hashes/hmac.js'
import { sha256 }       from '@noble/hashes/sha2.js'
import { gcm }          from '@noble/ciphers/aes.js'
import {
  concatBytes, bytesToBase64, base64ToBytes,
  bytesToHex, buildNonce,
} from './utils.js'
import { createLogger, cryptoLog } from '../utils/logger.js'

const log = createLogger('Ratchet')

// ── Constantes ────────────────────────────────────────────────
const HKDF_INFO_RK   = new TextEncoder().encode('ZignalRatchet')
const MAX_SKIP       = 100   // max mensajes omitidos antes de error

// ── KDF de la cadena raiz ─────────────────────────────────────
/**
 * KDF_RK: actualiza la root key al girar el ratchet DH.
 *
 * @param {Uint8Array} rk        Root key actual (32 bytes)
 * @param {Uint8Array} dhOutput  Output del DH entre los dos ratchet keys
 * @returns {{ newRK: Uint8Array, newCK: Uint8Array }}  64 bytes divididos en [32, 32]
 */
function kdfRK(rk, dhOutput) {
  // HKDF: salt=rk, ikm=dhOutput, info=ZignalRatchet, length=64
  const out   = hkdf(sha256, dhOutput, rk, HKDF_INFO_RK, 64)
  const newRK = out.slice(0,  32)   // nueva root key
  const newCK = out.slice(32, 64)   // nueva chain key (send o receive segun contexto)
  return { newRK, newCK }
}

// ── KDF de la cadena simetrica ────────────────────────────────
/**
 * KDF_CK: deriva una message key y avanza la chain key.
 *
 * Usa HMAC-SHA256:
 *   MK = HMAC(ck, 0x01)   <- clave de mensaje (cifrado/descifrado)
 *   CK = HMAC(ck, 0x02)   <- nueva chain key  (avance del ratchet simetrico)
 *
 * @param {Uint8Array} ck  Chain key actual (32 bytes)
 * @returns {{ newCK: Uint8Array, mk: Uint8Array }}
 */
function kdfCK(ck) {
  const mk    = hmac(sha256, ck, new Uint8Array([0x01]))
  const newCK = hmac(sha256, ck, new Uint8Array([0x02]))
  return { newCK, mk }
}

// ── Cifrado AES-256-GCM ───────────────────────────────────────
/**
 * Cifra un mensaje con AES-256-GCM.
 *
 * El AAD (Additional Authenticated Data) es la serializacion del header
 * concatenada con el AD del X3DH. Esto garantiza que el tag de autenticacion
 * cubra tanto el contenido como los metadatos del mensaje.
 *
 * @param {Uint8Array} mk         Message key (32 bytes)
 * @param {Uint8Array} nonce      Nonce de 12 bytes (buildNonce)
 * @param {Uint8Array} plaintext  Bytes del texto claro
 * @param {Uint8Array} aad        Datos autenticados (no cifrados)
 * @returns {{ ciphertext: string, tag: string }}  Base64 URL-safe
 */
function encryptAEAD(mk, nonce, plaintext, aad) {
  const cipher    = gcm(mk, nonce, aad)
  const encrypted = cipher.encrypt(plaintext)   // ciphertext || tag (ultimos 16 bytes)

  // Separar ciphertext del tag de autenticacion (segun formato del doc. secc. 6)
  const ciphertext = encrypted.slice(0, -16)
  const tag        = encrypted.slice(-16)

  return {
    ciphertext: bytesToBase64(ciphertext),
    tag:        bytesToBase64(tag),
  }
}

/**
 * Descifra un mensaje AES-256-GCM.
 * Lanza si el tag no es valido (mensaje alterado o clave incorrecta).
 */
function decryptAEAD(mk, nonce, ciphertextB64, tagB64, aad) {
  const ciphertext = base64ToBytes(ciphertextB64)
  const tag        = base64ToBytes(tagB64)

  // noble/ciphers espera ciphertext || tag concatenados
  const combined = concatBytes(ciphertext, tag)

  const cipher    = gcm(mk, nonce, aad)
  const plaintext = cipher.decrypt(combined)   // lanza si tag invalido
  return plaintext
}

// ── Serializacion del header para AAD ────────────────────────
/**
 * Serializa el header como bytes para usarlo como AAD en AES-GCM.
 * Esto autentica los metadatos del mensaje (impide modificar el header).
 */
function headerToBytes(header) {
  return new TextEncoder().encode(JSON.stringify(header))
}

// ── Inicializacion del Double Ratchet ─────────────────────────

/**
 * Inicializa el estado del ratchet para el INICIADOR (Alice).
 *
 * Alice ya tiene:
 *  - SK:        shared secret del X3DH
 *  - dhsKP:     su primer par de claves DH del ratchet (generado en x3dhSend)
 *  - bobSpkPub: la clave publica SPK de Bob (primer DHr)
 *
 * Segun el spec: Alice hace un giro DH inmediato para obtener CKs.
 *
 * @param {Uint8Array} SK         Shared secret (32 bytes) de X3DH
 * @param {object}     dhsKP      { priv, pub } — primer DH ratchet key de Alice
 * @param {Uint8Array} bobSpkPub  Clave publica SPK de Bob
 * @param {Uint8Array} AD         Associated data del X3DH
 */
export function initSend(SK, dhsKP, bobSpkPub, AD) {
  log.info('Inicializando ratchet (send/Alice)')

  // Giro DH inicial: RK, CKs = KDF_RK(SK, DH(DHs, DHr))
  const dhOut          = x25519.getSharedSecret(dhsKP.priv, bobSpkPub)
  const { newRK, newCK } = kdfRK(SK, dhOut)

  const state = {
    DHs:         dhsKP,       // nuestro par DH ratchet actual
    DHr:         bobSpkPub,   // clave DH publica del otro lado
    RK:          newRK,       // root key actualizada
    CKs:         newCK,       // sending chain key (lista para cifrar)
    CKr:         null,        // receiving chain key (aun no tenemos respuesta)
    Ns:          0,           // contador de mensajes enviados en cadena actual
    Nr:          0,           // contador de mensajes recibidos en cadena actual
    PN:          0,           // longitud de la cadena anterior
    dhRatchetStep: 1,         // pasos DH realizados (para el nonce estructurado)
    MKSKIPPED:   new Map(),   // MKs de mensajes omitidos: "hexDHr:msgNum" -> MK
    AD,                       // associated data del X3DH (autenticacion mutua)
    sessionEstablished: true,
  }

  log.debug('Estado inicial (send)', {
    RK:  bytesToHex(state.RK).slice(0, 16) + '...',
    CKs: bytesToHex(state.CKs).slice(0, 16) + '...',
    DHs: bytesToHex(state.DHs.pub).slice(0, 16) + '...',
    DHr: bytesToHex(state.DHr).slice(0, 16) + '...',
  })

  return state
}

/**
 * Inicializa el estado del ratchet para el RECEPTOR (Bob).
 *
 * Bob empieza con el SK del X3DH y su SPK como primer DHs.
 * No tiene CKs ni CKr hasta recibir/enviar el primer mensaje.
 *
 * @param {Uint8Array} SK     Shared secret del X3DH
 * @param {object}     spkKP  { priv, pub } — el SPK de Bob
 * @param {Uint8Array} AD     Associated data del X3DH
 */
export function initReceive(SK, spkKP, AD) {
  log.info('Inicializando ratchet (receive/Bob)')

  const state = {
    DHs:         spkKP,    // Bob usa su SPK como primer DHs
    DHr:         null,     // aun no conoce el DHs de Alice
    RK:          SK,       // root key = SK de X3DH (sin giro DH aun)
    CKs:         null,     // sin cadena de envio hasta responder
    CKr:         null,     // sin cadena de recepcion hasta recibir
    Ns:          0,
    Nr:          0,
    PN:          0,
    dhRatchetStep: 0,
    MKSKIPPED:   new Map(),
    AD,
    sessionEstablished: true,
  }

  log.debug('Estado inicial (receive)', {
    RK: bytesToHex(state.RK).slice(0, 16) + '...',
    DHs: bytesToHex(state.DHs.pub).slice(0, 16) + '...',
  })

  return state
}

// ── Cifrado con Double Ratchet ────────────────────────────────

/**
 * Cifra un mensaje usando el Double Ratchet.
 *
 * Algoritmo (Fase 2 del doc.):
 *   1. Si no hay CKs (Bob enviando primer mensaje), girar DH ratchet
 *   2. KDF_CK(CKs) -> nueva CKs + MK
 *   3. Cifrar con AES-256-GCM(MK, nonce, plaintext, AAD)
 *   4. Devolver header + { ciphertext, tag }
 *
 * @param {object} state      Estado actual del ratchet
 * @param {string} plaintext  Mensaje en texto claro
 * @param {string} senderId
 * @param {string} receiverId
 * @returns {{ newState, envelope }}
 *   envelope = { header: {...}, ciphertext: string, tag: string }
 */
export function ratchetEncrypt(state, plaintext, senderId, receiverId) {
  // Clonar el estado para inmutabilidad (evitar mutaciones inesperadas)
  let s = deepCloneState(state)

  // ── Si no tenemos cadena de envio, girar el ratchet DH ───
  // Ocurre cuando Bob va a enviar su primera respuesta
  if (!s.CKs) {
    cryptoLog.group('Ratchet DH — giro antes de primer envio')
    log.info('Sin CKs — ejecutando giro DH previo al envio')

    s.PN  = s.Ns
    s.Ns  = 0
    // Generar nuevo par DH para este giro
    const newDHsPriv = x25519.utils.randomSecretKey()
    const newDHsPub  = x25519.getPublicKey(newDHsPriv)
    s.DHs = { priv: newDHsPriv, pub: newDHsPub }

    // Derivar nueva CKs con el nuevo DHs
    const dhOut          = x25519.getSharedSecret(s.DHs.priv, s.DHr)
    const { newRK, newCK } = kdfRK(s.RK, dhOut)
    s.RK  = newRK
    s.CKs = newCK
    s.dhRatchetStep++

    log.debug('Giro DH completado (antes de envio)', {
      newDHs:       bytesToHex(s.DHs.pub).slice(0, 16) + '...',
      newRK:        bytesToHex(s.RK).slice(0, 16) + '...',
      dhRatchetStep: s.dhRatchetStep,
    })
    cryptoLog.groupEnd()
  }

  // ── Avanzar ratchet simetrico: CKs -> nueva CKs + MK ─────
  const { newCK: newCKs, mk } = kdfCK(s.CKs)
  s.CKs = newCKs

  log.debug('Ratchet simetrico avanzado', {
    msgNum: s.Ns,
    MK:     bytesToHex(mk).slice(0, 8) + '...',
  })

  // ── Construir header del mensaje ──────────────────────────
  const nonce = buildNonce(s.dhRatchetStep, s.Ns)
  const header = {
    type:                   'ratchet',
    sender_id:              senderId,
    receiver_id:            receiverId,
    dh_pub:                 bytesToBase64(s.DHs.pub),
    message_number:         s.Ns,
    previous_chain_length:  s.PN,
    nonce:                  bytesToBase64(nonce),
  }

  // ── AAD: headerBytes + AD del X3DH ────────────────────────
  // Autentica tanto el header como la identidad de los participantes
  const aad = concatBytes(headerToBytes(header), s.AD)

  // ── Cifrar ───────────────────────────────────────────────
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const { ciphertext, tag } = encryptAEAD(mk, nonce, plaintextBytes, aad)

  s.Ns++   // incrementar contador despues de cifrar

  log.info('Mensaje cifrado', {
    to:     receiverId,
    msgNum: header.message_number,
    dhStep: s.dhRatchetStep,
  })

  // Destruir MK despues de usar (minimizar tiempo en memoria)
  mk.fill(0)

  return {
    newState: s,
    envelope: { header, ciphertext, tag },
  }
}

// ── Primer mensaje X3DH (incluye datos de sesion) ─────────────

/**
 * Cifra el PRIMER mensaje de Alice, que incluye los datos X3DH
 * que Bob necesita para replicar la sesion.
 *
 * El header de tipo 'x3dh_init' contiene:
 *   ik_pub, ek_pub, opk_id, dh_pub (primer ratchet key de Alice)
 */
export function encryptInitialMessage(state, plaintext, senderId, receiverId, x3dhInfo) {
  let s = deepCloneState(state)

  // Avanzar cadena simetrica
  const { newCK: newCKs, mk } = kdfCK(s.CKs)
  s.CKs = newCKs

  const nonce  = buildNonce(s.dhRatchetStep, s.Ns)
  const header = {
    type:                   'x3dh_init',
    sender_id:              senderId,
    receiver_id:            receiverId,
    // Campos X3DH que Bob necesita para derivar SK
    ik_pub:                 bytesToBase64(x3dhInfo.myIkPub),
    ek_pub:                 bytesToBase64(x3dhInfo.ekPub),
    opk_id:                 x3dhInfo.opkId,
    // Primer clave DH del ratchet (para que Bob inicialice su ratchet)
    dh_pub:                 bytesToBase64(s.DHs.pub),
    message_number:         s.Ns,
    previous_chain_length:  s.PN,
    nonce:                  bytesToBase64(nonce),
  }

  const aad            = concatBytes(headerToBytes(header), s.AD)
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const { ciphertext, tag } = encryptAEAD(mk, nonce, plaintextBytes, aad)

  s.Ns++

  log.info('Mensaje inicial X3DH cifrado', {
    to:    receiverId,
    opkId: x3dhInfo.opkId,
  })

  mk.fill(0)

  return {
    newState: s,
    envelope: { header, ciphertext, tag },
  }
}

// ── Descifrado con Double Ratchet ─────────────────────────────

/**
 * Descifra un mensaje usando el Double Ratchet.
 *
 * Algoritmo (Fase 2 + Fase 4 del doc.):
 *   1. Verificar si es un mensaje ya visto (anti-replay)
 *   2. Si el dh_pub del header es nuevo -> girar ratchet DH
 *   3. Manejar mensajes fuera de orden (MKSKIPPED)
 *   4. KDF_CK(CKr) -> nueva CKr + MK
 *   5. Descifrar con AES-256-GCM, verificar tag
 *
 * @param {object} state    Estado del ratchet
 * @param {object} envelope { header, ciphertext, tag }
 * @returns {{ newState, plaintext: string }}
 */
export function ratchetDecrypt(state, envelope) {
  let s = deepCloneState(state)
  const { header, ciphertext, tag } = envelope

  const headerDHPub = base64ToBytes(header.dh_pub)
  const nonce       = base64ToBytes(header.nonce)
  const msgNum      = header.message_number

  // ── Anti-replay: verificar que no sea un duplicado ────────
  // Un mensaje con contador menor al ultimo procesado y que no
  // este en MKSKIPPED es un posible ataque de repeticion.
  const skKey = mkSkippedKey(headerDHPub, msgNum)
  if (s.Nr > msgNum && !s.MKSKIPPED.has(skKey) &&
      s.DHr && bytesToHex(s.DHr) === bytesToHex(headerDHPub)) {
    log.warn('Posible replay attack — mensaje con contador antiguo descartado', {
      msgNum,
      Nr: s.Nr,
    })
    throw new Error(`Replay detectado: msgNum=${msgNum} ya procesado`)
  }

  // ── Verificar si hay una MK en cache (mensaje fuera de orden) ──
  if (s.MKSKIPPED.has(skKey)) {
    log.info('Usando MK cacheada (mensaje fuera de orden)', { msgNum })
    const mk = s.MKSKIPPED.get(skKey)
    s.MKSKIPPED.delete(skKey)

    const aad = concatBytes(headerToBytes(header), s.AD)
    const plaintext = decryptAEAD(mk, nonce, ciphertext, tag, aad)
    mk.fill(0)

    return {
      newState:  s,
      plaintext: new TextDecoder().decode(plaintext),
    }
  }

  // ── Verificar si el DHr cambio (nuevo giro DH del otro lado) ──
  const isNewDHr = !s.DHr || bytesToHex(s.DHr) !== bytesToHex(headerDHPub)

  if (isNewDHr) {
    cryptoLog.group('Ratchet DH — giro al recibir mensaje')
    log.info('Nuevo DHr detectado — girando ratchet DH', {
      newDHr: bytesToHex(headerDHPub).slice(0, 16) + '...',
    })

    // Guardar MKs de la cadena de recepcion actual (mensajes aun no llegados)
    skipMessageKeys(s, s.Nr, msgNum)

    // Actualizar PN y resetear contadores de la nueva cadena
    s.PN  = s.Ns
    s.Ns  = 0
    s.Nr  = 0
    s.DHr = headerDHPub

    // Giro de recepcion: RK, CKr = KDF_RK(RK, DH(DHs, DHr))
    const dhOut1             = x25519.getSharedSecret(s.DHs.priv, s.DHr)
    const { newRK: rk1, newCK: ckr } = kdfRK(s.RK, dhOut1)
    s.RK  = rk1
    s.CKr = ckr
    s.dhRatchetStep++

    // Giro de envio: generar nuevo DHs y derivar CKs
    const newDHsPriv = x25519.utils.randomSecretKey()
    const newDHsPub  = x25519.getPublicKey(newDHsPriv)
    s.DHs = { priv: newDHsPriv, pub: newDHsPub }

    const dhOut2              = x25519.getSharedSecret(s.DHs.priv, s.DHr)
    const { newRK: rk2, newCK: cks } = kdfRK(s.RK, dhOut2)
    s.RK  = rk2
    s.CKs = cks
    s.dhRatchetStep++

    log.debug('Giro DH completado (recepcion)', {
      newRK:        bytesToHex(s.RK).slice(0, 16) + '...',
      newCKr:       bytesToHex(s.CKr).slice(0, 16) + '...',
      dhRatchetStep: s.dhRatchetStep,
    })
    cryptoLog.groupEnd()
  }

  // ── Guardar MKs de mensajes omitidos en la cadena actual ──
  skipMessageKeys(s, s.Nr, msgNum)

  // ── Avanzar cadena de recepcion para este mensaje ─────────
  const { newCK: newCKr, mk } = kdfCK(s.CKr)
  s.CKr = newCKr
  s.Nr  = msgNum + 1

  // ── Descifrar ─────────────────────────────────────────────
  const aad = concatBytes(headerToBytes(header), s.AD)

  let plaintext
  try {
    const plaintextBytes = decryptAEAD(mk, nonce, ciphertext, tag, aad)
    plaintext = new TextDecoder().decode(plaintextBytes)
  } catch (err) {
    log.error('Fallo de autenticacion AEAD — mensaje alterado o clave incorrecta', {
      msgNum,
      error: err.message,
    })
    throw err
  }

  log.info('Mensaje descifrado correctamente', {
    from:   header.sender_id,
    msgNum,
    dhStep: s.dhRatchetStep,
  })

  mk.fill(0)

  return { newState: s, plaintext }
}

// ── Helpers internos ──────────────────────────────────────────

/**
 * Genera la clave del mapa MKSKIPPED: "hexDHr:msgNum"
 */
function mkSkippedKey(dhPub, msgNum) {
  return `${bytesToHex(dhPub)}:${msgNum}`
}

/**
 * Cachea las message keys de mensajes que aun no han llegado.
 * Necesario para manejar mensajes fuera de orden (secc. 7 del doc.).
 *
 * Ejemplo: si llega el msg 5 antes del msg 3, calculamos y guardamos
 * las MKs de msg 3 y 4 en MKSKIPPED para usarlas cuando lleguen.
 */
function skipMessageKeys(state, from, until) {
  if (from + MAX_SKIP < until) {
    throw new Error(
      `Demasiados mensajes omitidos: ${until - from} > MAX_SKIP (${MAX_SKIP})`
    )
  }
  if (!state.CKr) return

  let ck = state.CKr
  for (let i = from; i < until; i++) {
    const { newCK, mk } = kdfCK(ck)
    ck = newCK
    const key = mkSkippedKey(state.DHr, i)
    state.MKSKIPPED.set(key, mk)
    log.debug('MK cacheada para mensaje omitido', { msgNum: i })
  }
  state.CKr = ck
}

/**
 * Clona el estado del ratchet para evitar mutaciones compartidas.
 * MKSKIPPED se clona de forma superficial (las MKs son inmutables tras creacion).
 */
function deepCloneState(s) {
  return {
    ...s,
    DHs:       s.DHs ? { priv: s.DHs.priv.slice(), pub: s.DHs.pub.slice() } : null,
    DHr:       s.DHr ? s.DHr.slice() : null,
    RK:        s.RK  ? s.RK.slice()  : null,
    CKs:       s.CKs ? s.CKs.slice() : null,
    CKr:       s.CKr ? s.CKr.slice() : null,
    AD:        s.AD  ? s.AD.slice()  : null,
    MKSKIPPED: new Map(s.MKSKIPPED),
  }
}

// ── Info para DiagnosticPanel ─────────────────────────────────
/**
 * Extrae informacion legible del estado del ratchet para mostrar
 * en el panel de diagnostico.
 * NO expone claves completas (solo prefijos para depuracion).
 */
export function getRatchetDisplay(state) {
  if (!state) return null
  return {
    sessionEstablished:   state.sessionEstablished ?? false,
    dhRatchetKey:         state.DHs ? bytesToHex(state.DHs.pub).slice(0, 20) + '...' : '—',
    rootKey:              state.RK  ? bytesToHex(state.RK).slice(0, 20) + '...'  : '—',
    sendingChainKey:      state.CKs ? bytesToHex(state.CKs).slice(0, 20) + '...' : '—',
    receivingChainKey:    state.CKr ? bytesToHex(state.CKr).slice(0, 20) + '...' : '—',
    messageNumber:        state.Ns  ?? 0,
    previousChainLength:  state.PN  ?? 0,
    dhRatchetStep:        state.dhRatchetStep ?? 0,
    skippedKeys:          state.MKSKIPPED?.size ?? 0,
  }
}
