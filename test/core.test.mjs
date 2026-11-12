import * as C from "../docs/core.js"; import { rows } from "./load.mjs";
const R = rows(); console.log("rows", R.length);
C.CLOCK.tz = "Africa/Cairo"; C.loadDocs(R);
console.log("today", C.iso(C.today()), "hour", C.nowHour());
const snap = C.brainSnapshot(); console.log(snap.slice(0, 1500)); console.log("snapshot bytes", snap.length, "system bytes", C.brainSystem().length);
for (const q of ["what's for today?", "add call the accountant tomorrow high 30 min", "spent 250 on uber", "how much did I spend?", "what's overdue", "weekly report", "should I hire someone?", "ايه اللي ورايا النهارده"]) {
  const r = await C.freeBrain(q); console.log("\n>", q, "\n", r ? (r.text.slice(0, 300) + "\n ops: " + JSON.stringify(r.ops.map(o => o.label))) : "(not understood -> Haiku)");
}
const p = C.parsePlan('Sure ```json\n{"reply":"I\'ll add it — ok","actions":[{"op":"create","section":"tasks","fields":{"text":"Renew domain","date":"2026-11-14","link":"Sulta"}},{"op":"settings","action":"set_budget","category":"Transport","amount":3000},{"op":"update","section":"todos","id":"x"}]}\n```');
console.log(p.reply); const prep = C.prepareActions(p.actions); console.log(JSON.stringify(prep, null, 1).slice(0, 900));
console.log(C.readData({ section: "businesses" }).slice(0, 300));
console.log(C.toTelegramHtml("**Today**\n- Call <x> & co\n# Head"));
