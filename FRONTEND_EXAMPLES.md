# 🎯 Framework Integration Examples

**Note**: All examples include proper UTF-8 encoding support for special characters (ä, ö, ü, é, à, ñ, etc.)

## 🔠 UTF-8 Support Requirements

Before implementing any framework example, ensure:

1. **HTML Meta Tag**: Add to your main HTML file
```html
<meta charset="UTF-8">
```

2. **No Additional Configuration Needed**: The API automatically handles UTF-8:
   - ✅ CSV uploads accept special characters
   - ✅ JSON responses include `charset=utf-8`
   - ✅ CSV exports include UTF-8 BOM for Excel

3. **Test Characters**: Works with all European characters:
   - German: ä, ö, ü, ß
   - French: é, è, à, ç
   - Spanish: ñ, á, é, í, ó, ú
   - Scandinavian: å, æ, ø

---

## React Example with UTF-8 Support

```jsx
import React, { useState, useEffect } from 'react';

const ScrapingDashboard = () => {
  const [file, setFile] = useState(null);
  const [batchId, setBatchId] = useState(null);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const API_BASE = 'http://localhost:3000/api/v1';

  const uploadCSV = async () => {
    if (!file) return;
    
    setLoading(true);
    setError(null);
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE}/scraping-batch`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Upload failed');
      
      const data = await response.json();
      setBatchId(data.batchId);
      startPolling(data.batchId);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const startPolling = (id) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/scraping-batch/${id}`);
        const data = await response.json();
        
        setResults(data);
        
        if (data.status === 'completed' || data.status === 'completed_with_errors') {
          clearInterval(interval);
          setLoading(false);
        }
      } catch (err) {
        setError(err.message);
        clearInterval(interval);
        setLoading(false);
      }
    }, 3000);
  };

  return (
    <div className="scraping-dashboard">
      <div className="upload-section">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files[0])}
        />
        <button onClick={uploadCSV} disabled={!file || loading}>
          {loading ? 'Procesando...' : 'Subir CSV'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {results && (
        <div className="progress-section">
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${results.progress.percentage}%` }}
            >
              {results.progress.percentage}%
            </div>
          </div>
          
          <div className="stats">
            <span>Completados: {results.progress.completed}</span>
            <span>Total: {results.progress.total}</span>
            <span>Fallidos: {results.progress.failed}</span>
          </div>

          {results.results && results.results.length > 0 && (
            <ResultsTable results={results.results} />
          )}
        </div>
      )}
    </div>
  );
};

const ResultsTable = ({ results }) => {
  const [selectedBusiness, setSelectedBusiness] = useState(null);

  return (
    <>
      <table className="results-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Nombre Original</th>
            <th>Estado</th>
            <th>Nombre Extraído</th>
            <th>Teléfono</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result, index) => (
            <tr key={result.jobId}>
              <td>{index + 1}</td>
              <td>{result.originalData.name}</td>
              <td>
                <span className={`status-${result.scrapedData?.status || 'failed'}`}>
                  {result.scrapedData?.status || 'failed'}
                </span>
              </td>
              <td>{result.scrapedData?.fullName || 'N/A'}</td>
              <td>{result.scrapedData?.phone || 'N/A'}</td>
              <td>
                <button onClick={() => setSelectedBusiness(result)}>
                  Ver Detalles
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedBusiness && (
        <BusinessModal
          business={selectedBusiness}
          onClose={() => setSelectedBusiness(null)}
        />
      )}
    </>
  );
};

const BusinessModal = ({ business, onClose }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>{business.scrapedData?.fullName || business.originalData.name}</h2>
        
        <div className="business-details">
          <section>
            <h3>Información Original</h3>
            <p><strong>Nombre:</strong> {business.originalData.name}</p>
            <p><strong>Dirección:</strong> {business.originalData.address}</p>
            <p><strong>Ciudad:</strong> {business.originalData.city}</p>
          </section>

          <section>
            <h3>Información Extraída</h3>
            <p><strong>Nombre Completo:</strong> {business.scrapedData?.fullName || 'N/A'}</p>
            <p><strong>Dirección:</strong> {business.scrapedData?.fullAddress || 'N/A'}</p>
            <p><strong>Teléfono:</strong> {business.scrapedData?.phone || 'N/A'}</p>
          </section>

          {business.scrapedData?.socialMedia && (
            <section>
              <h3>Redes Sociales</h3>
              {Object.entries(business.scrapedData.socialMedia).map(([platform, url]) => 
                url && (
                  <p key={platform}>
                    <strong>{platform}:</strong> 
                    <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
                  </p>
                )
              )}
            </section>
          )}

          {business.scrapedData?.openingHours && (
            <section>
              <h3>Horarios</h3>
              {Object.entries(business.scrapedData.openingHours).map(([day, hours]) => (
                <p key={day}><strong>{day}:</strong> {hours}</p>
              ))}
            </section>
          )}
        </div>

        <button onClick={onClose}>Cerrar</button>
      </div>
    </div>
  );
};

export default ScrapingDashboard;
```

## Vue.js Example

```vue
<template>
  <div class="scraping-dashboard">
    <div class="upload-section">
      <input
        type="file"
        accept=".csv"
        @change="handleFileChange"
        ref="fileInput"
      />
      <button @click="uploadCSV" :disabled="!file || loading">
        {{ loading ? 'Procesando...' : 'Subir CSV' }}
      </button>
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="results" class="progress-section">
      <div class="progress-bar">
        <div 
          class="progress-fill"
          :style="{ width: results.progress.percentage + '%' }"
        >
          {{ results.progress.percentage }}%
        </div>
      </div>
      
      <div class="stats">
        <span>Completados: {{ results.progress.completed }}</span>
        <span>Total: {{ results.progress.total }}</span>
        <span>Fallidos: {{ results.progress.failed }}</span>
      </div>

      <results-table 
        v-if="results.results && results.results.length > 0"
        :results="results.results"
        @show-details="showBusinessDetails"
      />
    </div>

    <business-modal
      v-if="selectedBusiness"
      :business="selectedBusiness"
      @close="selectedBusiness = null"
    />
  </div>
</template>

<script>
import ResultsTable from './components/ResultsTable.vue';
import BusinessModal from './components/BusinessModal.vue';

export default {
  name: 'ScrapingDashboard',
  components: {
    ResultsTable,
    BusinessModal
  },
  data() {
    return {
      file: null,
      batchId: null,
      results: null,
      loading: false,
      error: null,
      selectedBusiness: null,
      pollingInterval: null,
      API_BASE: 'http://localhost:3000/api/v1'
    };
  },
  methods: {
    handleFileChange(event) {
      this.file = event.target.files[0];
    },
    
    async uploadCSV() {
      if (!this.file) return;
      
      this.loading = true;
      this.error = null;
      
      const formData = new FormData();
      formData.append('file', this.file);

      try {
        const response = await fetch(`${this.API_BASE}/scraping-batch`, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) throw new Error('Upload failed');
        
        const data = await response.json();
        this.batchId = data.batchId;
        this.startPolling();
      } catch (err) {
        this.error = err.message;
        this.loading = false;
      }
    },

    startPolling() {
      this.pollingInterval = setInterval(async () => {
        try {
          const response = await fetch(`${this.API_BASE}/scraping-batch/${this.batchId}`);
          const data = await response.json();
          
          this.results = data;
          
          if (data.status === 'completed' || data.status === 'completed_with_errors') {
            this.stopPolling();
            this.loading = false;
          }
        } catch (err) {
          this.error = err.message;
          this.stopPolling();
          this.loading = false;
        }
      }, 3000);
    },

    stopPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
    },

    showBusinessDetails(business) {
      this.selectedBusiness = business;
    }
  },

  beforeUnmount() {
    this.stopPolling();
  }
};
</script>
```

## Vanilla JavaScript Example

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Web Scraper Dashboard</title>
    <style>
        .progress-bar {
            width: 100%;
            height: 30px;
            background-color: #f0f0f0;
            border-radius: 15px;
            overflow: hidden;
        }
        
        .progress-fill {
            height: 100%;
            background-color: #007bff;
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
        }
        
        .status-success { color: #28a745; }
        .status-partial { color: #ffc107; }
        .status-failed { color: #dc3545; }
        
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
        }
        
        .modal-content {
            background-color: white;
            margin: 5% auto;
            padding: 20px;
            border-radius: 8px;
            width: 80%;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
        }
    </style>
</head>
<body>
    <div id="app">
        <h1>Web Scraper Dashboard</h1>
        
        <div class="upload-section">
            <input type="file" id="csvInput" accept=".csv">
            <button id="uploadBtn">Subir CSV</button>
        </div>
        
        <div id="error" class="error" style="display: none;"></div>
        
        <div id="progressSection" style="display: none;">
            <h3>Progreso del Scraping</h3>
            <div class="progress-bar">
                <div id="progressFill" class="progress-fill">0%</div>
            </div>
            
            <div id="stats" class="stats">
                <p>Estado: <span id="batchStatus">-</span></p>
                <p>Completados: <span id="completed">0</span> / <span id="total">0</span></p>
                <p>Fallidos: <span id="failed">0</span></p>
                <p id="estimatedTime"></p>
            </div>
            
            <div id="resultsSection" style="display: none;">
                <h3>Resultados</h3>
                <button id="showResultsBtn">Ver Tabla de Resultados</button>
            </div>
        </div>
        
        <!-- Modal para la tabla de resultados -->
        <div id="resultsModal" class="modal">
            <div class="modal-content">
                <span id="closeModal" style="float: right; cursor: pointer; font-size: 24px;">&times;</span>
                <h2>Resultados del Scraping</h2>
                <table id="resultsTable" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Nombre Original</th>
                            <th>Estado</th>
                            <th>Nombre Extraído</th>
                            <th>Teléfono</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="resultsTableBody">
                    </tbody>
                </table>
            </div>
        </div>
        
        <!-- Modal para detalles del negocio -->
        <div id="businessModal" class="modal">
            <div class="modal-content">
                <span id="closeBusinessModal" style="float: right; cursor: pointer; font-size: 24px;">&times;</span>
                <div id="businessDetails"></div>
            </div>
        </div>
    </div>

    <script>
        class ScrapingDashboard {
            constructor() {
                this.apiBase = 'http://localhost:3000/api/v1';
                this.batchId = null;
                this.pollingInterval = null;
                this.currentResults = null;
                
                this.initializeEventListeners();
            }
            
            initializeEventListeners() {
                document.getElementById('uploadBtn').addEventListener('click', () => this.uploadCSV());
                document.getElementById('showResultsBtn').addEventListener('click', () => this.showResultsModal());
                document.getElementById('closeModal').addEventListener('click', () => this.hideResultsModal());
                document.getElementById('closeBusinessModal').addEventListener('click', () => this.hideBusinessModal());
            }
            
            async uploadCSV() {
                const fileInput = document.getElementById('csvInput');
                const file = fileInput.files[0];
                
                if (!file) {
                    this.showError('Por favor selecciona un archivo CSV');
                    return;
                }
                
                this.hideError();
                this.showProgressSection();
                
                const formData = new FormData();
                formData.append('file', file);
                
                try {
                    const response = await fetch(`${this.apiBase}/scraping-batch`, {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Error: ${response.status}`);
                    }
                    
                    const data = await response.json();
                    this.batchId = data.batchId;
                    this.startPolling();
                    
                } catch (error) {
                    this.showError('Error subiendo archivo: ' + error.message);
                }
            }
            
            startPolling() {
                this.pollingInterval = setInterval(async () => {
                    try {
                        const response = await fetch(`${this.apiBase}/scraping-batch/${this.batchId}`);
                        const data = await response.json();
                        
                        this.updateProgress(data);
                        this.currentResults = data;
                        
                        if (data.status === 'completed' || data.status === 'completed_with_errors') {
                            this.stopPolling();
                            this.showResultsSection();
                        }
                        
                    } catch (error) {
                        this.showError('Error obteniendo resultados: ' + error.message);
                        this.stopPolling();
                    }
                }, 3000);
            }
            
            stopPolling() {
                if (this.pollingInterval) {
                    clearInterval(this.pollingInterval);
                    this.pollingInterval = null;
                }
            }
            
            updateProgress(data) {
                const { progress, status, timing } = data;
                
                // Actualizar barra de progreso
                const progressFill = document.getElementById('progressFill');
                progressFill.style.width = `${progress.percentage}%`;
                progressFill.textContent = `${progress.percentage}%`;
                
                // Actualizar estadísticas
                document.getElementById('batchStatus').textContent = this.getStatusText(status);
                document.getElementById('completed').textContent = progress.completed;
                document.getElementById('total').textContent = progress.total;
                document.getElementById('failed').textContent = progress.failed;
                
                // Tiempo estimado
                const timeElement = document.getElementById('estimatedTime');
                if (timing.estimatedTimeRemaining) {
                    timeElement.textContent = `Tiempo restante: ${timing.estimatedTimeRemaining}`;
                } else {
                    timeElement.textContent = '';
                }
            }
            
            getStatusText(status) {
                const statusMap = {
                    'queued': 'En cola',
                    'processing': 'Procesando',
                    'completed': 'Completado',
                    'completed_with_errors': 'Completado con errores'
                };
                return statusMap[status] || status;
            }
            
            showProgressSection() {
                document.getElementById('progressSection').style.display = 'block';
            }
            
            showResultsSection() {
                document.getElementById('resultsSection').style.display = 'block';
            }
            
            showResultsModal() {
                if (!this.currentResults || !this.currentResults.results) return;
                
                this.populateResultsTable(this.currentResults.results);
                document.getElementById('resultsModal').style.display = 'block';
            }
            
            hideResultsModal() {
                document.getElementById('resultsModal').style.display = 'none';
            }
            
            populateResultsTable(results) {
                const tbody = document.getElementById('resultsTableBody');
                tbody.innerHTML = '';
                
                results.forEach((result, index) => {
                    const row = document.createElement('tr');
                    const status = result.scrapedData?.status || 'failed';
                    
                    row.innerHTML = `
                        <td>${index + 1}</td>
                        <td>${result.originalData.name || 'N/A'}</td>
                        <td><span class="status-${status}">${status}</span></td>
                        <td>${result.scrapedData?.fullName || 'N/A'}</td>
                        <td>${result.scrapedData?.phone || 'N/A'}</td>
                        <td>
                            <button onclick="dashboard.showBusinessDetails(${index})">
                                Ver Detalles
                            </button>
                        </td>
                    `;
                    
                    tbody.appendChild(row);
                });
            }
            
            showBusinessDetails(index) {
                const result = this.currentResults.results[index];
                if (!result) return;
                
                const detailsDiv = document.getElementById('businessDetails');
                detailsDiv.innerHTML = `
                    <h2>${result.scrapedData?.fullName || result.originalData.name}</h2>
                    
                    <h3>Información Original</h3>
                    <p><b>Nombre:</b> ${result.originalData.name || 'N/A'}</p>
                    <p><b>Dirección:</b> ${result.originalData.address || 'N/A'}</p>
                    <p><b>Ciudad:</b> ${result.originalData.city || 'N/A'}</p>
                    
                    <h3>Información Extraída</h3>
                    <p><b>Nombre Completo:</b> ${result.scrapedData?.fullName || 'N/A'}</p>
                    <p><b>Dirección Completa:</b> ${result.scrapedData?.fullAddress || 'N/A'}</p>
                    <p><b>Teléfono:</b> ${result.scrapedData?.phone || 'N/A'}</p>
                    
                    ${this.generateSocialMediaHTML(result.scrapedData?.socialMedia)}
                    ${this.generateOpeningHoursHTML(result.scrapedData?.openingHours)}
                `;
                
                document.getElementById('businessModal').style.display = 'block';
            }
            
            generateSocialMediaHTML(socialMedia) {
                if (!socialMedia) return '<h3>Redes Sociales</h3><p>No disponible</p>';
                
                const links = Object.entries(socialMedia)
                    .filter(([key, value]) => value)
                    .map(([platform, url]) => 
                        `<p><b>${platform}:</b> <a href="${url}" target="_blank">${url}</a></p>`
                    ).join('');
                
                return `<h3>Redes Sociales</h3>${links || '<p>No encontradas</p>'}`;
            }
            
            generateOpeningHoursHTML(openingHours) {
                if (!openingHours) return '<h3>Horarios</h3><p>No disponible</p>';
                
                const hours = Object.entries(openingHours)
                    .map(([day, time]) => `<p><b>${day}:</b> ${time}</p>`)
                    .join('');
                
                return `<h3>Horarios de Atención</h3>${hours}`;
            }
            
            hideBusinessModal() {
                document.getElementById('businessModal').style.display = 'none';
            }
            
            showError(message) {
                const errorDiv = document.getElementById('error');
                errorDiv.textContent = message;
                errorDiv.style.display = 'block';
            }
            
            hideError() {
                document.getElementById('error').style.display = 'none';
            }
        }
        
        // Inicializar la aplicación
        const dashboard = new ScrapingDashboard();
    </script>
</body>
</html>
```

## Angular Example (TypeScript)

```typescript
// scraping.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, interval, switchMap, takeWhile } from 'rxjs';

export interface BatchResult {
  batchId: string;
  status: string;
  progress: {
    total: number;
    completed: number;
    failed: number;
    processing: number;
    waiting: number;
    percentage: number;
  };
  results: any[];
  // ... resto de la interfaz
}

@Injectable({
  providedIn: 'root'
})
export class ScrapingService {
  private readonly API_BASE = 'http://localhost:3000/api/v1';

  constructor(private http: HttpClient) {}

  uploadCSV(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    
    return this.http.post(`${this.API_BASE}/scraping-batch`, formData);
  }

  getBatchResults(batchId: string): Observable<BatchResult> {
    return this.http.get<BatchResult>(`${this.API_BASE}/scraping-batch/${batchId}`);
  }

  pollBatchResults(batchId: string): Observable<BatchResult> {
    return interval(3000).pipe(
      switchMap(() => this.getBatchResults(batchId)),
      takeWhile(result => 
        result.status !== 'completed' && result.status !== 'completed_with_errors', 
        true
      )
    );
  }
}

// scraping-dashboard.component.ts
import { Component } from '@angular/core';
import { ScrapingService, BatchResult } from './scraping.service';

@Component({
  selector: 'app-scraping-dashboard',
  template: `
    <div class="scraping-dashboard">
      <div class="upload-section">
        <input type="file" (change)="onFileSelected($event)" accept=".csv">
        <button (click)="uploadCSV()" [disabled]="!selectedFile || loading">
          {{ loading ? 'Procesando...' : 'Subir CSV' }}
        </button>
      </div>

      <div *ngIf="error" class="error">{{ error }}</div>

      <div *ngIf="results" class="progress-section">
        <div class="progress-bar">
          <div 
            class="progress-fill"
            [style.width.%]="results.progress.percentage"
          >
            {{ results.progress.percentage }}%
          </div>
        </div>
        
        <div class="stats">
          <p>Estado: {{ getStatusText(results.status) }}</p>
          <p>Completados: {{ results.progress.completed }} / {{ results.progress.total }}</p>
          <p>Fallidos: {{ results.progress.failed }}</p>
        </div>

        <div *ngIf="results.results && results.results.length > 0">
          <button (click)="showModal = true">Ver Resultados</button>
        </div>
      </div>

      <!-- Modal -->
      <div *ngIf="showModal" class="modal" (click)="showModal = false">
        <div class="modal-content" (click)="$event.stopPropagation()">
          <h2>Resultados del Scraping</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Nombre Original</th>
                <th>Estado</th>
                <th>Nombre Extraído</th>
                <th>Teléfono</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let result of results.results; let i = index">
                <td>{{ i + 1 }}</td>
                <td>{{ result.originalData.name }}</td>
                <td>
                  <span [class]="'status-' + (result.scrapedData?.status || 'failed')">
                    {{ result.scrapedData?.status || 'failed' }}
                  </span>
                </td>
                <td>{{ result.scrapedData?.fullName || 'N/A' }}</td>
                <td>{{ result.scrapedData?.phone || 'N/A' }}</td>
                <td>
                  <button (click)="showBusinessDetails(result)">Ver Detalles</button>
                </td>
              </tr>
            </tbody>
          </table>
          <button (click)="showModal = false">Cerrar</button>
        </div>
      </div>
    </div>
  `
})
export class ScrapingDashboardComponent {
  selectedFile: File | null = null;
  loading = false;
  error: string | null = null;
  results: BatchResult | null = null;
  showModal = false;

  constructor(private scrapingService: ScrapingService) {}

  onFileSelected(event: any) {
    this.selectedFile = event.target.files[0];
  }

  uploadCSV() {
    if (!this.selectedFile) return;

    this.loading = true;
    this.error = null;

    this.scrapingService.uploadCSV(this.selectedFile).subscribe({
      next: (response) => {
        this.startPolling(response.batchId);
      },
      error: (error) => {
        this.error = error.message;
        this.loading = false;
      }
    });
  }

  startPolling(batchId: string) {
    this.scrapingService.pollBatchResults(batchId).subscribe({
      next: (results) => {
        this.results = results;
        if (results.status === 'completed' || results.status === 'completed_with_errors') {
          this.loading = false;
        }
      },
      error: (error) => {
        this.error = error.message;
        this.loading = false;
      }
    });
  }

  getStatusText(status: string): string {
    const statusMap: { [key: string]: string } = {
      'queued': 'En cola',
      'processing': 'Procesando',
      'completed': 'Completado',
      'completed_with_errors': 'Completado con errores'
    };
    return statusMap[status] || status;
  }

  showBusinessDetails(result: any) {
    // Implementar modal de detalles
    console.log('Show details for:', result);
  }
}
```

¡Con estos ejemplos deberías poder integrar fácilmente tu frontend con la API de scraping, sin importar qué framework estés usando! 🚀