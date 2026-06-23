/* =====================================================================
   暗房水印 · DARKROOM.WM  —  app.js
   纯前端 / 零依赖 / 全部 Canvas 本地处理,图片绝不离开浏览器。

   渲染哲学:始终以"原图自然分辨率"绘制到 canvas,再用 CSS 缩放显示。
   => 预览所见 === 导出所得(真·所见即所得),且导出保持原始分辨率。
   ===================================================================== */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const LS_KEY = "darkroom.wm.config.v1";

  /* ---------------- 默认配置 ---------------- */
  const DEFAULTS = () => ({
    text: {
      enabled: true,
      content: "© 暗房 DARKROOM",
      fontFamily: "monospace",
      fontSize: 5,          // 占图宽百分比
      color: "#ede4d8",
      opacity: 70,          // %
      rotation: 0,          // 单点摆放时的旋转角(度)
      strokeEnabled: false,
      strokeColor: "#0b0a0a",
      strokeWidth: 8,        // 占字号百分比
    },
    logo: { enabled: false, dataUrl: null, scale: 20, opacity: 80 },
    position: { anchor: "br", free: false, x: null, y: null, margin: 4 },
    tile: { enabled: false, spacing: 18, angle: -30 },
    output: { format: "image/png", quality: 92 },
  });

  /* ---------------- 运行态 ---------------- */
  const state = DEFAULTS();
  const images = [];        // { id, name, img, url, width, height }
  let activeId = null;
  let logoImg = null;       // HTMLImageElement
  let dragging = false;

  const canvas = $("preview");
  const ctx = canvas.getContext("2d");

  /* =====================================================================
     水印度量 & 绘制
     ===================================================================== */
  function getMetrics(c, W) {
    const t = state.text;
    const fontPx = Math.max(1, (W * t.fontSize) / 100);
    const fontStr = `700 ${fontPx}px ${t.fontFamily}`;
    let lines = [], textW = 0, textH = 0;

    if (t.enabled && t.content.trim()) {
      c.font = fontStr;
      lines = t.content.split("\n");
      const lineH = fontPx * 1.25;
      textH = lineH * lines.length;
      for (const ln of lines) textW = Math.max(textW, c.measureText(ln).width);
    }

    let logoW = 0, logoH = 0;
    if (state.logo.enabled && logoImg && logoImg.complete && logoImg.naturalWidth) {
      logoW = (W * state.logo.scale) / 100;
      logoH = logoW * (logoImg.naturalHeight / logoImg.naturalWidth);
    }

    const gap = textH && logoH ? fontPx * 0.4 : 0;
    return {
      fontPx, fontStr, lines, textW, textH, logoW, logoH, gap,
      width: Math.max(textW, logoW),
      height: logoH + gap + textH,
    };
  }

  // 在当前坐标系下,以 (ox,oy) 为中心绘制一枚"水印戳"
  function paintStamp(c, m, ox, oy) {
    let y = oy - m.height / 2;

    if (m.logoH) {
      c.globalAlpha = state.logo.opacity / 100;
      c.drawImage(logoImg, ox - m.logoW / 2, y, m.logoW, m.logoH);
      y += m.logoH + m.gap;
    }

    if (m.textH) {
      const t = state.text;
      c.globalAlpha = t.opacity / 100;
      c.font = m.fontStr;
      c.textAlign = "center";
      c.textBaseline = "top";
      c.fillStyle = t.color;
      c.lineJoin = "round";
      c.miterLimit = 2;
      const lw = t.strokeEnabled ? m.fontPx * (t.strokeWidth / 100) : 0;
      if (lw > 0) { c.lineWidth = lw; c.strokeStyle = t.strokeColor; }
      let ty = y;
      for (const ln of m.lines) {
        if (lw > 0) c.strokeText(ln, ox, ty);
        c.fillText(ln, ox, ty);
        ty += m.fontPx * 1.25;
      }
    }
    c.globalAlpha = 1;
  }

  function anchorCenter(W, H, m) {
    const p = state.position;
    if (p.free && p.x != null) return { cx: p.x * W, cy: p.y * H };
    const margin = (Math.min(W, H) * p.margin) / 100;
    const hw = m.width / 2, hh = m.height / 2, a = p.anchor;
    let cx, cy;
    if (a.includes("l")) cx = margin + hw;
    else if (a.includes("r")) cx = W - margin - hw;
    else cx = W / 2;
    if (a.includes("t")) cy = margin + hh;
    else if (a.includes("b")) cy = H - margin - hh;
    else cy = H / 2;
    return { cx, cy };
  }

  function drawTiled(c, W, H, m) {
    const stepX = Math.max(m.width + (W * state.tile.spacing) / 100, 12);
    const stepY = Math.max(m.height + (W * state.tile.spacing) / 100, 12);
    c.save();
    c.translate(W / 2, H / 2);
    c.rotate((state.tile.angle * Math.PI) / 180);
    const diag = Math.sqrt(W * W + H * H);
    for (let yy = -diag; yy <= diag; yy += stepY)
      for (let xx = -diag; xx <= diag; xx += stepX) paintStamp(c, m, xx, yy);
    c.restore();
  }

  function drawWatermark(c, W, H) {
    const m = getMetrics(c, W);
    if (!m.width && !m.height) return;          // 没有任何可绘制内容
    if (state.tile.enabled) { drawTiled(c, W, H, m); return; }
    const { cx, cy } = anchorCenter(W, H, m);
    c.save();
    c.translate(cx, cy);
    c.rotate((state.text.rotation * Math.PI) / 180);
    paintStamp(c, m, 0, 0);
    c.restore();
  }

  // 把某张图整体(底图 + 水印)画到指定 canvas
  function compose(targetCanvas, item, forJpeg) {
    targetCanvas.width = item.width;
    targetCanvas.height = item.height;
    const c = targetCanvas.getContext("2d");
    c.clearRect(0, 0, item.width, item.height);
    if (forJpeg) { c.fillStyle = "#ffffff"; c.fillRect(0, 0, item.width, item.height); }
    c.drawImage(item.img, 0, 0, item.width, item.height);
    drawWatermark(c, item.width, item.height);
  }

  /* =====================================================================
     预览
     ===================================================================== */
  function activeItem() { return images.find((i) => i.id === activeId) || null; }

  function render() {
    const item = activeItem();
    if (!item) {
      canvas.style.display = "none";
      $("emptyState").style.display = "block";
      $("stageName").textContent = "// 暗房工作台 · NO FILM LOADED";
      $("stageDims").textContent = "";
      return;
    }
    $("emptyState").style.display = "none";
    canvas.style.display = "block";
    compose(canvas, item, false);
    canvas.classList.toggle("tiled", state.tile.enabled);
    $("stageName").textContent = "// " + item.name;
    $("stageDims").textContent = `${item.width} × ${item.height} px`;
  }

  /* =====================================================================
     文件载入
     ===================================================================== */
  function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    files.forEach((f) => {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        const item = { id: uid(), name: f.name, img, url, width: img.naturalWidth, height: img.naturalHeight };
        images.push(item);
        if (!activeId) activeId = item.id;
        renderThumbs();
        render();
        updateCounters();
      };
      img.onerror = () => { URL.revokeObjectURL(url); };
      img.src = url;
    });
  }

  function removeImage(id) {
    const idx = images.findIndex((i) => i.id === id);
    if (idx < 0) return;
    URL.revokeObjectURL(images[idx].url);
    images.splice(idx, 1);
    if (activeId === id) activeId = images.length ? images[Math.max(0, idx - 1)].id : null;
    renderThumbs();
    render();
    updateCounters();
  }

  function renderThumbs() {
    const wrap = $("thumbs");
    wrap.innerHTML = "";
    images.forEach((it, i) => {
      const d = document.createElement("div");
      d.className = "thumb" + (it.id === activeId ? " is-active" : "");
      d.title = it.name;
      d.innerHTML =
        `<span class="idx">${String(i + 1).padStart(2, "0")}</span>` +
        `<span class="kill" title="移除">✕</span>`;
      const im = document.createElement("img");
      im.src = it.url;
      d.appendChild(im);
      d.addEventListener("click", (e) => {
        if (e.target.classList.contains("kill")) { removeImage(it.id); return; }
        activeId = it.id; renderThumbs(); render();
      });
      wrap.appendChild(d);
    });
  }

  function updateCounters() {
    $("imgCount").textContent = `${images.length} 张已装片`;
  }

  /* =====================================================================
     Logo
     ===================================================================== */
  function loadLogoFromDataUrl(dataUrl) {
    if (!dataUrl) { logoImg = null; render(); return; }
    const im = new Image();
    im.onload = () => { logoImg = im; render(); };
    im.src = dataUrl;
  }

  function onLogoFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.logo.dataUrl = reader.result;
      state.logo.enabled = true;
      $("logoEnabled").checked = true;
      $("logoName").textContent = file.name;
      loadLogoFromDataUrl(reader.result);
      save();
    };
    reader.readAsDataURL(file);
  }

  /* =====================================================================
     导出
     ===================================================================== */
  const baseName = (n) => n.replace(/\.[^.]+$/, "");

  function exportItem(item) {
    return new Promise((resolve) => {
      const off = document.createElement("canvas");
      compose(off, item, state.output.format === "image/jpeg");
      off.toBlob(
        (blob) => resolve(blob),
        state.output.format,
        state.output.quality / 100
      );
    });
  }

  async function downloadItem(item) {
    const blob = await exportItem(item);
    if (!blob) return;
    const ext = state.output.format === "image/png" ? "png" : "jpg";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${baseName(item.name)}_wm.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function exportCurrent() {
    const item = activeItem();
    if (!item) { toast("没有可导出的图片"); return; }
    await downloadItem(item);
    toast("已冲洗:" + item.name);
  }

  async function exportAll() {
    if (!images.length) { toast("没有可导出的图片"); return; }
    toast(`批量冲洗 ${images.length} 张…`);
    for (const item of images) { await downloadItem(item); await sleep(400); }
    toast("批量冲洗完成 ✓");
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector(".flash-toast");
    if (!el) { el = document.createElement("div"); el.className = "flash-toast"; document.body.appendChild(el); }
    el.textContent = msg;
    el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2200);
  }

  /* =====================================================================
     localStorage 记忆
     ===================================================================== */
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        text: state.text, logo: state.logo,
        position: state.position, tile: state.tile, output: state.output,
      }));
    } catch (e) { /* 配额/隐私模式,忽略 */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      Object.assign(state.text, d.text || {});
      Object.assign(state.logo, d.logo || {});
      Object.assign(state.position, d.position || {});
      Object.assign(state.tile, d.tile || {});
      Object.assign(state.output, d.output || {});
      if (state.logo.dataUrl) loadLogoFromDataUrl(state.logo.dataUrl);
    } catch (e) { /* 损坏配置,忽略 */ }
  }

  /* =====================================================================
     UI 同步 (state -> 控件 / 控件 -> state)
     ===================================================================== */
  function syncUI() {
    const t = state.text;
    $("textEnabled").checked = t.enabled;
    $("textContent").value = t.content;
    $("fontFamily").value = t.fontFamily;
    $("fontSize").value = t.fontSize;
    $("textColor").value = t.color;
    $("textOpacity").value = t.opacity;
    $("rotation").value = t.rotation;
    $("strokeEnabled").checked = t.strokeEnabled;
    $("strokeColor").value = t.strokeColor;
    $("strokeWidth").value = t.strokeWidth;

    $("logoEnabled").checked = state.logo.enabled;
    $("logoScale").value = state.logo.scale;
    $("logoOpacity").value = state.logo.opacity;
    $("logoName").textContent = state.logo.dataUrl ? "Logo 已载入" : "未载入 Logo";

    $("margin").value = state.position.margin;
    $("tileEnabled").checked = state.tile.enabled;
    $("tileSpacing").value = state.tile.spacing;
    $("tileAngle").value = state.tile.angle;

    $("exportFormat").value = state.output.format;
    $("jpegQuality").value = state.output.quality;

    document.querySelectorAll("#grid9 button").forEach((b) =>
      b.classList.toggle("is-active", !state.position.free && b.dataset.anchor === state.position.anchor));

    syncLabels();
  }

  function syncLabels() {
    $("fontSizeVal").textContent = (+state.text.fontSize).toFixed(1) + "%";
    $("textOpacityVal").textContent = state.text.opacity + "%";
    $("rotationVal").textContent = state.text.rotation + "°";
    $("strokeWidthVal").textContent = state.text.strokeWidth + "%";
    $("logoScaleVal").textContent = state.logo.scale + "%";
    $("logoOpacityVal").textContent = state.logo.opacity + "%";
    $("marginVal").textContent = (+state.position.margin).toFixed(1).replace(/\.0$/, "") + "%";
    $("tileSpacingVal").textContent = state.tile.spacing + "%";
    $("tileAngleVal").textContent = state.tile.angle + "°";
    $("jpegQualityVal").textContent = state.output.quality;
  }

  // 通用绑定:控件变化 -> 更新 state -> 重绘 -> 记忆
  function bind(id, path, transform) {
    const el = $(id);
    const [grp, key] = path.split(".");
    const ev = (el.type === "checkbox" || el.tagName === "SELECT") ? "change" : "input";
    el.addEventListener(ev, () => {
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (transform) v = transform(v);
      state[grp][key] = v;
      syncLabels();
      render();
      save();
    });
  }

  /* =====================================================================
     拖拽定位 (预览图上)
     ===================================================================== */
  function pointerToNorm(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / r.width, 0, 1),
      y: clamp((e.clientY - r.top) / r.height, 0, 1),
    };
  }
  function placeAt(e) {
    if (state.tile.enabled || !activeItem()) return;
    const n = pointerToNorm(e);
    state.position.free = true;
    state.position.x = n.x;
    state.position.y = n.y;
    document.querySelectorAll("#grid9 button").forEach((b) => b.classList.remove("is-active"));
    render();
    save();
  }

  /* =====================================================================
     事件接线
     ===================================================================== */
  function wire() {
    // —— 上传 ——
    $("pickBtn").addEventListener("click", () => $("fileInput").click());
    $("fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });

    const dz = $("dropzone");
    ["dragenter", "dragover"].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); }));
    dz.addEventListener("drop", (e) => { if (e.dataTransfer?.files) addFiles(e.dataTransfer.files); });

    // 整页拖拽也可装片
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      if (e.target.closest(".dropzone")) return;
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    });

    // —— 文字 ——
    bind("textEnabled", "text.enabled");
    bind("textContent", "text.content");
    bind("fontFamily", "text.fontFamily");
    bind("fontSize", "text.fontSize", parseFloat);
    bind("textColor", "text.color");
    bind("textOpacity", "text.opacity", (v) => +v);
    bind("rotation", "text.rotation", (v) => +v);
    bind("strokeEnabled", "text.strokeEnabled");
    bind("strokeColor", "text.strokeColor");
    bind("strokeWidth", "text.strokeWidth", (v) => +v);

    // —— Logo ——
    bind("logoEnabled", "logo.enabled");
    bind("logoScale", "logo.scale", (v) => +v);
    bind("logoOpacity", "logo.opacity", (v) => +v);
    $("logoPickBtn").addEventListener("click", () => $("logoInput").click());
    $("logoInput").addEventListener("change", (e) => { onLogoFile(e.target.files[0]); e.target.value = ""; });
    $("logoClear").addEventListener("click", () => {
      state.logo.dataUrl = null; state.logo.enabled = false; logoImg = null;
      $("logoEnabled").checked = false; $("logoName").textContent = "未载入 Logo";
      render(); save();
    });

    // —— 定位 ——
    document.querySelectorAll("#grid9 button").forEach((b) =>
      b.addEventListener("click", () => {
        state.position.anchor = b.dataset.anchor;
        state.position.free = false;
        state.position.x = state.position.y = null;
        document.querySelectorAll("#grid9 button").forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
        render(); save();
      }));
    bind("margin", "position.margin", parseFloat);

    // —— 平铺 ——
    bind("tileEnabled", "tile.enabled");
    bind("tileSpacing", "tile.spacing", (v) => +v);
    bind("tileAngle", "tile.angle", (v) => +v);

    // —— 导出 ——
    bind("exportFormat", "output.format");
    bind("jpegQuality", "output.quality", (v) => +v);
    $("exportBtn").addEventListener("click", exportCurrent);
    $("exportAllBtn").addEventListener("click", exportAll);
    $("resetBtn").addEventListener("click", () => {
      Object.assign(state, DEFAULTS());
      logoImg = null;
      syncUI(); render(); save();
      toast("参数已重置");
    });

    // —— 预览拖拽 ——
    canvas.addEventListener("pointerdown", (e) => {
      if (state.tile.enabled || !activeItem()) return;
      dragging = true; canvas.classList.add("dragging");
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      placeAt(e);
    });
    canvas.addEventListener("pointermove", (e) => { if (dragging) placeAt(e); });
    const stopDrag = () => { dragging = false; canvas.classList.remove("dragging"); };
    canvas.addEventListener("pointerup", stopDrag);
    canvas.addEventListener("pointercancel", stopDrag);

    // —— 方向键微调 ——
    window.addEventListener("keydown", (e) => {
      if (!activeItem() || state.tile.enabled) return;
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      const step = e.shiftKey ? 0.02 : 0.005;
      const p = state.position;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (!map[e.key]) return;
      e.preventDefault();
      if (!p.free) { const a = anchorPercent(p.anchor); p.x = a.x; p.y = a.y; p.free = true; }
      p.x = clamp(p.x + map[e.key][0], 0, 1);
      p.y = clamp(p.y + map[e.key][1], 0, 1);
      document.querySelectorAll("#grid9 button").forEach((b) => b.classList.remove("is-active"));
      render(); save();
    });
  }

  // 由锚点估算归一化坐标(用于方向键起步)
  function anchorPercent(a) {
    const mg = state.position.margin / 100;
    let x = 0.5, y = 0.5;
    if (a.includes("l")) x = mg; else if (a.includes("r")) x = 1 - mg;
    if (a.includes("t")) y = mg; else if (a.includes("b")) y = 1 - mg;
    return { x, y };
  }

  /* =====================================================================
     启动
     ===================================================================== */
  function init() {
    load();
    syncUI();
    wire();
    render();
    updateCounters();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
