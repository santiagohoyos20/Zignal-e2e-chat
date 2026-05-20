import { useEffect, useRef, useCallback } from 'react'

const WS_URL = `ws://${window.location.hostname}:3001`

export function useChat(userId, onIncoming) {
  const wsRef = useRef(null)
  // Ref para evitar stale closure sin re-crear el efecto
  const onIncomingRef = useRef(onIncoming)
  onIncomingRef.current = onIncoming

  useEffect(() => {
    if (!userId) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'identify', userId }))
    }

    ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data)
        if (msg.type === 'message') onIncomingRef.current(msg)
      } catch {}
    }

    ws.onerror = (err) => console.error('WS error:', err)

    return () => ws.close()
  }, [userId])

  const send = useCallback((to, text) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'message', from: userId, to, text }))
    }
  }, [userId])

  return { send }
}
