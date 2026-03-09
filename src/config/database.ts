// import { PrismaClient } from '@prisma/client';
import { PrismaClient } from '../generated/prisma/client'; // relative path to src/generated/prisma
import logger from './logger';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'error', 'warn'] 
    : ['error'],
});

// Test connection on startup
prisma.$connect()
  .then(() => {
    logger.info('✅ PostgreSQL connected');
  })
  .catch((err: any) => {
    logger.error(`❌ PostgreSQL connection failed: ${err.message}`);
    process.exit(1);
  });

export default prisma;