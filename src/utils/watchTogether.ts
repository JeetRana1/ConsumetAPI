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
  createdAt: number;
  members: Map<string, RoomMember>;
  state: RoomState;
};

type ClientState = {
  id: string;
  name: string;
  roomCode?: string;
  role?: 'host' | 'guest';
};

type WatchSocket = {
  readyState: number;
  send: (data: string) => void;
  on: (event: 'message' | 'close', listener: (data?: unknown) => void) => void;
};

const rooms = new Map<string, WatchRoom>();
const clients = new Map<WatchSocket, ClientState>();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function createRoomCode() {
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function send(ws: WatchSocket, type: string, payload: Record<string, any> = {}) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function publicRoomList() {
  return [...rooms.values()]
    .filter((room) => room.isPublic)
    .map((room) => ({
      code: room.code,
      title: room.title,
      count: room.members.size,
      createdAt: room.createdAt,
    }));
}

function roomSockets(code: string) {
  return [...clients.entries()].filter(([, state]) => state.roomCode === code).map(([socket]) => socket);
}

function broadcast(code: string, type: string, payload: Record<string, any> = {}, except?: WatchSocket) {
  roomSockets(code).forEach((socket) => {
    if (socket !== except) send(socket, type, payload);
  });
}

function broadcastPublicRooms() {
  const roomsPayload = publicRoomList();
  clients.forEach((_state, socket) => send(socket, 'rooms:public', { rooms: roomsPayload }));
}

function getRoomStateSnapshot(room: WatchRoom): RoomState {
  const elapsedSeconds = room.state.paused ? 0 : Math.max(0, (Date.now() - room.state.updatedAt) / 1000);
  return {
    ...room.state,
    currentTime: Math.max(0, Number(room.state.currentTime || 0) + elapsedSeconds),
    updatedAt: Date.now(),
  };
}

function normalizeMediaRoute(msg: any) {
  const source = typeof msg.params === 'object' && msg.params
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
  roomSockets(code).forEach((socket) => {
    const state = clients.get(socket);
    if (state) {
      delete state.roomCode;
      delete state.role;
    }
  });
  rooms.delete(code);
  broadcastPublicRooms();
}

function leaveRoom(socket: WatchSocket) {
  const state = clients.get(socket);
  if (!state?.roomCode) return;
  const room = rooms.get(state.roomCode);
  if (!room) return;

  if (room.hostId === state.id) {
    destroyRoom(room.code);
    return;
  }

  room.members.delete(state.id);
  broadcast(room.code, 'room:members', { count: room.members.size, members: [...room.members.values()] });
  delete state.roomCode;
  delete state.role;
  broadcastPublicRooms();
}

export function registerWatchTogether(fastify: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true });

  fastify.get('/watch-party/public', async () => ({ rooms: publicRoomList() }));

  fastify.server.on('upgrade', (request: any, socket: any, head: any) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname !== '/watch-party/ws') return;
    wss.handleUpgrade(request, socket, head, (ws: WatchSocket) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (socket: WatchSocket) => {
    const state: ClientState = {
      id: Math.random().toString(36).slice(2, 10),
      name: `Guest-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    };
    clients.set(socket, state);
    send(socket, 'rooms:public', { rooms: publicRoomList() });

    socket.on('message', (raw: unknown) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw || '{}'));
      } catch {
        return;
      }

      if (msg.type === 'rooms:list') {
        send(socket, 'rooms:public', { rooms: publicRoomList() });
        return;
      }

      if (msg.type === 'room:create') {
        const code = createRoomCode();
        state.name = String(msg.name || `Host-${state.id.slice(0, 4).toUpperCase()}`).slice(0, 32);
        state.roomCode = code;
        state.role = 'host';

        const room: WatchRoom = {
          code,
          hostId: state.id,
          isPublic: Boolean(msg.isPublic),
          title: String(msg.title || 'Watch Party').slice(0, 120),
          createdAt: Date.now(),
          members: new Map([[state.id, { id: state.id, name: state.name, role: 'host' }]]),
          state: {
            paused: typeof msg.paused === 'boolean' ? msg.paused : true,
            currentTime: Number(msg.currentTime || 0) || 0,
            updatedAt: Date.now(),
            route: typeof msg.route === 'object' && msg.route ? msg.route : undefined,
          },
        };

        rooms.set(code, room);
        send(socket, 'room:created', {
          code,
          role: 'host',
          room: { code, title: room.title, isPublic: room.isPublic, count: room.members.size },
          state: getRoomStateSnapshot(room),
        });
        broadcastPublicRooms();
        return;
      }

      if (msg.type === 'room:join') {
        const code = String(msg.code || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          send(socket, 'room:error', { message: 'Room not found' });
          return;
        }
        leaveRoom(socket);
        state.name = String(msg.name || state.name).slice(0, 32);
        state.roomCode = code;
        state.role = 'guest';
        room.members.set(state.id, { id: state.id, name: state.name, role: 'guest' });
        send(socket, 'room:joined', {
          code,
          role: 'guest',
          room: { code, title: room.title, isPublic: room.isPublic, count: room.members.size },
          state: getRoomStateSnapshot(room),
          members: [...room.members.values()],
        });
        broadcast(code, 'room:members', { count: room.members.size, members: [...room.members.values()] });
        broadcastPublicRooms();
        return;
      }

      if (msg.type === 'room:leave') {
        leaveRoom(socket);
        send(socket, 'room:left');
        return;
      }

      if (msg.type === 'host:state') {
        const room = state.roomCode ? rooms.get(state.roomCode) : null;
        if (!room || room.hostId !== state.id) return;
        const action = ['play', 'pause', 'seek', 'route'].includes(msg.action) ? msg.action : 'seek';
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
          route: typeof msg.route === 'object' && msg.route ? msg.route : room.state.route,
        };
        broadcast(room.code, 'player:sync', { action, ...getRoomStateSnapshot(room) }, socket);
        return;
      }

      if (msg.type === 'host:control') {
        const room = state.roomCode ? rooms.get(state.roomCode) : null;
        if (!room || room.hostId !== state.id) return;
        broadcast(
          room.code,
          'control:sync',
          {
            control: String(msg.control || ''),
            value: msg.value,
            currentTime: Number(msg.currentTime || 0) || 0,
            timestamp: Date.now(),
          },
          socket
        );
        return;
      }

      if (msg.type === 'change_media') {
        const room = state.roomCode ? rooms.get(state.roomCode) : null;
        if (!room || room.hostId !== state.id) return;

        const route = normalizeMediaRoute(msg);
        const currentTime = Number(msg.currentTime || route.t || 0) || 0;
        const paused = typeof msg.paused === 'boolean' ? msg.paused : room.state.paused;

        room.state = {
          paused,
          currentTime,
          updatedAt: Date.now(),
          route: Object.keys(route).length ? route : room.state.route,
        };

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
          socket
        );
        return;
      }

      if (msg.type === 'chat:send') {
        const room = state.roomCode ? rooms.get(state.roomCode) : null;
        const text = String(msg.text || '').trim().slice(0, 500);
        if (!room || !text) return;
        broadcast(room.code, 'chat:message', {
          id: `${Date.now()}-${state.id}`,
          userId: state.id,
          name: state.name,
          text,
          timestamp: Date.now(),
        });
      }
    });

    socket.on('close', () => {
      leaveRoom(socket);
      clients.delete(socket);
    });
  });
}
