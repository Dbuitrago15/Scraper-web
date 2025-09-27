// Fastify server setup and API routes
// Main HTTP server for the scraping service

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { config } from '../config.js';
import { addScrapingJob } from '../jobs/producer.js';
import csv from 'csv-parser';
import { randomUUID } from 'crypto';

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