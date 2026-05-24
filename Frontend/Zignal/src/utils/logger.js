/**
 * utils/logger.js — Logger para el navegador
 *
 * Proporciona salida de log con:
 *  - Niveles: INFO | WARN | ERROR | DEBUG
 *  - Colores CSS en la consola del browser
 *  - Agrupación de operaciones criptográficas (crypto.group / crypto.groupEnd)
 *  - Timestamps relativos al inicio de la sesión
 *
 * Uso:
 *   import { createLogger, cryptoLog } from '../utils/logger'
 *   const log = createLogger('X3DH')
 *   log.info('Sesión establecida', { userId: 'alice' })
 *   cryptoLog.group('X3DH Send')
 *   cryptoLog.groupEnd()
 */

// ── Colores por nivel ─────────────────────────────────────────
const STYLES = {
  INFO:  'color: #4ade80; font-weight: bold',   // verde
  WARN:  'color: #facc15; font-weight: bold',   // amarillo
  ERROR: 'color: #f87171; font-weight: bold',   // rojo
  DEBUG: 'color: #60a5fa; font-weight: bold',   // azul
}

const MODULE_STYLE  = 'color: #a78bfa; font-weight: bold'   // violeta
const META_STYLE    = 'color: #94a3b8; font-size: 11px'     // gris
const TIME_STYLE    = 'color: #475569; font-size: 10px'     // gris oscuro

// Momento de inicio de la sesión (para timestamps relativos)
const SESSION_START = performance.now()

function relativeTime() {
  const ms = Math.round(performance.now() - SESSION_START)
  return `+${ms}ms`
}

// ── Función interna de log ────────────────────────────────────
function writeLog(level, module, message, meta) {
  const time = relativeTime()
  const fn   = level === 'ERROR' ? console.error
             : level === 'WARN'  ? console.warn
             : console.log

  if (meta !== undefined) {
    fn(
      `%c${level}%c [${module}] %c${time}%c ${message}`,
      STYLES[level], MODULE_STYLE, TIME_STYLE, '',
      meta
    )
  } else {
    fn(
      `%c${level}%c [${module}] %c${time}%c ${message}`,
      STYLES[level], MODULE_STYLE, TIME_STYLE, ''
    )
  }
}

// ── Factory: logger vinculado a un módulo ─────────────────────
/**
 * @param {string} module  Nombre del módulo (p.ej. 'X3DH', 'Ratchet', 'useCrypto')
 */
export function createLogger(module) {
  return {
    /** Evento informativo normal del flujo. */
    info(message, meta) {
      writeLog('INFO', module, message, meta)
    },

    /** Situacion anómala no fatal. */
    warn(message, meta) {
      writeLog('WARN', module, message, meta)
    },

    /** Error que impide completar la operacion. */
    error(message, meta) {
      writeLog('ERROR', module, message, meta)
    },

    /**
     * Detalle de depuracion.
     * Solo emite si localStorage.debug === '1' o en desarrollo.
     */
    debug(message, meta) {
      if (localStorage.getItem('zignal:debug') === '1' || import.meta.env.DEV) {
        writeLog('DEBUG', module, message, meta)
      }
    },
  }
}

// ── Helper para agrupar operaciones criptograficas ────────────
/**
 * Envuelve un bloque de logs en un grupo colapsable en DevTools.
 *
 * Uso:
 *   cryptoLog.group('X3DH — Fase 3: derivar SK')
 *   log.debug('DH1', dh1)
 *   cryptoLog.groupEnd()
 */
export const cryptoLog = {
  group(label) {
    console.groupCollapsed(
      `%c🔐 ${label}`,
      'color: #c084fc; font-weight: bold; font-size: 12px'
    )
  },
  groupEnd() {
    console.groupEnd()
  },
}

// Logger global de la aplicacion
export const appLogger = createLogger('App')
