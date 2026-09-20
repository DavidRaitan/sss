/**
 * Where the RSVPs land: one spreadsheet per couple.
 *
 * Setting it up (five minutes, once per wedding):
 *   1. Make a new Google Sheet, name it after the couple.
 *   2. Extensions → Apps Script. Delete what's there, paste this in, Save.
 *   3. Deploy → New deployment → type "Web app".
 *        Execute as: Me
 *        Who has access: Anyone
 *      Deploy, allow the permissions it asks for, and copy the /exec URL.
 *   4. Paste that URL into ENDPOINT at the top of the invitation page.
 *
 * Changing the script later needs Deploy → Manage deployments → edit →
 * New version, or the old code keeps running.
 */

var SHEET_NAME = 'RSVPs';
var HEADERS = ['Received', 'Name', 'Attending', 'Guests', 'Dietary', 'Details', 'Language'];

function doPost(e) {
  var lock = LockService.getScriptLock();       // two guests can reply at once
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getSheet_();
    sheet.appendRow([
      data.timestamp ? new Date(data.timestamp) : new Date(),
      data.name || '',
      data.attending || '',
      data.guests || '',
      data.diet || '',
      data.dietNote || '',
      data.language || ''
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json_({ ok: true, note: 'RSVP endpoint is live' });
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
