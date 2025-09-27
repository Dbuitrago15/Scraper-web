# 🚀 High-Performance Web Scraper

A production-ready, scalable web scraping service that extracts business information from Google Maps. Built with Node.js, this system processes CSV files containing business data and returns comprehensive scraped information including contact details, social media links, and operating hours.

## 📋 Project Overview

This web scraper is designed for businesses, researchers, and developers who need to extract structured business information at scale. Upload a CSV file with business names and addresses, and receive detailed scraped data including:

- ✅ **Business Names**: Official business names from Google Maps
- 📍 **Complete Addresses**: Full formatted addresses
- 📞 **Phone Numbers**: Contact numbers when available
- 🌐 **Social Media**: Links to Facebook, Instagram, Twitter, LinkedIn, YouTube
- 🕐 **Operating Hours**: Daily opening hours for the entire week
- 📊 **Batch Processing**: Handle hundreds of businesses simultaneously
- 🔄 **Real-time Progress**: Track scraping progress and retrieve results

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+ with ES Modules
- **Web Framework**: Fastify (high-performance HTTP server)
- **Job Queue**: BullMQ with Redis (reliable background processing)
- **Web Scraping**: Playwright (browser automation)
- **Browser Pool**: generic-pool (efficient resource management)
- **Data Processing**: csv-parser (stream-based CSV processing)
- **Containerization**: Docker & Docker Compose
- **Database**: Redis (job queue and caching)

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose installed
- Git installed

### 1. Clone the Repository
```bash
git clone https://github.com/Dbuitrago15/Scraper-web.git
cd Scraper-web
```

### 2. Start the Application
```bash
# Build and start all services
docker-compose up --build -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f
```

### 3. Verify Installation
```bash
# Test health endpoint
curl http://localhost:3000/health
# Expected response: {"status":"ok"}
```

The application will be running at:
- **API Server**: `http://localhost:3000`
- **Redis**: `localhost:6379`

## 🎯 API Usage Example

### Step 1: Prepare Your CSV File

Create a CSV file (`businesses.csv`) with the following columns:
```csv
name,address,city,postal_code
"Joe's Pizza","123 Main St","New York","10001"
"Smith & Co Legal","456 Oak Ave","Boston","02101"
"Green Garden Restaurant","789 Pine St","Chicago","60601"
```

### Step 2: Upload CSV and Create Batch Job

```bash
# Upload CSV file to start scraping
curl -X POST \
  -F "file=@businesses.csv" \
  http://localhost:3000/api/v1/scraping-batch
```

**Response:**
```json
{
  "batchId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "jobsCreated": 3,
  "message": "CSV processed successfully, jobs added to queue"
}
```

### Step 3: Monitor Progress and Retrieve Results

```bash
# Check batch status and get results
curl http://localhost:3000/api/v1/scraping-batch/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Response:**
```json
{
  "batchId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "progress": {
    "total": 3,
    "completed": 3,
    "failed": 0,
    "processing": 0,
    "waiting": 0,
    "percentage": 100
  },
  "timing": {
    "createdAt": "2025-09-27T12:00:00.000Z",
    "lastProcessedAt": "2025-09-27T12:02:30.000Z",
    "estimatedTimeRemaining": null
  },
  "results": [
    {
      "jobId": "job_001",
      "originalData": {
        "name": "Joe's Pizza",
        "address": "123 Main St",
        "city": "New York",
        "postal_code": "10001"
      },
      "scrapedData": {
        "fullName": "Joe's Pizza - Authentic Italian",
        "fullAddress": "123 Main Street, New York, NY 10001, USA",
        "phone": "+1 (212) 555-0123",
        "socialMedia": {
          "facebook": "https://facebook.com/joespizzanyc",
          "instagram": "https://instagram.com/joespizza"
        },
        "openingHours": {
          "Monday": "11:00 AM – 10:00 PM",
          "Tuesday": "11:00 AM – 10:00 PM",
          "Wednesday": "11:00 AM – 10:00 PM",
          "Thursday": "11:00 AM – 10:00 PM",
          "Friday": "11:00 AM – 11:00 PM",
          "Saturday": "11:00 AM – 11:00 PM",
          "Sunday": "12:00 PM – 9:00 PM"
        },
        "status": "success",
        "scrapedAt": "2025-09-27T12:01:15.000Z"
      },
      "processingTime": 4500,
      "processedAt": "2025-09-27T12:01:15.000Z"
    }
  ],
  "summary": {
    "totalBusinesses": 3,
    "successfulScrapes": 3,
    "partialScrapes": 0,
    "failedScrapes": 0
  }
}
```

## 🔧 Development Setup

### Local Development

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Start Redis (required)
docker run -d -p 6379:6379 redis:alpine

# Start API server only
npm run dev:api

# Start worker only (in another terminal)
npm run dev:worker

# Or start both together
npm run dev:both
```

### Available Scripts

```bash
# Production
npm run start          # API server (default)
npm run start:api       # API server only
npm run start:worker    # Worker only
npm run start:both      # API + Worker

# Development (with auto-reload)
npm run dev            # API server (default)
npm run dev:api        # API server only
npm run dev:worker     # Worker only
npm run dev:both       # API + Worker
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Application mode (api, worker, both)
APP_MODE=api

# Server configuration
PORT=3000
NODE_ENV=development

# Redis configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Browser pool configuration
MAX_BROWSER_INSTANCES=5
BROWSER_TIMEOUT=30000

# Worker configuration
WORKER_CONCURRENCY=5

# API configuration
API_RATE_LIMIT=100
CORS_ORIGIN=*

# Logging
LOG_LEVEL=info
```

## 📊 API Reference

### Health Check
```http
GET /health
```
Returns server health status.

### Create Batch Job
```http
POST /api/v1/scraping-batch
Content-Type: multipart/form-data

file: [CSV file]
```
Upload a CSV file to create a batch scraping job.

### Get Batch Results
```http
GET /api/v1/scraping-batch/{batchId}
```
Retrieve results and progress for a specific batch.

## 🐳 Docker Deployment

### Production Deployment

```bash
# Production build and start
docker-compose up --build -d

# Scale workers for high load
docker-compose up --scale worker=4 -d

# Monitor logs
docker-compose logs -f api worker

# Stop services
docker-compose down
```

### Container Architecture

- **API Container**: Handles HTTP requests and CSV processing
- **Worker Containers**: Process scraping jobs (scalable)
- **Redis Container**: Job queue and data persistence

## 🔍 CSV Format Requirements

Your CSV file should contain the following columns:

| Column | Required | Description | Example |
|--------|----------|-------------|---------|
| `name` | Yes | Business name | "Joe's Pizza" |
| `address` | Recommended | Street address | "123 Main St" |
| `city` | Recommended | City name | "New York" |
| `postal_code` | Optional | ZIP/Postal code | "10001" |

**Example CSV:**
```csv
name,address,city,postal_code
"Acme Corporation","100 Business Ave","New York","10001"
"Tech Solutions Inc","200 Innovation Dr","San Francisco","94105"
"Green Cafe","300 Eco Street","Portland","97201"
```

## 📈 Performance & Scaling

- **Concurrent Processing**: 5 jobs per worker (configurable)
- **Browser Pooling**: Efficient resource reuse
- **Memory Optimization**: Resource blocking for faster scraping
- **Horizontal Scaling**: Add more worker containers
- **Redis Queue**: Reliable job distribution

### Scaling Workers

```bash
# Scale to 4 worker instances
docker-compose up --scale worker=4 -d

# Monitor worker performance
docker-compose logs -f worker
```

## 🛡️ Error Handling

- **Job Retries**: 3 attempts with exponential backoff
- **Browser Recovery**: Automatic browser replacement on failure
- **Partial Results**: Graceful handling of incomplete data
- **Comprehensive Logging**: Detailed error tracking and monitoring

## 📚 Documentation

- [System Architecture](./docs/ARCHITECTURE.md) - Technical architecture details
- [Development Log](./docs/DEVELOPMENT_LOG.md) - Development history and decisions

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For issues and questions:
1. Check the [documentation](./docs/)
2. Review existing GitHub issues
3. Create a new issue with detailed information

---

**Built with ❤️ for efficient business data extraction**