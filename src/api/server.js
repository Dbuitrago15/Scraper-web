// Fastify server setup and API routes
// Main HTTP server for the scraping service

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config } from '../config.js';
import { addScrapingJob } from '../jobs/producer.js';
import { scrapingQueue } from '../jobs/queue.js';
import csv from 'csv-parser';
import { randomUUID } from 'crypto';
import { prepareForCSV } from '../utils/character-normalization.js';
import iconv from 'iconv-lite';
import chardet from 'chardet';
import { Readable } from 'stream';

/**
 * Creates and configures the Fastify server instance
 * @returns {FastifyInstance} Configured Fastify server
 */
export async function createServer() {
  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL || 'info'
    },
    // Ensure UTF-8 encoding for all responses
    charset: 'utf-8',
    // Enable trust proxy for reverse proxy scenarios (nginx, Apache, etc.)
    trustProxy: true
  });

  // Configure CORS to allow requests from different origins
  // This enables the frontend to connect from localhost, production IPs, or any environment
  await fastify.register(cors, {
    origin: [
      // Local development
      'http://localhost:5173',      // Vite dev server
      'http://localhost:3001',      // Alternative local port
      'http://127.0.0.1:5173',      // IP-based localhost
      'http://127.0.0.1:3001',      // IP-based localhost alternative
      
      // Production server (Ubuntu)
      'http://69.164.197.86:4500',  // Your production frontend
      /^http:\/\/69\.164\.197\.86:\d+$/,  // Any port on production server
      
      // Flexible pattern for any IP address (development/testing)
      // Use with caution in production - consider restricting to specific IPs
      /^http:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
  });

  // Add global hook to set UTF-8 for all JSON responses
  fastify.addHook('onSend', async (request, reply, payload) => {
    // Ensure JSON responses have UTF-8 charset
    const contentType = reply.getHeader('content-type');
    if (contentType && contentType.includes('application/json')) {
      reply.header('Content-Type', 'application/json; charset=utf-8');
    }
    return payload;
  });

  // Register multipart plugin for file uploads
  await fastify.register(multipart);

  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok' };
  });

  // Redis health check endpoint
  fastify.get('/health/redis', async (request, reply) => {
    try {
      const startTime = Date.now();
      
      // Test Redis connection and basic operations using BullMQ queue methods
      // Test queue operations to verify Redis connectivity
      const queueStats = await scrapingQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
      const queueInfo = await scrapingQueue.getWaiting();
      
      // Test basic Redis operations through the queue's Redis connection
      const testJobId = `health_check_${Date.now()}`;
      
      // Add a test job and immediately remove it to test Redis write/read operations
      const testJob = await scrapingQueue.add('health-check', {
        test: true,
        timestamp: Date.now()
      }, {
        jobId: testJobId,
        delay: 60000 // Delay for 1 minute so it doesn't get processed
      });
      
      // Remove the test job immediately
      await testJob.remove();
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        service: 'redis',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        connection: {
          status: 'connected',
          queue_accessible: true
        },
        operations: {
          queue_stats: 'ok',
          job_creation: 'ok',
          job_removal: 'ok'
        },
        queue_stats: queueStats,
        waiting_jobs: queueInfo.length
      };
    } catch (error) {
      console.error('Redis health check failed:', error);
      return reply.code(503).send({
        status: 'unhealthy',
        service: 'redis',
        timestamp: new Date().toISOString(),
        error: error.message,
        details: 'Redis connection or operations failed'
      });
    }
  });

  // Worker health check endpoint
  fastify.get('/health/worker', async (request, reply) => {
    try {
      const startTime = Date.now();
      
      // Get queue statistics
      const queueStats = await scrapingQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      
      // Get active jobs to check if workers are processing
      const activeJobs = await scrapingQueue.getActive();
      const waitingJobs = await scrapingQueue.getWaiting();
      const completedJobs = await scrapingQueue.getCompleted(0, 9); // Get last 10 completed jobs
      const failedJobs = await scrapingQueue.getFailed(0, 9); // Get last 10 failed jobs
      
      // Check if there are recent completed jobs (last 5 minutes)
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      const recentCompletedJobs = completedJobs.filter(job => 
        job.processedOn && job.processedOn > fiveMinutesAgo
      );
      
      // Determine worker health status
      let workerStatus = 'healthy';
      let statusReason = 'Workers are processing jobs normally';
      
      if (queueStats.active === 0 && queueStats.waiting > 0) {
        // Jobs are waiting but none are active - might indicate worker issues
        if (recentCompletedJobs.length === 0) {
          workerStatus = 'degraded';
          statusReason = 'No active jobs and no recent completions - workers may be offline';
        }
      } else if (queueStats.failed > queueStats.completed && queueStats.failed > 10) {
        workerStatus = 'degraded';
        statusReason = 'High failure rate detected';
      }
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: workerStatus,
        service: 'worker',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        reason: statusReason,
        queue_statistics: {
          waiting: queueStats.waiting,
          active: queueStats.active,
          completed: queueStats.completed,
          failed: queueStats.failed,
          delayed: queueStats.delayed
        },
        active_jobs: {
          count: activeJobs.length,
          jobs: activeJobs.map(job => ({
            id: job.id,
            name: job.name,
            startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
            progress: job.progress || 0
          }))
        },
        recent_activity: {
          completed_last_5min: recentCompletedJobs.length,
          last_completed: completedJobs.length > 0 ? {
            id: completedJobs[0].id,
            completedAt: new Date(completedJobs[0].processedOn).toISOString(),
            processingTime: completedJobs[0].returnvalue?.processingTime || 'unknown'
          } : null,
          last_failed: failedJobs.length > 0 ? {
            id: failedJobs[0].id,
            failedAt: new Date(failedJobs[0].processedOn).toISOString(),
            error: failedJobs[0].failedReason || 'unknown'
          } : null
        }
      };
    } catch (error) {
      console.error('Worker health check failed:', error);
      return reply.code(503).send({
        status: 'unhealthy',
        service: 'worker',
        timestamp: new Date().toISOString(),
        error: error.message,
        details: 'Unable to access job queue or worker information'
      });
    }
  });

  // Get batch results endpoint
  fastify.get('/api/v1/scraping-batch/:batchId', async (request, reply) => {
    try {
      const { batchId } = request.params;
      
      if (!batchId) {
        return reply.code(400).send({
          error: 'Missing batchId',
          message: 'Please provide a valid batchId parameter'
        });
      }

      console.log(`🔍 Retrieving results for batch: ${batchId}`);

      // Get batch results
      const batchResults = await getBatchResults(batchId);
      
      if (!batchResults) {
        return reply.code(404).send({
          error: 'Batch not found',
          message: `No batch found with ID: ${batchId}`
        });
      }

      console.log(`📊 Batch ${batchId} - ${batchResults.progress.completed}/${batchResults.progress.total} jobs completed`);
      
      return batchResults;

    } catch (error) {
      fastify.log.error('Batch results retrieval error:', error);
      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to retrieve batch results'
      });
    }
  });

  // CSV export endpoint with clean format and European character support
  fastify.get('/api/v1/scraping-batch/:batchId/export', async (request, reply) => {
    try {
      const { batchId } = request.params;
      
      if (!batchId) {
        return reply.code(400).send({
          error: 'Missing batchId',
          message: 'Please provide a valid batchId parameter'
        });
      }

      console.log(`📁 Exporting CSV for batch: ${batchId}`);

      // Get batch results
      const batchResults = await getBatchResults(batchId);
      
      if (!batchResults) {
        return reply.code(404).send({
          error: 'Batch not found',
          message: `No batch found with ID: ${batchId}`
        });
      }

      // Generate clean CSV content with European character support
      const csvContent = generateCleanCSV(batchResults.results);
      
      // Add UTF-8 BOM for proper European character display in Excel/LibreOffice
      const utf8BOM = '\uFEFF';
      const csvWithBOM = utf8BOM + csvContent;
      
      // Set headers for CSV download with proper encoding
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="scraping-results-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv"`);
      reply.header('Cache-Control', 'no-cache');
      
      return csvWithBOM;

    } catch (error) {
      fastify.log.error('CSV export error:', error);
      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to export CSV'
      });
    }
  });

  // Real-time progress streaming endpoint using Server-Sent Events (SSE)
  // Frontend can connect to this to receive live updates as jobs complete
  fastify.get('/api/v1/scraping-batch/:batchId/stream', async (request, reply) => {
    try {
      const { batchId } = request.params;
      
      if (!batchId) {
        return reply.code(400).send({
          error: 'Missing batchId',
          message: 'Please provide a valid batchId parameter'
        });
      }

      console.log(`📡 Starting SSE stream for batch: ${batchId}`);

      // Set headers for Server-Sent Events
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('Access-Control-Allow-Origin', '*'); // For CORS
      reply.hijack(); // Take control of the response

      // Function to send SSE message
      const sendEvent = (event, data) => {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Send initial connection message
      sendEvent('connected', { 
        batchId, 
        message: 'Connected to real-time updates',
        timestamp: new Date().toISOString()
      });

      // Poll for job updates every 2 seconds
      const pollInterval = setInterval(async () => {
        try {
          const batchResults = await getBatchResults(batchId);
          
          if (batchResults) {
            const { completed, total, results } = batchResults;
            
            // Send progress update
            sendEvent('progress', {
              batchId,
              completed,
              total,
              percentage: Math.round((completed / total) * 100),
              timestamp: new Date().toISOString()
            });

            // Send each completed result
            results.forEach((result, index) => {
              sendEvent('result', {
                index,
                ...result,
                timestamp: new Date().toISOString()
              });
            });

            // If all jobs completed, send final message and close
            if (completed >= total) {
              sendEvent('complete', {
                batchId,
                completed,
                total,
                message: 'All jobs completed',
                timestamp: new Date().toISOString()
              });
              clearInterval(pollInterval);
              reply.raw.end();
            }
          }
        } catch (error) {
          console.error('Error polling batch results:', error);
          sendEvent('error', {
            message: 'Error fetching updates',
            error: error.message
          });
        }
      }, 2000); // Poll every 2 seconds

      // Clean up on client disconnect
      request.raw.on('close', () => {
        console.log(`📡 Client disconnected from SSE stream: ${batchId}`);
        clearInterval(pollInterval);
      });

    } catch (error) {
      fastify.log.error('SSE stream error:', error);
      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to start real-time stream'
      });
    }
  });

  // CSV upload and batch job creation endpoint
  fastify.post('/api/v1/scraping-batch', async (request, reply) => {
    try {
      // Get the uploaded file
      const data = await request.file();
      
      if (!data) {
        return reply.code(400).send({
          error: 'No file uploaded',
          message: 'Please provide a CSV file in the "file" field'
        });
      }

      // Validate file type
      if (!data.filename.toLowerCase().endsWith('.csv')) {
        return reply.code(400).send({
          error: 'Invalid file type',
          message: 'Only CSV files are allowed'
        });
      }

      const batchId = randomUUID();
      const jobs = [];

      // Convert file stream to buffer for encoding detection
      const chunks = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      console.log(`📁 CSV file received: ${data.filename} (${buffer.length} bytes)`);

      // Detect encoding automatically
      const detectedEncoding = chardet.detect(buffer);
      console.log(`🔍 Detected encoding: ${detectedEncoding}`);

      // Determine the correct encoding to use
      let encoding = 'utf-8';
      if (detectedEncoding) {
        // Map detected encodings to iconv-lite supported encodings
        const encodingLower = detectedEncoding.toLowerCase();
        if (encodingLower.includes('utf-8') || encodingLower.includes('utf8')) {
          encoding = 'utf-8';
        } else if (encodingLower.includes('iso-8859') || encodingLower.includes('latin')) {
          encoding = 'iso-8859-1';
        } else if (encodingLower.includes('windows-1252') || encodingLower.includes('cp1252')) {
          encoding = 'windows-1252';
        } else {
          encoding = detectedEncoding;
        }
      }

      console.log(`📝 Using encoding: ${encoding}`);

      // Remove UTF-8 BOM if present (0xEF, 0xBB, 0xBF)
      let processedBuffer = buffer;
      if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        console.log('🔧 Removing UTF-8 BOM from CSV');
        processedBuffer = buffer.slice(3);
      }

      // Convert buffer to UTF-8 string using detected encoding
      let csvString;
      try {
        csvString = iconv.decode(processedBuffer, encoding);
        console.log(`✅ Successfully decoded CSV with ${encoding} encoding`);
        
        // Log first line to verify encoding worked
        const firstLine = csvString.split('\n')[0];
        console.log(`📋 CSV Header: ${firstLine}`);
      } catch (decodeError) {
        console.error(`❌ Encoding decode error with ${encoding}:`, decodeError.message);
        // Fallback to UTF-8
        csvString = buffer.toString('utf-8');
        console.log('⚠️ Fallback to UTF-8 encoding');
      }

      // Parse CSV with proper UTF-8 handling
      // Collect all rows first, then process them sequentially to avoid race conditions
      return new Promise((resolve, reject) => {
        const stream = Readable.from(csvString);
        const rows = [];
        
        stream
          .pipe(csv({
            skipEmptyLines: true,
            mapHeaders: ({ header }) => header.trim().toLowerCase(),
            skipLines: 0
          }))
          .on('data', (row) => {
            // Collect rows synchronously (no await here)
            rows.push(row);
            console.log(`📊 Parsed row ${rows.length}: ${JSON.stringify(row, null, 2)}`);
          })
          .on('end', async () => {
            // Now process all rows sequentially with proper async/await
            console.log(`📦 Processing ${rows.length} rows...`);
            
            try {
              for (const row of rows) {
                const jobId = await addScrapingJob({
                  batchId,
                  data: row,
                  timestamp: new Date().toISOString()
                });
                jobs.push(jobId);
                console.log(`✅ Created job ${jobs.length}/${rows.length}: ${jobId}`);
              }
              
              fastify.log.info(`Batch ${batchId} created with ${jobs.length} jobs`);
              resolve({
                batchId,
                jobsCreated: jobs.length,
                message: 'CSV processed successfully, jobs added to queue',
                encoding: encoding,
                bomRemoved: buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF
              });
            } catch (error) {
              fastify.log.error('Error creating jobs:', error);
              reject(reply.code(500).send({
                error: 'Job creation failed',
                message: error.message
              }));
            }
          })
          .on('error', (error) => {
            fastify.log.error('CSV parsing error:', error);
            reject(reply.code(400).send({
              error: 'CSV parsing failed',
              message: error.message
            }));
          });
      });

    } catch (error) {
      fastify.log.error('Batch creation error:', error);
      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to process CSV file'
      });
    }
  });

  return fastify;
}

/**
 * Retrieves batch results from BullMQ queue
 * @param {string} batchId - Batch identifier
 * @returns {Promise<Object|null>} Batch results or null if not found
 */
async function getBatchResults(batchId) {
  try {
    // Get all jobs from the queue
    const [waiting, active, completed, failed] = await Promise.all([
      scrapingQueue.getWaiting(),
      scrapingQueue.getActive(),
      scrapingQueue.getCompleted(),
      scrapingQueue.getFailed()
    ]);

    // Combine all jobs
    const allJobs = [...waiting, ...active, ...completed, ...failed];

    // Filter jobs by batchId
    const batchJobs = allJobs.filter(job => job.data && job.data.batchId === batchId);

    if (batchJobs.length === 0) {
      return null; // Batch not found
    }

    // Categorize jobs by status
    const jobsByStatus = {
      waiting: [],
      active: [],
      completed: [],
      failed: []
    };

    const results = [];

    for (const job of batchJobs) {
      const jobData = {
        jobId: job.id,
        status: await job.getState(),
        data: job.data.data,
        createdAt: job.data.createdAt || job.timestamp,
        processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        progress: job.progress || 0
      };

      // Add job to appropriate status category
      const jobStatus = jobData.status;
      if (jobsByStatus[jobStatus]) {
        jobsByStatus[jobStatus].push(jobData);
      }

      // Add scraped results for completed jobs
      if (jobStatus === 'completed' && job.returnvalue) {
        results.push({
          jobId: job.id,
          originalData: job.data.data,
          scrapedData: job.returnvalue.scrapedData,
          processingTime: job.returnvalue.processingTime,
          processedAt: job.returnvalue.processedAt,
          worker: job.returnvalue.worker
        });
      } else if (jobStatus === 'failed') {
        results.push({
          jobId: job.id,
          originalData: job.data.data,
          scrapedData: null,
          error: job.failedReason || 'Unknown error',
          processedAt: job.failedOn ? new Date(job.failedOn).toISOString() : null
        });
      }
    }

    // Calculate progress
    const totalJobs = batchJobs.length;
    const completedJobs = jobsByStatus.completed.length;
    const failedJobs = jobsByStatus.failed.length;
    const processingJobs = jobsByStatus.active.length;
    const waitingJobs = jobsByStatus.waiting.length;

    const progressPercentage = totalJobs > 0 ? Math.round(((completedJobs + failedJobs) / totalJobs) * 100) : 0;

    // Determine overall batch status
    let batchStatus = 'processing';
    if (completedJobs + failedJobs === totalJobs) {
      batchStatus = failedJobs === 0 ? 'completed' : 'completed_with_errors';
    } else if (processingJobs === 0 && waitingJobs === totalJobs) {
      batchStatus = 'queued';
    }

    // Calculate timing information
    const createdTimes = batchJobs.map(job => job.timestamp).filter(Boolean);
    const processedTimes = batchJobs.map(job => job.processedOn).filter(Boolean);
    
    const batchCreatedAt = createdTimes.length > 0 ? new Date(Math.min(...createdTimes)).toISOString() : null;
    const lastProcessedAt = processedTimes.length > 0 ? new Date(Math.max(...processedTimes)).toISOString() : null;

    return {
      batchId,
      status: batchStatus,
      progress: {
        total: totalJobs,
        completed: completedJobs,
        failed: failedJobs,
        processing: processingJobs,
        waiting: waitingJobs,
        percentage: progressPercentage
      },
      timing: {
        createdAt: batchCreatedAt,
        lastProcessedAt: lastProcessedAt,
        estimatedTimeRemaining: calculateEstimatedTime(processingJobs + waitingJobs, completedJobs, createdTimes, processedTimes)
      },
      results: results,
      summary: {
        totalBusinesses: totalJobs,
        successfulScrapes: results.filter(r => r.scrapedData && r.scrapedData.status === 'success').length,
        partialScrapes: results.filter(r => r.scrapedData && r.scrapedData.status === 'partial').length,
        failedScrapes: results.filter(r => !r.scrapedData || r.error).length
      }
    };

  } catch (error) {
    console.error('Error retrieving batch results:', error);
    throw error;
  }
}

/**
 * Calculates estimated time remaining for batch completion
 * @param {number} remainingJobs - Number of jobs remaining
 * @param {number} completedJobs - Number of completed jobs
 * @param {number[]} createdTimes - Array of job creation timestamps
 * @param {number[]} processedTimes - Array of job completion timestamps
 * @returns {string|null} Estimated time remaining
 */
function calculateEstimatedTime(remainingJobs, completedJobs, createdTimes, processedTimes) {
  if (remainingJobs === 0 || completedJobs === 0 || createdTimes.length === 0 || processedTimes.length === 0) {
    return null;
  }

  try {
    const startTime = Math.min(...createdTimes);
    const lastProcessedTime = Math.max(...processedTimes);
    const elapsedTime = lastProcessedTime - startTime;
    
    if (elapsedTime <= 0) return null;

    const averageTimePerJob = elapsedTime / completedJobs;
    const estimatedRemainingMs = averageTimePerJob * remainingJobs;

    // Convert to human readable format
    const hours = Math.floor(estimatedRemainingMs / (1000 * 60 * 60));
    const minutes = Math.floor((estimatedRemainingMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((estimatedRemainingMs % (1000 * 60)) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  } catch (error) {
    return null;
  }
}

/**
 * Generates clean CSV content with only useful scraped data
 * @param {Array} results - Array of scraping results
 * @returns {string} CSV content
 */
function generateCleanCSV(results) {
  // CSV headers with new expanded format including coordinates
  const headers = [
    'Name',
    'Rating',
    'Reviews Count',
    'Phone',
    'Address', 
    'Website',
    'Category',
    'Latitude',
    'Longitude',
    'Monday Hours',
    'Tuesday Hours', 
    'Wednesday Hours',
    'Thursday Hours',
    'Friday Hours',
    'Saturday Hours',
    'Sunday Hours',
    'Status'
  ];

  // Generate CSV rows
  const rows = results.map(result => {
    const scraped = result.scrapedData;
    
    if (!scraped || result.scrapedData?.status === 'failed') {
      return [
        '', // Name
        '', // Rating
        '', // Reviews Count
        '', // Phone
        '', // Address
        '', // Website
        '', // Category
        '', // Latitude
        '', // Longitude
        '', '', '', '', '', '', '', // All days empty
        'failed' // Status
      ];
    }

    return [
      escapeCsvValue(scraped.fullName || ''),
      escapeCsvValue(formatRating(scraped.rating || '')),
      escapeCsvValue(formatReviewsCount(scraped.reviewsCount || '')),
      escapeCsvValue(formatPhoneNumber(scraped.phone || '')),
      escapeCsvValue(scraped.fullAddress || ''),
      escapeCsvValue(formatWebsite(scraped.website || '')),
      escapeCsvValue(scraped.category || ''),
      escapeCsvValue(scraped.latitude || ''),
      escapeCsvValue(scraped.longitude || ''),
      escapeCsvValue(formatHours(scraped.openingHours?.Monday || '')),
      escapeCsvValue(formatHours(scraped.openingHours?.Tuesday || '')),
      escapeCsvValue(formatHours(scraped.openingHours?.Wednesday || '')),
      escapeCsvValue(formatHours(scraped.openingHours?.Thursday || '')),
      escapeCsvValue(formatHours(scraped.openingHours?.Friday || '')),
      escapeCsvValue(formatHours(scraped.openingHours?.Saturday || '')),
      escapeCsvValue(formatHours(scraped.openingHours?.Sunday || '')),
      scraped.status || 'unknown'
    ];
  });

  // Combine headers and rows
  const csvLines = [headers.join(',')];
  rows.forEach(row => {
    csvLines.push(row.join(','));
  });

  return csvLines.join('\n');
}

/**
 * Normalizes day names from different languages to English
 * @param {string} text - Text containing day names
 * @returns {string} Text with normalized day names
 */
function normalizeDayNames(text) {
  if (!text) return text;
  
  const dayTranslations = {
    // German
    'Montag': 'Monday',
    'Dienstag': 'Tuesday', 
    'Mittwoch': 'Wednesday',
    'Donnerstag': 'Thursday',
    'Freitag': 'Friday',
    'Samstag': 'Saturday',
    'Sonntag': 'Sunday',
    'Geschlossen': 'Closed',
    
    // French
    'Lundi': 'Monday',
    'Mardi': 'Tuesday',
    'Mercredi': 'Wednesday',
    'Jeudi': 'Thursday',
    'Vendredi': 'Friday',
    'Samedi': 'Saturday',
    'Dimanche': 'Sunday',
    'Fermé': 'Closed',
    
    // Italian
    'Lunedì': 'Monday',
    'Martedì': 'Tuesday',
    'Mercoledì': 'Wednesday',
    'Giovedì': 'Thursday',
    'Venerdì': 'Friday',
    'Sabato': 'Saturday',
    'Domenica': 'Sunday',
    'Chiuso': 'Closed',
    
    // Spanish
    'Lunes': 'Monday',
    'Martes': 'Tuesday',
    'Miércoles': 'Wednesday',
    'Jueves': 'Thursday',
    'Viernes': 'Friday',
    'Sábado': 'Saturday',
    'Domingo': 'Sunday',
    'Cerrado': 'Closed'
  };
  
  let normalizedText = text;
  
  // Replace day names (case insensitive)
  for (const [foreign, english] of Object.entries(dayTranslations)) {
    const regex = new RegExp(`\\b${foreign}\\b`, 'gi');
    normalizedText = normalizedText.replace(regex, english);
  }
  
  return normalizedText;
}

/**
 * Formats opening hours to HH:MM - HH:MM format
 * @param {string} hours - Raw hours string from Google Maps
 * @returns {string} Formatted hours
 */
function formatHours(hours) {
  if (!hours || hours.trim() === '') return '';
  
  // First normalize day names from other languages
  let normalizedHours = normalizeDayNames(hours);
  
  // Handle "Cerrado" / "Closed" / "Geschlossen"
  if (normalizedHours.toLowerCase().includes('closed') || 
      normalizedHours.toLowerCase().includes('geschlossen') ||
      normalizedHours.toLowerCase().includes('fermé') ||
      normalizedHours.toLowerCase().includes('chiuso') ||
      normalizedHours.toLowerCase().includes('cerrado')) {
    return 'Closed';
  }

  // Extract time patterns like "9 a.m.–6 p.m." or "9:30 a.m.–5:30 p.m."
  const timePattern = /(\d{1,2}):?(\d{0,2})\s*(a\.m\.|p\.m\.).*?(\d{1,2}):?(\d{0,2})\s*(a\.m\.|p\.m\.)/i;
  const match = normalizedHours.match(timePattern);
  
  if (match) {
    const [, startHour, startMin = '00', startPeriod, endHour, endMin = '00', endPeriod] = match;
    
    // Convert to 24-hour format
    const startTime = convertTo24Hour(startHour, startMin, startPeriod);
    const endTime = convertTo24Hour(endHour, endMin, endPeriod);
    
    return `${startTime} - ${endTime}`;
  }

  // Handle 24-hour format like "08:30-20:00" or "8:30 - 20:00"
  const time24Pattern = /(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/;
  const match24 = normalizedHours.match(time24Pattern);
  
  if (match24) {
    const [, startHour, startMin, endHour, endMin] = match24;
    const startTime = `${startHour.padStart(2, '0')}:${startMin}`;
    const endTime = `${endHour.padStart(2, '0')}:${endMin}`;
    return `${startTime} - ${endTime}`;
  }

  // Clean up and return normalized version, removing day names but keeping hours
  let cleanHours = normalizedHours
    .replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi, '')
    .replace(/[^\w\s:-]/g, '')
    .trim();
  
  return cleanHours || normalizedHours.trim();
}

/**
 * Converts 12-hour time to 24-hour format
 * @param {string} hour - Hour part
 * @param {string} minute - Minute part
 * @param {string} period - AM/PM
 * @returns {string} Time in HH:MM format
 */
function convertTo24Hour(hour, minute, period) {
  let h = parseInt(hour);
  const m = minute.padStart(2, '0');
  
  if (period.toLowerCase().includes('p.m.') && h !== 12) {
    h += 12;
  } else if (period.toLowerCase().includes('a.m.') && h === 12) {
    h = 0;
  }
  
  return `${h.toString().padStart(2, '0')}:${m}`;
}

/**
 * Formats phone number by removing addresses that got mixed in
 * @param {string} phone - Raw phone string
 * @returns {string} Clean phone number
 */
function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  // If it looks like an address (contains street names/numbers), return empty
  if (phone.includes(',') || phone.includes('Strasse') || phone.includes('strasse') || 
      phone.includes('gasse') || phone.includes('platz') || phone.includes('weg')) {
    return '';
  }
  
  return phone.trim();
}

/**
 * Formats rating to display only the numeric value
 * @param {string} rating - Raw rating string from Google Maps
 * @returns {string} Clean numeric rating
 */
function formatRating(rating) {
  if (!rating) return '';
  
  // Extract numeric rating (e.g., "4.2" from "4.2 stars" or "4,2")
  const match = rating.match(/(\d+[.,]\d+|\d+)/);
  if (match) {
    return match[1].replace(',', '.');
  }
  
  return rating.trim();
}

/**
 * Formats reviews count to display only the number
 * @param {string} reviewsCount - Raw reviews count from Google Maps
 * @returns {string} Clean numeric reviews count
 */
function formatReviewsCount(reviewsCount) {
  if (!reviewsCount) return '';
  
  // Extract numeric value (e.g., "1,234" from "1,234 reviews" or "(1.234)")
  const match = reviewsCount.match(/[\d.,]+/);
  if (match) {
    return match[0];
  }
  
  return reviewsCount.trim();
}

/**
 * Formats website URL to be clean and clickable
 * @param {string} website - Raw website string
 * @returns {string} Clean website URL
 */
function formatWebsite(website) {
  if (!website) return '';
  
  // If it's already a URL, return as is
  if (website.startsWith('http://') || website.startsWith('https://')) {
    return website.trim();
  }
  
  // If it's a domain without protocol, add https://
  if (website.includes('.') && !website.includes(' ')) {
    return `https://${website.trim()}`;
  }
  
  return website.trim();
}

/**
 * Escapes CSV values with European character support
 * Handles commas, quotes, newlines, and properly preserves European special characters
 * @param {string} value - Value to escape
 * @returns {string} Escaped CSV value with proper European character handling
 */
function escapeCsvValue(value) {
  if (!value) return '';
  
  // Use the character normalization utility to prepare for CSV while preserving original characters
  let stringValue = prepareForCSV(String(value));
  
  // If value contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }
  
  return stringValue;
}

/**
 * Starts the Fastify server
 * @returns {Promise<void>}
 */
export async function startServer() {
  try {
    const server = await createServer();
    
    await server.listen({
      port: config.PORT || 3000,
      host: '0.0.0.0'
    });

    console.log(`🚀 API Server running on port ${config.PORT || 3000}`);
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}