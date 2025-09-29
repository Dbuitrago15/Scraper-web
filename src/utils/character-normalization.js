// Character normalization utilities for European languages
// Handles German, Swedish, Norwegian, Danish, and other European special characters

/**
 * Mapping of European special characters to their normalized equivalents
 * Used for search queries to improve matching success
 */
const EUROPEAN_CHAR_MAP = {
  // German umlauts and ß
  'ä': 'ae', 'Ä': 'Ae',
  'ö': 'oe', 'Ö': 'Oe', 
  'ü': 'ue', 'Ü': 'Ue',
  'ß': 'ss',
  
  // Swedish/Norwegian/Danish characters
  'å': 'aa', 'Å': 'Aa',
  'æ': 'ae', 'Æ': 'Ae',
  'ø': 'oe', 'Ø': 'Oe',
  
  // French accents (for Switzerland)
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
  'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'Ä': 'A',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
  'È': 'E', 'É': 'E', 'Ê': 'E', 'Ë': 'E',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
  'Ì': 'I', 'Í': 'I', 'Î': 'I', 'Ï': 'I',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
  'Ò': 'O', 'Ó': 'O', 'Ô': 'O', 'Õ': 'O', 'Ö': 'O',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
  'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'Ü': 'U',
  'ç': 'c', 'Ç': 'C',
  'ñ': 'n', 'Ñ': 'N',
  
  // Italian accents (for Switzerland)
  'à': 'a', 'è': 'e', 'é': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u',
  'À': 'A', 'È': 'E', 'É': 'E', 'Ì': 'I', 'Ò': 'O', 'Ù': 'U'
};

/**
 * Alternative mappings that preserve more character information
 * Used when we want to keep some character distinction
 */
const EUROPEAN_CHAR_MAP_LIGHT = {
  // German - keep some distinction
  'ä': 'a', 'Ä': 'A',
  'ö': 'o', 'Ö': 'O', 
  'ü': 'u', 'Ü': 'U',
  'ß': 'ss',
  
  // Scandinavian - keep some distinction
  'å': 'a', 'Å': 'A',
  'æ': 'ae', 'Æ': 'AE',
  'ø': 'o', 'Ø': 'O'
};

/**
 * Normalizes European special characters for search queries
 * Uses full normalization to maximize search success
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
export function normalizeForSearch(text) {
  if (!text || typeof text !== 'string') return text;
  
  let normalized = text;
  
  // Apply character mapping
  for (const [special, normal] of Object.entries(EUROPEAN_CHAR_MAP)) {
    normalized = normalized.replace(new RegExp(special, 'g'), normal);
  }
  
  // Additional cleanup for search
  normalized = normalized
    .trim()
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[^\w\s\-\.]/g, ' ') // Remove special punctuation but keep hyphens and dots
    .replace(/\s+/g, ' '); // Clean up extra spaces
  
  return normalized;
}

/**
 * Normalizes text with light character replacement
 * Preserves more original character information
 * @param {string} text - Text to normalize
 * @returns {string} Lightly normalized text
 */
export function normalizeLightly(text) {
  if (!text || typeof text !== 'string') return text;
  
  let normalized = text;
  
  // Apply light character mapping
  for (const [special, normal] of Object.entries(EUROPEAN_CHAR_MAP_LIGHT)) {
    normalized = normalized.replace(new RegExp(special, 'g'), normal);
  }
  
  return normalized.trim();
}

/**
 * Generates multiple search variations for a business name
 * Including original, normalized, and alternative spellings
 * @param {string} businessName - Original business name
 * @returns {string[]} Array of search variations
 */
export function generateSearchVariations(businessName) {
  if (!businessName || typeof businessName !== 'string') return [businessName];
  
  const variations = new Set();
  
  // Original name
  variations.add(businessName.trim());
  
  // Fully normalized version
  const normalized = normalizeForSearch(businessName);
  if (normalized !== businessName) {
    variations.add(normalized);
  }
  
  // Lightly normalized version
  const lightNormalized = normalizeLightly(businessName);
  if (lightNormalized !== businessName && lightNormalized !== normalized) {
    variations.add(lightNormalized);
  }
  
  // Remove company endings for additional variations
  const companyEndings = [
    'GmbH', 'AG', 'AB', 'AS', 'ApS', 'A/S', 'Oy', 'Ltd', 'LLC', 'Inc',
    'Co.', 'Company', 'Företag', 'Selskab', 'Gesellschaft'
  ];
  
  const withoutEndings = businessName.replace(
    new RegExp(`\\s+(${companyEndings.join('|')})\\s*$`, 'i'), 
    ''
  ).trim();
  
  if (withoutEndings !== businessName && withoutEndings.length > 2) {
    variations.add(withoutEndings);
    variations.add(normalizeForSearch(withoutEndings));
  }
  
  return Array.from(variations).filter(v => v && v.length > 1);
}

/**
 * Checks if text contains European special characters
 * @param {string} text - Text to check
 * @returns {boolean} True if contains special characters
 */
export function hasEuropeanChars(text) {
  if (!text || typeof text !== 'string') return false;
  
  const europeanCharRegex = /[äöüßåæøàáâãèéêëìíîïòóôõùúûüçñ]/i;
  return europeanCharRegex.test(text);
}

/**
 * Preserves original characters while ensuring CSV compatibility
 * @param {string} text - Text to prepare for CSV
 * @returns {string} CSV-safe text with preserved characters
 */
export function prepareForCSV(text) {
  if (!text || typeof text !== 'string') return text;
  
  return text
    .trim()
    .replace(/"/g, '""') // Escape quotes for CSV
    .replace(/\r?\n/g, ' ') // Replace newlines with spaces
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Language-specific selectors for European Google Maps interfaces
 */
export const EUROPEAN_SELECTORS = {
  // German selectors
  german: {
    rating: ['bewertung', 'sterne', 'rating'],
    reviews: ['bewertungen', 'rezensionen', 'reviews'],
    address: ['adresse', 'address'],
    phone: ['telefon', 'phone'],
    website: ['website', 'webseite'],
    hours: ['öffnungszeiten', 'hours'],
    category: ['kategorie', 'category']
  },
  
  // Swedish selectors
  swedish: {
    rating: ['betyg', 'stjärnor', 'rating'],
    reviews: ['recensioner', 'omdömen', 'reviews'],
    address: ['adress', 'address'], 
    phone: ['telefon', 'phone'],
    website: ['webbplats', 'website'],
    hours: ['öppettider', 'hours'],
    category: ['kategori', 'category']
  },
  
  // Norwegian selectors
  norwegian: {
    rating: ['vurdering', 'stjerner', 'rating'],
    reviews: ['anmeldelser', 'reviews'],
    address: ['adresse', 'address'],
    phone: ['telefon', 'phone'], 
    website: ['nettsted', 'website'],
    hours: ['åpningstider', 'hours'],
    category: ['kategori', 'category']
  },
  
  // Danish selectors
  danish: {
    rating: ['bedømmelse', 'stjerner', 'rating'],
    reviews: ['anmeldelser', 'reviews'],
    address: ['adresse', 'address'],
    phone: ['telefon', 'phone'],
    website: ['hjemmeside', 'website'], 
    hours: ['åbningstider', 'hours'],
    category: ['kategori', 'category']
  }
};

/**
 * Gets all European language selectors combined
 * @returns {Object} Combined selectors for all European languages
 */
export function getAllEuropeanSelectors() {
  const combined = {};
  
  Object.values(EUROPEAN_SELECTORS).forEach(langSelectors => {
    Object.entries(langSelectors).forEach(([key, selectors]) => {
      if (!combined[key]) combined[key] = new Set();
      selectors.forEach(selector => combined[key].add(selector));
    });
  });
  
  // Convert Sets back to arrays
  Object.keys(combined).forEach(key => {
    combined[key] = Array.from(combined[key]);
  });
  
  return combined;
}