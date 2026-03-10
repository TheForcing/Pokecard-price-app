import { expect, test } from '@playwright/test';

const SAMPLE_IMAGE_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
  'base64',
);

test.describe('Home flows', () => {
  test('upload -> recognize -> candidate select -> get price', async ({ page }) => {
    await page.route('**/recognize', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          best: {
            cardId: 'card-1',
            identityId: 'identity-1',
            name: 'Pikachu',
            confidence: 0.95,
            language: 'EN',
            setCode: 'sv1',
            number: '001',
            imageUrl: null,
          },
          candidates: [
            {
              cardId: 'card-1',
              identityId: 'identity-1',
              name: 'Pikachu',
              confidence: 0.95,
              language: 'EN',
              setCode: 'sv1',
              number: '001',
              imageUrl: null,
            },
          ],
          needsUserPick: false,
        }),
      });
    });

    await page.route('**/cards/**/prices**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cardId: 'identity-1',
          market: 'US',
          currency: 'USD',
          low: 12.34,
          high: 45.67,
          source: 'stub',
          fetchedAt: '2026-02-20T00:00:00.000Z',
        }),
      });
    });

    await page.goto('/');

    await page.getByLabel('Image').setInputFiles({
      name: 'card.png',
      mimeType: 'image/png',
      buffer: SAMPLE_IMAGE_BUFFER,
    });

    await page.getByRole('button', { name: 'Recognize' }).click();
    const candidatesSection = page.locator('section').filter({ hasText: 'Candidates' });
    await expect(candidatesSection.getByText('1. Pikachu')).toBeVisible();
    await candidatesSection.getByRole('button', { name: 'Select' }).first().click();
    await candidatesSection.getByRole('button', { name: 'Get Price' }).first().click();

    await expect(page.getByText('USD 12.34')).toBeVisible();
    await expect(page.getByText('USD 45.67')).toBeVisible();
  });

  test('ocr failure -> manual search -> get price', async ({ page }) => {
    await page.route('**/recognize', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });

    await page.route('**/cards/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'identity-manual-1',
              name: 'Charizard',
              language: 'EN',
              setCode: 'sv2',
              setName: 'Paldea Evolved',
              collectorNumber: '125',
              variant: 'HOLOFOIL',
              imageUrl: null,
            },
          ],
        }),
      });
    });

    await page.route('**/cards/**/prices**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cardId: 'identity-manual-1',
          market: 'US',
          currency: 'USD',
          low: 120,
          high: 199,
          source: 'stub',
          fetchedAt: '2026-02-20T00:00:00.000Z',
        }),
      });
    });

    await page.goto('/');

    await page.getByLabel('Image').setInputFiles({
      name: 'card.png',
      mimeType: 'image/png',
      buffer: SAMPLE_IMAGE_BUFFER,
    });

    await page.getByRole('button', { name: 'Recognize' }).click();
    await expect(
      page.getByText('Card recognition failed. Please retake the photo with clearer card boundaries.'),
    ).toBeVisible();

    await page.getByLabel('Name').fill('Charizard');
    await page.getByRole('button', { name: 'Search' }).click();
    const manualSection = page.locator('section').filter({ hasText: 'Manual Search' });
    await expect(manualSection.getByText('Charizard')).toBeVisible();
    await manualSection.getByRole('button', { name: 'Select' }).first().click();
    await manualSection.getByRole('button', { name: 'Get Price' }).first().click();

    await expect(page.getByText('USD 120')).toBeVisible();
    await expect(page.getByText('USD 199')).toBeVisible();
  });
});
