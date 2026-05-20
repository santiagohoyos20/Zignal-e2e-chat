# Zignal — Chat E2E Encriptado

Aplicación de mensajería con encriptación de extremo a extremo (E2E) que implementa los protocolos **X3DH** y **Double Ratchet** (los mismos que usa Signal). Desarrollada como proyecto final del curso de Criptografía.

---

## ¿Qué hace la app?

Zignal simula una conversación encriptada entre dos usuarios (**Alice** y **Bob**). Al abrir la app, el usuario elige con cuál identidad conectarse. Los mensajes se enrutan en tiempo real a través de WebSockets, y un panel de diagnóstico expone el estado criptográfico interno (claves DH, cadenas ratchet, contadores de mensajes) con fines educativos.

### Pantallas principales

| Pantalla | Descripción |
|---|---|
| **Login** | Selección de identidad (Alice / Bob) con visualización de la llave pública de identidad |
| **Sidebar** | Lista de contactos con búsqueda, indicadores de no leídos, fijados y silenciados |
| **Chat** | Composición y recepción de mensajes, indicador E2E, verificación del número de seguridad |
| **Diagnóstico** | Panel educativo con el estado de la sesión X3DH y las claves del Double Ratchet |

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 19 + Vite 8 + Tailwind CSS 4 |
| Backend | Node.js + Express 5 + WebSockets (`ws`) |
| Íconos | lucide-react |


## Cómo correr el proyecto

### Requisitos

- Node.js 18 o superior
- npm

### 1. Instalar dependencias

```bash
# Backend
cd Backend
npm install

# Frontend
cd ../Frontend/Zignal
npm install
```

### 2. Levantar los servidores

Abrir **dos terminales**:

```bash
# Terminal 1 — Backend (puerto 3001)
cd Backend
npm run dev

# Terminal 2 — Frontend (puerto 5173)
cd Frontend/Zignal
npm run dev
```

Luego abrir [http://localhost:5173](http://localhost:5173) en el navegador.

> Para simular una conversación real, abrir la app en **dos pestañas o ventanas**: una con Alice y otra con Bob.


## Arquitectura de comunicación

El backend actúa como **servidor de señalización**: no almacena mensajes, solo los enruta entre clientes conectados por WebSocket.

```
Alice (browser) ──WS──► Backend :3001 ──WS──► Bob (browser)
```
