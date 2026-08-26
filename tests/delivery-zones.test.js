const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterDeliveryZones,
  normalizeDeliveryZoneSearch
} = require("../delivery-zones.js");

const zones = [
  ["maica", "Maicá", 16.2],
  ["mapiri", "Mapiri", 12],
  ["maracana", "Maracanã", 17],
  ["maracana-i", "Maracanã I", 17],
  ["mararu", "Mararú", 17],
  ["matinha", "Matinha", 16.2],
  ["sao-cristovao", "São Cristóvão", 17],
  ["sao-francisco", "São Francisco", 14.4],
  ["sao-jose-operario", "São José Operário", 12.6],
  ["jua", "Juá", 12.6],
  ["espirito-santo", "Espírito Santo", 12.6],
  ["perola-do-maica", "Pérola do Maicá", 17],
  ["nova-jerusalem", "Nova Jerusalém", 14.4],
  ["nova-republica", "Nova República", 12.6],
  ["nova-vitoria", "Nova Vitória", 17]
].map(([slug, name, fee]) => ({ slug, name, fee }));

function namesFor(query, limit = 7) {
  return filterDeliveryZones(zones, query, limit).map(zone => zone.name);
}

test("normalização ignora acentos, caixa e espaços extras", () => {
  assert.equal(normalizeDeliveryZoneSearch("  SÃO   José  "), "sao jose");
  assert.equal(normalizeDeliveryZoneSearch("ESPÍRITO"), "espirito");
  assert.equal(normalizeDeliveryZoneSearch("  JuÁ "), "jua");
});

test("busca encontra os grupos oficiais esperados", () => {
  assert.deepEqual(namesFor("ma").slice(0, 6), [
    "Maicá", "Mapiri", "Maracanã", "Maracanã I", "Mararú", "Matinha"
  ]);
  assert.deepEqual(namesFor("sao"), [
    "São Cristóvão", "São Francisco", "São José Operário"
  ]);
  assert.deepEqual(namesFor("são"), namesFor("sao"));
  assert.deepEqual(namesFor("jua"), ["Juá"]);
  assert.deepEqual(namesFor("espirito"), ["Espírito Santo"]);
  assert.equal(namesFor("pe").includes("Pérola do Maicá"), true);
  assert.deepEqual(namesFor("nova"), [
    "Nova Jerusalém", "Nova República", "Nova Vitória"
  ]);
});

test("busca sem correspondência e consulta vazia não inventam opções", () => {
  assert.deepEqual(namesFor("Alter do Chão"), []);
  assert.deepEqual(namesFor("   "), []);
});

test("limite impede uma lista longa no mobile", () => {
  assert.equal(namesFor("a", 5).length, 5);
});
