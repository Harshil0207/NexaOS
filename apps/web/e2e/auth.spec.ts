import { expect, test } from '@playwright/test';
import { PASSWORD, registerAndCreateOrg } from './helpers';

test('signed-out visitors are redirected to sign in', async ({ page }) => {
  await page.goto('/agents');
  await expect(page).toHaveURL(/\/login\?next=%2Fagents/);
});

test('invalid credentials show a clear error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.com');
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid email or password')).toBeVisible();
});

test('client-side validation blocks weak passwords', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill('X');
  await page.getByLabel('Work email').fill('x@example.com');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Use at least 12 characters')).toBeVisible();
});

test('register → organisation → sign out → session is invalid → sign back in', async ({
  page,
  context,
}) => {
  const { email, orgName } = await registerAndCreateOrg(page);
  await expect(page.getByRole('button', { name: 'Switch organisation' })).toContainText(orgName);
  const cookies = await context.cookies();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');
  // Replaying the old session cookie must not work.
  await context.addCookies(cookies);
  const res = await page.request.get('/api/v1/auth/me');
  expect(res.status()).toBe(401);
  await context.clearCookies();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
});
