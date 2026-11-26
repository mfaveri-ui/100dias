// Envia o aviso do horário para os celulares cadastrados em push/inscricoes.json.
// O texto é montado no próprio celular, com base no que ainda falta no dia.
const fs = require("fs");
const webpush = require("web-push");

const PUBLIC = "BOVOm8924fp6bq16sMXwzYna1eEcGu59NiZNBJ1mp8Fb4It1_qd5uW_1QLrUK5cMcK5b9f0DpMlvOsIJh58Rq4U";
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
if (!PRIVATE) { console.log("Falta o segredo VAPID_PRIVATE_KEY em Settings → Secrets → Actions."); process.exit(1); }
webpush.setVapidDetails("mailto:avisos@100dias.app", PUBLIC, PRIVATE);

// Horários de Brasília, em minutos desde a meia-noite, por dia da semana (0 = domingo).
// Rotina de nov/2026: um aviso para cada evento do dia.
const BASE = { acordar: 150, revleve: 160, estudo: 175, agua: 600, almoco: 720, jantar: 1020, fechar: 1140 };
const UTIL = { banho: 390, moinho: 450, moinho2: 810, revisao: 1080 };
const TAB = {
  0: Object.assign({}, BASE, { treino: 330, familia: 405, tarde: 840, semanal: 1080 }),
  1: Object.assign({}, BASE, UTIL, { questoes: 330 }),
  2: Object.assign({}, BASE, UTIL, { treino: 330 }),
  3: Object.assign({}, BASE, UTIL, { questoes: 330 }),
  4: Object.assign({}, BASE, UTIL, { treino: 330 }),
  5: Object.assign({}, BASE, UTIL, { questoes: 330 }),
  6: Object.assign({}, BASE, { questoes: 330, banho: 390, moinho: 450, tarde: 840, revisao: 1080 })
};
// Cada agendamento do GitHub diz qual aviso é, mesmo que a fila atrase o disparo.
const CRON = {
  "27 5 * * *": () => "acordar",
  "37 5 * * *": () => "revleve",
  "52 5 * * *": () => "estudo",
  "27 8 * * *": dow => (dow === 0 || dow === 2 || dow === 4) ? "treino" : "questoes",
  "27 9 * * 1-6": () => "banho",
  "42 9 * * 0": () => "familia",
  "27 10 * * 1-6": () => "moinho",
  "57 12 * * *": () => "agua",
  "57 14 * * *": () => "almoco",
  "27 16 * * 1-5": () => "moinho2",
  "57 16 * * 0,6": () => "tarde",
  "57 19 * * *": () => "jantar",
  "57 20 * * *": dow => dow === 0 ? "semanal" : "revisao",
  "57 21 * * *": () => "fechar"
};

function brNow() { const d = new Date(Date.now() - 3 * 3600e3); return { dow: d.getUTCDay(), m: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
function slotDoCron() {
  const c = (process.env.CRON || "").trim();
  return CRON[c] ? CRON[c](brNow().dow) : null;
}
function slotAgora() {
  const t = brNow(), tab = TAB[t.dow];
  let best = null, dist = 1e9;
  for (const [s, v] of Object.entries(tab)) {
    const diff = t.m - v;               // atraso do agendamento (positivo) ou adiantamento (negativo)
    if (diff >= -10 && diff <= 50 && Math.abs(diff) < dist) { best = s; dist = Math.abs(diff); }
  }
  return best;
}

(async () => {
  const slot = (process.env.SLOT || "").trim() || slotDoCron() || slotAgora();
  if (!slot) { console.log("Nenhum aviso para este horário."); return; }
  let subs = [];
  try { subs = JSON.parse(fs.readFileSync(__dirname + "/inscricoes.json", "utf8")); } catch (e) {}
  if (!Array.isArray(subs)) subs = [subs];
  subs = subs.filter(s => s && s.endpoint);
  if (!subs.length) { console.log("Nenhum celular cadastrado em push/inscricoes.json."); return; }
  const payload = JSON.stringify({ s: slot, at: new Date().toISOString() });
  for (const sub of subs) {
    try {
      const r = await webpush.sendNotification(sub, payload, { TTL: 3600, urgency: "high" });
      console.log("Aviso '" + slot + "' enviado:", r.statusCode);
    } catch (e) {
      console.log("Falha ao enviar '" + slot + "':", e.statusCode || "", e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) console.log("Esta inscrição expirou: ative de novo no app e mande o código novo.");
    }
  }
})();
