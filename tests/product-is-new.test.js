const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const readProjectFile = relativePath => fs.readFileSync(
  path.join(__dirname, "..", relativePath),
  "utf8"
);

test("migration adiciona products.is_new com default seguro", () => {
  const migration = readProjectFile(
    "supabase/migrations/20260827120000_add_products_is_new.sql"
  );

  assert.match(
    migration,
    /alter table public\.products[\s\S]*add column is_new boolean not null default false/i
  );
  assert.doesNotMatch(migration, /\b(?:update|delete|truncate|drop)\b/i);
});

test("painel administra is_new independentemente da visibilidade", () => {
  const html = readProjectFile("admin/index.html");
  const script = readProjectFile("admin/admin.js");
  const newCheckboxPosition = html.indexOf('id="product-is-new"');
  const visibilityCheckboxPosition = html.indexOf('id="product-available"');

  assert.ok(newCheckboxPosition >= 0);
  assert.ok(newCheckboxPosition < visibilityCheckboxPosition);
  assert.match(html, /Exibir selo “NOVIDADE ✨”/);
  assert.match(script, /\bis_new,\s*\n\s*stock,/);
  assert.match(script, /is_new: productIsNew\.checked/);
  assert.match(script, /productIsNew\.checked = product\.is_new === true/);
  assert.match(script, /productIsNew\.checked = false/);
  assert.match(script, /product\.is_new === true \? " · novidade" : ""/);
});

test("catálogo fallback não marca produtos existentes como novidade", () => {
  const fallback = readProjectFile("products.js");
  const productCount = (fallback.match(/\bid:/g) || []).length;
  const falseCount = (fallback.match(/\bis_new:\s*false/g) || []).length;

  assert.ok(productCount > 0);
  assert.equal(falseCount, productCount);
  assert.doesNotMatch(fallback, /\bis_new:\s*true/);
});
