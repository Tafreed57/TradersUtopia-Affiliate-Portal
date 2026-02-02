/**
 * GAS Export Script
 *
 * This script should be copied into the Google Apps Script editor
 * and run to export all PropertiesService data to JSON.
 *
 * INSTRUCTIONS:
 * 1. Open your Google Apps Script project
 * 2. Create a new file called "ExportData.gs"
 * 3. Copy this entire script into that file
 * 4. Run the exportAllData() function
 * 5. Check your Google Drive for the exported JSON file
 * 6. Download the file and place it in portal-next/data/legacy-export.json
 */

// ============================================================================
// MAIN EXPORT FUNCTION
// ============================================================================

function exportAllData() {
  Logger.log('Starting data export...');

  const props = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();

  // Get all properties
  const allProps = props.getProperties();
  const keys = Object.keys(allProps);

  Logger.log('Total properties found: ' + keys.length);

  // Initialize export structure
  const exportData = {
    exportedAt: new Date().toISOString(),
    exportedBy: Session.getActiveUser().getEmail() || 'unknown',
    version: '1.0.0',

    authData: {},
    affiliateAuth: {},
    pendingAccounts: {},
    approvedAccounts: {},
    rejectedAccounts: {},
    attendanceUsers: {},
    attendanceRecords: {},
    teacherLinks: {},
    teacherStudents: {},
    teacherEarnings: {},
    commissionOverrides: {},
    commissionTracking: {},
    referralData: {},
    passwordTokens: {},

    // Raw data for debugging
    _rawKeyCount: keys.length,
    _unknownKeys: [],
  };

  // Process each key
  for (const key of keys) {
    const value = allProps[key];

    try {
      // Parse JSON value if possible
      let parsedValue;
      try {
        parsedValue = JSON.parse(value);
      } catch (e) {
        parsedValue = value;
      }

      // Route to appropriate category
      if (key.startsWith('AUTH_')) {
        const email = key.replace('AUTH_', '');
        exportData.authData[email] = parsedValue;
      } else if (key.startsWith('AFFILIATE_AUTH_')) {
        const email = key.replace('AFFILIATE_AUTH_', '');
        exportData.affiliateAuth[email] = parsedValue;
      } else if (key.startsWith('PENDING_')) {
        const email = key.replace('PENDING_', '');
        exportData.pendingAccounts[email] = parsedValue;
      } else if (key.startsWith('APPROVED_')) {
        const email = key.replace('APPROVED_', '');
        exportData.approvedAccounts[email] = parsedValue;
      } else if (key.startsWith('REJECTED_')) {
        const email = key.replace('REJECTED_', '');
        exportData.rejectedAccounts[email] = parsedValue;
      } else if (key.startsWith('ATTENDANCE_USER_')) {
        const email = key.replace('ATTENDANCE_USER_', '');
        exportData.attendanceUsers[email] = parsedValue;
      } else if (key.startsWith('ATTENDANCE_RECORDS_')) {
        const email = key.replace('ATTENDANCE_RECORDS_', '');
        exportData.attendanceRecords[email] = parsedValue;
      } else if (key.startsWith('TEACHER_LINKS_')) {
        const email = key.replace('TEACHER_LINKS_', '');
        exportData.teacherLinks[email] = parsedValue;
      } else if (key.startsWith('TEACHER_STUDENTS_')) {
        const email = key.replace('TEACHER_STUDENTS_', '');
        exportData.teacherStudents[email] = parsedValue;
      } else if (key.startsWith('TEACHER_EARNINGS_')) {
        const email = key.replace('TEACHER_EARNINGS_', '');
        exportData.teacherEarnings[email] = parsedValue;
      } else if (key.startsWith('OVERRIDE_')) {
        const email = key.replace('OVERRIDE_', '');
        exportData.commissionOverrides[email] = parsedValue;
      } else if (key.startsWith('TRACKING_')) {
        const email = key.replace('TRACKING_', '');
        exportData.commissionTracking[email] = parsedValue;
      } else if (key.startsWith('REFERRAL_DATA_')) {
        const email = key.replace('REFERRAL_DATA_', '');
        exportData.referralData[email] = parsedValue;
      } else if (key.startsWith('PASSWORD_SETUP_TOKEN_')) {
        const token = key.replace('PASSWORD_SETUP_TOKEN_', '');
        exportData.passwordTokens[token] = parsedValue;
      } else {
        // Unknown key pattern
        exportData._unknownKeys.push({
          key: key,
          value: parsedValue,
        });
      }
    } catch (e) {
      Logger.log('Error processing key ' + key + ': ' + e.message);
    }
  }

  // Log summary
  Logger.log('Export summary:');
  Logger.log('- Auth data: ' + Object.keys(exportData.authData).length);
  Logger.log('- Affiliate auth: ' + Object.keys(exportData.affiliateAuth).length);
  Logger.log('- Pending accounts: ' + Object.keys(exportData.pendingAccounts).length);
  Logger.log('- Approved accounts: ' + Object.keys(exportData.approvedAccounts).length);
  Logger.log('- Rejected accounts: ' + Object.keys(exportData.rejectedAccounts).length);
  Logger.log('- Attendance users: ' + Object.keys(exportData.attendanceUsers).length);
  Logger.log('- Attendance records: ' + Object.keys(exportData.attendanceRecords).length);
  Logger.log('- Teacher links: ' + Object.keys(exportData.teacherLinks).length);
  Logger.log('- Teacher students: ' + Object.keys(exportData.teacherStudents).length);
  Logger.log('- Teacher earnings: ' + Object.keys(exportData.teacherEarnings).length);
  Logger.log('- Commission overrides: ' + Object.keys(exportData.commissionOverrides).length);
  Logger.log('- Commission tracking: ' + Object.keys(exportData.commissionTracking).length);
  Logger.log('- Referral data: ' + Object.keys(exportData.referralData).length);
  Logger.log('- Password tokens: ' + Object.keys(exportData.passwordTokens).length);
  Logger.log('- Unknown keys: ' + exportData._unknownKeys.length);

  // Save to Google Drive
  const json = JSON.stringify(exportData, null, 2);
  const filename = 'tradersutopia-export-' + new Date().toISOString().split('T')[0] + '.json';
  const file = DriveApp.createFile(filename, json, MimeType.PLAIN_TEXT);

  Logger.log('Export saved to Google Drive: ' + file.getUrl());
  Logger.log('Filename: ' + filename);

  return {
    success: true,
    fileUrl: file.getUrl(),
    filename: filename,
    summary: {
      authData: Object.keys(exportData.authData).length,
      affiliateAuth: Object.keys(exportData.affiliateAuth).length,
      pendingAccounts: Object.keys(exportData.pendingAccounts).length,
      approvedAccounts: Object.keys(exportData.approvedAccounts).length,
      attendanceUsers: Object.keys(exportData.attendanceUsers).length,
      teacherLinks: Object.keys(exportData.teacherLinks).length,
      unknownKeys: exportData._unknownKeys.length,
    },
  };
}

// ============================================================================
// HELPER: Export specific category
// ============================================================================

function exportCategory(prefix) {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();

  const result = {};

  for (const key of Object.keys(allProps)) {
    if (key.startsWith(prefix)) {
      const email = key.replace(prefix, '');
      try {
        result[email] = JSON.parse(allProps[key]);
      } catch (e) {
        result[email] = allProps[key];
      }
    }
  }

  return result;
}

// ============================================================================
// HELPER: Count keys by prefix
// ============================================================================

function countKeysByPrefix() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  const keys = Object.keys(allProps);

  const counts = {};

  for (const key of keys) {
    const prefix = key.split('_').slice(0, 2).join('_') + '_';
    counts[prefix] = (counts[prefix] || 0) + 1;
  }

  Logger.log('Key counts by prefix:');
  for (const prefix of Object.keys(counts).sort()) {
    Logger.log(prefix + ': ' + counts[prefix]);
  }

  return counts;
}

// ============================================================================
// HELPER: Validate export
// ============================================================================

function validateExport() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  const keys = Object.keys(allProps);

  let validJson = 0;
  let invalidJson = 0;
  const invalidKeys = [];

  for (const key of keys) {
    try {
      JSON.parse(allProps[key]);
      validJson++;
    } catch (e) {
      invalidJson++;
      if (invalidKeys.length < 10) {
        invalidKeys.push(key);
      }
    }
  }

  Logger.log('Validation results:');
  Logger.log('- Valid JSON values: ' + validJson);
  Logger.log('- Invalid/plain values: ' + invalidJson);
  Logger.log('- Sample invalid keys: ' + invalidKeys.join(', '));

  return {
    validJson,
    invalidJson,
    sampleInvalidKeys: invalidKeys,
  };
}
