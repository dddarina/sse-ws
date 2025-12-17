import { randomUUID } from "node:crypto";
import http from "node:http";
import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import pino from "pino";
import pinoPretty from "pino-pretty";
import WebSocket, { WebSocketServer } from "ws";

const app = express();
const logger = pino(pinoPretty());

app.use(cors());
app.use(bodyParser.json());

const userState = [];
const activeConnections = new Map(); 

app.post("/new-user", async (request, response) => {
  if (!request.body || !request.body.name) {
    return response.status(400).json({
      status: "error",
      message: "Name is required!"
    });
  }

  const { name } = request.body;

  const isExist = userState.find((user) => user.name === name);
  if (isExist) {
    const userWs = activeConnections.get(isExist.id);
    if (userWs && userWs.readyState === WebSocket.OPEN) {
      return response.status(409).json({
        status: "error",
        message: "This name is already taken by an active user!"
      });
    } else {
      const idx = userState.findIndex(user => user.id === isExist.id);
      if (idx !== -1) {
        userState.splice(idx, 1);
        activeConnections.delete(isExist.id);
      }
    }
  }

  const newUser = {
    id: randomUUID(),
    name: name,
    joinedAt: Date.now()
  };

  userState.push(newUser);
  logger.info(`New user created: ${JSON.stringify(newUser)}`);

  response.json({
    status: "ok",
    user: newUser
  });
});

app.post("/force-remove-user", (req, res) => {
  const { name } = req.body;
  const idx = userState.findIndex(user => user.name === name);

  if (idx !== -1) {
    const user = userState[idx];
    userState.splice(idx, 1);
    activeConnections.delete(user.id);
    logger.info(`User "${name}" forcibly removed`);

    broadcastUserList();
    res.json({ status: "ok", message: `User "${name}" removed` });
  } else {
    res.json({ status: "error", message: "User not found" });
  }
});

const server = http.createServer(app);
const wsServer = new WebSocketServer({ server });

const broadcastUserList = () => {
  const userList = userState.map(user => ({
    id: user.id,
    name: user.name,
    isOnline: activeConnections.has(user.id) &&
      activeConnections.get(user.id).readyState === WebSocket.OPEN
  }));

  wsServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(userList));
    }
  });
};

const setupHeartbeat = (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
};

setInterval(() => {
  wsServer.clients.forEach(ws => {
    if (ws.isAlive === false) {
      if (ws.userId) {
        const user = userState.find(u => u.id === ws.userId);
        if (user) {
          logger.info(`Removing inactive user: ${user.name}`);
          const idx = userState.findIndex(u => u.id === ws.userId);
          if (idx !== -1) userState.splice(idx, 1);
          activeConnections.delete(ws.userId);
        }
      }
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });

  broadcastUserList();
}, 30000); 

wsServer.on("connection", (ws, req) => {
  setupHeartbeat(ws);

  ws.on("message", (msg, isBinary) => {
    try {
      const receivedMSG = JSON.parse(msg);
      logger.info(`Message received: ${JSON.stringify(receivedMSG)}`);

      if (receivedMSG.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (receivedMSG.user && receivedMSG.user.id) {
        ws.userId = receivedMSG.user.id;
        ws.userName = receivedMSG.user.name;
        activeConnections.set(receivedMSG.user.id, ws);

        const userExists = userState.find(u => u.id === receivedMSG.user.id);
        if (!userExists) {
          userState.push({
            id: receivedMSG.user.id,
            name: receivedMSG.user.name,
            joinedAt: Date.now()
          });
        }
      }

      if (receivedMSG.type === "exit") {
        const idx = userState.findIndex(
          (user) => user.id === receivedMSG.user.id
        );
        if (idx !== -1) {
          userState.splice(idx, 1);
          activeConnections.delete(receivedMSG.user.id);
        }
        broadcastUserList();
        logger.info(`User with name "${receivedMSG.user.name}" has been deleted`);
        return;
      }

      if (receivedMSG.type === "send") {
        wsServer.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(msg, { binary: isBinary });
          }
        });
        logger.info("Message sent to all users");
      }

      if (receivedMSG.type === "get_users") {
        ws.send(JSON.stringify(
          userState.map(user => ({
            id: user.id,
            name: user.name,
            isOnline: activeConnections.has(user.id)
          }))
        ));
      }

    } catch (error) {
      logger.error(`Error parsing message: ${error}`);
    }
  });

  ws.on("close", () => {
    if (ws.userId) {
      const user = userState.find(u => u.id === ws.userId);
      logger.info(`Connection closed for user: ${user?.name || ws.userId}`);
    }
  });

  ws.on("error", (error) => {
    logger.error(`WebSocket error for user ${ws.userName}: ${error}`);
  });

  broadcastUserList();
});

const port = process.env.PORT || 3000;

const bootstrap = async () => {
  try {
    server.listen(port, () =>
      logger.info(`Server has been started on http://localhost:${port}`)
    );
  } catch (error) {
    logger.error(`Error: ${error.message}`);
  }
};

bootstrap();