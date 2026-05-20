import { useState, useRef, useEffect } from "react";
import { Phone, Video, Search, Info, Lock, Paperclip, Smile, Send, ArrowLeft } from "lucide-react";

const iconBtn =
  "w-[34px] h-[34px] rounded-[10px] border border-transparent bg-transparent text-muted cursor-pointer inline-flex items-center justify-center transition-[background-color,color] duration-[120ms] hover:bg-surface-2 hover:text-app-text";

function groupMessages(messages) {
  return messages.map((msg, i, arr) => {
    const prev = arr[i - 1];
    const next = arr[i + 1];
    const samePrev = prev?.sender === msg.sender;
    const sameNext = next?.sender === msg.sender;
    let position = "solo";
    if (!samePrev && sameNext)       position = "first";
    else if (samePrev && sameNext)   position = "middle";
    else if (samePrev && !sameNext)  position = "last";
    return { ...msg, position };
  });
}

function bubbleRadius(position, isMe) {
  if (isMe) {
    return position === "middle" || position === "last"
      ? "rounded-[16px_4px_4px_16px]"
      : "rounded-[16px_16px_4px_16px]";
  }
  return position === "middle" || position === "last"
    ? "rounded-[4px_16px_16px_4px]"
    : "rounded-[16px_16px_16px_4px]";
}

function DoubleCheck() {
  return (
    <svg
      width="14" height="10" viewBox="0 0 14 10" fill="none"
      stroke="var(--verified)" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      className="ml-0.5 shrink-0"
    >
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
    e.target.style.height = Math.min(e.target.scrollHeight, 130) + "px";
  }

  if (!contact) {
    return (
      <div className="flex-1 flex items-center justify-center bg-chat">
        <div className="text-center text-faint">
          <Lock size={36} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Selecciona un contacto para comenzar</p>
        </div>
      </div>
    );
  }

  const grouped = groupMessages(messages);
  const isFirst = (pos) => pos === "first" || pos === "solo";
  const isLast  = (pos) => pos === "last"  || pos === "solo";

  return (
    <div className="flex-1 grid grid-rows-[auto_1fr_auto] bg-chat min-h-0">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="px-[22px] py-[14px] flex items-center gap-[14px] border-b border-divider bg-chat">
        <button className={`${iconBtn} hidden max-md:inline-flex`} onClick={onBack} title="Volver">
          <ArrowLeft size={18} />
        </button>

        <div
          className={`av ${contact.av}${contact.online ? " av-online-chat" : ""} rounded-full flex items-center justify-center text-white font-bold shrink-0 relative`}
          style={{ width: 40, height: 40, fontSize: 15 }}
        >
          {contact.avatar}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-bold text-base tracking-[-0.01em] flex items-center gap-2">
            {contact.name}
            {sessionEstablished ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-verified-tint text-verified text-[11px] font-semibold whitespace-nowrap">
                <Lock size={11} /> verificado
              </span>
            ) : (
              <span className="pending-pill inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap">
                sesión pendiente
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {contact.online ? "en línea" : "sin conexión"}
          </div>
        </div>

        <div className="flex gap-1">
          <button className={`${iconBtn} max-md:hidden`} title="Llamar"><Phone size={18} /></button>
          <button className={`${iconBtn} max-md:hidden`} title="Videollamada"><Video size={18} /></button>
          <button className={`${iconBtn} max-md:hidden`} title="Buscar"><Search size={18} /></button>
          <button className={iconBtn} title="Info" onClick={onToggleDiag}><Info size={18} /></button>
        </div>
      </div>

      {/* ── Messages ────────────────────────────────────────── */}
      <div className="overflow-y-auto px-[22px] pt-5 pb-3 flex flex-col gap-[3px]">
        <div className="self-center font-mono text-[11px] text-muted tracking-[0.06em] uppercase my-3">
          hoy · {grouped[0]?.timestamp ?? "—"}
        </div>

        {sessionEstablished && (
          <div className="self-center mb-4 bg-verified-tint text-verified px-[18px] py-[10px] rounded-[14px] text-xs font-semibold flex flex-col items-center gap-[5px] max-w-[360px] text-center leading-relaxed">
            <div className="flex items-center gap-1.5">
              <Lock size={12} />
              Mensajes y llamadas cifrados extremo a extremo.
            </div>
            <a className="text-[11px] font-medium opacity-80 underline cursor-pointer">
              verifica el safety number →
            </a>
          </div>
        )}

        {grouped.length === 0 && (
          <div className="self-center text-faint text-[13px] mt-6">
            No hay mensajes aún.
          </div>
        )}

        {grouped.map((msg) => {
          const isMe  = msg.sender === activeUser.id;
          const first = isFirst(msg.position);
          const last  = isLast(msg.position);

          return (
            <div
              key={msg.id}
              className={`flex gap-2 max-w-[70%] items-end ${isMe ? "self-end flex-row-reverse" : "self-start"}`}
              style={{ marginTop: first ? 6 : 0 }}
            >
              <div
                className={`av ${isMe ? activeUser.av : contact.av} rounded-full flex items-center justify-center text-white font-bold shrink-0 ${first ? "visible" : "invisible"}`}
                style={{ width: 30, height: 30, fontSize: 11 }}
              >
                {isMe ? activeUser.avatar : contact.avatar}
              </div>

              <div>
                <div
                  className={`px-[13px] py-[9px] text-[14.5px] leading-[1.42] shadow-app break-words ${bubbleRadius(msg.position, isMe)} ${
                    isMe
                      ? "bg-own-bg text-own-text border border-own-bg"
                      : "bg-their-bg text-app-text border border-their-border"
                  }`}
                >
                  {msg.text}
                </div>

                {last && (
                  <div
                    className={`flex items-center gap-1 mt-1 font-mono text-[10px] tabular-nums ${isMe ? "justify-end" : "justify-start text-muted"}`}
                    style={isMe ? { color: "color-mix(in srgb, var(--own-text) 55%, transparent)" } : {}}
                  >
                    <span>{msg.timestamp}</span>
                    {isMe && <DoubleCheck />}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* ── Composer ────────────────────────────────────────── */}
      <div className="px-[22px] pt-[10px] pb-[18px] border-t border-divider bg-chat">
        <div className="flex items-end gap-2 bg-surface border border-divider rounded-[14px] pl-[14px] pr-[6px] py-[6px] shadow-app transition-[border-color] duration-[120ms] focus-within:border-accent">
          <button className="w-8 h-8 rounded-[10px] border border-transparent bg-transparent text-muted cursor-pointer inline-flex items-center justify-center shrink-0 hover:bg-surface-2 hover:text-app-text" title="Adjuntar">
            <Paperclip size={17} />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="escribe un mensaje cifrado…"
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            className="flex-1 border-0 outline-none resize-none bg-transparent text-app-text text-[14.5px] py-2 min-h-[22px] leading-[1.4] placeholder:text-muted"
            style={{ maxHeight: 130 }}
          />

          <button className="w-8 h-8 rounded-[10px] border border-transparent bg-transparent text-muted cursor-pointer inline-flex items-center justify-center shrink-0 hover:bg-surface-2 hover:text-app-text" title="Emoji">
            <Smile size={17} />
          </button>

          <button
            className="w-9 h-9 rounded-[10px] bg-accent text-white border-0 flex items-center justify-center cursor-pointer transition-[filter,transform] duration-[120ms] shrink-0 hover:brightness-110 hover:-translate-y-px disabled:cursor-default"
            onClick={handleSend}
            disabled={input.trim() === ""}
            style={{ opacity: input.trim() === "" ? 0.4 : 1 }}
          >
            <Send size={15} />
          </button>
        </div>

        <div className="mt-2 text-[11px] text-faint flex items-center gap-1.5 font-mono">
          <Lock size={10} /> cifrado e2e activo · ↵ enviar · ⇧↵ nueva línea
        </div>
      </div>
    </div>
  );
}
