// Navegador local: todas as origens externas são bloqueadas e o Supabase é fictício.
const { chromium } = require(process.env.MIMO_PLAYWRIGHT_MODULE || "playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const fixture = `
let fakeDelay = 0;
let fakeSettings = {store_mode:'open',is_paused:false,return_time:null,pause_message:null,
  manual_open_until:new Date(Date.now()+86400000).toISOString()};
const product = {id:'fixture', slug:'fixture', name:'Cookie fictício', price:10, stock:2,
  available:true, image_url:'', description:'Cookie', display_order:1};
const supabaseClient = {
  from(table) {
    const q = {
      then(resolve) { resolve({data:table==='products'?[product]:[],error:null}); },
      update(values) { fakeSettings={...fakeSettings,...values}; return q; },
      async maybeSingle() { if(fakeDelay){const delay=fakeDelay;fakeDelay=0;await new Promise(r=>setTimeout(r,delay));} return {data:{...fakeSettings},error:null}; },
      async single() { return {data:{...fakeSettings},error:null}; }
    };
    for (const key of ['select','eq','in','order','limit','gte','lte','range']) q[key]=()=>q;
    return q;
  },
  async rpc(name, values) {
    return {data:[],error:null};
  },
  auth: { async getUser(){ return {data:{user:{id:'dcf88d88-cb5e-4378-89e1-ba1020cb20e8',email:'fixture@example.test'}},error:null}; },
    onAuthStateChange(){}, async signOut(){} },
  channel(){ const q={on(){return q},subscribe(){return q}};return q; }, removeChannel(){}
};`;
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (pathname.endsWith("supabase-config.js")) { res.setHeader("Content-Type", "text/javascript"); res.end(fixture); return; }
  try {
    res.setHeader("Content-Type", ({".html":"text/html", ".js":"text/javascript", ".css":"text/css"})[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  await page.route("**/*", route => route.request().url().startsWith(origin)
    ? route.continue() : route.abort());
  await page.goto(origin);
  await page.locator(".status-low-stock").waitFor();
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({width, height:800});
    const result = await page.locator(".status-low-stock").evaluate(el => {
      const box = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect();
      return {text:el.textContent.trim(), fits:box.left>=parent.left && box.right<=parent.right, height:box.height};
    });
    assert.equal(result.text, "ÚLTIMOS :O"); assert.equal(result.fits, true); assert.ok(result.height < 40);
  }
  await page.evaluate(() => {
    addItem('fixture');
    document.querySelector('#customer-name').value = 'Cliente fictício';
    document.querySelector('#customer-notes').value = 'Preservar formulário';
    storeSettings = {isPaused:true,mode:'closed_today',returnTime:null,pauseMessage:'',manualOpenUntil:null};
    renderStoreSettings();
  });
  await page.waitForFunction(() => document.querySelector('#whatsapp-button').disabled);
  assert.equal(await page.locator('#customer-name').inputValue(), 'Cliente fictício');
  assert.equal(await page.locator('#customer-notes').inputValue(), 'Preservar formulário');
  assert.equal(await page.evaluate(() => cart.get('fixture')), 1);
  await page.evaluate(() => {
    fakeSettings={...fakeSettings,is_paused:true,store_mode:'paused',return_time:null,manual_open_until:null};
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => getStoreState() === 'paused');
  assert.equal(await page.locator('#customer-notes').inputValue(), 'Preservar formulário');
  await page.goto(origin + "/admin/");
  await page.locator('[data-tab="settings"]').click();
  await page.locator("#store-manual-open").check();
  await page.locator("#save-settings-button").click();
  await page.waitForFunction(() => document.querySelector('#settings-status').textContent.includes('abertura excepcional até'));
  assert.equal(await page.locator('input[name="store-mode"]:checked').count(), 1);
  await page.locator("#store-automatic").check();
  await page.locator("#save-settings-button").click();
  await page.waitForFunction(() => document.querySelector('#settings-status').textContent.includes('expediente automático'));
  // Uma leitura iniciada antes do salvamento termina depois: não restaura o estado velho.
  await page.evaluate(() => { fakeDelay=400; loadStoreSettings(); });
  await page.locator('#store-manual-open').check();
  await page.locator('#save-settings-button').click();
  await page.waitForFunction(() => document.querySelector('#settings-status').textContent.includes('abertura excepcional até'));
  await page.waitForTimeout(500);
  assert.match(await page.locator('#settings-status').textContent(), /abertura excepcional até/);
  await page.locator('#store-pause-message').fill('Edição ainda não salva');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(await page.locator('#store-pause-message').inputValue(), 'Edição ainda não salva');
  console.log("UI local: 320/360/390 px, transição com carrinho preservado, visibilitychange, abertura e encerramento, leitura atrasada e formulário administrativo preservado passaram.");
})().catch(error => {console.error(error);process.exitCode=1;}).finally(async () => {
  await browser?.close(); server.close();
});
