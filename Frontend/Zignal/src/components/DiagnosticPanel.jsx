import { FlaskConical, ChevronRight } from "lucide-react";

function DiagRow({ label, value }) {
  return (
    <div className="diag-row">
      <div className="diag-label">{label}</div>
      <div className="diag-value">{value ?? "—"}</div>
    </div>
  );
}

export default function DiagnosticPanel({ ratchetState, activeUser, contact, mobileOpen, onClose }) {
  return (
    <aside className={`diag-panel${mobileOpen ? " mobile-open" : ""}`}>
      <div className="diag-head">
        <FlaskConical size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <span className="diag-title">Diagnóstico</span>
        <button className="icon-btn diag-close-btn" style={{ marginLeft: "auto" }} onClick={onClose} title="Cerrar">
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

