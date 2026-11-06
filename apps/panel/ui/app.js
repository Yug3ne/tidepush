const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const tilde = (p) => p.replace(/^\/home\/[^/]+/, "~");
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colour codes.
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

// ---------------------------------------------------------------- icons
const ICONS = {
  "chevron-down": '<path d="m4 6 4 4 4-4"/>',
  undo: '<path d="M5 3 2 6l3 3"/><path d="M2 6h7.5a4 4 0 0 1 0 8H7"/>',
  x: '<path d="m4 4 8 8M12 4l-8 8"/>',
  check: '<path d="m3.5 8.5 3 3 6-7" stroke-width="2"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M13 2.5V5h-2.5"/>',
  loader: '<path d="M8 2a6 6 0 1 0 6 6"/>',
  more: '<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>',
};
const icon = (name, cls = "") =>
  `<span class="ico ${cls}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg></span>`;
for (const el of document.querySelectorAll("[data-icon]")) el.outerHTML = icon(el.dataset.icon);

// ---------------------------------------------------------------- state
const state = {
  app: null, // AppInfo from the backend
  settings: null,
  updates: [], // newest first, from `tidepush list --json`
  loading: false,
  listError: "",
  filter: "all",
  selected: null, // groupId
  runtime: {}, // platform -> { value } | { error } | { pending: true }
  job: null, // { title, onDone }
};

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};
const appKey = (k) => `${k}:${state.app?.dir}`;

async function call(cmd, args) {
  try {
    return await invoke(cmd, args);
  } catch (e) {
    toast(String(e), true);
    throw e;
  }
}

// ---------------------------------------------------------------- toasts / menus / modals
function toast(text, error = false) {
  if (!text) return;
  const el = document.createElement("div");
  el.className = `toast${error ? " error" : ""}`;
  el.textContent = text;
  if (error) el.title = "Click to dismiss";
  el.onclick = () => el.remove();
  $("#toasts").append(el);
  setTimeout(() => el.remove(), error ? 9000 : 4000);
}

function openMenu(anchor, items, { x, y } = {}) {
  const menu = $("#menu");
  menu.innerHTML = "";
  for (const item of items) {
    if (item === "-") {
      menu.append(document.createElement("hr"));
      continue;
    }
    const b = document.createElement("button");
    b.innerHTML = `<span class="ico">${item.checked ? `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${ICONS.check}</svg>` : ""}</span><span>${esc(item.label)}</span>${item.hint ? `<span class="spacer"></span><kbd>${esc(item.hint)}</kbd>` : ""}`;
    if (item.danger) b.classList.add("danger");
    b.disabled = !!item.disabled;
    b.onclick = () => {
      closeMenu();
      item.run();
    };
    menu.append(b);
  }
  menu.hidden = false;
  const mr = menu.getBoundingClientRect();
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    x = r.right - mr.width;
    y = r.bottom + 2;
    if (y + mr.height > innerHeight - 4) y = r.top - mr.height - 2;
  }
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - mr.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - mr.height - 4))}px`;
}
function closeMenu() {
  $("#menu").hidden = true;
}
document.addEventListener("mousedown", (e) => {
  if (!$("#menu").hidden && !e.target.closest("#menu")) closeMenu();
});

let modalResolve = null;
function closeModal(value = null) {
  $("#modal-backdrop").hidden = true;
  $("#modal").innerHTML = "";
  const r = modalResolve;
  modalResolve = null;
  r?.(value);
}
$("#modal-backdrop").addEventListener("mousedown", (e) => {
  if (e.target.id === "modal-backdrop") closeModal();
});

/**
 * A modal with `html` above Cancel / OK. Resolves to `collect()` on OK (or true),
 * null on cancel.
 */
function dialog(html, { ok = "OK", danger = false, collect, focus } = {}) {
  closeModal();
  return new Promise((resolve) => {
    modalResolve = resolve;
    const modal = $("#modal");
    modal.innerHTML = `${html}<div class="modal-actions"><button class="btn" data-r="0">Cancel</button><button class="btn primary ${danger ? "danger" : ""}" data-r="1">${esc(ok)}</button></div>`;
    $("#modal-backdrop").hidden = false;
    const confirm = () => {
      const v = collect ? collect(modal) : true;
      if (v == null) return;
      modalResolve = null;
      closeModal();
      resolve(v);
    };
    $('[data-r="0"]', modal).onclick = () => closeModal();
    $('[data-r="1"]', modal).onclick = confirm;
    modal.onkeydown = (e) => {
      if (e.key === "Escape") closeModal();
      else if (e.key === "Enter" && (e.target.tagName === "INPUT" || e.ctrlKey)) {
        e.preventDefault();
        confirm();
      }
    };
    (focus ? $(focus, modal) : $('[data-r="1"]', modal))?.focus();
    $(focus ?? "x-none", modal)?.select?.();
  });
}

function summary(rows) {
  return `<dl class="summary">${rows
    .filter(Boolean)
    .map(([k, v, cls = ""]) => `<dt>${esc(k)}</dt><dd class="${cls}">${esc(v)}</dd>`)
    .join("")}</dl>`;
}

/** Subsequence match score (higher is better), or -1 when `q` doesn't match. */
function fuzzyScore(q, text) {
  const t = text.toLowerCase();
  const sub = t.indexOf(q);
  if (sub !== -1) return 1000 - sub * 2 - t.length / 100 + (sub === 0 ? 500 : 0);
  let score = 0;
  let pos = 0;
  let prev = -2;
  for (const ch of q) {
    const k = t.indexOf(ch, pos);
    if (k === -1) return -1;
    score += k === prev + 1 ? 8 : 1;
    prev = k;
    pos = k + 1;
  }
  return score;
}

/** Filterable list in a modal. items: [{main, sub, search, current}]. */
function picker({ placeholder, items, load, onPick }) {
  closeModal();
  const modal = $("#modal");
  modal.innerHTML = `<input class="picker-input" placeholder="${esc(placeholder)}" /><div class="picker-list"></div>`;
  $("#modal-backdrop").hidden = false;
  const input = $("input", modal);
  const list = $(".picker-list", modal);
  let shown = [];
  let active = 0;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    shown = !q
      ? items.slice(0, 300)
      : items
          .map((i) => {
            const a = fuzzyScore(q, i.main);
            const b = fuzzyScore(q, i.search ?? "");
            return { i, score: Math.max(a >= 0 ? a + 200 : -1, b) };
          })
          .filter((x) => x.score >= 0)
          .sort((x, y) => y.score - x.score)
          .map((x) => x.i);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length
      ? shown
          .map(
            (i, n) =>
              `<button class="picker-item ${n === active ? "active" : ""} ${i.current ? "current" : ""}" data-n="${n}"><span class="main">${esc(i.main)}</span><span class="sub">‎${esc(i.sub || "")}‎</span></button>`,
          )
          .join("")
      : `<div class="empty">${load && !items.length ? "Looking for Expo apps…" : "No matches"}</div>`;
    list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  };
  const choose = (n) => {
    const item = shown[n];
    if (!item) return;
    closeModal();
    onPick(item);
  };
  input.oninput = () => {
    active = 0;
    render();
  };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) active = Math.min(active + 1, shown.length - 1);
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) active = Math.max(active - 1, 0);
    else if (e.key === "Enter") return choose(active);
    else if (e.key === "Escape") return closeModal();
    else return;
    e.preventDefault();
    e.stopPropagation();
    render();
  };
  list.onclick = (e) => {
    const b = e.target.closest(".picker-item");
    if (b) choose(+b.dataset.n);
  };
  render();
  input.focus();
  load?.then((fresh) => {
    if (!fresh || !list.isConnected) return;
    items = fresh;
    render();
  });
}

// ---------------------------------------------------------------- time
function ago(iso) {
  const t = Date.parse(iso);
  if (!t) return "";
  const d = (Date.now() - t) / 1000;
  if (d < 90) return "just now";
  for (const [n, unit] of [
    [86400 * 365, "y"],
    [86400 * 30, "mo"],
    [86400 * 7, "w"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ]) {
    if (d >= n) return `${Math.floor(d / n)}${unit} ago`;
  }
  return "";
}
const fullDate = (iso) => new Date(iso).toLocaleString();

// ---------------------------------------------------------------- opening an app
let discovered = null;
async function discoverApps() {
  if (discovered && Date.now() - discovered.at < 60_000) return discovered.apps;
  const apps = await invoke("discover_apps").catch(() => []);
  discovered = { at: Date.now(), apps };
  return apps;
}

function appItems(apps) {
  return [
    ...apps.map((a) => ({
      main: a.name,
      sub: tilde(a.path),
      search: tilde(a.path),
      path: a.path,
      current: a.path === state.app?.dir,
    })),
    { main: "Open Folder…", sub: "Ctrl O", search: "", openFolder: true },
  ];
}

function appSwitcher() {
  picker({
    placeholder: "Switch app…",
    items: appItems(discovered?.apps ?? []),
    load: discoverApps().then(appItems),
    onPick: (i) => (i.openFolder ? pickFolder() : openApp(i.path)),
  });
}

async function pickFolder() {
  const info = await call("pick_app").catch(() => null);
  if (info) activate(info);
}

async function openApp(path, { quiet = false } = {}) {
  try {
    activate(await invoke("open_app", { path }));
    return true;
  } catch (e) {
    if (!quiet) toast(String(e), true);
    return false;
  }
}

function activate(info) {
  const changed = info.dir !== state.app?.dir;
  state.app = info;
  if (changed) {
    state.updates = [];
    state.selected = null;
    state.runtime = {};
    state.filter = store.get(appKey("filter"), "all");
    $("#msg").value = store.get(appKey("draft"), "") || defaultMessage();
    $("#rollout").value = 100;
    platform = store.get(appKey("platform"), null);
    channel = store.get(appKey("channel"), "production");
  }
  $("#welcome").hidden = true;
  $("#app").hidden = false;
  document.title = `${info.name} · Tidepush Panel`;
  render();
  loadUpdates().then(() => {
    if (changed) resolveRuntime();
  });
}

function defaultMessage() {
  const a = state.app;
  if (!a?.subject) return "";
  const where = [a.branch, a.sha].filter(Boolean).join(" ");
  return where ? `${a.subject} (${where})` : a.subject;
}

async function refreshApp() {
  if (!state.app) return;
  state.app = await invoke("app_info").catch(() => state.app);
  renderFooter();
}

// A second `tidepanel <path>` launch forwards its folder here.
listen("open-path", (e) => openApp(e.payload, { quiet: !!state.app }));

// ---------------------------------------------------------------- updates
async function loadUpdates() {
  if (!state.app) return;
  state.loading = true;
  renderList();
  try {
    state.updates = await invoke("list_updates", { limit: 100 });
    state.listError = "";
  } catch (e) {
    state.listError = String(e);
  }
  state.loading = false;
  if (!platform) platform = guessPlatform();
  render();
}

/** Publishes grouped: one row per publish (its platforms share a groupId). */
function groups() {
  const by = new Map();
  for (const u of state.updates) {
    let g = by.get(u.groupId);
    if (!g) {
      g = { id: u.groupId, updates: [], ...u };
      by.set(u.groupId, g);
    }
    g.updates.push(u);
  }
  return [...by.values()].map((g) => ({
    ...g,
    platforms: g.updates.map((u) => u.platform).sort(),
    devices: g.updates.reduce((n, u) => n + (u.deviceCount ?? 0), 0),
    rolledBack: g.updates.every((u) => u.status === "rolled_back"),
    rolloutPct: Math.min(...g.updates.map((u) => u.rolloutPct)),
    runtimes: [...new Set(g.updates.map((u) => u.runtimeVersion))],
  }));
}

/** The newest active update per channel + platform + runtime: what phones get. */
function liveIds() {
  const seen = new Set();
  const live = new Set();
  for (const u of state.updates) {
    if (u.status !== "active") continue;
    const k = `${u.channel}|${u.platform}|${u.runtimeVersion}`;
    if (seen.has(k)) continue;
    seen.add(k);
    live.add(u.id);
  }
  return live;
}

const channels = () => {
  const seen = [...new Set(state.updates.map((u) => u.channel))];
  for (const c of ["production", "staging"]) if (!seen.includes(c)) seen.push(c);
  if (channel && !seen.includes(channel)) seen.push(channel);
  return seen;
};

function guessPlatform() {
  const ps = new Set(state.updates.slice(0, 20).map((u) => u.platform));
  if (ps.size === 1) return [...ps][0];
  return "all";
}

// ---------------------------------------------------------------- render
function render() {
  renderFilters();
  renderList();
  renderFooter();
}

function renderFilters() {
  const chans = [...new Set(state.updates.map((u) => u.channel))];
  if (state.filter !== "all" && !chans.includes(state.filter)) state.filter = "all";
  $("#filters").innerHTML = ["all", ...chans]
    .map(
      (c) =>
        `<button class="chip ${state.filter === c ? "on" : ""}" data-f="${esc(c)}">${c === "all" ? "All channels" : esc(c)}</button>`,
    )
    .join("");
}
$("#filters").onclick = (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  state.filter = b.dataset.f;
  store.set(appKey("filter"), state.filter);
  render();
};

function visibleGroups() {
  return groups().filter((g) => state.filter === "all" || g.channel === state.filter);
}

function renderList() {
  const list = $("#update-list");
  const banner = $("#banner");
  banner.hidden = !state.listError;
  banner.textContent = state.listError ? `Couldn't load updates:\n${state.listError}` : "";
  $("#refresh").innerHTML = state.loading ? icon("loader", "spin") : icon("refresh");
  const gs = visibleGroups();
  $("#update-count").textContent = state.updates.length ? `(${groups().length})` : "";
  if (!gs.length) {
    list.innerHTML = `<div class="empty">${state.loading ? "Loading updates…" : state.listError ? "" : "No updates yet.\nWrite a message below and press Publish."}</div>`;
    return;
  }
  const live = liveIds();
  list.innerHTML = gs
    .map((g) => {
      const isLive = g.updates.some((u) => live.has(u.id));
      const tags = [
        `<span class="tag ${g.channel === "production" ? "prod" : ""}">${esc(g.channel)}</span>`,
        isLive ? `<span class="tag live">live</span>` : "",
        g.rolledBack ? `<span class="tag rolled">rolled back</span>` : "",
        !g.rolledBack && g.rolloutPct < 100 ? `<span class="tag partial">${g.rolloutPct}%</span>` : "",
      ].join("");
      const meta = [
        tags,
        `<span>${esc(g.platforms.join(" + "))}</span>`,
        `<span title="${esc(fullDate(g.createdAt))}">${esc(ago(g.createdAt))}</span>`,
        `<span>${g.devices} device${g.devices === 1 ? "" : "s"}</span>`,
        g.gitSha
          ? `<span class="mono" title="git commit">${esc(g.gitSha.slice(0, 7))}${g.gitSha.endsWith("-dirty") ? "*" : ""}</span>`
          : "",
        `<span class="mono" title="runtime version">rt ${esc(g.runtimes.map((r) => r.slice(0, 8)).join(","))}</span>`,
        g.sourceUpdateId ? `<span title="Promoted or republished from another update">↻</span>` : "",
      ].join("");
      return `<div class="upd ${g.rolledBack ? "rolled" : ""} ${g.id === state.selected ? "selected" : ""}" data-g="${esc(g.id)}">
        <div class="body"><div class="subject ${g.message ? "" : "none"}" title="${esc(g.message ?? "")}">${esc(g.message || "(no message)")}</div><div class="meta">${meta}</div></div>
        <button class="icon-btn more" title="Actions">${icon("more")}</button></div>`;
    })
    .join("");
}

const groupById = (id) => groups().find((g) => g.id === id);

$("#update-list").addEventListener("click", (e) => {
  const row = e.target.closest(".upd");
  if (!row) return;
  select(row.dataset.g);
  if (e.target.closest(".more")) openMenu(e.target.closest(".more"), groupMenu(groupById(row.dataset.g)));
});
$("#update-list").addEventListener("contextmenu", (e) => {
  const row = e.target.closest(".upd");
  if (!row) return;
  e.preventDefault();
  select(row.dataset.g);
  openMenu(null, groupMenu(groupById(row.dataset.g)), { x: e.clientX, y: e.clientY });
});
$("#update-list").addEventListener("dblclick", (e) => {
  const row = e.target.closest(".upd");
  if (row) showDetails(groupById(row.dataset.g));
});

function select(id) {
  state.selected = id;
  for (const el of document.querySelectorAll(".upd")) el.classList.toggle("selected", el.dataset.g === id);
  document.querySelector(".upd.selected")?.scrollIntoView({ block: "nearest" });
}

let platform = null; // "android" | "ios" | "all"
let channel = "production";

function renderFooter() {
  const a = state.app;
  if (!a) return;
  $("#app-btn").textContent = a.name;
  $("#app-btn").title = `${tilde(a.dir)}\nSwitch app (Ctrl P)`;
  $("#git-info").innerHTML = a.sha
    ? `<span>${esc(a.branch || "detached")}</span><span class="mono">${esc(a.sha)}</span>${a.dirty ? `<span class="dirty" title="Uncommitted changes. They are included in what you publish.">● uncommitted</span>` : ""}`
    : `<span>not a git repo</span>`;
  const s = state.settings;
  const server = $("#server");
  if (s) {
    const host = s.server.replace(/^https?:\/\//, "");
    server.textContent = s.auth === "none" ? "not signed in" : host;
    server.className = s.auth === "none" ? "bad" : "";
    server.title = `Server: ${s.server}\nAuth: ${s.auth === "token" ? `API token from ${tilde(s.env_file)}` : s.auth === "login" ? "tidepush login" : "none: add TIDEPUSH_TOKEN to the .env or run tidepush login"}\nCLI: ${tilde(s.cli)}`;
  }

  for (const b of document.querySelectorAll("#platforms button")) b.classList.toggle("on", b.dataset.p === platform);
  const prod = channel === "production";
  $("#channel-name").textContent = channel;
  $("#channel-btn").classList.toggle("prod", prod);
  const busy = !!state.job;
  const pb = $("#publish-btn");
  pb.classList.toggle("prod", prod);
  pb.disabled = busy || !$("#msg").value.trim();
  pb.innerHTML = busy ? `${icon("loader", "spin")} Working…` : `Publish to ${esc(channel)}`;
  $("#publish-menu").disabled = busy;

  renderRuntime();

  const live = state.updates.find((u) => u.channel === channel && u.status === "active");
  $("#live-text").innerHTML = live
    ? `Live on ${esc(channel)}: <b>${esc(live.message || "(no message)")}</b> · ${esc(ago(live.createdAt))}`
    : `Nothing published to ${esc(channel)} yet`;
}

const platformsFor = (p) => (p === "all" ? ["android", "ios"] : [p]);

function renderRuntime() {
  const el = $("#runtime-text");
  if (!platform) {
    el.textContent = "";
    return;
  }
  const parts = platformsFor(platform).map((p) => {
    const r = state.runtime[p];
    const label = platform === "all" ? `${p} ` : "";
    if (!r || r.pending) return `<span>${label}runtime ${icon("loader", "spin")}</span>`;
    if (r.error) return `<span class="bad" title="${esc(r.error)}">${label}runtime: couldn't resolve</span>`;
    const same = state.updates.filter((u) => u.platform === p && u.channel === channel && u.runtimeVersion === r.value);
    const status = same.length
      ? `<span class="good" title="Phones running this native build already get updates from ${esc(channel)}">✓ matches ${esc(channel)}</span>`
      : `<span class="warn" title="No ${esc(channel)} update has this runtime. Only installs built from this native code will get it; existing installs won't.">new runtime: needs a new build</span>`;
    return `<span>${label}runtime</span><span class="mono" title="${esc(r.value)}">${esc(r.value.slice(0, 10))}</span>${status}`;
  });
  el.innerHTML = parts.join("<span>·</span>");
}

let runtimeSeq = 0;
async function resolveRuntime() {
  if (!state.app || !platform) return;
  const seq = ++runtimeSeq;
  const ps = platformsFor(platform);
  for (const p of ps) state.runtime[p] = { pending: true };
  renderRuntime();
  await Promise.all(
    ps.map(async (p) => {
      try {
        const value = await invoke("runtime_version", { platform: p, channel });
        if (seq === runtimeSeq) state.runtime[p] = { value };
      } catch (e) {
        if (seq === runtimeSeq) state.runtime[p] = { error: String(e) };
      }
    }),
  );
  if (seq === runtimeSeq) renderRuntime();
}

// ---------------------------------------------------------------- composer
const msg = $("#msg");
msg.addEventListener("input", () => {
  store.set(appKey("draft"), msg.value);
  renderFooter();
});
$("#reset-msg").onclick = () => {
  msg.value = defaultMessage();
  store.set(appKey("draft"), "");
  renderFooter();
};
$("#platforms").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const before = platformsFor(platform ?? "all");
  platform = b.dataset.p;
  store.set(appKey("platform"), platform);
  renderFooter();
  if (platformsFor(platform).some((p) => !before.includes(p) || !state.runtime[p])) resolveRuntime();
};
$("#channel-btn").onclick = (e) => {
  openMenu(e.currentTarget, [
    ...channels().map((c) => ({ label: c, checked: c === channel, run: () => setChannel(c) })),
    "-",
    {
      label: "Other channel…",
      run: async () => {
        const c = await askText("Channel name", "e.g. staging, preview, qa");
        if (c) setChannel(c);
      },
    },
  ]);
};
function setChannel(c) {
  channel = c;
  store.set(appKey("channel"), c);
  renderFooter();
}

$("#publish-btn").onclick = () => publish();
$("#publish-menu").onclick = (e) =>
  openMenu(e.currentTarget, [
    { label: `Publish to ${channel}…`, hint: "Ctrl Enter", run: () => publish() },
    { label: "Dry run (export only, nothing uploaded)", run: () => publish({ dryRun: true }) },
    "-",
    { label: "Use last commit as the message", run: () => $("#reset-msg").click() },
    { label: "Check the runtime version again", run: () => resolveRuntime() },
  ]);
$("#runtime-check").onclick = () => resolveRuntime();

function rolloutValue() {
  const n = Number($("#rollout").value);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    toast("Rollout must be a whole number from 1 to 100", true);
    return null;
  }
  return n;
}

async function publish({ dryRun = false } = {}) {
  if (state.job) return;
  const message = msg.value.trim();
  if (!message && !dryRun) return toast("Write a message first", true);
  const pct = rolloutValue();
  if (pct == null || !platform) return;
  await refreshApp();
  const a = state.app;
  const rts = platformsFor(platform)
    .map((p) => `${p} ${state.runtime[p]?.value?.slice(0, 12) ?? "(resolved during publish)"}`)
    .join(", ");
  const newRuntime = platformsFor(platform).some(
    (p) =>
      state.runtime[p]?.value &&
      !state.updates.some(
        (u) => u.platform === p && u.channel === channel && u.runtimeVersion === state.runtime[p].value,
      ),
  );
  const notes = [
    a.dirty ? "Uncommitted changes in the app are included in this update." : "",
    newRuntime ? `No ${channel} update has this runtime yet: phones on the current store build won't receive it.` : "",
    channel === "production" && !dryRun ? "This goes to every production install on this runtime." : "",
  ].filter(Boolean);
  const ok = await dialog(
    `<div class="modal-title">${dryRun ? "Dry run" : `Publish to ${esc(channel)}?`}</div>${summary([
      ["App", `${a.name}  ${tilde(a.dir)}`],
      ["Commit", a.sha ? `${a.branch} ${a.sha}${a.dirty ? " + uncommitted changes" : ""}` : "—", "mono"],
      ["Channel", channel],
      ["Platforms", platformsFor(platform).join(" + ")],
      ["Runtime", rts, "mono"],
      ["Rollout", `${pct}% of devices`],
      ["Message", message || "—"],
    ])}${notes.length ? `<div class="modal-note">${esc(notes.join("\n"))}</div>` : ""}`,
    { ok: dryRun ? "Run dry run" : `Publish to ${channel}`, danger: channel === "production" && !dryRun },
  );
  if (!ok) return;
  const args = ["publish", "--channel", channel, "--platform", platform, "--rollout", String(pct)];
  if (message) args.push("-m", message);
  if (dryRun) args.push("--dry-run");
  runJob(dryRun ? `Dry run for ${channel}` : `Publishing to ${channel}`, args, {
    onSuccess: () => {
      if (dryRun) return toast("Dry run finished. Nothing was uploaded.");
      toast(`Published to ${channel}`);
      msg.value = "";
      store.set(appKey("draft"), "");
      setTab("updates");
    },
  });
}

// ---------------------------------------------------------------- update actions
function groupMenu(g) {
  if (!g) return [];
  const others = channels().filter((c) => c !== g.channel);
  return [
    ...others.map((c) => ({ label: `Promote to ${c}…`, run: () => promote(g, c) })),
    { label: "Promote to another channel…", run: () => promote(g) },
    "-",
    { label: "Change rollout…", disabled: g.rolledBack, run: () => changeRollout(g) },
    "-",
    { label: "Roll back…", danger: true, disabled: g.rolledBack, run: () => rollback(g, false) },
    { label: "Roll back to the store build…", danger: true, disabled: g.rolledBack, run: () => rollback(g, true) },
    "-",
    { label: "Details", run: () => showDetails(g) },
    { label: "Copy group id", run: () => copy(g.id) },
    { label: "Reuse message", run: () => reuseMessage(g) },
  ];
}

function groupSummary(g) {
  return summary([
    ["Update", g.message || "(no message)"],
    ["Channel", g.channel],
    ["Platforms", g.platforms.join(" + ")],
    ["Published", `${fullDate(g.createdAt)}${g.createdBy ? ` by ${g.createdBy}` : ""}`],
    ["Devices", String(g.devices)],
    ["Group", g.id, "mono"],
  ]);
}

async function promote(g, to) {
  if (!to) {
    to = await askText("Promote to which channel?", "channel name");
    if (!to) return;
  }
  const pct = await dialog(
    `<div class="modal-title">Promote to ${esc(to)}?</div>${groupSummary(g)}
     <div class="field"><span>Rollout on ${esc(to)}</span><input type="number" min="1" max="100" value="100" id="pct" />%</div>
     <div class="modal-note">${to === "production" ? "The exact same bundle goes to every production install on this runtime." : "The exact same bundle, no rebuild."}</div>`,
    {
      ok: `Promote to ${to}`,
      danger: to === "production",
      focus: "#pct",
      collect: (m) => {
        const n = Number($("#pct", m).value);
        if (!Number.isInteger(n) || n < 1 || n > 100) {
          toast("Rollout must be 1–100", true);
          return null;
        }
        return n;
      },
    },
  );
  if (pct == null) return;
  runJob(`Promoting to ${to}`, ["promote", g.id, "--to", to, "--rollout", String(pct)], {
    onSuccess: () => toast(`Promoted to ${to}`),
  });
}

async function changeRollout(g) {
  const presets = [10, 25, 50, 100];
  const pct = await dialog(
    `<div class="modal-title">Change rollout</div>${groupSummary(g)}
     <div class="presets">${presets.map((p) => `<button class="btn" data-p="${p}">${p}%</button>`).join("")}</div>
     <div class="field"><span>Share of devices</span><input type="number" min="0" max="100" value="${g.rolloutPct}" id="pct" />%</div>
     <div class="modal-note">Currently ${g.rolloutPct}%. 0 stops new devices from getting it.</div>`,
    {
      ok: "Set rollout",
      focus: "#pct",
      collect: (m) => {
        const n = Number($("#pct", m).value);
        if (!Number.isInteger(n) || n < 0 || n > 100) {
          toast("Rollout must be 0–100", true);
          return null;
        }
        return n;
      },
    },
  );
  if (pct == null) return;
  runJob(`Setting rollout to ${pct}%`, ["rollout", g.id, String(pct)], {
    onSuccess: () => toast(`Rollout set to ${pct}%`),
  });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".presets button");
  if (b) $("#modal #pct").value = b.dataset.p;
});

async function rollback(g, toEmbedded) {
  const ok = await dialog(
    `<div class="modal-title">${toEmbedded ? "Roll back to the store build?" : "Roll back this update?"}</div>${groupSummary(g)}
     <div class="modal-note">${
       toEmbedded
         ? `Phones on ${esc(g.channel)} drop every OTA update and run the bundle that shipped inside the app.`
         : `Phones on ${esc(g.channel)} go back to the update before this one.`
     }</div>`,
    { ok: toEmbedded ? "Roll back to store build" : "Roll back", danger: true },
  );
  if (!ok) return;
  const args = ["rollback", g.id];
  if (toEmbedded) args.push("--to-embedded");
  runJob(toEmbedded ? "Rolling back to the store build" : "Rolling back", args, {
    onSuccess: () => toast("Rolled back"),
  });
}

function showDetails(g) {
  if (!g) return;
  const rows = g.updates.map((u) =>
    summary([
      [u.platform, u.id, "mono"],
      ["runtime", u.runtimeVersion, "mono"],
      [
        "rollout",
        `${u.rolloutPct}% · ${u.status.replace("_", " ")}${u.rolledBackAt ? ` ${fullDate(u.rolledBackAt)}` : ""}`,
      ],
      ["devices", String(u.deviceCount ?? 0)],
      ["assets", String(u.assetCount ?? "—")],
      u.sourceUpdateId ? ["from", u.sourceUpdateId, "mono"] : null,
    ]),
  );
  dialog(
    `<div class="modal-title">${esc(g.message || "(no message)")}</div>${summary([
      ["Channel", g.channel],
      ["Published", `${fullDate(g.createdAt)}${g.createdBy ? ` by ${g.createdBy}` : ""}`],
      ["Commit", g.gitSha ?? "—", "mono"],
      ["Group", g.id, "mono"],
    ])}${rows.join("")}`,
    { ok: "Close" },
  );
}

async function askText(title, placeholder) {
  const v = await dialog(
    `<div class="modal-title">${esc(title)}</div><div class="field"><input type="text" id="txt" placeholder="${esc(placeholder)}" /></div>`,
    {
      focus: "#txt",
      collect: (m) => {
        const s = $("#txt", m).value.trim();
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(s)) {
          toast("Use letters, numbers, dots, dashes or underscores", true);
          return null;
        }
        return s;
      },
    },
  );
  return v || null;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast(text);
  }
}

// ---------------------------------------------------------------- jobs (CLI runs)
const log = $("#log");
function logLine(text, cls = "") {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  el.textContent = text;
  const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  log.append(el);
  while (log.childElementCount > 5000) log.firstElementChild.remove();
  if (stick) log.scrollTop = log.scrollHeight;
}

function classify(text, err) {
  if (/^✔/.test(text)) return "ok";
  if (/^✖|error/i.test(text)) return "bad";
  if (/^!|warn/i.test(text)) return "warn";
  if (/^•/.test(text)) return "step";
  return err ? "err" : "";
}

listen("job-line", (e) => {
  const text = stripAnsi(e.payload.text);
  if (text.trim()) logLine(text, classify(text, e.payload.err));
});

listen("job-done", async (e) => {
  const job = state.job;
  state.job = null;
  const { code, cancelled } = e.payload;
  const ok = code === 0 && !cancelled;
  const dot = $("#job-dot");
  dot.className = ok ? "ok" : "fail";
  $("#job-cancel").hidden = true;
  $("#job-title").textContent =
    `${job?.title ?? "Job"}: ${cancelled ? "cancelled" : ok ? "done" : `failed (exit ${code})`}`;
  logLine(cancelled ? "Cancelled." : ok ? "Done." : `Exited with ${code}.`, ok ? "ok" : "bad");
  if (ok) job?.onSuccess?.();
  else if (!cancelled) {
    const last = [...log.querySelectorAll(".bad")].pop()?.textContent;
    toast(`${job?.title ?? "Job"} failed${last ? `:\n${last}` : ""}`, true);
    setTab("output");
  }
  renderFooter();
  await Promise.all([loadUpdates(), refreshApp()]);
});

async function runJob(title, args, { onSuccess } = {}) {
  if (state.job) return toast("Something is already running", true);
  state.job = { title, onSuccess };
  const shown = args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
  logLine(`$ tidepush ${shown}`, "cmd");
  $("#job-title").innerHTML = `${icon("loader", "spin")} ${esc(title)}…`;
  $("#job-cancel").hidden = false;
  $("#job-dot").hidden = false;
  $("#job-dot").className = "run";
  setTab("output");
  renderFooter();
  try {
    await invoke("run_job", { args });
  } catch (e) {
    state.job = null;
    $("#job-cancel").hidden = true;
    $("#job-title").textContent = `${title}: couldn't start`;
    logLine(String(e), "bad");
    toast(String(e), true);
    renderFooter();
  }
}

$("#job-cancel").onclick = async () => {
  const ok = await dialog(`<div class="modal-text">Stop "${esc(state.job?.title ?? "")}"?</div>`, {
    ok: "Stop",
    danger: true,
  });
  if (ok) call("cancel_job");
};
$("#job-clear").onclick = () => {
  log.innerHTML = "";
};

// ---------------------------------------------------------------- tabs / keys
function setTab(tab) {
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === tab);
  $("#updates-view").hidden = tab !== "updates";
  $("#output-view").hidden = tab !== "output";
  if (tab === "output") log.scrollTop = log.scrollHeight;
}
for (const t of document.querySelectorAll(".tab")) t.onclick = () => setTab(t.dataset.tab);
$("#refresh").onclick = () => Promise.all([loadUpdates(), refreshApp()]);
$("#app-btn").onclick = appSwitcher;
$("#welcome-project").onclick = appSwitcher;
$("#welcome-open").onclick = pickFolder;

document.addEventListener("keydown", (e) => {
  const modalOpen = !$("#modal-backdrop").hidden;
  if (e.key === "Escape") {
    if (!$("#menu").hidden) return closeMenu();
    if (modalOpen) return closeModal();
  }
  if (modalOpen) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === "p") {
    e.preventDefault();
    appSwitcher();
  } else if (e.ctrlKey && k === "o") {
    e.preventDefault();
    pickFolder();
  } else if (!state.app) {
    return;
  } else if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    publish();
  } else if (e.ctrlKey && k === "r") {
    e.preventDefault();
    loadUpdates();
    refreshApp();
  } else if (e.ctrlKey && e.key === "1") {
    setTab("updates");
  } else if (e.ctrlKey && e.key === "2") {
    setTab("output");
  } else if (document.activeElement === $("#update-list")) {
    const gs = visibleGroups();
    const i = gs.findIndex((g) => g.id === state.selected);
    if (e.key === "ArrowDown" || k === "j") select(gs[Math.min(i + 1, gs.length - 1)]?.id);
    else if (e.key === "ArrowUp" || k === "k") select(gs[Math.max(i - 1, 0)]?.id);
    else if (e.key === "Enter") showDetails(groupById(state.selected));
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      const row = $(".upd.selected");
      if (row) openMenu($(".more", row), groupMenu(groupById(state.selected)));
    } else return;
    e.preventDefault();
  }
});

// Pick up new commits when the window comes back into focus.
window.addEventListener("focus", () => {
  if (state.app && !state.job) refreshApp();
});

// ---------------------------------------------------------------- start
(async () => {
  state.settings = await invoke("settings").catch(() => null);
  const s = state.settings;
  if (s) {
    $("#welcome-settings").textContent =
      `${s.auth === "none" ? "Not signed in" : `Server ${s.server}`}\nCredentials: ${tilde(s.env_file)}${s.env_found ? "" : " (missing)"}`;
  }
  const target = await invoke("launch_path").catch(() => null);
  const last = await invoke("last_app").catch(() => null);
  const opened =
    (target && (await openApp(target, { quiet: true }))) || (last && (await openApp(last, { quiet: true })));
  if (!opened) {
    $("#welcome").hidden = false;
    discoverApps();
  }
})();

function reuseMessage(g) {
  msg.value = g.message ?? "";
  store.set(appKey("draft"), msg.value);
  renderFooter();
}
