'use strict';
/* Deep regression for TeamConneXtions v1.0.1. Run: node tools/regression.js (server must be up) */
const BASE = 'http://127.0.0.1:4100';
let pass = 0, failCount = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { pass++; }
  else { failCount++; failures.push(name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 240) : '')); }
}
async function req(method, path, opts) {
  opts = opts || {};
  const h = Object.assign({}, opts.headers || {});
  if (opts.body !== undefined) h['Content-Type'] = 'application/json';
  if (opts.token) h['Authorization'] = 'Bearer ' + opts.token;
  const res = await fetch(BASE + path, { method, headers: h, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  return { status: res.status, data, headers: res.headers };
}

(async () => {
  let r = await fetch(BASE + '/'); check('GET / serves UI', r.status === 200 && (await r.text()).includes('TeamConne'));
  r = await fetch(BASE + '/docs'); check('GET /docs serves docs', r.status === 200 && (await r.text()).includes('API Reference'));
  r = await fetch(BASE + '/docs.html'); check('GET /docs.html serves docs (bug fix)', r.status === 200 && (await r.text()).includes('API Reference'));
  r = await fetch(BASE + '/openapi.json'); check('GET /openapi.json', r.status === 200 && (await r.json()).openapi === '3.0.3');
  r = await req('GET', '/nope.html'); check('unknown route -> 404 envelope with hint', r.status === 404 && r.data.error.code === 'ROUTE_NOT_FOUND' && r.data.error.details.hint.includes('/docs'));

  r = await req('GET', '/api/ping'); check('ping ok', r.status === 200 && r.data.status === 'ok' && r.data.app === 'TeamConneXtions');
  check('X-Request-Id present', !!r.headers.get('x-request-id'));
  r = await req('POST', '/api/reset'); check('reset -> 117 / 12', r.status === 200 && r.data.employees === 117 && r.data.departments === 12, r.data);
  r = await req('GET', '/api/overview'); check('public overview (no token)', r.status === 200 && r.data.totalEmployees === 117 && r.data.totalLocations === 12 && r.data.managers > 0 && typeof r.data.newHiresThisYear === 'number', r.data);
  r = await req('DELETE', '/api/ping'); check('405 on ping + Allow', r.status === 405 && r.data.error.code === 'METHOD_NOT_ALLOWED' && r.headers.get('allow') === 'GET');

  r = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong' } });
  check('bad creds 401', r.status === 401 && r.data.error.code === 'BAD_CREDENTIALS');
  r = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  check('admin login -> emp 109', r.status === 200 && r.data.role === 'admin' && r.data.employeeId === 109, r.data);
  const admin = r.data.token;
  r = await req('POST', '/api/auth/login', { body: { username: 'user', password: 'user123' } });
  check('user login -> emp 113', r.status === 200 && r.data.role === 'user' && r.data.employeeId === 113, r.data);
  const user = r.data.token;
  r = await req('GET', '/api/auth/me', { token: admin }); check('me admin', r.status === 200 && r.data.employeeId === 109);
  r = await req('GET', '/api/auth/me'); check('me without token 401', r.status === 401 && r.data.error.code === 'UNAUTHORIZED');

  r = await req('GET', '/api/auth/apikey'); check('apikey missing 401', r.status === 401 && r.data.error.code === 'MISSING_API_KEY');
  r = await req('GET', '/api/auth/apikey', { headers: { 'X-API-Key': 'teamconnex-key-2026' } }); check('apikey ok', r.status === 200 && r.data.authenticated === true);
  r = await req('GET', '/api/auth/basic'); check('basic missing 401 + WWW-Authenticate', r.status === 401 && !!r.headers.get('www-authenticate'));
  r = await req('GET', '/api/auth/basic', { headers: { Authorization: 'Basic ' + Buffer.from('connex:basic123').toString('base64') } });
  check('basic ok', r.status === 200 && r.data.user === 'connex');
  const t0 = Date.now();
  r = await req('GET', '/api/delay?ms=300'); check('delay waits', r.status === 200 && Date.now() - t0 >= 290 && r.data.delayMs === 300);
  r = await req('POST', '/api/echo?x=1', { body: { hello: 'world' } });
  check('echo', r.status === 200 && r.data.query.x === '1' && r.data.body.hello === 'world');
  r = await req('GET', '/api/status/418'); check('status 418', r.status === 418 && r.data.requestedStatus === 418);

  r = await req('GET', '/api/employees'); check('list without token 401', r.status === 401);
  r = await req('GET', '/api/employees', { token: user }); check('user can read; total 117', r.status === 200 && r.data.total === 117 && r.data.data.length === 117, r.data && r.data.total);
  const ceo = r.data.data.find((e) => e.managerId === null);
  check('single CEO root, manager null', !!ceo && ceo.title === 'Chief Executive Officer');
  const anIC = r.data.data.find((e) => e.title.includes('Engineer') && e.managerId);
  check('employee shape expanded (dept+manager)', !!anIC && anIC.department && anIC.manager, anIC);
  check('employee carries region+timezone+employmentType', !!anIC.region && !!anIC.timezone && !!anIC.employmentType, anIC);
  r = await req('POST', '/api/employees', { token: user, body: {} }); check('user cannot create 403', r.status === 403 && r.data.error.code === 'FORBIDDEN');
  r = await req('DELETE', '/api/employees/50', { token: user }); check('user cannot delete 403', r.status === 403);

  r = await req('GET', '/api/departments', { token: user });
  check('12 departments', r.status === 200 && r.data.total === 12);
  check('every department staffed', r.data.data.every((d) => d.headcount >= 1), r.data.data.map((d) => d.code + ':' + d.headcount));
  const engId = r.data.data.find((d) => d.code === 'ENG').id;

  r = await req('GET', '/api/employees?departmentId=' + engId, { token: user }); check('dept filter ENG', r.status === 200 && r.data.total >= 30);
  r = await req('GET', '/api/employees?departmentId=999', { token: user }); check('unknown dept filter 400', r.status === 400 && r.data.error.code === 'VALIDATION_ERROR');
  r = await req('GET', '/api/employees?search=engineer', { token: user }); check('search matches titles', r.status === 200 && r.data.total >= 10);
  r = await req('GET', '/api/employees?search=zzzznomatch', { token: user }); check('search empty ok', r.status === 200 && r.data.total === 0);

  r = await req('GET', '/api/employees/1', { token: user }); check('get CEO', r.status === 200 && r.data.managerId === null);
  r = await req('GET', '/api/employees/99999', { token: user }); check('get missing 404', r.status === 404 && r.data.error.code === 'EMPLOYEE_NOT_FOUND');
  r = await req('GET', '/api/employees/1/team', { token: user });
  check('CEO team: 6 direct, 116 total', r.status === 200 && r.data.directCount === 6 && r.data.totalCount === 116, { d: r.data.directCount, t: r.data.totalCount });
  r = await req('GET', '/api/employees/99999/team', { token: user }); check('team of missing 404', r.status === 404);
  const all = (await req('GET', '/api/employees', { token: user })).data.data;
  const mgrIds = new Set(all.filter((e) => e.managerId).map((e) => e.managerId));
  const ic = all.find((e) => !mgrIds.has(e.id));
  r = await req('GET', '/api/employees/' + ic.id + '/team', { token: user });
  check('IC team empty', r.status === 200 && r.data.directCount === 0 && r.data.totalCount === 0);

  r = await req('POST', '/api/employees', { token: admin, body: { firstname: 'X' } });
  check('create validation 400 details', r.status === 400 && Array.isArray(r.data.error.details) && r.data.error.details.length >= 3);
  const existingEmail = all[10].email;
  r = await req('POST', '/api/employees', { token: admin, body: { firstname: 'A', lastname: 'B', email: existingEmail, title: 'T', departmentId: engId } });
  check('duplicate email 409', r.status === 409 && r.data.error.code === 'DUPLICATE_EMAIL');
  r = await req('POST', '/api/employees', { token: admin, body: { firstname: 'A', lastname: 'B', email: 'unique.new@teamconnextions.dev', title: 'T', departmentId: 999 } });
  check('unknown dept 400', r.status === 400);
  r = await req('POST', '/api/employees', { token: admin, body: { firstname: 'New', lastname: 'Joiner', email: 'new.joiner@teamconnextions.dev', title: 'SDET', departmentId: engId, managerId: 1, location: 'Berlin', region: 'EMEA' } });
  check('create 201 + Location + id 118 + region', r.status === 201 && r.data.id === 118 && r.headers.get('location') === '/api/employees/118' && r.data.region === 'EMEA', { id: r.data.id, region: r.data.region });
  const newId = r.data.id;

  r = await req('PATCH', '/api/employees/' + newId, { token: admin, body: { title: 'Senior SDET' } });
  check('patch one field', r.status === 200 && r.data.title === 'Senior SDET');
  r = await req('PATCH', '/api/employees/' + newId, { token: admin, body: { region: 'APAC', employmentType: 'Contract' } });
  check('patch region + employmentType persists', r.status === 200 && r.data.region === 'APAC' && r.data.employmentType === 'Contract', { region: r.data.region, emp: r.data.employmentType });
  r = await req('PATCH', '/api/employees/' + newId, { token: admin, body: { managerId: newId } });
  check('own manager 400', r.status === 400);
  r = await req('PATCH', '/api/employees/' + newId, { token: admin, body: { email: existingEmail } });
  check('patch duplicate email 409', r.status === 409);
  r = await req('PATCH', '/api/employees/' + newId, { token: admin, body: { status: 'Vacation' } });
  check('bad status 400', r.status === 400);
  r = await req('PUT', '/api/employees/' + newId, { token: admin, body: { firstname: 'New', lastname: 'Joiner', email: 'new.joiner@teamconnextions.dev', title: 'QA Lead', departmentId: engId, managerId: 1, status: 'Active', location: 'Berlin' } });
  check('put full replace', r.status === 200 && r.data.title === 'QA Lead');

  r = await req('DELETE', '/api/employees/109', { token: admin });
  check('SELF delete 403 (admin=emp 109)', r.status === 403 && r.data.error.code === 'SELF_DELETE_FORBIDDEN');
  r = await req('DELETE', '/api/employees/1', { token: admin });
  check('CEO delete blocked without reassign', r.status === 409 && r.data.error.code === 'EMPLOYEE_HAS_REPORTS', r.data && r.data.error);
  check('409 message plain (no ?reassignTo jargon)', r.status === 409 && !/\?reassignTo=<employeeId>/.test(r.data.error.message), r.data.error.message);
  check('409 details reportIds + count', r.data.error.details.reportIds.length >= 6 && r.data.error.details.reportCount === r.data.error.details.reportIds.length, r.data.error.details);
  r = await req('DELETE', '/api/employees/1?reassignTo=99999', { token: admin });
  check('bad reassignTo 400', r.status === 400);
  r = await req('DELETE', '/api/employees/1?reassignTo=1', { token: admin });
  check('reassign to self 400', r.status === 400);
  r = await req('DELETE', '/api/employees/1?reassignTo=2', { token: admin });
  check('CEO deleted after reassign', r.status === 200 && r.data.deleted === true, r.data);
  r = await req('GET', '/api/employees/3', { token: admin });
  check('former CEO-report now reports to 2', r.status === 200 && r.data.managerId === 2, { m: r.data.managerId });
  r = await req('DELETE', '/api/employees/' + newId, { token: admin }); check('delete leaf', r.status === 200);
  r = await req('DELETE', '/api/employees/' + newId, { token: admin }); check('delete again 404', r.status === 404);

  await req('POST', '/api/reset');
  r = await req('GET', '/api/orgchart', { token: user });
  const root = r.data.data[0];
  check('org chart single root', r.status === 200 && r.data.data.length === 1 && root.managerId === null);
  check('CEO has 6 direct reports', root.reports.length === 6, root.reports.map((x) => x.title));
  r = await req('GET', '/api/stats', { token: user });
  check('stats totals', r.status === 200 && r.data.totalEmployees === 117 && r.data.totalDepartments === 12 && r.data.totalLocations === 12, r.data && { e: r.data.totalEmployees, d: r.data.totalDepartments, l: r.data.totalLocations });
  check('stats status split', r.data.active + r.data.onLeave === 117 && r.data.onLeave > 0);
  check('stats byDepartment sorted + all>=1', r.data.byDepartment[0].headcount >= r.data.byDepartment[11].headcount && r.data.byDepartment.every((d) => d.headcount >= 1));
  check('stats locations array desc', Array.isArray(r.data.locations) && r.data.locations.length === 12 && r.data.locations[0].count >= r.data.locations[11].count);
  check('stats byRegion 3', Object.keys(r.data.byRegion).length === 3);
  check('stats byEmployment', !!r.data.byEmployment['Full-time']);
  check('stats managers present', r.data.managers > 0);
  check('stats newHiresThisYear present + latestHireYear', typeof r.data.newHiresThisYear === 'number' && r.data.latestHireYear >= 2025);
  check('stats largest = Engineering', r.data.largestDepartment && r.data.largestDepartment.name === 'Engineering');

  // adding a hire dated today makes them the newest hire and bumps new-hires-this-year
  {
    const today = new Date().toISOString().slice(0, 10);
    const before = (await req('GET', '/api/stats', { token: user })).data.newHiresThisYear;
    await req('POST', '/api/employees', { token: admin, body: { firstname: 'Newest', lastname: 'Today', email: 'newest.today@teamconnextions.dev', title: 'SDET', departmentId: engId, managerId: 1, joinedOn: today } });
    const after = await req('GET', '/api/stats', { token: user });
    check('newest hire reflects today after add', after.data.newestHire.joinedOn === today, after.data.newestHire);
    check('new-hires-this-year increments', after.data.newHiresThisYear === before + 1, { before, after: after.data.newHiresThisYear });
    await req('POST', '/api/reset');
  }

  const rawRes = await fetch(BASE + '/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin }, body: '{nope' });
  check('invalid json 400', rawRes.status === 400 && (await rawRes.json()).error.code === 'INVALID_JSON');
  const big = await fetch(BASE + '/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin }, body: JSON.stringify({ x: 'a'.repeat(120 * 1024) }) });
  check('oversized body 413', big.status === 413);

  await req('POST', '/api/auth/logout', { token: user });
  r = await req('GET', '/api/employees', { token: user });
  check('token dead after logout', r.status === 401);

  console.log('\nPASS ' + pass + '  FAIL ' + failCount);
  failures.forEach((f) => console.log('  FAIL:', f));
  process.exit(failCount ? 1 : 0);
})().catch((e) => { console.error('Regression crashed:', e); process.exit(1); });
