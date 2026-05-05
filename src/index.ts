import './config/loadEnv';
import './types/express';
import express, { Request, Response } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import logger from './config/logger';
import redis from './config/redis';
import prisma from './config/database';
import { errorHandler } from './middleware/errorHandler';
import routes from './routes';
import { swaggerDocument } from './config/swagger';
import { initializeFirebase } from './config/firebase';
import HeartbeatService from './services/HeartbeatService';

initializeFirebase();

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.text({ type: '*/*' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ─── Swagger Documentation ────────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/health', async (req: Request, res: Response) => {
  try {
    // Check Redis
    const redisPing = await redis.ping();
    const redisConnected = redisPing === 'PONG';

    // Check PostgreSQL
    await prisma.$queryRaw`SELECT 1`;
    const databaseConnected = true;

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      redis: redisConnected ? 'connected' : 'disconnected',
      database: databaseConnected ? 'connected' : 'disconnected',
    };

    res.json(health);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Health check failed: ${errorMessage}`);

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: errorMessage,
    });
  }
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'NODi Server',
    version: '1.0.0',
    description: 'Fleet Distraction Control Platform',
    endpoints: {
      health: '/health',
      docs: '/api-docs',
      api: '/api/v1',
    },
  });
});

// API Routes
app.use('/api/v1', routes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path,
  });
});

// Error handler
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info('╔═══════════════════════════════════════════════╗');
  logger.info('║                                               ║');
  logger.info('║          🚀 NODi Server Started               ║');
  logger.info('║                                               ║');
  logger.info('╚═══════════════════════════════════════════════╝');
  logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
  logger.info(`🔌 Port: ${PORT}`);
  logger.info(`📡 Health: http://localhost:${PORT}/health`);
  logger.info(`📚 API Docs: http://localhost:${PORT}/api-docs`);
  logger.info(`🔗 API Base: http://localhost:${PORT}/api/v1`);
  logger.info('');
  // HeartbeatService.start();
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = async (signal: string) => {
  logger.info(`\n${signal} received. Starting graceful shutdown...`);

  server.close(async () => {
    logger.info('✅ HTTP server closed');

    try {
      HeartbeatService.stop();
      await prisma.$disconnect();
      logger.info('✅ PostgreSQL disconnected');
    } catch (err) {
      logger.error('Error disconnecting PostgreSQL:', err);
    }

    try {
      await redis.quit();
      logger.info('✅ Redis disconnected');
    } catch (err) {
      logger.error('Error disconnecting Redis:', err);
    }

    logger.info('✅ Graceful shutdown complete');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('⚠️  Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
