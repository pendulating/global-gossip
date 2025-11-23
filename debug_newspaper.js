
import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:8925');
  
  // Wait for the newspaper to be visible (it's in the DOM structure)
  // We can wait for the canvas element or specific text
  await page.waitForTimeout(2000); // Give it a moment to render Three.js

  await page.screenshot({ path: 'debug_screenshot.png' });
  
  // Get the bounding box of the newspaper container
  const newspaperContainer = await page.$('div[style*="width: 800px"]');
  if (newspaperContainer) {
    const box = await newspaperContainer.boundingBox();
    console.log('Newspaper Container BBox:', box);
  } else {
    console.log('Newspaper container not found');
  }

  // Get viewport size
  const viewport = page.viewportSize();
  console.log('Viewport:', viewport);

  await browser.close();
})();

