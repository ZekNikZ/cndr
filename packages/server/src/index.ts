import 'dotenv/config';

import { createServer } from 'node:http';

import compression from 'compression';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pino } from 'pino';
import { Server } from 'socket.io';

import type { ClientToServerEvents, ServerToClientEvents } from '@cndr/shared';

import { env } from './config/env.js';

const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        }
      : undefined,
});

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*', // adjust for security in production
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
  })
);
app.use(compression());
app.use(express.json());

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info({
    method: req.method,
    url: req.url,
    ip: req.ip,
  });
  next();
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  const response = {
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
  };
  res.json(response);
});

// ws
io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('handshake', (roomCode, role, roomPassword, hostKey) => {
    console.log(`handshake received for room ${roomCode}`);

    if (role === 'host') {
      if (!hostKey) {
        socket.emit('handshake', 'error', 'Host key is required for host role');
      } else {
        socket.emit('handshake', 'success');
      }
    } else {
      socket.emit('handshake', 'success');
    }
  });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  const response = {
    success: false,
    error: 'Not Found',
  };
  res.status(404).json(response);
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({
    error: err.message,
    stack: err.stack,
  });

  const response = {
    success: false,
    error: env.NODE_ENV === 'development' ? err.message : 'Internal Server Error',
  };

  res.status(500).json(response);
});

// Start server
httpServer.listen(env.PORT, env.HOST, () => {
  logger.info(`Server running at http://${env.HOST}:${env.PORT}`);
  logger.info(`Environment: ${env.NODE_ENV}`);
});
