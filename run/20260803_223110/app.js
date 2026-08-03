const ACTIONS = Object.freeze([
  "買進",
  "加碼",
  "續抱",
  "減碼",
  "賣出",
  "停利",
  "停損",
  "觀望",
  "未給明確動作",
]);

const SCREEN_DIRECTIONS = Object.freeze([
  "偏多確認",
  "偏多未確認",
  "中性",
  "偏空確認",
  "資料不足",
]);

const SCREEN_ALIGNMENTS = Object.freeze([
  "支持",
  "部分支持",
  "尚未確認",
  "矛盾",
  "資料不足",
]);

const state = {
  summary: null,
  actions: [],
  excludedSystemActions: 0,
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
    } catch (error) {
      console.debug("Theme preference could not be saved", error);
    }
    renderThemeToggle();
  });
  renderThemeToggle();
}

async function api(path) {
  let lastError;
  if (prefersStaticData) return staticApi(path);
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
  if (pathname === "/api/claims") {
    return { items: filterStaticClaims(bundle.claims?.items || [], params) };
  }
  if (pathname === "/api/analyst-actions") {
    return {
      items: filterStaticAnalystActions(
        bundle.analyst_actions?.items || bundle.search_index?.analyst_actions || [],
        params,
      ),
    };
  }
  if (pathname === "/api/authors/scoreboard") {
    return cloneData(bundle.scoreboard || { items: [] });
  }
  if (pathname === "/api/market-screens") {
    return { items: filterStaticMarket(bundle.market_screens?.items || [], params) };
  }
  throw new Error(`Unknown static endpoint: ${pathname}`);
}

function filterStaticRuns(bundle, params) {
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const mode = params.get("mode") || "";
  const authors = paramList(params, "author");
  return (bundle.runs?.items || [])
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

function filterStaticAnalystActions(rows, params) {
  const runId = params.get("run_id") || "";
  const author = params.get("author") || "";
  const analyst = params.get("analyst") || "";
  const ticker = params.get("ticker") || "";
  const action = params.get("action") || "";
  const videoId = params.get("video_id") || "";
  const attribution = params.get("attribution") || "";
  const date = params.get("date") || "";
  return rows
    .filter((row) => {
      if (runId && String(row.run_id || "") !== runId) return false;
      if (author && String(row.analyst || "") !== author) return false;
      if (analyst && String(row.analyst || "") !== analyst) return false;
      if (ticker && String(row.ticker || "") !== ticker) return false;
      if (action && normalizeAction(row.normalized_action) !== normalizeAction(action)) return false;
      if (videoId && String(row.video_id || "") !== videoId) return false;
      if (attribution && String(row.attribution || "") !== attribution) return false;
      if (date && String(row.published_at || "").slice(0, 10) !== date) return false;
      return true;
    })
    .slice(0, 10000);
}

function filterStaticMarket(rows, params) {
  const runId = params.get("run_id") || "";
  const ticker = params.get("ticker") || "";
  return rows
    .filter((row) => {
      if (runId && row.run_id !== runId) return false;
      if (ticker && String(row.code || row.ticker || "") !== ticker) return false;
      return true;
    })
    .slice(0, 500);
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function firstPresent(row, keys, fallback = "") {
  for (const key of keys) {
    if (hasValue(row?.[key])) return row[key];
  }
  return fallback;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || !["[", "{"].includes(text[0])) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function asRows(value) {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) return parsed.filter((row) => row && typeof row === "object");
  if (!parsed || typeof parsed !== "object") return [];
  if (Array.isArray(parsed.items)) return parsed.items.filter((row) => row && typeof row === "object");
  const groups = Object.values(parsed).filter(Array.isArray);
  return groups.flat().filter((row) => row && typeof row === "object");
}

function asTextList(value) {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) {
    return parsed.flatMap(asTextList).map((item) => String(item).trim()).filter(Boolean);
  }
  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed)
      .map(([key, item]) => {
        if (!hasValue(item)) return "";
        return `${key}：${Array.isArray(item) ? item.join("、") : String(item)}`;
      })
      .filter(Boolean);
  }
  if (!hasValue(parsed)) return [];
  return String(parsed)
    .split(/\r?\n|；/)
    .map((item) => item.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
}

function asIdList(value) {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  if (!hasValue(parsed)) return [];
  return String(parsed)
    .split(/[,;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeHttpUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value), location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function linkify(value) {
  let source = String(value ?? "");
  const links = [];
  const tokenFor = (label, rawUrl) => {
    const cleanUrl = String(rawUrl).replace(/[),，。；;]+$/, "");
    const href = safeHttpUrl(cleanUrl);
    if (!href) return label || rawUrl;
    const token = `\u0000LINK${links.length}\u0000`;
    links.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label || cleanUrl)}</a>`);
    return token;
  };
  source = source.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => tokenFor(label, url));
  source = source.replace(/<?(https?:\/\/[^\s<>]+)>?/g, (_, url) => tokenFor(url, url));
  let escaped = escapeHtml(source);
  links.forEach((html, index) => {
    escaped = escaped.replace(`\u0000LINK${index}\u0000`, html);
  });
  return escaped;
}

function percent(value) {
  if (!hasValue(value) || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(1)}%`;
}

function rate(value) {
  if (!hasValue(value) || !Number.isFinite(Number(value))) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function compactDateTime(value) {
  if (!value) return "未提供";
  return String(value).replace("T", " ").replace(/\+08:00$/, "");
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

function modeLabel(value) {
  if (value === "formal") return "正式";
  if (value === "test") return "測試";
  if (value === "history") return "歷史補錄";
  return value || "未標示";
}

function adoptionCompact(status) {
  const match = String(status || "").match(/(\d+\s*\/\s*\d+)/);
  return match ? match[1].replace(/\s+/g, "") : status || "未標示";
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

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

function emptyState(title, detail = "") {
  return `
    <div class="empty-state">
      <span class="empty-mark" aria-hidden="true">—</span>
      <strong>${escapeHtml(title)}</strong>
      ${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
    </div>
  `;
}

function renderResearchBlock(selector, text, emptyTitle = "尚無資料") {
  const target = $(selector);
  if (!target) return;
  target.innerHTML = renderResearchBlockHtml(text, emptyTitle);
}

function renderResearchBlockHtml(text, emptyTitle = "尚無資料") {
  const chunks = String(text || "")
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (!chunks.length) return emptyState(emptyTitle);
  return `<div class="research-stack">${chunks.map(renderResearchChunk).join("")}</div>`;
}

function renderResearchChunk(chunk) {
  const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
  const heading = lines[0] || "";
  const numbered = heading.match(/^(\d+)\.\s*(.+)$/);
  const body = numbered ? lines.slice(1) : lines;
  return `
    <article class="research-card">
      ${
        numbered
          ? `<h3><span>${escapeHtml(numbered[1])}</span>${linkify(numbered[2])}</h3>`
          : ""
      }
      ${body.map(renderResearchLine).join("")}
    </article>
  `;
}

function renderResearchLine(line) {
  const bullet = /^[-•]\s*/.test(line);
  const clean = line.replace(/^[-•]\s*/, "");
  const separator = clean.indexOf("：");
  if (separator > 0 && separator <= 16) {
    return `<p class="research-line${bullet ? " bullet" : ""}"><strong>${escapeHtml(
      clean.slice(0, separator),
    )}：</strong>${linkify(clean.slice(separator + 1))}</p>`;
  }
  return `<p class="research-line${bullet ? " bullet" : ""}">${linkify(clean)}</p>`;
}

function sectionValue(source, name) {
  const sections = source?.sections || {};
  return firstPresent(sections, [name, `[${name}]`, name.replace("逐片摘要", "video_summaries")], "");
}

function normalizeAction(value) {
  const text = String(value || "").trim();
  if (!text || text === "無明確動作" || text === "無") return "未給明確動作";
  if (ACTIONS.includes(text)) return text;
  const candidates = [
    ["停損", ["停損", "止損"]],
    ["停利", ["停利", "獲利出場", "獲利了結"]],
    ["減碼", ["減碼", "減倉"]],
    ["賣出", ["賣出", "賣掉", "出清", "清倉", "先賣"]],
    ["買進", ["買進", "買入", "進場"]],
    ["加碼", ["加碼", "加倉"]],
    ["續抱", ["續抱", "持有"]],
    ["觀望", ["觀望", "等待"]],
  ];
  const matches = candidates
    .flatMap(([action, terms]) =>
      terms
        .map((term) => ({ action, index: text.indexOf(term) }))
        .filter((item) => item.index >= 0),
    )
    .sort((a, b) => a.index - b.index);
  return matches[0]?.action || "未給明確動作";
}

function sourceAttribution(row) {
  const attribution = String(firstPresent(row, ["attribution", "attribution_type"], "")).trim();
  const sourceType = String(firstPresent(row, ["source_type", "source_layer"], "")).trim();
  const combined = `${attribution} ${sourceType}`.toLowerCase();
  if (/system|screen|derived|inference|系統|快篩|推論/.test(combined)) {
    return { kind: "system", label: "系統推論" };
  }
  if (combined.includes("逐字稿明確用語")) {
    return { kind: "transcript-explicit", label: "逐字稿明確用語" };
  }
  if (combined.includes("逐字稿語意正規化")) {
    return { kind: "transcript-normalized", label: "逐字稿語意正規化" };
  }
  if (combined.includes("僅方向無動作")) {
    return { kind: "direction-only", label: "僅方向無動作" };
  }
  if (/direct_quote|\bdirect\b|verbatim|quote|直接引述|原話/.test(combined)) {
    return { kind: "direct", label: "直接引述" };
  }
  if (/faithful_paraphrase|paraphrase|faithful|忠實轉述|轉述/.test(combined)) {
    return { kind: "paraphrase", label: "忠實轉述" };
  }
  return { kind: "unknown", label: "來源未標示" };
}

function parseTimestampSeconds(value) {
  if (!hasValue(value)) return null;
  if (Number.isFinite(Number(value))) return Math.max(0, Math.floor(Number(value)));
  const parts = String(value).trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds)) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function buildTimestampUrl(videoUrl, seconds) {
  const safeVideoUrl = safeHttpUrl(videoUrl);
  if (!safeVideoUrl) return "";
  if (!Number.isFinite(seconds)) return safeVideoUrl;
  try {
    const url = new URL(safeVideoUrl);
    url.searchParams.set("t", `${seconds}s`);
    return url.toString();
  } catch {
    return safeVideoUrl;
  }
}

function normalizeAnalystAction(row, context = {}) {
  const canonicalAction = firstPresent(row, ["normalized_action", "action"], "");
  const actionText = String(
    firstPresent(row, ["action_text", "action_phrase", "recommendation_text"], canonicalAction),
  ).trim();
  const sourceQuote = String(
    firstPresent(row, ["source_quote", "quote", "original_quote", "original_text"], ""),
  ).trim();
  const timestampSeconds = parseTimestampSeconds(
    firstPresent(row, ["timestamp_seconds", "timestamp_sec", "seconds", "timestamp"], null),
  );
  const videoUrl = firstPresent(row, ["video_url", "webpage_url", "source_url", "url"], context.videoUrl || "");
  const timestampUrl =
    safeHttpUrl(firstPresent(row, ["timestamp_url", "clip_url", "source_link"], "")) ||
    buildTimestampUrl(videoUrl, timestampSeconds);
  const source = sourceAttribution(row);
  return {
    id: String(firstPresent(row, ["action_id", "analyst_action_id", "id"], "")).trim(),
    analyst: String(firstPresent(row, ["analyst", "teacher", "author"], context.analyst || "")).trim(),
    target: String(firstPresent(row, ["target", "target_name", "symbol_name", "name"], "")).trim(),
    ticker: String(firstPresent(row, ["ticker", "code", "symbol"], "")).trim(),
    stance: String(firstPresent(row, ["stance", "view", "analyst_stance"], context.stance || "")).trim(),
    action: normalizeAction(canonicalAction || actionText),
    actionText,
    sourceQuote,
    attribution: source,
    condition: String(
      firstPresent(row, ["condition_text", "conditions", "condition", "timing", "trigger_condition"], ""),
    ).trim(),
    positionContext: String(
      firstPresent(row, ["position_context", "holding_context", "position_scenario", "holding_scenario"], ""),
    ).trim(),
    timestampSeconds,
    timestampUrl,
    videoUrl: safeHttpUrl(videoUrl),
    publishedAt: firstPresent(row, ["published_at", "published_time"], context.publishedAt || ""),
    sourceType: String(firstPresent(row, ["source_type", "source_medium"], "")).trim(),
    raw: row,
  };
}

function extractHttpUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s<>]+/);
  return match ? match[0].replace(/[),，。；;]+$/, "") : "";
}

function fieldFromParts(parts, labels) {
  for (const part of parts) {
    for (const label of labels) {
      const match = part.match(new RegExp(`^${label}\\s*[：:]\\s*(.*)$`));
      if (match) return match[1].trim();
    }
  }
  return "";
}

function parseStructuredActionsFromSection(text, videos = []) {
  if (!/明確動作\s*[：:]/.test(String(text || ""))) return [];
  const rows = [];
  let analyst = "";
  let stance = "";
  let publishedAt = "";
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = line.match(/^-\s*([^／/(（]+)(?:[／/][^(（]+)?[（(]發布[：:]\s*([^）)]+)[）)]/);
    if (header) {
      analyst = header[1].trim();
      publishedAt = header[2].trim();
      stance = "";
      continue;
    }
    const stanceMatch = line.match(/^-\s*立場\s*[：:]\s*(.*)/);
    if (stanceMatch) {
      stance = stanceMatch[1].trim();
      continue;
    }
    if (!analyst || !/明確動作\s*[：:]/.test(line)) continue;
    const clean = line.replace(/^-\s*/, "");
    const parts = clean.split(/\s*[｜|]\s*/).map((part) => part.trim()).filter(Boolean);
    const actionText = fieldFromParts(parts, ["明確動作"]);
    const sourceQuote = fieldFromParts(parts, ["原話", "原句", "近原文"]).replace(/^[「“"]|[」”"]$/g, "");
    const condition = fieldFromParts(parts, ["條件／時點", "條件/時點", "條件"]);
    const positionContext = fieldFromParts(parts, ["部位語境", "持股情境"]);
    const replay = fieldFromParts(parts, ["回看片段", "來源"]);
    const timestampMatch = replay.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    const video = videos.find((item) => String(item.analyst || "").trim() === analyst) || {};
    rows.push({
      analyst,
      target: parts[0] || "未標示標的",
      stance,
      normalized_action: normalizeAction(actionText),
      action_text: actionText,
      source_quote: sourceQuote,
      attribution: sourceQuote ? "direct_quote" : "faithful_paraphrase",
      source_type: "report_section",
      condition_text: condition,
      position_context: positionContext,
      timestamp_seconds: timestampMatch?.[1] || null,
      timestamp_url: extractHttpUrl(replay),
      video_url: video.webpage_url || "",
      published_at: publishedAt || video.published_at || "",
    });
  }
  return rows;
}

function actionCollection(source) {
  const candidates = [
    source?.analyst_actions,
    source?.run?.analyst_actions,
    source?.actions,
    source?.run?.actions,
  ];
  for (const candidate of candidates) {
    const rows = asRows(candidate);
    if (rows.length) return { rows, origin: "structured" };
  }
  const parsed = parseStructuredActionsFromSection(sectionValue(source, "逐片摘要"), source?.videos || []);
  return parsed.length ? { rows: parsed, origin: "parsed_section" } : { rows: [], origin: "legacy" };
}

function extractActions(source) {
  const collection = actionCollection(source);
  const videos = asRows(source?.videos);
  const normalized = collection.rows.map((row) => {
    const videoId = String(firstPresent(row, ["video_id", "source_video_id"], "")).trim();
    const analyst = String(firstPresent(row, ["analyst", "teacher", "author"], "")).trim();
    const video =
      videos.find((item) => videoId && String(item.video_id || "") === videoId) ||
      videos.find((item) => analyst && String(item.analyst || "").trim() === analyst) ||
      {};
    return normalizeAnalystAction(row, {
      analyst,
      videoUrl: video.webpage_url || video.video_url || "",
      publishedAt: video.published_at || "",
    });
  });
  return {
    origin: collection.origin,
    actions: normalized.filter((action) => action.attribution.kind !== "system"),
    excludedSystemActions: normalized.filter((action) => action.attribution.kind === "system").length,
  };
}

function actionTone(action) {
  return {
    買進: "action-buy",
    加碼: "action-add",
    續抱: "action-hold",
    減碼: "action-reduce",
    賣出: "action-sell",
    停利: "action-profit",
    停損: "action-stop",
    觀望: "action-wait",
    未給明確動作: "action-none",
  }[action] || "action-none";
}

function actionTarget(action) {
  const pieces = [action.ticker, action.target].filter(Boolean);
  return pieces.join(" · ") || "標的未說明";
}

function renderActionCard(action) {
  const statement = action.sourceQuote || action.actionText || "來源文字未提供";
  const statementLabel =
    action.attribution.kind === "paraphrase"
      ? "近原文"
      : action.sourceQuote
        ? "逐字稿原句"
        : "動作表述";
  const sourceDetail =
    action.sourceType &&
    action.sourceType !== action.attribution.label &&
    !/direct_quote|faithful_paraphrase|report_section|逐字稿明確用語|逐字稿語意正規化|僅方向無動作/i.test(
      action.sourceType,
    )
      ? ` · ${action.sourceType}`
      : "";
  return `
    <article class="action-card">
      <header class="action-card-head">
        <div>
          <p class="analyst-name">${escapeHtml(action.analyst || "老師未標示")}</p>
          <h3>${escapeHtml(actionTarget(action))}</h3>
        </div>
        <div class="badge-row">
          <span class="action-badge ${actionTone(action.action)}">${escapeHtml(action.action)}</span>
          <span class="source-badge source-${escapeHtml(action.attribution.kind)}">${escapeHtml(
            action.attribution.label,
          )}${escapeHtml(sourceDetail)}</span>
        </div>
      </header>
      ${action.stance ? `<p class="stance-line"><span>立場</span>${escapeHtml(action.stance)}</p>` : ""}
      ${
        action.actionText && action.actionText !== action.action
          ? `<p class="action-phrase"><span>動作表述</span>${escapeHtml(action.actionText)}</p>`
          : ""
      }
      <div class="source-quote">
        <span>${escapeHtml(statementLabel)}</span>
        <blockquote>${linkify(statement)}</blockquote>
      </div>
      <dl class="action-context">
        <div>
          <dt>條件／時點</dt>
          <dd>${escapeHtml(action.condition || "未說明")}</dd>
        </div>
        <div>
          <dt>持股情境</dt>
          <dd>${escapeHtml(action.positionContext || "未說明")}</dd>
        </div>
      </dl>
      <footer class="action-card-foot">
        <span>${action.publishedAt ? `發布 ${escapeHtml(compactDateTime(action.publishedAt))}` : "發布時間未提供"}</span>
        ${
          action.timestampUrl
            ? `<a href="${escapeHtml(action.timestampUrl)}" target="_blank" rel="noreferrer">${
                Number.isFinite(action.timestampSeconds)
                  ? `回看 ${escapeHtml(formatTimestamp(action.timestampSeconds))}`
                  : "開啟來源"
              } <span aria-hidden="true">↗</span></a>`
            : '<span class="missing-source">時間戳／連結未提供</span>'
        }
      </footer>
    </article>
  `;
}

function renderActionCardsHtml(actions, emptyDetail = "尚未收到結構化的老師動作。") {
  if (!actions.length) return emptyState("沒有符合條件的分析師動作", emptyDetail);
  return actions.map(renderActionCard).join("");
}

function renderLegacySummary(text, locationLabel = "本日") {
  if (!text) {
    return emptyState("沒有逐片摘要", `${locationLabel}資料未提供結構化動作或可回退的摘要原文。`);
  }
  return `
    <div class="legacy-action-block">
      <div class="legacy-notice">
        <span class="legacy-badge">舊版</span>
        <p>此紀錄尚無結構化動作欄位，以下原樣呈現舊版逐片摘要；不由前端推測老師的買賣動作。</p>
      </div>
      <div class="legacy-summary">${renderResearchBlockHtml(text)}</div>
    </div>
  `;
}

function normalizeScreenDirection(value) {
  const text = String(value || "").trim();
  if (SCREEN_DIRECTIONS.includes(text)) return text;
  const lower = text.toLowerCase();
  if (/bullish_confirmed|confirmed_bullish/.test(lower)) return "偏多確認";
  if (/bullish_unconfirmed|unconfirmed_bullish|pending_bullish/.test(lower)) return "偏多未確認";
  if (/neutral/.test(lower)) return "中性";
  if (/bearish_confirmed|confirmed_bearish/.test(lower)) return "偏空確認";
  return "資料不足";
}

function normalizeAlignment(value) {
  const text = String(value || "").trim();
  if (SCREEN_ALIGNMENTS.includes(text)) return text;
  const lower = text.toLowerCase();
  if (/^support(ed)?$/.test(lower)) return "支持";
  if (/partial/.test(lower)) return "部分支持";
  if (/unconfirmed|pending|not_confirmed/.test(lower)) return "尚未確認";
  if (/conflict|contradict/.test(lower)) return "矛盾";
  return "資料不足";
}

function factualEvidence(row) {
  const facts = [];
  if (hasValue(row.close)) facts.push(`收盤 ${row.close}`);
  if (hasValue(row.ret5_pct)) facts.push(`5 日 ${percent(row.ret5_pct)}`);
  if (hasValue(row.ret20_pct)) facts.push(`20 日 ${percent(row.ret20_pct)}`);
  if (hasValue(row.ma20_pct)) facts.push(`距 20 日線 ${percent(row.ma20_pct)}`);
  if (hasValue(row.vol_ratio20)) facts.push(`量比 ${Number(row.vol_ratio20).toFixed(2)}`);
  return facts;
}

function normalizeMarketScreen(row) {
  const nestedActionRows = asRows(
    firstPresent(row, ["analyst_actions", "linked_actions", "actions"], []),
  );
  return {
    id: String(firstPresent(row, ["screen_id", "id"], "")).trim(),
    actionIds: asIdList(firstPresent(row, ["analyst_action_ids", "action_ids"], [])),
    code: String(firstPresent(row, ["ticker", "code", "symbol"], "")).trim(),
    name: String(firstPresent(row, ["target", "name", "target_name", "symbol_name"], "")).trim(),
    direction: normalizeScreenDirection(
      firstPresent(row, ["screen_direction", "market_direction", "direction"], ""),
    ),
    alignment: normalizeAlignment(
      firstPresent(row, ["alignment", "screen_alignment", "action_alignment"], ""),
    ),
    evidence:
      asTextList(firstPresent(row, ["screen_evidence", "evidence", "evidence_text", "reason"], "")).length
        ? asTextList(firstPresent(row, ["screen_evidence", "evidence", "evidence_text", "reason"], ""))
        : factualEvidence(row),
    confirmationConditions: asTextList(
      firstPresent(
        row,
        [
          "confirmation_conditions",
          "confirm_conditions",
          "confirmation_conditions_json",
          "confirm_conditions_json",
        ],
        [],
      ),
    ),
    invalidConditions: asTextList(
      firstPresent(row, ["invalid_conditions", "invalidation_conditions", "invalid_conditions_json"], []),
    ),
    latestDate: firstPresent(row, ["latest_date", "market_date", "date"], ""),
    source: String(firstPresent(row, ["source", "market_source"], "")).trim(),
    nestedActions: nestedActionRows
      .map((action) => normalizeAnalystAction(action))
      .filter((action) => action.attribution.kind !== "system"),
    raw: row,
  };
}

function directionTone(value) {
  return {
    偏多確認: "direction-bull",
    偏多未確認: "direction-pending",
    中性: "direction-neutral",
    偏空確認: "direction-bear",
    資料不足: "direction-missing",
  }[value] || "direction-missing";
}

function alignmentTone(value) {
  return {
    支持: "alignment-support",
    部分支持: "alignment-partial",
    尚未確認: "alignment-pending",
    矛盾: "alignment-conflict",
    資料不足: "alignment-missing",
  }[value] || "alignment-missing";
}

function actionsForScreen(screen, actions) {
  if (screen.nestedActions.length) return screen.nestedActions;
  if (screen.actionIds.length) {
    return actions.filter((action) => action.id && screen.actionIds.includes(action.id));
  }
  return [];
}

function renderList(items, emptyText) {
  if (!items.length) return `<p class="condition-empty">${escapeHtml(emptyText)}</p>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderScreenCard(screen, allActions) {
  const linkedActions = actionsForScreen(screen, allActions);
  return `
    <article class="screen-card">
      <header class="screen-card-head">
        <div>
          <p class="screen-code">${escapeHtml(screen.code || "代號未提供")}</p>
          <h3>${escapeHtml(screen.name || "標的未提供")}</h3>
        </div>
        <div class="screen-statuses">
          <span class="screen-badge ${directionTone(screen.direction)}">
            <small>方向</small>${escapeHtml(screen.direction)}
          </span>
          <span class="screen-badge ${alignmentTone(screen.alignment)}">
            <small>一致性</small>${escapeHtml(screen.alignment)}
          </span>
        </div>
      </header>
      <div class="linked-actions">
        <span class="screen-label">對照老師動作</span>
        <div class="action-chip-row">
          ${
            linkedActions.length
              ? linkedActions
                  .map(
                    (action) =>
                      `<span class="action-chip ${actionTone(action.action)}">${escapeHtml(
                        action.analyst || "老師",
                      )} · ${escapeHtml(action.action)}</span>`,
                  )
                  .join("")
              : '<span class="unlinked">未連結結構化老師動作</span>'
          }
        </div>
      </div>
      <div class="screen-evidence">
        <h4>驗證依據</h4>
        ${renderList(screen.evidence, "尚無可核對的市場依據")}
      </div>
      <div class="condition-grid">
        <section>
          <h4>確認條件</h4>
          ${renderList(screen.confirmationConditions, "未提供")}
        </section>
        <section>
          <h4>失效條件</h4>
          ${renderList(screen.invalidConditions, "未提供")}
        </section>
      </div>
      <footer class="screen-card-foot">
        <span>市場日期：${escapeHtml(screen.latestDate || "未提供")}</span>
        <span>${screen.source ? `資料源：${escapeHtml(screen.source)}` : "資料源未標示"}</span>
        <strong>系統結果不改寫老師動作</strong>
      </footer>
    </article>
  `;
}

function renderScreenGridHtml(screens, actions, emptyDetail = "本輪尚無系統驗證資料。") {
  if (!screens.length) return emptyState("沒有符合條件的快篩結果", emptyDetail);
  return screens.map((screen) => renderScreenCard(screen, actions)).join("");
}

function metric(label, value, hint = "", tone = "") {
  return `
    <div class="metric ${escapeHtml(tone)}">
      <span class="metric-label">${escapeHtml(label)}</span>
      <strong class="metric-value">${escapeHtml(value)}</strong>
      ${hint ? `<span class="metric-hint">${escapeHtml(hint)}</span>` : ""}
    </div>
  `;
}

function renderOverviewActions() {
  const filter = $("#overviewActionFilter")?.value || "";
  const filtered = state.actions.filter((action) => !filter || action.action === filter);
  const target = $("#analystActionList");
  const legacyText = sectionValue(state.summary, "逐片摘要");
  if (!target) return;
  if (state.actions.length) {
    target.innerHTML = renderActionCardsHtml(filtered);
  } else {
    target.innerHTML = renderLegacySummary(legacyText, "最新");
  }
  const note = $("#actionIntegrityNote");
  if (note) {
    note.innerHTML = state.excludedSystemActions
      ? `
        <div class="integrity-note">
          <strong>已隔離 ${state.excludedSystemActions} 筆系統來源資料</strong>
          <span>它們不會顯示為分析師動作。</span>
        </div>
      `
      : "";
  }
}

function filteredOverviewScreens() {
  const direction = $("#overviewDirectionFilter")?.value || "";
  const alignment = $("#overviewAlignmentFilter")?.value || "";
  return asRows(state.summary?.market_screens)
    .map(normalizeMarketScreen)
    .filter((row) => (!direction || row.direction === direction) && (!alignment || row.alignment === alignment));
}

function renderOverviewScreens() {
  const target = $("#overviewMarketList");
  if (!target) return;
  target.innerHTML = renderScreenGridHtml(filteredOverviewScreens(), state.actions);
}

function renderSummary() {
  const data = state.summary || {};
  const run = data.run || {};
  const extracted = extractActions(data);
  state.actions = extracted.actions;
  state.excludedSystemActions = extracted.excludedSystemActions;

  const runMeta = $("#runMeta");
  if (runMeta) {
    runMeta.innerHTML = run.run_id
      ? `<span>最新紀錄</span><strong>${escapeHtml(run.run_date || "日期未標示")}</strong><small>${escapeHtml(
          modeLabel(run.mode),
        )}模式</small>`
      : "<span>資料狀態</span><strong>尚無紀錄</strong>";
  }

  const metrics = [
    metric("最新日期", run.run_date || "—", modeLabel(run.mode), "metric-primary"),
    metric(
      "老師動作",
      state.actions.length ? `${state.actions.length} 筆` : "舊版",
      state.actions.length ? "結構化且可追溯" : "保留原摘要、不推測",
      "metric-action",
    ),
    metric(
      "系統驗證",
      `${asRows(data.market_screens).length} 筆`,
      "只驗證，不改寫動作",
      "metric-system",
    ),
    metric("待驗證觀點", `${data.open_claims?.length || 0} 筆`, "依原訂條件追蹤", "metric-pending"),
    metric("逐字稿採納", adoptionCompact(run.adoption_status), run.adoption_status || "未標示", ""),
  ];
  const metricsTarget = $("#summaryMetrics");
  if (metricsTarget) metricsTarget.innerHTML = metrics.join("");
  const actionFilter = $("#overviewActionFilter");
  if (actionFilter) actionFilter.disabled = !state.actions.length;
  const contractStatusNote = $("#contractStatusNote");
  if (contractStatusNote) {
    const isLegacyRun = Number(run.market_schema_version || 0) < 2;
    contractStatusNote.innerHTML = isLegacyRun
      ? `
        <div class="legacy-notice contract-note">
          <span class="legacy-badge">舊版紀錄</span>
          <p>目前最新日報仍是舊版產物；下方共識與逐片摘要原樣保留供查核，不把其中的系統標籤視為老師原話。下一次正式日報通過 v2 驗證後，這裡會改為結構化老師動作與獨立快篩。</p>
        </div>
      `
      : "";
  }

  renderResearchBlock("#consensusBlock", sectionValue(data, "共識"), "今日尚無共識摘要");
  renderOverviewActions();
  renderOverviewScreens();
  renderResearchBlock("#divergenceBlock", sectionValue(data, "分歧"), "今日尚無分歧摘要");
  renderResearchBlock("#trackingBlock", sectionValue(data, "追蹤"), "今日尚無追蹤摘要");
  renderOpenClaims(data.open_claims || []);
}

function renderOpenClaims(rows) {
  const target = $("#openClaimsList");
  if (!target) return;
  target.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <article class="claim-card compact">
              <div class="claim-card-head">
                <strong>${escapeHtml(row.analyst || "作者未標示")}</strong>
                <span class="status-badge status-open">待驗證</span>
              </div>
              <p>${escapeHtml(row.statement || "觀點內容未提供")}</p>
              <div class="meta-line">${escapeHtml(row.targets_text || "標的未標示")} · 到期 ${escapeHtml(
                row.evaluation_due_date || "未標示",
              )}</div>
            </article>
          `,
        )
        .join("")
    : emptyState("目前沒有待驗證觀點");
}

function setDefaultHistoryDates() {
  const latestRunDate = state.summary?.run?.run_date;
  const endDate = parseLocalDate(latestRunDate) || new Date();
  const startDate = addMonthsClamped(endDate, -1);
  if (!$("#historyFrom")?.value) $("#historyFrom").value = formatInputDate(startDate);
  if (!$("#historyTo")?.value) $("#historyTo").value = formatInputDate(endDate);
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
  label.textContent = !selected.length
    ? "全部作者"
    : selected.length <= 2
      ? selected.join("、")
      : `已選 ${selected.length} 位作者`;
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
    .map(
      (name) => `
        <label class="multi-option">
          <input type="checkbox" value="${escapeHtml(name)}"${
            state.selectedHistoryAuthors.has(name) ? " checked" : ""
          } />
          <span>${escapeHtml(name)}</span>
        </label>
      `,
    )
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

function statusTone(value) {
  const text = String(value || "");
  if (text === "success" || text.includes("完整")) return "status-good";
  if (text === "miss" || text.includes("錯誤") || text.includes("失敗")) return "status-risk";
  if (text === "partial" || text.includes("僅") || text.includes("缺")) return "status-warn";
  return "status-info";
}

async function loadHistory() {
  const params = new URLSearchParams();
  if ($("#historyFrom")?.value) params.set("from", $("#historyFrom").value);
  if ($("#historyTo")?.value) params.set("to", $("#historyTo").value);
  if ($("#historyMode")?.value) params.set("mode", $("#historyMode").value);
  selectedHistoryAuthorList().forEach((author) => params.append("author", author));
  const data = await api(`/api/runs?${params.toString()}`);
  state.runs = data.items || [];
  const target = $("#historyRows");
  if (!target) return;
  target.innerHTML = state.runs.length
    ? state.runs
        .map((row) => {
          const count = firstPresent(row, ["analyst_action_count", "action_count", "claim_count"], 0);
          return `
            <tr>
              <td data-label="日期">${escapeHtml(row.run_date || "—")}</td>
              <td data-label="資料狀態"><span class="status-badge ${statusTone(
                row.data_status,
              )}">${escapeHtml(row.data_status || "未標示")}</span></td>
              <td data-label="模式">${escapeHtml(modeLabel(row.mode))}</td>
              <td data-label="動作／觀點">${escapeHtml(count)}</td>
              <td data-label="影片">${escapeHtml(row.video_count ?? 0)}</td>
              <td data-label="快篩">${escapeHtml(row.market_screen_count ?? 0)}</td>
              <td data-label="操作"><button class="button small" type="button" data-run="${escapeHtml(
                row.run_id,
              )}">檢視</button></td>
            </tr>
          `;
        })
        .join("")
    : '<tr class="empty-row"><td colspan="7">查無符合條件的歷史紀錄</td></tr>';
}

function detailSection(title, content, options = {}) {
  const badge = options.badge
    ? `<span class="detail-version ${escapeHtml(options.badgeTone || "")}">${escapeHtml(options.badge)}</span>`
    : "";
  return `
    <section class="detail-section">
      <div class="detail-section-head">
        <h3>${escapeHtml(title)}</h3>
        ${badge}
      </div>
      <div class="detail-section-body">${content}</div>
    </section>
  `;
}

function renderHistorySummary(detail, actionSet) {
  if (actionSet.actions.length) {
    return detailSection(
      "逐片摘要",
      `<div class="action-grid">${renderActionCardsHtml(actionSet.actions)}</div>`,
      { badge: "新版卡片", badgeTone: "new" },
    );
  }
  const legacyText = sectionValue(detail, "逐片摘要");
  return detailSection(
    "逐片摘要",
    renderLegacySummary(legacyText, "此日"),
    { badge: "舊版", badgeTone: "legacy" },
  );
}

function renderDetailClaims(rows, wrapped = true) {
  if (!rows?.length) return emptyState("這一天沒有已錄入的觀點追蹤");
  const cards = rows
        .map((row) => {
          const outcome = row.evaluation_result || row.status || "未標示";
          return `
            <article class="claim-card">
              <div class="claim-card-head">
                <strong>${escapeHtml(row.analyst || "作者未標示")}</strong>
                <div class="badge-row">
                  <span class="status-badge ${statusTone(outcome)}">${escapeHtml(outcome)}</span>
                  ${
                    row.confidence_level
                      ? `<span class="status-badge status-info">${escapeHtml(row.confidence_level)}</span>`
                      : ""
                  }
                </div>
              </div>
              <p>${escapeHtml(row.statement || "觀點內容未提供")}</p>
              <div class="meta-line">${escapeHtml(row.targets_text || "標的未標示")} · ${escapeHtml(
                row.direction || "方向未標示",
              )} · 到期 ${escapeHtml(row.evaluation_due_date || "未標示")}</div>
              ${row.notes ? `<div class="meta-line">評語：${escapeHtml(row.notes)}</div>` : ""}
            </article>
          `;
        })
        .join("");
  return wrapped ? `<div class="claim-list embedded-list">${cards}</div>` : cards;
}

function renderDetailVideos(rows) {
  if (!rows?.length) return emptyState("這一天沒有已錄入的來源影片");
  return `
    <div class="video-grid embedded-list">
      ${rows
        .map((row) => {
          const href = safeHttpUrl(row.webpage_url);
          return `
            <article class="video-card">
              <p class="analyst-name">${escapeHtml(row.analyst || row.channel_name || "來源未標示")}</p>
              <h4>
                ${
                  href
                    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(
                        row.title || row.video_id || "開啟影片",
                      )}</a>`
                    : escapeHtml(row.title || row.video_id || "影片標題未提供")
                }
              </h4>
              <div class="meta-line">${escapeHtml(compactDateTime(row.published_at))} · ${escapeHtml(
                row.status || "狀態未標示",
              )} · ${escapeHtml(row.transcript_confidence || "信心未標示")}</div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

async function loadRunDetail(runId, options = {}) {
  const detail = await api(`/api/runs/${encodeURIComponent(runId)}`);
  const run = detail.run || {};
  const actionSet = extractActions(detail);
  const screens = asRows(detail.market_screens).map(normalizeMarketScreen);
  if (options.updateUrl !== false) updateLocationForRun(runId);
  const url = reportUrl(runId);
  const explanation =
    run.record_type === "history_date"
      ? "這一天沒有完整 daily run 檔案；下方會保留可取得的舊版逐片摘要、觀點追蹤與來源影片，不由前端補寫缺失內容。"
      : "";
  const target = $("#runDetail");
  if (!target) return;
  target.classList.remove("subtle");
  target.innerHTML = `
    <div class="detail-summary">
      <div><span>日期</span><strong>${escapeHtml(run.run_date || "—")}</strong></div>
      <div><span>資料狀態</span><strong>${escapeHtml(run.data_status || "完整日報")}</strong></div>
      <div><span>模式</span><strong>${escapeHtml(modeLabel(run.mode))}</strong></div>
      <div><span>資料量</span><strong>${escapeHtml(
        firstPresent(run, ["analyst_action_count", "action_count", "claim_count"], detail.claims?.length || 0),
      )} 動作／觀點 · ${escapeHtml(run.video_count ?? detail.videos?.length ?? 0)} 影片</strong></div>
      <div class="detail-link-cell">
        <span>單日連結</span>
        <div class="detail-actions">
          <a class="button small secondary" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">開啟</a>
          <button class="button small" type="button" data-copy-run-link="${escapeHtml(url)}">複製</button>
        </div>
      </div>
    </div>
    ${explanation ? detailSection("資料說明", `<p>${escapeHtml(explanation)}</p>`) : ""}
    ${detailSection("今日共識", renderResearchBlockHtml(sectionValue(detail, "共識"), "此日沒有共識摘要"))}
    ${renderHistorySummary(detail, actionSet)}
    ${
      detailSection(
        "系統快篩驗證",
        `
          <div class="layer-note system-layer-note compact">
            <strong>系統層</strong><span>只驗證市場資料；即使矛盾，也不更動上方老師動作。</span>
          </div>
          <div class="screen-grid">${renderScreenGridHtml(screens, actionSet.actions)}</div>
        `,
      )
    }
    ${detailSection("分歧", renderResearchBlockHtml(sectionValue(detail, "分歧"), "此日沒有分歧摘要"))}
    ${detailSection("追蹤", renderResearchBlockHtml(sectionValue(detail, "追蹤"), "此日沒有追蹤摘要"))}
    ${detailSection("當日觀點資料", renderDetailClaims(detail.claims || []))}
    ${detailSection("來源影片", renderDetailVideos(detail.videos || []))}
  `;
}

async function loadClaims() {
  const params = new URLSearchParams();
  if ($("#claimAuthor")?.value) params.set("author", $("#claimAuthor").value);
  if ($("#claimTicker")?.value) params.set("ticker", $("#claimTicker").value);
  if ($("#claimStatus")?.value) params.set("status", $("#claimStatus").value);
  if ($("#claimResult")?.value) params.set("result", $("#claimResult").value);
  const data = await api(`/api/claims?${params.toString()}`);
  state.claims = asRows(data.items);
  const target = $("#claimList");
  if (!target) return;
  target.innerHTML = state.claims.length
    ? renderDetailClaims(state.claims, false)
    : emptyState("查無符合條件的觀點", "可調整作者、標的、狀態或結果篩選。");
}

function filteredMarketRows() {
  const ticker = String($("#marketTicker")?.value || "").trim().toLowerCase();
  const actionFilter = $("#marketAction")?.value || "";
  const direction = $("#marketDirection")?.value || "";
  const alignment = $("#marketAlignment")?.value || "";
  return state.market.filter((screen) => {
    const tickerMatches =
      !ticker ||
      String(screen.code || "").toLowerCase().includes(ticker) ||
      String(screen.name || "").toLowerCase().includes(ticker);
    const actions = actionsForScreen(screen, state.actions);
    return (
      tickerMatches &&
      (!actionFilter || actions.some((action) => action.action === actionFilter)) &&
      (!direction || screen.direction === direction) &&
      (!alignment || screen.alignment === alignment)
    );
  });
}

function renderMarket() {
  const rows = filteredMarketRows();
  const summary = $("#marketSummary");
  const target = $("#marketRows");
  if (summary) {
    summary.innerHTML = `顯示 <strong>${rows.length}</strong>／${state.market.length} 筆驗證結果`;
  }
  if (target) {
    target.innerHTML = renderScreenGridHtml(
      rows,
      state.actions,
      state.market.length ? "可調整動作、方向或一致性篩選。" : "本輪尚無系統快篩資料。",
    );
  }
}

async function loadMarket() {
  const runId = state.summary?.run?.run_id || "";
  const params = new URLSearchParams();
  if (runId) params.set("run_id", runId);
  const data = await api(`/api/market-screens?${params.toString()}`);
  state.market = asRows(data.items).map(normalizeMarketScreen);
  renderMarket();
}

async function loadAuthors() {
  const data = await api("/api/authors/scoreboard");
  state.scoreboard = data.items || [];
  renderHistoryAuthorOptions();
  const target = $("#authorRows");
  if (!target) return;
  target.innerHTML = state.scoreboard.length
    ? state.scoreboard
        .map(
          (row) => `
            <tr>
              <td data-label="作者">${escapeHtml(row.analyst || "—")}</td>
              <td data-label="可評分樣本">${escapeHtml(row.scored_sample_count ?? "—")}</td>
              <td data-label="命中率">${rate(row.hit_rate)}</td>
              <td data-label="近 20 筆">${rate(row.near20_hit_rate)}</td>
              <td data-label="高確信">${rate(row.high_confidence_hit_rate)}</td>
              <td data-label="平均報酬">${percent(Number(row.average_return || 0) * 100)}</td>
              <td data-label="平均相對報酬">${percent(Number(row.average_relative_return || 0) * 100)}</td>
              <td data-label="待驗證">${escapeHtml(row.open_claims ?? "—")}</td>
            </tr>
          `,
        )
        .join("")
    : '<tr class="empty-row"><td colspan="8">尚無作者成績資料</td></tr>';
}

function activateView(name) {
  $$(".tab").forEach((tab) => {
    const active = tab.dataset.view === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-current", active ? "page" : "false");
  });
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
}

function bindEvents() {
  bindThemeToggle();
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateView(tab.dataset.view));
  });
  $("#overviewActionFilter")?.addEventListener("change", renderOverviewActions);
  $("#overviewDirectionFilter")?.addEventListener("change", renderOverviewScreens);
  $("#overviewAlignmentFilter")?.addEventListener("change", renderOverviewScreens);
  $("#historyApply")?.addEventListener("click", () => loadHistory().catch(handleError));
  $("#claimApply")?.addEventListener("click", () => loadClaims().catch(handleError));
  $("#marketApply")?.addEventListener("click", renderMarket);
  $("#marketTicker")?.addEventListener("input", renderMarket);
  $("#marketAction")?.addEventListener("change", renderMarket);
  $("#marketDirection")?.addEventListener("change", renderMarket);
  $("#marketAlignment")?.addEventListener("change", renderMarket);
  $("#historyRows")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-run]");
    if (button) loadRunDetail(button.dataset.run).catch(handleError);
  });
  $("#runDetail")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-run-link]");
    if (!button) return;
    copyText(button.dataset.copyRunLink)
      .then(() => showToast("已複製單日連結"))
      .catch(handleError);
  });
  $("#historyAuthorToggle")?.addEventListener("click", () => {
    setHistoryAuthorMenuOpen(Boolean($("#historyAuthorMenu")?.hidden));
  });
  $("#historyAuthorOptions")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    if (checkbox.checked) state.selectedHistoryAuthors.add(checkbox.value);
    else state.selectedHistoryAuthors.delete(checkbox.value);
    updateHistoryAuthorLabel();
    loadHistory().catch(handleError);
  });
  $("#historyAuthorClear")?.addEventListener("click", () => {
    state.selectedHistoryAuthors.clear();
    renderHistoryAuthorOptions();
    loadHistory().catch(handleError);
  });
  $("#historyAuthorDone")?.addEventListener("click", () => setHistoryAuthorMenuOpen(false));
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
  showToast(error?.message || "載入失敗");
}

async function init() {
  bindEvents();
  const initialRunId = initialRunIdFromLocation();
  state.summary = await api("/api/summary/today");
  renderSummary();
  setDefaultHistoryDates();
  await loadAuthors();
  await Promise.all([loadHistory(), loadClaims(), loadMarket()]);
  if (initialRunId) {
    activateView("history");
    await loadRunDetail(initialRunId, { updateUrl: false });
    $("#runDetailPanel")?.scrollIntoView({ block: "start" });
  }
}

init().catch(handleError);
