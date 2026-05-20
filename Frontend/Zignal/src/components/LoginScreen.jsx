import { ShieldCheck } from "lucide-react";

const subtitles = {
  alice: "@alice · identity key A1B2…",
  bob:   "@bob · identity key F0E1…",
};

export default function LoginScreen({ onLogin, users }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-mark">z</div>
          zignal
        </div>

        <p className="login-tagline">
          Chat cifrado extremo a extremo.<br />
          ¿Con qué identidad deseas entrar?
        </p>

        <div className="login-options" style={{ width: "100%" }}>
          <p className="login-label">Selecciona tu usuario</p>
          {users.map((user) => (
            <button key={user.id} className="login-btn" onClick={() => onLogin(user)}>
              <div className={`av ${user.av}`} style={{ width: 42, height: 42, fontSize: 17 }}>
                {user.avatar}
              </div>
              <div>
                <div>{user.name}</div>
                <div className="login-btn-sub">{subtitles[user.id]}</div>
              </div>
              <ShieldCheck
                size={16}
                style={{ marginLeft: "auto", color: "var(--verified)", opacity: 0.7 }}
              />
            </button>
          ))}
        </div>

        <p className="login-footer">
          🔒 &nbsp;Las claves nunca salen de tu dispositivo
        </p>
      </div>
    </div>
  );
}
