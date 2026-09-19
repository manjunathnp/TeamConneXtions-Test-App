import { test, expect, Page } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4100';

async function signIn(page: Page, username: string, password: string) {
  await page.goto(BASE + '/');
  await page.getByTestId('open-login').click();
  if (username === 'admin' && password === 'admin123') await page.getByTestId('quick-admin').click();
  else if (username === 'user' && password === 'user123') await page.getByTestId('quick-user').click();
  else {
    await page.getByTestId('login-username').fill(username);
    await page.getByTestId('login-password').fill(password);
    await page.getByTestId('auth-submit').click();
  }
  await expect(page.getByTestId('user-chip')).toBeVisible();
}

async function selectOptionMatching(page: Page, testId: string, label: RegExp) {
  const select = page.getByTestId(testId);
  const value = await select.locator('option').filter({ hasText: label }).first().getAttribute('value');
  expect(value, `option matching ${label} in ${testId}`).not.toBeNull();
  await select.selectOption(value!);
}

test.beforeEach(async ({ request }) => {
  await request.post(`${BASE}/api/reset`);
});

test('welcome shows Title Case hero, company snapshot and docs link', async ({ page }) => {
  await page.goto(BASE + '/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.locator('h1')).toContainText('Every Team, Every Reporting Line, One Directory');
  await expect(page.getByTestId('welcome-emp-count')).toHaveText('117');
  await expect(page.getByTestId('docs-link')).toHaveAttribute('href', '/docs.html');
});

test('admin signs in and sees 117 employees, paginated, with the Actions column', async ({ page }) => {
  await signIn(page, 'admin', 'admin123');
  await expect(page.getByTestId('user-name')).toHaveText('admin');
  await expect(page.getByTestId('employee-count')).toContainText('117');
  await expect(page.getByTestId('add-employee')).toBeVisible();
  await expect(page.locator('thead th', { hasText: 'Actions' })).toBeVisible();
  // paginated: 15 rows per page, pager visible
  await expect(page.getByTestId('employees-table').locator('tr')).toHaveCount(15);
  await expect(page.getByTestId('pager')).toBeVisible();
});

test('directory pagination navigates and jumps to a page', async ({ page }) => {
  await signIn(page, 'user', 'user123');
  await expect(page.getByTestId('page-1')).toHaveClass(/active/);
  await page.getByTestId('page-next').click();
  await expect(page.getByTestId('page-2')).toHaveClass(/active/);
  await page.getByTestId('page-jump-input').fill('8');
  await page.getByTestId('page-jump-go').click();
  await expect(page.getByTestId('page-8')).toHaveClass(/active/);
  await expect(page.getByTestId('page-next')).toBeDisabled();
  await page.getByTestId('page-prev').click();
  await expect(page.getByTestId('page-7')).toHaveClass(/active/);
});

test('every directory column header sorts', async ({ page }) => {
  await signIn(page, 'user', 'user123');
  for (const key of ['name', 'title', 'department', 'location', 'status', 'team']) {
    await expect(page.getByTestId('sort-' + key)).toBeVisible();
  }
  // sort by name ascending then descending, first cell changes
  await page.getByTestId('sort-name').click();
  const firstAsc = await page.locator('[data-testid^="cell-name-"]').first().textContent();
  await page.getByTestId('sort-name').click();
  const firstDesc = await page.locator('[data-testid^="cell-name-"]').first().textContent();
  expect(firstAsc).not.toBe(firstDesc);
});

test('Actions stays fully visible while every column is sorted at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await signIn(page, 'admin', 'admin123');
  const scroller = page.getByTestId('directory-table-scroll');
  await expect(scroller).toBeVisible();

  for (const key of ['name', 'title', 'department', 'location', 'status', 'team']) {
    for (let direction = 0; direction < 2; direction += 1) {
      await page.getByTestId(`sort-${key}`).click();
      const bounds = await scroller.boundingBox();
      const actionBounds = await page.locator('tbody td.actions').first().boundingBox();
      expect(bounds).not.toBeNull();
      expect(actionBounds).not.toBeNull();
      expect(actionBounds!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
      expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
      const teamBounds = await page.getByTestId('sort-team').boundingBox();
      expect(teamBounds).not.toBeNull();
      expect(teamBounds!.x + teamBounds!.width).toBeLessThanOrEqual(actionBounds!.x + 1);
      await expect(page.getByTestId('sort-team')).toBeVisible();
      await expect(page.locator('[data-testid^="edit-"]').first()).toBeVisible();
      await expect(page.locator('[data-testid^="delete-"]').first()).toBeVisible();
    }
  }
});

test('department filter options are sorted alphabetically', async ({ page }) => {
  await signIn(page, 'user', 'user123');
  const opts = await page.getByTestId('department-filter').locator('option').allTextContents();
  const named = opts.slice(1).map((o) => o.replace(/\s*\(\d+\)\s*$/, '')); // drop the "All" + counts
  const sorted = [...named].sort((a, b) => a.localeCompare(b));
  expect(named).toEqual(sorted);
});

test('read-only user has NO Actions column and no write controls', async ({ page }) => {
  await signIn(page, 'user', 'user123');
  await expect(page.getByTestId('readonly-note')).toBeVisible();
  await expect(page.getByTestId('add-employee')).toHaveCount(0);
  await expect(page.locator('thead th', { hasText: 'Actions' })).toHaveCount(0);
  await expect(page.locator('[data-testid^="edit-"]')).toHaveCount(0);
});

test('department badge has no leading bullet dot', async ({ page }) => {
  await signIn(page, 'user', 'user123');
  const badge = page.locator('[data-testid^="cell-dept-"]').first();
  const before = await badge.evaluate((el) => getComputedStyle(el, '::before').content);
  expect(['none', '', 'normal']).toContain(before);
});

test('search and department filter narrow the table', async ({ page }) => {
  await signIn(page, 'admin', 'admin123');
  await page.getByTestId('employee-search').fill('Chief Executive');
  await expect(page.getByTestId('employee-count')).toContainText('1 of 117');
  await page.getByTestId('employee-search').fill('');
  await selectOptionMatching(page, 'department-filter', /^Engineering/);
  await expect(page.getByTestId('employee-count')).not.toContainText('117 of 117');
});

test('name opens detail; manager shows a clear value and email is plain text', async ({ page }) => {
  await signIn(page, 'user', 'user123');
  await page.getByTestId('employee-search').fill('Chief Executive Officer');
  await page.getByTestId('cell-name-1').click(); // the CEO
  await expect(page.getByTestId('employee-detail-modal')).toBeVisible();
  await expect(page.getByTestId('detail-team')).toBeHidden();
  await expect(page.locator('#detailGrid')).toContainText('top of the org');
  const email = page.getByTestId('detail-email');
  expect(await email.evaluate((n) => n.closest('a') === null && n.querySelector('a') === null)).toBe(true);
});

test('employee detail Team tab groups reports by department, collapsible', async ({ page }) => {
  await signIn(page, 'user', 'user123');
  await page.getByTestId('employee-search').fill('Chief Executive Officer');
  await page.getByTestId('cell-name-1').click();
  await page.getByTestId('detail-tab-team').click();
  await expect(page.getByTestId('detail-team-summary')).toContainText('6');
  await expect(page.getByTestId('reportees-detail-direct')).toBeVisible();
  const firstGroup = page.getByTestId('rgroup-detail-direct-0');
  await expect(firstGroup).toBeVisible();
});

test('add form has an editable date of joining defaulting to today', async ({ page }) => {
  await signIn(page, 'admin', 'admin123');
  await page.getByTestId('add-employee').click();
  const today = new Date().toISOString().slice(0, 10);
  await expect(page.getByTestId('field-joined')).toHaveValue(today);
  await page.getByTestId('field-joined').fill('2026-01-15');
  await expect(page.getByTestId('field-joined')).toHaveValue('2026-01-15');
});

test('directory reportees expander opens inline, grouped by department', async ({ page }) => {
  await signIn(page, 'user', 'user123');
  await page.getByTestId('employee-search').fill('Chief Executive Officer');
  await page.getByTestId('team-toggle-1').click();
  await expect(page.getByTestId('team-row-1')).toBeVisible();
  await expect(page.getByTestId('team-inline-1')).toContainText('manages 6 directly');
  await expect(page.getByTestId('reportees-inline-1')).toBeVisible();
  await page.getByTestId('team-toggle-1').click();
  await expect(page.getByTestId('team-row-1')).toHaveCount(0);
});

test('admin adds, edits and deletes a leaf employee', async ({ page }) => {
  await signIn(page, 'admin', 'admin123');
  await page.getByTestId('add-employee').click();
  await page.getByTestId('field-firstname').fill('Testa');
  await page.getByTestId('field-lastname').fill('Automation');
  await page.getByTestId('field-email').fill('testa.automation@teamconnextions.dev');
  await page.getByTestId('field-title').fill('QA Analyst');
  await selectOptionMatching(page, 'field-department', /^Quality Engineering$/);
  await page.getByTestId('save-employee').click();
  await expect(page.getByTestId('employee-count')).toContainText('118');
  // surface the new hire (id 118) regardless of sort/page
  await page.getByTestId('employee-search').fill('Testa Automation');
  await page.getByTestId('edit-118').click();
  await page.getByTestId('field-title').fill('Senior QA Analyst');
  await page.getByTestId('save-employee').click();
  await page.getByTestId('employee-search').fill('Testa Automation');
  await expect(page.getByTestId('cell-title-118')).toHaveText('Senior QA Analyst');
  await page.getByTestId('delete-118').click();
  await page.getByTestId('confirm-delete').click();
  await expect(page.getByTestId('employee-count')).toContainText('117');
});

test('admin cannot delete their own record (button disabled)', async ({ page }) => {
  await signIn(page, 'admin', 'admin123');
  await page.getByTestId('employee-search').fill('People'); // narrow toward id 109
  await expect(page.getByTestId('delete-109')).toBeDisabled();
});

test('deleting a manager offers Move team & delete and reassigns', async ({ page }) => {
  await signIn(page, 'admin', 'admin123');
  await page.getByTestId('employee-search').fill('Chief Executive Officer'); // surface the CEO row
  await page.getByTestId('delete-1').click(); // the CEO, has reports
  await expect(page.getByTestId('confirm-modal')).toContainText('manages');
  await expect(page.getByTestId('reassign-select')).toBeVisible();
  await page.getByTestId('confirm-delete').click();
  await expect(page.getByTestId('toast')).toContainText('Team moved and employee deleted');
});

test('org chart is an indented tree with expand/collapse', async ({ page }) => {
  await signIn(page, 'user', 'user123');
  await page.getByTestId('nav-orgchart').click();
  await expect(page.getByTestId('org-tree')).toBeVisible();
  await expect(page.getByTestId('org-node-1')).toContainText('Chief Executive Officer');
  await expect(page.getByTestId('org-count-1')).toHaveText('6');
  await page.getByTestId('org-expand-all').click();
  expect(await page.locator('.org-row').count()).toBeGreaterThan(20);
  await page.getByTestId('org-collapse-all').click();
  // after collapse, only the CEO row remains at minimum
  expect(await page.locator('.org-row').count()).toBeLessThan(10);
  // toggling a caret expands one level
  await page.getByTestId('org-toggle-1').click();
  await expect(page.getByTestId('org-node-2')).toBeVisible();
});

test('insights shows working department and location bars', async ({ page }) => {
  await signIn(page, 'user', 'user123');
  await page.getByTestId('nav-insights').click();
  await expect(page.getByTestId('stat-total')).toContainText('117');
  await expect(page.getByTestId('stat-locations')).toContainText('12');
  await expect(page.getByTestId('stat-newhires')).toBeVisible();
  await expect(page.getByTestId('dept-distribution')).toContainText('Headcount by Department');
  await expect(page.getByTestId('by-location')).toContainText('People by Location');
  const width = await page.locator('[data-testid="dept-distribution"] .bar-fill').first()
    .evaluate((el) => (el as HTMLElement).style.width);
  expect(width).not.toBe('');
  await expect(page.getByTestId('by-region')).toContainText('APAC');
  await expect(page.getByTestId('by-employment')).toContainText('Full-time');
});

test('adding a hire dated today updates Newest Hire and New Hires This Year', async ({ page }) => {
  await signIn(page, 'admin', 'admin123');
  await page.getByTestId('nav-insights').click();
  const before = Number((await page.getByTestId('stat-newhires').locator('.val').textContent()) || '0');
  await page.getByTestId('nav-directory').click();
  await page.getByTestId('add-employee').click();
  await page.getByTestId('field-firstname').fill('Newest');
  await page.getByTestId('field-lastname').fill('Today');
  await page.getByTestId('field-email').fill('newest.today@teamconnextions.dev');
  await page.getByTestId('field-title').fill('SDET');
  await selectOptionMatching(page, 'field-department', /^Engineering$/);
  // join date defaults to today; leave as-is
  await page.getByTestId('save-employee').click();
  await page.getByTestId('nav-insights').click();
  const after = Number((await page.getByTestId('stat-newhires').locator('.val').textContent()) || '0');
  expect(after).toBe(before + 1);
  await expect(page.getByTestId('stat-newest')).toContainText('Newest');
});

test('settings drawer sits at far right, tests API and resets with a warning', async ({ page }) => {
  await page.goto(BASE + '/');
  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-drawer')).toBeVisible();
  await page.getByTestId('settings-test-api').click();
  await expect(page.getByTestId('ping-status')).toContainText('Connected');
  // reset now asks for confirmation first
  await page.getByTestId('settings-reset').click();
  await expect(page.getByTestId('reset-modal')).toBeVisible();
  await page.getByTestId('reset-cancel').click();
  await expect(page.getByTestId('reset-modal')).toBeHidden();
  await page.getByTestId('settings-reset').click();
  await page.getByTestId('reset-confirm').click();
  await expect(page.getByTestId('reset-status')).toContainText('117 employees');
});

test('add/edit form has Region and Employment Type, and they persist', async ({ page }) => {
  await signIn(page, 'admin', 'admin123');
  await page.getByTestId('add-employee').click();
  await page.getByTestId('field-firstname').fill('Region');
  await page.getByTestId('field-lastname').fill('Person');
  await page.getByTestId('field-email').fill('region.person@teamconnextions.dev');
  await page.getByTestId('field-title').fill('SDET');
  await selectOptionMatching(page, 'field-department', /^Engineering$/);
  await page.getByTestId('field-region').selectOption('EMEA');
  await page.getByTestId('field-employment').selectOption('Contract');
  await page.getByTestId('save-employee').click();
  await page.getByTestId('employee-search').fill('Region Person');
  await page.getByTestId('cell-name-118').click();
  await expect(page.getByTestId('employee-detail-modal')).toContainText('EMEA');
  await expect(page.getByTestId('employee-detail-modal')).toContainText('Contract');
});

test('login password field does not trigger a browser credential save (masked text input)', async ({ page }) => {
  await page.goto(BASE + '/');
  await page.getByTestId('open-login').click();
  const type = await page.getByTestId('login-password').getAttribute('type');
  expect(type).toBe('text'); // masked via CSS, so Chrome never offers to save it
  await expect(page.getByTestId('login-password')).toHaveClass(/masked/);
});

test('refreshing the page keeps the user signed in', async ({ page }) => {
  await signIn(page, 'admin', 'admin123');
  await page.reload();
  await expect(page.getByTestId('user-chip')).toBeVisible();
  await expect(page.getByTestId('user-name')).toHaveText('admin');
});

test('playground works and has the data table instead of downloads', async ({ page }) => {
  await page.goto(BASE + '/#/playground');
  await expect(page.getByTestId('playground')).toBeVisible();
  await expect(page.getByTestId('pg-downloads')).toHaveCount(0);
  await expect(page.getByTestId('pg-datatable')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('pg-confirm').click();
  await expect(page.getByTestId('pg-dialog-out')).toHaveText('confirmed');
  await page.getByTestId('pg-shadow-button').click();
  await expect(page.getByTestId('pg-shadow-out')).toHaveText('1');
});

test('playground data table sorts and paginates', async ({ page }) => {
  await page.goto(BASE + '/#/playground');
  await expect(page.getByTestId('pg-pageinfo')).toContainText('Page 1 of');
  const firstBefore = await page.getByTestId('pg-cell-name-0').textContent();
  await page.getByTestId('pg-th-score').click(); // sort ascending by score
  const firstAfter = await page.getByTestId('pg-cell-name-0').textContent();
  expect(firstAfter).not.toBe(firstBefore);
  await page.getByTestId('pg-next').click();
  await expect(page.getByTestId('pg-pageinfo')).toContainText('Page 2 of');
  await page.getByTestId('pg-prev').click();
  await expect(page.getByTestId('pg-pageinfo')).toContainText('Page 1 of');
});

test('playground accordion opens one panel at a time', async ({ page }) => {
  await page.goto(BASE + '/#/playground');
  await expect(page.getByTestId('pg-accordion')).toBeVisible();
  // first panel open by default
  await expect(page.getByTestId('acc-head-0')).toHaveAttribute('aria-expanded', 'true');
  await page.getByTestId('acc-head-1').click();
  await expect(page.getByTestId('acc-head-1')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('acc-head-0')).toHaveAttribute('aria-expanded', 'false');
});

test('playground iframe interaction', async ({ page }) => {
  await page.goto(BASE + '/#/playground');
  const frame = page.frameLocator('[data-testid="pg-iframe"]');
  await frame.getByTestId('pg-frame-btn').click();
  await expect(frame.getByTestId('pg-frame-out')).toHaveText('clicked');
});

test('docs page links back to the app and authorizes', async ({ page }) => {
  await page.goto(BASE + '/docs.html');
  await expect(page.getByTestId('open-app-link')).toHaveAttribute('href', '/');
  await page.getByTestId('authorize-btn').click();
  await page.getByTestId('docs-login-admin').click();
  await expect(page.getByTestId('docs-login-status')).toContainText('Signed in as admin');
});
