// padavan-tw 後台跑版檢查：每個頁面 × 多種寬度
// 檢查：1) 整頁橫向溢出  2) 頂部列換成兩行  3) 內容欄裡有元素超出內容欄右緣（不在可捲動容器內；被 overflow:hidden 切掉也算）
// 用法：node tools/ui-preview/layout-check.js [頁面...]   （要先執行 serve.py；不給頁面就檢查全部）
// 環境變數：WIDTHS=360,1024  RESIZE=1（載入後才縮小視窗）  PREVIEW_URL=http://127.0.0.1:8088/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.env.PREVIEW_URL || 'http://127.0.0.1:8088/';
const RESIZE = process.env.RESIZE === '1';   // 1：載入後再縮小視窗
const widths = (process.env.WIDTHS || '360,390,768,900,1024,1100,1280,1440,1920').split(',').map(Number);
const WEBUI = path.join(__dirname, '..', '..', 'trunk', 'user', 'www', 'n56u_ribbon_fixed');
// 不是頁面的端點（資料、動作、上傳結果、iframe 片段）
const SKIP = /^(as|Ad_action|ajax_ddnscode|aplist|bit_action|console_response|lan_clients|Logout|log_content|Nologin|Restarting|status_.*|system_status_data|tw_rstats|tw_status|Update.*|Upload.*|Updating|vpn_clients|wds_aplist.*|wol_action|.*_action|.*_log|aidisk)\.asp$/;

async function check(page, w) {
  return page.evaluate((w) => {
    const out = [];
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) out.push(`整頁橫向溢出 ${de.scrollWidth - de.clientWidth}px`);
    const top = document.querySelector('.tw-top');
    if (top) {
      const h = top.getBoundingClientRect().height;
      const limit = w <= 900 ? 110 : 64;   // 手機版本來就有兩行（品牌列＋狀態列）
      if (h > limit) out.push(`頂部列高度 ${Math.round(h)}px（換行）`);
      const acts = top.querySelector('.tw-top-actions');
      if (acts) {
        const kids = [...acts.children].filter((k) => k.offsetParent);
        const mids = kids.map((k) => { const r = k.getBoundingClientRect(); return r.top + r.height / 2; });
        if (mids.length && Math.max(...mids) - Math.min(...mids) > 12) out.push('頂部列按鈕分成兩行');
      }
    }
    const main = document.querySelector('.tw-main');
    if (main) {
      const cs = getComputedStyle(main);
      const right = main.getBoundingClientRect().right - parseFloat(cs.paddingRight) + 2;
      const scrollable = (el) => {
        for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
          // 只有可捲動的容器算正常；overflow: hidden 會把內容切掉，一樣算跑版
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll') return true;
        }
        return false;
      };
      const bad = [];
      main.querySelectorAll('*').forEach((el) => {
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.right > right && !scrollable(el)) bad.push(el);
      });
      // 只回報最外層的那個（裡面的子元素一定也超出）
      const roots = bad.filter((el) => !bad.some((b) => b !== el && b.contains(el)));
      roots.slice(0, 4).forEach((el) => {
        const r = el.getBoundingClientRect();
        const id = el.id ? '#' + el.id : '';
        const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        out.push(`超出內容欄 ${Math.round(r.right - right)}px：<${el.tagName.toLowerCase()}${id}${cls}>`);
      });
    }
    return out;
  }, w);
}

(async () => {
  let pages = process.argv.slice(2);
  if (!pages.length) pages = fs.readdirSync(WEBUI).filter((f) => f.endsWith('.asp') && !SKIP.test(f)).sort();
  const browser = await chromium.launch();
  const problems = {};
  for (const w of widths) {
    const mobile = w < 768;
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    for (const p of pages) {
      try {
        // 先用較寬的視窗載入、再縮成目標寬度：抓「載入後才改變寬度」才會發生的跑版（例如 Highcharts）
        if (RESIZE) await page.setViewportSize({ width: Math.min(1920, w + 500), height: 900 });
        await page.goto(base + p, { waitUntil: 'load', timeout: 20000 });
        await page.waitForTimeout(700);
        if (RESIZE) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(700); }
        const r = await check(page, w);
        if (r.length) (problems[p] = problems[p] || []).push(...r.map((x) => `${w}px ${x}`));
      } catch (e) {
        (problems[p] = problems[p] || []).push(`${w}px 載入失敗：${e.message.split('\n')[0]}`);
      }
    }
    await ctx.close();
  }
  await browser.close();
  const names = Object.keys(problems);
  console.log(`檢查 ${pages.length} 頁 × ${widths.length} 種寬度，有問題的頁面 ${names.length} 個`);
  for (const n of names) {
    console.log('\n' + n);
    [...new Set(problems[n])].forEach((x) => console.log('  ' + x));
  }
})();
