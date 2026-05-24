/**
 * routes/messages.js — Message Store
 *
 * El servidor almacena temporalmente mensajes cifrados cuando el
 * destinatario está desconectado. Al reconectarse, los recupera
 * y los elimina del store (entrega garantizada de un solo intento).
 *
 * IMPORTANTE: el servidor NUNCA puede leer el contenido.
 * Solo almacena blobs opacos { header, ciphertext, tag } tal como
 * los define el documento de diseño (sección 6).
 *
 * Endpoints:
 *   POST /api/messages/send            → Encolar mensaje (usado solo si el destino está offline)
 *   GET  /api/messages/:userId         → Recuperar y vaciar la cola del usuario
 *   GET  /api/messages/:userId/count   → Cuántos mensajes hay en cola (sin consumirlos)
 *   DELETE /api/messages/:userId       → Vaciar la cola manualmente (debug / logout)
 *
 * Nota: el WebSocket en app.js llama directamente a enqueueMessage()
 * cuando detecta que el destinatario está offline, sin pasar por HTTP.
 */

import { Router } from 'express'
import { createLogger } from '../utils/logger.js'

const router = Router()
const log    = createLogger('MessageStore')

// ── Cola en memoria ───────────────────────────────────────────
// Map: userId → [ MessageEnvelope, ... ]
//
// MessageEnvelope = {
//   id:        string (uuid simplificado),
//   from:      string (userId del remitente),
//   payload:   object (el mensaje cifrado completo, formato del doc §6)
//   enqueuedAt: string (ISO timestamp)
// }
const messageQueue = new Map()

// Límite de mensajes encolados por usuario para evitar abuso
const MAX_QUEUE_SIZE = 200

// ── Helper: inicializar cola si no existe ─────────────────────
function getQueue(userId) {
  if (!messageQueue.has(userId)) {
    messageQueue.set(userId, [])
  }
  return messageQueue.get(userId)
}

// ── Helper: generar ID simple de sobre ───────────────────────
let _seq = 0
function nextEnvelopeId() {
  return `env_${Date.now()}_${(++_seq).toString(36)}`
}

// ── Función exportada: encolar desde WebSocket ────────────────
/**
 * Encola un mensaje para un usuario offline.
 * Esta función es llamada directamente por app.js (no por HTTP).
 *
 * @param {string} toUserId   - Destinatario
 * @param {string} fromUserId - Remitente
 * @param {object} payload    - Envelope cifrado { header, ciphertext, tag }
 * @returns {{ ok: boolean, queueSize: number, dropped?: boolean }}
 */
export function enqueueMessage(toUserId, fromUserId, payload) {
  const queue = getQueue(toUserId)

  // ── Límite de cola por usuario ────────────────────────────
  if (queue.length >= MAX_QUEUE_SIZE) {
    log.warn('Cola llena — mensaje descartado', {
      to:        toUserId,
      from:      fromUserId,
      queueSize: queue.length,
      limit:     MAX_QUEUE_SIZE,
    })
    return { ok: false, dropped: true, queueSize: queue.length }
  }

  const envelope = {
    id:          nextEnvelopeId(),
    from:        fromUserId,
    payload,                          // blob cifrado opaco
    enqueuedAt:  new Date().toISOString(),
  }

  queue.push(envelope)

  log.info('Mensaje encolado para usuario offline', {
    to:        toUserId,
    from:      fromUserId,
    envelopeId: envelope.id,
    queueSize:  queue.length,
  })

  return { ok: true, queueSize: queue.length }
}

// ── Función exportada: recuperar y vaciar cola ────────────────
/**
 * Devuelve todos los mensajes encolados y vacía la cola.
 * Llamada por app.js al detectar que un usuario se reconecta (identify).
 *
 * @param {string} userId
 * @returns {MessageEnvelope[]}
 */
export function drainQueue(userId) {
  if (!messageQueue.has(userId) || messageQueue.get(userId).length === 0) {
    return []
  }

  const messages = messageQueue.get(userId).splice(0) // vacía en una operación atómica
  log.info('Cola drenada al reconectar', { userId, count: messages.length })
  return messages
}

// ── POST /api/messages/send ───────────────────────────────────
/**
 * Endpoint HTTP para encolar un mensaje manualmente.
 * En el flujo normal, app.js encola vía WebSocket sin pasar por aquí.
 * Este endpoint sirve para implementaciones REST-only o futuros clientes móviles.
 *
 * Body: { from, to, payload: { header, ciphertext, tag } }
 */
router.post('/send', (req, res) => {
  const { from, to, payload } = req.body

  // ── Validaciones ──────────────────────────────────────────
  if (!from || typeof from !== 'string') {
    return res.status(400).json({ error: '"from" es requerido (string)' })
  }
  if (!to || typeof to !== 'string') {
    return res.status(400).json({ error: '"to" es requerido (string)' })
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: '"payload" debe ser un objeto cifrado' })
  }
  // Verificar que el payload tiene la forma mínima esperada (§6 del diseño)
  if (!payload.header || !payload.ciphertext || !payload.tag) {
    log.warn('Payload malformado — faltan campos requeridos', { from, to })
    return res.status(400).json({
      error: 'payload debe contener { header, ciphertext, tag }',
    })
  }

  const result = enqueueMessage(to, from, payload)

  if (result.dropped) {
    return res.status(507).json({
      error: 'Cola del destinatario llena. El mensaje fue descartado.',
      queueSize: result.queueSize,
    })
  }

  return res.status(202).json({
    ok:        true,
    to,
    queueSize: result.queueSize,
    message:   'Mensaje encolado para entrega cuando el usuario se reconecte',
  })
})

// ── GET /api/messages/:userId ─────────────────────────────────
/**
 * El usuario recupera todos sus mensajes encolados.
 * La cola queda vacía después de esta llamada (entrega única).
 *
 * En un sistema real, esta ruta requeriría autenticación para
 * evitar que otro usuario vacíe la cola ajena.
 */
router.get('/:userId', (req, res) => {
  const { userId } = req.params

  const messages = drainQueue(userId)

  log.info('Mensajes recuperados vía HTTP', { userId, count: messages.length })

  return res.json({
    userId,
    count:    messages.length,
    messages,
  })
})

// ── GET /api/messages/:userId/count ──────────────────────────
/**
 * Consulta cuántos mensajes están encolados sin consumirlos.
 * Útil para que el cliente decida si debe hacer polling.
 */
router.get('/:userId/count', (req, res) => {
  const { userId } = req.params
  const count = messageQueue.get(userId)?.length ?? 0

  log.debug('Consulta de cola', { userId, count })
  return res.json({ userId, count })
})

// ── DELETE /api/messages/:userId ──────────────────────────────
/**
 * Vacía la cola sin devolver los mensajes.
 * Uso: logout, depuración, expiración de sesión.
 */
router.delete('/:userId', (req, res) => {
  const { userId } = req.params
  const previous   = messageQueue.get(userId)?.length ?? 0

  messageQueue.set(userId, [])
  log.info('Cola vaciada manualmente', { userId, deleted: previous })

  return res.json({ ok: true, userId, deleted: previous })
})

export default router
export { messageQueue }
