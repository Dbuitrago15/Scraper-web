# 🎨 Guía de Integración Frontend - Web Scraper API

Esta guía contiene toda la información necesaria para integrar tu frontend con la API de web scraping de Google Maps.

## 📡 Configuración de API

### URL Base
```javascript
const API_BASE_URL = 'http://localhost:3000/api/v1';
```

### Endpoints Disponibles

#### 1. Health Check
```http
GET /health
```
**Respuesta:**
```json
{
  "status": "ok"
}
```

#### 2. Subir CSV y Crear Batch
```http
POST /api/v1/scraping-batch
Content-Type: multipart/form-data
```

#### 3. Obtener Resultados del Batch
```http
GET /api/v1/scraping-batch/{batchId}
```

---

## 🔄 Flujo de Trabajo Completo

### Paso 1: Upload del CSV

**Endpoint:** `POST /api/v1/scraping-batch`

**JavaScript Example:**
```javascript
async function uploadCSV(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch(`${API_BASE_URL}/scraping-batch`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error uploading CSV:', error);
    throw error;
  }
}
```

**Respuesta Exitosa:**
```json
{
  "batchId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "jobsCreated": 150,
  "message": "CSV processed successfully, jobs added to queue"
}
```

**Respuestas de Error:**
```json
// Sin archivo
{
  "error": "No file uploaded",
  "message": "Please provide a CSV file in the \"file\" field"
}

// Archivo no válido
{
  "error": "Invalid file type",
  "message": "Only CSV files are allowed"
}

// Error interno
{
  "error": "Internal server error",
  "message": "Failed to process CSV file"
}
```

---

### Paso 2: Polling de Resultados

**Endpoint:** `GET /api/v1/scraping-batch/{batchId}`

**JavaScript Example:**
```javascript
async function getBatchResults(batchId) {
  try {
    const response = await fetch(`${API_BASE_URL}/scraping-batch/${batchId}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Batch not found');
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching batch results:', error);
    throw error;
  }
}

// Polling function para actualizaciones en tiempo real
function startPolling(batchId, onUpdate, interval = 3000) {
  const pollInterval = setInterval(async () => {
    try {
      const results = await getBatchResults(batchId);
      onUpdate(results);
      
      // Detener polling si el batch está completo
      if (results.status === 'completed' || results.status === 'completed_with_errors') {
        clearInterval(pollInterval);
      }
    } catch (error) {
      console.error('Polling error:', error);
      clearInterval(pollInterval);
    }
  }, interval);
  
  return pollInterval; // Para poder detenerlo manualmente
}
```

---

## 📊 Estructura de Respuesta de Resultados

```json
{
  "batchId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed", // "processing" | "queued" | "completed" | "completed_with_errors"
  "progress": {
    "total": 150,
    "completed": 145,
    "failed": 5,
    "processing": 0,
    "waiting": 0,
    "percentage": 96
  },
  "timing": {
    "createdAt": "2025-09-27T12:00:00.000Z",
    "lastProcessedAt": "2025-09-27T12:15:30.000Z",
    "estimatedTimeRemaining": "2m 30s" // null si está completo
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
          "instagram": "https://instagram.com/joespizza",
          "twitter": null,
          "linkedin": null,
          "youtube": null
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
        "status": "success", // "success" | "partial" | "failed"
        "scrapedAt": "2025-09-27T12:01:15.000Z",
        "error": null
      },
      "processingTime": 4500,
      "processedAt": "2025-09-27T12:01:15.000Z",
      "worker": 1
    }
    // ... más resultados
  ],
  "summary": {
    "totalBusinesses": 150,
    "successfulScrapes": 140,
    "partialScrapes": 5,
    "failedScrapes": 5
  }
}
```

---

## 🎛️ Implementación para tu Frontend

### 1. Estado de la Barra de Progreso

```javascript
function updateProgressBar(progressData) {
  const { percentage, completed, total, processing, waiting, failed } = progressData;
  
  // Actualizar barra de progreso
  const progressBar = document.getElementById('progress-bar');
  progressBar.style.width = `${percentage}%`;
  progressBar.textContent = `${percentage}%`;
  
  // Actualizar contadores
  document.getElementById('completed-count').textContent = completed;
  document.getElementById('total-count').textContent = total;
  document.getElementById('processing-count').textContent = processing;
  document.getElementById('waiting-count').textContent = waiting;
  document.getElementById('failed-count').textContent = failed;
}
```

### 2. Manejo de Estados del Batch

```javascript
function updateBatchStatus(status, timing) {
  const statusElement = document.getElementById('batch-status');
  const timeElement = document.getElementById('estimated-time');
  
  switch(status) {
    case 'queued':
      statusElement.textContent = 'En cola';
      statusElement.className = 'status-queued';
      break;
    case 'processing':
      statusElement.textContent = 'Procesando';
      statusElement.className = 'status-processing';
      break;
    case 'completed':
      statusElement.textContent = 'Completado';
      statusElement.className = 'status-completed';
      break;
    case 'completed_with_errors':
      statusElement.textContent = 'Completado con errores';
      statusElement.className = 'status-completed-with-errors';
      break;
  }
  
  // Mostrar tiempo estimado restante
  if (timing.estimatedTimeRemaining) {
    timeElement.textContent = `Tiempo restante: ${timing.estimatedTimeRemaining}`;
  } else {
    timeElement.textContent = '';
  }
}
```

### 3. Tabla de Resultados para el Modal

```javascript
function generateResultsTable(results) {
  const tableBody = document.getElementById('results-table-body');
  tableBody.innerHTML = '';
  
  results.forEach((result, index) => {
    const row = document.createElement('tr');
    
    // Determinar clase CSS basada en el estado
    let statusClass = 'status-unknown';
    let statusText = 'Desconocido';
    
    if (result.scrapedData) {
      switch(result.scrapedData.status) {
        case 'success':
          statusClass = 'status-success';
          statusText = 'Exitoso';
          break;
        case 'partial':
          statusClass = 'status-partial';
          statusText = 'Parcial';
          break;
        case 'failed':
          statusClass = 'status-failed';
          statusText = 'Fallido';
          break;
      }
    } else if (result.error) {
      statusClass = 'status-failed';
      statusText = 'Error';
    }
    
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${result.originalData.name || 'N/A'}</td>
      <td>${result.originalData.address || 'N/A'}</td>
      <td>${result.originalData.city || 'N/A'}</td>
      <td><span class="${statusClass}">${statusText}</span></td>
      <td>${result.scrapedData?.fullName || 'N/A'}</td>
      <td>${result.scrapedData?.phone || 'N/A'}</td>
      <td>
        ${result.scrapedData?.socialMedia ? 
          Object.entries(result.scrapedData.socialMedia)
            .filter(([key, value]) => value)
            .map(([key, value]) => `<a href="${value}" target="_blank">${key}</a>`)
            .join(', ') 
          : 'N/A'}
      </td>
      <td>
        <button onclick="showBusinessDetails('${result.jobId}')" class="btn-details">
          Ver Detalles
        </button>
      </td>
    `;
    
    tableBody.appendChild(row);
  });
}
```

### 4. Modal de Detalles de Negocio

```javascript
function showBusinessDetails(jobId, results) {
  const result = results.find(r => r.jobId === jobId);
  if (!result) return;
  
  const modal = document.getElementById('business-details-modal');
  const modalContent = document.getElementById('modal-content');
  
  modalContent.innerHTML = `
    <h3>${result.scrapedData?.fullName || result.originalData.name}</h3>
    
    <div class="detail-section">
      <h4>Información Original</h4>
      <p><strong>Nombre:</strong> ${result.originalData.name || 'N/A'}</p>
      <p><strong>Dirección:</strong> ${result.originalData.address || 'N/A'}</p>
      <p><strong>Ciudad:</strong> ${result.originalData.city || 'N/A'}</p>
      <p><strong>Código Postal:</strong> ${result.originalData.postal_code || 'N/A'}</p>
    </div>
    
    <div class="detail-section">
      <h4>Información Extraída</h4>
      <p><strong>Nombre Completo:</strong> ${result.scrapedData?.fullName || 'N/A'}</p>
      <p><strong>Dirección Completa:</strong> ${result.scrapedData?.fullAddress || 'N/A'}</p>
      <p><strong>Teléfono:</strong> ${result.scrapedData?.phone || 'N/A'}</p>
    </div>
    
    <div class="detail-section">
      <h4>Redes Sociales</h4>
      ${result.scrapedData?.socialMedia ? 
        Object.entries(result.scrapedData.socialMedia)
          .map(([platform, url]) => url ? 
            `<p><strong>${platform.charAt(0).toUpperCase() + platform.slice(1)}:</strong> 
             <a href="${url}" target="_blank">${url}</a></p>` : '')
          .join('') || '<p>No se encontraron redes sociales</p>'
        : '<p>No se encontraron redes sociales</p>'}
    </div>
    
    <div class="detail-section">
      <h4>Horarios de Atención</h4>
      ${result.scrapedData?.openingHours ? 
        Object.entries(result.scrapedData.openingHours)
          .map(([day, hours]) => `<p><strong>${day}:</strong> ${hours || 'No disponible'}</p>`)
          .join('') || '<p>No se encontraron horarios</p>'
        : '<p>No se encontraron horarios</p>'}
    </div>
    
    <div class="detail-section">
      <h4>Información de Procesamiento</h4>
      <p><strong>Tiempo de Procesamiento:</strong> ${result.processingTime ? (result.processingTime / 1000).toFixed(2) + 's' : 'N/A'}</p>
      <p><strong>Procesado en:</strong> ${result.processedAt ? new Date(result.processedAt).toLocaleString() : 'N/A'}</p>
      <p><strong>Estado:</strong> ${result.scrapedData?.status || 'N/A'}</p>
      ${result.scrapedData?.error ? `<p><strong>Error:</strong> ${result.scrapedData.error}</p>` : ''}
    </div>
  `;
  
  modal.style.display = 'block';
}
```

---

## 🔧 Ejemplo de Implementación Completa

```javascript
class ScrapingManager {
  constructor(apiBaseUrl = 'http://localhost:3000/api/v1') {
    this.apiBaseUrl = apiBaseUrl;
    this.currentBatchId = null;
    this.pollingInterval = null;
  }
  
  async uploadCSV(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(`${this.apiBaseUrl}/scraping-batch`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error uploading CSV');
    }
    
    const data = await response.json();
    this.currentBatchId = data.batchId;
    return data;
  }
  
  async getBatchResults(batchId = this.currentBatchId) {
    const response = await fetch(`${this.apiBaseUrl}/scraping-batch/${batchId}`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error fetching results');
    }
    
    return await response.json();
  }
  
  startPolling(onUpdate, interval = 3000) {
    if (!this.currentBatchId) {
      throw new Error('No batch ID available');
    }
    
    this.pollingInterval = setInterval(async () => {
      try {
        const results = await this.getBatchResults();
        onUpdate(results);
        
        if (results.status === 'completed' || results.status === 'completed_with_errors') {
          this.stopPolling();
        }
      } catch (error) {
        console.error('Polling error:', error);
        this.stopPolling();
      }
    }, interval);
  }
  
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}

// Uso
const scrapingManager = new ScrapingManager();

// Event listener para el input de archivo
document.getElementById('csv-input').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  
  try {
    const uploadResult = await scrapingManager.uploadCSV(file);
    console.log('Upload successful:', uploadResult);
    
    // Iniciar polling
    scrapingManager.startPolling((results) => {
      updateProgressBar(results.progress);
      updateBatchStatus(results.status, results.timing);
      
      if (results.results && results.results.length > 0) {
        generateResultsTable(results.results);
      }
    });
    
  } catch (error) {
    console.error('Upload failed:', error);
    alert('Error uploading CSV: ' + error.message);
  }
});
```

---

## 📋 Formato CSV Requerido

Tu CSV debe tener estas columnas:

```csv
name,address,city,postal_code
"Joe's Pizza","123 Main St","New York","10001"
"Smith Legal","456 Oak Ave","Boston","02101"
"Green Cafe","789 Pine St","Chicago","60601"
```

- **name**: Nombre del negocio (requerido)
- **address**: Dirección (recomendado)
- **city**: Ciudad (recomendado)
- **postal_code**: Código postal (opcional)

---

## 🎨 CSS Sugerido para Estados

```css
.status-success { color: #28a745; font-weight: bold; }
.status-partial { color: #ffc107; font-weight: bold; }
.status-failed { color: #dc3545; font-weight: bold; }
.status-queued { color: #6c757d; }
.status-processing { color: #007bff; }
.status-completed { color: #28a745; }
.status-completed-with-errors { color: #fd7e14; }

.progress-bar {
  transition: width 0.3s ease;
  background-color: #007bff;
}
```

---

## ⚠️ Manejo de Errores

```javascript
function handleAPIError(error, context) {
  console.error(`Error in ${context}:`, error);
  
  let userMessage = 'Ha ocurrido un error inesperado.';
  
  if (error.message.includes('404')) {
    userMessage = 'Batch no encontrado. El ID puede haber expirado.';
  } else if (error.message.includes('400')) {
    userMessage = 'Archivo CSV inválido. Verifica el formato.';
  } else if (error.message.includes('500')) {
    userMessage = 'Error del servidor. Intenta nuevamente más tarde.';
  }
  
  // Mostrar mensaje al usuario
  showErrorMessage(userMessage);
}
```

¡Con esta guía tu frontend debería poder integrarse perfectamente con la API de scraping! 🚀