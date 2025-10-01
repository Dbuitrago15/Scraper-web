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
    
    // Create new browser context for isolation with localization
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: localizationConfig.userAgent,
      locale: localizationConfig.language,
      timezoneId: localizationConfig.timezone,
      extraHTTPHeaders: {
        'Accept-Language': `${localizationConfig.language}-${localizationConfig.region},${localizationConfig.language};q=0.9,en;q=0.8`
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
      
      // Use localized Google Maps URL
      const googleMapsUrl = buildLocalizedMapsUrl(searchQuery, localizationConfig);
      
      console.log(`🗺️ Strategy ${i + 1}/${searchStrategies.length} (${currentStrategy}): ${searchQuery}`);
      console.log(`🌍 Localized URL: ${googleMapsUrl}`);
      
      try {
        // Navigate to Google Maps with localization
        await page.goto(googleMapsUrl, { 
          waitUntil: 'networkidle',
          timeout: 30000 
        });
        
        // Wait for search results to load
        await page.waitForTimeout(5000);
        
        // Check if we found something
        searchSuccess = await checkIfBusinessFound(page);
        
        if (searchSuccess) {
          console.log(`✅ Search successful with strategy: ${currentStrategy}`);
          break;
        } else {
          console.log(`❌ Strategy ${currentStrategy} failed, trying next...`);
        }
      } catch (error) {
        console.log(`❌ Strategy ${currentStrategy} error: ${error.message}`);
        continue;
      }
    }
    
    if (!searchSuccess) {
      console.log('❌ All search strategies failed');
      return createEmptyResult(data, 'Business not found with any search strategy');
    }
    
    // Enhanced detection for business detail view (Spanish/International support)
    const detailViewSelectors = [
      'h1[data-attrid="title"]',                   // Main title
      '.x3AX1-LfntMc-header-title-title',         // Header title
      '[data-item-id="address"]',                 // Address element
      'h1.DUwDvf',                               // Business name header
      '.qrShPb .fontHeadlineLarge',              // Large headline
      '[data-item-id="phone"]',                  // Phone element
      '.MW4etd',                                 // Rating element
      '.F7nice',                                 // Rating container
      'button[data-item-id="authority"]',        // Website button
      '[aria-label*="estrella"]',                // Spanish: stars
      '[aria-label*="star"]',                    // English: stars
      '.section-star-display',                   // Star display
      '[data-attrid*="rating"]'                  // Rating attribute
    ];
    
    let isDetailView = false;
    let detailSelector = '';
    
    // Check if we're already in a business detail view
    for (const selector of detailViewSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        isDetailView = true;
        detailSelector = selector;
        console.log(`✅ Detected business detail view using selector: ${selector}`);
        break;
      }
    }
    
    if (!isDetailView) {
      console.log('🔍 Not in detail view, trying to find business results...');
      
      // Multiple selectors to find business results in different Google Maps layouts
      const businessSelectors = [
        '[data-result-index="0"]',                    // Original selector
        'div[role="main"] .Nv2PK',                   // Search results container
        '.bJzME.Hu9e2e.tTVLSc',                      // Business card
        'a[data-result-index="0"]',                  // Link with result index
        '.hfpxzc[role="button"]',                    // Business listing button
        '.section-result .section-result-content',   // Search result content
        'div[jsaction*="click"]:has(.fontHeadlineSmall)', // Any clickable div with business name
        '.section-result-title',                     // Result title
        '.section-result .section-result-title',     // Result title in section
        'a[href*="/place/"]',                       // Direct place links
        '[data-result-index]:first-child',          // First result item
        '.section-listbox .section-result'          // Results in listbox
      ];
      
      let businessResult = null;
      let selectorUsed = '';
      
      // Try each selector until we find results
      for (const selector of businessSelectors) {
        console.log(`🔍 Trying business selector: ${selector}`);
        businessResult = await page.locator(selector).first();
        const count = await businessResult.count();
        console.log(`📊 Found ${count} elements with selector: ${selector}`);
        
        if (count > 0) {
          selectorUsed = selector;
          break;
        }
      }
      
      if (!businessResult || await businessResult.count() === 0) {
        console.log('❌ No business results found with any selector');
        
        // Debug: Take a screenshot and log page content
        console.log('🔍 Page URL:', page.url());
        await page.screenshot({ path: '/tmp/debug-no-results.png', fullPage: true }).catch(() => {});
        
        return createEmptyResult(data, 'No results found on Google Maps');
      }
      
      console.log(`✅ Found business result using selector: ${selectorUsed}`);
      console.log('🔄 Clicking on business result to open details');
      
      // Click on the first result
      await businessResult.click();
      // Wait for business details to load
      await page.waitForTimeout(5000);
      
      // Re-check if we're now in detail view
      for (const selector of detailViewSelectors) {
        const count = await page.locator(selector).count();
        if (count > 0) {
          isDetailView = true;
          detailSelector = selector;
          console.log(`✅ Now in business detail view using selector: ${selector}`);
          break;
        }
      }
      
      if (!isDetailView) {
        console.log('❌ Still not in detail view after clicking');
        return createEmptyResult(data, 'Could not access business details');
      }
    } else {
      console.log('✅ Already in business detail view');
    }
    
    // Extract business information
    const scrapedData = await extractBusinessDetails(page, data);
    
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
  const hasEuropeanCharacters = hasEuropeanChars(data.name || '');
  
  console.log(`🔤 Building optimized search strategies for: ${data.name}`);
  if (hasEuropeanCharacters) {
    console.log('🇪🇺 Detected European characters, adding normalized variations');
  }
  if (localizationConfig) {
    console.log(`🌍 Using localization: ${localizationConfig.language}/${localizationConfig.region}`);
  }
  
  // Generate business name variations for European characters
  const businessNameVariations = data.name ? generateSearchVariations(data.name) : [data.name];
  console.log(`📝 Generated ${businessNameVariations.length} name variations:`, businessNameVariations);
  
  // PRIORITY 1: Most specific - Name + Address + City + Postal Code
  if (data.name && data.address && data.city && data.postal_code) {
    for (const nameVariation of businessNameVariations) {
      strategies.push({
        name: `Priority 1: Full Search${nameVariation !== data.name ? ' (Normalized)' : ''}`,
        query: `${nameVariation} ${data.address} ${data.city} ${data.postal_code}`.trim()
      });
    }
    console.log('✅ Added Priority 1: Name + Address + City + Postal Code');
  }
  
  // PRIORITY 2: Name + Address + Postal Code (without city)
  if (data.name && data.address && data.postal_code) {
    for (const nameVariation of businessNameVariations) {
      strategies.push({
        name: `Priority 2: Name + Address + Postal${nameVariation !== data.name ? ' (Normalized)' : ''}`,
        query: `${nameVariation} ${data.address} ${data.postal_code}`.trim()
      });
    }
    console.log('✅ Added Priority 2: Name + Address + Postal Code');
  }
  
// PRIORITY 3: Name + Address + City (without postal - different combination)
  if (data.name && data.address && data.city) {
    for (const nameVariation of businessNameVariations) {
      strategies.push({
        name: `Priority 3: Name + Address + City${nameVariation !== data.name ? ' (Normalized)' : ''}`,
        query: `${nameVariation} ${data.address} ${data.city}`.trim()
      });
    }
    console.log('✅ Added Priority 3: Name + Address + City');
  }

  // PRIORITY 4: Name + Address (without city or postal)
  if (data.name && data.address) {
    for (const nameVariation of businessNameVariations) {
      strategies.push({
        name: `Priority 4: Name + Address${nameVariation !== data.name ? ' (Normalized)' : ''}`,
        query: `${nameVariation} ${data.address}`.trim()
      });
    }
    console.log('✅ Added Priority 4: Name + Address');
  }
  
  
  
  // PRIORITY 5: FINAL FALLBACK - Name + City (least specific but still targeted)
  if (data.name && data.city) {
    for (const nameVariation of businessNameVariations) {
      strategies.push({
        name: `Priority 5: Final Fallback - Name + City${nameVariation !== data.name ? ' (Normalized)' : ''}`,
        query: `${nameVariation} ${data.city}`.trim()
      });
    }
    console.log('✅ Added Priority 5: Name + City (Final Fallback)');
  }
  
  // Swiss brand-specific searches (keep existing for Swiss brands)
  if (data.name && localizationConfig?.region === 'CH') {
    const swissBrands = ['migros', 'coop', 'manor', 'globus', 'denner', 'aldi', 'lidl'];
    const nameLower = data.name.toLowerCase();
    
    if (swissBrands.some(brand => nameLower.includes(brand))) {
      console.log('🇨🇭 Adding Swiss brand-specific strategies');
      
      // Add specific Swiss retail searches
      for (const nameVariation of businessNameVariations) {
        if (nameLower.includes('migros')) {
          if (nameLower.includes('city')) {
            strategies.push({
              name: `Swiss Brand City Format (Migros)`,
              query: `Migros City ${data.address} ${data.city}`.trim()
            });
            strategies.push({
              name: `Swiss Brand City Alternative (Migros)`,
              query: `"Migros City" ${data.city}`.trim()
            });
          }
          strategies.push({
            name: `Swiss Brand + Exact Name (Migros)`,
            query: `"${data.name}" ${data.city}`.trim()
          });
        }
        if (nameLower.includes('coop')) {
          if (nameLower.includes('city')) {
            strategies.push({
              name: `Swiss Brand City Format (Coop)`,
              query: `"Coop City" ${data.address} ${data.city}`.trim()
            });
          }
          if (nameLower.includes('bahnhof')) {
            strategies.push({
              name: `Swiss Brand Bahnhof (Coop)`,
              query: `Coop Bahnhof ${data.city}`.trim()
            });
          }
          strategies.push({
            name: `Swiss Brand + Exact Name (Coop)`,
            query: `"${data.name}" ${data.city}`.trim()
          });
        }
        if (nameLower.includes('manor')) {
          strategies.push({
            name: `Swiss Brand + Exact Name (Manor)`,
            query: `"${data.name}" ${data.city}`.trim()
          });
        }
        if (nameLower.includes('globus')) {
          strategies.push({
            name: `Swiss Brand + Exact Name (Globus)`,
            query: `"${data.name}" ${data.city}`.trim()
          });
        }
      }
    }
  }
  
  // Remove duplicates and empty queries
  const uniqueStrategies = [];
  const seenQueries = new Set();
  
  for (const strategy of strategies) {
    if (strategy.query.length > 0 && !seenQueries.has(strategy.query.toLowerCase())) {
      seenQueries.add(strategy.query.toLowerCase());
      uniqueStrategies.push(strategy);
    }
  }
  
  console.log(`🎯 Generated ${uniqueStrategies.length} unique search strategies in optimized priority order`);
  console.log('📋 Strategy Order: 1) Name+Address+City+Postal → 2) Name+Address+Postal → 3) Name+Address → 4) Name+Address+City → 5) Name+City');
  return uniqueStrategies;
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
function buildLocalizedMapsUrl(query, localizationConfig) {
  const encodedQuery = encodeURIComponent(query);
  const baseUrl = 'https://www.google.com/maps/search/';
  const params = new URLSearchParams({
    api: '1',
    query: encodedQuery,
    hl: localizationConfig.language,
    gl: localizationConfig.region
  });
  
  return `${baseUrl}?${params.toString()}`;
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
async function extractBusinessDetails(page, originalData) {
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
    // Extract business name with enhanced selectors for Swiss/European businesses
    const nameSelectors = [
      'h1[data-attrid="title"]',                     // Main title attribute (highest priority)
      'h1.DUwDvf',                                   // Header class (most common)
      '[data-attrid="title"]',                       // Any element with title attribute
      '.qrShPb .fontHeadlineLarge',                  // Large headline in info panel
      '.x3AX1-LfntMc-header-title-title',           // Header title
      '.section-hero-header-title-title',            // Hero section title
      'h1.fontHeadlineLarge',                        // Direct headline class
      '.tAiQdd .fontHeadlineLarge',                  // Info section headline
      '.x3AX1-LfntMc-header-title .fontHeadlineLarge', // Header with large font
      // Enhanced selectors for business detail pages
      '.place-name',                                 // Place name class
      '[jsaction*="pane.placeDetails.placeInfo"] h1', // Place details info
      'h1[data-attrid="kc:/collection/knowledge_panels/local_entity:title"]', // Knowledge panel title
      '.fontHeadlineLarge[data-attrid]',            // Large font with data attribute
      '.section-hero-header-title-title .fontHeadlineLarge', // Nested headline
      '.x3AX1-LfntMc-header-title',                 // Header title container
      'h1[class*="fontHeadline"]',                  // Any h1 with headline class
      '[role="main"] h1',                           // Main section h1
      '.section-hero-header-title',                  // Hero header title
      'h1',                                          // Any h1 tag (fallback)
      '[data-attrid*="title"]'                      // Any element with title in attribute (fallback)
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
    
    // Extract address with enhanced selectors (Swiss/European support)
    const addressSelectors = [
      // Primary address selectors
      '[data-item-id="address"] .Io6YTe',           // Primary address text
      '[data-item-id="address"] .fontBodyMedium',   // Address with medium font
      'button[data-item-id="address"] span.Io6YTe', // Address button text
      // Knowledge panel and structured data
      '[data-attrid="kc:/location/location:address"]', // Knowledge panel address
      '[data-attrid="kc:/location/location:street_address"]', // Street address
      // Address container selectors
      '.rogA2c .Io6YTe:not(:empty)',               // Non-empty address text
      '.tAiQdd [data-item-id="address"] span',     // Address in info section
      // Multi-language address button selectors
      'button[aria-label*="Address"] .Io6YTe',     // English
      'button[aria-label*="Adresse"] .Io6YTe',     // German/Swiss German/French
      'button[aria-label*="Indirizzo"] .Io6YTe',   // Italian (Swiss)
      'button[aria-label*="Dirección"] .Io6YTe',   // Spanish
      // Fallback address selectors
      '.section-info-text:contains(",")',          // Text with comma (likely address)
      '.fontBodyMedium:contains(","):not(.MW4etd):not(.ceNzKf)', // Address with comma (not rating/review)
      // Swiss postal code pattern matching
      '.fontBodyMedium:contains("CH-")',           // Swiss address with CH prefix
      'span:contains("Schweiz")',                  // Contains Switzerland
      'span:contains("Suiza")',                    // Contains Switzerland (Spanish)
      'span:contains("Svizzera")',                 // Contains Switzerland (Italian)
      'span:contains("Suisse")',                   // Contains Switzerland (French)
      // European postal code patterns
      '.fontBodyMedium:regex("\\d{4}\\s+[A-Z][a-z]+")', // 4-digit postal codes (Swiss/Austrian)
      '.fontBodyMedium:regex("\\d{5}\\s+[A-Z][a-z]+")', // 5-digit postal codes (German)
      // Street pattern matching
      '.fontBodyMedium:contains("strasse")',       // German street names
      '.fontBodyMedium:contains("gasse")',         // German lane names
      '.fontBodyMedium:contains("platz")',         // German square names
      '.fontBodyMedium:contains("rue")',           // French street names
      '.fontBodyMedium:contains("via")',           // Italian street names
      '.fontBodyMedium:contains("avenue")',        // Avenue names
      // Generic address patterns
      '.section-info-line:contains(",")',          // Info lines with commas
      '[data-item-id="address"] span:not(:empty)'  // Non-empty address spans
    ];
    
    result.fullAddress = await extractTextFromSelectors(page, addressSelectors, 'address') || '';
    console.log(`📍 Extracted address: ${result.fullAddress}`);
    
    // Extract phone number with enhanced selectors (Swiss/European support)
    const phoneSelectors = [
      // Primary phone selectors
      'button[data-item-id="phone:tel"] .Io6YTe', // Phone button text
      '[data-item-id="phone"] .Io6YTe',           // Phone item text
      'button[aria-label*="Call"] .Io6YTe',       // Call button text
      // Button-based phone selectors with language support
      'button[aria-label*="phone"] span:not(.visually-hidden)', // English
      'button[aria-label*="telefon"] span:not(.visually-hidden)', // German/Swedish
      'button[aria-label*="téléphone"] span:not(.visually-hidden)', // French
      'button[aria-label*="teléfono"] span:not(.visually-hidden)', // Spanish
      'button[aria-label*="chiamare"] span:not(.visually-hidden)', // Italian
      // Direct phone link and text selectors
      'a[href^="tel:"]',                          // Direct phone links
      'span[data-phone]',                         // Phone data attributes
      // Swiss and European phone pattern selectors
      'button:contains("+41")',                   // Swiss phone in buttons
      'span:contains("+41")',                     // Swiss phone spans
      'div.fontBodyMedium:contains("+41")',      // Swiss phone in medium font
      'button:contains("+49")',                   // German phone
      'button:contains("+33")',                   // French phone
      'button:contains("+39")',                   // Italian phone
      'button:contains("+34")',                   // Spanish phone
      'button:contains("+46")',                   // Swedish phone
      'button:contains("+47")',                   // Norwegian phone
      'button:contains("+45")',                   // Danish phone
      // Generic phone pattern selectors
      '.fontBodyMedium[href^="tel:"]',            // Phone links with medium font
      'button[data-value*="phone"]',              // Phone data value buttons
      '[data-attrid*="phone"] .fontBodyMedium',   // Phone attribute with medium font
      // Phone links and fallback selectors
      'a[href^="tel:"]',                          // Direct tel links
      '.section-info-line [href^="tel:"]',        // Phone links in info section
      // Swiss-specific selectors
      'span[aria-label*="+41"]',                   // Swiss country code in aria-label
      '.fontBodyMedium[aria-label*="+41"]',        // Swiss numbers in medium font
      'span:contains("+41")',                      // Elements containing Swiss country code
      '.Io6YTe[aria-label*="0"]',                 // Phone elements with Swiss format
      '[data-item-id="phone"] .fontBodySmall'     // Phone in small font
    ];
    
    result.phone = await extractTextFromSelectors(page, phoneSelectors, 'phone') || '';
    console.log(`📞 Extracted phone: ${result.phone}`);
    
    // Extract rating with comprehensive selectors (Multi-language European support)
    const europeanSelectors = getAllEuropeanSelectors();
    const ratingSelectors = [
      // Primary rating selectors - most specific first
      '.F7nice .ceNzKf:first-child',               // First rating element in F7nice container
      'span.ceNzKf:not(:empty)',                   // Non-empty rating spans
      '.MW4etd.ceNzKf',                           // Rating with both classes
      '[data-attrid="kc:/collection/knowledge_panels/has_rating:rating"]', // Knowledge panel rating
      // Star rating images with adjacent text
      'div[role="img"][aria-label*="star"] + span', // Span next to star image (English)
      'div[role="img"][aria-label*="estrella"] + span', // Span next to star image (Spanish)
      'div[role="img"][aria-label*="stern"] + span',    // Span next to star image (German)
      'div[role="img"][aria-label*="stjärn"] + span',    // Span next to star image (Swedish)
      'div[role="img"][aria-label*="stjerne"] + span',   // Span next to star image (Norwegian/Danish)
      // Rating in star display containers
      '.section-star-display .section-star-display-text:first-child',
      '.section-reviewchart-stars-text',
      // Button-based rating selectors (more specific)
      'button[jsaction*="pane.rating"] .ceNzKf:first-child',
      // Aria-label based selectors (extract number from label)
      '[aria-label*="stars"][aria-label*="out of"]',
      '[aria-label*="estrellas"][aria-label*="de"]',
      '[aria-label*="Sterne"][aria-label*="von"]',
      '[aria-label*="stjärnor"][aria-label*="av"]',
      // Fallback: First span in rating container (but not review count)
      '.F7nice > span:first-child:not(.MW4etd)',
      // Swedish selectors
      'span.ceNzKf[aria-label*="stjärn"]',        // Star rating with aria label (Swedish)  
      '[role="img"][aria-label*="stjärn"]',       // Star image elements (Swedish)
      '.fontBodyMedium[aria-label*="betyg"]',     // Rating labels (Swedish)
      'span.ceNzKf[aria-label*="betyg"]',         // Rating with aria label (Swedish)
      // Norwegian selectors
      'span.ceNzKf[aria-label*="stjerne"]',       // Star rating with aria label (Norwegian)
      '[role="img"][aria-label*="stjerne"]',      // Star image elements (Norwegian) 
      '.fontBodyMedium[aria-label*="vurdering"]', // Rating labels (Norwegian)
      'span.ceNzKf[aria-label*="vurdering"]',     // Rating with aria label (Norwegian)
      // Danish selectors
      'span.ceNzKf[aria-label*="stjerne"]',       // Star rating with aria label (Danish)
      '[role="img"][aria-label*="stjerne"]',      // Star image elements (Danish)
      '.fontBodyMedium[aria-label*="bedømmelse"]',// Rating labels (Danish)
      'span.ceNzKf[aria-label*="bedømmelse"]',    // Rating with aria label (Danish)
      // Generic selectors
      '.section-star-display .section-star-display-text', // Alternative rating display
      '[jsaction*="pane.rating"]',                 // Rating with jsaction
      '.F7nice span:first-child',                  // First span in rating container
      'span[data-value]',                         // Spans with data-value (ratings)
      '.section-star-display'                     // Star display section
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
    
    // Extract reviews count with comprehensive selectors (Multi-language European support)
    const reviewsSelectors = [
      // Primary review count selectors
      '.F7nice .MW4etd:nth-child(2)',              // Second element in F7nice container
      '[data-attrid="kc:/collection/knowledge_panels/has_rating:review_count"]', // Knowledge panel reviews
      '.section-reviewchart-numreviews',           // Review chart number
      'button[jsaction*="pane.reviewChart"] .MW4etd:not(.ceNzKf)', // Reviews button (not rating)
      // Button-based review selectors with text patterns
      'button[aria-label*="reviews"] .MW4etd',     // Review button with count (English)
      'button[aria-label*="reseñas"] .MW4etd',     // Review button with count (Spanish)
      'button[aria-label*="bewertungen"] .MW4etd', // Review button with count (German)
      'button[aria-label*="recensioner"] .MW4etd', // Review button with count (Swedish)
      'button[aria-label*="anmeldelser"] .MW4etd', // Review button with count (Norwegian/Danish)
      // Span elements with review text patterns (extract numbers)
      'span[aria-label*="reviews"]:contains("(")', // English review count with parentheses
      'span[aria-label*="reseñas"]:contains("(")', // Spanish review count
      'span[aria-label*="bewertungen"]:contains("(")', // German review count
      'span[aria-label*="recensioner"]:contains("(")', // Swedish review count
      'span[aria-label*="anmeldelser"]:contains("(")', // Norwegian/Danish review count
      // Text-based review selectors
      '.MW4etd:contains("review")',                // Contains "review" text
      '.MW4etd:contains("reseña")',                // Contains "reseña" text
      '.MW4etd:contains("bewertung")',             // Contains "bewertung" text
      '.MW4etd:contains("recensioner")',           // Contains "recensioner" text
      // Fallback selectors (second element in rating containers)
      '.F7nice .MW4etd:last-child:not(.ceNzKf)',   // Last element (not rating)
      '.F7nice [aria-label*="rezensionen"]',       // Reviews count in aria label (German alt)
      'span[aria-label*="bewertungen"]',           // Any span with review in aria label (German)
      'span[aria-label*="rezensionen"]',           // Any span with review in aria label (German alt)
      'button[aria-label*="bewertungen"] .MW4etd', // Review button text (German)
      '.fontBodyMedium[aria-label*="bewertungen"]', // Medium font review labels (German)
      // Swedish selectors
      '.F7nice [aria-label*="recensioner"]',       // Reviews count in aria label (Swedish)
      '.F7nice [aria-label*="omdömen"]',           // Reviews count in aria label (Swedish alt)
      'span[aria-label*="recensioner"]',           // Any span with review in aria label (Swedish)
      'span[aria-label*="omdömen"]',               // Any span with review in aria label (Swedish alt)
      'button[aria-label*="recensioner"] .MW4etd', // Review button text (Swedish)
      '.fontBodyMedium[aria-label*="recensioner"]', // Medium font review labels (Swedish)
      // Norwegian selectors
      '.F7nice [aria-label*="anmeldelser"]',       // Reviews count in aria label (Norwegian)
      'span[aria-label*="anmeldelser"]',           // Any span with review in aria label (Norwegian)
      'button[aria-label*="anmeldelser"] .MW4etd', // Review button text (Norwegian)
      '.fontBodyMedium[aria-label*="anmeldelser"]', // Medium font review labels (Norwegian)
      // Danish selectors
      '.F7nice [aria-label*="anmeldelser"]',       // Reviews count in aria label (Danish)
      'span[aria-label*="anmeldelser"]',           // Any span with review in aria label (Danish)
      'button[aria-label*="anmeldelser"] .MW4etd', // Review button text (Danish)
      '.fontBodyMedium[aria-label*="anmeldelser"]' // Medium font review labels (Danish)
    ];
    
    result.reviewsCount = await extractTextFromSelectors(page, reviewsSelectors, 'reviews') || '';
    console.log(`📊 Extracted reviews count: ${result.reviewsCount}`);
    
    // Extract website with enhanced URL extraction
    const websiteSelectors = [
      'a[href^="http"][data-item-id="authority"]', // Direct website link (highest priority)
      'button[data-item-id="authority"][data-href]', // Button with data-href
      '[data-item-id="authority"] a[href^="http"]', // Link inside authority item
      '.section-info-line a[href^="http"]:not([href*="google"]):not([href*="maps"])', // External links
      '[data-attrid="kc:/collection/knowledge_panels/has_url:url"] a[href]', // Knowledge panel URL
      'button[aria-label*="Website"][data-href]',   // Website button with data-href
      'a[target="_blank"][href^="http"]:not([href*="google"]):not([href*="maps"])', // External links
      '[data-item-id="authority"] .Io6YTe',       // Fallback: website text
      'button[data-item-id="authority"]'          // Website button (last resort)
    ];
    
    result.website = await extractWebsiteFromSelectors(page, websiteSelectors) || '';
    console.log(`🌐 Extracted website: ${result.website}`);
    
    // Extract category/business type with comprehensive selectors (Spanish/International support)
    const categorySelectors = [
      // Primary category selectors
      '.DkEaL',                                    // Main category display
      '[data-attrid="kc:/collection/knowledge_panels/has_type:type"]', // Knowledge panel type
      '.section-hero-header-description',          // Hero section description
      '.tAiQdd .fontBodyMedium:not(.MW4etd):not(.ceNzKf)', // Category in info section (not rating/reviews)
      // Secondary category selectors
      'button[jsaction*="pane.category"]',        // Category button (not rating)
      '[data-item-id="type"] .fontBodyMedium',    // Type/category item
      // Aria-label based category detection (avoiding rating/review terms)
      '[aria-label*="category"]:not([aria-label*="star"]):not([aria-label*="review"])', // English
      '[aria-label*="categoría"]:not([aria-label*="estrella"]):not([aria-label*="reseña"])', // Spanish
      '[aria-label*="kategorie"]:not([aria-label*="stern"]):not([aria-label*="bewertung"])', // German
      // Fallback selectors (avoiding rating indicators)
      '.section-editorial-quote',                  // Editorial quote
      '.place-desc-large:not(:contains("★")):not(:contains("star"))', // Description without stars
      '.section-info-definition',                  // Info definition
      '.section-result-details:not(:contains("★"))', // Details without ratings
      '.fontBodyMedium:first-of-type:not(.MW4etd):not(.ceNzKf):not([aria-label*="star"]):not([aria-label*="review"])' // First medium font (not rating/review)
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
          
          // Phone number validation
          if (fieldType === 'phone') {
            // Only accept text that looks like a phone number
            const phonePattern = /[\d\s\-\+\(\)\.]{7,}/;
            if (!phonePattern.test(cleanText)) {
              console.log(`⚠️ Skipping non-phone text: "${cleanText}"`);
              continue;
            }
          }
          
          // Reviews validation - should contain numbers
          if (fieldType === 'reviews') {
            // Extract number from reviews text
            const reviewMatch = cleanText.match(/(\d+[\d\s,\.]*)/);
            if (reviewMatch) {
              const reviewCount = reviewMatch[1].replace(/[\s,\.]/g, '');
              console.log(`📊 Valid review count found: ${reviewCount}`);
              return reviewCount;
            }
            console.log(`⚠️ No valid review count in: "${cleanText}"`);
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
    
    // Wait a moment for the page to fully load
    await page.waitForTimeout(2000);
    
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
          
          // Click share button
          await shareButton.click();
          await page.waitForTimeout(2000);
          
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
  
  // Clean up common patterns
  normalizedText = normalizedText
    // Add spaces before time separators for readability
    .replace(/(\d+):(\d+)/g, '$1:$2')
    // Normalize time range separators
    .replace(/(\d+:\d+)\s*[-–—]\s*(\d+:\d+)/g, '$1 - $2')
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
  
  return normalizedText;
}

/**
 * Extracts opening hours from Google Maps with enhanced Swiss/European support
 * @param {Page} page - Playwright page
 * @returns {Promise<Object>} Opening hours by day
 */
async function extractOpeningHours(page) {
  const hours = {};
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
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
          await page.waitForTimeout(1500);
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
          for (let i = 0; i < Math.min(hoursRows.length, days.length); i++) {
            const dayElement = hoursRows[i];
            const dayText = await dayElement.textContent();
            
            if (dayText && dayText.trim()) {
              const day = days[i];
              const normalizedHours = normalizeDayNames(dayText.trim());
              hours[day] = normalizedHours;
              console.log(`📅 ${day}: ${dayText.trim()} → ${normalizedHours}`);
            }
          }
          hoursFound = true;
          break;
        }
      } catch (error) {
        console.log(`⚠️ Hours extraction failed for ${selector}: ${error.message}`);
        continue;
      }
    }
    
    if (!hoursFound) {
      console.log('⚠️ No opening hours found with standard selectors, trying alternative approach...');
      
      // Alternative approach: look for any text containing time patterns
      const timePatternSelectors = [
        'span:contains(":")',                       // Any span with colon (time)
        'div:contains("–")',                       // Any div with time range dash
        'span:contains("a.m.")',                   // AM/PM times
        'span:contains("p.m.")',                   // AM/PM times
        '[aria-label*="open"]',                    // Open status
        '[aria-label*="closed"]',                  // Closed status
        '.fontBodyMedium:contains(":")'            // Medium font with time
      ];
      
      for (const selector of timePatternSelectors) {
        try {
          const elements = await page.locator(selector).all();
          if (elements.length > 0) {
            console.log(`🕐 Found ${elements.length} potential time elements`);
            // This is a fallback - would need more complex parsing
            break;
          }
        } catch (error) {
          continue;
        }
      }
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