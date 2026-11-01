import { chromium } from 'playwright';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

fs.mkdirSync('output/video-record', { recursive: true });

// Clean up previous video files in output/video-record
for (const file of fs.readdirSync('output/video-record')) {
  if (file.endsWith('.webm')) {
    fs.unlinkSync(`output/video-record/${file}`);
  }
}

console.log('Launching browser for comprehensive 3-5 min screen recording...');
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
  viewport: { width: 1280, height: 720 },
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
});

const page = await context.newPage();

async function smoothScroll(targetY, durationMs = 1800) {
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
  await page.waitForTimeout(durationMs + 400);
}

// ----------------------------------------------------------------------
// PART 1: LIVE SITE WALKTHROUGH & BRANDING (0:00 - 0:50)
// ----------------------------------------------------------------------
console.log('[0:00] Step 1: Navigating to live site via whop.app canonical redirect...');
await page.goto('https://ridge-ready-roofing-demo.whop.app/', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

// Top banner & Hero showcase
console.log('[0:10] Showcasing Hero section & brand positioning...');
await page.waitForTimeout(4000);

// Smooth scroll to Trust Band
console.log('[0:18] Highlighting trust indicators & Whop secure payment guarantees...');
await smoothScroll(450, 1500);
await page.waitForTimeout(3500);

// Services grid ($149 Inspection, $399 Tune-up, $500 Deposit)
console.log('[0:25] Showcasing transparent pricing and service tiers...');
await smoothScroll(950, 1800);
await page.waitForTimeout(3500);

// Highlight Service 1: Inspection
const inspCard = page.locator('[data-service="inspection"]');
if (await inspCard.count()) {
  await inspCard.hover();
  await page.waitForTimeout(2500);
}

// Highlight Service 2: Tune-up
const repairCard = page.locator('[data-service="repair"]');
if (await repairCard.count()) {
  await repairCard.hover();
  await page.waitForTimeout(2500);
}

// Highlight Service 3: Replacement ($500 deposit)
const depCard = page.locator('[data-service="deposit"]');
if (await depCard.count()) {
  await depCard.hover();
  await page.waitForTimeout(3000);
}

// Process Section
console.log('[0:38] Demonstrating 4-step clear process (from deposit to final balance)...');
await smoothScroll(1650, 1800);
await page.waitForTimeout(4500);

// Flexible Financing Section
console.log('[0:45] Showcasing flexible financing callout via Whop checkout...');
await smoothScroll(2150, 1800);
await page.waitForTimeout(4000);

// Service Area & Reviews
console.log('[0:52] Local Triangle service area & sample reviews...');
await smoothScroll(2800, 1800);
await page.waitForTimeout(4000);

// FAQ Accordion interaction
console.log('[1:00] Interacting with FAQ section...');
await smoothScroll(3450, 1800);
await page.waitForTimeout(2000);

const faqButtons = page.locator('.faq-list button');
if (await faqButtons.count() > 1) {
  await faqButtons.nth(1).click();
  await page.waitForTimeout(2500);
  await faqButtons.nth(2).click();
  await page.waitForTimeout(2500);
}

// ----------------------------------------------------------------------
// PART 2: ESTIMATE FORM -> WHOP LEADS API (1:10 - 1:55)
// ----------------------------------------------------------------------
console.log('[1:15] Step 2: Demonstrating Estimate Request form wired to Whop Leads API...');
await smoothScroll(4100, 2000);
await page.waitForTimeout(3000);

// Form data filling
console.log('[1:22] Typing customer lead details...');
await page.locator('input[name="name"]').click();
await page.locator('input[name="name"]').pressSequentially('Sarah Jenkins', { delay: 60 });
await page.waitForTimeout(800);

await page.locator('input[name="email"]').click();
await page.locator('input[name="email"]').pressSequentially('sarah.jenkins@example.com', { delay: 50 });
await page.waitForTimeout(800);

await page.locator('input[name="phone"]').click();
await page.locator('input[name="phone"]').pressSequentially('(919) 555-0199', { delay: 50 });
await page.waitForTimeout(800);

await page.locator('input[name="zip"]').click();
await page.locator('input[name="zip"]').pressSequentially('27601', { delay: 60 });
await page.waitForTimeout(800);

await page.locator('input[name="address"]').click();
await page.locator('input[name="address"]').pressSequentially('412 Oak Ridge Rd, Raleigh, NC', { delay: 50 });
await page.waitForTimeout(1000);

await page.locator('select[name="service"]').selectOption('replacement');
await page.waitForTimeout(1000);

await page.locator('textarea[name="message"]').click();
await page.locator('textarea[name="message"]').pressSequentially('Recent storm inspection requested for roof replacement estimate.', { delay: 40 });
await page.waitForTimeout(1200);

// Check consent
console.log('[1:45] Homeowner contact consent recorded...');
await page.locator('input[name="consent"]').check();
await page.waitForTimeout(2500);

// Highlight the Clear form button added
const clearBtn = page.getByRole('button', { name: 'Clear form' });
if (await clearBtn.count()) {
  await clearBtn.hover();
  await page.waitForTimeout(2000);
}

// ----------------------------------------------------------------------
// PART 3: TEST CHECKOUT WITH WHOP PAYMENT ELEMENTS (1:55 - 2:45)
// ----------------------------------------------------------------------
console.log('[1:55] Step 3: Navigating to Sandbox Test Checkout (/sandbox)...');
await page.goto('https://ridge-ready-roofing-demo.whop.site/sandbox', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

// Scroll down to services
await smoothScroll(650, 1600);
await page.waitForTimeout(2500);

// Open Deposit Checkout
console.log('[2:05] Opening $500 Deposit Checkout with Whop Payment Elements...');
const reserveBtn = page.getByRole('button', { name: 'Reserve your project' });
await reserveBtn.click();
await page.waitForTimeout(2500);

// Agree to written project terms
const agreeCheckbox = page.getByRole('dialog').getByRole('checkbox');
if (await agreeCheckbox.count()) {
  await agreeCheckbox.check();
  await page.waitForTimeout(2000);
}

// Continue to Whop payment surface
const continueBtn = page.getByRole('button', { name: 'Continue to payment' });
if (await continueBtn.count()) {
  await continueBtn.click();
  await page.waitForTimeout(3000);
}

// Choose Card & available financing
const cardSurfaceBtn = page.getByRole('button', { name: 'Card & available financing' });
if (await cardSurfaceBtn.count() && await cardSurfaceBtn.isVisible()) {
  await cardSurfaceBtn.click();
  await page.waitForTimeout(3000);
}

// Showcase Payment Elements surface with BrandingElement
console.log('[2:20] Displaying Whop Payment Elements & BrandingElement...');
await page.waitForTimeout(7000);

// Close modal
const closeBtn = page.getByRole('button', { name: 'Close checkout' });
if (await closeBtn.count()) {
  await closeBtn.click();
  await page.waitForTimeout(2000);
}

// Show verified payment confirmation page
console.log('[2:35] Showing verified test checkout return status (paid deposit)...');
await page.goto('https://ridge-ready-roofing-demo.whop.site/sandbox/checkout/return?job=633e5e8c-db07-41c9-9462-eef5ec9b8e65', { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);

// ----------------------------------------------------------------------
// PART 4: OWNER OPERATIONS DESK & BALANCE SUMMARY (2:45 - 3:45)
// ----------------------------------------------------------------------
console.log('[2:45] Step 4: Navigating to Owner Operations Desk (/sandbox/operations)...');
await page.goto('https://ridge-ready-roofing-demo.whop.site/sandbox/operations', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Owner login
console.log('[2:55] Owner signing in with secure credential...');
const pwdInput = page.locator('input[type="password"]');
if (await pwdInput.count() && await pwdInput.isVisible()) {
  await pwdInput.fill(process.env.ADMIN_PASSWORD || '');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.waitForTimeout(3500);
}

// Show the Financial Summary & Balance Cards!
console.log('[3:05] Highlighting Financial Summary: Total Collected $899.00, Deposits $500.00, Leads count...');
await page.waitForTimeout(5000);

// Estimate Requests table
console.log('[3:15] Reviewing Estimate Requests table read from Whop Leads API...');
await smoothScroll(450, 1400);
await page.waitForTimeout(6000);

// Project Deposits & Payments table ($399 Tune-up and $500 Deposit)
console.log('[3:25] Reviewing Project Deposits & Payments table (all template payments in Whop Sandbox)...');
await smoothScroll(850, 1400);
await page.waitForTimeout(7000);

// ----------------------------------------------------------------------
// PART 5: FINAL BALANCE INVOICE CREATION (3:45 - 4:20)
// ----------------------------------------------------------------------
console.log('[3:45] Step 5: Creating Final Balance Invoice ($8,500 scope - $500 deposit = $8,000 balance)...');
await smoothScroll(1300, 1400);
await page.waitForTimeout(2500);

const depositSelect = page.getByLabel('Paid project deposit');
if (await depositSelect.count() && await depositSelect.isVisible()) {
  await depositSelect.selectOption({ index: 1 });
  await page.waitForTimeout(2000);
  
  const totalInput = page.getByLabel('Full project total (USD)');
  await totalInput.fill('8500.00');
  await page.waitForTimeout(3000);
  
  // Job completed confirmation
  const jobDoneCheck = page.locator('input[type="checkbox"]').first();
  if (await jobDoneCheck.count()) {
    await jobDoneCheck.check();
    await page.waitForTimeout(2000);
  }
  
  // Click Create final invoice
  console.log('[4:05] Creating verified final invoice in Whop...');
  const createInvBtn = page.getByRole('button', { name: 'Create final invoice' });
  if (await createInvBtn.count() && await createInvBtn.isEnabled()) {
    await createInvBtn.click();
    await page.waitForTimeout(4000);
  }
}

// ----------------------------------------------------------------------
// PART 6: PIXEL TRACKING EVENTS & AUDIT VERIFICATION (4:20 - 4:45)
// ----------------------------------------------------------------------
console.log('[4:20] Step 6: Reviewing Custom Events received by Whop & browser pixel audit log...');
await smoothScroll(1950, 1400);
await page.waitForTimeout(6000);

// Show live Whop events and client pixel log
await smoothScroll(2500, 1400);
await page.waitForTimeout(6000);

console.log('[4:35] Recording completed successfully. Total duration ~4.5 minutes.');
await page.close();
await context.close();
await browser.close();

// Check for recorded video and convert to MP4
const recorded = fs.readdirSync('output/video-record').find(f => f.endsWith('.webm'));
if (recorded) {
  const webmPath = `output/video-record/${recorded}`;
  const mp4Path = 'output/screen-recording.mp4';
  console.log(`Converting ${webmPath} to ${mp4Path} via ffmpeg...`);
  spawnSync('ffmpeg', ['-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', mp4Path], { stdio: 'inherit' });
  
  // Verify duration
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mp4Path], { encoding: 'utf-8' });
  console.log(`Video ready: ${mp4Path} (Duration: ${parseFloat(probe.stdout.trim()).toFixed(1)} seconds)`);
}
