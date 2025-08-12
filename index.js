const routes = require("./routes");
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const port = 5000;

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "http://localhost:8100", // Ionic dev server default port
    methods: ["GET", "POST"]
  }
});

// Store io instance in app locals to access in routes
app.locals.io = io;

app.use(cors());
app.use(express.json());

app.use("/api", routes);

// Handle WebSocket connections
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
