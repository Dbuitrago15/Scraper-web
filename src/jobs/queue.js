// BullMQ queue configuration and setup
// Manages job queues for scraping tasks

import { Queue } from 'bullmq';
import { config } from '../config.js';

/**
 * Redis connection configuration
 */
const redisConnection = {
  host: config.REDIS_HOST || 'localhost',
  port: config.REDIS_PORT || 6379,
  password: config.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 3,
  retryDelayOnFailure: 100,
};

/**
 * Main scraping jobs queue
 * Handles all web scraping tasks
 */
export const scrapingQueue = new Queue('scraping-jobs', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 50,      // Keep last 50 failed jobs
    attempts: 3,           // Retry failed jobs up to 3 times
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Log queue events for monitoring
scrapingQueue.on('error', (error) => {
  console.error('Queue error:', error);
});

scrapingQueue.on('waiting', (job) => {
  console.log(`Job ${job.id} is waiting`);
});

scrapingQueue.on('active', (job) => {
  console.log(`Job ${job.id} is now active`);
});

scrapingQueue.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

scrapingQueue.on('failed', (job, error) => {
  console.error(`Job ${job.id} failed:`, error.message);
});

console.log('✅ Queue management module loaded');
console.log(`📡 Connected to Redis at ${config.REDIS_HOST}:${config.REDIS_PORT}`);