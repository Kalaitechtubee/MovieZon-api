function parseQualityAndLanguage(qualityStr, defaultLanguage = 'English') {
  const str = qualityStr.trim()
  
  const compositePatterns = [
    { regex: /^Original\s+Audio\b/i, lang: defaultLanguage },
    { regex: /^Original\s*\/\s*Default\b/i, lang: defaultLanguage }
  ]
  
  for (const pattern of compositePatterns) {
    if (pattern.regex.test(str)) {
      const cleanQuality = str.replace(pattern.regex, '').trim()
      return {
        language: pattern.lang,
        quality: cleanQuality || 'Auto'
      }
    }
  }
  
  const knownLanguages = [
    'Tamil', 'Telugu', 'Hindi', 'English', 'Malayalam', 'Kannada', 
    'Bengali', 'Marathi', 'Punjabi', 'Spanish', 'French', 'German', 
    'Japanese', 'Korean', 'Original'
  ]
  
  for (const lang of knownLanguages) {
    const regex = new RegExp(`^${lang}\\b`, 'i')
    if (regex.test(str)) {
      const cleanQuality = str.replace(regex, '').trim()
      return {
        language: lang === 'Original' ? defaultLanguage : lang,
        quality: cleanQuality || 'Auto'
      }
    }
  }
  
  const alphaMatch = str.match(/^([a-zA-Z]+)\s+(.*)$/)
  if (alphaMatch) {
    return {
      language: alphaMatch[1],
      quality: alphaMatch[2]
    }
  }
  
  return {
    language: defaultLanguage,
    quality: str
  }
}

// Test cases
const cases = [
  'Original Audio 360p',
  'Original / Default 266p',
  'Hindi 480p',
  'Tamil 1080p',
  'Malayalam 720p',
  'Original 1080p',
  'Default 480p'
];

console.log("Testing parseQualityAndLanguage:");
cases.forEach(c => {
  console.log(`Input: "${c}" ->`, parseQualityAndLanguage(c));
});
