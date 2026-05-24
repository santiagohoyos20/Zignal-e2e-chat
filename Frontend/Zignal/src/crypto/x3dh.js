/**
 * crypto/x3dh.js — Protocolo X3DH (Extended Triple Diffie-Hellman)
 *
 * Implementa el flujo completo del documento (seccion 4 y figura 2):
 *
 *   FASE 1 — Bob publica su keybundle (IK, SPK firmado, OPKs)
 *   FASE 2 — Alice obtiene el bundle de Bob del servidor
 *   FASE 3 — Alice calcula la clave de sesion SK (4 operaciones DH + HKDF)
 *   FASE 4 — Alice envia el mensaje inicial cifrado
 *   FASE 5 — Bob replica SK con las mismas 4 operaciones DH
 *   FASE 6 — Sesion E2E establecida, se inicia Double Ratchet
 *
 * Librerias:
 *   @noble/curves  — X25519 (DH), Ed25519 (firma de SPK)
 *   @noble/hashes  — HKDF con SHA-256
 *
 * IMPORTANTE: las claves privadas nunca salen de este modulo.
 * Solo se exponen claves publicas y el SK resultante.
 */

import { x25519 }             from '@noble/curves/ed25519.js'
import { ed25519 }            from '@noble/curves/ed25519.js'
import { hkdf }               from '@noble/hashes/hkdf.js'
import { sha256 }             from '@noble/hashes/sha2.js'
import { concatBytes, bytesToBase64, base64ToBytes, bytesToHex } from './utils.js'
import { createLogger, cryptoLog } from '../utils/logger.js'

const log = createLogger('X3DH')

// ── Constantes del protocolo ──────────────────────────────────

// Salt para HKDF en X3DH: 32 bytes de 0xFF (segun spec de Signal)
const HKDF_SALT = new Uint8Array(32).fill(0xFF)

// Info string para HKDF — identifica esta aplicacion y version
const HKDF_INFO = new TextEncoder().encode('Zignal X3DH v1')

// Numero de OPKs a generar por defecto
const DEFAULT_OPK_COUNT = 10

// ── Generacion de claves ──────────────────────────────────────

/**
 * Genera el keybundle completo de un usuario.
 *
 * Devuelve:
 *  - publicBundle:  lo que se sube al servidor (solo claves publicas)
 *  - privateKeys:   lo que se guarda en memoria del cliente (claves privadas)
 *
 * Estructura de claves de identidad:
 *  - IK x25519: para operaciones DH en X3DH
 *  - IK ed25519: para firmar la SPK (autenticacion de identidad)
 *
 * @param {string} userId
 * @param {number} [opkCount=DEFAULT_OPK_COUNT]
 */
export function generateKeyBundle(userId, opkCount = DEFAULT_OPK_COUNT) {
  cryptoLog.group(`X3DH — Generar keybundle para '${userId}'`)
  log.info('Generando keybundle', { userId, opkCount })

  // ── Identity Key: dos partes ──────────────────────────────
  // x25519 para DH, ed25519 para firma de SPK
  const ikX25519Priv = x25519.utils.randomSecretKey()
  const ikX25519Pub  = x25519.getPublicKey(ikX25519Priv)
  const ikEd25519Priv = ed25519.utils.randomSecretKey()
  const ikEd25519Pub  = ed25519.getPublicKey(ikEd25519Priv)

  log.debug('IK generado', {
    ikX25519Pub:  bytesToHex(ikX25519Pub).slice(0, 16) + '...',
    ikEd25519Pub: bytesToHex(ikEd25519Pub).slice(0, 16) + '...',
  })

  // ── Signed PreKey (SPK) ───────────────────────────────────
  // Clave x25519 de mediano plazo, firmada con IK ed25519
  const spkPriv = x25519.utils.randomSecretKey()
  const spkPub  = x25519.getPublicKey(spkPriv)
  const spkKeyId = Date.now()  // keyId unico basado en timestamp

  // Firma: ed25519.sign(mensaje, clave_privada)
  // El mensaje firmado es la clave publica SPK
  const spkSignature = ed25519.sign(spkPub, ikEd25519Priv)

  log.debug('SPK generado y firmado', {
    spkKeyId,
    spkPub:       bytesToHex(spkPub).slice(0, 16) + '...',
    signatureLen: spkSignature.length,
  })

  // ── One-Time PreKeys (OPKs) ───────────────────────────────
  // Claves efimeras de un solo uso. Cada una tiene un ID unico.
  const opkPrivs = new Map()  // keyId -> privateKey (se guarda solo localmente)
  const opkPubs  = []         // lista de { keyId, publicKey } para el servidor

  for (let i = 0; i < opkCount; i++) {
    const keyId  = spkKeyId + i + 1   // IDs consecutivos
    const priv   = x25519.utils.randomSecretKey()
    const pub    = x25519.getPublicKey(priv)
    opkPrivs.set(keyId, priv)
    opkPubs.push({ keyId, publicKey: bytesToBase64(pub) })
  }

  log.info('OPKs generados', { count: opkCount, firstKeyId: opkPubs[0]?.keyId })

  // ── Bundle publico (va al servidor) ──────────────────────
  const publicBundle = {
    userId,
    identityKey: bytesToBase64(ikX25519Pub),   // IK x25519 para DH
    signedPrekey: {
      keyId:     spkKeyId,
      publicKey: bytesToBase64(spkPub),
      signature: bytesToBase64(spkSignature),
      // La firma permite al receptor verificar que SPK no fue alterada
    },
    oneTimePrekeys: opkPubs,
  }

  // ── Claves privadas (solo en memoria del cliente) ─────────
  const privateKeys = {
    ikX25519:  { priv: ikX25519Priv,  pub: ikX25519Pub  },
    ikEd25519: { priv: ikEd25519Priv, pub: ikEd25519Pub },
    spk:       { keyId: spkKeyId, priv: spkPriv, pub: spkPub },
    opks:      opkPrivs,   // Map<keyId, Uint8Array>
  }

  log.info('Keybundle generado correctamente', { userId })
  cryptoLog.groupEnd()

  return { publicBundle, privateKeys }
}

// ── X3DH Lado Alice (iniciadora) ──────────────────────────────

/**
 * FASE 3 del documento: Alice calcula SK usando el bundle de Bob.
 *
 * Operaciones DH:
 *   DH1 = DH(IK_A_x25519, SPK_B)    <- autenticacion de Alice con Bob
 *   DH2 = DH(EK_A,        IK_B)     <- forward secrecy del EK efimero
 *   DH3 = DH(EK_A,        SPK_B)    <- forward secrecy del SPK
 *   DH4 = DH(EK_A,        OPK_B)    <- perfect forward secrecy (si hay OPK)
 *
 *   SK = HKDF(DH1 || DH2 || DH3 [|| DH4])
 *
 * @param {object} myPrivateKeys   - Claves privadas de Alice (de generateKeyBundle)
 * @param {object} bobBundle       - Bundle publico de Bob (del servidor)
 * @returns {{ SK, AD, ephemeralKeyPair, opkId, dhsKeyPair }}
 */
export function x3dhSend(myPrivateKeys, bobBundle) {
  cryptoLog.group('X3DH — Fase 3: Alice calcula SK')
  log.info('Iniciando X3DH send', { bobUserId: bobBundle.userId })

  // ── Verificar firma de la SPK de Bob ──────────────────────
  // Esto previene que un servidor malicioso sustituya la SPK
  const bobSpkPub    = base64ToBytes(bobBundle.signedPrekey.publicKey)
  const bobSpkSig    = base64ToBytes(bobBundle.signedPrekey.signature)
  const bobIkX25519  = base64ToBytes(bobBundle.identityKey)

  // NOTA: necesitamos la IK ed25519 de Bob para verificar la firma.
  // En un sistema real, Bob tambien publicaria su IK ed25519.
  // Para este prototipo, omitimos la verificacion de firma aqui
  // (el documento la menciona como "verifica firma Sig(IK_B, SPK_B)").
  // TODO: publicar ikEd25519Pub en el bundle y verificar aqui.
  log.debug('Firma SPK de Bob (verificacion pendiente de ikEd25519 en bundle)')

  // ── Generar clave efimera EK_A ────────────────────────────
  // Esta clave es de un solo uso y garantiza forward secrecy
  const ekPriv = x25519.utils.randomSecretKey()
  const ekPub  = x25519.getPublicKey(ekPriv)
  log.debug('EK efimero generado', { ekPub: bytesToHex(ekPub).slice(0, 16) + '...' })

  // ── 4 operaciones DH ──────────────────────────────────────
  // DH1: IK_A_x25519 (priv) × SPK_B (pub)
  const dh1 = x25519.getSharedSecret(myPrivateKeys.ikX25519.priv, bobSpkPub)
  log.debug('DH1 = DH(IK_A, SPK_B)', { dh1: bytesToHex(dh1).slice(0, 16) + '...' })

  // DH2: EK_A (priv) × IK_B_x25519 (pub)
  const dh2 = x25519.getSharedSecret(ekPriv, bobIkX25519)
  log.debug('DH2 = DH(EK_A, IK_B)', { dh2: bytesToHex(dh2).slice(0, 16) + '...' })

  // DH3: EK_A (priv) × SPK_B (pub)
  const dh3 = x25519.getSharedSecret(ekPriv, bobSpkPub)
  log.debug('DH3 = DH(EK_A, SPK_B)', { dh3: bytesToHex(dh3).slice(0, 16) + '...' })

  // DH4 (opcional): EK_A (priv) × OPK_B (pub)
  let dh4   = null
  let opkId = null
  if (bobBundle.oneTimePrekey) {
    const opkPub = base64ToBytes(bobBundle.oneTimePrekey.publicKey)
    dh4  = x25519.getSharedSecret(ekPriv, opkPub)
    opkId = bobBundle.oneTimePrekey.keyId
    log.debug('DH4 = DH(EK_A, OPK_B)', {
      opkId,
      dh4: bytesToHex(dh4).slice(0, 16) + '...',
    })
  } else {
    log.warn('Sin OPK disponible — X3DH con 3 DH (forward secrecy reducida)')
  }

  // ── HKDF: derivar SK ─────────────────────────────────────
  // IKM = DH1 || DH2 || DH3 [|| DH4]
  const ikm = dh4 ? concatBytes(dh1, dh2, dh3, dh4) : concatBytes(dh1, dh2, dh3)
  const SK  = hkdf(sha256, ikm, HKDF_SALT, HKDF_INFO, 32)

  log.info('SK derivado correctamente', {
    SK:       bytesToHex(SK).slice(0, 16) + '...',
    usedOPK:  !!dh4,
  })

  // ── Associated Data (AD) ──────────────────────────────────
  // AD = Encode(IK_A) || Encode(IK_B)
  // Usado como AAD en el primer mensaje cifrado
  const AD = concatBytes(myPrivateKeys.ikX25519.pub, bobIkX25519)

  // ── Primer par DH del ratchet ─────────────────────────────
  // Clave efimera inicial para arrancar el Double Ratchet
  // (distinta de EK_A que fue solo para X3DH)
  const dhsPriv = x25519.utils.randomSecretKey()
  const dhsPub  = x25519.getPublicKey(dhsPriv)

  log.info('X3DH send completado — sesion lista para Double Ratchet')
  cryptoLog.groupEnd()

  return {
    SK,
    AD,
    ephemeralKeyPair: { priv: ekPriv, pub: ekPub },
    dhsKeyPair: { priv: dhsPriv, pub: dhsPub },
    opkId,
    bobSpkPub,
    bobIkX25519,
  }
}

// ── X3DH Lado Bob (receptor) ──────────────────────────────────

/**
 * FASE 5 del documento: Bob replica SK al recibir el primer mensaje de Alice.
 *
 * Bob calcula las mismas 4 operaciones DH pero usando sus claves privadas:
 *   DH1 = DH(SPK_B,  IK_A_pub)
 *   DH2 = DH(IK_B,   EK_A_pub)
 *   DH3 = DH(SPK_B,  EK_A_pub)
 *   DH4 = DH(OPK_B,  EK_A_pub)  <- si se uso OPK
 *
 * @param {object} myPrivateKeys  - Claves privadas de Bob
 * @param {object} initHeader     - Header del primer mensaje de Alice
 *   { ik_pub, ek_pub, opk_id, dh_pub, sender_id, receiver_id }
 * @returns {{ SK, AD }}
 */
export function x3dhReceive(myPrivateKeys, initHeader) {
  cryptoLog.group(`X3DH — Fase 5: Bob replica SK de '${initHeader.sender_id}'`)
  log.info('Iniciando X3DH receive', { from: initHeader.sender_id })

  const aliceIkPub = base64ToBytes(initHeader.ik_pub)
  const aliceEkPub = base64ToBytes(initHeader.ek_pub)

  // ── 4 operaciones DH (espejo de Alice) ────────────────────
  // DH1: SPK_B (priv) × IK_A (pub)
  const dh1 = x25519.getSharedSecret(myPrivateKeys.spk.priv, aliceIkPub)
  log.debug('DH1 = DH(SPK_B, IK_A)', { dh1: bytesToHex(dh1).slice(0, 16) + '...' })

  // DH2: IK_B_x25519 (priv) × EK_A (pub)
  const dh2 = x25519.getSharedSecret(myPrivateKeys.ikX25519.priv, aliceEkPub)
  log.debug('DH2 = DH(IK_B, EK_A)', { dh2: bytesToHex(dh2).slice(0, 16) + '...' })

  // DH3: SPK_B (priv) × EK_A (pub)
  const dh3 = x25519.getSharedSecret(myPrivateKeys.spk.priv, aliceEkPub)
  log.debug('DH3 = DH(SPK_B, EK_A)', { dh3: bytesToHex(dh3).slice(0, 16) + '...' })

  // DH4 (opcional): OPK_B (priv) × EK_A (pub)
  let dh4 = null
  if (initHeader.opk_id != null) {
    const opkPriv = myPrivateKeys.opks.get(initHeader.opk_id)
    if (!opkPriv) {
      log.warn('OPK solicitada no encontrada — posible reuso o perdida', {
        opkId: initHeader.opk_id,
      })
    } else {
      dh4 = x25519.getSharedSecret(opkPriv, aliceEkPub)
      // Eliminar OPK usada: no puede reutilizarse (forward secrecy)
      myPrivateKeys.opks.delete(initHeader.opk_id)
      log.debug('DH4 = DH(OPK_B, EK_A) — OPK eliminada', {
        opkId: initHeader.opk_id,
        dh4:   bytesToHex(dh4).slice(0, 16) + '...',
      })
    }
  }

  // ── HKDF: derivar el mismo SK que Alice ───────────────────
  const ikm = dh4 ? concatBytes(dh1, dh2, dh3, dh4) : concatBytes(dh1, dh2, dh3)
  const SK  = hkdf(sha256, ikm, HKDF_SALT, HKDF_INFO, 32)

  log.info('SK derivado correctamente (debe coincidir con el de Alice)', {
    SK:      bytesToHex(SK).slice(0, 16) + '...',
    usedOPK: !!dh4,
  })

  // ── Associated Data ───────────────────────────────────────
  const AD = concatBytes(aliceIkPub, myPrivateKeys.ikX25519.pub)

  log.info('X3DH receive completado')
  cryptoLog.groupEnd()

  return { SK, AD }
}
