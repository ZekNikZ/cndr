# Protocol Documentation

## Overview

This document defines the communication protocol between clients, relay server, and host for a multiplayer game system.

### Roles
- **Host**: Controls the game, manages state, requires host key to join
- **Player**: Active participant, requires room password (if set), limited by max player count
- **Audience**: Passive observer, no password required, limited by max audience count

### Room Configuration
- Room code (required)
- Room password (optional, required for player role only)
- Host key (random, required for host role)
- Maximum player count (optional)
- Maximum audience count (optional)

---

## Message Definitions

### 1. Handshake Request (Client → Relay)
**Purpose**: Client attempts to join a room

**Parameters**:
- `roomCode` (string, required): Room identifier
- `password` (string, optional): Room password (required for player role if room has password)
- `role` (enum, required): One of `"host"` | `"player"` | `"audience"`
- `hostKey` (string, optional): Required for host role
- `meta` (JSON, optional): Game-specific metadata (commonly used for player name)

**Validation**:
- Player role: Password must match if room has password, room must not be at max player capacity
- Audience role: No password required, room must not be at max audience capacity
- Host role: Host key must match room's host key

---

### 2. Handshake Response (Relay → Client)
**Purpose**: Confirm join success or failure

**Parameters**:
- `status` (enum, required): `"success"` | `"error"`
- `errorMessage` (string, optional): Present if status is error
- `gameState` (JSON, optional): Current global game state (present if status is success)

**Notes**:
- On success, client receives current game state managed by host
- On error, client receives error message explaining rejection reason

---

### 3. Client Join Event (Relay → Host)
**Purpose**: Notify host that a client has joined

**Parameters**:
- `clientId` (string, required): Unique identifier for the client
- `role` (enum, required): `"host"` | `"player"` | `"audience"`
- `meta` (JSON, optional): Metadata provided by client during handshake

---

### 4. Set Game State (Host → Relay → All Clients)
**Purpose**: Update global game state visible to all clients

**Parameters**:
- `gameState` (JSON, required): Complete game state object

**Notes**:
- Broadcast to all players and audience members
- Only host can set game state

---

### 5. Set Player State (Host → Relay → Specific Player)
**Purpose**: Update state for a specific player (private to that player)

**Parameters**:
- `clientId` (string, required): Target player identifier
- `playerState` (JSON, required): Player-specific state object

**Notes**:
- Only sent to the specified player
- Only host can set player state

---

### 6. Send Message to Host (Player → Relay → Host)
**Purpose**: Player sends game action/data to host

**Player → Relay Parameters**:
- `message` (JSON, required): Arbitrary game-specific message

**Relay → Host Parameters**:
- `clientId` (string, required): Identifier of sending player (added by relay)
- `message` (JSON, required): Original message from player

**Notes**:
- Relay automatically attaches clientId for host processing
- Message format is game-specific

---

### 7. Client Leave (Client → Relay → Host)
**Purpose**: Gracefully disconnect from room

**Parameters**: None

**Notes**:
- Frees up player/audience slot for new clients
- Relay notifies host of disconnection

---

### 8. Poll Start (Host → Relay → All Audience)
**Purpose**: Configure and start a poll for audience participation

**Parameters**:
- `pollId` (string, required): Unique identifier for the poll
- `type` (enum, required): `"multiple_choice"` | `"single_choice"` | `"free_text"`
- `question` (string, required): Poll question text
- `options` (array of strings, required for `"multiple_choice"` and `"single_choice"` types): List of possible answers

**Notes**:
- Only host can start polls
- Audience can respond immediately after receiving this message
- Broadcast to all audience members

---

### 9. Poll Response (Audience → Relay → Host)
**Purpose**: Submit audience member's response to an active poll

**Audience → Relay Parameters**:
- `pollId` (string, required): Identifier of the poll being responded to
- `response` (string or array of strings, required): Answer(s) selected or entered by audience member

**Relay → Host Parameters**:
- `clientId` (string, required): Identifier of responding audience member (added by relay)
- `pollId` (string, required): Identifier of the poll
- `response` (string or array of strings, required): Original response from audience member

**Notes**:
- Relay automatically attaches clientId for host tracking
- Response format depends on poll type (single string for single_choice/free_text, array for multiple_choice)
- Responses received after poll ends should be rejected by relay

---

### 10. Poll End (Host → Relay → All Audience)
**Purpose**: Close poll voting and stop accepting new responses

**Parameters**:
- `pollId` (string, required): Unique identifier for the poll to close

**Notes**:
- Broadcast to all audience members
- Only host can end polls
- Relay stops accepting responses after this message

---

### 11. Poll Results Request (Host → Relay)
**Purpose**: Request aggregated poll results from relay

**Parameters**:
- `pollId` (string, required): Unique identifier for the poll

**Notes**:
- Only host can request poll results
- Can be called while poll is active or after it ends

---

### 12. Poll Results Response (Relay → Host)
**Purpose**: Return aggregated poll results to host

**Parameters**:
- `pollId` (string, required): Unique identifier for the poll
- `results` (JSON, required): Aggregated poll data (format depends on poll type)
- `totalResponses` (number, required): Total number of responses received

**Notes**:
- Sent in response to Poll Results Request
- Results format is poll-type specific (e.g., vote counts per option for multiple choice)

---

### 13. Close Room (Host → Relay → All Clients)
**Purpose**: Permanently close the room and disconnect all clients

**Parameters**:
- `reason` (string, optional): Optional message explaining why the room is closing

**Notes**:
- Only host can close the room
- Broadcast to all connected clients (host, players, and audience)
- Relay immediately disconnects all clients after sending this message
- Room is permanently destroyed and cannot be rejoined
- All room state, polls, and data are cleared