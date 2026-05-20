import { FlaskConical, ChevronRight, ChevronLeft } from "lucide-react";

function DiagRow({ label, value }) {
  return (
    <div className="diag-row">
      <div className="diag-label">{label}</div>
      <div className="diag-value">{value ?? "—"}</div>
    </div>
  );
}

export default function DiagnosticPanel({ ratchetState, activeUser, contact }) {
  // collapsed state managed via CSS class swap — using React state
  const [collapsed, setCollapsed] = React.useState(false);

  if (collapsed) {
    return (
      <aside
        className="diag-panel collapsed"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 14 }}
      >
        <button
          className="icon-btn"
          onClick={() => setCollapsed(false)}
          title="Expandir diagnóstico"
        >
          <ChevronLeft size={15} />
        </button>
        <span
          style={{
            marginTop: 20,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--faint)",
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
          }}
        >
          Diagnóstico
        </span>
      </aside>
    );
  }

  return (
    <aside className="diag-panel">
      <div className="diag-head">
        <FlaskConical size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <span className="diag-title">Diagnóstico</span>
        <button
          className="icon-btn"
          style={{ marginLeft: "auto" }}
          onClick={() => setCollapsed(true)}
          title="Colapsar"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="diag-body">
        <div className="diag-disclaimer">
          Solo para propósitos didácticos. En producción este estado nunca es visible.
        </div>

        <div>
          <div className="diag-section-title">Sesión</div>
          <DiagRow label="Usuario activo" value={activeUser?.name} />
          <DiagRow label="Interlocutor"   value={contact?.name} />
          <DiagRow
            label="Estado X3DH"
            value={ratchetState?.sessionEstablished ? "Establecido ✓" : "Pendiente…"}
          />
        </div>

        <div>
          <div className="diag-section-title">Double Ratchet</div>
          <DiagRow label="DH Ratchet Key"       value={ratchetState?.dhRatchetKey} />
          <DiagRow label="Root Key"              value={ratchetState?.rootKey} />
          <DiagRow label="Sending Chain Key"     value={ratchetState?.sendingChainKey} />
          <DiagRow label="Receiving Chain Key"   value={ratchetState?.receivingChainKey} />
          <DiagRow label="Nº de mensaje"         value={ratchetState?.messageNumber?.toString()} />
          <DiagRow label="Longitud cadena prev." value={ratchetState?.previousChainLength?.toString()} />
        </div>
      </div>
    </aside>
  );
}

// Make React available as bare reference inside the component (Vite bundles it)
import React from "react";
