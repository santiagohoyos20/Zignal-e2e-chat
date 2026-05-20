import { useState } from "react";
import { Search, Sun, Moon, LogOut, Pin, BellOff } from "lucide-react";

export default function Sidebar({ contacts, activeUser, activeContact, darkMode, onToggleDark, onSelectContact, onLogout }) {
  const [search, setSearch] = useState("");

  const peers = contacts.filter((c) => c.id !== activeUser.id);

  const filtered = peers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className="sidebar">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="side-head">
        <div className="logo">
          <div className="logo-mark">z</div>
          zignal
        </div>
        <button className="icon-btn" onClick={onToggleDark} title="Alternar tema" style={{ marginLeft: "auto" }}>
          {darkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────── */}
      <div className="search">
        <Search size={14} style={{ flexShrink: 0 }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="buscar o empezar un chat"
        />
        <kbd className="search-kbd">⌘K</kbd>
      </div>

      {/* ── Contact list ───────────────────────────────── */}
      <div className="list">
        {filtered.map((contact) => {
          const isActive = activeContact?.id === contact.id;
          return (
            <div
              key={contact.id}
              className={`row${isActive ? " active" : ""}`}
              onClick={() => onSelectContact(contact)}
            >
              <div
                className={`av ${contact.av}${contact.online && !contact.group ? " online" : ""}`}
                style={{ width: 42, height: 42, fontSize: 16 }}
              >
                {contact.avatar}
              </div>

              <div className="row-meta">
                <div className="row-top">
                  <span className="row-name">{contact.name}</span>
                  <span className="row-time">{contact.time ?? "ahora"}</span>
                </div>
                <div className="row-preview">
                  {contact.you && <span className="you">tú:&nbsp;</span>}
                  <span>{contact.preview}</span>
                </div>
              </div>

              <div className="row-end">
                {contact.unread > 0
                  ? <div className="badge">{contact.unread}</div>
                  : contact.pinned
                    ? <span className="pin"><Pin size={14} /></span>
                    : contact.muted
                      ? <span className="pin"><BellOff size={14} /></span>
                      : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer ─────────────────────────────────────── */}
      <div className="side-foot">
        <div className="av av-me" style={{ width: 34, height: 34, fontSize: 13 }}>
          {activeUser.avatar}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="me-name">{activeUser.name}</div>
          <div className="me-handle">@{activeUser.id}</div>
        </div>
        <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onLogout} title="Cerrar sesión">
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  );
}
