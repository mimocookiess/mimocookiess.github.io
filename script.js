const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});
const {
  STORE_MODES,
  STORE_TIME_ZONE,
  getStoreDateTimeParts,
  getStoreState: resolveStoreState,
  normalizeStoreMode,
  toValidDate
} = MimoStoreStatus;

const cart = new Map();
let PRODUCTS = [];
let isSubmitting = false;
let lastRegisteredSignature = null;
let lastWhatsAppUrl = null;
let turnstileToken = null;
let turnstileWidgetId = null;
let turnstileApiRequested = false;
let cartConfirmationTimeout = null;
let cartConfirmationFrame = null;
let checkoutAttempt = null;
let checkoutStarted = false;
let deliveryZones = [];
let selectedDeliveryZone = null;
let visibleDeliveryZones = [];
let activeDeliveryZoneIndex = -1;
const trackedOrderCreatedIds = new Set();
let storeSettings = {
  isPaused: false,
  mode: STORE_MODES.OPEN,
  returnTime: null,
  pauseMessage: ""
};
let storeStateTimer = null;
let productsLoadedFromSupabase = false;

const TURNSTILE_ACTION = "create_order";
const CART_SWIPE_CLOSE_THRESHOLD = 80;
const CART_SWIPE_DIRECTION_THRESHOLD = 10;
const CART_SWIPE_HORIZONTAL_RATIO = 1.2;

const WHATSAPP_EMOJIS = Object.freeze({
  cookie: String.fromCodePoint(0x1F36A),
  heart: String.fromCodePoint(0x1F497),
  customer: String.fromCodePoint(0x1F464),
  cart: String.fromCodePoint(0x1F6D2),
  payment: String.fromCodePoint(0x1F4B3),
  location: String.fromCodePoint(0x1F4CD),
  pin: String.fromCodePoint(0x1F4CC),
  home: String.fromCodePoint(0x1F3E0),
  delivery: String.fromCodePoint(0x1F6F5),
  notes: String.fromCodePoint(0x1F4DD)
});

function shouldIncludeWhatsAppEmojis() {
  if (typeof navigator.userAgentData?.mobile === "boolean") {
    return navigator.userAgentData.mobile;
  }

  const userAgent = navigator.userAgent || "";
  const hasMobileUserAgent =
    /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile|BlackBerry|webOS/i
      .test(userAgent);
  const isIPadOS =
    /Macintosh/i.test(userAgent) &&
    navigator.maxTouchPoints > 1;

  return hasMobileUserAgent || isIPadOS;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function getSafeImageSource(value) {
  const source = String(value ?? "").trim();

  if (!source) return "";

  try {
    const url = new URL(source, window.location.href);

    return ["http:", "https:"].includes(url.protocol)
      ? escapeHtml(source)
      : "";
  } catch {
    return "";
  }
}

const grid = document.querySelector("#product-grid");
const cartFab = document.querySelector("#cart-fab");
const cartFabSummary = document.querySelector("#cart-fab-summary");
const panel = document.querySelector("#cart-panel");
const overlay = document.querySelector("#overlay");
const closeCartButton = document.querySelector("#close-cart");
const cartItems = document.querySelector("#cart-items");
const subtotalEl = document.querySelector("#subtotal");
const totalEl = document.querySelector("#total");
const shippingEl = document.querySelector("#shipping");
const form = document.querySelector("#checkout-form");
const addressFields = document.querySelector("#address-fields");
const addressInput = document.querySelector("#customer-address");
const deliveryNeighborhoodInput = document.querySelector(
  "#delivery-neighborhood"
);
const deliveryNeighborhoodOptions = document.querySelector(
  "#delivery-neighborhood-options"
);
const deliveryNeighborhoodSelectedIndicator = document.querySelector(
  "#delivery-neighborhood-selected-indicator"
);
const deliveryNeighborhoodMessage = document.querySelector(
  "#delivery-neighborhood-message"
);
const deliveryChoiceFee = document.querySelector("#delivery-choice-fee");
const whatsappButton = document.querySelector("#whatsapp-button");
const turnstileMessage = document.querySelector("#turnstile-message");
const storePauseBanner = document.querySelector("#store-pause-banner");
const storePauseTitle = document.querySelector("#store-pause-title");
const storePauseReturn = document.querySelector("#store-pause-return");
const storePauseMessage = document.querySelector("#store-pause-message");
const cartPauseNotice = document.querySelector("#cart-pause-notice");
const cartPauseTitle = document.querySelector("#cart-pause-title");
const cartPauseMessage = document.querySelector("#cart-pause-message");

const STORE_NOTICE_ICON = "🍪";
const DEFAULT_PAUSE_MESSAGE =
  "Estamos fazendo uma pausa rápida. Você pode montar seu pedido normalmente e enviá-lo para atendermos assim que voltarmos.";
const CLOSED_STORE_MESSAGE =
  "Você pode montar seu pedido normalmente e deixá-lo no carrinho, mas o envio ficará disponível somente quando a loja reabrir.";

function isSameStoreDate(firstDate, secondDate) {
  const firstParts = getStoreDateTimeParts(firstDate);
  const secondParts = getStoreDateTimeParts(secondDate);

  return Boolean(
    firstParts &&
    secondParts &&
    firstParts.year === secondParts.year &&
    firstParts.month === secondParts.month &&
    firstParts.day === secondParts.day
  );
}

function buildWhatsAppMessage({
  orderNumber,
  customerName,
  items,
  payment,
  delivery,
  address,
  neighborhood,
  notes,
  subtotal,
  deliveryFee,
  total,
  includeEmojis = true
}) {
  const emojiPrefix = name => includeEmojis
    ? `${WHATSAPP_EMOJIS[name]} `
    : "";
  const greetingEmojis = includeEmojis
    ? ` ${WHATSAPP_EMOJIS.cookie}${WHATSAPP_EMOJIS.heart}`
    : "";
  const normalizedNotes = String(notes ?? "").trim();
  const hasNotes =
    normalizedNotes.toLocaleLowerCase("pt-BR") !== "sem observações" &&
    normalizedNotes.length > 0;
  const formattedSubtotal = BRL.format(subtotal);
  const formattedDeliveryFee = BRL.format(deliveryFee);
  const formattedTotal = BRL.format(total);
  const receivingLines = delivery === "Entrega"
    ? [
        `${emojiPrefix("delivery")}*ENTREGA*`,
        `${emojiPrefix("home")}*Endereço:* ${address}`,
        `${emojiPrefix("pin")}*Bairro:* ${neighborhood}`
      ]
    : [
        `${emojiPrefix("location")}*RETIRADA*`,
        `${emojiPrefix("home")}${STORE_CONFIG.pickupAddress}`
      ];

  const lines = [
    `Olá! Este é meu pedido na Mimo Cookies${greetingEmojis}`,
    "",
    `*Pedido Mimo nº ${orderNumber}*`,
    `${emojiPrefix("customer")}*Cliente:* ${customerName}`,
    "",
    `${emojiPrefix("cart")}*Itens do pedido:*`,
    ...items,
    "",
    `${emojiPrefix("payment")}*Pagamento:* ${payment}`,
    "",
    ...receivingLines
  ];

  if (hasNotes) {
    lines.push(
      "",
      `${emojiPrefix("notes")}*Observações:* ${normalizedNotes}`
    );
  }

  if (delivery === "Entrega") {
    lines.push(
      "",
      `*Subtotal:* ${formattedSubtotal}`,
      `*Frete:* ${formattedDeliveryFee}`,
      `*Total:* ${formattedTotal}`
    );
  } else {
    lines.push("", `*Total:* ${formattedTotal}`);
  }

  lines.push(
    "",
    "_Pedido sujeito à confirmação da Mimo Cookies._"
  );

  return lines.join("\n");
}

function formatLocalHour(date) {
  const parts = getStoreDateTimeParts(date);

  if (!parts) return "";

  const { hour: hours, minute: minutes } = parts;

  return minutes === 0
    ? `${hours}h`
    : `${hours}h${String(minutes).padStart(2, "0")}`;
}

function formatReturnTime(value, now = new Date()) {
  const date = toValidDate(value);
  const currentDate = toValidDate(now);

  if (!date || !currentDate) return "";

  const formattedHour = formatLocalHour(date);

  if (isSameStoreDate(date, currentDate)) {
    return formattedHour;
  }

  const nowParts = getStoreDateTimeParts(currentDate);
  const tomorrow = nowParts && new Date(Date.UTC(
    nowParts.year,
    nowParts.month - 1,
    nowParts.day + 1,
    12
  ));

  if (tomorrow && isSameStoreDate(date, tomorrow)) {
    return `amanhã às ${formattedHour}`;
  }

  const dateParts = getStoreDateTimeParts(date);
  const includeYear = dateParts.year !== nowParts.year;
  const formattedDate = new Intl.DateTimeFormat("pt-BR", {
    timeZone: STORE_TIME_ZONE,
    day: "numeric",
    month: "long",
    ...(includeYear ? { year: "numeric" } : {})
  }).format(date);

  return `${formattedDate}, às ${formattedHour}`;
}

function getStoreState(now = new Date()) {
  return resolveStoreState(storeSettings, now);
}

function getClosedDetails(now = new Date()) {
  const returnDate = toValidDate(storeSettings.returnTime);
  const formattedReturnTime = formatReturnTime(storeSettings.returnTime, now);
  const returnHour = formatLocalHour(returnDate);
  const returnsToday = isSameStoreDate(returnDate, now);
  let returnText = "";

  if (formattedReturnTime) {
    returnText = returnsToday
      ? `Cookies quentinhos a partir das ${returnHour}.`
      : formattedReturnTime.startsWith("amanhã")
        ? `Amanhã tem mais cookies quentinhos a partir das ${returnHour}.`
        : `Retornamos em ${formattedReturnTime}.`;
  }

  return {
    formattedReturnTime,
    returnText,
    title: returnsToday
      ? `${STORE_NOTICE_ICON} Ainda estamos fechados!`
      : `${STORE_NOTICE_ICON} Por hoje, encerramos!`,
    buttonText: formattedReturnTime
      ? `Pedidos fechados até ${formattedReturnTime}`
      : "Pedidos fechados"
  };
}

function getPauseDetails() {
  const formattedReturnTime = formatReturnTime(storeSettings.returnTime);
  const message = storeSettings.pauseMessage || DEFAULT_PAUSE_MESSAGE;

  return {
    formattedReturnTime,
    message,
    returnText: formattedReturnTime
      ? `Retorno previsto: ${formattedReturnTime}.`
      : ""
  };
}

function renderStoreSettings() {
  const storeState = getStoreState();
  const isPaused = storeState !== STORE_MODES.OPEN;
  const { message, returnText } = getPauseDetails();

  if (storeStateTimer !== null) {
    window.clearTimeout(storeStateTimer);
    storeStateTimer = null;
  }

  storePauseBanner.hidden = !isPaused;
  cartPauseNotice.hidden = !isPaused;

  if (!isPaused) {
    storeSettings.isPaused = false;
    storeSettings.mode = STORE_MODES.OPEN;
    storeSettings.returnTime = null;
    refreshWhatsappButton();
    return;
  }

  const returnDate = toValidDate(storeSettings.returnTime);

  if (returnDate) {
    const delay = returnDate.getTime() - Date.now();

    if (delay > 0) {
      storeStateTimer = window.setTimeout(
        renderStoreSettings,
        Math.min(delay + 50, 2_147_483_647)
      );
    }
  }

  if (storeState === STORE_MODES.CLOSED_TODAY) {
    const { title, returnText: closedReturnText } = getClosedDetails();

    storePauseTitle.textContent = title;
    storePauseReturn.textContent = "";
    storePauseReturn.hidden = true;
    storePauseMessage.textContent = closedReturnText;
    storePauseMessage.hidden = !closedReturnText;
    cartPauseTitle.textContent = title;
    cartPauseMessage.textContent = [closedReturnText, CLOSED_STORE_MESSAGE]
      .filter(Boolean)
      .join(" ");
    refreshWhatsappButton();
    return;
  }

  storePauseTitle.textContent = `${STORE_NOTICE_ICON} Pausa rapidinha!`;
  storePauseReturn.textContent = returnText;
  storePauseReturn.hidden = !returnText;
  storePauseMessage.textContent = message;
  storePauseMessage.hidden = false;
  cartPauseTitle.textContent = `${STORE_NOTICE_ICON} Atendimento em pausa`;
  cartPauseMessage.textContent = [returnText, message]
    .filter(Boolean)
    .join(" ");
  refreshWhatsappButton();
}

async function loadStoreSettings() {
  try {
    const { data, error } = await supabaseClient
      .from("store_settings")
      .select("is_paused, store_mode, return_time, pause_message")
      .eq("id", 1)
      .maybeSingle();

    if (error) throw error;

    if (!data) return;

    storeSettings = {
      isPaused: data.is_paused === true,
      mode: normalizeStoreMode(data.store_mode, data.is_paused === true),
      returnTime: data.return_time || null,
      pauseMessage: String(data.pause_message || "").trim()
    };

    renderStoreSettings();
  } catch (error) {
    console.warn(
      "Não foi possível carregar o status da loja. Mantendo o funcionamento normal.",
      error
    );
  }
}

const cartConfirmation = document.createElement("div");
cartConfirmation.className = "cart-confirmation";
cartConfirmation.setAttribute("role", "status");
cartConfirmation.setAttribute("aria-live", "polite");
cartConfirmation.setAttribute("aria-atomic", "true");
document.body.append(cartConfirmation);
cartConfirmation.addEventListener("transitionend", event => {
  if (
    event.propertyName === "opacity" &&
    !cartConfirmation.classList.contains("visible")
  ) {
    cartConfirmation.textContent = "";
  }
});

function showCartConfirmation(productName) {
  window.clearTimeout(cartConfirmationTimeout);
  window.cancelAnimationFrame(cartConfirmationFrame);

  cartConfirmation.textContent = "";

  cartConfirmationFrame = window.requestAnimationFrame(() => {
    cartConfirmation.textContent = `${productName} adicionado ao carrinho.`;
    cartConfirmation.classList.add("visible");

    cartConfirmationTimeout = window.setTimeout(() => {
      cartConfirmation.classList.remove("visible");
    }, 2500);
  });
}

function setTurnstileMessage(text, type = "") {
  turnstileMessage.textContent = text;
  turnstileMessage.className = "turnstile-message";

  if (type) {
    turnstileMessage.classList.add(type);
  }
}

function handleTurnstileUnavailable() {
  turnstileToken = null;
  setTurnstileMessage(
    "Não foi possível carregar a verificação de segurança.",
    "error"
  );
  refreshWhatsappButton();
}

function initializeTurnstile() {
  if (turnstileWidgetId !== null) return;

  const siteKey =
    String(STORE_CONFIG.turnstileSiteKey || "").trim();

  if (!siteKey) {
    setTurnstileMessage(
      "A verificação de segurança ainda não foi configurada.",
      "error"
    );
    refreshWhatsappButton();
    return;
  }

  if (!window.turnstile) {
    handleTurnstileUnavailable();
    return;
  }

  turnstileWidgetId = window.turnstile.render(
    "#turnstile-widget",
    {
      sitekey: siteKey,
      action: TURNSTILE_ACTION,
      size: window.matchMedia("(max-width: 370px)").matches
        ? "compact"
        : "flexible",
      callback: token => {
        turnstileToken = token;
        setTurnstileMessage(
          "Verificação concluída.",
          "success"
        );
        refreshWhatsappButton();
      },
      "expired-callback": () => {
        turnstileToken = null;
        setTurnstileMessage(
          "A verificação expirou. Tente novamente.",
          "error"
        );
        refreshWhatsappButton();
      },
      "timeout-callback": () => {
        turnstileToken = null;
        setTurnstileMessage(
          "A verificação expirou. Tente novamente.",
          "error"
        );
        refreshWhatsappButton();
      },
      "error-callback": () => {
        handleTurnstileUnavailable();
      }
    }
  );
}

function resetTurnstile() {
  turnstileToken = null;

  if (
    window.turnstile &&
    turnstileWidgetId !== null
  ) {
    window.turnstile.reset(turnstileWidgetId);
    setTurnstileMessage("Faça uma nova verificação.");
  }
}

async function getEdgeFunctionErrorMessage(error) {
  try {
    if (error?.context instanceof Response) {
      const payload = await error.context.clone().json();

      if (payload?.error) {
        return payload.error;
      }
    }
  } catch {
    // Usa a mensagem genérica abaixo.
  }

  return error?.message ||
    "Não foi possível registrar o pedido. Tente novamente.";
}

function loadTurnstileApi() {
  if (turnstileApiRequested) return;

  if (!String(STORE_CONFIG.turnstileSiteKey || "").trim()) {
    setTurnstileMessage(
      "A verificação de segurança ainda não foi configurada.",
      "error"
    );
    refreshWhatsappButton();
    return;
  }

  turnstileApiRequested = true;

  const script = document.createElement("script");

  script.src =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  script.addEventListener("load", initializeTurnstile);
  script.addEventListener("error", handleTurnstileUnavailable);

  document.head.append(script);
}

function getCurrentOrderSignature() {
  const cartItemsSignature = [...cart.entries()]
    .sort(([idA], [idB]) => idA.localeCompare(idB))
    .map(([id, quantity]) => ({
      id,
      quantity
    }));

  const delivery =
    document.querySelector('input[name="delivery"]:checked')
      ?.value || "";

  const payment =
    document.querySelector('input[name="payment"]:checked')
      ?.value || "";

  const name =
    document.querySelector("#customer-name")
      ?.value.trim() || "";

  const address =
    addressInput?.value.trim() || "";

  const notes =
    document.querySelector("#customer-notes")
      ?.value.trim() || "";

  const deliveryNeighborhoodSlug = delivery === "Entrega"
    ? selectedDeliveryZone?.slug || ""
    : "";

  return JSON.stringify({
    cart: cartItemsSignature,
    delivery,
    payment,
    name,
    address,
    deliveryNeighborhoodSlug,
    notes
  });
}

function createCheckoutAttemptId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hexadecimal = [...bytes]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    hexadecimal.slice(12, 16),
    hexadecimal.slice(16, 20),
    hexadecimal.slice(20)
  ].join("-");
}

function getCheckoutAttemptId(orderSignature) {
  if (checkoutAttempt?.signature === orderSignature) {
    return checkoutAttempt.id;
  }

  checkoutAttempt = {
    id: createCheckoutAttemptId(),
    signature: orderSignature
  };

  return checkoutAttempt.id;
}

function refreshWhatsappButton() {
  const quantity = [...cart.values()]
    .reduce((sum, value) => sum + value, 0);

  const sameRegisteredOrder =
    quantity > 0 &&
    lastRegisteredSignature === getCurrentOrderSignature();

  if (isSubmitting) {
    whatsappButton.disabled = true;
    whatsappButton.textContent = "Registrando pedido...";
    return;
  }

  if (getStoreState() === STORE_MODES.CLOSED_TODAY) {
    const { buttonText } = getClosedDetails();

    whatsappButton.disabled = true;
    whatsappButton.textContent = buttonText;
    return;
  }

  if (quantity === 0) {
    whatsappButton.disabled = true;
    whatsappButton.textContent = "Pedir pelo WhatsApp";
    return;
  }

  const delivery = document.querySelector(
    'input[name="delivery"]:checked'
  )?.value;
  const customerName = document.querySelector("#customer-name")
    ?.value.trim() || "";
  const deliveryFieldsValid = delivery !== "Entrega" || (
    Boolean(selectedDeliveryZone) &&
    addressInput.value.trim().length > 0
  );

  if (customerName.length < 2 || !deliveryFieldsValid) {
    whatsappButton.disabled = true;
    whatsappButton.textContent = delivery === "Entrega" &&
      !selectedDeliveryZone
      ? "Selecione um bairro"
      : "Preencha os dados obrigatórios";
    return;
  }

  if (sameRegisteredOrder) {
    whatsappButton.disabled = false;
    whatsappButton.textContent = "Abrir WhatsApp novamente";
    return;
  }

  if (!turnstileToken) {
    whatsappButton.disabled = true;
    whatsappButton.textContent = "Conclua a verificação";
    return;
  }

  whatsappButton.disabled = false;
  whatsappButton.textContent = "Pedir pelo WhatsApp";
}

async function loadProducts() {
  try {
    const { data, error } = await supabaseClient
      .from("products")
      .select(`
        id,
        slug,
        name,
        price,
        description,
        image_url,
        available,
        stock,
        display_order
      `)
      .order("display_order", { ascending: true });

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      console.warn(
        "Nenhum produto encontrado no Supabase. Usando produtos locais."
      );

      return FALLBACK_PRODUCTS;
    }

    productsLoadedFromSupabase = true;

    return data.map(product => ({
      id: product.slug,
      databaseId: product.id,
      name: product.name,
      price: Number(product.price),
      image: product.image_url,
      description: product.description,
      available:
        product.available &&
        (product.stock === null || product.stock > 0),
      stock: product.stock,
      displayOrder: product.display_order
    }));
  } catch (error) {
    console.error(
      "Erro ao carregar produtos do Supabase:",
      error
    );

    return FALLBACK_PRODUCTS;
  }
}

function isProductSoldOut(product) {
  return !product.available || product.stock === 0;
}

async function loadDeliveryZones() {
  deliveryNeighborhoodInput.disabled = true;
  setDeliveryNeighborhoodMessage("Carregando bairros de entrega...");

  try {
    const { data, error } = await supabaseClient.rpc("list_delivery_zones");

    if (error) throw error;

    deliveryZones = (Array.isArray(data) ? data : [])
      .map(zone => ({
        slug: String(zone.slug || ""),
        name: String(zone.name || ""),
        fee: Number(zone.fee)
      }))
      .filter(zone =>
        zone.slug && zone.name && Number.isFinite(zone.fee) && zone.fee >= 0
      );

    if (!deliveryZones.length) {
      throw new Error("Nenhum bairro de entrega está disponível.");
    }

    deliveryNeighborhoodInput.disabled = false;
    setDeliveryNeighborhoodMessage("");
  } catch (error) {
    console.error("Erro ao carregar bairros de entrega:", error);
    deliveryZones = [];
    deliveryNeighborhoodInput.disabled = true;
    setDeliveryNeighborhoodMessage(
      "Não foi possível carregar os bairros. Tente novamente mais tarde.",
      "error"
    );
  }

  refreshWhatsappButton();
}

function getProductStatus(product) {
  if (isProductSoldOut(product)) {
    return {
      text: "ESGOTADO :(",
      className: "status-sold-out"
    };
  }

  if (
    product.stock !== null &&
    product.stock !== undefined &&
    product.stock >= 1 &&
    product.stock <= 3
  ) {
    return {
      text: "ACABANDO :O",
      className: "status-low-stock"
    };
  }

  return {
    text: "DISPONÍVEL :D",
    className: "status-available"
  };
}

function sortProductsForDisplay(products) {
  return [...products].sort((firstProduct, secondProduct) => {
    const soldOutComparison =
      Number(isProductSoldOut(firstProduct)) -
      Number(isProductSoldOut(secondProduct));

    if (soldOutComparison !== 0) {
      return soldOutComparison;
    }

    const displayOrderComparison =
      Number(firstProduct.displayOrder ?? Number.MAX_SAFE_INTEGER) -
      Number(secondProduct.displayOrder ?? Number.MAX_SAFE_INTEGER);

    if (displayOrderComparison !== 0) {
      return displayOrderComparison;
    }

    return String(firstProduct.id).localeCompare(String(secondProduct.id));
  });
}

function renderProducts() {
  const productsForDisplay = sortProductsForDisplay(PRODUCTS);

  grid.innerHTML = productsForDisplay.map(product => {
    const status = getProductStatus(product);
    const productId = escapeHtml(product.id);
    const productName = escapeHtml(product.name);

    return `
      <article class="product-card">
        <div class="product-image-wrap">
          <img
            class="product-image"
            src="${getSafeImageSource(product.image)}"
            alt="Cookie ${productName} da Mimo Cookies"
            width="800"
            height="820"
            loading="lazy"
            decoding="async"
          >

          <span class="status-pill ${status.className}">
            ${status.text}
          </span>
        </div>

        <div class="product-body">
          <div class="product-title-row">
            <h3>${productName}</h3>
            <span class="price">${BRL.format(product.price)}</span>
          </div>

          <p>${escapeHtml(product.description)}</p>

          <button
            class="add-button"
            type="button"
            data-add="${productId}"
            ${product.available ? "" : "disabled"}
          >
            ${product.available
              ? "Adicionar ao pedido"
              : "Indisponível"}
          </button>
        </div>
      </article>
    `;
  }).join("");
  grid.setAttribute("aria-busy", "false");
}

grid.addEventListener("click", event => {
  const button = event.target.closest("[data-add]");

  if (!button) return;

  addItem(button.dataset.add);
});

function addItem(id) {
  const product = getProduct(id);

  if (!product || !product.available) return;

  const currentQuantity = cart.get(id) || 0;

  if (
    product.stock !== null &&
    product.stock !== undefined &&
    currentQuantity >= product.stock
  ) {
    alert(`Há apenas ${product.stock} unidade(s) de ${product.name} disponível(is).`);
    return;
  }

  cart.set(id, currentQuantity + 1);

  window.MimoAnalytics?.trackAddToCart(product, 1);

  updateCart();
  showCartConfirmation(product.name);
}

function changeQuantity(id, delta) {
  const product = getProduct(id);

  if (!product) return;

  const current = cart.get(id) || 0;
  const next = current + delta;

  if (next <= 0) {
    cart.delete(id);
    window.MimoAnalytics?.trackRemoveFromCart(product, current);
    updateCart();
    return;
  }

  if (
    delta > 0 &&
    product.stock !== null &&
    product.stock !== undefined &&
    next > product.stock
  ) {
    alert(`Há apenas ${product.stock} unidade(s) de ${product.name} disponível(is).`);
    return;
  }

  cart.set(id, next);

  if (next > current) {
    window.MimoAnalytics?.trackAddToCart(product, next - current);
  } else if (next < current) {
    window.MimoAnalytics?.trackRemoveFromCart(product, current - next);
  }

  updateCart();
}

function getProduct(id) {
  return PRODUCTS.find(product => product.id === id);
}

function calculateSubtotal() {
  return [...cart.entries()].reduce((sum, [id, qty]) => {
    const product = getProduct(id);

    if (!product) return sum;

    return sum + product.price * qty;
  }, 0);
}

function getDisplayedDeliveryFee() {
  const delivery = document.querySelector(
    'input[name="delivery"]:checked'
  )?.value;

  if (delivery === "Retirada") return 0;
  if (delivery === "Entrega" && selectedDeliveryZone) {
    return selectedDeliveryZone.fee;
  }

  return null;
}

function updateOrderTotals() {
  const subtotal = calculateSubtotal();
  const deliveryFee = getDisplayedDeliveryFee();

  subtotalEl.textContent = BRL.format(subtotal);
  shippingEl.textContent = deliveryFee === null
    ? "A calcular"
    : deliveryFee === 0
      ? "Grátis"
      : BRL.format(deliveryFee);
  totalEl.textContent = BRL.format(subtotal + (deliveryFee || 0));

  if (deliveryChoiceFee) {
    deliveryChoiceFee.textContent = deliveryFee === null
      ? "A calcular"
      : deliveryFee === 0
        ? "Grátis"
        : BRL.format(deliveryFee);
  }
}

function getCartAnalyticsLines() {
  return [...cart.entries()]
    .map(([id, quantity]) => ({
      product: getProduct(id),
      quantity
    }))
    .filter(line => line.product);
}

function updateCart() {
  const quantity = [...cart.values()]
    .reduce((sum, value) => sum + value, 0);

  const subtotal = calculateSubtotal();

  cartFabSummary.textContent =
    `${quantity} ${quantity === 1 ? "item" : "itens"} · ${BRL.format(subtotal)}`;

  updateOrderTotals();
  
  refreshWhatsappButton();

  if (!quantity) {
    checkoutStarted = false;
    cartItems.innerHTML = `
      <div class="empty-cart">
        Seu carrinho ainda está vazio.
      </div>
    `;

    return;
  }

  cartItems.innerHTML = [...cart.entries()]
    .map(([id, qty]) => {
      const product = getProduct(id);

      if (!product) return "";

      const productId = escapeHtml(id);

      return `
        <div class="cart-item">
          <img
            src="${getSafeImageSource(product.image)}"
            alt=""
            width="62"
            height="62"
            loading="lazy"
            decoding="async"
          >

          <div>
            <h4>${escapeHtml(product.name)}</h4>
            <small>
              ${BRL.format(product.price * qty)}
            </small>
          </div>

          <div class="quantity">
            <button
              type="button"
              data-change="${productId}"
              data-delta="-1"
              aria-label="Remover uma unidade"
            >
              −
            </button>

            <strong>${qty}</strong>

            <button
  type="button"
              data-change="${productId}"
  data-delta="1"
  aria-label="Adicionar uma unidade"
  ${
    product.stock !== null &&
    product.stock !== undefined &&
    qty >= product.stock
      ? "disabled"
      : ""
  }
>
  +
</button>
          </div>
        </div>
      `;
    })
    .join("");
}

cartItems.addEventListener("click", event => {
  const button = event.target.closest("[data-change]");

  if (!button) return;

  changeQuantity(
    button.dataset.change,
    Number(button.dataset.delta)
  );
});

function openCart() {
  if (panel.classList.contains("open")) return;

  loadTurnstileApi();
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  cartFab.setAttribute("aria-expanded", "true");
  overlay.hidden = false;
  document.body.classList.add("cart-open");
  window.MimoAnalytics?.trackViewCart(getCartAnalyticsLines());
}

let cartSwipe = null;

function resetCartSwipe() {
  cartSwipe = null;
  panel.classList.remove("swiping");
  panel.style.removeProperty("--cart-swipe-x");
}

function closeCart() {
  resetCartSwipe();
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  cartFab.setAttribute("aria-expanded", "false");
  overlay.hidden = true;
  document.body.classList.remove("cart-open");
}

function handleCartPointerDown(event) {
  if (
    event.pointerType !== "touch" ||
    !event.isPrimary ||
    !panel.classList.contains("open") ||
    cartSwipe
  ) {
    return;
  }

  cartSwipe = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    direction: null,
    distance: 0
  };
}

function handleCartPointerMove(event) {
  if (!cartSwipe || event.pointerId !== cartSwipe.pointerId) return;

  const deltaX = event.clientX - cartSwipe.startX;
  const deltaY = event.clientY - cartSwipe.startY;
  const absoluteX = Math.abs(deltaX);
  const absoluteY = Math.abs(deltaY);

  if (!cartSwipe.direction) {
    if (
      absoluteX < CART_SWIPE_DIRECTION_THRESHOLD &&
      absoluteY < CART_SWIPE_DIRECTION_THRESHOLD
    ) {
      return;
    }

    if (
      deltaX > 0 &&
      absoluteX > absoluteY * CART_SWIPE_HORIZONTAL_RATIO
    ) {
      cartSwipe.direction = "horizontal";
      panel.classList.add("swiping");
      panel.setPointerCapture(event.pointerId);
    } else if (absoluteY >= absoluteX || deltaX <= 0) {
      cartSwipe.direction = "ignored";
    } else {
      return;
    }
  }

  if (cartSwipe.direction !== "horizontal") return;

  event.preventDefault();
  cartSwipe.distance = Math.max(0, deltaX);
  panel.style.setProperty("--cart-swipe-x", `${cartSwipe.distance}px`);
}

function handleCartPointerEnd(event) {
  if (!cartSwipe || event.pointerId !== cartSwipe.pointerId) return;

  const shouldClose =
    event.type === "pointerup" &&
    cartSwipe.direction === "horizontal" &&
    cartSwipe.distance >= CART_SWIPE_CLOSE_THRESHOLD;

  if (cartSwipe.direction === "horizontal") {
    event.preventDefault();
  }

  if (shouldClose) {
    closeCart();
  } else {
    resetCartSwipe();
  }
}

if ("PointerEvent" in window) {
  panel.addEventListener("pointerdown", handleCartPointerDown);
  panel.addEventListener("pointermove", handleCartPointerMove);
  panel.addEventListener("pointerup", handleCartPointerEnd);
  panel.addEventListener("pointercancel", handleCartPointerEnd);
}

cartFab.addEventListener("click", openCart);
closeCartButton.addEventListener("click", closeCart);
overlay.addEventListener("click", closeCart);

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeCart();
  }
});

function setDeliveryNeighborhoodMessage(message, type = "") {
  deliveryNeighborhoodMessage.textContent = message;
  deliveryNeighborhoodMessage.className = "delivery-neighborhood-message";

  if (type) deliveryNeighborhoodMessage.classList.add(type);
}

function setDeliveryNeighborhoodValidity(isValid) {
  const delivery = document.querySelector(
    'input[name="delivery"]:checked'
  )?.value;
  const requiresNeighborhood = delivery === "Entrega";

  deliveryNeighborhoodInput.setAttribute(
    "aria-invalid",
    String(requiresNeighborhood && !isValid)
  );
  deliveryNeighborhoodInput.setCustomValidity?.(
    requiresNeighborhood && !isValid
      ? "Selecione um bairro nas sugestões."
      : ""
  );

  const hasSelectedNeighborhood = requiresNeighborhood &&
    isValid &&
    Boolean(selectedDeliveryZone) &&
    deliveryNeighborhoodInput.value === selectedDeliveryZone.name;

  deliveryNeighborhoodInput.classList.toggle(
    "is-selected",
    hasSelectedNeighborhood
  );
  deliveryNeighborhoodSelectedIndicator.hidden = !hasSelectedNeighborhood;
}

function closeDeliveryNeighborhoodOptions() {
  visibleDeliveryZones = [];
  activeDeliveryZoneIndex = -1;
  deliveryNeighborhoodOptions.hidden = true;
  deliveryNeighborhoodInput.setAttribute("aria-expanded", "false");
  deliveryNeighborhoodInput.removeAttribute("aria-activedescendant");

  if (deliveryNeighborhoodMessage.classList.contains("instruction")) {
    setDeliveryNeighborhoodMessage("");
  }
}

function updateActiveDeliveryZoneOption() {
  const options = Array.from(
    deliveryNeighborhoodOptions.querySelectorAll("[role=option]")
  );

  options.forEach((option, index) => {
    option.setAttribute(
      "aria-selected",
      String(index === activeDeliveryZoneIndex)
    );
  });

  const activeOption = options[activeDeliveryZoneIndex];

  if (activeOption) {
    deliveryNeighborhoodInput.setAttribute(
      "aria-activedescendant",
      activeOption.id
    );
    activeOption.scrollIntoView?.({ block: "nearest" });
  } else {
    deliveryNeighborhoodInput.removeAttribute("aria-activedescendant");
  }
}

function positionDeliveryNeighborhoodOptions() {
  if (deliveryNeighborhoodOptions.hidden) return;

  const inputRect = deliveryNeighborhoodInput.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportTop = Number(viewport?.offsetTop) || 0;
  const viewportHeight = Number(viewport?.height) ||
    Number(window.innerHeight) || 844;
  const viewportBottom = viewportTop + viewportHeight;
  const availableBelow = Math.max(0, viewportBottom - inputRect.bottom - 12);
  const availableAbove = Math.max(0, inputRect.top - viewportTop - 12);
  const opensUp = availableBelow < 180 && availableAbove > availableBelow;
  const availableSpace = opensUp ? availableAbove : availableBelow;

  deliveryNeighborhoodOptions.classList.toggle("opens-up", opensUp);
  deliveryNeighborhoodOptions.style.maxHeight =
    `${Math.max(96, Math.min(320, availableSpace))}px`;
}

function renderDeliveryNeighborhoodOptions() {
  const query = deliveryNeighborhoodInput.value;

  if (!query.trim()) {
    closeDeliveryNeighborhoodOptions();
    setDeliveryNeighborhoodMessage("");
    return;
  }

  visibleDeliveryZones = MimoDeliveryZones.filterDeliveryZones(
    deliveryZones,
    query,
    7
  );
  activeDeliveryZoneIndex = -1;

  if (!visibleDeliveryZones.length) {
    closeDeliveryNeighborhoodOptions();
    setDeliveryNeighborhoodMessage(
      "Nenhum bairro de entrega encontrado.",
      "error"
    );
    return;
  }

  deliveryNeighborhoodOptions.innerHTML = `
    <li
      class="delivery-neighborhood-options-heading"
      role="presentation"
      aria-hidden="true"
    >
      Selecione seu bairro abaixo
    </li>
  ` + visibleDeliveryZones.map((zone, index) => `
      <li
        id="delivery-neighborhood-option-${index}"
        class="delivery-neighborhood-option"
        role="option"
        aria-selected="false"
        data-delivery-zone-index="${index}"
      >
        <span>${escapeHtml(zone.name)}</span>
      </li>
    `).join("");
  deliveryNeighborhoodOptions.hidden = false;
  deliveryNeighborhoodInput.setAttribute("aria-expanded", "true");
  setDeliveryNeighborhoodMessage(
    "Selecione seu bairro abaixo",
    "instruction"
  );
  window.requestAnimationFrame(positionDeliveryNeighborhoodOptions);
}

function selectDeliveryZone(zone) {
  if (!zone) return;

  selectedDeliveryZone = { ...zone };
  deliveryNeighborhoodInput.value = zone.name;
  setDeliveryNeighborhoodValidity(true);
  setDeliveryNeighborhoodMessage("Bairro selecionado.", "success");
  closeDeliveryNeighborhoodOptions();
  updateOrderTotals();
  refreshWhatsappButton();
}

deliveryNeighborhoodInput.addEventListener("input", () => {
  if (
    selectedDeliveryZone &&
    deliveryNeighborhoodInput.value !== selectedDeliveryZone.name
  ) {
    selectedDeliveryZone = null;
  }

  setDeliveryNeighborhoodValidity(Boolean(selectedDeliveryZone));
  renderDeliveryNeighborhoodOptions();
  updateOrderTotals();
  refreshWhatsappButton();
});

deliveryNeighborhoodInput.addEventListener("focus", () => {
  if (deliveryNeighborhoodInput.value.trim() && !selectedDeliveryZone) {
    renderDeliveryNeighborhoodOptions();
  }
});

deliveryNeighborhoodInput.addEventListener("blur", () => {
  window.setTimeout(closeDeliveryNeighborhoodOptions, 100);
});

deliveryNeighborhoodInput.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (!deliveryNeighborhoodOptions.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeDeliveryNeighborhoodOptions();
    }
    return;
  }

  if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;

  if (deliveryNeighborhoodOptions.hidden && event.key !== "Enter") {
    renderDeliveryNeighborhoodOptions();
  }

  if (!visibleDeliveryZones.length) return;

  if (event.key === "Enter") {
    if (activeDeliveryZoneIndex < 0) return;
    event.preventDefault();
    selectDeliveryZone(visibleDeliveryZones[activeDeliveryZoneIndex]);
    return;
  }

  event.preventDefault();
  activeDeliveryZoneIndex = event.key === "ArrowDown"
    ? (activeDeliveryZoneIndex + 1) % visibleDeliveryZones.length
    : (activeDeliveryZoneIndex - 1 + visibleDeliveryZones.length) %
      visibleDeliveryZones.length;
  updateActiveDeliveryZoneOption();
});

deliveryNeighborhoodOptions.addEventListener("pointerdown", event => {
  const option = event.target.closest("[data-delivery-zone-index]");

  if (!option) return;

  event.preventDefault();
});

deliveryNeighborhoodOptions.addEventListener("click", event => {
  const option = event.target.closest("[data-delivery-zone-index]");

  if (!option) return;

  selectDeliveryZone(
    visibleDeliveryZones[Number(option.dataset.deliveryZoneIndex)]
  );
  deliveryNeighborhoodInput.focus();
});

window.addEventListener?.("resize", positionDeliveryNeighborhoodOptions);
window.visualViewport?.addEventListener(
  "resize",
  positionDeliveryNeighborhoodOptions
);
window.visualViewport?.addEventListener(
  "scroll",
  positionDeliveryNeighborhoodOptions
);

function updateDeliveryFields() {
  const selectedDelivery = document.querySelector(
    'input[name="delivery"]:checked'
  )?.value;
  const isDelivery = selectedDelivery === "Entrega";

  addressFields.hidden = !isDelivery;
  addressInput.required = isDelivery;
  deliveryNeighborhoodInput.required = isDelivery;
  setDeliveryNeighborhoodValidity(!isDelivery || Boolean(selectedDeliveryZone));

  if (!isDelivery) closeDeliveryNeighborhoodOptions();

  updateOrderTotals();
  refreshWhatsappButton();
}

document
  .querySelectorAll('input[name="delivery"]')
  .forEach(input => {
    input.addEventListener("change", updateDeliveryFields);
  });

updateDeliveryFields();

function handleCheckoutInteraction(event) {
  if (
    checkoutStarted ||
    !cart.size ||
    !event.target.matches(`
      #customer-name,
      #customer-address,
      #delivery-neighborhood,
      #customer-notes,
      input[name="delivery"],
      input[name="payment"]
    `)
  ) {
    return;
  }

  checkoutStarted = true;
  window.MimoAnalytics?.trackBeginCheckout(getCartAnalyticsLines());
}

form.addEventListener("focusin", handleCheckoutInteraction);
form.addEventListener("input", event => {
  handleCheckoutInteraction(event);
  refreshWhatsappButton();
});
form.addEventListener("change", event => {
  handleCheckoutInteraction(event);
  refreshWhatsappButton();
});

form.addEventListener("submit", async event => {
  event.preventDefault();

  if (!cart.size || isSubmitting) return;

  const storeState = getStoreState();

  if (storeState === STORE_MODES.CLOSED_TODAY) {
    const { title, returnText } = getClosedDetails();

    alert(`${title}\n\n${returnText}\n\n${CLOSED_STORE_MESSAGE}`);
    return;
  }

  if (storeState === STORE_MODES.PAUSED) {
    const { message, returnText } = getPauseDetails();
    const confirmed = window.confirm([
      "🍪 Nosso atendimento está em pausa neste momento.",
      returnText,
      message,
      "",
      "Deseja continuar, registrar o pedido e abrir o WhatsApp?"
    ].filter(Boolean).join("\n"));

    if (!confirmed) return;
  }

  const delivery = document
    .querySelector('input[name="delivery"]:checked')
    .value;

  if (delivery === "Entrega" && !selectedDeliveryZone) {
    setDeliveryNeighborhoodValidity(false);
    setDeliveryNeighborhoodMessage(
      "Selecione um bairro oficial nas sugestões.",
      "error"
    );
    deliveryNeighborhoodInput.focus();
    return;
  }

  if (delivery === "Entrega" && !addressInput.value.trim()) {
    addressInput.focus();
    return;
  }

  const currentSignature = getCurrentOrderSignature();

  /*
   * O pedido já foi registrado e nada foi alterado.
   * Apenas reabre a mesma mensagem no WhatsApp.
   */
  if (
    currentSignature === lastRegisteredSignature &&
    lastWhatsAppUrl
  ) {
    window.open(lastWhatsAppUrl, "_blank", "noopener");
    return;
  }

  if (!turnstileToken) {
    alert("Conclua a verificação de segurança para continuar.");
    return;
  }

  const whatsapp =
    STORE_CONFIG.whatsappNumber.replace(/\D/g, "");

  if (!whatsapp) {
    alert(
      "Falta configurar o número do WhatsApp no arquivo config.js."
    );
    return;
  }

  const name = document
    .querySelector("#customer-name")
    .value
    .trim();

  const payment = document
    .querySelector('input[name="payment"]:checked')
    .value;

  const address = addressInput.value.trim();

  const notes = document
    .querySelector("#customer-notes")
    .value
    .trim();

  const items = [...cart.entries()].map(([id, qty]) => ({
    slug: id,
    quantity: qty
  }));

  const submissionTurnstileToken = turnstileToken;
  turnstileToken = null;

  isSubmitting = true;
  refreshWhatsappButton();

  try {
    const analyticsIdentifiers = await (
      window.MimoAnalytics?.getIdentifiers({ timeoutMs: 250 }) ||
      Promise.resolve({ client_id: null, session_id: null })
    ).catch(() => ({ client_id: null, session_id: null }));
    const checkoutAttemptId = getCheckoutAttemptId(currentSignature);
    const functionName =
      STORE_CONFIG.orderFunctionName || "create-order";

    const { data, error } =
      await supabaseClient.functions.invoke(
        functionName,
        {
          body: {
            turnstileToken: submissionTurnstileToken,
            checkout_attempt_id: checkoutAttemptId,
            analytics: {
              client_id: analyticsIdentifiers.client_id,
              session_id: analyticsIdentifiers.session_id
            },
            order: {
              p_customer_name: name,
              p_delivery_method: delivery,
              p_payment_method: payment,
              p_customer_address:
                delivery === "Entrega" ? address : "",
              p_delivery_neighborhood_slug:
                delivery === "Entrega" ? selectedDeliveryZone.slug : null,
              p_notes: notes,
              p_items: items
            }
          }
        }
      );

    if (error) {
      throw new Error(
        await getEdgeFunctionErrorMessage(error)
      );
    }

    if (!data || data.error) {
      throw new Error(
        data?.error ||
        "A resposta do servidor foi inválida."
      );
    }

    const orderNumber = data.order_number;
    const subtotal = Number(data.subtotal);
    const deliveryFee = Number(data.delivery_fee);
    const total = Number(data.total);
    const deliveryNeighborhood = data.delivery_neighborhood;

    if (
      !Number.isFinite(subtotal) ||
      !Number.isFinite(deliveryFee) ||
      !Number.isFinite(total) ||
      (delivery === "Entrega" && !deliveryNeighborhood)
    ) {
      throw new Error("A resposta do servidor foi inválida.");
    }

    if (delivery === "Entrega") {
      selectedDeliveryZone = {
        ...selectedDeliveryZone,
        name: deliveryNeighborhood,
        fee: deliveryFee
      };
      deliveryNeighborhoodInput.value = deliveryNeighborhood;
      setDeliveryNeighborhoodMessage(`Frete: ${BRL.format(deliveryFee)}`);
    }

    updateOrderTotals();
    const analyticsOrderId = `MIMO-${orderNumber}`;

    if (!trackedOrderCreatedIds.has(analyticsOrderId)) {
      window.MimoAnalytics?.trackOrderCreated({
        orderNumber,
        subtotal,
        lines: getCartAnalyticsLines()
      });
      trackedOrderCreatedIds.add(analyticsOrderId);
    }

    checkoutStarted = false;

    const messageItems = [...cart.entries()].map(([id, qty]) => {
      const product = getProduct(id);

      return `${qty}x ${product.name} — ${BRL.format(
        product.price * qty
      )}`;
    });

    const whatsappMessage = buildWhatsAppMessage({
      orderNumber,
      customerName: name,
      items: messageItems,
      payment,
      delivery,
      address,
      neighborhood: deliveryNeighborhood,
      notes,
      subtotal,
      deliveryFee,
      total,
      includeEmojis: shouldIncludeWhatsAppEmojis()
    });

    lastWhatsAppUrl =
      `https://wa.me/${whatsapp}?text=${encodeURIComponent(whatsappMessage)}`;

    lastRegisteredSignature = currentSignature;

    window.open(lastWhatsAppUrl, "_blank", "noopener");

  } catch (error) {
    console.error("Erro ao registrar pedido:", error);

    alert(
      error.message ||
      "Não foi possível registrar o pedido. Tente novamente."
    );
  } finally {
    resetTurnstile();
    isSubmitting = false;
    refreshWhatsappButton();
  }
});

async function initializeStore() {
  if (!grid.querySelector(".product-card-skeleton")) {
    window.MimoCatalogLoading?.renderSkeletons();
  }

  const [loadedProducts] = await Promise.all([
    loadProducts(),
    loadDeliveryZones()
  ]);

  PRODUCTS = loadedProducts;

  renderProducts();

  if (productsLoadedFromSupabase) {
    window.MimoCatalogLoading?.saveProductCount(PRODUCTS.length);
  }

  updateCart();
}

initializeStore();
loadStoreSettings();
