# cndr Architecture Documentation

## Table of Contents
1. [Overview](#1-overview)
2. [System Components](#2-system-components)
3. [Roles and Permissions](#3-roles-and-permissions)
4. [Distributed System Architecture](#4-distributed-system-architecture)
5. [Client Connection Lifecycle](#5-client-connection-lifecycle)
6. [Message Flow Architecture](#6-message-flow-architecture)
7. [Room Management](#7-room-management)
8. [State Management](#8-state-management)
9. [Poll System Architecture](#9-poll-system-architecture)
10. [Redis Data Schema](#10-redis-data-schema)
11. [Protocol Implementation](#11-protocol-implementation)
12. [Security Considerations](#12-security-considerations)
13. [Scalability Considerations](#13-scalability-considerations)
14. [Monitoring and Observability](#14-monitoring-and-observability)
15. [Quick Start for Developers](#15-quick-start-for-developers)
16. [Glossary](#16-glossary)

---

## 1. Overview

### System Purpose
cndr is a distributed WebSocket relay server designed for multiplayer game applications. It facilitates real-time communication between a game host and multiple clients (players and audience members) through a fault-tolerant, scalable architecture.

### Key Capabilities
- **Real-time Communication**: WebSocket-based bidirectional messaging
- **Distributed Coordination**: Multiple server instances coordinate via Redis
- **Role-based Access**: Host, player, and audience roles with distinct permissions
- **Interactive Polling**: Host can conduct polls with audience participation
- **State Management**: Separate global game state and per-player private state
- **Fault Tolerance**: Automatic failover and client reconnection handling

### High-Level Architecture

```
┌─────────────┐     WebSocket      ┌──────────────┐
│   Clients   │ ◄─────────────────► │  cndr Node   │
│ (Host/      │                     │  (Instance)  │
│  Players/   │                     └──────┬───────┘
│  Audience)  │                            │
└─────────────┘                            │ Redis
                                           │ Protocol
┌─────────────┐     WebSocket      ┌──────▼───────┐     ┌─────────────┐
│   Clients   │ ◄─────────────────► │  cndr Node   │ ◄───┤    Redis    │
│             │                     │  (Instance)  │     │  (Single    │
└─────────────┘                     └──────┬───────┘     │  Instance)  │
                                           │             └─────────────┘
┌─────────────┐     WebSocket             │
│   Clients   │ ◄──────────────────────────┘
│             │
└─────────────┘
```

### Core Concepts

- **Room**: An isolated session identified by a unique room code, with optional password protection
- **Host**: The game controller who manages state and orchestrates gameplay
- **Player**: Active participants with persistent seats that survive reconnections
- **Audience**: Observers who can participate in polls but have no persistent state
- **Host Node**: The cndr instance that has the room's host connected (authoritative for state)
- **Client Node**: Other cndr instances that poll Redis and relay updates to their clients
- **Primary Node**: The earliest-connected node responsible for maintenance tasks

---

## 2. System Components

### WebSocket Server (cndr node)

Each cndr server instance provides:

- **Connection Management**: Handles WebSocket connections via Socket.io
- **Message Routing**: Routes messages between clients and through Redis queues
- **Protocol Validation**: Enforces message format and permission requirements
- **Room Rules**: Validates capacity limits, password requirements, and role permissions
- **Node Identity**: Generates unique identifier on startup for coordination

**Technology Stack**:
- Socket.io for WebSocket transport
- Pino for structured logging
- ioredis for Redis connectivity

### Redis Store

**Architecture**: Single Redis instance (no clustering or replication)

**Purpose**:
- State persistence for distributed coordination between cndr nodes
- Ephemeral data model: acceptable data loss on Redis failure
- Clients handle reconnection; no complex recovery mechanisms

**Trade-off Rationale**:
- Simplicity over high availability
- Most data is transient (room sessions are temporary)
- Downtime results in room loss, but clients can create new rooms
- Single instance sufficient for moderate scale (vertical scaling available)

### Room Management Service

**External Responsibility**: Room creation handled outside cndr nodes

**Typical Flow**:
1. External API/admin interface creates room
2. Room config written to Redis (code, password, host key, capacity limits)
3. Clients can now join via cndr nodes

**Why External?**:
- Decouples room lifecycle management from relay infrastructure
- Enables custom room creation logic, validation, rate limiting
- Allows room reservation, scheduling, or payment integration

---

## 3. Roles and Permissions

### Host

**Capabilities**:
- Full control over game state (global and per-player)
- Start, end, and retrieve results from polls
- Close the room permanently
- Receive all player and audience messages

**Authentication**:
- Must provide correct host key (generated during room creation)
- Only one host per room

**Connection Behavior**:
- No seat persistence: Host reconnecting is treated as new connection
- Host key required on every connection

### Player

**Capabilities**:
- Send messages to host
- Receive global game state updates
- Receive private player state updates
- Cannot participate in polls

**Authentication**:
- Must provide room password (if room has password)
- Assigned unique client ID on first join

**Connection Behavior**:
- Seat persistence: Players keep their seat until explicit disconnect
- Can reconnect to same seat using client ID (even to different node)
- Subject to room's max player capacity limit

### Audience

**Capabilities**:
- Observe global game state
- Participate in polls (submit responses)
- Send messages to host

**Authentication**:
- No password required
- No persistent identity

**Connection Behavior**:
- No seat persistence: Each connection is independent
- Subject to room's max audience capacity limit

### Permission Matrix

| Action | Host | Player | Audience |
|--------|------|--------|----------|
| Set game state | ✓ | ✗ | ✗ |
| Set player state | ✓ | ✗ | ✗ |
| Send message to host | ✗ | ✓ | ✓ |
| Start/end poll | ✓ | ✗ | ✗ |
| Respond to poll | ✗ | ✗ | ✓ |
| Request poll results | ✓ | ✗ | ✗ |
| Close room | ✓ | ✗ | ✗ |

---

## 4. Distributed System Architecture

### Node Coordination

**Node Registration**:
1. On startup, each cndr instance generates unique node ID (e.g., UUID)
2. Node registers itself in Redis (`nodes:registry` sorted set)
3. Node begins sending heartbeat every 60 seconds (configurable)

**Heartbeat Protocol**:
- Interval: 60 seconds (default, configurable)
- Storage: `nodes:heartbeat` hash maps node ID → timestamp
- Timeout: Node considered inactive after 3 minutes without heartbeat

**Primary Node Election**:
- **Definition**: The earliest-connected node with an active heartbeat
- **Computation**: Sort `nodes:registry` by score (registration timestamp), find first node with recent heartbeat (< 3 minutes old)
- **No explicit lock**: Each node independently computes if it's primary
- **Responsibilities**: See Primary Node Responsibilities section below

### Host Node vs Client Node

**Host Node** (for a specific room):
- The cndr instance that has the room's host client connected
- Authoritative for all state changes in that room
- Writes to Redis:
  - Game state updates
  - Player state updates
  - Poll configurations and results
  - Room state (host node ID, last activity)
- Reads from Redis:
  - Client messages queue (`room:queue:tohost:<roomCode>`)
- Broadcasts updates to its connected clients directly via WebSocket

**Client Node** (for a specific room):
- Any cndr instance without the host connected, but with players/audience
- Subscribes to Redis pub-sub channel `room:updates:<roomCode>` for instant state updates:
  - Game state updates
  - Player state updates (for its connected players)
  - Poll events
- Reads initial state from Redis when first client connects
- Forwards client messages to host by writing to Redis queue
- Relays updates from pub-sub to its connected clients via WebSocket

**Dynamic Role Switching**:
- A single cndr instance can be:
  - Host node for room A
  - Client node for room B
  - Not involved in room C
- If host disconnects: Node switches from host mode to client mode for that room
- If host reconnects to different node: New node becomes host node, old node becomes client node

### Failover Behavior

**Host Disconnection**:
1. Host node detects socket disconnect
2. Host node removes `hostNodeId` from `room:state:<roomCode>`
3. Host node switches to client mode (starts polling Redis)
4. Players/audience remain connected, waiting for host to return

**Host Reconnection**:
1. Host reconnects (possibly to different cndr node)
2. New host node validates host key
3. New host node writes its ID to `room:state:<roomCode>:hostNodeId`
4. New host node takes over as authoritative state manager
5. Previous host node (if different) automatically becomes client node

**Client Node Failure**:
1. Node's WebSocket clients disconnect
2. Players reconnect to any available cndr node
3. Players provide client ID in handshake to reclaim seat
4. New node looks up client in Redis and restores session

**Redis Failure**:
- All cndr nodes lose coordination capability
- Existing WebSocket connections remain open temporarily
- State updates cannot propagate
- New clients cannot join
- **Recovery**: When Redis returns, rooms may need manual recreation (ephemeral data model)

**No Complex Failover**:
- System prioritizes simplicity over zero-downtime guarantees
- Clients responsible for reconnection logic
- Host disconnection pauses game but doesn't terminate room
- Lost messages are client's responsibility to handle

### Primary Node Responsibilities

The primary node performs maintenance tasks:

**Inactive Room Cleanup**:
- Every 5 minutes (configurable), scan all rooms
- Close rooms with `lastActivity` > 5 minutes old (configurable)
- Delete all associated Redis keys (room config, state, game state, polls, clients)

**Stale Node Cleanup**:
- Remove nodes from `nodes:registry` that haven't sent heartbeat in 3+ minutes
- Clean up corresponding `nodes:heartbeat` entries

**Poll Cleanup**:
- When closing inactive rooms, delete all associated poll keys
- No TTL-based cleanup (manual only)

**Election Stability**:
- Each node independently determines if it's primary
- No coordination required (deterministic based on registration time + heartbeat)
- If primary node fails, next-earliest node automatically takes over

---

## 5. Client Connection Lifecycle

### Initial Connection

**Step-by-Step Flow**:

1. **Client establishes WebSocket connection** to any cndr node (load balancer distributes)

2. **Client sends Handshake Request** (see COMMANDS.md #1):
   ```json
   {
     "roomCode": "ABC123",
     "role": "player",
     "password": "secret",
     "meta": {"playerName": "Alice"}
   }
   ```

3. **Node validates request**:
   - Room exists in Redis (`room:config:<roomCode>`)
   - Password matches (if role is player and room has password)
   - Host key matches (if role is host)
   - Room capacity not exceeded (check `room:clients:<roomCode>` count vs `maxPlayers`/`maxAudience`)

4. **Node assigns client ID** (if role is player):
   - Generate unique client ID (UUID)
   - Store client metadata in `room:client:<roomCode>:<clientId>`

5. **Node sends Handshake Response** (see COMMANDS.md #2):
   ```json
   {
     "status": "success",
     "clientId": "player-uuid-1234",
     "gameState": { /* current state */ }
   }
   ```

6. **Node notifies host** (if role is player or audience) via Client Join Event (COMMANDS.md #3):
   - If this node is the host node: Send directly via WebSocket
   - If this node is a client node: Write to `room:queue:tohost:<roomCode>`, host node polls and delivers

7. **Client is now active** and begins receiving state updates

### Reconnection Handling

**Same-Node Reconnection**:
- Socket.io provides automatic reconnection to same server instance
- Session state persists in memory
- No additional handshake needed (handled by Socket.io)

**Cross-Node Reconnection** (player only):

1. **Client connects to different cndr node**
2. **Client sends Handshake Request with client ID**:
   ```json
   {
     "roomCode": "ABC123",
     "role": "player",
     "clientId": "player-uuid-1234",
     "password": "secret"
   }
   ```
3. **Node looks up client in Redis** (`room:client:<roomCode>:<clientId>`)
4. **Node validates seat is not explicitly disconnected**:
   - Check that client still exists in `room:clients:<roomCode>`
   - Verify client metadata indicates seat is held
5. **Node updates connection metadata**:
   - Update `connectedNodeId` to this node's ID
   - Update `socketId` to new socket
6. **Client reclaims seat** and receives current game state

**Host/Audience Reconnection**:
- No seat persistence
- Treated as brand new connection
- Must complete full handshake again
- Host must provide host key again

### Seat Persistence Rules

**Players**:
- Seat held until:
  - Explicit disconnect (Client Leave message, COMMANDS.md #7)
  - Room closes (COMMANDS.md #13)
  - Room cleaned up by primary node (inactive for 5+ minutes)
- Players can **always** reclaim their seat with client ID
- No timeout for seat expiration

**Host/Audience**:
- No seat persistence
- Each connection is independent

### Disconnection Scenarios

**Graceful Disconnect**:
1. Client sends Leave message (COMMANDS.md #7)
2. Node removes client from `room:clients:<roomCode>`
3. Node deletes `room:client:<roomCode>:<clientId>` (for players)
4. Node notifies host of disconnection
5. Seat immediately freed for new client

**Ungraceful Disconnect** (network timeout, crash):
1. Socket.io detects disconnect event
2. Node marks socket as disconnected internally
3. **Player**: Seat remains held, client can reconnect
4. **Host/Audience**: Slot freed after socket timeout

**Timeout Configuration**:
- Socket.io ping/pong timeout: 20 seconds (default)
- Clients should implement exponential backoff for reconnection

---

## 6. Message Flow Architecture

### Message Routing Patterns

#### Pattern 1: Player → Host (COMMANDS.md #6)

**Flow**:
```
Player Client
    ↓ (WebSocket) Send Message to Host
Client Node
    ↓ (Add clientId to message)
Client Node
    ↓ (Write to Redis list)
Redis: room:queue:tohost:<roomCode>
    ↓ (RPOP by host node)
Host Node
    ↓ (WebSocket delivery)
Host Client
```

**Implementation Details**:
- Client sends: `{message: {type: "move", data: "..."}}`
- Client node adds: `{clientId: "player-uuid", message: {...}, timestamp: 123456}`
- **Optimization**: If host is on same node, deliver directly via WebSocket
- **Otherwise**: Write to Redis: `LPUSH room:queue:tohost:<roomCode>`
- Host node polls: `RPOP room:queue:tohost:<roomCode>` (continuous loop)
- Host node delivers to host socket

**Rate Limiting**:
- Applied at client node before writing to Redis
- Limit: 100 messages/minute per client (configurable)
- Tracked in-memory on each node

#### Pattern 2: Host → All Clients (COMMANDS.md #4, #8, #10, #13)

**Examples**:
- Set Game State (COMMANDS.md #4)
- Poll Start (COMMANDS.md #8)
- Poll End (COMMANDS.md #10)
- Close Room (COMMANDS.md #13)

**Flow**:
```
Host Client
    ↓ (WebSocket) Set Game State
Host Node
    ├─ Write to Redis (persistence)
    └─ Publish to room:updates:<roomCode>
         ↓ (Instant notification)
Client Nodes (subscribed)
    ↓ WebSocket broadcast
All Player/Audience Clients
```

**Implementation Details**:
- Host node writes state to Redis: `SET room:gamestate:<roomCode>`
- Host node publishes: `PUBLISH room:updates:<roomCode> {type: "gamestate", data: ...}`
- Host node broadcasts to its own connected clients via WebSocket
- Client nodes subscribed to channel receive message instantly
- Client nodes broadcast to their connected clients
- Update `room:state:<roomCode>:lastActivity` timestamp

#### Pattern 3: Host → Specific Player (COMMANDS.md #5)

**Flow**:
```
Host Client
    ↓ (WebSocket) Set Player State
Host Node
    ↓ (Write to Redis)
Redis: room:playerstate:<roomCode>:<clientId>
    ↑ (Poll every 100ms)
Client Node (with that player connected)
    ↓ (WebSocket delivery to specific socket)
Player Client
```

**Implementation Details**:
- Host specifies `clientId` in message
- Host node writes to `room:playerstate:<roomCode>:<clientId>`
- Host node publishes to `room:updates:<roomCode>` with type `playerstate`
- Client nodes subscribed to channel receive message
- Node checks if target player is connected to this node
- If yes: Deliver to specific player socket

#### Pattern 4: Audience → Host (COMMANDS.md #9)

**Example**: Poll Response

**Flow**:
- Same as Pattern 1 (Player → Host)
- Audience sends poll response
- Client node adds `clientId` (socket ID for audience)
- Client node writes to Redis queue
- Host node reads and processes

### Message Guarantees

**Delivery Semantics**:
- **Best-effort delivery**: Messages may be lost on node failure
- **No ordering guarantees**: Messages may arrive out of order
- **No deduplication**: Same message may be delivered multiple times
- **No acknowledgment**: Clients don't receive confirmation of delivery

**Rationale**:
- Prioritizes simplicity and performance
- Games typically implement their own retry/confirmation logic
- Lost messages are acceptable in most game scenarios
- Host is source of truth; clients can request state resync if needed

**Client Responsibility**:
- Implement timeout and retry for critical actions
- Handle duplicate messages gracefully
- Sync state with host periodically

### Rate Limiting

**Per-Client Limits**:
- Default: 100 messages/minute per client (configurable)
- Applies to: Player → Host and Audience → Host messages
- Does not apply to: Host messages (trusted)

**Implementation**:
- Tracked in-memory on each node (sliding window or token bucket)
- Each node tracks only its own clients
- No Redis coordination for rate limits (acceptable per-node limit)

**Exceeded Limit Behavior**:
1. Node rejects message
2. Node sends error event to client socket
3. Node logs rate limit violation
4. Message not written to Redis

**Configuration**:
- `RATE_LIMIT_MESSAGES`: Message count (default 100)
- `RATE_LIMIT_WINDOW_MS`: Time window in milliseconds (default 60000)

---

## 7. Room Management

### Room Creation

**Responsibility**: External API or admin interface (not cndr nodes)

**Typical Implementation**:
1. User requests new room via API
2. API generates:
   - Room code (6-character alphanumeric, e.g., "ABC123")
   - Optional password (user-provided or generated)
   - Random host key (UUID or similar, kept secret)
3. API writes to Redis: `room:config:<roomCode>`
4. API returns room code and host key to user
5. User can now connect as host using room code + host key

**Why External**:
- Enables custom room validation, rate limiting, abuse prevention
- Allows integration with payment, scheduling, or reservation systems
- Decouples room lifecycle from relay infrastructure
- Permits room audit logging, analytics, or moderation

### Room Configuration

**Required Fields**:
- `roomCode`: Unique identifier (typically 6-character alphanumeric)
- `hostKey`: Random secret for host authentication

**Optional Fields**:
- `password`: Required for player role (if set)
- `maxPlayers`: Maximum player capacity (0 = unlimited)
- `maxAudience`: Maximum audience capacity (0 = unlimited)

**Validation on Join**:
- **Player**: Password must match (if room has password), count < maxPlayers
- **Audience**: No password, count < maxAudience
- **Host**: Host key must match

**Configuration Changes**:
- Not supported during active room
- Room must be closed and recreated with new config

### Room Lifecycle

**Phase 1: Created**
- Room config exists in Redis
- No clients connected
- No host node assigned

**Phase 2: Active**
- Host has joined (host node recorded in `room:state:<roomCode>`)
- Players/audience can join
- Messages flowing
- `lastActivity` timestamp updated on each message

**Phase 3: Idle**
- Host still connected, but no messages for some time
- `lastActivity` timestamp stale
- Room remains active until explicitly closed

**Phase 4: Closed**
- Host sends Close Room message (COMMANDS.md #13), OR
- Primary node cleans up (inactive for 5+ minutes)
- All Redis keys deleted
- All clients disconnected
- Room code can be reused

### Room Cleanup

**Manual Cleanup** (Host closes room):
1. Host sends Close Room message
2. Host node broadcasts to all connected clients
3. Host node deletes all Redis keys:
   - `room:config:<roomCode>`
   - `room:state:<roomCode>`
   - `room:clients:<roomCode>`
   - `room:client:<roomCode>:<clientId>` (all clients)
   - `room:gamestate:<roomCode>`
   - `room:playerstate:<roomCode>:<clientId>` (all players)
   - `room:poll:*:<roomCode>:*` (all polls)
   - `room:queue:tohost:<roomCode>`
4. Host node disconnects all sockets

**Automatic Cleanup** (Primary node maintenance):
1. Primary node runs every 5 minutes
2. Scans all rooms: `SCAN` for `room:state:*` keys
3. Checks `lastActivity` timestamp
4. If `lastActivity` > 5 minutes old:
   - Delete all room keys (same as manual cleanup)
   - Note: Clients already disconnected by socket timeout

**Cleanup Configuration**:
- `CLEANUP_INTERVAL_MS`: How often primary node checks (default 300000 = 5 min)
- `INACTIVE_ROOM_THRESHOLD_MS`: Activity threshold (default 300000 = 5 min)

---

## 8. State Management

### Game State (Global)

**Definition**: Game state visible to all clients (players and audience)

**Control**: Only host can update (Set Game State, COMMANDS.md #4)

**Storage**:
- Redis key: `room:gamestate:<roomCode>`
- Data type: String (JSON serialized)
- Value: Complete game state object

**Update Flow**:
1. Host sends Set Game State message
2. Host node validates sender is host
3. Host node writes to Redis: `SET room:gamestate:<roomCode> <jsonState>`
4. Host node broadcasts to its connected clients
5. Client nodes poll Redis, detect change, broadcast to their clients

**Characteristics**:
- **Full state replacement**: No delta updates, always complete state
- **No versioning**: Last write wins
- **No conflict resolution**: Host is source of truth
- **Arbitrary structure**: JSON schema is game-specific

**Example**:
```json
{
  "round": 3,
  "currentPlayer": "player-uuid-1234",
  "board": [...],
  "scores": {"player-uuid-1234": 10, "player-uuid-5678": 15}
}
```

### Player State (Private)

**Definition**: Per-player private state, only visible to that specific player

**Control**: Only host can update (Set Player State, COMMANDS.md #5)

**Storage**:
- Redis key: `room:playerstate:<roomCode>:<clientId>`
- Data type: String (JSON serialized)
- Value: Player-specific state object

**Update Flow**:
1. Host sends Set Player State message with `clientId`
2. Host node validates sender is host
3. Host node writes to Redis: `SET room:playerstate:<roomCode>:<clientId> <jsonState>`
4. Host node checks if player is on this node:
   - **Yes**: Deliver directly via WebSocket
   - **No**: Client node will poll and deliver
5. Client nodes poll Redis for their players, detect change, deliver to specific socket

**Characteristics**:
- **Per-player isolation**: Player A cannot see Player B's state
- **Host controls content**: Host decides what each player sees
- **Full state replacement**: No delta updates
- **Arbitrary structure**: JSON schema is game-specific

**Example** (for a card game):
```json
{
  "hand": ["card1", "card2", "card3"],
  "secretMission": "Collect 3 red cards"
}
```

### Room State

**Definition**: Metadata about the room itself (not game-specific)

**Control**: cndr nodes manage (not exposed to host/clients directly)

**Storage**:
- Redis key: `room:state:<roomCode>`
- Data type: Hash
- Fields:
  - `hostNodeId`: Node ID of the host's connected node
  - `lastActivity`: Unix timestamp of last message
  - `hostClientId`: Socket ID of the host

**Usage**:
- Nodes determine if they're the host node for a room
- Primary node uses `lastActivity` for cleanup
- Client nodes know which node to route host messages to (if needed)

**Update Triggers**:
- Host connects: Set `hostNodeId`, `hostClientId`
- Host disconnects: Clear `hostNodeId`
- Any message: Update `lastActivity`

### Client List

**Definition**: List of all clients currently in the room

**Storage**:
- Redis key: `room:clients:<roomCode>`
- Data type: Sorted Set
- Members: `<clientId>` for players, `<socketId>` for host/audience
- Score: Unix timestamp of join time

**Purpose**:
- Capacity validation (count vs maxPlayers/maxAudience)
- Client enumeration for host
- Cleanup tracking

**Metadata Storage** (for players):
- Redis key: `room:client:<roomCode>:<clientId>`
- Data type: Hash
- Fields:
  - `role`: "host" | "player" | "audience"
  - `meta`: JSON string (player name, etc.)
  - `connectedNodeId`: Node ID
  - `socketId`: Current socket ID
  - `joinedAt`: Timestamp

---

## 9. Poll System Architecture

### Poll Lifecycle

**1. Start Poll** (COMMANDS.md #8)
- **Trigger**: Host sends Poll Start message
- **Validation**: Host only, poll ID must be unique
- **Actions**:
  - Write poll config to `room:poll:config:<roomCode>:<pollId>`
  - Set `active: true`
  - Broadcast to all audience members
- **State**: Poll now accepting responses

**2. Audience Responds** (COMMANDS.md #9)
- **Trigger**: Audience member sends Poll Response
- **Validation**: Poll must exist and be active
- **Actions**:
  - Write response to `room:poll:responses:<roomCode>:<pollId>`
  - Store as hash field: `<clientId>` → `<response>`
  - If client already responded, overwrite (last response wins)
- **State**: Response recorded

**3. End Poll** (COMMANDS.md #10)
- **Trigger**: Host sends Poll End message
- **Validation**: Host only, poll must exist
- **Actions**:
  - Update poll config: `active: false`, set `endedAt` timestamp
  - Broadcast to all audience members
- **State**: Poll no longer accepting responses

**4. Request Results** (COMMANDS.md #11-12)
- **Trigger**: Host sends Poll Results Request
- **Validation**: Host only, poll must exist
- **Actions**:
  - Read all responses from `room:poll:responses:<roomCode>:<pollId>`
  - Compute aggregated results (on-demand)
  - Return Poll Results Response to host
- **State**: Results computed but not stored (ephemeral)

**5. Cleanup**
- **Trigger**: Room closes (manual or automatic)
- **Actions**:
  - Delete all poll keys: `room:poll:*:<roomCode>:*`
- **State**: Polls permanently deleted

### Poll Types

**Single Choice**:
- Audience selects one option from a list
- Response format: String (e.g., "option_0")
- Results format: `{"option_0": 5, "option_1": 3, "option_2": 2, "totalResponses": 10}`

**Multiple Choice**:
- Audience selects multiple options from a list
- Response format: Array of strings (e.g., `["option_0", "option_2"]`)
- Results format: `{"option_0": 5, "option_1": 2, "option_2": 7, "totalResponses": 10}`
- Note: Total may exceed response count (each person can vote multiple times)

**Free Text**:
- Audience enters arbitrary text
- Response format: String (any text)
- Results format: Hash of unique responses to counts
  - `{"response_hash_1": 3, "response_hash_2": 2, ...}`
  - Or return all responses as array (game-specific decision)

### Poll Storage

**Configuration**:
- **Key**: `room:poll:config:<roomCode>:<pollId>`
- **Type**: Hash
- **Fields**:
  ```
  type: "multiple_choice" | "single_choice" | "free_text"
  question: "What is your favorite color?"
  options: '["Red", "Blue", "Green"]'  (JSON array string)
  active: "true" | "false"
  startedAt: "1678901234"
  endedAt: "1678901534"  (null if active)
  ```

**Individual Responses**:
- **Key**: `room:poll:responses:<roomCode>:<pollId>`
- **Type**: Hash
- **Fields**: `<clientId>` → `<response>`
  - Single choice: `"audience-socket-123" → "option_1"`
  - Multiple choice: `"audience-socket-456" → '["option_0", "option_2"]'`
  - Free text: `"audience-socket-789" → "My answer text"`

**Aggregated Results** (Computed on Demand):
- Not stored in Redis (computed when requested)
- Host node reads all responses from hash
- Aggregates based on poll type
- Returns to host via Poll Results Response

### Poll Cleanup

**No Automatic Expiration**:
- Polls have no TTL
- Remain in Redis until room closes

**Manual Cleanup**:
- Host closes room → All polls deleted
- Primary node cleans inactive room → All polls deleted

**Cleanup Keys**:
- `room:poll:config:<roomCode>:<pollId>`
- `room:poll:responses:<roomCode>:<pollId>`

### Poll Constraints

**No Duplicate Prevention**:
- Same client can respond multiple times
- Last response wins (hash field overwrite)
- Host can implement client-side deduplication if needed

**No Response Editing**:
- Once submitted, response cannot be edited (only overwritten)
- Client must send new Poll Response message

**No Partial Results**:
- Results are always complete (all responses aggregated)
- No incremental/streaming results

---

## 10. Redis Data Schema

### Key Format Convention
- **No environment prefix**: Keys are not namespaced (assumes dedicated Redis instance)
- **Format**: `<entity>:<subtype>:<identifier>[:<subIdentifier>]`
- **Examples**:
  - `room:config:ABC123`
  - `room:poll:responses:ABC123:poll-1`

### Room Data

#### Room Configuration
- **Type**: Hash
- **Key**: `room:config:<roomCode>`
- **Fields**:
  ```
  password: ""  (empty string if no password)
  hostKey: "random-uuid-1234"
  maxPlayers: "10"  (0 = unlimited)
  maxAudience: "50"  (0 = unlimited)
  createdAt: "1678901234"
  ```
- **TTL**: None (manual cleanup only)
- **Example**:
  ```
  HGETALL room:config:ABC123
  1) "password"
  2) "secret123"
  3) "hostKey"
  4) "host-key-uuid"
  5) "maxPlayers"
  6) "10"
  7) "maxAudience"
  8) "50"
  9) "createdAt"
  10) "1678901234"
  ```

#### Room State
- **Type**: Hash
- **Key**: `room:state:<roomCode>`
- **Fields**:
  ```
  hostNodeId: "node-uuid-1234"
  lastActivity: "1678901234"
  hostClientId: "socket-id-5678"
  ```
- **TTL**: None (manual cleanup only)
- **Usage**: Nodes check this to determine host node, primary node checks lastActivity for cleanup

#### Room Clients
- **Type**: Sorted Set
- **Key**: `room:clients:<roomCode>`
- **Members**: `<clientId>` (for players) or `<socketId>` (for host/audience)
- **Score**: Unix timestamp of join time
- **TTL**: None (manual cleanup only)
- **Example**:
  ```
  ZRANGE room:clients:ABC123 0 -1 WITHSCORES
  1) "player-uuid-1234"
  2) "1678901234"
  3) "player-uuid-5678"
  4) "1678901250"
  5) "socket-audience-9999"
  6) "1678901260"
  ```
- **Usage**: Count for capacity validation, enumerate for host

#### Client Metadata
- **Type**: Hash
- **Key**: `room:client:<roomCode>:<clientId>`
- **Fields**:
  ```
  role: "player"
  meta: '{"playerName": "Alice"}'
  connectedNodeId: "node-uuid-1234"
  socketId: "socket-id-5678"
  joinedAt: "1678901234"
  ```
- **TTL**: None (cleaned up with room)
- **Usage**: Player reconnection, role validation

### Game State Data

#### Global Game State
- **Type**: String (JSON)
- **Key**: `room:gamestate:<roomCode>`
- **Value**: JSON string of complete game state
- **TTL**: None (manual cleanup only)
- **Example**:
  ```
  GET room:gamestate:ABC123
  '{"round":3,"currentPlayer":"player-uuid-1234","board":[...],"scores":{"player-uuid-1234":10}}'
  ```

#### Player State
- **Type**: String (JSON)
- **Key**: `room:playerstate:<roomCode>:<clientId>`
- **Value**: JSON string of player-specific state
- **TTL**: None (cleaned up with room)
- **Example**:
  ```
  GET room:playerstate:ABC123:player-uuid-1234
  '{"hand":["card1","card2","card3"],"secretMission":"Collect 3 red cards"}'
  ```

### Poll Data

#### Poll Configuration
- **Type**: Hash
- **Key**: `room:poll:config:<roomCode>:<pollId>`
- **Fields**:
  ```
  type: "single_choice"
  question: "What is your favorite color?"
  options: '["Red", "Blue", "Green"]'
  active: "true"
  startedAt: "1678901234"
  endedAt: ""  (empty if active)
  ```
- **TTL**: None (cleaned up with room)

#### Poll Responses (Individual)
- **Type**: Hash
- **Key**: `room:poll:responses:<roomCode>:<pollId>`
- **Fields**: `<clientId>` → `<response>`
- **Example**:
  ```
  HGETALL room:poll:responses:ABC123:poll-1
  1) "audience-socket-123"
  2) "option_0"
  3) "audience-socket-456"
  4) '["option_0", "option_2"]'
  5) "audience-socket-789"
  6) "My free text response"
  ```
- **TTL**: None (cleaned up with room)

#### Poll Aggregated Results
- **Not Stored**: Computed on-demand from individual responses
- **Computation**:
  1. `HGETALL room:poll:responses:<roomCode>:<pollId>`
  2. Parse each response based on poll type
  3. Aggregate counts
  4. Return to host
- **Example Result** (single choice):
  ```json
  {
    "option_0": 5,
    "option_1": 3,
    "option_2": 2,
    "totalResponses": 10
  }
  ```

### Node Coordination Data

#### Node Registry
- **Type**: Sorted Set
- **Key**: `nodes:registry`
- **Members**: `<nodeId>` (e.g., "node-uuid-1234")
- **Score**: Unix timestamp of registration time
- **TTL**: None (cleaned up by primary node)
- **Usage**: Primary node election (earliest node with recent heartbeat)
- **Example**:
  ```
  ZADD nodes:registry 1678901234 "node-uuid-1234"
  ZADD nodes:registry 1678901250 "node-uuid-5678"
  ```

#### Node Heartbeat
- **Type**: Hash
- **Key**: `nodes:heartbeat`
- **Fields**: `<nodeId>` → timestamp of last heartbeat
- **TTL**: None (cleaned up by primary node)
- **Usage**: Determine which nodes are active (heartbeat < 3 minutes old)
- **Example**:
  ```
  HSET nodes:heartbeat "node-uuid-1234" "1678901234"
  HGET nodes:heartbeat "node-uuid-1234"
  "1678901234"
  ```

#### Primary Node Election
- **Not Stored**: Computed on-demand by each node
- **Algorithm**:
  1. `ZRANGE nodes:registry 0 -1 WITHSCORES` (get all nodes sorted by registration time)
  2. `HGETALL nodes:heartbeat` (get all heartbeats)
  3. Find earliest node with heartbeat < 3 minutes old
  4. If this node's ID matches, it's the primary node

### Message Queues (Inter-Node Communication)

#### Client Messages to Host
- **Type**: List
- **Key**: `room:queue:tohost:<roomCode>`
- **Values**: JSON objects `{clientId, message, timestamp}`
- **Usage**:
  - Client nodes: `LPUSH room:queue:tohost:<roomCode> <jsonMessage>`
  - Host node: `RPOP room:queue:tohost:<roomCode>` (in loop or periodic poll)
- **TTL**: None (trimmed by host node after processing)
- **Example**:
  ```
  LPUSH room:queue:tohost:ABC123 '{"clientId":"player-uuid-1234","message":{"type":"move","data":"..."},"timestamp":1678901234}'
  RPOP room:queue:tohost:ABC123
  '{"clientId":"player-uuid-1234","message":{"type":"move","data":"..."},"timestamp":1678901234}'
  ```

#### State Update Notifications (Pub-Sub)
- **Type**: Pub/Sub Channel
- **Channel**: `room:updates:<roomCode>`
- **Messages**: JSON `{type: "gamestate"|"playerstate"|"poll_start"|"poll_end"|"room_close", data: ...}`
- **Usage**:
  - Host node: `PUBLISH room:updates:<roomCode> <jsonNotification>`
  - Client nodes: `SUBSCRIBE room:updates:<roomCode>` (per room, as needed)
- **Benefit**: Instant state propagation (eliminates 100ms polling delay)
- **Note**: Core feature (not optional). Each node maintains separate Redis client for pub-sub.

### Cleanup Strategy

**Room Closure** (manual or automatic):
- Delete all keys matching:
  - `room:config:<roomCode>`
  - `room:state:<roomCode>`
  - `room:clients:<roomCode>`
  - `room:client:<roomCode>:*` (all clients)
  - `room:gamestate:<roomCode>`
  - `room:playerstate:<roomCode>:*` (all players)
  - `room:poll:config:<roomCode>:*` (all polls)
  - `room:poll:responses:<roomCode>:*` (all poll responses)
  - `room:queue:tohost:<roomCode>`

**Node Cleanup** (by primary node):
- Remove from `nodes:registry` if heartbeat > 3 minutes old
- Delete corresponding field from `nodes:heartbeat`

**No TTL Usage**:
- All keys have no expiration (TTL = -1)
- Manual cleanup only (by host close or primary node maintenance)

---

## 11. Protocol Implementation

### Implementation Status

**Current State**: ~15% complete
- Basic WebSocket server running (Socket.io)
- Partial handshake implementation
- **Missing**: All Redis integration, distributed coordination, 12 of 13 message types

### Required Message Types

All 13 message types from COMMANDS.md must be implemented:

| # | Message Type | Direction | Status |
|---|--------------|-----------|--------|
| 1 | Handshake Request | Client → Relay | Partial |
| 2 | Handshake Response | Relay → Client | Partial |
| 3 | Client Join Event | Relay → Host | Not implemented |
| 4 | Set Game State | Host → All Clients | Not implemented |
| 5 | Set Player State | Host → Specific Player | Not implemented |
| 6 | Send Message to Host | Player → Host | Not implemented |
| 7 | Client Leave | Client → Relay | Not implemented |
| 8 | Poll Start | Host → All Audience | Not implemented |
| 9 | Poll Response | Audience → Host | Not implemented |
| 10 | Poll End | Host → All Audience | Not implemented |
| 11 | Poll Results Request | Host → Relay | Not implemented |
| 12 | Poll Results Response | Relay → Host | Not implemented |
| 13 | Close Room | Host → All Clients | Not implemented |

### Implementation Requirements

**Message Validation**:
- Validate all required parameters present
- Check JSON schema for nested objects
- Validate enum values (role, poll type, etc.)
- Size limits on message payloads (prevent abuse)

**Permission Enforcement**:
- Check role before allowing message (host-only commands)
- Validate host key on host connection
- Validate room password on player connection
- Reject unauthorized messages with error response

**Redis Integration**:
- ioredis client with connection pooling
- Error handling for Redis failures
- Retry logic for transient errors
- Graceful degradation on Redis unavailability

**Message Handlers** (one per message type):
- Parse incoming message
- Validate parameters and permissions
- Execute Redis operations (read/write)
- Send response or broadcast to clients
- Log errors and violations

**State Synchronization**:
- Host node: Write to Redis immediately
- Client nodes: Poll Redis every 100ms
- Detect changes and broadcast to connected clients
- Handle race conditions (last write wins)

### Testing Requirements

**Unit Tests**:
- Message validation logic
- Permission checks
- Redis key generation
- Poll aggregation logic

**Integration Tests**:
- Full handshake flow (all roles)
- Game state broadcast to multiple clients
- Player state delivery to specific client
- Poll lifecycle (start → respond → end → results)
- Room cleanup (manual and automatic)

**Load Tests**:
- Multiple concurrent rooms
- High message throughput per room
- Many clients per room
- Node failover scenarios

---

## 12. Security Considerations

### Authentication

**Host Authentication**:
- Host must provide `hostKey` in handshake
- Host key generated by external room creation API (random UUID)
- Host key stored in `room:config:<roomCode>:hostKey`
- Validated on every host connection (no session persistence)

**Player Authentication**:
- Player must provide `password` if room has password
- Password stored in `room:config:<roomCode>:password`
- Validated on initial connection
- Client ID issued on successful auth, used for reconnection

**Audience Authentication**:
- No authentication required
- Audience connections subject to capacity limit only

**Session Management**:
- No JWT or cookies (WebSocket connection is session)
- Client ID serves as session identifier for players
- Reconnection requires client ID + room password

### Authorization

**Role-Based Access Control**:
- Enforced at message handler level
- Each message type has allowed roles (see permission matrix)
- Unauthorized messages rejected with error

**Host-Only Commands**:
- Set Game State (COMMANDS.md #4)
- Set Player State (COMMANDS.md #5)
- Poll Start (COMMANDS.md #8)
- Poll End (COMMANDS.md #10)
- Poll Results Request (COMMANDS.md #11)
- Close Room (COMMANDS.md #13)

**Player/Audience Commands**:
- Send Message to Host (COMMANDS.md #6)
- Poll Response (COMMANDS.md #9, audience only)
- Client Leave (COMMANDS.md #7)

### Rate Limiting

**Per-Client Limits**:
- Default: 100 messages/minute per client (configurable)
- Tracked in-memory on each node (sliding window or token bucket)
- Applies to: Player → Host and Audience → Host messages
- Does not apply to: Host messages (trusted role)

**Implementation**:
```javascript
// Pseudocode
const rateLimits = new Map(); // clientId -> {count, windowStart}

function checkRateLimit(clientId) {
  const now = Date.now();
  const limit = rateLimits.get(clientId) || {count: 0, windowStart: now};

  if (now - limit.windowStart > 60000) {
    // New window
    limit.count = 1;
    limit.windowStart = now;
  } else if (limit.count >= 100) {
    // Limit exceeded
    return false;
  } else {
    limit.count++;
  }

  rateLimits.set(clientId, limit);
  return true;
}
```

**Exceeded Limit Behavior**:
- Reject message immediately
- Send error event to client socket
- Log violation (for monitoring)
- Do not write to Redis

**DDoS Mitigation**:
- Rate limits per client prevent single-client spam
- Load balancer can implement IP-based limits
- Redis connection pooling prevents exhaustion
- Message size limits prevent large payload attacks

### Input Validation

**Message Schema Validation**:
- Validate all incoming messages against protocol schema
- Reject malformed JSON
- Check required fields present
- Validate data types (string, number, array, etc.)

**Payload Size Limits**:
- Maximum message size: 64KB (configurable)
- Prevents memory exhaustion attacks
- Enforced at Socket.io transport level

**Room Code Validation**:
- Format: 6-character alphanumeric (configurable)
- Reject invalid formats before Redis lookup
- Prevents NoSQL injection (though Redis is not SQL)

**Client ID Validation**:
- Format: UUID v4
- Validate format before Redis lookup
- Prevent enumeration attacks

### CORS Configuration

**Current State**:
```javascript
// packages/server/src/index.ts
cors: {
  origin: "*",  // Security issue - allows any origin
  methods: ["GET", "POST"]
}
```

**Recommended**:
- Configure allowed origins per deployment
- Use environment variable `ALLOWED_ORIGINS` (comma-separated list)
- Reject connections from unauthorized origins

**Example**:
```javascript
cors: {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || "*",
  methods: ["GET", "POST"],
  credentials: true
}
```

### Data Privacy

**Private Player State**:
- Only delivered to specific player (by client ID)
- Not visible to other players or audience
- Host can see all player states (trusted role)

**Poll Responses**:
- Individual responses stored with client ID (for deduplication)
- Only aggregated results returned to host
- Individual responses not exposed to host (unless explicitly implemented)

**Connection Metadata**:
- Node IDs, socket IDs are internal (not exposed to clients)
- Room codes are public (shareable)
- Host keys are secret (never sent to clients)

### Secrets Management

**Host Keys**:
- Generated by external room creation API
- Stored in Redis (plaintext, acceptable for ephemeral rooms)
- Never logged or exposed in error messages
- Transmitted over WebSocket (ensure WSS/TLS in production)

**Room Passwords**:
- Stored in Redis (plaintext, acceptable for casual games)
- For higher security: Hash passwords (bcrypt) before storing
- Transmitted over WebSocket (ensure WSS/TLS in production)

**Redis Credentials**:
- Stored in environment variables (not in code)
- Use Redis AUTH if available
- Consider Redis TLS for production

### Transport Security

**WebSocket Encryption**:
- Use WSS (WebSocket Secure) in production
- TLS certificate on load balancer or cndr node
- Prevents eavesdropping on messages

**Redis Connection**:
- Use Redis TLS in production (if available)
- Keep Redis on private network (not public internet)
- Firewall rules to restrict Redis access to cndr nodes only

---

## 13. Scalability Considerations

### Horizontal Scaling

**Multi-Node Deployment**:
- Run multiple cndr instances behind load balancer
- Each node handles subset of client connections
- All nodes coordinate via single Redis instance
- No shared state in memory (stateless except rate limits)

**Load Balancer Configuration**:
- Use sticky sessions (IP hash or cookie-based) for WebSocket connections
- Enables Socket.io reconnection to same node (preferred)
- Not required: Clients can reconnect to different node (with client ID)

**Scaling Limits**:
- Redis becomes bottleneck at high scale (single instance)
- Client nodes polling every 100ms creates read load
- Consider Redis Pub/Sub optimization for high-traffic rooms

### Bottlenecks

**Single Redis Instance**:
- All state reads/writes go through one Redis
- Pub-sub load: Message distribution across subscribed client nodes
- Write load: Host nodes writing state updates and publishing notifications
- **Mitigation**:
  - Vertical scaling (Redis on high-memory, high-CPU machine)
  - Redis pipelining for batch operations
  - Connection pooling for command client

**Redis Pub-Sub Load**:
- Each room has one channel: `room:updates:<roomCode>`
- Each client node subscribes only to rooms with connected clients
- Redis pub-sub is highly efficient (in-memory message passing)
- **Mitigation**:
  - Nodes unsubscribe when last client leaves room
  - Use connection pooling for command client
  - Monitor pub-sub channel count and subscription count

**Message Queue Buildup**:
- If host node is slow to process messages, queue grows
- `room:queue:tohost:<roomCode>` list can become long
- **Mitigation**:
  - Host node processes queue in tight loop (RPOP until empty)
  - Monitor queue depth, alert if > threshold
  - Implement max queue size (reject messages if full)

### Performance Optimizations

**In-Memory Caching** (per node):
- Cache room configs in memory (avoid repeated Redis reads)
- TTL: 1 minute (balance freshness vs Redis load)
- Invalidate on room close

**Rate Limiting in Memory**:
- Track rate limits in-memory (not Redis)
- Reduces Redis load (no read/write per message)
- Acceptable: Per-node limits (each node tracks its own clients)

**Batch Redis Operations**:
- Use Redis pipelining for multi-key reads/writes
- Example: Read all player states in one batch when room state changes
- Reduces round-trip latency

**Redis Connection Pooling**:
- ioredis client supports connection pooling
- Configure pool size based on expected load
- Prevents connection exhaustion

**Redis Pub-Sub (Default)**:
- All state updates use pub-sub for instant propagation
- Host node publishes to `room:updates:<roomCode>` on state changes
- Client nodes subscribe per room (only rooms with connected clients)
- **Benefit**: Eliminates 100ms polling delay, reduces Redis read load
- **Implementation**: Separate Redis client dedicated to pub-sub (ioredis requirement)

**Example Pub/Sub Flow**:
```javascript
// Host node
redis.publish(`room:updates:${roomCode}`, JSON.stringify({
  type: 'gamestate',
  data: newGameState
}));

// Client node
redis.subscribe(`room:updates:${roomCode}`);
redis.on('message', (channel, message) => {
  const update = JSON.parse(message);
  if (update.type === 'gamestate') {
    broadcastToClients(update.data);
  }
});
```

**Same-Node Message Bypass**:
- When player sends message to host, check if host is on this node
- If same node: Deliver directly via WebSocket (bypass Redis queue)
- If different node: Use Redis queue as before
- **Benefit**: Reduces latency from ~5-10ms to <1ms for same-node messages
- **Implementation**: Track host locations in-memory, update on connect/disconnect

### Limits and Capacity Planning

**Per-Room Limits**:
- Max players: Configurable (default unlimited)
- Max audience: Configurable (default unlimited)
- Max message size: 64KB (default)
- Max poll options: No limit (JSON array in config)

**System-Wide Limits**:
- Concurrent rooms: Limited by Redis memory
  - Estimate: ~10KB per room (config + state) → 100K rooms in 1GB Redis
- Concurrent clients: Limited by cndr node capacity + network bandwidth
  - Estimate: ~10K connections per node (depends on hardware)
- Messages per second: Limited by Redis throughput
  - Redis can handle 100K+ ops/sec (depends on operation type)

**Capacity Planning**:
- Estimate room count: Average room size × expected concurrent users
- Estimate Redis memory: 10KB per room × expected concurrent rooms
- Estimate cndr node count: Concurrent users ÷ 10K per node
- Monitor metrics: Active rooms, connected clients, Redis memory, message rate

---

## 14. Monitoring and Observability

### Key Metrics

**Room Metrics**:
- `rooms.active.count`: Number of active rooms (with connected host)
- `rooms.idle.count`: Number of idle rooms (no activity in last 5 min)
- `rooms.created.rate`: Rooms created per minute
- `rooms.closed.rate`: Rooms closed per minute (manual + automatic)

**Client Metrics**:
- `clients.connected.total`: Total connected clients across all nodes
- `clients.connected.by_role`: Breakdown by host/player/audience
- `clients.connected.by_room`: Per-room client count distribution
- `clients.joined.rate`: New client connections per minute
- `clients.disconnected.rate`: Client disconnections per minute

**Message Metrics**:
- `messages.sent.rate`: Messages per second (total)
- `messages.sent.by_type`: Breakdown by message type (gamestate, playerstate, etc.)
- `messages.queue.depth`: Length of `room:queue:tohost` lists (per room)
- `messages.rate_limited.count`: Number of rate limit violations

**Redis Metrics**:
- `redis.ops.rate`: Operations per second (read + write)
- `redis.ops.latency`: Latency percentiles (p50, p95, p99)
- `redis.memory.used`: Current memory usage
- `redis.connections.active`: Active Redis client connections

**Node Metrics**:
- `nodes.registered.count`: Number of registered nodes
- `nodes.active.count`: Nodes with recent heartbeat (< 3 min)
- `nodes.primary.id`: Current primary node ID
- `nodes.heartbeat.missed.count`: Missed heartbeats (per node)

**Performance Metrics**:
- `websocket.connections.current`: Current WebSocket connections (per node)
- `websocket.connections.rate`: New connections per minute
- `cpu.usage.percent`: CPU usage per node
- `memory.usage.bytes`: Memory usage per node

### Health Checks

**HTTP `/health` Endpoint** (already implemented):
- Returns: `{status: "ok"}` if healthy
- Should include:
  - Redis connectivity: Can ping Redis successfully
  - Node registration: This node is registered in Redis
  - Active connections: Count of current WebSocket connections

**Example Enhanced Health Check**:
```json
{
  "status": "ok",
  "node": {
    "id": "node-uuid-1234",
    "registered": true,
    "isPrimary": false
  },
  "redis": {
    "connected": true,
    "latency": 5
  },
  "connections": {
    "total": 123,
    "host": 5,
    "player": 80,
    "audience": 38
  }
}
```

**Liveness Probe**:
- Endpoint: `GET /health`
- Success: HTTP 200 with `status: "ok"`
- Failure: HTTP 503 if Redis unreachable or node not registered

**Readiness Probe**:
- Endpoint: `GET /ready`
- Success: HTTP 200 if node can accept new connections
- Failure: HTTP 503 if node is shutting down or overloaded

### Logging

**Log Levels** (Pino configured):
- **error**: Unrecoverable errors (Redis failure, message validation failure)
- **warn**: Recoverable issues (rate limit exceeded, invalid message format)
- **info**: Key events (client join/leave, room created/closed, host change)
- **debug**: Detailed flow (message received, state update, Redis operation)

**Events to Log**:

**Connection Events** (info level):
- Client connected: `{event: "client_connected", roomCode, role, clientId, nodeId}`
- Client disconnected: `{event: "client_disconnected", roomCode, role, clientId, reason}`
- Host changed: `{event: "host_node_changed", roomCode, oldNodeId, newNodeId}`

**Room Lifecycle** (info level):
- Room activated: `{event: "room_activated", roomCode, hostNodeId}`
- Room closed: `{event: "room_closed", roomCode, reason: "manual"|"inactive"}`
- Room cleaned up: `{event: "room_cleanup", roomCode, clientCount, pollCount}`

**Security Events** (warn level):
- Rate limit exceeded: `{event: "rate_limit_exceeded", clientId, roomCode, messageCount}`
- Authentication failure: `{event: "auth_failed", roomCode, role, reason: "invalid_password"|"invalid_host_key"}`
- Unauthorized message: `{event: "unauthorized_message", clientId, roomCode, messageType}`

**System Events** (info/error level):
- Node registered: `{event: "node_registered", nodeId}`
- Node heartbeat: `{event: "node_heartbeat", nodeId}` (debug level)
- Primary node elected: `{event: "primary_node_elected", nodeId}`
- Redis connection lost: `{event: "redis_disconnected", error}` (error level)
- Redis connection restored: `{event: "redis_reconnected"}` (info level)

**Structured Logging Example**:
```javascript
logger.info({
  event: 'client_connected',
  roomCode: 'ABC123',
  role: 'player',
  clientId: 'player-uuid-1234',
  nodeId: 'node-uuid-5678',
  timestamp: Date.now()
});
```

### Alerting

**Critical Alerts**:
- Redis connection lost (all nodes)
- Primary node unable to elect itself (no nodes with recent heartbeat)
- High rate of authentication failures (potential attack)

**Warning Alerts**:
- High message queue depth (> 100 messages in `room:queue:tohost`)
- High rate limit violations (potential spam)
- Node heartbeat missed (node may be down)

**Informational Alerts**:
- High concurrent room count (approaching capacity)
- High client count per room (may impact performance)

### Monitoring Tools

**Recommended Stack**:
- **Metrics**: Prometheus (scrape `/metrics` endpoint)
- **Logging**: ELK Stack (Elasticsearch, Logstash, Kibana) or similar
- **Dashboards**: Grafana (visualize Prometheus metrics)
- **Alerting**: Prometheus Alertmanager or PagerDuty

**Custom Metrics Exporter**:
- Implement `/metrics` endpoint (Prometheus format)
- Export all key metrics listed above
- Update metrics on each event (connection, message, etc.)

---

## 15. Quick Start for Developers

### Prerequisites
- Node.js 18+ and pnpm
- Redis 6+ running locally or accessible remotely
- Familiarity with WebSocket/Socket.io

### Setup

1. **Clone and install**:
   ```bash
   git clone <repo-url>
   cd cndr
   pnpm install
   ```

2. **Configure environment** (`.env` file):
   ```bash
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=  # Optional
   PORT=3000
   LOG_LEVEL=info
   ```

3. **Start Redis**:
   ```bash
   redis-server
   ```

4. **Run server**:
   ```bash
   cd packages/server
   pnpm dev
   ```

5. **Create a room** (external API, manual Redis command for testing):
   ```bash
   redis-cli HSET room:config:TEST123 password "secret" hostKey "host-key-123" maxPlayers "10" maxAudience "50" createdAt "$(date +%s)"
   ```

6. **Connect as host** (WebSocket client):
   ```javascript
   const socket = io('http://localhost:3000');
   socket.emit('handshake', {
     roomCode: 'TEST123',
     role: 'host',
     hostKey: 'host-key-123'
   });
   socket.on('handshake_response', (data) => {
     console.log('Connected as host:', data);
   });
   ```

7. **Connect as player** (different WebSocket client):
   ```javascript
   const socket = io('http://localhost:3000');
   socket.emit('handshake', {
     roomCode: 'TEST123',
     role: 'player',
     password: 'secret',
     meta: {playerName: 'Alice'}
   });
   socket.on('handshake_response', (data) => {
     console.log('Connected as player:', data);
   });
   ```

### Development Workflow

1. **Read COMMANDS.md**: Understand protocol and message types
2. **Implement message handler**: Add handler in `packages/server/src/handlers/`
3. **Add Redis operations**: Use `ioredis` client to read/write state
4. **Test with WebSocket client**: Use tool like Postman or custom client
5. **Write tests**: Add unit/integration tests in `packages/server/src/__tests__/`
6. **Update documentation**: Add examples to this file if needed

### Testing

**Run tests**:
```bash
cd packages/server
pnpm test
```

**Manual testing with Redis CLI**:
```bash
# Check room state
redis-cli HGETALL room:config:TEST123
redis-cli HGETALL room:state:TEST123

# Check clients
redis-cli ZRANGE room:clients:TEST123 0 -1 WITHSCORES

# Check game state
redis-cli GET room:gamestate:TEST123
```

### Debugging

**Enable debug logs**:
```bash
LOG_LEVEL=debug pnpm dev
```

**Monitor Redis operations**:
```bash
redis-cli MONITOR
```

**Inspect WebSocket traffic**:
- Use browser DevTools (Network → WS tab)
- Use Wireshark or tcpdump for deep inspection

---

## 16. Glossary

**Audience**: Passive observer role that can participate in polls but has no persistent state

**Client ID**: Unique identifier assigned to players for seat persistence across reconnections

**Client Node**: A cndr instance that polls Redis and relays updates to its connected clients (no host connected)

**cndr**: The WebSocket relay server software; multiple instances can run simultaneously

**Distributed Coordination**: Multiple cndr instances coordinating via Redis to provide fault tolerance

**Game State**: Global state visible to all clients, controlled exclusively by the host

**Heartbeat**: Periodic signal sent by each node to Redis indicating it's still active

**Host**: The game controller role with full permissions to manage state and orchestrate gameplay

**Host Key**: Random secret required for host authentication, generated during room creation

**Host Node**: The cndr instance that has the room's host connected and is authoritative for state changes

**Inactive Room**: Room with no messages for a configured threshold (default 5 minutes), eligible for cleanup

**Node**: A running instance of the cndr server software

**Player**: Active participant role with persistent seat that survives reconnections

**Player State**: Per-player private state, only visible to that specific player, controlled by host

**Poll**: Interactive question system where host asks audience for responses (multiple choice, single choice, or free text)

**Primary Node**: The earliest-connected node with active heartbeat, responsible for maintenance tasks

**Redis**: Single-instance in-memory data store used for state persistence and distributed coordination

**Room**: An isolated game session identified by a unique room code, with optional password protection

**Room Code**: Unique identifier for a room (typically 6-character alphanumeric)

**Seat Persistence**: Player's ability to reconnect and reclaim their seat using client ID

**Socket.io**: WebSocket library used for real-time bidirectional communication

**TTL (Time To Live)**: Expiration time for Redis keys (not used in cndr; all cleanup is manual)

---

## Implementation Roadmap

This document serves as the authoritative design specification. Implementation is a separate task and is currently ~15% complete.

**Completed**:
- Basic WebSocket server with Socket.io
- Health check endpoint
- Pino logging setup
- Partial handshake implementation

**Pending**:
- Redis integration (ioredis client)
- All 13 message type handlers
- Distributed coordination (node registration, heartbeat, primary election)
- Room lifecycle management
- State synchronization (polling or pub/sub)
- Poll system
- Rate limiting
- Authentication and authorization
- Security hardening (CORS, input validation)
- Monitoring and metrics
- Comprehensive testing

For detailed protocol specifications, see [COMMANDS.md](./COMMANDS.md).
