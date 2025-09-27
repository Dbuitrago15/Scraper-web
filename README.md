# High-Performance Web Scraper

## Project Objective

This project is designed to create a high-performance, scalable web scraping backend using Node.js. The system leverages modern technologies including Fastify for the API server, BullMQ for job queue management, Playwright for browser automation, and Redis for data persistence and queue management.

The architecture is built to handle large-scale scraping operations efficiently while maintaining reliability and performance through browser pooling, job queuing, and containerized deployment.

## Key Features

- **High-Performance API**: Built with Fastify for fast HTTP handling
- **Job Queue Management**: BullMQ for reliable task processing
- **Browser Automation**: Playwright for robust web scraping
- **Resource Management**: Browser pooling for efficient resource usage
- **Data Processing**: CSV parsing and data transformation capabilities
- **Containerized Deployment**: Docker and Docker Compose support
- **Modern JavaScript**: ES Modules support throughout the codebase

## API Endpoints

### Health Check
- **GET** `/health`
  - Returns server health status
  - Response: `{ "status": "ok" }`

### Batch Scraping
- **POST** `/api/v1/scraping-batch`
  - Upload CSV file to create batch scraping jobs
  - Content-Type: `multipart/form-data`
  - Field name: `file` (CSV file)
  - Response: `{ "batchId": "uuid", "jobsCreated": number, "message": "CSV processed successfully, jobs added to queue" }`
  - Each row in the CSV becomes a separate scraping job in the queue

## Getting Started

1. Copy `.env.example` to `.env` and configure your environment variables
2. Install dependencies: `npm install`
3. Start development server: `npm run dev`
4. Or use Docker: `docker-compose up`

## Documentation

- [System Architecture](./docs/ARCHITECTURE.md)
- [Development Log](./docs/DEVELOPMENT_LOG.md)