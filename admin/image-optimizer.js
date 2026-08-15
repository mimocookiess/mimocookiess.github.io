(function initializeProductImageOptimizer(globalScope) {
  "use strict";

  const DEFAULT_MAX_DIMENSION = 1200;
  const DEFAULT_WEBP_QUALITY = 0.84;
  const WEBP_MIME_TYPE = "image/webp";

  function getOutputDimensions(width, height, maxDimension) {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error("Não foi possível identificar as dimensões da imagem.");
    }

    const largestDimension = Math.max(width, height);
    const scale = Math.min(1, maxDimension / largestDimension);

    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      wasResized: scale < 1
    };
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => resolve({ image, objectUrl });
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Não foi possível ler o conteúdo da imagem."));
      };
      image.src = objectUrl;
    });
  }

  function canvasToWebp(canvas, quality) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== "function") {
        reject(new Error(
          "Este navegador não oferece suporte à otimização de imagens."
        ));
        return;
      }

      canvas.toBlob(blob => {
        if (!blob || blob.type !== WEBP_MIME_TYPE) {
          reject(new Error(
            "Este navegador não conseguiu gerar a imagem em WebP."
          ));
          return;
        }

        resolve(blob);
      }, WEBP_MIME_TYPE, quality);
    });
  }

  function getWebpFileName(fileName) {
    const baseName = String(fileName || "")
      .replace(/\.[^.]+$/, "")
      .trim() || "produto";

    return `${baseName}.webp`;
  }

  async function optimizeProductImage(file, options = {}) {
    if (!(file instanceof Blob)) {
      throw new Error("Selecione uma imagem válida para otimizar.");
    }

    const maxDimension = Number(options.maxDimension) ||
      DEFAULT_MAX_DIMENSION;
    const quality = Number.isFinite(options.quality)
      ? options.quality
      : DEFAULT_WEBP_QUALITY;
    const { image, objectUrl } = await loadImage(file);
    let originalWidth;
    let originalHeight;
    let outputDimensions;
    let optimizedBlob;

    try {
      originalWidth = image.naturalWidth;
      originalHeight = image.naturalHeight;
      outputDimensions = getOutputDimensions(
        originalWidth,
        originalHeight,
        maxDimension
      );

      const canvas = document.createElement("canvas");
      canvas.width = outputDimensions.width;
      canvas.height = outputDimensions.height;

      const context = canvas.getContext("2d", { alpha: true });

      if (!context) {
        throw new Error("Não foi possível preparar a otimização da imagem.");
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        0,
        0,
        outputDimensions.width,
        outputDimensions.height
      );

      optimizedBlob = await canvasToWebp(canvas, quality);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    const canKeepSmallerOriginal =
      !outputDimensions.wasResized &&
      file.size <= optimizedBlob.size;

    if (canKeepSmallerOriginal) {
      return {
        file,
        originalWidth,
        originalHeight,
        outputWidth: originalWidth,
        outputHeight: originalHeight,
        wasOptimized: false
      };
    }

    const optimizedFile = new File(
      [optimizedBlob],
      getWebpFileName(file.name),
      {
        type: WEBP_MIME_TYPE,
        lastModified: file.lastModified || Date.now()
      }
    );

    return {
      file: optimizedFile,
      originalWidth,
      originalHeight,
      outputWidth: outputDimensions.width,
      outputHeight: outputDimensions.height,
      wasOptimized: true
    };
  }

  globalScope.MimoProductImageOptimizer = Object.freeze({
    DEFAULT_MAX_DIMENSION,
    DEFAULT_WEBP_QUALITY,
    WEBP_MIME_TYPE,
    getOutputDimensions,
    optimizeProductImage
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
