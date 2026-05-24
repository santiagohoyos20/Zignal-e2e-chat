/**
 * hooks/useChat.js — Conexion WebSocket
 *
 * Responsabilidades:
 *   - Mantener la conexion WebSocket con el servidor
 *   - Enviar mensajes cifrados (payload = { header, ciphertext, tag })
 *   - Recibir mensajes y pasarlos al handler (sin descifrar — eso lo hace App)
 *   - Manejar identify y entrega de mensajes encolados al reconectar
 *
 * NOTA: este hook NO sabe nada de criptografia.
 * Solo transporta el payload opaco que le pasa App.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { createLogger } from '../utils/logger.js'

const log = createLogger('useChat')

const WS_URL = `ws://${window.location.hostname}:3001`

/**
 * @param {string|null} userId      - ID del usuario autenticado
 * @param {function}    onMessage   - Callback al recibir mensaje: ({ from, payload }) => void
 * @param {function}    onDelivered - Callback al recibir confirmacion de entrega (opcional)
 */
export function useChat(userId, onMessage, onDelivered) {
  const wsRef          = useRef(null)
  const onMessageRef   = useRef(onMessage)
  const onDeliveredRef = useRef(onDelivered)
  const [connected, setConnected] = useState(false)

  // Mantener refs actualizados sin recrear el efecto
  onMessageRef.current   = onMessage
  onDeliveredRef.current = onDelivered

  useEffect(() => {
    if (!userId) return

    log.info('Conectando WebSocket', { userId, url: WS_URL })
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      log.info('WebSocket conectado — enviando identify', { userId })
      ws.send(JSON.stringify({ type: 'identify', userId }))
    }

    ws.onmessage = ({ data }) => {
      let msg
      try {
        msg = JSON.parse(data)
      } catch {
        log.warn('Mensaje WS con JSON invalido descartado')
        return
      }

      switch (msg.type) {

        // Confirmacion de identify + mensajes encolados pendientes
        case 'identify_ack':
          setConnected(true)
          log.info('identify_ack recibido', {
            userId:          msg.userId,
            pendingMessages: msg.pendingMessages,
          })
          if (msg.pendingMessages > 0) {
            log.info(`Hay ${msg.pendingMessages} mensaje(s) encolado(s) siendo entregados`)
          }
          break

        // Mensaje cifrado entrante (online o encolado)
        case 'message':
          log.info('Mensaje recibido', {
            from:   msg.from,
            queued: msg.queued ?? false,
            type:   msg.payload?.header?.type ?? 'unknown',
          })
          // Pasar al handler de App para descifrado
          onMessageRef.current?.({ from: msg.from, payload: msg.payload })
          break

        // Confirmacion de entrega al destinatario
        case 'delivered':
          log.info('Confirmacion de entrega', {
            to:     msg.to,
            status: msg.status,   // 'online' | 'queued'
          })
          onDeliveredRef.current?.({ to: msg.to, status: msg.status })
          break

        // Respuesta a heartbeat
        case 'pong':
          log.debug('Pong recibido', { ts: msg.ts })
          break

        // Error del servidor
        case 'error':
          log.warn('Error del servidor', { reason: msg.reason, to: msg.to })
          break

        default:
          log.warn('Tipo de mensaje WS desconocido', { type: msg.type })
      }
    }

    ws.onerror = (err) => {
      log.error('Error en WebSocket', { error: err.message ?? 'unknown' })
    }

    ws.onclose = (evt) => {
      setConnected(false)
      log.info('WebSocket cerrado', { code: evt.code, reason: evt.reason })
    }

    // Heartbeat cada 25 segundos para mantener la conexion viva
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
        log.debug('Ping enviado')
      }
    }, 25_000)

    return () => {
      clearInterval(heartbeat)
      ws.close()
      log.info('WebSocket cerrado al desmontar hook', { userId })
    }
  }, [userId])

  /**
   * Envia un payload cifrado al destinatario.
   *
   * @param {string} to      - userId del destinatario
   * @param {object} payload - envelope cifrado { header, ciphertext, tag }
   */
  const send = useCallback((to, payload) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log.warn('Intento de envio con WebSocket no disponible', { to })
      return false
    }

    ws.send(JSON.stringify({ type: 'message', to, payload }))
    log.info('Mensaje enviado', {
      to,
      headerType: payload?.header?.type ?? 'unknown',
      msgNum:     payload?.header?.message_number,
    })
    return true
  }, [])

  return { send, connected }
}
