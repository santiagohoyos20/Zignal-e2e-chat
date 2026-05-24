/**
 * logger.js — Utilidad de logging centralizada
 *
 * Proporciona funciones de log con:
 *  - Timestamp ISO 8601
 *  - Nivel: INFO | WARN | ERROR | DEBUG
 *  - Módulo origen (para identificar de dónde viene el log)
 *  - Colores ANSI en desarrollo (se desactivan si NO_COLOR=1)
 *
 * Uso:
 *   import { createLogger } from '../utils/logger.js'
 *   const log = createLogger('KeyServer')
 *   log.info('Keybundle registrado', { userId: 'alice' })
 */

// ── Colores ANSI ───────────────────────────────────────────────
const USE_COLOR = process.env.NO_COLOR !== '1'

const RESET  = USE_COLOR ? '\x1b[0m'  : ''
const BOLD   = USE_COLOR ? '\x1b[1m'  : ''
const DIM    = USE_COLOR ? '\x1b[2m'  : ''
const CYAN   = USE_COLOR ? '\x1b[36m' : ''
const GREEN  = USE_COLOR ? '\x1b[32m' : ''
const YELLOW = USE_COLOR ? '\x1b[33m' : ''
const RED    = USE_COLOR ? '\x1b[31m' : ''
const BLUE   = USE_COLOR ? '\x1b[34m' : ''

// Paleta por nivel
const LEVEL_STYLES = {
  INFO:  { color: GREEN,  label: 'INFO ' },
  WARN:  { color: YELLOW, label: 'WARN ' },
  ERROR: { color: RED,    label: 'ERROR' },
  DEBUG: { color: BLUE,   label: 'DEBUG' },
}

// ── Formateador de timestamp ───────────────────────────────────
function timestamp() {
  return new Date().toISOString()
}

// ── Serializa metadatos opcionales ────────────────────────────
function serializeMeta(meta) {
  if (!meta || Object.keys(meta).length === 0) return ''
  try {
    return '  ' + DIM + JSON.stringify(meta) + RESET
  } catch {
    return '  [meta no serializable]'
  }
}

// ── Función interna de escritura ──────────────────────────────
function writeLog(level, module, message, meta) {
  const { color, label } = LEVEL_STYLES[level]
  const ts  = `${DIM}${timestamp()}${RESET}`
  const lvl = `${BOLD}${color}${label}${RESET}`
  const mod = `${CYAN}[${module}]${RESET}`
  const msg = message
  const ext = serializeMeta(meta)

  const line = `${ts} ${lvl} ${mod} ${msg}${ext}`

  // Los errores van a stderr, el resto a stdout
  if (level === 'ERROR') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
}

// ── Factory: crea un logger vinculado a un módulo ─────────────
/**
 * @param {string} module  Nombre del módulo (p.ej. 'KeyServer', 'WebSocket')
 * @returns {{ info, warn, error, debug }}
 */
export function createLogger(module) {
  return {
    /**
     * Evento informativo normal del flujo de negocio.
     * @param {string} message
     * @param {object} [meta]  Datos adicionales a serializar
     */
    info(message, meta) {
      writeLog('INFO', module, message, meta)
    },

    /**
     * Situación anómala que no detiene el servidor pero merece atención.
     * @param {string} message
     * @param {object} [meta]
     */
    warn(message, meta) {
      writeLog('WARN', module, message, meta)
    },

    /**
     * Error que impide completar una operación. Escribe en stderr.
     * @param {string} message
     * @param {Error|object} [meta]
     */
    error(message, meta) {
      // Si meta es un Error, extrae stack para el log
      const payload = meta instanceof Error
        ? { message: meta.message, stack: meta.stack }
        : meta
      writeLog('ERROR', module, message, payload)
    },

    /**
     * Información detallada útil en desarrollo.
     * Solo se emite si DEBUG=1 o NODE_ENV !== 'production'.
     * @param {string} message
     * @param {object} [meta]
     */
    debug(message, meta) {
      if (process.env.DEBUG === '1' || process.env.NODE_ENV !== 'production') {
        writeLog('DEBUG', module, message, meta)
      }
    },
  }
}

// Logger global para el módulo raíz (app.js)
export const rootLogger = createLogger('App')
