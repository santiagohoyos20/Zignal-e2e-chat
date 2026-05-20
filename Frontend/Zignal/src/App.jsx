import { useState, useEffect } from "react";
import LoginScreen    from "./components/LoginScreen";
import Sidebar        from "./components/Sidebar";
import ChatPanel      from "./components/ChatPanel";
import DiagnosticPanel from "./components/DiagnosticPanel";
import { users, contacts, mockMessages, mockRatchetState } from "./data/mockData";

export default function App() {
  const [activeUser,    setActiveUser]    = useState(null);
  const [activeContact, setActiveContact] = useState(null);
  const [messages,      setMessages]      = useState(mockMessages);
  const [darkMode,      setDarkMode]      = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

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

  function handleSelectContact(contact) {
    setActiveContact(contact);
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
  }

  const chatMessages = activeContact ? (messages[activeContact.id] ?? []) : [];
  const ratchetState = activeUser && activeContact ? (mockRatchetState[activeUser.id] ?? null) : null;

  if (!activeUser) {
    return <LoginScreen onLogin={handleLogin} users={users} />;
  }

  return (
    <div className="app">
      <Sidebar
        contacts={contacts}
        activeUser={activeUser}
        activeContact={activeContact}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((d) => !d)}
        onSelectContact={handleSelectContact}
        onLogout={handleLogout}
      />
      <div style={{ display: "flex", minWidth: 0, overflow: "hidden" }}>
        <ChatPanel
          activeUser={activeUser}
          contact={activeContact}
          messages={chatMessages}
          sessionEstablished={ratchetState?.sessionEstablished ?? false}
          onSendMessage={handleSendMessage}
        />
        <DiagnosticPanel
          ratchetState={ratchetState}
          activeUser={activeUser}
          contact={activeContact}
        />
      </div>
    </div>
  );
}
