import { useState, useRef, useEffect } from "react";
import { Phone, Video, Search, Info, Lock, Paperclip, Smile, Mic, Send, ArrowLeft } from "lucide-react";

function groupMessages(messages) {
  return messages.map((msg, i, arr) => {
    const prev = arr[i - 1];
    const next = arr[i + 1];
    const samePrev = prev?.sender === msg.sender;
    const sameNext = next?.sender === msg.sender;
    let position = "solo";
    if (!samePrev && sameNext)  position = "first";
    else if (samePrev && sameNext)  position = "middle";
    else if (samePrev && !sameNext) position = "last";
    return { ...msg, position };
  });
}

function DoubleCheck() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none"
         stroke="var(--verified)" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round"
         style={{ marginLeft: 2, flexShrink: 0 }}>
      <path d="M1 5l3 3 5-6" />
      <path d="M5 5l3 3 5-6" />
    </svg>
  );
}

export default function ChatPanel({ activeUser, contact, messages, sessionEstablished, onSendMessage, onBack, onToggleDiag }) {
  const [input, setInput] = useState("");
  const bottomRef   = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    onSendMessage(text);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput(e) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
  }

  if (!contact) {
    return (
      <div className="chat" style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "var(--faint)" }}>
          <Lock size={36} style={{ margin: "0 auto 12px", display: "block", opacity: 0.4 }} />
          <p style={{ fontSize: 14 }}>Selecciona un contacto para comenzar</p>
        </div>
      </div>
    );
  }

  const grouped = groupMessages(messages);
  const isFirst  = (pos) => pos === "first" || pos === "solo";
  const isLast   = (pos) => pos === "last"  || pos === "solo";

  return (
    <div className="chat">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="chat-head">
        <button className="icon-btn back-btn" onClick={onBack} title="Volver">
          <ArrowLeft size={18} />
        </button>
        <div
          className={`av ${contact.av}${contact.online ? " online" : ""}`}
          style={{ width: 40, height: 40, fontSize: 15 }}
        >
          {contact.avatar}
        </div>

        <div className="chat-head-meta">
          <div className="chat-head-name">
            {contact.name}
            {sessionEstablished ? (
              <span className="verified-pill"><Lock size={11} /> verificado</span>
            ) : (
              <span className="pending-pill">sesión pendiente</span>
            )}
          </div>
          <div className="chat-head-status">
            {contact.online
              ? "en línea · cifrado e2e"
              : `conversando como ${activeUser.name} · cifrado e2e`}
          </div>
        </div>

        <div className="chat-head-actions">
          <button className="icon-btn" title="Llamar"><Phone size={18} /></button>
          <button className="icon-btn" title="Videollamada"><Video size={18} /></button>
          <button className="icon-btn" title="Buscar"><Search size={18} /></button>
          <button className="icon-btn" title="Info" onClick={onToggleDiag}><Info size={18} /></button>
        </div>
      </div>

      {/* ── Messages ────────────────────────────────────── */}
      <div className="messages">
        <div className="day-sep">
          hoy · {grouped[0]?.timestamp ?? "—"}
        </div>

        {sessionEstablished && (
          <div className="e2ee-card">
            <Lock size={13} />
            Mensajes y llamadas cifrados extremo a extremo.{" "}
            <a style={{ color: "inherit", textDecoration: "underline", cursor: "pointer" }}>
              verifica el safety number →
            </a>
          </div>
        )}

        {grouped.length === 0 && (
          <div style={{ alignSelf: "center", color: "var(--faint)", fontSize: 13, marginTop: 24 }}>
            No hay mensajes aún.
          </div>
        )}

        {grouped.map((msg) => {
          const isMe  = msg.sender === activeUser.id;
          const first = isFirst(msg.position);
          const last  = isLast(msg.position);
          const cls   = [
            "msg",
            isMe ? "me" : "them",
            first && last ? "solo" : first ? "first" : last ? "last" : "middle",
          ].join(" ");

          return (
            <div key={msg.id} className={cls} style={{ marginTop: first ? 6 : 0 }}>
              <div
                className={`msg-av ${isMe ? "av-me" : contact.av}`}
                style={{ width: 30, height: 30, fontSize: 11 }}
              >
                {isMe ? activeUser.avatar : contact.avatar}
              </div>

              <div>
                <div className="bubble">{msg.text}</div>
                {last && (
                  <div
                    className="meta-row"
                    style={{ justifyContent: isMe ? "flex-end" : "flex-start" }}
                  >
                    <span>{msg.timestamp}</span>
                    {isMe && <DoubleCheck />}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        <div className="typing">
          <span /><span /><span />
        </div>

        <div ref={bottomRef} />
      </div>

      {/* ── Composer ────────────────────────────────────── */}
      <div className="composer">
        <div className="composer-row">
          <button className="icon-btn" style={{ width: 32, height: 32, flexShrink: 0 }} title="Adjuntar">
            <Paperclip size={17} />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="escribe un mensaje cifrado…"
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
          />

          <button className="icon-btn" style={{ width: 32, height: 32, flexShrink: 0 }} title="Emoji">
            <Smile size={17} />
          </button>

          {input.trim() === "" ? (
            <button className="icon-btn" style={{ width: 36, height: 36, flexShrink: 0 }} title="Audio">
              <Mic size={17} />
            </button>
          ) : (
            <button className="send" onClick={handleSend}>
              <Send size={15} />
            </button>
          )}
        </div>

        <div className="composer-hint">
          <Lock size={10} /> cifrado e2e activo · ↵ enviar · ⇧↵ nueva línea
        </div>
      </div>
    </div>
  );
}
