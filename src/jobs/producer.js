// Job producer for creating scraping tasks
// Creates and adds jobs to the queue

import { scrapingQueue } from './queue.js';
import { randomUUID } from 'crypto';

/**
 * Adds a scraping job to the queue
 * @param {Object} jobData - The data for the scraping job
 * @param {string} jobData.batchId - Unique identifier for the batch
 * @param {Object} jobData.data - CSV row data containing scraping targets
 * @param {string} jobData.timestamp - When the job was created
 * @param {Object} options - Additional job options
 * @returns {Promise<string>} Job ID
 */
export async function addScrapingJob(jobData, options = {}) {
  try {
    const jobId = randomUUID();
    
    const job = await scrapingQueue.add(
      'scrape-data', // Job name
      {
        id: jobId,
        batchId: jobData.batchId,
        data: jobData.data,
        timestamp: jobData.timestamp,
        createdAt: new Date().toISOString(),
        ...jobData
      },
      {
        jobId,
        priority: options.priority || 0,
        delay: options.delay || 0,
        ...options
      }
    );

    console.log(`📝 Created scraping job ${jobId} for batch ${jobData.batchId}`);
    return job.id;
  } catch (error) {
    console.error('Error creating scraping job:', error);
    throw new Error(`Failed to create scraping job: ${error.message}`);
  }
}

/**
 * Adds multiple scraping jobs to the queue in bulk
 * @param {Array} jobsData - Array of job data objects
 * @param {Object} options - Additional options for all jobs
 * @returns {Promise<Array>} Array of job IDs
 */
export async function addBulkScrapingJobs(jobsData, options = {}) {
  try {
    const jobs = jobsData.map(jobData => ({
      name: 'scrape-data',
      data: {
        id: randomUUID(),
        ...jobData,
        createdAt: new Date().toISOString()
      },
      opts: {
        jobId: randomUUID(),
        priority: options.priority || 0,
        delay: options.delay || 0,
        ...options
      }
    }));

    const createdJobs = await scrapingQueue.addBulk(jobs);
    console.log(`📝 Created ${createdJobs.length} scraping jobs in bulk`);
    
    return createdJobs.map(job => job.id);
  } catch (error) {
    console.error('Error creating bulk scraping jobs:', error);
    throw new Error(`Failed to create bulk scraping jobs: ${error.message}`);
  }
}

/**
 * Gets queue statistics
 * @returns {Promise<Object>} Queue statistics
 */
export async function getQueueStats() {
  try {
    const waiting = await scrapingQueue.getWaiting();
    const active = await scrapingQueue.getActive();
    const completed = await scrapingQueue.getCompleted();
    const failed = await scrapingQueue.getFailed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      total: waiting.length + active.length + completed.length + failed.length
    };
  } catch (error) {
    console.error('Error getting queue stats:', error);
    throw error;
  }
}

console.log('✅ Job producer module loaded');