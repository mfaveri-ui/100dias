// Envia o aviso do horário para os celulares cadastrados em push/inscricoes.json.
// O texto é montado no próprio celular, com base no que ainda falta no dia.
const fs = require("fs");
const webpush = require("web-push");

const PUBLIC = "BOVOm8924fp6bq16sMXwzYna1eEcGu59NiZNBJ1mp8Fb4It1_qd5uW_1QLrUK5cMcK5b9f0DpMlvOsIJh58Rq4U";
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
if (!PRIVATE) { console.log("Falta o segredo VAPID_PRIVATE_KEY em Settings → Secrets → Actions."); process.exit(1); }
webpush.setVapidDetails("mailto:avisos@100dias.app", PUBLIC, PRIVATE);

// Horários de Brasília, em minutos desde a meia-noite, por dia da semana (0 = domingo)
const UTIL = { acordar: 150, treino: 175, estudo: 210, questoes: 310, agua: 600, almoco: 720, revisao: 1050, fechar: 1170 };
const SAB = { acordar: 150, treino: 175, estudo: 210, agua: 600, almoco: 720, questoes: 810, fechar: 1170 };
const DOM = { acordar: 150, estudo: 180, treino: 360, questoes: 540, agua: 600, leitura: 810, revisao: 870, semanal: 1020, fechar: 1170 };

function slotAgora() {
  const d = new Date(Date.now() - 3 * 3600e3), dow = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const tab = dow === 0 ? DOM : dow === 6 ? SAB : UTIL;
  let best = null, dist = 1e9;
  for (const [s, t] of Object.entries(tab)) {
    const diff = m - t;               // atraso do agendamento (positivo) ou adiantamento (negativo)
    if (diff >= -10 && diff <= 50 && Math.abs(diff) < dist) { best = s; dist = Math.abs(diff); }
  }
  return best;
}

(async () => {
  const slot = (process.env.SLOT || "").trim() || slotAgora();
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
