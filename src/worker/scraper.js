// Web scraper implementation using Playwright
// Core scraping logic and browser automation

import { browserPool } from './browser-pool.js';
import { 
  normalizeForSearch, 
  generateSearchVariations, 
  hasEuropeanChars, 
  getAllEuropeanSelectors 
} from '../utils/character-normalization.js';

/**
 * Scrapes business information from Google Maps
 * @param {Object} data - Business data from CSV row
 * @param {string} data.name - Business name
 * @param {string} data.address - Business address
 * @param {string} data.city - City name
 * @param {string} data.postal_code - Postal code
 * @returns {Promise<Object>} Scraped business information
 */
export async function scrapeBusiness(data) {
  let browser = null;
  let context = null;
  
  try {
    console.log(`🔍 Starting scrape for: ${data.name || 'Unknown Business'}`);
    
    // Detect target country and get localization config
    const targetCountry = detectTargetCountry(data);
    const localizationConfig = getLocalizationConfig(targetCountry);
    console.log(`🌍 Detected target country: ${targetCountry} (${localizationConfig.language}/${localizationConfig.region})`);
    
    // Acquire browser from pool
    browser = await browserPool.acquire();
    console.log('📱 Browser acquired from pool');
    
    // Create new browser context with ENGLISH locale for consistent data extraction
    // We use the region (CH, CO, etc.) but force English language for parsing
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: localizationConfig.userAgent,
      locale: 'en-US', // Force English for consistent extraction
      timezoneId: localizationConfig.timezone,
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9' // Force English interface
      }
    });
    
    const page = await context.newPage();
    
    // Block unnecessary resources for performance
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'font', 'stylesheet', 'media'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });
    
    // Try multiple search strategies with localization
    const searchStrategies = buildSearchStrategies(data, localizationConfig);
    let searchSuccess = false;
    let currentStrategy = '';
    
    for (let i = 0; i < searchStrategies.length && !searchSuccess; i++) {
      const searchQuery = searchStrategies[i].query;
      currentStrategy = searchStrategies[i].name;
      
      // Use localized Google Maps URL with city coordinates
      const googleMapsUrl = buildLocalizedMapsUrl(searchQuery, localizationConfig, data);
      
      console.log(`🗺️ Strategy ${i + 1}/${searchStrategies.length} (${currentStrategy}): ${searchQuery}`);
      console.log(`🌍 Localized URL with coords: ${googleMapsUrl}`);
      
      try {
        // Navigate to Google Maps with reliable settings
        await page.goto(googleMapsUrl, { 
          waitUntil: 'networkidle', // Wait for network to be idle for better reliability
          timeout: 30000 // Increased timeout for stability under load
        });
        
        // Wait for search results to load properly
        await page.waitForTimeout(3000); // Increased wait time for content to fully render
        
        // Check if we found a business page directly
        searchSuccess = await checkIfBusinessFound(page);
        
        if (searchSuccess) {
          console.log(`✅ Search successful with strategy: ${currentStrategy}`);
          break;
        }
        
        // If not on business page, we might be on search results - try clicking first result
        console.log(`🔍 Not on business page directly, checking for search results to click...`);
        
        const businessSelectors = [
          'a[href*="/maps/place/"]',                    // Most reliable: Direct place links
          '.hfpxzc',                                    // Business card (common)
          '[role="article"]',                           // Article role (common in results)
          'div[jsaction*="mouseover"]',                 // Hoverable results
          'a[href*="@"]',                               // Links with coordinates (@lat,lng)
        ];
        
        let clickedResult = false;
        for (const selector of businessSelectors) {
          try {
            const results = await page.locator(selector).count();
            if (results > 0) {
              console.log(`🔍 Found ${results} search results with selector: ${selector}`);
              
              const firstResult = page.locator(selector).first();
              
              // APPROACH 1: Try to get the href and navigate directly (faster, more reliable)
              if (selector.includes('href')) {
                try {
                  const href = await firstResult.getAttribute('href');
                  if (href && href.includes('/maps/place/')) {
                    console.log(`🔗 Navigating directly to place URL...`);
                    // Direct navigation to business page
                    await page.goto(`https://www.google.com${href}`, { 
                      waitUntil: 'networkidle', 
                      timeout: 30000
                    });
                    await page.waitForTimeout(2500);
                    
                    searchSuccess = await checkIfBusinessFound(page);
                    if (searchSuccess) {
                      console.log(`✅ Successfully loaded business details via direct navigation`);
                      clickedResult = true;
                      break;
                    }
                  }
                } catch (navError) {
                  console.log(`⚠️ Direct navigation failed: ${navError.message}`);
                }
              }
              
              // APPROACH 2: Try scrolling into view and clicking
              console.log(`🖱️ Attempting to scroll and click first result...`);
              try {
                await firstResult.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(e => {
                  console.log(`⚠️ Scroll timeout (this is OK, will try click anyway)`);
                });
                
                await page.waitForTimeout(500);
                await firstResult.click({ timeout: 8000, force: false });
                await page.waitForTimeout(3000);
                
                searchSuccess = await checkIfBusinessFound(page);
                if (searchSuccess) {
                  console.log(`✅ Successfully loaded business details after clicking`);
                  clickedResult = true;
                  break;
                }
              } catch (clickError) {
                console.log(`⚠️ Click failed: ${clickError.message}`);
              }
            }
          } catch (selectorError) {
            console.log(`⚠️ Could not process selector ${selector}: ${selectorError.message}`);
            continue;
          }
        }
        
        if (searchSuccess) {
          break;
        }
        
        console.log(`❌ Strategy ${currentStrategy} failed - no valid business page found`);
      } catch (error) {
        console.log(`❌ Strategy ${currentStrategy} error: ${error.message}`);
        continue;
      }
    }
    
    if (!searchSuccess) {
      console.log('❌ All search strategies failed');
      return createEmptyResult(data, 'Business not found with any search strategy');
    }
    
    // At this point, we should be on a business detail page
    // Verify we can extract data
    console.log(`✅ On business detail page, proceeding to extract data...`);
    
    // Extract business information
    const scrapedData = await extractBusinessDetails(page, data, targetCountry);
    
    console.log(`✅ Successfully scraped: ${scrapedData.fullName}`);
    return scrapedData;
    
  } catch (error) {
    console.error(`❌ Error scraping business ${data.name}:`, error.message);
    return createEmptyResult(data, error.message);
  } finally {
    // Always clean up resources
    if (context) {
      try {
        await context.close();
        console.log('🧹 Browser context closed');
      } catch (error) {
        console.error('❌ Error closing context:', error);
      }
    }
    
    if (browser) {
      try {
        await browserPool.release(browser);
        console.log('🔄 Browser released back to pool');
      } catch (error) {
        console.error('❌ Error releasing browser:', error);
      }
    }
  }
}

/**
 * Builds multiple search strategies for finding a business
 * Enhanced with European character normalization and localization
 * @param {Object} data - Business data
 * @param {Object} localizationConfig - Localization configuration
 * @returns {Array} Array of search strategies
 */
function buildSearchStrategies(data, localizationConfig = null) {
  const strategies = [];
  
  console.log(`🔎 Building OPTIMIZED search strategies for: ${data.name}`);
  
  // OPTIMIZED APPROACH: Top 5 most effective strategies only
  // Order: Most specific → High success rate → Fallbacks
  // Removed: Low-success strategies 3, 6, 8 to improve speed
  
  // STRATEGY 1: Full exact match - Name + Address + City (highest precision)
  if (data.name && data.address && data.city) {
    strategies.push({
      name: `Strategy 1: Full Match (Name + Address + City)`,
      query: `${data.name}, ${data.address}, ${data.city}`.trim()
    });
    console.log(`✅ Strategy 1: ${data.name}, ${data.address}, ${data.city}`);
  }
  
  // STRATEGY 2: Name + City (highest success rate - 80%+)
  if (data.name && data.city) {
    strategies.push({
      name: `Strategy 2: Name + City`,
      query: `${data.name} ${data.city}`.trim()
    });
    console.log(`✅ Strategy 2: ${data.name} ${data.city}`);
  }
  
  // STRATEGY 3: Name + Address (unique addresses)
  if (data.name && data.address) {
    strategies.push({
      name: `Strategy 3: Name + Address`,
      query: `${data.name} ${data.address}`.trim()
    });
    console.log(`✅ Strategy 3: ${data.name} ${data.address}`);
  }
  
  // STRATEGY 4: Address + City (when name is generic)
  if (data.address && data.city) {
    strategies.push({
      name: `Strategy 4: Address + City`,
      query: `${data.address}, ${data.city}`.trim()
    });
    console.log(`✅ Strategy 4: ${data.address}, ${data.city}`);
  }
  
  // STRATEGY 5: Quoted name + City (chain stores fallback)
  if (data.name && data.city) {
    strategies.push({
      name: `Strategy 5: Quoted Name + City`,
      query: `"${data.name}" ${data.city}`.trim()
    });
    console.log(`✅ Strategy 5: "${data.name}" ${data.city}`);
  }
  
  console.log(`🎯 Generated ${strategies.length} OPTIMIZED search strategies (reduced from 8 to 5)`);
  console.log('⚡ Trying: Full→Name+City→Name+Addr→Addr+City→Quoted');
  return strategies;
}

/**
 * Detects the target country based on business data patterns
 * @param {Object} data - Business data from CSV
 * @returns {string} Country code (CH, DE, FR, IT, ES, etc.)
 */
function detectTargetCountry(data) {
  const { postal_code, city, address, name } = data;
  
  // Swiss patterns
  if (postal_code && /^\d{4}$/.test(postal_code.toString())) {
    return 'CH'; // Swiss postal codes are 4 digits
  }
  
  // German patterns
  if (postal_code && /^\d{5}$/.test(postal_code.toString())) {
    return 'DE'; // German postal codes are 5 digits
  }
  
  // French patterns
  if (postal_code && /^\d{5}$/.test(postal_code.toString()) && 
      (city && /paris|lyon|marseille|toulouse|nice|nantes|strasbourg|montpellier|bordeaux|lille/i.test(city))) {
    return 'FR';
  }
  
  // Italian patterns
  if (postal_code && /^\d{5}$/.test(postal_code.toString()) && 
      (city && /roma|milano|napoli|torino|palermo|genova|bologna|firenze|bari|catania/i.test(city))) {
    return 'IT';
  }
  
  // City-based detection for well-known European cities
  if (city) {
    const cityLower = city.toLowerCase();
    
    // Swiss cities
    if (/zurich|geneva|basel|bern|lausanne|winterthur|lucerne|st\.?\s*gallen|lugano|biel/i.test(cityLower)) {
      return 'CH';
    }
    
    // German cities
    if (/berlin|hamburg|munich|münchen|cologne|köln|frankfurt|stuttgart|düsseldorf|dortmund|essen|leipzig|bremen|dresden|hannover|nüremberg|duisburg/i.test(cityLower)) {
      return 'DE';
    }
    
    // French cities
    if (/paris|lyon|marseille|toulouse|nice|nantes|strasbourg|montpellier|bordeaux|lille|rennes|reims|le havre|saint-étienne|toulon|grenoble|dijon|angers|nîmes|villeurbanne/i.test(cityLower)) {
      return 'FR';
    }
    
    // Italian cities
    if (/roma|milano|napoli|torino|palermo|genova|bologna|firenze|bari|catania|venezia|verona|messina|padova|trieste|brescia|parma|taranto|prato|modena/i.test(cityLower)) {
      return 'IT';
    }
  }
  
  // Address-based patterns
  if (address) {
    const addressLower = address.toLowerCase();
    
    // Swiss address patterns
    if (/\bch-\d{4}\b|schweiz|suisse|svizzera|switzerland|strasse|gasse|platz.*\d{4}/i.test(addressLower)) {
      return 'CH';
    }
    
    // German address patterns
    if (/\b\d{5}\s+[a-z]+.*deutschland|straße|platz.*\d{5}|germany/i.test(addressLower)) {
      return 'DE';
    }
    
    // French address patterns
    if (/\b\d{5}\s+[a-z]+.*france|rue|avenue.*\d{5}|france/i.test(addressLower)) {
      return 'FR';
    }
    
    // Italian address patterns
    if (/\b\d{5}\s+[a-z]+.*italia|via|corso.*\d{5}|italy/i.test(addressLower)) {
      return 'IT';
    }
  }
  
  // Default fallback based on context
  return 'CH'; // Default to Switzerland as many European businesses
}

/**
 * Gets localization configuration for a specific country
 * @param {string} countryCode - Country code (CH, DE, FR, IT, etc.)
 * @returns {Object} Localization configuration
 */
function getLocalizationConfig(countryCode) {
  const configs = {
    'CH': {
      language: 'de',
      region: 'CH',
      timezone: 'Europe/Zurich',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      currency: 'CHF',
      phonePrefix: '+41'
    },
    'DE': {
      language: 'de',
      region: 'DE',
      timezone: 'Europe/Berlin',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      currency: 'EUR',
      phonePrefix: '+49'
    },
    'FR': {
      language: 'fr',
      region: 'FR',
      timezone: 'Europe/Paris',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      currency: 'EUR',
      phonePrefix: '+33'
    },
    'IT': {
      language: 'it',
      region: 'IT',
      timezone: 'Europe/Rome',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      currency: 'EUR',
      phonePrefix: '+39'
    },
    'ES': {
      language: 'es',
      region: 'ES',
      timezone: 'Europe/Madrid',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      currency: 'EUR',
      phonePrefix: '+34'
    },
    'AT': {
      language: 'de',
      region: 'AT',
      timezone: 'Europe/Vienna',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      currency: 'EUR',
      phonePrefix: '+43'
    }
  };
  
  return configs[countryCode] || configs['CH']; // Default to Swiss config
}

/**
 * Builds Google Maps URL with proper localization
 * @param {string} query - Search query
 * @param {Object} localizationConfig - Localization configuration
 * @returns {string} Localized Google Maps URL
 */
function buildLocalizedMapsUrl(query, localizationConfig, cityData = null) {
  const encodedQuery = encodeURIComponent(query);
  
  // Try to extract city from query or use cityData
  let cityName = cityData?.city || '';
  if (!cityName && query) {
    // Extract last word as potential city name
    const words = query.trim().split(' ');
    cityName = words[words.length - 1];
  }
  
  // Get approximate coordinates for the city
  const cityCoords = getCityCoordinates(cityName, localizationConfig?.region);
  
  // Build URL with coordinates to force correct region
  // Use English language (hl=en) for consistent extraction, but keep correct region (gl)
  const baseUrl = 'https://www.google.com/maps/search/';
  const params = new URLSearchParams({
    api: '1',
    query: encodedQuery,
    hl: 'en', // Force English for consistent data
    gl: localizationConfig.region // Keep correct region (CH, CO, etc.)
  });
  
  // Add center coordinates if available - CRITICAL for correct geolocation
  if (cityCoords) {
    params.append('center', `${cityCoords.lat},${cityCoords.lng}`);
    params.append('zoom', '13'); // City-level zoom
    console.log(`📍 Using coordinates for ${cityName}: ${cityCoords.lat}, ${cityCoords.lng}`);
  } else {
    console.log(`⚠️ No coordinates found for city: ${cityName}`);
  }
  
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Gets approximate coordinates for major cities worldwide
 * This forces Google Maps to search in the correct region
 * @param {string} cityName - City name
 * @param {string} countryCode - Country code (CH, DE, FR, CO, etc.)
 * @returns {Object|null} {lat, lng} or null
 */
function getCityCoordinates(cityName, countryCode) {
  if (!cityName) return null;
  
  const cityLower = cityName.toLowerCase().trim();
  
  // Comprehensive city coordinates database
  const cityCoords = {
    // Switzerland - Extended
    'zürich': { lat: 47.3769, lng: 8.5417 },
    'zurich': { lat: 47.3769, lng: 8.5417 },
    'genève': { lat: 46.2044, lng: 6.1432 },
    'geneve': { lat: 46.2044, lng: 6.1432 },
    'geneva': { lat: 46.2044, lng: 6.1432 },
    'basel': { lat: 47.5596, lng: 7.5886 },
    'bern': { lat: 46.9480, lng: 7.4474 },
    'berne': { lat: 46.9480, lng: 7.4474 },
    'lausanne': { lat: 46.5197, lng: 6.6323 },
    'luzern': { lat: 47.0502, lng: 8.3093 },
    'lucerne': { lat: 47.0502, lng: 8.3093 },
    'lugano': { lat: 46.0037, lng: 8.9511 },
    'st. gallen': { lat: 47.4239, lng: 9.3745 },
    'st.gallen': { lat: 47.4239, lng: 9.3745 },
    'st gallen': { lat: 47.4239, lng: 9.3745 },
    'winterthur': { lat: 47.5000, lng: 8.7500 },
    'thun': { lat: 46.7578, lng: 7.6280 },
    'biel': { lat: 47.1368, lng: 7.2463 },
    'bienne': { lat: 47.1368, lng: 7.2463 },
    'wallisellen': { lat: 47.4133, lng: 8.5961 },
    'uster': { lat: 47.3510, lng: 8.7206 },
    'emmen': { lat: 47.0790, lng: 8.3010 },
    'dietikon': { lat: 47.4024, lng: 8.4008 },
    'kriens': { lat: 47.0360, lng: 8.2789 },
    'baar': { lat: 47.1979, lng: 8.5293 },
    'zug': { lat: 47.1724, lng: 8.5153 },
    
    // Colombia
    'cartagena': { lat: 10.3910, lng: -75.4794 },
    'bogotá': { lat: 4.7110, lng: -74.0721 },
    'bogota': { lat: 4.7110, lng: -74.0721 },
    'medellín': { lat: 6.2442, lng: -75.5812 },
    'medellin': { lat: 6.2442, lng: -75.5812 },
    'cali': { lat: 3.4516, lng: -76.5320 },
    'barranquilla': { lat: 10.9639, lng: -74.7964 },
    'bucaramanga': { lat: 7.1254, lng: -73.1198 },
    
    // Germany
    'berlin': { lat: 52.5200, lng: 13.4050 },
    'münchen': { lat: 48.1351, lng: 11.5820 },
    'munich': { lat: 48.1351, lng: 11.5820 },
    'hamburg': { lat: 53.5511, lng: 9.9937 },
    'frankfurt': { lat: 50.1109, lng: 8.6821 },
    'köln': { lat: 50.9375, lng: 6.9603 },
    'cologne': { lat: 50.9375, lng: 6.9603 },
    
    // France
    'paris': { lat: 48.8566, lng: 2.3522 },
    'lyon': { lat: 45.7640, lng: 4.8357 },
    'marseille': { lat: 43.2965, lng: 5.3698 },
    'nice': { lat: 43.7102, lng: 7.2620 },
    
    // Italy
    'roma': { lat: 41.9028, lng: 12.4964 },
    'rome': { lat: 41.9028, lng: 12.4964 },
    'milano': { lat: 45.4642, lng: 9.1900 },
    'milan': { lat: 45.4642, lng: 9.1900 },
    'napoli': { lat: 40.8518, lng: 14.2681 },
    'naples': { lat: 40.8518, lng: 14.2681 },
    
    // Spain
    'madrid': { lat: 40.4168, lng: -3.7038 },
    'barcelona': { lat: 41.3851, lng: 2.1734 },
    'valencia': { lat: 39.4699, lng: -0.3763 },
    'sevilla': { lat: 37.3891, lng: -5.9845 }
  };
  
  return cityCoords[cityLower] || null;
}

/**
 * Checks if a business was found on the current page
 * @param {Page} page - Playwright page
 * @returns {Promise<boolean>} True if business found
 */
async function checkIfBusinessFound(page) {
  // First check if we're on a search results page (bad)
  const searchResultsIndicators = [
    'div[role="main"] h1:has-text("Ergebnisse")',
    'div[role="main"] h1:has-text("Results")',
    'div[role="main"] h1:has-text("Resultados")',
    'div[role="main"] h1:has-text("Résultats")',
    'h1:has-text("Ergebnisse für")',
    'h1:has-text("Results for")',
    '.section-hero-header-title:has-text("Ergebnisse")',
    '[data-attrid="title"]:has-text("Ergebnisse")',
    // Generic search results patterns
    'div[aria-label*="results"]',
    'div[aria-label*="Ergebnisse"]',
    '.section-result-content',
    '.section-scrollable-list .section-result'
  ];
  
  // If we detect search results page, return false
  for (const selector of searchResultsIndicators) {
    try {
      const count = await page.locator(selector).count();
      if (count > 0) {
        const text = await page.locator(selector).first().textContent().catch(() => '');
        if (text && (text.includes('Ergebnisse') || text.includes('Results') || text.includes('Resultados') || text.includes('Résultats'))) {
          console.log(`🚫 Detected search results page: "${text}"`);
          return false;
        }
      }
    } catch (error) {
      // Ignore selector errors and continue checking
    }
  }
  
  // Now check for actual business page indicators
  const businessIndicators = [
    'h1[data-attrid="title"]:not(:has-text("Ergebnisse")):not(:has-text("Results"))',
    'h1.DUwDvf:not(:has-text("Ergebnisse")):not(:has-text("Results"))',
    '[data-item-id="address"]',
    '.MW4etd',  // Rating element
    '.F7nice',  // Rating container
    'button[data-item-id="address"]',
    '[data-attrid="kc:/collection/knowledge_panels/local_entity:title"]',
    '.section-hero-header-title-title:not(:has-text("Ergebnisse"))',
    '.place-name'
  ];
  
  for (const selector of businessIndicators) {
    try {
      const count = await page.locator(selector).count();
      if (count > 0) {
        const text = await page.locator(selector).first().textContent().catch(() => '');
        // Make sure it's not a search results text
        if (text && !text.includes('Ergebnisse') && !text.includes('Results for') && !text.includes('Resultados para')) {
          console.log(`✅ Business page detected with: "${text}"`);
          return true;
        }
      }
    } catch (error) {
      // Ignore selector errors and continue checking
    }
  }
  
  console.log(`❌ No valid business page detected`);
  return false;
}

/**
 * Builds a search query from business data (legacy function)
 * @param {Object} data - Business data
 * @returns {string} Search query
 */
function buildSearchQuery(data) {
  const parts = [];
  
  if (data.name) parts.push(data.name);
  if (data.address) parts.push(data.address);
  if (data.city) parts.push(data.city);
  if (data.postal_code) parts.push(data.postal_code);
  
  return parts.join(' ').trim();
}

/**
 * Extracts business details from Google Maps page
 * @param {Page} page - Playwright page object
 * @param {Object} originalData - Original CSV data
 * @returns {Promise<Object>} Extracted business information
 */
async function extractBusinessDetails(page, originalData, targetCountry = 'CH') {
  const result = {
    // Original data
    originalName: originalData.name || '',
    originalAddress: originalData.address || '',
    originalCity: originalData.city || '',
    originalPostalCode: originalData.postal_code || '',
    
    // Scraped data
    fullName: '',
    fullAddress: '',
    phone: '',
    rating: '',
    reviewsCount: '',
    website: '',
    category: '',
    latitude: '',
    longitude: '',
    socialMedia: {},
    openingHours: {},
    
    // Metadata
    scrapedAt: new Date().toISOString(),
    status: 'success',
    error: null
  };
  
  try {
    // SIMPLIFIED: Extract business name from Google Maps sidebar
    const nameSelectors = [
      'h1.DUwDvf',                                   // Most common: Business name in sidebar
      'h1.fontHeadlineLarge',                        // Alternative headline format
      'h1',                                          // Any h1 (fallback)
    ];
    
    result.fullName = await extractTextFromSelectors(page, nameSelectors, 'name') || originalData.name || '';
    console.log(`📝 Extracted name: "${result.fullName}"`);
    
    // Validate if we extracted "Ergebnisse" or other search result indicators
    const searchResultNames = ['Ergebnisse', 'Results', 'Resultados', 'Résultats', 'Results for', 'Ergebnisse für'];
    const foundSearchTerm = searchResultNames.find(term => result.fullName.includes(term));
    if (foundSearchTerm) {
      console.log(`🚫 DETECTED SEARCH RESULTS PAGE! Name contains: "${foundSearchTerm}"`);
      console.log(`🚫 Full extracted name: "${result.fullName}"`);
      console.log(`🚫 Returning failed status due to search results page detection`);
      // Return a failed result indicating we're on a search results page
      return {
        ...result,
        fullName: originalData.name || 'Search Results Page',
        status: 'failed',
        error: 'Landing on search results page instead of business page'
      };
    }
    
    // SIMPLIFIED: Extract address from Google Maps sidebar
    const addressSelectors = [
      'button[data-item-id="address"] .Io6YTe',     // Most common: Address button text
      '[data-item-id="address"] .fontBodyMedium',   // Address with medium font
      'button[aria-label*="ddress"] .Io6YTe',       // Address button (multi-language: Address/Adresse/Indirizzo)
    ];
    
    result.fullAddress = await extractTextFromSelectors(page, addressSelectors, 'address') || '';
    console.log(`📍 Extracted address: ${result.fullAddress}`);
    
    // COMPREHENSIVE: Extract phone from Google Maps sidebar (2025 updated selectors)
    const phoneSelectors = [
      'button[data-item-id="phone:tel"] .Io6YTe',     // 2024 format: Phone button text
      'button[data-item-id="phone:tel"]',              // 2024 format: Phone button (any text)
      '[data-item-id*="phone"] button',                // 2025 format: Any phone item with button
      '[data-item-id*="phone"] .fontBodyMedium',       // 2025 format: Phone with medium font
      '[data-item-id*="phone"] div[class*="fontBody"]', // 2025 format: Phone with font body class
      'a[href^="tel:"]',                               // Direct tel: link
      'button[aria-label*="Call"]',                    // English: Call button
      'button[aria-label*="Anrufen"]',                 // German: Call button  
      'button[aria-label*="Llamar"]',                  // Spanish: Call button
      'button[aria-label*="Appeler"]',                 // French: Call button
      'button[aria-label*="phone"] .Io6YTe',           // Phone aria-label with text
      'button[aria-label*="telefon"]',                 // German: Telefon
      'button[aria-label*="téléphone"]',               // French: téléphone
      '[data-tooltip*="phone"]',                       // Tooltip containing phone
      '[data-tooltip*="Call"]',                        // Tooltip with Call
      'button[jsaction*="phone"]',                     // JS action for phone
    ];
    
    console.log('🔍 Starting phone number extraction...');
    result.phone = await extractTextFromSelectors(page, phoneSelectors, 'phone') || '';
    
    // FALLBACK: If no phone found, try to extract from page using regex
    if (!result.phone || result.phone.trim() === '') {
      console.log('⚠️ No phone found with selectors, trying page-wide search...');
      try {
        const pageText = await page.evaluate(() => document.body.innerText);
        // Match phone patterns: +41, 00, international formats
        const phonePatterns = [
          /\+\d{1,3}\s?\d{1,4}\s?\d{1,4}\s?\d{1,4}\s?\d{0,4}/g,  // +41 44 123 45 67
          /\d{3}\s?\d{3}\s?\d{2}\s?\d{2}/g,                       // 044 123 45 67
          /\(\d{3}\)\s?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g,             // (044) 123 45 67
        ];
        
        for (const pattern of phonePatterns) {
          const matches = pageText.match(pattern);
          if (matches && matches.length > 0) {
            // Take first match that looks like a phone number
            const potentialPhone = matches[0].trim();
            // Validate it's not just random numbers
            if (potentialPhone.length >= 9 && potentialPhone.length <= 20) {
              result.phone = potentialPhone;
              console.log(`📞 Found phone via regex: "${result.phone}"`);
              break;
            }
          }
        }
      } catch (regexError) {
        console.log(`⚠️ Regex phone search failed: ${regexError.message}`);
      }
    }
    
    // NORMALIZE: Format phone to international format based on country
    if (result.phone && result.phone.trim() !== '') {
      result.phone = normalizePhoneNumber(result.phone, targetCountry);
      console.log(`📞 Normalized phone: "${result.phone}"`);
    } else {
      console.log(`📞 Phone extraction result: "${result.phone}"`);
    }
    
    // COMPREHENSIVE: Extract rating from Google Maps sidebar (multiple strategies)
    const ratingSelectors = [
      '.F7nice .ceNzKf',                            // Most common: Rating number in sidebar
      'span.ceNzKf',                                // Rating span (general)
      'div[jsaction*="pane.rating"] span',          // Rating in jsaction div
      'div[role="img"][aria-label*="star"] + span', // Next to stars (English)
      'div[role="img"][aria-label*="stern"] + span', // German: Sterne
      'div[role="img"][aria-label*="estrell"] + span', // Spanish: estrellas
      '.fontDisplayLarge',                          // Large display font (sometimes rating)
      'button[aria-label*="stars"] span',           // Stars button with span
      '[aria-label*="rating"] span',                // Any rating aria-label
    ];
    
    result.rating = await extractTextFromSelectors(page, ratingSelectors, 'rating') || '';
    
    // Format rating to ensure decimal display
    if (result.rating && !isNaN(result.rating)) {
      const numRating = parseFloat(result.rating);
      if (numRating >= 0 && numRating <= 5) {
        // Format as decimal (e.g., "4" becomes "4.0")
        result.rating = numRating % 1 === 0 ? numRating.toFixed(1) : numRating.toString();
      }
    }
    
    console.log(`⭐ Formatted rating: ${result.rating}`);
    
    // COMPREHENSIVE: Extract reviews count from Google Maps sidebar (multiple strategies)
    const reviewsSelectors = [
      '.F7nice .MW4etd',                            // Most common: Review count in sidebar
      'button[aria-label*="eview"] .MW4etd',        // Review button (multi-language: review/bewertung/reseña)
      'button[aria-label*="ewertung"] .MW4etd',     // German: Bewertungen
      'button[aria-label*="eseña"] .MW4etd',        // Spanish: reseñas
      'button[aria-label*="ecensio"] .MW4etd',      // Italian: recensioni
      'button[jsaction*="pane.rating"] .MW4etd',    // Reviews in rating jsaction
      '.fontBodyMedium.MW4etd',                     // Medium font reviews count
      'span.MW4etd',                                // General reviews span
      '[aria-label*="reviews"] span',               // Any reviews aria-label
    ];
    
    console.log('🔍 Starting reviews count extraction...');
    result.reviewsCount = await extractTextFromSelectors(page, reviewsSelectors, 'reviews') || '';
    console.log(`📊 Reviews extraction result: "${result.reviewsCount}"`);
    
    // SIMPLIFIED: Extract website from Google Maps sidebar
    const websiteSelectors = [
      'a[data-item-id="authority"]',                // Most common: Website link
      'button[data-item-id="authority"]',           // Website button
      'a[href^="http"]:not([href*="google"]):not([href*="maps"])', // External links (not Google)
    ];
    
    result.website = await extractWebsiteFromSelectors(page, websiteSelectors) || '';
    console.log(`🌐 Extracted website: ${result.website}`);
    
    // SIMPLIFIED: Extract category from Google Maps sidebar
    const categorySelectors = [
      '.DkEaL',                                     // Most common: Category display
      'button[jsaction*="pane.category"]',          // Category button
      '.fontBodyMedium:not(.MW4etd):not(.ceNzKf)', // Medium font (not rating/reviews)
    ];
    
    result.category = await extractTextFromSelectors(page, categorySelectors, 'category') || '';
    console.log(`🏷️ Extracted category: ${result.category}`);
    
    // Extract coordinates (latitude and longitude)
    const coordinates = await extractCoordinates(page);
    result.latitude = coordinates.latitude;
    result.longitude = coordinates.longitude;
    console.log(`📍 Extracted coordinates: ${result.latitude}, ${result.longitude}`);
    
    // Extract opening hours
    result.openingHours = await extractOpeningHours(page);
    
    // Extract social media links
    result.socialMedia = await extractSocialMedia(page);
    
  } catch (error) {
    console.error('❌ Error extracting business details:', error);
    result.status = 'partial';
    result.error = error.message;
  }
  
  return result;
}

/**
 * Extracts text from multiple selectors with smart filtering
 * @param {Page} page - Playwright page
 * @param {string[]} selectors - Array of CSS selectors to try
 * @param {string} fieldType - Type of field being extracted (for better filtering)
 * @returns {Promise<string>} Extracted text or empty string
 */
async function extractTextFromSelectors(page, selectors, fieldType = 'general') {
  // Generic terms to avoid (indicates we're not on the right page)
  const genericTerms = [
    'resultados', 'results', 'resultado', 'result',
    'búsqueda', 'search', 'buscar', 'suchen',
    'filtros', 'filters', 'filtrar', 'filter'
  ];
  
  for (const selector of selectors) {
    try {
      console.log(`🔍 Trying selector: ${selector}`);
      const element = await page.locator(selector).first();
      const count = await element.count();
      console.log(`📊 Found ${count} elements with selector: ${selector}`);
      
      if (count > 0) {
        const text = await element.textContent();
        console.log(`📝 Raw text from selector "${selector}": "${text}"`);
        
        if (text && text.trim()) {
          const cleanText = text.trim();
          
          // Field-specific validation and filtering
          if (fieldType === 'name') {
            const isGeneric = genericTerms.some(term => 
              cleanText.toLowerCase().includes(term.toLowerCase())
            );
            if (isGeneric) {
              console.log(`⚠️ Skipping generic text: "${cleanText}"`);
              continue;
            }
            
            // Skip if it's just a number (probably a rating)
            if (/^\d+(\.\d+)?$/.test(cleanText)) {
              console.log(`⚠️ Skipping numeric value: "${cleanText}"`);
              continue;
            }
          }
          
          // Rating validation - should be a number between 0-5
          if (fieldType === 'rating') {
            // Extract numeric rating from text (improved decimal support)
            const ratingMatch = cleanText.match(/(\d+(?:[,.]\d+)?)/);
            if (ratingMatch) {
              // Handle both comma and dot as decimal separator
              const ratingStr = ratingMatch[1].replace(',', '.');
              const numericRating = parseFloat(ratingStr);
              if (numericRating >= 0 && numericRating <= 5) {
                console.log(`⭐ Valid rating found: ${numericRating} (from "${cleanText}")`);
                // Return as formatted decimal (e.g., "4.0" instead of "4")
                return numericRating % 1 === 0 ? numericRating.toFixed(1) : numericRating.toString();
              }
            }
            console.log(`⚠️ Invalid rating format: "${cleanText}"`);
            continue;
          }
          
          // Category validation - avoid numeric values and rating-like text
          if (fieldType === 'category') {
            // Skip pure numbers (likely ratings)
            if (/^\d+(\.\d+)?$/.test(cleanText)) {
              console.log(`⚠️ Skipping numeric category (likely rating): "${cleanText}"`);
              continue;
            }
            // Skip rating patterns
            if (cleanText.includes('★') || cleanText.includes('star') || /\d+\.\d+/.test(cleanText)) {
              console.log(`⚠️ Skipping rating-like category: "${cleanText}"`);
              continue;
            }
          }
          
          // Phone validation moved to final check section to avoid early returns
          
          // Reviews validation - enhanced for 2025 Google Maps format
          if (fieldType === 'reviews') {
            // Handle various review formats from Google Maps 2025
            const reviewPatterns = [
              /\(([0-9,.]+)\)/,                 // Parentheses format (1.309)
              /([0-9,.]+)\s+review/i,            // "1309 reviews"
              /([0-9,.]+)\s+bewertung/i,         // "1309 Bewertungen"
              /([0-9,.]+)\s+recensioner?/i,     // "1309 recensioner"
              /([0-9,.]+)\s+anmeldelse/i,       // "1309 anmeldelser"
              /^([0-9,.]+)$/                     // Just numbers: 1309, 1.309
            ];
            
            for (const pattern of reviewPatterns) {
              const reviewMatch = cleanText.match(pattern);
              if (reviewMatch) {
                // Remove dots and commas from thousands separators but keep as string
                let reviewCount = reviewMatch[1];
                // Handle European number format (1.309 -> 1309)
                if (reviewCount.includes('.') && reviewCount.length > 4) {
                  reviewCount = reviewCount.replace(/\./g, '');
                } else if (reviewCount.includes(',') && reviewCount.length > 4) {
                  reviewCount = reviewCount.replace(/,/g, '');
                }
                
                if (/^\d+$/.test(reviewCount)) {
                  console.log(`📊 Valid review count found: ${reviewCount} (from "${cleanText}")`);
                  return reviewCount;
                }
              }
            }
            
            // Fallback: if it's just a number, use it
            if (/^[0-9,.]+$/.test(cleanText)) {
              let cleanCount = cleanText.replace(/[.,]/g, '');
              if (/^\d+$/.test(cleanCount) && cleanCount.length >= 1) {
                console.log(`📊 Valid review count found (numeric): ${cleanCount} (from "${cleanText}")`);
                return cleanCount;
              }
            }
            
            console.log(`⚠️ No valid review count in: "${cleanText}"`);
            continue;
          }
          
          // Phone validation BEFORE generic return
          if (fieldType === 'phone') {
            // FIRST: Reject obvious non-phone content
            if (cleanText.includes('★') || cleanText.includes('·') || cleanText.includes('$') ||
                cleanText.includes('€') || cleanText.includes('CHF') ||
                /\d\.\d.*\(/.test(cleanText) ||  // Pattern like "3.7(1.309)" - rating format
                /\d,\d.*\(/.test(cleanText) ||   // Pattern like "3,7(1.309)" - rating format  
                cleanText.length > 50 ||         // Too long for phone
                cleanText.includes('review') || cleanText.includes('bewertung') ||
                cleanText.includes('rating') || cleanText.includes('stern')) {
              console.log(`⚠️ Skipping non-phone content: "${cleanText}"`);
              continue;
            }
            
            // Enhanced phone validation for Swiss/European numbers
            const phonePatterns = [
              /^\+\d{1,3}[\s\-]?\d+/,           // International format (+41 44 839 34 34)
              /^0\d{2}[\s\-]?\d+/,              // Swiss national format (044 123...)
              /^\(\d+\)[\s\-]?\d+/,             // Format with area code in parentheses
              /^\d{7,15}$/,                     // Just digits (7-15 digits)
              /^\d{2,3}[\s\-]?\d{3}[\s\-]?\d{2,4}$/ // Standard format (44 839 34 34)
            ];
            
            if (phonePatterns.some(pattern => pattern.test(cleanText))) {
              console.log(`📞 Valid phone found: ${cleanText}`);
              return cleanText;
            }
            
            // Accept if contains specific country codes and looks like phone
            if ((cleanText.includes('+41') || cleanText.includes('+49') || 
                cleanText.includes('+33') || cleanText.includes('+39') ||
                cleanText.includes('+34') || cleanText.includes('+46')) &&
                cleanText.length >= 10 && cleanText.length <= 20) {
              console.log(`📞 Valid phone found (country code): ${cleanText}`);
              return cleanText;
            }
            
            console.log(`⚠️ Skipping non-phone text: "${cleanText}"`);
            continue;
          }

          console.log(`✅ Successfully extracted: "${cleanText}" using selector: ${selector}`);
          return cleanText;
        }
      }
    } catch (error) {
      console.log(`❌ Error with selector "${selector}": ${error.message}`);
      // Continue to next selector
      continue;
    }
  }
  console.log('❌ No valid text found with any of the provided selectors');
  return '';
}

/**
 * Extracts latitude and longitude coordinates from Google Maps
 * @param {Page} page - Playwright page
 * @returns {Promise<Object>} Object with latitude and longitude
 */
async function extractCoordinates(page) {
  try {
    console.log('📍 Attempting to extract coordinates from URL...');
    
    // Wait a moment for the page to fully load (optimized)
    await page.waitForTimeout(500); // Reduced from 2s to 0.5s
    
    // Get the current URL which should contain coordinates
    const currentUrl = page.url();
    console.log(`🔍 Current URL: ${currentUrl}`);
    
    // Method 1: Extract from URL pattern @lat,lng,zoom
    let coordinatesMatch = currentUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+\.?\d*)z/);
    
    if (coordinatesMatch) {
      const latitude = parseFloat(coordinatesMatch[1]);
      const longitude = parseFloat(coordinatesMatch[2]);
      console.log(`✅ Coordinates found in URL: ${latitude}, ${longitude}`);
      return { latitude: latitude.toString(), longitude: longitude.toString() };
    }
    
    // Method 2: Extract from different URL pattern !3d and !4d
    coordinatesMatch = currentUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    
    if (coordinatesMatch) {
      const latitude = parseFloat(coordinatesMatch[1]);
      const longitude = parseFloat(coordinatesMatch[2]);
      console.log(`✅ Coordinates found in URL (alternative pattern): ${latitude}, ${longitude}`);
      return { latitude: latitude.toString(), longitude: longitude.toString() };
    }
    
    // Method 3: Try to extract from place data in the page
    try {
      console.log('🔍 Trying to extract coordinates from page data...');
      
      // Look for coordinates in page scripts or data attributes
      const coordinates = await page.evaluate(() => {
        // Try to find coordinates in window data
        if (window.APP_INITIALIZATION_STATE) {
          const initState = window.APP_INITIALIZATION_STATE;
          const initStateStr = JSON.stringify(initState);
          
          // Look for coordinate patterns in the initialization state
          const coordMatch = initStateStr.match(/(-?\d+\.\d{6,}),(-?\d+\.\d{6,})/g);
          if (coordMatch && coordMatch.length > 0) {
            const coords = coordMatch[0].split(',');
            return {
              latitude: parseFloat(coords[0]),
              longitude: parseFloat(coords[1])
            };
          }
        }
        
        // Try to extract from meta tags or other data attributes
        const metaTags = document.querySelectorAll('meta[property*="geo"], meta[name*="geo"]');
        for (const meta of metaTags) {
          const content = meta.getAttribute('content');
          if (content && content.includes(',')) {
            const coords = content.split(',');
            if (coords.length >= 2) {
              const lat = parseFloat(coords[0].trim());
              const lng = parseFloat(coords[1].trim());
              if (!isNaN(lat) && !isNaN(lng)) {
                return { latitude: lat, longitude: lng };
              }
            }
          }
        }
        
        return null;
      });
      
      if (coordinates && coordinates.latitude && coordinates.longitude) {
        console.log(`✅ Coordinates found in page data: ${coordinates.latitude}, ${coordinates.longitude}`);
        return { 
          latitude: coordinates.latitude.toString(), 
          longitude: coordinates.longitude.toString() 
        };
      }
    } catch (evalError) {
      console.log('⚠️ Could not extract coordinates from page data:', evalError.message);
    }
    
    // Method 4: Try to extract from share button or URL sharing functionality
    // OPTIMIZATION: Reduced timeouts but kept method (needed for accurate coordinates)
    try {
      console.log('🔍 Looking for share button to get coordinates...');
      
      // Look for share button
      const shareSelectors = [
        'button[data-value="Share"]',
        'button[aria-label*="Share"]',
        'button[aria-label*="Compartir"]',
        'button[aria-label*="Teilen"]',
        'button[aria-label*="Partager"]',
        '[data-item-id="share"]',
        'button[jsaction*="share"]'
      ];
      
      for (const selector of shareSelectors) {
        const shareButton = page.locator(selector).first();
        const count = await shareButton.count();
        
        if (count > 0) {
          console.log(`🔗 Found share button with selector: ${selector}`);
          
          // Click share button - AGGRESSIVE
          await shareButton.click();
          await page.waitForTimeout(300); // AGGRESSIVE: Reduced from 500ms to 300ms
          
          // Look for URL in share modal or clipboard
          const shareUrl = await page.evaluate(() => {
            // Look for input fields that might contain the share URL
            const inputs = document.querySelectorAll('input[value*="maps.google"], input[value*="goo.gl"]');
            for (const input of inputs) {
              if (input.value && input.value.includes('maps.google')) {
                return input.value;
              }
            }
            
            // Look for text content that might contain URL
            const textElements = document.querySelectorAll('div[role="dialog"] div, div[role="dialog"] span');
            for (const element of textElements) {
              const text = element.textContent || '';
              if (text.includes('maps.google.com') || text.includes('goo.gl')) {
                return text;
              }
            }
            
            return null;
          });
          
          if (shareUrl) {
            console.log(`🔍 Found share URL: ${shareUrl}`);
            
            // Extract coordinates from share URL
            const shareCoordMatch = shareUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+\.?\d*)z/);
            if (shareCoordMatch) {
              const latitude = parseFloat(shareCoordMatch[1]);
              const longitude = parseFloat(shareCoordMatch[2]);
              console.log(`✅ Coordinates found in share URL: ${latitude}, ${longitude}`);
              
              // Close share modal by pressing Escape
              await page.keyboard.press('Escape');
              
              return { latitude: latitude.toString(), longitude: longitude.toString() };
            }
          }
          
          // Close share modal by pressing Escape
          await page.keyboard.press('Escape');
          break;
        }
      }
    } catch (shareError) {
      console.log('⚠️ Could not extract coordinates from share functionality:', shareError.message);
    }
    
    console.log('❌ No coordinates found using any method');
    return { latitude: '', longitude: '' };
    
  } catch (error) {
    console.error('❌ Error extracting coordinates:', error);
    return { latitude: '', longitude: '' };
  }
}

/**
 * Normalizes day names and hours from different languages to English
 * @param {string} text - Text containing day names and hours
 * @returns {string} Text with normalized day names and format
 */
/**
 * Converts 12-hour time to 24-hour format (HH:MM)
 * @param {string} time12h - Time in 12h format (e.g., "9 am", "7:30 pm", "12 pm")
 * @returns {string} Time in 24h format (e.g., "09:00", "19:30", "12:00")
 */
/**
 * Normalizes phone numbers to international format based on country
 * @param {string} phone - Raw phone number from extraction
 * @param {string} country - Country code (CH, AT, DE, etc.)
 * @returns {string} Normalized phone number in international format
 */
function normalizePhoneNumber(phone, country = 'CH') {
  if (!phone || phone.trim() === '') return '';
  
  // Remove all spaces, dashes, parentheses, dots
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  
  // If already has international format (+), return it formatted
  if (cleaned.startsWith('+')) {
    // Format: +41 44 123 45 67 (group digits)
    const countryCode = cleaned.match(/^\+\d{1,3}/)?.[0] || '';
    const rest = cleaned.substring(countryCode.length);
    
    // Format the rest with spaces
    if (rest.length >= 9) {
      // Format: +CC AA BBB BB BB
      return `${countryCode} ${rest.substring(0, 2)} ${rest.substring(2, 5)} ${rest.substring(5, 7)} ${rest.substring(7)}`.trim();
    }
    return `${countryCode} ${rest}`.trim();
  }
  
  // Country-specific normalization
  const countryPrefixes = {
    'CH': '+41',  // Switzerland
    'AT': '+43',  // Austria
    'DE': '+49',  // Germany
    'FR': '+33',  // France
    'IT': '+39',  // Italy
    'LI': '+423', // Liechtenstein
  };
  
  const prefix = countryPrefixes[country] || '+41'; // Default to Switzerland
  
  // Handle Swiss numbers
  if (country === 'CH') {
    // Remove leading 0 from Swiss numbers (044 → 44, 0844 → 844)
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    
    // Format: +41 AA BBB BB BB
    if (cleaned.length >= 9) {
      return `${prefix} ${cleaned.substring(0, 2)} ${cleaned.substring(2, 5)} ${cleaned.substring(5, 7)} ${cleaned.substring(7)}`.trim();
    }
  }
  
  // Handle Austrian numbers
  if (country === 'AT') {
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    // Format: +43 AAAA BBBBBB
    if (cleaned.length >= 9) {
      return `${prefix} ${cleaned.substring(0, 4)} ${cleaned.substring(4)}`.trim();
    }
  }
  
  // Handle German numbers
  if (country === 'DE') {
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    // Format: +49 AAA BBBBBBB
    if (cleaned.length >= 10) {
      return `${prefix} ${cleaned.substring(0, 3)} ${cleaned.substring(3)}`.trim();
    }
  }
  
  // Fallback: just add prefix
  return `${prefix} ${cleaned}`;
}

function convertTo24Hour(time12h) {
  if (!time12h) return time12h;
  
  // Extract time components with flexible spacing
  const match = time12h.trim().match(/(\d+)(?::(\d+))?\s*(am|pm)/i);
  if (!match) {
    console.log(`      ⚠️ Cannot parse time: "${time12h}"`);
    return time12h; // Return original if can't parse
  }
  
  let hours = parseInt(match[1]);
  const minutes = match[2] ? match[2].padStart(2, '0') : '00'; // Ensure 2 digits
  const period = match[3].toLowerCase();
  
  // Validate hours (1-12 for 12h format)
  if (hours < 1 || hours > 12) {
    console.log(`      ⚠️ Invalid hours: ${hours}`);
    return time12h;
  }
  
  // Convert to 24-hour format
  if (period === 'pm' && hours !== 12) {
    hours += 12; // 1pm→13, 2pm→14, ..., 11pm→23
  } else if (period === 'am' && hours === 12) {
    hours = 0; // 12am→00
  }
  // Note: 12pm stays as 12 (noon)
  
  // Format as HH:MM
  const formatted = `${hours.toString().padStart(2, '0')}:${minutes}`;
  return formatted;
}

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
    'Cerrado': 'Closed',
    
    // English (for normalization)
    'Open 24 hours': 'Open 24 hours',
    'Closed': 'Closed'
  };
  
  let normalizedText = text;
  
  // Replace day names (case insensitive)
  for (const [foreign, english] of Object.entries(dayTranslations)) {
    const regex = new RegExp(`\\b${foreign}\\b`, 'gi');
    normalizedText = normalizedText.replace(regex, english);
  }
  
  // Check for special cases FIRST
  if (/open 24 hours?/i.test(normalizedText)) {
    return 'Open 24 hours';
  }
  if (/closed/i.test(normalizedText)) {
    return 'Closed';
  }
  
  // Step 1: Clean up formatting and add missing spaces
  normalizedText = normalizedText
    // Add spaces around am/pm if missing: "9am" → "9 am"
    .replace(/(\d+)(am|pm)/gi, '$1 $2')
    // Normalize to lowercase am/pm
    .replace(/\b(AM|PM)\b/g, (match) => match.toLowerCase())
    // Fix missing spaces after am/pm: "9 am7 pm" → "9 am 7 pm"
    .replace(/(\d+\s*(?:am|pm))(\d+)/gi, '$1 $2')
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
  
  // Step 2: Convert all 12h times to 24h format BEFORE fixing separators
  // This prevents issues like "12:0021:00" from bad replacements
  normalizedText = normalizedText.replace(/(\d+(?::\d+)?\s*(?:am|pm))/gi, (match) => {
    const converted = convertTo24Hour(match);
    console.log(`      Converting time: "${match}" → "${converted}"`);
    return converted;
  });
  
  // Step 3: Now fix separators AFTER conversion (no more am/pm in text)
  normalizedText = normalizedText
    // Normalize range separators (–, —, -, to) to " - "
    .replace(/\s*[-–—]\s*/g, ' - ')
    .replace(/\s+to\s+/gi, ' - ')
    // Normalize multiple range separators (comma, and) to " & "
    .replace(/\s*,\s*/g, ' & ')
    .replace(/\s+and\s+/gi, ' & ')
    // Clean up any double spaces
    .replace(/\s+/g, ' ')
    .trim();
  
  return normalizedText;
}

/**
 * Detects which day a text string represents (multi-language support)
 * @param {string} text - Text that might contain a day name
 * @returns {string|null} Day name in English or null if not found
 */
function detectDayName(text) {
  if (!text) return null;
  
  const textLower = text.toLowerCase();
  
  // Day patterns in multiple languages
  const dayPatterns = {
    'Monday': ['monday', 'lunes', 'lundi', 'montag', 'lunedì', 'segunda'],
    'Tuesday': ['tuesday', 'martes', 'mardi', 'dienstag', 'martedì', 'terça'],
    'Wednesday': ['wednesday', 'miércoles', 'mercredi', 'mittwoch', 'mercoledì', 'quarta'],
    'Thursday': ['thursday', 'jueves', 'jeudi', 'donnerstag', 'giovedì', 'quinta'],
    'Friday': ['friday', 'viernes', 'vendredi', 'freitag', 'venerdì', 'sexta'],
    'Saturday': ['saturday', 'sábado', 'samedi', 'samstag', 'sabato', 'sábado'],
    'Sunday': ['sunday', 'domingo', 'dimanche', 'sonntag', 'domenica', 'domingo']
  };
  
  // Check each day pattern
  for (const [englishDay, patterns] of Object.entries(dayPatterns)) {
    for (const pattern of patterns) {
      if (textLower.includes(pattern)) {
        return englishDay;
      }
    }
  }
  
  return null;
}

/**
 * Extracts opening hours from Google Maps with enhanced Swiss/European support
 * FIXED: Now correctly detects day names instead of assuming sequential order
 * @param {Page} page - Playwright page
 * @returns {Promise<Object>} Opening hours by day
 */
async function extractOpeningHours(page) {
  const hours = {};
  
  try {
    console.log('🕒 Attempting to extract opening hours...');
    
    // Try multiple strategies to find and expand hours section
    const hoursSectionSelectors = [
      '[data-item-id="oh"] button',                 // Standard hours button
      'button[aria-label*="Hours"]',                // Hours button (English)
      'button[aria-label*="Horarios"]',             // Hours button (Spanish)
      'button[aria-label*="Öffnungszeiten"]',       // Hours button (German)
      'button[aria-label*="Horaires"]',             // Hours button (French)
      'button[aria-label*="Orari"]',                // Hours button (Italian)
      '[data-item-id="oh"]',                        // Hours section without button
      '.section-open-hours-container button',       // Hours container button
      '.section-info-hours button'                  // Info hours button
    ];
    
    let hoursExpanded = false;
    for (const selector of hoursSectionSelectors) {
      try {
        const hoursButton = page.locator(selector).first();
        if (await hoursButton.count() > 0) {
          console.log(`🔍 Found hours button with selector: ${selector}`);
          await hoursButton.click();
          await page.waitForTimeout(500);
          hoursExpanded = true;
          break;
        }
      } catch (error) {
        console.log(`⚠️ Hours button click failed for ${selector}: ${error.message}`);
        continue;
      }
    }
    
    // Try multiple selectors for hours rows
    const hourRowSelectors = [
      '.t39EBf .y0skZc',                           // Standard hours rows
      '[data-item-id="oh"] .y0skZc',               // Hours in oh section
      '.section-open-hours-container .y0skZc',     // Hours container rows
      '.section-info-hours .y0skZc',               // Info hours rows
      '[aria-label*="hours"] .y0skZc',             // Hours with aria label
      '.opening-hours .y0skZc',                    // Opening hours rows
      '.t39EBf div[class*="fontBody"]',            // Hours with font body class
      '[data-item-id="oh"] div[role="row"]',       // Hours as table rows
      '.section-open-hours div[class*="fontBody"]' // Hours section with font body
    ];
    
    let hoursFound = false;
    for (const selector of hourRowSelectors) {
      try {
        const hoursRows = await page.locator(selector).all();
        console.log(`📊 Found ${hoursRows.length} hour rows with selector: ${selector}`);
        
        if (hoursRows.length > 0) {
          // Extract each row and detect the actual day name
          for (const dayElement of hoursRows) {
            const dayText = await dayElement.textContent();
            
            if (dayText && dayText.trim()) {
              const rawText = dayText.trim();
              console.log(`🔍 Processing hour row: "${rawText}"`);
              
              // Detect which day this row represents
              const detectedDay = detectDayName(rawText);
              
              if (detectedDay) {
                // Remove the day name from the beginning to isolate hours
                let hoursOnly = rawText;
                
                // Remove day names in multiple languages
                const dayPatternsToRemove = [
                  // English
                  detectedDay,
                  // German
                  'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag',
                  // French  
                  'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche',
                  // Italian
                  'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica',
                  // Spanish
                  'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'
                ];
                
                for (const dayPattern of dayPatternsToRemove) {
                  hoursOnly = hoursOnly.replace(new RegExp(`^${dayPattern}\\s*:?\\s*`, 'i'), '');
                }
                
                hoursOnly = hoursOnly.trim();
                console.log(`🕒 Hours before normalization: "${hoursOnly}"`);
                
                // Now normalize the hours (convert to 24h format)
                const normalizedHours = normalizeDayNames(hoursOnly);
                console.log(`✅ Hours after normalization: "${normalizedHours}"`);
                
                hours[detectedDay] = normalizedHours;
                console.log(`📅 ${detectedDay}: ${normalizedHours}`);
              } else {
                console.log(`⚠️ Could not detect day name in: ${rawText}`);
              }
            }
          }
          
          if (Object.keys(hours).length > 0) {
            hoursFound = true;
            break;
          }
        }
      } catch (error) {
        console.log(`⚠️ Hours extraction failed for ${selector}: ${error.message}`);
        continue;
      }
    }
    
    if (!hoursFound) {
      console.log('⚠️ No opening hours found with standard selectors');
    }
    
    console.log(`✅ Extracted opening hours for ${Object.keys(hours).length} days`);
    
  } catch (error) {
    console.error('❌ Error extracting opening hours:', error);
  }
  
  return hours;
}

/**
 * Extracts social media links
 * @param {Page} page - Playwright page
 * @returns {Promise<Object>} Social media links
 */
async function extractSocialMedia(page) {
  const socialMedia = {};
  
  try {
    // Look for social media links
    const socialLinks = await page.locator('a[href*="facebook"], a[href*="instagram"], a[href*="twitter"], a[href*="linkedin"], a[href*="youtube"]').all();
    
    for (const link of socialLinks) {
      const href = await link.getAttribute('href');
      if (href) {
        if (href.includes('facebook')) socialMedia.facebook = href;
        else if (href.includes('instagram')) socialMedia.instagram = href;
        else if (href.includes('twitter')) socialMedia.twitter = href;
        else if (href.includes('linkedin')) socialMedia.linkedin = href;
        else if (href.includes('youtube')) socialMedia.youtube = href;
      }
    }
  } catch (error) {
    console.error('❌ Error extracting social media:', error);
  }
  
  return socialMedia;
}

/**
 * Extracts website URL from selectors, prioritizing href attributes over text
 * @param {Page} page - Playwright page
 * @param {string[]} selectors - Array of CSS selectors
 * @returns {Promise<string>} Website URL or empty string
 */
async function extractWebsiteFromSelectors(page, selectors) {
  for (const selector of selectors) {
    try {
      const element = await page.locator(selector).first();
      const count = await element.count();
      
      if (count > 0) {
        // Prioritize href attribute for actual URLs
        const href = await element.getAttribute('href');
        if (href && href.startsWith('http') && !href.includes('google.com')) {
          console.log(`✅ Found website URL: ${href}`);
          return href;
        }
        
        // Try data-href attribute
        const dataHref = await element.getAttribute('data-href');
        if (dataHref && dataHref.startsWith('http')) {
          console.log(`✅ Found website URL from data-href: ${dataHref}`);
          return dataHref;
        }
        
        // Skip generic "Website" text
        const text = await element.textContent();
        if (text && text.trim().toLowerCase() !== 'website' && text.startsWith('http')) {
          return text.trim();
        }
      }
    } catch (error) {
      continue;
    }
  }
  return '';
}

/**
 * Creates an empty result object for failed scrapes
 * @param {Object} originalData - Original CSV data
 * @param {string} error - Error message
 * @returns {Object} Empty result object
 */
function createEmptyResult(originalData, error) {
  return {
    originalName: originalData.name || '',
    originalAddress: originalData.address || '',
    originalCity: originalData.city || '',
    originalPostalCode: originalData.postal_code || '',
    fullName: '',
    fullAddress: '',
    phone: '',
    rating: '',
    reviewsCount: '',
    website: '',
    category: '',
    latitude: '',
    longitude: '',
    socialMedia: {},
    openingHours: {},
    scrapedAt: new Date().toISOString(),
    status: 'failed',
    error: error
  };
}

console.log('✅ Web scraper module loaded');