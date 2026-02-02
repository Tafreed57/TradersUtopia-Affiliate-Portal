/*
 * Affiliate ↔ Sheet Sync (v12.2 — Fixed Issues + Enhanced Reliability)
 * IMPROVEMENTS:
 *  - Optimized authentication (remembers working method)
 *  - Better error handling and input validation
 *  - Pagination safety checks
 *  - Enhanced UI robustness
 *  - Memory optimization for large datasets
 */

var BASE_URL   = 'https://api.getrewardful.com/v1';
var HEADERS    = ['Email','Affiliate ID','Unpaid Amount','Due Now','Approved Commission','Last Payout','Status','Last Updated'];
var HDR_RANGE  = 'A1:H1';
var COL_A = 1;
var COL_EMAIL = 1, COL_ID = 2, COL_UNPAID = 3, COL_DUE_NOW = 4, COL_PAID = 5, COL_LAST = 6, COL_STATUS = 7, COL_UPDATED = 8;
var CURRENCY   = 'CAD';
var USD_TO_CAD_RATE = 1.39; // Updated conversion rate (Nov 2024)
var PRIVACY_ON = true;
var REHIDE_FN  = 'rehideEmails_';

// =============================================================================
// ADMIN CONFIGURATION — SINGLE SOURCE OF TRUTH
// =============================================================================
// All admin emails go here. DO NOT hardcode admin checks anywhere else.
// To add/remove admins: update this array and redeploy.
// Future: Move to PropertiesService or database for runtime updates.
// =============================================================================
var ADMIN_EMAILS = [
  'admin@gmail.com',           // System admin account
  'tafreed57@gmail.com',       // Tafreed
  'ps9721@gmail.com',          // PS
  'shehrozeps9721@gmail.com'   // Shehroz
];

// =============================================================================
// TEACHER OVERRIDE EMAILS
// These alias emails are granted Teacher Portal access regardless of name check.
// Use this for accounts that lost teacher access after migration/merging.
// =============================================================================
var TEACHER_OVERRIDE_EMAILS = [
  'tafreed47@gmail.com'        // Tafreed (migrated from tafreeddddd100%@gmail.com)
];

// Web App URL - Fallback only, prefer ScriptApp.getService().getUrl()
var WEB_APP_URL_FALLBACK = 'https://script.google.com/macros/s/AKfycbxec_gT1Pw6c77caBrnFqMDuG6DoMy4I_ORL-ruleuJXSYDC3Dts4mzUf5wt6ZNcTtw/exec';

/**
 * PUBLIC: Get the deployed web app URL
 * IMPORTANT: Uses ScriptApp.getService().getUrl() to get the CORRECT deployed URL
 * This prevents the userCodeAppPanel bug where users get blank pages
 */
function getWebAppUrl() {
  try {
    // This is the CORRECT way to get the deployed web app URL
    // It returns the /exec URL, not the preview/userCodeAppPanel URL
    var url = ScriptApp.getService().getUrl();
    if (url) {
      Logger.log('getWebAppUrl: Using ScriptApp URL: ' + url);
      return url;
    }
  } catch (e) {
    Logger.log('getWebAppUrl: ScriptApp.getService().getUrl() failed: ' + e.message);
  }
  
  // Fallback to hardcoded URL (should rarely happen)
  Logger.log('getWebAppUrl: Using fallback URL');
  return WEB_APP_URL_FALLBACK;
}

// New constants for improved reliability
var MAX_PAGES = 100; // Safety limit for pagination
var MAX_RETRIES = 3;
var RETRY_DELAY_MS = 300;
var RATE_LIMIT_DELAY_MS = 350;  // Base delay between API calls
var RATE_LIMIT_BACKOFF_MS = 2000;  // Initial backoff for 429 errors
var MAX_RATE_LIMIT_RETRIES = 3;  // Max retries on rate limit

// Cache for authentication method that works
var _authMethodCache = null;

// Performance optimization flags
var ENABLE_VERBOSE_LOGGING = false; // Set to false for production (massive speedup!)
var CACHE_DURATION_SECONDS = 300; // 5 minutes cache for API responses (use manual refresh for instant updates)
var ENABLE_API_CACHE = true; // Enable caching of API responses

/* ---------- Performance Optimization Functions ---------- */

/**
 * Conditional logger - only logs if verbose logging is enabled
 */
function log_(message) {
  if (ENABLE_VERBOSE_LOGGING) {
    Logger.log(message);
  }
}

/**
 * Get cached API response
 */
function getCachedApiResponse_(cacheKey) {
  if (!ENABLE_API_CACHE) return null;
  
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(cacheKey);
    if (cached) {
      log_('✅ Cache HIT: ' + cacheKey);
      return JSON.parse(cached);
    }
    log_('❌ Cache MISS: ' + cacheKey);
  } catch(e) {
    log_('Cache get error: ' + e.message);
  }
  return null;
}

/**
 * Set cached API response
 */
function setCachedApiResponse_(cacheKey, data) {
  if (!ENABLE_API_CACHE) return;
  
  try {
    var cache = CacheService.getScriptCache();
    cache.put(cacheKey, JSON.stringify(data), CACHE_DURATION_SECONDS);
    log_('💾 Cached: ' + cacheKey);
  } catch(e) {
    log_('Cache set error: ' + e.message);
  }
}

/**
 * Clear cache for specific key or all cache
 */
function clearCache_(cacheKey) {
  try {
    var cache = CacheService.getScriptCache();
    if (cacheKey) {
      cache.remove(cacheKey);
      log_('🗑️ Cleared cache: ' + cacheKey);
    } else {
      cache.removeAll([]);
      log_('🗑️ Cleared ALL cache');
    }
  } catch(e) {
    log_('Cache clear error: ' + e.message);
  }
}

/**
 * Clear cache for a specific teacher (useful after adding/removing students)
 */
function clearTeacherCache_(teacherEmail) {
  var emailLower = teacherEmail.toLowerCase();
  clearCache_('teacher_verify_' + emailLower);
  clearCache_('students_data_' + emailLower);
  log_('Cleared all cache for teacher: ' + teacherEmail);
}

/**
 * Clear cache for a specific student (useful after payment or data changes)
 */
function clearStudentCache_(studentEmail) {
  var emailLower = studentEmail.toLowerCase();
  clearCache_('raw_due_now_' + emailLower);
  log_('Cleared cache for student: ' + studentEmail);
}

/**
 * PUBLIC: Clear all caches (callable from UI for debugging/force refresh)
 */
function clearAllCaches() {
  clearCache_();
  return { success: true, message: 'All caches cleared successfully' };
}

/**
 * DEBUG: Check what percentage and tracking data exists for a user
 */
function debugUserTracking(email) {
  Logger.log('=== DEBUG USER TRACKING: ' + email + ' ===');
  
  // Check email percentage
  var emailPercentage = extractEmailPercentage_(email);
  Logger.log('Email percentage: ' + (emailPercentage !== null ? emailPercentage + '%' : 'None'));
  
  // Check incremental tracking
  var tracking = getIncrementalTracking_(email);
  if (tracking) {
    Logger.log('Tracking exists:');
    Logger.log('  - Initialized: ' + tracking.isInitialized);
    Logger.log('  - Email baseline %: ' + tracking.emailBaselinePercentage);
    Logger.log('  - Last API Unpaid: $' + tracking.lastApiUnpaid);
    Logger.log('  - Last Displayed Unpaid: $' + tracking.lastDisplayedUnpaid);
    Logger.log('  - Last API Due Now: $' + tracking.lastApiDueNow);
    Logger.log('  - Last Displayed Due Now: $' + tracking.lastDisplayedDueNow);
  } else {
    Logger.log('No tracking data found (will be first lookup)');
  }
}

/**
 * COMPREHENSIVE DEBUG: Fetch RAW API values directly and compare with tracking
 * This bypasses the incremental tracking system to show what values SHOULD be
 * 
 * Call this from Apps Script editor: debugRawVsDisplayed('momo50%@gmail.com')
 */
function debugRawVsDisplayed(email) {
  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════════════════╗');
  Logger.log('║   COMPREHENSIVE DEBUG: RAW API vs DISPLAYED VALUES              ║');
  Logger.log('║   Email: ' + email);
  Logger.log('╚══════════════════════════════════════════════════════════════════╝');
  Logger.log('');
  
  var results = {
    email: email,
    timestamp: new Date().toISOString()
  };
  
  // Step 1: Extract email percentage
  var emailPercentage = extractEmailPercentage_(email);
  var effectivePercentage = (emailPercentage === null) ? 100 : emailPercentage;
  var multiplier = effectivePercentage / 100;
  
  Logger.log('─── STEP 1: EMAIL PERCENTAGE ───');
  Logger.log('Extracted percentage: ' + (emailPercentage !== null ? emailPercentage + '%' : 'null (no pattern)'));
  Logger.log('Effective percentage: ' + effectivePercentage + '%');
  Logger.log('Multiplier: ' + multiplier);
  Logger.log('');
  
  results.emailPercentage = emailPercentage;
  results.effectivePercentage = effectivePercentage;
  results.multiplier = multiplier;
  
  // Step 2: Fetch RAW API values (bypass tracking completely)
  Logger.log('─── STEP 2: RAW API VALUES (100% - from Rewardful) ───');
  
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) {
      Logger.log('ERROR: Missing AFFILIATE_API_KEY');
      return { error: 'Missing API key' };
    }
    
    // Fetch affiliate
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    Logger.log('Fetching affiliate from: ' + affUrl);
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp || affResp.getResponseCode() !== 200) {
      Logger.log('ERROR: Affiliate API returned ' + (affResp ? affResp.getResponseCode() : 'null'));
      return { error: 'Failed to fetch affiliate' };
    }
    
    var payload = safeParseJson_(affResp.getContentText());
    var aff = extractAffiliate_(payload);
    
    if (!aff || !aff.id) {
      Logger.log('ERROR: Affiliate not found for email: ' + email);
      return { error: 'Affiliate not found', email: email };
    }
    
    Logger.log('Affiliate ID: ' + aff.id);
    Logger.log('Affiliate Name: ' + (aff.first_name || '') + ' ' + (aff.last_name || ''));
    
    results.affiliateId = aff.id;
    results.affiliateName = (aff.first_name || '') + ' ' + (aff.last_name || '');
    
    // Fetch expanded affiliate data with commission_stats
    var affByIdUrl = BASE_URL + '/affiliates/' + aff.id + '?expand=true';
    Logger.log('Fetching expanded data from: ' + affByIdUrl);
    var affByIdResp = fetchWithRetry_(affByIdUrl, apiKey);
    
    var rawUnpaid = 0;
    var rawDueNow = 0;
    var rawTotalPaid = 0;
    var dataSource = 'unknown';
    
    if (affByIdResp && affByIdResp.getResponseCode() === 200) {
      var expandedPayload = safeParseJson_(affByIdResp.getContentText());
      var expandedAff = extractAffiliate_(expandedPayload);
      
      if (expandedAff && expandedAff.commission_stats && expandedAff.commission_stats.currencies) {
        var currencies = expandedAff.commission_stats.currencies;
        Logger.log('Available currencies in commission_stats: ' + JSON.stringify(Object.keys(currencies)));
        
        // Try to get CAD first, then USD
        var currData = currencies['CAD'] || currencies['USD'] || currencies[Object.keys(currencies)[0]];
        var currCode = currencies['CAD'] ? 'CAD' : (currencies['USD'] ? 'USD' : Object.keys(currencies)[0]);
        
        if (currData) {
          Logger.log('Using currency: ' + currCode);
          Logger.log('Currency data: ' + JSON.stringify(currData));
          
          // Extract unpaid
          if (currData.unpaid && currData.unpaid.cents !== undefined) {
            rawUnpaid = Number(currData.unpaid.cents) / 100;
            if (currCode === 'USD' && CURRENCY === 'CAD') {
              rawUnpaid = rawUnpaid * USD_TO_CAD_RATE;
            }
            Logger.log('Raw Unpaid: ' + currData.unpaid.cents + ' cents = $' + rawUnpaid.toFixed(2) + ' ' + CURRENCY);
          }
          
          // Extract due
          if (currData.due && currData.due.cents !== undefined) {
            rawDueNow = Number(currData.due.cents) / 100;
            if (currCode === 'USD' && CURRENCY === 'CAD') {
              rawDueNow = rawDueNow * USD_TO_CAD_RATE;
            }
            Logger.log('Raw Due Now: ' + currData.due.cents + ' cents = $' + rawDueNow.toFixed(2) + ' ' + CURRENCY);
          }
          
          // Extract paid
          if (currData.paid && currData.paid.cents !== undefined) {
            rawTotalPaid = Number(currData.paid.cents) / 100;
            if (currCode === 'USD' && CURRENCY === 'CAD') {
              rawTotalPaid = rawTotalPaid * USD_TO_CAD_RATE;
            }
            Logger.log('Raw Total Paid: ' + currData.paid.cents + ' cents = $' + rawTotalPaid.toFixed(2) + ' ' + CURRENCY);
          }
          
          dataSource = 'commission_stats.currencies.' + currCode;
        }
      } else {
        Logger.log('No commission_stats.currencies found, falling back to commissions calculation');
      }
    }
    
    // If we didn't get data from commission_stats, calculate from commissions
    if (dataSource === 'unknown') {
      Logger.log('Calculating from commissions API...');
      var totals = sumDueNowForAffiliate_(aff.id, apiKey);
      rawUnpaid = totals.unpaid;
      rawDueNow = totals.dueNow;
      rawTotalPaid = totals.paid;
      dataSource = 'calculated_from_commissions';
    }
    
    rawUnpaid = round2_(rawUnpaid);
    rawDueNow = round2_(rawDueNow);
    rawTotalPaid = round2_(rawTotalPaid);
    
    Logger.log('');
    Logger.log('📊 RAW API VALUES (100% from Rewardful):');
    Logger.log('   Unpaid:     $' + rawUnpaid.toFixed(2) + ' ' + CURRENCY);
    Logger.log('   Due Now:    $' + rawDueNow.toFixed(2) + ' ' + CURRENCY);
    Logger.log('   Total Paid: $' + rawTotalPaid.toFixed(2) + ' ' + CURRENCY);
    Logger.log('   Data Source: ' + dataSource);
    Logger.log('');
    
    results.rawApiValues = {
      unpaid: rawUnpaid,
      dueNow: rawDueNow,
      totalPaid: rawTotalPaid,
      source: dataSource
    };
    
    // Step 3: Calculate what SHOULD be displayed (raw × percentage)
    Logger.log('─── STEP 3: EXPECTED DISPLAYED VALUES (' + effectivePercentage + '% of raw) ───');
    
    var expectedUnpaid = round2_(rawUnpaid * multiplier);
    var expectedDueNow = round2_(rawDueNow * multiplier);
    var expectedTotalPaid = round2_(rawTotalPaid * multiplier);
    
    Logger.log('📋 EXPECTED DISPLAYED VALUES:');
    Logger.log('   Unpaid:     $' + rawUnpaid.toFixed(2) + ' × ' + multiplier + ' = $' + expectedUnpaid.toFixed(2) + ' ' + CURRENCY);
    Logger.log('   Due Now:    $' + rawDueNow.toFixed(2) + ' × ' + multiplier + ' = $' + expectedDueNow.toFixed(2) + ' ' + CURRENCY);
    Logger.log('   Total Paid: $' + rawTotalPaid.toFixed(2) + ' × ' + multiplier + ' = $' + expectedTotalPaid.toFixed(2) + ' ' + CURRENCY);
    Logger.log('');
    
    results.expectedDisplayed = {
      unpaid: expectedUnpaid,
      dueNow: expectedDueNow,
      totalPaid: expectedTotalPaid
    };
    
    // Step 4: Check what tracking system has stored
    Logger.log('─── STEP 4: CURRENT TRACKING DATA ───');
    
    var tracking = getIncrementalTracking_(email);
    
    if (tracking) {
      Logger.log('Tracking found:');
      Logger.log('   Initialized: ' + tracking.isInitialized);
      Logger.log('   Stored Email Percentage: ' + (tracking.emailBaselinePercentage !== null ? tracking.emailBaselinePercentage + '%' : 'null (100%)'));
      Logger.log('   Last API Unpaid:       $' + (tracking.lastApiUnpaid || 0).toFixed(2));
      Logger.log('   Last API Due Now:      $' + (tracking.lastApiDueNow || 0).toFixed(2));
      Logger.log('   Last API Total Paid:   $' + (tracking.lastApiTotalPaid || 0).toFixed(2));
      Logger.log('   Last DISPLAYED Unpaid:     $' + (tracking.lastDisplayedUnpaid || 0).toFixed(2));
      Logger.log('   Last DISPLAYED Due Now:    $' + (tracking.lastDisplayedDueNow || 0).toFixed(2));
      Logger.log('   Last DISPLAYED Total Paid: $' + (tracking.lastDisplayedTotalPaid || 0).toFixed(2));
      
      results.trackingData = tracking;
    } else {
      Logger.log('❌ No tracking data found - this would be a first lookup');
      results.trackingData = null;
    }
    
    Logger.log('');
    
    // Step 5: Compare and identify issues
    Logger.log('─── STEP 5: COMPARISON & ISSUES ───');
    
    var issues = [];
    
    // Check if tracking percentage matches email percentage
    if (tracking) {
      var storedPercent = (tracking.emailBaselinePercentage === null || tracking.emailBaselinePercentage === 100) ? 100 : tracking.emailBaselinePercentage;
      if (storedPercent !== effectivePercentage) {
        issues.push('PERCENTAGE MISMATCH: Email says ' + effectivePercentage + '%, tracking has ' + storedPercent + '%');
      }
      
      // Check if displayed values match expected
      var unpaidDiff = Math.abs((tracking.lastDisplayedUnpaid || 0) - expectedUnpaid);
      var dueNowDiff = Math.abs((tracking.lastDisplayedDueNow || 0) - expectedDueNow);
      var paidDiff = Math.abs((tracking.lastDisplayedTotalPaid || 0) - expectedTotalPaid);
      
      if (unpaidDiff > 0.01) {
        issues.push('UNPAID MISMATCH: Tracking shows $' + (tracking.lastDisplayedUnpaid || 0).toFixed(2) + ' but should be $' + expectedUnpaid.toFixed(2) + ' (diff: $' + unpaidDiff.toFixed(2) + ')');
      }
      if (dueNowDiff > 0.01) {
        issues.push('DUE NOW MISMATCH: Tracking shows $' + (tracking.lastDisplayedDueNow || 0).toFixed(2) + ' but should be $' + expectedDueNow.toFixed(2) + ' (diff: $' + dueNowDiff.toFixed(2) + ')');
      }
      if (paidDiff > 0.01) {
        issues.push('TOTAL PAID MISMATCH: Tracking shows $' + (tracking.lastDisplayedTotalPaid || 0).toFixed(2) + ' but should be $' + expectedTotalPaid.toFixed(2) + ' (diff: $' + paidDiff.toFixed(2) + ')');
      }
    }
    
    if (issues.length === 0) {
      Logger.log('✅ NO ISSUES FOUND - Values are correct!');
    } else {
      Logger.log('⚠️ ISSUES FOUND:');
      for (var i = 0; i < issues.length; i++) {
        Logger.log('   ' + (i + 1) + '. ' + issues[i]);
      }
    }
    
    results.issues = issues;
    
    Logger.log('');
    Logger.log('═══════════════════════════════════════════════════════════════════');
    Logger.log('');
    
    // Step 6: Provide fix recommendation
    if (issues.length > 0) {
      Logger.log('🔧 RECOMMENDED FIX:');
      Logger.log('   Run: resetIncrementalTracking("' + email + '")');
      Logger.log('   This will delete the corrupted tracking data.');
      Logger.log('   On next lookup, correct values will be calculated fresh.');
      Logger.log('');
      Logger.log('   OR run: fixAffiliatePercentage("' + email + '", true)');
      Logger.log('   This will force reset and trigger a fresh lookup.');
    }
    
    Logger.log('');
    Logger.log('╔══════════════════════════════════════════════════════════════════╗');
    Logger.log('║   DEBUG COMPLETE                                                 ║');
    Logger.log('╚══════════════════════════════════════════════════════════════════╝');
    
    return results;
    
  } catch(e) {
    Logger.log('ERROR: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return { error: e.message, email: email };
  }
}

/**
 * SIMPLE MODE: Fetch and calculate commission values WITHOUT incremental tracking
 * This is the "clean" calculation that should always produce correct values.
 * 
 * Use this when you suspect the incremental tracking has corrupted data.
 * 
 * @param {string} email - Affiliate email
 * @returns {object} - Calculated commission values with percentage applied
 */
function getSimpleCommissionValues(email) {
  Logger.log('=== SIMPLE MODE: Getting commission values for ' + email + ' ===');
  
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) throw new Error('Missing AFFILIATE_API_KEY');
    
    // Step 1: Get email percentage
    var emailPercentage = extractEmailPercentage_(email);
    var effectivePercentage = (emailPercentage === null) ? 100 : emailPercentage;
    var multiplier = effectivePercentage / 100;
    
    Logger.log('Email percentage: ' + effectivePercentage + '%');
    
    // Step 2: Fetch affiliate
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp || affResp.getResponseCode() !== 200) {
      return { status: 'Error', error: 'Affiliate API failed' };
    }
    
    var payload = safeParseJson_(affResp.getContentText());
    var aff = extractAffiliate_(payload);
    
    if (!aff || !aff.id) {
      return { status: 'Not found', affiliateId: '', unpaidAmount: 0, dueNow: 0, totalPaid: 0 };
    }
    
    // Step 3: Fetch expanded affiliate data
    var affByIdUrl = BASE_URL + '/affiliates/' + aff.id + '?expand=true';
    var affByIdResp = fetchWithRetry_(affByIdUrl, apiKey);
    
    var rawUnpaid = 0;
    var rawDueNow = 0;
    var rawTotalPaid = 0;
    var dataSource = 'unknown';
    
    if (affByIdResp && affByIdResp.getResponseCode() === 200) {
      var expandedPayload = safeParseJson_(affByIdResp.getContentText());
      var expandedAff = extractAffiliate_(expandedPayload);
      
      if (expandedAff && expandedAff.commission_stats && expandedAff.commission_stats.currencies) {
        var currencies = expandedAff.commission_stats.currencies;
        var currData = currencies['CAD'] || currencies['USD'] || currencies[Object.keys(currencies)[0]];
        var currCode = currencies['CAD'] ? 'CAD' : (currencies['USD'] ? 'USD' : Object.keys(currencies)[0]);
        
        if (currData) {
          if (currData.unpaid && currData.unpaid.cents !== undefined) {
            rawUnpaid = Number(currData.unpaid.cents) / 100;
            if (currCode === 'USD' && CURRENCY === 'CAD') rawUnpaid *= USD_TO_CAD_RATE;
          }
          if (currData.due && currData.due.cents !== undefined) {
            rawDueNow = Number(currData.due.cents) / 100;
            if (currCode === 'USD' && CURRENCY === 'CAD') rawDueNow *= USD_TO_CAD_RATE;
          }
          if (currData.paid && currData.paid.cents !== undefined) {
            rawTotalPaid = Number(currData.paid.cents) / 100;
            if (currCode === 'USD' && CURRENCY === 'CAD') rawTotalPaid *= USD_TO_CAD_RATE;
          }
          dataSource = 'commission_stats.' + currCode;
        }
      }
    }
    
    // Fallback to calculated values if commission_stats not available
    if (dataSource === 'unknown') {
      var totals = sumDueNowForAffiliate_(aff.id, apiKey);
      rawUnpaid = totals.unpaid;
      rawDueNow = totals.dueNow;
      rawTotalPaid = totals.paid;
      dataSource = 'calculated';
    }
    
    // Step 4: Apply percentage
    var displayedUnpaid = round2_(rawUnpaid * multiplier);
    var displayedDueNow = round2_(rawDueNow * multiplier);
    var displayedTotalPaid = round2_(rawTotalPaid * multiplier);
    
    Logger.log('Raw API values (100%): Unpaid=$' + rawUnpaid.toFixed(2) + ', DueNow=$' + rawDueNow.toFixed(2) + ', Paid=$' + rawTotalPaid.toFixed(2));
    Logger.log('Displayed values (' + effectivePercentage + '%): Unpaid=$' + displayedUnpaid.toFixed(2) + ', DueNow=$' + displayedDueNow.toFixed(2) + ', Paid=$' + displayedTotalPaid.toFixed(2));
    
    return {
      status: 'active',
      affiliateId: aff.id,
      unpaidAmount: displayedUnpaid,
      dueNow: displayedDueNow,
      totalPaid: displayedTotalPaid,
      lastPayout: '',
      _mode: 'simple',
      _emailPercentage: effectivePercentage,
      _dataSource: dataSource,
      _rawValues: {
        unpaid: round2_(rawUnpaid),
        dueNow: round2_(rawDueNow),
        totalPaid: round2_(rawTotalPaid)
      }
    };
    
  } catch(e) {
    Logger.log('Error in simple mode: ' + e.message);
    return { status: 'Error', error: e.message };
  }
  
  // Check admin override
  var override = getAdminOverride_(email);
  if (override) {
    Logger.log('Admin override exists:');
    Logger.log('  - Unpaid: ' + override.unpaidAmount);
    Logger.log('  - Due Now: ' + override.dueNow);
    Logger.log('  - Percentage enabled: ' + override.percentageEnabled);
    Logger.log('  - Percentage multiplier: ' + override.percentageMultiplier);
  } else {
    Logger.log('No admin override');
  }
  
  Logger.log('=== END DEBUG ===');
}

/**
 * PUBLIC: Reset tracking for all users with percentage-based emails
 * Dynamically finds all affiliates with percentage patterns in their emails
 * and triggers auto-correction for each one.
 * 
 * This is useful after system updates or when percentage calculation logic was fixed.
 * 
 * @returns {object} - Result with success status, count of users fixed, and details
 */
function fixAllPercentageUsers() {
  try {
    Logger.log("=== FIX ALL PERCENTAGE USERS ===");
    
    // Find all affiliates with tracking data that have percentage patterns
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var percentageEmails = [];
    
    // Scan all tracking properties to find percentage-based emails
    for (var key in allProps) {
      if (key.indexOf('INCREMENTAL_TRACKING_') === 0) {
        // Extract email from key
        var email = key.replace('INCREMENTAL_TRACKING_', '')
                       .replace('_AT_', '@')
                       .replace(/_/g, '.');
        
        // Check if this email has a percentage pattern
        var percentage = extractEmailPercentage_(email);
        if (percentage !== null) {
          percentageEmails.push({ email: email, percentage: percentage });
          Logger.log("Found percentage email: " + email + " (" + percentage + "%)");
        }
      }
    }
    
    Logger.log("Found " + percentageEmails.length + " affiliates with percentage patterns");
    
    if (percentageEmails.length === 0) {
      return { 
        success: true, 
        message: 'No affiliates with percentage-based emails found in tracking data.',
        count: 0,
        results: []
      };
    }
    
    // Fix each percentage user by triggering auto-correction
    var results = [];
    var successCount = 0;
    var failCount = 0;
    
    for (var i = 0; i < percentageEmails.length; i++) {
      var item = percentageEmails[i];
      try {
        // Trigger a lookup which will auto-correct the baseline if needed
        var lookupResult = fetchByEmail_(item.email);
        
        var wasFixed = lookupResult._baseline_corrected && lookupResult._baseline_corrected.wasApplied;
        
        results.push({
          email: item.email,
          percentage: item.percentage,
          fixed: wasFixed,
          status: wasFixed ? 'CORRECTED' : 'ALREADY_CORRECT',
          currentValues: {
            unpaid: lookupResult.unpaidAmount,
            dueNow: lookupResult.dueNow,
            totalPaid: lookupResult.totalPaid
          }
        });
        
        if (wasFixed) {
          successCount++;
          Logger.log("✅ " + item.email + ": CORRECTED");
        } else {
          Logger.log("✓ " + item.email + ": Already correct");
        }
        
        // Rate limiting
        Utilities.sleep(200);
        
      } catch(e) {
        failCount++;
        results.push({
          email: item.email,
          percentage: item.percentage,
          fixed: false,
          status: 'ERROR',
          error: e.message
        });
        Logger.log("❌ " + item.email + ": ERROR - " + e.message);
      }
    }
    
    var message = 'Processed ' + percentageEmails.length + ' percentage users. ' +
                  'Corrected: ' + successCount + ', Already correct: ' + 
                  (percentageEmails.length - successCount - failCount) + ', Errors: ' + failCount;
    
    Logger.log(message);
    Logger.log("=== END FIX ALL PERCENTAGE USERS ===");
    
    return { 
      success: true, 
      message: message,
      count: percentageEmails.length,
      corrected: successCount,
      alreadyCorrect: percentageEmails.length - successCount - failCount,
      errors: failCount,
      results: results
    };
    
  } catch(e) {
    Logger.log('Error fixing percentage users: ' + e);
    return { success: false, message: 'Error: ' + e.message };
  }
}

/**
 * Batch fetch multiple URLs in parallel (MUCH faster than sequential)
 */
function batchFetchUrls_(requests) {
  try {
    var responses = UrlFetchApp.fetchAll(requests);
    return responses;
  } catch(e) {
    Logger.log('Batch fetch error: ' + e.message);
    return null;
  }
}

/* ---------- Admin Functions ---------- */

/**
 * INTERNAL: Check if current Google session user is an admin
 * Uses ADMIN_EMAILS as the single source of truth.
 * Note: This checks the Google account. For session-based admin check, use isAdminSession_()
 */
function isAdmin_() {
  try {
    var userEmail = Session.getActiveUser().getEmail();
    if (!userEmail) return false;
    return isAdminEmail_(userEmail.toLowerCase().trim());
  } catch(e) {
    return false;
  }
}

/**
 * INTERNAL: Check if a session token belongs to an admin
 * This is the preferred method for admin checks from frontend calls
 */
function isAdminSession_(sessionToken) {
  if (!sessionToken) return false;
  
  try {
    var session = validateSessionToken(sessionToken);
    if (!session || !session.valid) return false;
    
    return session.isAdmin === true && isAdminEmail_(session.email);
  } catch(e) {
    return false;
  }
}

/**
 * INTERNAL: Check admin status using EITHER Google session OR app session token
 * Pass sessionToken for mobile/web app calls
 */
function isAdminAny_(sessionToken) {
  // First try Google session
  if (isAdmin_()) return true;
  
  // Then try app session token
  if (sessionToken && isAdminSession_(sessionToken)) return true;
  
  return false;
}

/**
 * INTERNAL: Check if a given email is in the admin list
 * This is the CANONICAL admin check - used everywhere.
 */
function isAdminEmail_(email) {
  if (!email) return false;
  var emailLower = email.toLowerCase().trim();
  for (var i = 0; i < ADMIN_EMAILS.length; i++) {
    if (ADMIN_EMAILS[i].toLowerCase().trim() === emailLower) {
      return true;
    }
  }
  return false;
}

/**
 * PUBLIC: Check if a given email is an admin (for frontend use)
 * Returns { isAdmin: true/false }
 */
function checkIsAdmin(email) {
  return { isAdmin: isAdminEmail_(email) };
}

/**
 * Check if email is a legacy/internal email
 * This checks TWO things:
 * 1. Does the email contain % (quick check for obvious internal emails)
 * 2. Is this email stored as someone's internalEmail in the auth records?
 * 
 * Users should login with their alias email, not the internal/Rewardful email.
 * 
 * @param {string} email - Email to check
 * @returns {boolean} - True if this is an internal email that shouldn't be used for login
 */
function isLegacyEmail_(email) {
  if (!email) return false;
  var normalized = email.toLowerCase().trim();
  
  // Quick check: if it contains %, it's definitely an internal email
  if (normalized.indexOf('%') !== -1) {
    return true;
  }
  
  // Check if this email is stored as someone's internal email in our auth records
  // This catches ALL internal emails, not just ones with %
  return isStoredAsInternalEmail_(normalized);
}

/**
 * Check if an email is stored as someone's internalEmail
 * Scans all auth records to see if this email is used as an internal email
 * 
 * @param {string} email - The email to check
 * @returns {boolean} - True if this email is someone's internal email
 */
function isStoredAsInternalEmail_(email) {
  if (!email) return false;
  var normalized = email.toLowerCase().trim();
  
  try {
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    
    // Look through all auth records
    for (var key in allProps) {
      if (key.indexOf('AFFILIATE_AUTH_') === 0) {
        try {
          var record = JSON.parse(allProps[key]);
          // Check if this email matches the internalEmail of this record
          if (record.internalEmail && record.internalEmail.toLowerCase().trim() === normalized) {
            // This email IS stored as someone's internal email
            // The person should use their aliasEmail instead
            Logger.log('Email ' + normalized + ' is stored as internal email for alias: ' + record.aliasEmail);
            return true;
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
    
    return false;
  } catch (e) {
    Logger.log('Error checking internal email: ' + e.message);
    return false;
  }
}

/**
 * Find the alias email for a given internal email
 * @param {string} internalEmail - The internal email to look up
 * @returns {string|null} - The alias email, or null if not found
 */
function findAliasForInternalEmail_(internalEmail) {
  if (!internalEmail) return null;
  var normalized = internalEmail.toLowerCase().trim();
  
  try {
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    
    for (var key in allProps) {
      if (key.indexOf('AFFILIATE_AUTH_') === 0) {
        try {
          var record = JSON.parse(allProps[key]);
          if (record.internalEmail && record.internalEmail.toLowerCase().trim() === normalized) {
            return record.aliasEmail || null;
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
    
    return null;
  } catch (e) {
    Logger.log('Error finding alias for internal email: ' + e.message);
    return null;
  }
}

/**
 * PUBLIC: Check if user is trying to login with internal/legacy email
 * Returns error message if internal email, with hint about their alias
 */
function checkLegacyEmailLogin(email) {
  if (!email) return null;
  var normalized = email.toLowerCase().trim();
  
  // Quick check for % symbol
  if (normalized.indexOf('%') !== -1) {
    // Try to find their alias email to give a helpful hint
    var aliasEmail = findAliasForInternalEmail_(normalized);
    var hint = aliasEmail 
      ? ' Your login email is: ' + aliasEmail
      : ' If you need help finding your login email, contact support.';
    
    return {
      isLegacy: true,
      aliasEmail: aliasEmail,
      error: 'This is an internal system email and cannot be used to login.' + hint
    };
  }
  
  // Check if this is stored as someone's internal email
  if (isStoredAsInternalEmail_(normalized)) {
    var aliasEmail = findAliasForInternalEmail_(normalized);
    var hint = aliasEmail 
      ? ' Your login email is: ' + aliasEmail
      : ' If you need help finding your login email, contact support.';
    
    return {
      isLegacy: true,
      aliasEmail: aliasEmail,
      error: 'This is an internal system email and cannot be used to login.' + hint
    };
  }
  
  return { isLegacy: false };
}

function getAdminOverrideKey_(email) {
  return 'ADMIN_OVERRIDE_' + email.toLowerCase().replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
}

function setAdminOverride_(email, overrideData) {
  try {
    var key = getAdminOverrideKey_(email);
    var dataStr = JSON.stringify(overrideData);
    PropertiesService.getScriptProperties().setProperty(key, dataStr);
    return true;
  } catch(e) {
    console.error('Error setting admin override:', e);
    return false;
  }
}

function getAdminOverride_(email) {
  try {
    var key = getAdminOverrideKey_(email);
    var dataStr = PropertiesService.getScriptProperties().getProperty(key);
    return dataStr ? JSON.parse(dataStr) : null;
  } catch(e) {
    console.error('Error getting admin override:', e);
    return null;
  }
}

/* ---------- Admin "Manage User" Mode ---------- */

/**
 * Start managing a user as admin
 * Admin can view and edit the target user's data while remaining identified as admin
 * 
 * @param {string} adminEmail - The admin's email
 * @param {string} targetEmail - The email of user to manage
 * @returns {object} - { success, targetUser, error }
 */
function adminStartManageUser(adminEmail, targetEmail) {
  try {
    Logger.log('Admin manage user request: admin=' + adminEmail + ', target=' + targetEmail);
    
    // Verify admin
    if (!isAdminEmail_(adminEmail)) {
      Logger.log('Unauthorized: ' + adminEmail + ' is not an admin');
      return { success: false, error: 'Unauthorized - admin access required' };
    }
    
    if (!targetEmail || targetEmail.indexOf('@') === -1) {
      return { success: false, error: 'Valid target email required' };
    }
    
    var normalizedTarget = targetEmail.toLowerCase().trim();
    
    // Resolve target user to canonical identity
    var resolveResult = resolveStudentByEmail_(normalizedTarget);
    
    if (resolveResult.status === 'NOT_FOUND') {
      // Try looking up directly in affiliate system
      var affiliateData = lookupAffiliate(normalizedTarget);
      if (!affiliateData || affiliateData.status === 'Not found') {
        return { success: false, error: 'User not found: ' + normalizedTarget };
      }
      
      // Found in affiliate system
      var targetUser = {
        email: normalizedTarget,
        internalEmail: normalizedTarget,
        affiliateId: affiliateData.affiliateId,
        firstName: affiliateData.firstName || '',
        lastName: affiliateData.lastName || '',
        source: 'affiliate_system'
      };
      
      // Log the action
      logAdminAction_(adminEmail, 'START_MANAGE', normalizedTarget, {});
      
      return {
        success: true,
        targetUser: targetUser
      };
    }
    
    if (resolveResult.status === 'NOT_LINKED') {
      // For admin manage mode, try looking up the email directly in affiliate system
      // This allows admins to manage users by their legacy/internal email
      Logger.log('User not linked in portal, trying affiliate system lookup for: ' + normalizedTarget);
      var affiliateData = lookupAffiliate(normalizedTarget);
      if (affiliateData && affiliateData.status !== 'Not found') {
        // Found in affiliate system - allow admin to manage
        var targetUser = {
          email: normalizedTarget,
          internalEmail: normalizedTarget,
          affiliateId: affiliateData.affiliateId,
          firstName: affiliateData.firstName || '',
          lastName: affiliateData.lastName || '',
          source: 'affiliate_system_legacy'
        };
        
        logAdminAction_(adminEmail, 'START_MANAGE', normalizedTarget, { note: 'legacy_email' });
        
        return {
          success: true,
          targetUser: targetUser
        };
      }
      
      // Not in affiliate system either - genuinely not linked
      return { success: false, error: 'User exists in portal but has no affiliate account linked.' };
    }
    
    // Found via student resolution
    var student = resolveResult.student;
    var targetUser = {
      email: student.aliasEmail || normalizedTarget,
      internalEmail: student.internalEmail || student.canonicalEmail,
      affiliateId: student.affiliateId,
      firstName: student.firstName || '',
      lastName: student.lastName || '',
      source: 'portal_user'
    };
    
    // Log the action
    logAdminAction_(adminEmail, 'START_MANAGE', normalizedTarget, {});
    
    return {
      success: true,
      targetUser: targetUser
    };
    
  } catch (e) {
    Logger.log('Error in adminStartManageUser: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Stop managing a user (return to admin's own view)
 */
function adminStopManageUser(adminEmail, targetEmail) {
  try {
    if (!isAdminEmail_(adminEmail)) {
      return { success: false, error: 'Unauthorized' };
    }
    
    // Log the action
    logAdminAction_(adminEmail, 'STOP_MANAGE', targetEmail, {});
    
    return { success: true };
  } catch (e) {
    Logger.log('Error in adminStopManageUser: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Log admin action for audit trail
 * Stores in an append-only format in PropertiesService
 */
function logAdminAction_(adminEmail, action, targetEmail, details) {
  try {
    var logEntry = {
      timestamp: new Date().toISOString(),
      adminEmail: adminEmail,
      action: action,
      targetEmail: targetEmail,
      details: details || {}
    };
    
    Logger.log('ADMIN AUDIT: ' + JSON.stringify(logEntry));
    
    // Store in PropertiesService (append to array)
    var props = PropertiesService.getScriptProperties();
    var logKey = 'ADMIN_AUDIT_LOG';
    var existingLogs = props.getProperty(logKey);
    var logs = existingLogs ? JSON.parse(existingLogs) : [];
    
    // Keep last 1000 entries to prevent overflow
    logs.push(logEntry);
    if (logs.length > 1000) {
      logs = logs.slice(-1000);
    }
    
    props.setProperty(logKey, JSON.stringify(logs));
    return true;
  } catch (e) {
    Logger.log('Error logging admin action: ' + e.message);
    return false;
  }
}

/**
 * Get admin audit logs (admin only)
 */
function getAdminAuditLogs(adminEmail, limit) {
  try {
    if (!isAdminEmail_(adminEmail)) {
      return { success: false, error: 'Unauthorized' };
    }
    
    var props = PropertiesService.getScriptProperties();
    var logKey = 'ADMIN_AUDIT_LOG';
    var existingLogs = props.getProperty(logKey);
    var logs = existingLogs ? JSON.parse(existingLogs) : [];
    
    // Return most recent first
    logs.reverse();
    
    if (limit && limit > 0) {
      logs = logs.slice(0, limit);
    }
    
    return { success: true, logs: logs };
  } catch (e) {
    Logger.log('Error getting admin audit logs: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Get teacher data with optional admin manage context
 * If managedUserEmail is provided and caller is admin, returns that user's data
 */
function getTeacherDataWithContext(callerEmail, managedUserEmail) {
  try {
    var targetEmail = callerEmail;
    
    // Check if admin is managing another user
    if (managedUserEmail && managedUserEmail !== callerEmail) {
      if (!isAdminEmail_(callerEmail)) {
        return { success: false, error: 'Unauthorized to manage other users' };
      }
      targetEmail = managedUserEmail;
      Logger.log('Admin ' + callerEmail + ' accessing data for: ' + targetEmail);
    }
    
    // Get the teacher data for the target
    return getTeacherData(targetEmail);
  } catch (e) {
    Logger.log('Error in getTeacherDataWithContext: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Add student to teacher with admin manage context
 */
function addStudentToTeacherWithContext(callerEmail, managedUserEmail, studentEmail) {
  try {
    var targetTeacher = callerEmail;
    
    // Check if admin is managing another user
    if (managedUserEmail && managedUserEmail !== callerEmail) {
      if (!isAdminEmail_(callerEmail)) {
        return { success: false, error: 'Unauthorized to manage other users' };
      }
      targetTeacher = managedUserEmail;
      
      // Log the admin action
      logAdminAction_(callerEmail, 'ADD_STUDENT', managedUserEmail, { studentEmail: studentEmail });
    }
    
    // Add the student to the target teacher
    return addStudentToTeacherByEmail(targetTeacher, studentEmail);
  } catch (e) {
    Logger.log('Error in addStudentToTeacherWithContext: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Get student attendance stats with admin manage context
 */
function getStudentAttendanceStatsWithContext(callerEmail, managedUserEmail, studentEmail) {
  try {
    // Check if admin is managing another user
    if (managedUserEmail && managedUserEmail !== callerEmail) {
      if (!isAdminEmail_(callerEmail)) {
        return { success: false, error: 'Unauthorized to manage other users' };
      }
      Logger.log('Admin ' + callerEmail + ' accessing student stats for managed user: ' + managedUserEmail);
    }
    
    // Get the student stats
    return getStudentAttendanceStats(studentEmail);
  } catch (e) {
    Logger.log('Error in getStudentAttendanceStatsWithContext: ' + e.message);
    return { success: false, error: e.message };
  }
}

/* ---------- Email Percentage Parser & Incremental Tracking ---------- */

/**
 * Extracts percentage from email address
 * 
 * Business Rule:
 * - Pattern: name{number}%@domain.com → returns {number}
 * - Examples:
 *   - momo50%@gmail.com → returns 50
 *   - agent20%@domain.com → returns 20
 *   - agent5%@domain.com → returns 5
 *   - test@example.com → returns null (100% - full values)
 * 
 * Edge Cases Handled:
 * - Percentage > 100 (e.g., user150%@...) → clamped to 100
 * - Percentage = 0 (e.g., user0%@...) → clamped to 1 (minimum)
 * - Invalid pattern (e.g., user%50@..., userabc%@...) → returns null (100%)
 * - Missing email → returns null (100%)
 * - The safe fallback is always null (100% - full values)
 * 
 * @param {string} email - The email address to parse
 * @returns {number|null} - The percentage (1-100) or null if no valid pattern found
 */
function extractEmailPercentage_(email) {
  if (!email || typeof email !== 'string') {
    return null;
  }
  
  // Normalize email to lowercase for consistent matching
  var normalizedEmail = email.toLowerCase().trim();
  
  // Match pattern: {anything}{1-3 digits}%@{domain}
  // The pattern must be DIGITS immediately followed by % and then @
  // Examples that MATCH: momo50%@gmail.com, user5%@test.com, agent100%@domain.com
  // Examples that DON'T MATCH: user%50@gmail.com, userabc%@test.com, user50%50@test.com
  var match = normalizedEmail.match(/(\d{1,3})%@/);
  
  if (match && match[1]) {
    var percentage = parseInt(match[1], 10);
    
    // Validate and clamp the percentage to reasonable range
    if (isNaN(percentage)) {
      Logger.log("Email percentage parsing failed (NaN) for: " + email + " - using 100%");
      return null;
    }
    
    // Clamp to valid range: 1-100
    // 0% doesn't make sense (would show $0 always)
    // >100% doesn't make sense either
    if (percentage < 1) {
      Logger.log("Email percentage " + percentage + "% clamped to minimum 1% for: " + email);
      percentage = 1;
    } else if (percentage > 100) {
      Logger.log("Email percentage " + percentage + "% clamped to maximum 100% for: " + email);
      percentage = 100;
    }
    
    Logger.log("Email percentage detected: " + percentage + "% from " + email);
    return percentage;
  }
  
  // No valid percentage pattern found - return null (meaning 100% of values)
  return null;
}

/**
 * Test helper function for email percentage extraction
 * Use this to verify the percentage parsing logic works correctly
 * 
 * @param {string} email - Email to test
 * @returns {object} - Test result with email, extracted percentage, and what will be displayed
 */
function testEmailPercentage(email) {
  var percentage = extractEmailPercentage_(email);
  var effectivePercentage = (percentage === null) ? 100 : percentage;
  
  return {
    email: email,
    extractedPercentage: percentage,
    effectivePercentage: effectivePercentage,
    multiplier: effectivePercentage / 100,
    description: percentage === null 
      ? "No percentage pattern - will show 100% of values" 
      : "Will show " + effectivePercentage + "% of Rewardful values"
  };
}

/**
 * Run comprehensive tests for the email percentage extraction
 * Call this from Apps Script editor to verify the logic
 */
function runEmailPercentageTests() {
  var testCases = [
    // Normal cases
    { email: "test@example.com", expected: null, description: "No percentage pattern" },
    { email: "momo50%@gmail.com", expected: 50, description: "Standard 50%" },
    { email: "agent20%@domain.com", expected: 20, description: "Standard 20%" },
    { email: "agent5%@domain.com", expected: 5, description: "Single digit 5%" },
    { email: "user100%@test.com", expected: 100, description: "Maximum 100%" },
    { email: "trainer1%@test.com", expected: 1, description: "Minimum 1%" },
    
    // Edge cases - clamping
    { email: "user150%@domain.com", expected: 100, description: "Over 100% - clamped to 100" },
    { email: "user0%@domain.com", expected: 1, description: "Zero percent - clamped to 1" },
    { email: "user999%@domain.com", expected: 100, description: "Way over 100% - clamped to 100" },
    
    // Invalid patterns - should return null (100%)
    { email: "user%50@domain.com", expected: null, description: "Percent before digits - invalid" },
    { email: "userabc%@domain.com", expected: null, description: "Letters before percent - invalid" },
    { email: "user50@domain.com", expected: null, description: "No percent sign - invalid" },
    { email: "", expected: null, description: "Empty string" },
    { email: null, expected: null, description: "Null input" },
    
    // Mixed cases
    { email: "MOMO50%@GMAIL.COM", expected: 50, description: "Uppercase email" },
    { email: "  momo50%@gmail.com  ", expected: 50, description: "Email with whitespace" },
    { email: "user50%special@test.com", expected: null, description: "Percent not followed by @" }
  ];
  
  Logger.log("=== EMAIL PERCENTAGE EXTRACTION TEST RESULTS ===");
  Logger.log("");
  
  var passed = 0;
  var failed = 0;
  
  for (var i = 0; i < testCases.length; i++) {
    var tc = testCases[i];
    var result = extractEmailPercentage_(tc.email);
    var success = (result === tc.expected);
    
    if (success) {
      passed++;
      Logger.log("✅ PASS: " + tc.description);
    } else {
      failed++;
      Logger.log("❌ FAIL: " + tc.description);
      Logger.log("   Email: " + tc.email);
      Logger.log("   Expected: " + tc.expected + ", Got: " + result);
    }
  }
  
  Logger.log("");
  Logger.log("=== SUMMARY ===");
  Logger.log("Total tests: " + testCases.length);
  Logger.log("Passed: " + passed);
  Logger.log("Failed: " + failed);
  Logger.log("================");
  
  return {
    total: testCases.length,
    passed: passed,
    failed: failed,
    success: failed === 0
  };
}

/**
 * Gets the storage key for incremental tracking data
 */
function getIncrementalTrackingKey_(email) {
  return 'INCREMENTAL_TRACKING_' + email.toLowerCase().replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Validates that stored tracking baseline matches current email percentage
 * Auto-corrects if mismatch detected
 * Returns: { isValid, correctionApplied, oldPercentage, newPercentage, ... }
 */
function validateAndFixBaselinePercentage_(email, tracking, currentApiUnpaid, currentApiDueNow, currentApiTotalPaid) {
  var currentEmailPercentage = extractEmailPercentage_(email);
  var storedPercentage = tracking.emailBaselinePercentage;
  
  // Normalize null vs 100 (both mean 100%)
  var currentNormalized = (currentEmailPercentage === null || currentEmailPercentage === 100) ? 100 : currentEmailPercentage;
  var storedNormalized = (storedPercentage === null || storedPercentage === 100) ? 100 : storedPercentage;
  
  if (currentNormalized === storedNormalized) {
    return { isValid: true, correctionApplied: false };
  }
  
  // MISMATCH DETECTED - Need to recalculate baseline
  Logger.log("🚨 PERCENTAGE MISMATCH DETECTED!");
  Logger.log("  Email: " + email);
  Logger.log("  Current email percentage: " + currentNormalized + "%");
  Logger.log("  Stored baseline percentage: " + storedNormalized + "%");
  
  // Store old values before correction
  var oldDisplayedUnpaid = tracking.lastDisplayedUnpaid;
  var oldDisplayedDueNow = tracking.lastDisplayedDueNow;
  var oldDisplayedTotalPaid = tracking.lastDisplayedTotalPaid;
  
  // Calculate what the baseline SHOULD be based on current API values and current email percentage
  var correctMultiplier = currentNormalized / 100;
  var correctBaselineUnpaid = round2_(currentApiUnpaid * correctMultiplier);
  var correctBaselineDueNow = round2_(currentApiDueNow * correctMultiplier);
  var correctBaselineTotalPaid = round2_(currentApiTotalPaid * correctMultiplier);
  
  Logger.log("  Current API values: Unpaid $" + currentApiUnpaid + ", Due $" + currentApiDueNow + ", Paid $" + currentApiTotalPaid);
  Logger.log("  Correct baseline should be: Unpaid $" + correctBaselineUnpaid + ", Due $" + correctBaselineDueNow + ", Paid $" + correctBaselineTotalPaid);
  Logger.log("  Currently displaying: Unpaid $" + oldDisplayedUnpaid + ", Due $" + oldDisplayedDueNow + ", Paid $" + oldDisplayedTotalPaid);
  
  // Update tracking with corrected baseline
  tracking.emailBaselinePercentage = currentEmailPercentage; // Store actual value (null if no percentage)
  tracking.lastDisplayedUnpaid = correctBaselineUnpaid;
  tracking.lastDisplayedDueNow = correctBaselineDueNow;
  tracking.lastDisplayedTotalPaid = correctBaselineTotalPaid;
  
  // Keep API tracking current
  tracking.lastApiUnpaid = currentApiUnpaid;
  tracking.lastApiDueNow = currentApiDueNow;
  tracking.lastApiTotalPaid = currentApiTotalPaid;
  
  Logger.log("✅ BASELINE CORRECTED!");
  Logger.log("  New baseline percentage: " + currentNormalized + "%");
  Logger.log("  New displayed values: Unpaid $" + correctBaselineUnpaid + ", Due $" + correctBaselineDueNow + ", Paid $" + correctBaselineTotalPaid);
  
  return {
    isValid: false,
    correctionApplied: true,
    oldPercentage: storedNormalized,
    newPercentage: currentNormalized,
    oldDisplayedUnpaid: oldDisplayedUnpaid,
    oldDisplayedDueNow: oldDisplayedDueNow,
    oldDisplayedTotalPaid: oldDisplayedTotalPaid,
    newDisplayedUnpaid: correctBaselineUnpaid,
    newDisplayedDueNow: correctBaselineDueNow,
    newDisplayedTotalPaid: correctBaselineTotalPaid
  };
}

/**
 * Saves incremental tracking data for an affiliate
 * Data includes: lastApiUnpaid, lastApiDueNow, lastDisplayedUnpaid, lastDisplayedDueNow, 
 *                emailBaselinePercentage, isInitialized, lastUpdateTime
 */
function setIncrementalTracking_(email, trackingData) {
  try {
    var key = getIncrementalTrackingKey_(email);
    trackingData.lastUpdateTime = new Date().toISOString();
    var dataStr = JSON.stringify(trackingData);
    PropertiesService.getScriptProperties().setProperty(key, dataStr);
    Logger.log("Saved incremental tracking for " + email + ": " + dataStr);
    return true;
  } catch(e) {
    Logger.log('Error setting incremental tracking: ' + e);
    return false;
  }
}

/**
 * Retrieves incremental tracking data for an affiliate
 */
function getIncrementalTracking_(email) {
  try {
    var key = getIncrementalTrackingKey_(email);
    var dataStr = PropertiesService.getScriptProperties().getProperty(key);
    if (dataStr) {
      var data = JSON.parse(dataStr);
      Logger.log("Loaded incremental tracking for " + email + ": " + dataStr);
      return data;
    }
    return null;
  } catch(e) {
    Logger.log('Error getting incremental tracking: ' + e);
    return null;
  }
}

/**
 * Deletes incremental tracking data for an affiliate
 */
function deleteIncrementalTracking_(email) {
  try {
    var key = getIncrementalTrackingKey_(email);
    PropertiesService.getScriptProperties().deleteProperty(key);
    Logger.log("Deleted incremental tracking for " + email);
    return true;
  } catch(e) {
    Logger.log('Error deleting incremental tracking: ' + e);
    return false;
  }
}


/* ---------- Open / Menu ---------- */
function onOpen() {
  try {
    // Only create menu if UI is available (not in web app context)
    SpreadsheetApp.getUi()
      .createMenu('Affiliate Manager')
      .addItem('Open Lookup Panel', 'openSidebar_')
      .addToUi();
  } catch(e) {
    // UI not available in this context (e.g., web app deployment)
    Logger.log('UI not available in this context: ' + e.message);
  }
    
  try {
    initializeSheet_();
  } catch(e) {
    // Sheet operations may not be available in web app context
    Logger.log('Sheet initialization skipped: ' + e.message);
  }
}

// Protected pages that require authentication
var PROTECTED_PAGES = ['home', 'commission', 'teacher', 'attendance'];
// Public pages that don't require auth
var PUBLIC_PAGES = ['login', 'set-password', 'test'];

// For web app deployment
function doGet(e) {
  // Debug: Log all parameters
  Logger.log('doGet called with parameters: ' + JSON.stringify(e ? e.parameter : {}));
  
  // Handle routing based on URL parameters
  try {
    // Normalize page parameter (lowercase, trim)
    var rawPage = e && e.parameter && e.parameter.page ? String(e.parameter.page) : '';
    var page = rawPage.toLowerCase().trim();
    
    Logger.log('Requested page: "' + rawPage + '" -> normalized: "' + page + '"');
    
    // If no page specified and root URL, go to login
    if (!page) {
      page = 'login';
    }
    
    var htmlOutput;
    var pageTitle = 'Traders Utopia Portal';
    
    switch(page) {
      case 'login':
        htmlOutput = HtmlService.createHtmlOutputFromFile('Login');
        pageTitle = 'Login - Traders Utopia Portal';
        break;
        
      case 'test':
        htmlOutput = HtmlService.createHtmlOutputFromFile('TestPage');
        pageTitle = 'Test Page - Traders Utopia';
        break;
        
      case 'commission':
        htmlOutput = HtmlService.createHtmlOutputFromFile('CommissionLookup');
        pageTitle = 'Commission Lookup - Traders Utopia';
        break;
        
      case 'teacher':
        htmlOutput = HtmlService.createHtmlOutputFromFile('TeacherPortal');
        pageTitle = 'Teacher Portal - Traders Utopia';
        break;
        
      case 'attendance':
        htmlOutput = HtmlService.createHtmlOutputFromFile('AttendancePortal');
        pageTitle = 'Student Dashboard - Traders Utopia';
        break;
        
      case 'set-password':
      case 'setpassword':
      case 'requestaccess':
        // All these go to SetPassword.html which handles both request access and set password
        htmlOutput = HtmlService.createHtmlOutputFromFile('SetPassword');
        pageTitle = 'Account Setup - Traders Utopia';
        break;
        
      case 'home':
        htmlOutput = HtmlService.createHtmlOutputFromFile('Home');
        pageTitle = 'Dashboard - Traders Utopia Portal';
        break;
        
      default:
        // Unknown page - show not found page
        Logger.log('Unknown page requested: ' + page);
        htmlOutput = renderNotFoundPage_(page);
        pageTitle = 'Page Not Found - Traders Utopia';
        break;
    }
    
    return htmlOutput
      .setTitle(pageTitle)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      
  } catch(err) {
    Logger.log('Error loading page: ' + err.message);
    Logger.log('Stack trace: ' + err.stack);
    // Return error page with details
    return renderErrorPage_(err, e);
  }
}

/**
 * Render a "Page Not Found" page with helpful links
 */
function renderNotFoundPage_(page) {
  var baseUrl = getWebAppUrl();
  
  var html = '<!DOCTYPE html>' +
    '<html><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<style>' +
    'body { font-family: "Segoe UI", Arial, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 20px; }' +
    '.container { background: rgba(255,255,255,0.95); border-radius: 24px; padding: 40px; max-width: 500px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }' +
    '.icon { font-size: 64px; margin-bottom: 20px; }' +
    'h1 { color: #1e293b; margin: 0 0 12px; }' +
    'p { color: #64748b; margin: 0 0 24px; }' +
    '.code { background: #f1f5f9; padding: 8px 16px; border-radius: 8px; font-family: monospace; color: #e94560; display: inline-block; margin-bottom: 24px; }' +
    '.btn { display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #e94560 0%, #ff6b6b 100%); color: white; text-decoration: none; border-radius: 12px; font-weight: 600; transition: transform 0.2s; }' +
    '.btn:hover { transform: translateY(-2px); }' +
    '.debug { margin-top: 24px; padding: 16px; background: #f8fafc; border-radius: 8px; text-align: left; font-size: 12px; color: #64748b; }' +
    '</style>' +
    '</head><body>' +
    '<div class="container">' +
    '<div class="icon">🔍</div>' +
    '<h1>Page Not Found</h1>' +
    '<p>The page you requested doesn\'t exist.</p>' +
    '<div class="code">?page=' + (page || 'unknown') + '</div>' +
    '<br><br>' +
    '<a href="' + baseUrl + '?page=login" class="btn">← Back to Login</a>' +
    '<div class="debug">' +
    '<strong>Debug Info:</strong><br>' +
    'Base URL: ' + baseUrl + '<br>' +
    'Requested: ' + page +
    '</div>' +
    '</div>' +
    '</body></html>';
  
  return HtmlService.createHtmlOutput(html);
}

/**
 * Render an error page with debug info
 */
function renderErrorPage_(err, e) {
  var baseUrl = getWebAppUrl();
  var page = e && e.parameter && e.parameter.page ? e.parameter.page : 'unknown';
  
  var html = '<!DOCTYPE html>' +
    '<html><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<style>' +
    'body { font-family: "Segoe UI", Arial, sans-serif; background: #fef2f2; min-height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 20px; }' +
    '.container { background: white; border-radius: 16px; padding: 40px; max-width: 600px; border-left: 4px solid #dc2626; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }' +
    'h1 { color: #dc2626; margin: 0 0 16px; }' +
    'p { color: #64748b; margin: 0 0 16px; }' +
    'pre { background: #f8fafc; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 12px; }' +
    '.btn { display: inline-block; padding: 12px 24px; background: #64748b; color: white; text-decoration: none; border-radius: 8px; margin-top: 16px; }' +
    '</style>' +
    '</head><body>' +
    '<div class="container">' +
    '<h1>⚠️ Error Loading Page</h1>' +
    '<p><strong>Page requested:</strong> ' + page + '</p>' +
    '<p><strong>Error:</strong> ' + (err.message || 'Unknown error') + '</p>' +
    '<pre>' + (err.stack || 'No stack trace available') + '</pre>' +
    '<a href="' + baseUrl + '?page=login" class="btn">← Back to Login</a>' +
    '</div>' +
    '</body></html>';
  
  return HtmlService.createHtmlOutput(html).setTitle('Error');
}

// ============================================================================
// PUBLIC API FUNCTIONS - Called from client-side (CommissionLookup.Html)
// ============================================================================

/**
 * Public wrapper for fetchByEmail_ (legacy function name)
 * @param {string} email - Affiliate email address
 * @returns {object} - Affiliate commission data
 */
function fetchByEmail(email) {
  return fetchByEmail_(email);
}

/**
 * MAIN COMMISSION LOOKUP FUNCTION
 * 
 * This is the primary function called by the Commission Lookup portal.
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE: TWO DISTINCT PATHS - NEVER MIX THEM
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * PATH A: NORMAL AFFILIATES (no admin percentageEnabled override)
 * ───────────────────────────────────────────────────────────────────────────
 *   1. Fetch FRESH values from Rewardful API
 *   2. Apply email percentage directly (e.g., momo50% → 50% of raw)
 *   3. Return values - DONE
 *   → NO incremental tracking, NO caching, NO stored baselines
 * 
 * PATH B: ADMIN-CONFIGURED AFFILIATES (percentageEnabled = true)
 * ───────────────────────────────────────────────────────────────────────────
 *   DEFINITIONS:
 *     - Rewardful total = raw values from API
 *     - Email percentage = % in email (e.g., momo50% → 50%)
 *     - User's cut = Rewardful total × (email percentage / 100)
 *     - Admin multiplier = % applied to FUTURE CHANGES only
 * 
 *   CRITICAL RULES:
 *     1. On FIRST lookup when admin enables multiplier:
 *        - Calculate user's cut (raw × email %)
 *        - Use this as BASELINE - DO NOT apply admin % yet!
 *        - Store baseline for future tracking
 * 
 *     2. On SUBSEQUENT lookups:
 *        - new_user_cut = new_rewardful_total × email_percentage
 *        - delta = new_user_cut - baseline_user_cut
 *        - adjusted_delta = delta × admin_multiplier  ← Admin % ONLY on delta!
 *        - displayed = baseline + adjusted_delta
 *        - Update baseline for next lookup
 * 
 *     3. GUARANTEE: Admin multiplier NEVER shrinks/inflates the existing cut
 *        immediately. It only affects future earnings.
 * 
 * EXAMPLE (admin multiplier = 50%, email percentage = 100%):
 *   Day 1: Rewardful = $1000 → User's cut = $1000 → Displayed = $1000 (baseline)
 *   Day 2: Rewardful = $1200 → User's cut = $1200
 *          Delta = $200, Adjusted = $100 → Displayed = $1000 + $100 = $1100
 * 
 * BUSINESS RULE - Email Percentage (applies to ALL affiliates):
 * - If email contains percentage before @ (e.g., momo50%@gmail.com):
 *   → For PATH A: Display that percentage of raw API values
 *   → For PATH B: User's cut is calculated with email %, then tracked
 * - If no percentage pattern: display 100%
 * - Percentage clamped to 1-100
 * 
 * @param {string} email - The affiliate's email address (can be alias or rewardful)
 * @returns {object} - Commission data with all adjustments applied
 */
function lookupAffiliate(email) {
  // DUAL EMAIL SYSTEM: If given an alias email, look up the rewardful email
  var rewardfulEmail = getRewardfulEmailForLookup_(email);
  if (rewardfulEmail !== email) {
    Logger.log('lookupAffiliate: Resolved alias ' + email + ' -> rewardful ' + rewardfulEmail);
  }
  return lookupAffiliateByRewardfulEmail_(rewardfulEmail);
}

/**
 * Get the rewardful_email for a given email (alias or rewardful)
 * If the email is an alias with a mapped rewardful_email, returns that.
 * Otherwise returns the original email.
 */
function getRewardfulEmailForLookup_(email) {
  var normalized = normalizeAuthEmail_(email);
  if (!normalized) return email;
  
  // Check if this email has a rewardful_email/internalEmail mapping
  var record = getAuthRecord_(normalized);
  if (record) {
    // Check multiple possible field names for the internal email
    var internalEmail = record.rewardfulEmail || record.internalEmail || record.rewardful_email;
    if (internalEmail) {
      Logger.log('Resolved alias to internal email: ' + normalized + ' -> ' + internalEmail);
      return internalEmail;
    }
  }
  
  // No mapping found - use the email as-is (might be rewardful email already)
  return normalized;
}

/**
 * PUBLIC: Get the rewardful email for displaying in admin UI
 * (But never show this to regular users!)
 */
function getRewardfulEmailForAdmin(aliasEmail) {
  if (!isAdmin_()) {
    return { success: false, error: 'Admin only' };
  }
  
  var rewardfulEmail = getRewardfulEmailForLookup_(aliasEmail);
  return { 
    success: true, 
    aliasEmail: aliasEmail,
    rewardfulEmail: rewardfulEmail
  };
}

/**
 * INTERNAL: Lookup affiliate using the rewardful email
 * This is the actual lookup logic - always uses rewardful email
 * 
 * @param {string} rewardfulEmail - The affiliate's Rewardful email address
 * @returns {object} - Commission data with all adjustments applied
 */
function lookupAffiliateByRewardfulEmail_(rewardfulEmail) {
  // NOTE: rewardfulEmail is the INTERNAL email (may contain % encoding)
  // This is what we use for Rewardful API calls
  var email = rewardfulEmail; // Use 'email' internally for compatibility with existing code
  
  try {
    Logger.log("=== LOOKUP AFFILIATE (by Rewardful Email) ===");
    Logger.log("Rewardful Email: " + email);
    
    // Validate input
    if (!email || typeof email !== 'string' || email.indexOf('@') === -1) {
      throw new Error('Invalid email address provided.');
    }
    
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) throw new Error('Missing AFFILIATE_API_KEY in Script properties.');
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: EXTRACT EMAIL PERCENTAGE (from rewardful email - this is where % is encoded)
    // ═══════════════════════════════════════════════════════════════════════
    var emailPercentage = extractEmailPercentage_(email);
    var emailPct = (emailPercentage === null) ? 100 : emailPercentage;
    var emailMultiplier = emailPct / 100;
    
    Logger.log("Email percentage: " + emailPct + "%");
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: FETCH FRESH DATA FROM REWARDFUL API (using rewardful email)
    // ═══════════════════════════════════════════════════════════════════════
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp) throw new Error('No response from affiliate API');
    
    var code = affResp.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('Affiliate lookup failed (HTTP ' + code + ')');
    }
    
    var payload = safeParseJson_(affResp.getContentText());
    if (!payload) throw new Error('Invalid JSON response from API');
    
    var aff = extractAffiliate_(payload);
    if (!aff || !aff.id) {
      return { 
        status: 'Not found', 
        affiliateId: '', 
        unpaidAmount: 0, 
        dueNow: 0, 
        totalPaid: 0,
        approvedCommission: 0, 
        lastPayout: '' 
      };
    }
    
    Logger.log("Affiliate ID: " + aff.id);
    
    // Fetch expanded data with commission_stats
    var rawUnpaid = 0, rawDueNow = 0, rawTotalPaid = 0;
    var lastPayoutAt = '';
    var dataSource = 'unknown';
    
    var affByIdUrl = BASE_URL + '/affiliates/' + aff.id + '?expand=true';
    var affByIdResp = fetchWithRetry_(affByIdUrl, apiKey);
    
    if (affByIdResp && affByIdResp.getResponseCode() === 200) {
      var expandedPayload = safeParseJson_(affByIdResp.getContentText());
      var expandedAff = extractAffiliate_(expandedPayload);
      
      if (expandedAff && expandedAff.commission_stats && expandedAff.commission_stats.currencies) {
        var currencies = expandedAff.commission_stats.currencies;
        var currData = currencies['CAD'] || currencies['USD'] || currencies[Object.keys(currencies)[0]];
        var currCode = currencies['CAD'] ? 'CAD' : (currencies['USD'] ? 'USD' : Object.keys(currencies)[0]);
        
        if (currData) {
          if (currData.unpaid && currData.unpaid.cents !== undefined) {
            rawUnpaid = Number(currData.unpaid.cents) / 100;
            if (currCode === 'USD' && CURRENCY === 'CAD') rawUnpaid *= USD_TO_CAD_RATE;
          }
          if (currData.due && currData.due.cents !== undefined) {
            rawDueNow = Number(currData.due.cents) / 100;
            if (currCode === 'USD' && CURRENCY === 'CAD') rawDueNow *= USD_TO_CAD_RATE;
          }
          if (currData.paid && currData.paid.cents !== undefined) {
            rawTotalPaid = Number(currData.paid.cents) / 100;
            if (currCode === 'USD' && CURRENCY === 'CAD') rawTotalPaid *= USD_TO_CAD_RATE;
          }
          dataSource = 'commission_stats.' + currCode;
        }
      }
    }
    
    // Fallback to calculated values
    if (dataSource === 'unknown') {
      var totals = sumDueNowForAffiliate_(aff.id, apiKey);
      rawUnpaid = totals.unpaid;
      rawDueNow = totals.dueNow;
      rawTotalPaid = totals.paid;
      lastPayoutAt = totals.lastPayoutAt || '';
      dataSource = 'calculated';
    }
    
    rawUnpaid = round2_(rawUnpaid);
    rawDueNow = round2_(rawDueNow);
    rawTotalPaid = round2_(rawTotalPaid);
    
    Logger.log("RAW API (100%): Unpaid=$" + rawUnpaid + ", Due=$" + rawDueNow + ", Paid=$" + rawTotalPaid);
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: CHECK IF ADMIN OVERRIDE WITH PERCENTAGE MULTIPLIER IS ENABLED
    // ═══════════════════════════════════════════════════════════════════════
    var override = getAdminOverride_(email);
    var useIncrementalTracking = override && 
                                  override.percentageEnabled === true && 
                                  override.percentageMultiplier !== undefined &&
                                  override.percentageMultiplier !== null &&
                                  override.percentageMultiplier !== 100;
    
    var baseUnpaid, baseDueNow, baseTotalPaid;
    var displayedUnpaid, displayedDueNow, displayedTotalPaid;
    var mode;
    
    if (useIncrementalTracking) {
      // ═════════════════════════════════════════════════════════════════════════
      // PATH B: ADMIN-CONFIGURED AFFILIATE - INCREMENTAL TRACKING ON USER'S CUT
      // ═════════════════════════════════════════════════════════════════════════
      //
      // CRITICAL: The percentage multiplier is applied to FUTURE CHANGES only,
      // NOT to the current cut retroactively!
      //
      // Definitions:
      //   - Rewardful total = raw values from API
      //   - Email percentage = % in email (e.g., momo50% → 50%)
      //   - User's cut = Rewardful total × (email percentage / 100)
      //   - Admin multiplier = percentage to apply to FUTURE changes only
      //
      // Rules:
      //   1. On FIRST lookup: User's cut becomes the BASELINE (no admin % applied yet!)
      //   2. On SUBSEQUENT lookups:
      //      - new_user_cut = new_rewardful_total × email_percentage
      //      - delta = new_user_cut - baseline_user_cut
      //      - adjusted_delta = delta × admin_multiplier
      //      - displayed = baseline + adjusted_delta
      //   3. The admin multiplier NEVER shrinks/inflates the existing cut immediately
      //
      // ═════════════════════════════════════════════════════════════════════════
      mode = 'admin_incremental';
      var adminPct = override.percentageMultiplier;
      var adminMultiplier = adminPct / 100;
      
      Logger.log("=== PATH B: ADMIN INCREMENTAL TRACKING (on user's cut) ===");
      Logger.log("Email percentage: " + emailPct + "%");
      Logger.log("Admin percentage multiplier: " + adminPct + "% (applies to FUTURE CHANGES only)");
      
      // FIRST: Calculate the USER'S CUT (Rewardful × email percentage)
      // This is the value BEFORE any admin percentage is applied
      var currentUserCutUnpaid = round2_(rawUnpaid * emailMultiplier);
      var currentUserCutDueNow = round2_(rawDueNow * emailMultiplier);
      var currentUserCutTotalPaid = round2_(rawTotalPaid * emailMultiplier);
      
      Logger.log("Current user's cut (raw × " + emailPct + "%): Unpaid=$" + currentUserCutUnpaid + 
                 ", Due=$" + currentUserCutDueNow + ", Paid=$" + currentUserCutTotalPaid);
      
      // Get or initialize tracking data
      var tracking = getIncrementalTracking_(email);
      
      if (!tracking || !tracking.isInitialized) {
        // ═══════════════════════════════════════════════════════════════════════
        // FIRST LOOKUP - Initialize baseline with current user's cut
        // CRITICAL: Do NOT apply admin percentage yet! Just store current cut.
        // ═══════════════════════════════════════════════════════════════════════
        Logger.log("⭐ FIRST LOOKUP - Initializing baseline with current user's cut");
        Logger.log("   Admin multiplier will apply to FUTURE changes only, not this baseline");
        
        // Baseline = current user's cut (email % already applied, admin % NOT applied)
        baseUnpaid = currentUserCutUnpaid;
        baseDueNow = currentUserCutDueNow;
        baseTotalPaid = currentUserCutTotalPaid;
        
        tracking = {
          isInitialized: true,
          emailPercentage: emailPct,
          adminPercentage: adminPct,
          // Track the USER'S CUT values, not raw API values
          lastUserCutUnpaid: currentUserCutUnpaid,
          lastUserCutDueNow: currentUserCutDueNow,
          lastUserCutTotalPaid: currentUserCutTotalPaid,
          // Displayed = baseline (no admin multiplier on first lookup!)
          lastDisplayedUnpaid: baseUnpaid,
          lastDisplayedDueNow: baseDueNow,
          lastDisplayedTotalPaid: baseTotalPaid
        };
        setIncrementalTracking_(email, tracking);
        
        Logger.log("✅ Baseline stored: Unpaid=$" + baseUnpaid + ", Due=$" + baseDueNow + ", Paid=$" + baseTotalPaid);
        Logger.log("   (Admin " + adminPct + "% will apply to changes AFTER this point)");
        
      } else {
        // ═══════════════════════════════════════════════════════════════════════
        // SUBSEQUENT LOOKUP - Apply admin percentage to CHANGES only
        // ═══════════════════════════════════════════════════════════════════════
        Logger.log("📊 SUBSEQUENT LOOKUP - Calculating deltas");
        
        // Check if email percentage changed (shouldn't happen, but handle it)
        var emailPctChanged = (tracking.emailPercentage !== emailPct);
        // Check if admin percentage changed
        var adminPctChanged = (tracking.adminPercentage !== adminPct);
        
        if (emailPctChanged) {
          // Email percentage changed - need to recalculate baseline from scratch
          Logger.log("⚠️ Email percentage changed from " + tracking.emailPercentage + "% to " + emailPct + "% - reinitializing baseline");
          
          baseUnpaid = currentUserCutUnpaid;
          baseDueNow = currentUserCutDueNow;
          baseTotalPaid = currentUserCutTotalPaid;
          
          tracking = {
            isInitialized: true,
            emailPercentage: emailPct,
            adminPercentage: adminPct,
            lastUserCutUnpaid: currentUserCutUnpaid,
            lastUserCutDueNow: currentUserCutDueNow,
            lastUserCutTotalPaid: currentUserCutTotalPaid,
            lastDisplayedUnpaid: baseUnpaid,
            lastDisplayedDueNow: baseDueNow,
            lastDisplayedTotalPaid: baseTotalPaid
          };
          setIncrementalTracking_(email, tracking);
          
        } else if (adminPctChanged) {
          // Admin percentage changed - DO NOT recalculate baseline!
          // Keep current displayed values as the new baseline, update admin %
          Logger.log("⚠️ Admin percentage changed from " + tracking.adminPercentage + "% to " + adminPct + "%");
          Logger.log("   Keeping current displayed values, new % applies to future changes only");
          
          // Keep existing displayed values as baseline
          baseUnpaid = tracking.lastDisplayedUnpaid || currentUserCutUnpaid;
          baseDueNow = tracking.lastDisplayedDueNow || currentUserCutDueNow;
          baseTotalPaid = tracking.lastDisplayedTotalPaid || currentUserCutTotalPaid;
          
          // Update tracking with new admin percentage but keep displayed values
          tracking.adminPercentage = adminPct;
          tracking.lastUserCutUnpaid = currentUserCutUnpaid;
          tracking.lastUserCutDueNow = currentUserCutDueNow;
          tracking.lastUserCutTotalPaid = currentUserCutTotalPaid;
          setIncrementalTracking_(email, tracking);
          
        } else {
          // Normal case: Calculate deltas in USER'S CUT (not raw API values!)
          var deltaUnpaid = currentUserCutUnpaid - (tracking.lastUserCutUnpaid || 0);
          var deltaDueNow = currentUserCutDueNow - (tracking.lastUserCutDueNow || 0);
          var deltaTotalPaid = currentUserCutTotalPaid - (tracking.lastUserCutTotalPaid || 0);
          
          Logger.log("Delta in user's cut: Unpaid=" + deltaUnpaid + ", Due=" + deltaDueNow + ", Paid=" + deltaTotalPaid);
          
          // Apply admin percentage to deltas ONLY (not to baseline!)
          var adjustedDeltaUnpaid = round2_(deltaUnpaid * adminMultiplier);
          var adjustedDeltaDueNow = round2_(deltaDueNow * adminMultiplier);
          var adjustedDeltaTotalPaid = round2_(deltaTotalPaid * adminMultiplier);
          
          Logger.log("Adjusted deltas (× " + adminPct + "%): Unpaid=" + adjustedDeltaUnpaid + 
                     ", Due=" + adjustedDeltaDueNow + ", Paid=" + adjustedDeltaTotalPaid);
          
          // Calculate new displayed values: baseline + adjusted_delta
          baseUnpaid = round2_((tracking.lastDisplayedUnpaid || 0) + adjustedDeltaUnpaid);
          baseDueNow = round2_((tracking.lastDisplayedDueNow || 0) + adjustedDeltaDueNow);
          baseTotalPaid = round2_((tracking.lastDisplayedTotalPaid || 0) + adjustedDeltaTotalPaid);
          
          // Clamp to zero (can't have negative values)
          if (baseUnpaid < 0) baseUnpaid = 0;
          if (baseDueNow < 0) baseDueNow = 0;
          if (baseTotalPaid < 0) baseTotalPaid = 0;
          
          Logger.log("New displayed values: Unpaid=$" + baseUnpaid + ", Due=$" + baseDueNow + ", Paid=$" + baseTotalPaid);
          
          // Update tracking
          tracking.lastUserCutUnpaid = currentUserCutUnpaid;
          tracking.lastUserCutDueNow = currentUserCutDueNow;
          tracking.lastUserCutTotalPaid = currentUserCutTotalPaid;
          tracking.lastDisplayedUnpaid = baseUnpaid;
          tracking.lastDisplayedDueNow = baseDueNow;
          tracking.lastDisplayedTotalPaid = baseTotalPaid;
          setIncrementalTracking_(email, tracking);
        }
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // CRITICAL: For PATH B, email percentage is ALREADY incorporated into the
      // tracked values (user's cut). We set these as the FINAL displayed values
      // to prevent double-application of email percentage in STEP 4!
      // ═══════════════════════════════════════════════════════════════════════════
      displayedUnpaid = baseUnpaid;
      displayedDueNow = baseDueNow;
      displayedTotalPaid = baseTotalPaid;
      
      // Flag to skip STEP 4 (email percentage already applied)
      var skipEmailPercentageStep = true;
      
    } else {
      // ═════════════════════════════════════════════════════════════════════
      // PATH A: NORMAL AFFILIATE - SIMPLE DIRECT CALCULATION
      // ═════════════════════════════════════════════════════════════════════
      mode = 'simple';
      Logger.log("=== PATH A: SIMPLE DIRECT CALCULATION ===");
      
      // Base values are simply the raw API values (no tracking, no stored state)
      baseUnpaid = rawUnpaid;
      baseDueNow = rawDueNow;
      baseTotalPaid = rawTotalPaid;
      
      // ═════════════════════════════════════════════════════════════════════
      // STEP 4 (PATH A ONLY): APPLY EMAIL PERCENTAGE
      // For PATH A, we apply email percentage here.
      // For PATH B, email percentage is ALREADY in the tracked user's cut values.
      // ═════════════════════════════════════════════════════════════════════
      displayedUnpaid = round2_(baseUnpaid * emailMultiplier);
      displayedDueNow = round2_(baseDueNow * emailMultiplier);
      displayedTotalPaid = round2_(baseTotalPaid * emailMultiplier);
      
      Logger.log("FINAL DISPLAYED (" + emailPct + "% of base): Unpaid=$" + displayedUnpaid + ", Due=$" + displayedDueNow + ", Paid=$" + displayedTotalPaid);
    }
    
    // NOTE: displayedUnpaid/DueNow/TotalPaid are now set by either:
    //   - PATH B: Already includes email percentage (from user's cut tracking)
    //   - PATH A: Applied email percentage above
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: APPLY STATIC ADMIN OVERRIDES (if any exist)
    // ═══════════════════════════════════════════════════════════════════════
    if (override) {
      // These are absolute value overrides (different from percentage multiplier)
      if (override.unpaidAmount !== undefined && override.unpaidAmount !== null) {
        displayedUnpaid = override.unpaidAmount;
        Logger.log("Static override unpaid: $" + displayedUnpaid);
      }
      if (override.dueNow !== undefined && override.dueNow !== null) {
        displayedDueNow = override.dueNow;
        Logger.log("Static override due: $" + displayedDueNow);
      }
      if (override.totalPaid !== undefined && override.totalPaid !== null) {
        displayedTotalPaid = override.totalPaid;
        Logger.log("Static override paid: $" + displayedTotalPaid);
      }
      if (override.lastPayout) lastPayoutAt = override.lastPayout;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: BUILD AND RETURN RESULT
    // ═══════════════════════════════════════════════════════════════════════
    var result = {
      affiliateId: aff.id,
      unpaidAmount: displayedUnpaid,
      dueNow: displayedDueNow,
      totalPaid: displayedTotalPaid,
      approvedCommission: round2_(displayedTotalPaid + displayedDueNow),
      lastPayout: lastPayoutAt,
      status: firstNotEmpty_((override && override.status) || '', aff.status, aff.state, 'active'),
      _mode: mode,
      _emailPercentage: emailPct,
      _dataSource: dataSource,
      _rawValues: { unpaid: rawUnpaid, dueNow: rawDueNow, totalPaid: rawTotalPaid }
    };
    
    if (override) {
      result._admin_override = override;
      if (useIncrementalTracking) {
        result._adminPercentage = override.percentageMultiplier;
        result._tracking = 'enabled';
      }
    }
    
    Logger.log("=== LOOKUP COMPLETE (mode: " + mode + ") ===");
    return result;
    
  } catch(e) {
    Logger.log("lookupAffiliate error: " + e.message);
    return { 
      status: 'Error', 
      error: e.message,
      affiliateId: '',
      unpaidAmount: 0,
      dueNow: 0,
      totalPaid: 0,
      approvedCommission: 0,
      lastPayout: '',
      _debug_http: 'Error: ' + e.message
    };
  }
}

/**
 * LEGACY FUNCTION: Original lookupAffiliate implementation
 * 
 * NOTE: The main lookupAffiliate() now handles both:
 * - Simple direct calculation (for normal users)
 * - Incremental tracking (only for admin-configured affiliates with percentageEnabled=true)
 * 
 * This function is kept only for backward compatibility with old code that
 * might call fetchByEmail_() directly. New code should use lookupAffiliate().
 */
function lookupAffiliateWithTracking(email) {
  // Just redirect to the new unified function
  return lookupAffiliate(email);
}

/**
 * ADMIN: Clear ALL incremental tracking data for ALL affiliates
 * 
 * The incremental tracking system was causing drift and incorrect values.
 * This function clears all tracking data so the system uses fresh API values.
 * 
 * With the new simple lookupAffiliate(), tracking data is no longer used,
 * but clearing it ensures a clean slate.
 */
function clearAllIncrementalTrackingData() {
  if (!isAdmin_()) {
    return { success: false, error: "Unauthorized - admin only" };
  }
  
  Logger.log("=== CLEARING ALL INCREMENTAL TRACKING DATA ===");
  
  try {
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var trackingKeys = [];
    
    // Find all tracking properties
    for (var key in allProps) {
      if (key.indexOf('INCREMENTAL_TRACKING_') === 0) {
        trackingKeys.push(key);
      }
    }
    
    Logger.log("Found " + trackingKeys.length + " tracking entries to delete");
    
    // Delete each tracking entry
    for (var i = 0; i < trackingKeys.length; i++) {
      props.deleteProperty(trackingKeys[i]);
      Logger.log("Deleted: " + trackingKeys[i]);
    }
    
    Logger.log("=== ALL TRACKING DATA CLEARED ===");
    
    return {
      success: true,
      message: "Cleared " + trackingKeys.length + " tracking entries",
      deletedCount: trackingKeys.length
    };
    
  } catch(e) {
    Logger.log("Error clearing tracking data: " + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Verify an affiliate's displayed values match expected calculation
 * Use this to confirm the fix is working correctly
 * 
 * @param {string} email - Email to verify
 * @returns {object} - Verification results
 */
function verifyAffiliateValues(email) {
  Logger.log("=== VERIFYING AFFILIATE: " + email + " ===");
  
  // Get the lookup result (new simple method)
  var lookupResult = lookupAffiliate(email);
  
  if (lookupResult.status === 'Not found' || lookupResult.status === 'Error') {
    return {
      email: email,
      status: lookupResult.status,
      error: lookupResult.error || 'Affiliate not found'
    };
  }
  
  // Calculate expected values
  var percentage = extractEmailPercentage_(email);
  var effectivePercentage = (percentage === null) ? 100 : percentage;
  var multiplier = effectivePercentage / 100;
  
  var expectedUnpaid = round2_(lookupResult._rawValues.unpaid * multiplier);
  var expectedDueNow = round2_(lookupResult._rawValues.dueNow * multiplier);
  var expectedTotalPaid = round2_(lookupResult._rawValues.totalPaid * multiplier);
  
  // Compare
  var unpaidMatch = Math.abs(lookupResult.unpaidAmount - expectedUnpaid) < 0.01;
  var dueNowMatch = Math.abs(lookupResult.dueNow - expectedDueNow) < 0.01;
  var totalPaidMatch = Math.abs(lookupResult.totalPaid - expectedTotalPaid) < 0.01;
  
  var allCorrect = unpaidMatch && dueNowMatch && totalPaidMatch;
  
  var result = {
    email: email,
    verified: allCorrect,
    emailPercentage: effectivePercentage,
    rawValues: lookupResult._rawValues,
    expectedDisplayed: {
      unpaid: expectedUnpaid,
      dueNow: expectedDueNow,
      totalPaid: expectedTotalPaid
    },
    actualDisplayed: {
      unpaid: lookupResult.unpaidAmount,
      dueNow: lookupResult.dueNow,
      totalPaid: lookupResult.totalPaid
    },
    matches: {
      unpaid: unpaidMatch,
      dueNow: dueNowMatch,
      totalPaid: totalPaidMatch
    }
  };
  
  if (allCorrect) {
    Logger.log("✅ VERIFICATION PASSED - All values correct!");
  } else {
    Logger.log("❌ VERIFICATION FAILED - Values don't match expected!");
    if (!unpaidMatch) Logger.log("   Unpaid: expected $" + expectedUnpaid + ", got $" + lookupResult.unpaidAmount);
    if (!dueNowMatch) Logger.log("   Due Now: expected $" + expectedDueNow + ", got $" + lookupResult.dueNow);
    if (!totalPaidMatch) Logger.log("   Total Paid: expected $" + expectedTotalPaid + ", got $" + lookupResult.totalPaid);
  }
  
  return result;
}

/**
 * Test helper: Calculate commission values with percentage applied
 * Use this to verify what values should be displayed for a given email
 * 
 * @param {string} email - Email to test
 * @param {number} rawUnpaid - Raw unpaid amount from Rewardful (100%)
 * @param {number} rawDueNow - Raw due now amount from Rewardful (100%)
 * @param {number} rawTotalPaid - Raw total paid amount from Rewardful (100%)
 * @returns {object} - Calculated display values
 */
function calculateDisplayValues(email, rawUnpaid, rawDueNow, rawTotalPaid) {
  var percentage = extractEmailPercentage_(email);
  var effectivePercentage = (percentage === null) ? 100 : percentage;
  var multiplier = effectivePercentage / 100;
  
  return {
    email: email,
    extractedPercentage: percentage,
    effectivePercentage: effectivePercentage,
    rawValues: {
      unpaid: rawUnpaid,
      dueNow: rawDueNow,
      totalPaid: rawTotalPaid
    },
    displayedValues: {
      unpaid: round2_(rawUnpaid * multiplier),
      dueNow: round2_(rawDueNow * multiplier),
      totalPaid: round2_(rawTotalPaid * multiplier)
    },
    explanation: "Raw values × " + effectivePercentage + "% = Displayed values"
  };
}

/**
 * Run comprehensive test of the commission calculation logic
 * Call from Apps Script editor to verify end-to-end percentage handling
 */
function runCommissionCalculationTests() {
  var testCases = [
    { email: "test@example.com", rawUnpaid: 1000, rawDueNow: 500, rawPaid: 2000, 
      expectedUnpaid: 1000, expectedDueNow: 500, expectedPaid: 2000, 
      description: "No percentage - show 100%" },
    
    { email: "momo50%@gmail.com", rawUnpaid: 1000, rawDueNow: 500, rawPaid: 2000, 
      expectedUnpaid: 500, expectedDueNow: 250, expectedPaid: 1000, 
      description: "50% email - show half" },
    
    { email: "agent20%@domain.com", rawUnpaid: 1000, rawDueNow: 500, rawPaid: 2000, 
      expectedUnpaid: 200, expectedDueNow: 100, expectedPaid: 400, 
      description: "20% email - show 20%" },
    
    { email: "trainer5%@test.com", rawUnpaid: 1000, rawDueNow: 500, rawPaid: 2000, 
      expectedUnpaid: 50, expectedDueNow: 25, expectedPaid: 100, 
      description: "5% email - show 5%" },
    
    { email: "user100%@test.com", rawUnpaid: 1000, rawDueNow: 500, rawPaid: 2000, 
      expectedUnpaid: 1000, expectedDueNow: 500, expectedPaid: 2000, 
      description: "100% email - show full" },
    
    { email: "user150%@test.com", rawUnpaid: 1000, rawDueNow: 500, rawPaid: 2000, 
      expectedUnpaid: 1000, expectedDueNow: 500, expectedPaid: 2000, 
      description: "150% email - clamped to 100%" },
    
    { email: "user0%@test.com", rawUnpaid: 1000, rawDueNow: 500, rawPaid: 2000, 
      expectedUnpaid: 10, expectedDueNow: 5, expectedPaid: 20, 
      description: "0% email - clamped to 1%" }
  ];
  
  Logger.log("=== COMMISSION CALCULATION TEST RESULTS ===");
  Logger.log("");
  
  var passed = 0;
  var failed = 0;
  
  for (var i = 0; i < testCases.length; i++) {
    var tc = testCases[i];
    var result = calculateDisplayValues(tc.email, tc.rawUnpaid, tc.rawDueNow, tc.rawPaid);
    
    var unpaidMatch = Math.abs(result.displayedValues.unpaid - tc.expectedUnpaid) < 0.01;
    var dueNowMatch = Math.abs(result.displayedValues.dueNow - tc.expectedDueNow) < 0.01;
    var paidMatch = Math.abs(result.displayedValues.totalPaid - tc.expectedPaid) < 0.01;
    
    var success = unpaidMatch && dueNowMatch && paidMatch;
    
    if (success) {
      passed++;
      Logger.log("✅ PASS: " + tc.description);
      Logger.log("   Email: " + tc.email + " → " + result.effectivePercentage + "%");
      Logger.log("   Displayed: $" + result.displayedValues.unpaid + " unpaid, $" + 
                 result.displayedValues.dueNow + " due, $" + result.displayedValues.totalPaid + " paid");
    } else {
      failed++;
      Logger.log("❌ FAIL: " + tc.description);
      Logger.log("   Email: " + tc.email);
      Logger.log("   Expected: $" + tc.expectedUnpaid + " unpaid, $" + tc.expectedDueNow + " due, $" + tc.expectedPaid + " paid");
      Logger.log("   Got: $" + result.displayedValues.unpaid + " unpaid, $" + 
                 result.displayedValues.dueNow + " due, $" + result.displayedValues.totalPaid + " paid");
    }
    Logger.log("");
  }
  
  Logger.log("=== SUMMARY ===");
  Logger.log("Total tests: " + testCases.length);
  Logger.log("Passed: " + passed);
  Logger.log("Failed: " + failed);
  Logger.log("================");
  
  return {
    total: testCases.length,
    passed: passed,
    failed: failed,
    success: failed === 0
  };
}

/**
 * TEST: Verify incremental tracking behavior for admin percentage multiplier
 * 
 * This test demonstrates the CORRECT behavior:
 * 1. Admin percentage multiplier is NOT applied to current cut immediately
 * 2. It is ONLY applied to FUTURE CHANGES in the user's cut
 * 3. The user's cut used for tracking is always AFTER email percentage
 * 
 * Run this from the Apps Script editor to verify the implementation.
 */
function testIncrementalTrackingBehavior() {
  Logger.log("═══════════════════════════════════════════════════════════════════════");
  Logger.log("TEST: INCREMENTAL TRACKING BEHAVIOR FOR ADMIN PERCENTAGE MULTIPLIER");
  Logger.log("═══════════════════════════════════════════════════════════════════════");
  Logger.log("");
  
  Logger.log("EXPECTED BEHAVIOR:");
  Logger.log("  1. When admin enables percentage multiplier (e.g., 50%):");
  Logger.log("     - Current user's cut becomes the BASELINE");
  Logger.log("     - Admin % is NOT applied to baseline (no immediate shrink/inflate)");
  Logger.log("");
  Logger.log("  2. On SUBSEQUENT changes in Rewardful totals:");
  Logger.log("     - new_user_cut = raw × email_percentage");
  Logger.log("     - delta = new_user_cut - baseline_user_cut");
  Logger.log("     - adjusted_delta = delta × admin_multiplier  ← Only applied to change!");
  Logger.log("     - displayed = baseline + adjusted_delta");
  Logger.log("");
  
  Logger.log("═══════════════════════════════════════════════════════════════════════");
  Logger.log("WALKTHROUGH EXAMPLE (admin=50%, email=100%):");
  Logger.log("═══════════════════════════════════════════════════════════════════════");
  Logger.log("");
  Logger.log("Day 1: Rewardful reports $1000 total paid");
  Logger.log("  → User's cut = $1000 × 100% = $1000");
  Logger.log("  → Admin enables 50% multiplier");
  Logger.log("  → Displayed = $1000 (BASELINE, no multiplier applied yet!)");
  Logger.log("");
  Logger.log("Day 2: Rewardful reports $1200 total paid (increased by $200)");
  Logger.log("  → User's cut = $1200 × 100% = $1200");
  Logger.log("  → Delta = $1200 - $1000 = $200 (change since baseline)");
  Logger.log("  → Adjusted delta = $200 × 50% = $100");
  Logger.log("  → Displayed = $1000 + $100 = $1100");
  Logger.log("");
  Logger.log("Day 3: Rewardful reports $1500 total paid (increased by $300)");
  Logger.log("  → User's cut = $1500 × 100% = $1500");
  Logger.log("  → Delta = $1500 - $1200 = $300 (change since last)");
  Logger.log("  → Adjusted delta = $300 × 50% = $150");
  Logger.log("  → Displayed = $1100 + $150 = $1250");
  Logger.log("");
  
  Logger.log("═══════════════════════════════════════════════════════════════════════");
  Logger.log("KEY GUARANTEES:");
  Logger.log("═══════════════════════════════════════════════════════════════════════");
  Logger.log("  ✓ Enabling multiplier does NOT immediately shrink user's displayed cut");
  Logger.log("  ✓ Multiplier only affects FUTURE earnings, not past/current");
  Logger.log("  ✓ User's cut tracked is AFTER email percentage applied");
  Logger.log("  ✓ Changing admin % keeps current displayed value, new % applies to future");
  Logger.log("");
  
  Logger.log("═══════════════════════════════════════════════════════════════════════");
  Logger.log("CODE PATH SUMMARY:");
  Logger.log("═══════════════════════════════════════════════════════════════════════");
  Logger.log("");
  Logger.log("PATH A (normal affiliates - no admin percentageEnabled):");
  Logger.log("  displayed = raw_api_value × email_percentage");
  Logger.log("  → Simple, direct calculation, no tracking");
  Logger.log("");
  Logger.log("PATH B (admin percentageEnabled = true):");
  Logger.log("  First lookup:");
  Logger.log("    baseline = raw × email_percentage  ← NO admin % yet!");
  Logger.log("    displayed = baseline");
  Logger.log("  Subsequent:");
  Logger.log("    user_cut = raw × email_percentage");
  Logger.log("    delta = user_cut - last_user_cut");
  Logger.log("    adjusted = delta × admin_multiplier");
  Logger.log("    displayed = last_displayed + adjusted");
  Logger.log("");
  
  return {
    status: "Documentation test - see logs for expected behavior",
    note: "This test explains the logic. Use lookupAffiliate() with real emails to test actual behavior."
  };
}

function getCurrentUserStatus() {
  try {
    var userEmail = Session.getActiveUser().getEmail().toLowerCase();
    var isAdmin = ADMIN_EMAILS.indexOf(userEmail) !== -1;
    return {
      email: userEmail,
      isAdmin: isAdmin
    };
  } catch(e) {
    return {
      email: '',
      isAdmin: false
    };
  }
}

function saveAdminOverride(email, overrideData) {
  if (!isAdmin_()) {
    throw new Error('Unauthorized');
  }
  
  // Clean up overrideData - remove null/undefined values so they don't override API data
  var cleanedOverride = {};
  
  if (overrideData.unpaidAmount !== null && overrideData.unpaidAmount !== undefined) {
    cleanedOverride.unpaidAmount = overrideData.unpaidAmount;
  }
  if (overrideData.dueNow !== null && overrideData.dueNow !== undefined) {
    cleanedOverride.dueNow = overrideData.dueNow;
  }
  if (overrideData.totalPaid !== null && overrideData.totalPaid !== undefined) {
    cleanedOverride.totalPaid = overrideData.totalPaid;
  }
  if (overrideData.approvedCommission !== null && overrideData.approvedCommission !== undefined) {
    cleanedOverride.approvedCommission = overrideData.approvedCommission;
  }
  if (overrideData.lastPayout !== null && overrideData.lastPayout !== undefined && overrideData.lastPayout !== '') {
    cleanedOverride.lastPayout = overrideData.lastPayout;
  }
  if (overrideData.status !== null && overrideData.status !== undefined && overrideData.status !== '') {
    cleanedOverride.status = overrideData.status;
  }
  
  // Always save percentage settings (even if null) since they're separate from field overrides
  cleanedOverride.percentageMultiplier = overrideData.percentageMultiplier;
  cleanedOverride.percentageEnabled = overrideData.percentageEnabled || false;
  
  Logger.log("Cleaned override data: " + JSON.stringify(cleanedOverride));
  
  return setAdminOverride_(email, cleanedOverride);
}

function removeAdminOverride(email) {
  if (!isAdmin_()) {
    throw new Error('Unauthorized');
  }
  var key = getAdminOverrideKey_(email);
  PropertiesService.getScriptProperties().deleteProperty(key);
  return true;
}

function initializeSheet_() {
  formatAndSetupSheet_();

  if (PRIVACY_ON) {
    clearBGValues_();   
    hideEmailsNow_();   
    try { SpreadsheetApp.getActive().setActiveSelection('A1'); } catch(_) {}
  }
}

/* ---------- Enhanced Authentication with Caching ---------- */
function fetchWithRetry_(url, apiKey, tries) {
  tries = tries || MAX_RETRIES;
  var lastResponse = null;
  
  // Use cached auth method if available
  if (_authMethodCache) {
    try {
      var response = UrlFetchApp.fetch(url, { 
        method: 'get', 
        headers: authHeaders_(apiKey, _authMethodCache), 
        muteHttpExceptions: true 
      });
      var code = response.getResponseCode();
      if (code >= 200 && code < 300) {
        return response;
      }
      // Clear cache if it stops working
      if (code === 401 || code === 403) {
        _authMethodCache = null;
      }
    } catch(e) {
      console.warn('Cached auth method failed:', e);
      _authMethodCache = null;
    }
  }
  
  var authMethods = ['bearer', 'basic', 'token'];
  
  for (var attempt = 0; attempt < tries; attempt++) {
    for (var i = 0; i < authMethods.length; i++) {
      var method = authMethods[i];
      
      try {
        var response = UrlFetchApp.fetch(url, { 
          method: 'get', 
          headers: authHeaders_(apiKey, method), 
          muteHttpExceptions: true 
        });
        
        var code = response.getResponseCode();
        lastResponse = response;
        
        if (code >= 200 && code < 300) {
          // Cache the working auth method
          _authMethodCache = method;
          return response;
        }
        
        // Don't retry other auth methods for non-auth errors
        if (code !== 401 && code !== 403) {
          break;
        }
        
      } catch(e) {
        console.warn('Fetch attempt failed:', e);
        continue;
      }
    }
    
    // Wait before retry
    if (attempt < tries - 1) {
      Utilities.sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  
  return lastResponse;
}

/* ---------- Enhanced Commission Processing with Safety Checks ---------- */
/**
 * Calculates commission totals for an affiliate from API
 * 
 * DATA MODEL:
 * - paid: Total amount of commissions that have been paid out to the affiliate
 * - unpaid: Total amount of commissions that have NOT been paid out yet (includes pending + approved)
 * - dueNow: Subset of unpaid commissions that are approved and ready for immediate payout
 *           (excludes commissions still in pending/holding/review period)
 * - approvedCommission (in result): paid + dueNow (approved commissions = those that passed review)
 * 
 * COMMISSION STATUSES:
 * - 'paid', 'completed', 'payout_paid', 'paid_out' → Counted as PAID
 * - 'approved', 'confirmed', 'ready_for_payout', 'pending_payout' → Counted as DUE NOW (unpaid but ready)
 * - 'pending', 'held', 'review', 'on_hold', etc. → Counted as UNPAID but NOT due now (still in holding)
 * 
 * RELATIONSHIPS:
 * - unpaid >= dueNow (due now is subset of unpaid)
 * - approvedCommission = paid + dueNow (approved = past review period)
 * - Total lifetime = paid + unpaid (includes pending commissions still in review)
 */
function sumDueNowForAffiliate_(affiliateId, apiKey) {
  if (!affiliateId) throw new Error('Invalid affiliate ID');
  
  var page = 1, paid = 0, unpaid = 0, dueNow = 0, lastPayoutAt = '', debugHttp = '';
  var pagesProcessed = 0;
  var debugData = []; // For debugging commission data
  var countedCommissions = []; // Track commissions that are actually counted
  var statusCounts = {}; // Track all unique statuses and their counts
  var skippedPendingCount = 0;
  var totalCommissionsProcessed = 0;
  var seenCommissionIds = {}; // Track commission IDs to avoid duplicates
  
  Logger.log("=== FETCHING COMMISSIONS FROM API ===");
  Logger.log("Note: /commissions endpoint returns recent commissions only");
  Logger.log("Complete balance data will be extracted from affiliate.commission_stats.currencies");
  
  while (page <= MAX_PAGES) { // Safety limit
    try {
      var url = BASE_URL + '/commissions?affiliate_id=' + encodeURIComponent(affiliateId) + 
                '&page=' + page + '&per_page=200';
      var r = fetchWithRetry_(url, apiKey);
      
      if (!r) {
        debugHttp = 'No response';
        break;
      }
      
      var rc = r.getResponseCode();
      debugHttp = 'API ' + rc;
      
      if (rc === 404) break; // No more data
      if (rc < 200 || rc >= 300) {
        console.warn('Commission fetch failed with HTTP', rc);
        break;
      }

      var body = safeParseJson_(r.getContentText());
      if (!body) {
        console.warn('Invalid JSON in commissions response');
        break;
      }
      
      var items = extractCommissions_(body);
      
      // Log pagination metadata
      if (body && body.pagination) {
        Logger.log("Page " + page + ": Fetched " + (items ? items.length : 0) + " commissions | " +
                   "Pagination: current=" + body.pagination.current_page + 
                   ", total_pages=" + body.pagination.total_pages +
                   ", total_count=" + body.pagination.total_count);
      } else {
        Logger.log("Page " + page + ": Fetched " + (items ? items.length : 0) + " commissions | No pagination metadata");
      }
      
      if (!items || !items.length) {
        Logger.log("No more commissions on page " + page + ", stopping pagination");
        break;
      }

      var now = new Date();
      for (var i = 0; i < items.length; i++) {
        var c = items[i];
        if (!c) continue;
        
        var amt = readAmount_(c);
        var status = readStatus_(c);
        var paidAt = (c.paid_at || c.payout_at) || '';
        var dueAt = null;
        
        // Safer date parsing
        if (c.due_at) {
          try {
            dueAt = new Date(c.due_at);
            if (isNaN(dueAt.getTime())) dueAt = null;
          } catch(_) {
            dueAt = null;
          }
        }

        // Enhanced commission categorization
        var isPaid = false;
        var isDueNow = false;
        
        // Check if commission is paid
        if (paidAt || status === 'paid' || ['paid', 'payout_paid', 'paid_out', 'completed'].indexOf(status) !== -1) {
          isPaid = true;
        }
        
        // Determine if commission is due now (ready for payout)
        if (!isPaid) {
          // Method 1: Check if due date has passed
          if (dueAt && dueAt <= now) {
            isDueNow = true;
          }
          // Method 2: Check status explicitly for approved/ready states
          else if (['approved', 'confirmed', 'ready_for_payout', 'pending_payout'].indexOf(status) !== -1) {
            isDueNow = true;
          }
          // Method 3: If no due date but status suggests it's approved/unpaid, check more carefully
          // Note: Removed automatic isDueNow for 'unpaid' without due_at as it may include pending commissions
        }
        
        // Track ALL statuses and commission counts
        totalCommissionsProcessed++;
        if (!statusCounts[status]) {
          statusCounts[status] = { count: 0, totalAmount: 0, isPaidCount: 0, isUnpaidCount: 0 };
        }
        statusCounts[status].count++;
        statusCounts[status].totalAmount += amt;
        if (isPaid) {
          statusCounts[status].isPaidCount++;
        } else {
          statusCounts[status].isUnpaidCount++;
        }
        
        // Filter commissions based on status
        // System DOES NOT count "pending" status commissions in unpaid total
        // Only APPROVED/CONFIRMED unpaid commissions are counted
        var shouldIncludeCommission = true;
        
        if (!isPaid && status === 'pending') {
          // EXCLUDE ALL pending commissions - they haven't been approved yet
          // System only counts approved commissions in the unpaid balance
          shouldIncludeCommission = false;
          skippedPendingCount++;
        }
        
        // Note: Commissions with status 'pending', 'held', 'review', 'pending_review', 'on_hold', 
        // 'fraud_review' are considered unpaid but NOT due now (still in holding/review period)
        
        // Debug logging (first 20 commissions to see patterns)
        if (debugData.length < 20) {
          debugData.push({
            id: c.id || 'unknown',
            convertedAmount: amt,
            rawFields: {
              amount: c.amount,
              amount_cents: c.amount_cents,
              total: c.total,
              total_cents: c.total_cents,
              payout_amount: c.payout_amount,
              payout_cents: c.payout_cents
            },
            currency: c.currency || 'unknown',
            normalizedStatus: status,
            rawStatus: c.status || c.payout_status || c.payment_status || c.state,
            paidAt: paidAt,
            dueAt: dueAt ? dueAt.toISOString() : null,
            isPaid: isPaid,
            isDueNow: isDueNow,
            allStatuses: {
              status: c.status,
              payout_status: c.payout_status,
              payment_status: c.payment_status,
              state: c.state,
              commission_status: c.commission_status
            }
          });
        }

        if (isPaid) {
          // Commission has been paid out
          paid += amt;
          
          if (pagesProcessed <= 1 && paid <= amt * 3) { // Log first few paid commissions
            Logger.log("PAID commission: $" + amt + " " + (c.currency || 'USD') + " - Status: " + status);
          }
          
          // Track paid commissions
          if (countedCommissions.length < 20) {
            countedCommissions.push({
              amount: amt,
              status: status,
              isPaid: true,
              isDueNow: false
            });
          }
          if (paidAt) {
            try {
              var cur = new Date(paidAt);
              if (!isNaN(cur.getTime())) {
                var prev = lastPayoutAt ? new Date(lastPayoutAt) : null;
                if (!prev || isNaN(prev.getTime()) || (cur > prev)) {
                  lastPayoutAt = paidAt;
                }
              }
            } catch(_) {
              // Ignore invalid dates
            }
          }
        } else if (shouldIncludeCommission) {
          // Commission is unpaid AND should be included (approved/confirmed)
          unpaid += amt;
          
          if (pagesProcessed <= 1 && unpaid <= amt * 10) { // Log first 10 COUNTED unpaid commissions
            Logger.log("✅ COUNTING unpaid: $" + amt + " " + (c.currency || 'USD') + " - Status: " + status + " - isDueNow: " + isDueNow);
          }
          
          // Track counted commissions
          if (countedCommissions.length < 20) {
            countedCommissions.push({
              amount: amt,
              status: status,
              isPaid: false,
              isDueNow: isDueNow
            });
          }
          
          // If commission is explicitly marked as due now (approved/ready for payout), include it
          if (isDueNow) {
            dueNow += amt;
            if (pagesProcessed <= 1 && dueNow <= amt * 3) { // Log first few due now commissions
              Logger.log("  → DUE NOW: $" + amt);
            }
          }
          // Otherwise, it's still in pending/holding period and not included in dueNow
        }
      }

      // Check pagination more safely
      var hasNext = checkPagination_(body);
      if (!hasNext) break;
      
      page++;
      pagesProcessed++;
      
      // Add rate limiting
      if (pagesProcessed % 5 === 0) {
        Utilities.sleep(RATE_LIMIT_DELAY_MS);
      }
      
    } catch(e) {
      console.error('Error processing commissions page', page, ':', e);
      break;
    }
  }
  
  if (page > MAX_PAGES) {
    console.warn('Hit maximum page limit (' + MAX_PAGES + ') for affiliate', affiliateId);
  }
  
  Logger.log("=== COMMISSION CALCULATION SUMMARY ===");
  Logger.log("Pages processed: " + pagesProcessed);
  Logger.log("Total commissions processed: " + totalCommissionsProcessed);
  Logger.log("Pending commissions skipped: " + skippedPendingCount);
  Logger.log("Total PAID: $" + round2_(paid));
  Logger.log("Total UNPAID: $" + round2_(unpaid));
  Logger.log("Total DUE NOW: $" + round2_(dueNow));
  Logger.log("======================================");
  
  // Log status breakdown
  Logger.log("=== STATUS BREAKDOWN ===");
  var statusKeys = Object.keys(statusCounts);
  for (var sk = 0; sk < statusKeys.length; sk++) {
    var st = statusKeys[sk];
    var sc = statusCounts[st];
    Logger.log(st + ": " + sc.count + " commissions, $" + round2_(sc.totalAmount) + 
               " (Paid: " + sc.isPaidCount + ", Unpaid: " + sc.isUnpaidCount + ")");
  }
  Logger.log("======================================");
  
  // Log first 20 commissions encountered
  if (debugData.length > 0) {
    Logger.log("=== SAMPLE COMMISSIONS (first 20 encountered) ===");
    for (var di = 0; di < Math.min(20, debugData.length); di++) {
      var dc = debugData[di];
      Logger.log((di+1) + ". $" + dc.convertedAmount.toFixed(2) + " - Status: " + dc.normalizedStatus + 
                 " - Paid: " + dc.isPaid + " - DueNow: " + dc.isDueNow);
    }
    Logger.log("======================================");
  }
  
  // Log commissions that were actually COUNTED (paid or unpaid)
  if (countedCommissions.length > 0) {
    Logger.log("=== COMMISSIONS ACTUALLY COUNTED (first 20) ===");
    for (var ci = 0; ci < countedCommissions.length; ci++) {
      var cc = countedCommissions[ci];
      Logger.log((ci+1) + ". $" + cc.amount.toFixed(2) + " - Status: " + cc.status + 
                 " - Paid: " + cc.isPaid + " - DueNow: " + cc.isDueNow);
    }
    Logger.log("======================================");
  } else {
    Logger.log("=== NO COMMISSIONS COUNTED (all were skipped) ===");
  }
  
  return { 
    paid: round2_(paid), 
    unpaid: round2_(unpaid),
    dueNow: round2_(dueNow), 
    lastPayoutAt: lastPayoutAt, 
    _debug_http: debugHttp,
    _debug_data: debugData,
    _debug_totals: {
      totalCommissionsProcessed: debugData.length,
      calculatedPaid: round2_(paid),
      calculatedUnpaid: round2_(unpaid), 
      calculatedDueNow: round2_(dueNow)
    }
  };
}

/* ---------- Enhanced Input Validation ---------- */
function fetchByEmail_(email) {
  if (!email || typeof email !== 'string' || email.indexOf('@') === -1) {
    throw new Error('Invalid email address provided.');
  }

  // NOTE: We do NOT cache fetchByEmail_ because it uses complex incremental tracking
  // state management that needs to be recalculated each time

  var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
  if (!apiKey) throw new Error('Missing AFFILIATE_API_KEY in Script properties.');

  try {
    // 1) affiliate by email → id (first lookup to get ID)
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp) throw new Error('No response from affiliate API');
    
    var code = affResp.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('Affiliate lookup failed (HTTP ' + code + ')');
    }
    
    var payload = safeParseJson_(affResp.getContentText());
    if (!payload) throw new Error('Invalid JSON response from API');
    
    var aff = extractAffiliate_(payload);
    if (!aff || !aff.id) {
      return { status: 'Not found', affiliateId: '', unpaidAmount: 0, dueNow: 0, approvedCommission: 0, lastPayout: '' };
    }
    
    // 2) Try fetching affiliate by ID with expansion to get balance fields
    Logger.log("=== ATTEMPTING TO FETCH AFFILIATE WITH EXPANSION ===");
    Logger.log("Affiliate ID: " + aff.id);
    
    var affByIdUrl = BASE_URL + '/affiliates/' + aff.id + '?expand=true';
    Logger.log("Fetching: " + affByIdUrl);
    var affByIdResp = fetchWithRetry_(affByIdUrl, apiKey);
    
    if (affByIdResp && affByIdResp.getResponseCode() === 200) {
      var expandedPayload = safeParseJson_(affByIdResp.getContentText());
      if (expandedPayload) {
        var expandedAff = extractAffiliate_(expandedPayload);
        if (expandedAff && expandedAff.id) {
          Logger.log("✅ Successfully fetched expanded affiliate data");
          Logger.log("Expanded affiliate keys: " + JSON.stringify(Object.keys(expandedAff)));
          aff = expandedAff;  // Use expanded data
        } else {
          Logger.log("⚠️ Expanded fetch returned invalid data, using original");
        }
      }
    } else {
      Logger.log("⚠️ Failed to fetch expanded affiliate data, using original");
    }

    // 2) Check if affiliate object provides balance fields directly (preferred)
    var useAffiliateBalances = false;
    var unpaidFromAff = 0;
    var dueNowFromAff = 0;
    var approvedFromAff = 0;
    
    // Affiliate object often contains pre-calculated balances
    // WARNING: These might already be in the target currency (CAD) and not need conversion!
    if (aff.balance !== undefined || aff.commissions_balance !== undefined || aff.unpaid_balance !== undefined) {
      // Try to extract balance information
      // Note: If these are already in cents, we need to divide by 100
      if (aff.unpaid_balance !== undefined && aff.unpaid_balance !== null) {
        var unpaidRaw = Number(aff.unpaid_balance);
        // Check if it's in cents (large integer) or dollars
        if (Number.isInteger(unpaidRaw) && Math.abs(unpaidRaw) >= 100) {
          unpaidFromAff = unpaidRaw / 100; // Convert from cents
        } else {
          unpaidFromAff = unpaidRaw;
        }
        // Only convert currency if it's in USD
        if ((aff.currency || '').toUpperCase() === 'USD' && CURRENCY === 'CAD') {
          unpaidFromAff = unpaidFromAff * USD_TO_CAD_RATE;
        }
        useAffiliateBalances = true;
      }
      if (aff.due_balance !== undefined && aff.due_balance !== null) {
        var dueRaw = Number(aff.due_balance);
        if (Number.isInteger(dueRaw) && Math.abs(dueRaw) >= 100) {
          dueNowFromAff = dueRaw / 100;
        } else {
          dueNowFromAff = dueRaw;
        }
        if ((aff.currency || '').toUpperCase() === 'USD' && CURRENCY === 'CAD') {
          dueNowFromAff = dueNowFromAff * USD_TO_CAD_RATE;
        }
        useAffiliateBalances = true;
      }
      if (aff.approved_balance !== undefined && aff.approved_balance !== null) {
        var approvedRaw = Number(aff.approved_balance);
        if (Number.isInteger(approvedRaw) && Math.abs(approvedRaw) >= 100) {
          approvedFromAff = approvedRaw / 100;
        } else {
          approvedFromAff = approvedRaw;
        }
        if ((aff.currency || '').toUpperCase() === 'USD' && CURRENCY === 'CAD') {
          approvedFromAff = approvedFromAff * USD_TO_CAD_RATE;
        }
        useAffiliateBalances = true;
      }
      if (aff.commissions_balance !== undefined && aff.commissions_balance !== null) {
        var commRaw = Number(aff.commissions_balance);
        if (Number.isInteger(commRaw) && Math.abs(commRaw) >= 100) {
          approvedFromAff = commRaw / 100;
        } else {
          approvedFromAff = commRaw;
        }
        if ((aff.currency || '').toUpperCase() === 'USD' && CURRENCY === 'CAD') {
          approvedFromAff = approvedFromAff * USD_TO_CAD_RATE;
        }
        useAffiliateBalances = true;
      }
    }
    
    // Calculate from commissions API
    var totals = sumDueNowForAffiliate_(aff.id, apiKey);
    
    // IMPORTANT: The /commissions endpoint only returns pending and due commissions
    // It does NOT return approved commissions that aren't due yet
    // For unpaid total, use affiliate's unpaid_balance which includes approved commissions
    // For dueNow, use calculated value which is accurate
    
    var finalUnpaid = totals.unpaid;  // Default to calculated
    var finalDueNow = totals.dueNow;  // Default to calculated
    var dataSource = 'calculated_from_commissions';
    
    // *** PRIORITY: Use commission_stats.currencies for complete balance data ***
    if (aff.commission_stats && aff.commission_stats.currencies) {
      Logger.log("=== EXTRACTING BALANCE FROM commission_stats.currencies ===");
      
      // Determine which currency to use (prefer our target CURRENCY, fallback to USD then first available)
      var targetCurrency = CURRENCY; // 'CAD'
      var currData = null;
      
      if (aff.commission_stats.currencies[targetCurrency]) {
        currData = aff.commission_stats.currencies[targetCurrency];
        Logger.log("✅ Found target currency: " + targetCurrency);
      } else if (aff.commission_stats.currencies['USD']) {
        currData = aff.commission_stats.currencies['USD'];
        Logger.log("⚠️ Target currency not found, using USD");
      } else {
        // Use first available currency
        var availableCurrencies = Object.keys(aff.commission_stats.currencies);
        if (availableCurrencies.length > 0) {
          var firstCurr = availableCurrencies[0];
          currData = aff.commission_stats.currencies[firstCurr];
          Logger.log("⚠️ Using first available currency: " + firstCurr);
        }
      }
      
      if (currData) {
        Logger.log("Currency data structure: " + JSON.stringify(currData));
        
        // Extract unpaid amount
        if (currData.unpaid && currData.unpaid.cents !== undefined) {
          var unpaidCents = Number(currData.unpaid.cents);
          var unpaidDollars = unpaidCents / 100;
          Logger.log("💰 Extracted UNPAID: " + unpaidCents + " cents = $" + unpaidDollars);
          
          // Convert currency if needed
          var currIso = currData.unpaid.currency_iso || targetCurrency;
          if (currIso === 'USD' && CURRENCY === 'CAD') {
            unpaidDollars = unpaidDollars * USD_TO_CAD_RATE;
            Logger.log("  Converted USD → CAD: $" + unpaidDollars);
          }
          
          finalUnpaid = round2_(unpaidDollars);
          dataSource = 'commission_stats_currencies';
          Logger.log("✅ Using commission_stats unpaid: $" + finalUnpaid);
        }
        
        // Extract due amount
        if (currData.due && currData.due.cents !== undefined) {
          var dueCents = Number(currData.due.cents);
          var dueDollars = dueCents / 100;
          Logger.log("💰 Extracted DUE: " + dueCents + " cents = $" + dueDollars);
          
          // Convert currency if needed
          var dueIso = currData.due.currency_iso || targetCurrency;
          if (dueIso === 'USD' && CURRENCY === 'CAD') {
            dueDollars = dueDollars * USD_TO_CAD_RATE;
            Logger.log("  Converted USD → CAD: $" + dueDollars);
          }
          
          finalDueNow = round2_(dueDollars);
          Logger.log("✅ Using commission_stats due: $" + finalDueNow);
        }
        
        // Extract paid amount (THIS IS THE FIX!)
        if (currData.paid && currData.paid.cents !== undefined) {
          var paidCents = Number(currData.paid.cents);
          var paidDollars = paidCents / 100;
          Logger.log("💰 Extracted PAID: " + paidCents + " cents = $" + paidDollars);
          
          // Convert currency if needed
          var paidIso = currData.paid.currency_iso || targetCurrency;
          if (paidIso === 'USD' && CURRENCY === 'CAD') {
            paidDollars = paidDollars * USD_TO_CAD_RATE;
            Logger.log("  Converted USD → CAD: $" + paidDollars);
          }
          
          // OVERRIDE the calculated totals.paid with the accurate API value!
          totals.paid = round2_(paidDollars);
          Logger.log("✅ Using commission_stats paid: $" + totals.paid + " (overriding calculated $" + totals.paid + ")");
        }
        
        Logger.log("=== FINAL VALUES FROM commission_stats ===");
        Logger.log("  Unpaid: $" + finalUnpaid + " " + CURRENCY);
        Logger.log("  Due Now: $" + finalDueNow + " " + CURRENCY);
        Logger.log("  Total Paid: $" + totals.paid + " " + CURRENCY);
      }
    }
    
    // Legacy check for unpaid_balance (commission_stats is now primary source)
    Logger.log("Legacy balance field check (for debugging):");
    Logger.log("  aff.unpaid_balance: " + aff.unpaid_balance);
    Logger.log("  aff.unpaid_commissions: " + aff.unpaid_commissions);
    Logger.log("  aff.due_balance: " + aff.due_balance);
    Logger.log("  aff.due_commissions: " + aff.due_commissions);
    Logger.log("  aff.approved_balance: " + aff.approved_balance);
    Logger.log("  aff.paid_commissions: " + aff.paid_commissions);
    Logger.log("  aff.balance: " + aff.balance);
    Logger.log("  aff.commissions_balance: " + aff.commissions_balance);
    
    // Log all available fields to find balance data
    Logger.log("All affiliate fields: " + JSON.stringify(Object.keys(aff)));
    
    // Check if balance is nested
    if (aff.balances) {
      Logger.log("Found aff.balances object: " + JSON.stringify(aff.balances));
    }
    if (aff.stats) {
      Logger.log("Found aff.stats object: " + JSON.stringify(aff.stats));
    }
    if (aff.totals) {
      Logger.log("Found aff.totals object: " + JSON.stringify(aff.totals));
    }
    if (aff.commission_totals) {
      Logger.log("Found aff.commission_totals object: " + JSON.stringify(aff.commission_totals));
    }
    
    // *** CHECK commission_stats - this might have the aggregate data! ***
    if (aff.commission_stats) {
      Logger.log("🔍 Found aff.commission_stats object!");
      Logger.log("commission_stats keys: " + JSON.stringify(Object.keys(aff.commission_stats)));
      
      // Check the currencies object
      if (aff.commission_stats.currencies) {
        Logger.log("💰 Found commission_stats.currencies!");
        Logger.log("Available currencies: " + JSON.stringify(Object.keys(aff.commission_stats.currencies)));
        
        // Log each currency's data
        var currencies = Object.keys(aff.commission_stats.currencies);
        for (var ci = 0; ci < currencies.length; ci++) {
          var currCode = currencies[ci];
          var currData = aff.commission_stats.currencies[currCode];
          Logger.log("=== Currency: " + currCode + " ===");
          Logger.log("  Keys: " + JSON.stringify(Object.keys(currData)));
          Logger.log("  Full data: " + JSON.stringify(currData));
          
          // Try to find balance fields
          if (currData.unpaid !== undefined) Logger.log("  💵 unpaid: " + currData.unpaid);
          if (currData.due !== undefined) Logger.log("  💵 due: " + currData.due);
          if (currData.approved !== undefined) Logger.log("  💵 approved: " + currData.approved);
          if (currData.paid !== undefined) Logger.log("  💵 paid: " + currData.paid);
          if (currData.total !== undefined) Logger.log("  💵 total: " + currData.total);
          if (currData.pending !== undefined) Logger.log("  💵 pending: " + currData.pending);
        }
      } else {
        Logger.log("commission_stats full: " + JSON.stringify(aff.commission_stats));
      }
    }
    
    // Old unpaid_balance field is not used anymore (commission_stats.currencies is primary source)
    if (dataSource === 'calculated_from_commissions' && aff.unpaid_balance !== undefined && aff.unpaid_balance !== null) {
      Logger.log("⚠️ Fallback: commission_stats not available, would use unpaid_balance but it's deprecated");
    }
    
    var result = {
      affiliateId: aff.id,
      unpaidAmount: finalUnpaid,
      dueNow: finalDueNow,
      totalPaid: totals.paid,
      approvedCommission: round2_(totals.paid + finalDueNow),
      lastPayout: totals.lastPayoutAt || '',
      status: firstNotEmpty_(aff.status, aff.state, 'OK'),
      _debug_http: totals._debug_http || ('HTTP ' + code),
      _debug_source: dataSource,
      _debug_aff_balances: {
        unpaid_balance: aff.unpaid_balance,
        due_balance: aff.due_balance,
        approved_balance: aff.approved_balance,
        commissions_balance: aff.commissions_balance,
        balance: aff.balance
      },
      _debug_calculated: {
        paid: totals.paid,
        unpaid: totals.unpaid,
        dueNow: totals.dueNow
      }
    };
    
    // === NEW INCREMENTAL TRACKING SYSTEM ===
    Logger.log("=== INCREMENTAL TRACKING & PERCENTAGE SYSTEM ===");
    Logger.log("Email being processed: " + email);
    
    // Store original API values
    var currentApiUnpaid = result.unpaidAmount;
    var currentApiDueNow = result.dueNow;
    var currentApiTotalPaid = result.totalPaid;
    Logger.log("Current API Values (raw from API/calculation):");
    Logger.log("  - Unpaid: $" + currentApiUnpaid + " " + CURRENCY);
    Logger.log("  - Due Now: $" + currentApiDueNow + " " + CURRENCY);
    Logger.log("  - Total Paid: $" + currentApiTotalPaid + " " + CURRENCY);
    Logger.log("  - Source: " + result._debug_source);
    
    // Step 1: Check for email-based baseline percentage
    var emailPercentage = extractEmailPercentage_(email);
    if (emailPercentage !== null) {
      Logger.log("✅ Email percentage detected: " + emailPercentage + "%");
    } else {
      Logger.log("No email percentage pattern found");
    }
    
    // Step 2: Load or initialize incremental tracking data
    var tracking = getIncrementalTracking_(email);
    var isFirstLookup = !tracking || !tracking.isInitialized;
    
    // Migration: If tracking exists but doesn't have totalPaid fields, add them
    if (tracking && tracking.isInitialized && !tracking.hasOwnProperty('lastApiTotalPaid')) {
      Logger.log("⚠️ Migration: Old tracking data detected, adding totalPaid fields");
      tracking.lastApiTotalPaid = currentApiTotalPaid;
      tracking.lastDisplayedTotalPaid = currentApiTotalPaid;
      tracking.initialApiTotalPaid = currentApiTotalPaid;
      setIncrementalTracking_(email, tracking);
      Logger.log("✅ Migration complete, tracking updated");
    }
    
    Logger.log("Tracking status: " + (isFirstLookup ? "FIRST LOOKUP (no tracking data)" : "SUBSEQUENT LOOKUP (has tracking)"));
    if (tracking) {
      Logger.log("Existing tracking data: " + JSON.stringify(tracking));
    }
    
    if (isFirstLookup) {
      Logger.log("🆕 FIRST LOOKUP - Initializing baseline");
      
      // Apply email baseline percentage to initial values
      var baselineUnpaid = currentApiUnpaid;
      var baselineDueNow = currentApiDueNow;
      var baselineTotalPaid = currentApiTotalPaid;
      
      if (emailPercentage !== null && emailPercentage < 100) {
        var baselineMultiplier = emailPercentage / 100;
        baselineUnpaid = round2_(currentApiUnpaid * baselineMultiplier);
        baselineDueNow = round2_(currentApiDueNow * baselineMultiplier);
        baselineTotalPaid = round2_(currentApiTotalPaid * baselineMultiplier);
        Logger.log("  - Email baseline (" + emailPercentage + "%) applied:");
        Logger.log("  - Unpaid: $" + currentApiUnpaid + " × " + baselineMultiplier + " = $" + baselineUnpaid);
        Logger.log("  - Due Now: $" + currentApiDueNow + " × " + baselineMultiplier + " = $" + baselineDueNow);
        Logger.log("  - Total Paid: $" + currentApiTotalPaid + " × " + baselineMultiplier + " = $" + baselineTotalPaid);
      } else {
        if (emailPercentage === 100) {
          Logger.log("  - Email baseline is 100% (no reduction), using full API values");
        } else {
          Logger.log("  - No email percentage pattern detected, using full API values (100%)");
        }
        Logger.log("  - Unpaid: $" + baselineUnpaid + " (100% of API)");
        Logger.log("  - Due Now: $" + baselineDueNow + " (100% of API)");
        Logger.log("  - Total Paid: $" + baselineTotalPaid + " (100% of API)");
      }
      
      // Initialize tracking
      tracking = {
        isInitialized: true,
        emailBaselinePercentage: emailPercentage,
        lastApiUnpaid: currentApiUnpaid,
        lastApiDueNow: currentApiDueNow,
        lastApiTotalPaid: currentApiTotalPaid,
        lastDisplayedUnpaid: baselineUnpaid,
        lastDisplayedDueNow: baselineDueNow,
        lastDisplayedTotalPaid: baselineTotalPaid,
        initialApiUnpaid: currentApiUnpaid,
        initialApiDueNow: currentApiDueNow,
        initialApiTotalPaid: currentApiTotalPaid
      };
      
      // Set initial display values
      result.unpaidAmount = baselineUnpaid;
      result.dueNow = baselineDueNow;
      result.totalPaid = baselineTotalPaid;
      
      // Save tracking
      setIncrementalTracking_(email, tracking);
      
      // Debug info
      result._incremental_debug = {
        isFirstLookup: true,
        emailPercentage: emailPercentage,
        currentApiUnpaid: currentApiUnpaid,
        currentApiDueNow: currentApiDueNow,
        currentApiTotalPaid: currentApiTotalPaid,
        baselineUnpaid: baselineUnpaid,
        baselineDueNow: baselineDueNow,
        baselineTotalPaid: baselineTotalPaid,
        displayedUnpaid: result.unpaidAmount,
        displayedDueNow: result.dueNow,
        displayedTotalPaid: result.totalPaid
      };
      
      Logger.log("Baseline set: Unpaid $" + result.unpaidAmount + ", Due Now $" + result.dueNow + ", Total Paid $" + result.totalPaid);
      
    } else {
      Logger.log("📊 SUBSEQUENT LOOKUP - Applying incremental changes");
      
      // === NEW: VALIDATE BASELINE PERCENTAGE BEFORE PROCESSING DELTAS ===
      Logger.log("=== VALIDATING BASELINE PERCENTAGE ===");
      var validation = validateAndFixBaselinePercentage_(
        email, 
        tracking, 
        currentApiUnpaid, 
        currentApiDueNow, 
        currentApiTotalPaid
      );
      
      if (validation.correctionApplied) {
        Logger.log("🔧 Baseline was automatically corrected - skipping delta processing this lookup");
        
        // Set result to corrected values
        result.unpaidAmount = tracking.lastDisplayedUnpaid;
        result.dueNow = tracking.lastDisplayedDueNow;
        result.totalPaid = tracking.lastDisplayedTotalPaid;
        
        // Save corrected tracking
        setIncrementalTracking_(email, tracking);
        
        // Add debug info about correction
        result._baseline_corrected = {
          wasApplied: true,
          oldPercentage: validation.oldPercentage,
          newPercentage: validation.newPercentage,
          correction: {
            unpaid: {
              before: validation.oldDisplayedUnpaid,
              after: validation.newDisplayedUnpaid,
              change: round2_(validation.newDisplayedUnpaid - validation.oldDisplayedUnpaid)
            },
            dueNow: {
              before: validation.oldDisplayedDueNow,
              after: validation.newDisplayedDueNow,
              change: round2_(validation.newDisplayedDueNow - validation.oldDisplayedDueNow)
            },
            totalPaid: {
              before: validation.oldDisplayedTotalPaid,
              after: validation.newDisplayedTotalPaid,
              change: round2_(validation.newDisplayedTotalPaid - validation.oldDisplayedTotalPaid)
            }
          },
          message: "Baseline percentage auto-corrected from " + validation.oldPercentage + "% to " + validation.newPercentage + "%"
        };
        
        // Don't process deltas - just use corrected baseline
        // This prevents applying changes twice
        
      } else {
        // Baseline is valid, proceed with normal delta processing
        Logger.log("✅ Baseline percentage validated: " + ((tracking.emailBaselinePercentage === null || tracking.emailBaselinePercentage === 100) ? 100 : tracking.emailBaselinePercentage) + "%");
        Logger.log("=== END VALIDATION ===");
        
        Logger.log("Previous data:");
        Logger.log("  - Last API: Unpaid $" + tracking.lastApiUnpaid + ", Due Now $" + tracking.lastApiDueNow + ", Total Paid $" + tracking.lastApiTotalPaid);
        Logger.log("  - Last Displayed: Unpaid $" + tracking.lastDisplayedUnpaid + ", Due Now $" + tracking.lastDisplayedDueNow + ", Total Paid $" + tracking.lastDisplayedTotalPaid);
        
        // Calculate deltas (changes in API values)
        var deltaUnpaid = currentApiUnpaid - tracking.lastApiUnpaid;
        var deltaDueNow = currentApiDueNow - tracking.lastApiDueNow;
        var deltaTotalPaid = currentApiTotalPaid - tracking.lastApiTotalPaid;
        Logger.log("API Changes (Deltas):");
        Logger.log("  - Unpaid: " + (deltaUnpaid >= 0 ? "+" : "") + "$" + deltaUnpaid);
        Logger.log("  - Due Now: " + (deltaDueNow >= 0 ? "+" : "") + "$" + deltaDueNow);
        Logger.log("  - Total Paid: " + (deltaTotalPaid >= 0 ? "+" : "") + "$" + deltaTotalPaid);
        
        // Get admin override to check for percentage multiplier
        var override = getAdminOverride_(email);
        var adminMultiplierActive = false;
        var adminPercentage = 100;
        
        if (override && override.percentageEnabled === true && 
            override.percentageMultiplier !== undefined && 
            override.percentageMultiplier !== 100) {
          adminMultiplierActive = true;
          adminPercentage = override.percentageMultiplier;
          Logger.log("✅ Admin percentage multiplier ACTIVE: " + adminPercentage + "%");
        } else {
          Logger.log("Admin percentage multiplier NOT active (showing 100% of changes)");
        }
        
        // Apply admin percentage to deltas
        var adjustedDeltaUnpaid = deltaUnpaid;
        var adjustedDeltaDueNow = deltaDueNow;
        var adjustedDeltaTotalPaid = deltaTotalPaid;
        
        if (adminMultiplierActive) {
          var deltaMultiplier = adminPercentage / 100;
          adjustedDeltaUnpaid = round2_(deltaUnpaid * deltaMultiplier);
          adjustedDeltaDueNow = round2_(deltaDueNow * deltaMultiplier);
          adjustedDeltaTotalPaid = round2_(deltaTotalPaid * deltaMultiplier);
          Logger.log("Adjusted Deltas (" + adminPercentage + "% of change):");
          Logger.log("  - Unpaid: $" + deltaUnpaid + " × " + deltaMultiplier + " = $" + adjustedDeltaUnpaid);
          Logger.log("  - Due Now: $" + deltaDueNow + " × " + deltaMultiplier + " = $" + adjustedDeltaDueNow);
          Logger.log("  - Total Paid: $" + deltaTotalPaid + " × " + deltaMultiplier + " = $" + adjustedDeltaTotalPaid);
        }
        
        // Calculate new displayed values
        var newDisplayedUnpaid = round2_(tracking.lastDisplayedUnpaid + adjustedDeltaUnpaid);
        var newDisplayedDueNow = round2_(tracking.lastDisplayedDueNow + adjustedDeltaDueNow);
        var newDisplayedTotalPaid = round2_(tracking.lastDisplayedTotalPaid + adjustedDeltaTotalPaid);
        
        Logger.log("New Displayed Values (before clamping):");
        Logger.log("  - Unpaid: $" + tracking.lastDisplayedUnpaid + " + $" + adjustedDeltaUnpaid + " = $" + newDisplayedUnpaid);
        Logger.log("  - Due Now: $" + tracking.lastDisplayedDueNow + " + $" + adjustedDeltaDueNow + " = $" + newDisplayedDueNow);
        Logger.log("  - Total Paid: $" + tracking.lastDisplayedTotalPaid + " + $" + adjustedDeltaTotalPaid + " = $" + newDisplayedTotalPaid);
        
        // IMPORTANT: Clamp values to 0 to prevent negative balances
        // This happens when someone gets paid and the delta is negative
        if (newDisplayedUnpaid < 0) {
          Logger.log("⚠️ WARNING: Calculated unpaid is negative ($" + newDisplayedUnpaid + "), clamping to $0");
          Logger.log("  This usually means a payment was made. Resetting to $0.");
          newDisplayedUnpaid = 0;
        }
        if (newDisplayedDueNow < 0) {
          Logger.log("⚠️ WARNING: Calculated dueNow is negative ($" + newDisplayedDueNow + "), clamping to $0");
          Logger.log("  This usually means a payment was made. Resetting to $0.");
          newDisplayedDueNow = 0;
        }
        if (newDisplayedTotalPaid < 0) {
          Logger.log("⚠️ WARNING: Calculated totalPaid is negative ($" + newDisplayedTotalPaid + "), clamping to $0");
          newDisplayedTotalPaid = 0;
        }
        
        Logger.log("Final Displayed Values (after clamping):");
        Logger.log("  - Unpaid: $" + newDisplayedUnpaid);
        Logger.log("  - Due Now: $" + newDisplayedDueNow);
        Logger.log("  - Total Paid: $" + newDisplayedTotalPaid);
        
        // Update result
        result.unpaidAmount = newDisplayedUnpaid;
        result.dueNow = newDisplayedDueNow;
        result.totalPaid = newDisplayedTotalPaid;
        
        // Update tracking
        tracking.lastApiUnpaid = currentApiUnpaid;
        tracking.lastApiDueNow = currentApiDueNow;
        tracking.lastApiTotalPaid = currentApiTotalPaid;
        tracking.lastDisplayedUnpaid = newDisplayedUnpaid;
        tracking.lastDisplayedDueNow = newDisplayedDueNow;
        tracking.lastDisplayedTotalPaid = newDisplayedTotalPaid;
        setIncrementalTracking_(email, tracking);
        
        // Debug info
        result._incremental_debug = {
          isFirstLookup: false,
          emailPercentage: tracking.emailBaselinePercentage,
          previousApiUnpaid: tracking.lastApiUnpaid - deltaUnpaid,
          previousApiDueNow: tracking.lastApiDueNow - deltaDueNow,
          previousApiTotalPaid: tracking.lastApiTotalPaid - deltaTotalPaid,
          currentApiUnpaid: currentApiUnpaid,
          currentApiDueNow: currentApiDueNow,
          currentApiTotalPaid: currentApiTotalPaid,
          deltaUnpaid: deltaUnpaid,
          deltaDueNow: deltaDueNow,
          deltaTotalPaid: deltaTotalPaid,
          adminMultiplierActive: adminMultiplierActive,
          adminPercentage: adminPercentage,
          adjustedDeltaUnpaid: adjustedDeltaUnpaid,
          adjustedDeltaDueNow: adjustedDeltaDueNow,
          adjustedDeltaTotalPaid: adjustedDeltaTotalPaid,
          previousDisplayedUnpaid: tracking.lastDisplayedUnpaid - adjustedDeltaUnpaid,
          previousDisplayedDueNow: tracking.lastDisplayedDueNow - adjustedDeltaDueNow,
          previousDisplayedTotalPaid: tracking.lastDisplayedTotalPaid - adjustedDeltaTotalPaid,
          displayedUnpaid: newDisplayedUnpaid,
          displayedDueNow: newDisplayedDueNow,
          displayedTotalPaid: newDisplayedTotalPaid
        };
        
        if (adminMultiplierActive) {
          result._percentage_applied = adminPercentage + '% (incremental)';
        }
        
      } // End of baseline validation else block
    }
    
    // Final safety clamp: Ensure no negative values before admin overrides
    if (result.unpaidAmount < 0) {
      Logger.log("⚠️ SAFETY CLAMP: unpaidAmount was negative ($" + result.unpaidAmount + "), setting to $0");
      result.unpaidAmount = 0;
    }
    if (result.dueNow < 0) {
      Logger.log("⚠️ SAFETY CLAMP: dueNow was negative ($" + result.dueNow + "), setting to $0");
      result.dueNow = 0;
    }
    if (result.totalPaid < 0) {
      Logger.log("⚠️ SAFETY CLAMP: totalPaid was negative ($" + result.totalPaid + "), setting to $0");
      result.totalPaid = 0;
    }
    
    Logger.log("Final Result: Unpaid $" + result.unpaidAmount + ", Due Now $" + result.dueNow + ", Total Paid $" + result.totalPaid);
    Logger.log("=== END INCREMENTAL TRACKING ===");
    
    // Apply specific admin overrides (these take absolute precedence)
    var override = getAdminOverride_(email);
    if (override) {
      Logger.log("=== APPLYING SPECIFIC ADMIN OVERRIDES ===");
      // Only apply override if value is not null/undefined (empty fields should not override)
      if (override.unpaidAmount !== undefined && override.unpaidAmount !== null) {
        Logger.log("Override unpaid: $" + override.unpaidAmount);
        result.unpaidAmount = override.unpaidAmount;
      }
      if (override.dueNow !== undefined && override.dueNow !== null) {
        Logger.log("Override due now: $" + override.dueNow);
        result.dueNow = override.dueNow;
      }
      if (override.totalPaid !== undefined && override.totalPaid !== null) {
        Logger.log("Override total paid: $" + override.totalPaid);
        result.totalPaid = override.totalPaid;
      }
      if (override.approvedCommission !== undefined && override.approvedCommission !== null) {
        result.approvedCommission = override.approvedCommission;
      }
      if (override.lastPayout !== undefined && override.lastPayout !== null && override.lastPayout !== '') {
        result.lastPayout = override.lastPayout;
      }
      if (override.status !== undefined && override.status !== null && override.status !== '') {
        result.status = override.status;
      }
      result._admin_override = true;
      Logger.log("=== END ADMIN OVERRIDES ===");
    }
    
    // NOTE: We do NOT cache this result because incremental tracking needs fresh calculations
    
    return result;
  } catch(e) {
    console.error('Error in fetchByEmail_:', e);
    throw new Error('Fetch failed: ' + e.message);
  }
}

/* ---------- Enhanced Response Parsing ---------- */
function extractAffiliate_(payload) {
  // Handle different possible response structures
  if (Array.isArray(payload)) {
    return payload[0] || null;
  }
  if (payload && Array.isArray(payload.data)) {
    return payload.data[0] || null;
  }
  if (payload && payload.data && !Array.isArray(payload.data)) {
    return payload.data;
  }
  if (payload && payload.id) {
    return payload;
  }
  return null;
}

function extractCommissions_(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && body.data && !Array.isArray(body.data)) return [body.data];
  return [];
}

function checkPagination_(body) {
  // Check various pagination indicators
  if (body && body.pagination) {
    var pg = body.pagination;
    if (pg.current_page && pg.total_pages) {
      return Number(pg.current_page) < Number(pg.total_pages);
    }
  }
  
  if (body && body.meta) {
    return !!(body.meta.next_page || body.meta.has_next);
  }
  
  if (body && body.links) {
    return !!body.links.next;
  }
  
  return false;
}

// ... [Rest of your existing functions with error handling improvements] ...

/* ---------- Enhanced Utilities ---------- */
function safeParseJson_(txt) { 
  try { 
    return JSON.parse(txt || '{}'); 
  } catch (e) { 
    console.warn('JSON parse error:', e);
    return null; 
  } 
}

function convertToCAD_(amount, currency) {
  if (!amount || !Number.isFinite(Number(amount))) return 0;
  
  var amt = Number(amount);
  var curr = (currency || '').toString().toUpperCase();
  
  // If amount is in USD and we want CAD, convert it
  if (curr === 'USD' && CURRENCY === 'CAD') {
    amt = amt * USD_TO_CAD_RATE;
  }
  
  return round2_(amt);
}

function readAmount_(c) {
  if (!c) return 0;
  
  var amount = 0;
  var currency = null;
  
    // Try cents fields first (more reliable)
  var centsFields = ['amount_cents', 'total_cents', 'payout_cents'];
  for (var i = 0; i < centsFields.length; i++) {
    var cents = Number(c[centsFields[i]]);
    if (Number.isFinite(cents) && cents !== 0) {
      amount = cents / 100;
      break;
    }
  }
  
  // Try dollar amount fields if no cents found
  // API might also send 'amount' field in cents (as integer)
  if (amount === 0) {
    var dollarFields = ['amount', 'total', 'payout_amount'];
    for (var i = 0; i < dollarFields.length; i++) {
      var raw = Number(c[dollarFields[i]]);
      if (Number.isFinite(raw) && raw !== 0) {
        // Check if it looks like cents (large integer) or dollars (decimal or small int)
        // If it's a large integer, treat as cents
        if (Number.isInteger(raw) && Math.abs(raw) >= 100) {
          amount = raw / 100;
        } else {
          // Small values or decimals are likely already in dollars
          amount = raw;
        }
        break;
      }
    }
  }
  
  // Check currency and convert if needed
  currency = (c.currency || '').toString().toUpperCase();
  
  // If amount is in USD and we want CAD, convert it
  if (currency === 'USD' && CURRENCY === 'CAD') {
    amount = amount * USD_TO_CAD_RATE;
  }
  
  return amount;
}

function authHeaders_(apiKey, mode) {
  if (!apiKey) throw new Error('API key is required');
  
  switch (mode) {
    case 'basic':
      var basic = Utilities.base64Encode(apiKey + ':');
      return { Authorization: 'Basic ' + basic, Accept: 'application/json' };
    case 'token':
      return { Authorization: 'Token token=' + apiKey, Accept: 'application/json' };
    default: // bearer
      return { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' };
  }
}

/* ---------- Setup & Formatting ---------- */
function formatAndSetupSheet_() {
  var sh = getOrCreateTargetSheet_(); 
  if (!sh) return;
  
  try {
    sh.getRange(HDR_RANGE).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    var currencyFmt = getCurrencyFormat_();
    sh.getRange(2, COL_UNPAID, sh.getMaxRows(), 1).setNumberFormat(currencyFmt);
    sh.getRange(2, COL_DUE_NOW, sh.getMaxRows(), 1).setNumberFormat(currencyFmt);
    sh.getRange(2, COL_PAID,    sh.getMaxRows(), 1).setNumberFormat(currencyFmt);
    sh.getRange(2, COL_LAST,    sh.getMaxRows(), 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    
    try { 
      if (!sh.getFilter()) {
        sh.getRange(1, 1, sh.getMaxRows(), HEADERS.length).createFilter(); 
      }
    } catch(_) {}
  } catch(e) {
    // Silent fail for setup
  }
}

function getOrCreateTargetSheet_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();
    
    for (var i = 0; i < sheets.length; i++) {
      var sh = sheets[i];
      try {
        var hdrs = sh.getRange(HDR_RANGE).getValues()[0].map(function(v) { 
          return (v || '').toString().trim(); 
        });
        if (eqCaseIns_(hdrs, HEADERS)) return sh;
      } catch(_) {
        continue;
      }
    }
    
    var sh2 = ss.getActiveSheet();
    sh2.getRange(HDR_RANGE).clearContent();
    sh2.getRange(HDR_RANGE).setValues([HEADERS]).setFontWeight('bold');
    sh2.setFrozenRows(1);
    return sh2;
  } catch(e) {
    return null;
  }
}

function getTargetSheet_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var sh = sheets[i];
      try {
        var hdrs = sh.getRange(HDR_RANGE).getValues()[0].map(function(v) { 
          return (v || '').toString().trim(); 
        });
        if (eqCaseIns_(hdrs, HEADERS)) return sh;
      } catch(_) {
        continue;
      }
    }
    return null;
  } catch(e) {
    return null;
  }
}

function getCurrencyFormat_() {
  var sym = (CURRENCY === 'GBP') ? '£' : (CURRENCY === 'EUR') ? '€' : '$';
  return sym + '#,##0.00;' + sym + '-#,##0.00';
}

function eqCaseIns_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if ((a[i] || '').toLowerCase() !== (b[i] || '').toLowerCase()) return false;
  }
  return true;
}

/* ---------- Privacy actions ---------- */
function clearBGValues_() {
  try {
    var sh = getTargetSheet_(); 
    if (!sh) return;
    var last = sh.getLastRow();
    if (last < 2) return;
    sh.getRange(2, COL_ID, last - 1, HEADERS.length - 1).clearContent();
  } catch(e) {
    // Silent fail
  }
}

function hideEmailsNow_() {
  try {
    var sh = getTargetSheet_(); 
    if (!sh) return;
    if (!sh.isColumnHiddenByUser(COL_A)) sh.hideColumns(COL_A);
    
    ScriptApp.getProjectTriggers().forEach(function(t) { 
      if (t.getHandlerFunction() === REHIDE_FN) ScriptApp.deleteTrigger(t); 
    });
  } catch(e) {
    // Silent fail
  }
}

function showEmailsTemporarily_() {
  try {
    var sh = getTargetSheet_(); 
    if (!sh) return;
    if (sh.isColumnHiddenByUser(COL_A)) sh.showColumns(COL_A);
    
    ScriptApp.getProjectTriggers().forEach(function(t) { 
      if (t.getHandlerFunction() === REHIDE_FN) ScriptApp.deleteTrigger(t); 
    });
    
    ScriptApp.newTrigger(REHIDE_FN).timeBased().after(60 * 1000).create();
    SpreadsheetApp.getUi().alert('Emails visible for ~1 minute. They will auto-hide again.');
  } catch(e) {
    SpreadsheetApp.getUi().alert('Error showing emails temporarily: ' + e.message);
  }
}

function rehideEmails_() { 
  hideEmailsNow_(); 
}

function openSidebar_() {
  try {
    SpreadsheetApp.getUi().showSidebar(buildUiHtml_().setTitle('Affiliate Lookup'));
  } catch(e) {
    SpreadsheetApp.getUi().alert('Error opening sidebar: ' + e.message);
  }
}

function getCurrentUserStatus() {
  return {
    isAdmin: isAdmin_(),
    email: Session.getActiveUser().getEmail()
  };
}

function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.indexOf(email.toLowerCase()) !== -1;
}


function buildUiHtml_() {
  try {
    var htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <style>
    body { 
      font-family: system-ui, Arial, sans-serif; 
      padding: 0; 
      margin: 0; 
      width: 100%;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
    }
    
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
      padding: 30px;
      width: calc(100% - 40px);
      max-width: 600px;
      min-width: 280px;
      margin: 20px;
    }
    
    .btn { 
      padding: 12px 20px; 
      border-radius: 8px; 
      border: 2px solid #4a90e2; 
      background: #4a90e2;
      color: white;
      cursor: pointer; 
      margin: 5px; 
      font-size: 16px;
      font-weight: 600;
      transition: all 0.3s ease;
      min-width: 150px;
      -webkit-tap-highlight-color: rgba(0,0,0,0);
      touch-action: manipulation;
    }
    
    .btn:hover {
      background: #357abd;
      border-color: #357abd;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(74, 144, 226, 0.3);
    }
    
    .btn:disabled { 
      opacity: 0.6; 
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
      background: #ccc;
      border-color: #ccc;
    }
    
    .input { 
      width: 100%; 
      padding: 15px; 
      margin: 10px 0 15px; 
      border: 2px solid #e1e5e9; 
      border-radius: 8px; 
      box-sizing: border-box;
      font-size: 16px;
      transition: border-color 0.3s ease;
    }
    
    .input:focus {
      outline: none;
      border-color: #4a90e2;
      box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.1);
    }
    
    .msg { 
      margin-top: 15px; 
      font-size: 14px; 
      padding: 10px;
      border-radius: 6px;
      background: #f8f9fa;
    }
    
    .table { 
      width: 100%; 
      border-collapse: collapse; 
      font-size: 15px; 
      margin-top: 20px;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .table td { 
      padding: 15px 10px; 
      border-bottom: 1px solid #f1f3f4;
    }
    
    .table td:first-child { 
      color: #666; 
      font-weight: 500;
    }
    
    .table td:last-child { 
      text-align: right; 
      font-weight: bold; 
      color: #2d3748;
    }
    
    h2 {
      text-align: center;
      color: #2d3748;
      font-size: 28px;
      margin-bottom: 10px;
      font-weight: 700;
    }
    
    /* Responsive design */
    @media (max-width: 768px) {
      body {
        padding: 0;
      }
      
      .container {
        padding: 25px;
        margin: 15px;
        width: calc(100vw - 30px);
        max-width: none;
        border-radius: 8px;
      }
      
      .btn {
        padding: 18px 20px;
        font-size: 18px;
        width: 100%;
        margin: 8px 0;
        min-height: 56px;
      }
      
      .input {
        font-size: 18px; /* Prevent zoom on iOS */
        padding: 18px;
        min-height: 56px;
        box-sizing: border-box;
      }
      
      h2 {
        font-size: 26px;
        margin-bottom: 15px;
      }
      
      .table td {
        padding: 15px 12px;
        font-size: 16px;
      }
    }
    
    @media (max-width: 480px) {
      .container {
        padding: 20px;
        margin: 10px;
        width: calc(100vw - 20px);
        border-radius: 6px;
      }
      
      .btn {
        padding: 20px;
        font-size: 18px;
        min-height: 60px;
      }
      
      .input {
        font-size: 18px;
        padding: 20px;
        min-height: 60px;
      }
      
      h2 {
        font-size: 24px;
      }
      
      .table td {
        padding: 12px 8px;
        font-size: 15px;
      }
      
      .msg {
        font-size: 15px;
        padding: 15px;
      }
    }
    
    @media (max-width: 320px) {
      .container {
        margin: 5px;
        padding: 15px;
        width: calc(100vw - 10px);
      }
      
      h2 {
        font-size: 22px;
      }
    }
    
    /* Admin interface mobile improvements */
    @media (max-width: 768px) {
      #adminInterface .btn {
        margin: 8px 0;
        padding: 16px;
        font-size: 16px;
      }
      
      #adminInterface input, #adminInterface select {
        width: 100%;
        padding: 15px;
        font-size: 16px;
        margin: 8px 0;
        box-sizing: border-box;
      }
      
      #adminInterface h4 {
        font-size: 18px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>Affiliate Lookup</h2>
    <div style="font-size: 14px; margin-bottom: 20px; color: #666; text-align: center;">
      Enter your email address to view your affiliate information.
    </div>
    <div style="font-size: 12px; margin-bottom: 15px; padding: 10px; background: #f0f8ff; border-radius: 6px; color: #555;">
      <strong>Field Explanations:</strong><br>
      - <strong>Unpaid Amount:</strong> Total commissions not yet paid to you (includes pending + approved)<br>
      - <strong>Due Now:</strong> Approved commissions ready for immediate payout (subset of unpaid)<br>
      - <strong>Approved Commission:</strong> Total commissions that passed review (paid out + due now)
    </div>
    
    <label style="font-weight: 600; color: #2d3748; margin-bottom: 8px; display: block;">Email</label>
    <input id="email" type="email" class="input" placeholder="Enter affiliate email address" value="" />
    
    <div style="text-align: center; margin: 20px 0;">
      <button id="btnQuick" type="button" class="btn">Lookup Affiliate</button>
    </div>
    
    <div id="msg" class="msg" style="color: #333;">Enter your email address to lookup affiliate data</div>
    <hr style="margin: 20px 0; border: none; height: 1px; background: #e1e5e9;">
    
    <!-- Normal affiliate results -->
    <div id="affiliateResults" style="display: none;">
      <table id="out" class="table"><tbody></tbody></table>
    </div>
    
    <!-- Admin interface -->
  <div id="adminInterface" style="display: none;">
    <div style="margin: 15px 0; padding: 10px; border: 2px solid #ff9800; border-radius: 6px; background: #fff3e0;">
      <h4 style="margin: 0 0 10px; color: #e65100;">[ADMIN] Admin Panel</h4>
      <p style="margin: 0 0 10px; font-size: 12px; color: #666;">You can override any affiliate's data or lookup anyone's information.</p>
      
      <div style="margin: 10px 0;">
        <label style="font-weight: bold; display: block; margin-bottom: 3px;">Lookup Any Affiliate Email</label>
        <input id="adminLookupEmail" type="email" class="input" placeholder="Enter any affiliate email to manage" />
        <button id="btnAdminLookup" class="btn" style="background: #4CAF50; color: white; border-color: #4CAF50; margin-top: 5px;">Lookup & Manage</button>
        <button id="btnExitAdmin" class="btn" style="background: #607d8b; color: white; border-color: #607d8b; margin-top: 5px; margin-left: 5px;">Exit Admin Mode</button>
      </div>
    </div>
    
    <!-- Admin lookup results -->
    <div id="adminResults" style="display: none;">
      <div style="margin: 15px 0; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
        <h4 style="margin: 0 0 10px;">Current Data</h4>
        <table id="adminDataTable" class="table"><tbody></tbody></table>
      </div>
      
      <!-- Percentage Multiplier Debug Panel -->
      <div id="percentageDebugPanel" style="display: none; margin: 15px 0; padding: 12px; border: 2px solid #1976D2; border-radius: 6px; background: #F5F5F5; font-family: 'Courier New', monospace;">
        <!-- Debug info will be inserted here by JavaScript -->
      </div>
      
      <div style="margin: 15px 0; padding: 10px; border: 2px solid #2196F3; border-radius: 6px; background: #e3f2fd;">
        <h4 style="margin: 0 0 10px; color: #1976d2;">Override Values</h4>
        
        <div style="margin: 8px 0;">
          <label style="font-weight: bold; display: block; margin-bottom: 3px;">Unpaid Amount (CAD)</label>
          <input id="adminUnpaid" type="number" step="0.01" style="width: 120px; padding: 4px; border: 1px solid #ccc; border-radius: 3px;" placeholder="Leave empty for API value" />
        </div>
        
        <div style="margin: 8px 0;">
          <label style="font-weight: bold; display: block; margin-bottom: 3px;">Due Now (CAD)</label>
          <input id="adminDueNow" type="number" step="0.01" style="width: 120px; padding: 4px; border: 1px solid #ccc; border-radius: 3px;" placeholder="Leave empty for API value" />
        </div>
        
        <div style="margin: 8px 0;">
          <label style="font-weight: bold; display: block; margin-bottom: 3px;">Approved Commission (CAD)</label>
          <input id="adminApproved" type="number" step="0.01" style="width: 120px; padding: 4px; border: 1px solid #ccc; border-radius: 3px;" placeholder="Leave empty for API value" />
        </div>
        
        <div style="margin: 8px 0;">
          <label style="font-weight: bold; display: block; margin-bottom: 3px;">Last Payout</label>
          <input id="adminLastPayout" type="text" style="width: 150px; padding: 4px; border: 1px solid #ccc; border-radius: 3px;" placeholder="e.g., 2024-01-15" />
        </div>
        
        <div style="margin: 8px 0;">
          <label style="font-weight: bold; display: block; margin-bottom: 3px;">Status</label>
          <select id="adminStatus" style="width: 120px; padding: 4px; border: 1px solid #ccc; border-radius: 3px;">
            <option value="">Use API value</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        
        <hr style="margin: 15px 0; border: none; height: 1px; background: #90CAF9;">
        
        <div style="margin: 8px 0; padding: 10px; background: #FFF9C4; border-radius: 4px; border-left: 4px solid #FBC02D;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <label style="font-weight: bold; color: #F57F17; margin: 0;">
              [INFO] Percentage Multiplier
            </label>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 11px; color: #666;">Enable:</span>
              <label style="position: relative; display: inline-block; width: 44px; height: 24px; margin: 0;">
                <input type="checkbox" id="adminPercentageEnabled" style="opacity: 0; width: 0; height: 0;">
                <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 24px;"></span>
                <span style="position: absolute; cursor: pointer; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%;"></span>
              </label>
            </div>
          </div>
          <p style="font-size: 11px; margin: 0 0 8px 0; color: #666;">
            When enabled, automatically reduce displayed Unpaid and Due Now amounts by the percentage below.<br>
            Example: Enter 50 to show only 50 percent of real values. This applies to future updates only.
          </p>
          <div style="display: flex; align-items: center; gap: 5px;">
            <input id="adminPercentage" type="number" min="0" max="100" step="1" style="width: 80px; padding: 4px; border: 1px solid #ccc; border-radius: 3px;" placeholder="100" />
            <span style="font-weight: bold;">%</span>
            <span style="font-size: 11px; color: #666; margin-left: 5px;">(Leave empty or 100 for full amount)</span>
          </div>
        </div>
        
        <style>
          #adminPercentageEnabled:checked + span {
            background-color: #4CAF50 !important;
          }
          #adminPercentageEnabled:checked + span + span {
            transform: translateX(20px) !important;
          }
          #adminPercentageEnabled + span {
            background-color: #ccc;
          }
          #adminPercentageEnabled + span + span {
            transition: transform 0.4s;
          }
        </style>
        
        <div style="margin-top: 10px;">
          <button id="btnSaveAdminOverride" class="btn" style="background: #4CAF50; color: white; border-color: #4CAF50;">Save Override</button>
          <button id="btnRemoveAdminOverride" class="btn" style="background: #f44336; color: white; border-color: #f44336; margin-left: 5px;">Remove Override</button>
          <button id="btnRefreshData" class="btn" style="background: #2196F3; color: white; border-color: #2196F3; margin-left: 5px;">Refresh Data</button>
        </div>
        <div style="margin-top: 8px;">
          <button id="btnResetTracking" class="btn" style="background: #FF9800; color: white; border-color: #FF9800; font-size: 11px; padding: 4px 8px;">Reset Incremental Tracking</button>
        </div>
        <p style="font-size: 11px; color: #666; margin-top: 8px;">
          <strong>Refresh Data:</strong> Fetch latest API values and apply incremental changes<br>
          <strong>Reset Tracking:</strong> Clear all tracking data - next lookup will re-initialize baseline
        </p>
      </div>
    </div>
  </div> <!-- End container -->

  <script>
    // Immediate test - if this doesn't show, there's a syntax error before this point
    console.log('[INIT] JavaScript loading started - line 1');
    
    // Global error handler - catches any JavaScript errors
    window.onerror = function(message, source, lineno, colno, error) {
      console.error('[ERROR] GLOBAL ERROR:', message, 'at line', lineno);
      console.error('Source:', source);
      console.error('Error object:', error);
      var msgEl = document.getElementById('msg');
      if (msgEl) {
        msgEl.innerHTML = '[ERROR] JavaScript Error: ' + message + ' (line ' + lineno + ')<br>Check console for details';
        msgEl.style.color = '#d00';
        msgEl.style.display = 'block';
      }
      return false;
    };
    
    console.log('[OK] Script started loading - error handler installed');
    
    var lastLookupData = null;
    var inactivityTimer = null;
    var INACTIVITY_TIMEOUT = 300000; // 5 minutes in milliseconds
    var currentLookupEmail = null;
    var adminEmails = ['tafreed57@gmail.com', 'shehrozeps9721@gmail.com'];
    
    // Check if running as web app
    var isWebApp = window.location.href.indexOf('script.google.com') !== -1;
    var isInAdminMode = false;
    
    // Check if google.script.run is available
    console.log("google.script.run available:", typeof google !== 'undefined' && typeof google.script !== 'undefined' && typeof google.script.run !== 'undefined');
    
    function setMessage(text, color) {
      var msgEl = document.getElementById("msg");
      if (msgEl) {
        msgEl.textContent = text;
        msgEl.style.color = color || "#333";
      }
    }
    
    function addTableRow(label, value) {
      return "<tr><td>" + label + "</td><td>" + value + "</td></tr>";
    }
    
    function formatMoney(amount) {
      if (amount == null || amount === "") return "-";
      return "$" + Number(amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " CAD";
    }
    
    function doLookup() {
      console.log("doLookup called");
      
      try {
        onUserActivity(); // Restart inactivity timer
        
        var emailInput = document.getElementById("email");
        console.log("Email input element:", emailInput);
        
        var email = emailInput ? emailInput.value.trim().toLowerCase() : "";
        console.log("Email value:", email);
        
        if (!email || email.indexOf("@") === -1) {
          setMessage("Please enter a valid email address.", "#d00");
          console.log("Invalid email format");
          return;
        }
        
        currentLookupEmail = email;
        console.log("Current lookup email set to:", currentLookupEmail);
        
        // Check if entered email is an admin email
        if (adminEmails.indexOf(email) !== -1) {
          console.log("Admin email detected, showing admin interface");
          showAdminInterface();
          return;
        }
        
        // Regular affiliate lookup
        console.log("Starting regular affiliate lookup");
        setMessage("Fetching your affiliate data...", "#666");
        var btn = document.getElementById("btnQuick");
        if (btn) {
          btn.disabled = true;
          console.log("Button disabled");
        }
        
        console.log("Calling google.script.run.lookupAffiliate");
        google.script.run
          .withSuccessHandler(handleAffiliateSuccess)
          .withFailureHandler(handleFailure)
          .lookupAffiliate(email);
      } catch(error) {
        console.error("Error in doLookup:", error);
        setMessage("Error: " + error.message, "#d00");
      }
    }
    
    
    function showAdminInterface() {
      isInAdminMode = true;
      setMessage("[ADMIN] Admin Mode Active - Interface will persist. Auto-logout in 15 minutes.", "#060");
      
      // Hide normal controls
      document.getElementById("btnQuick").style.display = "none";
      document.getElementById("affiliateResults").style.display = "none";
      
      // Show admin interface
      document.getElementById("adminInterface").style.display = "block";
      
      // Use longer timeout for admin users (15 minutes instead of 5)
      INACTIVITY_TIMEOUT = 900000;
      startInactivityTimer();
    }
    
    function handleAffiliateSuccess(result) {
      var btn = document.getElementById("btnQuick");
      if (btn) btn.disabled = false;
      
      if (!result) {
        setMessage("No response from server", "#d00");
        return;
      }
      
      if (result.status === "Not found") {
        setMessage("Email not found in affiliate database", "#d00");
        return;
      }
      
      setMessage("Success! Found your affiliate data.", "#060");
      lastLookupData = result;
      
      // Show affiliate results
      document.getElementById("affiliateResults").style.display = "block";
      
      var tableBody = document.querySelector("#out tbody");
      if (tableBody) {
        var html = "";
        html += addTableRow("Affiliate ID", result.affiliateId || "-");
        html += addTableRow("Unpaid Amount", formatMoney(result.unpaidAmount));
        html += addTableRow("Due Now", formatMoney(result.dueNow));
        html += addTableRow("Approved Commission", formatMoney(result.approvedCommission));
        html += addTableRow("Last Payout", result.lastPayout || "-");
        html += addTableRow("Status", result.status || "-");
        
        // Note: Percentage multiplier indicator is hidden from regular users
        // Only admins can see it in the admin panel
        
        tableBody.innerHTML = html;
      }
      
      // Insert functionality removed - affiliate lookup only
      
      // Debug logging for commission calculation issues
      if (result._debug_data && result._debug_data.length > 0) {
        console.log('Commission Debug Data:', result._debug_data);
        console.log('Debug Totals:', result._debug_totals);
      }
    }
    
    function handleFailure(error) {
      var btn = document.getElementById("btnQuick");
      if (btn) btn.disabled = false;
      setMessage("Error: " + (error.message || error.toString() || "Unknown error"), "#d00");
    }
    
    // Insert functionality removed for simplified interface
    
    // Complete privacy reset for multi-user protection
    function resetAllData(forceReset) {
      // If in admin mode and not forced, only do light reset
      if (isInAdminMode && !forceReset) {
        return;
      }
      
      lastLookupData = null;
      currentLookupEmail = null;
      isInAdminMode = false;
      
      var emailInput = document.getElementById("email");
      var btnQuick = document.getElementById("btnQuick");
      var tableBody = document.querySelector("#out tbody");
      var affiliateResults = document.getElementById("affiliateResults");
      var adminInterface = document.getElementById("adminInterface");
      var adminResults = document.getElementById("adminResults");
      
      if (emailInput) {
        emailInput.value = "";
        // Don't blur - let user interact with field
      }
      if (btnQuick) {
        btnQuick.disabled = false;
        btnQuick.style.display = "inline-block";
      }
      if (tableBody) tableBody.innerHTML = "";
      if (affiliateResults) affiliateResults.style.display = "none";
      if (adminInterface) adminInterface.style.display = "none";
      if (adminResults) adminResults.style.display = "none";
      
      // Reset timeout to normal
      INACTIVITY_TIMEOUT = 300000; // 5 minutes
      
      setMessage("Enter your email address to lookup affiliate data", "#333");
      
      // Clear any stored data in browser
      if (typeof(Storage) !== "undefined") {
        sessionStorage.clear();
        localStorage.removeItem('lastLookupData');
        localStorage.removeItem('affiliateEmail');
      }
      
      // Clear inactivity timer
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
    }
    
    // Force reset (for security when needed)
    function forceResetAllData() {
      resetAllData(true);
    }
    
    // Auto-clear after inactivity for security
    function startInactivityTimer() {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
      }
      inactivityTimer = setTimeout(function() {
        forceResetAllData();
        setMessage("Session cleared for privacy", "#999");
      }, INACTIVITY_TIMEOUT);
    }
    
    // Restart timer on any user activity
    function onUserActivity() {
      startInactivityTimer();
    }
    
    // Admin functions
    function doAdminLookup() {
      var adminEmailInput = document.getElementById("adminLookupEmail");
      var targetEmail = adminEmailInput ? adminEmailInput.value.trim() : "";
      
      if (!targetEmail || targetEmail.indexOf("@") === -1) {
        setMessage("Please enter a valid affiliate email to manage.", "#d00");
        return;
      }
      
      setMessage("Fetching affiliate data for management...", "#666");
      var btn = document.getElementById("btnAdminLookup");
      if (btn) btn.disabled = true;
      
      google.script.run
        .withSuccessHandler(handleAdminLookupSuccess)
        .withFailureHandler(handleAdminLookupFailure)
        .lookupAffiliate(targetEmail);
    }
    
    function handleAdminLookupSuccess(result) {
      var btn = document.getElementById("btnAdminLookup");
      if (btn) btn.disabled = false;
      
      console.log("=== ADMIN LOOKUP RESULT ===");
      console.log("Full result object:", result);
      console.log("Incremental debug info:", result._incremental_debug);
      console.log("Percentage applied:", result._percentage_applied);
      
      if (!result) {
        setMessage("No response from server", "#d00");
        return;
      }
      
      if (result.status === "Not found") {
        setMessage("Affiliate not found in database", "#d00");
        document.getElementById("adminResults").style.display = "none";
        return;
      }
      
      var targetEmail = document.getElementById("adminLookupEmail").value.trim();
      setMessage("Affiliate found. You can now override their data.", "#060");
      
      // Show current data
      var adminTableBody = document.querySelector("#adminDataTable tbody");
      if (adminTableBody) {
        var html = "";
        html += addTableRow("Affiliate ID", result.affiliateId || "-");
        html += addTableRow("Unpaid Amount", formatMoney(result.unpaidAmount));
        html += addTableRow("Due Now", formatMoney(result.dueNow));
        html += addTableRow("Approved Commission", formatMoney(result.approvedCommission));
        html += addTableRow("Last Payout", result.lastPayout || "-");
        html += addTableRow("Status", result.status || "-");
        if (result._admin_override) {
          html += addTableRow("", "<span style='color: #ff6b35; font-weight: bold;'>[!] Has Override</span>");
        }
        if (result._percentage_applied) {
          html += "<tr><td colspan='2' style='background: #FFF9C4; border-left: 4px solid #FBC02D; padding: 8px; font-size: 11px;'>";
          html += "<strong>[INFO] Percentage Multiplier:</strong> " + result._percentage_applied + " currently applied";
          html += "</td></tr>";
        }
        adminTableBody.innerHTML = html;
      }
      
      // Show debug panel for incremental tracking
      var debugPanel = document.getElementById("percentageDebugPanel");
      if (debugPanel && result._incremental_debug) {
        var debug = result._incremental_debug;
        var debugHtml = "<h4 style='margin: 0 0 10px 0; color: #1976D2;'>[DEBUG] Incremental Tracking Debug Info</h4>";
        
        if (debug.isFirstLookup) {
          // First lookup - show baseline initialization
          debugHtml += "<div style='background: #E3F2FD; padding: 10px; border-radius: 4px; border-left: 4px solid #2196F3; margin-bottom: 10px;'>";
          debugHtml += "<strong style='color: #1565C0;'>[NEW] FIRST LOOKUP - Baseline Initialized</strong><br>";
          debugHtml += "<div style='margin-top: 8px; font-size: 12px;'>";
          
          if (debug.emailPercentage !== null) {
            debugHtml += "<strong style='color: #F57F17;'>[EMAIL] Email Baseline Detected:</strong> " + debug.emailPercentage + " percent<br>";
            debugHtml += "<hr style='margin: 8px 0; border: none; height: 1px; background: #BBDEFB;'>";
            debugHtml += "<strong>Real API Values:</strong><br>";
            debugHtml += "- Unpaid: $" + debug.currentApiUnpaid.toFixed(2) + "<br>";
            debugHtml += "- Due Now: $" + debug.currentApiDueNow.toFixed(2) + "<br>";
            debugHtml += "<strong style='color: #1565C0;'>Baseline Applied (" + debug.emailPercentage + " percent):</strong><br>";
            debugHtml += "- Unpaid: $" + debug.currentApiUnpaid.toFixed(2) + " * " + (debug.emailPercentage/100) + " = $" + debug.baselineUnpaid.toFixed(2) + "<br>";
            debugHtml += "- Due Now: $" + debug.currentApiDueNow.toFixed(2) + " * " + (debug.emailPercentage/100) + " = $" + debug.baselineDueNow.toFixed(2) + "<br>";
            debugHtml += "<hr style='margin: 8px 0; border: none; height: 1px; background: #BBDEFB;'>";
            debugHtml += "<strong style='color: #2E7D32;'>User Sees:</strong><br>";
            debugHtml += "- Unpaid: $" + debug.displayedUnpaid.toFixed(2) + "<br>";
            debugHtml += "- Due Now: $" + debug.displayedDueNow.toFixed(2) + "<br>";
          } else {
            debugHtml += "<strong style='color: #2E7D32;'>[OK] No Email Baseline - Showing 100 percent</strong><br>";
            debugHtml += "<small style='color: #666;'>Email has no percentage pattern (e.g., name50percent at domain.com)</small><br>";
            debugHtml += "<hr style='margin: 8px 0; border: none; height: 1px; background: #BBDEFB;'>";
            debugHtml += "<strong>API Values = Displayed (100 percent):</strong><br>";
            debugHtml += "- Unpaid: $" + debug.currentApiUnpaid.toFixed(2) + " <span style='color: #2E7D32;'>(100 percent of real value)</span><br>";
            debugHtml += "- Due Now: $" + debug.currentApiDueNow.toFixed(2) + " <span style='color: #2E7D32;'>(100 percent of real value)</span><br>";
          }
          
          debugHtml += "<small style='color: #666; margin-top: 8px; display: block;'>Next lookup will apply incremental changes to these baseline values.</small>";
          debugHtml += "</div></div>";
          
        } else {
          // Subsequent lookup - show incremental changes
          debugHtml += "<div style='background: #E8F5E9; padding: 10px; border-radius: 4px; border-left: 4px solid #4CAF50; margin-bottom: 10px;'>";
          debugHtml += "<strong style='color: #2E7D32;'>[UPDATE] INCREMENTAL UPDATE</strong><br>";
          debugHtml += "<div style='margin-top: 8px; font-size: 12px;'>";
          
          if (debug.emailPercentage !== null) {
            debugHtml += "<strong style='color: #F57F17;'>[EMAIL] Email Baseline:</strong> " + debug.emailPercentage + " percent<br>";
          } else {
            debugHtml += "<strong style='color: #2E7D32;'>[EMAIL] Email Baseline:</strong> None (100 percent of API values)<br>";
          }
          
          debugHtml += "<hr style='margin: 8px 0; border: none; height: 1px; background: #C8E6C9;'>";
          debugHtml += "<strong>API Value Changes:</strong><br>";
          debugHtml += "- Unpaid: $" + debug.previousApiUnpaid.toFixed(2) + " -> $" + debug.currentApiUnpaid.toFixed(2);
          debugHtml += " <strong style='color: " + (debug.deltaUnpaid >= 0 ? "#2E7D32" : "#C62828") + ";'>";
          debugHtml += "(" + (debug.deltaUnpaid >= 0 ? "+" : "") + "$" + debug.deltaUnpaid.toFixed(2) + ")</strong><br>";
          
          debugHtml += "- Due Now: $" + debug.previousApiDueNow.toFixed(2) + " -> $" + debug.currentApiDueNow.toFixed(2);
          debugHtml += " <strong style='color: " + (debug.deltaDueNow >= 0 ? "#2E7D32" : "#C62828") + ";'>";
          debugHtml += "(" + (debug.deltaDueNow >= 0 ? "+" : "") + "$" + debug.deltaDueNow.toFixed(2) + ")</strong><br>";
          
          if (debug.adminMultiplierActive) {
            debugHtml += "<hr style='margin: 8px 0; border: none; height: 1px; background: #C8E6C9;'>";
            debugHtml += "<strong style='color: #F57F17;'>[ADMIN] Admin Multiplier Active:</strong> " + debug.adminPercentage + " percent<br>";
            debugHtml += "<strong>Adjusted Changes (shown to user):</strong><br>";
            debugHtml += "- Unpaid: $" + debug.deltaUnpaid.toFixed(2) + " * " + (debug.adminPercentage/100) + " = $" + debug.adjustedDeltaUnpaid.toFixed(2) + "<br>";
            debugHtml += "- Due Now: $" + debug.deltaDueNow.toFixed(2) + " * " + (debug.adminPercentage/100) + " = $" + debug.adjustedDeltaDueNow.toFixed(2) + "<br>";
          } else {
            debugHtml += "<hr style='margin: 8px 0; border: none; height: 1px; background: #C8E6C9;'>";
            debugHtml += "<strong>Admin Multiplier:</strong> Not active (100 percent of changes shown)<br>";
          }
          
          debugHtml += "<hr style='margin: 8px 0; border: none; height: 1px; background: #C8E6C9;'>";
          debugHtml += "<strong style='color: #2E7D32;'>User Sees (Incremental):</strong><br>";
          debugHtml += "- Unpaid: $" + debug.previousDisplayedUnpaid.toFixed(2) + " + $" + debug.adjustedDeltaUnpaid.toFixed(2) + " = <strong>$" + debug.displayedUnpaid.toFixed(2) + "</strong><br>";
          debugHtml += "- Due Now: $" + debug.previousDisplayedDueNow.toFixed(2) + " + $" + debug.adjustedDeltaDueNow.toFixed(2) + " = <strong>$" + debug.displayedDueNow.toFixed(2) + "</strong><br>";
          
          debugHtml += "</div></div>";
        }
        
        debugPanel.innerHTML = debugHtml;
        debugPanel.style.display = "block";
      } else if (debugPanel) {
        debugPanel.style.display = "none";
      }
      
      // Show admin results section
      document.getElementById("adminResults").style.display = "block";
      
      // Load existing overrides
      google.script.run
        .withSuccessHandler(loadAdminOverrides)
        .getExistingOverride(targetEmail);
    }
    
    function handleAdminLookupFailure(error) {
      var btn = document.getElementById("btnAdminLookup");
      if (btn) btn.disabled = false;
      setMessage("Error: " + (error.message || error.toString() || "Unknown error"), "#d00");
    }
    
    function loadAdminOverrides(override) {
      if (!override) return;
      
      if (override.unpaidAmount !== undefined) {
        document.getElementById("adminUnpaid").value = override.unpaidAmount;
      }
      if (override.dueNow !== undefined) {
        document.getElementById("adminDueNow").value = override.dueNow;
      }
      if (override.approvedCommission !== undefined) {
        document.getElementById("adminApproved").value = override.approvedCommission;
      }
      if (override.lastPayout !== undefined) {
        document.getElementById("adminLastPayout").value = override.lastPayout;
      }
      if (override.status !== undefined) {
        document.getElementById("adminStatus").value = override.status;
      }
      if (override.percentageMultiplier !== undefined) {
        document.getElementById("adminPercentage").value = override.percentageMultiplier;
      }
      if (override.percentageEnabled !== undefined) {
        document.getElementById("adminPercentageEnabled").checked = override.percentageEnabled;
      }
    }
    
    function saveAdminOverride() {
      console.log("saveAdminOverride called");
      
      var targetEmail = document.getElementById("adminLookupEmail").value.trim();
      console.log("Target email:", targetEmail);
      
      if (!targetEmail) {
        setMessage("No affiliate selected", "#d00");
        console.log("No email - returning");
        return;
      }
      
      var override = {};
      var hasChanges = false;
      
      var unpaid = document.getElementById("adminUnpaid").value;
      console.log("Unpaid value:", unpaid);
      if (unpaid !== "") {
        override.unpaidAmount = parseFloat(unpaid);
        hasChanges = true;
      }
      
      var dueNow = document.getElementById("adminDueNow").value;
      console.log("DueNow value:", dueNow);
      if (dueNow !== "") {
        override.dueNow = parseFloat(dueNow);
        hasChanges = true;
      }
      
      var approved = document.getElementById("adminApproved").value;
      console.log("Approved value:", approved);
      if (approved !== "") {
        override.approvedCommission = parseFloat(approved);
        hasChanges = true;
      }
      
      var lastPayout = document.getElementById("adminLastPayout").value;
      console.log("LastPayout value:", lastPayout);
      if (lastPayout !== "") {
        override.lastPayout = lastPayout;
        hasChanges = true;
      }
      
      var status = document.getElementById("adminStatus").value;
      console.log("Status value:", status);
      if (status !== "") {
        override.status = status;
        hasChanges = true;
      }
      
      var percentage = document.getElementById("adminPercentage").value;
      var percentageEnabled = document.getElementById("adminPercentageEnabled").checked;
      console.log("=== PERCENTAGE MULTIPLIER SAVE ===");
      console.log("Percentage value:", percentage);
      console.log("Toggle enabled:", percentageEnabled);
      console.log("Toggle element checked:", document.getElementById("adminPercentageEnabled").checked);
      
      if (percentage !== "" || percentageEnabled !== undefined) {
        var pct = parseFloat(percentage);
        if (percentage === "" || (pct >= 0 && pct <= 100)) {
          if (percentage !== "") {
            override.percentageMultiplier = pct;
          }
          override.percentageEnabled = percentageEnabled;
          hasChanges = true;
          console.log("Percentage multiplier set:", pct, "Enabled:", percentageEnabled);
        } else {
          console.log("Percentage out of range:", pct);
        }
      }
      
      console.log("HasChanges:", hasChanges);
      console.log("Override object:", override);
      
      if (!hasChanges) {
        setMessage("No override values set", "#d00");
        console.log("No changes - returning");
        return;
      }
      
      setMessage("Saving override...", "#666");
      console.log("Calling saveAffiliateOverride with:", targetEmail, override);
      
      try {
        google.script.run
          .withSuccessHandler(function(success) {
            console.log("Save success handler called:", success);
            if (success) {
              setMessage("Override saved! Refreshing data...", "#060");
              // Automatically refresh the affiliate data to show the new values
              setTimeout(function() {
                console.log("Auto-refreshing affiliate data after save");
                google.script.run
                  .withSuccessHandler(handleAdminLookupSuccess)
                  .withFailureHandler(handleAdminLookupFailure)
                  .lookupAffiliate(targetEmail);
              }, 500);
            } else {
              setMessage("Failed to save override", "#d00");
            }
          })
          .withFailureHandler(function(error) {
            console.error("Save failure handler called:", error);
            setMessage("Error saving: " + (error.message || error.toString()), "#d00");
          })
          .saveAffiliateOverride(targetEmail, override);
      } catch(e) {
        console.error("Exception calling google.script.run:", e);
        setMessage("Error: " + e.message, "#d00");
      }
    }
    
    function removeAdminOverride() {
      var targetEmail = document.getElementById("adminLookupEmail").value.trim();
      if (!targetEmail) {
        setMessage("No affiliate selected", "#d00");
        return;
      }
      
      if (!confirm("Remove all overrides for " + targetEmail + "?")) {
        return;
      }
      
      setMessage("Removing override...", "#666");
      
      google.script.run
        .withSuccessHandler(function(success) {
          if (success) {
            setMessage("Override removed! Refreshing data...", "#060");
            // Clear form
            document.getElementById("adminUnpaid").value = "";
            document.getElementById("adminDueNow").value = "";
            document.getElementById("adminApproved").value = "";
            document.getElementById("adminLastPayout").value = "";
            document.getElementById("adminStatus").value = "";
            document.getElementById("adminPercentage").value = "";
            document.getElementById("adminPercentageEnabled").checked = false;
            
            // Automatically refresh the affiliate data to show real API values
            setTimeout(function() {
              console.log("Auto-refreshing affiliate data after removing override");
              google.script.run
                .withSuccessHandler(handleAdminLookupSuccess)
                .withFailureHandler(handleAdminLookupFailure)
                .lookupAffiliate(targetEmail);
            }, 500);
          } else {
            setMessage("Failed to remove override", "#d00");
          }
        })
        .withFailureHandler(function(error) {
          setMessage("Error removing: " + error.message, "#d00");
        })
        .removeAffiliateOverride(targetEmail);
    }
    
    function exitAdminMode() {
      if (confirm("Exit admin mode? This will clear all data and return to normal interface.")) {
        forceResetAllData();
      }
    }

    // Initialize when page loads
    window.addEventListener('load', function() {
      console.log("Page loaded, setting up...");
      resetAllData();
      
      // Additional privacy: Reset on visibility change (tab switching) - but not during admin work
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
          // Only reset if not in admin mode or after long period
          if (!isInAdminMode) {
            resetAllData();
          }
        }
      });
      
      // Privacy: Reset on focus (when window becomes active) - gentle for admins
      window.addEventListener('focus', function() {
        if (!isInAdminMode) {
          resetAllData();
        }
      });
      
      // Privacy: Clear data when leaving page (always force)
      window.addEventListener('beforeunload', function() {
        forceResetAllData();
      });
      
      // Privacy: Reset on any page refresh/reload from cache (always force)
      window.addEventListener('pageshow', function(event) {
        // Only reset if page is loaded from cache (back/forward button)
        if (event.persisted) {
          console.log("Page loaded from cache, resetting data");
          forceResetAllData();
        }
      });
      
      // Start inactivity timer for auto-clear
      startInactivityTimer();
      
      // Track user activity to restart timer
      ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(function(event) {
        document.addEventListener(event, onUserActivity, true);
      });
      
      // Add event listeners
      var btnQuick = document.getElementById("btnQuick");
      console.log("btnQuick found:", !!btnQuick);
      
      if (btnQuick) {
        btnQuick.addEventListener("click", function(e) {
          console.log("Lookup button clicked!");
          e.preventDefault(); // Prevent any default behavior
          e.stopPropagation(); // Stop event from bubbling
          try {
            doLookup();
          } catch(error) {
            console.error("Error in doLookup:", error);
            setMessage("Error: " + error.message, "#d00");
          }
        });
        console.log("Event listener attached to btnQuick");
      } else {
        console.error("btnQuick button not found!");
      }
      
      // Insert button functionality removed
      
      // Add admin event listeners
      var btnAdminLookup = document.getElementById("btnAdminLookup");
      var btnSaveAdmin = document.getElementById("btnSaveAdminOverride");
      var btnRemoveAdmin = document.getElementById("btnRemoveAdminOverride");
      var btnExitAdmin = document.getElementById("btnExitAdmin");
      var adminLookupEmail = document.getElementById("adminLookupEmail");
      
      if (btnAdminLookup) {
        btnAdminLookup.addEventListener("click", doAdminLookup);
      }
      if (btnSaveAdmin) {
        console.log("Save Admin button found, adding listener");
        btnSaveAdmin.addEventListener("click", function() {
          console.log("Save Admin button clicked!");
          saveAdminOverride();
        });
      } else {
        console.log("Save Admin button NOT found");
      }
      if (btnRemoveAdmin) {
        btnRemoveAdmin.addEventListener("click", removeAdminOverride);
      }
      var btnRefreshData = document.getElementById("btnRefreshData");
      if (btnRefreshData) {
        btnRefreshData.addEventListener("click", function() {
          console.log("Refresh Data button clicked!");
          var targetEmail = document.getElementById("adminLookupEmail").value.trim();
          if (targetEmail) {
            setMessage("Refreshing data from API...", "#666");
            google.script.run
              .withSuccessHandler(handleAdminLookupSuccess)
              .withFailureHandler(handleAdminLookupFailure)
              .lookupAffiliate(targetEmail);
          } else {
            setMessage("Please enter an email first", "#d00");
          }
        });
      }
      var btnResetTracking = document.getElementById("btnResetTracking");
      if (btnResetTracking) {
        btnResetTracking.addEventListener("click", function() {
          var targetEmail = document.getElementById("adminLookupEmail").value.trim();
          if (targetEmail) {
            if (confirm("Reset incremental tracking for " + targetEmail + "?\n\nThis will:\n- Clear all tracking history\n- Next lookup will re-initialize baseline\n- Email percentage (if any) will be re-applied")) {
              console.log("Resetting tracking for:", targetEmail);
              setMessage("Resetting tracking...", "#666");
              google.script.run
                .withSuccessHandler(function(success) {
                  if (success) {
                    setMessage("Tracking reset! Click 'Refresh Data' to reinitialize.", "#060");
                    // Auto-refresh to show reset
                    setTimeout(function() {
                      google.script.run
                        .withSuccessHandler(handleAdminLookupSuccess)
                        .withFailureHandler(handleAdminLookupFailure)
                        .lookupAffiliate(targetEmail);
                    }, 500);
                  } else {
                    setMessage("Failed to reset tracking", "#d00");
                  }
                })
                .withFailureHandler(function(error) {
                  setMessage("Error: " + error.message, "#d00");
                })
                .resetIncrementalTracking(targetEmail);
            }
          } else {
            setMessage("Please enter an email first", "#d00");
          }
        });
      }
      if (btnExitAdmin) {
        btnExitAdmin.addEventListener("click", exitAdminMode);
      }
      if (adminLookupEmail) {
        adminLookupEmail.addEventListener("keypress", function(e) {
          if (e.key === "Enter") doAdminLookup();
        });
      }
      
      var emailInput = document.getElementById("email");
      if (emailInput) {
        emailInput.addEventListener("keypress", function(e) {
          if (e.key === "Enter") {
            e.preventDefault();
            console.log("Enter key pressed in email field");
            doLookup();
          }
        });
        
        // Enhanced privacy: Clear previous data when email field is touched (but only if there's data to clear)
        emailInput.addEventListener("focus", function() {
          if (!isInAdminMode && lastLookupData !== null) {
            // Only reset if there's existing data, don't clear the input field on focus
            lastLookupData = null;
            var tableBody = document.querySelector("#out tbody");
            var affiliateResults = document.getElementById("affiliateResults");
            if (tableBody) tableBody.innerHTML = "";
            if (affiliateResults) affiliateResults.style.display = "none";
            setMessage("Enter your email address to lookup affiliate data", "#333");
          }
        });
        
        // Clear previous results when email changes for privacy (gentle for admins)
        emailInput.addEventListener("input", function() {
          if (isInAdminMode) {
            // In admin mode, only clear if field is completely empty
            if (emailInput.value.trim() === "") {
              forceResetAllData();
            }
            return;
          }
          
          // Normal behavior for regular users
          lastLookupData = null;
          var tableBody = document.querySelector("#out tbody");
          var affiliateResults = document.getElementById("affiliateResults");
          if (tableBody) tableBody.innerHTML = "";
          if (affiliateResults) affiliateResults.style.display = "none";
          setMessage("Enter your email address to lookup affiliate data", "#333");
        });
      }
    });
  </script>
</body>
</html>`;

    Logger.log('HTML content generated successfully, length: ' + htmlContent.length);
    Logger.log('HTML content starts with: ' + htmlContent.substring(0, 100));
    
    var output = HtmlService.createHtmlOutput(htmlContent);
    Logger.log('HtmlService output created successfully');
    return output;
  } catch(e) {
    Logger.log('Error building HTML: ' + e.message);
    if (e.lineNumber) Logger.log('At line: ' + e.lineNumber);
    if (e.stack) Logger.log('Stack: ' + e.stack);
    
    // Return a simple error page if template fails
    return HtmlService.createHtmlOutput(
      '<html><head><title>Error</title></head><body>' +
      '<h1 style="color: red;">Error Loading Page</h1>' +
      '<p><strong>Error:</strong> ' + e.message + '</p>' +
      '<p><strong>Line:</strong> ' + (e.lineNumber || 'Unknown') + '</p>' +
      '<p>Please check the Apps Script execution logs for more details.</p>' +
      '<p><a href="#" onclick="location.reload()">Try Reloading</a></p>' +
      '</body></html>'
    );
  }
}

// Admin panel server functions

function getExistingOverride(email) {
  if (!isAdmin_()) {
    return null;
  }
  
  return getAdminOverride_(email);
}

function saveAffiliateOverride(email, overrideData) {
  if (!isAdmin_()) {
    return false;
  }
  
  return setAdminOverride_(email, overrideData);
}

function removeAffiliateOverride(email) {
  if (!isAdmin_()) {
    return false;
  }
  
  try {
    var key = getAdminOverrideKey_(email);
    PropertiesService.getScriptProperties().deleteProperty(key);
    return true;
  } catch(e) {
    console.error('Error removing override:', e);
    return false;
  }
}

/**
 * Resets incremental tracking data for an affiliate
 * Admin-only function - clears all tracking history
 * Next lookup will re-initialize baseline
 */
function resetIncrementalTracking(email) {
  if (!isAdmin_()) {
    Logger.log("Unauthorized attempt to reset tracking");
    return false;
  }
  
  Logger.log("Admin resetting incremental tracking for: " + email);
  var result = deleteIncrementalTracking_(email);
  if (result) {
    Logger.log("✅ Successfully deleted tracking for: " + email);
  } else {
    Logger.log("❌ Failed to delete tracking for: " + email);
  }
  return result;
}

/**
 * Reset ALL incremental tracking data (admin only)
 * Use when switching data sources or clearing legacy data
 */
function resetAllIncrementalTracking() {
  if (!isAdmin_()) {
    Logger.log("Unauthorized attempt to reset all tracking");
    return { success: false, error: "Unauthorized" };
  }
  
  try {
    Logger.log("=== RESETTING ALL INCREMENTAL TRACKING ===");
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var deletedCount = 0;
    
    // Find and delete all properties starting with "INCREMENTAL_TRACKING_"
    for (var key in allProps) {
      if (key.indexOf('INCREMENTAL_TRACKING_') === 0) {
        props.deleteProperty(key);
        deletedCount++;
        Logger.log("Deleted: " + key);
      }
    }
    
    Logger.log("✅ Reset complete! Deleted " + deletedCount + " tracking entries");
    return { success: true, count: deletedCount };
    
  } catch (e) {
    Logger.log("❌ Error resetting all tracking: " + e.message);
    return { success: false, error: e.message };
  }
}

// Public function to get tracking data for debugging
function getTrackingDebugInfo(email) {
  if (!isAdmin_()) {
    return { error: 'Unauthorized' };
  }
  
  var tracking = getIncrementalTracking_(email);
  var override = getAdminOverride_(email);
  
  return {
    hasTracking: tracking !== null,
    tracking: tracking,
    hasOverride: override !== null,
    override: override,
    email: email
  };
}

// Get RAW API data without any modifications (no baseline, no tracking, no overrides)
function getRawApiData(email) {
  if (!isAdmin_()) {
    return { error: 'Unauthorized' };
  }
  
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) return { error: 'Missing API key' };
    
    // Fetch affiliate
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp) return { error: 'No response from API' };
    
    var code = affResp.getResponseCode();
    if (code !== 200) return { error: 'HTTP ' + code };
    
    var payload = safeParseJson_(affResp.getContentText());
    if (!payload) return { error: 'Invalid JSON' };
    
    var aff = extractAffiliate_(payload);
    if (!aff || !aff.id) return { error: 'Affiliate not found' };
    
    // Get commission totals
    var totals = sumDueNowForAffiliate_(aff.id, apiKey);
    
    // Check for balance fields
    var balanceFields = {
      unpaid_balance: aff.unpaid_balance,
      due_balance: aff.due_balance,
      approved_balance: aff.approved_balance,
      commissions_balance: aff.commissions_balance,
      balance: aff.balance
    };
    
    return {
      email: email,
      affiliateId: aff.id,
      rawApiFields: balanceFields,
      calculatedFromCommissions: {
        paid: totals.paid,
        unpaid: totals.unpaid,
        dueNow: totals.dueNow,
        lastPayout: totals.lastPayoutAt
      },
      currency: aff.currency || 'USD',
      status: aff.status || aff.state || 'unknown',
      _debug_http: totals._debug_http
    };
  } catch(e) {
    return { error: e.message, stack: e.stack };
  }
}


function forceAuthorize_() {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) { 
      SpreadsheetApp.getUi().alert('Missing AFFILIATE_API_KEY in Script properties.'); 
      return; 
    }
    
    UrlFetchApp.fetch(BASE_URL + '/_noop', { 
      method: 'get', 
      headers: authHeaders_(apiKey, 'bearer'), 
      muteHttpExceptions: true 
    });
    
    SpreadsheetApp.getUi().alert('Authorization completed. Reload the sheet and try again.');
  } catch(e) {
    SpreadsheetApp.getUi().alert('Authorization error: ' + e.message);
  }
}

function insertLookupIntoRow_(email, res) {
  try {
    if (!email || !res) {
      return { success: false, error: 'Invalid parameters' };
    }
    
    // Check if the lookup was successful first
    if (res.status === 'Not found') {
      return { success: false, error: 'Email not found in affiliate database' };
    }
    
    var sh = getTargetSheet_(); 
    if (!sh) {
      return { success: false, error: 'Target sheet not found' };
    }
    
    var row = findRowByEmail_(sh, email); 
    
    // If email not found in sheet, add it as a new row
    if (row < 2) {
      row = addNewEmailRow_(sh, email);
      if (row < 2) {
        return { success: false, error: 'Failed to add new row' };
      }
    }
    
    writeRow_(sh, row, res);
    return { success: true, message: 'Data added successfully!' };
    
  } catch(e) {
    console.error('Error in insertLookupIntoRow_:', e);
    return { success: false, error: e.message };
  }
}

function insertFromSidebarPrompt_() {
  try {
    var ui = SpreadsheetApp.getUi();
    var resp = ui.prompt('Insert into which email row?', ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    
    var email = String(resp.getResponseText() || '').trim();
    if (!email || email.indexOf('@') === -1) { 
      ui.alert('Enter a valid email.'); 
      return; 
    }
    
    var sh = getTargetSheet_(); 
    if (!sh) { 
      ui.alert('Headers not found.'); 
      return; 
    }
    
    var row = findRowByEmail_(sh, email);
    if (row < 2) { 
      ui.alert('Email not found: ' + email); 
      return; 
    }
    
    var res = fetchByEmail_(email);
    writeRow_(sh, row, res);
    ui.alert('Inserted row ' + row + ' for ' + email + '.');
    
  } catch(e) {
    console.error('Error in insertFromSidebarPrompt_:', e);
    SpreadsheetApp.getUi().alert('Error: ' + e.message);
  }
}

function refreshSelectedRows() {
  try {
    var sh = getTargetSheet_(); 
    if (!sh) return;
    
    var r = SpreadsheetApp.getActive().getActiveRange();
    if (!r || r.getSheet().getSheetId() !== sh.getSheetId()) {
      SpreadsheetApp.getUi().alert('Select rows on the target sheet.');
      return;
    }
    
    var vals = r.getValues();
    for (var i = 0; i < vals.length; i++) {
      var rowVals = vals[i];
      var email = (rowVals[COL_EMAIL - 1] || '').toString().trim();
      if (email && email.indexOf('@') !== -1) {
        try {
          var out = fetchByEmail_(email);
          writeRow_(sh, r.getRow() + i, out);
          Utilities.sleep(RATE_LIMIT_DELAY_MS);
        } catch(e) {
          console.error('Error refreshing row for', email, ':', e);
        }
      }
    }
  } catch(e) {
    console.error('Error in refreshSelectedRows:', e);
    SpreadsheetApp.getUi().alert('Error: ' + e.message);
  }
}

function refreshAllRows() {
  try {
    var sh = getTargetSheet_(); 
    if (!sh) return;
    
    var last = sh.getLastRow();
    for (var row = 2; row <= last; row++) {
      try {
        var email = (sh.getRange(row, COL_EMAIL).getValue() || '').toString().trim();
        if (email && email.indexOf('@') !== -1) {
          var out = fetchByEmail_(email);
          writeRow_(sh, row, out);
          Utilities.sleep(RATE_LIMIT_DELAY_MS);
        }
      } catch(e) {
        console.error('Error refreshing row', row, ':', e);
      }
    }
  } catch(e) {
    console.error('Error in refreshAllRows:', e);
    SpreadsheetApp.getUi().alert('Error: ' + e.message);
  }
}

function findRowByEmail_(sheet, email) {
  if (!sheet || !email) return -1;
  
  try {
    var data = sheet.getRange('A:A').getValues();
    var searchEmail = email.toLowerCase().trim();
    
    for (var i = 2; i <= data.length; i++) {
      var cellValue = data[i - 1][0];
      if (cellValue) {
        var v = cellValue.toString().trim().toLowerCase();
        if (v === searchEmail) return i;
      }
    }
    return -1;
  } catch(e) {
    console.error('Error in findRowByEmail_:', e);
    return -1;
  }
}

function addNewEmailRow_(sheet, email) {
  if (!sheet || !email) return -1;
  
  try {
    var lastRow = sheet.getLastRow();
    var newRow = lastRow + 1;
    
    // Add the email to column A
    sheet.getRange(newRow, COL_EMAIL).setValue(email);
    
    return newRow;
  } catch(e) {
    console.error('Error in addNewEmailRow_:', e);
    return -1;
  }
}

function writeRow_(sh, row, data) {
  if (!sh || !row || !data) return;
  
  try {
    var out = [[
      data.affiliateId || '',
      toNum_(data.unpaidAmount),
      toNum_(data.dueNow),
      toNum_(data.approvedCommission),
      data.lastPayout || '',
      data.status || '',
      new Date().toISOString()
    ]];
    
    sh.getRange(row, COL_ID, 1, HEADERS.length - 1).setValues(out);
    
    var currencyFmt = getCurrencyFormat_();
    sh.getRange(row, COL_UNPAID, 1, 1).setNumberFormat(currencyFmt);
    sh.getRange(row, COL_DUE_NOW, 1, 1).setNumberFormat(currencyFmt);
    sh.getRange(row, COL_PAID, 1, 1).setNumberFormat(currencyFmt);
    sh.getRange(row, COL_LAST, 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    
    var unpaidValue = Number(data.unpaidAmount || 0);
    var dueNowValue = Number(data.dueNow || 0);
    sh.getRange(row, COL_UNPAID).setBackground(unpaidValue > 0 ? '#ffe5cc' : null);
    sh.getRange(row, COL_DUE_NOW).setBackground(dueNowValue > 0 ? '#ffcccc' : null);
    
  } catch(e) {
    console.error('Error in writeRow_:', e);
    throw new Error('Failed to write row: ' + e.message);
  }
}

function debugShowForEmail_() {
  try {
    var ui = SpreadsheetApp.getUi();
    var resp = ui.prompt('Enter affiliate email to debug:', ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    
    var email = String(resp.getResponseText() || '').trim();
    if (!email || email.indexOf('@') === -1) {
      ui.alert('Enter a valid email.');
      return;
    }

    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) {
      ui.alert('Missing AFFILIATE_API_KEY in Script properties.');
      return;
    }

    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email);
    var r = fetchWithRetry_(affUrl, apiKey);
    
    console.log('=== Debug for email:', email, '===');
    console.log('Affiliate lookup code:', r ? r.getResponseCode() : 'NO RESPONSE');
    
    if (r) {
      var content = r.getContentText();
      console.log('Affiliate lookup body:', content.slice(0, 1000));
    }

    if (r && r.getResponseCode() >= 200 && r.getResponseCode() < 300) {
      var payload = safeParseJson_(r.getContentText());
      var aff = extractAffiliate_(payload);
      
      if (aff && aff.id) {
        console.log('Found affiliate:', aff.id);
        var totals = sumDueNowForAffiliate_(aff.id, apiKey);
        console.log('Commission totals:', JSON.stringify(totals, null, 2));
      } else {
        console.log('No affiliate found in response');
      }
    }
    
    ui.alert('Debug info logged. Check Executions for details.');
    
  } catch(e) {
    console.error('Debug error:', e);
    SpreadsheetApp.getUi().alert('Debug error: ' + e.message);
  }
}

function ping_() {
  return 'pong';
}

// Debug function to help troubleshoot commission calculations
function debugCommissions(email) {
  try {
    if (!email) {
      Logger.log('Email required for debug');
      return null;
    }

    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) {
      Logger.log('Missing AFFILIATE_API_KEY');
      return null;
    }

    Logger.log('=== DEBUG COMMISSION CALCULATION START ===');
    Logger.log('Email: ' + email);
    Logger.log('Currency Setting: ' + CURRENCY);
    Logger.log('USD to CAD Rate (Our Code): ' + USD_TO_CAD_RATE);
    Logger.log('NOTE: If API uses a different rate, values will be off!');

    // Get affiliate info
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp) {
      Logger.log('ERROR: No response from affiliate API');
      return null;
    }

    var responseCode = affResp.getResponseCode();
    Logger.log('Affiliate API Response Code: ' + responseCode);
    
    if (responseCode !== 200) {
      Logger.log('ERROR: Failed to fetch affiliate data - HTTP ' + responseCode);
      Logger.log('Response: ' + affResp.getContentText());
      return null;
    }

    var payload = safeParseJson_(affResp.getContentText());
    var aff = extractAffiliate_(payload);
    
    if (!aff || !aff.id) {
      Logger.log('ERROR: Affiliate not found in response');
      Logger.log('Response payload: ' + JSON.stringify(payload));
      return null;
    }

    Logger.log('Affiliate ID: ' + aff.id);
    Logger.log('Affiliate Status: ' + (aff.status || aff.state || 'unknown'));
    
    // Log ALL available fields on affiliate object
    Logger.log('--- AFFILIATE OBJECT FIELDS ---');
    Logger.log('Full affiliate object: ' + JSON.stringify(aff, null, 2));
    if (aff.balance) Logger.log('Balance field: ' + JSON.stringify(aff.balance));
    if (aff.earnings) Logger.log('Earnings field: ' + JSON.stringify(aff.earnings));
    if (aff.commissions) Logger.log('Commissions field: ' + JSON.stringify(aff.commissions));
    if (aff.commission_balance) Logger.log('Commission Balance: ' + JSON.stringify(aff.commission_balance));
    if (aff.unpaid_balance) Logger.log('Unpaid Balance: ' + JSON.stringify(aff.unpaid_balance));
    if (aff.pending_balance) Logger.log('Pending Balance: ' + JSON.stringify(aff.pending_balance));
    
    // Get detailed commission data
    var totals = sumDueNowForAffiliate_(aff.id, apiKey);
    
    Logger.log('--- COMMISSION DEBUG DATA (First 10) ---');
    for (var i = 0; i < totals._debug_data.length; i++) {
      var c = totals._debug_data[i];
      Logger.log('Commission ' + (i + 1) + ' [ID: ' + c.id + ']:');
      Logger.log('  RAW FIELDS:');
      Logger.log('    amount: ' + c.rawFields.amount);
      Logger.log('    amount_cents: ' + c.rawFields.amount_cents);
      Logger.log('    total: ' + c.rawFields.total);
      Logger.log('    total_cents: ' + c.rawFields.total_cents);
      Logger.log('  Currency: ' + c.currency);
      Logger.log('  Converted Amount (CAD): ' + c.convertedAmount);
      Logger.log('  Normalized Status: ' + c.normalizedStatus + ' (raw: ' + c.rawStatus + ')');
      Logger.log('  All Status Fields: ' + JSON.stringify(c.allStatuses));
      Logger.log('  Paid At: ' + c.paidAt);
      Logger.log('  Due At: ' + c.dueAt);
      Logger.log('  Is Paid: ' + c.isPaid);
      Logger.log('  Is Due Now: ' + c.isDueNow);
      Logger.log('  ---');
    }
    
    Logger.log('--- CALCULATED TOTALS ---');
    Logger.log('Paid (Already Received): $' + totals.paid + ' CAD');
    Logger.log('Unpaid (Total Outstanding): $' + totals.unpaid + ' CAD'); 
    Logger.log('Due Now (Ready for Payout): $' + totals.dueNow + ' CAD');
    Logger.log('Approved Commission (Paid + Due Now): $' + round2_(totals.paid + totals.dueNow) + ' CAD');
    Logger.log('Lifetime Total (Paid + Unpaid): $' + round2_(totals.paid + totals.unpaid) + ' CAD');
    Logger.log('Last Payout: ' + (totals.lastPayoutAt || 'None'));
    
    Logger.log('=== DEBUG COMMISSION CALCULATION END ===');
    
    return totals;
    
  } catch(e) {
    Logger.log('ERROR in debugCommissions: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return null;
  }
}

// Simple function to run debug from Apps Script editor
function runDebugForEmail() {
  // Change this email to the one you want to debug
  var emailToDebug = 'mg.one4all@gmail.com';
  return debugCommissions(emailToDebug);
}

// NOTE: The main lookupAffiliate() function is defined earlier in this file (around line 474)
// This was a duplicate definition that has been removed to avoid confusion.
// The lookupAffiliate() function is the public wrapper for fetchByEmail_().

// Wrapper function for inserting data
function insertAffiliate(email, data) {
  try {
    return insertLookupIntoRow_(email, data);
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function readStatus_(c) {
  if (!c) return 'unknown';
  
  var statusFields = ['status', 'payout_status', 'payment_status', 'state', 'commission_status'];
  for (var i = 0; i < statusFields.length; i++) {
    var s = (c[statusFields[i]] || '').toString().toLowerCase().trim();
    if (s) {
      // Normalize common paid status variations
      if (['paid', 'payout_paid', 'paid_out', 'completed', 'processed'].indexOf(s) !== -1) {
        return 'paid';
      }
      // Normalize approved status variations
      if (['approved', 'confirmed', 'ready_for_payout', 'pending_payout'].indexOf(s) !== -1) {
        return 'approved';
      }
      // Return the first valid status found
      return s;
    }
  }
  
  return 'unknown';
}

function firstNotEmpty_() { 
  for (var i = 0; i < arguments.length; i++) { 
    if (arguments[i]) return arguments[i]; 
  } 
  return ''; 
}

function round2_(n) { 
  var num = Number(n) || 0;
  return Math.round(num * 100) / 100; 
}

function toNum_(n) { 
  var v = Number(n); 
  return Number.isFinite(v) ? v : 0; 
}

/* ========================================
 * TEACHER PORTAL FUNCTIONS
 * ========================================*/

/**
 * DEBUG FUNCTION: Test 30-day commission calculation for a student
 * Call this manually from Apps Script to debug
 */
function debugStudent30DayCommissions(studentEmail) {
  Logger.log('====================================');
  Logger.log('DEBUG: Testing 30-day commissions for: ' + studentEmail);
  Logger.log('====================================');
  
  try {
    // Get full affiliate data
    Logger.log('\n1. Fetching full affiliate data...');
    var fullData = fetchByEmail_(studentEmail);
    Logger.log('Full affiliate data: ' + JSON.stringify({
      affiliateId: fullData.affiliateId,
      totalUnpaid: fullData.unpaidAmount,
      totalDueNow: fullData.dueNow,
      totalPaid: fullData.totalPaid,
      status: fullData.status
    }));
    
    // Get 30-day data
    Logger.log('\n2. Calculating 30-day commissions...');
    var thirtyDayData = calculateLast30DaysCommissionsAdjusted_(studentEmail);
    Logger.log('30-day adjusted data: ' + JSON.stringify(thirtyDayData));
    
    // Get email percentage
    var emailPercentage = extractEmailPercentage_(studentEmail);
    Logger.log('\n3. Email percentage: ' + (emailPercentage !== null ? emailPercentage + '%' : 'None'));
    
    // Check for admin override
    var override = getAdminOverride_(studentEmail);
    Logger.log('\n4. Admin override: ' + (override ? JSON.stringify(override) : 'None'));
    
    Logger.log('\n====================================');
    Logger.log('DEBUG COMPLETE');
    Logger.log('====================================');
    
    return {
      email: studentEmail,
      emailPercentage: emailPercentage,
      fullData: {
        totalUnpaid: fullData.unpaidAmount,
        totalDueNow: fullData.dueNow
      },
      thirtyDayData: thirtyDayData,
      adminOverride: override
    };
    
  } catch(e) {
    Logger.log('ERROR in debug: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return { error: e.message, stack: e.stack };
  }
}

/**
 * Get storage key for teacher-student data
 */
function getTeacherStudentsKey_(teacherEmail) {
  return 'TEACHER_STUDENTS_' + teacherEmail.toLowerCase().replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Verify if an email belongs to a teacher
 * Checks if "teacher" appears in the first name field (case insensitive)
 * Admin emails are automatically granted access
 */
function verifyTeacherAccess(email) {
  try {
    log_('Verifying teacher access for: ' + email);
    
    // Check if email is an admin - admins bypass teacher verification
    var emailLower = email.toLowerCase().trim();
    var isAdmin = false;
    for (var i = 0; i < ADMIN_EMAILS.length; i++) {
      if (ADMIN_EMAILS[i].toLowerCase() === emailLower) {
        isAdmin = true;
        break;
      }
    }
    
    if (isAdmin) {
      log_('✅ ADMIN ACCESS - Bypassing teacher verification');
      return { 
        isTeacher: true, 
        name: 'Admin',
        email: email,
        isAdmin: true
      };
    }
    
    // Check teacher override list
    if (isTeacherOverrideEmail_(emailLower)) {
      log_('✅ TEACHER OVERRIDE - Granting access for: ' + emailLower);
      return { 
        isTeacher: true, 
        name: emailLower,
        email: email,
        isOverride: true
      };
    }
    
    // Check cache first (5 minute cache for teacher verification)
    var cacheKey = 'teacher_verify_' + emailLower;
    var cached = getCachedApiResponse_(cacheKey);
    if (cached !== null) {
      return cached;
    }
    
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) {
      log_('Missing API key');
      return { isTeacher: false, error: 'System configuration error' };
    }
    
    // Fetch affiliate data
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp || affResp.getResponseCode() !== 200) {
      log_('Affiliate not found');
      return { isTeacher: false, error: 'Email not found in system' };
    }
    
    var payload = safeParseJson_(affResp.getContentText());
    var aff = extractAffiliate_(payload);
    
    if (!aff || !aff.id) {
      log_('No affiliate data');
      return { isTeacher: false, error: 'Email not found in system' };
    }
    
    // Check if teacher by first name OR override list
    var firstName = aff.first_name || '';
    log_('First name: ' + firstName);
    
    var result;
    if (hasTeacherAccess_(firstName, emailLower)) {
      log_('✅ Teacher verified: ' + firstName + ' (email: ' + emailLower + ')');
      result = { 
        isTeacher: true, 
        name: firstName || email,
        email: email
      };
    } else {
      log_('❌ Not a teacher: ' + firstName);
      result = { isTeacher: false, error: 'Teacher credentials not found' };
    }
    
    // Cache the result
    setCachedApiResponse_(cacheKey, result);
    
    return result;
    
  } catch(e) {
    log_('Error verifying teacher: ' + e.message);
    return { isTeacher: false, error: e.message };
  }
}

/**
 * Get teacher data (list of students)
 * CANONICAL: Now reads from TEACHER_LINKS_* (single source of truth) first,
 * falls back to legacy TEACHER_STUDENTS_* keys for backward compatibility
 * 
 * @param {string} teacherEmail - Teacher's email (alias or internal)
 * @param {boolean} returnContext - If true, returns {data, actualKey, allKeys} for migration ops
 * @returns {Object} - Teacher data object or context object if returnContext=true
 */
function getTeacherData(teacherEmail, returnContext) {
  try {
    Logger.log('Getting teacher data for: ' + teacherEmail);
    var teacherEmailLower = teacherEmail.toLowerCase().trim();
    
    // Track all keys we find data under (for cleanup/context)
    var allKeys = [];
    var actualKey = null;
    var data = null;
    
    // =========================================================
    // STEP 1: Check CANONICAL source (TEACHER_LINKS_*) FIRST
    // This is the single source of truth
    // Check BOTH alias-based and internal-email-based keys
    // =========================================================
    var canonicalKeysToCheck = [];
    
    // Key based on provided email
    canonicalKeysToCheck.push(getCanonicalTeacherId_(teacherEmailLower));
    
    // Key based on internal email (if different)
    var internalEmailForCanonical = getRewardfulEmailForLookup_(teacherEmailLower);
    if (internalEmailForCanonical !== teacherEmailLower) {
      var internalCanonicalKey = 'TEACHER_LINKS_' + internalEmailForCanonical.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
      if (canonicalKeysToCheck.indexOf(internalCanonicalKey) === -1) {
        canonicalKeysToCheck.push(internalCanonicalKey);
      }
    }
    
    // Key based on alias email (if different)
    var aliasEmailForCanonical = findAliasForInternalEmail_(teacherEmailLower);
    if (aliasEmailForCanonical && aliasEmailForCanonical !== teacherEmailLower) {
      var aliasCanonicalKey = 'TEACHER_LINKS_' + aliasEmailForCanonical.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
      if (canonicalKeysToCheck.indexOf(aliasCanonicalKey) === -1) {
        canonicalKeysToCheck.push(aliasCanonicalKey);
      }
    }
    
    Logger.log('Checking canonical keys: ' + JSON.stringify(canonicalKeysToCheck));
    
    var canonicalData = null;
    var canonicalKey = null;
    
    for (var i = 0; i < canonicalKeysToCheck.length; i++) {
      var keyToCheck = canonicalKeysToCheck[i];
      var canonicalDataStr = PropertiesService.getScriptProperties().getProperty(keyToCheck);
      
      if (canonicalDataStr) {
        try {
          var parsedData = JSON.parse(canonicalDataStr);
          if (parsedData.students && parsedData.students.length > 0) {
            // Found canonical data with students
            canonicalData = parsedData;
            canonicalKey = keyToCheck;
            allKeys.push(keyToCheck);
            Logger.log('Found canonical data under key: ' + keyToCheck);
            break;
          }
        } catch (parseErr) {
          Logger.log('Error parsing canonical data from ' + keyToCheck + ': ' + parseErr.message);
        }
      }
    }
    
    if (canonicalData) {
      // Convert canonical format to legacy format (filter to ACTIVE only)
      var activeStudents = (canonicalData.students || []).filter(function(s) {
        return s.status === LINK_STATUS.ACTIVE;
      }).map(function(s) {
        return {
          email: s.email,
          internalEmail: s.internalEmail,
          affiliateId: s.affiliateId,
          name: s.name,
          addedDate: s.createdAt
        };
      });
      
      data = { students: activeStudents };
      actualKey = canonicalKey;
      Logger.log('Returning ' + activeStudents.length + ' ACTIVE students from canonical source');
      
      // If we have canonical data, that's authoritative - return it
      if (returnContext) {
        return { data: data, actualKey: actualKey, allKeys: allKeys };
      }
      return data;
    }
    
    // =========================================================
    // STEP 2: Fall back to LEGACY sources (TEACHER_STUDENTS_*)
    // Only if canonical source not found
    // =========================================================
    Logger.log('No canonical data found, checking legacy keys...');
    
    // Try with the provided email (could be alias)
    var key = getTeacherStudentsKey_(teacherEmailLower);
    var dataStr = PropertiesService.getScriptProperties().getProperty(key);
    
    if (dataStr) {
      data = JSON.parse(dataStr);
      actualKey = key;
      allKeys.push(key);
      Logger.log('Found ' + data.students.length + ' students using legacy email key: ' + key);
    }
    
    // Also check internal email key
    var internalEmail = getRewardfulEmailForLookup_(teacherEmailLower);
    if (internalEmail !== teacherEmailLower) {
      var internalKey = getTeacherStudentsKey_(internalEmail);
      var internalDataStr = PropertiesService.getScriptProperties().getProperty(internalKey);
      
      if (internalDataStr) {
        var internalData = JSON.parse(internalDataStr);
        allKeys.push(internalKey);
        Logger.log('Found ' + internalData.students.length + ' students using legacy internal key: ' + internalKey);
        
        if (!data) {
          data = internalData;
          actualKey = internalKey;
        } else {
          // Merge (dedup by email)
          var existingEmails = {};
          data.students.forEach(function(s) {
            existingEmails[(s.email || '').toLowerCase()] = true;
            existingEmails[(s.internalEmail || '').toLowerCase()] = true;
          });
          
          internalData.students.forEach(function(s) {
            var studentEmail = (s.email || '').toLowerCase();
            var studentInternal = (s.internalEmail || '').toLowerCase();
            if (!existingEmails[studentEmail] && !existingEmails[studentInternal]) {
              data.students.push(s);
            }
          });
        }
      }
    }
    
    // Also check alias->internal reverse lookup
    var aliasEmail = findAliasForInternalEmail_(teacherEmailLower);
    if (aliasEmail && aliasEmail !== teacherEmailLower) {
      var aliasKey = getTeacherStudentsKey_(aliasEmail);
      if (allKeys.indexOf(aliasKey) === -1) {
        var aliasDataStr = PropertiesService.getScriptProperties().getProperty(aliasKey);
        if (aliasDataStr) {
          allKeys.push(aliasKey);
          var aliasData = JSON.parse(aliasDataStr);
          Logger.log('Found ' + aliasData.students.length + ' students using legacy reverse alias key: ' + aliasKey);
          
          if (!data) {
            data = aliasData;
            actualKey = aliasKey;
          }
        }
      }
    }
    
    if (!data) {
      Logger.log('No data found for teacher (checked canonical and all legacy keys)');
      data = { students: [] };
      actualKey = key;
    }
    
    if (returnContext) {
      return { data: data, actualKey: actualKey, allKeys: allKeys };
    }
    
    return data;
    
  } catch(e) {
    Logger.log('Error getting teacher data: ' + e.message);
    if (returnContext) {
      return { data: { students: [] }, actualKey: null, allKeys: [] };
    }
    return { students: [] };
  }
}

/**
 * Add a student to a teacher's list by full name (first and last)
 */
function addStudentToTeacherByFullName(teacherEmail, studentFirstName, studentLastName) {
  try {
    Logger.log('Searching for student: ' + studentFirstName + ' ' + studentLastName + ' for teacher: ' + teacherEmail);
    
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) {
      return { success: false, error: 'System configuration error' };
    }
    
    // Search for affiliates with matching first and last name
    var searchUrl = BASE_URL + '/affiliates?per_page=200';
    var response = fetchWithRetry_(searchUrl, apiKey);
    
    if (!response || response.getResponseCode() !== 200) {
      Logger.log('Failed to fetch affiliates');
      return { success: false, error: 'Failed to search for student' };
    }
    
    var payload = safeParseJson_(response.getContentText());
    var affiliates = extractCommissions_(payload); // This works for both commissions and affiliates
    
    if (!affiliates || affiliates.length === 0) {
      return { success: false, error: 'No affiliates found in system' };
    }
    
    // Search for matching first AND last name (case insensitive)
    var matchedStudent = null;
    var searchFirstName = studentFirstName.toLowerCase().trim();
    var searchLastName = studentLastName.toLowerCase().trim();
    
    Logger.log('Searching for: First="' + searchFirstName + '" Last="' + searchLastName + '"');
    
    for (var i = 0; i < affiliates.length; i++) {
      var aff = affiliates[i];
      var affFirstName = (aff.first_name || '').toLowerCase().trim();
      var affLastName = (aff.last_name || '').toLowerCase().trim();
      
      Logger.log('Checking affiliate: First="' + affFirstName + '" Last="' + affLastName + '" Email=' + aff.email);
      
      if (affFirstName === searchFirstName && affLastName === searchLastName) {
        matchedStudent = aff;
        Logger.log('✅ Found exact match: ' + aff.first_name + ' ' + aff.last_name + ' (' + aff.email + ')');
        break;
      }
    }
    
    if (!matchedStudent) {
      Logger.log('❌ No student found with name: ' + studentFirstName + ' ' + studentLastName);
      return { 
        success: false, 
        error: 'No student found with name "' + studentFirstName + ' ' + studentLastName + '". Please check the spelling and try again.' 
      };
    }
    
    var studentEmail = matchedStudent.email;
    
    // Verify student exists and has commission data
    var studentData = fetchByEmail_(studentEmail);
    if (!studentData || studentData.status === 'Not found') {
      Logger.log('Student has no commission data');
      return { 
        success: false, 
        error: 'Student found but has no commission data' 
      };
    }
    
    // Get existing teacher data
    var teacherData = getTeacherData(teacherEmail);
    
    // Check if student already exists
    var exists = teacherData.students.some(function(s) {
      return s.email.toLowerCase() === studentEmail.toLowerCase();
    });
    
    if (exists) {
      Logger.log('Student already in teacher list');
      return { 
        success: false, 
        error: 'This student is already in your list' 
      };
    }
    
    // Add student
    teacherData.students.push({
      email: studentEmail.toLowerCase(),
      addedDate: new Date().toISOString()
    });
    
    // Save updated data
    var key = getTeacherStudentsKey_(teacherEmail);
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(teacherData));
    
    // Clear cache for this teacher so next load gets fresh data
    clearTeacherCache_(teacherEmail);
    
    Logger.log('Student added successfully: ' + matchedStudent.first_name + ' ' + matchedStudent.last_name);
    return { 
      success: true,
      studentName: matchedStudent.first_name + ' ' + matchedStudent.last_name,
      email: studentEmail
    };
    
  } catch(e) {
    Logger.log('Error adding student by full name: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return { 
      success: false, 
      error: e.message 
    };
  }
}

/**
 * Add a student to a teacher's list by EMAIL (new preferred method)
 * Accepts either alias email or internal commission email
 * MIGRATION FIX: Normalizes teacher email to alias for consistent storage
 */
function addStudentToTeacherByEmail(teacherEmail, studentEmail) {
  try {
    Logger.log('Adding student by email: ' + studentEmail + ' for teacher: ' + teacherEmail);
    
    if (!studentEmail || studentEmail.indexOf('@') === -1) {
      return { success: false, error: 'Invalid email address' };
    }
    
    // MIGRATION FIX: Normalize teacher email - try to find alias if internal email given
    var normalizedTeacherEmail = teacherEmail.toLowerCase().trim();
    var teacherAlias = findAliasForInternalEmail_(normalizedTeacherEmail);
    if (teacherAlias) {
      Logger.log('Resolved teacher internal email to alias: ' + normalizedTeacherEmail + ' -> ' + teacherAlias);
      normalizedTeacherEmail = teacherAlias;
    }
    
    // Resolve student by email (supports both alias and internal email)
    var resolveResult = resolveStudentByEmail_(studentEmail);
    
    if (resolveResult.status === 'NOT_FOUND') {
      Logger.log('Student not found: ' + studentEmail);
      return { 
        success: false, 
        status: 'NOT_FOUND',
        error: 'No student found with that email. Check spelling or ask them to request access.'
      };
    }
    
    if (resolveResult.status === 'NOT_LINKED') {
      Logger.log('Student exists but not linked: ' + studentEmail);
      return { 
        success: false, 
        status: 'NOT_LINKED',
        error: 'This email exists but is not linked to an internal account yet. Ask admin to approve/link it first.'
      };
    }
    
    var student = resolveResult.student;
    var studentName = student.firstName + ' ' + student.lastName;
    
    // MIGRATION FIX: Use ALIAS email for storage/display, keep internal for lookups
    var aliasEmail = student.aliasEmail || student.email;
    var internalEmail = student.internalEmail || student.canonicalEmail || aliasEmail;
    
    Logger.log('Student resolved - alias: ' + aliasEmail + ', internal: ' + internalEmail);
    
    // Get existing teacher data (using normalized/alias email)
    var teacherData = getTeacherData(normalizedTeacherEmail);
    
    // Check if student already exists (by EITHER alias or internal email)
    var normalizedAlias = aliasEmail.toLowerCase().trim();
    var normalizedInternal = internalEmail.toLowerCase().trim();
    var exists = teacherData.students.some(function(s) {
      var storedEmail = s.email.toLowerCase().trim();
      var storedInternal = (s.internalEmail || '').toLowerCase().trim();
      // Match by alias, internal, or the stored internal
      return storedEmail === normalizedAlias || 
             storedEmail === normalizedInternal ||
             storedInternal === normalizedInternal ||
             storedInternal === normalizedAlias;
    });
    
    if (exists) {
      Logger.log('Student already in teacher list: ' + aliasEmail);
      return { 
        success: false, 
        status: 'ALREADY_ADDED',
        error: 'This student is already in your list'
      };
    }
    
    // Add student using ALIAS email (for display) but also store internal email (for data lookups)
    teacherData.students.push({
      email: aliasEmail.toLowerCase(),           // Alias email for display
      internalEmail: internalEmail.toLowerCase(), // Internal email for data lookups
      affiliateId: student.affiliateId || null,
      addedDate: new Date().toISOString()
    });
    
    // Save updated data (using normalized/alias teacher email for consistent key)
    var key = getTeacherStudentsKey_(normalizedTeacherEmail);
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(teacherData));
    
    // Clear cache for this teacher so next load gets fresh data
    clearTeacherCache_(normalizedTeacherEmail);
    
    Logger.log('Student added successfully to teacher ' + normalizedTeacherEmail + ': ' + studentName + ' (alias: ' + aliasEmail + ', internal: ' + internalEmail + ')');
    return { 
      success: true,
      studentName: studentName,
      email: aliasEmail  // Return alias email to frontend
    };
    
  } catch(e) {
    Logger.log('Error adding student by email: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return { 
      success: false, 
      error: e.message 
    };
  }
}

/**
 * Resolve a student by email address
 * Checks both alias email and internal commission email
 * 
 * Returns:
 * - {status: 'OK', student: {...}} if found and linked
 * - {status: 'NOT_LINKED'} if alias exists but no internal email linked
 * - {status: 'NOT_FOUND'} if email doesn't exist anywhere
 */
function resolveStudentByEmail_(inputEmail) {
  var normalizedEmail = normalizeAuthEmail_(inputEmail);
  
  if (!normalizedEmail) {
    return { status: 'NOT_FOUND' };
  }
  
  Logger.log('Resolving student by email: ' + normalizedEmail);
  
  // Step 1: Check portal auth records (alias email lookup)
  var authRecord = getAuthRecord_(normalizedEmail);
  
  // Handle redirect records
  if (authRecord && authRecord.redirectTo) {
    authRecord = getAuthRecord_(authRecord.redirectTo);
  }
  
  if (authRecord) {
    Logger.log('Found auth record for: ' + normalizedEmail);
    
    // Check if internal email is linked
    var internalEmail = authRecord.rewardfulEmail || authRecord.internalEmail;
    
    if (!internalEmail) {
      // Alias exists but not linked to internal account
      Logger.log('Alias exists but not linked: ' + normalizedEmail);
      return { status: 'NOT_LINKED' };
    }
    
    // Check if approved/active
    var status = authRecord.accountStatus;
    if (status === ACCOUNT_STATUS.PENDING) {
      return { status: 'NOT_LINKED' }; // Pending approval counts as not linked
    }
    if (status === ACCOUNT_STATUS.REJECTED) {
      return { status: 'NOT_FOUND' }; // Rejected = doesn't exist for this purpose
    }
    
    // Get affiliate data from the system
    var affiliateData = getAffiliateByEmail_(internalEmail);
    
    return {
      status: 'OK',
      student: {
        email: normalizedEmail,
        aliasEmail: normalizedEmail,
        internalEmail: internalEmail,
        canonicalEmail: internalEmail, // Use internal email as canonical
        firstName: authRecord.firstName || (affiliateData ? affiliateData.first_name : ''),
        lastName: authRecord.lastName || (affiliateData ? affiliateData.last_name : ''),
        affiliateId: authRecord.rewardfulAffiliateId || authRecord.affiliateId || (affiliateData ? affiliateData.id : null)
      }
    };
  }
  
  // Step 2: Not found by alias - check if it's an internal email directly
  var affiliateData = getAffiliateByEmail_(normalizedEmail);
  
  if (affiliateData) {
    Logger.log('Found affiliate by internal email: ' + normalizedEmail);
    return {
      status: 'OK',
      student: {
        email: normalizedEmail,
        aliasEmail: null, // No known alias
        internalEmail: normalizedEmail,
        canonicalEmail: normalizedEmail,
        firstName: affiliateData.first_name || '',
        lastName: affiliateData.last_name || '',
        affiliateId: affiliateData.id
      }
    };
  }
  
  // Also try searching by originalAliasEmail in case admin changed it
  var recordByOriginal = findRecordByOriginalEmail_(normalizedEmail);
  if (recordByOriginal) {
    Logger.log('Found record by original alias email: ' + normalizedEmail);
    var internalEmail = recordByOriginal.rewardfulEmail || recordByOriginal.internalEmail;
    
    if (!internalEmail) {
      return { status: 'NOT_LINKED' };
    }
    
    return {
      status: 'OK',
      student: {
        email: recordByOriginal.aliasEmail || normalizedEmail,
        aliasEmail: recordByOriginal.aliasEmail,
        internalEmail: internalEmail,
        canonicalEmail: internalEmail,
        firstName: recordByOriginal.firstName || '',
        lastName: recordByOriginal.lastName || '',
        affiliateId: recordByOriginal.rewardfulAffiliateId || recordByOriginal.affiliateId
      }
    };
  }
  
  // Not found anywhere
  Logger.log('Student not found by any email: ' + normalizedEmail);
  return { status: 'NOT_FOUND' };
}

/**
 * Add a student to a teacher's list by first name (legacy - deprecated)
 */
function addStudentToTeacherByName(teacherEmail, studentFirstName) {
  try {
    Logger.log('Searching for student with first name: ' + studentFirstName + ' for teacher: ' + teacherEmail);
    
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) {
      return { success: false, error: 'System configuration error' };
    }
    
    // Search for affiliates with matching first name
    var searchUrl = BASE_URL + '/affiliates?per_page=200';
    var response = fetchWithRetry_(searchUrl, apiKey);
    
    if (!response || response.getResponseCode() !== 200) {
      Logger.log('Failed to fetch affiliates');
      return { success: false, error: 'Failed to search for student' };
    }
    
    var payload = safeParseJson_(response.getContentText());
    var affiliates = extractCommissions_(payload); // This works for both commissions and affiliates
    
    if (!affiliates || affiliates.length === 0) {
      return { success: false, error: 'No affiliates found in system' };
    }
    
    // Search for matching first name (case insensitive)
    var matchedStudent = null;
    var searchName = studentFirstName.toLowerCase().trim();
    
    for (var i = 0; i < affiliates.length; i++) {
      var aff = affiliates[i];
      var affFirstName = (aff.first_name || '').toLowerCase().trim();
      
      if (affFirstName === searchName) {
        matchedStudent = aff;
        Logger.log('Found exact match: ' + aff.first_name + ' (' + aff.email + ')');
        break;
      }
    }
    
    if (!matchedStudent) {
      Logger.log('No student found with first name: ' + studentFirstName);
      return { 
        success: false, 
        error: 'No student found with first name "' + studentFirstName + '". Please check the spelling and try again.' 
      };
    }
    
    var studentEmail = matchedStudent.email;
    
    // Verify student exists and has commission data
    var studentData = fetchByEmail_(studentEmail);
    if (!studentData || studentData.status === 'Not found') {
      Logger.log('Student has no commission data');
      return { 
        success: false, 
        error: 'Student found but has no commission data' 
      };
    }
    
    // Get existing teacher data
    var teacherData = getTeacherData(teacherEmail);
    
    // Check if student already exists
    var exists = teacherData.students.some(function(s) {
      return s.email.toLowerCase() === studentEmail.toLowerCase();
    });
    
    if (exists) {
      Logger.log('Student already in teacher list');
      return { 
        success: false, 
        error: 'This student is already in your list' 
      };
    }
    
    // Add student
    teacherData.students.push({
      email: studentEmail.toLowerCase(),
      addedDate: new Date().toISOString()
    });
    
    // Save updated data
    var key = getTeacherStudentsKey_(teacherEmail);
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(teacherData));
    
    Logger.log('Student added successfully: ' + matchedStudent.first_name + ' ' + (matchedStudent.last_name || ''));
    return { 
      success: true,
      studentName: matchedStudent.first_name + ' ' + (matchedStudent.last_name || ''),
      email: studentEmail
    };
    
  } catch(e) {
    Logger.log('Error adding student by name: ' + e.message);
    return { 
      success: false, 
      error: e.message 
    };
  }
}

/**
 * Add a student to a teacher's list (legacy - by email)
 * MIGRATION FIX: Now resolves alias email to internal email for Rewardful lookup
 */
function addStudentToTeacher(teacherEmail, studentEmail) {
  try {
    Logger.log('Adding student ' + studentEmail + ' to teacher ' + teacherEmail);
    
    // MIGRATION FIX: Resolve alias email to internal email for Rewardful lookup
    var emailForLookup = getRewardfulEmailForLookup_(studentEmail);
    if (emailForLookup !== studentEmail) {
      Logger.log('Resolved alias to internal email: ' + studentEmail + ' -> ' + emailForLookup);
    }
    
    // Verify the student exists in the Rewardful system using internal email
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    var affiliate = findAffiliateByEmail_(emailForLookup, apiKey);
    
    if (!affiliate) {
      Logger.log('Student not found in Rewardful system for email: ' + emailForLookup);
      return { 
        success: false, 
        error: 'Student email not found in the affiliate system. Please ensure your account is approved.' 
      };
    }
    
    Logger.log('Student found in Rewardful: ' + affiliate.first_name + ' ' + affiliate.last_name);
    
    // Get existing teacher data
    var teacherData = getTeacherData(teacherEmail);
    
    // Check if student already exists
    var exists = teacherData.students.some(function(s) {
      return s.email.toLowerCase() === studentEmail.toLowerCase();
    });
    
    if (exists) {
      Logger.log('Student already in teacher list');
      return { 
        success: false, 
        error: 'Student already in your list' 
      };
    }
    
    // Add student
    teacherData.students.push({
      email: studentEmail.toLowerCase(),
      addedDate: new Date().toISOString()
    });
    
    // Save updated data
    var key = getTeacherStudentsKey_(teacherEmail);
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(teacherData));
    
    Logger.log('Student added successfully to teacher ' + teacherEmail);
    return { success: true };
    
  } catch(e) {
    Logger.log('Error adding student: ' + e.message);
    return { 
      success: false, 
      error: e.message 
    };
  }
}

/**
 * Remove a student from a teacher's list
 * CANONICAL: Uses soft delete - student can re-select this teacher later
 */
function removeStudentFromTeacher(teacherEmail, studentEmail) {
  try {
    Logger.log('Teacher removing student ' + studentEmail + ' from ' + teacherEmail);
    
    // Use canonical unlink (soft delete)
    var unlinkResult = unlinkStudentFromTeacher(teacherEmail, studentEmail, 'teacher');
    
    if (!unlinkResult.success) {
      return { success: false, error: unlinkResult.error };
    }
    
    // Also clear the student's cached teacherEmail so they're prompted to re-select
    var studentEmailLower = studentEmail.toLowerCase().trim();
    
    // Try both alias and internal email keys
    var studentAliasEmail = findAliasForInternalEmail_(studentEmailLower) || studentEmailLower;
    var userKey = getAttendanceUserKey_(studentAliasEmail);
    var userDataStr = PropertiesService.getScriptProperties().getProperty(userKey);
    
    if (!userDataStr) {
      // Try with original email
      userKey = getAttendanceUserKey_(studentEmailLower);
      userDataStr = PropertiesService.getScriptProperties().getProperty(userKey);
    }
    
    if (userDataStr) {
      var userData = JSON.parse(userDataStr);
      userData.teacherEmail = null;
      userData.teacherRemovedDate = new Date().toISOString();
      userData.teacherRemovedBy = 'teacher';
      PropertiesService.getScriptProperties().setProperty(userKey, JSON.stringify(userData));
      Logger.log('Cleared teacher assignment for student: ' + studentEmail);
    }
    
    Logger.log('Student removed successfully (soft delete): ' + unlinkResult.status);
    return { success: true };
    
  } catch(e) {
    Logger.log('Error removing student: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * INTERNAL: Remove student from teacher's list only (doesn't touch student's attendance record)
 * Used when student is changing teachers - we only need to remove from the old teacher's list
 * MIGRATION FIX: Now updates ALL possible keys where teacher data might be stored
 * Returns {removed: true/false} to indicate if student was actually in the list
 */
function removeStudentFromTeacherList_(teacherEmail, studentEmail) {
  try {
    var teacherEmailLower = teacherEmail.toLowerCase().trim();
    var studentEmailLower = studentEmail.toLowerCase().trim();
    
    // Get student's internal email for matching
    var studentInternalEmail = getRewardfulEmailForLookup_(studentEmailLower);
    
    // Get teacher data with context (tells us which keys have data)
    var context = getTeacherData(teacherEmailLower, true);
    var teacherData = context.data;
    var allKeys = context.allKeys;
    var originalCount = teacherData.students.length;
    
    Logger.log('Removing student ' + studentEmailLower + ' from teacher ' + teacherEmailLower);
    Logger.log('Keys to update: ' + JSON.stringify(allKeys));
    
    // Filter out the student (check both alias and internal email)
    teacherData.students = teacherData.students.filter(function(s) {
      var storedEmail = (s.email || '').toLowerCase().trim();
      var storedInternal = (s.internalEmail || '').toLowerCase().trim();
      
      // Check if this student matches any of the possible emails
      var isMatch = storedEmail === studentEmailLower || 
                    storedInternal === studentEmailLower ||
                    storedEmail === studentInternalEmail ||
                    storedInternal === studentInternalEmail;
      
      if (isMatch) {
        Logger.log('Filtering out student: ' + storedEmail + ' (internal: ' + storedInternal + ')');
      }
      
      // Keep if NOT matching this student
      return !isMatch;
    });
    
    var removed = teacherData.students.length < originalCount;
    
    if (removed) {
      // MIGRATION FIX: Update ALL keys where data existed
      var updatedDataStr = JSON.stringify(teacherData);
      
      if (allKeys.length > 0) {
        // Update all existing keys with the filtered data
        allKeys.forEach(function(k) {
          PropertiesService.getScriptProperties().setProperty(k, updatedDataStr);
          Logger.log('Updated key: ' + k);
        });
      } else {
        // No existing keys found, save to default key
        var defaultKey = getTeacherStudentsKey_(teacherEmailLower);
        PropertiesService.getScriptProperties().setProperty(defaultKey, updatedDataStr);
        Logger.log('Updated default key: ' + defaultKey);
      }
      
      // Clear cache for this teacher
      clearTeacherCache_(teacherEmailLower);
      
      Logger.log('Successfully removed student ' + studentEmailLower + ' from teacher ' + teacherEmailLower + ' list');
    } else {
      Logger.log('Student ' + studentEmailLower + ' was not in teacher ' + teacherEmailLower + ' list');
    }
    
    return { removed: removed };
    
  } catch(e) {
    Logger.log('Error in removeStudentFromTeacherList_: ' + e.message);
    return { removed: false, error: e.message };
  }
}

/**
 * Set percentage override for a specific student under a teacher
 */
function setStudentPercentageOverride(teacherEmail, studentEmail, percentage) {
  try {
    Logger.log('Setting percentage override for student ' + studentEmail + ' under teacher ' + teacherEmail + ': ' + percentage + '%');
    
    var key = 'teacher_student_pct_' + teacherEmail.toLowerCase() + '_' + studentEmail.toLowerCase();
    PropertiesService.getScriptProperties().setProperty(key, percentage.toString());
    
    // Clear cache so next load gets fresh data
    clearTeacherCache_(teacherEmail);
    
    Logger.log('Percentage override saved successfully');
    return { success: true };
    
  } catch(e) {
    Logger.log('Error setting student percentage override: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Get percentage override for a specific student under a teacher
 * Returns null if no override is set
 */
function getStudentPercentageOverride(teacherEmail, studentEmail) {
  try {
    var key = 'teacher_student_pct_' + teacherEmail.toLowerCase() + '_' + studentEmail.toLowerCase();
    var value = PropertiesService.getScriptProperties().getProperty(key);
    
    if (value === null || value === undefined) {
      return null;
    }
    
    return parseFloat(value);
    
  } catch(e) {
    Logger.log('Error getting student percentage override: ' + e.message);
    return null;
  }
}

/**
 * Get all percentage overrides for all students under a teacher
 * Returns an object where keys are student emails and values are percentages
 */
function getAllStudentPercentageOverrides(teacherEmail) {
  try {
    Logger.log('Getting all percentage overrides for teacher: ' + teacherEmail);
    
    var teacherData = getTeacherData(teacherEmail);
    var overrides = {};
    
    teacherData.students.forEach(function(student) {
      var override = getStudentPercentageOverride(teacherEmail, student.email);
      if (override !== null) {
        overrides[student.email.toLowerCase()] = override;
      }
    });
    
    Logger.log('Found ' + Object.keys(overrides).length + ' percentage overrides');
    return overrides;
    
  } catch(e) {
    Logger.log('Error getting all percentage overrides: ' + e.message);
    return {};
  }
}

/**
 * Apply default percentage to all students under a teacher
 */
function applyDefaultPercentageToAllStudents(teacherEmail, defaultPercentage) {
  try {
    Logger.log('Applying default percentage ' + defaultPercentage + '% to all students under teacher: ' + teacherEmail);
    
    var teacherData = getTeacherData(teacherEmail);
    var count = 0;
    
    teacherData.students.forEach(function(student) {
      setStudentPercentageOverride(teacherEmail, student.email, defaultPercentage);
      count++;
    });
    
    Logger.log('Applied default percentage to ' + count + ' students');
    return { success: true, count: count };
    
  } catch(e) {
    Logger.log('Error applying default percentage: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Teacher Earnings Tracking System
 * Tracks cumulative teacher earnings that don't decrease when students get paid
 */

/**
 * Get teacher earnings history (cumulative locked-in earnings)
 */
function getTeacherEarningsHistory(teacherEmail) {
  try {
    var key = 'teacher_earnings_' + teacherEmail.toLowerCase();
    var dataStr = PropertiesService.getScriptProperties().getProperty(key);
    
    if (!dataStr) {
      // Initialize with zero earnings
      return {
        totalEarned: 0,
        totalUnpaidEarned: 0,
        totalDueNowEarned: 0,
        lastUpdated: new Date().toISOString(),
        studentTracking: {} // student email -> last tracked amount
      };
    }
    
    return JSON.parse(dataStr);
    
  } catch(e) {
    Logger.log('Error getting teacher earnings history: ' + e.message);
    return {
      totalEarned: 0,
      totalUnpaidEarned: 0,
      totalDueNowEarned: 0,
      lastUpdated: new Date().toISOString(),
      studentTracking: {}
    };
  }
}

/**
 * Save teacher earnings history
 */
function saveTeacherEarningsHistory(teacherEmail, earningsData) {
  try {
    var key = 'teacher_earnings_' + teacherEmail.toLowerCase();
    earningsData.lastUpdated = new Date().toISOString();
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(earningsData));
    return { success: true };
  } catch(e) {
    Logger.log('Error saving teacher earnings history: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Update teacher earnings based on current student data
 * Only adds NEW earnings since last check (locked-in system)
 */
function updateTeacherEarnings(teacherEmail) {
  try {
    Logger.log('=== UPDATING TEACHER EARNINGS ===');
    Logger.log('Teacher: ' + teacherEmail);
    
    // Get current earnings history
    var history = getTeacherEarningsHistory(teacherEmail);
    Logger.log('Current total earned: $' + history.totalEarned);
    
    // Get current student data (includes teacherPercentage for each student)
    var studentsData = getStudentsCommissionData(teacherEmail);
    Logger.log('Found ' + studentsData.length + ' students');
    
    // Get teacher's default percentage (fallback if student has no override)
    var defaultPercentage = getTeacherAdjustmentPercentage(teacherEmail) || 10;
    Logger.log('Default teacher percentage: ' + defaultPercentage + '%');
    
    var newEarningsUnpaid = 0;
    var newEarningsDueNow = 0;
    
    // Process each student
    studentsData.forEach(function(student) {
      var studentEmail = student.email.toLowerCase();
      
      // Get student's current unpaid amount (100% raw value)
      var currentUnpaid = student.totalUnpaid || 0;
      var currentDueNow = student.totalDueNow || 0;
      
      // Get last tracked amount for this student
      var lastTracked = history.studentTracking[studentEmail] || { unpaid: 0, dueNow: 0 };
      
      // Calculate NEW earnings (only if student's amount increased)
      var unpaidIncrease = Math.max(0, currentUnpaid - lastTracked.unpaid);
      var dueNowIncrease = Math.max(0, currentDueNow - lastTracked.dueNow);
      
      if (unpaidIncrease > 0 || dueNowIncrease > 0) {
        Logger.log('Student ' + studentEmail + ' has new earnings:');
        Logger.log('  Unpaid increase: $' + unpaidIncrease);
        Logger.log('  Due Now increase: $' + dueNowIncrease);
        
        // Get percentage for this student
        // Use student.teacherPercentage if set, otherwise use default
        var studentPercentage = student.teacherPercentage || defaultPercentage;
        var multiplier = studentPercentage / 100;
        
        Logger.log('  Student teacherPercentage from data: ' + student.teacherPercentage);
        Logger.log('  Applying teacher percentage: ' + studentPercentage + '%');
        
        // Add teacher's share of the increase
        newEarningsUnpaid += unpaidIncrease * multiplier;
        newEarningsDueNow += dueNowIncrease * multiplier;
      }
      
      // ALWAYS update tracking to current amount (even on decreases)
      // This ensures we can detect future increases correctly
      history.studentTracking[studentEmail] = {
        unpaid: currentUnpaid,
        dueNow: currentDueNow
      };
    });
    
    // Add new earnings to cumulative totals
    if (newEarningsUnpaid > 0 || newEarningsDueNow > 0) {
      history.totalUnpaidEarned += newEarningsUnpaid;
      history.totalDueNowEarned += newEarningsDueNow;
      history.totalEarned = history.totalUnpaidEarned + history.totalDueNowEarned;
      
      Logger.log('NEW EARNINGS ADDED:');
      Logger.log('  Unpaid: $' + newEarningsUnpaid);
      Logger.log('  Due Now: $' + newEarningsDueNow);
      Logger.log('UPDATED CUMULATIVE TOTALS:');
      Logger.log('  Total Unpaid Earned: $' + history.totalUnpaidEarned);
      Logger.log('  Total Due Now Earned: $' + history.totalDueNowEarned);
      Logger.log('  Total Earned: $' + history.totalEarned);
    } else {
      Logger.log('No new earnings to add');
    }
    
    // ALWAYS save history (even if no new earnings) to persist tracking updates
    saveTeacherEarningsHistory(teacherEmail, history);
    
    return {
      success: true,
      newEarningsUnpaid: newEarningsUnpaid,
      newEarningsDueNow: newEarningsDueNow,
      totalUnpaidEarned: history.totalUnpaidEarned,
      totalDueNowEarned: history.totalDueNowEarned,
      totalEarned: history.totalEarned
    };
    
  } catch(e) {
    Logger.log('Error updating teacher earnings: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Record a teacher payout (reduces their earned but unpaid balance)
 */
function recordTeacherPayout(teacherEmail, amount) {
  try {
    Logger.log('Recording teacher payout: $' + amount + ' for ' + teacherEmail);
    
    var history = getTeacherEarningsHistory(teacherEmail);
    
    // Reduce the unpaid earned amount
    history.totalUnpaidEarned = Math.max(0, history.totalUnpaidEarned - amount);
    
    Logger.log('Updated total unpaid earned: $' + history.totalUnpaidEarned);
    
    saveTeacherEarningsHistory(teacherEmail, history);
    
    return { success: true, newUnpaidBalance: history.totalUnpaidEarned };
    
  } catch(e) {
    Logger.log('Error recording teacher payout: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Reset teacher earnings tracking (for testing or corrections)
 * @param {string} mode - 'soft' or 'full'
 *   - 'soft': Clears locked earnings but keeps tracking baseline (prevents re-earning from existing amounts)
 *   - 'full': Clears everything and allows recapture of current student amounts
 */
function resetTeacherEarnings(teacherEmail, mode) {
  try {
    mode = mode || 'soft'; // Default to soft reset
    Logger.log('Resetting teacher earnings for: ' + teacherEmail + ' (mode: ' + mode + ')');
    
    if (mode === 'soft') {
      // Soft reset: Clear earnings but preserve student tracking baseline
      Logger.log('Performing SOFT reset - preserving student tracking baseline');
      
      // Get current student data to establish baseline
      var studentsData = getStudentsCommissionData(teacherEmail);
      
      // Create fresh earnings history with current student amounts as baseline
      var history = {
        totalEarned: 0,
        totalUnpaidEarned: 0,
        totalDueNowEarned: 0,
        lastUpdated: new Date().toISOString(),
        studentTracking: {}
      };
      
      // Set baseline to current amounts (so next update only counts NEW earnings)
      studentsData.forEach(function(student) {
        history.studentTracking[student.email.toLowerCase()] = {
          unpaid: student.totalUnpaid || 0,
          dueNow: student.totalDueNow || 0
        };
      });
      
      // Save the new history with zero earnings but current tracking
      saveTeacherEarningsHistory(teacherEmail, history);
      
      Logger.log('Soft reset complete - baseline set for ' + studentsData.length + ' students');
      
    } else if (mode === 'full') {
      // Full reset: Delete everything
      Logger.log('Performing FULL reset - clearing all data');
      var key = 'teacher_earnings_' + teacherEmail.toLowerCase();
      PropertiesService.getScriptProperties().deleteProperty(key);
      Logger.log('Full reset complete');
    }
    
    // Clear cache
    clearTeacherCache_(teacherEmail);
    
    return { success: true, mode: mode };
    
  } catch(e) {
    Logger.log('Error resetting teacher earnings: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Calculate RAW 30-day commissions by affiliate ID (no percentage adjustments)
 * This is a helper function that accepts affiliate ID directly to avoid redundant lookups
 */
function calculate30DaysRawByAffiliateId_(affiliateId, apiKey) {
  try {
    Logger.log('Calculating RAW 30-day commissions for affiliate ID: ' + affiliateId);
    
    // Calculate date 30 days ago
    var thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    var cutoffDate = thirtyDaysAgo.toISOString();
    
    Logger.log('Cutoff date (30 days ago): ' + cutoffDate);
    
    // Fetch all commissions with pagination
    var allCommissions = [];
    var page = 1;
    var MAX_PAGES = 20; // Safety limit
    
    while (page <= MAX_PAGES) {
      try {
        // Correct API format: /commissions?affiliate_id={id}&page={page}
        var url = BASE_URL + '/commissions?affiliate_id=' + encodeURIComponent(affiliateId) + 
                  '&page=' + page + '&per_page=200';
        
        Logger.log('Fetching page ' + page);
        
        Utilities.sleep(200); // Rate limiting
        var r = fetchWithRetry_(url, apiKey);
        
        if (!r) {
          Logger.log('No response from API');
          break;
        }
        
        var rc = r.getResponseCode();
        
        if (rc === 404) {
          Logger.log('No more data (404)');
          break;
        }
        
        if (rc < 200 || rc >= 300) {
          Logger.log('API error: HTTP ' + rc);
          break;
        }
        
        var content = r.getContentText();
        var parsed = safeParseJson_(content);
        
        if (!parsed) {
          Logger.log('Failed to parse JSON');
          break;
        }
        
        var pageCommissions = extractCommissions_(parsed);
        
        if (!pageCommissions || pageCommissions.length === 0) {
          Logger.log('No commissions on page ' + page);
          break;
        }
        
        Logger.log('Found ' + pageCommissions.length + ' commissions on page ' + page);
        
        // Add to allCommissions array
        allCommissions = allCommissions.concat(pageCommissions);
        
        // If we got fewer than 200, we've reached the end
        if (pageCommissions.length < 200) {
          Logger.log('Reached end of data (< 200 results)');
          break;
        }
        
        page++;
        
      } catch(e) {
        Logger.log('Error fetching page ' + page + ': ' + e.message);
        break;
      }
    }
    
    Logger.log('Total commissions fetched: ' + allCommissions.length);
    
    // Filter and sum commissions from last 30 days
    var unpaid30Days = 0;
    var dueNow30Days = 0;
    
    for (var i = 0; i < allCommissions.length; i++) {
      var c = allCommissions[i];
      
      // Parse commission date
      var commDate = null;
      if (c.created_at) {
        commDate = new Date(c.created_at);
      } else if (c.date) {
        commDate = new Date(c.date);
      }
      
      // Only include commissions from last 30 days
      if (commDate && commDate >= thirtyDaysAgo) {
        var status = readStatus_(c);
        var amount = Number(c.amount || c.commission_amount || 0);
        
        // Convert from cents if needed
        if (Number.isInteger(amount) && Math.abs(amount) >= 100) {
          amount = amount / 100;
        }
        
        // Convert currency if needed
        var currencyIso = (c.currency || c.currency_iso || 'USD').toUpperCase();
        if (currencyIso === 'USD' && CURRENCY === 'CAD') {
          amount = amount * USD_TO_CAD_RATE;
        }
        
        // Add to appropriate total based on status
        // NOTE: System EXCLUDES pending commissions (they haven't been approved yet)
        // Only approved/confirmed commissions count toward unpaid balance
        if (status === 'approved' || status === 'confirmed') {
          unpaid30Days += amount;
          dueNow30Days += amount; // Approved/confirmed are both unpaid AND due now
        }
      }
    }
    
    Logger.log('30-day RAW totals: Unpaid=$' + unpaid30Days + ', Due Now=$' + dueNow30Days);
    
    return {
      unpaid: unpaid30Days,
      dueNow: dueNow30Days
    };
    
  } catch(e) {
    Logger.log('Error calculating 30-day commissions: ' + e.message);
    return { unpaid: 0, dueNow: 0 };
  }
}

/**
 * Get RAW commission data for a student (bypasses all percentage logic and tracking)
 * This is used by teachers to see the FULL 100% values of what students are earning
 * Teacher's percentage is applied separately in the UI
 */
function getRawStudentCommissionData_(email) {
  try {
    Logger.log('=== GETTING RAW STUDENT DATA (100%) for: ' + email + ' ===');
    
    // MIGRATION FIX: Resolve alias email to internal email for Rewardful lookup
    var emailForLookup = getRewardfulEmailForLookup_(email);
    if (emailForLookup !== email) {
      Logger.log('Resolved alias to internal email: ' + email + ' -> ' + emailForLookup);
    }
    
    var apiKey = getApiKey_();
    
    // 1) Get affiliate by email (using internal/rewardful email)
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(emailForLookup.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp || affResp.getResponseCode() !== 200) {
      Logger.log('Affiliate not found');
      return { found: false };
    }
    
    var payload = safeParseJson_(affResp.getContentText());
    var aff = extractAffiliate_(payload);
    
    if (!aff || !aff.id) {
      Logger.log('No affiliate ID found');
      return { found: false };
    }
    
    Logger.log('Found affiliate ID: ' + aff.id);
    
    // 2) Try to fetch with expansion for commission_stats
    var affByIdUrl = BASE_URL + '/affiliates/' + aff.id + '?expand=true';
    Logger.log('Fetching expanded data: ' + affByIdUrl);
    var affByIdResp = fetchWithRetry_(affByIdUrl, apiKey);
    
    if (affByIdResp && affByIdResp.getResponseCode() === 200) {
      var expandedPayload = safeParseJson_(affByIdResp.getContentText());
      if (expandedPayload) {
        var expandedAff = extractAffiliate_(expandedPayload);
        if (expandedAff && expandedAff.id) {
          Logger.log('Using expanded affiliate data');
          aff = expandedAff;
        }
      }
    }
    
    var totalUnpaid = 0;
    var totalDueNow = 0;
    var totalPaid = 0;
    var dataSource = 'calculated';
    
    // 3) Try to get values from commission_stats.currencies (most accurate)
    if (aff.commission_stats && aff.commission_stats.currencies) {
      Logger.log('Using commission_stats.currencies');
      
      var targetCurrency = CURRENCY; // 'CAD'
      var currData = aff.commission_stats.currencies[targetCurrency];
      
      if (!currData && aff.commission_stats.currencies['USD']) {
        currData = aff.commission_stats.currencies['USD'];
        Logger.log('Target currency not found, using USD');
      }
      
      if (currData) {
        // Extract unpaid
        if (currData.unpaid && currData.unpaid.cents !== undefined) {
          var unpaidCents = Number(currData.unpaid.cents);
          totalUnpaid = unpaidCents / 100;
          var currIso = currData.unpaid.currency_iso || targetCurrency;
          if (currIso === 'USD' && CURRENCY === 'CAD') {
            totalUnpaid = totalUnpaid * USD_TO_CAD_RATE;
          }
          totalUnpaid = round2_(totalUnpaid);
          Logger.log('Unpaid: $' + totalUnpaid);
        }
        
        // Extract due now
        if (currData.due && currData.due.cents !== undefined) {
          var dueCents = Number(currData.due.cents);
          totalDueNow = dueCents / 100;
          var dueIso = currData.due.currency_iso || targetCurrency;
          if (dueIso === 'USD' && CURRENCY === 'CAD') {
            totalDueNow = totalDueNow * USD_TO_CAD_RATE;
          }
          totalDueNow = round2_(totalDueNow);
          Logger.log('Due Now: $' + totalDueNow);
        }
        
        // Extract paid
        if (currData.paid && currData.paid.cents !== undefined) {
          var paidCents = Number(currData.paid.cents);
          totalPaid = paidCents / 100;
          var paidIso = currData.paid.currency_iso || targetCurrency;
          if (paidIso === 'USD' && CURRENCY === 'CAD') {
            totalPaid = totalPaid * USD_TO_CAD_RATE;
          }
          totalPaid = round2_(totalPaid);
          Logger.log('Total Paid: $' + totalPaid);
        }
        
        dataSource = 'commission_stats';
      }
    }
    
    // 4) Fallback: Calculate from commissions API
    if (totalUnpaid === 0 && totalDueNow === 0) {
      Logger.log('Fallback: Calculating from commissions API');
      var totals = sumDueNowForAffiliate_(aff.id, apiKey);
      totalUnpaid = round2_(totals.unpaid || 0);
      totalDueNow = round2_(totals.dueNow || 0);
      totalPaid = round2_(totals.paid || 0);
      dataSource = 'calculated_from_commissions';
    }
    
    // 5) Get 30-day filtered amounts using helper function with affiliate ID
    var unpaid30Days = 0;
    var dueNow30Days = 0;
    
    try {
      // Use helper function that accepts affiliate ID directly (avoids calling fetchByEmail_ again)
      var thirtyDayData = calculate30DaysRawByAffiliateId_(aff.id, apiKey);
      unpaid30Days = round2_(thirtyDayData.unpaid || 0);
      dueNow30Days = round2_(thirtyDayData.dueNow || 0);
      Logger.log('30-day totals: Unpaid=$' + unpaid30Days + ', Due Now=$' + dueNow30Days);
    } catch(e) {
      Logger.log('Error calculating 30-day totals: ' + e.message);
    }
    
    Logger.log('=== RAW DATA RETRIEVAL COMPLETE ===');
    Logger.log('Source: ' + dataSource);
    Logger.log('All-time: Unpaid=$' + totalUnpaid + ', Due=$' + totalDueNow + ', Paid=$' + totalPaid);
    
    return {
      found: true,
      affiliateId: aff.id,
      totalUnpaid: totalUnpaid,
      totalDueNow: totalDueNow,
      totalPaid: totalPaid,
      unpaid30Days: unpaid30Days,
      dueNow30Days: dueNow30Days,
      dataSource: dataSource
    };
    
  } catch(e) {
    Logger.log('Error getting raw student data: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return { found: false, error: e.message };
  }
}

/**
 * Get commission data for all students for teacher portal display
 * NOTE: This returns RAW 100% values (bypassing email percentages, tracking, overrides)
 * Teachers should see the FULL amounts students are earning
 * Teacher's percentage is applied separately in the "Adjusted Totals" UI section
 */
function getStudentsCommissionData(teacherEmail) {
  try {
    log_('Getting commission data for teacher: ' + teacherEmail);
    
    // Check cache first - cache the entire result set
    var cacheKey = 'students_data_' + teacherEmail.toLowerCase();
    var cached = getCachedApiResponse_(cacheKey);
    if (cached !== null) {
      log_('Using cached student data (' + cached.length + ' students)');
      return cached;
    }
    
    var teacherData = getTeacherData(teacherEmail);
    var studentsWithData = [];
    
    // Get percentage overrides for all students
    var percentageOverrides = getAllStudentPercentageOverrides(teacherEmail);
    
    // Get data for each student - TEACHERS SEE 100% RAW VALUES
    // The teacher's percentage is applied separately in the "Adjusted Totals" section
    teacherData.students.forEach(function(student) {
      try {
        // MIGRATION FIX: Use alias email for display, internal email for lookups
        var displayEmail = student.email;  // Alias email for display
        var internalEmail = student.internalEmail || student.email;  // Internal email for data lookups
        
        log_('Fetching RAW data for student: ' + displayEmail + ' (internal: ' + internalEmail + ')');
        
        // *** CHANGED: Use RAW data fetching (bypasses email percentage, tracking, etc.) ***
        // Teachers should see the FULL 100% values of what students are earning
        // Pass internal email for Rewardful lookup
        var rawData = getRawStudentCommissionData_(internalEmail);
        
        // Get teacher's percentage override for this student (by alias email)
        var teacherPercentageOverride = percentageOverrides[displayEmail.toLowerCase()] || null;
        
        if (rawData && rawData.found) {
          studentsWithData.push({
            email: displayEmail,  // Show alias email to teacher
            internalEmail: internalEmail,  // Keep for reference
            addedDate: student.addedDate,
            // Use 30-day filtered amounts (RAW 100%)
            unpaid30Days: rawData.unpaid30Days || 0,
            dueNow30Days: rawData.dueNow30Days || 0,
            // All-time totals (RAW 100%)
            totalUnpaid: rawData.totalUnpaid || 0,
            totalDueNow: rawData.totalDueNow || 0,
            totalPaid: rawData.totalPaid || 0,
            affiliateId: rawData.affiliateId || '',
            // Include percentage info for transparency (extracted from INTERNAL email where % is encoded)
            emailPercentage: extractEmailPercentage_(internalEmail),
            // Teacher's percentage override for this student
            teacherPercentage: teacherPercentageOverride,
            // Debug info
            raw30DayUnpaid: rawData.unpaid30Days || 0,
            raw30DayDueNow: rawData.dueNow30Days || 0
          });
          
          log_('Student ' + displayEmail + ' - RAW 30d Unpaid: $' + rawData.unpaid30Days + ', RAW 30d Due: $' + rawData.dueNow30Days);
        } else {
          // Student not found or error
          studentsWithData.push({
            email: displayEmail,  // Show alias email
            internalEmail: internalEmail,
            addedDate: student.addedDate,
            unpaid30Days: 0,
            dueNow30Days: 0,
            totalUnpaid: 0,
            totalDueNow: 0,
            totalPaid: 0,
            teacherPercentage: teacherPercentageOverride,
            error: 'Not found in system'
          });
        }
      } catch(e) {
        log_('Error fetching student data for ' + displayEmail + ': ' + e.message);
        studentsWithData.push({
          email: displayEmail,  // Show alias email
          internalEmail: internalEmail,
          addedDate: student.addedDate,
          unpaid30Days: 0,
          dueNow30Days: 0,
          totalUnpaid: 0,
          totalDueNow: 0,
          totalPaid: 0,
          teacherPercentage: teacherPercentageOverride,
          error: e.message
        });
      }
    });
    
    // Cache the result for 5 minutes
    setCachedApiResponse_(cacheKey, studentsWithData);
    
    log_('Returning data for ' + studentsWithData.length + ' students');
    return studentsWithData;
    
  } catch(e) {
    log_('Error getting students commission data: ' + e.message);
    return [];
  }
}

/**
 * Calculate commissions from the last 30 days only
 * This version RESPECTS the student's email percentage and adjustments
 */
function calculateLast30DaysCommissionsAdjusted_(affiliateEmail) {
  try {
    Logger.log('Calculating ADJUSTED last 30 days commissions for: ' + affiliateEmail);
    
    // Get the student's email percentage (if any)
    var emailPercentage = extractEmailPercentage_(affiliateEmail);
    var percentageMultiplier = 1.0;
    
    if (emailPercentage !== null && emailPercentage < 100) {
      percentageMultiplier = emailPercentage / 100;
      Logger.log('Student has email percentage: ' + emailPercentage + '% (multiplier: ' + percentageMultiplier + ')');
    }
    
    // Check for admin override percentage
    var override = getAdminOverride_(affiliateEmail);
    if (override && override.percentageEnabled === true && 
        override.percentageMultiplier !== undefined && 
        override.percentageMultiplier !== 100) {
      var adminMultiplier = override.percentageMultiplier / 100;
      percentageMultiplier = percentageMultiplier * adminMultiplier;
      Logger.log('Admin percentage override active: ' + override.percentageMultiplier + '% (combined multiplier: ' + percentageMultiplier + ')');
    }
    
    // Get raw 30-day data
    var rawData = calculateLast30DaysCommissionsRaw_(affiliateEmail);
    
    // Apply the combined percentage adjustment
    var adjustedUnpaid = round2_(rawData.unpaid * percentageMultiplier);
    var adjustedDueNow = round2_(rawData.dueNow * percentageMultiplier);
    
    Logger.log('Raw 30d: Unpaid $' + rawData.unpaid + ', Due $' + rawData.dueNow);
    Logger.log('Adjusted 30d (×' + percentageMultiplier + '): Unpaid $' + adjustedUnpaid + ', Due $' + adjustedDueNow);
    
    return {
      unpaid: adjustedUnpaid,
      dueNow: adjustedDueNow,
      rawUnpaid: rawData.unpaid,
      rawDueNow: rawData.dueNow,
      multiplier: percentageMultiplier
    };
    
  } catch(e) {
    Logger.log('Error calculating adjusted 30 day commissions: ' + e.message);
    return { unpaid: 0, dueNow: 0, rawUnpaid: 0, rawDueNow: 0, multiplier: 1.0 };
  }
}

/**
 * Calculate RAW commissions from the last 30 days (no adjustments)
 * Helper function for calculateLast30DaysCommissionsAdjusted_
 */
function calculateLast30DaysCommissionsRaw_(affiliateEmail) {
  try {
    Logger.log('Calculating RAW last 30 days commissions for: ' + affiliateEmail);
    
    // Get affiliate data using the main function to get the ID
    // This doesn't affect tracking since we're just getting the ID
    var affiliateData = fetchByEmail_(affiliateEmail);
    if (!affiliateData || !affiliateData.affiliateId) {
      Logger.log('No affiliate found');
      return { unpaid: 0, dueNow: 0 };
    }
    
    var affiliateId = affiliateData.affiliateId;
    var apiKey = getApiKey_();
    
    // Calculate date 30 days ago
    var thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    var cutoffDate = thirtyDaysAgo.toISOString();
    
    Logger.log('Cutoff date (30 days ago): ' + cutoffDate);
    
    // Fetch commissions using the CORRECT API format (same as Commission Portal)
    var allCommissions = [];
    var page = 1;
    var pagesProcessed = 0;
    
    Logger.log("=== FETCHING COMMISSIONS FROM API (30-day filter) ===");
    
    while (page <= MAX_PAGES) {
      try {
        // ✅ CORRECT URL FORMAT: /commissions?affiliate_id={id}&page={page}&per_page=200
        var url = BASE_URL + '/commissions?affiliate_id=' + encodeURIComponent(affiliateId) + 
                  '&page=' + page + '&per_page=200';
        
        Logger.log('Fetching page ' + page + ': ' + url);
        
        // ✅ Use fetchWithRetry_ with multiple auth methods (bearer, basic, token)
        Utilities.sleep(RATE_LIMIT_DELAY_MS); // Rate limiting
        var r = fetchWithRetry_(url, apiKey);
        
        if (!r) {
          Logger.log('No response from API');
          break;
        }
        
        var rc = r.getResponseCode();
        Logger.log('Response code: ' + rc);
        
        if (rc === 404) {
          Logger.log('No more data (404)');
          break;
        }
        
        if (rc < 200 || rc >= 300) {
          Logger.log('API error: HTTP ' + rc);
          break;
        }
        
        // ✅ Use safeParseJson_ for robust parsing
        var body = safeParseJson_(r.getContentText());
        if (!body) {
          Logger.log('Invalid JSON response');
          break;
        }
        
        // ✅ Use extractCommissions_ to get the commission items
        var items = extractCommissions_(body);
        
        if (!items || items.length === 0) {
          Logger.log('No items in response, stopping pagination');
          break;
        }
        
        Logger.log('Fetched ' + items.length + ' commissions on page ' + page);
        allCommissions = allCommissions.concat(items);
        pagesProcessed++;
        page++;
        
      } catch(e) {
        Logger.log('Error fetching commissions page ' + page + ': ' + e.message);
        Logger.log('Stack: ' + e.stack);
        break;
      }
    }
    
    Logger.log('Total commissions fetched: ' + allCommissions.length + ' (from ' + pagesProcessed + ' pages)');
    
    // Filter and calculate amounts for last 30 days using EXACT Commission Portal logic
    var unpaid = 0;
    var dueNow = 0;
    var skippedPendingCount = 0;
    var statusCounts = {};
    var now = new Date();
    var totalProcessed = 0;
    var within30Days = 0;
    var older30Days = 0;
    var noDateCount = 0;
    
    Logger.log("=== PROCESSING COMMISSIONS (30-day filter) ===");
    Logger.log("Cutoff date: " + cutoffDate);
    Logger.log("Current date: " + now.toISOString());
    
    allCommissions.forEach(function(comm) {
      if (!comm) return;
      
      totalProcessed++;
      
      // Check if commission is within last 30 days
      var commDateStr = comm.created_at || comm.conversion_date || comm.date;
      if (!commDateStr) {
        noDateCount++;
        Logger.log('Commission #' + totalProcessed + ' has no date field');
        return;
      }
      
      // Log first few commission dates for debugging
      if (totalProcessed <= 5) {
        Logger.log('Commission #' + totalProcessed + ' date: ' + commDateStr + ' (comparing to cutoff: ' + cutoffDate + ')');
      }
      
      // Convert to Date object for reliable comparison
      var commDate;
      try {
        commDate = new Date(commDateStr);
        if (isNaN(commDate.getTime())) {
          Logger.log('Invalid date format: ' + commDateStr);
          return;
        }
      } catch(e) {
        Logger.log('Error parsing date: ' + commDateStr + ' - ' + e.message);
        return;
      }
      
      // Convert cutoff to Date for comparison
      var cutoffDateObj = new Date(cutoffDate);
      
      // Compare as Date objects
      if (commDate >= cutoffDateObj) {
        within30Days++;
        
        if (within30Days <= 3) {
          Logger.log('✅ Commission #' + totalProcessed + ' is within 30 days: ' + commDateStr);
        }
        // ✅ Use readAmount_ which handles cents fields correctly
        var amt = readAmount_(comm);
        
        // ✅ Use readStatus_ which normalizes status variations
        var status = readStatus_(comm);
        
        var paidAt = (comm.paid_at || comm.payout_at) || '';
        var dueAt = null;
        
        // Parse due_at date
        if (comm.due_at) {
          try {
            dueAt = new Date(comm.due_at);
            if (isNaN(dueAt.getTime())) dueAt = null;
          } catch(_) {
            dueAt = null;
          }
        }
        
        // ✅ EXACT SAME CATEGORIZATION LOGIC as Commission Portal
        var isPaid = false;
        var isDueNow = false;
        
        // Check if commission is paid
        if (paidAt || status === 'paid' || ['paid', 'payout_paid', 'paid_out', 'completed'].indexOf(status) !== -1) {
          isPaid = true;
        }
        
        // Determine if commission is due now (ready for payout)
        if (!isPaid) {
          // Method 1: Check if due date has passed
          if (dueAt && dueAt <= now) {
            isDueNow = true;
          }
          // Method 2: Check status explicitly for approved/ready states
          else if (['approved', 'confirmed', 'ready_for_payout', 'pending_payout'].indexOf(status) !== -1) {
            isDueNow = true;
          }
        }
        
        // Track status counts for debugging
        if (!statusCounts[status]) {
          statusCounts[status] = { count: 0, amount: 0 };
        }
        statusCounts[status].count++;
        statusCounts[status].amount += amt;
        
        // ✅ CRITICAL: EXCLUDE pending commissions (same as Commission Portal)
        // System does NOT count "pending" status commissions in unpaid total
        var shouldInclude = true;
        if (!isPaid && status === 'pending') {
          shouldInclude = false;
          skippedPendingCount++;
        }
        
        // Calculate totals
        if (shouldInclude && !isPaid) {
          unpaid += amt;
          if (isDueNow) {
            dueNow += amt;
          }
        }
      } else {
        older30Days++;
        if (older30Days <= 3) {
          Logger.log('❌ Commission #' + totalProcessed + ' is older than 30 days: ' + commDateStr);
        }
      }
    });
    
    Logger.log('=== PROCESSING SUMMARY ===');
    Logger.log('Total commissions processed: ' + totalProcessed);
    Logger.log('Within 30 days: ' + within30Days);
    Logger.log('Older than 30 days: ' + older30Days);
    Logger.log('No date field: ' + noDateCount);
    Logger.log('Status breakdown (30 days): ' + JSON.stringify(statusCounts));
    Logger.log('Skipped pending commissions: ' + skippedPendingCount);
    
    Logger.log('RAW Last 30 days - Unpaid: ' + unpaid + ', Due Now: ' + dueNow);
    
    return {
      unpaid: round2_(unpaid),
      dueNow: round2_(dueNow)
    };
    
  } catch(e) {
    Logger.log('Error calculating raw 30 day commissions: ' + e.message);
    return { unpaid: 0, dueNow: 0 };
  }
}

/**
 * Helper function to get API key
 */
function getApiKey_() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
  if (!apiKey) throw new Error('Missing AFFILIATE_API_KEY in Script properties.');
  return apiKey;
}

/**
 * Test function for mario30%@gmail.com
 * Run this from the Apps Script editor to debug
 */
function testMario() {
  Logger.log('Testing mario30%@gmail.com...');
  return debugStudent30DayCommissions('mario30%@gmail.com');
}

/* ========================================
 * TEACHER PAYMENT TRACKING SYSTEM
 * ========================================*/

/**
 * Get storage key for teacher payment tracking
 */
function getTeacherPaymentKey_(teacherEmail) {
  return 'TEACHER_PAYMENT_' + teacherEmail.toLowerCase().replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Get storage key for teacher adjustment percentage
 */
function getTeacherPercentageKey_(teacherEmail) {
  return 'TEACHER_PERCENTAGE_' + teacherEmail.toLowerCase().replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Save teacher's adjustment percentage
 */
function saveTeacherAdjustmentPercentage(teacherEmail, percentage) {
  try {
    var key = getTeacherPercentageKey_(teacherEmail);
    PropertiesService.getScriptProperties().setProperty(key, String(percentage));
    Logger.log('Saved adjustment percentage for ' + teacherEmail + ': ' + percentage + '%');
    return { success: true };
  } catch(e) {
    Logger.log('Error saving teacher percentage: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Get teacher's adjustment percentage
 */
function getTeacherAdjustmentPercentage(teacherEmail) {
  try {
    var key = getTeacherPercentageKey_(teacherEmail);
    var percentage = PropertiesService.getScriptProperties().getProperty(key);
    
    if (percentage === null || percentage === undefined) {
      return 10; // Default to 10%
    }
    
    return parseFloat(percentage);
  } catch(e) {
    Logger.log('Error getting teacher percentage: ' + e.message);
    return 10;
  }
}

/**
 * Get RAW all-time "Due Now" for a student (no percentages, no adjustments, no tracking)
 * Used specifically for teacher payment calculations
 */
function getRawDueNowForStudent_(email) {
  try {
    // Check cache first
    var cacheKey = 'raw_due_now_' + email.toLowerCase();
    var cached = getCachedApiResponse_(cacheKey);
    if (cached !== null) {
      return cached;
    }
    
    var apiKey = getApiKey_();
    
    // Fetch affiliate by email
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp || affResp.getResponseCode() !== 200) {
      return 0;
    }
    
    var payload = safeParseJson_(affResp.getContentText());
    var aff = extractAffiliate_(payload);
    
    if (!aff || !aff.id) {
      return 0;
    }
    
    // Try to fetch with expansion for commission_stats
    var affByIdUrl = BASE_URL + '/affiliates/' + aff.id + '?expand=true';
    var affByIdResp = fetchWithRetry_(affByIdUrl, apiKey);
    
    if (affByIdResp && affByIdResp.getResponseCode() === 200) {
      var expandedPayload = safeParseJson_(affByIdResp.getContentText());
      if (expandedPayload) {
        var expandedAff = extractAffiliate_(expandedPayload);
        if (expandedAff && expandedAff.id) {
          aff = expandedAff;
        }
      }
    }
    
    var result = 0;
    
    // Try to get due balance from commission_stats (most accurate)
    if (aff.commission_stats && aff.commission_stats.currencies) {
      var targetCurrency = CURRENCY; // 'CAD'
      var currData = aff.commission_stats.currencies[targetCurrency] || aff.commission_stats.currencies['USD'];
      
      if (currData && currData.due && currData.due.cents !== undefined) {
        var dueCents = Number(currData.due.cents);
        var dueDollars = dueCents / 100;
        
        // Convert if needed
        var dueIso = currData.due.currency_iso || targetCurrency;
        if (dueIso === 'USD' && CURRENCY === 'CAD') {
          dueDollars = dueDollars * USD_TO_CAD_RATE;
        }
        
        result = round2_(dueDollars);
      }
    }
    
    // Fallback: Calculate from commissions
    if (result === 0) {
      var totals = sumDueNowForAffiliate_(aff.id, apiKey);
      result = round2_(totals.dueNow || 0);
    }
    
    // Cache the result
    setCachedApiResponse_(cacheKey, result);
    
    return result;
    
  } catch(e) {
    Logger.log('Error getting raw due now for ' + email + ': ' + e.message);
    return 0;
  }
}

/**
 * Get all teachers and their payment data
 * 
 * IMPORTANT: Uses the LOCKED EARNINGS SYSTEM as the single source of truth.
 * This is the same data shown in the Teacher Portal.
 * 
 * The "accumulatedAmount" returned is the teacher's LOCKED DUE NOW EARNED,
 * which represents the amount available to be paid to the teacher.
 */
function getAllTeachersPaymentData(adminEmail) {
  try {
    Logger.log('=== GETTING ALL TEACHERS PAYMENT DATA ===');
    
    // Verify admin access using canonical helper
    var isAuthorized = adminEmail ? isAdminEmail_(adminEmail) : false;
    
    if (!isAuthorized && !isAdmin_()) {
      Logger.log('Unauthorized access attempt - adminEmail: ' + adminEmail);
      return [];
    }
    
    Logger.log('Authorized admin access: ' + adminEmail);
    
    // STEP 1: Get ALL affiliates from API with pagination
    // (The Rewardful API ignores per_page=200 and uses default ~25, so we must paginate)
    var apiKey = getApiKey_();
    if (!apiKey) {
      Logger.log('ERROR: Missing API key');
      return [];
    }
    
    var allAffiliates = [];
    var page = 1;
    var hasMore = true;
    var maxPages = 20; // Safety limit
    
    while (hasMore && page <= maxPages) {
      var searchUrl = BASE_URL + '/affiliates?per_page=200&page=' + page + '&state[]=active&state[]=pending&state[]=inactive';
      Logger.log('Fetching affiliates page ' + page);
      
      Utilities.sleep(200); // Rate limiting
      var response = fetchWithRetry_(searchUrl, apiKey);
      
      if (!response || response.getResponseCode() !== 200) {
        Logger.log('Failed to fetch affiliates page ' + page);
        break;
      }
      
      var payload = safeParseJson_(response.getContentText());
      var affiliates = extractCommissions_(payload);
      
      Logger.log('Page ' + page + ': Found ' + affiliates.length + ' affiliates');
      
      if (!affiliates || affiliates.length === 0) {
        hasMore = false;
        break;
      }
      
      // Add to master list
      allAffiliates = allAffiliates.concat(affiliates);
      page++;
    }
    
    if (allAffiliates.length === 0) {
      Logger.log('No affiliates found in API');
      return [];
    }
    
    var affiliates = allAffiliates;
    Logger.log('Found ' + affiliates.length + ' total affiliates (across ' + (page - 1) + ' pages)');
    
    // STEP 2: Get stored teacher emails (teachers who have added students)
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var storedTeacherEmails = {};
    
    for (var key in allProps) {
      if (key.indexOf('TEACHER_STUDENTS_') === 0) {
        // Extract email from key
        var emailKey = key.replace('TEACHER_STUDENTS_', '');
        // Reconstruct email - key format is like: momo50_25_AT_gmail_2ecom
        var email = emailKey.replace(/_AT_/gi, '@').replace(/_2e/gi, '.').replace(/_25/gi, '%');
        // Clean up any remaining underscores between @ and .
        email = email.replace(/@([^.]+)_/g, '@$1.');
        email = email.toLowerCase();
        
        if (email.indexOf('@') > 0) {
          storedTeacherEmails[email] = true;
          Logger.log('Found teacher with students in storage: ' + email);
        }
      }
    }
    
    Logger.log('Found ' + Object.keys(storedTeacherEmails).length + ' teachers with student data');
    
    // STEP 3: Find all teachers - either by name OR by stored data
    var teachers = [];
    var teacherEmailsFound = {};
    
    for (var i = 0; i < affiliates.length; i++) {
      var aff = affiliates[i];
      var email = aff.email ? aff.email.toLowerCase() : '';
      var firstName = aff.first_name || '';
      
      // Check if this is a teacher by:
      // 1. First name contains "teacher" (case insensitive) using canonical helper, OR
      // 2. Email is in our stored teacher list
      var isTeacher = isTeacherByFirstName_(firstName) || storedTeacherEmails[email];
      
      if (isTeacher && email && !teacherEmailsFound[email]) {
        teachers.push(aff);
        teacherEmailsFound[email] = true;
        Logger.log('Found teacher: ' + aff.first_name + ' (' + email + ')');
      }
    }
    
    Logger.log('Total teachers found: ' + teachers.length);
    
    // Calculate payment data for each teacher
    var teacherPaymentData = [];
    
    for (var t = 0; t < teachers.length; t++) {
      var teacher = teachers[t];
      var teacherEmail = teacher.email;
      
      Logger.log('Processing teacher: ' + teacherEmail);
      
      // Get teacher's students
      var teacherData = getTeacherData(teacherEmail);
      var students = teacherData.students || [];
      
      Logger.log('  Students: ' + students.length);
      
      // Get teacher's adjustment percentage
      var teacherPercentage = getTeacherAdjustmentPercentage(teacherEmail);
      
      Logger.log('  Teacher percentage: ' + teacherPercentage + '%');
      
      // =====================================================
      // SECTION 1: REAL-TIME STUDENT TOTALS (Top Cards in Teacher Portal)
      // These are the current raw values from all students
      // =====================================================
      var studentsData = getStudentsCommissionData(teacherEmail);
      var totalUnpaidRaw = 0;
      var totalDueNowRaw = 0;
      
      for (var s = 0; s < studentsData.length; s++) {
        var student = studentsData[s];
        totalUnpaidRaw += parseFloat(student.totalUnpaid || 0);
        totalDueNowRaw += parseFloat(student.totalDueNow || 0);
      }
      
      totalUnpaidRaw = round2_(totalUnpaidRaw);
      totalDueNowRaw = round2_(totalDueNowRaw);
      
      Logger.log('  Real-time Student Totals (raw, 100%):');
      Logger.log('    - Total Unpaid: $' + totalUnpaidRaw);
      Logger.log('    - Total Due Now: $' + totalDueNowRaw);
      
      // =====================================================
      // SECTION 2: LOCKED EARNINGS (Your Locked Earnings in Teacher Portal)
      // These are cumulative earnings that don't decrease when students get paid
      // =====================================================
      var lockedEarnings = getTeacherEarningsHistory(teacherEmail);
      
      // The payable amount is the "Locked Due Now Earned" from Teacher Portal
      var payableAmount = round2_(lockedEarnings.totalDueNowEarned || 0);
      var lockedUnpaid = round2_(lockedEarnings.totalUnpaidEarned || 0);
      var totalLocked = round2_(lockedEarnings.totalEarned || 0);
      
      Logger.log('  Locked Earnings (from Teacher Portal system):');
      Logger.log('    - Total Locked: $' + totalLocked);
      Logger.log('    - Locked Unpaid: $' + lockedUnpaid);
      Logger.log('    - Locked Due Now (payable): $' + payableAmount);
      
      // Get last payment info
      var paymentKey = getTeacherPaymentKey_(teacherEmail);
      var paymentDataStr = PropertiesService.getScriptProperties().getProperty(paymentKey);
      var paymentData = paymentDataStr ? JSON.parse(paymentDataStr) : null;
      
      teacherPaymentData.push({
        email: teacherEmail,
        name: teacher.first_name + ' ' + (teacher.last_name || ''),
        studentCount: studentsData.length,  // Use actual students with commission data
        // Real-time totals (matches Teacher Portal top cards)
        totalUnpaid: totalUnpaidRaw,
        totalDueNow: totalDueNowRaw,
        // Locked earnings (matches Teacher Portal "Your Locked Earnings")
        lockedUnpaid: lockedUnpaid,
        lockedDueNow: payableAmount,
        totalLockedEarnings: totalLocked,
        // accumulatedAmount for payment button (uses Locked Due Now)
        accumulatedAmount: payableAmount,
        adjustmentPercentage: teacherPercentage,
        lastPayment: paymentData ? {
          amount: paymentData.paidAmount || 0,
          date: paymentData.paymentDate || null
        } : null
      });
    }
    
    Logger.log('=== TEACHERS PAYMENT DATA COMPLETE ===');
    return teacherPaymentData;
    
  } catch(e) {
    Logger.log('Error getting teachers payment data: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return [];
  }
}

/**
 * Record a payment for a teacher and reset their accumulation
 * @param {string} teacherEmail - Teacher's email address
 * @param {number} customAmount - Optional custom payment amount (if not provided, uses accumulated amount)
 */
function recordTeacherPayment(teacherEmail, customAmount) {
  try {
    Logger.log('=== RECORDING PAYMENT FOR TEACHER: ' + teacherEmail + ' ===');
    
    if (!isAdmin_()) {
      Logger.log('Unauthorized access attempt');
      return { success: false, error: 'Unauthorized' };
    }
    
    // Get teacher's students
    var teacherData = getTeacherData(teacherEmail);
    var students = teacherData.students || [];
    
    Logger.log('Students: ' + students.length);
    
    // Calculate current total (this is what we're paying) - ADJUSTED ALL-TIME DUE NOW
    var totalToPay = 0;
    var totalRawDueNow = 0;
    
    for (var s = 0; s < students.length; s++) {
      var student = students[s];
      
      try {
        // Get RAW all-time due now (no percentages, no adjustments, no tracking)
        var studentDueNow = getRawDueNowForStudent_(student.email);
        totalRawDueNow += studentDueNow;
        
        Logger.log('  ' + student.email + ': $' + studentDueNow + ' (all-time due now, raw)');
      } catch(e) {
        Logger.log('  Error calculating for ' + student.email + ': ' + e.message);
      }
    }
    
    // Get teacher's adjustment percentage and apply it
    var teacherPercentage = getTeacherAdjustmentPercentage(teacherEmail);
    var multiplier = teacherPercentage / 100;
    var currentAllStudentsTotal = round2_(totalRawDueNow * multiplier);
    
    Logger.log('Raw total: $' + totalRawDueNow);
    Logger.log('Teacher percentage: ' + teacherPercentage + '%');
    Logger.log('Adjusted total: $' + currentAllStudentsTotal);
    
    // Get previous payment data
    var paymentKey = getTeacherPaymentKey_(teacherEmail);
    var paymentDataStr = PropertiesService.getScriptProperties().getProperty(paymentKey);
    var previousData = paymentDataStr ? JSON.parse(paymentDataStr) : null;
    
    // Calculate amount to pay (accumulated since last payment OR custom amount)
    var amountToPay;
    if (customAmount !== null && customAmount !== undefined && customAmount > 0) {
      // Use custom amount if provided
      amountToPay = round2_(customAmount);
      Logger.log('Using custom payment amount: $' + amountToPay);
    } else {
      // Calculate accumulated amount
      amountToPay = currentAllStudentsTotal;
      if (previousData && previousData.lastPaidAllStudentsTotal !== undefined) {
        amountToPay = round2_(currentAllStudentsTotal - previousData.lastPaidAllStudentsTotal);
        if (amountToPay < 0) amountToPay = 0;
      }
      Logger.log('Using accumulated payment amount: $' + amountToPay);
    }
    
    Logger.log('Current all students total: $' + currentAllStudentsTotal);
    Logger.log('Amount to pay: $' + amountToPay);
    
    // Save payment record
    var paymentRecord = {
      paymentDate: new Date().toISOString(),
      paidAmount: amountToPay,
      lastPaidAllStudentsTotal: currentAllStudentsTotal, // Store current total as baseline for next payment
      studentCount: students.length
    };
    
    PropertiesService.getScriptProperties().setProperty(paymentKey, JSON.stringify(paymentRecord));
    
    // ALSO UPDATE LOCKED EARNINGS SYSTEM
    // Reduce teacher's locked earnings by the payment amount
    Logger.log('Updating locked earnings system...');
    var lockedHistory = getTeacherEarningsHistory(teacherEmail);
    var originalLockedTotal = lockedHistory.totalEarned || 0;
    
    Logger.log('Current locked earnings: $' + originalLockedTotal);
    Logger.log('Payment amount: $' + amountToPay);
    
    if (amountToPay > 0 && originalLockedTotal > 0) {
      var amountToReduceFromLocked = Math.min(amountToPay, originalLockedTotal);
      
      // =====================================================
      // PAYMENT REDUCTION LOGIC:
      // The "Pay Now" button pays the "Locked Due Now" amount,
      // so we reduce from DUE NOW FIRST, then from UNPAID.
      // This correctly reflects that we're paying what's ready to pay.
      // =====================================================
      var originalDueNow = lockedHistory.totalDueNowEarned || 0;
      var originalUnpaid = lockedHistory.totalUnpaidEarned || 0;
      
      if (originalDueNow >= amountToReduceFromLocked) {
        // Full payment can be covered by Due Now
        lockedHistory.totalDueNowEarned = round2_(originalDueNow - amountToReduceFromLocked);
        Logger.log('Reduced Due Now by: $' + amountToReduceFromLocked);
        Logger.log('  Due Now: $' + originalDueNow + ' → $' + lockedHistory.totalDueNowEarned);
      } else {
        // Due Now not enough, reduce remaining from Unpaid
        var remaining = round2_(amountToReduceFromLocked - originalDueNow);
        lockedHistory.totalDueNowEarned = 0;
        lockedHistory.totalUnpaidEarned = round2_(Math.max(0, originalUnpaid - remaining));
        Logger.log('Reduced Due Now by: $' + originalDueNow + ' (depleted to $0)');
        Logger.log('Reduced Unpaid by: $' + remaining);
        Logger.log('  Unpaid: $' + originalUnpaid + ' → $' + lockedHistory.totalUnpaidEarned);
      }
      
      // Recalculate total
      lockedHistory.totalEarned = round2_(lockedHistory.totalUnpaidEarned + lockedHistory.totalDueNowEarned);
      saveTeacherEarningsHistory(teacherEmail, lockedHistory);
      
      Logger.log('=== LOCKED EARNINGS AFTER PAYMENT ===');
      Logger.log('  Locked Unpaid: $' + lockedHistory.totalUnpaidEarned);
      Logger.log('  Locked Due Now: $' + lockedHistory.totalDueNowEarned);
      Logger.log('  Total Locked: $' + lockedHistory.totalEarned);
    } else {
      Logger.log('No locked earnings to reduce (amount: $' + amountToPay + ', total: $' + originalLockedTotal + ')');
    }
    
    // Clear all caches related to this teacher and their students
    clearTeacherCache_(teacherEmail);
    for (var i = 0; i < students.length; i++) {
      clearStudentCache_(students[i].email);
    }
    
    Logger.log('✅ Payment recorded successfully');
    Logger.log('=== PAYMENT RECORD COMPLETE ===');
    
    return {
      success: true,
      paidAmount: amountToPay,
      teacherEmail: teacherEmail,
      oldLockedBalance: originalLockedTotal,
      newLockedBalance: lockedHistory.totalEarned || 0
    };
    
  } catch(e) {
    Logger.log('Error recording teacher payment: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return {
      success: false,
      error: e.message
    };
  }
}

/* ========================================
 * ATTENDANCE PORTAL FUNCTIONS
 * ========================================*/

/**
 * Hash password using SHA-256
 */
function hashPassword_(password) {
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  var hashString = '';
  for (var i = 0; i < rawHash.length; i++) {
    var byte = rawHash[i];
    if (byte < 0) byte += 256;
    var byteString = byte.toString(16);
    if (byteString.length == 1) byteString = '0' + byteString;
    hashString += byteString;
  }
  return hashString;
}

/**
 * Get storage key for attendance user
 */
function getAttendanceUserKey_(email) {
  return 'ATTENDANCE_USER_' + email.toLowerCase().replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Get attendance user data with migration support
 * This checks BOTH the alias email AND the internal email for existing data
 * If data is found under internal email but not alias, it migrates the data
 * 
 * @param {string} aliasEmail - The user's login/alias email
 * @returns {object|null} - User data or null if not found
 */
function getAttendanceUserWithMigration_(aliasEmail) {
  var aliasLower = aliasEmail.toLowerCase().trim();
  var props = PropertiesService.getScriptProperties();
  
  // First, try to find data under the alias email
  var aliasKey = getAttendanceUserKey_(aliasLower);
  var aliasDataStr = props.getProperty(aliasKey);
  
  if (aliasDataStr) {
    // Data exists under alias - return it
    try {
      return { data: JSON.parse(aliasDataStr), key: aliasKey, source: 'alias' };
    } catch (e) {
      Logger.log('Error parsing alias attendance data: ' + e.message);
    }
  }
  
  // No data under alias - check if this alias has an internal email
  var authRecord = getAuthRecord_(aliasLower);
  if (!authRecord || !authRecord.internalEmail) {
    // No internal email mapping - data truly doesn't exist
    return null;
  }
  
  var internalEmail = authRecord.internalEmail.toLowerCase().trim();
  var internalKey = getAttendanceUserKey_(internalEmail);
  var internalDataStr = props.getProperty(internalKey);
  
  if (!internalDataStr) {
    // No data under internal email either
    return null;
  }
  
  // DATA FOUND UNDER INTERNAL EMAIL - Migrate it to alias email
  Logger.log('=== MIGRATING ATTENDANCE DATA ===');
  Logger.log('From internal email: ' + internalEmail);
  Logger.log('To alias email: ' + aliasLower);
  
  try {
    var userData = JSON.parse(internalDataStr);
    
    // Update the email in the data to the alias
    userData.originalEmail = userData.email;  // Keep record of original
    userData.email = aliasLower;              // Update to alias
    userData.migratedFrom = internalEmail;    // Track migration
    userData.migratedAt = new Date().toISOString();
    
    // Save under alias key
    props.setProperty(aliasKey, JSON.stringify(userData));
    Logger.log('Attendance data migrated successfully');
    
    // Optionally, we could delete the old key, but keeping it for safety
    // props.deleteProperty(internalKey);
    
    return { data: userData, key: aliasKey, source: 'migrated', migratedFrom: internalEmail };
  } catch (e) {
    Logger.log('Error migrating attendance data: ' + e.message);
    return null;
  }
}

/**
 * Check if user has attendance data (considering migration)
 * @param {string} email - Email to check (alias or internal)
 * @returns {boolean}
 */
function hasAttendanceData_(email) {
  var result = getAttendanceUserWithMigration_(email);
  return result !== null;
}

/**
 * Get storage key for attendance record
 */
function getAttendanceRecordKey_(email, date) {
  var dateStr = typeof date === 'string' ? date : Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return 'ATTENDANCE_' + email.toLowerCase().replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_') + '_' + dateStr;
}

/**
 * Get today's date string in YYYY-MM-DD format
 */
function getTodayDateString_() {
  var now = new Date();
  return Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Register a new attendance user
 */
function registerAttendanceUser(name, email, password) {
  try {
    Logger.log('Registering new attendance user: ' + email);
    
    if (!name || !email || !password) {
      return { success: false, error: 'All fields are required' };
    }
    
    if (password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters' };
    }
    
    var emailLower = email.toLowerCase().trim();
    var userKey = getAttendanceUserKey_(emailLower);
    
    // Check if user already exists
    var existingUser = PropertiesService.getScriptProperties().getProperty(userKey);
    if (existingUser) {
      Logger.log('User already exists: ' + email);
      return { success: false, error: 'An account with this email already exists' };
    }
    
    // Create user record
    var userData = {
      name: name.trim(),
      email: emailLower,
      passwordHash: hashPassword_(password),
      createdDate: new Date().toISOString(),
      teacherEmail: null  // Will be set later by user
    };
    
    // Save user
    PropertiesService.getScriptProperties().setProperty(userKey, JSON.stringify(userData));
    
    // *** FIX: Initialize attendance tracking for today ***
    // This fixes the bug where new accounts don't track attendance properly
    var todayDate = getTodayDateString_();
    var attendanceKey = getAttendanceRecordKey_(emailLower, todayDate);
    var initialAttendanceRecord = {
      email: emailLower,
      name: name.trim(),
      date: todayDate,
      confirmed: false,
      timestamp: null,
      createdDate: new Date().toISOString()
    };
    PropertiesService.getScriptProperties().setProperty(attendanceKey, JSON.stringify(initialAttendanceRecord));
    Logger.log('Initialized attendance tracking for new user on ' + todayDate);
    
    Logger.log('User registered successfully: ' + email);
    return { success: true, message: 'Account created successfully' };
    
  } catch(e) {
    Logger.log('Error registering user: ' + e.message);
    return { success: false, error: 'Failed to create account: ' + e.message };
  }
}

/**
 * Login attendance user
 * NOTE: This is a legacy function. New logins should use loginAndCreateSession().
 */
function loginAttendanceUser(email, password) {
  try {
    Logger.log('Login attempt for: ' + email);
    
    if (!email || !password) {
      return { success: false, error: 'Email and password are required' };
    }
    
    var emailLower = email.toLowerCase().trim();
    
    // BLOCK LEGACY/INTERNAL EMAIL LOGINS
    var legacyCheck = checkLegacyEmailLogin(emailLower);
    if (legacyCheck.isLegacy) {
      Logger.log('Blocked internal email login attempt: ' + emailLower);
      return { 
        success: false, 
        error: legacyCheck.error,
        isLegacyEmail: true,
        aliasEmail: legacyCheck.aliasEmail
      };
    }
    var userKey = getAttendanceUserKey_(emailLower);
    
    // Get user data
    var userDataStr = PropertiesService.getScriptProperties().getProperty(userKey);
    if (!userDataStr) {
      Logger.log('User not found: ' + email);
      return { success: false, error: 'Invalid email or password' };
    }
    
    var userData = JSON.parse(userDataStr);
    
    // Verify password
    var passwordHash = hashPassword_(password);
    if (passwordHash !== userData.passwordHash) {
      Logger.log('Invalid password for: ' + email);
      return { success: false, error: 'Invalid email or password' };
    }
    
    Logger.log('Login successful: ' + email);
    
    // Check admin status using canonical admin list
    var isAdmin = isAdminEmail_(emailLower);
    
    // Return user data (without password hash)
    return {
      success: true,
      isAdmin: isAdmin,
      user: {
        name: userData.name,
        email: userData.email,
        createdDate: userData.createdDate,
        isAdmin: isAdmin
      }
    };
    
  } catch(e) {
    Logger.log('Error during login: ' + e.message);
    return { success: false, error: 'Login failed: ' + e.message };
  }
}

/**
 * Helper: Find affiliate by email (simple lookup without tracking)
 */
function findAffiliateByEmail_(email, apiKey) {
  try {
    if (!email || !apiKey) {
      return null;
    }
    
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp || affResp.getResponseCode() !== 200) {
      return null;
    }
    
    var payload = safeParseJson_(affResp.getContentText());
    var aff = extractAffiliate_(payload);
    
    return aff; // Returns affiliate object or null
    
  } catch(e) {
    Logger.log('Error finding affiliate by email: ' + e.message);
    return null;
  }
}

/**
 * Simplified email-only login (verify email exists in Rewardful)
 * Admin status is determined from ADMIN_EMAILS (single source of truth)
 */
function loginAttendanceWithEmail(email) {
  try {
    Logger.log('Email-only login attempt for: ' + email);
    
    if (!email) {
      return { success: false, error: 'Email is required' };
    }
    
    var emailLower = email.toLowerCase().trim();
    
    // BLOCK LEGACY/INTERNAL EMAIL LOGINS
    var legacyCheck = checkLegacyEmailLogin(emailLower);
    if (legacyCheck.isLegacy) {
      Logger.log('Blocked internal email login attempt: ' + emailLower);
      return { 
        success: false, 
        error: legacyCheck.error,
        isLegacyEmail: true,
        aliasEmail: legacyCheck.aliasEmail
      };
    }
    
    // Check admin status using canonical admin list
    var isAdmin = isAdminEmail_(emailLower);
    
    // MIGRATION FIX: Check teacher override list FIRST (before affiliate lookup)
    // This handles migrated users whose affiliate first name might not contain "teacher"
    var isTeacherByOverride = isTeacherOverrideEmail_(emailLower);
    if (isTeacherByOverride) {
      Logger.log('User is a teacher via OVERRIDE LIST: ' + emailLower);
    }
    
    // Verify email exists in Rewardful database
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) {
      return { success: false, error: 'System configuration error' };
    }
    
    // MIGRATION FIX: Resolve alias email to internal email for Rewardful lookup
    var emailForLookup = getRewardfulEmailForLookup_(emailLower);
    if (emailForLookup !== emailLower) {
      Logger.log('Resolved alias to internal email for lookup: ' + emailLower + ' -> ' + emailForLookup);
    }
    
    // Search for affiliate by email (use internal email if available)
    var affiliate = findAffiliateByEmail_(emailForLookup, apiKey);
    
    if (!affiliate) {
      Logger.log('Email not found in Rewardful database: ' + emailForLookup);
      return { 
        success: false, 
        error: 'Email not found. Please make sure you are using your affiliate email address.' 
      };
    }
    
    Logger.log('Email verified in Rewardful: ' + affiliate.first_name + ' ' + affiliate.last_name);
    
    // Check if user is a teacher using canonical helper OR override list
    var firstName = affiliate.first_name || '';
    var isTeacher = isTeacherByOverride || isTeacherByFirstName_(firstName);
    Logger.log('User is a teacher: ' + isTeacher + ' (override: ' + isTeacherByOverride + ', firstName: ' + firstName + ')');
    
    // Check if user already has a teacher assigned
    var teacherResult = getTeacherForAttendanceUser(emailLower);
    var hasTeacher = teacherResult.success && teacherResult.teacherEmail;
    
    // Teachers with "none" assignment are considered to have a teacher (themselves)
    var hasTeacherOrSelf = hasTeacher || (teacherResult.success && teacherResult.teacherEmail === 'none');
    
    Logger.log('User has existing teacher assignment: ' + hasTeacher);
    if (hasTeacher) {
      Logger.log('Existing teacher: ' + teacherResult.teacherEmail);
    }
    
    // Return success with affiliate info
    return {
      success: true,
      isAdmin: isAdmin, // From canonical ADMIN_EMAILS check
      isTeacher: isTeacher, // Tell frontend if user is a teacher
      needsTeacherSelection: !hasTeacherOrSelf,
      existingTeacher: hasTeacher ? teacherResult.teacherEmail : null,
      user: {
        name: affiliate.first_name + ' ' + affiliate.last_name,
        email: emailLower,
        affiliateId: affiliate.id,
        isTeacher: isTeacher,
        isAdmin: isAdmin // Include in user object too
      }
    };
    
  } catch(e) {
    Logger.log('Error during email login: ' + e.message);
    return { success: false, error: 'Login failed: ' + e.message };
  }
}

/**
 * Complete attendance login by selecting a teacher
 * Teachers can select "none" to indicate they don't need a teacher assignment
 */
function completeAttendanceLoginWithTeacher(email, teacherEmail) {
  try {
    Logger.log('Completing login for ' + email + ' with teacher: ' + teacherEmail);
    
    if (!email || !teacherEmail) {
      return { success: false, error: 'Email and teacher selection are required' };
    }
    
    var emailLower = email.toLowerCase().trim();
    var teacherEmailLower = teacherEmail.toLowerCase().trim();
    
    // MIGRATION FIX: Resolve alias email to internal email for Rewardful lookup
    var emailForLookup = getRewardfulEmailForLookup_(emailLower);
    if (emailForLookup !== emailLower) {
      Logger.log('Resolved alias to internal email for affiliate lookup: ' + emailLower + ' -> ' + emailForLookup);
    }
    
    // Get affiliate info using internal email
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    var affiliate = findAffiliateByEmail_(emailForLookup, apiKey);
    
    if (!affiliate) {
      Logger.log('Affiliate not found for email: ' + emailForLookup + ' (alias: ' + emailLower + ')');
      return { success: false, error: 'Affiliate not found. Please contact support if this persists.' };
    }
    
    // Check if user selected "none" (for teachers who don't need a teacher assignment)
    var isNoneSelection = teacherEmailLower === 'none';
    
    if (isNoneSelection) {
      // Verify that this user is actually a teacher using canonical helper
      var firstName = affiliate.first_name || '';
      var isTeacher = isTeacherByFirstName_(firstName);
      
      if (!isTeacher) {
        Logger.log('Non-teacher tried to select "none" - rejecting (first name: ' + firstName + ')');
        return { success: false, error: 'Only teachers can skip teacher selection' };
      }
      
      Logger.log('Teacher selecting "none" - no teacher assignment needed');
    } else {
      // Regular flow: Add student to teacher's list
      // MIGRATION FIX: Use addStudentToTeacherByEmail which handles alias->internal email resolution
      var result = addStudentToTeacherByEmail(teacherEmailLower, emailLower);
      
      if (!result.success) {
        // Check if it's because student is already added (which is fine)
        if (result.status === 'ALREADY_ADDED' || (result.error && result.error.indexOf('already') !== -1)) {
          Logger.log('Student already assigned to this teacher - that\'s OK');
        } else {
          Logger.log('Failed to add student to teacher: ' + result.error);
          // For other errors, return failure
          return { success: false, error: result.error };
        }
      } else {
        Logger.log('Successfully added student to teacher');
      }
    }
    
    // Initialize attendance user data for this user
    var userKey = getAttendanceUserKey_(emailLower);
    var existing = PropertiesService.getScriptProperties().getProperty(userKey);
    
    if (!existing) {
      var userData = {
        email: emailLower,
        name: affiliate.first_name + ' ' + affiliate.last_name,
        createdDate: new Date().toISOString(),
        teacherEmail: teacherEmailLower
      };
      PropertiesService.getScriptProperties().setProperty(userKey, JSON.stringify(userData));
      Logger.log('Initialized attendance user data for: ' + emailLower);
    } else {
      // Update existing user data with teacher
      var userData = JSON.parse(existing);
      userData.teacherEmail = teacherEmailLower;
      PropertiesService.getScriptProperties().setProperty(userKey, JSON.stringify(userData));
      Logger.log('Updated teacher for existing user: ' + emailLower);
    }
    
    // Set teacher for this user
    setTeacherForAttendanceUser(emailLower, teacherEmailLower);
    
    return {
      success: true,
      user: {
        name: affiliate.first_name + ' ' + affiliate.last_name,
        email: emailLower,
        teacher: teacherEmailLower
      }
    };
    
  } catch(e) {
    Logger.log('Error completing login: ' + e.message);
    return { success: false, error: 'Failed to complete login: ' + e.message };
  }
}

/**
 * Validate session (check if user exists)
 */
function validateSession(email) {
  try {
    if (!email) {
      return { success: false };
    }
    
    var emailLower = email.toLowerCase().trim();
    
    // Check admin status using canonical admin list
    var isAdmin = isAdminEmail_(emailLower);
    
    var userKey = getAttendanceUserKey_(emailLower);
    
    var userDataStr = PropertiesService.getScriptProperties().getProperty(userKey);
    if (!userDataStr) {
      // If user doesn't have attendance data but is an admin, still allow
      if (isAdmin) {
        return {
          success: true,
          isAdmin: true,
          user: {
            name: 'Administrator',
            email: emailLower,
            isAdmin: true
          }
        };
      }
      return { success: false };
    }
    
    var userData = JSON.parse(userDataStr);
    
    return {
      success: true,
      isAdmin: isAdmin,
      user: {
        name: userData.name,
        email: userData.email,
        createdDate: userData.createdDate,
        isAdmin: isAdmin
      }
    };
    
  } catch(e) {
    Logger.log('Error validating session: ' + e.message);
    return { success: false };
  }
}

/**
 * Confirm attendance for today
 * Creates a NEW record each time (allows multiple confirmations per day)
 * 
 * REQUIREMENTS (Issue 2 & 3 fix):
 * - User must have a valid ATTENDANCE_USER record
 * - User must have a valid teacher assigned (teacherEmail not null)
 * - If teacher has removed this student, they must re-select a teacher first
 */
function confirmAttendance(email, userLocalDate) {
  try {
    Logger.log('=== CONFIRMING ATTENDANCE ===');
    Logger.log('Email: ' + email);
    Logger.log('User Local Date: ' + userLocalDate);
    
    if (!email) {
      Logger.log('ERROR: Email is required');
      return { success: false, error: 'Email is required' };
    }
    
    var emailLower = email.toLowerCase().trim();
    
    // Verify user exists - use migration-aware lookup
    var migrationResult = getAttendanceUserWithMigration_(emailLower);
    if (!migrationResult || !migrationResult.data) {
      Logger.log('ERROR: User not found for: ' + emailLower);
      return { success: false, error: 'User not found. Please log in again.' };
    }
    
    var userData = migrationResult.data;
    var userKey = migrationResult.key;
    
    if (migrationResult.source === 'migrated') {
      Logger.log('Using migrated attendance data from: ' + migrationResult.migratedFrom);
    }
    Logger.log('User data loaded: ' + JSON.stringify(userData));
    
    // =====================================================
    // CRITICAL FIX (Issue 2 & 3): Validate teacher assignment
    // User MUST have a valid teacher OR be a teacher themselves (teacherEmail = "none")
    // =====================================================
    if (!userData.teacherEmail) {
      Logger.log('ERROR: No teacher assigned for user: ' + emailLower);
      return { 
        success: false, 
        error: 'No teacher assigned. Please select a teacher first.',
        requiresTeacherSelection: true
      };
    }
    
    // Check if user is a teacher who selected "none" - they don't need teacher validation
    var isTeacherWithNone = userData.teacherEmail === 'none';
    
    if (isTeacherWithNone) {
      Logger.log('User is a teacher with "none" teacher assignment - skipping teacher validation');
    } else {
      // Regular student: Verify the teacher still has this student in their list
      var teacherData = getTeacherData(userData.teacherEmail);
      var isStillAssigned = false;
      
      if (teacherData && teacherData.students) {
        for (var i = 0; i < teacherData.students.length; i++) {
          if (teacherData.students[i].email.toLowerCase() === emailLower) {
            isStillAssigned = true;
            break;
          }
        }
      }
      
      if (!isStillAssigned) {
        Logger.log('ERROR: Student no longer assigned to teacher: ' + userData.teacherEmail);
        // Clear the stale teacher assignment
        userData.teacherEmail = null;
        PropertiesService.getScriptProperties().setProperty(userKey, JSON.stringify(userData));
        
        return { 
          success: false, 
          error: 'Your teacher has removed you from their list. Please select a new teacher.',
          requiresTeacherSelection: true
        };
      }
    }
    
    Logger.log('Teacher validation passed: ' + userData.teacherEmail);
    
    // Use the date from the user's browser (their local timezone)
    var todayStr = userLocalDate || getTodayDateString_();
    Logger.log('Using date: ' + todayStr + (userLocalDate ? ' (from user browser)' : ' (from server)'));
    
    // Get current timestamp
    var now = new Date();
    var timestamp = now.getTime();
    
    // Create UNIQUE key with timestamp to allow multiple records per day
    var recordKey = 'ATTENDANCE_' + emailLower.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_') + '_' + todayStr + '_' + timestamp;
    
    // Create NEW attendance record
    var attendanceRecord = {
      email: emailLower,
      date: todayStr,
      confirmed: true,
      timestamp: now.toISOString(),
      recordId: timestamp,
      teacherEmail: userData.teacherEmail  // Include teacher for reference
    };
    
    // Save NEW attendance record
    PropertiesService.getScriptProperties().setProperty(recordKey, JSON.stringify(attendanceRecord));
    
    Logger.log('✅ Attendance record created: ' + recordKey);
    Logger.log('Record: ' + JSON.stringify(attendanceRecord));
    
    return { 
      success: true, 
      message: 'Attendance confirmed successfully',
      record: attendanceRecord
    };
    
  } catch(e) {
    Logger.log('ERROR confirming attendance: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return { success: false, error: 'Failed to confirm attendance: ' + e.message };
  }
}

/**
 * Delete a single attendance record
 */
function deleteAttendanceRecord(email, recordId) {
  try {
    Logger.log('Deleting attendance record: ' + recordId + ' for: ' + email);
    
    if (!email || !recordId) {
      return { success: false, error: 'Email and record ID are required' };
    }
    
    var emailLower = email.toLowerCase().trim();
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var emailKey = emailLower.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
    var searchPrefix = 'ATTENDANCE_' + emailKey + '_';
    
    // Find and delete the specific record
    var deleted = false;
    for (var key in allProps) {
      if (key.indexOf(searchPrefix) === 0) {
        try {
          var record = JSON.parse(allProps[key]);
          if (record.recordId == recordId) {
            props.deleteProperty(key);
            Logger.log('Deleted attendance record: ' + key);
            deleted = true;
            break;
          }
        } catch(e) {
          Logger.log('Error parsing record: ' + key);
        }
      }
    }
    
    if (deleted) {
      return { success: true, message: 'Attendance record deleted successfully' };
    } else {
      return { success: false, error: 'Record not found' };
    }
    
  } catch(e) {
    Logger.log('Error deleting attendance record: ' + e.message);
    return { success: false, error: 'Failed to delete record: ' + e.message };
  }
}

/**
 * Reset all attendance records for a user
 */
function resetAllAttendance(email) {
  try {
    Logger.log('Resetting all attendance for: ' + email);
    
    if (!email) {
      return { success: false, error: 'Email is required' };
    }
    
    var emailLower = email.toLowerCase().trim();
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var emailKey = emailLower.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
    var searchPrefix = 'ATTENDANCE_' + emailKey + '_';
    
    Logger.log('Looking for keys starting with: ' + searchPrefix);
    
    // Delete all attendance records for this user
    var deletedCount = 0;
    var deletedKeys = [];
    for (var key in allProps) {
      if (key.indexOf(searchPrefix) === 0) {
        props.deleteProperty(key);
        deletedKeys.push(key);
        deletedCount++;
      }
    }
    
    Logger.log('Deleted ' + deletedCount + ' attendance records for: ' + email);
    Logger.log('Deleted keys: ' + JSON.stringify(deletedKeys));
    
    return { 
      success: true, 
      message: 'All attendance records deleted (' + deletedCount + ' records)',
      deletedCount: deletedCount,
      deletedKeys: deletedKeys
    };
    
  } catch(e) {
    Logger.log('Error resetting attendance: ' + e.message);
    return { success: false, error: 'Failed to reset attendance: ' + e.message };
  }
}

/**
 * DIAGNOSTIC: Get all stored keys for a user's attendance
 */
function diagnoseAttendanceStorage(email) {
  try {
    if (!email) {
      return { success: false, error: 'Email is required' };
    }
    
    var emailLower = email.toLowerCase().trim();
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var emailKey = emailLower.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
    var searchPrefix = 'ATTENDANCE_' + emailKey + '_';
    
    var foundKeys = [];
    var records = [];
    
    for (var key in allProps) {
      if (key.indexOf(searchPrefix) === 0) {
        foundKeys.push(key);
        try {
          var record = JSON.parse(allProps[key]);
          records.push({
            key: key,
            date: record.date,
            confirmed: record.confirmed,
            timestamp: record.timestamp,
            recordId: record.recordId
          });
        } catch(e) {
          records.push({
            key: key,
            error: 'Failed to parse: ' + e.message
          });
        }
      }
    }
    
    return {
      success: true,
      email: emailLower,
      emailKey: emailKey,
      searchPrefix: searchPrefix,
      totalKeys: foundKeys.length,
      keys: foundKeys,
      records: records
    };
    
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/**
 * Get attendance data for a user, INCLUDING MISSED DAYS
 * Now supports multiple records per day
 * 
 * IMPORTANT: Uses userLocalDate from the browser to determine "today"
 * This prevents timezone issues where server thinks it's a different day.
 * 
 * CRITICAL FIX (Issue 1): This function now calculates MISSED DAYS
 * - After the first ever confirmation, every subsequent day is either:
 *   - Confirmed (has attendance record)
 *   - Missed (no attendance record for that day)
 * - The history array includes both confirmed AND missed entries
 * 
 * @param {string} email - User's email
 * @param {string} userLocalDate - The user's local date in YYYY-MM-DD format (from browser)
 * @returns {object} - { today: [], history: [], accountCreated: string, firstConfirmDate: string, stats: {} }
 */
function getAttendanceData(email, userLocalDate) {
  try {
    Logger.log('=== GETTING ATTENDANCE DATA ===');
    Logger.log('Email: ' + email);
    Logger.log('User local date: ' + (userLocalDate || 'not provided'));
    
    if (!email) {
      return { today: [], history: [] };
    }
    
    var emailLower = email.toLowerCase().trim();
    
    // Get user's account creation date and teacher info
    var userKey = getAttendanceUserKey_(emailLower);
    var userDataStr = PropertiesService.getScriptProperties().getProperty(userKey);
    var accountCreationDate = null;
    var teacherEmail = null;
    
    if (userDataStr) {
      var userData = JSON.parse(userDataStr);
      accountCreationDate = new Date(userData.createdDate);
      teacherEmail = userData.teacherEmail || null;
    }
    
    // Scan all properties to find attendance records for this user
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var emailKey = emailLower.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
    var searchPrefix = 'ATTENDANCE_' + emailKey + '_';
    
    var allRecords = [];
    
    for (var key in allProps) {
      if (key.indexOf(searchPrefix) === 0) {
        try {
          var record = JSON.parse(allProps[key]);
          if (record.confirmed) {
            allRecords.push(record);
          }
        } catch(e) {
          Logger.log('Error parsing record: ' + key);
        }
      }
    }
    
    // Sort records by date then timestamp (oldest first for finding first confirmation)
    allRecords.sort(function(a, b) {
      var dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });
    
    // =====================================================
    // CRITICAL FIX: Use the USER'S LOCAL DATE as "today"
    // NOT the most recent record's date!
    // =====================================================
    var todayStr;
    if (userLocalDate && /^\d{4}-\d{2}-\d{2}$/.test(userLocalDate)) {
      todayStr = userLocalDate;
      Logger.log('Using user local date as today: ' + todayStr);
    } else {
      todayStr = getTodayDateString_();
      Logger.log('Using server date as today (fallback): ' + todayStr);
    }
    
    // Find the first confirmation date (this is when tracking started)
    var firstConfirmDate = null;
    if (allRecords.length > 0) {
      firstConfirmDate = allRecords[0].date;
      Logger.log('First confirmation date: ' + firstConfirmDate);
    }
    
    // Create a map of dates that have confirmations
    var confirmedDatesMap = {};
    for (var i = 0; i < allRecords.length; i++) {
      var record = allRecords[i];
      if (!confirmedDatesMap[record.date]) {
        confirmedDatesMap[record.date] = [];
      }
      confirmedDatesMap[record.date].push(record);
    }
    
    // =====================================================
    // ISSUE 1 FIX: Calculate ALL dates from first confirm to today
    // Including MISSED days (days without any confirmation)
    // =====================================================
    var todayRecords = confirmedDatesMap[todayStr] || [];
    var historyWithMissed = [];
    
    if (firstConfirmDate) {
      // Generate all dates from first confirmation to yesterday
      var startDate = parseDateString_(firstConfirmDate);
      var endDate = parseDateString_(todayStr);
      
      // Move endDate to yesterday (we handle today separately)
      endDate.setDate(endDate.getDate() - 1);
      
      // Iterate through each date from first confirm to yesterday (most recent first)
      var currentDate = new Date(endDate);
      
      while (currentDate >= startDate) {
        var dateStr = formatDateToString_(currentDate);
        
        if (confirmedDatesMap[dateStr]) {
          // This date has confirmations - add all of them
          var dateRecords = confirmedDatesMap[dateStr];
          // Sort by timestamp descending within the day
          dateRecords.sort(function(a, b) {
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
          });
          for (var j = 0; j < dateRecords.length; j++) {
            historyWithMissed.push(dateRecords[j]);
          }
        } else {
          // This date has NO confirmations - mark as MISSED
          historyWithMissed.push({
            date: dateStr,
            confirmed: false,
            missed: true,
            email: emailLower
          });
        }
        
        // Move to previous day
        currentDate.setDate(currentDate.getDate() - 1);
      }
    }
    
    Logger.log('=== ATTENDANCE SUMMARY ===');
    Logger.log('First confirm: ' + firstConfirmDate);
    Logger.log('Today: ' + todayStr);
    Logger.log('Today records: ' + todayRecords.length);
    Logger.log('History entries (incl. missed): ' + historyWithMissed.length);
    
    // Count missed vs confirmed for stats
    var missedCount = 0;
    var confirmedCount = 0;
    for (var k = 0; k < historyWithMissed.length; k++) {
      if (historyWithMissed[k].missed) {
        missedCount++;
      } else {
        confirmedCount++;
      }
    }
    Logger.log('  - Confirmed entries: ' + confirmedCount);
    Logger.log('  - Missed days: ' + missedCount);
    
    return {
      today: todayRecords,
      history: historyWithMissed,
      accountCreated: accountCreationDate ? accountCreationDate.toISOString() : null,
      todayDate: todayStr,
      firstConfirmDate: firstConfirmDate,
      teacherEmail: teacherEmail,
      stats: {
        confirmedEntries: confirmedCount,
        missedDays: missedCount,
        totalHistoryEntries: historyWithMissed.length
      }
    };
    
  } catch(e) {
    Logger.log('Error getting attendance data: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return { today: [], history: [], todayDate: null };
  }
}

/**
 * Helper: Parse a YYYY-MM-DD string into a Date object (local timezone)
 */
function parseDateString_(dateStr) {
  var parts = dateStr.split('-');
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

/**
 * Helper: Format a Date object to YYYY-MM-DD string
 */
function formatDateToString_(date) {
  var year = date.getFullYear();
  var month = String(date.getMonth() + 1).padStart(2, '0');
  var day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

/**
 * Get all attendance users (for admin)
 */
function getAllAttendanceUsers() {
  try {
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var users = [];
    
    // First pass: collect all users
    for (var key in allProps) {
      if (key.indexOf('ATTENDANCE_USER_') === 0) {
        var userData = JSON.parse(allProps[key]);
        
        // Get alias email from auth record if available
        var aliasEmail = userData.aliasEmail || userData.email;
        var internalEmail = userData.internalEmail || userData.rewardfulEmail || userData.email;
        
        // Try to find auth record for more complete info
        var authRecord = getAuthRecord_(userData.email);
        if (authRecord) {
          aliasEmail = authRecord.aliasEmail || aliasEmail;
          internalEmail = authRecord.rewardfulEmail || authRecord.internalEmail || internalEmail;
        }
        
        // Determine if this is a legacy account (alias == internal)
        var isLegacy = aliasEmail.toLowerCase().trim() === internalEmail.toLowerCase().trim();
        
        users.push({
          name: userData.name,
          email: userData.email,  // Primary lookup email
          aliasEmail: aliasEmail,  // Login email (alias)
          internalEmail: internalEmail,  // Rewardful email
          teacherEmail: userData.teacherEmail || null,
          createdDate: userData.createdDate,
          isTeacher: userData.isTeacher || false,
          isLegacy: isLegacy
        });
      }
    }
    
    // Second pass: Build a map of internal emails for migrated accounts
    // to identify orphaned legacy accounts
    var migratedInternalEmails = {};
    for (var i = 0; i < users.length; i++) {
      if (!users[i].isLegacy) {
        // This is a migrated account - record its internal email
        migratedInternalEmails[users[i].internalEmail.toLowerCase().trim()] = users[i];
      }
    }
    
    // Third pass: Flag orphaned legacy accounts
    // A legacy account is orphaned if its email matches a migrated account's internal email
    for (var j = 0; j < users.length; j++) {
      if (users[j].isLegacy) {
        var legacyEmail = users[j].email.toLowerCase().trim();
        if (migratedInternalEmails[legacyEmail]) {
          users[j].isOrphanedLegacy = true;
          users[j].migratedTo = migratedInternalEmails[legacyEmail].aliasEmail;
        } else {
          users[j].isOrphanedLegacy = false;
        }
      } else {
        users[j].isOrphanedLegacy = false;
      }
    }
    
    // Sort by name
    users.sort(function(a, b) {
      return (a.name || '').localeCompare(b.name || '');
    });
    
    Logger.log('Found ' + users.length + ' attendance users');
    return { success: true, users: users };
    
  } catch(e) {
    Logger.log('Error getting all users: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Search attendance users (for admin)
 * Uses getAllAttendanceUsers for legacy/orphan detection consistency
 */
function searchAttendanceUsers(searchQuery) {
  try {
    // Get all users first (includes legacy/orphan detection)
    var allResult = getAllAttendanceUsers();
    if (!allResult.success) {
      return allResult;
    }
    
    if (!searchQuery) {
      return allResult;
    }
    
    var query = searchQuery.toLowerCase();
    
    // Filter users based on search query
    var filteredUsers = allResult.users.filter(function(user) {
      return (user.name && user.name.toLowerCase().indexOf(query) !== -1) || 
             (user.email && user.email.toLowerCase().indexOf(query) !== -1) ||
             (user.aliasEmail && user.aliasEmail.toLowerCase().indexOf(query) !== -1) ||
             (user.internalEmail && user.internalEmail.toLowerCase().indexOf(query) !== -1);
    });
    
    Logger.log('Search "' + searchQuery + '" found ' + filteredUsers.length + ' users');
    return { success: true, users: filteredUsers };
    
  } catch(e) {
    Logger.log('Error searching users: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * ADMIN ONLY: Get attendance stats for a user
 */
function getAttendanceStats(email) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized' };
  }
  
  try {
    var emailLower = email.toLowerCase().trim();
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    
    var totalDays = 0;
    var confirmedDays = 0;
    var missedDays = 0;
    var records = [];
    
    for (var key in allProps) {
      if (key.indexOf('ATTENDANCE_' + emailLower.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_')) === 0) {
        var record = JSON.parse(allProps[key]);
        records.push(record);
        totalDays++;
        if (record.confirmed) {
          confirmedDays++;
        } else {
          missedDays++;
        }
      }
    }
    
    var attendanceRate = totalDays > 0 ? Math.round((confirmedDays / totalDays) * 100) : 0;
    
    return {
      success: true,
      stats: {
        totalDays: totalDays,
        confirmedDays: confirmedDays,
        missedDays: missedDays,
        attendanceRate: attendanceRate,
        records: records
      }
    };
    
  } catch(e) {
    Logger.log('Error getting attendance stats: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Canonical helper: Check if a user is a teacher by first name
 * RULE: First name must contain the substring "teacher" (case-insensitive)
 * 
 * Examples:
 *   "Sarah Teacher" → true
 *   "teacherMike" → true  
 *   "TEACHER John" → true
 *   "John" → false
 * 
 * @param {string} firstName - The first name to check
 * @returns {boolean} - True if the first name indicates a teacher
 */
function isTeacherByFirstName_(firstName) {
  if (!firstName || typeof firstName !== 'string') {
    return false;
  }
  return firstName.toLowerCase().indexOf('teacher') !== -1;
}

/**
 * Check if an email is in the teacher override list
 * These accounts are granted teacher access regardless of name check.
 * 
 * @param {string} email - Email to check (alias email)
 * @returns {boolean} - True if this email has teacher access override
 */
function isTeacherOverrideEmail_(email) {
  if (!email) return false;
  var emailLower = email.toLowerCase().trim();
  for (var i = 0; i < TEACHER_OVERRIDE_EMAILS.length; i++) {
    if (TEACHER_OVERRIDE_EMAILS[i].toLowerCase().trim() === emailLower) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a user should have teacher access
 * Checks both the first name AND the override list
 * 
 * @param {string} firstName - First name from affiliate data
 * @param {string} email - User's alias email (optional, for override check)
 * @returns {boolean} - True if user should have teacher access
 */
function hasTeacherAccess_(firstName, email) {
  // First check the override list (alias emails that are always teachers)
  if (email && isTeacherOverrideEmail_(email)) {
    Logger.log('Teacher access granted via override for: ' + email);
    return true;
  }
  
  // Then check by first name
  return isTeacherByFirstName_(firstName);
}

/**
 * Get all valid teachers for selection dropdown
 * Returns ONLY verified teachers (with "teacher" in first name from affiliate system)
 * 
 * FIXED: Now properly paginates through ALL affiliates to find all teachers
 */
function getAllValidTeachers() {
  try {
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('GET ALL VALID TEACHERS');
    Logger.log('═══════════════════════════════════════════════════════');
    
    var teachers = [];
    var teacherEmails = {};
    var debugInfo = {
      totalAffiliatesFetched: 0,
      pagesProcessed: 0,
      teachersFound: 0,
      adminsExcluded: 0,
      errors: []
    };
    
    // Fetch ALL affiliates with pagination
    try {
      var apiKey = getApiKey_();
      if (!apiKey) {
        Logger.log('ERROR: Missing API key');
        return { success: false, error: 'System configuration error', teachers: [] };
      }
      
      var page = 1;
      var hasMore = true;
      var maxPages = 20; // Safety limit (20 * 200 = 4000 affiliates max)
      
      while (hasMore && page <= maxPages) {
        // Include all affiliate states to ensure we don't miss any teachers
        // Rewardful API may filter by state; we want ALL affiliates
        var searchUrl = BASE_URL + '/affiliates?per_page=200&page=' + page + '&state[]=active&state[]=pending&state[]=inactive';
        Logger.log('Fetching affiliates page ' + page + ': ' + searchUrl);
        
        Utilities.sleep(200); // Rate limiting
        var response = fetchWithRetry_(searchUrl, apiKey);
        
        if (!response) {
          debugInfo.errors.push('No response on page ' + page);
          break;
        }
        
        var responseCode = response.getResponseCode();
        if (responseCode !== 200) {
          debugInfo.errors.push('HTTP ' + responseCode + ' on page ' + page);
          break;
        }
        
        var payload = safeParseJson_(response.getContentText());
        var affiliates = extractCommissions_(payload);
        
        Logger.log('Page ' + page + ': Found ' + affiliates.length + ' affiliates');
        debugInfo.totalAffiliatesFetched += affiliates.length;
        debugInfo.pagesProcessed = page;
        
        if (affiliates.length === 0) {
          hasMore = false;
          break;
        }
        
        // Process each affiliate - with DETAILED logging
        affiliates.forEach(function(aff, index) {
          var email = (aff.email || '').toLowerCase().trim();
          var firstName = aff.first_name || '';
          var lastName = aff.last_name || '';
          var fullName = firstName + ' ' + lastName;
          
          // Log every affiliate's first name for debugging
          if (firstName.toLowerCase().indexOf('teacher') !== -1 || 
              firstName.toLowerCase().indexOf('mario') !== -1 || 
              firstName.toLowerCase().indexOf('sarah') !== -1) {
            Logger.log('📌 Affiliate #' + index + ': firstName="' + firstName + '", lastName="' + lastName + '", email="' + email + '"');
          }
          
          // Use canonical teacher check
          var isTeacher = isTeacherByFirstName_(firstName);
          var isAdmin = ADMIN_EMAILS.indexOf(email) !== -1;
          
          // Track all candidates
          if (!debugInfo.allCandidates) {
            debugInfo.allCandidates = [];
          }
          
          if (isTeacher) {
            debugInfo.allCandidates.push({
              firstName: firstName,
              email: email,
              isAdmin: isAdmin,
              included: !isAdmin && email && !teacherEmails[email]
            });
          }
          
          if (isTeacher && !isAdmin && email && !teacherEmails[email]) {
            Logger.log('✓ INCLUDED teacher: ' + fullName.trim() + ' (email: ' + email + ', firstName: "' + firstName + '")');
            teachers.push({
              name: fullName.trim(),
              email: email,
              source: 'affiliate'
            });
            teacherEmails[email] = true;
            debugInfo.teachersFound++;
          } else if (isTeacher && isAdmin) {
            Logger.log('✗ EXCLUDED admin teacher: ' + email);
            debugInfo.adminsExcluded++;
          } else if (isTeacher && !email) {
            Logger.log('✗ EXCLUDED teacher (no email): firstName="' + firstName + '"');
          } else if (isTeacher && teacherEmails[email]) {
            Logger.log('✗ EXCLUDED teacher (duplicate): ' + email);
          }
        });
        
        // Check if we need more pages
        // IMPORTANT: Rewardful API may ignore per_page and use its own default (often 25)
        // So we continue if we got ANY results, and stop only when we get 0 results
        // The empty result check at the top of the loop handles the "no more data" case
        if (affiliates.length > 0) {
          page++;
          // Continue fetching - the loop will stop when affiliates.length === 0
        } else {
          hasMore = false;
        }
      }
      
    } catch(e) {
      Logger.log('ERROR fetching teachers from affiliate system: ' + e.message);
      debugInfo.errors.push(e.message);
    }
    
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('TEACHER SEARCH COMPLETE');
    Logger.log('Total affiliates scanned: ' + debugInfo.totalAffiliatesFetched);
    Logger.log('Pages processed: ' + debugInfo.pagesProcessed);
    Logger.log('Teachers found: ' + debugInfo.teachersFound);
    Logger.log('Admins excluded: ' + debugInfo.adminsExcluded);
    Logger.log('Errors: ' + (debugInfo.errors.length > 0 ? debugInfo.errors.join(', ') : 'None'));
    Logger.log('═══════════════════════════════════════════════════════');
    
    // Sort teachers alphabetically by name
    teachers.sort(function(a, b) {
      return a.name.localeCompare(b.name);
    });
    
    return { 
      success: true, 
      teachers: teachers,
      debug: debugInfo // Include debug info (admin-only, not shown in UI)
    };
    
  } catch(e) {
    Logger.log('EXCEPTION in getAllValidTeachers: ' + e.message);
    return { success: false, error: e.message, teachers: [] };
  }
}

/**
 * Admin debug function: Get detailed teacher list diagnostics
 * Returns comprehensive info about teacher detection
 * 
 * Call from Apps Script: debugTeacherList()
 */
function debugTeacherList() {
  if (!isAdmin_()) {
    return { error: 'Unauthorized - admin only' };
  }
  
  try {
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('DEBUG TEACHER LIST - STARTING');
    Logger.log('═══════════════════════════════════════════════════════');
    
    var result = getAllValidTeachers();
    
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('DEBUG TEACHER LIST - RESULTS');
    Logger.log('Success: ' + result.success);
    Logger.log('Teacher count: ' + (result.teachers ? result.teachers.length : 0));
    if (result.teachers) {
      result.teachers.forEach(function(t, i) {
        Logger.log('  ' + (i+1) + '. ' + t.name + ' (' + t.email + ')');
      });
    }
    if (result.debug && result.debug.allCandidates) {
      Logger.log('All teacher candidates found:');
      result.debug.allCandidates.forEach(function(c, i) {
        Logger.log('  ' + (i+1) + '. firstName="' + c.firstName + '", email=' + c.email + ', isAdmin=' + c.isAdmin + ', included=' + c.included);
      });
    }
    Logger.log('═══════════════════════════════════════════════════════');
    
    return {
      timestamp: new Date().toISOString(),
      success: result.success,
      teacherCount: result.teachers ? result.teachers.length : 0,
      teachers: result.teachers ? result.teachers.map(function(t) {
        return { name: t.name, email: t.email, source: t.source };
      }) : [],
      debug: result.debug,
      allCandidates: result.debug ? result.debug.allCandidates : [],
      error: result.error
    };
  } catch(e) {
    Logger.log('ERROR in debugTeacherList: ' + e.message);
    return { error: e.message, stack: e.stack };
  }
}

/**
 * Test function to check raw API response for affiliates
 * This PROPERLY PAGINATES through all pages to find all affiliates
 */
function testRawAffiliatesFetch() {
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('RAW AFFILIATES FETCH TEST (WITH FULL PAGINATION)');
  Logger.log('═══════════════════════════════════════════════════════');
  
  var apiKey = getApiKey_();
  if (!apiKey) {
    Logger.log('ERROR: No API key');
    return { error: 'No API key' };
  }
  
  var allAffiliates = [];
  var page = 1;
  var maxPages = 50;
  
  // Paginate through ALL pages
  while (page <= maxPages) {
    var searchUrl = BASE_URL + '/affiliates?per_page=200&page=' + page + '&state[]=active&state[]=pending&state[]=inactive';
    Logger.log('Fetching page ' + page + ': ' + searchUrl);
    
    Utilities.sleep(200); // Rate limiting
    var response = fetchWithRetry_(searchUrl, apiKey);
    
    if (!response) {
      Logger.log('ERROR: No response on page ' + page);
      break;
    }
    
    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log('HTTP Error: ' + code + ' on page ' + page);
      break;
    }
    
    var payload = safeParseJson_(response.getContentText());
    var affiliates = extractCommissions_(payload);
    
    Logger.log('Page ' + page + ': Got ' + affiliates.length + ' affiliates');
    
    if (affiliates.length === 0) {
      Logger.log('Empty page - pagination complete');
      break;
    }
    
    allAffiliates = allAffiliates.concat(affiliates);
    page++;
  }
  
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('TOTAL AFFILIATES FETCHED: ' + allAffiliates.length + ' across ' + (page - 1) + ' pages');
  Logger.log('═══════════════════════════════════════════════════════');
  
  // Look for specific affiliates
  var marioFound = false;
  var sarahFound = false;
  var teachersFound = [];
  
  allAffiliates.forEach(function(aff, i) {
    var firstName = (aff.first_name || '').toLowerCase();
    var email = (aff.email || '').toLowerCase();
    
    if (firstName.indexOf('mario') !== -1) {
      marioFound = true;
      Logger.log('🎯 FOUND MARIO: #' + i + ' firstName="' + aff.first_name + '", email="' + aff.email + '"');
    }
    if (firstName.indexOf('sarah') !== -1) {
      sarahFound = true;
      Logger.log('🎯 FOUND SARAH: #' + i + ' firstName="' + aff.first_name + '", email="' + aff.email + '"');
    }
    if (firstName.indexOf('teacher') !== -1) {
      teachersFound.push({
        index: i,
        firstName: aff.first_name,
        email: aff.email
      });
      Logger.log('📚 TEACHER CANDIDATE: #' + i + ' firstName="' + aff.first_name + '", email="' + aff.email + '"');
    }
  });
  
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('SUMMARY:');
  Logger.log('  Total affiliates across all pages: ' + allAffiliates.length);
  Logger.log('  Pages fetched: ' + (page - 1));
  Logger.log('  Mario found: ' + marioFound);
  Logger.log('  Sarah found: ' + sarahFound);
  Logger.log('  Teachers with "teacher" in first name: ' + teachersFound.length);
  Logger.log('═══════════════════════════════════════════════════════');
  
  return {
    totalAffiliates: allAffiliates.length,
    pagesFetched: page - 1,
    marioFound: marioFound,
    sarahFound: sarahFound,
    teachersFound: teachersFound
  };
}

/**
 * Debug function: Check if a specific email exists as an affiliate
 * Useful for diagnosing why an affiliate doesn't appear in teacher list
 */
function debugCheckAffiliate(email) {
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('DEBUG CHECK AFFILIATE: ' + email);
  Logger.log('═══════════════════════════════════════════════════════');
  
  var apiKey = getApiKey_();
  if (!apiKey) {
    return { error: 'No API key' };
  }
  
  // Try direct email lookup
  var affiliate = findAffiliateByEmail_(email, apiKey);
  
  if (!affiliate) {
    Logger.log('❌ Affiliate NOT FOUND by email lookup');
    return { 
      found: false, 
      message: 'Affiliate not found by direct email lookup',
      emailUsed: email 
    };
  }
  
  var firstName = affiliate.first_name || '';
  var lastName = affiliate.last_name || '';
  var isTeacher = isTeacherByFirstName_(firstName);
  var affEmail = (affiliate.email || '').toLowerCase();
  
  Logger.log('✓ Affiliate FOUND:');
  Logger.log('  First name: "' + firstName + '"');
  Logger.log('  Last name: "' + lastName + '"');
  Logger.log('  Email: ' + affEmail);
  Logger.log('  Is Teacher: ' + isTeacher);
  Logger.log('  State: ' + (affiliate.state || 'unknown'));
  Logger.log('  ID: ' + affiliate.id);
  
  // Check if they would be excluded from teacher list
  var isAdmin = ADMIN_EMAILS.indexOf(affEmail) !== -1;
  var wouldBeIncluded = isTeacher && !isAdmin && affEmail;
  
  Logger.log('  Would be included in teacher list: ' + wouldBeIncluded);
  if (!wouldBeIncluded) {
    if (!isTeacher) {
      Logger.log('    - Reason: first name does not contain "teacher"');
    }
    if (isAdmin) {
      Logger.log('    - Reason: email is in ADMIN_EMAILS list');
    }
    if (!affEmail) {
      Logger.log('    - Reason: no email');
    }
  }
  
  return {
    found: true,
    firstName: firstName,
    lastName: lastName,
    email: affEmail,
    state: affiliate.state,
    id: affiliate.id,
    isTeacher: isTeacher,
    isAdmin: isAdmin,
    wouldBeIncludedInTeacherList: wouldBeIncluded
  };
}

/**
 * Set teacher for an attendance user (affiliate)
 * CANONICAL: Uses the new linking system with soft deletes
 */
function setTeacherForAttendanceUser(studentEmail, teacherEmail) {
  try {
    Logger.log('=== Setting teacher for ' + studentEmail + ' to: ' + teacherEmail + ' ===');
    
    if (!studentEmail) {
      return { success: false, error: 'Student email is required' };
    }
    
    var studentEmailLower = studentEmail.toLowerCase().trim();
    var teacherEmailLower = teacherEmail ? teacherEmail.toLowerCase().trim() : null;
    
    // Use migration-aware lookup for attendance data
    var migrationResult = getAttendanceUserWithMigration_(studentEmailLower);
    var userKey;
    var userData;
    var oldTeacherEmail = null;
    
    if (migrationResult && migrationResult.data) {
      userKey = migrationResult.key;
      userData = migrationResult.data;
      oldTeacherEmail = userData.teacherEmail ? userData.teacherEmail.toLowerCase().trim() : null;
      if (migrationResult.source === 'migrated') {
        Logger.log('Using migrated attendance data from: ' + migrationResult.migratedFrom);
      }
      Logger.log('Current teacher: ' + (oldTeacherEmail || 'none'));
    } else {
      userKey = getAttendanceUserKey_(studentEmailLower);
      userData = {
        email: studentEmailLower,
        name: studentEmailLower,
        createdDate: new Date().toISOString()
      };
      Logger.log('Creating new attendance record for: ' + studentEmailLower);
    }
    
    // Check if user is trying to select "none" (only allowed for teachers)
    if (teacherEmailLower === 'none') {
      if (isTeacherOverrideEmail_(studentEmailLower)) {
        Logger.log('Teacher selecting "none" via OVERRIDE LIST: ' + studentEmailLower);
      } else {
        var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
        var emailForLookup = getRewardfulEmailForLookup_(studentEmailLower);
        var affiliate = findAffiliateByEmail_(emailForLookup, apiKey);
        
        if (affiliate) {
          var firstName = affiliate.first_name || '';
          var isTeacher = isTeacherByFirstName_(firstName);
          
          if (!isTeacher) {
            Logger.log('Non-teacher tried to select "none" - rejecting');
            return { success: false, error: 'Only teachers can skip teacher selection' };
          }
        }
      }
    }
    
    // CANONICAL LINKING: Use new system with soft deletes
    var isSelectingNone = teacherEmailLower === 'none';
    
    // Step 1: UNLINK from old teacher (soft delete - can be reactivated later)
    if (oldTeacherEmail && oldTeacherEmail !== 'none' && oldTeacherEmail !== teacherEmailLower) {
      Logger.log('Unlinking from old teacher: ' + oldTeacherEmail);
      var unlinkResult = unlinkStudentFromTeacher(oldTeacherEmail, studentEmailLower, 'student');
      Logger.log('Unlink result: ' + unlinkResult.status);
    }
    
    // Step 2: LINK to new teacher (idempotent - handles reactivation)
    if (teacherEmailLower && !isSelectingNone) {
      Logger.log('Linking to teacher: ' + teacherEmailLower);
      var linkResult = linkStudentToTeacher(teacherEmailLower, studentEmailLower, 'student');
      
      if (!linkResult.success) {
        Logger.log('Warning: Link failed: ' + linkResult.error);
        // Continue anyway - we'll still update the attendance record
      } else {
        Logger.log('Link result: ' + linkResult.status);
      }
    }
    
    // Step 3: Update student's attendance record (cached reference for quick lookups)
    userData.teacherEmail = teacherEmailLower;
    userData.teacherUpdatedAt = new Date().toISOString();
    PropertiesService.getScriptProperties().setProperty(userKey, JSON.stringify(userData));
    
    Logger.log('=== Teacher set successfully ===');
    return { success: true, message: 'Teacher assigned successfully' };
    
  } catch(e) {
    Logger.log('Error setting teacher: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Get teacher email for an attendance user
 * MIGRATION AWARE: Checks both alias email AND internal email for existing data
 */
function getTeacherForAttendanceUser(studentEmail) {
  try {
    if (!studentEmail) {
      return { success: false, teacherEmail: null };
    }
    
    var studentEmailLower = studentEmail.toLowerCase().trim();
    
    // Use migration-aware lookup to find data under alias OR internal email
    var migrationResult = getAttendanceUserWithMigration_(studentEmailLower);
    
    if (!migrationResult || !migrationResult.data) {
      Logger.log('No attendance data found for: ' + studentEmailLower);
      return { success: false, teacherEmail: null };
    }
    
    var userData = migrationResult.data;
    
    if (migrationResult.source === 'migrated') {
      Logger.log('Found attendance data via migration from: ' + migrationResult.migratedFrom);
    }
    
    return { success: true, teacherEmail: userData.teacherEmail || null };
    
  } catch(e) {
    Logger.log('Error getting teacher: ' + e.message);
    return { success: false, teacherEmail: null };
  }
}

/**
 * Get attendance statistics for a student (used by teacher portal)
 */
function getStudentAttendanceStats(studentEmail) {
  try {
    Logger.log('Getting attendance stats for student: ' + studentEmail);
    
    var emailLower = studentEmail.toLowerCase().trim();
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    
    // Get user info from multiple sources
    var studentName = emailLower;
    var accountCreatedDate = null;
    var teacherEmail = null;
    
    // Source 1: Attendance user record (migration-aware)
    var migrationResult = getAttendanceUserWithMigration_(emailLower);
    var userKey = getAttendanceUserKey_(emailLower);  // For attendance record lookups
    var effectiveEmailForRecords = emailLower;  // The email to use for finding attendance records
    
    if (migrationResult && migrationResult.data) {
      var userData = migrationResult.data;
      studentName = userData.name || emailLower;
      accountCreatedDate = userData.createdDate;
      teacherEmail = userData.teacherEmail || null;
      
      // If migrated, we need to also check attendance records under the old email
      if (migrationResult.migratedFrom) {
        effectiveEmailForRecords = migrationResult.migratedFrom;
        Logger.log('Using attendance records from migrated email: ' + effectiveEmailForRecords);
      }
    }
    
    // Source 2: Auth record (for better name info)
    var authRecord = getAuthRecord_(emailLower);
    if (authRecord) {
      // Use auth record name if attendance name is just the email
      if (studentName === emailLower && (authRecord.firstName || authRecord.lastName)) {
        studentName = (authRecord.firstName || '') + ' ' + (authRecord.lastName || '');
        studentName = studentName.trim() || emailLower;
      }
      // Use auth record created date if not set
      if (!accountCreatedDate && authRecord.requestedAt) {
        accountCreatedDate = authRecord.requestedAt;
      }
    }
    
    // Source 3: Resolve student by email to get affiliate data
    var resolveResult = resolveStudentByEmail_(emailLower);
    if (resolveResult.status === 'OK' && resolveResult.student) {
      var student = resolveResult.student;
      // Use affiliate name if we still don't have a proper name
      if (studentName === emailLower && (student.firstName || student.lastName)) {
        studentName = (student.firstName || '') + ' ' + (student.lastName || '');
        studentName = studentName.trim() || emailLower;
      }
    }
    
    // Scan for attendance records
    // Check BOTH alias email AND internal email (if migrated)
    var emailKey = emailLower.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
    var searchPrefix = 'ATTENDANCE_' + emailKey + '_';
    
    // If migrated, also search under the old internal email
    var searchPrefixOld = null;
    if (migrationResult && migrationResult.migratedFrom) {
      var oldEmailKey = migrationResult.migratedFrom.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
      searchPrefixOld = 'ATTENDANCE_' + oldEmailKey + '_';
      Logger.log('Also searching attendance records under old email prefix: ' + searchPrefixOld);
    }
    
    var totalDays = 0;
    var confirmedDays = 0;
    var missedDays = 0;
    var records = [];
    var recordDates = {};  // Track dates to avoid duplicates
    
    for (var key in allProps) {
      // Check if matches current alias OR old internal email
      var isMatch = key.indexOf(searchPrefix) === 0 || 
                   (searchPrefixOld && key.indexOf(searchPrefixOld) === 0);
      
      if (isMatch) {
        var record = JSON.parse(allProps[key]);
        
        // Avoid duplicate records for the same date
        var recordDate = record.date || key;
        if (recordDates[recordDate]) {
          continue;
        }
        recordDates[recordDate] = true;
        
        records.push(record);
        totalDays++;
        
        if (record.confirmed) {
          confirmedDays++;
        } else {
          missedDays++;
        }
      }
    }
    
    // Sort records by date (newest first)
    records.sort(function(a, b) {
      return new Date(b.date) - new Date(a.date);
    });
    
    // Calculate attendance percentage
    var attendancePercentage = totalDays > 0 ? Math.round((confirmedDays / totalDays) * 100) : 0;
    
    // Also fetch leads data for this student
    var leadsData = getStudentLeadsData_(emailLower);
    
    return {
      success: true,
      studentName: studentName,
      studentEmail: emailLower,
      teacherEmail: teacherEmail,
      accountCreatedDate: accountCreatedDate,
      totalDays: totalDays,
      confirmedDays: confirmedDays,
      missedDays: missedDays,
      attendancePercentage: attendancePercentage,
      recentRecords: records.slice(0, 30), // Last 30 days
      // Leads data
      totalLeads: leadsData.totalLeads || 0,
      leadsDelta: leadsData.delta || 0,
      leadsLastUpdated: leadsData.lastUpdated || null,
      leads: leadsData.leads || []
    };
    
  } catch(e) {
    Logger.log('Error getting student attendance stats: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Get leads data for a student (internal helper)
 * Resolves student email to internal commission email and fetches leads
 */
function getStudentLeadsData_(studentEmail) {
  try {
    Logger.log('Getting leads data for student: ' + studentEmail);
    
    // Resolve student email to internal email (in case it's an alias)
    var resolveResult = resolveStudentByEmail_(studentEmail);
    
    var emailForLeads = studentEmail;
    if (resolveResult.status === 'OK' && resolveResult.student) {
      // Use internal/canonical email for leads lookup
      emailForLeads = resolveResult.student.internalEmail || resolveResult.student.canonicalEmail || studentEmail;
      Logger.log('Resolved to internal email for leads: ' + emailForLeads);
    }
    
    // Fetch referral/leads data
    var referralData = getReferralData(emailForLeads, false); // Use cache if available
    
    if (!referralData.success) {
      Logger.log('Could not fetch leads: ' + (referralData.error || 'Unknown error'));
      return {
        totalLeads: 0,
        delta: 0,
        lastUpdated: null,
        leads: []
      };
    }
    
    return {
      totalLeads: referralData.totalLeads || referralData.totalReferrals || 0,
      delta: referralData.deltaSinceLastFetch || 0,
      lastUpdated: referralData.lastUpdated || null,
      leads: referralData.leads || []
    };
    
  } catch (e) {
    Logger.log('Error getting student leads data: ' + e.message);
    return {
      totalLeads: 0,
      delta: 0,
      lastUpdated: null,
      leads: []
    };
  }
}

/**
 * DIAGNOSTIC: Check 30-day commission calculation for a student
 * This helps identify why 30-day amounts might be showing $0.00
 */
function diagnose30DayCalculation(email) {
  if (!isAdmin_()) {
    return { error: "Unauthorized" };
  }
  
  try {
    Logger.log('=== DIAGNOSING 30-DAY CALCULATION FOR: ' + email + ' ===');
    
    var apiKey = getApiKey_();
    
    // Get affiliate data
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp || affResp.getResponseCode() !== 200) {
      return { error: "Affiliate not found" };
    }
    
    var payload = safeParseJson_(affResp.getContentText());
    var aff = extractAffiliate_(payload);
    
    if (!aff || !aff.id) {
      return { error: "No affiliate ID found" };
    }
    
    Logger.log('Affiliate ID: ' + aff.id);
    
    // Calculate 30 days ago
    var thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Fetch ALL commissions
    var commUrl = BASE_URL + '/commissions?affiliate_id=' + encodeURIComponent(aff.id) + '&per_page=200';
    Logger.log('Fetching from: ' + commUrl);
    
    var commResp = fetchWithRetry_(commUrl, apiKey);
    
    if (!commResp || commResp.getResponseCode() !== 200) {
      return { error: "Failed to fetch commissions" };
    }
    
    var commPayload = safeParseJson_(commResp.getContentText());
    var commissions = extractCommissions_(commPayload);
    
    Logger.log('Total commissions found: ' + commissions.length);
    
    // Analyze commissions
    var analysis = {
      totalCommissions: commissions.length,
      last30Days: [],
      older: [],
      byStatus: {
        pending: 0,
        approved: 0,
        confirmed: 0,
        paid: 0,
        other: 0
      },
      last30DaysByStatus: {
        pending: { count: 0, amount: 0 },
        approved: { count: 0, amount: 0 },
        confirmed: { count: 0, amount: 0 },
        paid: { count: 0, amount: 0 }
      }
    };
    
    commissions.forEach(function(c) {
      var commDate = null;
      if (c.created_at) {
        commDate = new Date(c.created_at);
      } else if (c.date) {
        commDate = new Date(c.date);
      }
      
      var status = readStatus_(c);
      var amount = Number(c.amount || c.commission_amount || 0);
      
      // Convert from cents if needed
      if (Number.isInteger(amount) && Math.abs(amount) >= 100) {
        amount = amount / 100;
      }
      
      // Convert currency
      var currencyIso = (c.currency || c.currency_iso || 'USD').toUpperCase();
      if (currencyIso === 'USD' && CURRENCY === 'CAD') {
        amount = amount * USD_TO_CAD_RATE;
      }
      
      // Count by status
      if (status === 'pending') analysis.byStatus.pending++;
      else if (status === 'approved') analysis.byStatus.approved++;
      else if (status === 'confirmed') analysis.byStatus.confirmed++;
      else if (status === 'paid') analysis.byStatus.paid++;
      else analysis.byStatus.other++;
      
      // Check if in last 30 days
      if (commDate && commDate >= thirtyDaysAgo) {
        analysis.last30Days.push({
          date: commDate.toISOString(),
          status: status,
          amount: amount,
          id: c.id || 'unknown'
        });
        
        if (status === 'pending') {
          analysis.last30DaysByStatus.pending.count++;
          analysis.last30DaysByStatus.pending.amount += amount;
        } else if (status === 'approved') {
          analysis.last30DaysByStatus.approved.count++;
          analysis.last30DaysByStatus.approved.amount += amount;
        } else if (status === 'confirmed') {
          analysis.last30DaysByStatus.confirmed.count++;
          analysis.last30DaysByStatus.confirmed.amount += amount;
        } else if (status === 'paid') {
          analysis.last30DaysByStatus.paid.count++;
          analysis.last30DaysByStatus.paid.amount += amount;
        }
      } else {
        analysis.older.push({
          date: commDate ? commDate.toISOString() : 'unknown',
          status: status,
          amount: amount
        });
      }
    });
    
    // Calculate what SHOULD be shown (approved + confirmed only)
    var calculatedUnpaid30Days = round2_(
      analysis.last30DaysByStatus.approved.amount + 
      analysis.last30DaysByStatus.confirmed.amount
    );
    
    Logger.log('=== DIAGNOSTIC COMPLETE ===');
    Logger.log('Last 30 days commissions: ' + analysis.last30Days.length);
    Logger.log('Approved in last 30 days: ' + analysis.last30DaysByStatus.approved.count + ' ($' + analysis.last30DaysByStatus.approved.amount + ')');
    Logger.log('Confirmed in last 30 days: ' + analysis.last30DaysByStatus.confirmed.count + ' ($' + analysis.last30DaysByStatus.confirmed.amount + ')');
    Logger.log('Pending in last 30 days: ' + analysis.last30DaysByStatus.pending.count + ' ($' + analysis.last30DaysByStatus.pending.amount + ')');
    Logger.log('Calculated 30d Unpaid (approved+confirmed): $' + calculatedUnpaid30Days);
    
    return {
      success: true,
      email: email,
      affiliateId: aff.id,
      cutoffDate: thirtyDaysAgo.toISOString(),
      analysis: analysis,
      calculatedUnpaid30Days: calculatedUnpaid30Days,
      explanation: calculatedUnpaid30Days === 0 ? 
        'No approved or confirmed commissions in last 30 days. All commissions are either pending (not yet approved) or older than 30 days.' :
        'Found ' + (analysis.last30DaysByStatus.approved.count + analysis.last30DaysByStatus.confirmed.count) + ' approved/confirmed commissions in last 30 days totaling $' + calculatedUnpaid30Days
    };
    
  } catch(e) {
    Logger.log('Error in diagnostic: ' + e.message);
    return { error: e.message };
  }
}

/**
 * ADMIN ONLY: Update a user's alias email
 * This changes the email they use to log in, but keeps the internal/Rewardful email the same
 */
function adminUpdateAliasEmail(userEmail, newAliasEmail) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  try {
    if (!userEmail || !newAliasEmail) {
      return { success: false, error: 'Both current email and new alias email are required' };
    }
    
    var normalizedNewAlias = normalizeAuthEmail_(newAliasEmail);
    if (!normalizedNewAlias || normalizedNewAlias.indexOf('@') === -1) {
      return { success: false, error: 'Invalid new alias email format' };
    }
    
    // Check if new alias is already in use by someone else
    var existingRecord = getAuthRecord_(normalizedNewAlias);
    if (existingRecord && existingRecord.email !== userEmail && existingRecord.aliasEmail !== userEmail) {
      return { success: false, error: 'This alias email is already in use by another user' };
    }
    
    var props = PropertiesService.getScriptProperties();
    
    // Find and update the auth record
    var oldAuthRecord = getAuthRecord_(userEmail);
    if (!oldAuthRecord) {
      // Try finding by alias
      oldAuthRecord = findAuthRecordByAliasOrInternal_(userEmail);
    }
    
    if (oldAuthRecord) {
      var oldAliasEmail = oldAuthRecord.aliasEmail || oldAuthRecord.email;
      
      // Update the auth record with new alias
      oldAuthRecord.aliasEmail = normalizedNewAlias;
      oldAuthRecord.originalAliasEmail = oldAliasEmail;  // Keep track of original
      oldAuthRecord.aliasUpdatedAt = new Date().toISOString();
      oldAuthRecord.aliasUpdatedBy = 'admin';
      
      // Save under new alias key
      saveAuthRecord_(normalizedNewAlias, oldAuthRecord);
      
      // Create redirect from old alias to new
      if (oldAliasEmail !== normalizedNewAlias) {
        var redirectRecord = {
          redirectTo: normalizedNewAlias,
          originalEmail: oldAliasEmail,
          redirectCreatedAt: new Date().toISOString()
        };
        saveAuthRecord_(oldAliasEmail, redirectRecord);
      }
      
      Logger.log('Updated alias email: ' + oldAliasEmail + ' -> ' + normalizedNewAlias);
    }
    
    // Update attendance user record
    var userKey = 'ATTENDANCE_USER_' + userEmail.toLowerCase().trim();
    var userDataStr = props.getProperty(userKey);
    if (userDataStr) {
      var userData = JSON.parse(userDataStr);
      userData.aliasEmail = normalizedNewAlias;
      userData.aliasUpdatedAt = new Date().toISOString();
      props.setProperty(userKey, JSON.stringify(userData));
    }
    
    return { 
      success: true, 
      message: 'Alias email updated successfully',
      oldAlias: userEmail,
      newAlias: normalizedNewAlias
    };
    
  } catch(e) {
    Logger.log('Error updating alias email: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * ADMIN ONLY: Audit legacy accounts and find orphaned duplicates
 * Returns a detailed report without making any changes
 */
function adminAuditLegacyAccounts() {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  try {
    Logger.log('=== LEGACY ACCOUNT AUDIT ===');
    
    var result = getAllAttendanceUsers();
    if (!result.success) {
      return result;
    }
    
    var users = result.users;
    var legacyAccounts = [];
    var migratedAccounts = [];
    var orphanedLegacy = [];
    
    for (var i = 0; i < users.length; i++) {
      var user = users[i];
      if (user.isLegacy) {
        legacyAccounts.push(user);
        if (user.isOrphanedLegacy) {
          orphanedLegacy.push({
            legacyEmail: user.email,
            legacyName: user.name,
            migratedTo: user.migratedTo,
            createdDate: user.createdDate
          });
        }
      } else {
        migratedAccounts.push(user);
      }
    }
    
    Logger.log('Total users: ' + users.length);
    Logger.log('Migrated accounts: ' + migratedAccounts.length);
    Logger.log('Legacy accounts (not migrated): ' + legacyAccounts.length);
    Logger.log('Orphaned legacy (safe to delete): ' + orphanedLegacy.length);
    
    return {
      success: true,
      totalUsers: users.length,
      migratedCount: migratedAccounts.length,
      legacyCount: legacyAccounts.length,
      orphanedCount: orphanedLegacy.length,
      orphanedAccounts: orphanedLegacy,
      legacyAccounts: legacyAccounts.map(function(u) {
        return {
          email: u.email,
          name: u.name,
          isOrphaned: u.isOrphanedLegacy,
          migratedTo: u.migratedTo || null
        };
      })
    };
    
  } catch(e) {
    Logger.log('Error in legacy audit: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * ADMIN ONLY: Delete a single orphaned legacy account
 * Only deletes if the account is confirmed orphaned (has a migrated version)
 */
function adminDeleteOrphanedLegacy(legacyEmail) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  try {
    if (!legacyEmail) {
      return { success: false, error: 'Email is required' };
    }
    
    var emailLower = legacyEmail.toLowerCase().trim();
    Logger.log('=== DELETING ORPHANED LEGACY: ' + emailLower + ' ===');
    
    // First, verify this is actually an orphaned legacy account
    var result = getAllAttendanceUsers();
    if (!result.success) {
      return result;
    }
    
    var targetUser = null;
    for (var i = 0; i < result.users.length; i++) {
      if (result.users[i].email.toLowerCase().trim() === emailLower) {
        targetUser = result.users[i];
        break;
      }
    }
    
    if (!targetUser) {
      return { success: false, error: 'User not found: ' + legacyEmail };
    }
    
    if (!targetUser.isLegacy) {
      return { success: false, error: 'This is not a legacy account. It has different alias and internal emails.' };
    }
    
    if (!targetUser.isOrphanedLegacy) {
      return { success: false, error: 'This legacy account is NOT orphaned. No migrated version exists. Deletion blocked for safety.' };
    }
    
    Logger.log('Verified orphaned legacy account. Migrated to: ' + targetUser.migratedTo);
    
    // Safe to delete - proceed
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var deletedKeys = [];
    
    // Find and delete the actual ATTENDANCE_USER_ key by iterating through all keys
    // This handles cases where the key format might not match exactly
    for (var key in allProps) {
      if (key.indexOf('ATTENDANCE_USER_') === 0) {
        try {
          var userData = JSON.parse(allProps[key]);
          if (userData.email && userData.email.toLowerCase().trim() === emailLower) {
            props.deleteProperty(key);
            deletedKeys.push(key);
            Logger.log('Deleted user record: ' + key);
          }
        } catch(e) {
          // Skip invalid records
        }
      }
    }
    
    // Re-fetch all props after deletion for attendance records
    allProps = props.getProperties();
    
    // Delete attendance records for this user (date-based records)
    // These keys are like ATTENDANCE_email_2026-01-25
    for (var key in allProps) {
      if (key.indexOf('ATTENDANCE_') === 0 && key.indexOf('ATTENDANCE_USER_') !== 0) {
        // Check if this key contains the email (case-insensitive)
        var keyLower = key.toLowerCase();
        if (keyLower.indexOf(emailLower) !== -1) {
          props.deleteProperty(key);
          deletedKeys.push(key);
          Logger.log('Deleted attendance record: ' + key);
        }
      }
    }
    
    // Delete auth record (but keep a redirect if needed)
    // Try multiple key formats
    var authKeyFormats = [
      'AFFILIATE_AUTH_' + emailLower.replace(/[@.]/g, '_'),
      'AFFILIATE_AUTH_' + legacyEmail.replace(/[@.]/g, '_'),
      'AFFILIATE_AUTH_' + emailLower,
      'AFFILIATE_AUTH_' + legacyEmail
    ];
    
    for (var i = 0; i < authKeyFormats.length; i++) {
      var authKey = authKeyFormats[i];
      if (props.getProperty(authKey)) {
        // Instead of deleting, convert to a redirect to the migrated account
        var redirectRecord = {
          redirectTo: targetUser.migratedTo,
          wasOrphanedLegacy: true,
          deletedAt: new Date().toISOString(),
          originalEmail: emailLower
        };
        props.setProperty(authKey, JSON.stringify(redirectRecord));
        deletedKeys.push('AUTH:' + authKey);
        Logger.log('Converted auth record to redirect: ' + authKey);
        break; // Only need to update one auth key
      }
    }
    
    Logger.log('=== DELETION COMPLETE ===');
    Logger.log('Deleted ' + deletedKeys.length + ' records: ' + deletedKeys.join(', '));
    
    if (deletedKeys.length === 0) {
      Logger.log('WARNING: No records were deleted! The key format might not match.');
      return {
        success: false,
        error: 'Could not find records to delete. Key format mismatch.',
        attemptedEmail: legacyEmail
      };
    }
    
    return {
      success: true,
      message: 'Orphaned legacy account deleted successfully',
      deletedEmail: legacyEmail,
      migratedTo: targetUser.migratedTo,
      deletedRecords: deletedKeys.length,
      deletedKeys: deletedKeys
    };
    
  } catch(e) {
    Logger.log('Error deleting orphaned legacy: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * ADMIN ONLY: Bulk delete all orphaned legacy accounts
 * USE WITH CAUTION - performs audit first, then deletes
 */
function adminCleanupAllOrphanedLegacy() {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  try {
    Logger.log('=== BULK CLEANUP OF ORPHANED LEGACY ACCOUNTS ===');
    
    // First, audit to find orphaned accounts
    var audit = adminAuditLegacyAccounts();
    if (!audit.success) {
      return audit;
    }
    
    if (audit.orphanedCount === 0) {
      Logger.log('No orphaned legacy accounts to clean up');
      return {
        success: true,
        message: 'No orphaned legacy accounts found',
        deletedCount: 0
      };
    }
    
    Logger.log('Found ' + audit.orphanedCount + ' orphaned accounts to delete');
    
    var deleted = [];
    var failed = [];
    
    for (var i = 0; i < audit.orphanedAccounts.length; i++) {
      var orphan = audit.orphanedAccounts[i];
      var deleteResult = adminDeleteOrphanedLegacy(orphan.legacyEmail);
      
      if (deleteResult.success) {
        deleted.push(orphan.legacyEmail);
      } else {
        failed.push({
          email: orphan.legacyEmail,
          error: deleteResult.error
        });
      }
    }
    
    Logger.log('=== BULK CLEANUP COMPLETE ===');
    Logger.log('Successfully deleted: ' + deleted.length);
    Logger.log('Failed: ' + failed.length);
    
    return {
      success: true,
      message: 'Bulk cleanup completed',
      deletedCount: deleted.length,
      failedCount: failed.length,
      deleted: deleted,
      failed: failed
    };
    
  } catch(e) {
    Logger.log('Error in bulk cleanup: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * ADMIN ONLY: Update a user's internal/Rewardful email
 * Validates that the new email exists in the affiliate database before saving
 */
function adminUpdateInternalEmail(userEmail, newInternalEmail) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  try {
    if (!userEmail || !newInternalEmail) {
      return { success: false, error: 'Both current email and new internal email are required' };
    }
    
    var normalizedNewInternal = newInternalEmail.toLowerCase().trim();
    if (!normalizedNewInternal || normalizedNewInternal.indexOf('@') === -1) {
      return { success: false, error: 'Invalid email format' };
    }
    
    Logger.log('Admin updating internal email for: ' + userEmail + ' -> ' + normalizedNewInternal);
    
    // CRITICAL: Validate that this email exists in the affiliate database (Rewardful)
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) {
      return { success: false, error: 'System configuration error' };
    }
    
    // Check if email exists in Rewardful
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(normalizedNewInternal);
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp) {
      return { success: false, error: 'Could not verify email. Please try again.' };
    }
    
    var affCode = affResp.getResponseCode();
    
    if (affCode !== 200) {
      // Email not found in affiliate database
      Logger.log('Email not found in affiliate database: ' + normalizedNewInternal + ' (HTTP ' + affCode + ')');
      return { success: false, error: 'Email not found in affiliate database' };
    }
    
    // Parse response to verify we actually got an affiliate
    var affPayload = safeParseJson_(affResp.getContentText());
    var aff = extractAffiliate_(affPayload);
    
    if (!aff || !aff.id) {
      Logger.log('No affiliate record found for email: ' + normalizedNewInternal);
      return { success: false, error: 'Email not found in affiliate database' };
    }
    
    Logger.log('Verified affiliate exists: ' + aff.id + ' for email: ' + normalizedNewInternal);
    
    var props = PropertiesService.getScriptProperties();
    
    // Find and update the auth record
    var authRecord = getAuthRecord_(userEmail);
    if (!authRecord) {
      authRecord = findAuthRecordByAliasOrInternal_(userEmail);
    }
    
    if (authRecord) {
      var oldInternalEmail = authRecord.rewardfulEmail || authRecord.internalEmail || authRecord.email;
      
      // Update the auth record with new internal email
      authRecord.rewardfulEmail = normalizedNewInternal;
      authRecord.internalEmail = normalizedNewInternal;
      authRecord.previousInternalEmail = oldInternalEmail;
      authRecord.internalUpdatedAt = new Date().toISOString();
      authRecord.internalUpdatedBy = 'admin';
      authRecord.verifiedAffiliateId = aff.id;
      
      // Save auth record (use alias email as the key if available)
      var saveKey = authRecord.aliasEmail || userEmail;
      saveAuthRecord_(saveKey, authRecord);
      
      Logger.log('Updated auth record internal email: ' + oldInternalEmail + ' -> ' + normalizedNewInternal);
    }
    
    // Update attendance user record
    var userKey = 'ATTENDANCE_USER_' + userEmail.toLowerCase().trim();
    var userDataStr = props.getProperty(userKey);
    if (userDataStr) {
      var userData = JSON.parse(userDataStr);
      var oldInternal = userData.internalEmail || userData.rewardfulEmail || userData.email;
      userData.internalEmail = normalizedNewInternal;
      userData.rewardfulEmail = normalizedNewInternal;
      userData.internalUpdatedAt = new Date().toISOString();
      props.setProperty(userKey, JSON.stringify(userData));
      Logger.log('Updated attendance user internal email: ' + oldInternal + ' -> ' + normalizedNewInternal);
    }
    
    // Clear any cached referral data for the old internal email
    // This ensures fresh data is fetched with the new email
    try {
      var cache = CacheService.getScriptCache();
      var cacheKey = 'LEADS_CACHE_' + userEmail.toLowerCase().trim();
      cache.remove(cacheKey);
      Logger.log('Cleared cached leads data');
    } catch(e) {
      // Ignore cache clear errors
    }
    
    return { 
      success: true, 
      message: 'Internal email updated successfully',
      oldInternal: userEmail,
      newInternal: normalizedNewInternal,
      affiliateId: aff.id
    };
    
  } catch(e) {
    Logger.log('Error updating internal email: ' + e.message);
    return { success: false, error: 'Failed to update email. Please try again.' };
  }
}

/**
 * ADMIN ONLY: Get complete student dashboard data for viewing/editing
 * Includes: attendance, teacher info, leads, conversions
 */
function adminGetStudentDashboard(studentEmail) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  try {
    if (!studentEmail) {
      return { success: false, error: 'Student email is required' };
    }
    
    var emailLower = studentEmail.toLowerCase().trim();
    Logger.log('Admin viewing student dashboard for: ' + emailLower);
    
    // 1. Get user info from attendance records
    var props = PropertiesService.getScriptProperties();
    var userKey = 'ATTENDANCE_USER_' + emailLower;
    var userDataStr = props.getProperty(userKey);
    var userData = null;
    
    if (userDataStr) {
      userData = JSON.parse(userDataStr);
    }
    
    // 2. Get auth record for alias/internal emails
    var authRecord = getAuthRecord_(emailLower);
    if (!authRecord) {
      authRecord = findAuthRecordByAliasOrInternal_(emailLower);
    }
    
    var aliasEmail = emailLower;
    var internalEmail = emailLower;
    if (authRecord) {
      aliasEmail = authRecord.aliasEmail || emailLower;
      internalEmail = authRecord.rewardfulEmail || authRecord.internalEmail || emailLower;
    }
    if (userData) {
      aliasEmail = userData.aliasEmail || aliasEmail;
      internalEmail = userData.internalEmail || userData.rewardfulEmail || internalEmail;
    }
    
    // 3. Get attendance data
    var userLocalDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var attendanceData = getAttendanceData(emailLower, userLocalDate);
    
    // 4. Get teacher info
    var teacherEmail = userData ? userData.teacherEmail : null;
    var teacherName = null;
    if (teacherEmail) {
      // Try to get teacher name
      var teacherUserKey = 'ATTENDANCE_USER_' + teacherEmail.toLowerCase();
      var teacherDataStr = props.getProperty(teacherUserKey);
      if (teacherDataStr) {
        var teacherData = JSON.parse(teacherDataStr);
        teacherName = teacherData.name;
      }
    }
    
    // 5. Get leads/referrals data
    var referralData = null;
    try {
      // Use internal email for Rewardful lookup
      referralData = getReferralData(internalEmail, false);
    } catch(e) {
      Logger.log('Error fetching referral data: ' + e.message);
      referralData = { success: false, error: e.message };
    }
    
    // 6. Get available teachers list
    var teachersList = getTeachersListInternal_();
    
    return {
      success: true,
      student: {
        email: emailLower,
        aliasEmail: aliasEmail,
        internalEmail: internalEmail,
        name: userData ? userData.name : 'Unknown',
        createdDate: userData ? userData.createdDate : null,
        isTeacher: userData ? userData.isTeacher : false
      },
      teacher: {
        email: teacherEmail,
        name: teacherName
      },
      attendance: attendanceData,
      referrals: referralData,
      teachersList: teachersList
    };
    
  } catch(e) {
    Logger.log('Error getting student dashboard: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Helper: Get teachers list for internal use
 */
function getTeachersListInternal_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var teachers = [];
    
    for (var key in allProps) {
      if (key.indexOf('ATTENDANCE_USER_') === 0) {
        try {
          var userData = JSON.parse(allProps[key]);
          if (userData.isTeacher) {
            teachers.push({
              email: userData.email,
              name: userData.name,
              aliasEmail: userData.aliasEmail || userData.email
            });
          }
        } catch(e) {}
      }
    }
    
    return teachers;
  } catch(e) {
    return [];
  }
}

/**
 * ADMIN ONLY: Update student's assigned teacher
 */
function adminUpdateStudentTeacher(studentEmail, newTeacherEmail) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  try {
    if (!studentEmail) {
      return { success: false, error: 'Student email is required' };
    }
    
    // Use existing function to update teacher
    var result = setTeacherForAttendanceUser(studentEmail, newTeacherEmail || '');
    return result;
    
  } catch(e) {
    Logger.log('Error updating student teacher: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Helper: Find auth record by alias or internal email
 */
function findAuthRecordByAliasOrInternal_(email) {
  try {
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var emailLower = email.toLowerCase().trim();
    
    for (var key in allProps) {
      if (key.indexOf('AFFILIATE_AUTH_') === 0) {
        try {
          var record = JSON.parse(allProps[key]);
          if (record.aliasEmail && record.aliasEmail.toLowerCase() === emailLower) {
            return record;
          }
          if (record.rewardfulEmail && record.rewardfulEmail.toLowerCase() === emailLower) {
            return record;
          }
          if (record.internalEmail && record.internalEmail.toLowerCase() === emailLower) {
            return record;
          }
          if (record.email && record.email.toLowerCase() === emailLower) {
            return record;
          }
        } catch(e) {}
      }
    }
    return null;
  } catch(e) {
    return null;
  }
}

/**
 * Delete attendance user and all their records
 */
function deleteAttendanceUser(email) {
  try {
    if (!email) {
      return { success: false, error: 'Email is required' };
    }
    
    var emailLower = email.toLowerCase().trim();
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    
    // Delete user account
    var userKey = getAttendanceUserKey_(emailLower);
    props.deleteProperty(userKey);
    Logger.log('Deleted user: ' + email);
    
    // Delete all attendance records for this user (new format with timestamps)
    var emailKey = emailLower.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
    var searchPrefix = 'ATTENDANCE_' + emailKey + '_';
    
    var deletedRecords = 0;
    for (var key in allProps) {
      if (key.indexOf(searchPrefix) === 0) {
        props.deleteProperty(key);
        deletedRecords++;
      }
    }
    
    Logger.log('Deleted ' + deletedRecords + ' attendance records for user: ' + email);
    
    return { 
      success: true, 
      message: 'User deleted successfully',
      deletedRecords: deletedRecords
    };
    
  } catch(e) {
    Logger.log('Error deleting user: ' + e.message);
    return { success: false, error: 'Failed to delete user: ' + e.message };
  }
}

/**
 * DIAGNOSTIC FUNCTIONS FOR EMAIL PERCENTAGE ISSUES
 * These functions help diagnose and fix issues where affiliates with percentage-based emails
 * (e.g., momo50%@gmail.com) don't have the correct baseline percentage applied
 */

/**
 * Diagnostic: Check if an affiliate's tracking data matches their email percentage
 * Returns detailed information about the current state
 */
function diagnoseAffiliatePercentage(email) {
  if (!isAdmin_()) {
    return { error: "Unauthorized" };
  }
  
  try {
    Logger.log("=== DIAGNOSING AFFILIATE: " + email + " ===");
    
    // Extract expected percentage from email
    var expectedPercentage = extractEmailPercentage_(email);
    Logger.log("Expected percentage from email: " + (expectedPercentage !== null ? expectedPercentage + "%" : "None (100%)"));
    
    // Get current tracking data
    var tracking = getIncrementalTracking_(email);
    Logger.log("Tracking exists: " + (tracking ? "Yes" : "No"));
    
    if (!tracking) {
      return {
        email: email,
        expectedPercentage: expectedPercentage,
        hasTracking: false,
        status: "NOT_INITIALIZED",
        message: "No tracking data exists. On next lookup, the correct percentage will be applied.",
        needsFix: false
      };
    }
    
    // Check if tracking percentage matches expected
    var trackingPercentage = tracking.emailBaselinePercentage;
    Logger.log("Tracking baseline percentage: " + (trackingPercentage !== null ? trackingPercentage + "%" : "None (100%)"));
    
    var isCorrect = (expectedPercentage === trackingPercentage) || 
                    (expectedPercentage === null && trackingPercentage === null);
    
    // Get current API values for comparison
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    var payload = safeParseJson_(affResp.getContentText());
    var aff = extractAffiliate_(payload);
    
    var currentApiValues = null;
    if (aff && aff.id) {
      var totals = sumDueNowForAffiliate_(aff.id, apiKey);
      currentApiValues = {
        unpaid: totals.unpaid,
        dueNow: totals.dueNow,
        totalPaid: totals.paid
      };
    }
    
    var result = {
      email: email,
      expectedPercentage: expectedPercentage,
      trackingPercentage: trackingPercentage,
      hasTracking: true,
      isCorrect: isCorrect,
      status: isCorrect ? "CORRECT" : "MISMATCH",
      message: isCorrect ? 
        "Tracking data matches expected percentage" : 
        "ERROR: Tracking percentage (" + trackingPercentage + "%) does not match email percentage (" + expectedPercentage + "%)",
      needsFix: !isCorrect,
      trackingData: {
        lastApiUnpaid: tracking.lastApiUnpaid,
        lastApiDueNow: tracking.lastApiDueNow,
        lastApiTotalPaid: tracking.lastApiTotalPaid,
        lastDisplayedUnpaid: tracking.lastDisplayedUnpaid,
        lastDisplayedDueNow: tracking.lastDisplayedDueNow,
        lastDisplayedTotalPaid: tracking.lastDisplayedTotalPaid,
        initialApiUnpaid: tracking.initialApiUnpaid,
        initialApiDueNow: tracking.initialApiDueNow,
        initialApiTotalPaid: tracking.initialApiTotalPaid
      },
      currentApiValues: currentApiValues
    };
    
    if (!isCorrect && expectedPercentage !== null) {
      var expectedDisplayedUnpaid = round2_(currentApiValues.unpaid * (expectedPercentage / 100));
      var expectedDisplayedDueNow = round2_(currentApiValues.dueNow * (expectedPercentage / 100));
      result.expectedCorrectValues = {
        unpaid: expectedDisplayedUnpaid,
        dueNow: expectedDisplayedDueNow,
        totalPaid: currentApiValues.totalPaid
      };
    }
    
    Logger.log("Diagnosis result: " + JSON.stringify(result));
    return result;
    
  } catch(e) {
    Logger.log("Error diagnosing affiliate: " + e.message);
    return { error: e.message, email: email };
  }
}

/**
 * Fix an affiliate's tracking data by triggering auto-correction
 * NOTE: As of the latest update, the system auto-corrects baseline percentages
 * on every lookup. This function triggers that auto-correction immediately.
 * 
 * @param {string} email - Affiliate email
 * @param {boolean} forceReset - If true, deletes tracking data to force fresh initialization
 * @returns {object} - Result with success status and message
 */
function fixAffiliatePercentage(email, forceReset) {
  if (!isAdmin_()) {
    return { success: false, error: "Unauthorized" };
  }
  
  try {
    Logger.log("=== FIXING AFFILIATE PERCENTAGE: " + email + " ===");
    
    // Get diagnostic info first
    var diagnosis = diagnoseAffiliatePercentage(email);
    
    if (diagnosis.error) {
      return { success: false, error: diagnosis.error };
    }
    
    if (!diagnosis.needsFix) {
      return { 
        success: true, 
        message: "No fix needed - tracking data is already correct (percentage: " + 
                 (diagnosis.expectedPercentage || 100) + "%)",
        diagnosis: diagnosis
      };
    }
    
    // Two methods to fix:
    // 1. Force reset (delete tracking) - legacy method
    // 2. Trigger lookup (auto-correction) - new method
    
    if (forceReset) {
      // Legacy method: Delete tracking data
      var deleted = deleteIncrementalTracking_(email);
      
      if (!deleted) {
        return { success: false, error: "Failed to delete tracking data" };
      }
      
      Logger.log("✅ Tracking data deleted. On next lookup, correct percentage will be applied.");
      
      return {
        success: true,
        method: "force_reset",
        message: "Tracking data reset successfully. Next lookup will apply " + 
                 (diagnosis.expectedPercentage !== null ? diagnosis.expectedPercentage + "%" : "100%") + 
                 " baseline.",
        previousDiagnosis: diagnosis
      };
    } else {
      // New method: Trigger lookup to activate auto-correction
      Logger.log("Triggering auto-correction by performing lookup...");
      
      var result = fetchByEmail_(email);
      
      if (result._baseline_corrected && result._baseline_corrected.wasApplied) {
        Logger.log("✅ Auto-correction was applied during lookup");
        return {
          success: true,
          method: "auto_correction",
          message: "Baseline automatically corrected from " + 
                   result._baseline_corrected.oldPercentage + "% to " + 
                   result._baseline_corrected.newPercentage + "%",
          correction: result._baseline_corrected,
          currentValues: {
            unpaid: result.unpaidAmount,
            dueNow: result.dueNow,
            totalPaid: result.totalPaid
          }
        };
      } else {
        return {
          success: true,
          method: "auto_correction",
          message: "Lookup completed but no correction was needed (already correct)",
          currentValues: {
            unpaid: result.unpaidAmount,
            dueNow: result.dueNow,
            totalPaid: result.totalPaid
          }
        };
      }
    }
    
  } catch(e) {
    Logger.log("Error fixing affiliate: " + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Trigger auto-correction for all affiliates by performing lookups
 * This is safer than deleting tracking data as it preserves incremental tracking
 * 
 * @param {boolean} dryRun - If true, only report issues without fixing
 * @returns {object} - Summary of all corrections applied
 */
function autoCorrectAllAffiliatePercentages(dryRun) {
  if (!isAdmin_()) {
    return { error: "Unauthorized" };
  }
  
  try {
    Logger.log("=== AUTO-CORRECTING ALL AFFILIATE PERCENTAGES ===");
    Logger.log("Dry run: " + (dryRun ? "YES (report only)" : "NO (will fix)"));
    
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var results = [];
    var totalCount = 0;
    var correctedCount = 0;
    var alreadyCorrectCount = 0;
    var errorCount = 0;
    
    // Find all tracking properties and extract emails
    var emails = [];
    for (var key in allProps) {
      if (key.indexOf('INCREMENTAL_TRACKING_') === 0) {
        // Extract email from key (reverse of getIncrementalTrackingKey_)
        var emailPart = key.replace('INCREMENTAL_TRACKING_', '');
        var email = emailPart.replace('_AT_', '@').replace(/_/g, '.');
        
        // Try to get a more accurate email by checking tracking data
        try {
          var trackingData = JSON.parse(allProps[key]);
          // The email in our system should match the percentage pattern if present
          emails.push(email);
        } catch(e) {
          Logger.log("Error parsing tracking for key: " + key);
        }
      }
    }
    
    Logger.log("Found " + emails.length + " affiliates with tracking data");
    
    // Process each affiliate
    for (var i = 0; i < emails.length; i++) {
      var email = emails[i];
      totalCount++;
      
      try {
        Logger.log("\nProcessing " + (i + 1) + "/" + emails.length + ": " + email);
        
        if (dryRun) {
          // Dry run: Just diagnose
          var diagnosis = diagnoseAffiliatePercentage(email);
          
          results.push({
            email: email,
            needsFix: diagnosis.needsFix,
            status: diagnosis.status,
            expectedPercentage: diagnosis.expectedPercentage,
            trackingPercentage: diagnosis.trackingPercentage,
            currentValues: diagnosis.currentApiValues
          });
          
          if (diagnosis.needsFix) {
            Logger.log("  ⚠️ NEEDS FIX: " + diagnosis.message);
          } else {
            Logger.log("  ✅ OK: " + diagnosis.message);
            alreadyCorrectCount++;
          }
        } else {
          // Actually fix by triggering lookup (auto-correction)
          var fixResult = fixAffiliatePercentage(email, false);
          
          if (fixResult.success) {
            if (fixResult.correction) {
              correctedCount++;
              Logger.log("  🔧 CORRECTED: " + fixResult.message);
              
              results.push({
                email: email,
                corrected: true,
                oldPercentage: fixResult.correction.oldPercentage,
                newPercentage: fixResult.correction.newPercentage,
                changes: fixResult.correction.correction,
                currentValues: fixResult.currentValues
              });
            } else {
              alreadyCorrectCount++;
              Logger.log("  ✅ ALREADY CORRECT");
              
              results.push({
                email: email,
                corrected: false,
                alreadyCorrect: true,
                currentValues: fixResult.currentValues
              });
            }
          } else {
            errorCount++;
            Logger.log("  ❌ ERROR: " + fixResult.error);
            
            results.push({
              email: email,
              error: fixResult.error
            });
          }
        }
        
        // Rate limiting
        if (i < emails.length - 1) {
          Utilities.sleep(200); // 200ms delay between lookups
        }
        
      } catch(e) {
        errorCount++;
        Logger.log("  ❌ ERROR: " + e.message);
        
        results.push({
          email: email,
          error: e.message
        });
      }
    }
    
    var summary = {
      totalProcessed: totalCount,
      corrected: correctedCount,
      alreadyCorrect: alreadyCorrectCount,
      errors: errorCount,
      dryRun: dryRun,
      timestamp: new Date().toISOString(),
      details: results
    };
    
    Logger.log("\n=== AUTO-CORRECTION SUMMARY ===");
    Logger.log("Total affiliates: " + totalCount);
    Logger.log("Corrected: " + correctedCount);
    Logger.log("Already correct: " + alreadyCorrectCount);
    Logger.log("Errors: " + errorCount);
    
    return summary;
    
  } catch(e) {
    Logger.log("Error in auto-correction: " + e.message);
    return { error: e.message };
  }
}

/**
 * Audit ALL affiliates with tracking data to find percentage mismatches
 * Returns a list of all affiliates and their status
 */
function auditAllAffiliatePercentages() {
  if (!isAdmin_()) {
    return { error: "Unauthorized" };
  }
  
  try {
    Logger.log("=== AUDITING ALL AFFILIATES ===");
    
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var results = [];
    var totalCount = 0;
    var mismatchCount = 0;
    var correctCount = 0;
    
    // Find all tracking properties
    for (var key in allProps) {
      if (key.indexOf('INCREMENTAL_TRACKING_') === 0) {
        totalCount++;
        
        // Extract email from key
        // Key format: INCREMENTAL_TRACKING_email_AT_domain_com
        var email = key.replace('INCREMENTAL_TRACKING_', '')
                       .replace('_AT_', '@')
                       .replace(/_/g, '.');
        
        // Try to reconstruct the email properly
        // This is a best-effort approach since we lost the original format
        var trackingDataStr = allProps[key];
        var trackingData = null;
        try {
          trackingData = JSON.parse(trackingDataStr);
        } catch(e) {
          Logger.log("Error parsing tracking data for key: " + key);
          continue;
        }
        
        // For accurate diagnosis, we need the actual email
        // Let's try to match it against known patterns
        var expectedPercentage = extractEmailPercentage_(email);
        var trackingPercentage = trackingData.emailBaselinePercentage;
        
        var isCorrect = (expectedPercentage === trackingPercentage) || 
                        (expectedPercentage === null && trackingPercentage === null);
        
        if (isCorrect) {
          correctCount++;
        } else {
          mismatchCount++;
        }
        
        results.push({
          email: email,
          expectedPercentage: expectedPercentage,
          trackingPercentage: trackingPercentage,
          isCorrect: isCorrect,
          status: isCorrect ? "CORRECT" : "MISMATCH",
          lastDisplayedUnpaid: trackingData.lastDisplayedUnpaid,
          lastDisplayedDueNow: trackingData.lastDisplayedDueNow
        });
      }
    }
    
    Logger.log("Audit complete: " + totalCount + " affiliates, " + mismatchCount + " mismatches, " + correctCount + " correct");
    
    return {
      success: true,
      summary: {
        totalAffiliates: totalCount,
        correctCount: correctCount,
        mismatchCount: mismatchCount
      },
      affiliates: results,
      mismatches: results.filter(function(r) { return !r.isCorrect; })
    };
    
  } catch(e) {
    Logger.log("Error auditing affiliates: " + e.message);
    return { error: e.message };
  }
}

/**
 * Fix ALL affiliates that have percentage mismatches
 * This will reset tracking data for any affiliate where the tracking percentage
 * doesn't match the email percentage
 */
function fixAllAffiliatePercentages() {
  if (!isAdmin_()) {
    return { success: false, error: "Unauthorized" };
  }
  
  try {
    Logger.log("=== FIXING ALL AFFILIATE PERCENTAGES ===");
    
    // First, audit to find mismatches
    var audit = auditAllAffiliatePercentages();
    
    if (audit.error) {
      return { success: false, error: audit.error };
    }
    
    var mismatches = audit.mismatches || [];
    
    if (mismatches.length === 0) {
      return {
        success: true,
        message: "No mismatches found. All affiliates have correct percentages.",
        audit: audit
      };
    }
    
    Logger.log("Found " + mismatches.length + " mismatches. Fixing...");
    
    var fixedCount = 0;
    var failedCount = 0;
    var fixResults = [];
    
    for (var i = 0; i < mismatches.length; i++) {
      var email = mismatches[i].email;
      Logger.log("Fixing: " + email);
      
      var fixResult = fixAffiliatePercentage(email);
      fixResults.push({
        email: email,
        success: fixResult.success,
        message: fixResult.message || fixResult.error
      });
      
      if (fixResult.success) {
        fixedCount++;
      } else {
        failedCount++;
      }
    }
    
    Logger.log("Fix complete: " + fixedCount + " fixed, " + failedCount + " failed");
    
    return {
      success: true,
      message: "Fixed " + fixedCount + " affiliates out of " + mismatches.length + " mismatches",
      summary: {
        totalMismatches: mismatches.length,
        fixedCount: fixedCount,
        failedCount: failedCount
      },
      details: fixResults
    };
    
  } catch(e) {
    Logger.log("Error fixing all affiliates: " + e.message);
    return { success: false, error: e.message };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * REFERRALS / LEADS TRACKING SYSTEM (FIXED)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This system tracks Rewardful LEADS (not visitors) for users in the Student Dashboard.
 * 
 * CRITICAL: Rewardful referrals have conversion_state:
 *   - "visitor" = anonymous visit (we don't count these)
 *   - "lead" = visitor provided contact info (THIS IS WHAT WE WANT)
 *   - "conversion" = paying customer
 * 
 * API: GET /referrals?affiliate_id={id}&conversion_state=lead
 * Pagination: max 100 per page, use page parameter
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Cache duration for referral data (in milliseconds)
var REFERRAL_CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get referral storage key for a user
 */
function getReferralDataKey_(email) {
  return 'REFERRAL_DATA_' + email.toLowerCase().trim();
}

/**
 * Get stored referral data for a user
 */
function getStoredReferralData_(email) {
  var key = getReferralDataKey_(email);
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty(key);
  
  if (!stored) {
    return null;
  }
  
  try {
    return JSON.parse(stored);
  } catch (e) {
    Logger.log('Error parsing stored referral data: ' + e.message);
    return null;
  }
}

/**
 * Save referral data for a user (metadata only - leads cached separately)
 * CRITICAL: Never overwrite good data with empty/zero on API failure
 */
function saveReferralData_(email, data) {
  var key = getReferralDataKey_(email);
  var props = PropertiesService.getScriptProperties();
  
  try {
    props.setProperty(key, JSON.stringify(data));
    return true;
  } catch (e) {
    Logger.log('Error saving referral data: ' + e.message);
    return false;
  }
}

/**
 * Get cache key for leads data
 */
function getLeadsCacheKey_(email) {
  return 'LEADS_CACHE_' + email.toLowerCase().trim();
}

/**
 * Cache leads for a user using CacheService (larger capacity than PropertiesService)
 * CacheService allows up to 100KB per key and 6 hour expiration
 */
function cacheLeadsForUser_(email, leads) {
  try {
    var key = getLeadsCacheKey_(email);
    var cache = CacheService.getScriptCache();
    
    // Stringify and check size
    var leadsJson = JSON.stringify(leads);
    
    // CacheService has 100KB limit - if too large, chunk it
    if (leadsJson.length > 90000) { // Leave some buffer
      // For very large datasets, split into chunks
      var chunkSize = 200; // Leads per chunk
      var chunks = [];
      for (var i = 0; i < leads.length; i += chunkSize) {
        chunks.push(leads.slice(i, i + chunkSize));
      }
      
      // Store chunk count and each chunk separately
      cache.put(key + '_count', chunks.length.toString(), 21600); // 6 hours
      for (var c = 0; c < chunks.length; c++) {
        cache.put(key + '_chunk_' + c, JSON.stringify(chunks[c]), 21600);
      }
      Logger.log('Cached ' + leads.length + ' leads in ' + chunks.length + ' chunks for: ' + email);
    } else {
      // Single cache entry for smaller datasets
      cache.put(key, leadsJson, 21600); // 6 hours
      cache.remove(key + '_count'); // Clear any old chunked data
      Logger.log('Cached ' + leads.length + ' leads (single entry) for: ' + email);
    }
    return true;
  } catch (e) {
    Logger.log('Error caching leads: ' + e.message);
    return false;
  }
}

/**
 * Get cached leads for a user
 */
function getCachedLeads_(email) {
  try {
    var key = getLeadsCacheKey_(email);
    var cache = CacheService.getScriptCache();
    
    // Check for chunked data first
    var chunkCount = cache.get(key + '_count');
    if (chunkCount) {
      var numChunks = parseInt(chunkCount, 10);
      var allLeads = [];
      for (var c = 0; c < numChunks; c++) {
        var chunkData = cache.get(key + '_chunk_' + c);
        if (chunkData) {
          var chunkLeads = JSON.parse(chunkData);
          allLeads = allLeads.concat(chunkLeads);
        }
      }
      Logger.log('Retrieved ' + allLeads.length + ' leads from ' + numChunks + ' cache chunks for: ' + email);
      return allLeads;
    }
    
    // Try single cache entry
    var cached = cache.get(key);
    if (cached) {
      var leads = JSON.parse(cached);
      Logger.log('Retrieved ' + leads.length + ' leads from cache for: ' + email);
      return leads;
    }
    
    return null;
  } catch (e) {
    Logger.log('Error getting cached leads: ' + e.message);
    return null;
  }
}

/**
 * Helper: Determine if a referral record is a conversion
 * 
 * A referral is considered a conversion if ANY of these are true:
 * - conversion_state equals "conversion" (case-insensitive)
 * - became_conversion_at exists and is truthy
 * - sale_occurred_at exists and is truthy
 * - converted_at exists and is truthy
 * 
 * @param {object} ref - The referral object from API
 * @returns {boolean} - True if this is a conversion
 */
/**
 * Check if a referral is a VISITOR (anonymous, never became a lead)
 * CRITICAL: Visitors must be EXCLUDED from lead counts!
 * 
 * @param {object} ref - The referral object from API
 * @returns {boolean} - True if this is a visitor (NOT a lead or conversion)
 */
function isVisitor_(ref) {
  if (!ref) return false;
  
  var state = (ref.conversion_state || '').toString().toLowerCase();
  
  // Explicit visitor state
  if (state === 'visitor') {
    return true;
  }
  
  // If no conversion_state and no became_lead_at, treat as visitor
  if (!state && !ref.became_lead_at) {
    return true;
  }
  
  return false;
}

/**
 * Check if a referral is a LEAD (provided contact info but hasn't converted)
 * 
 * @param {object} ref - The referral object from API
 * @returns {boolean} - True if this is a lead
 */
function isLead_(ref) {
  if (!ref) return false;
  
  // Not a visitor and not a conversion = lead
  if (isVisitor_(ref)) return false;
  if (isConversion_(ref)) return false;
  
  // Explicit lead state
  var state = (ref.conversion_state || '').toString().toLowerCase();
  if (state === 'lead') {
    return true;
  }
  
  // Has became_lead_at but not a conversion
  if (ref.became_lead_at && ref.became_lead_at !== null && ref.became_lead_at !== '') {
    return true;
  }
  
  // Default: if not visitor and not conversion, it's a lead
  return true;
}

/**
 * Check if a referral is a CONVERSION (paying customer)
 * 
 * @param {object} ref - The referral object from API
 * @returns {boolean} - True if this is a conversion
 */
function isConversion_(ref) {
  if (!ref) return false;
  
  // Check conversion_state field (case-insensitive)
  var state = (ref.conversion_state || '').toString().toLowerCase();
  if (state === 'conversion' || state === 'converted') {
    return true;
  }
  
  // Check date fields that indicate conversion
  if (ref.became_conversion_at && ref.became_conversion_at !== null && ref.became_conversion_at !== '') {
    return true;
  }
  if (ref.sale_occurred_at && ref.sale_occurred_at !== null && ref.sale_occurred_at !== '') {
    return true;
  }
  if (ref.converted_at && ref.converted_at !== null && ref.converted_at !== '') {
    return true;
  }
  if (ref.convertedAt && ref.convertedAt !== null && ref.convertedAt !== '') {
    return true;
  }
  
  return false;
}

/**
 * MAIN FUNCTION: Fetch ALL referrals (leads + conversions) from API for an affiliate
 * 
 * Uses: GET /referrals?affiliate_id={id} (NO conversion_state filter)
 * This fetches both leads AND conversions so we can display both in the toggle UI.
 * 
 * @param {string} affiliateId - The affiliate ID
 * @param {string} apiKey - The API key
 * @param {string} filterState - Optional: 'lead' or 'conversion' to filter server-side
 * @returns {object} - { success, referrals, totalCount, error, debugInfo }
 */
function fetchAllReferralsFromRewardful_(affiliateId, apiKey, filterState) {
  var debugInfo = {
    affiliateId: affiliateId,
    filterState: filterState || 'all',
    requestedAt: new Date().toISOString(),
    pages: [],
    totalFetched: 0,
    errors: []
  };
  
  try {
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('FETCHING ALL REFERRALS FROM API');
    Logger.log('Affiliate ID: ' + affiliateId);
    Logger.log('Filter state: ' + (filterState || 'none (all)'));
    Logger.log('═══════════════════════════════════════════════════════');
    
    var allReferrals = [];
    var page = 1;
    var hasMore = true;
    var maxPages = 50; // Safety limit (50 * 100 = 5000 referrals max)
    
    while (hasMore && page <= maxPages) {
      // Fetch ALL referrals (both leads and conversions)
      // Only add conversion_state filter if explicitly requested
      var url = BASE_URL + '/referrals' +
                '?affiliate_id=' + encodeURIComponent(affiliateId) +
                (filterState ? '&conversion_state=' + filterState : '') +
                '&page=' + page +
                '&limit=100';  // Rewardful uses 'limit', not 'per_page'
      
      Logger.log('Page ' + page + ' URL: ' + url);
      debugInfo.pages.push({ page: page, url: url });
      
      Utilities.sleep(RATE_LIMIT_DELAY_MS); // Rate limiting between requests
      
      // Fetch with retry logic for rate limiting (429 errors)
      var response = null;
      var code = 0;
      var responseText = '';
      var rateLimitRetries = 0;
      
      while (rateLimitRetries <= MAX_RATE_LIMIT_RETRIES) {
        response = fetchWithRetry_(url, apiKey);
        
        if (!response) {
          var errMsg = 'No response from API for page ' + page;
          Logger.log('ERROR: ' + errMsg);
          debugInfo.errors.push(errMsg);
          break;
        }
        
        code = response.getResponseCode();
        responseText = response.getContentText();
        
        // Handle rate limiting with exponential backoff
        if (code === 429) {
          rateLimitRetries++;
          if (rateLimitRetries <= MAX_RATE_LIMIT_RETRIES) {
            var backoffMs = RATE_LIMIT_BACKOFF_MS * Math.pow(2, rateLimitRetries - 1);
            Logger.log('Rate limited (429) on page ' + page + ', retry ' + rateLimitRetries + '/' + MAX_RATE_LIMIT_RETRIES + ' after ' + backoffMs + 'ms');
            Utilities.sleep(backoffMs);
            continue;  // Retry the request
          } else {
            Logger.log('Rate limit exceeded after ' + MAX_RATE_LIMIT_RETRIES + ' retries on page ' + page);
          }
        }
        break;  // Exit retry loop on success or non-429 error
      }
      
      if (!response) {
        break;  // No response after retries
      }
      
      Logger.log('Page ' + page + ' HTTP: ' + code);
      debugInfo.pages[page - 1].httpCode = code;
      
      if (code < 200 || code >= 300) {
        var errMsg = 'API error HTTP ' + code + ': ' + responseText.substring(0, 200);
        Logger.log('ERROR: ' + errMsg);
        debugInfo.errors.push(errMsg);
        break;
      }
      
      var body = safeParseJson_(responseText);
      if (!body) {
        var errMsg = 'Invalid JSON response on page ' + page;
        Logger.log('ERROR: ' + errMsg);
        debugInfo.errors.push(errMsg);
        debugInfo.pages[page - 1].rawResponse = responseText.substring(0, 500);
        break;
      }
      
      // Rewardful returns array directly (not wrapped in data/referrals)
      var refs = [];
      if (Array.isArray(body)) {
        refs = body;
      } else if (body.data && Array.isArray(body.data)) {
        refs = body.data;
      } else if (body.referrals && Array.isArray(body.referrals)) {
        refs = body.referrals;
      }
      
      var pageCount = refs.length;
      Logger.log('Page ' + page + ' returned ' + pageCount + ' referrals');
      debugInfo.pages[page - 1].count = pageCount;
      
      // Log first referral's fields for debugging conversion detection
      if (page === 1 && refs.length > 0) {
        var sample = refs[0];
        Logger.log('Sample referral keys: ' + Object.keys(sample).join(', '));
        Logger.log('Sample conversion_state: ' + sample.conversion_state);
        Logger.log('Sample became_conversion_at: ' + sample.became_conversion_at);
        Logger.log('Sample sale_occurred_at: ' + sample.sale_occurred_at);
      }
      
      if (pageCount === 0) {
        // No more results
        hasMore = false;
      } else {
        allReferrals = allReferrals.concat(refs);
        page++;
        
        // Continue if we got a full page (might be more)
        if (pageCount < 100) {
          hasMore = false;
        }
      }
    }
    
    debugInfo.totalFetched = allReferrals.length;
    debugInfo.pagesProcessed = page - 1;
    
    // FIXED: Properly classify into THREE states: visitor, lead, conversion
    // Visitors are EXCLUDED from the returned data - they are not leads!
    var visitorsCount = 0;
    var leadsCount = 0;
    var conversionsCount = 0;
    var filteredReferrals = []; // Only leads + conversions, NO visitors
    
    for (var i = 0; i < allReferrals.length; i++) {
      var ref = allReferrals[i];
      
      if (isVisitor_(ref)) {
        // EXCLUDE visitors - they are anonymous and not real leads
        visitorsCount++;
        // Do NOT add to filteredReferrals
      } else if (isConversion_(ref)) {
        conversionsCount++;
        filteredReferrals.push(ref);
      } else {
        // It's a lead (not visitor, not conversion)
        leadsCount++;
        filteredReferrals.push(ref);
      }
    }
    
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('TOTAL REFERRALS FETCHED: ' + allReferrals.length);
    Logger.log('  - Visitors (EXCLUDED): ' + visitorsCount);
    Logger.log('  - Leads: ' + leadsCount);
    Logger.log('  - Conversions: ' + conversionsCount);
    Logger.log('  - Returned (leads+conversions): ' + filteredReferrals.length);
    Logger.log('Pages processed: ' + (page - 1));
    Logger.log('═══════════════════════════════════════════════════════');
    
    return {
      success: true,
      referrals: filteredReferrals,  // FIXED: Only leads + conversions
      leads: filteredReferrals,       // FIXED: Only leads + conversions
      totalCount: filteredReferrals.length,  // FIXED: Exclude visitors
      leadsCount: leadsCount,
      conversionsCount: conversionsCount,
      visitorsExcluded: visitorsCount,  // For debugging
      debugInfo: debugInfo
    };
    
  } catch (e) {
    Logger.log('EXCEPTION in fetchAllReferralsFromRewardful_: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    debugInfo.errors.push('Exception: ' + e.message);
    return { 
      success: false, 
      error: e.message, 
      totalCount: 0,
      referrals: [],
      leads: [],
      debugInfo: debugInfo
    };
  }
}

/**
 * MAIN FUNCTION: Get lead/referral data for a user
 * Called from the Student Dashboard frontend
 * 
 * FIXED: Now correctly fetches LEADS (conversion_state=lead), not visitors
 * 
 * @param {string} email - The user's email
 * @param {boolean} forceRefresh - If true, bypass cache and fetch fresh from API
 * @returns {object} - Lead data with counts, delta, timestamps, and lead details for table
 */
function getReferralData(email, forceRefresh) {
  try {
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('GET REFERRAL DATA (LEADS)');
    Logger.log('Email: ' + email);
    Logger.log('Force refresh: ' + forceRefresh);
    Logger.log('═══════════════════════════════════════════════════════');
    
    if (!email || typeof email !== 'string' || email.indexOf('@') === -1) {
      return { success: false, error: 'Invalid email address' };
    }
    
    var now = new Date().getTime();
    var storedData = getStoredReferralData_(email);
    
    // Check if we can use cached data
    if (!forceRefresh && storedData && storedData.lastSuccessfulFetchAt) {
      var cacheAge = now - storedData.lastSuccessfulFetchAt;
      if (cacheAge < REFERRAL_CACHE_DURATION_MS) {
        Logger.log('Using cached metadata (age: ' + Math.round(cacheAge/1000) + 's)');
        
        // Get cached leads from CacheService (separate from metadata)
        var cachedLeads = getCachedLeads_(email);
        
        if (cachedLeads && cachedLeads.length > 0) {
          Logger.log('Found ' + cachedLeads.length + ' cached leads for display');
          return {
            success: true,
            totalLeads: storedData.lastKnownLeadCount || 0,
            previousCount: storedData.previousLeadCount || 0,
            deltaSinceLastFetch: 0,
            lastFetchedAt: storedData.lastSuccessfulFetchAt,
            fromCache: true,
            leads: cachedLeads, // Return ALL cached leads for client-side pagination
            hasMore: false
          };
        } else {
          // Leads cache expired but metadata still valid - need to refetch
          Logger.log('Leads cache expired, forcing API refresh...');
          // Fall through to API fetch below
        }
      }
    }
    
    // Need to fetch fresh data from API
    Logger.log('Fetching fresh lead data from API...');
    
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    if (!apiKey) {
      Logger.log('ERROR: Missing API key');
      return { success: false, error: 'Missing API key' };
    }
    
    // First, get the affiliate ID for this email
    Logger.log('Looking up affiliate for email: ' + email);
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    
    if (!affResp) {
      Logger.log('ERROR: No response from affiliate lookup');
      // Return stored data if available
      if (storedData && storedData.lastKnownLeadCount > 0) {
        return returnStoredDataWithWarning_(storedData, 'No response from API', email);
      }
      return { success: false, error: 'No response from API' };
    }
    
    var affCode = affResp.getResponseCode();
    Logger.log('Affiliate lookup HTTP: ' + affCode);
    
    if (affCode !== 200) {
      Logger.log('Affiliate not found (HTTP ' + affCode + ')');
      // Return sanitized response - no internal details to frontend
      return {
        success: true,
        totalLeads: 0,
        previousCount: 0,
        deltaSinceLastFetch: 0,
        lastFetchedAt: now,
        fromCache: false,
        message: 'No leads data available for this account',
        leads: []
      };
    }
    
    var affPayload = safeParseJson_(affResp.getContentText());
    var aff = extractAffiliate_(affPayload);
    
    if (!aff || !aff.id) {
      Logger.log('No affiliate found for email: ' + email);
      return {
        success: true,
        totalLeads: 0,
        previousCount: 0,
        deltaSinceLastFetch: 0,
        lastFetchedAt: now,
        fromCache: false,
        affiliateId: null,
        message: 'Affiliate not found',
        leads: []
      };
    }
    
    Logger.log('Found affiliate ID: ' + aff.id);
    
    // FIXED: Fetch ALL referrals (leads + conversions) for this affiliate
    // This allows the toggle UI to show both leads and conversions
    var leadResult = fetchAllReferralsFromRewardful_(aff.id, apiKey);
    
    if (!leadResult.success) {
      Logger.log('API fetch failed: ' + leadResult.error);
      // CRITICAL: Do NOT overwrite good data with zeros on failure
      if (storedData && storedData.lastKnownLeadCount > 0) {
        Logger.log('Returning stored data instead of zeros');
        return returnStoredDataWithWarning_(storedData, leadResult.error, email);
      }
      // Return generic error - no debug info to frontend
      return { 
        success: false, 
        error: 'Failed to fetch lead data. Please try again later.'
      };
    }
    
    // SUCCESS: Calculate delta and save
    var previousCount = storedData ? (storedData.lastKnownLeadCount || 0) : 0;
    var newCount = leadResult.totalCount;
    var delta = newCount - previousCount;
    
    Logger.log('Lead count: ' + newCount + ' (was: ' + previousCount + ', delta: ' + delta + ')');
    
    // Prepare ALL lead details for table (most recent first, no PII)
    var allLeadsForDisplay = prepareLeadsForDisplay_(leadResult.leads);
    
    // Store metadata (not all leads - PropertiesService has size limits)
    // Leads are cached separately in CacheService for "Load More" functionality
    var newStoredData = {
      userEmail: email,
      affiliateId: aff.id,
      lastKnownLeadCount: newCount,
      previousLeadCount: previousCount,
      lastSuccessfulFetchAt: now,
      lastFetchedAt: now,
      fetchHistory: storedData ? (storedData.fetchHistory || []) : []
    };
    
    // Keep last 10 fetch records
    newStoredData.fetchHistory.push({
      timestamp: now,
      count: newCount,
      delta: delta
    });
    if (newStoredData.fetchHistory.length > 10) {
      newStoredData.fetchHistory = newStoredData.fetchHistory.slice(-10);
    }
    
    saveReferralData_(email, newStoredData);
    
    // Cache ALL leads separately using CacheService (larger capacity, 6hr expiration)
    cacheLeadsForUser_(email, allLeadsForDisplay);
    
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('SUCCESS: Returning ' + newCount + ' leads (all ' + allLeadsForDisplay.length + ' for display)');
    Logger.log('═══════════════════════════════════════════════════════');
    
    // Return sanitized data with ALL leads for frontend pagination
    // Frontend will handle "Load More" client-side
    return {
      success: true,
      totalLeads: newCount,
      previousCount: previousCount,
      deltaSinceLastFetch: delta,
      lastFetchedAt: now,
      fromCache: false,
      leads: allLeadsForDisplay, // Return ALL leads - frontend will paginate
      hasMore: false // All leads returned, no server-side pagination needed
    };
    
  } catch (e) {
    Logger.log('EXCEPTION in getReferralData: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    
    // CRITICAL: Return stored data on exception, never zeros
    var storedData = getStoredReferralData_(email);
    if (storedData && storedData.lastKnownLeadCount > 0) {
      return returnStoredDataWithWarning_(storedData, 'Exception: ' + e.message, email);
    }
    
    return { success: false, error: e.message };
  }
}

/**
 * Helper: Return stored data with a warning when API fails
 * NEVER returns 0 if we have valid stored data
 */
function returnStoredDataWithWarning_(storedData, warning, email) {
  // Return sanitized data only - no internal IDs to frontend
  // Sanitize warning to be user-friendly (hide internal details)
  var userWarning = 'Using cached data. Refresh may be temporarily unavailable.';
  
  // Get cached leads from CacheService
  var cachedLeads = email ? getCachedLeads_(email) : [];
  
  return {
    success: true,
    totalLeads: storedData.lastKnownLeadCount || 0,
    previousCount: storedData.previousLeadCount || 0,
    deltaSinceLastFetch: 0,
    lastFetchedAt: storedData.lastSuccessfulFetchAt || storedData.lastFetchedAt,
    fromCache: true,
    leads: cachedLeads || [],
    hasMore: false,
    warning: userWarning
  };
}

/**
 * PUBLIC: Get referrals with mode filter (leads or conversions)
 * Supports pagination and can be used by both Student Dashboard and Teacher Stats
 * 
 * @param {object} params - { email, mode, page, pageSize }
 *   email: The affiliate email (internal commission email preferred)
 *   mode: "leads" or "conversions"
 *   page: Page number (1-based)
 *   pageSize: Items per page
 * @returns {object} { success, rows, totalCount, page, pageSize, mode }
 */
function getReferralsWithMode(params) {
  try {
    var email = params.email;
    var mode = (params.mode || 'leads').toLowerCase();
    var page = parseInt(params.page, 10) || 1;
    var pageSize = parseInt(params.pageSize, 10) || 25;
    
    Logger.log('getReferralsWithMode: email=' + email + ', mode=' + mode + ', page=' + page);
    
    if (!email || email.indexOf('@') === -1) {
      return { success: false, error: 'Invalid email' };
    }
    
    if (mode !== 'leads' && mode !== 'conversions') {
      mode = 'leads';
    }
    
    // Resolve email to internal email if needed
    var resolveResult = resolveStudentByEmail_(email);
    var emailForLookup = email;
    if (resolveResult.status === 'OK' && resolveResult.student) {
      emailForLookup = resolveResult.student.internalEmail || resolveResult.student.canonicalEmail || email;
    }
    
    // Fetch all referral data (uses caching internally)
    var referralData = getReferralData(emailForLookup, false);
    
    if (!referralData.success) {
      return { 
        success: false, 
        error: referralData.error || 'Failed to fetch referrals',
        rows: [],
        totalCount: 0,
        page: page,
        pageSize: pageSize,
        mode: mode
      };
    }
    
    var allReferrals = referralData.leads || referralData.referrals || [];
    
    // FIXED: Properly classify using canonical helpers
    // Visitors should already be filtered out at the source, but double-check here
    var leadsCount = 0;
    var conversionsCount = 0;
    var leadsArr = [];
    var conversionsArr = [];
    
    for (var i = 0; i < allReferrals.length; i++) {
      var ref = allReferrals[i];
      
      // Skip visitors (should already be filtered, but be safe)
      if (isVisitor_(ref)) {
        continue;
      }
      
      if (isConversion_(ref)) {
        conversionsCount++;
        conversionsArr.push(ref);
      } else if (isLead_(ref)) {
        leadsCount++;
        leadsArr.push(ref);
      }
    }
    
    Logger.log('Total referrals (excluding visitors): ' + (leadsCount + conversionsCount) + ', Leads: ' + leadsCount + ', Conversions: ' + conversionsCount);
    
    // Select the appropriate filtered array based on mode
    var filteredRows = mode === 'conversions' ? conversionsArr : leadsArr;
    
    // Calculate pagination
    var totalCount = filteredRows.length;
    var totalPages = Math.ceil(totalCount / pageSize) || 1;
    page = Math.min(page, totalPages);
    page = Math.max(1, page);
    
    var startIndex = (page - 1) * pageSize;
    var endIndex = Math.min(startIndex + pageSize, totalCount);
    var rows = filteredRows.slice(startIndex, endIndex);
    
    Logger.log('Mode=' + mode + ': ' + totalCount + ' total, returning ' + rows.length + ' (page ' + page + '/' + totalPages + ')');
    
    return {
      success: true,
      rows: rows,
      totalCount: totalCount,
      page: page,
      pageSize: pageSize,
      totalPages: totalPages,
      mode: mode,
      leadsCount: leadsCount,
      conversionsCount: conversionsCount
    };
    
  } catch (e) {
    Logger.log('Error in getReferralsWithMode: ' + e.message);
    return { 
      success: false, 
      error: e.message,
      rows: [],
      totalCount: 0,
      page: 1,
      pageSize: 25,
      mode: params.mode || 'leads'
    };
  }
}

/**
 * PUBLIC: Get referrals for teacher viewing a student
 * Includes authorization check
 */
function getStudentReferralsForTeacher(teacherEmail, studentEmail, mode, page, pageSize) {
  try {
    Logger.log('Teacher ' + teacherEmail + ' requesting referrals for student ' + studentEmail);
    
    // Verify teacher is linked to this student
    var teacherData = getTeacherData(teacherEmail);
    if (!teacherData || !teacherData.students) {
      return { success: false, error: 'Teacher data not found' };
    }
    
    var isLinked = teacherData.students.some(function(s) {
      return s.email.toLowerCase() === studentEmail.toLowerCase();
    });
    
    if (!isLinked) {
      Logger.log('Authorization failed: teacher not linked to student');
      return { success: false, error: 'You are not authorized to view this student\'s data' };
    }
    
    // Teacher is authorized - fetch the referrals
    return getReferralsWithMode({
      email: studentEmail,
      mode: mode,
      page: page,
      pageSize: pageSize
    });
    
  } catch (e) {
    Logger.log('Error in getStudentReferralsForTeacher: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Helper: Prepare lead data for display (no PII)
 * Converts raw API referral objects to display-safe format
 */
function prepareLeadsForDisplay_(leads) {
  if (!leads || !Array.isArray(leads)) {
    return [];
  }
  
  var displayLeads = leads.map(function(lead) {
    // Detect conversion and lead status using canonical helpers
    var isConv = isConversion_(lead);
    var isLeadRecord = isLead_(lead);
    
    // Determine the correct state label
    var stateLabel = 'lead';
    if (isConv) {
      stateLabel = 'conversion';
    } else if (lead.conversion_state) {
      stateLabel = lead.conversion_state.toLowerCase();
    }
    
    // Extract safe display data - NO customer names/emails
    return {
      id: lead.id ? lead.id.toString().slice(-6) : '------', // Last 6 chars of ID
      state: stateLabel,
      conversion_state: stateLabel,
      createdAt: lead.created_at || null,
      becameLeadAt: lead.became_lead_at || lead.created_at || null,
      // Include ALL possible conversion date fields
      becameConversionAt: lead.became_conversion_at || lead.converted_at || lead.sale_occurred_at || null,
      sale_occurred_at: lead.sale_occurred_at || lead.became_conversion_at || null,
      isConversion: isConv,
      isLead: isLeadRecord,
      // Include timestamps for sorting
      _sortTimestamp: lead.became_lead_at || lead.created_at || ''
    };
  });
  
  // Sort by most recent first
  displayLeads.sort(function(a, b) {
    var dateA = a._sortTimestamp || '';
    var dateB = b._sortTimestamp || '';
    return dateB.localeCompare(dateA);
  });
  
  return displayLeads;
}

/**
 * DEBUG: Get comprehensive lead/referral debug info for a user
 * Admin-only function for troubleshooting
 */
function debugReferralData(email) {
  if (!isAdmin_()) {
    return { error: 'Unauthorized - admin only' };
  }
  
  try {
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('DEBUG REFERRAL DATA');
    Logger.log('Email: ' + email);
    Logger.log('═══════════════════════════════════════════════════════');
    
    // Get stored data first
    var storedData = getStoredReferralData_(email);
    
    // Get affiliate ID
    var apiKey = PropertiesService.getScriptProperties().getProperty('AFFILIATE_API_KEY');
    var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(email.trim());
    var affResp = fetchWithRetry_(affUrl, apiKey);
    var affiliateInfo = null;
    
    if (affResp && affResp.getResponseCode() === 200) {
      var affPayload = safeParseJson_(affResp.getContentText());
      var aff = extractAffiliate_(affPayload);
      if (aff) {
        affiliateInfo = {
          id: aff.id,
          firstName: aff.first_name,
          lastName: aff.last_name,
          email: aff.email
        };
      }
    }
    
    // Force fresh fetch
    var freshResult = getReferralData(email, true);
    
    return {
      email: email,
      affiliateInfo: affiliateInfo,
      storedDataBefore: storedData,
      freshFetchResult: {
        success: freshResult.success,
        totalLeads: freshResult.totalLeads,
        previousCount: freshResult.previousCount,
        delta: freshResult.deltaSinceLastFetch,
        fromCache: freshResult.fromCache,
        leadsCount: freshResult.leads ? freshResult.leads.length : 0,
        warning: freshResult.warning,
        error: freshResult.error
      },
      debugInfo: freshResult.debugInfo,
      cacheConfig: {
        cacheDurationMs: REFERRAL_CACHE_DURATION_MS,
        cacheDurationMinutes: REFERRAL_CACHE_DURATION_MS / 60000
      },
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    return { error: e.message, stack: e.stack };
  }
}

/**
 * Clear referral data for a user (admin only)
 */
function clearReferralData(email) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  try {
    var key = getReferralDataKey_(email);
    PropertiesService.getScriptProperties().deleteProperty(key);
    Logger.log('Cleared referral data for: ' + email);
    return { success: true, message: 'Referral data cleared for ' + email };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Test referral fetching behavior - run this to verify the fix
 */
function testLeadsFetching() {
  var testEmail = 'tafreedddddd100%@gmail.com'; // The affiliate from screenshot
  
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('TEST: LEADS FETCHING');
  Logger.log('Testing email: ' + testEmail);
  Logger.log('═══════════════════════════════════════════════════════');
  
  // Clear any cached data first
  clearReferralData(testEmail);
  Logger.log('Cleared cached data');
  
  // Test 1: Fresh fetch
  Logger.log('\n--- Test 1: Fresh fetch ---');
  var result1 = getReferralData(testEmail, true);
  Logger.log('Total leads: ' + result1.totalLeads);
  Logger.log('From cache: ' + result1.fromCache);
  Logger.log('Debug info: ' + JSON.stringify(result1.debugInfo));
  
  // Test 2: Cached fetch
  Logger.log('\n--- Test 2: Cached fetch ---');
  var result2 = getReferralData(testEmail, false);
  Logger.log('Total leads: ' + result2.totalLeads);
  Logger.log('From cache: ' + result2.fromCache);
  
  // Test 3: Force refresh
  Logger.log('\n--- Test 3: Force refresh ---');
  var result3 = getReferralData(testEmail, true);
  Logger.log('Total leads: ' + result3.totalLeads);
  Logger.log('From cache: ' + result3.fromCache);
  
  return {
    testEmail: testEmail,
    test1_fresh: {
      totalLeads: result1.totalLeads,
      fromCache: result1.fromCache,
      success: result1.success
    },
    test2_cached: {
      totalLeads: result2.totalLeads,
      fromCache: result2.fromCache,
      success: result2.success
    },
    test3_refresh: {
      totalLeads: result3.totalLeads,
      fromCache: result3.fromCache,
      success: result3.success
    }
  };
}

// ============================================================================
// AFFILIATE AUTHENTICATION SYSTEM
// ============================================================================
// Secure password-based authentication for all portals
// Uses SHA-256 hashing with per-user salt and rate limiting
// ============================================================================

var AUTH_PREFIX = 'AUTH_';
var AUTH_LOCKOUT_MINUTES = 15;
var AUTH_MAX_FAILED_ATTEMPTS = 5;
var AUTH_MIN_PASSWORD_LENGTH = 8;

/**
 * Normalize email for consistent storage
 */
function normalizeAuthEmail_(email) {
  if (!email) return '';
  return email.toLowerCase().trim();
}

/**
 * Get the storage key for auth data
 */
function getAuthKey_(email) {
  return AUTH_PREFIX + normalizeAuthEmail_(email);
}

/**
 * Generate a cryptographically random salt
 */
function generateSalt_() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var salt = '';
  for (var i = 0; i < 32; i++) {
    salt += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return salt;
}

/**
 * Hash a password with salt using iterative SHA-256 (PBKDF2-like)
 * Uses multiple rounds to slow down brute force attacks
 */
function hashPassword_(password, salt) {
  var iterations = 10000;
  var combined = password + salt;
  
  // Iterative hashing for security
  for (var i = 0; i < iterations; i++) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined);
    combined = Utilities.base64Encode(digest) + salt;
  }
  
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined)
  );
}

/**
 * Get auth record for an email
 */
function getAuthRecord_(email) {
  var key = getAuthKey_(email);
  var data = PropertiesService.getScriptProperties().getProperty(key);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

/**
 * Save auth record for an email
 */
function saveAuthRecord_(email, record) {
  var key = getAuthKey_(email);
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(record));
}

/**
 * Delete an auth record by email
 */
function deleteAuthRecord_(email) {
  var key = getAuthKey_(email);
  PropertiesService.getScriptProperties().deleteProperty(key);
}

// ============================================================================
// ACCOUNT STATUS SYSTEM (Approval-based registration)
// ============================================================================
// Account statuses:
// - PENDING: User has requested access, waiting for admin approval
// - ACTIVE: Account approved and can log in
// - REJECTED: Account request was denied
// - (no record): Admin accounts or pre-existing affiliates
//
// EMAIL SYSTEM:
// - alias_email: User-facing login email (what user sees/types)
// - rewardful_email: Internal email used in Rewardful (may contain encoded %)
// - Admin sets rewardful_email during approval
// - User never sees rewardful_email
// ============================================================================

var ACCOUNT_STATUS = {
  PENDING: 'PENDING',           // Request submitted, awaiting admin approval
  APPROVED: 'APPROVED',         // Admin approved, awaiting user to set password
  COMPLETED: 'COMPLETED',       // User set password, account fully set up (can also be called ACTIVE)
  ACTIVE: 'ACTIVE',             // Alias for COMPLETED - fully set up account
  REJECTED: 'REJECTED'          // Admin rejected the request
};

/**
 * Get account status for an email
 * Returns null if no explicit status (admin or not yet requested)
 */
function getAccountStatus_(email) {
  var record = getAuthRecord_(email);
  if (!record) return null;
  return record.accountStatus || null;
}

/**
 * Check if user can log in based on account status
 * Admins: always allowed
 * Affiliates in Rewardful with ACTIVE status or no status: allowed
 * PENDING or REJECTED: not allowed
 */
function canUserLogin_(email) {
  var normalizedEmail = normalizeAuthEmail_(email);
  
  // Admins always allowed
  if (isAdminEmail_(normalizedEmail)) {
    return { allowed: true, reason: 'admin' };
  }
  
  var record = getAuthRecord_(normalizedEmail);
  
  // Handle redirect records
  if (record && record.redirectTo) {
    record = getAuthRecord_(record.redirectTo);
  }
  
  var status = record ? record.accountStatus : null;
  var hasPassword = record ? !!record.passwordHash : false;
  
  // If no status set and user exists in affiliate system, they're legacy users (allowed)
  if (!status && affiliateExists_(normalizedEmail)) {
    return { allowed: true, reason: 'legacy_affiliate' };
  }
  
  // COMPLETED or ACTIVE: Fully set up, can log in
  if (status === ACCOUNT_STATUS.COMPLETED || status === ACCOUNT_STATUS.ACTIVE) {
    if (hasPassword) {
      return { allowed: true, reason: 'approved' };
    } else {
      // Active but no password - need to set it first
      return { 
        allowed: false, 
        reason: 'needs_password',
        error: 'Your account is approved but no password is set. Please set your password first.'
      };
    }
  }
  
  // APPROVED: Admin approved but waiting for password
  if (status === ACCOUNT_STATUS.APPROVED) {
    return { 
      allowed: false, 
      reason: 'needs_password',
      error: 'Your account is approved! Please set your password to complete setup.'
    };
  }
  
  if (status === ACCOUNT_STATUS.PENDING) {
    return { 
      allowed: false, 
      reason: 'pending',
      error: 'Your account is pending approval. Please wait for an admin to approve your access request.'
    };
  }
  
  if (status === ACCOUNT_STATUS.REJECTED) {
    return { 
      allowed: false, 
      reason: 'rejected',
      error: 'Your access request was not approved. Please contact an administrator.'
    };
  }
  
  // Unknown status - not allowed
  return { 
    allowed: false, 
    reason: 'unknown',
    error: 'Account not found. Please request access first.'
  };
}

/**
 * PUBLIC: Check account status for request access page
 * Used by SetPassword.html to determine what UI to show
 * 
 * Returns:
 * - status: 'new' | 'pending' | 'approved_needs_password' | 'active' | 'rejected' | 'admin'
 * - Can set password only if status is 'approved_needs_password'
 */
function checkAccountStatus(aliasEmail) {
  var normalizedAlias = normalizeAuthEmail_(aliasEmail);
  
  if (!normalizedAlias) {
    return { status: 'new', canSetPassword: false };
  }
  
  // Check if admin (don't reveal in message)
  if (isAdminEmail_(normalizedAlias)) {
    return { status: 'admin', canSetPassword: true, message: 'You can set or reset your password.' };
  }
  
  // Get account record by alias email
  var record = getAuthRecord_(normalizedAlias);
  
  // Handle redirect records (when admin changed alias email)
  if (record && record.redirectTo) {
    record = getAuthRecord_(record.redirectTo);
  }
  
  // If not found, try searching by originalAliasEmail
  if (!record) {
    record = findRecordByOriginalEmail_(normalizedAlias);
  }
  
  if (!record) {
    return { status: 'new', canSetPassword: false };
  }
  
  var accountStatus = record.accountStatus;
  var hasPassword = !!record.passwordHash;
  
  if (accountStatus === ACCOUNT_STATUS.PENDING) {
    return { 
      status: 'pending', 
      canSetPassword: false,
      message: 'Your account is pending approval. Please check back later.'
    };
  }
  
  if (accountStatus === ACCOUNT_STATUS.REJECTED) {
    return { 
      status: 'rejected', 
      canSetPassword: false,
      message: 'Your access request was not approved. Please contact an administrator.'
    };
  }
  
  // APPROVED: Admin approved, waiting for password
  if (accountStatus === ACCOUNT_STATUS.APPROVED) {
    return { 
      status: 'approved_needs_password', 
      canSetPassword: true,
      message: 'Your account has been approved! Please set your password below.',
      currentAliasEmail: record.aliasEmail  // In case it was changed
    };
  }
  
  // COMPLETED or ACTIVE: Fully set up
  if (accountStatus === ACCOUNT_STATUS.COMPLETED || accountStatus === ACCOUNT_STATUS.ACTIVE) {
    if (hasPassword) {
      return { 
        status: 'active', 
        canSetPassword: false,
        message: 'Your account is already set up. Please use the login page.'
      };
    } else {
      // Edge case: status is ACTIVE/COMPLETED but no password (shouldn't happen)
      return { 
        status: 'approved_needs_password', 
        canSetPassword: true,
        message: 'Your account has been approved! Please set your password below.'
      };
    }
  }
  
  // No explicit status - check if legacy affiliate (exists in affiliate system by alias email)
  if (affiliateExists_(normalizedAlias)) {
    if (hasPassword) {
      return { status: 'active', canSetPassword: false, message: 'Please log in.' };
    } else {
      return { status: 'approved_needs_password', canSetPassword: true, message: 'Please set your password.' };
    }
  }
  
  return { status: 'new', canSetPassword: false };
}

/**
 * PUBLIC: Get request status for "Check your status" popup
 * Returns user-friendly status information
 */
function getRequestStatus(email) {
  var normalizedEmail = normalizeAuthEmail_(email);
  
  if (!normalizedEmail) {
    return { 
      found: false, 
      status: 'NOT_FOUND',
      message: 'Please enter a valid email address.'
    };
  }
  
  // Check if admin (don't reveal in message)
  if (isAdminEmail_(normalizedEmail)) {
    return { 
      found: true, 
      status: 'ADMIN',
      canSetPassword: true,
      message: 'You can set or reset your password.'  // Generic message, don't reveal admin
    };
  }
  
  // Get account record
  var record = getAuthRecord_(normalizedEmail);
  
  // If not found directly, the email might have been changed by admin
  // Try searching by originalAliasEmail in other records
  if (!record) {
    record = findRecordByOriginalEmail_(normalizedEmail);
  }
  
  if (!record) {
    return { 
      found: false, 
      status: 'NOT_FOUND',
      message: 'No access request found for this email. Would you like to request access?'
    };
  }
  
  // Handle redirect records (when admin changed alias email)
  if (record.redirectTo) {
    // This is a redirect pointer - fetch the actual record
    var actualRecord = getAuthRecord_(record.redirectTo);
    if (actualRecord) {
      record = actualRecord;
      // Let user know their email was updated
      Logger.log('Status check redirected: ' + normalizedEmail + ' -> ' + record.aliasEmail);
    }
  }
  
  var accountStatus = record.accountStatus;
  var hasPassword = !!record.passwordHash;
  var firstName = record.firstName || '';
  var lastName = record.lastName || '';
  var requestedAt = record.requestedAt || null;
  var approvedAt = record.approvedAt || null;
  var currentAliasEmail = record.aliasEmail || normalizedEmail;
  
  // PENDING: Waiting for admin approval
  if (accountStatus === ACCOUNT_STATUS.PENDING) {
    return { 
      found: true,
      status: 'PENDING',
      canSetPassword: false,
      firstName: firstName,
      lastName: lastName,
      requestedAt: requestedAt,
      message: 'Your access request is pending approval. Please check back later or contact an administrator.'
    };
  }
  
  // REJECTED: Admin declined
  if (accountStatus === ACCOUNT_STATUS.REJECTED) {
    return { 
      found: true,
      status: 'REJECTED',
      canSetPassword: false,
      firstName: firstName,
      lastName: lastName,
      message: 'Your access request was not approved. Please contact an administrator if you believe this is an error.'
    };
  }
  
  // APPROVED: Admin approved, waiting for user to set password
  if (accountStatus === ACCOUNT_STATUS.APPROVED) {
    var emailNote = '';
    if (currentAliasEmail !== normalizedEmail) {
      emailNote = ' Note: Your login email has been updated to ' + currentAliasEmail + '.';
    }
    return { 
      found: true,
      status: 'APPROVED',
      canSetPassword: true,
      firstName: firstName,
      lastName: lastName,
      approvedAt: approvedAt,
      currentAliasEmail: currentAliasEmail,
      message: 'Your account has been approved! You can now set your password.' + emailNote
    };
  }
  
  // COMPLETED or ACTIVE: Password is set, account fully active
  if (accountStatus === ACCOUNT_STATUS.COMPLETED || accountStatus === ACCOUNT_STATUS.ACTIVE) {
    if (hasPassword) {
      return { 
        found: true,
        status: 'COMPLETED',
        canSetPassword: false,
        firstName: firstName,
        lastName: lastName,
        message: 'Your account is already set up! Please use the login page to sign in.'
      };
    } else {
      // Edge case: ACTIVE but no password (shouldn't happen but handle gracefully)
      return { 
        found: true,
        status: 'APPROVED',
        canSetPassword: true,
        firstName: firstName,
        lastName: lastName,
        approvedAt: approvedAt,
        message: 'Your account has been approved! You can now set your password.'
      };
    }
  }
  
  // No explicit status but record exists - treat as unknown
  return { 
    found: true,
    status: 'UNKNOWN',
    canSetPassword: false,
    message: 'Account status unknown. Please contact an administrator.'
  };
}

/**
 * Helper: Find a record by originalAliasEmail
 * This handles the case where admin edited the alias email
 */
function findRecordByOriginalEmail_(originalEmail) {
  var props = PropertiesService.getScriptProperties();
  var allProps = props.getProperties();
  var normalizedOriginal = normalizeAuthEmail_(originalEmail);
  
  for (var key in allProps) {
    if (key.indexOf('auth_') === 0) {
      try {
        var record = JSON.parse(allProps[key]);
        // Check if this record's originalAliasEmail matches
        if (record && record.originalAliasEmail) {
          var recordOriginal = normalizeAuthEmail_(record.originalAliasEmail);
          if (recordOriginal === normalizedOriginal) {
            return record;
          }
        }
      } catch (e) {
        // Skip invalid records
      }
    }
  }
  return null;
}

/**
 * PUBLIC: Request account access (new user registration)
 * Creates a PENDING account request that admins must approve.
 * 
 * User enters their ALIAS EMAIL (the email they want to use for login).
 * Admin will assign the REWARDFUL EMAIL (with encoded %) during approval.
 * 
 * NO password collected at request time - user sets password after approval.
 */
function requestAccountAccess(aliasEmail, firstName, lastName, portalType) {
  var normalizedAlias = normalizeAuthEmail_(aliasEmail);
  
  // Validate inputs
  if (!normalizedAlias) {
    return { success: false, error: 'Email is required' };
  }
  
  // BLOCK LEGACY/INTERNAL EMAIL REQUESTS
  // Users must request access with their alias email, not internal email
  var legacyCheck = checkLegacyEmailLogin(normalizedAlias);
  if (legacyCheck.isLegacy) {
    Logger.log('Blocked internal email access request: ' + normalizedAlias);
    return { 
      success: false, 
      error: 'This is an internal system email and cannot be used for access requests. Please use your regular email address.' + (legacyCheck.aliasEmail ? ' Your login email should be: ' + legacyCheck.aliasEmail : ''),
      isLegacyEmail: true,
      aliasEmail: legacyCheck.aliasEmail
    };
  }
  
  // First name and last name are now OPTIONAL
  // Admin will set these during approval based on affiliate system data
  firstName = firstName ? firstName.trim() : '';
  lastName = lastName ? lastName.trim() : '';
  portalType = portalType || 'affiliate';
  
  // =============================================================================
  // SECURITY: Check if email already exists in our ALIAS database
  // - Don't reveal if it's an admin email
  // - Don't reveal account status details
  // - Just say "email already exists" for any existing record
  // - Only check OUR auth records, NOT Rewardful database
  // =============================================================================
  
  // Check existing record by alias email FIRST (before admin check)
  var existingRecord = getAuthRecord_(normalizedAlias);
  
  if (existingRecord) {
    // Email already exists in our system - give generic message
    // Don't reveal if it's pending, rejected, active, admin, etc.
    var status = existingRecord.accountStatus;
    
    // Special case: If user's OWN request is pending, let them know
    // (They entered the same email they previously requested)
    if (status === ACCOUNT_STATUS.PENDING) {
      return { 
        success: false, 
        isPending: true,
        error: 'You already have a pending access request. Please check back later for approval.' 
      };
    }
    
    // Special case: If approved but no password yet, let them set it
    // (This is their own approved account)
    if ((status === ACCOUNT_STATUS.ACTIVE || status === ACCOUNT_STATUS.APPROVED || status === ACCOUNT_STATUS.COMPLETED) && !existingRecord.passwordHash) {
      return { 
        success: false, 
        isApproved: true,
        needsPassword: true,
        error: 'Your account is approved! Please set your password below.' 
      };
    }
    
    // For ALL other cases (active with password, rejected, or any other status)
    // Give a GENERIC message - don't reveal status details
    return { 
      success: false, 
      error: 'This email address is already registered. Please use the login page or contact support if you need assistance.' 
    };
  }
  
  // Email doesn't exist in our database yet
  // Now check if it's an admin email (they get special setup flow)
  if (isAdminEmail_(normalizedAlias)) {
    // Admin email that hasn't been set up yet - allow password setup
    // Don't reveal it's an admin to the user - just show password form
    return { 
      success: false, 
      isAdmin: true,  // Frontend will show password setup
      error: 'Please set your password to activate your account.'  // Generic message
    };
  }
  
  // Create PENDING account request
  var record = existingRecord || {};
  record.aliasEmail = normalizedAlias;  // User-facing login email
  record.email = normalizedAlias;        // For backwards compatibility
  record.firstName = firstName;
  record.lastName = lastName;
  record.requestedPortalType = portalType;
  record.accountStatus = ACCOUNT_STATUS.PENDING;
  record.requestedAt = new Date().toISOString();
  record.requestedName = firstName + ' ' + lastName;
  // rewardful_email will be set by admin during approval
  record.rewardfulEmail = null;
  record.rewardfulAffiliateId = null;
  // NO password - will be set after approval
  record.passwordHash = null;
  record.passwordSalt = null;
  record.failedLoginCount = 0;
  record.lockUntilTimestamp = 0;
  
  saveAuthRecord_(normalizedAlias, record);
  
  Logger.log('Account access requested (PENDING): ' + normalizedAlias + ' - ' + firstName + ' ' + lastName);
  
  return { 
    success: true, 
    pending: true,
    message: 'Your access request has been submitted! Please check back later to set your password once an administrator approves your account.'
  };
}

/**
 * PUBLIC: Set password for APPROVED accounts (alias email)
 * User can only set password if their account is APPROVED
 */
function setApprovedAccountPassword(aliasEmail, password, confirmPassword) {
  var normalizedAlias = normalizeAuthEmail_(aliasEmail);
  
  if (!normalizedAlias) {
    return { success: false, error: 'Email is required' };
  }
  
  // Validate password
  if (!password) {
    return { success: false, error: 'Password is required' };
  }
  
  if (password !== confirmPassword) {
    return { success: false, error: 'Passwords do not match' };
  }
  
  var strengthCheck = validatePasswordStrength_(password);
  if (!strengthCheck.valid) {
    return { success: false, error: strengthCheck.error };
  }
  
  // Get record - check direct lookup first, then follow redirect
  var record = getAuthRecord_(normalizedAlias);
  var recordKey = normalizedAlias;
  
  // Handle redirect (if admin changed alias email)
  if (record && record.redirectTo) {
    // This email was changed by admin, use the new one
    recordKey = record.redirectTo;
    record = getAuthRecord_(recordKey);
    if (!record) {
      return { success: false, error: 'Account record not found. Please contact an administrator.' };
    }
  }
  
  // If still not found, try searching by originalAliasEmail
  if (!record) {
    record = findRecordByOriginalEmail_(normalizedAlias);
    if (record) {
      recordKey = record.aliasEmail || normalizedAlias;
    }
  }
  
  // Special case: Admin emails without a record yet
  // Create their record on-the-fly when they set their password
  if (!record && isAdminEmail_(normalizedAlias)) {
    Logger.log('Creating new admin record for: ' + normalizedAlias);
    record = {
      aliasEmail: normalizedAlias,
      email: normalizedAlias,
      firstName: 'Admin',
      lastName: '',
      accountStatus: ACCOUNT_STATUS.APPROVED,  // Will become COMPLETED after password set
      requestedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      isAdmin: true
    };
    recordKey = normalizedAlias;
  }
  
  if (!record) {
    return { success: false, error: 'No approved account found for this email.' };
  }
  
  // Check if status allows password setting
  var accountStatus = record.accountStatus;
  if (accountStatus === ACCOUNT_STATUS.PENDING) {
    return { success: false, error: 'Your account is still pending approval. Please wait for admin approval.' };
  }
  if (accountStatus === ACCOUNT_STATUS.REJECTED) {
    return { success: false, error: 'Your account request was rejected. Please contact an administrator.' };
  }
  if ((accountStatus === ACCOUNT_STATUS.COMPLETED || accountStatus === ACCOUNT_STATUS.ACTIVE) && record.passwordHash) {
    return { success: false, error: 'Password is already set for this account. Please use the login page.' };
  }
  if (accountStatus !== ACCOUNT_STATUS.APPROVED && accountStatus !== ACCOUNT_STATUS.ACTIVE && accountStatus !== ACCOUNT_STATUS.COMPLETED) {
    // Admin accounts and other edge cases
    if (!isAdminEmail_(normalizedAlias) && !isAdminEmail_(recordKey)) {
      return { success: false, error: 'Cannot set password for this account status.' };
    }
  }
  
  // Generate salt and hash
  var salt = generateSalt_();
  var hash = hashPassword_(password, salt);
  
  // Update record - transition to COMPLETED
  record.passwordSalt = salt;
  record.passwordHash = hash;
  record.passwordSetAt = new Date().toISOString();
  record.completedAt = new Date().toISOString();  // Mark when setup completed
  record.failedLoginCount = 0;
  record.lockUntilTimestamp = 0;
  record.accountStatus = ACCOUNT_STATUS.COMPLETED;  // Final state!
  
  saveAuthRecord_(recordKey, record);
  
  // Clean up redirect record if exists (optional - could keep for audit trail)
  if (record.originalAliasEmail && normalizeAuthEmail_(record.originalAliasEmail) !== recordKey) {
    var redirectRecord = getAuthRecord_(record.originalAliasEmail);
    if (redirectRecord && redirectRecord.redirectTo) {
      // Update redirect to show COMPLETED status too
      redirectRecord.accountStatus = ACCOUNT_STATUS.COMPLETED;
      saveAuthRecord_(record.originalAliasEmail, redirectRecord);
    }
  }
  
  Logger.log('Password set - account COMPLETED: ' + recordKey);
  
  return { 
    success: true, 
    message: 'Your password has been set successfully! You can now log in.',
    loginEmail: recordKey  // Return the correct email to use for login
  };
}

// ============================================================================
// REWARDFUL API INTEGRATION
// ============================================================================

/**
 * Fetch all campaigns from Rewardful
 * Used by admin to assign new affiliates to campaigns
 * @param {string} sessionToken - Optional session token for mobile/web auth
 */
function fetchRewardfulCampaigns(sessionToken) {
  if (!isAdminAny_(sessionToken)) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  try {
    var apiKey = getApiKey_();
    if (!apiKey) {
      return { success: false, error: 'API key not configured' };
    }
    
    var url = BASE_URL + '/campaigns?per_page=100';
    var response = fetchWithRetry_(url, apiKey);
    
    if (!response || response.getResponseCode() !== 200) {
      Logger.log('Failed to fetch campaigns: ' + (response ? response.getResponseCode() : 'no response'));
      return { success: false, error: 'Failed to fetch campaigns from Rewardful' };
    }
    
    var payload = safeParseJson_(response.getContentText());
    var campaigns = [];
    
    // Handle both array and object with data property
    var data = Array.isArray(payload) ? payload : (payload.data || payload);
    
    if (Array.isArray(data)) {
      for (var i = 0; i < data.length; i++) {
        var c = data[i];
        campaigns.push({
          id: c.id,
          name: c.name,
          commission_percent: c.commission_percent || c.default_commission_percent,
          cookie_days: c.cookie_days,
          created_at: c.created_at
        });
      }
    }
    
    Logger.log('Fetched ' + campaigns.length + ' campaigns from Rewardful');
    
    return { success: true, campaigns: campaigns };
    
  } catch (e) {
    Logger.log('Error fetching campaigns: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * PUBLIC: Fetch campaigns from affiliate system
 * Alias for fetchRewardfulCampaigns to avoid exposing provider name
 */
function fetchAffiliateCampaigns() {
  return fetchRewardfulCampaigns();
}

/**
 * Create or update affiliate in affiliate system
 * Returns the affiliate ID on success
 */
function upsertRewardfulAffiliate_(email, firstName, lastName, campaignId, paypalEmail, options) {
  var normalizedEmail = normalizeAuthEmail_(email);
  options = options || {};
  
  try {
    var apiKey = getApiKey_();
    if (!apiKey) {
      return { success: false, error: 'API key not configured' };
    }
    
    // First, check if affiliate already exists
    var existingAffiliate = getAffiliateByEmail_(normalizedEmail);
    
    if (existingAffiliate) {
      // UPDATE existing affiliate
      Logger.log('Updating existing affiliate: ' + normalizedEmail + ' (ID: ' + existingAffiliate.id + ')');
      
      var updateUrl = BASE_URL + '/affiliates/' + existingAffiliate.id;
      var updatePayload = {
        first_name: firstName,
        last_name: lastName
      };
      
      // Only update campaign if provided and different
      if (campaignId && campaignId !== existingAffiliate.campaign_id) {
        updatePayload.campaign_id = campaignId;
      }
      
      if (paypalEmail) {
        updatePayload.paypal_email = paypalEmail;
      }
      
      if (options.state) {
        updatePayload.state = options.state;
      }
      
      var updateResponse = UrlFetchApp.fetch(updateUrl, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify(updatePayload),
        muteHttpExceptions: true
      });
      
      if (updateResponse.getResponseCode() === 200) {
        var updatedData = safeParseJson_(updateResponse.getContentText());
        Logger.log('Affiliate updated successfully: ' + normalizedEmail);
        return { 
          success: true, 
          action: 'updated',
          affiliateId: existingAffiliate.id,
          affiliate: updatedData
        };
      } else {
        Logger.log('Failed to update affiliate: ' + updateResponse.getContentText());
        return { success: false, error: 'Failed to update affiliate: ' + updateResponse.getContentText() };
      }
      
    } else {
      // CREATE new affiliate
      Logger.log('Creating new affiliate: ' + normalizedEmail);
      
      var createUrl = BASE_URL + '/affiliates';
      var createPayload = {
        email: normalizedEmail,
        first_name: firstName,
        last_name: lastName,
        state: options.state || 'active'
      };
      
      if (campaignId) {
        createPayload.campaign_id = campaignId;
      }
      
      if (paypalEmail) {
        createPayload.paypal_email = paypalEmail;
      }
      
      var createResponse = UrlFetchApp.fetch(createUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify(createPayload),
        muteHttpExceptions: true
      });
      
      var responseCode = createResponse.getResponseCode();
      if (responseCode === 200 || responseCode === 201) {
        var createdData = safeParseJson_(createResponse.getContentText());
        var affiliateId = createdData.id || (createdData.data && createdData.data.id);
        Logger.log('Affiliate created successfully: ' + normalizedEmail + ' (ID: ' + affiliateId + ')');
        return { 
          success: true, 
          action: 'created',
          affiliateId: affiliateId,
          affiliate: createdData
        };
      } else {
        Logger.log('Failed to create affiliate: ' + createResponse.getContentText());
        return { success: false, error: 'Failed to create affiliate: ' + createResponse.getContentText() };
      }
    }
    
  } catch (e) {
    Logger.log('Error in upsertRewardfulAffiliate_: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Create a NEW affiliate in the affiliate system
 * This function ONLY creates - it does not check if affiliate exists first
 * Use getAffiliateByEmail_ to check existence before calling this
 */
function createAffiliateInSystem_(email, firstName, lastName, campaignId, paypalEmail, options) {
  var normalizedEmail = normalizeAuthEmail_(email);
  options = options || {};
  
  try {
    var apiKey = getApiKey_();
    if (!apiKey) {
      return { success: false, error: 'API key not configured' };
    }
    
    Logger.log('Creating new affiliate: ' + normalizedEmail);
    
    var createUrl = BASE_URL + '/affiliates';
    var createPayload = {
      email: normalizedEmail,
      first_name: firstName,
      last_name: lastName,
      state: options.state || 'active'
    };
    
    if (campaignId) {
      createPayload.campaign_id = campaignId;
    }
    
    // Only include PayPal email if provided (optional)
    if (paypalEmail && paypalEmail.trim()) {
      createPayload.paypal_email = paypalEmail.trim();
    }
    
    var createResponse = UrlFetchApp.fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(createPayload),
      muteHttpExceptions: true
    });
    
    var responseCode = createResponse.getResponseCode();
    if (responseCode === 200 || responseCode === 201) {
      var createdData = safeParseJson_(createResponse.getContentText());
      var affiliateId = createdData.id || (createdData.data && createdData.data.id);
      Logger.log('Affiliate created successfully: ' + normalizedEmail + ' (ID: ' + affiliateId + ')');
      return { 
        success: true, 
        action: 'created',
        affiliateId: affiliateId,
        affiliate: createdData
      };
    } else {
      var errorText = createResponse.getContentText();
      Logger.log('Failed to create affiliate: ' + errorText);
      // Parse error for user-friendly message
      var errorData = safeParseJson_(errorText);
      var userMessage = 'Failed to create affiliate';
      if (errorData && errorData.error) {
        userMessage = errorData.error;
      } else if (errorData && errorData.message) {
        userMessage = errorData.message;
      }
      return { success: false, error: userMessage };
    }
    
  } catch (e) {
    Logger.log('Error in createAffiliateInSystem_: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Get affiliate by email from affiliate system
 */
function getAffiliateByEmail_(email) {
  var normalizedEmail = normalizeAuthEmail_(email);
  
  try {
    var apiKey = getApiKey_();
    if (!apiKey) return null;
    
    var searchUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(normalizedEmail);
    var response = fetchWithRetry_(searchUrl, apiKey);
    
    if (!response || response.getResponseCode() !== 200) return null;
    
    var payload = safeParseJson_(response.getContentText());
    var affiliates = extractCommissions_(payload);
    
    if (!affiliates || affiliates.length === 0) return null;
    
    // Find exact email match
    for (var i = 0; i < affiliates.length; i++) {
      if (normalizeAuthEmail_(affiliates[i].email) === normalizedEmail) {
        return affiliates[i];
      }
    }
    
    return null;
  } catch (e) {
    Logger.log('Error getting affiliate by email: ' + e.message);
    return null;
  }
}

// ============================================================================
// PASSWORD SETUP TOKEN SYSTEM
// ============================================================================

var TOKEN_PREFIX = 'PWD_TOKEN_';
var TOKEN_EXPIRY_HOURS = 48; // Tokens expire after 48 hours

/**
 * Generate a secure password setup token
 */
function generatePasswordToken_(email) {
  var normalizedEmail = normalizeAuthEmail_(email);
  
  // Generate random token
  var token = Utilities.getUuid() + '-' + Utilities.getUuid();
  
  // Store token with expiry
  var tokenData = {
    email: normalizedEmail,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()
  };
  
  var props = PropertiesService.getScriptProperties();
  props.setProperty(TOKEN_PREFIX + token, JSON.stringify(tokenData));
  
  Logger.log('Password token generated for: ' + normalizedEmail);
  
  return token;
}

/**
 * Validate password setup token and return associated email
 */
function validatePasswordToken_(token) {
  if (!token) return null;
  
  try {
    var props = PropertiesService.getScriptProperties();
    var tokenDataStr = props.getProperty(TOKEN_PREFIX + token);
    
    if (!tokenDataStr) {
      Logger.log('Token not found: ' + token.substring(0, 20) + '...');
      return null;
    }
    
    var tokenData = JSON.parse(tokenDataStr);
    
    // Check expiry
    if (new Date(tokenData.expiresAt) < new Date()) {
      Logger.log('Token expired for: ' + tokenData.email);
      // Clean up expired token
      props.deleteProperty(TOKEN_PREFIX + token);
      return null;
    }
    
    return tokenData.email;
    
  } catch (e) {
    Logger.log('Error validating token: ' + e.message);
    return null;
  }
}

/**
 * Consume (invalidate) a password token after use
 */
function consumePasswordToken_(token) {
  if (!token) return;
  
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(TOKEN_PREFIX + token);
  Logger.log('Password token consumed');
}

/**
 * PUBLIC: Validate a password setup token (for frontend)
 */
function validatePasswordSetupToken(token) {
  var email = validatePasswordToken_(token);
  
  if (!email) {
    return { valid: false, error: 'Invalid or expired link. Please contact an administrator for a new password setup link.' };
  }
  
  return { valid: true, email: email };
}

/**
 * PUBLIC: Set password using a valid token
 */
function setPasswordWithToken(token, password, confirmPassword) {
  // Validate token first
  var email = validatePasswordToken_(token);
  
  if (!email) {
    return { success: false, error: 'Invalid or expired link. Please contact an administrator for a new password setup link.' };
  }
  
  // Validate password
  if (!password) {
    return { success: false, error: 'Password is required' };
  }
  
  if (password !== confirmPassword) {
    return { success: false, error: 'Passwords do not match' };
  }
  
  var strengthCheck = validatePasswordStrength_(password);
  if (!strengthCheck.valid) {
    return { success: false, error: strengthCheck.error };
  }
  
  // Get or create auth record
  var record = getAuthRecord_(email) || { email: email };
  
  // Generate salt and hash
  var salt = generateSalt_();
  var hash = hashPassword_(password, salt);
  
  // Update record
  record.email = email;
  record.passwordSalt = salt;
  record.passwordHash = hash;
  record.passwordSetAt = new Date().toISOString();
  record.accountStatus = ACCOUNT_STATUS.ACTIVE; // Ensure active
  record.failedLoginCount = 0;
  record.lockUntilTimestamp = 0;
  
  saveAuthRecord_(email, record);
  
  // Consume the token so it can't be reused
  consumePasswordToken_(token);
  
  Logger.log('Password set via token for: ' + email);
  
  return { 
    success: true, 
    message: 'Your password has been set successfully! You can now log in.'
  };
}

/**
 * Send password setup email to user
 */
function sendPasswordSetupEmail_(email, firstName) {
  var normalizedEmail = normalizeAuthEmail_(email);
  
  try {
    // Generate token
    var token = generatePasswordToken_(normalizedEmail);
    
    // Build setup URL
    var setupUrl = WEB_APP_URL + '?page=setpassword&token=' + encodeURIComponent(token);
    
    // Send email
    var subject = 'Set Up Your TradersUtopia Portal Password';
    var htmlBody = '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">' +
      '<h2 style="color: #3b82f6;">Welcome to TradersUtopia Portal!</h2>' +
      '<p>Hi ' + (firstName || 'there') + ',</p>' +
      '<p>Your account has been approved! Click the button below to set up your password and access the portal:</p>' +
      '<p style="text-align: center; margin: 30px 0;">' +
        '<a href="' + setupUrl + '" style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Set Up Your Password</a>' +
      '</p>' +
      '<p style="color: #666; font-size: 14px;">This link will expire in ' + TOKEN_EXPIRY_HOURS + ' hours.</p>' +
      '<p style="color: #666; font-size: 14px;">If you did not request this account, please ignore this email.</p>' +
      '<hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">' +
      '<p style="color: #999; font-size: 12px;">TradersUtopia Portal</p>' +
      '</div>';
    
    var textBody = 'Welcome to TradersUtopia Portal!\n\n' +
      'Hi ' + (firstName || 'there') + ',\n\n' +
      'Your account has been approved! Visit this link to set up your password:\n' +
      setupUrl + '\n\n' +
      'This link will expire in ' + TOKEN_EXPIRY_HOURS + ' hours.\n\n' +
      'If you did not request this account, please ignore this email.';
    
    MailApp.sendEmail({
      to: normalizedEmail,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody
    });
    
    Logger.log('Password setup email sent to: ' + normalizedEmail);
    return { success: true };
    
  } catch (e) {
    Logger.log('Error sending password setup email: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * ADMIN: Get list of pending account requests
 * @param {string} sessionToken - Optional session token for mobile/web auth
 */
function adminGetPendingAccounts(sessionToken) {
  if (!isAdminAny_(sessionToken)) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  var props = PropertiesService.getScriptProperties();
  var allKeys = props.getKeys();
  var pending = [];
  
  for (var i = 0; i < allKeys.length; i++) {
    var key = allKeys[i];
    if (key.indexOf(AUTH_PREFIX) === 0) {
      try {
        var record = JSON.parse(props.getProperty(key));
        if (record && record.accountStatus === ACCOUNT_STATUS.PENDING) {
          // aliasEmail is what user entered (login email)
          var aliasEmail = record.aliasEmail || record.email;
          
          pending.push({
            aliasEmail: aliasEmail,              // User-facing login email
            email: aliasEmail,                   // For backwards compatibility
            firstName: record.firstName || '',
            lastName: record.lastName || '',
            requestedAt: record.requestedAt,
            requestedPortalType: record.requestedPortalType || 'affiliate',
            requestedName: record.requestedName || '(not provided)',
            // rewardfulEmail will be set by admin during approval
            rewardfulEmail: record.rewardfulEmail || null
          });
        }
      } catch (e) {
        // Skip invalid records
      }
    }
  }
  
  // Sort by request date (oldest first)
  pending.sort(function(a, b) {
    return new Date(a.requestedAt) - new Date(b.requestedAt);
  });
  
  return { 
    success: true, 
    pending: pending,
    count: pending.length
  };
}

/**
 * ADMIN: Get details of a pending account request
 * Returns full info for the admin approval form
 */
function adminGetAccountRequest(aliasEmail) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  var normalizedAlias = normalizeAuthEmail_(aliasEmail);
  if (!normalizedAlias) {
    return { success: false, error: 'Email is required' };
  }
  
  var record = getAuthRecord_(normalizedAlias);
  if (!record) {
    return { success: false, error: 'No account request found for this email' };
  }
  
  // Check if a rewardful_email was previously set
  var rewardfulEmail = record.rewardfulEmail || null;
  
  // If we have a rewardful_email, check if affiliate exists by that email
  var existingAffiliate = null;
  if (rewardfulEmail) {
    existingAffiliate = getAffiliateByEmail_(rewardfulEmail);
  }
  
  return {
    success: true,
    request: {
      aliasEmail: normalizedAlias,           // User-facing login email (read-only)
      rewardfulEmail: rewardfulEmail,        // Internal Rewardful email (editable by admin)
      firstName: record.firstName || '',
      lastName: record.lastName || '',
      requestedPortalType: record.requestedPortalType || 'affiliate',
      requestedAt: record.requestedAt,
      accountStatus: record.accountStatus
    },
    existingAffiliate: existingAffiliate ? {
      id: existingAffiliate.id,
      firstName: existingAffiliate.first_name,
      lastName: existingAffiliate.last_name,
      email: existingAffiliate.email,
      campaignId: existingAffiliate.campaign_id
    } : null
  };
}

/**
 * ADMIN: Approve an account request with Rewardful provisioning
 * 
 * DUAL EMAIL SYSTEM:
 * - aliasEmail: User-facing login email (what user entered to request access)
 * - rewardfulEmail: Internal email for Rewardful (may contain encoded % commission)
 * 
 * This function:
 * 1. Validates rewardfulEmail is provided
 * 2. Upserts affiliate in Rewardful using rewardfulEmail
 * 3. Creates/activates portal user keyed by aliasEmail
 * 4. Stores the mapping: aliasEmail -> rewardfulEmail
 * 5. Marks request as APPROVED
 * 
 * NOTE: No email is sent - user revisits "Request Access" to set password
 */
function adminApproveAccount(originalAliasEmail, approvalData, sessionToken) {
  if (!isAdminAny_(sessionToken)) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  var normalizedOriginalAlias = normalizeAuthEmail_(originalAliasEmail);
  if (!normalizedOriginalAlias) {
    return { success: false, error: 'Original alias email is required' };
  }
  
  // Get approval data (from admin form)
  approvalData = approvalData || {};
  var firstName = approvalData.firstName;
  var lastName = approvalData.lastName;
  var newAliasEmail = approvalData.newAliasEmail;       // NEW: Possibly edited alias email
  var rewardfulEmail = approvalData.rewardfulEmail;     // REQUIRED - internal Rewardful email with %
  var campaignId = approvalData.campaignId || null;
  var paypalEmail = approvalData.paypalEmail || null;   // OPTIONAL - can be blank
  var affiliateState = approvalData.state || 'active';
  
  // Normalize new alias email (or use original if not provided)
  var normalizedNewAlias = newAliasEmail ? normalizeAuthEmail_(newAliasEmail) : normalizedOriginalAlias;
  if (!normalizedNewAlias) {
    return { success: false, error: 'Valid alias email is required' };
  }
  
  // CRITICAL: internal email must be provided by admin
  if (!rewardfulEmail || !rewardfulEmail.trim()) {
    return { 
      success: false, 
      error: 'Internal Commission Email is required. Please enter the internal email (with % if applicable).' 
    };
  }
  
  var normalizedRewardful = normalizeAuthEmail_(rewardfulEmail);
  
  // Get the pending request using ORIGINAL alias email
  var record = getAuthRecord_(normalizedOriginalAlias);
  if (!record) {
    return { success: false, error: 'No account request found for this alias email' };
  }
  
  // Use request data as fallback if not provided in approval
  firstName = firstName || record.firstName || 'Unknown';
  lastName = lastName || record.lastName || 'User';
  
  // Validate we're approving a pending request
  if (record.accountStatus && record.accountStatus !== ACCOUNT_STATUS.PENDING) {
    if (record.accountStatus === ACCOUNT_STATUS.ACTIVE) {
      return { success: false, error: 'This account is already active.' };
    }
  }
  
  // Check if alias email was changed and if new one conflicts with existing
  var aliasEmailChanged = normalizedNewAlias !== normalizedOriginalAlias;
  if (aliasEmailChanged) {
    var existingRecord = getAuthRecord_(normalizedNewAlias);
    if (existingRecord) {
      return { success: false, error: 'The new alias email is already in use by another account.' };
    }
  }
  
  Logger.log('=== ADMIN APPROVING ACCOUNT ===');
  Logger.log('Original Alias Email: ' + normalizedOriginalAlias);
  Logger.log('New Alias Email (login): ' + normalizedNewAlias + (aliasEmailChanged ? ' [CHANGED]' : ''));
  Logger.log('Internal Email: ' + normalizedRewardful);
  
  // STEP 1: Check if affiliate ALREADY EXISTS by internal email
  var existingAffiliate = getAffiliateByEmail_(normalizedRewardful);
  var affiliateId = null;
  var actionTaken = '';
  
  if (existingAffiliate) {
    // Case A: Affiliate already exists - LINK, don't create
    affiliateId = existingAffiliate.id;
    actionTaken = 'linked';
    Logger.log('Existing affiliate found: ID=' + affiliateId + ' - Linking instead of creating');
  } else {
    // Case B: Affiliate does NOT exist - CREATE new one
    Logger.log('No existing affiliate found - Creating new affiliate');
    
    var createResult = createAffiliateInSystem_(
      normalizedRewardful,
      firstName,
      lastName,
      campaignId,
      paypalEmail || null,
      { state: affiliateState }
    );
    
    if (!createResult.success) {
      Logger.log('Failed to create affiliate: ' + createResult.error);
      return { 
        success: false, 
        error: 'Failed to create affiliate in system: ' + createResult.error,
        step: 'affiliate_system'
      };
    }
    
    affiliateId = createResult.affiliateId;
    actionTaken = 'created';
    Logger.log('New affiliate created: ID=' + affiliateId);
  }
  
  // STEP 2: Update the record - set status to APPROVED (NOT ACTIVE yet)
  // Store originalAliasEmail so user can find by either email
  record.originalAliasEmail = normalizedOriginalAlias;  // What user originally requested with
  record.aliasEmail = normalizedNewAlias;               // Current login email (possibly edited by admin)
  record.email = normalizedNewAlias;                    // For backwards compatibility
  record.rewardfulEmail = normalizedRewardful;          // Internal commission email
  record.internalEmail = normalizedRewardful;           // Alias for clarity
  record.firstName = firstName;
  record.lastName = lastName;
  record.accountStatus = ACCOUNT_STATUS.APPROVED;       // APPROVED, not ACTIVE - waiting for password
  record.approvedAt = new Date().toISOString();
  record.approvedBy = Session.getActiveUser().getEmail();
  record.rewardfulAffiliateId = affiliateId;            // Linked affiliate ID
  record.affiliateId = affiliateId;                     // Alias for clarity
  // Password remains null - user will set it when they return to "Request Access"
  
  // STEP 3: Handle alias email change
  if (aliasEmailChanged) {
    // Save the updated record under the NEW alias email
    saveAuthRecord_(normalizedNewAlias, record);
    
    // Create a redirect pointer at the OLD email so user can still find their request
    // This allows user to check status with their original email
    var redirectRecord = {
      redirectTo: normalizedNewAlias,
      originalAliasEmail: normalizedOriginalAlias,
      aliasEmailChangedTo: normalizedNewAlias,
      accountStatus: ACCOUNT_STATUS.APPROVED,
      approvedAt: record.approvedAt
    };
    saveAuthRecord_(normalizedOriginalAlias, redirectRecord);
    
    Logger.log('Alias email changed: ' + normalizedOriginalAlias + ' -> ' + normalizedNewAlias + ' (redirect created)');
  } else {
    // No change - just save under the same alias
    saveAuthRecord_(normalizedNewAlias, record);
  }
  
  Logger.log('Account APPROVED (awaiting password): ' + normalizedNewAlias + ' -> ' + normalizedRewardful + ' (affiliate ID: ' + affiliateId + ')');
  
  // Build appropriate message based on action taken
  var successMessage;
  var actionDescription;
  
  if (actionTaken === 'linked') {
    // MIGRATION: Existing affiliate
    var affiliateName = existingAffiliate ? (existingAffiliate.first_name + ' ' + existingAffiliate.last_name).trim() : 'Unknown';
    successMessage = '🔗 MIGRATION COMPLETE: Linked existing affiliate "' + affiliateName + '" to alias email "' + normalizedNewAlias + '".';
    actionDescription = 'This was a MIGRATION — the internal email already existed in the affiliate system. We linked it to the new alias email for login.';
  } else {
    // NEW USER: Created new affiliate
    successMessage = '✨ NEW AFFILIATE CREATED: "' + firstName + ' ' + lastName + '" with internal email "' + normalizedRewardful + '".';
    actionDescription = 'This was a NEW USER — the internal email did NOT exist in the affiliate system. A new affiliate record was created.';
  }
  
  return { 
    success: true, 
    message: successMessage,
    actionDescription: actionDescription,
    aliasEmail: normalizedNewAlias,
    originalAliasEmail: normalizedOriginalAlias,
    internalEmail: normalizedRewardful,
    actionTaken: actionTaken,  // 'linked' or 'created'
    actionLabel: actionTaken === 'linked' ? 'MIGRATION (Linked Existing)' : 'NEW USER (Created New)',
    affiliateId: affiliateId,
    affiliateName: actionTaken === 'linked' && existingAffiliate ? (existingAffiliate.first_name + ' ' + existingAffiliate.last_name).trim() : (firstName + ' ' + lastName),
    aliasEmailChanged: aliasEmailChanged,
    statusNote: 'User must check their status and set a password to complete setup.'
  };
}

/**
 * ADMIN: Pre-check an internal email before approval
 * This tells the admin whether this will be a MIGRATION or NEW USER creation
 * 
 * @param {string} internalEmail - The internal/commission email to check
 * @returns {object} - Info about whether affiliate exists
 */
function adminPreCheckInternalEmail(internalEmail, sessionToken) {
  if (!isAdminAny_(sessionToken)) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  if (!internalEmail || !internalEmail.trim()) {
    return { 
      success: false, 
      error: 'Please enter an internal email to check' 
    };
  }
  
  var normalized = normalizeAuthEmail_(internalEmail);
  
  // Check if affiliate exists in the system
  var existingAffiliate = getAffiliateByEmail_(normalized);
  
  if (existingAffiliate) {
    // MIGRATION case - affiliate already exists
    var affiliateName = (existingAffiliate.first_name + ' ' + existingAffiliate.last_name).trim() || 'Unknown';
    var commissionStats = existingAffiliate.commission_stats || {};
    var currencies = commissionStats.currencies || {};
    var cad = currencies.CAD || {};
    var unpaid = ((cad.unpaid || {}).cents || 0) / 100;
    var paid = ((cad.paid || {}).cents || 0) / 100;
    
    return {
      success: true,
      exists: true,
      actionWillBe: 'MIGRATION',
      message: '🔗 EXISTING AFFILIATE FOUND — This will be a MIGRATION',
      description: 'This email already exists in the affiliate system. Approving will LINK this alias email to the existing affiliate. No new affiliate will be created.',
      affiliate: {
        id: existingAffiliate.id,
        name: affiliateName,
        firstName: existingAffiliate.first_name || '',
        lastName: existingAffiliate.last_name || '',
        email: existingAffiliate.email,
        state: existingAffiliate.state,
        unpaidCommission: unpaid,
        totalPaid: paid
      }
    };
  } else {
    // NEW USER case - affiliate doesn't exist
    return {
      success: true,
      exists: false,
      actionWillBe: 'NEW_USER',
      message: '✨ NO AFFILIATE FOUND — This will be a NEW USER creation',
      description: 'This email does NOT exist in the affiliate system. Approving will CREATE a new affiliate with this internal email and the provided name/campaign.',
      affiliate: null
    };
  }
}

/**
 * ADMIN: Reject an account request
 */
function adminRejectAccount(email, reason, sessionToken) {
  if (!isAdminAny_(sessionToken)) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  var normalizedEmail = normalizeAuthEmail_(email);
  if (!normalizedEmail) {
    return { success: false, error: 'Email is required' };
  }
  
  var record = getAuthRecord_(normalizedEmail);
  if (!record) {
    return { success: false, error: 'No account found for this email' };
  }
  
  if (record.accountStatus !== ACCOUNT_STATUS.PENDING) {
    return { success: false, error: 'This account is not pending approval' };
  }
  
  // Reject the account
  record.accountStatus = ACCOUNT_STATUS.REJECTED;
  record.rejectedAt = new Date().toISOString();
  record.rejectedBy = Session.getActiveUser().getEmail();
  record.rejectionReason = reason || '';
  
  saveAuthRecord_(normalizedEmail, record);
  
  Logger.log('Account REJECTED: ' + normalizedEmail + ' by ' + record.rejectedBy);
  
  return { 
    success: true, 
    message: 'Account request rejected.',
    email: normalizedEmail
  };
}

/**
 * ADMIN: Delete a pending/rejected account request
 */
function adminDeleteAccountRequest(email) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  var normalizedEmail = normalizeAuthEmail_(email);
  if (!normalizedEmail) {
    return { success: false, error: 'Email is required' };
  }
  
  var key = getAuthKey_(normalizedEmail);
  PropertiesService.getScriptProperties().deleteProperty(key);
  
  Logger.log('Account request DELETED: ' + normalizedEmail);
  
  return { 
    success: true, 
    message: 'Account request deleted.',
    email: normalizedEmail
  };
}

/**
 * Check if affiliate exists (can set password)
 */
function affiliateExists_(email) {
  var normalizedEmail = normalizeAuthEmail_(email);
  if (!normalizedEmail) return false;
  
  // Check if we can find this affiliate in the provider system
  var apiKey = getApiKey_();
  if (!apiKey) return false;
  
  var searchUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(normalizedEmail);
  
  try {
    var response = fetchWithRetry_(searchUrl, apiKey);
    if (!response) return false;
    
    var payload = safeParseJson_(response.getContentText());
    var affiliates = extractCommissions_(payload);
    
    if (!affiliates || affiliates.length === 0) return false;
    
    // Check if email matches
    for (var i = 0; i < affiliates.length; i++) {
      if (normalizeAuthEmail_(affiliates[i].email) === normalizedEmail) {
        return true;
      }
    }
    return false;
  } catch (e) {
    Logger.log('Error checking affiliate existence: ' + e.message);
    return false;
  }
}

/**
 * Validate password meets requirements
 */
function validatePasswordStrength_(password) {
  if (!password || password.length < AUTH_MIN_PASSWORD_LENGTH) {
    return { valid: false, error: 'Password must be at least ' + AUTH_MIN_PASSWORD_LENGTH + ' characters' };
  }
  
  // Check for at least one letter
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one letter' };
  }
  
  // Check for at least one number
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  
  return { valid: true };
}

/**
 * Check if login is allowed (rate limiting)
 */
function checkLoginAllowed_(email) {
  var record = getAuthRecord_(email);
  if (!record) return { allowed: true };
  
  var failedCount = record.failedLoginCount || 0;
  var lockUntil = record.lockUntilTimestamp || 0;
  
  // Check if currently locked out
  if (lockUntil > Date.now()) {
    var remainingMinutes = Math.ceil((lockUntil - Date.now()) / (1000 * 60));
    return { 
      allowed: false, 
      error: 'Too many failed attempts. Try again in ' + remainingMinutes + ' minute(s).' 
    };
  }
  
  // If lock expired, reset failed count
  if (lockUntil > 0 && lockUntil <= Date.now()) {
    record.failedLoginCount = 0;
    record.lockUntilTimestamp = 0;
    saveAuthRecord_(email, record);
  }
  
  return { allowed: true };
}

/**
 * Record a failed login attempt
 */
function recordFailedLogin_(email) {
  var record = getAuthRecord_(email);
  if (!record) return;
  
  record.failedLoginCount = (record.failedLoginCount || 0) + 1;
  
  // Lock out after too many failures
  if (record.failedLoginCount >= AUTH_MAX_FAILED_ATTEMPTS) {
    record.lockUntilTimestamp = Date.now() + (AUTH_LOCKOUT_MINUTES * 60 * 1000);
    Logger.log('Account locked for ' + email + ' due to failed attempts');
  }
  
  saveAuthRecord_(email, record);
}

/**
 * Record a successful login
 */
function recordSuccessfulLogin_(email) {
  var record = getAuthRecord_(email);
  if (!record) return;
  
  record.failedLoginCount = 0;
  record.lockUntilTimestamp = 0;
  record.lastLoginAt = new Date().toISOString();
  
  saveAuthRecord_(email, record);
}

/**
 * PUBLIC: Set password for an affiliate
 * Called from the password setup page
 */
function setAffiliatePassword(email, password, confirmPassword) {
  var normalizedEmail = normalizeAuthEmail_(email);
  
  // Validate inputs
  if (!normalizedEmail) {
    return { success: false, error: 'Email is required' };
  }
  
  if (!password) {
    return { success: false, error: 'Password is required' };
  }
  
  if (password !== confirmPassword) {
    return { success: false, error: 'Passwords do not match' };
  }
  
  // Validate password strength
  var strengthCheck = validatePasswordStrength_(password);
  if (!strengthCheck.valid) {
    return { success: false, error: strengthCheck.error };
  }
  
  // Check if admin (admins can set password without being in Rewardful)
  var isAdmin = isAdminEmail_(normalizedEmail);
  
  // Verify user is either an admin OR exists as affiliate
  if (!isAdmin && !affiliateExists_(normalizedEmail)) {
    return { success: false, error: 'Email not recognized. Please use your registered affiliate email.' };
  }
  
  Logger.log('Password setup for: ' + normalizedEmail + ' (isAdmin: ' + isAdmin + ')');
  
  // Generate salt and hash
  var salt = generateSalt_();
  var hash = hashPassword_(password, salt);
  
  // Save auth record
  var record = getAuthRecord_(normalizedEmail) || {};
  record.email = normalizedEmail;
  record.passwordSalt = salt;
  record.passwordHash = hash;
  record.passwordSetAt = new Date().toISOString();
  record.failedLoginCount = 0;
  record.lockUntilTimestamp = 0;
  
  // Admins and affiliates are immediately ACTIVE (no approval needed)
  // Only requestAccountAccess creates PENDING accounts
  if (isAdmin) {
    record.accountStatus = ACCOUNT_STATUS.ACTIVE;
    record.isAdmin = true;
    Logger.log('Admin account activated: ' + normalizedEmail);
  } else {
    // Regular affiliate - also ACTIVE (they're already approved in Rewardful)
    record.accountStatus = ACCOUNT_STATUS.ACTIVE;
  }
  
  saveAuthRecord_(normalizedEmail, record);
  
  Logger.log('Password set successfully for: ' + normalizedEmail + ' (isAdmin: ' + isAdmin + ')');
  
  return { 
    success: true, 
    message: 'Password set successfully. You can now log in.' 
  };
}

/**
 * PUBLIC: Verify password for login
 * Called from all portal login screens
 */
function verifyAffiliatePassword(aliasEmail, password) {
  // Login uses ALIAS EMAIL (what user enters)
  // The rewardful_email is only used internally for Rewardful operations
  var normalizedAlias = normalizeAuthEmail_(aliasEmail);
  
  // Validate inputs
  if (!normalizedAlias) {
    return { success: false, error: 'Email is required' };
  }
  
  // BLOCK LEGACY/INTERNAL EMAIL LOGINS
  // Users must use their alias email, not the internal email
  var legacyCheck = checkLegacyEmailLogin(normalizedAlias);
  if (legacyCheck.isLegacy) {
    Logger.log('Blocked internal email login attempt: ' + normalizedAlias);
    return { 
      success: false, 
      error: legacyCheck.error,
      isLegacyEmail: true,
      aliasEmail: legacyCheck.aliasEmail
    };
  }
  
  if (!password) {
    return { success: false, error: 'Password is required' };
  }
  
  // Check rate limiting
  var loginCheck = checkLoginAllowed_(normalizedAlias);
  if (!loginCheck.allowed) {
    return { success: false, error: loginCheck.error };
  }
  
  // Get auth record by alias email
  var record = getAuthRecord_(normalizedAlias);
  
  if (!record || !record.passwordHash || !record.passwordSalt) {
    // No password set - check if this is a known user
    var isAdmin = isAdminEmail_(normalizedAlias);
    
    // Check account status
    var status = record ? record.accountStatus : null;
    
    if (isAdmin) {
      return { 
        success: false, 
        noPasswordSet: true,
        error: 'No password set for this account. Please click "New here?" to set your password.'  // Don't reveal admin
      };
    } else if (status === ACCOUNT_STATUS.ACTIVE) {
      // Approved but no password yet
      return { 
        success: false, 
        noPasswordSet: true,
        error: 'Your account is approved but no password is set. Please click "New here?" to set your password.' 
      };
    } else if (status === ACCOUNT_STATUS.PENDING) {
      return { 
        success: false, 
        isPending: true,
        error: 'Your account is pending approval. Please check back later.' 
      };
    } else {
      return { 
        success: false, 
        needsAccessRequest: true,
        error: 'Account not found. Please click "New here?" to request access.' 
      };
    }
  }
  
  // Check account status BEFORE verifying password
  // (Don't leak valid password by checking after)
  var statusCheck = canUserLogin_(normalizedAlias);
  if (!statusCheck.allowed) {
    if (statusCheck.reason === 'pending') {
      return { 
        success: false, 
        isPending: true,
        error: statusCheck.error 
      };
    }
    if (statusCheck.reason === 'rejected') {
      return { 
        success: false, 
        isRejected: true,
        error: statusCheck.error 
      };
    }
    return { success: false, error: statusCheck.error };
  }
  
  // Verify password
  var inputHash = hashPassword_(password, record.passwordSalt);
  
  if (inputHash !== record.passwordHash) {
    recordFailedLogin_(normalizedAlias);
    return { success: false, error: 'Invalid password' };
  }
  
  // Success!
  recordSuccessfulLogin_(normalizedAlias);
  
  return { 
    success: true, 
    email: normalizedAlias,
    message: 'Login successful' 
  };
}

/**
 * PUBLIC: Check if a user has a password set
 */
function hasPasswordSet(email) {
  var normalizedEmail = normalizeAuthEmail_(email);
  if (!normalizedEmail) return { hasPassword: false };
  
  var record = getAuthRecord_(normalizedEmail);
  return { 
    hasPassword: !!(record && record.passwordHash && record.passwordSalt),
    email: normalizedEmail
  };
}

/**
 * PUBLIC: Check if affiliate exists (for frontend validation)
 */
function checkAffiliateExists(email) {
  var normalizedEmail = normalizeAuthEmail_(email);
  if (!normalizedEmail) return { exists: false };
  
  // Check if admin FIRST - admins bypass Rewardful entirely
  var isAdmin = isAdminEmail_(normalizedEmail);
  
  if (isAdmin) {
    // Admins are always valid, don't even check Rewardful
    Logger.log('checkAffiliateExists: ' + normalizedEmail + ' is ADMIN - bypassing Rewardful');
    return { 
      exists: true,
      email: normalizedEmail,
      isAdmin: true
    };
  }
  
  // Non-admin: check Rewardful
  var existsInRewardful = affiliateExists_(normalizedEmail);
  
  return { 
    exists: existsInRewardful,
    email: normalizedEmail,
    isAdmin: false
  };
}

/**
 * ADMIN: Reset password for an affiliate (removes password, forces reset)
 */
function adminResetPassword(email) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  var normalizedEmail = normalizeAuthEmail_(email);
  if (!normalizedEmail) {
    return { success: false, error: 'Email is required' };
  }
  
  var record = getAuthRecord_(normalizedEmail);
  if (!record) {
    return { success: false, error: 'No auth record found for this email' };
  }
  
  // Clear password but keep other data
  record.passwordHash = null;
  record.passwordSalt = null;
  record.passwordSetAt = null;
  record.failedLoginCount = 0;
  record.lockUntilTimestamp = 0;
  record.passwordResetAt = new Date().toISOString();
  record.resetBy = Session.getActiveUser().getEmail();
  
  saveAuthRecord_(normalizedEmail, record);
  
  Logger.log('Admin reset password for: ' + normalizedEmail);
  
  return { 
    success: true, 
    message: 'Password reset. User will need to set a new password.' 
  };
}

/**
 * ADMIN: Unlock an account
 */
function adminUnlockAccount(email) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  var normalizedEmail = normalizeAuthEmail_(email);
  if (!normalizedEmail) {
    return { success: false, error: 'Email is required' };
  }
  
  var record = getAuthRecord_(normalizedEmail);
  if (!record) {
    return { success: false, error: 'No auth record found for this email' };
  }
  
  record.failedLoginCount = 0;
  record.lockUntilTimestamp = 0;
  
  saveAuthRecord_(normalizedEmail, record);
  
  Logger.log('Admin unlocked account for: ' + normalizedEmail);
  
  return { 
    success: true, 
    message: 'Account unlocked successfully.' 
  };
}

/**
 * ADMIN: View auth status for an email
 */
function adminGetAuthStatus(email) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  var normalizedEmail = normalizeAuthEmail_(email);
  if (!normalizedEmail) {
    return { success: false, error: 'Email is required' };
  }
  
  var record = getAuthRecord_(normalizedEmail);
  var isAdmin = isAdminEmail_(normalizedEmail);
  
  return {
    success: true,
    email: normalizedEmail,
    isAdmin: isAdmin,
    existsInRewardful: affiliateExists_(normalizedEmail),
    canLogin: isAdmin || affiliateExists_(normalizedEmail),
    hasPassword: !!(record && record.passwordHash),
    accountStatus: record ? record.accountStatus : null,
    passwordSetAt: record ? record.passwordSetAt : null,
    lastLoginAt: record ? record.lastLoginAt : null,
    failedAttempts: record ? (record.failedLoginCount || 0) : 0,
    isLocked: record && record.lockUntilTimestamp > Date.now(),
    lockExpiresAt: record ? record.lockUntilTimestamp : null
  };
}

/**
 * DEBUG: Test admin email check (run from Apps Script editor)
 */
function testAdminEmails() {
  var testEmails = ['admin@gmail.com', 'tafreed57@gmail.com', 'ps9721@gmail.com', 'random@example.com'];
  
  Logger.log('=== ADMIN EMAIL TEST ===');
  Logger.log('ADMIN_EMAILS list: ' + JSON.stringify(ADMIN_EMAILS));
  Logger.log('');
  
  for (var i = 0; i < testEmails.length; i++) {
    var email = testEmails[i];
    var isAdmin = isAdminEmail_(email);
    var checkResult = checkAffiliateExists(email);
    Logger.log(email + ':');
    Logger.log('  isAdminEmail_(): ' + isAdmin);
    Logger.log('  checkAffiliateExists(): ' + JSON.stringify(checkResult));
    Logger.log('');
  }
  
  return 'Check Apps Script logs for results';
}

// ============================================================================
// SESSION MANAGEMENT SYSTEM
// Single Sign-On across all portals
// ============================================================================

var SESSION_PREFIX = 'SESSION_';
var SESSION_DURATION_HOURS = 12; // Sessions last 12 hours
var SESSION_TOKEN_LENGTH = 64; // 64-character secure token

/**
 * Generate a cryptographically secure session token
 * Uses combination of random characters for 256-bit security
 */
function generateSessionToken_() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var token = '';
  for (var i = 0; i < SESSION_TOKEN_LENGTH; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Add timestamp component for uniqueness
  token += '_' + Date.now().toString(36);
  return token;
}

/**
 * Get session storage key
 */
function getSessionKey_(token) {
  return SESSION_PREFIX + token;
}

/**
 * Store session data in CacheService with PropertiesService fallback
 * CacheService for speed, PropertiesService for persistence
 */
function storeSession_(token, sessionData) {
  var key = getSessionKey_(token);
  var dataStr = JSON.stringify(sessionData);
  
  try {
    // Primary: Use ScriptCache (fast, auto-expires)
    var cache = CacheService.getScriptCache();
    // Cache for slightly longer than session duration to allow for clock skew
    var cacheDurationSeconds = (SESSION_DURATION_HOURS * 60 * 60) + 300;
    cache.put(key, dataStr, cacheDurationSeconds);
  } catch (e) {
    Logger.log('CacheService error, using PropertiesService: ' + e.message);
  }
  
  // Secondary: Also store in PropertiesService for persistence across cache evictions
  try {
    PropertiesService.getScriptProperties().setProperty(key, dataStr);
  } catch (e) {
    Logger.log('PropertiesService error: ' + e.message);
  }
}

/**
 * Retrieve session data - check cache first, then properties
 */
function getSession_(token) {
  if (!token) return null;
  
  var key = getSessionKey_(token);
  var dataStr = null;
  
  // Try cache first (faster)
  try {
    var cache = CacheService.getScriptCache();
    dataStr = cache.get(key);
  } catch (e) {
    Logger.log('CacheService get error: ' + e.message);
  }
  
  // Fallback to properties if not in cache
  if (!dataStr) {
    try {
      dataStr = PropertiesService.getScriptProperties().getProperty(key);
      // If found in properties, restore to cache
      if (dataStr) {
        try {
          var cache = CacheService.getScriptCache();
          cache.put(key, dataStr, (SESSION_DURATION_HOURS * 60 * 60) + 300);
        } catch (e) {}
      }
    } catch (e) {
      Logger.log('PropertiesService get error: ' + e.message);
    }
  }
  
  if (!dataStr) return null;
  
  try {
    return JSON.parse(dataStr);
  } catch (e) {
    return null;
  }
}

/**
 * Delete a session from both cache and properties
 */
function deleteSession_(token) {
  if (!token) return;
  
  var key = getSessionKey_(token);
  
  try {
    var cache = CacheService.getScriptCache();
    cache.remove(key);
  } catch (e) {}
  
  try {
    PropertiesService.getScriptProperties().deleteProperty(key);
  } catch (e) {}
}

/**
 * Validate a session token and return session data if valid
 */
function validateSession_(token) {
  if (!token) return null;
  
  var session = getSession_(token);
  if (!session) return null;
  
  // Check expiration
  var now = Date.now();
  if (session.expiresAt && session.expiresAt < now) {
    // Session expired - clean up
    deleteSession_(token);
    return null;
  }
  
  // Update lastSeenAt
  session.lastSeenAt = new Date().toISOString();
  storeSession_(token, session);
  
  return session;
}

/**
 * PUBLIC: Create a new session after successful login
 * Called after password verification succeeds
 * Returns session token to store on client
 */
function createSession(aliasEmail) {
  var normalizedAlias = normalizeAuthEmail_(aliasEmail);
  if (!normalizedAlias) {
    return { success: false, error: 'Invalid email' };
  }
  
  // Generate secure token
  var token = generateSessionToken_();
  var now = Date.now();
  var expiresAt = now + (SESSION_DURATION_HOURS * 60 * 60 * 1000);
  
  // Get user info for session (including rewardful email mapping)
  var userInfo = getUserInfoForSession_(normalizedAlias);
  
  // Get the auth record to retrieve rewardfulEmail mapping
  var record = getAuthRecord_(normalizedAlias);
  var rewardfulEmail = (record && record.rewardfulEmail) ? record.rewardfulEmail : normalizedAlias;
  
  // Create session data with DUAL EMAIL SYSTEM
  var sessionData = {
    token: token,
    email: normalizedAlias,            // Alias email (what user sees/entered)
    aliasEmail: normalizedAlias,       // Explicit alias email
    rewardfulEmail: rewardfulEmail,    // Internal Rewardful email (may contain %)
    // Legacy fields for backwards compatibility
    canonicalEmail: normalizedAlias,
    displayEmail: normalizedAlias,     // Always show alias to user
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt,
    lastSeenAt: new Date().toISOString(),
    isTeacher: userInfo.isTeacher,
    isAdmin: userInfo.isAdmin,
    userName: userInfo.name
  };
  
  // Store session
  storeSession_(token, sessionData);
  
  Logger.log('Session created for alias: ' + normalizedAlias + ' -> rewardful: ' + rewardfulEmail);
  
  return {
    success: true,
    token: token,
    expiresAt: expiresAt,
    user: {
      email: normalizedAlias,           // Show alias email to user
      displayEmail: normalizedAlias,    // Show alias email to user
      rewardfulEmail: rewardfulEmail,   // Internal use only - DO NOT SHOW TO USER
      name: userInfo.name,
      isTeacher: userInfo.isTeacher,
      isAdmin: userInfo.isAdmin
    }
  };
}

/**
 * Get user info for session (roles, name)
 * IMPORTANT: If email is an alias, resolves to internal email first to get affiliate data
 */
function getUserInfoForSession_(email) {
  var emailLower = email.toLowerCase().trim();
  var isAdmin = false;
  var isTeacher = false;
  var name = email;
  
  // Check admin status
  for (var i = 0; i < ADMIN_EMAILS.length; i++) {
    if (ADMIN_EMAILS[i].toLowerCase() === emailLower) {
      isAdmin = true;
      break;
    }
  }
  
  // Get affiliate info for name and teacher status
  try {
    var apiKey = getApiKey_();
    if (apiKey) {
      // IMPORTANT: First check if this is an alias email and resolve to internal email
      var emailToLookup = emailLower;
      var authRecord = getAuthRecord_(emailLower);
      
      if (authRecord && authRecord.internalEmail) {
        // This is an alias email - use the internal email to look up affiliate
        emailToLookup = authRecord.internalEmail;
        Logger.log('Resolved alias ' + emailLower + ' to internal email: ' + emailToLookup);
      }
      
      var affUrl = BASE_URL + '/affiliates?email=' + encodeURIComponent(emailToLookup.trim());
      var affResp = fetchWithRetry_(affUrl, apiKey);
      
      if (affResp && affResp.getResponseCode() === 200) {
        var payload = safeParseJson_(affResp.getContentText());
        var aff = extractAffiliate_(payload);
        
        if (aff) {
          var firstName = aff.first_name || '';
          var lastName = aff.last_name || '';
          name = (firstName + ' ' + lastName).trim() || email;
          
          // Check if teacher using new helper that includes override list
          // Pass the original login email (emailLower) for override check
          isTeacher = hasTeacherAccess_(firstName, emailLower);
          Logger.log('Affiliate found: ' + name + ', isTeacher: ' + isTeacher + ' (firstName: ' + firstName + ', email: ' + emailLower + ')');
        }
      } else {
        Logger.log('No affiliate found for email: ' + emailToLookup);
        // Even if no affiliate found, check override list
        isTeacher = isTeacherOverrideEmail_(emailLower);
        if (isTeacher) {
          Logger.log('Teacher access granted via override (no affiliate): ' + emailLower);
        }
      }
    }
  } catch (e) {
    Logger.log('Error getting user info: ' + e.message);
  }
  
  // Check teacher override list even if affiliate lookup failed
  if (!isTeacher && isTeacherOverrideEmail_(emailLower)) {
    isTeacher = true;
    Logger.log('Teacher access granted via override: ' + emailLower);
  }
  
  // Admins are treated as teachers for portal access
  if (isAdmin) {
    isTeacher = true;
  }
  
  return {
    name: name,
    isTeacher: isTeacher,
    isAdmin: isAdmin
  };
}

/**
 * PUBLIC: Validate session and get current user
 * Called by frontend to check if logged in
 */
function validateSessionToken(token) {
  var session = validateSession_(token);
  
  if (!session) {
    return { valid: false };
  }
  
  return {
    valid: true,
    user: {
      email: session.email,
      displayEmail: session.displayEmail || session.email,
      canonicalEmail: session.canonicalEmail || session.email,
      name: session.userName || session.email,
      isTeacher: session.isTeacher || false,
      isAdmin: session.isAdmin || false
    },
    expiresAt: session.expiresAt
  };
}

/**
 * PUBLIC: Get current user from session token
 * Convenience function for portals
 */
function getCurrentUser(token) {
  var result = validateSessionToken(token);
  if (!result.valid) {
    return null;
  }
  return result.user;
}

/**
 * PUBLIC: Logout - invalidate session
 */
function logoutSession(token) {
  if (!token) {
    return { success: false, error: 'No token provided' };
  }
  
  var session = getSession_(token);
  if (session) {
    Logger.log('Session logged out for: ' + session.email);
  }
  
  deleteSession_(token);
  
  return { success: true, message: 'Logged out successfully' };
}

/**
 * PUBLIC: Full login flow - verify password and create session
 * Single function for the login page
 */
function loginAndCreateSession(email, password) {
  // First verify the password
  var verifyResult = verifyAffiliatePassword(email, password);
  
  if (!verifyResult.success) {
    return verifyResult; // Return the error from password verification
  }
  
  // Password verified - create session
  var sessionResult = createSession(email);
  
  if (!sessionResult.success) {
    return { success: false, error: 'Failed to create session' };
  }
  
  return {
    success: true,
    token: sessionResult.token,
    expiresAt: sessionResult.expiresAt,
    user: sessionResult.user,
    message: 'Login successful'
  };
}

/**
 * PUBLIC: Check if user has access to a specific portal
 */
function checkPortalAccess(token, portal) {
  var session = validateSession_(token);
  
  if (!session) {
    return { hasAccess: false, reason: 'not_logged_in' };
  }
  
  // All logged-in users can access commission and student portals
  if (portal === 'commission' || portal === 'attendance' || portal === 'student') {
    return { hasAccess: true, user: session };
  }
  
  // Teacher portal requires teacher role
  if (portal === 'teacher') {
    if (session.isTeacher || session.isAdmin) {
      return { hasAccess: true, user: session };
    } else {
      return { hasAccess: false, reason: 'not_teacher', user: session };
    }
  }
  
  // Home is always accessible when logged in
  if (portal === 'home') {
    return { hasAccess: true, user: session };
  }
  
  return { hasAccess: false, reason: 'unknown_portal' };
}

/**
 * ADMIN: List all active sessions (for debugging)
 */
function adminListActiveSessions() {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized' };
  }
  
  var properties = PropertiesService.getScriptProperties().getProperties();
  var sessions = [];
  var now = Date.now();
  
  for (var key in properties) {
    if (key.indexOf(SESSION_PREFIX) === 0) {
      try {
        var session = JSON.parse(properties[key]);
        var isExpired = session.expiresAt < now;
        sessions.push({
          email: session.email,
          createdAt: session.createdAt,
          expiresAt: new Date(session.expiresAt).toISOString(),
          lastSeenAt: session.lastSeenAt,
          isExpired: isExpired,
          isTeacher: session.isTeacher,
          isAdmin: session.isAdmin
        });
      } catch (e) {}
    }
  }
  
  return { success: true, sessions: sessions };
}

/**
 * ADMIN: Clear all sessions (force everyone to re-login)
 */
function adminClearAllSessions() {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized' };
  }
  
  var properties = PropertiesService.getScriptProperties().getProperties();
  var count = 0;
  
  for (var key in properties) {
    if (key.indexOf(SESSION_PREFIX) === 0) {
      PropertiesService.getScriptProperties().deleteProperty(key);
      count++;
    }
  }
  
  Logger.log('Admin cleared ' + count + ' sessions');
  
  return { success: true, message: 'Cleared ' + count + ' sessions' };
}

// ============================================================================
// CANONICAL TEACHER-STUDENT LINKING SYSTEM
// ============================================================================
// 
// DESIGN PRINCIPLES:
// 1. SINGLE SOURCE OF TRUTH: Teacher's student list is canonical
// 2. SOFT DELETES: status = 'ACTIVE' | 'REMOVED' (never hard delete)
// 3. IDEMPOTENT: Repeated add/remove operations are safe
// 4. CANONICAL IDs: Use affiliateId where possible, email as fallback
// 5. Student's "equipped teacher" is DERIVED from links, not stored separately
//
// DATA MODEL (per teacher):
// TEACHER_LINKS_{canonicalTeacherId}: {
//   students: [{
//     studentId: string (affiliateId or normalized email),
//     email: string (alias email for display),
//     internalEmail: string (for Rewardful lookups),
//     affiliateId: string|null,
//     status: 'ACTIVE' | 'REMOVED',
//     createdAt: ISO string,
//     updatedAt: ISO string,
//     createdBy: 'student' | 'teacher' | 'admin',
//     removedAt: ISO string | null,
//     removedBy: 'student' | 'teacher' | 'admin' | null
//   }]
// }
// ============================================================================

var LINK_STATUS = {
  ACTIVE: 'ACTIVE',
  REMOVED: 'REMOVED'
};

/**
 * Get canonical ID for a teacher (affiliateId preferred, email as fallback)
 */
function getCanonicalTeacherId_(teacherEmail) {
  var emailLower = (teacherEmail || '').toLowerCase().trim();
  
  // Try to get affiliate ID
  var internalEmail = getRewardfulEmailForLookup_(emailLower);
  var aliasEmail = findAliasForInternalEmail_(emailLower) || emailLower;
  
  // Use a consistent key based on normalized alias email
  // This ensures the same teacher always maps to the same key
  return 'TEACHER_LINKS_' + aliasEmail.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Get canonical student ID (affiliateId preferred, normalized email as fallback)
 */
function getCanonicalStudentId_(studentEmail) {
  var emailLower = (studentEmail || '').toLowerCase().trim();
  var aliasEmail = findAliasForInternalEmail_(emailLower) || emailLower;
  // Use alias email as canonical ID for consistency
  return aliasEmail;
}

/**
 * CANONICAL: Link a student to a teacher
 * Idempotent - safe to call multiple times
 * 
 * @param {string} teacherEmail - Teacher's email (alias or internal)
 * @param {string} studentEmail - Student's email (alias or internal)
 * @param {string} actor - Who initiated: 'student' | 'teacher' | 'admin'
 * @returns {Object} {success, status: 'CREATED'|'REACTIVATED'|'ALREADY_ACTIVE', ...}
 */
function linkStudentToTeacher(teacherEmail, studentEmail, actor) {
  try {
    Logger.log('=== LINK STUDENT TO TEACHER ===');
    Logger.log('Teacher: ' + teacherEmail + ', Student: ' + studentEmail + ', Actor: ' + actor);
    
    if (!teacherEmail || !studentEmail) {
      return { success: false, error: 'Teacher and student emails are required' };
    }
    
    var teacherEmailLower = teacherEmail.toLowerCase().trim();
    var studentEmailLower = studentEmail.toLowerCase().trim();
    
    // Resolve canonical IDs and emails
    var teacherKey = getCanonicalTeacherId_(teacherEmailLower);
    var studentId = getCanonicalStudentId_(studentEmailLower);
    
    // Get student details for storage
    var studentAliasEmail = findAliasForInternalEmail_(studentEmailLower) || studentEmailLower;
    var studentInternalEmail = getRewardfulEmailForLookup_(studentEmailLower);
    var studentAffiliateId = null;
    var studentName = studentAliasEmail;
    
    // Try to get affiliate info
    try {
      var apiKey = getApiKey_();
      var affiliate = findAffiliateByEmail_(studentInternalEmail, apiKey);
      if (affiliate) {
        studentAffiliateId = affiliate.id;
        studentName = (affiliate.first_name || '') + ' ' + (affiliate.last_name || '');
      }
    } catch (e) {
      Logger.log('Could not fetch affiliate info: ' + e.message);
    }
    
    // Load existing links for this teacher
    var linksDataStr = PropertiesService.getScriptProperties().getProperty(teacherKey);
    var linksData = linksDataStr ? JSON.parse(linksDataStr) : { students: [] };
    
    // Find existing link for this student
    var existingIndex = -1;
    for (var i = 0; i < linksData.students.length; i++) {
      var s = linksData.students[i];
      if (s.studentId === studentId || 
          (s.email || '').toLowerCase() === studentAliasEmail.toLowerCase() ||
          (s.internalEmail || '').toLowerCase() === studentInternalEmail.toLowerCase()) {
        existingIndex = i;
        break;
      }
    }
    
    var now = new Date().toISOString();
    var resultStatus;
    
    if (existingIndex >= 0) {
      // Link exists - check status
      var existing = linksData.students[existingIndex];
      
      if (existing.status === LINK_STATUS.ACTIVE) {
        Logger.log('Link already active - no change needed');
        resultStatus = 'ALREADY_ACTIVE';
      } else {
        // REACTIVATE removed link
        Logger.log('Reactivating removed link');
        existing.status = LINK_STATUS.ACTIVE;
        existing.updatedAt = now;
        existing.removedAt = null;
        existing.removedBy = null;
        // Update other fields in case they changed
        existing.email = studentAliasEmail;
        existing.internalEmail = studentInternalEmail;
        existing.affiliateId = studentAffiliateId || existing.affiliateId;
        existing.name = studentName;
        resultStatus = 'REACTIVATED';
      }
    } else {
      // Create new link
      Logger.log('Creating new link');
      linksData.students.push({
        studentId: studentId,
        email: studentAliasEmail,
        internalEmail: studentInternalEmail,
        affiliateId: studentAffiliateId,
        name: studentName,
        status: LINK_STATUS.ACTIVE,
        createdAt: now,
        updatedAt: now,
        createdBy: actor || 'student',
        removedAt: null,
        removedBy: null
      });
      resultStatus = 'CREATED';
    }
    
    // Save updated links
    PropertiesService.getScriptProperties().setProperty(teacherKey, JSON.stringify(linksData));
    
    // Clear any caches
    clearTeacherCache_(teacherEmailLower);
    
    // ALSO update the legacy teacher key for backward compatibility
    // This ensures old code still works during migration
    syncToLegacyTeacherData_(teacherEmailLower, linksData);
    
    Logger.log('Link operation complete: ' + resultStatus);
    return { 
      success: true, 
      status: resultStatus,
      studentId: studentId,
      teacherKey: teacherKey
    };
    
  } catch (e) {
    Logger.log('Error in linkStudentToTeacher: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * CANONICAL: Unlink a student from a teacher (SOFT DELETE)
 * Idempotent - safe to call multiple times
 * 
 * @param {string} teacherEmail - Teacher's email
 * @param {string} studentEmail - Student's email
 * @param {string} actor - Who initiated: 'student' | 'teacher' | 'admin'
 * @returns {Object} {success, status: 'REMOVED'|'ALREADY_REMOVED'|'NOT_FOUND', ...}
 */
function unlinkStudentFromTeacher(teacherEmail, studentEmail, actor) {
  try {
    Logger.log('=== UNLINK STUDENT FROM TEACHER ===');
    Logger.log('Teacher: ' + teacherEmail + ', Student: ' + studentEmail + ', Actor: ' + actor);
    
    if (!teacherEmail || !studentEmail) {
      return { success: false, error: 'Teacher and student emails are required' };
    }
    
    var teacherEmailLower = teacherEmail.toLowerCase().trim();
    var studentEmailLower = studentEmail.toLowerCase().trim();
    
    // Resolve canonical IDs
    var teacherKey = getCanonicalTeacherId_(teacherEmailLower);
    var studentId = getCanonicalStudentId_(studentEmailLower);
    var studentAliasEmail = findAliasForInternalEmail_(studentEmailLower) || studentEmailLower;
    var studentInternalEmail = getRewardfulEmailForLookup_(studentEmailLower);
    
    // Load existing links
    var linksDataStr = PropertiesService.getScriptProperties().getProperty(teacherKey);
    if (!linksDataStr) {
      Logger.log('No links found for teacher');
      return { success: true, status: 'NOT_FOUND' };
    }
    
    var linksData = JSON.parse(linksDataStr);
    
    // Find the link
    var existingIndex = -1;
    for (var i = 0; i < linksData.students.length; i++) {
      var s = linksData.students[i];
      if (s.studentId === studentId || 
          (s.email || '').toLowerCase() === studentAliasEmail.toLowerCase() ||
          (s.internalEmail || '').toLowerCase() === studentInternalEmail.toLowerCase()) {
        existingIndex = i;
        break;
      }
    }
    
    if (existingIndex < 0) {
      Logger.log('Link not found');
      return { success: true, status: 'NOT_FOUND' };
    }
    
    var existing = linksData.students[existingIndex];
    var now = new Date().toISOString();
    var resultStatus;
    
    if (existing.status === LINK_STATUS.REMOVED) {
      Logger.log('Link already removed');
      resultStatus = 'ALREADY_REMOVED';
    } else {
      // SOFT DELETE - set status to REMOVED
      Logger.log('Soft-deleting link');
      existing.status = LINK_STATUS.REMOVED;
      existing.updatedAt = now;
      existing.removedAt = now;
      existing.removedBy = actor || 'unknown';
      resultStatus = 'REMOVED';
    }
    
    // Save updated links
    PropertiesService.getScriptProperties().setProperty(teacherKey, JSON.stringify(linksData));
    
    // Clear caches
    clearTeacherCache_(teacherEmailLower);
    
    // Sync to legacy for backward compatibility
    syncToLegacyTeacherData_(teacherEmailLower, linksData);
    
    Logger.log('Unlink operation complete: ' + resultStatus);
    return { success: true, status: resultStatus };
    
  } catch (e) {
    Logger.log('Error in unlinkStudentFromTeacher: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * CANONICAL: List all ACTIVE students for a teacher
 * 
 * @param {string} teacherEmail - Teacher's email
 * @returns {Object} {success, students: [...]}
 */
function listStudentsForTeacher(teacherEmail) {
  try {
    var teacherEmailLower = (teacherEmail || '').toLowerCase().trim();
    var teacherKey = getCanonicalTeacherId_(teacherEmailLower);
    
    var linksDataStr = PropertiesService.getScriptProperties().getProperty(teacherKey);
    if (!linksDataStr) {
      // Check legacy data and migrate if found
      var legacyData = getTeacherData(teacherEmailLower, true);
      if (legacyData.data && legacyData.data.students && legacyData.data.students.length > 0) {
        Logger.log('Migrating legacy teacher data to canonical format');
        migrateTeacherDataToCanonical_(teacherEmailLower, legacyData.data);
        // Re-fetch after migration
        linksDataStr = PropertiesService.getScriptProperties().getProperty(teacherKey);
      }
    }
    
    if (!linksDataStr) {
      return { success: true, students: [] };
    }
    
    var linksData = JSON.parse(linksDataStr);
    
    // Filter to ACTIVE only
    var activeStudents = linksData.students.filter(function(s) {
      return s.status === LINK_STATUS.ACTIVE;
    });
    
    return { success: true, students: activeStudents };
    
  } catch (e) {
    Logger.log('Error in listStudentsForTeacher: ' + e.message);
    return { success: false, students: [], error: e.message };
  }
}

/**
 * CANONICAL: List all ACTIVE teachers for a student
 * (Scans all teacher links - less efficient but correct)
 * 
 * @param {string} studentEmail - Student's email
 * @returns {Object} {success, teachers: [...]}
 */
function listTeachersForStudent(studentEmail) {
  try {
    var studentEmailLower = (studentEmail || '').toLowerCase().trim();
    var studentId = getCanonicalStudentId_(studentEmailLower);
    var studentAliasEmail = findAliasForInternalEmail_(studentEmailLower) || studentEmailLower;
    var studentInternalEmail = getRewardfulEmailForLookup_(studentEmailLower);
    
    var properties = PropertiesService.getScriptProperties().getProperties();
    var teachers = [];
    
    for (var key in properties) {
      if (key.indexOf('TEACHER_LINKS_') === 0) {
        try {
          var linksData = JSON.parse(properties[key]);
          
          for (var i = 0; i < linksData.students.length; i++) {
            var s = linksData.students[i];
            
            // Check if this is our student and link is ACTIVE
            var isMatch = s.status === LINK_STATUS.ACTIVE && (
              s.studentId === studentId ||
              (s.email || '').toLowerCase() === studentAliasEmail.toLowerCase() ||
              (s.internalEmail || '').toLowerCase() === studentInternalEmail.toLowerCase()
            );
            
            if (isMatch) {
              // Extract teacher email from key
              var teacherEmailPart = key.replace('TEACHER_LINKS_', '').replace('_AT_', '@').replace(/_/g, '.');
              teachers.push({
                email: teacherEmailPart,
                linkedAt: s.createdAt,
                linkedBy: s.createdBy
              });
              break;
            }
          }
        } catch (e) {
          // Skip invalid entries
        }
      }
    }
    
    return { success: true, teachers: teachers };
    
  } catch (e) {
    Logger.log('Error in listTeachersForStudent: ' + e.message);
    return { success: false, teachers: [], error: e.message };
  }
}

/**
 * Get the currently equipped teacher for a student (derived from links)
 * Returns the first (or only) active teacher link
 */
function getEquippedTeacher(studentEmail) {
  var result = listTeachersForStudent(studentEmail);
  if (result.success && result.teachers.length > 0) {
    return { success: true, teacherEmail: result.teachers[0].email };
  }
  return { success: true, teacherEmail: null };
}

/**
 * Sync canonical link data to legacy TEACHER_STUDENTS format
 * This ensures backward compatibility during migration
 */
function syncToLegacyTeacherData_(teacherEmail, linksData) {
  try {
    var teacherEmailLower = (teacherEmail || '').toLowerCase().trim();
    
    // Convert to legacy format (only ACTIVE students)
    var legacyStudents = linksData.students
      .filter(function(s) { return s.status === LINK_STATUS.ACTIVE; })
      .map(function(s) {
        return {
          email: s.email,
          internalEmail: s.internalEmail,
          affiliateId: s.affiliateId,
          addedDate: s.createdAt
        };
      });
    
    var legacyData = { students: legacyStudents };
    
    // Save to all possible legacy keys
    var aliasEmail = findAliasForInternalEmail_(teacherEmailLower) || teacherEmailLower;
    var internalEmail = getRewardfulEmailForLookup_(teacherEmailLower);
    
    var keys = [];
    keys.push(getTeacherStudentsKey_(aliasEmail));
    if (internalEmail !== aliasEmail) {
      keys.push(getTeacherStudentsKey_(internalEmail));
    }
    if (teacherEmailLower !== aliasEmail && teacherEmailLower !== internalEmail) {
      keys.push(getTeacherStudentsKey_(teacherEmailLower));
    }
    
    // Deduplicate
    var uniqueKeys = [];
    keys.forEach(function(k) {
      if (uniqueKeys.indexOf(k) === -1) uniqueKeys.push(k);
    });
    
    var legacyDataStr = JSON.stringify(legacyData);
    uniqueKeys.forEach(function(key) {
      PropertiesService.getScriptProperties().setProperty(key, legacyDataStr);
    });
    
    Logger.log('Synced to ' + uniqueKeys.length + ' legacy keys');
    
  } catch (e) {
    Logger.log('Error syncing to legacy: ' + e.message);
  }
}

/**
 * Migrate legacy teacher data to canonical format
 */
function migrateTeacherDataToCanonical_(teacherEmail, legacyData) {
  try {
    var teacherEmailLower = (teacherEmail || '').toLowerCase().trim();
    var teacherKey = getCanonicalTeacherId_(teacherEmailLower);
    
    var canonicalStudents = (legacyData.students || []).map(function(s) {
      var email = (s.email || '').toLowerCase().trim();
      var internalEmail = s.internalEmail || getRewardfulEmailForLookup_(email);
      var aliasEmail = findAliasForInternalEmail_(email) || email;
      
      return {
        studentId: getCanonicalStudentId_(email),
        email: aliasEmail,
        internalEmail: internalEmail,
        affiliateId: s.affiliateId || null,
        name: s.name || aliasEmail,
        status: LINK_STATUS.ACTIVE,  // Assume all legacy are active
        createdAt: s.addedDate || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'migrated',
        removedAt: null,
        removedBy: null
      };
    });
    
    var linksData = { students: canonicalStudents };
    PropertiesService.getScriptProperties().setProperty(teacherKey, JSON.stringify(linksData));
    
    Logger.log('Migrated ' + canonicalStudents.length + ' students to canonical format for teacher: ' + teacherEmailLower);
    
  } catch (e) {
    Logger.log('Error migrating teacher data: ' + e.message);
  }
}

/**
 * ADMIN: Reconcile all teacher-student links
 * Scans all sources of truth and fixes inconsistencies
 */
function reconcileTeacherStudentLinks() {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  try {
    Logger.log('=== RECONCILIATION STARTING ===');
    
    var properties = PropertiesService.getScriptProperties().getProperties();
    var stats = {
      teachersProcessed: 0,
      studentsProcessed: 0,
      linksCreated: 0,
      linksReactivated: 0,
      contradictionsFound: 0,
      contradictionsFixed: 0
    };
    
    // Step 1: Migrate all legacy TEACHER_STUDENTS_ data to canonical format
    Logger.log('Step 1: Migrating legacy teacher data...');
    var teacherKeys = {};
    
    for (var key in properties) {
      if (key.indexOf('TEACHER_STUDENTS_') === 0) {
        try {
          var legacyData = JSON.parse(properties[key]);
          if (legacyData.students && legacyData.students.length > 0) {
            // Extract teacher email from key
            var teacherEmailPart = key.replace('TEACHER_STUDENTS_', '')
              .replace('_AT_', '@')
              .replace(/_/g, '.');
            
            if (!teacherKeys[teacherEmailPart]) {
              teacherKeys[teacherEmailPart] = legacyData;
              stats.teachersProcessed++;
            }
          }
        } catch (e) {
          Logger.log('Skipping invalid key: ' + key);
        }
      }
    }
    
    // Migrate each teacher
    for (var teacherEmail in teacherKeys) {
      migrateTeacherDataToCanonical_(teacherEmail, teacherKeys[teacherEmail]);
      stats.studentsProcessed += teacherKeys[teacherEmail].students.length;
    }
    
    // Step 2: Scan student attendance records for "equipped teacher" and ensure links exist
    Logger.log('Step 2: Checking student attendance records...');
    
    for (var key in properties) {
      if (key.indexOf('ATTENDANCE_USER_') === 0) {
        try {
          var userData = JSON.parse(properties[key]);
          var studentEmail = userData.email;
          var equippedTeacher = userData.teacherEmail;
          
          if (studentEmail && equippedTeacher && equippedTeacher !== 'none') {
            // Check if link exists and is active
            var linkResult = listTeachersForStudent(studentEmail);
            var hasActiveLink = linkResult.teachers.some(function(t) {
              return t.email.toLowerCase() === equippedTeacher.toLowerCase();
            });
            
            if (!hasActiveLink) {
              Logger.log('CONTRADICTION: Student ' + studentEmail + ' has equipped teacher ' + 
                equippedTeacher + ' but no active link. Fixing...');
              stats.contradictionsFound++;
              
              // Create/reactivate the link
              var fixResult = linkStudentToTeacher(equippedTeacher, studentEmail, 'reconciliation');
              if (fixResult.success) {
                stats.contradictionsFixed++;
                if (fixResult.status === 'CREATED') stats.linksCreated++;
                if (fixResult.status === 'REACTIVATED') stats.linksReactivated++;
              }
            }
          }
        } catch (e) {
          Logger.log('Error processing attendance record: ' + e.message);
        }
      }
    }
    
    Logger.log('=== RECONCILIATION COMPLETE ===');
    Logger.log('Teachers processed: ' + stats.teachersProcessed);
    Logger.log('Students processed: ' + stats.studentsProcessed);
    Logger.log('Contradictions found: ' + stats.contradictionsFound);
    Logger.log('Contradictions fixed: ' + stats.contradictionsFixed);
    
    return { success: true, stats: stats };
    
  } catch (e) {
    Logger.log('Error in reconciliation: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * ADMIN: Force fix a specific student-teacher relationship
 * Use when automatic reconciliation isn't enough
 */
function adminFixStudentTeacherLink(studentEmail, teacherEmail, action) {
  if (!isAdmin_()) {
    return { success: false, error: 'Unauthorized - admin only' };
  }
  
  Logger.log('Admin fix: ' + action + ' link between student ' + studentEmail + ' and teacher ' + teacherEmail);
  
  if (action === 'link' || action === 'add') {
    return linkStudentToTeacher(teacherEmail, studentEmail, 'admin');
  } else if (action === 'unlink' || action === 'remove') {
    return unlinkStudentFromTeacher(teacherEmail, studentEmail, 'admin');
  } else {
    return { success: false, error: 'Invalid action. Use "link" or "unlink".' };
  }
}

/**
 * DEBUG: Check for duplicate auth records for an email
 * Run this to see if there are multiple records for the same email
 */
function debugFindDuplicateAuthRecords(email) {
  var props = PropertiesService.getScriptProperties();
  var allKeys = props.getKeys();
  var emailLower = (email || '').toLowerCase().trim();
  
  var matches = [];
  
  for (var i = 0; i < allKeys.length; i++) {
    var key = allKeys[i];
    if (key.indexOf('AFFILIATE_AUTH_') === 0) {
      try {
        var record = JSON.parse(props.getProperty(key));
        var recordEmail = (record.email || record.aliasEmail || '').toLowerCase();
        
        // Check if this record matches the email we're looking for
        if (recordEmail === emailLower || key.indexOf(emailLower.replace('@', '_AT_')) !== -1) {
          matches.push({
            key: key,
            email: record.email,
            aliasEmail: record.aliasEmail,
            status: record.accountStatus,
            requestedAt: record.requestedAt
          });
        }
      } catch(e) {}
    }
  }
  
  Logger.log('Found ' + matches.length + ' records matching: ' + email);
  matches.forEach(function(m) {
    Logger.log('  Key: ' + m.key);
    Logger.log('  Email: ' + m.email + ', Alias: ' + m.aliasEmail + ', Status: ' + m.status);
  });
  
  return { email: email, matches: matches };
}

/**
 * DEBUG: List ALL pending accounts with their keys (to find duplicates)
 */
function debugListAllPendingWithKeys() {
  var props = PropertiesService.getScriptProperties();
  var allKeys = props.getKeys();
  var pending = [];
  
  for (var i = 0; i < allKeys.length; i++) {
    var key = allKeys[i];
    if (key.indexOf('AFFILIATE_AUTH_') === 0) {
      try {
        var record = JSON.parse(props.getProperty(key));
        if (record && record.accountStatus === 'PENDING') {
          pending.push({
            key: key,
            email: record.email,
            aliasEmail: record.aliasEmail,
            requestedAt: record.requestedAt
          });
        }
      } catch(e) {}
    }
  }
  
  Logger.log('=== ALL PENDING ACCOUNTS ===');
  Logger.log('Count: ' + pending.length);
  pending.forEach(function(p) {
    Logger.log('Key: ' + p.key + ' | Email: ' + p.email + ' | Alias: ' + p.aliasEmail);
  });
  
  return pending;
}

/**
 * DEBUG: Trace email resolution for a teacher
 * Run this to see why a teacher might not find their students
 */
function debugTeacherEmailResolution(teacherEmail) {
  var emailLower = (teacherEmail || '').toLowerCase().trim();
  
  Logger.log('=== DEBUG EMAIL RESOLUTION ===');
  Logger.log('Input email: ' + emailLower);
  
  // Check auth record
  var authRecord = getAuthRecord_(emailLower);
  Logger.log('Auth record: ' + JSON.stringify(authRecord));
  
  // Get internal email
  var internalEmail = getRewardfulEmailForLookup_(emailLower);
  Logger.log('getRewardfulEmailForLookup_: ' + internalEmail);
  
  // Get alias email
  var aliasEmail = findAliasForInternalEmail_(emailLower);
  Logger.log('findAliasForInternalEmail_: ' + aliasEmail);
  
  // Generate canonical keys
  var key1 = 'TEACHER_LINKS_' + emailLower.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
  Logger.log('Canonical key (input): ' + key1);
  
  if (internalEmail && internalEmail !== emailLower) {
    var key2 = 'TEACHER_LINKS_' + internalEmail.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
    Logger.log('Canonical key (internal): ' + key2);
  }
  
  if (aliasEmail && aliasEmail !== emailLower) {
    var key3 = 'TEACHER_LINKS_' + aliasEmail.replace('@', '_AT_').replace(/[^a-zA-Z0-9_]/g, '_');
    Logger.log('Canonical key (alias): ' + key3);
  }
  
  // Try to get data
  var data = getTeacherData(emailLower);
  Logger.log('getTeacherData result: ' + data.students.length + ' students');
  if (data.students.length > 0) {
    data.students.forEach(function(s) {
      Logger.log('  - ' + s.email);
    });
  }
  
  return {
    input: emailLower,
    internalEmail: internalEmail,
    aliasEmail: aliasEmail,
    studentsFound: data.students.length
  };
}