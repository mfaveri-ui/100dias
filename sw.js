// Funciona offline: guarda o app no celular e usa a cópia guardada sem internet.
// Também recebe os avisos diários e monta o texto com o que ainda falta no dia.
const VERSION = "v8-2026-11-26";
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
function tgt(h, C) {
  if (h.prevT && C.n <= h.prevT.u) return (C.we && h.prevT.tw) ? +h.prevT.tw : +h.prevT.t;
  if (h.tdow && C.n >= (h.tdowFrom || 1) && h.tdow[C.dow] != null && h.tdow[C.dow] !== "") return +h.tdow[C.dow];
  return (C.we && h.targetWeekend) ? +h.targetWeekend : +h.target;
}
function active(h, C) {
  if (h.from75 && C.n < C.s75) return false;
  if (h.fromN && C.n < h.fromN) return false;
  if (h.untilN != null && C.n > h.untilN) return false;
  if (h.dows && C.n >= (h.dowsFrom || 1) && h.dows.indexOf(C.dow) < 0) return false;
  return true;
}
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
const TREINO = { 2: ["🏃 Treino: corrida de qualidade", "40–45 min. Aquecimento de 10 min antes dos tiros. Ainda escuro: colete refletivo e lanterna."],
  4: ["💪 Treino: força + corrida leve", "45–50 min: circuito de força e 10–15 min de corrida leve no fim."],
  0: ["🏃 Treino: longão", "60–75 min em ritmo de conversa. Água antes e depois."] };

function compose(slot, S) {
  const app = "Toque para abrir o app.";
  if (!S || !S.startDate) {
    const G = { acordar: ["⏰ Bom dia", "Luz forte, água e 5 min de movimento."], fechar: ["🔥 Fechar o dia", "Registre o que falta no app."] };
    const g = G[slot] || ["100 dias", "Hora de mais uma etapa da rotina."];
    return { title: g[0], body: g[1] + " " + app };
  }
  const C = ctx(S), H = id => findH(S, id), P = id => pending(H(id), C);
  if (C.n < 1) return { title: "O desafio ainda não começou", body: "Ajuste a data de início em Mais → Ajustes." };
  switch (slot) {
    case "acordar":
      return { title: "⏰ Dia " + C.n + ". Ativação", body: "Luz mais forte da casa, copo d'água, Alpha GPC e 5 min de movimento. Celular longe. Comece a estudar até 02h45." };
    case "estudo":
      return { title: "📚 Estudo principal até 05h30", body: (P("engrenar") ? "Comece pela tarefa que você deixou definida ontem. " : "") + "Pausa de 5 min a cada 50–60 min." };
    case "treino": {
      if (!P("treino")) return { title: "✓ Treino já marcado", body: "Banho, refeição e bom dia de trabalho." };
      const t = TREINO[C.dow] || ["🏃 Treino do dia", "Marque no app ao terminar."];
      return { title: t[0], body: t[1] + " Dia apertado: corte o treino, nunca o sono." };
    }
    case "questoes": {
      const qp = C.d.qp || [], qr = C.d.qr || {}, mats = S.qmat || [];
      const nm = id => { const m = mats.filter(x => x.id === id)[0]; return m ? String(m.name).split(" (")[0].split(" e ")[0] : id; };
      const tot = qp.reduce((a, x) => a + (+x.q || 0), 0) || tgt(H("quest") || {}, C) || 30;
      const feitas = Object.keys(qr).reduce((a, k) => a + (+(qr[k].q || 0)), 0);
      const pre = C.dow === 6 ? "Estudo extra: bateria de questões. " : "Estudo extra: questões, lei seca ou flashcards. ";
      if (feitas >= tot) return { title: "✓ Questões do dia feitas", body: pre + feitas + " questões registradas." };
      const lista = qp.length ? qp.map(x => nm(x.s) + " " + x.q).join(" · ") : "Abra o app para ver o roteiro do dia.";
      return { title: "🎯 " + (feitas ? "Faltam " + (tot - feitas) + " questões" : tot + " questões de hoje"), body: pre + lista };
    }
    case "agua":
      if (!P("agua")) return { title: "✓ Água do dia marcada", body: "Siga firme." };
      return { title: "💧 Água", body: "Meta: 2,5 a 3 L no dia. Garrafa sempre por perto." };
    case "almoco": {
      const tr = C.dow === 0 || C.dow === 2 || C.dow === 4;
      return { title: "🍽️ Almoço e suplementos", body: "Proteína, arroz, feijão e salada, sem exagero. Q10, vitamina D+K e creatina" + (tr ? "" : " + farinha de beterraba") + "." + (C.we ? "" : " Depois, 30 min de questões curtas ou flashcards.") };
    }
    case "tarde":
      return C.dow === 6
        ? { title: "📝 Simulado ou bateria de questões", body: "14h às 17h. Matérias de maior peso, no estilo da banca." }
        : { title: "📚 Estudo da tarde", body: "Caderno de Erros, revisões D+7/D+30 ou discursiva. Depois, tempo livre sem culpa." };
    case "revisao":
      return { title: "📚 Caderno de Erros e véspera", body: "Magnésio. " + (P("erros") ? "30 min de Caderno de Erros, reincidências primeiro. " : "Caderno de Erros já marcado ✓ ") + (P("tarefa") ? "Depois, defina a 1ª tarefa de amanhã." : "") };
    case "semanal":
      return { title: "🗓️ Revisão da semana", body: "Magnésio. 15 min: horas, acertos por matéria e o que ajustar. Deixe a 1ª tarefa de segunda definida." };
    case "fechar": default: {
      const pend = allHabits(S).filter(h => pending(h, C));
      if (pend.length) return { title: "🔥 Faltam " + pend.length + " itens para fechar o dia", body: pend.slice(0, 4).map(h => short(h.label)).join(" · ") + (pend.length > 4 ? "…" : "") };
      return { title: "✓ Dia " + C.n + " vencido", body: "Tudo registrado. Telas desligadas e cama às 19h30." };
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
