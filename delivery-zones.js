(function initializeDeliveryZoneHelpers(globalScope) {
  "use strict";

  function normalizeDeliveryZoneSearch(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .trim()
      .replace(/\s+/g, " ");
  }

  function filterDeliveryZones(zones, query, limit = 7) {
    const normalizedQuery = normalizeDeliveryZoneSearch(query);

    if (!normalizedQuery) return [];

    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : 7;

    return (Array.isArray(zones) ? zones : [])
      .filter(zone =>
        zone &&
        typeof zone.slug === "string" &&
        typeof zone.name === "string" &&
        Number.isFinite(Number(zone.fee)) &&
        Number(zone.fee) >= 0 &&
        normalizeDeliveryZoneSearch(zone.name).includes(normalizedQuery)
      )
      .slice(0, safeLimit);
  }

  const helpers = Object.freeze({
    filterDeliveryZones,
    normalizeDeliveryZoneSearch
  });

  globalScope.MimoDeliveryZones = helpers;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = helpers;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
