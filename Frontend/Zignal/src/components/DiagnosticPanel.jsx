import { FlaskConical, ChevronRight } from "lucide-react";

const iconBtn =
  "w-[34px] h-[34px] rounded-[10px] border border-transparent bg-transparent text-muted cursor-pointer inline-flex items-center justify-center transition-[background-color,color] duration-[120ms] hover:bg-surface-2 hover:text-app-text";

function DiagRow({ label, value }) {
  return (
    <div className="py-1.5 border-b border-divider last:border-b-0">
      <div className="text-[10.5px] text-muted mb-0.5">{label}</div>
      <div className="font-mono text-[10.5px] text-verified break-all">{value ?? "—"}</div>
    </div>
  );
}

export default function DiagnosticPanel({ ratchetState, activeUser, contact, mobileOpen, onClose }) {
  return (
    <aside className={`diag-panel bg-sidebar flex flex-col${mobileOpen ? " open" : ""}`}>

      <div className="px-3.5 pt-3.5 pb-3 border-b border-divider flex items-center gap-2">
        <FlaskConical size={14} className="text-muted shrink-0" />
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
          Diagnóstico
        </span>
        <button
          className={`${iconBtn} ml-auto hidden max-lg:inline-flex`}
          onClick={onClose}
          title="Cerrar"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-4">
        <div className="diag-disclaimer rounded-lg px-2.5 py-2 text-[11px] leading-relaxed">
          Solo para propósitos didácticos. En producción este estado nunca es visible.
        </div>

        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-faint mb-1.5">
            Sesión
          </div>
          <DiagRow label="Usuario activo" value={activeUser?.name} />
          <DiagRow label="Interlocutor"   value={contact?.name} />
          <DiagRow
            label="Estado X3DH"
            value={ratchetState?.sessionEstablished ? "Establecido ✓" : "Pendiente…"}
          />
        </div>

        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-faint mb-1.5">
            Double Ratchet
          </div>
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
