'use strict';

/*
 * TeamConneXtions - Employee Directory API for UI + API automation practice.
 *
 * Zero dependencies. Run `node server.js` and open http://127.0.0.1:4100
 *
 * Pages served by this same process (so UI and docs always cross-link):
 *   GET /            -> the TeamConneXtions UI
 *   GET /docs        -> interactive API reference
 *   GET /docs.html   -> same reference (fixes "Route not found: GET /docs.html")
 *   GET /openapi.json
 *
 * Access model:
 *   - Reading employees / departments / org chart needs any signed-in account.
 *   - Creating, editing and deleting employees needs an admin account.
 *   - /api/ping, /api/auth/login and /api/reset are public.
 *
 * Deliberate, testable business rules (great for negative test practice):
 *   - An admin can never delete their own employee record  -> 403 SELF_DELETE_FORBIDDEN
 *   - Deleting a manager who still has direct reports      -> 409 EMPLOYEE_HAS_REPORTS
 *     (pass ?reassignTo=<employeeId> to move the reports first)
 *   - Duplicate email on create/update                     -> 409 DUPLICATE_EMAIL
 *   - Unknown department / manager                         -> 400 VALIDATION_ERROR
 *
 * Every error uses one envelope: { "error": { "code", "message", "details?" } }
 * Every response carries an X-Request-Id header for log correlation practice.
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 4100;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 100 * 1024;

const API_KEY = 'teamconnex-key-2026';
const BASIC_USER = 'connex';
const BASIC_PASS = 'basic123';

/* ---------------- accounts (exactly two) ----------------
 * Each account is linked to an employee record via employeeId.
 * That link powers the self-delete guard. The admin is deliberately linked to
 * the VP of People & Culture (an HR admin persona), NOT the CEO, so the CEO can
 * be deleted in tests once their reports are reassigned. */
const ACCOUNTS = [
  { username: 'admin', password: 'admin123', role: 'admin', employeeId: 109 },
  { username: 'user', password: 'user123', role: 'user', employeeId: 113 },
];

/* ---------------- seed data ----------------
 * Deterministic on every reset so assertions never flake.
 * Built from tools/org-template.js via tools/build-org.js:
 * 12 departments, ~117 employees across 12 worldwide locations, 6 org levels.
 * See README for the exact seed contract. */
const { buildOrg } = require('./tools/build-org');

let departments = [];
let employees = [];
let nextId = 1;
const tokens = new Map(); // token -> { username, role, employeeId }

function resetStore() {
  const org = buildOrg();
  departments = org.departments;
  employees = org.employees;
  nextId = employees.reduce((m, e) => Math.max(m, e.id), 0) + 1;
}
resetStore();

/* ---------------- helpers ---------------- */
function send(res, status, body, extraHeaders) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'X-Request-Id': crypto.randomBytes(8).toString('hex'),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-API-Key',
  }, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(payload);
}

function fail(res, status, code, message, details, extraHeaders) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  send(res, status, { error }, extraHeaders);
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      return fail(res, 404, 'FILE_NOT_FOUND',
        `${path.basename(filePath)} is missing next to server.js. Start the server from the project folder.`);
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'X-Request-Id': crypto.randomBytes(8).toString('hex'),
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      if (tooBig) return;
      data += chunk;
      if (data.length > MAX_BODY) { tooBig = true; data = ''; }
    });
    req.on('end', () => {
      if (tooBig) return resolve({ __tooBig: true });
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({ __invalid: true }); }
    });
    req.on('error', () => resolve({ __invalid: true }));
  });
}

function authFrom(req) {
  const header = req.headers['authorization'] || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return tokens.get(token) || null;
}

function requireAuth(req, res) {
  const session = authFrom(req);
  if (!session) {
    fail(res, 401, 'UNAUTHORIZED', 'Sign in first. Send Authorization: Bearer <token> from POST /api/auth/login.');
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const session = requireAuth(req, res);
  if (!session) return null;
  if (session.role !== 'admin') {
    fail(res, 403, 'FORBIDDEN', 'Only the admin account can modify employees. You are signed in as a read-only user.');
    return null;
  }
  return session;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUSES = ['Active', 'On Leave'];

function deptById(id) { return departments.find((d) => d.id === id) || null; }
function empById(id) { return employees.find((e) => e.id === id) || null; }

function validateEmployee(input, { partial = false, selfId = null } = {}) {
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);

  if (!partial || has('firstname')) {
    if (!input.firstname || !String(input.firstname).trim()) errors.push({ field: 'firstname', message: 'First name is required.' });
  }
  if (!partial || has('lastname')) {
    if (!input.lastname || !String(input.lastname).trim()) errors.push({ field: 'lastname', message: 'Last name is required.' });
  }
  if (!partial || has('email')) {
    const email = String(input.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) errors.push({ field: 'email', message: 'Enter a valid email like name@company.dev.' });
  }
  if (!partial || has('title')) {
    if (!input.title || !String(input.title).trim()) errors.push({ field: 'title', message: 'Job title is required.' });
  }
  if (!partial || has('departmentId')) {
    const id = Number(input.departmentId);
    if (!Number.isInteger(id) || !deptById(id)) errors.push({ field: 'departmentId', message: 'departmentId must match an existing department (GET /api/departments).' });
  }
  if (has('managerId') && input.managerId !== null && input.managerId !== '') {
    const id = Number(input.managerId);
    if (!Number.isInteger(id) || !empById(id)) errors.push({ field: 'managerId', message: 'managerId must match an existing employee, or be null.' });
    else if (selfId !== null && id === selfId) errors.push({ field: 'managerId', message: 'An employee cannot be their own manager.' });
  }
  if (has('status')) {
    if (!STATUSES.includes(input.status)) errors.push({ field: 'status', message: `status must be one of: ${STATUSES.join(', ')}.` });
  }
  return errors;
}

function emailTaken(email, exceptId) {
  const norm = String(email).trim().toLowerCase();
  return employees.some((e) => e.email.toLowerCase() === norm && e.id !== exceptId);
}

function shapeEmployee(e) {
  const dept = deptById(e.departmentId);
  const mgr = e.managerId ? empById(e.managerId) : null;
  return Object.assign({}, e, {
    department: dept ? { id: dept.id, code: dept.code, name: dept.name } : null,
    manager: mgr ? { id: mgr.id, name: `${mgr.firstname} ${mgr.lastname}` } : null,
  });
}

function pickEmployeeFields(input) {
  return {
    firstname: String(input.firstname || '').trim(),
    lastname: String(input.lastname || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    title: String(input.title || '').trim(),
    departmentId: Number(input.departmentId),
    managerId: (input.managerId === null || input.managerId === '' || input.managerId === undefined) ? null : Number(input.managerId),
    phone: String(input.phone || '').trim(),
    location: String(input.location || '').trim(),
    country: String(input.country || '').trim(),
    region: String(input.region || '').trim(),
    timezone: String(input.timezone || '').trim(),
    employmentType: input.employmentType || 'Full-time',
    status: input.status || 'Active',
    joinedOn: String(input.joinedOn || new Date().toISOString().slice(0, 10)),
  };
}

function buildOrgTree() {
  const byId = new Map(employees.map((e) => [e.id, Object.assign(shapeEmployee(e), { reports: [] })]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.managerId && byId.has(node.managerId)) byId.get(node.managerId).reports.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes) => {
    nodes.sort((a, b) => a.id - b.id);
    nodes.forEach((n) => sortRec(n.reports));
  };
  sortRec(roots);
  return roots;
}

function directReports(id) { return employees.filter((e) => e.managerId === id); }

/* All reports beneath a manager (direct + indirect). */
function allReports(id) {
  const out = [];
  const walk = (mgrId) => {
    directReports(mgrId).forEach((r) => { out.push(r); walk(r.id); });
  };
  walk(id);
  return out;
}

function buildStats() {
  const byDepartment = departments.map((d) => ({
    id: d.id, code: d.code, name: d.name,
    headcount: employees.filter((e) => e.departmentId === d.id).length,
  })).sort((a, b) => b.headcount - a.headcount);

  const byLocation = {};
  employees.forEach((e) => { const k = e.location || 'Unknown'; byLocation[k] = (byLocation[k] || 0) + 1; });
  const locations = Object.keys(byLocation).map((city) => {
    const anyone = employees.find((e) => e.location === city) || {};
    return { city, country: anyone.country || '', region: anyone.region || '', count: byLocation[city] };
  }).sort((a, b) => b.count - a.count);

  const byRegion = {};
  employees.forEach((e) => { const k = e.region || 'Unknown'; byRegion[k] = (byRegion[k] || 0) + 1; });
  const byEmployment = {};
  employees.forEach((e) => { const k = e.employmentType || 'Full-time'; byEmployment[k] = (byEmployment[k] || 0) + 1; });

  const newest = employees.slice().sort((a, b) => b.joinedOn.localeCompare(a.joinedOn))[0] || null;
  const currentYear = new Date().getFullYear();
  const newHiresThisYear = employees.filter((e) => Number((e.joinedOn || '0').slice(0, 4)) === currentYear).length;
  const managerIds = new Set(employees.filter((e) => e.managerId).map((e) => e.managerId));
  const largestDept = byDepartment[0] || null;
  const spans = [...managerIds].map((mid) => directReports(mid).length);
  const avgSpan = spans.length ? (spans.reduce((s, n) => s + n, 0) / spans.length) : 0;

  return {
    totalEmployees: employees.length,
    totalDepartments: departments.length,
    totalLocations: locations.length,
    active: employees.filter((e) => e.status === 'Active').length,
    onLeave: employees.filter((e) => e.status === 'On Leave').length,
    managers: managerIds.size,
    avgSpanOfControl: Math.round(avgSpan * 10) / 10,
    newHiresThisYear,
    latestHireYear: currentYear,
    largestDepartment: largestDept ? { name: largestDept.name, headcount: largestDept.headcount } : null,
    byDepartment,
    byLocation,
    locations,
    byRegion,
    byEmployment,
    newestHire: newest ? { id: newest.id, name: `${newest.firstname} ${newest.lastname}`, joinedOn: newest.joinedOn } : null,
  };
}

/* ---------------- router ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();

  if (method === 'OPTIONS') return send(res, 204);

  /* ---- static pages: UI and docs served by the same process ---- */
  if (method === 'GET' && (p === '/' || p === '/index.html' || p === '/ui' || p === '/ui.html')) {
    return sendFile(res, path.join(__dirname, 'ui.html'), 'text/html; charset=utf-8');
  }
  if (method === 'GET' && (p === '/docs' || p === '/docs.html')) {
    return sendFile(res, path.join(__dirname, 'docs.html'), 'text/html; charset=utf-8');
  }
  if (method === 'GET' && p === '/openapi.json') {
    return sendFile(res, path.join(__dirname, 'openapi.json'), 'application/json; charset=utf-8');
  }
  if (method === 'GET' && p === '/assets/teamconnextions-logo-dark.png') {
    return sendFile(res, path.join(__dirname, 'assets', 'teamconnextions-logo-dark.png'), 'image/png');
  }
  if (method === 'GET' && p === '/assets/teamconnextions-icon.png') {
    return sendFile(res, path.join(__dirname, 'assets', 'teamconnextions-icon.png'), 'image/png');
  }
  if (method === 'GET' && p === '/favicon.ico') {
    return sendFile(res, path.join(__dirname, 'assets', 'teamconnextions-icon.png'), 'image/png');
  }

  /* ---- system ---- */
  if (p === '/api/ping') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return send(res, 200, { status: 'ok', app: 'TeamConneXtions', time: new Date().toISOString() });
  }
  if (p === '/api/reset') {
    if (method !== 'POST') return methodNotAllowed(res, 'POST');
    resetStore();
    return send(res, 200, { reset: true, employees: employees.length, departments: departments.length });
  }
  if (p === '/api/overview') {
    /* Public, non-sensitive company snapshot for the signed-out landing page. */
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    const s = buildStats();
    return send(res, 200, {
      totalEmployees: s.totalEmployees, totalDepartments: s.totalDepartments,
      totalLocations: s.totalLocations, managers: s.managers,
      newHiresThisYear: s.newHiresThisYear, latestHireYear: s.latestHireYear,
      largestDepartment: s.largestDepartment,
    });
  }

  /* ---- auth ---- */
  if (p === '/api/auth/login') {
    if (method !== 'POST') return methodNotAllowed(res, 'POST');
    const body = await readBody(req);
    if (body.__invalid) return fail(res, 400, 'INVALID_JSON', 'The request body is not valid JSON.');
    if (body.__tooBig) return fail(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body exceeds 100 KB.');
    const account = ACCOUNTS.find((a) => a.username === String(body.username || '') && a.password === String(body.password || ''));
    if (!account) return fail(res, 401, 'BAD_CREDENTIALS', 'Wrong username or password. Try admin/admin123 or user/user123.');
    const token = crypto.randomBytes(16).toString('hex');
    tokens.set(token, { username: account.username, role: account.role, employeeId: account.employeeId });
    return send(res, 200, { token, username: account.username, role: account.role, employeeId: account.employeeId });
  }
  if (p === '/api/auth/logout') {
    if (method !== 'POST') return methodNotAllowed(res, 'POST');
    const header = req.headers['authorization'] || '';
    const token = header.replace(/^Bearer\s+/i, '').trim();
    tokens.delete(token);
    return send(res, 200, { loggedOut: true });
  }
  if (p === '/api/auth/me') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    const session = requireAuth(req, res);
    if (!session) return;
    return send(res, 200, { username: session.username, role: session.role, employeeId: session.employeeId });
  }

  /* ---- standalone practice endpoints ---- */
  if (p === '/api/auth/apikey') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    const key = req.headers['x-api-key'];
    if (!key) return fail(res, 401, 'MISSING_API_KEY', 'Send the header X-API-Key.');
    if (key !== API_KEY) return fail(res, 401, 'INVALID_API_KEY', 'That API key is not valid.');
    return send(res, 200, { authenticated: true, method: 'api-key' });
  }
  if (p === '/api/auth/basic') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    const header = req.headers['authorization'] || '';
    if (!header.startsWith('Basic ')) {
      return fail(res, 401, 'MISSING_BASIC_AUTH', 'Send HTTP Basic credentials.', undefined, { 'WWW-Authenticate': 'Basic realm="TeamConneXtions"' });
    }
    let decoded = '';
    try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch (e) { decoded = ''; }
    const sep = decoded.indexOf(':');
    const u = sep === -1 ? decoded : decoded.slice(0, sep);
    const pw = sep === -1 ? '' : decoded.slice(sep + 1);
    if (u !== BASIC_USER || pw !== BASIC_PASS) return fail(res, 401, 'INVALID_BASIC_AUTH', 'Invalid Basic credentials.', undefined, { 'WWW-Authenticate': 'Basic realm="TeamConneXtions"' });
    return send(res, 200, { authenticated: true, method: 'basic', user: u });
  }
  if (p === '/api/delay') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    let ms = Number.parseInt(url.searchParams.get('ms') || '1000', 10);
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    if (ms > 10000) ms = 10000;
    await new Promise((r) => setTimeout(r, ms));
    return send(res, 200, { message: `Responded after ${ms} ms.`, delayMs: ms });
  }
  if (p === '/api/echo') {
    const body = await readBody(req);
    const query = {};
    for (const [k, v] of url.searchParams.entries()) query[k] = v;
    return send(res, 200, { method, path: p, query, headers: req.headers, body: (body.__invalid || body.__tooBig) ? null : body });
  }
  const statusMatch = p.match(/^\/api\/status\/(\d{3})$/);
  if (statusMatch) {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    const code = Number(statusMatch[1]);
    if (code < 200 || code > 599) return fail(res, 400, 'BAD_STATUS', 'Pick a status code between 200 and 599.');
    return send(res, code, { requestedStatus: code });
  }

  /* ---- departments ---- */
  if (p === '/api/departments') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    if (!requireAuth(req, res)) return;
    const data = departments.map((d) => ({
      id: d.id, code: d.code, name: d.name,
      headcount: employees.filter((e) => e.departmentId === d.id).length,
    }));
    return send(res, 200, { data, total: data.length });
  }

  /* ---- org chart & stats ---- */
  if (p === '/api/orgchart') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    if (!requireAuth(req, res)) return;
    return send(res, 200, { data: buildOrgTree() });
  }
  if (p === '/api/stats') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    if (!requireAuth(req, res)) return;
    return send(res, 200, buildStats());
  }

  /* ---- employees collection ---- */
  if (p === '/api/employees') {
    if (method === 'GET') {
      const session = requireAuth(req, res);
      if (!session) return;
      let rows = employees.slice();
      const search = (url.searchParams.get('search') || '').trim().toLowerCase();
      const deptFilter = url.searchParams.get('departmentId');
      if (deptFilter) {
        const id = Number(deptFilter);
        if (!Number.isInteger(id) || !deptById(id)) {
          return fail(res, 400, 'VALIDATION_ERROR', 'departmentId must match an existing department.', [{ field: 'departmentId', message: 'Unknown department id.' }]);
        }
        rows = rows.filter((e) => e.departmentId === id);
      }
      if (search) {
        rows = rows.filter((e) => (`${e.firstname} ${e.lastname} ${e.email} ${e.title} ${e.location}`).toLowerCase().includes(search));
      }
      return send(res, 200, { data: rows.map(shapeEmployee), total: rows.length });
    }
    if (method === 'POST') {
      const session = requireAdmin(req, res);
      if (!session) return;
      const body = await readBody(req);
      if (body.__invalid) return fail(res, 400, 'INVALID_JSON', 'The request body is not valid JSON.');
      if (body.__tooBig) return fail(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body exceeds 100 KB.');
      const errors = validateEmployee(body);
      if (errors.length) return fail(res, 400, 'VALIDATION_ERROR', 'One or more fields failed validation.', errors);
      if (emailTaken(body.email, -1)) return fail(res, 409, 'DUPLICATE_EMAIL', 'Another employee already uses that email.');
      const employee = Object.assign({ id: nextId++ }, pickEmployeeFields(body));
      employees.push(employee);
      return send(res, 201, shapeEmployee(employee), { Location: `/api/employees/${employee.id}` });
    }
    return methodNotAllowed(res, 'GET, POST');
  }

  /* ---- a manager's team (direct + skip-level reports) ---- */
  const teamMatch = p.match(/^\/api\/employees\/(-?\d+)\/team$/);
  if (teamMatch) {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    if (!requireAuth(req, res)) return;
    const id = Number(teamMatch[1]);
    const employee = empById(id);
    if (!employee) return fail(res, 404, 'EMPLOYEE_NOT_FOUND', `No employee with id ${id}.`);
    const direct = directReports(id).map(shapeEmployee);
    const all = allReports(id).map(shapeEmployee);
    return send(res, 200, {
      manager: { id: employee.id, name: `${employee.firstname} ${employee.lastname}`, title: employee.title },
      directCount: direct.length,
      totalCount: all.length,
      direct,
      all,
    });
  }

  /* ---- single employee ---- */
  const empMatch = p.match(/^\/api\/employees\/(-?\d+)$/);
  if (empMatch) {
    const id = Number(empMatch[1]);
    const employee = empById(id);

    if (method === 'GET') {
      if (!requireAuth(req, res)) return;
      if (!employee) return fail(res, 404, 'EMPLOYEE_NOT_FOUND', `No employee with id ${id}.`);
      return send(res, 200, shapeEmployee(employee));
    }

    if (method === 'PUT' || method === 'PATCH') {
      const session = requireAdmin(req, res);
      if (!session) return;
      if (!employee) return fail(res, 404, 'EMPLOYEE_NOT_FOUND', `No employee with id ${id}.`);
      const body = await readBody(req);
      if (body.__invalid) return fail(res, 400, 'INVALID_JSON', 'The request body is not valid JSON.');
      if (body.__tooBig) return fail(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body exceeds 100 KB.');
      const partial = method === 'PATCH';
      const errors = validateEmployee(body, { partial, selfId: id });
      if (errors.length) return fail(res, 400, 'VALIDATION_ERROR', 'One or more fields failed validation.', errors);
      const email = body.email !== undefined ? String(body.email).trim().toLowerCase() : employee.email;
      if (emailTaken(email, id)) return fail(res, 409, 'DUPLICATE_EMAIL', 'Another employee already uses that email.');

      if (partial) {
        ['firstname', 'lastname', 'title', 'phone', 'location', 'country', 'region', 'timezone', 'employmentType', 'status', 'joinedOn'].forEach((k) => {
          if (body[k] !== undefined) employee[k] = String(body[k]).trim ? String(body[k]).trim() : body[k];
        });
        if (body.email !== undefined) employee.email = email;
        if (body.departmentId !== undefined) employee.departmentId = Number(body.departmentId);
        if (body.managerId !== undefined) employee.managerId = (body.managerId === null || body.managerId === '') ? null : Number(body.managerId);
      } else {
        Object.assign(employee, pickEmployeeFields(body));
      }
      return send(res, 200, shapeEmployee(employee));
    }

    if (method === 'DELETE') {
      const session = requireAdmin(req, res);
      if (!session) return;
      if (!employee) return fail(res, 404, 'EMPLOYEE_NOT_FOUND', `No employee with id ${id}.`);

      /* Guard 1: you cannot delete yourself. */
      if (session.employeeId === id) {
        return fail(res, 403, 'SELF_DELETE_FORBIDDEN',
          'You cannot delete your own employee record while signed in with it. Ask another admin, or pick a different record.');
      }

      /* Guard 2: a manager with direct reports cannot vanish silently. */
      const reports = employees.filter((e) => e.managerId === id);
      if (reports.length) {
        const reassignRaw = url.searchParams.get('reassignTo');
        if (!reassignRaw) {
          const who = `${employee.firstname} ${employee.lastname}`;
          const n = reports.length;
          return fail(res, 409, 'EMPLOYEE_HAS_REPORTS',
            `${who} is a manager with ${n} direct ${n === 1 ? 'report' : 'reports'}. Choose a new manager for the team, then delete ${employee.firstname}. In the app, use the "Move team & delete" option and pick who should take over.`,
            { reportIds: reports.map((r) => r.id), reportCount: n, employee: who });
        }
        const newMgrId = Number(reassignRaw);
        const newMgr = empById(newMgrId);
        if (!Number.isInteger(newMgrId) || !newMgr || newMgrId === id) {
          return fail(res, 400, 'VALIDATION_ERROR', 'reassignTo must be the id of another existing employee.',
            [{ field: 'reassignTo', message: 'Unknown or invalid employee id.' }]);
        }
        reports.forEach((r) => { r.managerId = newMgrId; });
      }

      employees = employees.filter((e) => e.id !== id);
      return send(res, 200, { deleted: true, id });
    }

    return methodNotAllowed(res, 'GET, PUT, PATCH, DELETE');
  }

  /* ---- catch-all: consistent, helpful 404 ---- */
  return fail(res, 404, 'ROUTE_NOT_FOUND', `Route not found: ${method} ${p}`, {
    hint: 'The UI lives at "/", the API reference at "/docs" (or "/docs.html"), and the API under "/api/...". See GET /openapi.json for the full contract.',
  });
});

function methodNotAllowed(res, allow) {
  fail(res, 405, 'METHOD_NOT_ALLOWED', `That method is not supported here. Allowed: ${allow}.`, undefined, { Allow: allow });
}

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  TeamConneXtions is running');
  console.log(`  UI        : http://${HOST}:${PORT}/`);
  console.log(`  API docs  : http://${HOST}:${PORT}/docs   (also /docs.html)`);
  console.log(`  API base  : http://${HOST}:${PORT}/api`);
  console.log('');
  console.log('  Accounts  : admin/admin123 (full access) · user/user123 (read only)');
  console.log('');
});
