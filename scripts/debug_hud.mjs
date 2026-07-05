import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--window-size=900,440','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.emulate({ name:'phone-landscape', userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36', viewport:{width:900,height:420,deviceScaleFactor:2,isMobile:true,hasTouch:true,isLandscape:true}});
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'mage', charName: 'Touchscreen', settleMs: 2000 });
await page.evaluate(() => { document.getElementById('mobile-preflight-continue')?.click(); });
await new Promise(r=>setTimeout(r,600));
await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown')));
await new Promise(r=>setTimeout(r,500));
const info = await page.evaluate(() => ({
  bodyClasses: document.body.className,
  attackBtn: !!document.getElementById('mobile-attack-nearest'),
  attackDisplay: getComputedStyle(document.getElementById('mobile-attack-nearest')||document.body).display,
  mobileControls: document.getElementById('mobile-controls')?.outerHTML.slice(0,300),
  actionbar: document.getElementById('actionbar')?.className,
}));
console.log(JSON.stringify(info, null, 2));
await browser.close();
