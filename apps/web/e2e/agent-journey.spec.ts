import { expect, test } from '@playwright/test';
import { registerAndCreateOrg } from './helpers';

/**
 * Primary journey: create an order, build a Support Agent with getOrder, publish, run it
 * from the test console and inspect the execution and audit trail.
 * With E2E_EXPECT_LLM=1 (a real provider key configured) the run must complete with the
 * order's real data. Without it, the run must fail visibly with PROVIDER_NOT_CONFIGURED.
 */
test('build, publish and run a Support Agent end-to-end', async ({ page }) => {
  test.setTimeout(120_000);
  await registerAndCreateOrg(page);

  // Business data the tool will read.
  await page.getByRole('link', { name: 'Business data' }).click();
  await page.getByRole('button', { name: 'Customer', exact: true }).click();
  await page.getByLabel('Name').fill('Jane Cooper');
  await page.getByLabel('Email').fill('jane@example.com');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText('Customer added')).toBeVisible();
  await page.getByRole('button', { name: 'Order', exact: true }).click();
  await page.getByLabel('Order number').fill('1234');
  await page.getByLabel('Status').selectOption('SHIPPED');
  await page.getByLabel('Total (USD)').fill('129.99');
  await page.getByLabel('Carrier').fill('UPS');
  await page.getByLabel('Tracking number').fill('1Z999AA10123456784');
  await page.getByRole('button', { name: 'Add order' }).click();
  await expect(page.getByRole('cell', { name: '#1234' })).toBeVisible();

  // Agent.
  await page.getByRole('link', { name: 'Agents' }).click();
  await page.getByRole('button', { name: 'New agent' }).click();
  await page.getByLabel('Name').fill('Support Agent');
  await page.getByRole('button', { name: 'Create agent' }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]+\?section=instructions/);
  await page
    .getByLabel('System instructions')
    .fill(
      'You are the Acme support agent. Always use getOrder to answer order questions and quote status, carrier and tracking number.',
    );
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('switch', { name: 'Attach Get order' }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published v1')).toBeVisible();

  // Test console run against the published version.
  await page.getByRole('radio', { name: 'Published' }).click();
  await page.getByLabel('Message').fill('Where is order #1234?');
  await page.getByRole('button', { name: 'Run agent' }).click();
  const console_ = page.getByRole('region', { name: 'Test console' });
  await expect(console_.getByText('Agent started')).toBeVisible();

  if (process.env.E2E_EXPECT_LLM === '1') {
    await expect(console_.getByText('Tool result · getOrder')).toBeVisible({ timeout: 60_000 });
    await expect(console_.getByText('Response')).toBeVisible({ timeout: 60_000 });
    await expect(console_).toContainText(/UPS|1Z999AA10123456784/);
    await expect(console_.getByText('Completed').first()).toBeVisible();
  } else {
    await expect(console_.getByText('PROVIDER_NOT_CONFIGURED').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(console_.getByText('Failed').first()).toBeVisible();
    await expect(console_.getByText('Response')).toHaveCount(0); // never claims success
  }

  // Execution detail + audit trail.
  await console_.getByRole('link', { name: 'Details' }).click();
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await expect(page.getByText('Where is order #1234?')).toBeVisible();
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByRole('cell', { name: 'agent.published' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'execution.started' })).toBeVisible();

  // Dashboard reflects the run from real data.
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('cell', { name: 'Support Agent' })).toBeVisible();
});
