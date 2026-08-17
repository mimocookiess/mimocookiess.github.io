(function initializeAdminReports(globalScope) {
  "use strict";

  const STORE_TIME_ZONE = "America/Santarem";
  const DEFAULT_PERIOD = "30days";
  const WEEKDAY_LABELS = Object.freeze([
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
    "Domingo"
  ]);
  const BRL = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
  const NUMBER = new Intl.NumberFormat("pt-BR");
  const DECIMAL = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const SHORT_DATE = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC"
  });

  let client = null;
  let elements = null;
  let activePeriod = DEFAULT_PERIOD;
  let selectedRange = null;
  let reportData = null;
  let chartMetric = "revenue";
  let loadedRangeKey = "";
  let loadSequence = 0;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  function toIsoDate(year, month, day) {
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function getStoreDate(value = new Date()) {
    const parts = globalScope.MimoStoreStatus?.getStoreDateTimeParts(value);

    if (parts) return toIsoDate(parts.year, parts.month, parts.day);

    const fallbackParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: STORE_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(value);
    const values = Object.fromEntries(
      fallbackParts
        .filter(part => part.type !== "literal")
        .map(part => [part.type, part.value])
    );

    return `${values.year}-${values.month}-${values.day}`;
  }

  function shiftIsoDate(isoDate, amount) {
    const [year, month, day] = isoDate.split("-").map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + amount));

    return toIsoDate(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate()
    );
  }

  function buildPeriodRange(period, now = new Date()) {
    const today = getStoreDate(now);

    if (period === "today") {
      return { startDate: today, endDate: today };
    }

    if (period === "7days") {
      return { startDate: shiftIsoDate(today, -6), endDate: today };
    }

    if (period === "month") {
      return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
    }

    return { startDate: shiftIsoDate(today, -29), endDate: today };
  }

  function isValidRange(range) {
    return Boolean(
      range &&
      /^\d{4}-\d{2}-\d{2}$/.test(range.startDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(range.endDate) &&
      range.startDate <= range.endDate
    );
  }

  function formatDate(isoDate) {
    return SHORT_DATE.format(new Date(`${isoDate}T12:00:00Z`)).replace(".", "");
  }

  function formatPeriod(range) {
    if (!isValidRange(range)) return "";
    if (range.startDate === range.endDate) return formatDate(range.startDate);
    return `${formatDate(range.startDate)} a ${formatDate(range.endDate)}`;
  }

  function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function formatCurrency(value) {
    return BRL.format(asNumber(value));
  }

  function formatNumber(value) {
    return NUMBER.format(asNumber(value));
  }

  function formatDecimal(value) {
    return DECIMAL.format(asNumber(value));
  }

  function setStatus(type, message) {
    elements.status.className = `reports-status ${type || ""}`.trim();
    elements.status.hidden = !message;
    elements.status.innerHTML = message
      ? `${type === "loading" ? '<div class="reports-loading" aria-hidden="true"></div>' : ""}` +
        `<p>${escapeHtml(message)}</p>` +
        `${type === "error" ? '<button type="button" data-retry-reports>Tentar novamente</button>' : ""}`
      : "";
  }

  function setActivePeriodButton() {
    elements.periodButtons.forEach(button => {
      const isActive = button.dataset.reportPeriod === activePeriod;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function setActiveChartButton() {
    elements.chartButtons.forEach(button => {
      const isActive = button.dataset.reportChart === chartMetric;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function renderSummary(summary) {
    elements.revenue.textContent = formatCurrency(summary.revenue);
    elements.orders.textContent = formatNumber(summary.completed_orders);
    elements.ticket.textContent = formatCurrency(summary.ticket_average);
    elements.cookies.textContent = formatNumber(summary.cookies_sold);
    elements.cookiesPerOrder.textContent =
      `${formatDecimal(summary.cookies_per_order)} cookies/pedido`;
    elements.averageCookie.textContent =
      `${formatCurrency(summary.average_product_value)} por cookie`;
    elements.productRevenue.textContent = formatCurrency(summary.product_revenue);
    elements.deliveryFees.textContent = formatCurrency(summary.delivery_fees);
    elements.completed.textContent = formatNumber(summary.completed_orders);
    elements.cancelled.textContent = formatNumber(summary.cancelled_orders);
    elements.cancellationRate.textContent =
      `${formatDecimal(summary.cancellation_rate)}%`;
  }

  function buildLineChart(data, metric) {
    if (!data.length || data.every(item => asNumber(item[metric]) === 0)) {
      return '<p class="report-empty">Não há vendas concluídas neste período.</p>';
    }

    const width = 760;
    const height = 270;
    const padding = { top: 20, right: 18, bottom: 42, left: 68 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const values = data.map(item => asNumber(item[metric]));
    const maximum = Math.max(...values, 1);
    const xFor = index => data.length === 1
      ? padding.left + plotWidth / 2
      : padding.left + (index / (data.length - 1)) * plotWidth;
    const yFor = value => padding.top + plotHeight - (value / maximum) * plotHeight;
    const points = values
      .map((value, index) => `${xFor(index).toFixed(2)},${yFor(value).toFixed(2)}`)
      .join(" ");
    const areaPoints = `${padding.left},${padding.top + plotHeight} ${points} ` +
      `${padding.left + plotWidth},${padding.top + plotHeight}`;
    const grid = [0, 0.5, 1].map(ratio => {
      const y = padding.top + plotHeight - ratio * plotHeight;
      const labelValue = maximum * ratio;
      const label = metric === "revenue"
        ? formatCurrency(labelValue)
        : formatNumber(Math.round(labelValue));

      return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />` +
        `<text x="${padding.left - 10}" y="${y + 4}" text-anchor="end">${escapeHtml(label)}</text>`;
    }).join("");
    const labelIndexes = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];
    const labels = labelIndexes.map(index =>
      `<text x="${xFor(index)}" y="${height - 13}" text-anchor="middle">` +
      `${escapeHtml(formatDate(data[index].date))}</text>`
    ).join("");
    const dots = data.map((item, index) => {
      const value = asNumber(item[metric]);
      const label = metric === "revenue" ? formatCurrency(value) : formatNumber(value);
      return `<circle cx="${xFor(index)}" cy="${yFor(value)}" r="4">` +
        `<title>${escapeHtml(`${formatDate(item.date)}: ${label}`)}</title></circle>`;
    }).join("");

    return `<svg viewBox="0 0 ${width} ${height}" role="img" ` +
      `aria-label="${metric === "revenue" ? "Faturamento" : "Pedidos"} por dia">` +
      `<g class="report-chart-grid">${grid}${labels}</g>` +
      `<polygon class="report-chart-area" points="${areaPoints}" />` +
      `<polyline class="report-chart-line" points="${points}" />` +
      `<g class="report-chart-dots">${dots}</g></svg>`;
  }

  function renderSalesChart() {
    elements.salesChart.innerHTML = buildLineChart(reportData?.daily || [], chartMetric);
  }

  function renderProducts(products) {
    if (!products.length) {
      elements.productsBody.innerHTML =
        '<tr><td class="report-table-empty" colspan="6">Nenhum produto vendido no período.</td></tr>';
      return;
    }

    elements.productsBody.innerHTML = products.map(product => `
      <tr>
        <th scope="row" data-label="Produto">${escapeHtml(product.name)}</th>
        <td data-label="Unidades">${formatNumber(product.units)}</td>
        <td data-label="Pedidos">${formatNumber(product.orders)}</td>
        <td data-label="Receita">${escapeHtml(formatCurrency(product.revenue))}</td>
        <td data-label="% unidades">
          <span class="report-share-value">${formatDecimal(product.unit_share)}%</span>
          <span class="report-share-bar"><i style="width:${Math.min(100, asNumber(product.unit_share))}%"></i></span>
        </td>
        <td data-label="% receita">
          <span class="report-share-value">${formatDecimal(product.revenue_share)}%</span>
          <span class="report-share-bar"><i style="width:${Math.min(100, asNumber(product.revenue_share))}%"></i></span>
        </td>
      </tr>
    `).join("");
  }

  function renderWeekdays(weekdays) {
    const maximum = Math.max(...weekdays.map(day => asNumber(day.orders)), 1);

    elements.weekdays.innerHTML = weekdays.map(day => {
      const orders = asNumber(day.orders);
      const width = (orders / maximum) * 100;
      const label = WEEKDAY_LABELS[asNumber(day.weekday) - 1] || "Dia";

      return `<div class="report-bar-row">
        <span>${escapeHtml(label)}</span>
        <div class="report-bar-track"><i style="width:${width}%"></i></div>
        <strong>${formatNumber(orders)}</strong>
        <small>${escapeHtml(formatCurrency(day.revenue))}</small>
      </div>`;
    }).join("");
  }

  function renderHours(hours) {
    const maximum = Math.max(...hours.map(hour => asNumber(hour.orders)), 1);

    elements.hours.innerHTML = hours.map(hour => {
      const orders = asNumber(hour.orders);
      const level = orders / maximum;

      return `<article class="report-hour" style="--hour-level:${level.toFixed(3)}" ` +
        `title="${escapeHtml(`${formatNumber(orders)} pedido(s) · ${formatCurrency(hour.revenue)}`)}">` +
        `<strong>${pad(asNumber(hour.hour))}h</strong>` +
        `<span>${formatNumber(orders)} ped.</span>` +
        `<small>${escapeHtml(formatCurrency(hour.revenue))}</small>` +
        `</article>`;
    }).join("");
  }

  function renderFulfillment(rows) {
    if (!rows.length) {
      elements.fulfillmentBody.innerHTML =
        '<tr><td class="report-table-empty" colspan="5">Sem pedidos concluídos no período.</td></tr>';
      return;
    }

    elements.fulfillmentBody.innerHTML = rows.map(row => `
      <tr>
        <th scope="row" data-label="Modalidade">${escapeHtml(row.method)}</th>
        <td data-label="Pedidos">${formatNumber(row.orders)}</td>
        <td data-label="%">${formatDecimal(row.order_share)}%</td>
        <td data-label="Receita">${escapeHtml(formatCurrency(row.revenue))}</td>
        <td data-label="Ticket médio">${escapeHtml(formatCurrency(row.ticket_average))}</td>
      </tr>
    `).join("");
  }

  function render(data) {
    const summary = data?.summary || {};

    renderSummary(summary);
    renderProducts(Array.isArray(data?.products) ? data.products : []);
    renderWeekdays(Array.isArray(data?.weekdays) ? data.weekdays : []);
    renderHours(Array.isArray(data?.hours) ? data.hours : []);
    renderFulfillment(Array.isArray(data?.fulfillment) ? data.fulfillment : []);
    renderSalesChart();
  }

  async function load({ force = false } = {}) {
    if (!client || !elements) return;

    const range = selectedRange || buildPeriodRange(activePeriod);

    if (!isValidRange(range)) return;

    const rangeKey = `${range.startDate}:${range.endDate}`;
    if (!force && reportData && loadedRangeKey === rangeKey) return;

    const sequence = ++loadSequence;
    elements.content.hidden = true;
    elements.refreshButton.disabled = true;
    elements.periodLabel.textContent = `Período: ${formatPeriod(range)} · ${STORE_TIME_ZONE}`;
    setStatus("loading", "Carregando indicadores...");

    const { data, error } = await client.rpc("get_admin_reports", {
      p_start_date: range.startDate,
      p_end_date: range.endDate
    });

    if (sequence !== loadSequence) return;

    elements.refreshButton.disabled = false;

    if (error) {
      console.error("Não foi possível carregar os relatórios.", error);
      setStatus(
        "error",
        "Não foi possível carregar os relatórios. Tente novamente."
      );
      return;
    }

    reportData = data || {};
    loadedRangeKey = rangeKey;
    render(reportData);

    const totalOrders = asNumber(reportData?.audit?.orders_total);
    if (totalOrders === 0) {
      setStatus("empty", "Não há pedidos no período selecionado.");
    } else {
      setStatus("", "");
    }

    elements.content.hidden = totalOrders === 0;
  }

  function selectPeriod(period) {
    activePeriod = period;
    selectedRange = period === "custom" ? selectedRange : buildPeriodRange(period);
    elements.customPeriod.hidden = period !== "custom";
    setActivePeriodButton();

    if (period !== "custom") load({ force: true });
  }

  function bindEvents() {
    elements.periodButtons.forEach(button => {
      button.addEventListener("click", () => selectPeriod(button.dataset.reportPeriod));
    });

    elements.periodForm.addEventListener("submit", event => {
      event.preventDefault();
      const range = {
        startDate: elements.startDate.value,
        endDate: elements.endDate.value
      };

      if (!isValidRange(range)) {
        setStatus("error", "Informe um período válido.");
        return;
      }

      selectedRange = range;
      load({ force: true });
    });

    elements.refreshButton.addEventListener("click", () => load({ force: true }));

    elements.chartButtons.forEach(button => {
      button.addEventListener("click", () => {
        chartMetric = button.dataset.reportChart;
        setActiveChartButton();
        renderSalesChart();
      });
    });

    elements.status.addEventListener("click", event => {
      if (event.target.closest("[data-retry-reports]")) load({ force: true });
    });
  }

  function init(options = {}) {
    if (typeof document === "undefined") return;

    client = options.client;
    elements = {
      periodForm: document.querySelector("#reports-period-form"),
      periodButtons: Array.from(document.querySelectorAll("[data-report-period]")),
      customPeriod: document.querySelector("#reports-custom-period"),
      startDate: document.querySelector("#reports-start-date"),
      endDate: document.querySelector("#reports-end-date"),
      periodLabel: document.querySelector("#reports-period-label"),
      refreshButton: document.querySelector("#refresh-reports-button"),
      status: document.querySelector("#reports-status"),
      content: document.querySelector("#reports-content"),
      revenue: document.querySelector("#report-revenue"),
      orders: document.querySelector("#report-orders"),
      ticket: document.querySelector("#report-ticket"),
      cookies: document.querySelector("#report-cookies"),
      cookiesPerOrder: document.querySelector("#report-cookies-per-order"),
      averageCookie: document.querySelector("#report-average-cookie"),
      productRevenue: document.querySelector("#report-product-revenue"),
      deliveryFees: document.querySelector("#report-delivery-fees"),
      completed: document.querySelector("#report-completed"),
      cancelled: document.querySelector("#report-cancelled"),
      cancellationRate: document.querySelector("#report-cancellation-rate"),
      salesChart: document.querySelector("#report-sales-chart"),
      productsBody: document.querySelector("#report-products-body"),
      weekdays: document.querySelector("#report-weekdays"),
      hours: document.querySelector("#report-hours"),
      fulfillmentBody: document.querySelector("#report-fulfillment-body"),
      chartButtons: Array.from(document.querySelectorAll("[data-report-chart]"))
    };

    selectedRange = buildPeriodRange(DEFAULT_PERIOD);
    elements.startDate.value = selectedRange.startDate;
    elements.endDate.value = selectedRange.endDate;
    setActivePeriodButton();
    setActiveChartButton();
    bindEvents();
  }

  function reset() {
    loadSequence += 1;
    reportData = null;
    loadedRangeKey = "";

    if (!elements) return;
    elements.content.hidden = true;
    setStatus("loading", "Carregando indicadores...");
  }

  const api = Object.freeze({
    buildPeriodRange,
    formatPeriod,
    init,
    isValidRange,
    load,
    reset,
    shiftIsoDate
  });

  globalScope.MimoAdminReports = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
