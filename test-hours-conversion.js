/**
 * Quick test to verify hours extraction with current changes
 * Tests the normalizeDayNames and convertTo24Hour functions
 */

// Simulated test cases based on actual Google Maps outputs
const testCases = [
  // 12-hour format tests
  { input: 'Monday: 12:00 pm - 9:00 pm', expected: '12:00 - 21:00' },
  { input: '7:30 am - 7 pm', expected: '07:30 - 19:00' },
  { input: '9 am - 5 pm', expected: '09:00 - 17:00' },
  { input: '12 am - 11:59 pm', expected: '00:00 - 23:59' },
  { input: '8:00am-6:00pm', expected: '08:00 - 18:00' },
  
  // Multiple ranges
  { input: '9:00 am - 12:00 pm, 2:00 pm - 6:00 pm', expected: '09:00 - 12:00 & 14:00 - 18:00' },
  { input: '7 am - 12 pm and 1 pm - 8 pm', expected: '07:00 - 12:00 & 13:00 - 20:00' },
  
  // Special cases
  { input: 'Open 24 hours', expected: 'Open 24 hours' },
  { input: 'Closed', expected: 'Closed' },
  
  // German
  { input: 'Montag: 9:00 - 18:00', expected: '09:00 - 18:00' },
  
  // Edge cases
  { input: '12:30 pm - 12:30 am', expected: '12:30 - 00:30' },
];

// Import the functions (simulate)
function convertTo24Hour(time12h) {
  if (!time12h) return time12h;
  
  const match = time12h.trim().match(/(\d+)(?::(\d+))?\s*(am|pm)/i);
  if (!match) {
    console.log(`      ⚠️ Cannot parse time: "${time12h}"`);
    return time12h;
  }
  
  let hours = parseInt(match[1]);
  const minutes = match[2] ? match[2].padStart(2, '0') : '00';
  const period = match[3].toLowerCase();
  
  if (hours < 1 || hours > 12) {
    console.log(`      ⚠️ Invalid hours: ${hours}`);
    return time12h;
  }
  
  if (period === 'pm' && hours !== 12) {
    hours += 12;
  } else if (period === 'am' && hours === 12) {
    hours = 0;
  }
  
  const formatted = `${hours.toString().padStart(2, '0')}:${minutes}`;
  return formatted;
}

function normalizeDayNames(text) {
  if (!text) return text;
  
  const dayTranslations = {
    'Montag': 'Monday',
    'Dienstag': 'Tuesday', 
    'Mittwoch': 'Wednesday',
    'Donnerstag': 'Thursday',
    'Freitag': 'Friday',
    'Samstag': 'Saturday',
    'Sonntag': 'Sunday',
    'Geschlossen': 'Closed',
  };
  
  let normalizedText = text;
  
  for (const [foreign, english] of Object.entries(dayTranslations)) {
    const regex = new RegExp(`\\b${foreign}\\b`, 'gi');
    normalizedText = normalizedText.replace(regex, english);
  }
  
  if (/open 24 hours?/i.test(normalizedText)) {
    return 'Open 24 hours';
  }
  if (/closed/i.test(normalizedText)) {
    return 'Closed';
  }
  
  normalizedText = normalizedText
    .replace(/(\d+)(am|pm)/gi, '$1 $2')
    .replace(/\b(AM|PM)\b/g, (match) => match.toLowerCase())
    .replace(/(\d+\s*(?:am|pm))(\d+)/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  
  normalizedText = normalizedText.replace(/(\d+(?::\d+)?\s*(?:am|pm))/gi, (match) => {
    const converted = convertTo24Hour(match);
    return converted;
  });
  
  normalizedText = normalizedText
    .replace(/\s*[-–—]\s*/g, ' - ')
    .replace(/\s+to\s+/gi, ' - ')
    .replace(/\s*,\s*/g, ' & ')
    .replace(/\s+and\s+/gi, ' & ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Remove day prefixes
  normalizedText = normalizedText.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*:?\s*/i, '');
  
  return normalizedText;
}

// Run tests
console.log('🧪 Testing hours conversion logic...\n');

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  const result = normalizeDayNames(test.input);
  const success = result === test.expected;
  
  if (success) {
    console.log(`✅ Test ${index + 1} PASSED`);
    passed++;
  } else {
    console.log(`❌ Test ${index + 1} FAILED`);
    console.log(`   Input:    "${test.input}"`);
    console.log(`   Expected: "${test.expected}"`);
    console.log(`   Got:      "${result}"`);
    failed++;
  }
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed (${Math.round(passed/(passed+failed)*100)}% success)`);
