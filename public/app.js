const state = {
  jobId: null,
  previewTimer: null,
  pollingTimer: null,
  language: "zh",
  statusKey: "idle",
  statusArgs: {},
  downloadSize: null,
  frameKey: "first",
  frameUrls: {}
};

const translations = {
  zh: {
    appTitle: "绿幕透明 WebM 工具",
    videoMetaIdle: "选择一个绿幕视频开始。",
    chooseVideo: "选择视频",
    originalFrame: "原始帧",
    noFrameLoaded: "未加载画面",
    keyedPreview: "抠像预览",
    frameFirst: "第一帧",
    frameMiddle: "中间帧",
    frameLast: "最后帧",
    bgChecker: "棋盘",
    bgStripes: "彩条",
    bgBlack: "黑底",
    bgWhite: "白底",
    tuneToPreview: "调整参数后预览",
    keySettings: "抠像参数",
    keyColor: "抠像颜色",
    similarity: "抠像强度",
    blend: "边缘柔和",
    despillMix: "去绿边强度",
    despillExpand: "去绿边范围",
    export: "导出",
    qualityCrf: "质量 CRF",
    preview: "预览",
    exportWebm: "导出 WebM",
    idle: "空闲",
    downloadOutput: "下载输出文件",
    filter: "滤镜",
    noPreviewYet: "还没有预览。",
    uploadingVideo: "正在上传视频...",
    generatingPreview: "正在生成预览...",
    previewReady: "预览已生成",
    videoLoaded: "视频已加载",
    exporting: "正在导出...",
    exportComplete: "导出完成",
    exportFailed: "导出失败",
    requestFailed: "请求失败",
    uploadFailed: "上传失败",
    downloadWithSize: "下载输出文件 ({size})"
  },
  en: {
    appTitle: "Green Screen WebM Tool",
    videoMetaIdle: "Choose a green-screen video to begin.",
    chooseVideo: "Choose Video",
    originalFrame: "Original Frame",
    noFrameLoaded: "No frame loaded",
    keyedPreview: "Keyed Preview",
    frameFirst: "First",
    frameMiddle: "Middle",
    frameLast: "Last",
    bgChecker: "Checker",
    bgStripes: "Stripes",
    bgBlack: "Black",
    bgWhite: "White",
    tuneToPreview: "Tune settings to preview",
    keySettings: "Key Settings",
    keyColor: "Key Color",
    similarity: "Similarity",
    blend: "Blend",
    despillMix: "Despill Mix",
    despillExpand: "Despill Expand",
    export: "Export",
    qualityCrf: "Quality CRF",
    preview: "Preview",
    exportWebm: "Export WebM",
    idle: "Idle",
    downloadOutput: "Download output",
    filter: "Filter",
    noPreviewYet: "No preview yet.",
    uploadingVideo: "Uploading video...",
    generatingPreview: "Generating preview...",
    previewReady: "Preview ready",
    videoLoaded: "Video loaded",
    exporting: "Exporting...",
    exportComplete: "Export complete",
    exportFailed: "Export failed",
    requestFailed: "Request failed",
    uploadFailed: "Upload failed",
    downloadWithSize: "Download output ({size})"
  }
};

const els = {
  videoInput: document.querySelector("#videoInput"),
  videoMeta: document.querySelector("#videoMeta"),
  originalFrame: document.querySelector("#originalFrame"),
  previewFrame: document.querySelector("#previewFrame"),
  previewBackground: document.querySelector("#previewBackground"),
  previewButton: document.querySelector("#previewButton"),
  exportButton: document.querySelector("#exportButton"),
  downloadLink: document.querySelector("#downloadLink"),
  statusText: document.querySelector("#statusText"),
  progressText: document.querySelector("#progressText"),
  progressFill: document.querySelector("#progressFill"),
  filterText: document.querySelector("#filterText"),
  langZh: document.querySelector("#langZh"),
  langEn: document.querySelector("#langEn"),
  keyColor: document.querySelector("#keyColor"),
  similarity: document.querySelector("#similarity"),
  blend: document.querySelector("#blend"),
  despillMix: document.querySelector("#despillMix"),
  despillExpand: document.querySelector("#despillExpand"),
  crf: document.querySelector("#crf")
};

const controls = [
  ["similarity", "similarityValue"],
  ["blend", "blendValue"],
  ["despillMix", "despillMixValue"],
  ["despillExpand", "despillExpandValue"],
  ["crf", "crfValue"]
];

function t(key, args = {}) {
  const template = translations[state.language]?.[key] || translations.zh[key] || key;
  return Object.entries(args).reduce((text, [name, value]) => {
    return text.replaceAll(`{${name}}`, value);
  }, template);
}

function setLanguage(language) {
  state.language = language;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  els.langZh.classList.toggle("is-active", language === "zh");
  els.langEn.classList.toggle("is-active", language === "en");

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });

  if (!state.jobId) {
    els.videoMeta.textContent = t("videoMetaIdle");
  }
  if (state.downloadSize !== null && !els.downloadLink.hidden) {
    els.downloadLink.textContent = t("downloadWithSize", { size: formatBytes(state.downloadSize) });
  }
  setStatus(state.statusKey, null, state.statusArgs);
}

function setImage(img, url) {
  img.src = url;
  img.closest(".frame-wrap").classList.add("has-image");
}

function setStatus(key, progress = null, args = {}) {
  state.statusKey = key;
  state.statusArgs = args;
  els.statusText.textContent = translations[state.language]?.[key] ? t(key, args) : key;
  if (progress !== null) {
    const clamped = Math.max(0, Math.min(100, progress));
    els.progressText.textContent = `${Math.round(clamped)}%`;
    els.progressFill.style.width = `${clamped}%`;
  }
}

function getParams() {
  return {
    id: state.jobId,
    frameKey: state.frameKey,
    keyColor: els.keyColor.value,
    similarity: Number(els.similarity.value),
    blend: Number(els.blend.value),
    despillMix: Number(els.despillMix.value),
    despillExpand: Number(els.despillExpand.value),
    crf: Number(els.crf.value)
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || t("requestFailed"));
  }
  return data;
}

function updateOutputLabels() {
  for (const [inputId, outputId] of controls) {
    const input = document.querySelector(`#${inputId}`);
    const output = document.querySelector(`#${outputId}`);
    output.textContent = formatControlValue(input);
  }
}

function formatControlValue(input) {
  if (input.id === "crf") {
    return String(Math.round(Number(input.value)));
  }
  return Number(input.value).toFixed(3);
}

function setActivePreviewFrame(frameKey, { preview = true } = {}) {
  state.frameKey = frameKey;
  document.querySelectorAll(".frame-option").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.frame === frameKey);
  });

  if (state.frameUrls[frameKey]) {
    setImage(els.originalFrame, state.frameUrls[frameKey]);
  }

  if (preview && state.jobId) {
    debouncePreview();
  }
}

function stepInput(input, direction) {
  const step = Number(input.step || 1);
  const min = Number(input.min);
  const max = Number(input.max);
  const current = Number(input.value);
  const decimals = Math.max(
    0,
    (input.step.split(".")[1] || "").length,
    (input.min.split(".")[1] || "").length
  );
  const next = Math.min(max, Math.max(min, current + step * direction));
  input.value = next.toFixed(decimals);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function debouncePreview() {
  if (!state.jobId) return;
  window.clearTimeout(state.previewTimer);
  state.previewTimer = window.setTimeout(() => {
    generatePreview().catch((error) => {
      setStatus(error.message);
    });
  }, 260);
}

async function generatePreview() {
  if (!state.jobId) return;
  setStatus("generatingPreview");
  els.previewButton.disabled = true;
  const data = await postJson("/api/preview", getParams());
  setImage(els.previewFrame, data.previewUrl);
  els.filterText.textContent = data.filter;
  els.previewButton.disabled = false;
  els.exportButton.disabled = false;
  setStatus("previewReady", 0);
}

async function uploadVideo(file) {
  const form = new FormData();
  form.append("video", file);
  setStatus("uploadingVideo");
  els.previewButton.disabled = true;
  els.exportButton.disabled = true;
  els.downloadLink.hidden = true;
  state.downloadSize = null;

  const response = await fetch("/api/upload", {
    method: "POST",
    body: form
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || t("uploadFailed"));
  }

  state.jobId = data.id;
  state.frameUrls = data.frameUrls || (data.firstFrameUrl ? { first: data.firstFrameUrl } : {});
  state.frameKey = "first";
  setActivePreviewFrame("first", { preview: false });
  els.videoMeta.textContent = `${data.originalName} · ${data.width}×${data.height} · ${data.duration.toFixed(2)}s`;
  els.previewButton.disabled = false;
  setStatus("videoLoaded", 0);
  await generatePreview();
}

async function exportVideo() {
  if (!state.jobId) return;
  els.exportButton.disabled = true;
  els.previewButton.disabled = true;
  els.downloadLink.hidden = true;
  state.downloadSize = null;
  setStatus("exporting", 0);
  await postJson("/api/export", getParams());
  pollJob();
}

async function pollJob() {
  window.clearTimeout(state.pollingTimer);
  const response = await fetch(`/api/job/${state.jobId}`);
  const data = await response.json();
  if (!response.ok) {
    setStatus(data.error || "exportFailed");
    return;
  }

  if (data.status === "exporting") {
    setStatus("exporting", data.progress || 0);
    state.pollingTimer = window.setTimeout(pollJob, 700);
    return;
  }

  if (data.status === "done") {
    setStatus("exportComplete", 100);
    els.downloadLink.href = data.outputUrl;
    els.downloadLink.hidden = false;
    state.downloadSize = data.outputSize;
    els.downloadLink.textContent = t("downloadWithSize", { size: formatBytes(data.outputSize) });
    els.exportButton.disabled = false;
    els.previewButton.disabled = false;
    return;
  }

  if (data.status === "error") {
    setStatus(data.error || "exportFailed");
    els.exportButton.disabled = false;
    els.previewButton.disabled = false;
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

els.videoInput.addEventListener("change", () => {
  const file = els.videoInput.files?.[0];
  if (!file) return;
  uploadVideo(file).catch((error) => {
    setStatus(error.message);
  });
});

els.previewButton.addEventListener("click", () => {
  generatePreview().catch((error) => setStatus(error.message));
});

els.exportButton.addEventListener("click", () => {
  exportVideo().catch((error) => {
    setStatus(error.message);
    els.exportButton.disabled = false;
    els.previewButton.disabled = false;
  });
});

document.querySelectorAll(".bg-option").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".bg-option").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    els.previewBackground.className = `frame-wrap has-image ${button.dataset.bg}`;
  });
});

document.querySelectorAll(".frame-option").forEach((button) => {
  button.addEventListener("click", () => {
    setActivePreviewFrame(button.dataset.frame);
  });
});

[els.keyColor, els.similarity, els.blend, els.despillMix, els.despillExpand].forEach((input) => {
  input.addEventListener("input", () => {
    updateOutputLabels();
    debouncePreview();
  });
});

els.crf.addEventListener("input", updateOutputLabels);

document.querySelectorAll(".step-button").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.querySelector(`#${button.dataset.target}`);
    stepInput(input, Number(button.dataset.step));
  });
});

els.langZh.addEventListener("click", () => setLanguage("zh"));
els.langEn.addEventListener("click", () => setLanguage("en"));

updateOutputLabels();
setLanguage("zh");
