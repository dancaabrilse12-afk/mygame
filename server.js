const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let players = {};

io.on("connection", (socket) => {
  console.log("Jugador conectado:", socket.id);

  players[socket.id] = { x: 0, y: 0 };

  socket.on("move", (data) => {
    players[socket.id] = data;
    io.emit("players", players);
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("players", players);
  });
});

server.listen(3000, () => {
  console.log("Servidor corriendo");
});
