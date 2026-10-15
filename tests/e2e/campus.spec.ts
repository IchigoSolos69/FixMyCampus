import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test';

const password = 'CampusDemo!2026';
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Institutional email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: /hello,|campus overview/i }).first(),
  ).toBeVisible();
}
async function actor(browser: Browser, email: string) {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
  });
  const page = await context.newPage();
  await login(page, email);
  return { context, page };
}
async function chooseAction(page: Page, action: string, button: string) {
  await page.getByLabel('Action', { exact: true }).selectOption(action);
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByText('Complaint updated.', { exact: true })).toBeVisible();
}

test('browser reporting, triage, officer work, resolution, feedback, and reopening', async ({
  page,
  browser,
}) => {
  const contexts: BrowserContext[] = [];
  try {
    await login(page, 'student@campus.test');
    await page.goto('/complaints/new');
    await page.getByLabel('Issue category').selectOption({ label: 'Classroom Infrastructure' });
    await page.getByLabel('Location', { exact: true }).fill(`Browser classroom ${Date.now()}`);
    await page
      .getByLabel('Describe the issue')
      .fill('The classroom window does not close and requires a safe repair.');
    await page.getByRole('button', { name: 'Submit report', exact: true }).click();
    await expect(page).toHaveURL(/\/complaints\/\d+$/);
    const detailPath = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { name: /^CMP-\d{8}-\d{4}$/ })).toBeVisible();
    const incharge = await actor(browser, 'incharge@campus.test');
    contexts.push(incharge.context);
    await incharge.page.goto(detailPath);
    await chooseAction(incharge.page, 'verify', 'Verify report');
    await incharge.page.getByLabel('Action', { exact: true }).selectOption('assign');
    await incharge.page
      .getByLabel('Department', { exact: true })
      .selectOption({ label: 'Civil Engineering' });
    await incharge.page
      .getByLabel('Reason', { exact: true })
      .fill('Civil team to inspect and repair the frame.');
    await incharge.page.getByRole('button', { name: 'Assign department', exact: true }).click();
    await expect(incharge.page.getByText('Complaint updated.', { exact: true })).toBeVisible();
    const officer = await actor(browser, 'officer1@campus.test');
    contexts.push(officer.context);
    await officer.page.goto(detailPath);
    await chooseAction(officer.page, 'start', 'Start work');
    await officer.page.getByLabel('Action', { exact: true }).selectOption('progress');
    await officer.page
      .getByLabel('Progress update', { exact: true })
      .fill('The replacement window latch is ready.');
    await officer.page.getByRole('button', { name: 'Add progress update', exact: true }).click();
    await expect(officer.page.getByText('Complaint updated.', { exact: true })).toBeVisible();
    await officer.page.getByLabel('Action', { exact: true }).selectOption('resolve');
    await officer.page
      .getByLabel('Resolution summary', { exact: true })
      .fill('The latch was replaced and the window now closes securely.');
    await officer.page.getByRole('button', { name: 'Mark as resolved', exact: true }).click();
    await expect(
      officer.page.getByRole('heading', { name: 'Resolution summary', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'How was the resolution?', exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await page.getByRole('radio').last().check();
    await page
      .getByLabel('Tell us more (optional)')
      .fill('The repair team explained the work clearly.');
    await page.getByRole('button', { name: 'Submit feedback', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Reporter feedback', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Action', { exact: true }).selectOption('reopen');
    await page
      .getByLabel('What still needs attention?')
      .fill('The frame needs one additional safety inspection.');
    await page.getByRole('button', { name: 'Reopen complaint', exact: true }).click();
    await expect(page.getByText('Resolved → Assigned', { exact: true })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('critical anonymous reporting immediately routes to welfare without exposing identity', async ({
  page,
  browser,
}) => {
  await login(page, 'student@campus.test');
  await page.goto('/complaints/new');
  await page.getByLabel('Issue category').selectOption({ label: 'Mental Health Concerns' });
  await expect(
    page.getByText('Critical priority · Immediate routing', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Location', { exact: true }).fill('Private consultation requested');
  await page
    .getByLabel('Describe the issue')
    .fill('I would like a private appointment with the student welfare team.');
  await page.getByLabel('Submit anonymously').check();
  await page.getByRole('button', { name: 'Submit report', exact: true }).click();
  await expect(page).toHaveURL(/\/complaints\/\d+$/);
  const detailPath = new URL(page.url()).pathname;
  const incharge = await actor(browser, 'incharge@campus.test');
  try {
    await incharge.page.goto(detailPath);
    await expect(incharge.page.getByText('Anonymous reporter', { exact: true })).toBeVisible();
    await expect(
      incharge.page.getByText('Students Development and Welfare', { exact: true }).first(),
    ).toBeVisible();
    await expect(incharge.page.getByText('student@campus.test', { exact: true })).toHaveCount(0);
    await expect(incharge.page.getByText(/Critical$/).first()).toBeVisible();
  } finally {
    await incharge.context.close();
  }
});

test('dedicated urgent path offers only emergency categories and routes medical reports', async ({
  page,
}) => {
  await login(page, 'student@campus.test');
  await page.goto('/complaints/emergency');
  const categories = page.getByLabel('Issue category');
  await expect(categories.getByRole('option')).toHaveCount(5);
  await categories.selectOption({ label: 'Medical Emergencies' });
  await expect(page.getByLabel('Submit anonymously')).toHaveCount(0);
  await page.getByLabel('Location', { exact: true }).fill('Browser test medical routing location');
  await page
    .getByLabel('Describe the issue')
    .fill('Browser test only: reviewing the medical emergency routing path.');
  await page.getByRole('button', { name: 'Submit report', exact: true }).click();
  await expect(page).toHaveURL(/\/complaints\/\d+$/);
  await expect(page.getByText('Medical Services', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Critical$/).first()).toBeVisible();
  await expect(page.getByText('Submitted → Assigned', { exact: true })).toBeVisible();
});

test('mobile reporting form fits the viewport and primary inputs work by keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByLabel('Institutional email').focus();
  await page.keyboard.type('student@campus.test');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('link', { name: 'Report an issue', exact: true }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Report a campus issue', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel('Issue category').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Location', { exact: true })).toBeFocused();
});

test('administrator can inspect management and download CSV/PDF reports', async ({ page }) => {
  await login(page, 'admin@campus.test');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: /administration/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'People & access', exact: true })).toBeVisible();
  const department = `Browser support ${Date.now()}`;
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  await page.getByLabel('New department name').fill(department);
  await page.getByRole('button', { name: 'Add department', exact: true }).click();
  await expect(page.getByText(department, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Issue categories', exact: true }).click();
  const category = `Browser facility ${Date.now()}`;
  await page.getByLabel('New issue category').fill(category);
  await page.getByLabel('Default department', { exact: true }).selectOption({ label: department });
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  await expect(page.getByText(category, { exact: true })).toBeVisible();
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: /reports/i }).first()).toBeVisible();
  for (const format of ['CSV', 'PDF']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: new RegExp(format, 'i') }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
    expect(await file.failure()).toBeNull();
  }
});

test('registration and verification through captured email', async ({ page, request }) => {
  test.setTimeout(45000);
  const mailpit = process.env.E2E_MAILPIT_URL;
  test.skip(!mailpit, 'Set E2E_MAILPIT_URL=http://localhost:8025 for captured-email browser flow');
  const email = `browser-${Date.now()}@campus.test`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Browser New Student');
  await page.getByLabel('Institutional email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText(/Account created/)).toBeVisible();
  let token = '';
  await expect
    .poll(
      async () => {
        const messages = await (await request.get(`${mailpit}/api/v1/messages`)).json();
        const message = messages.messages?.find((item: any) =>
          item.To?.some((to: any) => to.Address === email),
        );
        if (!message) return false;
        const detail = await (await request.get(`${mailpit}/api/v1/message/${message.ID}`)).json();
        token = String(detail.Text || '').match(/verify-email\?token=([a-zA-Z0-9]+)/)?.[1] || '';
        return !!token;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await page.goto(`/verify-email?token=${token}`);
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(
    page.getByText('Your email is verified. You can now sign in.', { exact: true }),
  ).toBeVisible();
  await login(page, email);
});
