"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var watchTogether_exports = {};
__export(watchTogether_exports, {
  registerWatchTogether: () => registerWatchTogether
});
module.exports = __toCommonJS(watchTogether_exports);
const { WebSocketServer, WebSocket } = require("ws");
const rooms = /* @__PURE__ */ new Map();
const clients = /* @__PURE__ */ new Map();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const HOST_RECONNECT_GRACE_MS = 12e3;
function createRoomCode() {
  let code = "";
  do {
    code = Array.from(
      { length: 6 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}
function send(ws, type, payload = {}) {
  if (ws.readyState !== WebSocket.OPEN)
    return;
  ws.send(JSON.stringify({ type, ...payload }));
}
function publicRoomList() {
  return [...rooms.values()].filter((room) => room.isPublic).map((room) => ({
    code: room.code,
    title: room.title,
    image: room.image,
    hostName: room.members.get(room.hostId)?.name || "Host",
    count: room.members.size,
    createdAt: room.createdAt
  }));
}
function roomSockets(code) {
  return [...clients.entries()].filter(([, state]) => state.roomCode === code).map(([socket]) => socket);
}
function broadcast(code, type, payload = {}, except) {
  roomSockets(code).forEach((socket) => {
    if (socket !== except)
      send(socket, type, payload);
  });
}
function broadcastPublicRooms() {
  const roomsPayload = publicRoomList();
  clients.forEach(
    (_state, socket) => send(socket, "rooms:public", { rooms: roomsPayload })
  );
}
function getRoomStateSnapshot(room) {
  const elapsedSeconds = room.state.paused ? 0 : Math.max(0, (Date.now() - room.state.updatedAt) / 1e3);
  return {
    ...room.state,
    currentTime: Math.max(0, Number(room.state.currentTime || 0) + elapsedSeconds),
    updatedAt: Date.now()
  };
}
function normalizeMediaRoute(msg) {
  const source = typeof msg.params === "object" && msg.params ? msg.params : typeof msg.route === "object" && msg.route ? msg.route : {};
  const route = {};
  Object.entries(source).forEach(([key, value]) => {
    if (value === void 0 || value === null)
      return;
    const cleanKey = String(key || "").trim();
    const cleanValue = String(value || "").trim();
    if (!cleanKey || !cleanValue)
      return;
    route[cleanKey] = cleanValue;
  });
  if (typeof msg.url === "string" && msg.url.trim()) {
    try {
      const parsed = new URL(msg.url, "http://localhost");
      parsed.searchParams.forEach((value, key) => {
        if (value)
          route[key] = value;
      });
    } catch {
    }
  }
  return route;
}
function destroyRoom(code, reason = "Host left the watch party") {
  const room = rooms.get(code);
  if (!room)
    return;
  broadcast(code, "room:destroyed", { reason });
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
function leaveRoom(socket, options = {}) {
  const state = clients.get(socket);
  if (!state?.roomCode) {
    console.log("[wp] leaveRoom early return (no state or no roomCode)");
    return;
  }
  console.log("[wp] leaveRoom roomCode=%s role=%s hostId=%s state.id=%s", state.roomCode, state.role, rooms.get(state.roomCode)?.hostId, state.id);
  const room = rooms.get(state.roomCode);
  if (!room)
    return;
  if (room.hostId === state.id) {
    room.members.delete(state.id);
    delete state.roomCode;
    delete state.role;
    if (options.immediateHostTransfer) {
      if (room.hostReconnectTimer) {
        clearTimeout(room.hostReconnectTimer);
        room.hostReconnectTimer = null;
      }
      const nextHost = [...room.members.values()][0];
      if (nextHost) {
        room.hostId = nextHost.id;
        room.hostAway = false;
        room.hostDisconnectedAt = void 0;
        nextHost.role = "host";
        room.members.set(nextHost.id, nextHost);
        broadcast(room.code, "host:transferred", { newHostId: nextHost.id, newHostName: nextHost.name });
        broadcast(room.code, "room:members", {
          count: room.members.size,
          members: [...room.members.values()]
        });
        broadcastPublicRooms();
      } else {
        destroyRoom(room.code, "Host left the watch party");
      }
      return;
    }
    const pausedSnapshot = getRoomStateSnapshot(room);
    room.state = {
      ...room.state,
      currentTime: Number(pausedSnapshot.currentTime || 0) || 0,
      paused: true,
      updatedAt: Date.now()
    };
    room.hostAway = true;
    room.hostDisconnectedAt = Date.now();
    broadcast(room.code, "player:sync", { action: "pause", ...getRoomStateSnapshot(room) });
    broadcast(room.code, "host:away", { message: "Host disconnected, reconnecting..." });
    room.hostReconnectTimer = setTimeout(() => {
      if (!room.hostAway)
        return;
      if (room.members.size === 0) {
        destroyRoom(room.code, "Host did not reconnect");
        return;
      }
      const nextHost = [...room.members.values()][0];
      if (nextHost) {
        room.hostId = nextHost.id;
        room.hostAway = false;
        room.hostDisconnectedAt = void 0;
        room.hostReconnectTimer = null;
        broadcast(room.code, "host:transferred", { newHostId: nextHost.id, newHostName: nextHost.name });
      } else {
        destroyRoom(room.code, "All members left the watch party");
        return;
      }
      broadcast(room.code, "room:members", {
        count: room.members.size,
        members: [...room.members.values()]
      });
      broadcastPublicRooms();
    }, HOST_RECONNECT_GRACE_MS);
    broadcast(room.code, "room:members", {
      count: room.members.size,
      members: [...room.members.values()]
    });
    broadcastPublicRooms();
    return;
  }
  room.members.delete(state.id);
  delete state.roomCode;
  delete state.role;
  if (room.hostId === state.id) {
    const nextHost = [...room.members.values()][0];
    if (nextHost) {
      room.hostId = nextHost.id;
      broadcast(room.code, "host:transferred", { newHostId: nextHost.id, newHostName: nextHost.name });
    } else {
      destroyRoom(room.code, "All members left the watch party");
      return;
    }
  }
  broadcast(room.code, "room:members", {
    count: room.members.size,
    members: [...room.members.values()]
  });
  broadcastPublicRooms();
}
function registerWatchTogether(fastify) {
  const wss = new WebSocketServer({ noServer: true });
  fastify.get("/watch-party/public", async () => ({ rooms: publicRoomList() }));
  fastify.server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (pathname !== "/watch-party/ws")
      return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });
  wss.on("connection", (socket) => {
    const state = {
      id: Math.random().toString(36).slice(2, 10),
      name: `Guest-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    };
    clients.set(socket, state);
    send(socket, "rooms:public", { rooms: publicRoomList() });
    socket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw || "{}"));
      } catch {
        return;
      }
      if (msg.type === "rooms:list") {
        send(socket, "rooms:public", { rooms: publicRoomList() });
        return;
      }
      if (msg.type === "room:create") {
        const code = createRoomCode();
        state.name = String(
          msg.name || `Host-${state.id.slice(0, 4).toUpperCase()}`
        ).slice(0, 32);
        state.roomCode = code;
        state.role = "host";
        const room = {
          code,
          hostId: state.id,
          isPublic: Boolean(msg.isPublic),
          title: String(msg.title || "Watch Party").slice(0, 120),
          image: String(msg.image || "").slice(0, 500) || void 0,
          createdAt: Date.now(),
          members: /* @__PURE__ */ new Map([
            [state.id, { id: state.id, name: state.name, role: "host" }]
          ]),
          state: {
            paused: typeof msg.paused === "boolean" ? msg.paused : true,
            currentTime: Number(msg.currentTime || 0) || 0,
            updatedAt: Date.now(),
            route: typeof msg.route === "object" && msg.route ? msg.route : void 0
          }
        };
        rooms.set(code, room);
        send(socket, "room:created", {
          code,
          role: "host",
          userId: state.id,
          room: {
            code,
            title: room.title,
            image: room.image,
            isPublic: room.isPublic,
            count: room.members.size
          },
          state: getRoomStateSnapshot(room)
        });
        broadcastPublicRooms();
        return;
      }
      if (msg.type === "room:join") {
        const code = String(msg.code || "").trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          send(socket, "room:error", { message: "Room not found" });
          return;
        }
        leaveRoom(socket, { immediateHostTransfer: true });
        state.name = String(msg.name || state.name).slice(0, 32);
        state.roomCode = code;
        const previousUserId = String(msg.previousUserId || "");
        const isSameHost = previousUserId && room.hostId === previousUserId;
        if (isSameHost && !room.hostAway) {
          console.log("[wp] sameHost, hostAway=false, force-disconnecting old socket");
          for (const [sock, st] of clients) {
            if (st.id === previousUserId && sock !== socket) {
              console.log("[wp] found old host socket, closing and deleting");
              try {
                sock.close();
              } catch (e) {
                console.log("[wp] sock.close error", e);
              }
              clients.delete(sock);
              break;
            }
          }
        } else {
          console.log("[wp] isSameHost=%s hostAway=%s prevUserId=%s room.hostId=%s", isSameHost, room.hostAway, previousUserId, room.hostId);
        }
        const isHostReconnect = isSameHost;
        if (isHostReconnect) {
          console.log("[wp] host reconnection path (isHostReconnect=true)");
          room.members.delete(room.hostId);
          state.role = "host";
          room.hostId = state.id;
          room.members.set(state.id, { id: state.id, name: state.name, role: "host" });
          if (room.hostReconnectTimer)
            clearTimeout(room.hostReconnectTimer);
          room.hostAway = false;
          room.hostDisconnectedAt = void 0;
          room.hostReconnectTimer = null;
          send(socket, "room:joined", {
            code,
            role: "host",
            userId: state.id,
            room: {
              code,
              title: room.title,
              image: room.image,
              isPublic: room.isPublic,
              count: room.members.size
            },
            state: getRoomStateSnapshot(room),
            members: [...room.members.values()]
          });
          broadcast(code, "host:reconnected", { name: state.name });
        } else {
          state.role = "guest";
          if (previousUserId) {
            room.members.delete(previousUserId);
          }
          room.members.set(state.id, { id: state.id, name: state.name, role: "guest" });
          send(socket, "room:joined", {
            code,
            role: "guest",
            userId: state.id,
            room: {
              code,
              title: room.title,
              image: room.image,
              isPublic: room.isPublic,
              count: room.members.size
            },
            state: getRoomStateSnapshot(room),
            members: [...room.members.values()]
          });
        }
        broadcast(code, "room:members", {
          count: room.members.size,
          members: [...room.members.values()]
        });
        broadcastPublicRooms();
        return;
      }
      if (msg.type === "room:leave") {
        leaveRoom(socket, { immediateHostTransfer: true });
        send(socket, "room:left");
        return;
      }
      if (msg.type === "room:claim-host") {
        const room = state.roomCode ? rooms.get(state.roomCode) : null;
        if (!room || !room.hostAway)
          return;
        if (room.hostId === state.id)
          return;
        if (!room.members.has(state.id))
          return;
        if (room.hostReconnectTimer) {
          clearTimeout(room.hostReconnectTimer);
          room.hostReconnectTimer = null;
        }
        const claimant = room.members.get(state.id);
        if (!claimant)
          return;
        room.hostId = state.id;
        state.role = "host";
        claimant.role = "host";
        room.members.set(state.id, claimant);
        room.hostAway = false;
        room.hostDisconnectedAt = void 0;
        broadcast(room.code, "host:transferred", { newHostId: state.id, newHostName: state.name });
        broadcast(room.code, "room:members", {
          count: room.members.size,
          members: [...room.members.values()]
        });
        broadcastPublicRooms();
        return;
      }
      if (msg.type === "host:navigating-home") {
        const room = state.roomCode ? rooms.get(state.roomCode) : null;
        if (!room || room.hostId !== state.id)
          return;
        room.title = "Watch Party";
        room.image = "";
        room.state.route = void 0;
        room.state.currentTime = 0;
        room.state.paused = true;
        room.state.updatedAt = Date.now();
        broadcast(state.roomCode, "host:navigated-home", { code: state.roomCode }, socket);
        broadcastPublicRooms();
        return;
      }
      if (msg.type === "host:promote") {
        const room = state.roomCode ? rooms.get(state.roomCode) : null;
        if (!room || room.hostId !== state.id || room.hostAway)
          return;
        const targetId = String(msg.targetUserId || "");
        const target = room.members.get(targetId);
        if (!target || target.role !== "guest")
          return;
        const oldHostEntry = room.members.get(room.hostId);
        if (oldHostEntry)
          oldHostEntry.role = "guest";
        room.hostId = targetId;
        target.role = "host";
        broadcast(room.code, "host:transferred", { newHostId: targetId, newHostName: target.name });
        broadcast(room.code, "room:members", {
          count: room.members.size,
          members: [...room.members.values()]
        });
        return;
      }
      if (msg.type === "host:kick") {
        const room = state.roomCode ? rooms.get(state.roomCode) : null;
        if (!room || room.hostId !== state.id || room.hostAway)
          return;
        const targetId = String(msg.targetUserId || "");
        if (!targetId || targetId === room.hostId)
          return;
        const kickedSocket = [...clients.entries()].find(([, s]) => s.roomCode === room.code && s.id === targetId)?.[0];
        if (kickedSocket) {
          const kickedState = clients.get(kickedSocket);
          if (kickedState) {
            delete kickedState.roomCode;
            delete kickedState.role;
          }
          send(kickedSocket, "room:kicked", { message: "You have been removed from the room by the host." });
          kickedSocket.close();
        }
        room.members.delete(targetId);
        broadcast(room.code, "room:members", {
          count: room.members.size,
          members: [...room.members.values()]
        });
        broadcastPublicRooms();
        if (room.members.size === 0) {
          destroyRoom(room.code, "All members left the watch party");
        }
        return;
      }
      if (msg.type === "host:state") {
        const room = state.roomCode ? rooms.get(state.roomCode) : null;
        if (!room || room.hostId !== state.id)
          return;
        const action = ["play", "pause", "seek", "route"].includes(msg.action) ? msg.action : "seek";
        const paused = action === "play" ? false : action === "pause" ? true : typeof msg.paused === "boolean" ? msg.paused : room.state.paused;
        room.state = {
          paused,
          currentTime: Number(msg.currentTime || 0) || 0,
          updatedAt: Date.now(),
          route: typeof msg.route === "object" && msg.route ? msg.route : room.state.route
        };
        broadcast(
          room.code,
          "player:sync",
          { action, ...getRoomStateSnapshot(room) },
          socket
        );
        return;
      }
      if (msg.type === "host:control") {
        const room = state.roomCode ? rooms.get(state.roomCode) : null;
        if (!room || room.hostId !== state.id)
          return;
        broadcast(
          room.code,
          "control:sync",
          {
            control: String(msg.control || ""),
            value: msg.value,
            currentTime: Number(msg.currentTime || 0) || 0,
            timestamp: Date.now()
          },
          socket
        );
        return;
      }
      if (msg.type === "change_media") {
        const room = state.roomCode ? rooms.get(state.roomCode) : null;
        if (!room || room.hostId !== state.id)
          return;
        const route = normalizeMediaRoute(msg);
        const currentTime = Number(msg.currentTime || route.t || 0) || 0;
        const paused = typeof msg.paused === "boolean" ? msg.paused : room.state.paused;
        room.state = {
          paused,
          currentTime,
          updatedAt: Date.now(),
          route: Object.keys(route).length ? route : room.state.route
        };
        if (typeof msg.title === "string") {
          room.title = String(msg.title || "Watch Party").slice(0, 120);
        }
        if (typeof msg.image === "string") {
          room.image = String(msg.image || "").slice(0, 500) || void 0;
        }
        broadcast(
          room.code,
          "media_changed",
          {
            url: typeof msg.url === "string" ? msg.url : "",
            params: route,
            currentTime: getRoomStateSnapshot(room).currentTime,
            paused,
            timestamp: Date.now(),
            updatedAt: room.state.updatedAt
          },
          socket
        );
        broadcastPublicRooms();
        return;
      }
      if (msg.type === "chat:send") {
        const room = state.roomCode ? rooms.get(state.roomCode) : null;
        const text = String(msg.text || "").trim().slice(0, 500);
        if (!room || !text)
          return;
        broadcast(room.code, "chat:message", {
          id: `${Date.now()}-${state.id}`,
          userId: state.id,
          name: state.name,
          text,
          timestamp: Date.now()
        });
      }
    });
    socket.on("close", () => {
      console.log("[wp] socket close event");
      leaveRoom(socket);
      clients.delete(socket);
    });
  });
  setInterval(() => {
    const now = Date.now();
    rooms.forEach((room, code) => {
      if (room.members.size === 0) {
        destroyRoom(code, "Room closed (no members)");
        return;
      }
      if (room.hostAway && room.hostDisconnectedAt && membersExceptHost(room).length === 0) {
        if (now - room.hostDisconnectedAt > 12e4) {
          destroyRoom(code, "Room closed (host away)");
          return;
        }
      }
      if (now - room.createdAt > 864e5) {
        destroyRoom(code, "Room expired (max 24 hours)");
      }
    });
  }, 1e4);
}
function membersExceptHost(room) {
  return [...room.members.values()].filter((m) => m.id !== room.hostId);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  registerWatchTogether
});
