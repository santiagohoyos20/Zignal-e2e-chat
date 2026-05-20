import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 3001

// userId → WebSocket activo
const connections = new Map()

// ── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'E2E Messaging Server — X3DH + Double Ratchet',
    version: '0.1.0',
  })
})

// ── WebSocket status ──────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({ connected: [...connections.keys()] })
})

// ── Pre-key bundle ────────────────────────────────────────────
app.get('/prekeys/:userId', (req, res) => {
  res.json({
    userId: req.params.userId,
    bundle: null,
    message: 'Pre-key bundle endpoint — pendiente de implementar',
  })
})

app.post('/prekeys/:userId', (req, res) => {
  const { bundle } = req.body
  res.status(201).json({
    userId: req.params.userId,
    received: bundle ?? null,
    message: 'Pre-key upload endpoint — pendiente de implementar',
  })
})

// ── Mensajes cifrados ─────────────────────────────────────────
app.post('/messages/:to', (req, res) => {
  const { ciphertext, header } = req.body
  res.status(202).json({
    to: req.params.to,
    received: { ciphertext, header },
    message: 'Message relay endpoint — pendiente de implementar',
  })
})

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: err.message })
})

// ── HTTP + WebSocket server ───────────────────────────────────
const server = createServer(app)
const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }

    if (msg.type === 'identify') {
      const { userId } = msg
      const existing = connections.get(userId)
      if (existing) {
        existing.close(4001, 'replaced')
      }
      connections.set(userId, ws)
      ws.send(JSON.stringify({ type: 'ack', userId }))
    } else if (msg.type === 'message') {
      const dest = connections.get(msg.to)
      if (dest && dest.readyState === dest.OPEN) {
        dest.send(data.toString())
      } else {
        ws.send(JSON.stringify({ type: 'error', reason: 'user_offline' }))
      }
    }
  })

  ws.on('close', () => {
    for (const [userId, socket] of connections) {
      if (socket === ws) {
        connections.delete(userId)
        break
      }
    }
  })

  ws.on('error', (err) => {
    console.error('WebSocket error:', err)
    ws.close()
  })
})

// ── Arranque ──────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`)
})

export default app
