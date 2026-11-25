/**
 * Speciality · 세특 수집기 Google Apps Script 백엔드
 *
 * [설치 방법]
 * 1. Google Drive에서 새 Google 스프레드시트를 만듭니다.
 * 2. 상단 메뉴 [확장 프로그램] -> [Apps Script]를 클릭합니다.
 * 3. 기존 코드를 모두 지우고 이 파일의 내용을 그대로 붙여넣은 뒤 저장(Ctrl+S)합니다.
 * 4. 우측 상단 [배포] -> [새 배포] -> 유형: [웹 앱] 선택
 *    - 다음 사용자 권한으로 실행: 나
 *    - 액세스 권한이 있는 사용자: 모든 사용자
 * 5. 배포 후 생성된 웹 앱 URL(https://script.google.com/macros/s/.../exec)을
 *    세특 수집기 웹앱의 [Google 시트 연동] 설정에 붙여넣으세요.
 */

var COURSES_SHEET = '_Courses';
var SUBMISSIONS_SHEET = '_Submissions';

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8f3f2');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function initSheets() {
  getOrCreateSheet(COURSES_SHEET, [
    'id',
    'title',
    'description',
    'isJointCurriculum',
    'isOpen',
    'fieldsJson',
    'createdAt',
    'updatedAt',
  ]);
  getOrCreateSheet(SUBMISSIONS_SHEET, [
    'id',
    'courseId',
    'studentId',
    'studentName',
    'school',
    'answersJson',
    'generatedText',
    'style',
    'status',
    'createdAt',
    'updatedAt',
  ]);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function readCourses() {
  initSheets();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COURSES_SHEET);
  var rows = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    var fields = [];
    try {
      fields = JSON.parse(r[5] || '[]');
    } catch (e) {
      fields = [];
    }
    list.push({
      id: String(r[0]),
      title: String(r[1] || ''),
      description: String(r[2] || ''),
      isJointCurriculum: r[3] === true || r[3] === 'TRUE' || r[3] === 'true',
      isOpen: r[4] !== false && r[4] !== 'FALSE' && r[4] !== 'false',
      fields: fields,
      createdAt: String(r[6] || ''),
      updatedAt: String(r[7] || ''),
    });
  }
  return list;
}

function readSubmissions(courseId) {
  initSheets();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SUBMISSIONS_SHEET);
  var rows = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    if (courseId && String(r[1]) !== String(courseId)) continue;
    var answers = {};
    try {
      answers = JSON.parse(r[5] || '{}');
    } catch (e) {
      answers = {};
    }
    list.push({
      id: String(r[0]),
      courseId: String(r[1]),
      studentId: String(r[2] || ''),
      studentName: String(r[3] || ''),
      school: String(r[4] || ''),
      answers: answers,
      generatedText: String(r[6] || ''),
      style: String(r[7] || 'inquiry'),
      status: String(r[8] || 'auto'),
      createdAt: String(r[9] || ''),
      updatedAt: String(r[10] || ''),
    });
  }
  // Most recent first
  list.reverse();
  return list;
}

/**
 * Syncs a clean, human-readable sheet tab named after the course so the teacher
 * can open Google Drive on any PC and view/copy all student answers & 세특 directly.
 */
function syncReadableCourseSheet(course) {
  if (!course || !course.id) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var safeName = String(course.title || '과목')
    .replace(/[\\/?*[\]:]/g, '_')
    .slice(0, 90);
  if (safeName === COURSES_SHEET || safeName === SUBMISSIONS_SHEET) {
    safeName = safeName + '_목록';
  }

  var sheet = ss.getSheetByName(safeName);
  if (!sheet) {
    sheet = ss.insertSheet(safeName);
  } else {
    sheet.clearContents();
  }

  var fields = course.fields || [];
  var headers = ['학번', '이름'];
  if (course.isJointCurriculum) headers.push('학교');
  for (var i = 0; i < fields.length; i++) {
    headers.push((i + 1) + '. ' + fields[i].label);
  }
  headers.push('세부능력 및 특기사항', '상태', '제출 시각');

  var subs = readSubmissions(course.id);
  var values = [headers];
  for (var s = 0; s < subs.length; s++) {
    var sub = subs[s];
    var row = [sub.studentId, sub.studentName];
    if (course.isJointCurriculum) row.push(sub.school || '');
    for (var f = 0; f < fields.length; f++) {
      row.push((sub.answers && sub.answers[fields[f].id]) || '');
    }
    row.push(
      sub.generatedText || '',
      sub.status === 'reviewed' ? '검토 완료' : '자동 입력됨',
      sub.createdAt || ''
    );
    values.push(row);
  }

  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8f3f2');
  sheet.setFrozenRows(1);
}

function doGet(e) {
  try {
    initSheets();
    var p = (e && e.parameter) || {};
    var action = p.action || 'ping';

    if (action === 'ping') {
      return jsonOut({
        ok: true,
        spreadsheetName: SpreadsheetApp.getActiveSpreadsheet().getName(),
      });
    }

    if (action === 'listCourses') {
      var courses = readCourses();
      var allSubs = readSubmissions(null);
      var counts = {};
      for (var i = 0; i < allSubs.length; i++) {
        var cid = allSubs[i].courseId;
        counts[cid] = (counts[cid] || 0) + 1;
      }
      for (var j = 0; j < courses.length; j++) {
        courses[j].submissionCount = counts[courses[j].id] || 0;
      }
      courses.reverse();
      return jsonOut({ courses: courses });
    }

    if (action === 'getCourse') {
      var targetId = p.courseId || '';
      var all = readCourses();
      for (var k = 0; k < all.length; k++) {
        if (all[k].id === targetId) {
          return jsonOut({ course: all[k] });
        }
      }
      return jsonOut({ error: '존재하지 않는 과목입니다.' });
    }

    if (action === 'listSubmissions') {
      var cid2 = p.courseId || '';
      return jsonOut({ submissions: readSubmissions(cid2) });
    }

    return jsonOut({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut({ error: err.message || String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    initSheets();
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var body = JSON.parse(raw);
    var action = body.action || '';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var now = new Date().toISOString();

    if (action === 'createCourse') {
      var c = body.payload || {};
      var id = c.id || 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      var course = {
        id: id,
        title: String(c.title || '새 과목').trim(),
        description: String(c.description || '').trim(),
        isJointCurriculum: Boolean(c.isJointCurriculum),
        isOpen: c.isOpen !== false,
        fields: Array.isArray(c.fields) ? c.fields : [],
        createdAt: now,
        updatedAt: now,
      };
      var sheet = ss.getSheetByName(COURSES_SHEET);
      sheet.appendRow([
        course.id,
        course.title,
        course.description,
        course.isJointCurriculum,
        course.isOpen,
        JSON.stringify(course.fields),
        course.createdAt,
        course.updatedAt,
      ]);
      syncReadableCourseSheet(course);
      course.submissionCount = 0;
      return jsonOut({ course: course });
    }

    if (action === 'updateCourse') {
      var courseId = String(body.courseId || '');
      var patch = body.payload || {};
      var cSheet = ss.getSheetByName(COURSES_SHEET);
      var rows = cSheet.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === courseId) {
          var existingFields = [];
          try {
            existingFields = JSON.parse(rows[i][5] || '[]');
          } catch (err2) {}
          var updated = {
            id: courseId,
            title: patch.title !== undefined ? String(patch.title).trim() : String(rows[i][1]),
            description:
              patch.description !== undefined ? String(patch.description).trim() : String(rows[i][2]),
            isJointCurriculum:
              patch.isJointCurriculum !== undefined
                ? Boolean(patch.isJointCurriculum)
                : rows[i][3] === true || rows[i][3] === 'TRUE',
            isOpen:
              patch.isOpen !== undefined
                ? Boolean(patch.isOpen)
                : rows[i][4] !== false && rows[i][4] !== 'FALSE',
            fields: Array.isArray(patch.fields) ? patch.fields : existingFields,
            createdAt: String(rows[i][6] || now),
            updatedAt: now,
          };
          cSheet
            .getRange(i + 1, 1, 1, 8)
            .setValues([
              [
                updated.id,
                updated.title,
                updated.description,
                updated.isJointCurriculum,
                updated.isOpen,
                JSON.stringify(updated.fields),
                updated.createdAt,
                updated.updatedAt,
              ],
            ]);
          syncReadableCourseSheet(updated);
          return jsonOut({ course: updated });
        }
      }
      return jsonOut({ error: '과목을 찾을 수 없습니다.' });
    }

    if (action === 'deleteCourse') {
      var delId = String(body.courseId || '');
      var cs = ss.getSheetByName(COURSES_SHEET);
      var cRows = cs.getDataRange().getValues();
      for (var r = cRows.length - 1; r >= 1; r--) {
        if (String(cRows[r][0]) === delId) cs.deleteRow(r + 1);
      }
      var sSheet = ss.getSheetByName(SUBMISSIONS_SHEET);
      var sRows = sSheet.getDataRange().getValues();
      for (var sr = sRows.length - 1; sr >= 1; sr--) {
        if (String(sRows[sr][1]) === delId) sSheet.deleteRow(sr + 1);
      }
      return jsonOut({ deleted: true });
    }

    if (action === 'submit') {
      var subCourseId = String(body.courseId || '');
      var payload = body.payload || {};
      var coursesAll = readCourses();
      var targetCourse = null;
      for (var ci = 0; ci < coursesAll.length; ci++) {
        if (coursesAll[ci].id === subCourseId) {
          targetCourse = coursesAll[ci];
          break;
        }
      }
      if (!targetCourse) return jsonOut({ error: '존재하지 않는 과목입니다.' });
      if (!targetCourse.isOpen) return jsonOut({ error: '현재 제출이 마감된 과목입니다.' });

      var subId = 'sub_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      var subSheet = ss.getSheetByName(SUBMISSIONS_SHEET);
      subSheet.appendRow([
        subId,
        subCourseId,
        String(payload.studentId || '').trim(),
        String(payload.studentName || '').trim(),
        targetCourse.isJointCurriculum ? String(payload.school || '').trim() : '',
        JSON.stringify(payload.answers || {}),
        String(payload.generatedText || ''),
        String(payload.style || 'inquiry'),
        'auto',
        now,
        now,
      ]);
      syncReadableCourseSheet(targetCourse);
      // Never return generatedText to student browser
      return jsonOut({ ok: true, submittedAt: now });
    }

    if (action === 'updateSubmission') {
      var uSubId = String(body.submissionId || '');
      var uPatch = body.payload || {};
      var uSheet = ss.getSheetByName(SUBMISSIONS_SHEET);
      var uRows = uSheet.getDataRange().getValues();
      for (var ui = 1; ui < uRows.length; ui++) {
        if (String(uRows[ui][0]) === uSubId) {
          var nextText = uPatch.generatedText !== undefined ? String(uPatch.generatedText) : String(uRows[ui][6]);
          var nextStyle = uPatch.style || String(uRows[ui][7] || 'inquiry');
          var nextStatus = uPatch.status || String(uRows[ui][8] || 'auto');
          uSheet.getRange(ui + 1, 7, 1, 5).setValues([[nextText, nextStyle, nextStatus, uRows[ui][9], now]]);

          var answersObj = {};
          try {
            answersObj = JSON.parse(uRows[ui][5] || '{}');
          } catch (err3) {}
          var subObj = {
            id: uSubId,
            courseId: String(uRows[ui][1]),
            studentId: String(uRows[ui][2]),
            studentName: String(uRows[ui][3]),
            school: String(uRows[ui][4]),
            answers: answersObj,
            generatedText: nextText,
            style: nextStyle,
            status: nextStatus,
            createdAt: String(uRows[ui][9]),
            updatedAt: now,
          };

          var csList = readCourses();
          for (var cidx = 0; cidx < csList.length; cidx++) {
            if (csList[cidx].id === subObj.courseId) {
              syncReadableCourseSheet(csList[cidx]);
              break;
            }
          }
          return jsonOut({ submission: subObj });
        }
      }
      return jsonOut({ error: '제출 기록을 찾을 수 없습니다.' });
    }

    if (action === 'deleteSubmission') {
      var dSubId = String(body.submissionId || '');
      var dSheet = ss.getSheetByName(SUBMISSIONS_SHEET);
      var dRows = dSheet.getDataRange().getValues();
      var affectedCourseId = null;
      for (var di = dRows.length - 1; di >= 1; di--) {
        if (String(dRows[di][0]) === dSubId) {
          affectedCourseId = String(dRows[di][1]);
          dSheet.deleteRow(di + 1);
        }
      }
      if (affectedCourseId) {
        var csList2 = readCourses();
        for (var ci2 = 0; ci2 < csList2.length; ci2++) {
          if (csList2[ci2].id === affectedCourseId) {
            syncReadableCourseSheet(csList2[ci2]);
            break;
          }
        }
      }
      return jsonOut({ deleted: true });
    }

    if (action === 'bulkUpdateSubmissions') {
      var updates = Array.isArray(body.updates) ? body.updates : [];
      var uMap = {};
      for (var bi = 0; bi < updates.length; bi++) {
        uMap[updates[bi].id] = updates[bi];
      }
      var bSheet = ss.getSheetByName(SUBMISSIONS_SHEET);
      var bRows = bSheet.getDataRange().getValues();
      var touchedCourses = {};
      for (var br = 1; br < bRows.length; br++) {
        var bid = String(bRows[br][0]);
        if (uMap[bid]) {
          var up = uMap[bid];
          var nt = up.generatedText !== undefined ? String(up.generatedText) : String(bRows[br][6]);
          var ns = up.style || String(bRows[br][7] || 'inquiry');
          var nst = up.status || String(bRows[br][8] || 'auto');
          bSheet.getRange(br + 1, 7, 1, 5).setValues([[nt, ns, nst, bRows[br][9], now]]);
          touchedCourses[String(bRows[br][1])] = true;
        }
      }
      var csList3 = readCourses();
      for (var ci3 = 0; ci3 < csList3.length; ci3++) {
        if (touchedCourses[csList3[ci3].id]) {
          syncReadableCourseSheet(csList3[ci3]);
        }
      }
      return jsonOut({ ok: true });
    }

    return jsonOut({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut({ error: err.message || String(err) });
  } finally {
    lock.releaseLock();
  }
}
