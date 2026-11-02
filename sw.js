// Funciona offline: guarda o app no celular e usa a cópia guardada sem internet.
// Também recebe os avisos diários e monta o texto com o que ainda falta no dia.
const VERSION = "v5-2026-11-02";
const APP = "app-" + VERSION;
const FONTS = "fonts-v1";
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== APP && k !== FONTS).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONTS).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => {
      caches.open(APP).then(c => c.put("index.html", r.clone()));
      return r;
    }).catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});

// ---------- avisos ----------
function loadState() {
  return new Promise(res => {
    try {
      const rq = indexedDB.open("cem-dias", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
      rq.onsuccess = () => {
        try {
          const db = rq.result, g = db.transaction("kv").objectStore("kv").get("S");
          g.onsuccess = () => { res(g.result || null); db.close(); };
          g.onerror = () => { res(null); db.close(); };
        } catch (e) { res(null); }
      };
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
function brNow() {
  // horário de Brasília (UTC-3, sem horário de verão)
  const d = new Date(Date.now() - 3 * 3600e3);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() };
}
function parseYmd(s) { const p = (s || "").split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function ctx(S) {
  const t = brNow(), today = Date.UTC(t.y, t.mo, t.d);
  const n = Math.round((today - parseYmd(S.startDate)) / 864e5) + 1;
  const s75 = S.c75 && S.c75.start ? Math.max(1, Math.round((parseYmd(S.c75.start) - parseYmd(S.startDate)) / 864e5) + 1) : 1;
  const d = (S.days || {})[n] || {};
  return { n, dow: t.dow, we: t.dow === 0 || t.dow === 6, s75, d, c: d.c || {}, v: d.v || {} };
}
function allHabits(S) { const H = S.habits || {}; let r = []; Object.keys(H).forEach(k => { r = r.concat(H[k] || []); }); return r; }
function findH(S, id) { return allHabits(S).filter(h => h.id === id)[0]; }
function tgt(h, C) { return (C.we && h.targetWeekend) ? +h.targetWeekend : +h.target; }
function active(h, C) { return !h.from75 || C.n >= C.s75; }
function pending(h, C) {
  if (!h || !active(h, C) || h.type === "money") return false;
  const v = C.v[h.id];
  if (h.type === "check") return !C.c[h.id];
  if (h.type === "limit") return v === undefined || v === "" || v === null;
  const t = tgt(h, C);
  return (+(v || 0)) < (t || 1);
}
function fail75(h, C) {
  if (!h.h75 || !active(h, C) || h.type === "money") return false;
  if (h.type === "num" && h.min75 != null && h.min75 !== "") {
    const m = (C.we && h.min75w != null && h.min75w !== "") ? +h.min75w : +h.min75;
    const v = C.v[h.id];
    return !(v != null && v !== "" && +v >= m);
  }
  return pending(h, C);
}
function short(label) { return String(label || "").split(":")[0].split("(")[0].trim(); }
const TREINO = { 1: "Calistenia A", 2: "Corrida intervalada", 3: "Calistenia B", 4: "Corda intervalada", 5: "Calistenia C", 6: "Corda técnica", 0: "Corrida do domingo" };

function compose(slot, S) {
  const app = "Toque para abrir o app.";
  if (!S || !S.startDate) {
    const G = { acordar: ["⏰ Bom dia", "Água e nada de celular."], fechar: ["🔥 Fechar o dia", "Registre o que falta no app."] };
    const g = G[slot] || ["100 dias", "Hora de mais uma etapa da rotina."];
    return { title: g[0], body: g[1] + " " + app };
  }
  const C = ctx(S), H = id => findH(S, id), P = id => pending(H(id), C);
  if (C.n < 1) return { title: "O desafio ainda não começou", body: "Ajuste a data de início em Mais → Ajustes." };
  switch (slot) {
    case "acordar":
      return { title: "⏰ Dia " + C.n + " de 100. Bom dia", body: "Água e nada de celular." + (P("oracao") ? " Depois, 15 min de oração e leitura sagrada." : "") };
    case "treino":
      if (!P("treino")) return { title: "✓ Treino já marcado", body: P("foto") ? "Só falta a foto de progresso." : "Siga para o estudo." };
      return { title: "🏃 " + (TREINO[C.dow] || "Treino do dia") + ": 30 min", body: "Depois, foto de progresso. Marque no app ao terminar." + (C.dow === 2 ? " Corrida no escuro: colete refletivo e lanterna." : "") };
    case "estudo":
      return { title: "📚 Estudo: teoria nova", body: "Celular em outro cômodo. Abra o app para cronometrar o bloco." };
    case "questoes": {
      const qp = C.d.qp || [], qr = C.d.qr || {}, mats = S.qmat || [];
      const nm = id => { const m = mats.filter(x => x.id === id)[0]; return m ? String(m.name).split(" (")[0].split(" e ")[0] : id; };
      const tot = qp.reduce((a, x) => a + (+x.q || 0), 0) || tgt(H("quest") || {}, C) || 30;
      const feitas = Object.keys(qr).reduce((a, k) => a + (+(qr[k].q || 0)), 0);
      if (feitas >= tot) return { title: "✓ Questões do dia feitas", body: feitas + " questões registradas." };
      const lista = qp.length ? qp.map(x => nm(x.s) + " " + x.q).join(" · ") : "Abra o app para ver o roteiro do dia.";
      return { title: "🎯 " + (feitas ? "Faltam " + (tot - feitas) + " questões" : tot + " questões de hoje"), body: lista };
    }
    case "agua":
      if (!P("agua")) return { title: "✓ Água do dia marcada", body: "Siga firme." };
      return { title: "💧 Água: 1ª garrafa até as 10h", body: "Meta do dia: 3,8 L em 4 garrafas." };
    case "almoco":
      return { title: "🍽️ Fim do jejum", body: "Almoço do plano." + (P("leitura") ? " Depois, 10 páginas e 20 min de flashcards." : " Leitura já feita ✓") + (P("jejum") ? " Marque o jejum no app." : "") };
    case "leitura":
      if (!P("leitura")) return { title: "✓ Leitura já feita", body: "10 páginas registradas." };
      return { title: "📖 10 páginas", body: "Regra do 75. Registre no app." };
    case "revisao":
      return { title: "📚 Revisões e Caderno de Erros", body: (P("erros") ? "Reincidências primeiro, depois quase-erros." : "Caderno de Erros já marcado ✓") + " Nada de matéria nova." };
    case "semanal":
      return { title: "🗓️ Revisão da semana", body: "Revisão semanal, cobertura do edital e backup. Depois, cardápio e marmitas." };
    case "fechar": default: {
      const pend = allHabits(S).filter(h => pending(h, C));
      const miss = allHabits(S).filter(h => fail75(h, C));
      if (miss.length) return { title: "⚠️ Faltam " + miss.length + (miss.length > 1 ? " regras" : " regra") + " do 75", body: miss.slice(0, 4).map(h => short(h.label)).join(" · ") + ". Sem elas, a contagem volta ao dia 1." };
      if (pend.length) return { title: "🔥 Faltam " + pend.length + " itens para fechar o dia", body: pend.slice(0, 4).map(h => short(h.label)).join(" · ") + (pend.length > 4 ? "…" : "") };
      return { title: "✓ Dia " + C.n + " vencido", body: "Tudo registrado. Durma às 20h." };
    }
  }
}
function show(slot) {
  return loadState().then(S => {
    const m = compose(slot, S);
    return self.registration.showNotification(m.title, {
      body: m.body, tag: "cem-" + slot, renotify: true,
      icon: "icon-192.png", badge: "icon-192.png", data: { url: "./" }
    });
  });
}
self.addEventListener("push", e => {
  let slot = "fechar";
  try { const j = e.data ? e.data.json() : {}; if (j && j.s) slot = j.s; } catch (err) {}
  e.waitUntil(show(slot));
});
self.addEventListener("message", e => {
  if (e.data && e.data.type === "teste") e.waitUntil(show(e.data.s || "fechar"));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow("./");
  }));
});
