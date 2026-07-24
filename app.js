(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const els = {
    homeView: $("#homeView"),
    gameView: $("#gameView"),
    nameInput: $("#nameInput"),
    roomInput: $("#roomInput"),
    homeStatus: $("#homeStatus"),
    createRoomBtn: $("#createRoomBtn"),
    joinRoomBtn: $("#joinRoomBtn"),
    roomCodeText: $("#roomCodeText"),
    copyLinkBtn: $("#copyLinkBtn"),
    leaveBtn: $("#leaveBtn"),
    participantsList: $("#participantsList"),
    playerCount: $("#playerCount"),
    itemLabelInput: $("#itemLabelInput"),
    imageInput: $("#imageInput"),
    imagePreviewWrap: $("#imagePreviewWrap"),
    imagePreview: $("#imagePreview"),
    addItemBtn: $("#addItemBtn"),
    gameStatus: $("#gameStatus"),
    hostPanel: $("#hostPanel"),
    finishBtn: $("#finishBtn"),
    syncText: $("#syncText"),
    board: $("#board"),
    itemsLayer: $("#itemsLayer"),
    itemTemplate: $("#itemTemplate"),
    endedOverlay: $("#endedOverlay"),
    resultsPanel: $("#resultsPanel"),
    downloadReportBtn: $("#downloadReportBtn"),
    downloadJsonBtn: $("#downloadJsonBtn")
  };

  const state = {
    roomCode: "",
    myName: "",
    myId: "",
    isHost: false,
    peer: null,
    hostConn: null,
    conns: new Map(),
    participants: {},
    items: [],
    ended: false,
    selectedImage: "",
    drag: null,
    lastMoveSent: 0
  };

  const savedName = localStorage.getItem("hmo-name");
  if (savedName) els.nameInput.value = savedName;

  const roomFromUrl = new URLSearchParams(location.search).get("room");
  if (roomFromUrl) els.roomInput.value = sanitizeRoom(roomFromUrl);

  function setStatus(target, message = "") {
    target.textContent = message;
  }

  function sanitizeRoom(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  }

  function randomCode(length = 6) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const cryptoBytes = new Uint32Array(length);
    crypto.getRandomValues(cryptoBytes);
    return Array.from(cryptoBytes, n => alphabet[n % alphabet.length]).join("");
  }

  function randomId(prefix = "id") {
    return `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  }

  function hostPeerId(roomCode) {
    return `hmocake-host-${roomCode}`;
  }

  function getCleanName() {
    const name = els.nameInput.value.trim().slice(0, 24);
    if (!name) throw new Error("Pon tu nombre primero 🥺");
    localStorage.setItem("hmo-name", name);
    return name;
  }

  function showGame() {
    els.homeView.classList.add("hidden");
    els.gameView.classList.remove("hidden");
    els.roomCodeText.textContent = state.roomCode;
    els.hostPanel.classList.toggle("hidden", !state.isHost);
    history.replaceState(null, "", `${location.pathname}?room=${encodeURIComponent(state.roomCode)}`);
    renderAll();
  }

  function resetToHome() {
    try { state.peer?.destroy(); } catch {}
    history.replaceState(null, "", location.pathname);
    location.reload();
  }

  function peerOptions() {
    // PeerJS usa su PeerServer Cloud por defecto.
    return { debug: 1 };
  }

  async function createRoom() {
    try {
      state.myName = getCleanName();
      state.roomCode = randomCode();
      state.isHost = true;
      state.myId = randomId("host");

      setStatus(els.homeStatus, "Creando sala…");

      // Usamos un ID determinista para que el código de sala sea suficiente para conectarse.
      state.peer = new Peer(hostPeerId(state.roomCode), peerOptions());

      state.peer.on("open", () => {
        state.participants[state.myId] = {
          id: state.myId,
          name: state.myName,
          isHost: true,
          joinedAt: new Date().toISOString()
        };
        setupHostListeners();
        showGame();
        els.syncText.textContent = "en vivo";
      });

      state.peer.on("error", (err) => {
        console.error(err);
        if (err.type === "unavailable-id") {
          // Extremadamente raro: generamos otro código.
          state.peer?.destroy();
          state.roomCode = randomCode();
          createRoomWithExistingName();
          return;
        }
        setStatus(els.homeStatus, `No pude crear la sala: ${err.type || err.message}`);
      });
    } catch (err) {
      setStatus(els.homeStatus, err.message);
    }
  }

  function createRoomWithExistingName() {
    state.peer = new Peer(hostPeerId(state.roomCode), peerOptions());
    state.peer.on("open", () => {
      state.participants[state.myId] = {
        id: state.myId,
        name: state.myName,
        isHost: true,
        joinedAt: new Date().toISOString()
      };
      setupHostListeners();
      showGame();
      els.syncText.textContent = "en vivo";
    });
    state.peer.on("error", (err) => setStatus(els.homeStatus, `No pude crear la sala: ${err.type || err.message}`));
  }

  function setupHostListeners() {
    state.peer.on("connection", (conn) => {
      state.conns.set(conn.peer, conn);

      conn.on("open", () => {
        conn.send({ type: "state", payload: serializableState() });
      });

      conn.on("data", (message) => {
        handleIncomingFromGuest(conn, message);
      });

      conn.on("close", () => {
        const participant = Object.values(state.participants).find(p => p.peerId === conn.peer);
        if (participant) {
          delete state.participants[participant.id];
          broadcast({ type: "state", payload: serializableState() });
          renderParticipants();
        }
        state.conns.delete(conn.peer);
      });

      conn.on("error", console.error);
    });
  }

  async function joinRoom() {
    try {
      state.myName = getCleanName();
      state.roomCode = sanitizeRoom(els.roomInput.value);
      if (state.roomCode.length !== 6) throw new Error("El código de sala debe tener 6 caracteres.");

      state.isHost = false;
      state.myId = randomId("guest");
      setStatus(els.homeStatus, "Buscando la sala…");

      state.peer = new Peer(peerOptions());

      state.peer.on("open", () => {
        const conn = state.peer.connect(hostPeerId(state.roomCode), {
          reliable: true,
          metadata: { name: state.myName }
        });
        state.hostConn = conn;

        const timeout = setTimeout(() => {
          if (!conn.open) setStatus(els.homeStatus, "No encontré esa sala. Revisa el código o que el host siga conectado.");
        }, 7000);

        conn.on("open", () => {
          clearTimeout(timeout);
          conn.send({
            type: "hello",
            payload: {
              id: state.myId,
              name: state.myName,
              joinedAt: new Date().toISOString()
            }
          });
          showGame();
          els.syncText.textContent = "en vivo";
        });

        conn.on("data", handleIncomingFromHost);

        conn.on("close", () => {
          els.syncText.textContent = "host desconectado";
          setStatus(els.gameStatus, "El anfitrión salió. La sala terminó.");
          state.ended = true;
          renderEnded();
        });

        conn.on("error", (err) => {
          console.error(err);
          setStatus(els.homeStatus, "No pude conectarme a esa sala.");
        });
      });

      state.peer.on("error", (err) => {
        console.error(err);
        setStatus(els.homeStatus, `Error de conexión: ${err.type || err.message}`);
      });
    } catch (err) {
      setStatus(els.homeStatus, err.message);
    }
  }

  function handleIncomingFromGuest(conn, message) {
    if (!message || typeof message !== "object") return;

    if (message.type === "hello") {
      const p = message.payload;
      state.participants[p.id] = {
        id: p.id,
        peerId: conn.peer,
        name: String(p.name || "Invitado").slice(0, 24),
        isHost: false,
        joinedAt: p.joinedAt || new Date().toISOString()
      };
      broadcast({ type: "state", payload: serializableState() });
      renderAll();
      return;
    }

    if (state.ended) return;

    const sender = Object.values(state.participants).find(p => p.peerId === conn.peer);
    if (!sender) return;

    if (message.type === "add-item") {
      const incoming = message.payload;
      if (!incoming || incoming.ownerId !== sender.id) return;
      const safeItem = sanitizeItem(incoming, sender);
      if (!safeItem) return;
      state.items.push(safeItem);
      broadcast({ type: "state", payload: serializableState() });
      renderItems();
      return;
    }

    if (message.type === "move-item") {
      const { id, x, y } = message.payload || {};
      const item = state.items.find(i => i.id === id);
      if (!item || item.ownerId !== sender.id) return;
      item.x = clamp(Number(x), 0, 92);
      item.y = clamp(Number(y), 0, 82);
      broadcastExcept(conn.peer, { type: "move-item", payload: { id, x: item.x, y: item.y } });
      renderItemPosition(id);
      return;
    }

    if (message.type === "delete-item") {
      const { id } = message.payload || {};
      const item = state.items.find(i => i.id === id);
      if (!item || item.ownerId !== sender.id) return;
      state.items = state.items.filter(i => i.id !== id);
      broadcast({ type: "delete-item", payload: { id } });
      renderItems();
    }
  }

  function handleIncomingFromHost(message) {
    if (!message || typeof message !== "object") return;

    if (message.type === "state") {
      applyRemoteState(message.payload);
      return;
    }

    if (message.type === "move-item") {
      const { id, x, y } = message.payload || {};
      const item = state.items.find(i => i.id === id);
      if (item) {
        item.x = x;
        item.y = y;
        renderItemPosition(id);
      }
      return;
    }

    if (message.type === "delete-item") {
      state.items = state.items.filter(i => i.id !== message.payload?.id);
      renderItems();
      return;
    }

    if (message.type === "ended") {
      state.ended = true;
      renderEnded();
    }
  }

  function sanitizeItem(raw, owner) {
    if (!raw?.image || typeof raw.image !== "string" || !raw.image.startsWith("data:image/")) return null;
    if (raw.image.length > 2_000_000) return null;
    return {
      id: String(raw.id || randomId("item")).slice(0, 80),
      ownerId: owner.id,
      ownerName: owner.name,
      label: String(raw.label || "Hear Me Out").slice(0, 60),
      image: raw.image,
      x: clamp(Number(raw.x), 0, 92),
      y: clamp(Number(raw.y), 0, 82),
      size: clamp(Number(raw.size || 112), 72, 160),
      rotation: clamp(Number(raw.rotation || 0), -14, 14),
      createdAt: raw.createdAt || new Date().toISOString()
    };
  }

  function serializableState() {
    return {
      roomCode: state.roomCode,
      participants: state.participants,
      items: state.items,
      ended: state.ended
    };
  }

  function applyRemoteState(remote) {
    if (!remote) return;
    state.participants = remote.participants || {};
    state.items = remote.items || [];
    state.ended = Boolean(remote.ended);
    renderAll();
  }

  function broadcast(message) {
    for (const conn of state.conns.values()) {
      if (conn.open) {
        try { conn.send(message); } catch (err) { console.warn(err); }
      }
    }
  }

  function broadcastExcept(peerId, message) {
    for (const [id, conn] of state.conns.entries()) {
      if (id !== peerId && conn.open) {
        try { conn.send(message); } catch (err) { console.warn(err); }
      }
    }
  }

  function sendToHost(message) {
    if (state.hostConn?.open) state.hostConn.send(message);
  }

  async function resizeImage(file) {
    if (!file || !file.type.startsWith("image/")) throw new Error("Elige una imagen válida.");

    const dataUrl = await fileToDataUrl(file);
    const img = await loadImage(dataUrl);

    const maxSide = 640;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", 0.78);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function onImageSelected() {
    try {
      const file = els.imageInput.files?.[0];
      if (!file) return;
      setStatus(els.gameStatus, "Preparando foto…");
      state.selectedImage = await resizeImage(file);
      els.imagePreview.src = state.selectedImage;
      els.imagePreviewWrap.classList.remove("hidden");
      setStatus(els.gameStatus, "");
    } catch (err) {
      setStatus(els.gameStatus, err.message);
    }
  }

  function addItem() {
    if (state.ended) return;
    const label = els.itemLabelInput.value.trim();
    if (!label) return setStatus(els.gameStatus, "Ponle nombre a tu Hear Me Out.");
    if (!state.selectedImage) return setStatus(els.gameStatus, "Elige una foto primero.");

    const item = {
      id: randomId("item"),
      ownerId: state.myId,
      ownerName: state.myName,
      label,
      image: state.selectedImage,
      x: 44 + (Math.random() * 8 - 4),
      y: 18 + (Math.random() * 8 - 4),
      size: window.innerWidth <= 560 ? 92 : 112,
      rotation: Math.round(Math.random() * 10 - 5),
      createdAt: new Date().toISOString()
    };

    if (state.isHost) {
      state.items.push(item);
      broadcast({ type: "state", payload: serializableState() });
      renderItems();
    } else {
      // Optimistic UI
      state.items.push(item);
      renderItems();
      sendToHost({ type: "add-item", payload: item });
    }

    els.itemLabelInput.value = "";
    els.imageInput.value = "";
    state.selectedImage = "";
    els.imagePreviewWrap.classList.add("hidden");
    setStatus(els.gameStatus, "Puesto en el cake ✨");
    setTimeout(() => setStatus(els.gameStatus, ""), 1200);
  }

  function renderAll() {
    renderParticipants();
    renderItems();
    renderEnded();
  }

  function renderParticipants() {
    els.participantsList.innerHTML = "";
    const people = Object.values(state.participants).sort((a, b) => {
      if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
      return String(a.joinedAt).localeCompare(String(b.joinedAt));
    });

    els.playerCount.textContent = people.length;

    for (const p of people) {
      const row = document.createElement("div");
      row.className = "participant";
      const dot = document.createElement("span");
      dot.className = "dot";
      const name = document.createElement("span");
      name.textContent = p.id === state.myId ? `${p.name} (tú)` : p.name;
      row.append(dot, name);
      if (p.isHost) {
        const crown = document.createElement("span");
        crown.className = "crown";
        crown.textContent = "👑";
        row.append(crown);
      }
      els.participantsList.append(row);
    }
  }

  function renderItems() {
    const known = new Map([...els.itemsLayer.children].map(node => [node.dataset.id, node]));
    const currentIds = new Set(state.items.map(i => i.id));

    for (const [id, node] of known) {
      if (!currentIds.has(id)) node.remove();
    }

    for (const item of state.items) {
      let node = els.itemsLayer.querySelector(`[data-id="${cssEscape(item.id)}"]`);
      if (!node) {
        node = els.itemTemplate.content.firstElementChild.cloneNode(true);
        node.dataset.id = item.id;
        node.querySelector("img").src = item.image;
        node.querySelector("img").alt = item.label;
        node.querySelector(".item-label").textContent = item.label;
        node.querySelector(".item-owner").textContent = `por ${item.ownerName}`;
        node.querySelector(".delete-item").addEventListener("click", (e) => {
          e.stopPropagation();
          deleteItem(item.id);
        });
        attachDrag(node, item.id);
        els.itemsLayer.append(node);
      }

      const owned = item.ownerId === state.myId && !state.ended;
      node.classList.toggle("owned", owned);
      node.style.setProperty("--size", `${item.size || 112}px`);
      node.style.left = `${item.x}%`;
      node.style.top = `${item.y}%`;
      node.style.transform = `translate(-50%, -30%) rotate(${item.rotation || 0}deg)`;
      node.style.pointerEvents = owned ? "auto" : "none";
    }
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function attachDrag(node, itemId) {
    node.addEventListener("pointerdown", (e) => {
      if (state.ended) return;
      const item = state.items.find(i => i.id === itemId);
      if (!item || item.ownerId !== state.myId) return;
      if (e.target.closest(".delete-item")) return;

      e.preventDefault();
      node.setPointerCapture(e.pointerId);
      node.classList.add("dragging");
      state.drag = { itemId, pointerId: e.pointerId };
      updateDraggedItem(e);
    });

    node.addEventListener("pointermove", (e) => {
      if (!state.drag || state.drag.itemId !== itemId || state.drag.pointerId !== e.pointerId) return;
      updateDraggedItem(e);
    });

    const end = (e) => {
      if (!state.drag || state.drag.itemId !== itemId) return;
      node.classList.remove("dragging");
      const item = state.items.find(i => i.id === itemId);
      if (item) sendMove(item, true);
      state.drag = null;
    };
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", end);
  }

  function updateDraggedItem(e) {
    const item = state.items.find(i => i.id === state.drag?.itemId);
    if (!item) return;

    const rect = els.board.getBoundingClientRect();
    item.x = clamp(((e.clientX - rect.left) / rect.width) * 100, 2, 98);
    item.y = clamp(((e.clientY - rect.top) / rect.height) * 100, 2, 86);
    renderItemPosition(item.id);

    const now = performance.now();
    if (now - state.lastMoveSent > 55) {
      state.lastMoveSent = now;
      sendMove(item, false);
    }
  }

  function sendMove(item, force) {
    const msg = { type: "move-item", payload: { id: item.id, x: item.x, y: item.y } };
    if (state.isHost) {
      broadcast(msg);
    } else {
      sendToHost(msg);
    }
  }

  function renderItemPosition(id) {
    const item = state.items.find(i => i.id === id);
    const node = els.itemsLayer.querySelector(`[data-id="${cssEscape(id)}"]`);
    if (!item || !node) return;
    node.style.left = `${item.x}%`;
    node.style.top = `${item.y}%`;
  }

  function deleteItem(id) {
    const item = state.items.find(i => i.id === id);
    if (!item || item.ownerId !== state.myId || state.ended) return;

    state.items = state.items.filter(i => i.id !== id);
    renderItems();

    if (state.isHost) {
      broadcast({ type: "delete-item", payload: { id } });
    } else {
      sendToHost({ type: "delete-item", payload: { id } });
    }
  }

  function finishGame() {
    if (!state.isHost || state.ended) return;
    state.ended = true;
    broadcast({ type: "ended" });
    broadcast({ type: "state", payload: serializableState() });
    renderEnded();
  }

  function renderEnded() {
    els.endedOverlay.classList.toggle("hidden", !state.ended);
    els.resultsPanel.classList.toggle("hidden", !(state.ended && state.isHost));
    els.addItemBtn.disabled = state.ended;
    els.itemLabelInput.disabled = state.ended;
    els.imageInput.disabled = state.ended;
    renderItems();
  }

  function reportData() {
    const participants = Object.values(state.participants)
      .sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)))
      .map(p => ({
        id: p.id,
        name: p.name,
        role: p.isHost ? "Anfitrión" : "Participante",
        joinedAt: p.joinedAt,
        entries: state.items
          .filter(i => i.ownerId === p.id)
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
          .map(i => ({
            label: i.label,
            createdAt: i.createdAt,
            image: i.image
          }))
      }));

    return {
      app: "Hear Me Out Cake",
      roomCode: state.roomCode,
      exportedAt: new Date().toISOString(),
      totalParticipants: participants.length,
      totalEntries: state.items.length,
      participants
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function downloadReport() {
    if (!state.isHost) return;
    const data = reportData();

    const sections = data.participants.map((p, index) => {
      const entries = p.entries.length
        ? p.entries.map((entry, idx) => `
          <article class="entry">
            <img src="${entry.image}" alt="">
            <div>
              <strong>${idx + 1}. ${escapeHtml(entry.label)}</strong>
              <small>${new Date(entry.createdAt).toLocaleString("es-MX")}</small>
            </div>
          </article>`).join("")
        : `<p class="empty">No añadió ningún Hear Me Out.</p>`;

      return `
        <section class="person">
          <div class="person-head">
            <h2>${escapeHtml(p.name)}</h2>
            <span>${escapeHtml(p.role)}</span>
          </div>
          <div class="entries">${entries}</div>
        </section>`;
    }).join("");

    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reporte Hear Me Out Cake · ${escapeHtml(data.roomCode)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#fff8fb;color:#2b202c}
  main{max-width:900px;margin:auto;padding:42px 24px}
  header{border-bottom:3px solid #2b202c;padding-bottom:20px;margin-bottom:30px}
  .eyebrow{text-transform:uppercase;letter-spacing:.18em;font-size:11px;font-weight:700;opacity:.55}
  h1{font-size:42px;margin:6px 0 10px}
  .meta{display:flex;gap:14px;flex-wrap:wrap;font-size:13px}
  .meta span{background:#f3e7ef;padding:7px 10px;border-radius:999px}
  .person{background:white;border:1px solid #eadde6;border-radius:18px;padding:20px;margin:18px 0;break-inside:avoid}
  .person-head{display:flex;justify-content:space-between;align-items:center;gap:15px}
  .person-head h2{margin:0}
  .person-head span{font-size:12px;opacity:.6}
  .entries{display:grid;gap:12px;margin-top:16px}
  .entry{display:grid;grid-template-columns:86px 1fr;gap:14px;align-items:center;padding:10px;background:#fff8fb;border-radius:14px}
  .entry img{width:86px;height:86px;object-fit:cover;border-radius:10px}
  .entry strong,.entry small{display:block}
  .entry small{margin-top:6px;opacity:.55}
  .empty{opacity:.55}
  footer{text-align:center;font-size:11px;opacity:.5;margin-top:30px}
  @media print{body{background:#fff}.person{box-shadow:none}}
</style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">Hear Me Out Cake · reporte de partida</div>
    <h1>Sala ${escapeHtml(data.roomCode)}</h1>
    <div class="meta">
      <span>${data.totalParticipants} participantes</span>
      <span>${data.totalEntries} Hear Me Outs</span>
      <span>${new Date(data.exportedAt).toLocaleString("es-MX")}</span>
    </div>
  </header>
  ${sections}
  <footer>Generado localmente por Hear Me Out Cake. Las fotos quedan dentro de este archivo.</footer>
</main>
</body>
</html>`;

    downloadBlob(
      new Blob([html], { type: "text/html;charset=utf-8" }),
      `hear-me-out-cake-${data.roomCode}.html`
    );
  }

  function downloadJson() {
    if (!state.isHost) return;
    const data = reportData();
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }),
      `hear-me-out-cake-${data.roomCode}.json`
    );
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyInvite() {
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.roomCode)}`;
    const text = `Únete a mi Hear Me Out Cake 🎂\nSala: ${state.roomCode}\n${url}`;
    try {
      await navigator.clipboard.writeText(text);
      els.copyLinkBtn.textContent = "¡Copiado!";
      setTimeout(() => els.copyLinkBtn.textContent = "Copiar invitación", 1200);
    } catch {
      prompt("Copia esta invitación:", text);
    }
  }

  function clamp(n, min, max) {
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  els.createRoomBtn.addEventListener("click", createRoom);
  els.joinRoomBtn.addEventListener("click", joinRoom);
  els.roomInput.addEventListener("input", () => {
    els.roomInput.value = sanitizeRoom(els.roomInput.value);
  });
  els.roomInput.addEventListener("keydown", e => {
    if (e.key === "Enter") joinRoom();
  });
  els.nameInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && els.roomInput.value) joinRoom();
  });
  els.imageInput.addEventListener("change", onImageSelected);
  els.addItemBtn.addEventListener("click", addItem);
  els.copyLinkBtn.addEventListener("click", copyInvite);
  els.leaveBtn.addEventListener("click", resetToHome);
  els.finishBtn.addEventListener("click", finishGame);
  els.downloadReportBtn.addEventListener("click", downloadReport);
  els.downloadJsonBtn.addEventListener("click", downloadJson);

  window.addEventListener("beforeunload", () => {
    try { state.peer?.destroy(); } catch {}
  });
})();
