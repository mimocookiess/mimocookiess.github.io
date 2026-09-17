(function (root) {
  "use strict";

  const WIDTH = 384;
  const MARGIN = 16;
  const CONTENT_WIDTH = WIDTH - MARGIN * 2;
  let logoPromise;

  function buildOrderReceiptData(order) {
    return {
      orderNumber: order.order_number,
      customerName: String(order.customer_name || "Não informado"),
      items: (order.order_items || []).map(item => ({
        quantity: item.quantity,
        productName: String(item.product_name || "Produto"),
        lineTotal: item.line_total
      })),
      subtotal: order.subtotal,
      deliveryFee: order.delivery_fee,
      total: order.total,
      paymentMethod: String(order.payment_method || "Não informado"),
      fulfillment: String(order.delivery_method || "Não informado").toUpperCase(),
      address: order.delivery_method === "Retirada"
        ? "Av. Frei Vicente, 485\nAeroporto Velho\nRes. Gran Ville"
        : String(order.customer_address || "Não informado"),
      neighborhood: order.delivery_method === "Entrega"
        ? String(order.delivery_neighborhood || "") : "",
      notes: String(order.notes || "").trim()
    };
  }

  function loadReceiptLogo() {
    if (!logoPromise) {
      logoPromise = new Promise(resolve => {
        const img = new Image();
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          img.onload = img.onerror = null;
          if (!value) console.warn("Logo da comanda indisponível.");
          resolve(value);
        };
        const timeout = setTimeout(() => finish(null), 5000);
        img.onload = () => finish(img.naturalWidth ? img : null);
        img.onerror = () => finish(null);
        img.src = "../assets/images/logo.png";
      });
    }
    return logoPromise;
  }

  function wrapText(context, text, width) {
    const lines = [];
    for (const paragraph of String(text).split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (context.measureText(candidate).width <= width) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        line = "";
        // Split even an unbroken word/address instead of clipping it.
        for (const character of word) {
          if (line && context.measureText(line + character).width > width) {
            lines.push(line);
            line = "";
          }
          line += character;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  function renderOrderReceiptCanvas(data, { logo = null, money, createCanvas = () => document.createElement("canvas") } = {}) {
    const canvas = createCanvas();
    canvas.width = WIDTH;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas indisponível.");
    const currency = money || new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    const commands = [];
    let y = MARGIN;
    const font = (size, bold) => `${bold ? 700 : 500} ${size}px Arial, sans-serif`;
    function text(value, size = 22, bold = false, align = "left", width = CONTENT_WIDTH, x = MARGIN) {
      context.font = font(size, bold);
      const lines = wrapText(context, value, width);
      for (const line of lines) {
        const lineY = y;
        commands.push(() => {
          context.font = font(size, bold);
          context.textAlign = align;
          context.fillText(line, x, lineY);
        });
        y += Math.ceil(size * 1.3);
      }
    }
    function separator() {
      y += 12;
      const lineY = y;
      commands.push(() => context.fillRect(MARGIN, lineY, CONTENT_WIDTH, 2));
      y += 18;
    }
    function pair(label, value, size = 22, bold = false) {
      const amount = currency.format(Number(value));
      context.font = font(size, bold);
      const amountWidth = context.measureText(amount).width;
      const start = y;
      if (amountWidth > CONTENT_WIDTH / 2) {
        text(label, size, bold);
        text(amount, size, bold, "right", CONTENT_WIDTH, WIDTH - MARGIN);
        return;
      }
      text(label, size, bold, "left", CONTENT_WIDTH - amountWidth - 12);
      const end = y;
      y = start;
      text(amount, size, bold, "right", amountWidth + 1, WIDTH - MARGIN);
      y = Math.max(y, end);
    }
    if (logo) {
      const logoWidth = 180;
      const logoHeight = Math.round(logoWidth * logo.naturalHeight / logo.naturalWidth);
      const logoY = y;
      commands.push(() => {
        try {
          // Composite on white, then threshold to pure black/white for thermal paper.
          const mono = createCanvas();
          mono.width = logoWidth;
          mono.height = logoHeight;
          const ctx = mono.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, logoWidth, logoHeight);
          ctx.drawImage(logo, 0, 0, logoWidth, logoHeight);
          const pixels = ctx.getImageData(0, 0, logoWidth, logoHeight);
          for (let i = 0; i < pixels.data.length; i += 4) {
            const luminance = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114;
            pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = luminance < 190 ? 0 : 255;
            pixels.data[i + 3] = 255;
          }
          ctx.putImageData(pixels, 0, 0);
          context.drawImage(mono, (WIDTH - logoWidth) / 2, logoY);
        } catch {
          console.warn("Não foi possível desenhar a logo da comanda.");
        }
      });
      y += logoHeight;
    }
    separator();
    text(`PEDIDO Nº ${data.orderNumber}`, 32, true, "center", CONTENT_WIDTH, WIDTH / 2);
    separator();
    text("CLIENTE", 20, true);
    text(data.customerName);
    separator();
    text("ITENS", 20, true);
    y += 8;
    data.items.forEach(item => {
      pair(`${item.quantity}x ${item.productName}`, item.lineTotal);
      y += 6;
    });
    separator();
    pair("Subtotal", data.subtotal);
    if (data.fulfillment === "ENTREGA") pair("Entrega", data.deliveryFee);
    pair("TOTAL", data.total, 27, true);
    separator();
    text("PAGAMENTO", 20, true);
    text(data.paymentMethod);
    separator();
    text(data.fulfillment, 20, true);
    text(data.address);
    if (data.neighborhood && !data.address.toLocaleLowerCase("pt-BR").includes(data.neighborhood.toLocaleLowerCase("pt-BR"))) {
      text(data.neighborhood);
    }
    if (data.notes) {
      separator();
      text("OBSERVAÇÃO", 20, true);
      text(data.notes);
    }
    separator();
    text("Obrigada por pedir Mimo!", 21, true, "center", CONTENT_WIDTH, WIDTH / 2);
    canvas.height = y + MARGIN;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, WIDTH, canvas.height);
    context.fillStyle = "#000";
    context.textBaseline = "top";
    commands.forEach(draw => draw());
    return canvas;
  }

  async function canvasToPngFile(canvas, orderNumber) {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error("PNG indisponível.")), "image/png");
    });
    const number = String(orderNumber).replace(/[^a-zA-Z0-9_-]/g, "_");
    return new File([blob], `mimo-pedido-${number}.png`, { type: "image/png" });
  }

  function canShareReceipt(file, nav = navigator) {
    try {
      return typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] });
    } catch {
      return false;
    }
  }

  async function shareOrderReceipt(file, nav = navigator) {
    if (!canShareReceipt(file, nav)) return "fallback";
    try {
      await nav.share({ files: [file] });
      return "shared";
    } catch (error) {
      if (error.name === "AbortError") return "cancelled";
      if (error.name === "NotAllowedError") return "retry";
      throw new Error("Não foi possível compartilhar a comanda.");
    }
  }

  const api = { buildOrderReceiptData, loadReceiptLogo, wrapText, renderOrderReceiptCanvas, canvasToPngFile, canShareReceipt, shareOrderReceipt };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MimoOrderReceipt = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
