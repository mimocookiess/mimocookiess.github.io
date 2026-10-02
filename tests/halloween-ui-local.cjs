// Supabase ficticio; nenhum pedido ou evento real. Fontes locais sao opcionais.
const { chromium } = require(process.env.MIMO_PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const fontDir = process.env.MIMO_FONT_DIR && path.resolve(process.env.MIMO_FONT_DIR);
const output = process.env.MIMO_SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "mimo-halloween-"));
fs.mkdirSync(output, { recursive: true });
const fixture = `
const supabaseClient = {
  from(table) {
    const query = {
      select() { return this; }, eq() { return this; },
      async order() { return {data: [], error: null}; },
      async maybeSingle() { return {data: {store_mode: 'open', is_paused: false,
        manual_open_until: '2099-10-02T03:00:00Z'}, error: null}; }
    };
    return query;
  },
  async rpc() { return {data: [{slug: 'teste', name: 'Bairro ficticio', fee: 8}], error: null}; },
  channel() { return {on() {return this;}, subscribe() {return this;}}; }
};`;
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (fontDir && pathname.startsWith('/__fonts/')) {
    const fontFile = path.resolve(fontDir, pathname.slice('/__fonts/'.length));
    if (!fontFile.startsWith(fontDir + path.sep)) { res.writeHead(403).end(); return; }
    try { res.end(fs.readFileSync(fontFile)); } catch { res.writeHead(404).end(); }
    return;
  }
  const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (pathname === "/supabase-config.js") {
    res.setHeader("Content-Type", "text/javascript"); res.end(fixture); return;
  }
  try {
    res.setHeader("Content-Type", ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8", ".webp": "image/webp", ".png": "image/png",
      ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (fontDir && url.hostname === 'fonts.googleapis.com') {
      return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(fontDir, 'fonts.css'), 'utf8').replaceAll('/__fonts/', origin + '/__fonts/') });
    }
    return url.origin === origin ? route.continue() : route.abort();
  });
  await page.goto(origin);
  await page.waitForFunction(() => PRODUCTS.length > 0 && getStoreState() === 'open');
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.querySelectorAll('img').forEach(img => { img.loading = 'eager'; });
    await Promise.all([...document.images].map(img => img.decode()));
  });
  const fonts = await page.evaluate(() => [...new Set([...document.fonts].filter(font => font.status === 'loaded').map(font => font.family))]);
  if (fontDir) { assert.ok(fonts.includes('DM Sans')); assert.ok(fonts.includes('Playfair Display')); }
  console.log('Fontes carregadas:', fonts);
  assert.equal(await page.locator('.preparation-note').innerText(),
    '\u{1F47B} Assamos seus cookies após a confirmação para chegarem quentinhos até você.');
  assert.equal(await page.locator('.halloween-hero').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('.halloween-hero img:not([alt=""])').count(), 0);
  for (const [width, height] of [[1440, 1000], [768, 1024], [844, 390], [320, 800], [390, 844], [412, 915]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { cart.clear(); updateCart(); window.scrollTo(0, 0); });
    assert.match(await page.locator('#cart-fab-summary').innerText(), /^0 itens · R\$\s0,00$/);
    await page.evaluate(() => { cart.set(PRODUCTS[0].id, 1); updateCart(); });
    assert.match(await page.locator('#cart-fab-summary').innerText(), /^1 item · R\$\s/);
    const fab = await page.locator('#cart-fab').evaluate(el => {
      const label = el.querySelector('span').getBoundingClientRect();
      const face = el.querySelector('.cart-fab-face');
      const faceBox = face.getBoundingClientRect();
      const summary = el.querySelector('strong').getBoundingClientRect();
      const style = getComputedStyle(el);
      const channel = value => {
        value /= 255;
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      };
      const luminance = rgb => {
        const values = rgb.match(/\d+/g).slice(0, 3).map(Number);
        return .2126 * channel(values[0]) + .7152 * channel(values[1]) + .0722 * channel(values[2]);
      };
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return {
        background: style.backgroundColor,
        color: style.color,
        summaryFontSize: getComputedStyle(el.querySelector('strong')).fontSize,
        contrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05),
        height: el.getBoundingClientRect().height,
        fits: el.scrollWidth <= el.clientWidth,
        order: faceBox.width < 1
          ? label.right + 4 <= summary.left
          : label.right + 4 <= faceBox.left && faceBox.right + 4 <= summary.left,
        faceWidth: faceBox.width,
        faceCenterX: faceBox.left + faceBox.width / 2,
        faceCenterY: faceBox.top + faceBox.height / 2,
        facePointerEvents: getComputedStyle(face).pointerEvents,
        faceDisplay: getComputedStyle(face).display,
        faceAriaHidden: face.getAttribute('aria-hidden'),
        faceAlt: face.getAttribute('alt'),
        faceTabIndex: face.tabIndex,
        faceClickTarget: document.elementFromPoint(
          faceBox.left + faceBox.width / 2,
          faceBox.top + faceBox.height / 2
        )?.closest('#cart-fab')?.id
      };
    });
    assert.equal(fab.background, 'rgb(217, 135, 67)');
    assert.equal(fab.color, 'rgb(23, 18, 14)');
    assert.equal(fab.summaryFontSize, '14px');
    assert.ok(fab.contrast >= 4.5);
    assert.equal(fab.height, 64);
    assert.equal(fab.fits, true);
    assert.equal(fab.order, true);
    assert.equal(fab.facePointerEvents, 'none');
    assert.equal(fab.faceAriaHidden, 'true');
    assert.equal(fab.faceAlt, '');
    assert.equal(fab.faceTabIndex, -1);
    if (fab.faceWidth >= 1) assert.equal(fab.faceClickTarget, 'cart-fab');
    else assert.equal(fab.faceDisplay, 'none');
    await page.locator('#cart-fab').screenshot({ path: path.join(output, `cart-fab-${width}.png`) });
    if (fab.faceWidth >= 1) await page.mouse.click(fab.faceCenterX, fab.faceCenterY);
    else await page.locator('#cart-fab').click();
    await page.waitForFunction(() => document.querySelector('#cart-panel').getAttribute('aria-hidden') === 'false');
    await page.locator('#close-cart').click();
    await page.waitForFunction(() => document.querySelector('#cart-panel').getAttribute('aria-hidden') === 'true');
    await page.waitForTimeout(300);
    await page.evaluate(() => { cart.set(PRODUCTS[0].id, 2); updateCart(); });
    assert.match(await page.locator('#cart-fab-summary').innerText(), /^2 itens · R\$\s/);
    const regularFaceWidth = fab.faceWidth;
    await page.evaluate(() => { cart.set(PRODUCTS[0].id, 9999); updateCart(); });
    const longFab = await page.locator('#cart-fab').evaluate(el => {
      const label = el.querySelector('span').getBoundingClientRect();
      const face = el.querySelector('.cart-fab-face').getBoundingClientRect();
      const summary = el.querySelector('strong');
      const summaryBox = summary.getBoundingClientRect();
      return {
        fits: el.scrollWidth <= el.clientWidth,
        textFits: summary.scrollWidth <= summary.clientWidth,
        textClear: label.right + 4 <= summaryBox.left,
        faceClear: face.width < 1 || (label.right + 4 <= face.left && face.right + 4 <= summaryBox.left),
        faceWidth: face.width,
        height: el.getBoundingClientRect().height
      };
    });
    assert.equal(longFab.fits, true);
    assert.equal(longFab.textFits, true);
    assert.equal(longFab.textClear, true);
    assert.equal(longFab.faceClear, true);
    assert.ok(longFab.faceWidth <= regularFaceWidth);
    assert.equal(longFab.height, 64);
    await page.locator('#cart-fab').screenshot({ path: path.join(output, `cart-fab-long-${width}.png`) });
    await page.evaluate(() => { cart.set(PRODUCTS[0].id, 1); updateCart(); });
    await page.locator('.hero').screenshot({ path: path.join(output, `hero-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.evaluate(() => { cart.set(PRODUCTS[0].id, 1); updateCart(); openCart(); });
    await page.waitForFunction(() => document.querySelector('.cart-panel').getBoundingClientRect().right <= innerWidth + 1);
    await page.waitForTimeout(300);
    const geometry = () => page.evaluate(() => {
      const selectors = ['.hero', '.hero-content', '.hero-copy', '.hero-visual', '.product-grid', '.cart-header', '#cart-title', '#close-cart', '.totals'];
      return selectors.map(selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return [selector, r.x, r.y, r.width, r.height];
      });
    });
    const decorated = await geometry();
    const noDecorations = await page.addStyleTag({ content: '.halloween-hero {display:none!important} .cart-header::before,.totals::before {content:none!important}' });
    assert.deepEqual(await geometry(), decorated, `Decoracao nao desloca layout em ${width}px`);
    await noDecorations.evaluate(el => el.remove());
    const header = await page.evaluate(() => {
      const panel = document.querySelector('.cart-panel');
      const header = document.querySelector('.cart-header');
      const ghost = getComputedStyle(header, '::before');
      const title = document.querySelector('#cart-title').getBoundingClientRect();
      const close = document.querySelector('#close-cart').getBoundingClientRect();
      const h = header.getBoundingClientRect();
      return { fits: panel.scrollWidth <= panel.clientWidth, titleClear: title.right < close.left,
        clickTarget: document.elementFromPoint(close.x + close.width/2, close.y + close.height/2).id,
        ghostTop: h.top + parseFloat(ghost.top), ghostOpacity: Number(ghost.opacity),
        transform: ghost.transform, pointerEvents: ghost.pointerEvents,
        heroPointerEvents: getComputedStyle(document.querySelector('.halloween-hero')).pointerEvents };
    });
    assert.equal(header.fits, true); assert.equal(header.titleClear, true);
    assert.equal(header.clickTarget, 'close-cart'); assert.ok(header.ghostTop < 0);
    assert.equal(header.transform, 'matrix(-1, 0, 0, -1, 0, 0)');
    assert.equal(header.pointerEvents, 'none'); assert.equal(header.heroPointerEvents, 'none');
    assert.ok(header.ghostOpacity >= .18 && header.ghostOpacity <= .3);
    await page.screenshot({ path: path.join(output, `cart-header-${width}.png`) });
    await page.locator('.totals').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#shipping').innerText(), 'A calcular');
    await page.screenshot({ path: path.join(output, `cart-totals-${width}.png`) });
    await page.locator('.totals').screenshot({ path: path.join(output, `totals-detail-${width}.png`) });
    const offsets = await page.evaluate(() => {
      const panel = document.querySelector('.cart-panel');
      const measure = () => ['.cart-header', '.totals'].map(selector => {
        const el = document.querySelector(selector), css = getComputedStyle(el, '::before');
        return el.getBoundingClientRect().top + parseFloat(css.top);
      });
      const before = measure(), start = panel.scrollTop;
      panel.scrollTop -= 70;
      return { before, after: measure(), delta: panel.scrollTop - start };
    });
    offsets.after.forEach((value, i) => assert.ok(Math.abs(value - offsets.before[i] + offsets.delta) < 1));
    await page.evaluate(() => {
      selectDeliveryZone(deliveryZones[0]);
      cart.set(PRODUCTS[0].id, 9999); updateCart();
    });
    await page.locator('.totals').scrollIntoViewIfNeeded();
    const totals = await page.locator('.totals').evaluate(el => {
      const box = el.getBoundingClientRect(), style = getComputedStyle(el, '::before');
      return { image: style.backgroundImage, pointerEvents: style.pointerEvents, opacity: Number(style.opacity),
        rowsFit: [...el.children].every(row => {
          const label = row.firstElementChild.getBoundingClientRect(), amount = row.lastElementChild.getBoundingClientRect();
          return label.right < amount.left && amount.right <= box.right;
        }) };
    });
    assert.match(totals.image, /halloween-pumpkin\.webp/);
    assert.equal(totals.rowsFit, true); assert.equal(totals.pointerEvents, 'none');
    assert.ok(totals.opacity >= .18 && totals.opacity <= .3);
    await page.screenshot({ path: path.join(output, `cart-long-values-${width}.png`) });
    await page.evaluate(() => {
      deliveryNeighborhoodInput.value = '';
      deliveryNeighborhoodInput.dispatchEvent(new Event('input'));
      document.querySelector('.cart-panel').scrollTop = 0;
    });
    await page.locator('#close-cart').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#cart-panel').getAttribute('aria-hidden'), 'true');
    console.log(`${width}px: layout, valores, decoracoes, rolagem e fechar OK`);
  }
  assert.deepEqual(errors, []);
  console.log(`Capturas locais: ${output}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server.close();
});
