import { useState, useEffect, useCallback } from "react";
import LoginScreen    from "./components/LoginScreen";
import Sidebar        from "./components/Sidebar";
import ChatPanel      from "./components/ChatPanel";
import DiagnosticPanel from "./components/DiagnosticPanel";
import { useChat }    from "./hooks/useChat";
import { users, contacts, mockMessages, mockRatchetState } from "./data/mockData";

export default function App() {
  const [activeUser,    setActiveUser]    = useState(null);
  const [activeContact, setActiveContact] = useState(null);
  const [messages,      setMessages]      = useState(mockMessages);
  const [darkMode,      setDarkMode]      = useState(true);
  const [showDiag,      setShowDiag]      = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  const handleIncoming = useCallback((msg) => {
    const newMsg = {
      id: Date.now(),
      sender: msg.from,
      text: msg.text,
      timestamp: new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => ({
      ...prev,
      [msg.from]: [...(prev[msg.from] ?? []), newMsg],
    }));
  }, []);

  const { send } = useChat(activeUser?.id, handleIncoming);

  function handleLogin(user) {
    setActiveUser(user);
    const peerUser    = users.find((u) => u.id !== user.id) ?? null;
    const peerContact = contacts.find((c) => c.id === peerUser?.id) ?? peerUser ?? null;
    setActiveContact(peerContact);
  }

  function handleLogout() {
    setActiveUser(null);
    setActiveContact(null);
  }

  function handleSendMessage(text) {
    if (!activeContact) return;
    const newMsg = {
      id: Date.now(),
      sender: activeUser.id,
      text,
      timestamp: new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => ({
      ...prev,
      [activeContact.id]: [...(prev[activeContact.id] ?? []), newMsg],
    }));
    send(activeContact.id, text);
  }

  const chatMessages = activeContact ? (messages[activeContact.id] ?? []) : [];
  const ratchetState = activeUser && activeContact ? (mockRatchetState[activeUser.id] ?? null) : null;

  if (!activeUser) {
    return <LoginScreen onLogin={handleLogin} users={users} />;
  }

  return (
    <div
      className={`app grid max-md:grid-cols-1 max-md:relative grid-cols-[320px_1fr] h-screen overflow-hidden bg-bg text-app-text font-sans${activeContact ? " contact-open" : ""}`}
    >
      <Sidebar
        contacts={contacts}
        activeUser={activeUser}
        activeContact={activeContact}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((d) => !d)}
        onSelectContact={setActiveContact}
        onLogout={handleLogout}
      />
      <div className="chat-area flex min-w-0 overflow-hidden relative">
        <ChatPanel
          activeUser={activeUser}
          contact={activeContact}
          messages={chatMessages}
          sessionEstablished={ratchetState?.sessionEstablished ?? false}
          onSendMessage={handleSendMessage}
          onBack={() => setActiveContact(null)}
          onToggleDiag={() => setShowDiag((v) => !v)}
        />
        <DiagnosticPanel
          ratchetState={ratchetState}
          activeUser={activeUser}
          contact={activeContact}
          mobileOpen={showDiag}
          onClose={() => setShowDiag(false)}
        />
      </div>
    </div>
  );
}
