// padavan-tw 後台截圖：桌機 1440 與手機 390 各一張
// 用法：node tools/ui-preview/shoot.js <輸出資料夾> [頁面...]
// 需要先執行 serve.py；Playwright 使用環境內建的 Chromium
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const out = process.argv[2] || 'ui-shots';
const pages = process.argv.slice(3);
const list = pages.length ? pages : ['index.asp', 'Advanced_WAN_Content.asp', 'Advanced_Wireless_Content.asp', 'Advanced_SQM.asp', 'Advanced_DHCP_Content.asp'];
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:8088/';
const sizes = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];
const scheme = process.env.SCHEME || 'light';

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  for (const s of sizes) {
    const ctx = await browser.newContext({
      viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1,
      isMobile: s.mobile, hasTouch: s.mobile, colorScheme: scheme,
      userAgent: s.mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : undefined,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const p of list) {
      await page.goto(base + p, { waitUntil: 'load' });
      await page.waitForTimeout(600);
      const file = path.join(out, `${p.replace(/[^A-Za-z0-9_.-]/g, '_')}.${s.name}.${scheme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      console.log(`${file}  scrollWidth=${w}${w > s.width ? '  ⚠ 橫向溢出' : ''}`);
    }
    if (errors.length) console.log('JS errors:', [...new Set(errors)].join(' | '));
    await ctx.close();
  }
  await browser.close();
})();
