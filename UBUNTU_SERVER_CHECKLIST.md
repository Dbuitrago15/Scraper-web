# ✅ Ubuntu Server Deployment Checklist

## 📋 Configuration Summary

Your setup:
- **Backend API:** `http://69.164.197.86:3000` ✅
- **Frontend:** `http://69.164.197.86:4500` ✅
- **CORS:** Configured to allow frontend (port 4500) to access backend (port 3000) ✅

## 🔍 Step-by-Step Verification

### 1. Connect to Your Ubuntu Server

```bash
ssh user@69.164.197.86
```

### 2. Navigate to Project Directory

```bash
cd ~/Scraper-web2  # or wherever you placed the project
```

### 3. Check if Docker is Running

```bash
docker-compose ps
```

**Expected output:**
```
NAME                    STATUS                    PORTS
scraper_api             Up (healthy)              0.0.0.0:3000->3000/tcp
scraper-web2-worker-1   Up                        3000/tcp
scraper_redis           Up (healthy)              0.0.0.0:6389->6389/tcp
```

**If containers are NOT running:**
```bash
docker-compose up -d
```

### 4. Test Backend Locally on Server

```bash
curl http://localhost:3000/health
```

**Expected response:**
```json
{"status":"ok"}
```

**If this FAILS:** Backend is not running properly. Check logs:
```bash
docker-compose logs api
```

### 5. Check Firewall Configuration

```bash
sudo ufw status
```

**REQUIRED rules:**
```
To                         Action      From
--                         ------      ----
3000/tcp                   ALLOW       Anywhere
4500/tcp                   ALLOW       Anywhere
```

**If port 3000 is NOT open:**
```bash
sudo ufw allow 3000/tcp
sudo ufw allow 4500/tcp
sudo ufw reload
sudo ufw status
```

### 6. Test Backend from Your Local Machine

**From your local computer (NOT from the server):**

**Windows PowerShell:**
```powershell
Invoke-WebRequest -Uri http://69.164.197.86:3000/health
```

**macOS/Linux:**
```bash
curl http://69.164.197.86:3000/health
```

**Expected response:**
```json
{"status":"ok"}
```

**If this FAILS:**
- ❌ Firewall is blocking the port
- ❌ Backend is not running
- ❌ Network/ISP might be blocking the connection

### 7. Check CORS Headers

**From your local machine:**

**Windows PowerShell:**
```powershell
$response = Invoke-WebRequest -Uri http://69.164.197.86:3000/health -Headers @{"Origin"="http://69.164.197.86:4500"}
$response.Headers
```

**macOS/Linux:**
```bash
curl -H "Origin: http://69.164.197.86:4500" http://69.164.197.86:3000/health -v
```

**Look for these headers in the response:**
```
access-control-allow-origin: http://69.164.197.86:4500
access-control-allow-credentials: true
```

**If CORS headers are MISSING:** Rebuild the containers with the new configuration.

### 8. Update Your Frontend Configuration

Your frontend needs to connect to the backend API. Update your frontend code:

**Option 1: Environment Variable (Recommended)**

Create `.env.production` in your frontend:
```
VITE_API_URL=http://69.164.197.86:3000
```

In your code:
```javascript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
```

**Option 2: Direct Configuration**

```javascript
// config.js or wherever you configure the API
const API_URL = 'http://69.164.197.86:3000';

// For fetching data
fetch(`${API_URL}/api/v1/scraping-batch`, {
  method: 'POST',
  body: formData
})

// For SSE streaming
const eventSource = new EventSource(`${API_URL}/api/v1/scraping-batch/${batchId}/stream`);
```

**Option 3: Dynamic Detection**

```javascript
// Automatically detect if running locally or on server
const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : `http://${window.location.hostname}:3000`;

console.log('API URL:', API_URL);  // Verify the URL is correct
```

### 9. Test Complete Flow

1. **Open your frontend:** `http://69.164.197.86:4500`
2. **Open browser console** (F12)
3. **Check for errors:**
   - ✅ No CORS errors
   - ✅ No "Connection refused" errors
   - ✅ API requests going to `69.164.197.86:3000`

### 10. Test File Upload

1. Upload a CSV file through your frontend
2. Check browser Network tab (F12 → Network)
3. Look for POST request to: `http://69.164.197.86:3000/api/v1/scraping-batch`
4. Response should include `batchId`

## 🐛 Common Problems & Solutions

### Problem 1: "Processing 0 of X businesses" (Stuck at 0%)

**Cause:** Frontend is connecting to `localhost:3000` instead of `69.164.197.86:3000`

**Solution:**
1. Open browser console (F12)
2. Look at Network tab
3. Check which URL the frontend is calling
4. Update frontend to use `http://69.164.197.86:3000`

### Problem 2: "Failed to fetch" or "Network Error"

**Cause:** Backend not accessible from outside

**Check:**
```bash
# On Ubuntu server
curl http://localhost:3000/health  # Should work

# From your local machine
curl http://69.164.197.86:3000/health  # Should also work
```

**If localhost works but external doesn't:**
- Check firewall: `sudo ufw status`
- Verify port is open: `sudo ufw allow 3000/tcp`
- Check Docker binding: `docker-compose port api 3000` (should show `0.0.0.0:3000`)

### Problem 3: CORS Error in Browser Console

**Error message:**
```
Access to fetch at 'http://69.164.197.86:3000/...' from origin 'http://69.164.197.86:4500' 
has been blocked by CORS policy
```

**Solution:**
1. Ensure you've transferred the UPDATED code to the server
2. Rebuild containers:
   ```bash
   cd ~/Scraper-web2
   docker-compose down
   docker-compose up --build -d
   ```
3. Verify CORS headers:
   ```bash
   curl -H "Origin: http://69.164.197.86:4500" http://localhost:3000/health -v
   ```

### Problem 4: Containers Keep Restarting

**Check logs:**
```bash
docker-compose logs api --tail 50
```

**Common causes:**
- Package version mismatch
- Port already in use
- Insufficient memory

**Solution:**
```bash
# Clean rebuild
docker-compose down -v
docker-compose build --no-cache
docker-compose up -d
```

## 📝 Quick Command Reference

```bash
# Start containers
docker-compose up -d

# Stop containers
docker-compose down

# Rebuild and start
docker-compose up --build -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f api

# Test health
curl http://localhost:3000/health

# Check firewall
sudo ufw status

# Open ports
sudo ufw allow 3000/tcp
sudo ufw allow 4500/tcp
```

## ✅ Success Indicators

When everything is working correctly:

1. **Backend accessible locally:**
   ```bash
   curl http://localhost:3000/health
   # Response: {"status":"ok"}
   ```

2. **Backend accessible externally:**
   ```bash
   curl http://69.164.197.86:3000/health
   # Response: {"status":"ok"}
   ```

3. **CORS headers present:**
   ```bash
   curl -H "Origin: http://69.164.197.86:4500" http://69.164.197.86:3000/health -v
   # Look for: access-control-allow-origin: http://69.164.197.86:4500
   ```

4. **Frontend can connect:**
   - Open `http://69.164.197.86:4500` in browser
   - No CORS errors in console
   - File upload works
   - Progress updates appear

5. **SSE streaming works:**
   ```bash
   curl -N http://69.164.197.86:3000/api/v1/scraping-batch/YOUR_BATCH_ID/stream
   # Should show: event: connected
   ```

## 🎯 Critical Configuration Points

1. **Backend must listen on `0.0.0.0`** (already configured ✅)
2. **Frontend must connect to `69.164.197.86:3000`** (YOU NEED TO UPDATE THIS)
3. **Firewall must allow port 3000** (YOU NEED TO VERIFY THIS)
4. **CORS must allow port 4500** (already configured ✅)
5. **Containers must be running** (YOU NEED TO VERIFY THIS)

## 🚨 Most Likely Issue

Based on "Processing 0 of X businesses", the **frontend is probably using the wrong API URL**.

**What to check in your frontend code:**

Search for these patterns:
```javascript
// ❌ WRONG - will only work locally
fetch('http://localhost:3000/api/...')
new EventSource('http://localhost:3000/api/...')

// ✅ CORRECT - will work on server
fetch('http://69.164.197.86:3000/api/...')
new EventSource('http://69.164.197.86:3000/api/...')

// ✅ BEST - works everywhere
const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000' 
  : `http://${window.location.hostname}:3000`;
fetch(`${API_URL}/api/...`)
```

---

**Need Help?**

1. Run these commands on your Ubuntu server and share the output:
   ```bash
   docker-compose ps
   curl http://localhost:3000/health
   sudo ufw status
   ```

2. Share your frontend code where you configure the API URL

3. Open browser console (F12) and share any error messages
