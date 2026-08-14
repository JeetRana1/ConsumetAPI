import { FastifyInstance } from 'fastify';

const { WebSocketServer, WebSocket } = require('ws') as any;

type RoomMember = {
  id: string;
  name: string;
  role: 'host' | 'guest';
};

type RoomState = {
  paused: boolean;
  currentTime: number;
  updatedAt: number;
  route?: Record<string, string>;
};

type WatchRoom = {
  code: string;
  hostId: string;
  isPublic: boolean;
  title: string;
  image?: string;
  createdAt: number;
  members: Map<string, RoomMember>;
  state: RoomState;
  hostAway?: boolean;
  hostDisconnectedAt?: number;
  hostReconnectTimer?: NodeJS.Timeout | null;
};

type WatchSocket = {
  readyState: number;
  send: (data: string) => void;
  on: (event: 'message' | 'close', listener: (data?: unknown) => void) => void;
  close: () => void;
};

/**
 * Unified watch-party client. A client is backed by either a live WebSocket
 * (kind: 'ws') or an HTTP long/short-poll session (kind: 'http'). Room
 * membership, host transfer, playback sync and chat all operate on this
 * abstraction, so a WebSocket connection being blocked (e.g. by an adblocker)
 * does not break watch parties — the browser transparently falls back to HTTP
 * polling against the same endpoints.
 */
type WatchClient = {
  id: string;
  name: string;
  roomCode?: string;
  role?: 'host' | 'guest';
  kind: 'ws' | 'http';
  ws?: WatchSocket;
  queue: Array<Record<string, any>>;
  lastSeen: number;
};

const rooms = new Map<string, WatchRoom>();
const clients = new Map<string, WatchClient>();
const wsToClient = new Map<WatchSocket, string>();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HOST_RECONNECT_GRACE_MS = 12000;
const HTTP_CLIENT_STALE_MS = 30000;

function createRoomCode() {
  let code = '';
  do {
    code = Array.from(
      { length: 6 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join('');
  } while (rooms.has(code));
  return code;
}

function isClientConnected(client: WatchClient): boolean {
  if (client.kind === 'ws') {
    return !!client.ws && client.ws.readyState === WebSocket.OPEN;
  }
  return Date.now() - client.lastSeen < HTTP_CLIENT_STALE_MS;
}

function sendToClient(client: WatchClient, type: string, payload: Record<string, any> = {}) {
  if (client.kind === 'ws') {
    if (client.ws && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify({ type, ...payload }));
      } catch {
        // Socket died mid-send; close handling will clean it up.
      }
    }
  } else {
    client.queue.push({ type, ...payload });
  }
}

function publicRoomList() {
  return [...rooms.values()]
    .filter((room) => room.isPublic)
    .map((room) => ({
      code: room.code,
      title: room.title,
      image: room.image,
      hostName: room.members.get(room.hostId)?.name || 'Host',
      count: room.members.size,
      createdAt: room.createdAt,
    }));
}

function roomClients(code: string): WatchClient[] {
  return [...clients.values()].filter((client) => client.roomCode === code);
}

function broadcast(
  code: string,
  type: string,
  payload: Record<string, any> = {},
  exceptId?: string,
) {
  roomClients(code).forEach((client) => {
    if (client.id !== exceptId) sendToClient(client, type, payload);
  });
}

function broadcastPublicRooms() {
  const roomsPayload = publicRoomList();
  clients.forEach((client) =>
    sendToClient(client, 'rooms:public', { rooms: roomsPayload }),
  );
}

function getRoomStateSnapshot(room: WatchRoom): RoomState {
  const elapsedSeconds = room.state.paused
    ? 0
    : Math.max(0, (Date.now() - room.state.updatedAt) / 1000);
  return {
    ...room.state,
    currentTime: Math.max(0, Number(room.state.currentTime || 0) + elapsedSeconds),
    updatedAt: Date.now(),
  };
}

function normalizeMediaRoute(msg: any) {
  const source =
    typeof msg.params === 'object' && msg.params
      ? msg.params
      : typeof msg.route === 'object' && msg.route
        ? msg.route
        : {};
  const route: Record<string, string> = {};

  Object.entries(source).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const cleanKey = String(key || '').trim();
    const cleanValue = String(value || '').trim();
    if (!cleanKey || !cleanValue) return;
    route[cleanKey] = cleanValue;
  });

  if (typeof msg.url === 'string' && msg.url.trim()) {
    try {
      const parsed = new URL(msg.url, 'http://localhost');
      parsed.searchParams.forEach((value, key) => {
        if (value) route[key] = value;
      });
    } catch {
      // Ignore malformed URLs; route params above are still usable.
    }
  }

  return route;
}

function destroyRoom(code: string, reason = 'Host left the watch party') {
  const room = rooms.get(code);
  if (!room) return;
  broadcast(code, 'room:destroyed', { reason });
  roomClients(code).forEach((client) => {
    delete client.roomCode;
    delete client.role;
  });
  rooms.delete(code);
  broadcastPublicRooms();
}

function leaveClient(client: WatchClient, options: { immediateHostTransfer?: boolean } = {}) {
  if (!client?.roomCode) {
    console.log('[wp] leaveClient early return (no roomCode)');
    return;
  }
  console.log('[wp] leaveClient roomCode=%s role=%s hostId=%s client.id=%s', client.roomCode, client.role, rooms.get(client.roomCode)?.hostId, client.id);
  const room = rooms.get(client.roomCode);
  if (!room) return;

  // Explicit host leave should hand ownership off immediately.
  if (room.hostId === client.id) {
    room.members.delete(client.id);
    delete client.roomCode;
    delete client.role;
    if (options.immediateHostTransfer) {
      if (room.hostReconnectTimer) {
        clearTimeout(room.hostReconnectTimer);
        room.hostReconnectTimer = null;
      }
      const nextHost = [...room.members.values()][0];
      if (nextHost) {
        room.hostId = nextHost.id;
        room.hostAway = false;
        room.hostDisconnectedAt = undefined;
        nextHost.role = 'host';
        room.members.set(nextHost.id, nextHost);
        broadcast(room.code, 'host:transferred', { newHostId: nextHost.id, newHostName: nextHost.name });
        broadcast(room.code, 'room:members', {
          count: room.members.size,
          members: [...room.members.values()],
        });
        broadcastPublicRooms();
      } else {
        destroyRoom(room.code, 'Host left the watch party');
      }
      return;
    }

    // Give the host a short window to refresh/reconnect before promoting a guest.
    const pausedSnapshot = getRoomStateSnapshot(room);
    room.state = {
      ...room.state,
      currentTime: Number(pausedSnapshot.currentTime || 0) || 0,
      paused: true,
      updatedAt: Date.now(),
    };
    room.hostAway = true;
    room.hostDisconnectedAt = Date.now();
    broadcast(room.code, 'player:sync', { action: 'pause', ...getRoomStateSnapshot(room) });
    broadcast(room.code, 'host:away', { message: 'Host disconnected, reconnecting...' });
    room.hostReconnectTimer = setTimeout(() => {
      if (!room.hostAway) return;
      if (room.members.size === 0) {
        destroyRoom(room.code, 'Host did not reconnect');
        return;
      }
      const nextHost = [...room.members.values()][0];
      if (nextHost) {
        room.hostId = nextHost.id;
        room.hostAway = false;
        room.hostDisconnectedAt = undefined;
        room.hostReconnectTimer = null;
        broadcast(room.code, 'host:transferred', { newHostId: nextHost.id, newHostName: nextHost.name });
      } else {
        destroyRoom(room.code, 'All members left the watch party');
        return;
      }
      broadcast(room.code, 'room:members', {
        count: room.members.size,
        members: [...room.members.values()],
      });
      broadcastPublicRooms();
    }, HOST_RECONNECT_GRACE_MS);
    broadcast(room.code, 'room:members', {
      count: room.members.size,
      members: [...room.members.values()],
    });
    broadcastPublicRooms();
    return;
  }

  room.members.delete(client.id);
  delete client.roomCode;
  delete client.role;

  if (room.hostId === client.id) {
    const nextHost = [...room.members.values()][0];
    if (nextHost) {
      room.hostId = nextHost.id;
      broadcast(room.code, 'host:transferred', { newHostId: nextHost.id, newHostName: nextHost.name });
    } else {
      destroyRoom(room.code, 'All members left the watch party');
      return;
    }
  }

  broadcast(room.code, 'room:members', {
    count: room.members.size,
    members: [...room.members.values()],
  });
  broadcastPublicRooms();
}

function handleClientMessage(client: WatchClient, msg: any) {
  if (msg.type === 'rooms:list') {
    sendToClient(client, 'rooms:public', { rooms: publicRoomList() });
    return;
  }

  if (msg.type === 'room:create') {
    const code = createRoomCode();
    client.name = String(
      msg.name || client.name || `Host-${client.id.slice(0, 4).toUpperCase()}`,
    ).slice(0, 32);
    client.roomCode = code;
    client.role = 'host';

    const room: WatchRoom = {
      code,
      hostId: client.id,
      isPublic: Boolean(msg.isPublic),
      title: String(msg.title || 'Watch Party').slice(0, 120),
      image: String(msg.image || '').slice(0, 500) || undefined,
      createdAt: Date.now(),
      members: new Map([
        [client.id, { id: client.id, name: client.name, role: 'host' }],
      ]),
      state: {
        paused: typeof msg.paused === 'boolean' ? msg.paused : true,
        currentTime: Number(msg.currentTime || 0) || 0,
        updatedAt: Date.now(),
        route: typeof msg.route === 'object' && msg.route ? msg.route : undefined,
      },
    };

    rooms.set(code, room);
    sendToClient(client, 'room:created', {
      code,
      role: 'host',
      userId: client.id,
      room: {
        code,
        title: room.title,
        image: room.image,
        isPublic: room.isPublic,
        count: room.members.size,
      },
      state: getRoomStateSnapshot(room),
    });
    broadcastPublicRooms();
    return;
  }

  if (msg.type === 'room:join') {
    const code = String(msg.code || '')
      .trim()
      .toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      sendToClient(client, 'room:error', { message: 'Room not found' });
      return;
    }
    leaveClient(client, { immediateHostTransfer: true });
    client.name = String(msg.name || client.name).slice(0, 32);
    client.roomCode = code;

    const previousUserId = String(msg.previousUserId || '');
    const isSameHost = previousUserId && room.hostId === previousUserId;

    // When the host navigates from homepage to player, the old WS may still be
    // connected (room.hostAway === false).  Force-disconnect it so we can take
    // over as host instead of being treated as a new guest.
    if (isSameHost && !room.hostAway) {
        console.log('[wp] sameHost, hostAway=false, force-disconnecting old client');
        for (const [otherId, other] of clients) {
            if (other.id === previousUserId && other.id !== client.id) {
                console.log('[wp] found old host client, closing and deleting');
                if (other.kind === 'ws' && other.ws) {
                    try { other.ws.close(); } catch (e) { console.log('[wp] ws.close error', e); }
                }
                if (other.ws && wsToClient.has(other.ws)) wsToClient.delete(other.ws);
                clients.delete(otherId);
                break;
            }
        }
    } else {
        console.log('[wp] isSameHost=%s hostAway=%s prevUserId=%s room.hostId=%s', isSameHost, room.hostAway, previousUserId, room.hostId);
    }

    const isHostReconnect = isSameHost;

    if (isHostReconnect) {
        console.log('[wp] host reconnection path (isHostReconnect=true)');
      // Remove the old host entry (disconnected), add new client as host
      room.members.delete(room.hostId);
      client.role = 'host';
      room.hostId = client.id;
      room.members.set(client.id, { id: client.id, name: client.name, role: 'host' });
      if (room.hostReconnectTimer) clearTimeout(room.hostReconnectTimer);
      room.hostAway = false;
      room.hostDisconnectedAt = undefined;
      room.hostReconnectTimer = null;

      sendToClient(client, 'room:joined', {
        code,
        role: 'host',
        userId: client.id,
        room: {
          code,
          title: room.title,
          image: room.image,
          isPublic: room.isPublic,
          count: room.members.size,
        },
        state: getRoomStateSnapshot(room),
        members: [...room.members.values()],
      });
      broadcast(code, 'host:reconnected', { name: client.name });
    } else {
      client.role = 'guest';

      // Remove stale member entry from a previous page refresh (old WebSocket
      // whose close event hasn't fired yet on the server)
      if (previousUserId) {
        room.members.delete(previousUserId);
      }

      room.members.set(client.id, { id: client.id, name: client.name, role: 'guest' });

      sendToClient(client, 'room:joined', {
        code,
        role: 'guest',
        userId: client.id,
        room: {
          code,
          title: room.title,
          image: room.image,
          isPublic: room.isPublic,
          count: room.members.size,
        },
        state: getRoomStateSnapshot(room),
        members: [...room.members.values()],
      });
    }

    broadcast(code, 'room:members', {
      count: room.members.size,
      members: [...room.members.values()],
    });
    broadcastPublicRooms();
    return;
  }

  if (msg.type === 'room:leave') {
    leaveClient(client, { immediateHostTransfer: true });
    sendToClient(client, 'room:left');
    return;
  }

  if (msg.type === 'room:claim-host') {
    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    if (!room || !room.hostAway) return;
    if (room.hostId === client.id) return;
    if (!room.members.has(client.id)) return;
    if (room.hostReconnectTimer) {
      clearTimeout(room.hostReconnectTimer);
      room.hostReconnectTimer = null;
    }
    const claimant = room.members.get(client.id);
    if (!claimant) return;
    room.hostId = client.id;
    client.role = 'host';
    claimant.role = 'host';
    room.members.set(client.id, claimant);
    room.hostAway = false;
    room.hostDisconnectedAt = undefined;
    broadcast(room.code, 'host:transferred', { newHostId: client.id, newHostName: client.name });
    broadcast(room.code, 'room:members', {
      count: room.members.size,
      members: [...room.members.values()],
    });
    broadcastPublicRooms();
    return;
  }

  if (msg.type === 'host:navigating-home') {
    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    if (!room || room.hostId !== client.id) return;
    room.title = 'Watch Party';
    room.image = '';
    room.state.route = undefined;
    room.state.currentTime = 0;
    room.state.paused = true;
    room.state.updatedAt = Date.now();
     broadcast(client.roomCode || '', 'host:navigated-home', { code: client.roomCode || '' }, client.id);
    broadcastPublicRooms();
    return;
  }

  if (msg.type === 'host:promote') {
    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    if (!room || room.hostId !== client.id || room.hostAway) return;
    const targetId = String(msg.targetUserId || '');
    const target = room.members.get(targetId);
    if (!target || target.role !== 'guest') return;
    const oldHostEntry = room.members.get(room.hostId);
    if (oldHostEntry) oldHostEntry.role = 'guest';
    room.hostId = targetId;
    target.role = 'host';
    broadcast(room.code, 'host:transferred', { newHostId: targetId, newHostName: target.name });
    broadcast(room.code, 'room:members', {
      count: room.members.size,
      members: [...room.members.values()],
    });
    return;
  }

  if (msg.type === 'host:kick') {
    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    if (!room || room.hostId !== client.id || room.hostAway) return;
    const targetId = String(msg.targetUserId || '');
    if (!targetId || targetId === room.hostId) return;
    const kickedClient = clients.get(targetId);
    if (kickedClient) {
      delete kickedClient.roomCode;
      delete kickedClient.role;
      sendToClient(kickedClient, 'room:kicked', { message: 'You have been removed from the room by the host.' });
      if (kickedClient.kind === 'ws' && kickedClient.ws) {
        kickedClient.ws.close();
      }
    }
    room.members.delete(targetId);
    broadcast(room.code, 'room:members', {
      count: room.members.size,
      members: [...room.members.values()],
    });
    broadcastPublicRooms();
    if (room.members.size === 0) {
      destroyRoom(room.code, 'All members left the watch party');
    }
    return;
  }

  if (msg.type === 'host:state') {
    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    if (!room || room.hostId !== client.id) return;
    const action = ['play', 'pause', 'seek', 'route'].includes(msg.action)
      ? msg.action
      : 'seek';
    const paused =
      action === 'play'
        ? false
        : action === 'pause'
          ? true
          : typeof msg.paused === 'boolean'
            ? msg.paused
            : room.state.paused;
    room.state = {
      paused,
      currentTime: Number(msg.currentTime || 0) || 0,
      updatedAt: Date.now(),
      route:
        typeof msg.route === 'object' && msg.route ? msg.route : room.state.route,
    };
    broadcast(
      room.code,
      'player:sync',
      { action, ...getRoomStateSnapshot(room) },
      client.id,
    );
    return;
  }

  if (msg.type === 'host:control') {
    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    if (!room || room.hostId !== client.id) return;
    broadcast(
      room.code,
      'control:sync',
      {
        control: String(msg.control || ''),
        value: msg.value,
        currentTime: Number(msg.currentTime || 0) || 0,
        timestamp: Date.now(),
      },
      client.id,
    );
    return;
  }

  if (msg.type === 'change_media') {
    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    if (!room || room.hostId !== client.id) return;

    const route = normalizeMediaRoute(msg);
    const currentTime = Number(msg.currentTime || route.t || 0) || 0;
    const paused = typeof msg.paused === 'boolean' ? msg.paused : room.state.paused;

    room.state = {
      paused,
      currentTime,
      updatedAt: Date.now(),
      route: Object.keys(route).length ? route : room.state.route,
    };

    if (typeof msg.title === 'string') {
      room.title = String(msg.title || 'Watch Party').slice(0, 120);
    }
    if (typeof msg.image === 'string') {
      room.image = String(msg.image || '').slice(0, 500) || undefined;
    }

    broadcast(
      room.code,
      'media_changed',
      {
        url: typeof msg.url === 'string' ? msg.url : '',
        params: route,
        currentTime: getRoomStateSnapshot(room).currentTime,
        paused,
        timestamp: Date.now(),
        updatedAt: room.state.updatedAt,
      },
      client.id,
    );
    broadcastPublicRooms();
    return;
  }

  if (msg.type === 'chat:send') {
    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    const text = String(msg.text || '')
      .trim()
      .slice(0, 500);
    if (!room || !text) return;
    broadcast(room.code, 'chat:message', {
      id: `${Date.now()}-${client.id}`,
      userId: client.id,
      name: client.name,
      text,
      timestamp: Date.now(),
    });
  }
}

function getOrCreateHttpClient(clientId: string): WatchClient {
  let client = clients.get(clientId);
  if (!client) {
    client = {
      id: clientId,
      name: `Guest-${clientId.slice(0, 4).toUpperCase()}`,
      kind: 'http',
      queue: [],
      lastSeen: Date.now(),
    };
    clients.set(clientId, client);
    client.queue.push({ type: 'rooms:public', rooms: publicRoomList() });
  }
  client.lastSeen = Date.now();
  return client;
}

export function registerWatchTogether(fastify: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true });

  fastify.get('/watch-party/public', async () => ({ rooms: publicRoomList() }));

  fastify.get('/watch-party/poll', async (request: any) => {
    const clientId = String(request?.query?.clientId || '').slice(0, 64);
    if (!clientId) {
      return { ok: false, message: 'Missing clientId' };
    }
    const client = getOrCreateHttpClient(clientId);
    const events = client.queue.splice(0);
    return { ok: true, events };
  });

  fastify.post('/watch-party/action', async (request: any, reply: any) => {
    const body = (request?.body as any) || {};
    const clientId = String(body.clientId || '').slice(0, 64);
    if (!clientId) {
      return reply.code(400).send({ ok: false, message: 'Missing clientId' });
    }
    const client = getOrCreateHttpClient(clientId);
    if (body.name) client.name = String(body.name).slice(0, 32);
    const msg = { ...body };
    delete msg.clientId;
    delete msg.name;
    handleClientMessage(client, msg);
    return { ok: true };
  });

  fastify.server.on('upgrade', (request: any, socket: any, head: any) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname !== '/watch-party/ws') return;
    wss.handleUpgrade(request, socket, head, (ws: WatchSocket) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (socket: WatchSocket) => {
    const client: WatchClient = {
      id: Math.random().toString(36).slice(2, 10),
      name: `Guest-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      kind: 'ws',
      ws: socket,
      queue: [],
      lastSeen: Date.now(),
    };
    clients.set(client.id, client);
    wsToClient.set(socket, client.id);
    sendToClient(client, 'rooms:public', { rooms: publicRoomList() });

    socket.on('message', (raw: unknown) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw || '{}'));
      } catch {
        return;
      }
      handleClientMessage(client, msg);
    });

    socket.on('close', () => {
      console.log('[wp] socket close event');
      leaveClient(client);
      if (wsToClient.get(socket) === client.id) wsToClient.delete(socket);
      clients.delete(client.id);
    });
  });

  // Periodic cleanup: destroy stale/empty rooms and drop dead HTTP-poll clients
  setInterval(() => {
    const now = Date.now();
    clients.forEach((client, clientId) => {
      if (client.kind === 'http' && now - client.lastSeen > HTTP_CLIENT_STALE_MS) {
        console.log('[wp] http client stale, removing', clientId);
        leaveClient(client);
        clients.delete(clientId);
      }
    });
    rooms.forEach((room, code) => {
      // Destroy rooms with no members
      if (room.members.size === 0) {
        destroyRoom(code, 'Room closed (no members)');
        return;
      }
      // Destroy rooms where host has been away > 2 min with no guests
      if (room.hostAway && room.hostDisconnectedAt && membersExceptHost(room).length === 0) {
        if (now - room.hostDisconnectedAt > 120000) {
          destroyRoom(code, 'Room closed (host away)');
          return;
        }
      }
      // Destroy rooms older than 24 hours
      if (now - room.createdAt > 86400000) {
        destroyRoom(code, 'Room expired (max 24 hours)');
      }
    });
  }, 10000);
}

function membersExceptHost(room: WatchRoom): RoomMember[] {
  return [...room.members.values()].filter((m) => m.id !== room.hostId);
}