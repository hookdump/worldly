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
  info: "",
  code: "",
  token: null,
  role: null, // host | player
  length: 5,
  guesses: [],
  draft: "",
  status: "waiting",
  secret: null,
  hasPlayer: false,
  kb: {},
};

let ws = null;

function fold(s) {
  const marked = s.toLowerCase().replaceAll("ñ", "\u0001");
  return marked.normalize("NFD").replace(/\p{M}/gu, "").replaceAll("\u0001", "ñ");
}
function onlyLetters(s) {
  return fold(s).replace(/[^a-zñ]/g, "");
}

function goHome() {
  closeWs();
  Object.assign(state, {
    view: "home",
    error: "",
    info: "",
    code: "",
    token: null,
    role: null,
    length: 5,
    guesses: [],
    draft: "",
    status: "waiting",
    secret: null,
    hasPlayer: false,
    kb: {},
  });
  render();
}

function header(extra = "", title = "Worldly") {
  return `<header class="brand">
    <h1 class="${title.startsWith("Salón") || title.startsWith("SALON") ? "salon" : ""}">${title}</h1>
    ${extra}
  </header>`;
}

function renderGrid() {
  const rows = [];
  for (let r = 0; r < MAX_ATTEMPTS; r++) {
    const guess = state.guesses[r];
    const isDraft = !guess && r === state.guesses.length && state.role === "player" && (state.status === "playing");
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
  if (state.role !== "player" || (state.status !== "playing" && state.status !== "waiting")) return "";
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
      <button class="btn primary" type="submit">Crear sala</button>
    </form>`;
  app.querySelector("input")?.focus();
}

function paintJoin() {
  app.innerHTML = `
    ${header(`<button class="link" data-go="home">Volver</button>`)}
    <div class="hero">
      <p class="lede">¿Tenés un código?</p>
      <p class="sub">Pedíselo a quien armó la sala.</p>
    </div>
    <form class="stack" id="join-form">
      <label class="field">Código de sala
        <input class="code" name="code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" maxlength="6" placeholder="MESA" />
      </label>
      <p class="msg">${escapeHtml(state.error)}</p>
      <button class="btn primary" type="submit">Entrar</button>
    </form>`;
  app.querySelector("input")?.focus();
}

function paintHost() {
  const wait = !state.hasPlayer && state.status === "waiting";
  const end = state.status === "won" || state.status === "lost";
  app.innerHTML = `
    ${header(`<button class="link" data-go="home">Salir</button>`, `Salón ${state.code}`)}
    <div class="card code-block">
      <div class="hint">Código para unirse</div>
      <div class="code">${state.code}</div>
      <div class="hint">${wait ? "Esperando a alguien…" : end ? "Partida terminada" : "Están jugando"}</div>
      <span class="quiet">Palabra lista</span>
    </div>
    <p class="status-line">${end ? endCopy() : wait ? "Las jugadas van a aparecer acá." : "Mirás, no jugás."}</p>
    ${renderGrid()}
    ${end ? `<div class="end"><h2>${state.status === "won" ? "La adivinaron" : "No la sacaron"}</h2><p class="secret">${escapeHtml(state.secret || "")}</p></div>` : ""}`;
}

function endCopy() {
  if (state.status === "won") return state.role === "player" ? "Ahí estaba." : "Ganó quien jugaba.";
  return state.role === "player" ? "Se acabaron los intentos." : "Se quedaron sin intentos.";
}

function paintPlay() {
  const end = state.status === "won" || state.status === "lost";
  app.innerHTML = `
    ${header(`<button class="link" data-go="home">Salir</button>`, `Salón ${state.code}`)}
    <p class="status-line">${end ? endCopy() : `${MAX_ATTEMPTS - state.guesses.length} intento${MAX_ATTEMPTS - state.guesses.length === 1 ? "" : "s"}`}</p>
    ${renderGrid()}
    ${end ? `<div class="end"><h2>${state.status === "won" ? "¡Bien!" : "Casi"}</h2><p>La palabra era</p><p class="secret">${escapeHtml(state.secret || "")}</p></div>` : ""}
    <p class="msg">${escapeHtml(state.error)}</p>
    ${end ? `<button class="btn primary" data-go="home">Otra</button>` : renderKeyboard()}`;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function render() {
  if (state.view === "home") paintHome();
  else if (state.view === "create") paintCreate();
  else if (state.view === "join") paintJoin();
  else if (state.view === "host") paintHost();
  else if (state.view === "play") paintPlay();
}

function applyState(data) {
  if (data.length) state.length = data.length;
  if (data.guesses) state.guesses = data.guesses;
  if (data.status) state.status = data.status;
  if (data.secret) state.secret = data.secret;
  if (typeof data.hasPlayer === "boolean") state.hasPlayer = data.hasPlayer;
  rebuildKb();
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

function closeWs() {
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
}

function connectWatch() {
  closeWs();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "watch", code: state.code }));
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "error") {
      state.error = msg.error;
      render();
      return;
    }
    if (msg.type === "state") {
      applyState(msg);
      render();
    }
  });
}

async function createRoom(word) {
  state.error = "";
  const res = await fetch("/api/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ word }),
  });
  const data = await res.json();
  if (!res.ok) {
    state.error = data.error || "No se pudo crear la sala.";
    render();
    return;
  }
  state.code = data.code;
  state.length = data.length;
  state.role = "host";
  state.view = "host";
  state.status = "waiting";
  state.guesses = [];
  connectWatch();
  render();
}

async function joinRoom(code) {
  state.error = "";
  const res = await fetch("/api/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok) {
    state.error = data.error || "No encontramos esa sala. Revisá el código.";
    render();
    return;
  }
  state.code = data.code;
  state.token = data.token;
  state.length = data.length;
  state.role = "player";
  state.view = "play";
  applyState(data);
  connectWatch();
  render();
}

async function submitGuess() {
  if (state.status !== "playing") return;
  const word = onlyLetters(state.draft);
  if (word.length !== state.length) {
    state.error = `Necesitás ${state.length} letras.`;
    render();
    return;
  }
  state.error = "";
  const res = await fetch("/api/guess", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: state.code, token: state.token, word }),
  });
  const data = await res.json();
  if (!res.ok) {
    state.error = data.error || "No se pudo enviar.";
    render();
    return;
  }
  state.draft = "";
  applyState(data);
  render();
}

function onKey(k) {
  if (state.view !== "play" || state.role !== "player" || state.status !== "playing") return;
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

app.addEventListener("click", (ev) => {
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
    joinRoom(String(code));
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

render();
