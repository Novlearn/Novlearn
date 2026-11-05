import "dotenv/config";
import { defineServer, defineRoom } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DuelRoom } from "./rooms/DuelRoom";

const PORT = parseInt(process.env.PORT ?? "2567");

const server = defineServer({
  transport: new WebSocketTransport({
    pingInterval: 10_000,
    pingMaxRetries: 3,
  }),
  rooms: {
    /**
     * filterBy(["duelId"]) ensures one room per duel:
     * both players joinOrCreate("duel_room", { duelId }) and land in the same room.
     */
    duel_room: defineRoom(DuelRoom).filterBy(["duelId"]),
  },
});

server.listen(PORT, process.env.NOVLEARN_ENGINE_ENABLED === "true" ? "127.0.0.1" : undefined).then(() => {
  console.log(`[Colyseus] Duel server running on port ${PORT}`);
});
