import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'e2e correct horse 42';
export const uid = () => Math.random().toString(36).slice(2, 8);

export async function registerAndCreateOrg(page: Page, orgName = `E2E Org ${uid()}`) {
  const email = `e2e-${uid()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E User');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/onboarding');
  await page.getByLabel('Organisation name').fill(orgName);
  await page.getByRole('button', { name: /Create organisation/ }).click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  return { email, orgName };
}
