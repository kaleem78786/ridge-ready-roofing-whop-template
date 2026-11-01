import { chromium } from 'playwright';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

fs.mkdirSync('output/video-record', { recursive: true });

console.log('Launching browser for screen recording...');
const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/google/chrome/chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
});

const context = await browser.newContext({
  recordVideo: {
    dir: 'output/video-record/',
    size: { width: 1280, height: 720 }
  },
  viewport: { width: 1280, height: 720 }
});

const page = await context.newPage();

async function smoothScroll(targetY, durationMs = 1500) {
  await page.evaluate(async ({ targetY, durationMs }) => {
    const startY = window.scrollY;
    const diff = targetY - startY;
    const startTime = performance.now();
    return new Promise(resolve => {
      function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / durationMs, 1);
        const ease = 0.5 - Math.cos(progress * Math.PI) / 2;
        window.scrollTo(0, startY + diff * ease);
        if (progress < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }, { targetY, durationMs });
  await page.waitForTimeout(durationMs + 300);
}

// ----------------------------------------------------
// SECTION 1: LIVE WEBSITE OVERVIEW (0:00 - 0:45)
// ----------------------------------------------------
console.log('Step 1: Visiting live website via whop.app entry...');
await page.goto('https://ridge-ready-roofing-kaleem.whop.app/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Hero view
console.log('Navigating hero...');
await page.waitForTimeout(4000);

// Scroll down to Services section
console.log('Viewing services ($149 Inspection, $399 Tune-up, $500 Deposit)...');
await smoothScroll(650, 2000);
await page.waitForTimeout(4000);

// Hover over Inspection
const inspCard = page.locator('[data-service="inspection"]');
if (await inspCard.count()) {
  await inspCard.hover();
  await page.waitForTimeout(2500);
}

// Hover over Tune-up
const repairCard = page.locator('[data-service="repair"]');
if (await repairCard.count()) {
  await repairCard.hover();
  await page.waitForTimeout(2500);
}

// Hover over Replacement ($500 deposit)
const depCard = page.locator('[data-service="deposit"]');
if (await depCard.count()) {
  await depCard.hover();
  await page.waitForTimeout(3000);
}

// Scroll to Service Area & Financing
console.log('Viewing Service Areas and Financing callout...');
await smoothScroll(1400, 2000);
await page.waitForTimeout(4500);

// Scroll to Reviews / Testimonials
console.log('Viewing customer reviews & trust ratings...');
await smoothScroll(2100, 2000);
await page.waitForTimeout(4500);

// ----------------------------------------------------
// SECTION 2: REQUEST AN ESTIMATE -> WHOP LEADS API (0:45 - 1:30)
// ----------------------------------------------------
console.log('Step 2: Viewing Request an Estimate form wired to Whop Leads API...');
await smoothScroll(2800, 2000);
await page.waitForTimeout(3500);

// Show form fields
console.log('Demonstrating estimate lead form...');
const nameInput = page.locator('input[name="name"]');
if (await nameInput.count() && await nameInput.isVisible()) {
  await nameInput.fill('Whop QA Demo');
  await page.waitForTimeout(1000);
  await page.locator('input[name="email"]').fill('devops.llm.kaleem@gmail.com');
  await page.waitForTimeout(1000);
  await page.locator('input[name="phone"]').fill('(919) 555-0123');
  await page.waitForTimeout(1000);
  await page.locator('input[name="zip"]').fill('27601');
  await page.waitForTimeout(1000);
  await page.locator('input[name="address"]').fill('100 Demo Lane, Raleigh, NC');
  await page.waitForTimeout(1000);
  await page.locator('select[name="service"]').selectOption('replacement');
  await page.waitForTimeout(1000);
  await page.locator('textarea[name="message"]').fill('Comprehensive roof inspection and full replacement quote requested.');
  await page.waitForTimeout(1500);
  await page.locator('input[name="consent"]').check();
  await page.waitForTimeout(3000);
}

// ----------------------------------------------------
// SECTION 3: TEST CHECKOUT WITH PAYMENT ELEMENTS (1:30 - 2:30)
// ----------------------------------------------------
console.log('Step 3: Navigating to Sandbox Test Checkout...');
await page.goto('https://ridge-ready-roofing-kaleem.whop.site/sandbox', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Scroll to deposit plan
await smoothScroll(650, 1500);
await page.waitForTimeout(2000);

// Open Deposit Checkout
console.log('Opening $500 Deposit Checkout with Whop Payment Elements...');
const reserveBtn = page.getByRole('button', { name: 'Reserve your project' });
await reserveBtn.click();
await page.waitForTimeout(2000);

// Check written agreement consent
const agreeCheckbox = page.getByRole('dialog').getByRole('checkbox');
if (await agreeCheckbox.count()) {
  await agreeCheckbox.check();
  await page.waitForTimeout(1500);
}

// Continue to payment surface
const continueBtn = page.getByRole('button', { name: 'Continue to payment' });
if (await continueBtn.count()) {
  await continueBtn.click();
  await page.waitForTimeout(3000);
}

// Click Card & available financing
const cardSurfaceBtn = page.getByRole('button', { name: 'Card & available financing' });
if (await cardSurfaceBtn.count() && await cardSurfaceBtn.isVisible()) {
  await cardSurfaceBtn.click();
  await page.waitForTimeout(3000);
}

// Show the Whop Payment Elements modal: BrandingElement, ExpressCheckout, Card fields
console.log('Displaying Whop Payment Elements with BrandingElement...');
await page.waitForTimeout(8000);

// Close checkout modal
const closeBtn = page.getByRole('button', { name: 'Close checkout' });
if (await closeBtn.count()) {
  await closeBtn.click();
  await page.waitForTimeout(2000);
}

// ----------------------------------------------------
// SECTION 4: OWNER OPERATIONS DESK & INVOICE FLOW (2:30 - 3:20)
// ----------------------------------------------------
console.log('Step 4: Navigating to Owner Operations Desk (/sandbox/operations)...');
await page.goto('https://ridge-ready-roofing-kaleem.whop.site/sandbox/operations', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Log in as owner
console.log('Authenticating owner...');
const pwdInput = page.locator('input[type="password"]');
if (await pwdInput.count() && await pwdInput.isVisible()) {
  await pwdInput.fill('s1ZucUcuVm00LwfhLZY8aHItIYCVaO7V');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.waitForTimeout(3000);
}

// Show Estimate requests table read from Whop Leads API
console.log('Viewing Estimate requests table (live Whop Leads)...');
await smoothScroll(200, 1000);
await page.waitForTimeout(5000);

// Show Project deposits table
console.log('Viewing Project deposits table ($500 paid deposit)...');
await smoothScroll(650, 1500);
await page.waitForTimeout(6000);

// Show Create a final invoice section ($8,500 - $500 = $8,000)
console.log('Demonstrating final balance invoice creation ($8,500 - $500 = $8,000)...');
await smoothScroll(1100, 1500);
await page.waitForTimeout(2000);

const depositSelect = page.getByLabel('Paid project deposit');
if (await depositSelect.count() && await depositSelect.isVisible()) {
  await depositSelect.selectOption({ index: 1 });
  await page.waitForTimeout(1500);
  
  const totalInput = page.getByLabel('Full project total (USD)');
  await totalInput.fill('8500.00');
  await page.waitForTimeout(2500);
  
  // Show calculated balance $8,000.00
  await page.waitForTimeout(4000);
}

// ----------------------------------------------------
// SECTION 5: PIXEL TRACKING EVENTS & SUMMARY (3:20 - 3:45)
// ----------------------------------------------------
console.log('Step 5: Showing custom events received by Whop and client pixel log...');
await smoothScroll(1700, 1500);
await page.waitForTimeout(6000);

await smoothScroll(2200, 1500);
await page.waitForTimeout(6000);

console.log('Recording completed. Closing context to save video...');
await page.close();
await context.close();
await browser.close();

const recorded = fs.readdirSync('output/video-record').find(f => f.endsWith('.webm'));
if (recorded) {
  const webmPath = `output/video-record/${recorded}`;
  const mp4Path = 'output/screen-recording.mp4';
  console.log(`Converting ${webmPath} to ${mp4Path} via ffmpeg...`);
  spawnSync('ffmpeg', ['-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', mp4Path], { stdio: 'inherit' });
  console.log(`Video ready: ${mp4Path}`);
}
