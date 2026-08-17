const ADMIN_USER_ID = "dcf88d88-cb5e-4378-89e1-ba1020cb20e8";
const PRODUCT_IMAGES_BUCKET = "product-images";
const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;
const ORDER_STATUS_FILTER_STORAGE_KEY =
  "mimo-admin-order-status-filters-v1";
const ORDER_ALERTS_STORAGE_KEY = "mimo-admin-order-alerts-v1";
const ADMIN_PAGE_TITLE = "Painel administrativo - Mimo Cookies";
const ORDERS_POLL_INTERVAL_MS = 2 * 60 * 1000;
const ORDERS_RETURN_REFRESH_THROTTLE_MS = 3 * 1000;
const ORDERS_REALTIME_REFRESH_DELAY_MS = 250;
const ORDER_STATUS_FILTER_VALUES = Object.freeze([
  "new",
  "confirmed",
  "completed",
  "cancelled"
]);
const ACTIVE_ORDER_STATUS_VALUES = Object.freeze([
  "new",
  "confirmed"
]);
const CANCELLATION_REASON_LABELS = Object.freeze({
  test_order: "Pedido de teste",
  duplicate_order: "Pedido duplicado",
  whatsapp_not_confirmed: "Cliente não confirmou no WhatsApp",
  other: "Outro"
});
const PRODUCT_IMAGE_EXTENSIONS = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
});
const {
  DEFAULT_MAX_DIMENSION: MAX_PRODUCT_IMAGE_DIMENSION,
  DEFAULT_WEBP_QUALITY: PRODUCT_IMAGE_WEBP_QUALITY,
  optimizeProductImage
} = MimoProductImageOptimizer;

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});
const {
  STORE_MODES,
  buildStoreSettingsUpdate,
  getStoreState: resolveStoreState,
  getTomorrowAtTen,
  normalizeStoreMode,
  storeLocalDateTimeToDate,
  toValidDate,
  toStoreLocalDateTimeInput
} = MimoStoreStatus;

const loginSection = document.querySelector("#login-section");
const dashboard = document.querySelector("#dashboard");

const loginForm = document.querySelector("#login-form");
const loginEmail = document.querySelector("#login-email");
const loginPassword = document.querySelector("#login-password");
const loginMessage = document.querySelector("#login-message");

const logoutButton = document.querySelector("#logout-button");
const adminEmail = document.querySelector("#admin-email");

const productForm = document.querySelector("#product-form");
const productId = document.querySelector("#product-id");
const productName = document.querySelector("#product-name");
const productSlug = document.querySelector("#product-slug");
const productPrice = document.querySelector("#product-price");
const productDescription = document.querySelector("#product-description");
const productImage = document.querySelector("#product-image");
const productImageFile = document.querySelector("#product-image-file");
const productImagePreview = document.querySelector("#product-image-preview");
const productImagePreviewWrap = document.querySelector(
  "#product-image-preview-wrap"
);
const productStock = document.querySelector("#product-stock");
const productOrder = document.querySelector("#product-order");
const productAvailable = document.querySelector("#product-available");

const formTitle = document.querySelector("#form-title");
const formEyebrow = document.querySelector("#form-eyebrow");
const productMessage = document.querySelector("#product-message");
const saveProductButton = document.querySelector("#save-product-button");
const cancelEditButton = document.querySelector("#cancel-edit-button");

const productsList = document.querySelector("#products-list");
const refreshButton = document.querySelector("#refresh-button");

const ordersList = document.querySelector("#orders-list");
const ordersMessage = document.querySelector("#orders-message");
const refreshOrdersButton =
  document.querySelector("#refresh-orders-button");
const orderAlertsButton =
  document.querySelector("#order-alerts-button");
const ordersAlertsStatus =
  document.querySelector("#orders-alerts-status");
const orderStatusFilters =
  document.querySelector("#order-status-filters");
const orderStatusFilterInputs = Array.from(
  orderStatusFilters.querySelectorAll('input[type="checkbox"]')
);
const orderStatusCountElements = Array.from(
  orderStatusFilters.querySelectorAll("[data-order-status-count]")
);

const settingsForm = document.querySelector("#settings-form");
const storeIsPaused = document.querySelector("#store-is-paused");
const storeReturnTime = document.querySelector("#store-return-time");
const storePauseMessage = document.querySelector("#store-pause-message");
const storeClosedToday = document.querySelector("#store-closed-today");
const clearReturnTimeButton = document.querySelector(
  "#clear-return-time-button"
);
const saveSettingsButton = document.querySelector("#save-settings-button");
const settingsMessage = document.querySelector("#settings-message");
const settingsStatus = document.querySelector("#settings-status");

const tabButtons =
  document.querySelectorAll("[data-tab]");

const tabPanels =
  document.querySelectorAll("[data-panel]");

let products = [];
let orders = [];
let selectedOrderStatuses = loadOrderStatusFilters();
let productImagePreviewUrl = "";
let isSavingProduct = false;
let isSavingSettings = false;
let settingsExpirationTimer = null;
let isAdminAuthenticated = false;
let ordersLoadPromise = null;
let fullOrdersRefreshQueued = false;
let ordersRealtimeChannel = null;
let isOrdersRealtimeSubscribed = false;
let ordersRealtimeRefreshTimer = null;
let ordersPollingTimer = null;
let lastOrdersReturnRefreshAt = 0;
let orderAlertAudioContext = null;
let orderAlertsEnabled = loadOrderAlertsPreference();
const alertedOrderIds = new Set();
const updatingOrderIds = new Set();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function getSafeImageSource(value, escapeForHtml = true) {
  const source = String(value ?? "").trim();

  if (!source) return "";

  const absoluteHttpUrl = /^https?:\/\//i;
  const explicitProtocol = /^[a-z][a-z\d+.-]*:/i;

  if (absoluteHttpUrl.test(source)) {
    try {
      const url = new URL(source);

      if (!["http:", "https:"].includes(url.protocol)) return "";

      return escapeForHtml ? escapeHtml(source) : source;
    } catch {
      return "";
    }
  }

  if (
    explicitProtocol.test(source) ||
    source.startsWith("/")
  ) {
    return "";
  }

  try {
    new URL(source, "https://local.invalid/");

    const relativeSource = source.startsWith("../")
      ? source
      : `../${source.replace(/^\.\/+/, "")}`;

    return escapeForHtml
      ? escapeHtml(relativeSource)
      : relativeSource;
  } catch {
    return "";
  }
}

function clearLocalImagePreview() {
  if (productImagePreviewUrl) {
    URL.revokeObjectURL(productImagePreviewUrl);
    productImagePreviewUrl = "";
  }
}

function showProductImagePreview(source = "", isLocal = false) {
  clearLocalImagePreview();

  const safeSource = isLocal
    ? source
    : getSafeImageSource(source, false);

  if (!safeSource) {
    productImagePreview.removeAttribute("src");
    productImagePreviewWrap.hidden = true;
    return;
  }

  if (isLocal) {
    productImagePreviewUrl = source;
  }

  productImagePreview.src = safeSource;
  productImagePreviewWrap.hidden = false;
}

function validateProductImage(file) {
  if (!file) return "";

  if (!Object.hasOwn(PRODUCT_IMAGE_EXTENSIONS, file.type)) {
    return "Escolha uma imagem JPEG, PNG ou WebP.";
  }

  if (file.size > MAX_PRODUCT_IMAGE_SIZE) {
    return "A imagem deve ter no máximo 5 MB.";
  }

  return "";
}

function setProductFormSaving(saving, status = "Salvando...") {
  isSavingProduct = saving;

  Array.from(productForm.elements).forEach(element => {
    element.disabled = saving;
  });

  cancelEditButton.disabled = saving;
  logoutButton.disabled = saving;
  saveProductButton.textContent = saving
    ? status
    : "Salvar produto";
}

async function uploadProductImage(file) {
  const validationError = validateProductImage(file);

  if (validationError) {
    throw new Error(validationError);
  }

  const {
    data: { user },
    error: userError
  } = await supabaseClient.auth.getUser();

  if (userError || !user || user.id !== ADMIN_USER_ID) {
    throw new Error(
      "Sua sessão administrativa expirou. Entre novamente para enviar a imagem."
    );
  }

  const optimizationResult = await optimizeProductImage(file, {
    maxDimension: MAX_PRODUCT_IMAGE_DIMENSION,
    quality: PRODUCT_IMAGE_WEBP_QUALITY
  });
  const uploadFile = optimizationResult.file;
  const extension = PRODUCT_IMAGE_EXTENSIONS[uploadFile.type];

  if (!extension) {
    throw new Error(
      "O navegador gerou um formato de imagem não suportado."
    );
  }

  setProductFormSaving(true, "Enviando imagem...");
  setMessage(
    productMessage,
    optimizationResult.wasOptimized
      ? "Imagem otimizada. Enviando..."
      : "A imagem original já é a opção menor. Enviando...",
    "loading"
  );

  const objectPath = `products/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabaseClient.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(objectPath, uploadFile, {
      cacheControl: "31536000",
      contentType: uploadFile.type,
      upsert: false
    });

  if (uploadError) {
    throw new Error(
      `Não foi possível enviar a imagem: ${uploadError.message}`
    );
  }

  const { data } = supabaseClient.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .getPublicUrl(objectPath);

  if (!data?.publicUrl) {
    throw new Error(
      "A imagem foi enviada, mas não foi possível obter a URL pública."
    );
  }

  return data.publicUrl;
}

function setMessage(element, text = "", type = "") {
  element.textContent = text;
  element.className = "message";

  if (type) {
    element.classList.add(type);
  }
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function showLogin() {
  loginSection.hidden = false;
  dashboard.hidden = true;
  document.title = ADMIN_PAGE_TITLE;
}

function showDashboard(user) {
  loginSection.hidden = true;
  dashboard.hidden = false;
  adminEmail.textContent = user.email || "";
}

function scheduleOrdersRefresh() {
  if (ordersRealtimeRefreshTimer !== null) return;

  ordersRealtimeRefreshTimer = window.setTimeout(() => {
    ordersRealtimeRefreshTimer = null;
    loadOrders({ showLoading: false });
  }, ORDERS_REALTIME_REFRESH_DELAY_MS);
}

function stopAdminOrderSync() {
  isOrdersRealtimeSubscribed = false;
  alertedOrderIds.clear();

  if (ordersRealtimeRefreshTimer !== null) {
    window.clearTimeout(ordersRealtimeRefreshTimer);
    ordersRealtimeRefreshTimer = null;
  }

  if (ordersPollingTimer !== null) {
    window.clearInterval(ordersPollingTimer);
    ordersPollingTimer = null;
  }

  if (ordersRealtimeChannel) {
    const channel = ordersRealtimeChannel;
    ordersRealtimeChannel = null;
    supabaseClient.removeChannel(channel).catch(error => {
      console.warn("Não foi possível remover o canal de pedidos.", error);
    });
  }
}

function startAdminOrderSync() {
  if (!isAdminAuthenticated || ordersRealtimeChannel) return;

  ordersRealtimeChannel = supabaseClient
    .channel("admin-orders")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "orders" },
      payload => {
        if (!isAdminAuthenticated || !isOrdersRealtimeSubscribed) return;

        const newOrder = payload.new;

        if (newOrder?.id && !alertedOrderIds.has(newOrder.id)) {
          alertedOrderIds.add(newOrder.id);
          showNewOrderNotification(newOrder);
        }

        scheduleOrdersRefresh();
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "orders" },
      () => {
        if (!isAdminAuthenticated || !isOrdersRealtimeSubscribed) return;
        scheduleOrdersRefresh();
      }
    )
    .subscribe(status => {
      if (status === "SUBSCRIBED") {
        isOrdersRealtimeSubscribed = true;
        loadOrders({ showLoading: false });
        return;
      }

      isOrdersRealtimeSubscribed = false;

      if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
        console.warn(`Canal Realtime de pedidos: ${status}.`);
      }
    });

  ordersPollingTimer = window.setInterval(() => {
    if (!document.hidden && isAdminAuthenticated) {
      loadOrders({ activeOnly: true, showLoading: false });
    }
  }, ORDERS_POLL_INTERVAL_MS);
}

async function startAdminSession(user) {
  isAdminAuthenticated = true;
  showDashboard(user);

  await Promise.all([
    loadProducts(),
    loadOrders(),
    loadStoreSettings()
  ]);

  startAdminOrderSync();
}

function isTomorrowAtTen(value, now = new Date()) {
  if (!value) return false;

  const returnDate = storeLocalDateTimeToDate(value);
  const tomorrow = getTomorrowAtTen(now);

  if (!returnDate || !tomorrow) return false;

  return returnDate.getTime() === tomorrow.getTime();
}

function getSettingsState(data, now = new Date()) {
  return resolveStoreState({
    isPaused: data.is_paused === true,
    mode: normalizeStoreMode(data.store_mode, data.is_paused === true),
    returnTime: data.return_time
  }, now);
}

function renderSettingsStatus(settingsState) {
  settingsStatus.textContent = settingsState === STORE_MODES.CLOSED_TODAY
    ? "Loja fechada"
    : settingsState === STORE_MODES.PAUSED
      ? "Loja em pausa"
      : "Loja funcionando";
  settingsStatus.classList.toggle("paused", settingsState !== "open");
}

function syncStoreSettingsForm(data) {
  const settingsState = getSettingsState(data);

  if (settingsExpirationTimer !== null) {
    window.clearTimeout(settingsExpirationTimer);
    settingsExpirationTimer = null;
  }

  storeIsPaused.checked = settingsState === STORE_MODES.PAUSED;
  storeClosedToday.checked = settingsState === STORE_MODES.CLOSED_TODAY;
  storeReturnTime.value = toStoreLocalDateTimeInput(data.return_time);
  storePauseMessage.value = data.pause_message || "";
  renderSettingsStatus(settingsState);

  const returnDate = toValidDate(data.return_time);
  const delay = returnDate
    ? returnDate.getTime() - Date.now()
    : 0;

  if (settingsState !== STORE_MODES.OPEN && delay > 0) {
    settingsExpirationTimer = window.setTimeout(() => {
      loadStoreSettings();
    }, Math.min(delay + 50, 2_147_483_647));
  }
}

function loadOrderAlertsPreference() {
  try {
    return localStorage.getItem(ORDER_ALERTS_STORAGE_KEY) === "true";
  } catch (error) {
    console.warn("Não foi possível recuperar a preferência de alertas.", error);
    return false;
  }
}

function saveOrderAlertsPreference() {
  try {
    localStorage.setItem(
      ORDER_ALERTS_STORAGE_KEY,
      String(orderAlertsEnabled)
    );
  } catch (error) {
    console.warn("Não foi possível salvar a preferência de alertas.", error);
  }
}

function updateOrderAlertsControl(message = "") {
  const notificationsSupported = "Notification" in window;
  const notificationsBlocked = notificationsSupported
    && Notification.permission === "denied";
  const alertsActive = notificationsSupported
    && !notificationsBlocked
    && orderAlertsEnabled;

  orderAlertsButton.textContent = alertsActive
    ? "🔔 Alertas ativados"
    : "🔔 Ativar alertas";
  orderAlertsButton.setAttribute("aria-pressed", String(alertsActive));
  orderAlertsButton.disabled = !notificationsSupported || notificationsBlocked;

  if (message) {
    ordersAlertsStatus.textContent = message;
  } else if (!notificationsSupported) {
    ordersAlertsStatus.textContent =
      "Este navegador não oferece notificações.";
  } else if (notificationsBlocked) {
    ordersAlertsStatus.textContent =
      "Notificações bloqueadas nas configurações do navegador.";
  } else {
    ordersAlertsStatus.textContent = "";
  }
}

async function prepareOrderAlertAudio() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) return false;

    orderAlertAudioContext ||= new AudioContext();

    if (orderAlertAudioContext.state === "suspended") {
      await orderAlertAudioContext.resume();
    }

    return orderAlertAudioContext.state === "running";
  } catch (error) {
    console.warn("Não foi possível preparar o som dos pedidos.", error);
    return false;
  }
}

async function playNewOrderSound() {
  try {
    if (!await prepareOrderAlertAudio()) return;

    const context = orderAlertAudioContext;
    const startAt = context.currentTime;
    const gain = context.createGain();
    const firstTone = context.createOscillator();
    const secondTone = context.createOscillator();

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.42);
    gain.connect(context.destination);

    firstTone.type = "sine";
    firstTone.frequency.value = 659.25;
    firstTone.connect(gain);
    firstTone.start(startAt);
    firstTone.stop(startAt + 0.18);

    secondTone.type = "sine";
    secondTone.frequency.value = 783.99;
    secondTone.connect(gain);
    secondTone.start(startAt + 0.16);
    secondTone.stop(startAt + 0.42);
  } catch (error) {
    console.warn("Não foi possível tocar o alerta de novo pedido.", error);
  }
}

function showNewOrderNotification(order) {
  if (
    !orderAlertsEnabled
    || !("Notification" in window)
    || Notification.permission !== "granted"
  ) {
    return;
  }

  playNewOrderSound();

  try {
    const notification = new Notification("Novo pedido na Mimo 🍪", {
      body: `Pedido nº ${order.order_number} · ${BRL.format(Number(order.total))}`,
      tag: `mimo-order-${order.id}`,
      requireInteraction: true
    });

    notification.onclick = () => {
      window.focus();
      selectAdminTab("orders");
      notification.close();
    };
  } catch (error) {
    console.warn("Não foi possível mostrar a notificação do pedido.", error);
  }
}

function updatePendingOrdersIndicator() {
  const pendingOrders = orders.filter(order => order.status === "new").length;
  document.title = pendingOrders
    ? `(${pendingOrders}) ${ADMIN_PAGE_TITLE}`
    : ADMIN_PAGE_TITLE;
}

function setSettingsSaving(saving) {
  isSavingSettings = saving;

  Array.from(settingsForm.elements).forEach(element => {
    element.disabled = saving;
  });

  saveSettingsButton.textContent = saving
    ? "Salvando..."
    : "Salvar funcionamento";
}

async function saveStoreSettings(values, successMessage) {
  setSettingsSaving(true);
  setMessage(settingsMessage, "Salvando...", "loading");

  try {
    const { data, error } = await supabaseClient
      .from("store_settings")
      .update(values)
      .eq("id", 1)
      .select("is_paused, store_mode, return_time, pause_message")
      .single();

    if (error) throw error;

    syncStoreSettingsForm(data);
    setMessage(settingsMessage, successMessage, "success");

    return true;
  } catch (error) {
    console.error(error);
    setMessage(
      settingsMessage,
      `Não foi possível salvar o funcionamento: ${error.message}`,
      "error"
    );

    return false;
  } finally {
    setSettingsSaving(false);
  }
}

async function loadStoreSettings() {
  setMessage(settingsMessage);

  try {
    const { data, error } = await supabaseClient
      .from("store_settings")
      .select("is_paused, store_mode, return_time, pause_message")
      .eq("id", 1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new Error("A configuração da loja ainda não foi criada.");
    }

    if (
      data.is_paused === true &&
      getSettingsState(data) === STORE_MODES.OPEN
    ) {
      await saveStoreSettings(
        buildStoreSettingsUpdate(
          STORE_MODES.OPEN,
          null,
          data.pause_message
        ),
        "Loja reaberta automaticamente."
      );
      return;
    }

    syncStoreSettingsForm(data);
  } catch (error) {
    console.error(error);
    settingsStatus.textContent = "Status indisponível";
    settingsStatus.classList.remove("paused");
    setMessage(
      settingsMessage,
      "Não foi possível carregar o funcionamento. Confirme se a migration foi aplicada no Supabase.",
      "error"
    );
  }
}

async function verifyAdmin() {
  const {
    data: { user },
    error
  } = await supabaseClient.auth.getUser();

  if (error || !user) {
    showLogin();
    return;
  }

  if (user.id !== ADMIN_USER_ID) {
    await supabaseClient.auth.signOut();
    setMessage(
      loginMessage,
      "Esta conta não possui acesso administrativo.",
      "error"
    );
    showLogin();
    return;
  }

  await startAdminSession(user);
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();

  setMessage(loginMessage);
  const button = loginForm.querySelector('button[type="submit"]');

  button.disabled = true;
  button.textContent = "Entrando...";

  const { data, error } =
    await supabaseClient.auth.signInWithPassword({
      email: loginEmail.value.trim(),
      password: loginPassword.value
    });

  button.disabled = false;
  button.textContent = "Entrar";

  if (error) {
    setMessage(
      loginMessage,
      "E-mail ou senha incorretos.",
      "error"
    );
    return;
  }

  if (!data.user || data.user.id !== ADMIN_USER_ID) {
    await supabaseClient.auth.signOut();

    setMessage(
      loginMessage,
      "Esta conta não possui acesso administrativo.",
      "error"
    );
    return;
  }

  loginPassword.value = "";
  await startAdminSession(data.user);
});

logoutButton.addEventListener("click", async () => {
  isAdminAuthenticated = false;
  stopAdminOrderSync();
  MimoAdminReports.reset();
  await supabaseClient.auth.signOut();
  productForm.reset();
  resetProductForm();
  settingsForm.reset();
  settingsStatus.textContent = "Carregando...";
  settingsStatus.classList.remove("paused");
  showLogin();
});

settingsForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (isSavingSettings) return;

  setMessage(settingsMessage);

  let returnTime = null;

  if (storeReturnTime.value) {
    const parsedReturnTime = storeLocalDateTimeToDate(storeReturnTime.value);

    if (!parsedReturnTime) {
      setMessage(
        settingsMessage,
        "Informe um horário de retorno válido.",
        "error"
      );
      return;
    }

    returnTime = parsedReturnTime.toISOString();
  }

  const selectedMode = storeClosedToday.checked
    ? STORE_MODES.CLOSED_TODAY
    : storeIsPaused.checked
      ? STORE_MODES.PAUSED
      : STORE_MODES.OPEN;
  const values = buildStoreSettingsUpdate(
    selectedMode,
    returnTime,
    storePauseMessage.value
  );

  await saveStoreSettings(
    values,
    "Funcionamento atualizado com sucesso."
  );
});

storeIsPaused.addEventListener("change", () => {
  if (!storeIsPaused.checked) return;

  storeClosedToday.checked = false;

  if (isTomorrowAtTen(storeReturnTime.value)) {
    storeReturnTime.value = "";
  }
});

storeClosedToday.addEventListener("change", async () => {
  if (isSavingSettings) return;

  if (!storeClosedToday.checked) {
    setMessage(
      settingsMessage,
      "Atalho desmarcado. Para reabrir a loja, ajuste a pausa e salve o funcionamento."
    );
    return;
  }

  const previousIsPaused = storeIsPaused.checked;
  const previousReturnTime = storeReturnTime.value;

  storeIsPaused.checked = false;
  setMessage(settingsMessage);

  const tomorrowAtTen = getTomorrowAtTen();
  const values = buildStoreSettingsUpdate(
    STORE_MODES.CLOSED_TODAY,
    tomorrowAtTen?.toISOString(),
    storePauseMessage.value
  );

  const saved = await saveStoreSettings(
    values,
    "Loja fechada por hoje. Retorno definido para amanhã às 10h."
  );

  if (!saved) {
    storeClosedToday.checked = false;
    storeIsPaused.checked = previousIsPaused;
    storeReturnTime.value = previousReturnTime;
  }
});

clearReturnTimeButton.addEventListener("click", async () => {
  if (isSavingSettings) return;

  const previousIsPaused = storeIsPaused.checked;
  const previousIsClosedToday = storeClosedToday.checked;
  const previousReturnTime = storeReturnTime.value;
  const shouldRemainPaused = previousIsPaused || previousIsClosedToday;

  storeReturnTime.value = "";
  storeClosedToday.checked = false;
  storeIsPaused.checked = shouldRemainPaused;

  const saved = await saveStoreSettings(
    buildStoreSettingsUpdate(
      shouldRemainPaused ? STORE_MODES.PAUSED : STORE_MODES.OPEN,
      null,
      storePauseMessage.value
    ),
    "Horário de retorno removido."
  );

  if (!saved) {
    storeIsPaused.checked = previousIsPaused;
    storeClosedToday.checked = previousIsClosedToday;
    storeReturnTime.value = previousReturnTime;
  }
});

productName.addEventListener("input", () => {
  if (!productId.value) {
    productSlug.value = slugify(productName.value);
  }
});

productImage.addEventListener("input", () => {
  if (!productImageFile.files?.length) {
    showProductImagePreview(productImage.value.trim());
  }
});

productImageFile.addEventListener("change", () => {
  setMessage(productMessage);

  const [file] = productImageFile.files;

  if (!file) {
    showProductImagePreview(productImage.value.trim());
    return;
  }

  const validationError = validateProductImage(file);

  if (validationError) {
    productImageFile.value = "";
    showProductImagePreview(productImage.value.trim());
    setMessage(productMessage, validationError, "error");
    return;
  }

  showProductImagePreview(URL.createObjectURL(file), true);
});

async function loadProducts() {
  productsList.innerHTML = '<p class="muted">Carregando produtos...</p>';

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
    productsList.innerHTML = `
      <p class="message error">
        Não foi possível carregar os produtos.
      </p>
    `;

    console.error(error);
    return;
  }

  products = data || [];
  renderProducts();
}

function renderProducts() {
  if (!products.length) {
    productsList.innerHTML = `
      <p class="muted">
        Nenhum produto cadastrado.
      </p>
    `;
    return;
  }

  productsList.innerHTML = products.map(product => `
    <article
      class="product-row ${product.available ? "" : "status-off"}"
    >
      <img
        src="${getSafeImageSource(product.image_url)}"
        alt="${escapeHtml(product.name)}"
      >

      <div class="product-info">
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.description)}</p>

        <div class="product-meta">
          ${BRL.format(Number(product.price))}
          · ordem ${escapeHtml(product.display_order)}
          · ${product.available ? "disponível" : "esgotado"}
          ${product.stock === null ? "" : ` · estoque ${escapeHtml(product.stock)}`}
        </div>
      </div>

      <div class="product-actions">
        <button
          type="button"
          data-edit="${escapeHtml(product.id)}"
        >
          Editar
        </button>

        <button
          class="delete-button"
          type="button"
          data-delete="${escapeHtml(product.id)}"
        >
          Excluir
        </button>
      </div>
    </article>
  `).join("");
}

const ORDER_STATUS_LABELS = {
  new: "Pendente",
  confirmed: "Confirmado",
  preparing: "Em preparo",
  ready: "Pronto",
  completed: "Finalizado",
  cancelled: "Cancelado"
};

const PAYMENT_STATUS_LABELS = {
  pending: "Pendente",
  paid: "Pago",
  refunded: "Estornado",
  cancelled: "Cancelado"
};

function loadOrderStatusFilters() {
  try {
    const storedValue = localStorage.getItem(
      ORDER_STATUS_FILTER_STORAGE_KEY
    );

    if (storedValue === null) {
      return new Set(ACTIVE_ORDER_STATUS_VALUES);
    }

    const parsedValue = JSON.parse(storedValue);

    if (
      !Array.isArray(parsedValue)
      || parsedValue.some(status => typeof status !== "string")
    ) {
      return new Set(ACTIVE_ORDER_STATUS_VALUES);
    }

    return new Set(
      parsedValue.filter(status =>
        ORDER_STATUS_FILTER_VALUES.includes(status)
      )
    );
  } catch (error) {
    console.warn("Não foi possível recuperar os filtros de pedidos.", error);
    return new Set(ACTIVE_ORDER_STATUS_VALUES);
  }
}

function saveOrderStatusFilters() {
  try {
    localStorage.setItem(
      ORDER_STATUS_FILTER_STORAGE_KEY,
      JSON.stringify(
        ORDER_STATUS_FILTER_VALUES.filter(status =>
          selectedOrderStatuses.has(status)
        )
      )
    );
  } catch (error) {
    console.warn("Não foi possível salvar os filtros de pedidos.", error);
  }
}

function updateOrderStatusFilterControls() {
  orderStatusFilterInputs.forEach(input => {
    input.checked = selectedOrderStatuses.has(input.value);
  });

  const statusCounts = orders.reduce((counts, order) => {
    if (ORDER_STATUS_FILTER_VALUES.includes(order.status)) {
      counts[order.status] += 1;
    }

    return counts;
  }, Object.fromEntries(
    ORDER_STATUS_FILTER_VALUES.map(status => [status, 0])
  ));

  orderStatusCountElements.forEach(element => {
    element.textContent = statusCounts[
      element.dataset.orderStatusCount
    ];
  });
}

function getFilteredOrders() {
  const allVisibleStatusesSelected = ORDER_STATUS_FILTER_VALUES.every(
    status => selectedOrderStatuses.has(status)
  );

  return orders.filter(order => {
    if (ORDER_STATUS_FILTER_VALUES.includes(order.status)) {
      return selectedOrderStatuses.has(order.status);
    }

    return allVisibleStatusesSelected;
  });
}

function formatDate(dateValue) {
  if (!dateValue) return "—";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(dateValue));
}

function buildOrdersQuery(activeOnly = false) {
  let query = supabaseClient
    .from("orders")
    .select(`
      id,
      order_number,
      customer_name,
      delivery_method,
      customer_address,
      payment_method,
      payment_status,
      notes,
      subtotal,
      delivery_fee,
      total,
      status,
      cancellation_reason,
      created_at,
      confirmed_at,
      cancelled_at,
      order_items (
        id,
        product_slug,
        product_name,
        unit_price,
        quantity,
        line_total
      )
    `);

  if (activeOnly) {
    query = query.in("status", ACTIVE_ORDER_STATUS_VALUES);
  }

  return query.order("created_at", { ascending: false });
}

async function loadOrders({ activeOnly = false, showLoading = true } = {}) {
  if (!isAdminAuthenticated) return;

  if (ordersLoadPromise) {
    if (!activeOnly) fullOrdersRefreshQueued = true;
    return ordersLoadPromise;
  }

  ordersLoadPromise = (async () => {
    let nextLoadIsActiveOnly = activeOnly;
    let shouldShowLoading = showLoading;

    do {
      fullOrdersRefreshQueued = false;

      if (shouldShowLoading) {
        ordersList.innerHTML =
          '<p class="muted">Carregando pedidos...</p>';
      }

      const { data, error } = await buildOrdersQuery(nextLoadIsActiveOnly);

      if (error) {
        console.error("Não foi possível carregar os pedidos.", error);

        if (shouldShowLoading) {
          ordersList.innerHTML = `
            <p class="message error">
              Não foi possível carregar os pedidos.
            </p>
          `;
        }

        return;
      }

      if (nextLoadIsActiveOnly) {
        const historicalOrders = orders.filter(order =>
          !ACTIVE_ORDER_STATUS_VALUES.includes(order.status)
        );

        orders = [...(data || []), ...historicalOrders].sort(
          (firstOrder, secondOrder) =>
            new Date(secondOrder.created_at) - new Date(firstOrder.created_at)
        );
      } else {
        orders = data || [];
      }

      renderOrders();
      shouldShowLoading = false;
      nextLoadIsActiveOnly = false;
    } while (fullOrdersRefreshQueued && isAdminAuthenticated);
  })();

  try {
    await ordersLoadPromise;
  } finally {
    ordersLoadPromise = null;
  }
}

function renderOrders() {
  updateOrderStatusFilterControls();
  updatePendingOrdersIndicator();

  if (!selectedOrderStatuses.size) {
    ordersList.innerHTML = `
      <p class="muted orders-empty-state">
        Nenhum status selecionado. Marque ao menos um filtro para exibir pedidos.
      </p>
    `;
    return;
  }

  if (!orders.length) {
    ordersList.innerHTML = `
      <p class="muted">
        Nenhum pedido registrado.
      </p>
    `;
    return;
  }

  const filteredOrders = getFilteredOrders();

  if (!filteredOrders.length) {
    ordersList.innerHTML = `
      <p class="muted orders-empty-state">
        Nenhum pedido corresponde aos filtros selecionados.
      </p>
    `;
    return;
  }

  ordersList.innerHTML = filteredOrders.map(order => {
    const items = order.order_items || [];
    const orderId = escapeHtml(order.id);
    const orderStatus = Object.hasOwn(
      ORDER_STATUS_LABELS,
      order.status
    ) ? order.status : "unknown";

    const itemsHtml = items.map(item => `
      <div class="order-item-line">
        <span>
          ${escapeHtml(item.quantity)}x ${escapeHtml(item.product_name)}
        </span>

        <strong>
          ${BRL.format(Number(item.line_total))}
        </strong>
      </div>
    `).join("");

    const canConfirm = order.status === "new";

    const canComplete = order.status === "confirmed";

    const canCancel = ![
      "cancelled",
      "completed"
    ].includes(order.status);

    const cancellationReasonLabel = order.status === "cancelled"
      ? CANCELLATION_REASON_LABELS[order.cancellation_reason]
      : "";

    return `
      <article
        class="order-card ${orderStatus}"
        data-order-id="${orderId}"
      >
        <div class="order-header">
          <div>
            <h3>
              Pedido nº ${escapeHtml(order.order_number)}
              — ${escapeHtml(order.customer_name)}
            </h3>

            <p>
              Registrado em ${escapeHtml(formatDate(order.created_at))}
            </p>
          </div>

          <span class="order-status ${orderStatus}">
            ${escapeHtml(
              ORDER_STATUS_LABELS[order.status]
                || order.status
                || "Desconhecido"
            )}
          </span>
        </div>

        <div class="order-details">
          <div class="order-detail">
            <small>Recebimento</small>
            <strong>${escapeHtml(order.delivery_method)}</strong>
          </div>

          <div class="order-detail">
            <small>Pagamento</small>
            <strong>${escapeHtml(order.payment_method)}</strong>
          </div>

          <div class="order-detail">
            <small>Situação do pagamento</small>
            <strong>
              ${escapeHtml(
                PAYMENT_STATUS_LABELS[order.payment_status]
                  || order.payment_status
              )}
            </strong>
          </div>

          <div class="order-detail">
            <small>Total dos produtos</small>
            <strong>${BRL.format(Number(order.subtotal))}</strong>
          </div>
        </div>

        ${
          order.delivery_method === "Entrega"
            ? `
              <div class="order-notes">
                <strong>Endereço:</strong>
                ${escapeHtml(order.customer_address || "Não informado")}
              </div>
            `
            : ""
        }

        ${
          order.notes
            ? `
              <div class="order-notes">
                <strong>Observações:</strong>
                ${escapeHtml(order.notes)}
              </div>
            `
            : ""
        }

        ${
          cancellationReasonLabel
            ? `
              <div class="order-cancellation-reason">
                <strong>Motivo do cancelamento:</strong>
                ${escapeHtml(cancellationReasonLabel)}
              </div>
            `
            : ""
        }

        <div class="order-items">
          ${itemsHtml}
        </div>

        ${
          canConfirm || canComplete || canCancel
            ? `
              <div class="order-actions" data-order-actions>
                ${
                  canConfirm
                    ? `
                      <button
                        class="confirm-order-button"
                        type="button"
                        data-confirm-order="${orderId}"
                      >
                        Confirmar e baixar estoque
                      </button>
                    `
                    : ""
                }

                ${
                  canComplete
                    ? `
                      <button
                        class="complete-order-button"
                        type="button"
                        data-complete-order="${orderId}"
                      >
                        Finalizar pedido
                      </button>
                    `
                    : ""
                }

                ${
                  canCancel
                    ? `
                      <button
                        class="cancel-order-button"
                        type="button"
                        data-cancel-order="${orderId}"
                      >
                        Cancelar pedido
                      </button>
                    `
                    : ""
                }
              </div>

              ${
                canCancel
                  ? `
                    <div class="order-cancellation-form" data-cancellation-form hidden>
                      <label>
                        Motivo do cancelamento
                        <select data-cancellation-reason>
                          <option value="">Selecione um motivo</option>
                          <option value="test_order">Pedido de teste</option>
                          <option value="duplicate_order">Pedido duplicado</option>
                          <option value="whatsapp_not_confirmed">Cliente não confirmou no WhatsApp</option>
                          <option value="other">Outro</option>
                        </select>
                      </label>

                      <p class="message error" data-cancellation-error></p>

                      <div class="order-cancellation-actions">
                        <button
                          class="cancel-order-button"
                          type="button"
                          data-confirm-cancellation="${orderId}"
                          disabled
                        >
                          Confirmar cancelamento
                        </button>
                        <button
                          class="secondary-button"
                          type="button"
                          data-close-cancellation
                        >
                          Voltar
                        </button>
                      </div>
                    </div>
                  `
                  : ""
              }
            `
            : ""
        }
      </article>
    `;
  }).join("");
}

productForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (isSavingProduct) return;

  setMessage(productMessage);

  const [selectedImage] = productImageFile.files;
  const imageValidationError = validateProductImage(selectedImage);
  const editingProductId = productId.value;

  if (imageValidationError) {
    setMessage(productMessage, imageValidationError, "error");
    return;
  }

  const values = {
    slug: slugify(productSlug.value),
    name: productName.value.trim(),
    price: Number(productPrice.value),
    description: productDescription.value.trim(),
    image_url: productImage.value.trim(),
    available: productAvailable.checked,
    stock:
      productStock.value === ""
        ? null
        : Number(productStock.value),
    display_order: Number(productOrder.value)
  };

  if (!values.slug || !values.name || (!values.image_url && !selectedImage)) {
    setMessage(
      productMessage,
      "Preencha os campos obrigatórios e informe ou escolha uma imagem.",
      "error"
    );
    return;
  }

  setProductFormSaving(
    true,
    selectedImage ? "Otimizando imagem..." : "Salvando..."
  );

  if (selectedImage) {
    setMessage(productMessage, "Otimizando imagem...", "loading");

    try {
      values.image_url = await uploadProductImage(selectedImage);
      productImage.value = values.image_url;
      productImageFile.value = "";
      showProductImagePreview(values.image_url);
    } catch (error) {
      console.error(error);
      setProductFormSaving(false);
      setMessage(
        productMessage,
        error.message || "Não foi possível enviar a imagem.",
        "error"
      );
      return;
    }

    saveProductButton.textContent = "Salvando produto...";
    setMessage(
      productMessage,
      "Imagem enviada. Salvando produto...",
      "loading"
    );
  }

  let error;

  try {
    if (editingProductId) {
      ({ error } = await supabaseClient
        .from("products")
        .update(values)
        .eq("id", editingProductId));
    } else {
      ({ error } = await supabaseClient
        .from("products")
        .insert(values));
    }
  } catch (saveError) {
    error = saveError;
  }

  setProductFormSaving(false);

  if (error) {
    console.error(error);

    let message = `Não foi possível salvar: ${error.message}`;

    if (error.code === "23505") {
      message = "Já existe um produto com esse identificador.";
    } else if (selectedImage) {
      message =
        `A imagem foi enviada, mas não foi possível salvar o produto: ${error.message}. `
        + "Tente salvar novamente.";
    }

    setMessage(productMessage, message, "error");
    return;
  }

  setMessage(
    productMessage,
    editingProductId
      ? "Produto atualizado com sucesso."
      : "Produto adicionado com sucesso.",
    "success"
  );

  resetProductForm();
  await loadProducts();
});

productsList.addEventListener("click", async event => {
  if (isSavingProduct) return;

  const editButton = event.target.closest("[data-edit]");
  const deleteButton = event.target.closest("[data-delete]");

  if (editButton) {
    startEditing(editButton.dataset.edit);
    return;
  }

  if (deleteButton) {
    await deleteProduct(deleteButton.dataset.delete);
  }
});

function startEditing(id) {
  const product = products.find(item => item.id === id);

  if (!product) return;

  productId.value = product.id;
  productName.value = product.name;
  productSlug.value = product.slug;
  productPrice.value = Number(product.price);
  productDescription.value = product.description;
  productImage.value = product.image_url;
  productImageFile.value = "";
  showProductImagePreview(product.image_url);
  productStock.value =
    product.stock === null ? "" : product.stock;
  productOrder.value = product.display_order;
  productAvailable.checked = product.available;

  formEyebrow.textContent = "Editando sabor";
  formTitle.textContent = product.name;
  cancelEditButton.hidden = false;

  setMessage(productMessage);

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

async function deleteProduct(id) {
  const product = products.find(item => item.id === id);

  if (!product) return;

  const confirmed = window.confirm(
    `Excluir o sabor "${product.name}"? Esta ação não pode ser desfeita.`
  );

  if (!confirmed) return;

  const { error } = await supabaseClient
    .from("products")
    .delete()
    .eq("id", id);

  if (error) {
    console.error(error);

    window.alert(
      `Não foi possível excluir: ${error.message}`
    );

    return;
  }

  if (productId.value === id) {
    resetProductForm();
  }

  await loadProducts();
}

function resetProductForm() {
  productForm.reset();

  setProductFormSaving(false);
  showProductImagePreview();

  productId.value = "";
  productOrder.value = "0";
  productAvailable.checked = true;

  formEyebrow.textContent = "Novo sabor";
  formTitle.textContent = "Adicionar produto";
  cancelEditButton.hidden = true;
}

cancelEditButton.addEventListener("click", () => {
  resetProductForm();
  setMessage(productMessage);
});

refreshButton.addEventListener("click", loadProducts);

supabaseClient.auth.onAuthStateChange(event => {
  if (event === "SIGNED_OUT") {
    isAdminAuthenticated = false;
    stopAdminOrderSync();
    MimoAdminReports.reset();
    showLogin();
  }
});

ordersList.addEventListener("click", async event => {
  const completeButton =
    event.target.closest("[data-complete-order]");

  const confirmButton =
    event.target.closest("[data-confirm-order]");

  const cancelButton =
    event.target.closest("[data-cancel-order]");

  const confirmCancellationButton =
    event.target.closest("[data-confirm-cancellation]");

  const closeCancellationButton =
    event.target.closest("[data-close-cancellation]");

  if (completeButton) {
    await completeOrder(completeButton.dataset.completeOrder);
    return;
  }

  if (confirmButton) {
    await confirmOrder(confirmButton.dataset.confirmOrder);
    return;
  }

  if (cancelButton) {
    showCancellationForm(cancelButton.dataset.cancelOrder);
    return;
  }

  if (confirmCancellationButton) {
    await cancelOrder(
      confirmCancellationButton.dataset.confirmCancellation
    );
    return;
  }

  if (closeCancellationButton) {
    closeCancellationForm(closeCancellationButton);
  }
});

ordersList.addEventListener("change", event => {
  const reasonSelect = event.target.closest("[data-cancellation-reason]");

  if (!reasonSelect) return;

  const form = reasonSelect.closest("[data-cancellation-form]");
  const confirmButton = form.querySelector("[data-confirm-cancellation]");

  confirmButton.disabled = !Object.hasOwn(
    CANCELLATION_REASON_LABELS,
    reasonSelect.value
  );
});

function showCancellationForm(orderId) {
  const orderCard = ordersList.querySelector(
    `[data-order-id="${CSS.escape(orderId)}"]`
  );

  if (!orderCard) return;

  orderCard.querySelector("[data-order-actions]").hidden = true;
  orderCard.querySelector("[data-cancellation-form]").hidden = false;
  orderCard.querySelector("[data-cancellation-reason]").focus();
}

function closeCancellationForm(button) {
  const orderCard = button.closest("[data-order-id]");
  const form = orderCard.querySelector("[data-cancellation-form]");

  form.hidden = true;
  form.querySelector("[data-cancellation-reason]").value = "";
  form.querySelector("[data-confirm-cancellation]").disabled = true;
  setMessage(form.querySelector("[data-cancellation-error]"));
  orderCard.querySelector("[data-order-actions]").hidden = false;
}

function setOrderUpdating(orderId, updating) {
  if (updating) {
    updatingOrderIds.add(orderId);
  } else {
    updatingOrderIds.delete(orderId);
  }

  const orderCard = Array.from(
    ordersList.querySelectorAll("[data-order-id]")
  ).find(card => card.dataset.orderId === orderId);

  if (!orderCard) return;

  orderCard.querySelectorAll("button, select").forEach(control => {
    control.disabled = updating;
  });

  if (!updating) {
    const reasonSelect = orderCard.querySelector("[data-cancellation-reason]");
    const confirmCancellationButton = orderCard.querySelector(
      "[data-confirm-cancellation]"
    );

    if (reasonSelect && confirmCancellationButton) {
      confirmCancellationButton.disabled = !Object.hasOwn(
        CANCELLATION_REASON_LABELS,
        reasonSelect.value
      );
    }
  }

  const completeButton = orderCard.querySelector(
    "[data-complete-order]"
  );

  if (completeButton) {
    completeButton.textContent = updating
      ? "Finalizando..."
      : "Finalizar pedido";
  }
}

async function completeOrder(orderId) {
  if (updatingOrderIds.has(orderId)) return;

  const order = orders.find(item => item.id === orderId);

  if (!order || order.status !== "confirmed") {
    setMessage(
      ordersMessage,
      "O pedido não está mais confirmado. Atualize a lista e tente novamente.",
      "error"
    );
    return;
  }

  const confirmed = window.confirm(
    `Marcar o Pedido Mimo nº ${order.order_number} como finalizado?`
  );

  if (!confirmed) return;

  setOrderUpdating(orderId, true);
  setMessage(ordersMessage, "Finalizando pedido...", "loading");

  let data;
  let error;

  try {
    ({ data, error } = await supabaseClient.rpc(
      "complete_order",
      {
        p_order_id: orderId
      }
    ));
  } catch (requestError) {
    error = requestError;
  }

  if (error) {
    console.error(error);
    setOrderUpdating(orderId, false);
    setMessage(
      ordersMessage,
      `Não foi possível finalizar o pedido: ${error.message}`,
      "error"
    );
    return;
  }

  if (data !== true) {
    setOrderUpdating(orderId, false);
    setMessage(
      ordersMessage,
      "O pedido não está mais confirmado. Atualize a lista e tente novamente.",
      "error"
    );
    await loadOrders();
    return;
  }

  await loadOrders();
  updatingOrderIds.delete(orderId);
  setMessage(
    ordersMessage,
    `Pedido Mimo nº ${order.order_number} finalizado com sucesso.`,
    "success"
  );
}

async function confirmOrder(orderId) {
  const order = orders.find(item => item.id === orderId);

  if (!order) return;

  const confirmed = window.confirm(
    `Confirmar o pedido nº ${order.order_number} e baixar o estoque?`
  );

  if (!confirmed) return;

  const { error } = await supabaseClient.rpc(
    "confirm_order",
    {
      p_order_id: orderId
    }
  );

  if (error) {
    console.error(error);
    window.alert(error.message);
    return;
  }

  await Promise.all([
    loadOrders(),
    loadProducts()
  ]);
}

async function cancelOrder(orderId) {
  if (updatingOrderIds.has(orderId)) return;

  const order = orders.find(item => item.id === orderId);

  if (!order) return;

  const orderCard = ordersList.querySelector(
    `[data-order-id="${CSS.escape(orderId)}"]`
  );
  const form = orderCard?.querySelector("[data-cancellation-form]");
  const reason = form?.querySelector("[data-cancellation-reason]").value;
  const errorMessage = form?.querySelector("[data-cancellation-error]");
  const confirmButton = form?.querySelector("[data-confirm-cancellation]");

  if (!Object.hasOwn(CANCELLATION_REASON_LABELS, reason)) {
    if (errorMessage) {
      setMessage(errorMessage, "Selecione um motivo para continuar.", "error");
    }
    return;
  }

  setMessage(errorMessage);
  setOrderUpdating(orderId, true);

  if (confirmButton) confirmButton.textContent = "Cancelando...";

  let error;

  try {
    ({ error } = await supabaseClient.rpc(
      "cancel_order_with_reason",
      {
        p_order_id: orderId,
        p_reason: reason
      }
    ));
  } catch (requestError) {
    error = requestError;
  }

  if (error) {
    console.error(error);
    setOrderUpdating(orderId, false);
    if (confirmButton) confirmButton.textContent = "Confirmar cancelamento";
    setMessage(
      errorMessage,
      `Não foi possível cancelar o pedido: ${error.message}`,
      "error"
    );
    return;
  }

  await Promise.all([
    loadOrders(),
    loadProducts()
  ]);

  updatingOrderIds.delete(orderId);
  setMessage(
    ordersMessage,
    `Pedido Mimo nº ${order.order_number} cancelado com sucesso.`,
    "success"
  );
}

refreshOrdersButton.addEventListener("click", () => loadOrders());

orderAlertsButton.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    updateOrderAlertsControl();
    return;
  }

  if (orderAlertsEnabled && Notification.permission === "granted") {
    orderAlertsEnabled = false;
    saveOrderAlertsPreference();
    updateOrderAlertsControl("Alertas desativados.");
    return;
  }

  let permission = Notification.permission;

  if (permission === "default") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    orderAlertsEnabled = false;
    saveOrderAlertsPreference();
    updateOrderAlertsControl();
    return;
  }

  await prepareOrderAlertAudio();
  orderAlertsEnabled = true;
  saveOrderAlertsPreference();
  updateOrderAlertsControl();
});

orderStatusFilters.addEventListener("change", event => {
  if (!event.target.matches('input[type="checkbox"]')) return;

  if (event.target.checked) {
    selectedOrderStatuses.add(event.target.value);
  } else {
    selectedOrderStatuses.delete(event.target.value);
  }

  saveOrderStatusFilters();
  renderOrders();
});

orderStatusFilters.addEventListener("click", event => {
  const actionButton = event.target.closest("[data-order-filter-action]");

  if (!actionButton) return;

  selectedOrderStatuses = new Set(
    actionButton.dataset.orderFilterAction === "all"
      ? ORDER_STATUS_FILTER_VALUES
      : ACTIVE_ORDER_STATUS_VALUES
  );

  saveOrderStatusFilters();
  renderOrders();
});

updateOrderStatusFilterControls();
updateOrderAlertsControl();
MimoAdminReports.init({ client: supabaseClient });

if (orderAlertsEnabled) {
  document.addEventListener("pointerdown", prepareOrderAlertAudio, {
    once: true
  });
}

function selectAdminTab(selectedTab) {
  tabButtons.forEach(tabButton => {
    const isSelected = tabButton.dataset.tab === selectedTab;

    tabButton.classList.toggle("active", isSelected);
    tabButton.setAttribute("aria-selected", String(isSelected));
  });

  tabPanels.forEach(panelElement => {
    const isSelected = panelElement.dataset.panel === selectedTab;

    panelElement.hidden = !isSelected;
    panelElement.classList.toggle("active", isSelected);
  });

  if (selectedTab === "orders") {
    loadOrders({ showLoading: false });
  } else if (selectedTab === "settings") {
    loadStoreSettings();
  } else if (selectedTab === "reports") {
    MimoAdminReports.load();
  }
}

tabButtons.forEach(button => {
  button.addEventListener("click", () => {
    selectAdminTab(button.dataset.tab);
  });
});

function refreshOrdersAfterReturn() {
  if (!isAdminAuthenticated || document.hidden) return;

  const now = Date.now();

  if (now - lastOrdersReturnRefreshAt < ORDERS_RETURN_REFRESH_THROTTLE_MS) {
    return;
  }

  lastOrdersReturnRefreshAt = now;
  loadOrders({ showLoading: false });
}

window.addEventListener("focus", refreshOrdersAfterReturn);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshOrdersAfterReturn();
});
window.addEventListener("pagehide", event => {
  if (!event.persisted) stopAdminOrderSync();
});

verifyAdmin();
