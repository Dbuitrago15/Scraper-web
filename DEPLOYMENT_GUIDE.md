# Deployment Guide - Ubuntu Server via SSH

This guide explains how to deploy the Web Scraper on a remote Ubuntu server and make it accessible via IP address.

## 🎯 Overview

The scraper is now configured to work universally:
- ✅ **Local development**: Works on localhost
- ✅ **Production server**: Works on remote Ubuntu servers
- ✅ **Docker**: Works in containerized environments
- ✅ **CORS**: Properly configured for cross-origin requests

## 📋 Prerequisites

### On Ubuntu Server
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose -y

# Add your user to docker group (optional, to run without sudo)
sudo usermod -aG docker $USER
newgrp docker

# Verify installation
docker --version
docker-compose --version
```

## 🚀 Deployment Steps

### 1. Transfer Files to Server

```bash
# From your local machine
# Option A: Using rsync (recommended)
rsync -avz --progress /path/to/Scraper-web2/ user@69.164.197.86:/home/user/Scraper-web2/

# Option B: Using scp
scp -r /path/to/Scraper-web2/ user@69.164.197.86:/home/user/

# Option C: Using git (if you have a repository)
ssh user@69.164.197.86
git clone https://github.com/yourusername/Scraper-web2.git
cd Scraper-web2
```

### 2. Configure Environment

```bash
# SSH into your server
ssh user@69.164.197.86

# Navigate to project directory
cd Scraper-web2

# Copy environment file
cp .env.example .env

# Edit if needed (optional - defaults work fine)
nano .env
```

### 3. Configure Firewall

```bash
# Allow API port (3000)
sudo ufw allow 3000/tcp

# Allow frontend port if different (e.g., 4500)
sudo ufw allow 4500/tcp

# Check firewall status
sudo ufw status

# Enable firewall if not already enabled
sudo ufw enable
```

### 4. Build and Start Containers

```bash
# Build and start all services
docker-compose up --build -d

# Check container status
docker-compose ps

# View logs
docker-compose logs -f

# View only API logs
docker-compose logs -f api
```

Expected output:
```
NAME                    STATUS                    PORTS
scraper_api             Up (healthy)              0.0.0.0:3000->3000/tcp
scraper-web2-worker-1   Up (health: starting)     3000/tcp
scraper_redis           Up (healthy)              0.0.0.0:6389->6389/tcp
```

### 5. Verify Deployment

```bash
# Test from server (should return {"status":"ok"})
curl http://localhost:3000/health

# Test Redis health
curl http://localhost:3000/health/redis

# Test Worker health
curl http://localhost:3000/health/worker
```

### 6. Test from External Network

From your local machine:
```bash
# Test basic connectivity
curl http://69.164.197.86:3000/health

# Test CORS (should include access-control headers)
curl -H "Origin: http://69.164.197.86:4500" http://69.164.197.86:3000/health -v
```

## 🌐 Frontend Configuration

Update your frontend to use the correct API URL:

### Option 1: Environment Variables (Recommended)

```javascript
// .env.production
VITE_API_URL=http://69.164.197.86:3000

// In your frontend code
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
```

### Option 2: Dynamic Detection

```javascript
// Automatically detect environment
const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : `http://${window.location.hostname}:3000`;

// For SSE streaming
const eventSource = new EventSource(`${API_URL}/api/v1/scraping-batch/${batchId}/stream`);
```

### Option 3: Manual Configuration

```javascript
// config.js
export const API_URL = 'http://69.164.197.86:3000';
```

## 🔧 CORS Configuration

The server is configured to allow requests from:

✅ **Local development:**
- `http://localhost:5173` (Vite dev server)
- `http://localhost:3001` (alternative port)
- `http://127.0.0.1:5173`
- `http://127.0.0.1:3001`

✅ **Production:**
- `http://69.164.197.86:4500` (your frontend)
- `http://69.164.197.86:*` (any port on production server)
- Any IPv4 address pattern (flexible for testing)

### Adding More Origins

Edit `src/api/server.js`:

```javascript
await fastify.register(cors, {
  origin: [
    // Add your custom origins here
    'https://yourdomain.com',
    'http://another-ip:3000',
    /^https:\/\/.*\.yourdomain\.com$/, // Subdomain pattern
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
});
```

## 📊 Monitoring

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f worker

# Last 50 lines
docker-compose logs --tail=50 api
```

### Container Status

```bash
# Check running containers
docker-compose ps

# Detailed stats
docker stats

# Restart a service
docker-compose restart api
docker-compose restart worker
```

## 🔄 Updates and Maintenance

### Update Code

```bash
# Stop containers
docker-compose down

# Pull latest changes (if using git)
git pull

# Rebuild and restart
docker-compose up --build -d
```

### Clean Rebuild (if issues occur)

```bash
# Stop and remove everything
docker-compose down -v

# Clean build (no cache)
docker-compose build --no-cache

# Start fresh
docker-compose up -d
```

### Backup Data

```bash
# Backup Redis data
docker-compose exec redis redis-cli SAVE
docker cp scraper_redis:/data/dump.rdb ./backup-$(date +%Y%m%d).rdb

# Backup results (if stored in containers)
docker cp scraper_api:/app/results ./results-backup
```

## 🐛 Troubleshooting

### Problem: API not accessible from outside

**Solution:**
```bash
# Check if container is running
docker-compose ps

# Check if port is exposed
docker-compose port api 3000

# Check firewall
sudo ufw status

# Check if service is listening on 0.0.0.0
docker-compose logs api | grep "running"
# Should show: API Server running on port 3000 with host 0.0.0.0
```

### Problem: CORS errors in browser

**Solution:**
1. Check browser console for exact error
2. Verify frontend origin is in CORS configuration
3. Test CORS headers:
   ```bash
   curl -H "Origin: http://your-frontend-url" http://69.164.197.86:3000/health -v
   ```
4. Look for `access-control-allow-origin` header in response

### Problem: Containers keep restarting

**Solution:**
```bash
# Check logs for errors
docker-compose logs api

# Common issues:
# - Version mismatch (Fastify/CORS)
# - Redis not ready (wait a moment)
# - Port already in use

# Check what's using port 3000
sudo lsof -i :3000
sudo netstat -tulpn | grep 3000
```

### Problem: Worker unhealthy

**Solution:**
```bash
# Worker may take time to initialize browsers
# Check logs
docker-compose logs worker

# Restart worker
docker-compose restart worker

# If persistent, check resources
docker stats
free -h  # Check available RAM
```

### Problem: Connection refused / timeout

**Solution:**
```bash
# Check if server is reachable
ping 69.164.197.86

# Check if port is open from outside
# From local machine:
telnet 69.164.197.86 3000
# OR
nc -zv 69.164.197.86 3000

# Check Docker network
docker network ls
docker network inspect scraper-web2_default
```

## 🔐 Security Recommendations

### For Production

1. **Use HTTPS**: Set up nginx with SSL/TLS
2. **Restrict CORS**: Remove wildcard IP patterns, specify exact origins
3. **Use Environment Variables**: Never commit sensitive data
4. **Firewall**: Only allow necessary ports
5. **Regular Updates**: Keep Docker, images, and dependencies updated

### Example nginx Configuration (optional)

```nginx
server {
    listen 80;
    server_name 69.164.197.86;

    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## 📞 Support

If you encounter issues:

1. Check logs: `docker-compose logs -f`
2. Verify configuration: `cat .env`
3. Test connectivity: `curl http://localhost:3000/health`
4. Check resources: `docker stats`

## ✅ Success Checklist

- [ ] Docker and Docker Compose installed
- [ ] Files transferred to server
- [ ] Firewall configured (ports 3000, 4500)
- [ ] Containers running (`docker-compose ps`)
- [ ] API accessible locally (`curl localhost:3000/health`)
- [ ] API accessible externally (`curl http://69.164.197.86:3000/health`)
- [ ] CORS headers present in responses
- [ ] Frontend updated with correct API URL
- [ ] SSE streaming working (test with test-frontend.html)

## 🎉 Testing Real-Time Streaming

Once deployed, test the SSE endpoint:

```bash
# From server or local machine
curl -N http://69.164.197.86:3000/api/v1/scraping-batch/YOUR_BATCH_ID/stream

# Should see events:
# event: connected
# data: {"batchId":"...","message":"Connected to real-time updates"}
#
# event: progress
# data: {"total":7,"completed":3,"percentage":43}
```

Use the included `test-frontend.html` file and update the API URL to test the complete frontend integration.

---

**Deployment Date:** $(date +"%Y-%m-%d")  
**Server:** Ubuntu with Docker  
**API Version:** 2.8 (Universal Configuration)
