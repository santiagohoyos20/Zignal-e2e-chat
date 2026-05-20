// app.js
import express from 'express'

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(express.json())

// ── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'E2E Messaging Server — X3DH + Double Ratchet',
    version: '0.1.0',
  })
})

// ── Rutas placeholder (las implementarás en semanas siguientes) ─
// Pre-key bundle: el servidor almacena las claves públicas de cada usuario
app.get('/prekeys/:userId', (req, res) => {
  res.json({
    userId: req.params.userId,
    bundle: null,          // aquí irá: IK, SPK, OPKs
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

// Mensajes cifrados entre dos usuarios
app.post('/messages/:to', (req, res) => {
  const { ciphertext, header } = req.body
  res.status(202).json({
    to: req.params.to,
    received: { ciphertext, header },
    message: 'Message relay endpoint — pendiente de implementar',
  })
})

// ── Manejo de errores (Express 5 ya propaga errores async) ────
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: err.message })
})

// ── Arranque ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

export default app