// Data processing and transformation
// BullMQ Worker that processes scraping jobs

import { Worker } from 'bullmq';
import { scrapeBusiness } from './scraper.js';
import { config } from '../config.js';
import { closeBrowserPool, getPoolStats } from './browser-pool.js';

/**
 * Redis connection configuration for worker
 */
const redisConnection = {
  host: config.REDIS_HOST || 'localhost',
  port: config.REDIS_PORT || 6379,
  password: config.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 3,
  retryDelayOnFailure: 100,
};

/**
 * Job processing function
 * @param {Job} job - BullMQ job object
 * @returns {Promise<Object>} Processing result
 */
async function processScrapingJob(job) {
  const startTime = Date.now();
  
  try {
    console.log(`🚀 Processing job ${job.id} from batch ${job.data.batchId}`);
    console.log(`📊 Job data:`, {
      name: job.data.data?.name,
      address: job.data.data?.address,
      city: job.data.data?.city
    });
    
    // Update job progress
    await job.updateProgress(10);
    
    // Get current pool stats
    const poolStats = getPoolStats();
    console.log(`🏊 Pool stats: ${poolStats.borrowed}/${poolStats.size} browsers in use`);
    
    // Process the scraping job
    await job.updateProgress(20);
    const scrapedData = await scrapeBusiness(job.data.data);
    await job.updateProgress(90);
    
    // Calculate processing time
    const processingTime = Date.now() - startTime;
    
    // Prepare result
    const result = {
      jobId: job.id,
      batchId: job.data.batchId,
      scrapedData,
      processingTime,
      processedAt: new Date().toISOString(),
      worker: process.pid
    };
    
    await job.updateProgress(100);
    
    console.log(`✅ Job ${job.id} completed in ${processingTime}ms`);
    console.log(`📊 Result status: ${scrapedData.status}`);
    
    return result;
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ Job ${job.id} failed after ${processingTime}ms:`, error.message);
    
    // Return error result
    return {
      jobId: job.id,
      batchId: job.data.batchId,
      error: error.message,
      processingTime,
      processedAt: new Date().toISOString(),
      worker: process.pid,
      status: 'failed'
    };
  }
}

/**
 * Creates and configures the BullMQ worker
 * @returns {Worker} Configured BullMQ worker
 */
export function createScrapingWorker() {
  const worker = new Worker('scraping-jobs', processScrapingJob, {
    connection: redisConnection,
    concurrency: config.WORKER_CONCURRENCY || 5, // Process 5 jobs simultaneously
    stalledInterval: 30000, // Check for stalled jobs every 30 seconds
    maxStalledCount: 1, // Max number of times a job can be stalled
    removeOnComplete: 50, // Keep last 50 completed jobs
    removeOnFail: 25, // Keep last 25 failed jobs
  });

  // Worker event handlers
  worker.on('ready', () => {
    console.log('🚀 Scraping worker is ready and waiting for jobs');
    console.log(`⚡ Worker concurrency: ${config.WORKER_CONCURRENCY || 5}`);
  });

  worker.on('active', (job) => {
    console.log(`🔄 Worker started processing job ${job.id}`);
  });

  worker.on('completed', (job, result) => {
    console.log(`✅ Worker completed job ${job.id}`, {
      status: result.scrapedData?.status,
      processingTime: result.processingTime
    });
  });

  worker.on('failed', (job, error) => {
    console.error(`❌ Worker failed job ${job?.id}:`, error.message);
  });

  worker.on('stalled', (jobId) => {
    console.warn(`⚠️ Job ${jobId} stalled`);
  });

  worker.on('progress', (job, progress) => {
    if (progress % 25 === 0) { // Log every 25% progress
      console.log(`📈 Job ${job.id} progress: ${progress}%`);
    }
  });

  worker.on('error', (error) => {
    console.error('❌ Worker error:', error);
  });

  return worker;
}

/**
 * Starts the scraping worker process
 * @returns {Promise<Worker>} Started worker instance
 */
export async function startScrapingWorker() {
  try {
    console.log('🚀 Starting scraping worker...');
    
    const worker = createScrapingWorker();
    
    // Graceful shutdown handling
    const gracefulShutdown = async (signal) => {
      console.log(`🛑 ${signal} received, shutting down worker gracefully...`);
      
      try {
        await worker.close();
        console.log('✅ Worker closed successfully');
        
        await closeBrowserPool();
        console.log('✅ Browser pool closed successfully');
        
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during graceful shutdown:', error);
        process.exit(1);
      }
    };
    
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    console.log('✅ Scraping worker started successfully');
    return worker;
    
  } catch (error) {
    console.error('❌ Failed to start scraping worker:', error);
    throw error;
  }
}

/**
 * Gets worker statistics and health information
 * @param {Worker} worker - BullMQ worker instance
 * @returns {Promise<Object>} Worker statistics
 */
export async function getWorkerStats(worker) {
  try {
    const poolStats = getPoolStats();
    
    return {
      worker: {
        isRunning: !worker.closing && !worker.closed,
        concurrency: worker.opts.concurrency,
        processed: worker.processed,
        failed: worker.failed
      },
      browserPool: poolStats,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    };
  } catch (error) {
    console.error('❌ Error getting worker stats:', error);
    return { error: error.message };
  }
}

console.log('✅ Data processor (Worker) module loaded');