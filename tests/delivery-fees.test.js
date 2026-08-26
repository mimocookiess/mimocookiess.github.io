const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260826180000_add_delivery_zones_and_actual_fees.sql"
);
const migration = fs.readFileSync(migrationPath, "utf8");
const reducedFeesMigration = fs.readFileSync(path.join(
  root,
  "supabase",
  "migrations",
  "20260826220000_reduce_delivery_fees.sql"
), "utf8");
const completedOrderFixMigration = fs.readFileSync(path.join(
  root,
  "supabase",
  "migrations",
  "20260826210000_allow_actual_delivery_fee_on_completed_orders.sql"
), "utf8");
const edgeFunction = fs.readFileSync(path.join(
  root,
  "supabase",
  "functions",
  "create-order",
  "index.ts"
), "utf8");
const checkoutHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const checkoutScript = fs.readFileSync(path.join(root, "script.js"), "utf8");
const checkoutStyle = fs.readFileSync(path.join(root, "style.css"), "utf8");
const adminScript = fs.readFileSync(path.join(root, "admin", "admin.js"), "utf8");

const expectedFees = new Map(Object.entries({
  "Aeroporto Velho": 6.00,
  "Aldeia": 8.00,
  "Alvorada": 16.00,
  "Amparo": 15.20,
  "Aparecida": 6.20,
  "Área Verde": 9.00,
  "Cambuquira": 16.00,
  "Caranazal": 8.00,
  "Centro": 7.00,
  "Cidade Jardim": 13.40,
  "Conquista": 15.20,
  "Diamantino": 7.00,
  "Elcione Barbalho": 15.00,
  "Esperança": 6.00,
  "Espírito Santo": 11.60,
  "Fátima": 7.00,
  "Floresta": 8.00,
  "Interventoria": 6.00,
  "Ipanema": 15.20,
  "Jaderlândia": 13.40,
  "Jardim Santarém": 6.00,
  "Juá": 11.60,
  "Jutaí": 15.20,
  "Laguinho": 8.00,
  "Liberdade": 6.20,
  "Livramento": 16.00,
  "Maicá": 15.20,
  "Mapiri": 11.00,
  "Maracanã": 16.00,
  "Maracanã I": 16.00,
  "Mararú": 16.00,
  "Matinha": 15.20,
  "Nova Jerusalém": 13.40,
  "Nova República": 11.60,
  "Nova Vitória": 16.00,
  "Novo Horizonte": 16.00,
  "Pérola do Maicá": 16.00,
  "Prainha": 6.00,
  "Salé": 8.00,
  "Santa Clara": 7.00,
  "Santana": 8.00,
  "Santarenzinho": 13.40,
  "Santíssimo": 6.00,
  "Santo André": 13.40,
  "São Cristóvão": 16.00,
  "São Francisco": 13.40,
  "São José Operário": 11.60,
  "Uruará": 7.00,
  "Urumanduba": 16.00,
  "Urumari": 8.00,
  "Vigia": 16.00,
  "Vitória Régia": 16.00
}));

function parseZoneRows(sql) {
  return [...sql.matchAll(
    /\('([^']+)',\s*'([^']+)',\s*(\d+\.\d{2}),\s*true,\s*'([^']+)',\s*(\d+)\)/g
  )].map(match => ({
    name: match[1],
    slug: match[2],
    fee: Number(match[3]),
    source: match[4],
    sortOrder: Number(match[5])
  }));
}

function parseFeeUpdates(sql) {
  return [...sql.matchAll(
    /\('([^']+)',\s*(\d+\.\d{2})::numeric\)/g
  )].map(match => ({
    slug: match[1],
    fee: Number(match[2])
  }));
}

test("migration base cadastra exatamente os 52 bairros", () => {
  const zones = parseZoneRows(migration);

  assert.equal(zones.length, 52);
  assert.equal(new Set(zones.map(zone => zone.slug)).size, 52);
  assert.equal(new Set(zones.map(zone => zone.sortOrder)).size, 52);
  assert.deepEqual(zones.map(zone => zone.sortOrder),
    Array.from({ length: 52 }, (_, index) => index + 1));

  assert.deepEqual(new Set(zones.map(zone => zone.name)), new Set(expectedFees.keys()));
});

test("migration comercial define explicitamente as 52 tarifas finais", () => {
  const zones = parseZoneRows(migration);
  const fees = parseFeeUpdates(reducedFeesMigration);
  const feesBySlug = new Map(fees.map(({ slug, fee }) => [slug, fee]));

  assert.equal(fees.length, 52);
  assert.equal(feesBySlug.size, 52);

  for (const zone of zones) {
    assert.equal(expectedFees.has(zone.name), true, zone.name);
    assert.equal(feesBySlug.get(zone.slug), expectedFees.get(zone.name), zone.name);
  }

  assert.match(reducedFeesMigration,
    /v_zone_count\s*<>\s*52[\s\S]*v_updated_count\s*<>\s*52/iu);
  assert.doesNotMatch(reducedFeesMigration, /fee\s*=\s*fee\s*-|update\s+public\.orders/iu);
});

test("origens administrativas seguem a classificação solicitada", () => {
  const zones = parseZoneRows(migration);
  const bySource = source => zones
    .filter(zone => zone.source === source)
    .map(zone => zone.name);

  assert.deepEqual(bySource("distance_estimated"), [
    "Cidade Jardim",
    "Espírito Santo",
    "Juá",
    "Nova Jerusalém"
  ]);
  assert.deepEqual(bySource("manual_verified"), [
    "Aeroporto Velho", "Aldeia", "Alvorada", "Área Verde", "Caranazal",
    "Centro", "Diamantino", "Elcione Barbalho", "Fátima", "Floresta",
    "Interventoria", "Jardim Santarém", "Mapiri", "Prainha", "Santa Clara",
    "Santana", "Santíssimo", "Uruará", "Urumari"
  ]);
  assert.equal(bySource("pdf_table").length, 29);
});

test("RPC de criação preserva snapshots, retirada e idempotência", () => {
  assert.match(migration, /add column delivery_neighborhood text/i);
  assert.match(migration, /add column delivery_actual_fee numeric\(10, 2\)/i);
  assert.match(migration, /where checkout_attempt_id = p_checkout_attempt_id[\s\S]*if found then[\s\S]*delivery_fee/iu);
  assert.match(migration, /where delivery_zones\.slug = p_delivery_neighborhood_slug[\s\S]*delivery_zones\.active = true/iu);
  assert.match(migration, /elsif p_delivery_method = 'Retirada'[\s\S]*v_delivery_neighborhood := null;[\s\S]*v_delivery_fee := 0/iu);
  assert.match(migration, /set[\s\S]*delivery_neighborhood = v_delivery_neighborhood,[\s\S]*delivery_fee = v_delivery_fee/iu);
  assert.match(migration, /'total', v_order\.total/iu);
  assert.doesNotMatch(migration, /setval|1\.80|1,80/iu);
});

test("listagem pública não concede acesso direto à tabela", () => {
  assert.match(migration, /create function public\.list_delivery_zones\(\)[\s\S]*security definer[\s\S]*where delivery_zones\.active = true/iu);
  assert.match(migration, /revoke all on table public\.delivery_zones[\s\S]*from public, anon, authenticated, service_role/iu);
  assert.match(migration, /grant execute on function public\.list_delivery_zones\(\)[\s\S]*to anon, authenticated, service_role/iu);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete)[\s\S]*delivery_zones/iu);
});

test("frete real usa RPC administrativa dedicada sem alterar valores do cliente", () => {
  const actualFeeFunction = migration.match(
    /create function public\.set_order_actual_delivery_fee[\s\S]*?end;\n\$\$;/iu
  )?.[0] || "";

  assert.match(actualFeeFunction, /security definer/iu);
  assert.match(actualFeeFunction, /auth\.uid\(\) is distinct from v_admin_user_id/iu);
  assert.match(actualFeeFunction, /p_actual_fee is null or p_actual_fee < 0/iu);
  assert.match(actualFeeFunction, /delivery_method <> 'Entrega'/iu);
  assert.match(actualFeeFunction, /set delivery_actual_fee = p_actual_fee/iu);
  assert.doesNotMatch(actualFeeFunction, /set[\s\S]*(?:delivery_fee|total)\s*=/iu);
  assert.match(migration, /revoke update on table public\.orders from authenticated/iu);
  assert.match(migration, /grant execute on function public\.set_order_actual_delivery_fee\(uuid, numeric\)[\s\S]*to authenticated/iu);
});

test("pedido completed permite somente a correcao do frete real", () => {
  assert.match(completedOrderFixMigration,
    /drop trigger if exists set_orders_updated_at[\s\S]*on public\.orders/iu);
  assert.match(completedOrderFixMigration,
    /create or replace function public\.validate_completed_order_transition\(\)/iu);
  assert.match(completedOrderFixMigration,
    /old\.status = 'completed'[\s\S]*new\.delivery_actual_fee is distinct from old\.delivery_actual_fee/iu);
  assert.match(completedOrderFixMigration,
    /to_jsonb\(new\) - 'delivery_actual_fee' - 'total'[\s\S]*to_jsonb\(old\) - 'delivery_actual_fee' - 'total'/iu);
  assert.match(completedOrderFixMigration,
    /new\.updated_at := pg_catalog\.now\(\)/iu);
  assert.doesNotMatch(completedOrderFixMigration,
    /grant|revoke update on table|create function public\.set_order_actual_delivery_fee/iu);
});

test("Edge Function aceita somente o slug e valida a resposta financeira", () => {
  assert.match(edgeFunction, /p_delivery_neighborhood_slug: string \| null/);
  assert.match(edgeFunction, /deliveryMethod === "Entrega"[\s\S]*deliveryNeighborhoodSlug/);
  assert.match(edgeFunction, /p_delivery_neighborhood_slug:\s*payload\.order\.p_delivery_neighborhood_slug/);
  assert.match(edgeFunction, /Math\.abs\(Number\(subtotal\) \+ Number\(deliveryFee\) - Number\(total\)\)/);
  assert.doesNotMatch(edgeFunction, /p_delivery_fee/);
});

test("checkout contém combobox acessível e não usa select de bairros", () => {
  assert.match(checkoutHtml, /id="delivery-neighborhood"[\s\S]*role="combobox"[\s\S]*aria-autocomplete="list"[\s\S]*aria-controls="delivery-neighborhood-options"/);
  assert.match(checkoutHtml, /id="delivery-neighborhood-options"[\s\S]*role="listbox"/);
  assert.match(checkoutHtml, /id="delivery-neighborhood-selected-indicator"[\s\S]*aria-hidden="true"[\s\S]*hidden/);
  assert.doesNotMatch(checkoutHtml, /<select[^>]*delivery-neighborhood/iu);
  assert.match(checkoutScript, /\["ArrowDown", "ArrowUp", "Enter"\]/);
  assert.match(checkoutScript, /event\.key === "Escape"/);
  assert.match(checkoutScript, /selectedDeliveryZone = null/);
  assert.match(checkoutScript, /data\.delivery_fee/);
  assert.match(checkoutScript, /data\.total/);
});

test("autocomplete orienta a seleção sem exibir tarifa nas sugestões", () => {
  const renderOptions = checkoutScript.match(
    /function renderDeliveryNeighborhoodOptions\(\)[\s\S]*?\n\}\n\nfunction selectDeliveryZone/iu
  )?.[0] || "";
  const selectZone = checkoutScript.match(
    /function selectDeliveryZone\(zone\)[\s\S]*?\n\}\n\ndeliveryNeighborhoodInput\.addEventListener\("input"/iu
  )?.[0] || "";

  assert.match(renderOptions, /<span>\$\{escapeHtml\(zone\.name\)\}<\/span>/u);
  assert.doesNotMatch(renderOptions, /BRL\.format|zone\.fee|<small>|R\$/u);
  assert.match(renderOptions,
    /delivery-neighborhood-options-heading[\s\S]*Selecione seu bairro abaixo[\s\S]*visibleDeliveryZones\.map/u);
  assert.match(renderOptions,
    /setDeliveryNeighborhoodMessage\(\s*"Selecione seu bairro abaixo",\s*"instruction"/u);
  assert.match(checkoutStyle,
    /\.delivery-neighborhood-options-heading\s*\{[\s\S]*position:\s*sticky;[\s\S]*border-bottom:/u);
  assert.match(checkoutStyle,
    /\.delivery-neighborhood-message\.instruction\s*\{[\s\S]*position:\s*absolute;[\s\S]*clip:/u);
  assert.match(selectZone,
    /setDeliveryNeighborhoodMessage\("Bairro selecionado\.", "success"\)/u);
  assert.match(checkoutScript,
    /deliveryNeighborhoodSelectedIndicator\.hidden = !hasSelectedNeighborhood/u);
  assert.match(checkoutScript,
    /selectedDeliveryZone = null;[\s\S]*setDeliveryNeighborhoodValidity\(Boolean\(selectedDeliveryZone\)\)[\s\S]*renderDeliveryNeighborhoodOptions\(\)/u);
  assert.match(checkoutScript,
    /deliveryNeighborhoodOptions\.addEventListener\("pointerdown"/u);
  assert.match(checkoutScript,
    /deliveryNeighborhoodOptions\.addEventListener\("click"/u);
});

test("admin lê snapshots e salva custo real pela RPC dedicada", () => {
  assert.match(adminScript, /delivery_neighborhood,[\s\S]*delivery_actual_fee/);
  assert.match(adminScript, /Frete real pago ao entregador/);
  assert.match(adminScript, /set_order_actual_delivery_fee/);
  assert.match(adminScript, /actualDeliveryFeeSavingIds\.has\(orderId\)/);
  assert.match(adminScript, /delivery_actual_fee\) -[\s\S]*delivery_fee/);
});
