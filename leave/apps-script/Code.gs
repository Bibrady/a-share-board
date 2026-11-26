/**
 * 朔元请假审批 — Google Apps Script Web App
 *
 * 部署：执行者 = 脚本所有者，访问者 = Anyone。
 * 脚本所有者必须能打开下方私有表格；切勿把表格设为公开。
 *
 * 前端以 text/plain POST JSON（避免 CORS 预检），body 内携带 Google ID token。
 */
var SPREADSHEET_ID = '1ua6Nj0EVhY3mMQ83khLwOTjkaNKz_fzZdxAKFoZwm7I';
var TZ = 'Asia/Shanghai';
var DEFAULT_ADMIN_NAME = '卓炀';
var DEFAULT_ADMIN_EMAIL = 'zhuoyang.shi@gmail.com';
var DEFAULT_TYPES = ['年假', '事假', '病假', '调休', '其他'];
var LEAVE_HEADERS = [
  '单号', '申请人姓名', '申请人邮箱', '类型', '开始日期', '结束日期', '天数',
  '事由', '状态', '提交时间', '审批人', '审批人邮箱', '审批时间', '审批意见'
];
var STATUS_PENDING = '待审批';
var STATUS_APPROVED = '已通过';
var STATUS_REJECTED = '已驳回';
var STATUS_CANCELLED = '已撤销';
var STAFF_HEADERS = ['姓名', '邮箱', '角色', '启用'];
var CONFIG_HEADERS = ['键', '值'];

function doGet() {
  return jsonOut_({
    ok: true,
    service: 'shuoyuan-leave',
    tz: TZ
  });
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    var body = {};
    if (raw) {
      body = JSON.parse(raw);
    }
    return jsonOut_(dispatch_(body));
  } catch (err) {
    return jsonOut_({
      ok: false,
      error: 'server',
      message: String(err && err.message ? err.message : err)
    });
  }
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function dispatch_(body) {
  var action = String(body.action || '').trim();
  if (!action) {
    return fail_('invalid', '缺少操作类型。');
  }

  var mutating = action === 'create' || action === 'decide' || action === 'cancel';
  var lock = LockService.getScriptLock();
  if (mutating) {
    var got = lock.tryLock(30000);
    if (!got) {
      return fail_('busy', '系统正忙，请稍后再试。');
    }
  }

  try {
    var ctx = bootstrapSheets_();
    var user = verifyUser_(body.idToken, ctx);
    if (user.error) {
      return user.error;
    }

    if (action === 'bootstrap') {
      return bootstrapPayload_(ctx, user);
    }
    if (action === 'create') {
      return createLeave_(ctx, user, body);
    }
    if (action === 'decide') {
      return decideLeave_(ctx, user, body);
    }
    if (action === 'cancel') {
      return cancelLeave_(ctx, user, body);
    }
    return fail_('invalid', '不支持的操作。');
  } finally {
    if (mutating) {
      lock.releaseLock();
    }
  }
}

function fail_(code, message) {
  return { ok: false, error: code, message: message };
}

function bootstrapPayload_(ctx, user) {
  var rows = readLeaves_(ctx);
  return {
    ok: true,
    me: publicUser_(user),
    types: ctx.types,
    tz: TZ,
    dayUnit: 0.5,
    requests: rows,
    summary: summarize_(rows, todayYmd_())
  };
}

function publicUser_(user) {
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    canApprove: user.canApprove
  };
}

/* ---------- Auth ---------- */

function verifyUser_(idToken, ctx) {
  if (!idToken) {
    return { error: fail_('unauthenticated', '请先使用 Google 账号登录。') };
  }

  var info;
  try {
    info = fetchTokenInfo_(idToken);
  } catch (err) {
    return { error: fail_('unauthenticated', '登录凭证无效或已过期，请重新登录。') };
  }

  if (!info || !info.email) {
    return { error: fail_('unauthenticated', '登录凭证中缺少邮箱，无法确认身份。') };
  }
  if (String(info.email_verified) !== 'true' && info.email_verified !== true) {
    return { error: fail_('unauthenticated', '该 Google 邮箱尚未验证，无法进入审批系统。') };
  }

  var iss = String(info.iss || '');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
    return { error: fail_('unauthenticated', '登录凭证来源不受信任。') };
  }

  var expectedAud = ctx.oauthClientId;
  if (expectedAud && String(info.aud || '') !== expectedAud) {
    return { error: fail_('unauthenticated', '登录凭证与本系统的 OAuth 客户端不匹配。') };
  }

  var email = String(info.email).trim().toLowerCase();
  var staff = ctx.staffByEmail[email];
  if (!staff || !staff.enabled) {
    return { error: fail_('forbidden', '此 Google 账号不在朔元请假系统授权名单中。') };
  }

  return {
    name: staff.name || info.name || email,
    email: email,
    role: staff.role,
    canApprove: staff.canApprove,
    picture: info.picture || ''
  };
}

function fetchTokenInfo_(idToken) {
  var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (resp.getResponseCode() !== 200) {
    throw new Error('tokeninfo ' + resp.getResponseCode());
  }
  return JSON.parse(resp.getContentText());
}

/* ---------- Sheets ---------- */

function bootstrapSheets_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var leaveSheet = ensureLeaveSheet_(ss);
  var staffSheet = ensureStaffSheet_(ss);
  var configSheet = ensureConfigSheet_(ss);
  var config = readConfig_(configSheet);
  return {
    ss: ss,
    leaveSheet: leaveSheet,
    staffSheet: staffSheet,
    configSheet: configSheet,
    staffByEmail: readStaff_(staffSheet),
    types: config.types,
    oauthClientId: config.oauthClientId
  };
}

function ensureLeaveSheet_(ss) {
  var sheets = ss.getSheets();
  var i, sh, header;
  for (i = 0; i < sheets.length; i++) {
    sh = sheets[i];
    header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), LEAVE_HEADERS.length)).getDisplayValues()[0];
    if (header[0] === '单号' || header.indexOf('单号') !== -1) {
      ensureHeaderRow_(sh, LEAVE_HEADERS);
      return sh;
    }
  }
  sh = ss.getSheetByName('请假');
  if (!sh) {
    sh = ss.insertSheet('请假');
  }
  ensureHeaderRow_(sh, LEAVE_HEADERS);
  return sh;
}

function ensureStaffSheet_(ss) {
  var sh = ss.getSheetByName('员工');
  if (!sh) {
    sh = ss.insertSheet('员工');
  }
  ensureHeaderRow_(sh, STAFF_HEADERS);
  if (sh.getLastRow() < 2) {
    sh.getRange(2, 1, 1, 4).setValues([[DEFAULT_ADMIN_NAME, DEFAULT_ADMIN_EMAIL, '管理员', '是']]);
  } else {
    var emails = readStaff_(sh);
    if (!emails[DEFAULT_ADMIN_EMAIL]) {
      sh.appendRow([DEFAULT_ADMIN_NAME, DEFAULT_ADMIN_EMAIL, '管理员', '是']);
    }
  }
  return sh;
}

function ensureConfigSheet_(ss) {
  var sh = ss.getSheetByName('配置');
  if (!sh) {
    sh = ss.insertSheet('配置');
  }
  ensureHeaderRow_(sh, CONFIG_HEADERS);
  var map = readConfigMap_(sh);
  var defaults = {
    leave_types: DEFAULT_TYPES.join(','),
    oauth_client_id: '',
    timezone: TZ,
    min_days: '0.5',
    day_unit: '0.5'
  };
  var key, rows = [];
  for (key in defaults) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) {
      rows.push([key, defaults[key]]);
    }
  }
  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
  }
  return sh;
}

function ensureHeaderRow_(sh, headers) {
  var existing = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  var i, need = false;
  for (i = 0; i < headers.length; i++) {
    if (String(existing[i] || '').trim() !== headers[i]) {
      need = true;
      break;
    }
  }
  if (need && !String(existing[0] || '').trim()) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
}

function readConfigMap_(sh) {
  var last = Math.max(sh.getLastRow(), 1);
  var values = sh.getRange(1, 1, last, 2).getDisplayValues();
  var map = {};
  var i, k;
  for (i = 1; i < values.length; i++) {
    k = String(values[i][0] || '').trim();
    if (k) {
      map[k] = String(values[i][1] || '').trim();
    }
  }
  return map;
}

function readConfig_(sh) {
  var map = readConfigMap_(sh);
  var types = String(map.leave_types || '').split(/[,，]/).map(function (s) {
    return s.trim();
  }).filter(Boolean);
  if (!types.length) {
    types = DEFAULT_TYPES.slice();
  }
  return {
    types: types,
    oauthClientId: String(map.oauth_client_id || '').trim()
  };
}

function readStaff_(sh) {
  var last = Math.max(sh.getLastRow(), 1);
  var values = sh.getRange(1, 1, last, 4).getDisplayValues();
  var byEmail = {};
  var i, name, email, role, enabled, canApprove;
  for (i = 1; i < values.length; i++) {
    name = String(values[i][0] || '').trim();
    email = String(values[i][1] || '').trim().toLowerCase();
    role = String(values[i][2] || '').trim() || '员工';
    enabled = isYes_(values[i][3]);
    if (!email) continue;
    canApprove = enabled && (role === '管理员' || role === '审批人');
    byEmail[email] = {
      name: name || email,
      email: email,
      role: role,
      enabled: enabled,
      canApprove: canApprove
    };
  }
  return byEmail;
}

function isYes_(v) {
  var s = String(v == null ? '' : v).trim();
  return s === '' || s === '是' || s === 'Y' || s === 'y' || s === 'TRUE' || s === 'true' || s === '1';
}

/* ---------- Leave CRUD ---------- */

function readLeaves_(ctx) {
  var sh = ctx.leaveSheet;
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, LEAVE_HEADERS.length).getValues();
  var out = [];
  var i, rec;
  for (i = 0; i < values.length; i++) {
    rec = rowToLeave_(values[i], i + 2);
    if (rec) out.push(rec);
  }
  out.sort(function (a, b) {
    if (a.submittedAt === b.submittedAt) return a.id < b.id ? 1 : -1;
    return a.submittedAt < b.submittedAt ? 1 : -1;
  });
  return out;
}

function rowToLeave_(row, rowNumber) {
  var id = String(row[0] || '').trim();
  if (!id) return null;
  return {
    id: id,
    rowNumber: rowNumber,
    applicantName: String(row[1] || '').trim(),
    applicantEmail: String(row[2] || '').trim().toLowerCase(),
    type: String(row[3] || '').trim(),
    startDate: cellDate_(row[4]),
    endDate: cellDate_(row[5]),
    days: Number(row[6]) || 0,
    reason: String(row[7] || '').trim(),
    status: String(row[8] || '').trim(),
    submittedAt: cellDateTime_(row[9]),
    reviewerName: String(row[10] || '').trim(),
    reviewerEmail: String(row[11] || '').trim(),
    reviewedAt: cellDateTime_(row[12]),
    comment: String(row[13] || '').trim()
  };
}

function cellDate_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  var s = String(v || '').trim();
  var m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return s;
  return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
}

function cellDateTime_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
  }
  return String(v || '').trim();
}

function pad2_(n) {
  n = String(n);
  return n.length < 2 ? '0' + n : n;
}

function createLeave_(ctx, user, body) {
  var type = String(body.type || '').trim();
  var startDate = String(body.startDate || '').trim();
  var endDate = String(body.endDate || '').trim();
  var reason = String(body.reason || '').trim();
  var days = Number(body.days);

  if (ctx.types.indexOf(type) === -1) {
    return fail_('invalid', '请选择有效的请假类型。');
  }
  if (!isYmd_(startDate) || !isYmd_(endDate)) {
    return fail_('invalid', '请填写完整的开始与结束日期。');
  }
  if (startDate > endDate) {
    return fail_('invalid', '结束日期不能早于开始日期。');
  }
  if (!reason) {
    return fail_('invalid', '请填写请假事由。');
  }
  if (reason.length > 500) {
    return fail_('invalid', '事由请控制在 500 字以内。');
  }

  var natural = naturalDays_(startDate, endDate);
  var daysErr = validateDays_(days, natural);
  if (daysErr) return fail_('invalid', daysErr);

  var today = todayYmd_();
  var id = nextId_(ctx.leaveSheet, today);
  var submittedAt = nowText_();
  ctx.leaveSheet.appendRow([
    id,
    user.name,
    user.email,
    type,
    startDate,
    endDate,
    days,
    reason,
    STATUS_PENDING,
    submittedAt,
    '',
    '',
    '',
    ''
  ]);

  return bootstrapPayload_(ctx, user);
}

function decideLeave_(ctx, user, body) {
  if (!user.canApprove) {
    return fail_('forbidden', '当前账号没有审批权限。');
  }
  var decision = String(body.decision || '').trim();
  var status = decision === 'approve' ? STATUS_APPROVED
    : decision === 'reject' ? STATUS_REJECTED
    : '';
  if (!status) {
    return fail_('invalid', '请选择通过或驳回。');
  }
  var comment = String(body.comment || '').trim();
  if (comment.length > 200) {
    return fail_('invalid', '审批意见请控制在 200 字以内。');
  }
  if (status === STATUS_REJECTED && !comment) {
    return fail_('invalid', '驳回时请填写审批意见。');
  }

  var found = findLeave_(ctx, body.id);
  if (!found) {
    return fail_('not_found', '未找到该请假单。');
  }
  if (found.status !== STATUS_PENDING) {
    return fail_('conflict', '该单据已处理，当前状态为「' + found.status + '」。');
  }

  var sh = ctx.leaveSheet;
  sh.getRange(found.rowNumber, 9).setValue(status);
  sh.getRange(found.rowNumber, 11).setValue(user.name);
  sh.getRange(found.rowNumber, 12).setValue(user.email);
  sh.getRange(found.rowNumber, 13).setValue(nowText_());
  sh.getRange(found.rowNumber, 14).setValue(comment);
  return bootstrapPayload_(ctx, user);
}

function cancelLeave_(ctx, user, body) {
  var found = findLeave_(ctx, body.id);
  if (!found) {
    return fail_('not_found', '未找到该请假单。');
  }
  if (found.applicantEmail !== user.email) {
    return fail_('forbidden', '只能撤销自己提交的请假单。');
  }
  if (found.status !== STATUS_PENDING) {
    return fail_('conflict', '仅待审批的单据可以撤销。');
  }
  var sh = ctx.leaveSheet;
  sh.getRange(found.rowNumber, 9).setValue(STATUS_CANCELLED);
  sh.getRange(found.rowNumber, 11).setValue(user.name);
  sh.getRange(found.rowNumber, 12).setValue(user.email);
  sh.getRange(found.rowNumber, 13).setValue(nowText_());
  sh.getRange(found.rowNumber, 14).setValue('申请人撤销');
  return bootstrapPayload_(ctx, user);
}

function findLeave_(ctx, id) {
  id = String(id || '').trim();
  if (!id) return null;
  var rows = readLeaves_(ctx);
  var i;
  for (i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return rows[i];
  }
  return null;
}

function nextId_(sheet, todayYmd) {
  var prefix = 'SY-' + todayYmd.replace(/-/g, '') + '-';
  var last = sheet.getLastRow();
  var maxn = 0;
  if (last >= 2) {
    var ids = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
    var i, id, n;
    for (i = 0; i < ids.length; i++) {
      id = String(ids[i][0] || '');
      if (id.indexOf(prefix) === 0) {
        n = parseInt(id.slice(prefix.length), 10);
        if (n > maxn) maxn = n;
      }
    }
  }
  var next = String(maxn + 1);
  while (next.length < 3) next = '0' + next;
  return prefix + next;
}

function summarize_(rows, today) {
  var pending = 0, approved = 0, rejected = 0, cancelled = 0;
  var agenda = [];
  var i, r, kind;
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    if (r.status === STATUS_PENDING) pending++;
    else if (r.status === STATUS_APPROVED) approved++;
    else if (r.status === STATUS_REJECTED) rejected++;
    else if (r.status === STATUS_CANCELLED) cancelled++;

    if (r.status === STATUS_APPROVED && r.startDate && r.endDate) {
      if (r.startDate <= today && today <= r.endDate) kind = 'ongoing';
      else if (r.startDate > today) kind = 'upcoming';
      else kind = '';
      if (kind) {
        agenda.push({
          id: r.id,
          kind: kind,
          applicantName: r.applicantName,
          type: r.type,
          startDate: r.startDate,
          endDate: r.endDate,
          days: r.days
        });
      }
    }
  }
  agenda.sort(function (a, b) {
    if (a.startDate === b.startDate) return a.id < b.id ? -1 : 1;
    return a.startDate < b.startDate ? -1 : 1;
  });
  return {
    pending: pending,
    approved: approved,
    rejected: rejected,
    cancelled: cancelled,
    agenda: agenda
  };
}

/* ---------- Dates ---------- */

function todayYmd_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function nowText_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function isYmd_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function naturalDays_(start, end) {
  var a = parseYmd_(start);
  var b = parseYmd_(end);
  if (!a || !b) return 0;
  var da = Date.UTC(a.y, a.m - 1, a.d);
  var db = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((db - da) / 86400000) + 1;
}

function parseYmd_(s) {
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function validateDays_(days, natural) {
  if (!isFinite(days) || days <= 0) {
    return '请填写请假天数。';
  }
  if (Math.round(days * 2) !== days * 2) {
    return '天数最小单位为 0.5。';
  }
  if (days < 0.5) {
    return '天数不能小于 0.5。';
  }
  if (natural > 0 && days > natural) {
    return '天数不能超过起止日期的自然日数（' + natural + ' 天，含周末）。如需排除周末，请下调天数。';
  }
  return '';
}
