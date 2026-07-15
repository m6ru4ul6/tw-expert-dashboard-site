const state = {
  summary: null,
  runs: [],
  claims: [],
  market: [],
  scoreboard: [],
  selectedHistoryAuthors: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const isLocalHttp = ["http:", "https:"].includes(location.protocol) && localHosts.has(location.hostname);
const prefersStaticData =
  Boolean(window.DASHBOARD_STATIC_DATA_URL) ||
  (["http:", "https:"].includes(location.protocol) && !isLocalHttp);

function appBasePath() {
  const parts = location.pathname.split("/").filter(Boolean);
  const routeIndex = parts.findIndex((part) => part === "runs" || part === "run");
  if (routeIndex >= 0) {
    const baseParts = parts.slice(0, routeIndex);
    return baseParts.length ? `/${baseParts.join("/")}` : "";
  }
  const lastPart = parts[parts.length - 1] || "";
  if (lastPart.includes(".")) parts.pop();
  return parts.length ? `/${parts.join("/")}` : "";
}

function withAppBase(route) {
  return `${appBasePath()}${route}`;
}

const apiOrigins = (() => {
  if (prefersStaticData) return [];
  if (location.protocol !== "file:") return [""];
  const params = new URLSearchParams(location.search);
  const configured = params.get("api");
  return [configured, "http://127.0.0.1:8765", "http://127.0.0.1:8766"].filter(Boolean);
})();
const staticDataCandidates = (() => {
  const configured = window.DASHBOARD_STATIC_DATA_URL;
  const candidates = configured ? [configured] : [];
  if (["http:", "https:"].includes(location.protocol)) {
    candidates.push(`${location.origin}${withAppBase("/data/dashboard-static.json")}`);
    candidates.push(`${location.origin}/data/dashboard-static.json`);
  }
  candidates.push("data/dashboard-static.json", "../data/dashboard-static.json");
  return [...new Set(candidates)];
})();

let staticBundlePromise = null;

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function renderThemeToggle() {
  const theme = currentTheme();
  const button = $("[data-theme-toggle]");
  const label = $("[data-theme-label]");
  const icon = $("[data-theme-icon]");
  if (label) label.textContent = theme === "dark" ? "淺色" : "暗黑";
  if (icon) icon.textContent = theme === "dark" ? "☼" : "◐";
  if (button) button.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
}

function bindThemeToggle() {
  const button = $("[data-theme-toggle]");
  if (!button) return;
  button.addEventListener("click", () => {
    const nextTheme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    try {
      localStorage.setItem("twExpertTheme", nextTheme);
    } catch (error) {}
    renderThemeToggle();
  });
  renderThemeToggle();
}

async function api(path) {
  let lastError;
  if (prefersStaticData) {
    return staticApi(path);
  }
  for (const origin of apiOrigins) {
    try {
      const response = await fetch(`${origin}${path}`);
      if (response.ok) return response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
  }
  try {
    return await staticApi(path);
  } catch (error) {
    lastError = error || lastError;
  }
  throw lastError || new Error("API unavailable");
}

async function loadStaticBundle() {
  if (!staticBundlePromise) {
    staticBundlePromise = (async () => {
      let lastError;
      for (const candidate of staticDataCandidates) {
        try {
          const response = await fetch(candidate, { cache: "no-store" });
          if (response.ok) return response.json();
          lastError = new Error(`${candidate}: ${response.status} ${response.statusText}`);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("Static dashboard data unavailable");
    })();
  }
  return staticBundlePromise;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function apiUrl(path) {
  return new URL(path, location.href);
}

function paramList(params, key) {
  return params
    .getAll(key)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

async function staticApi(path) {
  const bundle = await loadStaticBundle();
  const url = apiUrl(path);
  const params = url.searchParams;
  const pathname = url.pathname;
  if (pathname === "/api/summary/today") return cloneData(bundle.summary || {});
  if (pathname === "/api/runs") return { items: filterStaticRuns(bundle, params) };
  if (pathname.startsWith("/api/runs/")) {
    const runId = decodeRouteValue(pathname.replace("/api/runs/", ""));
    const detail = bundle.run_details?.[runId];
    if (!detail) throw new Error(`找不到紀錄：${runId}`);
    return cloneData(detail);
  }
  if (pathname === "/api/claims") return { items: filterStaticClaims(bundle.claims?.items || [], params) };
  if (pathname === "/api/authors/scoreboard") return cloneData(bundle.scoreboard || { items: [] });
  if (pathname === "/api/market-screens") {
    return { items: filterStaticMarket(bundle.market_screens?.items || [], params) };
  }
  if (pathname === "/api/search") return staticSearch(bundle, params.get("q") || "");
  throw new Error(`Unknown static endpoint: ${pathname}`);
}

function filterStaticRuns(bundle, params) {
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const mode = params.get("mode") || "";
  const authors = paramList(params, "author");
  const rows = bundle.runs?.items || [];
  return rows
    .filter((row) => {
      const runDate = String(row.run_date || "");
      if (from && runDate < from) return false;
      if (to && runDate > to) return false;
      if (mode && row.mode !== mode) return false;
      if (authors.length) {
        const runAuthors = bundle.run_authors?.[row.run_id] || [];
        if (!authors.some((author) => runAuthors.includes(author))) return false;
      }
      return true;
    })
    .slice(0, 200);
}

function filterStaticClaims(rows, params) {
  const author = params.get("author") || "";
  const ticker = params.get("ticker") || "";
  const status = params.get("status") || "";
  const result = params.get("result") || "";
  const due = params.get("due") || "";
  const runId = params.get("run_id") || "";
  const date = params.get("date") || "";
  return rows
    .filter((row) => {
      if (author && row.analyst !== author) return false;
      if (ticker && !String(row.targets_text || "").includes(ticker)) return false;
      if (status && !String(row.status || "").startsWith(status)) return false;
      if (result && row.evaluation_result !== result) return false;
      if (due && String(row.evaluation_due_date || "") > due) return false;
      if (runId && row.run_id !== runId) return false;
      if (date && String(row.created_at || "").slice(0, 10) !== date) return false;
      return true;
    })
    .slice(0, 500);
}

function filterStaticMarket(rows, params) {
  const runId = params.get("run_id") || "";
  const ticker = params.get("ticker") || "";
  const category = params.get("category") || "";
  return rows
    .filter((row) => {
      if (runId && row.run_id !== runId) return false;
      if (ticker && row.code !== ticker) return false;
      if (category && row.category !== category) return false;
      return true;
    })
    .slice(0, 500);
}

function staticSearch(bundle, rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return { claims: [], videos: [], runs: [] };
  const includesQuery = (...values) =>
    values.some((value) => String(value || "").toLowerCase().includes(query));
  const claims = (bundle.claims?.items || [])
    .filter((row) => includesQuery(row.statement, row.source_quote, row.targets_text))
    .slice(0, 20);
  const videos = (bundle.search_index?.videos || [])
    .filter((row) => includesQuery(row.title, row.channel_name, row.analyst))
    .slice(0, 20);
  const runs = (bundle.search_index?.runs || [])
    .filter((row) => {
      const detail = bundle.run_details?.[row.run_id] || {};
      const sectionText = Object.values(detail.sections || {}).join("\n");
      return includesQuery(row.adoption_status, sectionText, detail.run?.full_result, detail.run?.slack_message);
    })
    .slice(0, 20);
  return { claims, videos, runs };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function linkify(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/(https?:\/\/[^\s<>]+)/g, (url) => {
    const clean = url.replace(/[).,，。]+$/, "");
    const tail = url.slice(clean.length);
    return `<a href="${clean}" target="_blank" rel="noreferrer">${clean}</a>${tail}`;
  });
}

function percent(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `${Number(value).toFixed(1)}%`;
}

function rate(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function shortDate(value) {
  return value ? String(value).slice(0, 10) : "-";
}

function parseLocalDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonthsClamped(date, amount) {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + amount);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

function compactDateTime(value) {
  if (!value) return "-";
  return String(value).replace("T", " ").replace("+08:00", "");
}

function badgeClass(value) {
  const text = String(value || "");
  if (text.includes("開倉") || text === "success") return "good";
  if (text.includes("回檔") || text.includes("不追") || text === "partial") return "warn";
  if (text.includes("避開") || text === "miss") return "risk";
  if (text.includes("僅") || text.includes("缺") || text.includes("history")) return "warn";
  return "info";
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

function renderTextBlock(selector, text) {
  const target = $(selector);
  target.innerHTML = linkify(text || "尚無資料");
}

function adoptionCompact(status) {
  const match = String(status || "").match(/(\d+\s*\/\s*\d+)/);
  return match ? match[1].replace(/\s+/g, "") : status || "-";
}

function modeLabel(value) {
  if (value === "formal") return "正式";
  if (value === "test") return "測試";
  if (value === "history") return "歷史補錄";
  return value || "-";
}

function decodeRouteValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function initialRunIdFromLocation() {
  const params = new URLSearchParams(location.search);
  const queryRunId = params.get("run_id") || params.get("run");
  if (queryRunId) return queryRunId;
  const match = location.pathname.match(/\/runs?\/([^/?#]+)/);
  return match ? decodeRouteValue(match[1]) : "";
}

function reportUrl(runId) {
  const url = new URL(location.href);
  if (location.protocol === "file:") {
    url.searchParams.set("run_id", runId);
    return url.toString();
  }
  url.pathname = withAppBase(`/runs/${encodeURIComponent(runId)}`);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function updateLocationForRun(runId) {
  if (location.protocol === "file:" || !window.history?.pushState) return;
  const nextPath = withAppBase(`/runs/${encodeURIComponent(runId)}`);
  if (location.pathname !== nextPath) {
    window.history.pushState({ runId }, "", nextPath);
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function renderResearchBlock(selector, text) {
  const target = $(selector);
  const chunks = String(text || "")
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (!chunks.length) {
    target.innerHTML = '<div class="subtle">尚無資料</div>';
    return;
  }
  target.innerHTML = `<div class="research-stack">${chunks.map(renderResearchChunk).join("")}</div>`;
}

function renderResearchChunk(chunk) {
  const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
  const heading = lines[0] || "";
  const match = heading.match(/^(\d+)\.\s*(.+)$/);
  if (!match) {
    return `<section class="research-card">${lines.map(renderResearchLine).join("")}</section>`;
  }
  return `
    <section class="research-card">
      <h3><span>${escapeHtml(match[1])}</span>${linkify(match[2])}</h3>
      ${lines.slice(1).map(renderResearchLine).join("")}
    </section>
  `;
}

function renderResearchLine(line) {
  const clean = line.replace(/^- /, "");
  const separator = clean.indexOf("：");
  const className = line.startsWith("- ") ? "research-line bullet" : "research-line";
  if (separator > 0 && separator <= 12) {
    const label = clean.slice(0, separator);
    const body = clean.slice(separator + 1);
    return `<p class="${className}"><strong>${escapeHtml(label)}：</strong>${linkify(body)}</p>`;
  }
  return `<p class="${className}">${linkify(clean)}</p>`;
}

function renderDetailSection(title, content) {
  return `
    <section class="detail-section">
      <div class="detail-section-head">${escapeHtml(title)}</div>
      ${content ? `<div class="text-block">${renderResearchBlockHtml(content)}</div>` : '<div class="text-block subtle">尚無資料</div>'}
    </section>
  `;
}

function renderResearchBlockHtml(text) {
  const chunks = String(text || "")
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (!chunks.length) {
    return '<div class="subtle">尚無資料</div>';
  }
  return `<div class="research-stack">${chunks.map(renderResearchChunk).join("")}</div>`;
}

function renderDetailClaims(rows) {
  if (!rows?.length) return '<div class="subtle">這一天沒有已錄入的觀點追蹤</div>';
  return `
    <div class="claim-list embedded-list">
      ${rows
        .map((row) => {
          const outcome = row.evaluation_result || row.status || "-";
          return `
            <article class="claim">
              <div class="title-line">
                ${escapeHtml(row.analyst || "-")}
                <span class="badge ${badgeClass(outcome)}">${escapeHtml(outcome)}</span>
                <span class="badge info">${escapeHtml(row.confidence_level || "-")}</span>
              </div>
              <div>${escapeHtml(row.statement || "")}</div>
              <div class="meta-line">${escapeHtml(row.targets_text || "")} · ${escapeHtml(row.direction || "-")} · 到期 ${escapeHtml(row.evaluation_due_date || "-")}</div>
              ${row.notes ? `<div class="meta-line">評語：${escapeHtml(row.notes)}</div>` : ""}
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderDetailVideos(rows) {
  if (!rows?.length) return '<div class="subtle">這一天沒有已錄入的影片/逐字稿</div>';
  return `
    <div class="video-grid embedded-list">
      ${rows
        .map((row) => {
          return `
            <article class="video">
              <div class="title-line">${escapeHtml(row.analyst || row.channel_name || "-")}</div>
              <a href="${escapeHtml(row.webpage_url)}" target="_blank" rel="noreferrer">${escapeHtml(row.title || row.video_id)}</a>
              <div class="meta-line">${compactDateTime(row.published_at)} · ${escapeHtml(row.status || "-")} · ${escapeHtml(row.transcript_confidence || "-")}</div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderDetailHtmlSection(title, html) {
  return `
    <section class="detail-section">
      <div class="detail-section-head">${escapeHtml(title)}</div>
      <div class="text-block">${html}</div>
    </section>
  `;
}

function renderSummary() {
  const data = state.summary;
  const run = data.run || {};
  $("#runMeta").innerHTML = run.run_id
    ? `最新紀錄 ${escapeHtml(run.run_date)}<br>${escapeHtml(run.adoption_status || "")}`
    : "尚無紀錄";

  const claimCount = data.claims?.length || 0;
  const openCount = data.open_claims?.length || 0;
  const watchCount = (data.market_screens || []).filter((row) =>
    String(row.research_timing || "").includes("觀察"),
  ).length;
  const topAuthor = [...(data.scoreboard || [])].sort((a, b) => {
    return Number(b.hit_rate || 0) - Number(a.hit_rate || 0);
  })[0];

  $("#summaryMetrics").innerHTML = [
    metric("最新日期", run.run_date || "-", run.mode === "formal" ? "正式模式" : "測試模式", "info"),
    metric("逐字稿採納", adoptionCompact(run.adoption_status), run.adoption_status || "-", "good"),
    metric("本輪觀點", `${claimCount} 條`, "本輪新增與最新 run 相關", "info"),
    metric("觀察標的", `${watchCount} 檔`, "使用確認條件，不是買賣指令", "warn"),
    metric("待驗證", `${openCount} 條`, "尚未到期或等待觸發", "warn"),
    metric("最高命中率", topAuthor ? rate(topAuthor.hit_rate) : "-", topAuthor?.analyst || "-", "good"),
    metric("快篩資料", `${data.market_screens?.length || 0} 筆`, "含確認與失效條件", "info"),
    metric("資料模式", run.mode === "test" ? "測試" : run.mode === "formal" ? "正式" : "-", run.archive_kind || "-", ""),
  ].join("");

  renderResearchBlock("#consensusBlock", data.sections?.["共識"]);
  renderResearchBlock("#divergenceBlock", data.sections?.["分歧"]);
  renderWatchlist(data.market_screens || []);
  renderOpenClaims(data.open_claims || []);
  renderVideos(data.videos || []);
}

function setDefaultHistoryDates() {
  const latestRunDate = state.summary?.run?.run_date;
  const endDate = parseLocalDate(latestRunDate) || new Date();
  const startDate = addMonthsClamped(endDate, -1);
  if (!$("#historyFrom").value) {
    $("#historyFrom").value = formatInputDate(startDate);
  }
  if (!$("#historyTo").value) {
    $("#historyTo").value = formatInputDate(endDate);
  }
}

function historyAuthorOptions() {
  const seen = new Set();
  return (state.scoreboard || [])
    .map((row) => String(row.analyst || "").trim())
    .filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

function selectedHistoryAuthorList() {
  const options = historyAuthorOptions();
  const order = new Map(options.map((name, index) => [name, index]));
  return Array.from(state.selectedHistoryAuthors).sort((a, b) => {
    return (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b, "zh-Hant");
  });
}

function updateHistoryAuthorLabel() {
  const selected = selectedHistoryAuthorList();
  const label = $("#historyAuthorLabel");
  const toggle = $("#historyAuthorToggle");
  if (!label || !toggle) return;
  if (!selected.length) {
    label.textContent = "全部作者";
  } else if (selected.length <= 2) {
    label.textContent = selected.join("、");
  } else {
    label.textContent = `已選 ${selected.length} 位作者`;
  }
  toggle.classList.toggle("has-selection", selected.length > 0);
}

function renderHistoryAuthorOptions() {
  const target = $("#historyAuthorOptions");
  if (!target) return;
  const options = historyAuthorOptions();
  const validOptions = new Set(options);
  state.selectedHistoryAuthors = new Set(
    Array.from(state.selectedHistoryAuthors).filter((name) => validOptions.has(name)),
  );
  if (!options.length) {
    target.innerHTML = '<div class="multi-select-empty">尚無作者資料</div>';
    updateHistoryAuthorLabel();
    return;
  }
  target.innerHTML = options
    .map((name) => {
      const checked = state.selectedHistoryAuthors.has(name) ? " checked" : "";
      return `
        <label class="multi-option">
          <input type="checkbox" value="${escapeHtml(name)}"${checked} />
          <span>${escapeHtml(name)}</span>
        </label>
      `;
    })
    .join("");
  updateHistoryAuthorLabel();
}

function setHistoryAuthorMenuOpen(open) {
  const picker = $("#historyAuthorPicker");
  const menu = $("#historyAuthorMenu");
  const toggle = $("#historyAuthorToggle");
  if (!picker || !menu || !toggle) return;
  menu.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  picker.classList.toggle("open", open);
  picker.closest(".panel")?.classList.toggle("has-open-menu", open);
}

function metric(label, value, hint = "", tone = "") {
  return `
    <div class="metric ${escapeHtml(tone)}">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      ${hint ? `<div class="metric-hint">${escapeHtml(hint)}</div>` : ""}
    </div>
  `;
}

function renderWatchlist(rows) {
  const preferred = rows
    .filter((row) => String(row.research_timing || "").includes("觀察"))
    .slice(0, 12);
  const fallback = rows.slice(0, 12);
  $("#watchlistRows").innerHTML = (preferred.length ? preferred : fallback)
    .map((row) => {
      return `
        <tr>
          <td>${escapeHtml(row.code)}</td>
          <td>${escapeHtml(row.name)}</td>
          <td><span class="badge ${badgeClass(row.research_timing)}">${escapeHtml(row.research_timing || "-")}</span></td>
          <td>${escapeHtml(row.category || "-")}</td>
          <td>${escapeHtml(row.reason || "-")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderOpenClaims(rows) {
  $("#openClaimsList").innerHTML = rows.length
    ? rows
        .map((row) => {
          return `
            <div class="item">
              <div class="title-line">
                ${escapeHtml(row.analyst)}
                <span class="badge ${badgeClass(row.confidence_level)}">${escapeHtml(row.confidence_level || "-")}</span>
              </div>
              <div>${escapeHtml(row.statement)}</div>
              <div class="meta-line">${escapeHtml(row.targets_text || "")} · 到期 ${escapeHtml(row.evaluation_due_date || "-")}</div>
            </div>
          `;
        })
        .join("")
    : '<div class="subtle">尚無待驗證觀點</div>';
}

function renderVideos(rows) {
  $("#videoList").innerHTML = rows.length
    ? rows
        .map((row) => {
          return `
            <article class="video">
              <div class="title-line">${escapeHtml(row.analyst || row.channel_name || "-")}</div>
              <a href="${escapeHtml(row.webpage_url)}" target="_blank" rel="noreferrer">${escapeHtml(row.title || row.video_id)}</a>
              <div class="meta-line">${compactDateTime(row.published_at)} · ${escapeHtml(row.status || "-")} · ${escapeHtml(row.transcript_confidence || "-")}</div>
            </article>
          `;
        })
        .join("")
    : '<div class="subtle">尚無影片資料</div>';
}

async function loadHistory() {
  const params = new URLSearchParams();
  if ($("#historyFrom").value) params.set("from", $("#historyFrom").value);
  if ($("#historyTo").value) params.set("to", $("#historyTo").value);
  if ($("#historyMode").value) params.set("mode", $("#historyMode").value);
  selectedHistoryAuthorList().forEach((author) => params.append("author", author));
  const data = await api(`/api/runs?${params.toString()}`);
  state.runs = data.items || [];
  $("#historyRows").innerHTML = state.runs
    .map((row) => {
      return `
        <tr>
          <td>${escapeHtml(row.run_date || "-")}</td>
          <td><span class="badge ${badgeClass(row.data_status)}">${escapeHtml(row.data_status || "-")}</span></td>
          <td>${escapeHtml(modeLabel(row.mode))}</td>
          <td>${escapeHtml(row.claim_count ?? 0)}</td>
          <td>${escapeHtml(row.video_count ?? 0)}</td>
          <td>${escapeHtml(row.market_screen_count ?? 0)}</td>
          <td><button class="button small" data-run="${escapeHtml(row.run_id)}">檢視</button></td>
        </tr>
      `;
    })
    .join("");
}

async function loadRunDetail(runId, options = {}) {
  const detail = await api(`/api/runs/${encodeURIComponent(runId)}`);
  const run = detail.run || {};
  if (options.updateUrl !== false) updateLocationForRun(runId);
  const url = reportUrl(runId);
  const hasSections = ["共識", "分歧", "追蹤"].some((section) => detail.sections?.[section]);
  const explanation =
    run.record_type === "history_date"
      ? "這一天沒有完整 daily run 檔案，因此無法還原當日共識/分歧摘要；下方保留已錄入的觀點追蹤與影片/逐字稿。"
      : "";
  $("#runDetail").classList.remove("subtle");
  $("#runDetail").innerHTML = `
    <div class="detail-summary">
      <div>
        <span class="detail-label">日期</span>
        <strong>${escapeHtml(run.run_date || "-")}</strong>
      </div>
      <div>
        <span class="detail-label">資料狀態</span>
        <strong>${escapeHtml(run.data_status || "完整日報")}</strong>
      </div>
      <div>
        <span class="detail-label">採納狀態</span>
        <strong>${escapeHtml(run.adoption_status || "-")}</strong>
      </div>
      <div>
        <span class="detail-label">資料量</span>
        <strong>${escapeHtml(run.claim_count ?? detail.claims?.length ?? 0)} 觀點 / ${escapeHtml(run.video_count ?? detail.videos?.length ?? 0)} 影片</strong>
      </div>
      <div>
        <span class="detail-label">單日連結</span>
        <div class="detail-actions">
          <a class="button small secondary" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">開啟</a>
          <button class="button small" type="button" data-copy-run-link="${escapeHtml(url)}">複製</button>
        </div>
      </div>
    </div>
    ${explanation ? renderDetailSection("資料說明", explanation) : ""}
    ${hasSections ? renderDetailSection("共識", detail.sections?.["共識"] || "") : ""}
    ${hasSections ? renderDetailSection("分歧", detail.sections?.["分歧"] || "") : ""}
    ${hasSections ? renderDetailSection("追蹤", detail.sections?.["追蹤"] || "") : ""}
    ${renderDetailHtmlSection("當日觀點", renderDetailClaims(detail.claims || []))}
    ${renderDetailHtmlSection("當日影片", renderDetailVideos(detail.videos || []))}
  `;
}

async function loadClaims() {
  const params = new URLSearchParams();
  if ($("#claimAuthor").value) params.set("author", $("#claimAuthor").value);
  if ($("#claimTicker").value) params.set("ticker", $("#claimTicker").value);
  if ($("#claimStatus").value) params.set("status", $("#claimStatus").value);
  if ($("#claimResult").value) params.set("result", $("#claimResult").value);
  const data = await api(`/api/claims?${params.toString()}`);
  state.claims = data.items || [];
  $("#claimList").innerHTML = state.claims
    .map((row) => {
      const outcome = row.evaluation_result || row.status || "-";
      return `
        <article class="claim">
          <div class="title-line">
            ${escapeHtml(row.analyst || "-")}
            <span class="badge ${badgeClass(outcome)}">${escapeHtml(outcome)}</span>
            <span class="badge info">${escapeHtml(row.confidence_level || "-")}</span>
          </div>
          <div>${escapeHtml(row.statement || "")}</div>
          <div class="meta-line">${escapeHtml(row.targets_text || "")} · ${escapeHtml(row.direction || "-")} · 到期 ${escapeHtml(row.evaluation_due_date || "-")}</div>
          ${row.notes ? `<div class="meta-line">評語：${escapeHtml(row.notes)}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

async function loadMarket() {
  const runId = state.summary?.run?.run_id || "";
  const params = new URLSearchParams();
  if (runId) params.set("run_id", runId);
  if ($("#marketTicker").value) params.set("ticker", $("#marketTicker").value);
  if ($("#marketCategory").value) params.set("category", $("#marketCategory").value);
  const data = await api(`/api/market-screens?${params.toString()}`);
  state.market = data.items || [];
  $("#marketRows").innerHTML = state.market
    .map((row) => {
      const confirm = (row.confirm_conditions || []).join("；") || "-";
      const invalid = (row.invalid_conditions || []).join("；") || "-";
      return `
        <tr>
          <td>${escapeHtml(row.code)}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.close ?? "-")}</td>
          <td>${percent(row.ret5_pct)}</td>
          <td>${percent(row.ret20_pct)}</td>
          <td>${percent(row.dist20_high_pct)}</td>
          <td><span class="badge ${badgeClass(row.research_timing)}">${escapeHtml(row.research_timing || "-")}</span></td>
          <td>確認：${escapeHtml(confirm)}<br>失效：${escapeHtml(invalid)}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadAuthors() {
  const data = await api("/api/authors/scoreboard");
  state.scoreboard = data.items || [];
  renderHistoryAuthorOptions();
  $("#authorRows").innerHTML = state.scoreboard
    .map((row) => {
      return `
        <tr>
          <td>${escapeHtml(row.analyst)}</td>
          <td>${escapeHtml(row.scored_sample_count ?? "-")}</td>
          <td>${rate(row.hit_rate)}</td>
          <td>${rate(row.near20_hit_rate)}</td>
          <td>${rate(row.high_confidence_hit_rate)}</td>
          <td>${percent(Number(row.average_return || 0) * 100)}</td>
          <td>${percent(Number(row.average_relative_return || 0) * 100)}</td>
          <td>${escapeHtml(row.open_claims ?? "-")}</td>
        </tr>
      `;
    })
    .join("");
}

function activateView(name) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === name));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
}

function bindEvents() {
  bindThemeToggle();
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateView(tab.dataset.view));
  });
  $("#historyApply").addEventListener("click", () => loadHistory().catch(handleError));
  $("#claimApply").addEventListener("click", () => loadClaims().catch(handleError));
  $("#marketApply").addEventListener("click", () => loadMarket().catch(handleError));
  $("#historyRows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-run]");
    if (button) {
      loadRunDetail(button.dataset.run).catch(handleError);
    }
  });
  $("#runDetail").addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-run-link]");
    if (!button) return;
    copyText(button.dataset.copyRunLink)
      .then(() => showToast("已複製單日連結"))
      .catch(handleError);
  });
  $("#historyAuthorToggle").addEventListener("click", () => {
    const menu = $("#historyAuthorMenu");
    setHistoryAuthorMenuOpen(Boolean(menu?.hidden));
  });
  $("#historyAuthorOptions").addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    if (checkbox.checked) {
      state.selectedHistoryAuthors.add(checkbox.value);
    } else {
      state.selectedHistoryAuthors.delete(checkbox.value);
    }
    updateHistoryAuthorLabel();
    loadHistory().catch(handleError);
  });
  $("#historyAuthorClear").addEventListener("click", () => {
    state.selectedHistoryAuthors.clear();
    renderHistoryAuthorOptions();
    loadHistory().catch(handleError);
  });
  $("#historyAuthorDone").addEventListener("click", () => setHistoryAuthorMenuOpen(false));
  document.addEventListener("click", (event) => {
    const picker = $("#historyAuthorPicker");
    if (picker && !picker.contains(event.target)) setHistoryAuthorMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setHistoryAuthorMenuOpen(false);
  });
}

function handleError(error) {
  console.error(error);
  showToast(error.message || "載入失敗");
}

async function init() {
  bindEvents();
  const initialRunId = initialRunIdFromLocation();
  state.summary = await api("/api/summary/today");
  renderSummary();
  setDefaultHistoryDates();
  await Promise.all([loadHistory(), loadClaims(), loadMarket(), loadAuthors()]);
  if (initialRunId) {
    activateView("history");
    await loadRunDetail(initialRunId, { updateUrl: false });
    $("#runDetailPanel")?.scrollIntoView({ block: "start" });
  }
}

init().catch(handleError);
