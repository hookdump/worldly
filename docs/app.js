const MAX_ATTEMPTS = 6;
const KEYS = [
  [..."qwertyuiop"],
  [..."asdfghjklñ"],
  ["entrar", ..."zxcvbnm", "borrar"],
];

const app = document.getElementById("app");
const state = {
  view: "home",
  error: "",
  code: "",
  secret: "",
  length: 5,
  guesses: [],
  draft: "",
  status: "playing",
  kb: {},
  shareUrl: "",
};
let dict = new Set();

function fold(s) {
  const marked = String(s).toLowerCase().replaceAll("ñ", "\u0001");
  return marked.normalize("NFD").replace(/\p{M}/gu, "").replaceAll("\u0001", "ñ");
}
function onlyLetters(s) {
  return fold(s).replace(/[^a-zñ]/g, "");
}

function encodeWord(word) {
  const b64 = btoa(unescape(encodeURIComponent(word)));
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decodeWord(code) {
  const pad = code.length % 4 === 0 ? "" : "=".repeat(4 - (code.length % 4));
  const b64 = code.replaceAll("-", "+").replaceAll("_", "/") + pad;
  try {
    return onlyLetters(decodeURIComponent(escape(atob(b64))));
  } catch {
    return "";
  }
}

function colorGuess(guess, secret) {
  const g = onlyLetters(guess);
  const s = onlyLetters(secret);
  const n = s.length;
  const colors = Array(n).fill("x");
  const remaining = {};
  for (let i = 0; i < n; i++) {
    if (g[i] === s[i]) colors[i] = "g";
    else remaining[s[i]] = (remaining[s[i]] || 0) + 1;
  }
  for (let i = 0; i < n; i++) {
    if (colors[i] === "g") continue;
    const ch = g[i];
    if (remaining[ch] > 0) {
      colors[i] = "y";
      remaining[ch]--;
    }
  }
  return colors;
}

function shareBase() {
  const u = new URL(location.href);
  u.hash = "";
  u.search = "";
  let href = u.href;
  if (!href.endsWith("/") && !href.endsWith(".html")) href += "/";
  return href.replace(/index\.html\/?$/, "");
}

function header(extra = "", title = "Worldly") {
  const salon = title.startsWith("Salón");
  return `<header class="brand">
    <h1 class="${salon ? "salon" : ""}">${title}</h1>
    ${extra}
  </header>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function goHome() {
  history.replaceState(null, "", shareBase() || "./");
  Object.assign(state, {
    view: "home",
    error: "",
    code: "",
    secret: "",
    length: 5,
    guesses: [],
    draft: "",
    status: "playing",
    kb: {},
    shareUrl: "",
  });
  render();
}

function renderGrid() {
  const rows = [];
  for (let r = 0; r < MAX_ATTEMPTS; r++) {
    const guess = state.guesses[r];
    const isDraft = !guess && r === state.guesses.length && state.status === "playing";
    const letters = guess
      ? [...guess.display]
      : isDraft
        ? [...state.draft.padEnd(state.length, " ")]
        : Array(state.length).fill(" ");
    const cells = letters
      .slice(0, state.length)
      .map((ch, i) => {
        const color = guess ? guess.colors[i] : "";
        const filled = !guess && isDraft && ch.trim();
        return `<div class="tile ${color} ${filled ? "filled" : ""}">${ch.trim() || ""}</div>`;
      })
      .join("");
    rows.push(`<div class="row" style="grid-template-columns:repeat(${state.length},1fr)">${cells}</div>`);
  }
  return `<div class="grid">${rows.join("")}</div>`;
}

function renderKeyboard() {
  if (state.status !== "playing") return "";
  const rows = KEYS.map((row) => {
    const keys = row
      .map((k) => {
        const cls = k.length === 1 ? state.kb[k] || "" : "";
        const wide = k.length > 1 ? "wide" : "";
        const label = k === "entrar" ? "Entrar" : k === "borrar" ? "Borrar" : k;
        return `<button class="key ${wide} ${cls}" data-key="${k}">${label}</button>`;
      })
      .join("");
    return `<div class="kb-row">${keys}</div>`;
  }).join("");
  return `<div class="keyboard">${rows}</div>`;
}

function paintHome() {
  app.innerHTML = `
    <div class="home" style="display:flex;flex-direction:column;flex:1">
    ${header()}
    <div class="hero">
      <p class="lede">El anfitrión elige la palabra. El resto juega.</p>
    </div>
    <div class="stack">
      <button class="btn primary" data-go="create">Crear sala</button>
      <button class="btn ghost" data-go="join">Unirse con código</button>
    </div>
    </div>`;
}

function paintCreate() {
  app.innerHTML = `
    ${header(`<button class="link" data-go="home">Volver</button>`)}
    <div class="hero">
      <p class="lede">Elegí la palabra secreta.</p>
      <p class="sub">De 4 a 8 letras. Tiene que estar en el diccionario.</p>
    </div>
    <form class="stack" id="create-form">
      <label class="field">Palabra
        <input class="word" name="word" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="12" placeholder="p. ej. mundo" />
      </label>
      <p class="msg">${escapeHtml(state.error)}</p>
      <button class="btn primary" type="submit">Armar link</button>
    </form>`;
  app.querySelector("input")?.focus();
}

function paintHost() {
  app.innerHTML = `
    ${header(`<button class="link" data-go="home">Salir</button>`, `Salón ${state.code}`)}
    <div class="card code-block">
      <div class="hint">Mandale este link a quien juega</div>
      <p class="share">${escapeHtml(state.shareUrl)}</p>
      <button class="btn primary" data-copy="${escapeHtml(state.shareUrl)}">Copiar link</button>
      <div class="hint" style="margin-top:12px">O el código</div>
      <div class="code">${escapeHtml(state.code)}</div>
      <span class="quiet">Palabra lista</span>
    </div>`;
}

function paintJoin() {
  app.innerHTML = `
    ${header(`<button class="link" data-go="home">Volver</button>`)}
    <div class="hero">
      <p class="lede">¿Tenés un código?</p>
      <p class="sub">O abrí el link que te mandaron.</p>
    </div>
    <form class="stack" id="join-form">
      <label class="field">Código de sala
        <input class="code" name="code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" maxlength="24" placeholder="código" />
      </label>
      <p class="msg">${escapeHtml(state.error)}</p>
      <button class="btn primary" type="submit">Entrar</button>
    </form>`;
  app.querySelector("input")?.focus();
}

function endCopy() {
  if (state.status === "won") return "Ahí estaba.";
  return "Se acabaron los intentos.";
}

function paintPlay() {
  const end = state.status === "won" || state.status === "lost";
  app.innerHTML = `
    ${header(`<button class="link" data-go="home">Salir</button>`, `Salón ${state.code}`)}
    <p class="status-line">${end ? endCopy() : `${MAX_ATTEMPTS - state.guesses.length} intento${MAX_ATTEMPTS - state.guesses.length === 1 ? "" : "s"}`}</p>
    ${renderGrid()}
    ${end ? `<div class="end"><h2>${state.status === "won" ? "¡Bien!" : "Casi"}</h2><p>La palabra era</p><p class="secret">${escapeHtml(state.secret)}</p></div>` : ""}
    <p class="msg">${escapeHtml(state.error)}</p>
    ${end ? `<button class="btn primary" data-go="home">Otra</button>` : renderKeyboard()}`;
}

function render() {
  if (state.view === "home") paintHome();
  else if (state.view === "create") paintCreate();
  else if (state.view === "host") paintHost();
  else if (state.view === "join") paintJoin();
  else if (state.view === "play") paintPlay();
}

function rebuildKb() {
  const kb = {};
  const rank = { x: 1, y: 2, g: 3 };
  for (const g of state.guesses) {
    const letters = [...g.display].map((ch) => fold(ch));
    letters.forEach((ch, i) => {
      const c = g.colors[i];
      if (!kb[ch] || rank[c] > rank[kb[ch]]) kb[ch] = c;
    });
  }
  state.kb = kb;
}

function createRoom(word) {
  state.error = "";
  const w = onlyLetters(word);
  if (w.length < 4 || w.length > 8) {
    state.error = "De 4 a 8 letras.";
    render();
    return;
  }
  if (!dict.has(w)) {
    state.error = "Esa no está en el diccionario.";
    render();
    return;
  }
  const code = encodeWord(w);
  state.secret = w;
  state.code = code;
  state.length = w.length;
  state.shareUrl = `${shareBase()}#${code}`;
  state.view = "host";
  render();
}

function startPlay(code) {
  const secret = decodeWord(code.trim());
  if (!secret || secret.length < 4 || secret.length > 8 || !dict.has(secret)) {
    state.view = "join";
    state.error = "No encontramos esa sala. Revisá el código.";
    render();
    return;
  }
  state.secret = secret;
  state.code = encodeWord(secret);
  state.length = secret.length;
  state.guesses = [];
  state.draft = "";
  state.status = "playing";
  state.kb = {};
  state.view = "play";
  history.replaceState(null, "", `${shareBase()}#${state.code}`);
  render();
}

function submitGuess() {
  if (state.status !== "playing") return;
  const word = onlyLetters(state.draft);
  if (word.length !== state.length) {
    state.error = `Necesitás ${state.length} letras.`;
    render();
    return;
  }
  if (!dict.has(word)) {
    state.error = "Esa no está en el diccionario.";
    render();
    return;
  }
  const colors = colorGuess(word, state.secret);
  state.guesses.push({ display: word, colors });
  state.draft = "";
  state.error = "";
  if (colors.every((c) => c === "g")) state.status = "won";
  else if (state.guesses.length >= MAX_ATTEMPTS) state.status = "lost";
  rebuildKb();
  render();
}

function onKey(k) {
  if (state.view !== "play" || state.status !== "playing") return;
  if (k === "entrar" || k === "enter") {
    submitGuess();
    return;
  }
  if (k === "borrar" || k === "backspace") {
    state.draft = state.draft.slice(0, -1);
    state.error = "";
    render();
    return;
  }
  if (!/^[a-zñ]$/.test(k)) return;
  if (state.draft.length >= state.length) return;
  state.draft += k;
  state.error = "";
  render();
}

app.addEventListener("click", async (ev) => {
  const copy = ev.target.closest("[data-copy]")?.dataset.copy;
  if (copy) {
    try { await navigator.clipboard.writeText(copy); } catch {}
    return;
  }
  const go = ev.target.closest("[data-go]")?.dataset.go;
  if (go === "home") goHome();
  if (go === "create") {
    state.view = "create";
    state.error = "";
    render();
  }
  if (go === "join") {
    state.view = "join";
    state.error = "";
    render();
  }
  const key = ev.target.closest("[data-key]")?.dataset.key;
  if (key) onKey(key);
});

app.addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (ev.target.id === "create-form") {
    const word = new FormData(ev.target).get("word") || "";
    createRoom(String(word));
  }
  if (ev.target.id === "join-form") {
    const code = new FormData(ev.target).get("code") || "";
    startPlay(String(code));
  }
});

window.addEventListener("keydown", (ev) => {
  if (state.view !== "play") return;
  if (ev.key === "Enter") {
    ev.preventDefault();
    onKey("entrar");
  } else if (ev.key === "Backspace") {
    ev.preventDefault();
    onKey("borrar");
  } else {
    const k = fold(ev.key);
    if (/^[a-zñ]$/.test(k)) {
      ev.preventDefault();
      onKey(k);
    }
  }
});

async function boot() {
  app.innerHTML = `${header()}<p class="status-line">Cargando diccionario…</p>`;
  const res = await fetch(new URL("words-es.txt", location.href));
  const text = await res.text();
  dict = new Set(
    text.split(/\s+/).map(onlyLetters).filter((w) => w.length >= 4 && w.length <= 8),
  );
  const hash = location.hash.replace(/^#/, "").trim();
  const q = new URLSearchParams(location.search).get("c");
  const incoming = hash || q || "";
  if (incoming) startPlay(incoming);
  else render();
}

boot();
