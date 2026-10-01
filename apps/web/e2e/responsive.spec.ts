import { expect, test } from '@playwright/test';
import { registerAndCreateOrg } from './helpers';

test('mobile layout: navigation drawer and no horizontal scroll', async ({ page }) => {
  await registerAndCreateOrg(page);
  for (const path of [
    '/dashboard',
    '/agents',
    '/executions',
    '/records',
    '/members',
    '/settings',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Agents' }).click();
  await expect(page).toHaveURL(/\/agents$/);
});
