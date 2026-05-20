export const users = [
  { id: "alice", name: "Alice", avatar: "A", av: "av-alice" },
  { id: "bob",   name: "Bob",   avatar: "B", av: "av-bob" },
];

export const contacts = [
  {
    id: "alice", name: "Alice", avatar: "A", av: "av-alice",
    online: true,  preview: "Great, no one can read this but us.",
    time: "10:04", unread: 0, pinned: true, real: true,
  },
  {
    id: "bob", name: "Bob", avatar: "B", av: "av-bob",
    online: false, preview: "The Double Ratchet is ready.",
    time: "10:03", unread: 2, real: true,
  },
  {
    id: "s", name: "Sara García", avatar: "S", av: "av-1",
    online: true,  preview: "vale, lo miro y te digo",
    time: "10:42", unread: 0, pinned: true,
  },
  {
    id: "g", name: "Eq. Cripto", avatar: "C", av: "av-2",
    online: false, preview: "Pablo: subí la presentación",
    time: "10:38", unread: 3, group: true,
  },
  {
    id: "p", name: "Prof. Martín", avatar: "M", av: "av-3",
    online: false, preview: "recordad la entrega del…",
    time: "09:15", unread: 0,
  },
  {
    id: "m", name: "Mamá", avatar: "M", av: "av-6",
    online: true,  preview: "¿comes en casa?",
    time: "ayer",  unread: 1,
  },
  {
    id: "d", name: "Diego R.", avatar: "D", av: "av-4",
    online: false, preview: "mensaje cifrado",
    time: "ayer",  unread: 0, muted: true,
  },
  {
    id: "l", name: "Lucía", avatar: "L", av: "av-5",
    online: false, preview: "jajaj vale",
    time: "mar",   unread: 0, you: true,
  },
];

export const mockMessages = {
  alice: [
    { id: 1, sender: "bob",   text: "Hey Alice! I just initialized our X3DH session.", timestamp: "10:01" },
    { id: 2, sender: "alice", text: "Perfect. I received your prekey bundle.", timestamp: "10:02" },
    { id: 3, sender: "bob",   text: "The Double Ratchet is ready. This channel is now end-to-end encrypted.", timestamp: "10:03" },
    { id: 4, sender: "alice", text: "Great, no one can read this but us.", timestamp: "10:04" },
  ],
  bob: [
    { id: 1, sender: "alice", text: "Hey Bob! I just initialized our X3DH session.", timestamp: "10:01" },
    { id: 2, sender: "bob",   text: "Perfect. I received your prekey bundle.", timestamp: "10:02" },
    { id: 3, sender: "alice", text: "The Double Ratchet is ready. This channel is now end-to-end encrypted.", timestamp: "10:03" },
    { id: 4, sender: "bob",   text: "Great, no one can read this but us.", timestamp: "10:04" },
  ],
};

export const mockRatchetState = {
  alice: {
    dhRatchetKey: "a1b2c3d4e5f6...7890",
    sendingChainKey: "sk_9f8e7d6c5b4a...3210",
    receivingChainKey: "rk_1a2b3c4d5e6f...7890",
    messageNumber: 4,
    previousChainLength: 0,
    rootKey: "rk_deadbeef1234...5678",
    sessionEstablished: true,
  },
  bob: {
    dhRatchetKey: "f0e1d2c3b4a5...6789",
    sendingChainKey: "sk_0123456789ab...cdef",
    receivingChainKey: "rk_fedcba987654...3210",
    messageNumber: 4,
    previousChainLength: 0,
    rootKey: "rk_deadbeef1234...5678",
    sessionEstablished: true,
  },
};
