/**
 * tests/crypto.test.mjs — Suite de pruebas de seguridad para Zignal
 *
 * Verifica que el protocolo X3DH + Double Ratchet funciona correctamente
 * y que las protecciones de seguridad actuan como se espera.
 *
 * Ejecutar:
 *   node tests/crypto.test.mjs
 *
 * Requiere Node.js 18+ (ESM nativo, WebCrypto disponible como crypto.getRandomValues).
 * No requiere instalar dependencias adicionales — usa los nobles de Frontend/.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Escenarios cubiertos:
 *
 *  X3DH
 *   T01  Alice y Bob derivan el mismo SK
 *   T02  SK varia entre sesiones distintas (OPK diferente)
 *   T03  AD = concat(IK_A, IK_B) es simétrico
 *
 *  Double Ratchet — flujo basico
 *   T04  Alice envía msg 1 (x3dh_init) → Bob descifra
 *   T05  Bob responde con giro DH → Alice descifra
 *   T06  Conversacion de 6 mensajes alternados — todos descifran correctamente
 *   T07  Multiples mensajes consecutivos en la misma cadena
 *
 *  Mensajes fuera de orden
 *   T08  Llega msg[2] antes que msg[1] — ambos descifran
 *   T09  Llega msg[4] antes que msg[2] y msg[3] — los tres descifran
 *
 *  Seguridad — integridad y autenticacion
 *   T10  Ciphertext modificado → AES-GCM rechaza (tag invalido)
 *   T11  Tag modificado → AES-GCM rechaza
 *   T12  Header modificado → AAD distinto → AES-GCM rechaza
 *   T13  Replay attack → excepcion "Replay detectado"
 *   T14  Mensaje de sesión distinta → descifrado falla (AD diferente)
 *   T15  OPK eliminada tras uso → segundo x3dhReceive con mismo opk_id falla
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Importar librerias noble desde el frontend ────────────────
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join }                from 'path'

const __dirname   = dirname(fileURLToPath(import.meta.url))
const nodeModules = join(__dirname, '../Frontend/Zignal/node_modules')

// En Windows los import() dinamicos requieren URLs file://, no rutas absolutas
function toURL(pkgPath) {
  return pathToFileURL(join(nodeModules, pkgPath)).href
}

const { x25519, ed25519 } = await import(toURL('@noble/curves/ed25519.js'))
const { hkdf }             = await import(toURL('@noble/hashes/hkdf.js'))
const { hmac }             = await import(toURL('@noble/hashes/hmac.js'))
const { sha256 }           = await import(toURL('@noble/hashes/sha2.js'))
const { gcm }              = await import(toURL('@noble/ciphers/aes.js'))

// ── Utilidades de bytes (replica exacta de src/crypto/utils.js) ──

function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out   = new Uint8Array(total)
  let offset  = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}

function bytesToBase64(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64ToBytes(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/')
  const padded = s + '=='.slice(0, (4 - s.length % 4) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Nonce estructurado de 96 bits (12 bytes):
 *   [dhRatchetStep(4B) | padding(4B) | messageNumber(4B)]
 */
function buildNonce(dhRatchetStep, messageNumber) {
  const view = new DataView(new ArrayBuffer(12))
  view.setUint32(0, dhRatchetStep,  false)  // big-endian
  view.setUint32(4, 0,              false)  // padding
  view.setUint32(8, messageNumber,  false)
  return new Uint8Array(view.buffer)
}

// ── Constantes del protocolo ──────────────────────────────────
const HKDF_SALT_X3DH   = new Uint8Array(32).fill(0xFF)
const HKDF_INFO_X3DH   = new TextEncoder().encode('Zignal X3DH v1')
const HKDF_INFO_RATCHET = new TextEncoder().encode('ZignalRatchet')
const MAX_SKIP = 100

// ── X3DH ─────────────────────────────────────────────────────

function generateKeyBundle(userId, opkCount = 10) {
  const ikX25519Priv  = x25519.utils.randomSecretKey()
  const ikX25519Pub   = x25519.getPublicKey(ikX25519Priv)
  const ikEd25519Priv = ed25519.utils.randomSecretKey()
  const ikEd25519Pub  = ed25519.getPublicKey(ikEd25519Priv)

  const spkPriv = x25519.utils.randomSecretKey()
  const spkPub  = x25519.getPublicKey(spkPriv)
  const spkKeyId = Date.now()
  const spkSignature = ed25519.sign(spkPub, ikEd25519Priv)

  const opkPrivs = new Map()
  const opkPubs  = []
  for (let i = 0; i < opkCount; i++) {
    const keyId = spkKeyId + i + 1
    const priv  = x25519.utils.randomSecretKey()
    const pub   = x25519.getPublicKey(priv)
    opkPrivs.set(keyId, priv)
    opkPubs.push({ keyId, publicKey: bytesToBase64(pub) })
  }

  const publicBundle = {
    userId,
    identityKey:   bytesToBase64(ikX25519Pub),
    signedPrekey:  { keyId: spkKeyId, publicKey: bytesToBase64(spkPub), signature: bytesToBase64(spkSignature) },
    oneTimePrekeys: opkPubs,
  }

  const privateKeys = {
    ikX25519:  { priv: ikX25519Priv,  pub: ikX25519Pub  },
    ikEd25519: { priv: ikEd25519Priv, pub: ikEd25519Pub },
    spk:       { keyId: spkKeyId, priv: spkPriv, pub: spkPub },
    opks:      opkPrivs,
  }

  return { publicBundle, privateKeys }
}

/**
 * Simula el servidor: consume la primera OPK del bundle (como GET /api/keys/:userId).
 */
function consumeBundle(publicBundle) {
  const opks = [...publicBundle.oneTimePrekeys]
  const oneTimePrekey = opks.shift() ?? null
  return { ...publicBundle, oneTimePrekeys: opks, oneTimePrekey }
}

function x3dhSend(myPrivateKeys, bobBundle) {
  const bobSpkPub   = base64ToBytes(bobBundle.signedPrekey.publicKey)
  const bobIkX25519 = base64ToBytes(bobBundle.identityKey)

  const ekPriv = x25519.utils.randomSecretKey()
  const ekPub  = x25519.getPublicKey(ekPriv)

  const dh1 = x25519.getSharedSecret(myPrivateKeys.ikX25519.priv, bobSpkPub)
  const dh2 = x25519.getSharedSecret(ekPriv, bobIkX25519)
  const dh3 = x25519.getSharedSecret(ekPriv, bobSpkPub)

  let dh4 = null, opkId = null
  if (bobBundle.oneTimePrekey) {
    const opkPub = base64ToBytes(bobBundle.oneTimePrekey.publicKey)
    dh4   = x25519.getSharedSecret(ekPriv, opkPub)
    opkId = bobBundle.oneTimePrekey.keyId
  }

  const ikm = dh4 ? concatBytes(dh1, dh2, dh3, dh4) : concatBytes(dh1, dh2, dh3)
  const SK  = hkdf(sha256, ikm, HKDF_SALT_X3DH, HKDF_INFO_X3DH, 32)
  const AD  = concatBytes(myPrivateKeys.ikX25519.pub, bobIkX25519)

  const dhsPriv = x25519.utils.randomSecretKey()
  const dhsPub  = x25519.getPublicKey(dhsPriv)

  return { SK, AD, ephemeralKeyPair: { priv: ekPriv, pub: ekPub },
           dhsKeyPair: { priv: dhsPriv, pub: dhsPub }, opkId, bobSpkPub, bobIkX25519 }
}

function x3dhReceive(myPrivateKeys, initHeader) {
  const aliceIkPub = base64ToBytes(initHeader.ik_pub)
  const aliceEkPub = base64ToBytes(initHeader.ek_pub)

  const dh1 = x25519.getSharedSecret(myPrivateKeys.spk.priv, aliceIkPub)
  const dh2 = x25519.getSharedSecret(myPrivateKeys.ikX25519.priv, aliceEkPub)
  const dh3 = x25519.getSharedSecret(myPrivateKeys.spk.priv, aliceEkPub)

  let dh4 = null
  if (initHeader.opk_id != null) {
    const opkPriv = myPrivateKeys.opks.get(initHeader.opk_id)
    if (opkPriv) {
      dh4 = x25519.getSharedSecret(opkPriv, aliceEkPub)
      myPrivateKeys.opks.delete(initHeader.opk_id)  // consumir OPK
    }
  }

  const ikm = dh4 ? concatBytes(dh1, dh2, dh3, dh4) : concatBytes(dh1, dh2, dh3)
  const SK  = hkdf(sha256, ikm, HKDF_SALT_X3DH, HKDF_INFO_X3DH, 32)
  const AD  = concatBytes(aliceIkPub, myPrivateKeys.ikX25519.pub)

  return { SK, AD }
}

// ── Double Ratchet ────────────────────────────────────────────

function kdfRK(rk, dhOutput) {
  const out = hkdf(sha256, dhOutput, rk, HKDF_INFO_RATCHET, 64)
  return { newRK: out.slice(0, 32), newCK: out.slice(32, 64) }
}

function kdfCK(ck) {
  const mk    = hmac(sha256, ck, new Uint8Array([0x01]))
  const newCK = hmac(sha256, ck, new Uint8Array([0x02]))
  return { newCK, mk }
}

function headerToBytes(header) {
  return new TextEncoder().encode(JSON.stringify(header))
}

function encryptAEAD(mk, nonce, plaintext, aad) {
  const cipher    = gcm(mk, nonce, aad)
  const encrypted = cipher.encrypt(plaintext)
  return { ciphertext: bytesToBase64(encrypted.slice(0, -16)),
           tag:        bytesToBase64(encrypted.slice(-16)) }
}

function decryptAEAD(mk, nonce, ciphertextB64, tagB64, aad) {
  const combined = concatBytes(base64ToBytes(ciphertextB64), base64ToBytes(tagB64))
  return gcm(mk, nonce, aad).decrypt(combined)
}

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

function initSend(SK, dhsKP, bobSpkPub, AD) {
  const dhOut          = x25519.getSharedSecret(dhsKP.priv, bobSpkPub)
  const { newRK, newCK } = kdfRK(SK, dhOut)
  return {
    DHs: dhsKP, DHr: bobSpkPub, RK: newRK, CKs: newCK, CKr: null,
    Ns: 0, Nr: 0, PN: 0, dhRatchetStep: 1,
    MKSKIPPED: new Map(), AD, sessionEstablished: true,
  }
}

function initReceive(SK, spkKP, AD) {
  return {
    DHs: spkKP, DHr: null, RK: SK, CKs: null, CKr: null,
    Ns: 0, Nr: 0, PN: 0, dhRatchetStep: 0,
    MKSKIPPED: new Map(), AD, sessionEstablished: true,
  }
}

function mkSkippedKey(dhPub, msgNum) {
  return `${bytesToHex(dhPub)}:${msgNum}`
}

function skipMessageKeys(state, from, until) {
  if (from + MAX_SKIP < until)
    throw new Error(`Demasiados mensajes omitidos: ${until - from} > MAX_SKIP (${MAX_SKIP})`)
  if (!state.CKr) return
  let ck = state.CKr
  for (let i = from; i < until; i++) {
    const { newCK, mk } = kdfCK(ck)
    ck = newCK
    state.MKSKIPPED.set(mkSkippedKey(state.DHr, i), mk)
  }
  state.CKr = ck
}

function ratchetEncrypt(state, plaintext, senderId, receiverId) {
  let s = deepCloneState(state)

  if (!s.CKs) {
    s.PN = s.Ns; s.Ns = 0
    const newDHsPriv = x25519.utils.randomSecretKey()
    s.DHs = { priv: newDHsPriv, pub: x25519.getPublicKey(newDHsPriv) }
    const { newRK, newCK } = kdfRK(s.RK, x25519.getSharedSecret(s.DHs.priv, s.DHr))
    s.RK = newRK; s.CKs = newCK; s.dhRatchetStep++
  }

  const { newCK: newCKs, mk } = kdfCK(s.CKs)
  s.CKs = newCKs

  const nonce  = buildNonce(s.dhRatchetStep, s.Ns)
  const header = {
    type: 'ratchet', sender_id: senderId, receiver_id: receiverId,
    dh_pub: bytesToBase64(s.DHs.pub),
    message_number: s.Ns, previous_chain_length: s.PN,
    nonce: bytesToBase64(nonce),
  }
  const aad = concatBytes(headerToBytes(header), s.AD)
  const { ciphertext, tag } = encryptAEAD(mk, nonce, new TextEncoder().encode(plaintext), aad)
  s.Ns++
  mk.fill(0)
  return { newState: s, envelope: { header, ciphertext, tag } }
}

function encryptInitialMessage(state, plaintext, senderId, receiverId, x3dhInfo) {
  let s = deepCloneState(state)
  const { newCK: newCKs, mk } = kdfCK(s.CKs)
  s.CKs = newCKs

  const nonce  = buildNonce(s.dhRatchetStep, s.Ns)
  const header = {
    type: 'x3dh_init', sender_id: senderId, receiver_id: receiverId,
    ik_pub:  bytesToBase64(x3dhInfo.myIkPub),
    ek_pub:  bytesToBase64(x3dhInfo.ekPub),
    opk_id:  x3dhInfo.opkId,
    dh_pub:  bytesToBase64(s.DHs.pub),
    message_number: s.Ns, previous_chain_length: s.PN,
    nonce: bytesToBase64(nonce),
  }
  const aad = concatBytes(headerToBytes(header), s.AD)
  const { ciphertext, tag } = encryptAEAD(mk, nonce, new TextEncoder().encode(plaintext), aad)
  s.Ns++
  mk.fill(0)
  return { newState: s, envelope: { header, ciphertext, tag } }
}

function ratchetDecrypt(state, envelope) {
  let s = deepCloneState(state)
  const { header, ciphertext, tag } = envelope
  const headerDHPub = base64ToBytes(header.dh_pub)
  const nonce       = base64ToBytes(header.nonce)
  const msgNum      = header.message_number

  // Anti-replay
  const skKey = mkSkippedKey(headerDHPub, msgNum)
  if (s.Nr > msgNum && !s.MKSKIPPED.has(skKey) &&
      s.DHr && bytesToHex(s.DHr) === bytesToHex(headerDHPub)) {
    throw new Error(`Replay detectado: msgNum=${msgNum} ya procesado`)
  }

  // Mensaje fuera de orden (en cache)
  if (s.MKSKIPPED.has(skKey)) {
    const mk = s.MKSKIPPED.get(skKey)
    s.MKSKIPPED.delete(skKey)
    const aad = concatBytes(headerToBytes(header), s.AD)
    const pt  = decryptAEAD(mk, nonce, ciphertext, tag, aad)
    mk.fill(0)
    return { newState: s, plaintext: new TextDecoder().decode(pt) }
  }

  // Nuevo DHr = giro DH
  const isNewDHr = !s.DHr || bytesToHex(s.DHr) !== bytesToHex(headerDHPub)
  if (isNewDHr) {
    skipMessageKeys(s, s.Nr, msgNum)
    s.PN = s.Ns; s.Ns = 0; s.Nr = 0; s.DHr = headerDHPub

    const { newRK: rk1, newCK: ckr } = kdfRK(s.RK, x25519.getSharedSecret(s.DHs.priv, s.DHr))
    s.RK = rk1; s.CKr = ckr; s.dhRatchetStep++

    const newP = x25519.utils.randomSecretKey()
    s.DHs = { priv: newP, pub: x25519.getPublicKey(newP) }
    const { newRK: rk2, newCK: cks } = kdfRK(s.RK, x25519.getSharedSecret(s.DHs.priv, s.DHr))
    s.RK = rk2; s.CKs = cks; s.dhRatchetStep++
  }

  skipMessageKeys(s, s.Nr, msgNum)
  const { newCK: newCKr, mk } = kdfCK(s.CKr)
  s.CKr = newCKr; s.Nr = msgNum + 1

  const aad = concatBytes(headerToBytes(header), s.AD)
  const pt  = decryptAEAD(mk, nonce, ciphertext, tag, aad)
  mk.fill(0)
  return { newState: s, plaintext: new TextDecoder().decode(pt) }
}

// ── Motor de pruebas ──────────────────────────────────────────

let passed = 0, failed = 0
const RESET = '\x1b[0m', GREEN = '\x1b[32m', RED = '\x1b[31m',
      BOLD = '\x1b[1m', DIM = '\x1b[2m', CYAN = '\x1b[36m', YELLOW = '\x1b[33m'

function header(title) {
  console.log(`\n${CYAN}${BOLD}▸ ${title}${RESET}`)
}

function pass(id, desc) {
  passed++
  console.log(`  ${GREEN}✓${RESET} ${DIM}${id}${RESET}  ${desc}`)
}

function fail(id, desc, err) {
  failed++
  console.log(`  ${RED}✗${RESET} ${DIM}${id}${RESET}  ${desc}`)
  console.log(`      ${RED}${err?.message ?? err}${RESET}`)
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Establece una sesion completa alice->bob y devuelve los estados iniciales.
 */
function setupSession(aliceId = 'alice', bobId = 'bob') {
  const alice = generateKeyBundle(aliceId)
  const bob   = generateKeyBundle(bobId)

  const serverBundle  = consumeBundle(bob.publicBundle)
  const aliceX3dh     = x3dhSend(alice.privateKeys, serverBundle)
  const { SK: aliceSK, AD: aliceAD } = aliceX3dh

  const aliceRatchet  = initSend(aliceSK, aliceX3dh.dhsKeyPair, aliceX3dh.bobSpkPub, aliceAD)

  // Alice cifra primer mensaje (x3dh_init)
  const { newState: aliceState1, envelope: msg1 } = encryptInitialMessage(
    aliceRatchet, 'Hola Bob',
    aliceId, bobId,
    { myIkPub: alice.privateKeys.ikX25519.pub, ekPub: aliceX3dh.ephemeralKeyPair.pub, opkId: aliceX3dh.opkId }
  )

  // Bob recibe y replica la sesion
  const { SK: bobSK, AD: bobAD } = x3dhReceive(bob.privateKeys, msg1.header)
  const bobSpkKP    = bob.privateKeys.spk
  const bobRatchet  = initReceive(bobSK, bobSpkKP, bobAD)
  const { newState: bobState1, plaintext: bobPlain1 } = ratchetDecrypt(bobRatchet, msg1)

  return {
    alice: { keys: alice, state: aliceState1, id: aliceId },
    bob:   { keys: bob,   state: bobState1,   id: bobId,  plain1: bobPlain1 },
    msg1,
  }
}

// ═══════════════════════════════════════════════════════════════
// PRUEBAS
// ═══════════════════════════════════════════════════════════════

// ── T01-T03: X3DH ──────────────────────────────────────────────
header('X3DH — Establecimiento de sesion')

try {
  const alice = generateKeyBundle('alice')
  const bob   = generateKeyBundle('bob')
  const serverBundle = consumeBundle(bob.publicBundle)

  const { SK: skAlice, AD: adAlice } = x3dhSend(alice.privateKeys, serverBundle)

  // Simular primer mensaje para que Bob conozca los params
  const dhsPriv = x25519.utils.randomSecretKey()
  const dhsKP   = { priv: dhsPriv, pub: x25519.getPublicKey(dhsPriv) }
  const ekPriv  = x25519.utils.randomSecretKey()
  const ekPub   = x25519.getPublicKey(ekPriv)
  const initHeader = {
    type: 'x3dh_init', sender_id: 'alice', receiver_id: 'bob',
    ik_pub: bytesToBase64(alice.privateKeys.ikX25519.pub),
    ek_pub: bytesToBase64(ekPub),
    opk_id: serverBundle.oneTimePrekey?.keyId ?? null,
    dh_pub: bytesToBase64(dhsKP.pub),
    message_number: 0, previous_chain_length: 0,
    nonce: bytesToBase64(buildNonce(1, 0)),
  }

  // Alice necesita recalcular con el EK real que uso
  const aliceX3dh = x3dhSend(alice.privateKeys, serverBundle)
  const { SK: skBob } = x3dhReceive(bob.privateKeys, {
    ...initHeader,
    ik_pub: bytesToBase64(alice.privateKeys.ikX25519.pub),
    ek_pub: bytesToBase64(aliceX3dh.ephemeralKeyPair.pub),
    opk_id: aliceX3dh.opkId,
  })

  // Para el test T01 usamos un flujo limpio con setupSession
  const { bob: { plain1 } } = setupSession()
  assert(plain1 === 'Hola Bob', `Texto descifrado incorrecto: "${plain1}"`)
  pass('T01', 'Alice y Bob derivan SK identico (primer mensaje descifrado correctamente)')
} catch (e) { fail('T01', 'Alice y Bob derivan SK identico', e) }

try {
  // Dos sesiones con bundles fresh — SK deben ser distintos
  const bob1 = generateKeyBundle('bob')
  const bob2 = generateKeyBundle('bob')
  const alice = generateKeyBundle('alice')

  const { SK: sk1 } = x3dhSend(alice.privateKeys, consumeBundle(bob1.publicBundle))
  const { SK: sk2 } = x3dhSend(alice.privateKeys, consumeBundle(bob2.publicBundle))

  assert(!bytesEqual(sk1, sk2), 'Los SK de dos sesiones distintas no deben coincidir')
  pass('T02', 'SK distinto en cada nueva sesion (OPK diferente)')
} catch (e) { fail('T02', 'SK distinto en cada nueva sesion', e) }

try {
  const alice = generateKeyBundle('alice')
  const bob   = generateKeyBundle('bob')
  const sBundle = consumeBundle(bob.publicBundle)
  const { AD: adAlice, ephemeralKeyPair: ek, opkId } = x3dhSend(alice.privateKeys, sBundle)
  const { AD: adBob } = x3dhReceive(bob.privateKeys, {
    ik_pub: bytesToBase64(alice.privateKeys.ikX25519.pub),
    ek_pub: bytesToBase64(ek.pub), opk_id: opkId,
  })

  // AD_Alice = concat(IK_A, IK_B) ; AD_Bob = concat(IK_A, IK_B)  → deben ser iguales
  assert(bytesEqual(adAlice, adBob), 'AD no coincide entre Alice y Bob')
  // AD tiene exactamente 64 bytes (dos claves x25519 de 32 bytes cada una)
  assert(adAlice.length === 64, `AD tiene longitud incorrecta: ${adAlice.length}`)
  pass('T03', `AD = concat(IK_A || IK_B) es simetrico (${adAlice.length} bytes)`)
} catch (e) { fail('T03', 'AD simetrico y correcto', e) }

// ── T04-T07: Double Ratchet basico ────────────────────────────
header('Double Ratchet — Flujo basico')

try {
  const { bob } = setupSession()
  assert(bob.plain1 === 'Hola Bob', `Esperaba "Hola Bob", obtuvo "${bob.plain1}"`)
  pass('T04', 'Primer mensaje x3dh_init descifrado por Bob: "Hola Bob"')
} catch (e) { fail('T04', 'Primer mensaje x3dh_init cifrado y descifrado', e) }

try {
  const { alice, bob } = setupSession()

  // Bob responde (gira el ratchet DH)
  const { newState: bobSt, envelope: reply } = ratchetEncrypt(bob.state, 'Hola Alice!', bob.id, alice.id)
  const { newState: aliceSt, plaintext } = ratchetDecrypt(alice.state, reply)

  assert(plaintext === 'Hola Alice!', `Esperaba "Hola Alice!", obtuvo "${plaintext}"`)
  pass('T05', 'Bob responde con giro DH → Alice descifra correctamente')
} catch (e) { fail('T05', 'Bob responde, Alice descifra', e) }

try {
  let { alice, bob } = setupSession()

  const exchange = [
    { from: 'alice', text: 'msg A1' },
    { from: 'bob',   text: 'msg B1' },
    { from: 'alice', text: 'msg A2' },
    { from: 'bob',   text: 'msg B2' },
    { from: 'alice', text: 'msg A3' },
    { from: 'bob',   text: 'msg B3' },
  ]

  for (const { from, text } of exchange) {
    if (from === 'alice') {
      const { newState, envelope } = ratchetEncrypt(alice.state, text, alice.id, bob.id)
      alice.state = newState
      const { newState: bs, plaintext } = ratchetDecrypt(bob.state, envelope)
      bob.state = bs
      assert(plaintext === text, `[${from}] Esperaba "${text}", obtuvo "${plaintext}"`)
    } else {
      const { newState, envelope } = ratchetEncrypt(bob.state, text, bob.id, alice.id)
      bob.state = newState
      const { newState: as, plaintext } = ratchetDecrypt(alice.state, envelope)
      alice.state = as
      assert(plaintext === text, `[${from}] Esperaba "${text}", obtuvo "${plaintext}"`)
    }
  }
  pass('T06', 'Conversacion de 6 mensajes alternados — todos descifrados correctamente')
} catch (e) { fail('T06', 'Conversacion alternada de 6 mensajes', e) }

try {
  let { alice, bob } = setupSession()

  // Alice envia 4 mensajes seguidos (misma cadena simetrica)
  const texts = ['primero', 'segundo', 'tercero', 'cuarto']
  const envelopes = []
  for (const t of texts) {
    const { newState, envelope } = ratchetEncrypt(alice.state, t, alice.id, bob.id)
    alice.state = newState
    envelopes.push({ envelope, text: t })
  }
  for (const { envelope, text } of envelopes) {
    const { newState, plaintext } = ratchetDecrypt(bob.state, envelope)
    bob.state = newState
    assert(plaintext === text, `Esperaba "${text}", obtuvo "${plaintext}"`)
  }
  pass('T07', '4 mensajes consecutivos en la misma cadena simetrica — todos correctos')
} catch (e) { fail('T07', '4 mensajes consecutivos en cadena', e) }

// ── T08-T09: Mensajes fuera de orden ──────────────────────────
header('Mensajes fuera de orden')

try {
  let { alice, bob } = setupSession()

  // Alice envia msg[0] y msg[1]
  const { newState: as0, envelope: env0 } = ratchetEncrypt(alice.state, 'orden-0', alice.id, bob.id)
  alice.state = as0
  const { newState: as1, envelope: env1 } = ratchetEncrypt(alice.state, 'orden-1', alice.id, bob.id)
  alice.state = as1

  // Bob recibe msg[1] PRIMERO (msg[0] llega tarde)
  const { newState: bs1, plaintext: p1 } = ratchetDecrypt(bob.state, env1)
  bob.state = bs1
  assert(p1 === 'orden-1', `Esperaba "orden-1", obtuvo "${p1}"`)

  // Luego llega msg[0] (debe estar en MKSKIPPED)
  const { newState: bs0, plaintext: p0 } = ratchetDecrypt(bob.state, env0)
  bob.state = bs0
  assert(p0 === 'orden-0', `Esperaba "orden-0", obtuvo "${p0}"`)

  pass('T08', 'msg[1] llega antes que msg[0] — ambos descifrados por MKSKIPPED')
} catch (e) { fail('T08', 'Mensajes fuera de orden (2 msgs)', e) }

try {
  let { alice, bob } = setupSession()

  // Alice envia msg[0..4]
  const envelopes = []
  for (let i = 0; i < 5; i++) {
    const { newState, envelope } = ratchetEncrypt(alice.state, `msg-${i}`, alice.id, bob.id)
    alice.state = newState
    envelopes.push(envelope)
  }

  // Bob recibe en orden: 4, 2, 3, 0, 1
  for (const i of [4, 2, 3, 0, 1]) {
    const { newState, plaintext } = ratchetDecrypt(bob.state, envelopes[i])
    bob.state = newState
    assert(plaintext === `msg-${i}`, `Esperaba "msg-${i}", obtuvo "${plaintext}"`)
  }
  pass('T09', '5 mensajes recibidos en orden [4,2,3,0,1] — todos descifrados via MKSKIPPED')
} catch (e) { fail('T09', 'Mensajes fuera de orden (5 msgs, orden aleatorio)', e) }

// ── T10-T15: Seguridad ────────────────────────────────────────
header('Seguridad — integridad y autenticacion AEAD')

try {
  const { alice, bob } = setupSession()
  const { envelope } = ratchetEncrypt(alice.state, 'mensaje secreto', alice.id, bob.id)

  // Modificar un byte del ciphertext
  const ct = base64ToBytes(envelope.ciphertext)
  ct[0] ^= 0xFF
  const tampered = { ...envelope, ciphertext: bytesToBase64(ct) }

  let threw = false
  try { ratchetDecrypt(bob.state, tampered) } catch { threw = true }
  assert(threw, 'Deberia lanzar excepcion al modificar ciphertext')
  pass('T10', 'Ciphertext modificado → AES-GCM rechaza (tag invalido)')
} catch (e) { fail('T10', 'Ciphertext tampered rechazado', e) }

try {
  const { alice, bob } = setupSession()
  const { envelope } = ratchetEncrypt(alice.state, 'mensaje secreto', alice.id, bob.id)

  // Modificar el tag de autenticacion
  const tag = base64ToBytes(envelope.tag)
  tag[0] ^= 0x01
  const tampered = { ...envelope, tag: bytesToBase64(tag) }

  let threw = false
  try { ratchetDecrypt(bob.state, tampered) } catch { threw = true }
  assert(threw, 'Deberia lanzar excepcion al modificar el tag')
  pass('T11', 'Tag de autenticacion modificado → AES-GCM rechaza')
} catch (e) { fail('T11', 'Tag tampered rechazado', e) }

try {
  const { alice, bob } = setupSession()
  const { envelope } = ratchetEncrypt(alice.state, 'mensaje secreto', alice.id, bob.id)

  // Modificar el sender_id en el header (el header es parte del AAD)
  const tampered = {
    ...envelope,
    header: { ...envelope.header, sender_id: 'mallory' },
  }

  let threw = false
  try { ratchetDecrypt(bob.state, tampered) } catch { threw = true }
  assert(threw, 'Deberia lanzar excepcion al modificar el header')
  pass('T12', 'Header modificado → AAD distinto → AES-GCM rechaza')
} catch (e) { fail('T12', 'Header tampered rechazado', e) }

try {
  const { alice, bob } = setupSession()
  const { newState: as, envelope } = ratchetEncrypt(alice.state, 'original', alice.id, bob.id)
  const { newState: bs } = ratchetDecrypt(bob.state, envelope)

  // Intentar descifrar el mismo envelope de nuevo (replay)
  let threw = false
  try { ratchetDecrypt(bs, envelope) } catch { threw = true }
  assert(threw, 'Deberia detectar replay')
  pass('T13', 'Replay attack detectado — segundo intento con mismo mensaje rechazado')
} catch (e) { fail('T13', 'Anti-replay detectado', e) }

try {
  // Sesion 1: alice → bob
  const s1 = setupSession('alice', 'bob')
  // Sesion 2: alice → carol (claves distintas)
  const carol = generateKeyBundle('carol')
  const carolBundle = consumeBundle(carol.publicBundle)
  const aliceX3dh2  = x3dhSend(s1.alice.keys.privateKeys, carolBundle)
  const { SK: sk2, AD: ad2 } = aliceX3dh2
  const aliceState2 = initSend(sk2, aliceX3dh2.dhsKeyPair, aliceX3dh2.bobSpkPub, ad2)

  // Alice cifra un mensaje en sesion 2
  const { envelope: env2 } = ratchetEncrypt(aliceState2, 'secreto para carol', 'alice', 'carol')

  // Bob intenta descifrar ese mensaje con su sesion 1 (AD diferente)
  let threw = false
  try { ratchetDecrypt(s1.bob.state, env2) } catch { threw = true }
  assert(threw, 'Bob no deberia poder descifrar un mensaje cifrado para Carol')
  pass('T14', 'Mensaje de sesion distinta → AD diferente → descifrado falla')
} catch (e) { fail('T14', 'Aislamiento entre sesiones', e) }

try {
  const alice = generateKeyBundle('alice')
  const bob   = generateKeyBundle('bob')
  const sBundle = consumeBundle(bob.publicBundle)

  const aliceX3dh = x3dhSend(alice.privateKeys, sBundle)
  const aliceRatchet = initSend(aliceX3dh.SK, aliceX3dh.dhsKeyPair, aliceX3dh.bobSpkPub, aliceX3dh.AD)

  const { envelope: msg } = encryptInitialMessage(
    aliceRatchet, 'primer mensaje', 'alice', 'bob',
    { myIkPub: alice.privateKeys.ikX25519.pub, ekPub: aliceX3dh.ephemeralKeyPair.pub, opkId: aliceX3dh.opkId }
  )

  // Primer x3dhReceive — consume la OPK
  const { SK: sk1 } = x3dhReceive(bob.privateKeys, msg.header)

  // Segundo x3dhReceive con el mismo header — la OPK ya fue eliminada
  // El SK resultante sera diferente (solo 3 DH, sin OPK)
  const { SK: sk2 } = x3dhReceive(bob.privateKeys, msg.header)

  assert(!bytesEqual(sk1, sk2), 'Segundo x3dhReceive sin OPK debe producir SK diferente')
  pass('T15', 'OPK eliminada tras primer uso — reutilizacion produce SK diferente')
} catch (e) { fail('T15', 'OPK consumida y no reutilizable', e) }

// ── Resumen final ─────────────────────────────────────────────
const total = passed + failed
console.log(`\n${'─'.repeat(56)}`)
if (failed === 0) {
  console.log(`${GREEN}${BOLD}  ✓ ${passed}/${total} pruebas pasaron${RESET}\n`)
} else {
  console.log(`${YELLOW}${BOLD}  ${passed} pasaron  |  ${RED}${failed} fallaron${RESET}  (total: ${total})\n`)
  process.exit(1)
}
