import { ShieldCheck } from "lucide-react";

const subtitles = {
  alice: "@alice · identity key A1B2…",
  bob:   "@bob · identity key F0E1…",
};

export default function LoginScreen({ onLogin, users }) {
  return (
    <div className="h-screen flex items-center justify-center bg-bg">
      <div className="w-[380px] bg-surface border border-divider rounded-[20px] px-8 pt-9 pb-8 shadow-pop-custom flex flex-col items-center gap-7">

        <div className="flex items-center gap-[10px] font-extrabold text-[22px] tracking-[-0.03em] text-app-text">
          <div className="logo-mark w-[30px] h-[30px] rounded-[9px] bg-app-text text-bg flex items-center justify-center font-extrabold text-[17px] relative shrink-0">
            z
          </div>
          zignal
        </div>

        <p className="text-[13px] text-muted text-center leading-relaxed -mt-3">
          Chat cifrado extremo a extremo.<br />
          ¿Con qué identidad deseas entrar?
        </p>

        <div className="flex flex-col gap-[10px] w-full">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted mb-1">
            Selecciona tu usuario
          </p>
          {users.map((user) => (
            <button
              key={user.id}
              onClick={() => onLogin(user)}
              className="w-full px-[18px] py-[14px] rounded-[13px] border-[1.5px] border-divider bg-surface-2 text-app-text cursor-pointer flex items-center gap-[14px] font-semibold text-[15px] transition-[border-color,background-color,box-shadow] duration-[140ms] text-left hover:border-accent hover:bg-accent-tint hover:shadow-app"
            >
              <div
                className={`av ${user.av} rounded-full flex items-center justify-center text-white font-bold shrink-0 relative`}
                style={{ width: 42, height: 42, fontSize: 17 }}
              >
                {user.avatar}
              </div>
              <div>
                <div>{user.name}</div>
                <div className="text-[11.5px] font-normal text-muted mt-0.5 font-mono">
                  {subtitles[user.id]}
                </div>
              </div>
              <ShieldCheck size={16} className="ml-auto text-verified opacity-70 shrink-0" />
            </button>
          ))}
        </div>

        <p className="text-[11px] text-faint text-center font-mono">
          🔒 &nbsp;Las claves nunca salen de tu dispositivo
        </p>
      </div>
    </div>
  );
}
