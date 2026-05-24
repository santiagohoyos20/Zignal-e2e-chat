/**
 * hooks/useCrypto.js — Hook React que orquesta toda la criptografia
 *
 * Ciclo de vida:
 *   1. Usuario hace login  -> initializeKeys(userId)
 *      - Genera keybundle (IK, SPK, OPKs)
 *      - Registra claves publicas en el Key Server (/api/keys/register)
 *
 *   2. Usuario selecciona contacto -> ensureSession(peerId)
 *      - Obtiene keybundle del contacto del servidor (GET /api/keys/:userId)
 *      - Ejecuta X3DH send -> obtiene SK y los parametros del ratchet
 *      - Inicializa Double Ratchet en modo envio
 *      - Estado: 'established' en sessionStates
 *
 *   3. Usuario envia mensaje -> encryptMessage(peerId, text)
 *      - Si es el primer mensaje: usa encryptInitialMessage (cabecera x3dh_init)
 *      - Si no: usa ratchetEncrypt normal
 *      - Devuelve { header, ciphertext, tag }
 *
 *   4. Llega mensaje -> decryptMessage(peerId, envelope)
 *      - Si header.type === 'x3dh_init': inicializa sesion Bob + descifra
 *      - Si header.type === 'ratchet':   descifra con estado existente
 *      - Devuelve texto claro
 *
 * Las claves privadas viven solo en myKeysRef (useRef) y nunca
 * se exponen en estado React ni en props.
 */

import { useRef, useState, useCallback } from 'react'
import { generateKeyBundle, x3dhSend, x3dhReceive } from '../crypto/x3dh.js'
import {
  initSend, initReceive,
  ratchetEncrypt, ratchetDecrypt,
  encryptInitialMessage, getRatchetDisplay,
} from '../crypto/ratchet.js'
import { base64ToBytes } from '../crypto/utils.js'
import { createLogger, cryptoLog } from '../utils/logger.js'

const log = createLogger('useCrypto')

// URL base del servidor
const API = `http://${window.location.hostname}:3001`

export function useCrypto(userId) {
  // ── Claves privadas del usuario local ─────────────────────
  // useRef: los cambios no disparan re-renders (las claves no van a la UI)
  const myKeysRef = useRef(null)

  // ── Sesiones por peer ─────────────────────────────────────
  // Map<peerId, { ratchetState, isFirstMessage: boolean }>
  const sessionsRef = useRef(new Map())

  // ── Estado React (solo lo que la UI necesita) ─────────────
  const [initialized,   setInitialized]   = useState(false)
  const [sessionStates, setSessionStates] = useState({})  // para DiagnosticPanel

  // ── Helper: actualizar display del ratchet ────────────────
  // Sincroniza el estado del ratchet al estado React para el DiagnosticPanel
  function syncRatchetDisplay(peerId, ratchetState) {
    setSessionStates(prev => ({
      ...prev,
      [peerId]: getRatchetDisplay(ratchetState),
    }))
  }

  // ── 1. Inicializar claves del usuario ─────────────────────
  /**
   * Genera el keybundle y lo registra en el servidor.
   * Debe llamarse una vez al hacer login.
   */
  const initializeKeys = useCallback(async () => {
    if (!userId) return
    cryptoLog.group(`useCrypto — initializeKeys('${userId}')`)
    log.info('Iniciando generacion de claves', { userId })

    try {
      const { publicBundle, privateKeys } = generateKeyBundle(userId)

      // Guardar claves privadas solo en memoria (nunca en estado React)
      myKeysRef.current = privateKeys

      // Registrar claves publicas en el servidor
      log.info('Registrando bundle publico en Key Server', { userId })
      const res = await fetch(`${API}/api/keys/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(publicBundle),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(`Key Server registro fallido: ${err.error}`)
      }

      const data = await res.json()
      log.info('Keybundle registrado en servidor', {
        userId,
        opkCount: data.opkCount,
        status:   data.message,
      })

      setInitialized(true)
      log.info('Inicializacion completada')
    } catch (err) {
      log.error('Error durante initializeKeys', err)
      throw err
    } finally {
      cryptoLog.groupEnd()
    }
  }, [userId])

  // ── 2. Establecer sesion X3DH con un peer ─────────────────
  /**
   * Obtiene el bundle del peer y ejecuta X3DH.
   * Si ya hay sesion activa, no hace nada.
   * Llamar antes de enviar el primer mensaje o al seleccionar un contacto.
   */
  const ensureSession = useCallback(async (peerId) => {
    if (!myKeysRef.current) {
      log.warn('ensureSession llamado sin claves inicializadas', { peerId })
      return
    }

    const existing = sessionsRef.current.get(peerId)
    if (existing?.ratchetState?.sessionEstablished) {
      log.debug('Sesion ya establecida', { peerId })
      return
    }

    cryptoLog.group(`useCrypto — ensureSession('${peerId}')`)
    log.info('Estableciendo sesion X3DH', { myUserId: userId, peerId })

    try {
      // Obtener bundle publico del peer del Key Server
      // (esta llamada consume una OPK del peer — forward secrecy)
      log.info('Obteniendo bundle del Key Server', { peerId })
      const res = await fetch(`${API}/api/keys/${peerId}`)

      if (!res.ok) {
        if (res.status === 404) {
          log.warn('Peer aun no ha registrado su bundle', { peerId })
          return
        }
        throw new Error(`Error al obtener bundle: ${res.status}`)
      }

      const peerBundle = await res.json()
      log.info('Bundle obtenido del servidor', {
        peerId,
        hasOPK:  !!peerBundle.oneTimePrekey,
        opkLow:  peerBundle.opkLow,
      })

      if (peerBundle.opkLow) {
        log.warn('OPK pool del peer esta bajo — notificar al peer para reabastecimiento', { peerId })
      }

      // ── X3DH send: calcular SK y parametros del ratchet ───
      const x3dhResult = x3dhSend(myKeysRef.current, peerBundle)
      const { SK, AD, dhsKeyPair, ephemeralKeyPair, opkId, bobSpkPub } = x3dhResult

      // ── Inicializar Double Ratchet (modo iniciador/Alice) ──
      const ratchetState = initSend(SK, dhsKeyPair, bobSpkPub, AD)

      // Guardar sesion con metadatos para el primer mensaje
      sessionsRef.current.set(peerId, {
        ratchetState,
        isFirstMessage: true,   // el primer cifrado usara encryptInitialMessage
        x3dhInfo: {
          myIkPub: myKeysRef.current.ikX25519.pub,
          ekPub:   ephemeralKeyPair.pub,
          opkId,
        },
      })

      log.info('Sesion X3DH establecida', {
        myUserId: userId,
        peerId,
        dhRatchetStep: ratchetState.dhRatchetStep,
      })

      syncRatchetDisplay(peerId, ratchetState)
    } catch (err) {
      log.error('Error al establecer sesion X3DH', err)
      throw err
    } finally {
      cryptoLog.groupEnd()
    }
  }, [userId])

  // ── 3. Cifrar un mensaje ──────────────────────────────────
  /**
   * Cifra un mensaje de texto para enviarlo al peer.
   * Si es el primer mensaje, incluye datos X3DH en el header.
   *
   * @param {string} peerId
   * @param {string} text
   * @returns {object} envelope { header, ciphertext, tag }
   */
  const encryptMessage = useCallback(async (peerId, text) => {
    const session = sessionsRef.current.get(peerId)
    if (!session?.ratchetState?.sessionEstablished) {
      log.warn('Intento de cifrar sin sesion activa — llamando ensureSession', { peerId })
      await ensureSession(peerId)
    }

    const s = sessionsRef.current.get(peerId)
    if (!s) throw new Error(`No hay sesion para '${peerId}'`)

    let result
    if (s.isFirstMessage) {
      // Primer mensaje: incluir datos X3DH para que el receptor pueda inicializar
      log.info('Cifrando primer mensaje (x3dh_init)', { to: peerId })
      result = encryptInitialMessage(
        s.ratchetState, text, userId, peerId, s.x3dhInfo
      )
      // Despues del primer mensaje, los siguientes son 'ratchet' normales
      sessionsRef.current.set(peerId, {
        ...s,
        ratchetState:   result.newState,
        isFirstMessage: false,
        x3dhInfo:       null,
      })
    } else {
      log.info('Cifrando mensaje', { to: peerId, type: 'ratchet' })
      result = ratchetEncrypt(s.ratchetState, text, userId, peerId)
      sessionsRef.current.set(peerId, { ...s, ratchetState: result.newState })
    }

    syncRatchetDisplay(peerId, result.newState)
    return result.envelope
  }, [userId, ensureSession])

  // ── 4. Descifrar un mensaje recibido ──────────────────────
  /**
   * Descifra un mensaje entrante.
   * Si es un mensaje x3dh_init, inicializa automaticamente la sesion de Bob.
   *
   * @param {string} fromId
   * @param {object} envelope  { header, ciphertext, tag }
   * @returns {string} texto claro
   */
  const decryptMessage = useCallback(async (fromId, envelope) => {
    if (!myKeysRef.current) {
      throw new Error('Claves no inicializadas — llama initializeKeys primero')
    }

    const { header } = envelope

    // ── Inicializar sesion si es el primer mensaje X3DH ───
    if (header.type === 'x3dh_init') {
      cryptoLog.group(`useCrypto — recibiendo sesion X3DH de '${fromId}'`)
      log.info('Recibido mensaje x3dh_init — inicializando sesion Bob', {
        from: fromId,
      })

      // Ejecutar X3DH receive para obtener el mismo SK que Alice
      const { SK, AD } = x3dhReceive(myKeysRef.current, header)

      // Inicializar ratchet en modo receptor (Bob)
      const ratchetState = initReceive(SK, myKeysRef.current.spk, AD)

      sessionsRef.current.set(fromId, {
        ratchetState,
        isFirstMessage: false,
      })

      log.info('Sesion X3DH inicializada (receptor)', { from: fromId })
      cryptoLog.groupEnd()
    }

    // ── Descifrar con Double Ratchet ──────────────────────
    const session = sessionsRef.current.get(fromId)
    if (!session) {
      throw new Error(`No hay sesion para descifrar mensaje de '${fromId}'`)
    }

    try {
      const { newState, plaintext } = ratchetDecrypt(session.ratchetState, envelope)

      sessionsRef.current.set(fromId, { ...session, ratchetState: newState })
      syncRatchetDisplay(fromId, newState)

      log.info('Mensaje descifrado', {
        from:   fromId,
        msgNum: header.message_number,
      })

      return plaintext
    } catch (err) {
      log.error('Fallo al descifrar mensaje', { from: fromId, error: err.message })
      throw err
    }
  }, [])

  // ── 5. Estado del ratchet para DiagnosticPanel ────────────
  /**
   * Devuelve el estado de visualizacion del ratchet para un peer.
   * Compatible con la interfaz que espera DiagnosticPanel.
   */
  const getRatchetState = useCallback((peerId) => {
    return sessionStates[peerId] ?? null
  }, [sessionStates])

  return {
    initialized,
    initializeKeys,
    ensureSession,
    encryptMessage,
    decryptMessage,
    getRatchetState,
  }
}
