// Fastify server setup and API routes
// Main HTTP server for the scraping service

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { config } from '../config.js';
import { addScrapingJob } from '../jobs/producer.js';
import { scrapingQueue } from '../jobs/queue.js';
import csv from 'csv-parser';
import { randomUUID } from 'crypto';
import { prepareForCSV } from '../utils/character-normalization.js';

/**
 * Creates and configures the Fastify server instance
 * @returns {FastifyInstance} Configured Fastify server
 */
export async function createServer() {
  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL || 'info'
    }
  });

  // Register multipart plugin for file uploads
  await fastify.register(multipart);

  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok' };
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

      // Parse CSV and create jobs
      return new Promise((resolve, reject) => {
        data.file
          .pipe(csv())
          .on('data', async (row) => {
            try {
              // Add job to queue for each CSV row
              const jobId = await addScrapingJob({
                batchId,
                data: row,
                timestamp: new Date().toISOString()
              });
              jobs.push(jobId);
            } catch (error) {
              fastify.log.error('Error adding job to queue:', error);
            }
          })
          .on('end', () => {
            fastify.log.info(`Batch ${batchId} created with ${jobs.length} jobs`);
            resolve({
              batchId,
              jobsCreated: jobs.length,
              message: 'CSV processed successfully, jobs added to queue'
            });
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
  // CSV headers with new expanded format
  const headers = [
    'Name',
    'Rating',
    'Reviews Count',
    'Phone',
    'Address', 
    'Website',
    'Category',
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
 * Formats opening hours to HH:MM - HH:MM format
 * @param {string} hours - Raw hours string from Google Maps
 * @returns {string} Formatted hours
 */
function formatHours(hours) {
  if (!hours || hours.trim() === '') return '';
  
  // Handle "Cerrado" / "Closed"
  if (hours.toLowerCase().includes('cerrado') || hours.toLowerCase().includes('closed')) {
    return 'Closed';
  }

  // Extract time patterns like "9 a.m.–6 p.m." or "9:30 a.m.–5:30 p.m."
  const timePattern = /(\d{1,2}):?(\d{0,2})\s*(a\.m\.|p\.m\.).*?(\d{1,2}):?(\d{0,2})\s*(a\.m\.|p\.m\.)/i;
  const match = hours.match(timePattern);
  
  if (match) {
    const [, startHour, startMin = '00', startPeriod, endHour, endMin = '00', endPeriod] = match;
    
    // Convert to 24-hour format
    const startTime = convertTo24Hour(startHour, startMin, startPeriod);
    const endTime = convertTo24Hour(endHour, endMin, endPeriod);
    
    return `${startTime} - ${endTime}`;
  }

  // Handle special cases or return original if no pattern matches
  return hours.replace(/[^\w\s:-]/g, '').trim();
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