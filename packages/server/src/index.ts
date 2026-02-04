import compression from 'compression';
import cors from 'cors';
import 'dotenv/config';
import type { ApiResponse } from '@cndr/shared';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { pino } from 'pino';
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
  const response: ApiResponse<{ status: string; timestamp: string }> = {
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
  };
  res.json(response);
});

// Example user endpoint
app.get('/users/:id', (req: Request, res: Response) => {
  const id = req.params.id;
  const userId = Array.isArray(id) ? (id[0] ?? 'unknown') : (id ?? 'unknown');

  const response: ApiResponse<{
    id: string;
    name: string;
    email: string;
  }> = {
    success: true,
    data: {
      id: userId,
      name: 'Example User',
      email: 'user@example.com',
    },
  };

  res.json(response);
});

// 404 handler
app.use((_req: Request, res: Response) => {
  const response: ApiResponse<never> = {
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

  const response: ApiResponse<never> = {
    success: false,
    error: env.NODE_ENV === 'development' ? err.message : 'Internal Server Error',
  };

  res.status(500).json(response);
});

// Start server
app.listen(env.PORT, env.HOST, () => {
  logger.info(`Server running at http://${env.HOST}:${env.PORT}`);
  logger.info(`Environment: ${env.NODE_ENV}`);
});
