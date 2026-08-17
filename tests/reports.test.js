const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildPeriodRange,
  isValidRange,
  shiftIsoDate
} = require("../admin/reports.js");

const beforeMidnightInSantarem = new Date("2026-08-17T02:00:00.000Z");

test("períodos rápidos usam a data local de America/Santarem", () => {
  assert.deepEqual(buildPeriodRange("today", beforeMidnightInSantarem), {
    startDate: "2026-08-16",
    endDate: "2026-08-16"
  });
  assert.deepEqual(buildPeriodRange("7days", beforeMidnightInSantarem), {
    startDate: "2026-08-10",
    endDate: "2026-08-16"
  });
  assert.deepEqual(buildPeriodRange("30days", beforeMidnightInSantarem), {
    startDate: "2026-07-18",
    endDate: "2026-08-16"
  });
  assert.deepEqual(buildPeriodRange("month", beforeMidnightInSantarem), {
    startDate: "2026-08-01",
    endDate: "2026-08-16"
  });
});

test("deslocamento de datas atravessa meses e anos sem depender do fuso local", () => {
  assert.equal(shiftIsoDate("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftIsoDate("2028-03-01", -1), "2028-02-29");
});

test("período personalizado rejeita datas ausentes, invertidas ou malformadas", () => {
  assert.equal(isValidRange({
    startDate: "2026-08-01",
    endDate: "2026-08-17"
  }), true);
  assert.equal(isValidRange({
    startDate: "2026-08-18",
    endDate: "2026-08-17"
  }), false);
  assert.equal(isValidRange({ startDate: "", endDate: "2026-08-17" }), false);
  assert.equal(isValidRange(null), false);
});

test("RPC de relatórios restringe execução e não retorna campos de PII", () => {
  const migration = fs.readFileSync(path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20260817193000_create_admin_reports_rpc.sql"
  ), "utf8");

  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(
    migration,
    /auth\.uid\(\) is distinct from v_admin_user_id/i
  );
  assert.match(
    migration,
    /revoke all on function public\.get_admin_reports\(date, date\)[\s\S]*from public, anon, authenticated, service_role/i
  );
  assert.match(
    migration,
    /grant execute on function public\.get_admin_reports\(date, date\)[\s\S]*to authenticated/i
  );

  [
    "customer_name",
    "customer_address",
    "notes",
    "ga_client_id",
    "ga_session_id"
  ].forEach(column => assert.doesNotMatch(migration, new RegExp(column, "i")));
});

test("correção consolida produtos pelo slug sem reescrever snapshots", () => {
  const migration = fs.readFileSync(path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20260817204000_consolidate_admin_report_products.sql"
  ), "utf8");

  assert.match(
    migration,
    /create or replace function public\.get_admin_reports/i
  );
  assert.match(migration, /from public\.orders/i);
  assert.match(migration, /join public\.order_items/i);
  assert.match(migration, /join public\.products/i);
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /from pg_catalog\.generate_series/i);
  assert.match(
    migration,
    /group by order_items\.product_slug, products\.name/i
  );
  assert.doesNotMatch(
    migration,
    /group by order_items\.product_slug, order_items\.product_name/i
  );
  assert.doesNotMatch(
    migration,
    /(?:insert into|update|delete from)\s+public\.(?:orders|order_items|products)/i
  );

  ["jsonb_build_object", "jsonb_agg", "round", "sum", "count"]
    .forEach(functionName => {
      const unqualifiedCall = new RegExp(
        `(?<!pg_catalog\\.)\\b${functionName}\\(`,
        "i"
      );
      assert.doesNotMatch(migration, unqualifiedCall);
    });
});

test("dashboard consulta a RPC e renderiza os principais estados", async () => {
  class FakeElement {
    constructor(dataset = {}) {
      this.dataset = dataset;
      this.hidden = false;
      this.disabled = false;
      this.value = "";
      this.textContent = "";
      this.innerHTML = "";
      this.className = "";
      this.listeners = new Map();
      const classes = new Set();
      this.classList = {
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
      };
    }

    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }

    setAttribute() {}
  }

  const ids = [
    "reports-period-form", "reports-custom-period", "reports-start-date",
    "reports-end-date", "reports-period-label", "refresh-reports-button",
    "reports-status", "reports-content", "report-revenue", "report-orders",
    "report-ticket", "report-cookies", "report-cookies-per-order",
    "report-average-cookie", "report-product-revenue", "report-delivery-fees",
    "report-completed", "report-cancelled", "report-cancellation-rate",
    "report-sales-chart", "report-products-body", "report-weekdays",
    "report-hours", "report-fulfillment-body"
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement()]));
  const periodButtons = ["today", "7days", "30days", "month", "custom"]
    .map(period => new FakeElement({ reportPeriod: period }));
  const chartButtons = ["revenue", "orders"]
    .map(metric => new FakeElement({ reportChart: metric }));
  const previousDocument = global.document;

  global.document = {
    querySelector: selector => elements[selector.replace(/^#/, "")],
    querySelectorAll: selector => selector === "[data-report-period]"
      ? periodButtons
      : chartButtons
  };

  const calls = [];
  const reportFixture = {
    summary: {
      revenue: 100,
      completed_orders: 4,
      ticket_average: 25,
      cookies_sold: 8,
      cookies_per_order: 2,
      average_product_value: 12.5,
      product_revenue: 100,
      delivery_fees: 0,
      cancelled_orders: 1,
      cancellation_rate: 20
    },
    audit: { orders_total: 5 },
    daily: [{ date: "2026-08-17", orders: 4, revenue: 100 }],
    products: [{
      name: "Tradicional",
      units: 8,
      orders: 4,
      revenue: 100,
      unit_share: 100,
      revenue_share: 100
    }],
    weekdays: Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      orders: index === 0 ? 4 : 0,
      revenue: index === 0 ? 100 : 0
    })),
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orders: hour === 10 ? 4 : 0,
      revenue: hour === 10 ? 100 : 0
    })),
    fulfillment: [{
      method: "Retirada",
      orders: 4,
      order_share: 100,
      revenue: 100,
      ticket_average: 25
    }]
  };
  let nextReport = reportFixture;
  let nextError = null;
  const client = {
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      return {
        error: nextError,
        data: nextReport
      };
    }
  };

  try {
    const reports = require("../admin/reports.js");
    reports.init({ client });
    await reports.load({ force: true });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "get_admin_reports");
    assert.equal(elements["reports-content"].hidden, false);
    assert.equal(elements["report-revenue"].textContent, "R$ 100,00");
    assert.equal(elements["report-orders"].textContent, "4");
    assert.match(elements["report-products-body"].innerHTML, /Tradicional/);
    assert.match(elements["report-sales-chart"].innerHTML, /<svg/);
    assert.doesNotMatch(elements["reports-content"].innerHTML, /NaN|Infinity/);

    nextReport = {
      ...reportFixture,
      summary: {
        ...reportFixture.summary,
        revenue: 0,
        completed_orders: 0,
        ticket_average: 0,
        cookies_sold: 0,
        cookies_per_order: 0,
        average_product_value: 0,
        product_revenue: 0,
        cancelled_orders: 1,
        cancellation_rate: 100
      },
      audit: { orders_total: 1 },
      daily: [{ date: "2026-08-17", orders: 0, revenue: 0 }],
      products: [],
      fulfillment: []
    };
    await reports.load({ force: true });
    assert.equal(elements["reports-content"].hidden, false);
    assert.equal(elements["report-cancelled"].textContent, "1");
    assert.match(elements["report-sales-chart"].innerHTML, /Não há vendas/);

    nextReport = {
      ...nextReport,
      summary: { ...nextReport.summary, cancelled_orders: 0, cancellation_rate: 0 },
      audit: { orders_total: 0 }
    };
    await reports.load({ force: true });
    assert.equal(elements["reports-content"].hidden, true);
    assert.match(elements["reports-status"].innerHTML, /Não há pedidos/);

    nextError = new Error("falha simulada");
    await reports.load({ force: true });
    assert.equal(elements["reports-content"].hidden, true);
    assert.match(elements["reports-status"].innerHTML, /Tentar novamente/);

    nextError = null;
    let finishRequest;
    client.rpc = () => new Promise(resolve => { finishRequest = resolve; });
    const pendingLoad = reports.load({ force: true });
    assert.match(elements["reports-status"].innerHTML, /Carregando indicadores/);
    finishRequest({ error: null, data: reportFixture });
    await pendingLoad;
  } finally {
    global.document = previousDocument;
  }
});
