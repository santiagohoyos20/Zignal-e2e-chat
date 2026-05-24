/**
 * app.js — Servidor principal de Zignal
 *
 * Arquitectura:
 *   - Express maneja las rutas REST (Key Server + Message Store)
 *   - WebSocketServer maneja la entrega de mensajes en tiempo real
 *   - El servidor es CIEGO al contenido: solo reenvía blobs cifrados
 *
 * Flujo de un mensaje:
 *   1. Alice cifra el mensaje con Double Ratchet -> envelope { header, ciphertext, tag }
 *   2. Alice envía: { type:'message', to:'bob', payload: envelope } por WebSocket
 *   3. Si Bob está online  -> relay inmediato por WebSocket
 *   4. Si Bob está offline -> se encola en MessageStore
 *   5. Al reconectarse, Bob recibe identify_ack con sus mensajes pendientes
 */

import express           from 'express'
import cors              from 'cors'
import { createServer }  from 'http'
import { WebSocketServer } from 'ws'

import keysRouter                     from './routes/keys.js'
import messagesRouter                 from './routes/messages.js'
import { enqueueMessage, drainQueue } from './routes/messages.js'
import { rootLogger, createLogger }   from './utils/logger.js'

const app = express()
const log = createLogger('WebSocket')

// ── Middleware global ─────────────────────────────────────────
app.use(cors())
app.use(express.json())

// Log de cada request HTTP entrante (excluyendo /health para no saturar)
app.use((req, _res, next) => {
  if (req.path !== '/health') {
    rootLogger.debug(`${req.method} ${req.path}`, { ip: req.ip })
  }
  next()
})

const PORT = process.env.PORT || 3001

// ── Mapa de conexiones WebSocket activas ──────────────────────
// userId -> WebSocket
// Solo contiene usuarios con conexión abierta en este momento.
const connections = new Map()

// ── Rutas REST ────────────────────────────────────────────────
app.use('/api/keys',     keysRouter)
app.use('/api/messages', messagesRouter)

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    uptime:    process.uptime(),
    connected: connections.size,
    timestamp: new Date().toISOString(),
  })
})

// ── Root info ─────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name:      'Zignal E2E Messaging Server',
    version:   '0.2.0',
    protocols: ['X3DH', 'Double Ratchet', 'AES-256-GCM'],
    endpoints: {
      keyServer:    '/api/keys',
      messageStore: '/api/messages',
      websocket:    `ws://localhost:${PORT}`,
      health:       '/health',
    },
  })
})

// ── Error handler global ──────────────────────────────────────
// Captura cualquier error no manejado en las rutas Express
app.use((err, _req, res, _next) => {
  rootLogger.error('Error no manejado en Express', err)
  res.status(500).json({ error: err.message ?? 'Internal Server Error' })
})

// ── HTTP server ───────────────────────────────────────────────
const server = createServer(app)

// ── WebSocket Server ──────────────────────────────────────────
const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  // IP del cliente para logging (detras de proxy usa x-forwarded-for)
  const clientIp = req.headers['x-forwarded-for'] ?? req.socket.remoteAddress
  log.info('Nueva conexion WebSocket', { ip: clientIp })

  // userId asociado a este socket (se asigna al recibir 'identify')
  let currentUserId = null

  // ── Mensaje recibido ──────────────────────────────────────
  ws.on('message', (raw) => {

    // ── Parseo seguro ──────────────────────────────────────
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      log.warn('JSON invalido descartado', { ip: clientIp })
      ws.send(JSON.stringify({ type: 'error', reason: 'invalid_json' }))
      return
    }

    // ── Tipo: identify ─────────────────────────────────────
    // El cliente se presenta con su userId al conectar o reconectar.
    // Respuesta: ack + entrega de mensajes encolados pendientes.
    if (msg.type === 'identify') {
      const { userId } = msg

      if (!userId || typeof userId !== 'string') {
        log.warn('identify sin userId valido', { ip: clientIp })
        ws.send(JSON.stringify({ type: 'error', reason: 'identify_missing_userId' }))
        return
      }

      // Cerrar sesion previa del mismo userId si existe
      // (el usuario abrio otra pestana o reconecto antes del cierre limpio)
      const existing = connections.get(userId)
      if (existing && existing !== ws) {
        log.warn('Sesion duplicada — cerrando conexion anterior', { userId })
        existing.close(4001, 'session_replaced')
      }

      connections.set(userId, ws)
      currentUserId = userId

      log.info('Usuario identificado', {
        userId,
        totalConnected: connections.size,
      })

      // ── Entrega de mensajes encolados ──────────────────
      // Si el usuario tenia mensajes pendientes (estaba offline),
      // los enviamos inmediatamente tras el identify.
      const pending = drainQueue(userId)
      if (pending.length > 0) {
        log.info('Entregando mensajes encolados al reconectar', {
          userId,
          count: pending.length,
        })
        for (const envelope of pending) {
          // Se entrega como 'message' estandar para que el cliente
          // lo procese igual que un mensaje en tiempo real.
          ws.send(JSON.stringify({
            type:       'message',
            from:       envelope.from,
            payload:    envelope.payload,
            queued:     true,          // bandera informativa (cliente puede ignorar)
            enqueuedAt: envelope.enqueuedAt,
          }))
        }
      }

      // Confirmar identify al cliente
      ws.send(JSON.stringify({
        type:            'identify_ack',
        userId,
        pendingMessages: pending.length,
      }))
      return
    }

    // ── Tipo: message ──────────────────────────────────────
    // Relay de un mensaje cifrado.
    // El servidor NUNCA inspecciona payload.ciphertext ni payload.header.
    if (msg.type === 'message') {
      const { to, payload } = msg

      if (!to || typeof to !== 'string') {
        log.warn('Mensaje sin destinatario valido', { from: currentUserId })
        ws.send(JSON.stringify({ type: 'error', reason: 'message_missing_to' }))
        return
      }
      if (!payload || typeof payload !== 'object') {
        log.warn('Mensaje sin payload cifrado', { from: currentUserId, to })
        ws.send(JSON.stringify({ type: 'error', reason: 'message_missing_payload' }))
        return
      }

      // Usar el userId autenticado (identify) como remitente
      const from = currentUserId ?? msg.from

      // ── Entrega directa si el destinatario esta online ─
      const destWs = connections.get(to)
      if (destWs && destWs.readyState === destWs.OPEN) {
        destWs.send(JSON.stringify({ type: 'message', from, payload }))
        log.info('Mensaje retransmitido (online)', { from, to })
        ws.send(JSON.stringify({ type: 'delivered', to, status: 'online' }))
      } else {
        // ── Encolar si el destinatario esta offline ────────
        const result = enqueueMessage(to, from, payload)

        if (result.dropped) {
          log.warn('Mensaje descartado — cola del destinatario llena', { from, to })
          ws.send(JSON.stringify({ type: 'error', reason: 'queue_full', to }))
        } else {
          log.info('Mensaje encolado (destinatario offline)', { from, to, queueSize: result.queueSize })
          ws.send(JSON.stringify({
            type:      'delivered',
            to,
            status:    'queued',
            queueSize: result.queueSize,
          }))
        }
      }
      return
    }

    // ── Tipo: ping ─────────────────────────────────────────
    // Heartbeat para mantener la conexion viva a traves de proxies
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
      return
    }

    // ── Tipo desconocido ───────────────────────────────────
    log.warn('Tipo de mensaje WebSocket desconocido', {
      type:   msg.type,
      userId: currentUserId,
    })
    ws.send(JSON.stringify({ type: 'error', reason: 'unknown_message_type' }))
  })

  // ── Cierre de conexion ─────────────────────────────────────
  ws.on('close', (code, reason) => {
    if (currentUserId) {
      connections.delete(currentUserId)
      log.info('Usuario desconectado', {
        userId:         currentUserId,
        code,
        reason:         reason?.toString() ?? '',
        totalConnected: connections.size,
      })
    } else {
      log.info('Conexion anonima cerrada', { ip: clientIp, code })
    }
  })

  // ── Error en el WebSocket ──────────────────────────────────
  ws.on('error', (err) => {
    log.error('Error en WebSocket', {
      userId: currentUserId ?? '(anonimo)',
      error:  err.message,
    })
    ws.close()
  })
})

// ── Arranque del servidor ─────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  rootLogger.info('===========================================')
  rootLogger.info('  Zignal E2E Messaging Server  v0.2.0')
  rootLogger.info('===========================================')
  rootLogger.info(`HTTP  -> http://0.0.0.0:${PORT}`)
  rootLogger.info(`WS    -> ws://0.0.0.0:${PORT}`)
  rootLogger.info('Rutas -> /api/keys  |  /api/messages  |  /health')
  rootLogger.info('Servidor listo. Esperando conexiones...')
})

export default app
export { connections }
