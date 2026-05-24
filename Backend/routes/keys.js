/**
 * routes/keys.js — Key Server
 *
 * El servidor actúa como un repositorio CIEGO de claves públicas.
 * NUNCA tiene acceso a claves privadas; solo almacena y sirve
 * los bundles públicos que los clientes necesitan para X3DH.
 *
 * Endpoints:
 *   POST  /api/keys/register          → Registrar o actualizar keybundle completo
 *   GET   /api/keys/:userId           → Obtener keybundle (consume una OPK)
 *   POST  /api/keys/:userId/opk       → Reponer One-Time PreKeys
 *   GET   /api/keys/:userId/opk-count → Consultar cuántas OPKs quedan
 *
 * Estructura de un keybundle:
 * {
 *   identityKey:      "<base64>",   // IK  — clave de identidad a largo plazo (X25519 pública)
 *   signedPrekey: {
 *     keyId:          <number>,
 *     publicKey:      "<base64>",   // SPK — clave firmada de mediano plazo
 *     signature:      "<base64>",   // Sig(IK_priv, SPK_pub) con ed25519
 *   },
 *   oneTimePrekeys: [               // OPKs — claves efímeras de un solo uso
 *     { keyId: <number>, publicKey: "<base64>" },
 *     ...
 *   ]
 * }
 */

import { Router } from 'express'
import { createLogger } from '../utils/logger.js'

const router = Router()
const log    = createLogger('KeyServer')

// ── Almacén en memoria ────────────────────────────────────────
// Producción real usaría una base de datos persistente.
// Map: userId → { identityKey, signedPrekey, oneTimePrekeys: [] }
const keyStore = new Map()

// Umbral mínimo de OPKs antes de emitir advertencia al cliente
const OPK_LOW_THRESHOLD = 5

// ── Validadores ───────────────────────────────────────────────

/**
 * Verifica que un keybundle tenga la forma esperada.
 * Solo valida estructura; la verificación criptográfica
 * (firma de SPK) la realiza el cliente receptor.
 */
function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    return 'El cuerpo debe ser un objeto JSON'
  }
  if (typeof bundle.identityKey !== 'string' || !bundle.identityKey) {
    return 'Falta identityKey (string base64)'
  }
  if (!bundle.signedPrekey || typeof bundle.signedPrekey !== 'object') {
    return 'Falta signedPrekey'
  }
  const spk = bundle.signedPrekey
  if (typeof spk.keyId !== 'number') return 'signedPrekey.keyId debe ser number'
  if (typeof spk.publicKey !== 'string' || !spk.publicKey) {
    return 'signedPrekey.publicKey es requerido (base64)'
  }
  if (typeof spk.signature !== 'string' || !spk.signature) {
    return 'signedPrekey.signature es requerido (base64)'
  }
  if (!Array.isArray(bundle.oneTimePrekeys)) {
    return 'oneTimePrekeys debe ser un array'
  }
  for (const opk of bundle.oneTimePrekeys) {
    if (typeof opk.keyId !== 'number' || typeof opk.publicKey !== 'string') {
      return 'Cada OPK debe tener { keyId: number, publicKey: string }'
    }
  }
  return null // sin error
}

// ── POST /api/keys/register ───────────────────────────────────
/**
 * Registra o reemplaza el keybundle completo de un usuario.
 *
 * Body: { userId, identityKey, signedPrekey, oneTimePrekeys[] }
 *
 * En un sistema real habría autenticación para evitar que otro
 * usuario sobreescriba el bundle ajeno. Aquí se omite por ser prototipo.
 */
router.post('/register', (req, res) => {
  const { userId, ...bundle } = req.body

  // ── Validar userId ────────────────────────────────────────
  if (!userId || typeof userId !== 'string') {
    log.warn('Registro rechazado: userId inválido', { body: req.body })
    return res.status(400).json({ error: 'userId es requerido (string)' })
  }

  // ── Validar estructura del bundle ─────────────────────────
  const validationError = validateBundle(bundle)
  if (validationError) {
    log.warn('Registro rechazado: bundle malformado', { userId, reason: validationError })
    return res.status(400).json({ error: validationError })
  }

  const isUpdate  = keyStore.has(userId)
  const opkCount  = bundle.oneTimePrekeys.length

  // ── Guardar en el store ───────────────────────────────────
  keyStore.set(userId, {
    identityKey:   bundle.identityKey,
    signedPrekey:  bundle.signedPrekey,
    oneTimePrekeys: [...bundle.oneTimePrekeys],  // copia defensiva
    registeredAt:  new Date().toISOString(),
  })

  log.info(`Keybundle ${isUpdate ? 'actualizado' : 'registrado'}`, {
    userId,
    spkKeyId:  bundle.signedPrekey.keyId,
    opkCount,
  })

  // Advertir si el usuario registró pocas OPKs
  if (opkCount < OPK_LOW_THRESHOLD) {
    log.warn('OPK count bajo en el registro', { userId, opkCount, threshold: OPK_LOW_THRESHOLD })
  }

  return res.status(isUpdate ? 200 : 201).json({
    ok:       true,
    userId,
    opkCount,
    message:  isUpdate ? 'Keybundle actualizado' : 'Keybundle registrado',
  })
})

// ── GET /api/keys/:userId ─────────────────────────────────────
/**
 * Devuelve el keybundle público de un usuario para iniciar X3DH.
 *
 * Comportamiento:
 *  - Siempre incluye IK y SPK (con firma).
 *  - Si hay OPKs disponibles, consume y retira una (forward secrecy).
 *  - Si no hay OPKs, devuelve el bundle sin OPK — el iniciador
 *    debe proceder sin ella (X3DH lo permite, con menor seguridad).
 *
 * El campo `opkLow: true` indica al cliente que el destinatario
 * debería reponer sus OPKs pronto.
 */
router.get('/:userId', (req, res) => {
  const { userId } = req.params

  // ── Verificar que el usuario esté registrado ──────────────
  if (!keyStore.has(userId)) {
    log.warn('Bundle solicitado para usuario no registrado', { userId })
    return res.status(404).json({ error: `No hay keybundle registrado para '${userId}'` })
  }

  const entry = keyStore.get(userId)

  // ── Consumir una OPK (si existe) ──────────────────────────
  // Extraemos la primera OPK disponible y la eliminamos del store
  // para que no pueda usarse en otra sesión (perfect forward secrecy).
  let oneTimePrekey = null
  if (entry.oneTimePrekeys.length > 0) {
    oneTimePrekey = entry.oneTimePrekeys.shift()  // consume la primera
    log.info('OPK consumida', {
      userId,
      opkKeyId:        oneTimePrekey.keyId,
      opkRemaining:    entry.oneTimePrekeys.length,
    })
  } else {
    // Sin OPKs: X3DH puede continuar sin ella, pero con menor
    // garantía de forward secrecy para esa sesión inicial.
    log.warn('Bundle servido SIN OPK — pool agotado', { userId })
  }

  const opkRemaining = entry.oneTimePrekeys.length
  const opkLow       = opkRemaining < OPK_LOW_THRESHOLD

  if (opkLow) {
    log.warn('OPK pool bajo', { userId, opkRemaining, threshold: OPK_LOW_THRESHOLD })
  }

  // ── Construir respuesta ───────────────────────────────────
  const responseBundle = {
    userId,
    identityKey:  entry.identityKey,
    signedPrekey: entry.signedPrekey,     // incluye keyId, publicKey, signature
    oneTimePrekey,                        // null si no hay disponibles
    opkLow,                               // aviso al cliente para reponer
  }

  log.info('Bundle entregado', { to: userId, hasOPK: !!oneTimePrekey })
  return res.json(responseBundle)
})

// ── POST /api/keys/:userId/opk ────────────────────────────────
/**
 * Repone el pool de One-Time PreKeys de un usuario.
 *
 * Body: { oneTimePrekeys: [{ keyId, publicKey }, ...] }
 *
 * El cliente debe llamar este endpoint cuando recibe opkLow=true
 * en una respuesta de GET /api/keys/:userId, o proactivamente
 * al detectar que su pool local está bajo.
 */
router.post('/:userId/opk', (req, res) => {
  const { userId }       = req.params
  const { oneTimePrekeys } = req.body

  // ── Validaciones básicas ──────────────────────────────────
  if (!keyStore.has(userId)) {
    log.warn('Reposición OPK para usuario no registrado', { userId })
    return res.status(404).json({ error: `Usuario '${userId}' no registrado` })
  }

  if (!Array.isArray(oneTimePrekeys) || oneTimePrekeys.length === 0) {
    log.warn('Reposición OPK rechazada: array vacío o inválido', { userId })
    return res.status(400).json({ error: 'oneTimePrekeys debe ser un array no vacío' })
  }

  // Validar formato de cada OPK nueva
  for (const opk of oneTimePrekeys) {
    if (typeof opk.keyId !== 'number' || typeof opk.publicKey !== 'string') {
      return res.status(400).json({
        error: 'Cada OPK debe tener { keyId: number, publicKey: string }',
      })
    }
  }

  const entry    = keyStore.get(userId)
  const previous = entry.oneTimePrekeys.length

  // ── Agregar las nuevas OPKs al pool ───────────────────────
  // Evitar duplicados por keyId (defensa ante reenvíos accidentales)
  const existingIds = new Set(entry.oneTimePrekeys.map((o) => o.keyId))
  const newOPKs     = oneTimePrekeys.filter((o) => !existingIds.has(o.keyId))
  const skipped     = oneTimePrekeys.length - newOPKs.length

  entry.oneTimePrekeys.push(...newOPKs)

  log.info('OPKs reabastecidas', {
    userId,
    added:    newOPKs.length,
    skipped,                  // duplicados ignorados
    total:    entry.oneTimePrekeys.length,
  })

  return res.json({
    ok:       true,
    added:    newOPKs.length,
    skipped,
    total:    entry.oneTimePrekeys.length,
    previous,
  })
})

// ── GET /api/keys/:userId/opk-count ──────────────────────────
/**
 * Devuelve cuántas OPKs quedan disponibles para un usuario.
 * Útil para que el propio usuario monitoree su pool sin exponer
 * las claves públicas completas.
 */
router.get('/:userId/opk-count', (req, res) => {
  const { userId } = req.params

  if (!keyStore.has(userId)) {
    return res.status(404).json({ error: `Usuario '${userId}' no registrado` })
  }

  const count = keyStore.get(userId).oneTimePrekeys.length
  log.debug('Consulta de OPK count', { userId, count })

  return res.json({
    userId,
    opkCount: count,
    opkLow:   count < OPK_LOW_THRESHOLD,
  })
})

// ── Exportar router y acceso al store (para el WebSocket) ─────
export default router
export { keyStore }
