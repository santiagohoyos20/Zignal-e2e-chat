/**
 * App.jsx — Componente raiz de Zignal
 *
 * Orquesta:
 *  1. useCrypto: genera claves al login, establece sesiones X3DH,
 *                cifra/descifra mensajes con Double Ratchet
 *  2. useChat:   transporta payloads cifrados por WebSocket
 *
 * Flujo de envio:
 *   handleSendMessage(text)
 *     -> crypto.encryptMessage(peerId, text) -> envelope cifrado
 *     -> chat.send(peerId, envelope)         -> WebSocket al servidor
 *     -> mensaje aparece en UI (texto plano local)
 *
 * Flujo de recepcion:
 *   useChat.onMessage({ from, payload })
 *     -> crypto.decryptMessage(from, payload) -> texto claro
 *     -> mensaje aparece en UI
 */

import { useState, useEffect, useCallback } from 'react'
import LoginScreen    from './components/LoginScreen'
import Sidebar        from './components/Sidebar'
import ChatPanel      from './components/ChatPanel'
import DiagnosticPanel from './components/DiagnosticPanel'
import { useChat }    from './hooks/useChat'
import { useCrypto }  from './hooks/useCrypto'
import { users, contacts } from './data/mockData'
import { appLogger }  from './utils/logger'

export default function App() {
  const [activeUser,    setActiveUser]    = useState(null)
  const [activeContact, setActiveContact] = useState(null)
  const [messages,      setMessages]      = useState({ alice: [], bob: [] })
  const [darkMode,      setDarkMode]      = useState(true)
  const [showDiag,      setShowDiag]      = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  // ── Capa criptografica ────────────────────────────────────
  const crypto = useCrypto(activeUser?.id)

  // ── Handler de mensajes entrantes ─────────────────────────
  const handleIncoming = useCallback(async ({ from, payload }) => {
    appLogger.info('Mensaje entrante recibido', { from, headerType: payload?.header?.type })

    let text
    try {
      // Descifrar el payload con Double Ratchet (y X3DH si es primer mensaje)
      text = await crypto.decryptMessage(from, payload)
    } catch (err) {
      appLogger.error('No se pudo descifrar el mensaje', { from, error: err.message })
      text = '[Mensaje no descifrable]'
    }

    const newMsg = {
      id:        Date.now(),
      sender:    from,
      text,
      timestamp: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages(prev => ({
      ...prev,
      [from]: [...(prev[from] ?? []), newMsg],
    }))
  }, [crypto])

  // ── Conexion WebSocket ────────────────────────────────────
  const { send, connected } = useChat(activeUser?.id, handleIncoming)

  // ── Login ─────────────────────────────────────────────────
  async function handleLogin(user) {
    appLogger.info('Login', { userId: user.id })
    setActiveUser(user)

    // Seleccionar el otro usuario como contacto inicial
    const peerUser    = users.find(u => u.id !== user.id) ?? null
    const peerContact = contacts.find(c => c.id === peerUser?.id) ?? peerUser ?? null
    setActiveContact(peerContact)
  }

  // Inicializar claves cuando el usuario este disponible
  // (useEffect porque handleLogin no puede ser async directo en el onClick)
  useEffect(() => {
    if (activeUser && !crypto.initialized) {
      crypto.initializeKeys().catch(err => {
        appLogger.error('Error inicializando claves', err)
      })
    }
  }, [activeUser, crypto.initialized])

  // ── Seleccion de contacto: iniciar sesion X3DH ───────────
  async function handleSelectContact(contact) {
    setActiveContact(contact)

    // Solo iniciar sesion con contactos reales (no decorativos de la sidebar)
    if (contact?.real && crypto.initialized) {
      appLogger.info('Contacto seleccionado — iniciando sesion X3DH', {
        myId:   activeUser?.id,
        peerId: contact.id,
      })
      try {
        await crypto.ensureSession(contact.id)
      } catch (err) {
        appLogger.error('No se pudo establecer sesion X3DH', {
          peerId: contact.id,
          error:  err.message,
        })
      }
    }
  }

  // ── Logout ────────────────────────────────────────────────
  function handleLogout() {
    appLogger.info('Logout', { userId: activeUser?.id })
    setActiveUser(null)
    setActiveContact(null)
    setMessages({ alice: [], bob: [] })
  }

  // ── Envio de mensajes ─────────────────────────────────────
  async function handleSendMessage(text) {
    if (!activeContact || !activeUser) return

    // Mostrar el mensaje en la UI inmediatamente (texto plano local)
    const newMsg = {
      id:        Date.now(),
      sender:    activeUser.id,
      text,
      timestamp: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
    }
    setMessages(prev => ({
      ...prev,
      [activeContact.id]: [...(prev[activeContact.id] ?? []), newMsg],
    }))

    // Cifrar y enviar
    try {
      const envelope = await crypto.encryptMessage(activeContact.id, text)
      const sent = send(activeContact.id, envelope)
      if (!sent) {
        appLogger.warn('Mensaje no enviado — WebSocket no disponible', {
          to: activeContact.id,
        })
      }
    } catch (err) {
      appLogger.error('Error al cifrar/enviar mensaje', {
        to:    activeContact.id,
        error: err.message,
      })
    }
  }

  // ── Datos para la UI ──────────────────────────────────────
  const chatMessages = activeContact ? (messages[activeContact.id] ?? []) : []

  // Estado real del ratchet para el DiagnosticPanel
  const ratchetState = activeUser && activeContact
    ? crypto.getRatchetState(activeContact.id)
    : null

  // ── Render ────────────────────────────────────────────────
  if (!activeUser) {
    return <LoginScreen onLogin={handleLogin} users={users} />
  }

  return (
    <div
      className={`app grid max-md:grid-cols-1 max-md:relative grid-cols-[320px_1fr] h-screen overflow-hidden bg-bg text-app-text font-sans${activeContact ? ' contact-open' : ''}`}
    >
      <Sidebar
        contacts={contacts}
        activeUser={activeUser}
        activeContact={activeContact}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode(d => !d)}
        onSelectContact={handleSelectContact}
        onLogout={handleLogout}
      />
      <div className="chat-area flex min-w-0 overflow-hidden relative">
        <ChatPanel
          activeUser={activeUser}
          contact={activeContact}
          messages={chatMessages}
          sessionEstablished={ratchetState?.sessionEstablished ?? false}
          connected={connected}
          onSendMessage={handleSendMessage}
          onBack={() => setActiveContact(null)}
          onToggleDiag={() => setShowDiag(v => !v)}
        />
        <DiagnosticPanel
          ratchetState={ratchetState}
          activeUser={activeUser}
          contact={activeContact}
          mobileOpen={showDiag}
          onClose={() => setShowDiag(false)}
        />
      </div>
    </div>
  )
}
