import { useState } from "react";
import { Search, Sun, Moon, LogOut, Pin, BellOff } from "lucide-react";

const iconBtn =
  "w-[34px] h-[34px] rounded-[10px] border border-transparent bg-transparent text-muted cursor-pointer inline-flex items-center justify-center transition-[background-color,color] duration-[120ms] hover:bg-surface-2 hover:text-app-text";

export default function Sidebar({ contacts, activeUser, activeContact, darkMode, onToggleDark, onSelectContact, onLogout }) {
  const [search, setSearch] = useState("");

  const peers    = contacts.filter((c) => c.id !== activeUser.id);
  const filtered = peers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className="bg-sidebar border-r border-divider flex flex-col min-h-0">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="px-[18px] pt-[18px] pb-3 flex items-center gap-[10px]">
        <div className="flex items-center gap-[9px] font-extrabold text-[19px] tracking-[-0.02em] text-app-text">
          <div className="logo-mark w-[30px] h-[30px] rounded-[9px] bg-app-text text-bg flex items-center justify-center font-extrabold text-[17px] relative shrink-0">
            z
          </div>
          zignal
        </div>
        <button className={`${iconBtn} ml-auto`} onClick={onToggleDark} title="Alternar tema">
          {darkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────────── */}
      <div className="mx-[14px] mb-[10px] flex items-center gap-2 h-[38px] px-3 bg-surface-2 rounded-[11px] text-muted text-sm">
        <Search size={14} className="shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="buscar o empezar un chat"
          className="flex-1 border-0 bg-transparent outline-none text-app-text placeholder:text-muted text-[14px]"
        />
      </div>

      {/* ── Contact list ───────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto pt-1 px-2 pb-3">
        {filtered.map((contact) => {
          const isActive = activeContact?.id === contact.id;
          return (
            <div
              key={contact.id}
              className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 px-[10px] py-[10px] rounded-xl cursor-pointer relative transition-[background-color] duration-[120ms] hover:bg-surface-2 ${
                isActive ? "row-active bg-surface shadow-app" : ""
              }`}
              onClick={() => onSelectContact(contact)}
            >
              <div
                className={`av ${contact.av}${contact.online && !contact.group ? " av-online" : ""} rounded-full flex items-center justify-center text-white font-bold shrink-0 relative`}
                style={{ width: 42, height: 42, fontSize: 16 }}
              >
                {contact.avatar}
              </div>

              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[15px] tracking-[-0.01em] truncate">
                    {contact.name}
                  </span>
                  <span className="font-mono text-[11px] text-muted shrink-0 tabular-nums">
                    {contact.time ?? "ahora"}
                  </span>
                </div>
                <div className="mt-0.5 text-[13px] text-muted flex items-center gap-[3px] min-w-0">
                  {contact.you && (
                    <span className="text-app-text font-medium shrink-0">tú:&nbsp;</span>
                  )}
                  <span className="truncate min-w-0">{contact.preview}</span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1 shrink-0 text-muted">
                {contact.pinned ? (
                  <Pin size={14} />
                ) : contact.muted ? (
                  <BellOff size={14} />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer ─────────────────────────────────────────── */}
      <div className="p-3 border-t border-divider flex items-center gap-[10px]">
        <div
          className={`av ${activeUser.av} rounded-full flex items-center justify-center text-white font-bold shrink-0 relative`}
          style={{ width: 34, height: 34, fontSize: 13 }}
        >
          {activeUser.avatar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{activeUser.name}</div>
          <div className="text-[11px] text-muted font-mono">@{activeUser.id}</div>
        </div>
        <button className={`${iconBtn} ml-auto`} onClick={onLogout} title="Cerrar sesión">
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  );
}
