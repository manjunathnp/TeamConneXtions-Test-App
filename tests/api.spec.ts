import { test, expect, APIRequestContext } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4100';

async function login(request: APIRequestContext, username: string, password: string) {
  const res = await request.post(`${BASE}/api/auth/login`, { data: { username, password } });
  expect(res.status()).toBe(200);
  return (await res.json()).token as string;
}

test.describe('TeamConneXtions API', () => {
  let admin: string;
  let user: string;

  test.beforeAll(async ({ request }) => {
    await request.post(`${BASE}/api/reset`);
    admin = await login(request, 'admin', 'admin123');
    user = await login(request, 'user', 'user123');
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${BASE}/api/reset`);
  });

  test('ping is public and healthy', async ({ request }) => {
    const res = await request.get(`${BASE}/api/ping`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.app).toBe('TeamConneXtions');
    expect(res.headers()['x-request-id']).toBeTruthy();
  });

  test('public overview needs no token', async ({ request }) => {
    const res = await request.get(`${BASE}/api/overview`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.totalEmployees).toBe(117);
    expect(body.totalLocations).toBe(12);
    expect(body.managers).toBeGreaterThan(0);
  });

  test('docs are served at /docs and /docs.html', async ({ request }) => {
    for (const path of ['/docs', '/docs.html']) {
      const res = await request.get(`${BASE}${path}`);
      expect(res.status(), path).toBe(200);
      expect(await res.text()).toContain('API Reference');
    }
  });

  test('brand assets are served with the correct image type', async ({ request }) => {
    for (const path of ['/assets/teamconnextions-logo-dark.png', '/assets/teamconnextions-icon.png', '/favicon.ico']) {
      const res = await request.get(`${BASE}${path}`);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['content-type'], path).toBe('image/png');
      expect((await res.body()).byteLength, path).toBeGreaterThan(1_000);
    }
  });

  test('unknown routes return the standard 404 envelope', async ({ request }) => {
    const res = await request.get(`${BASE}/definitely-not-a-route`);
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('ROUTE_NOT_FOUND');
  });

  test('listing needs a token; user reads all 117', async ({ request }) => {
    expect((await request.get(`${BASE}/api/employees`)).status()).toBe(401);
    const res = await request.get(`${BASE}/api/employees`, { headers: { Authorization: `Bearer ${user}` } });
    const body = await res.json();
    expect(body.total).toBe(117);
    expect(body.data[0].department).toBeTruthy();
  });

  test('twelve departments, all staffed', async ({ request }) => {
    const res = await request.get(`${BASE}/api/departments`, { headers: { Authorization: `Bearer ${user}` } });
    const body = await res.json();
    expect(body.total).toBe(12);
    for (const dept of body.data) expect(dept.headcount, dept.name).toBeGreaterThanOrEqual(1);
  });

  test('an employee team endpoint returns direct + skip-level counts', async ({ request }) => {
    const res = await request.get(`${BASE}/api/employees/1/team`, { headers: { Authorization: `Bearer ${user}` } });
    const body = await res.json();
    expect(body.directCount).toBe(6);
    expect(body.totalCount).toBe(116);
  });

  test('read-only user cannot write', async ({ request }) => {
    const res = await request.post(`${BASE}/api/employees`, { headers: { Authorization: `Bearer ${user}` }, data: {} });
    expect(res.status()).toBe(403);
  });

  test('create, patch and delete a leaf', async ({ request }) => {
    const created = await request.post(`${BASE}/api/employees`, {
      headers: { Authorization: `Bearer ${admin}` },
      data: { firstname: 'Test', lastname: 'Person', email: 'test.person@teamconnextions.dev', title: 'Intern', departmentId: 2, managerId: 1 },
    });
    expect(created.status()).toBe(201);
    const emp = await created.json();
    expect(created.headers()['location']).toBe(`/api/employees/${emp.id}`);
    const patched = await request.patch(`${BASE}/api/employees/${emp.id}`, { headers: { Authorization: `Bearer ${admin}` }, data: { title: 'Senior Intern' } });
    expect((await patched.json()).title).toBe('Senior Intern');
    expect((await request.delete(`${BASE}/api/employees/${emp.id}`, { headers: { Authorization: `Bearer ${admin}` } })).status()).toBe(200);
  });

  test('validation failures name the field', async ({ request }) => {
    const res = await request.post(`${BASE}/api/employees`, { headers: { Authorization: `Bearer ${admin}` }, data: { firstname: 'Only' } });
    expect(res.status()).toBe(400);
    const fields = (await res.json()).error.details.map((d: any) => d.field);
    expect(fields).toContain('lastname');
    expect(fields).toContain('email');
    expect(fields).toContain('departmentId');
  });

  test('admin cannot delete their own record', async ({ request }) => {
    const me = await request.get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${admin}` } });
    const { employeeId } = await me.json();
    const res = await request.delete(`${BASE}/api/employees/${employeeId}`, { headers: { Authorization: `Bearer ${admin}` } });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe('SELF_DELETE_FORBIDDEN');
  });

  test('deleting a manager needs reassignTo; message is plain', async ({ request }) => {
    const blocked = await request.delete(`${BASE}/api/employees/1`, { headers: { Authorization: `Bearer ${admin}` } });
    expect(blocked.status()).toBe(409);
    const body = await blocked.json();
    expect(body.error.code).toBe('EMPLOYEE_HAS_REPORTS');
    expect(body.error.message).not.toContain('?reassignTo=<employeeId>');
    expect(body.error.details.reportIds.length).toBe(6);
    const ok = await request.delete(`${BASE}/api/employees/1?reassignTo=2`, { headers: { Authorization: `Bearer ${admin}` } });
    expect(ok.status()).toBe(200);
    const moved = await request.get(`${BASE}/api/employees/3`, { headers: { Authorization: `Bearer ${admin}` } });
    expect((await moved.json()).managerId).toBe(2);
  });

  test('org chart has one root with six directs', async ({ request }) => {
    const res = await request.get(`${BASE}/api/orgchart`, { headers: { Authorization: `Bearer ${user}` } });
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].reports.length).toBe(6);
  });

  test('stats expose the new dimensions', async ({ request }) => {
    const res = await request.get(`${BASE}/api/stats`, { headers: { Authorization: `Bearer ${user}` } });
    const body = await res.json();
    expect(body.totalEmployees).toBe(117);
    expect(body.totalLocations).toBe(12);
    expect(body.locations.length).toBe(12);
    expect(Object.keys(body.byRegion).length).toBe(3);
    expect(body.byEmployment['Full-time']).toBeGreaterThan(0);
    expect(body.largestDepartment.name).toBe('Engineering');
  });

  test('api key and basic auth practice endpoints', async ({ request }) => {
    expect((await request.get(`${BASE}/api/auth/apikey`)).status()).toBe(401);
    expect((await request.get(`${BASE}/api/auth/apikey`, { headers: { 'X-API-Key': 'teamconnex-key-2026' } })).status()).toBe(200);
    const basic = await request.get(`${BASE}/api/auth/basic`, { headers: { Authorization: 'Basic ' + Buffer.from('connex:basic123').toString('base64') } });
    expect(basic.status()).toBe(200);
  });
});
