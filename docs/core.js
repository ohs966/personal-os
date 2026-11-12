// Personal OS core: data helpers and the assistant's brain.
// Shared by the web app (index.html) and the Supabase Edge Functions (bundled with esbuild).
// No browser APIs in here: anything browser-only lives in app.js, and the server swaps in shims.
const BRAIN = { notes: "" };
const S = { opts: null, goals: [], plans: [], ms: [], biz: [], pays: [], accts: [], bms: [], maint: [], decs: [], todos: [], money: [], fixed: [], ready: new Set(), db: null, readOnly: false, noDb: false };
const FREQ = { "Weekly": { perMonth: 52 / 12, days: 7 }, "Monthly": { perMonth: 1, months: 1 }, "Quarterly": { perMonth: 1 / 3, months: 3 },
  "Every 6 months": { perMonth: 1 / 6, months: 6 }, "Yearly": { perMonth: 1 / 12, months: 12 }, "One-off": { perMonth: 0 } };
const KINDS = ["Client", "Product"];
const RUN = ["Active", "Paused", "Stopped"];
const LISTS = {
  values: { label: "Values", note: "Each value has its own colour. Goals, plans and milestones take it on.", coloured: true },
  priorities: { label: "Priority", note: "The first one counts as top priority." },
  have: { label: "Have it?", note: "The first one means achieved. Anything else counts as still to get." },
  msStatus: { label: "Milestone status", note: "The first one means done. Ticking a milestone sets it." },
  bizTypes: { label: "Business type", note: "" },
  bizStatus: { label: "Business status", note: "The first one means active." },
  paidVia: { label: "Paid via", note: "" },
  acctCats: { label: "Client / product category", note: "Groups your clients and products, e.g. Retail, Wholesale, T-shirts." },
  acctStatus: { label: "Client / product status", note: "The first one means active. Active ones with no payout for 60 days get flagged." },
  maintCats: { label: "Maintenance category", note: "What the upkeep is for, e.g. Subscription, Website, Equipment." },
  contractTypes: { label: "Contract type", note: "How a client works with you, e.g. Retainer, Per order, Supply agreement." },
  payTerms: { label: "Payment terms", note: "When a client pays, e.g. Upfront, Net 30." },
  expenseCats: { label: "Expense category", note: "Personal spending groups on the Money tab. Each can have a monthly budget." },
  incomeCats: { label: "Income source", note: "Where personal money comes from, e.g. Salary, Business payout." },
};
const opt = k => (S.opts && Array.isArray(S.opts[k])) ? S.opts[k] : [];
const dueSoon = () => (S.opts && Number(S.opts.dueSoon) > 0) ? Number(S.opts.dueSoon) : 90;

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DAY = 86400000;
// CLOCK.tz lets the server compute "today" in Omar's timezone; the browser leaves it null and uses the device clock.
const CLOCK = { tz: null };
const today = () => {
  if (CLOCK.tz) { const p = new Intl.DateTimeFormat("en-CA", { timeZone: CLOCK.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
};
const nowHour = () => CLOCK.tz ? +new Intl.DateTimeFormat("en-GB", { timeZone: CLOCK.tz, hour: "2-digit", hourCycle: "h23" }).format(new Date()) : new Date().getHours();
const parse = s => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const days = (a, b) => Math.round((a - b) / DAY);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fdate = s => { const d = parse(s); return d ? `${String(d.getDate()).padStart(2, "0")} ${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : "-"; };
const money = n => (n == null || isNaN(n)) ? "-" : (Math.round(n) === 0 ? "-" : (n < 0 ? "(" + Math.round(-n).toLocaleString("en-US") + ")" : Math.round(n).toLocaleString("en-US")));
const pct = n => (n == null || isNaN(n)) ? "-" : Math.round(n * 100) + "%";
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const monthsBetween = (a, b) => { let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()); if (b.getDate() < a.getDate()) m--; return Math.max(0, m); };
const valueClass = v => { const i = opt("values").indexOf(v); return i >= 0 ? "c" + (i % 8) : ""; };
const bizIndex = id => S.biz.findIndex(b => b.id === id);
const bizClass = id => { const i = bizIndex(id); return i >= 0 ? "c" + (i % 8) : ""; };
const sortBiz = () => S.biz.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(b.name));

const KEYOF = { goals: "goals", plans: "plans", milestones: "ms", businesses: "biz", payouts: "pays", accounts: "accts", bizMilestones: "bms", maintenance: "maint", decisions: "decs", todos: "todos", money: "money", fixed: "fixed" };

function goalInfo(g) {
  const t = today(), achieved = !!opt("have")[0] && g.have === opt("have")[0];
  const target = parse(g.target);
  const d = (!achieved && target) ? days(target, t) : null;
  let timeline = "On track";
  if (achieved) timeline = "Achieved"; else if (!target) timeline = "No date"; else if (target < t) timeline = "Overdue"; else if (d <= dueSoon()) timeline = "Due soon";
  const months = d == null ? null : Math.max(1, Math.round(d / 30.44));
  const price = num(g.price);
  const save = (!achieved && price > 0 && months) ? price / months : 0;
  const plan = S.plans.find(p => p.goalId === g.id);
  return { achieved, days: d, timeline, save, price, plan, planPct: plan ? planInfo(plan).done : null };
}
function msOf(planId) { return S.ms.filter(m => m.planId === planId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }
function planInfo(p) {
  const g = S.goals.find(x => x.id === p.goalId), list = msOf(p.id), DONE = opt("msStatus")[0];
  const start = parse(p.start), target = g ? parse(g.target) : null, t = today();
  const dur = (start && target) ? days(target, start) : null;
  const used = (start && target) ? (target <= start ? 1 : Math.min(1, Math.max(0, (t - start) / (target - start)))) : null;
  const done = Math.min(1, list.filter(m => m.status === DONE).reduce((s, m) => s + num(m.worth), 0) / 100);
  let pace = "";
  if (done >= 1) pace = "Complete"; else if (used != null) pace = done >= used + .05 ? "Ahead" : done >= used - .05 ? "On pace" : "Behind";
  const pending = list.filter(m => m.status !== DONE);
  const next = pending.slice().sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"))[0] || null;
  let run = 0;
  const reaches = list.map(m => (run += num(m.worth), run));
  const totalWorth = run;
  return { g, list, start, target, dur, used, done, pace, next, reaches, totalWorth, doneCount: list.length - pending.length };
}
function bizInfo(b) {
  const pays = S.pays.filter(p => p.businessId === b.id);
  const rev = pays.reduce((s, p) => s + num(p.revenue), 0), exp = pays.reduce((s, p) => s + num(p.expenses), 0);
  const dates = pays.map(p => p.date).filter(Boolean).sort();
  const since = parse(b.start) || parse(dates[0]);
  const months = since ? monthsBetween(since, today()) : null;
  return { pays, count: pays.length, rev, exp, profit: rev - exp, margin: rev ? (rev - exp) / rev : null,
    last: dates[dates.length - 1] || null, months, perMonth: months == null ? null : pays.length / Math.max(1, months),
    running: months == null ? "Not started" : `${Math.floor(months / 12)} yr ${months % 12} mo` };
}
function addInterval(dateStr, freq) {
  const f = FREQ[freq], d = parse(dateStr) || today();
  if (!f || (!f.days && !f.months)) return "";
  return iso(f.days ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + f.days) : new Date(d.getFullYear(), d.getMonth() + f.months, d.getDate()));
}
function maintInfo(m) {
  const run = m.status || "Active", active = run === "Active";
  const perMonth = active ? num(m.cost) * ((FREQ[m.freq] || {}).perMonth || 0) : 0;
  const next = parse(m.next), dl = next ? days(next, today()) : null;
  const state = !active ? run : dl == null ? "No date" : dl < 0 ? "Overdue" : dl <= 14 ? "Due soon" : "OK";
  return { active, perMonth, dl, state };
}
const sumK = (a, k) => a.reduce((s, p) => s + num(p[k]), 0);
function bizStats(b) {
  const f = bizInfo(b), t = today(), m0 = new Date(t.getFullYear(), t.getMonth(), 1);
  const end = new Date(t.getFullYear(), t.getMonth() + 1, 1), from3 = new Date(m0.getFullYear(), m0.getMonth() - 2, 1), from6 = new Date(m0.getFullYear(), m0.getMonth() - 5, 1);
  const inR = (p, a, z) => { const d = parse(p.date); return d && d >= a && d < z; };
  const r3 = f.pays.filter(p => inR(p, from3, end)), r6 = f.pays.filter(p => inR(p, from6, from3));
  const first = f.pays.map(p => parse(p.date)).filter(Boolean).sort((a, c) => a - c)[0];
  const span = first ? Math.min(3, Math.max(1, monthsBetween(new Date(first.getFullYear(), first.getMonth(), 1), m0) + 1)) : 3;
  const avgRev = sumK(r3, "revenue") / span, avgProfit = (sumK(r3, "revenue") - sumK(r3, "expenses")) / span;
  const prevRev = sumK(r6, "revenue"), trend = prevRev ? sumK(r3, "revenue") / prevRev - 1 : null;
  const maint = S.maint.filter(m => m.businessId === b.id).map(m => ({ m, i: maintInfo(m) }));
  const maintMo = maint.reduce((s, x) => s + x.i.perMonth, 0);
  const maintOver = maint.filter(x => x.i.state === "Overdue").length, maintSoon = maint.filter(x => x.i.state === "Due soon").length;
  const ACT = opt("acctStatus")[0];
  const accts = S.accts.filter(a => a.businessId === b.id);
  const isActive = a => !a.status || a.status === ACT;
  const bySrc = accts.map(a => { const ps = f.pays.filter(p => p.accountId === a.id); const ds = ps.map(p => p.date).filter(Boolean).sort();
    const r3a = ps.filter(p => inR(p, from3, end)), upk = maint.filter(x => x.m.accountId === a.id);
    return { a, rev: sumK(ps, "revenue"), profit: sumK(ps, "revenue") - sumK(ps, "expenses"), n: ps.length, last: ds[ds.length - 1] || null,
      avgRev: sumK(r3a, "revenue") / span, avgProfit: (sumK(r3a, "revenue") - sumK(r3a, "expenses")) / span,
      maintMo: upk.reduce((s2, x) => s2 + x.i.perMonth, 0), maintN: upk.length, maintOver: upk.filter(x => x.i.state === "Overdue").length,
      nextMaint: upk.filter(x => x.i.active && x.m.next).map(x => x.m.next).sort()[0] || null }; }).sort((x, y) => y.rev - x.rev);
  const top = bySrc[0] && bySrc[0].rev > 0 ? bySrc[0] : null;
  const dormant = bySrc.filter(x => isActive(x.a) && (!x.last || days(t, parse(x.last)) > 60));
  const DONE = opt("msStatus")[0], ms = S.bms.filter(m => m.businessId === b.id);
  const msDone = ms.filter(m => m.status === DONE).length, msLate = ms.filter(m => m.status !== DONE && m.due && parse(m.due) < t).length;
  const nextMs = ms.filter(m => m.status !== DONE).sort((a, c) => (a.due || "9999").localeCompare(c.due || "9999"))[0] || null;
  return { ...f, avgRev, avgProfit, trend, maint, maintMo, maintOver, maintSoon, maintRatio: avgRev ? maintMo / avgRev : null, net: avgProfit - maintMo,
    accts, active: accts.filter(isActive), bySrc, top, topShare: top && f.rev ? top.rev / f.rev : null, dormant, untagged: f.pays.filter(p => !p.accountId).length,
    ms, msDone, msLate, nextMs, invest: sumK(ms, "invest"), investDone: sumK(ms.filter(m => m.status === DONE), "invest"),
    sinceLast: f.last ? days(t, parse(f.last)) : null };
}
function signals(rows) {
  const out = [], ACTB = opt("bizStatus")[0];
  rows.forEach(({ b, s }) => {
    const n = `<b>${esc(b.name)}</b>`, prod = s.top && s.top.a.kind === "Product";
    if (s.top && s.topShare >= 0.5 && s.bySrc.filter(x => x.rev > 0).length)
      out.push({ k: "top-"+b.id, biz: b.id, lv: "warn", t: `${n} gets ${pct(s.topShare)} of its revenue from one ${prod ? "product" : "client"}, <b>${esc(s.top.a.name)}</b>. ${prod ? "Push other products so one slow item doesn't sink the month." : "Win more clients so losing one doesn't sink the business."}` });
    if (s.net < 0 && (s.maintMo > 0 || s.count))
      out.push({ k: "net-"+b.id, biz: b.id, lv: "warn", t: `${n} costs more to keep running than it brings in: about ${money(-s.net)} EGP a month after maintenance. Cut upkeep or lift sales.` });
    else if (s.maintRatio != null && s.maintRatio >= 0.25)
      out.push({ k: "mratio-"+b.id, biz: b.id, lv: "warn", t: `Maintenance takes ${pct(s.maintRatio)} of ${n}'s monthly revenue. Check which subscriptions still pay for themselves.` });
    if (s.trend != null && s.trend <= -0.2) out.push({ k: "down-"+b.id, biz: b.id, lv: "warn", t: `${n} revenue is down ${pct(-s.trend)} on the 3 months before.` });
    if (s.trend != null && s.trend >= 0.2) out.push({ k: "up-"+b.id, biz: b.id, lv: "good", t: `${n} revenue is up ${pct(s.trend)} on the 3 months before. A good time to fund its next milestone.` });
    if (s.maintOver) out.push({ k: "mover-"+b.id, biz: b.id, lv: "warn", t: `${n} has ${s.maintOver} overdue maintenance ${s.maintOver === 1 ? "item" : "items"}.` });
    if (s.msLate) out.push({ k: "mslate-"+b.id, biz: b.id, lv: "warn", t: `${n} has ${s.msLate} late ${s.msLate === 1 ? "milestone" : "milestones"}.` });
    if ((b.status || ACTB) === ACTB && s.count && s.sinceLast > 45) out.push({ k: "nopay-"+b.id, biz: b.id, lv: "warn", t: `No payout from ${n} in ${s.sinceLast} days.` });
    s.bySrc.filter(x => x.maintMo > 0 && x.avgProfit < x.maintMo && (!x.a.status || x.a.status === opt("acctStatus")[0])).slice(0, 3).forEach(x =>
      out.push({ k: "srcmaint-"+b.id+"-"+x.a.id, biz: b.id, lv: "warn", t: `Keeping <b>${esc(x.a.name)}</b> (${n}) costs about ${money(x.maintMo)} EGP a month in maintenance, more than the ${money(Math.max(0, x.avgProfit))} EGP profit it brings. Raise the price, bill the upkeep, or cut it.` }));
    s.bySrc.filter(x => x.maintOver).slice(0, 3).forEach(x => out.push({ k: "srcover-"+b.id+"-"+x.a.id, biz: b.id, lv: "warn", t: `<b>${esc(x.a.name)}</b> (${n}) has overdue maintenance.` }));
    if (s.dormant.length) out.push({ k: "dormant-"+b.id, biz: b.id, lv: "info", t: `${s.dormant.length} active ${s.dormant.length === 1 ? "client or product" : "clients or products"} in ${n} with no payout for 60+ days: ${s.dormant.slice(0, 3).map(x => esc(x.a.name)).join(", ")}${s.dormant.length > 3 ? " and more" : ""}. Follow up or mark them paused.` });
    if (!s.accts.length) out.push({ k: "noacct-"+b.id, biz: b.id, lv: "info", t: `Add the clients or products behind ${n} to see where its money really comes from.` });
    else if (s.untagged && s.count) out.push({ k: "untag-"+b.id, biz: b.id, lv: "info", t: `${s.untagged} of ${n}'s payouts aren't linked to a client or product yet. Link them so the shares are accurate.` });
    if (!s.ms.length) out.push({ k: "noms-"+b.id, biz: b.id, lv: "info", t: `${n} has no development milestones. Add the next steps you want it to reach.` });
  });
  const earners = rows.filter(r => r.s.count);
  if (earners.length > 1) { const best = earners.slice().sort((a, c) => c.s.net - a.s.net)[0]; if (best.s.net > 0) out.push({ k: "best-"+best.b.id, biz: best.b.id, lv: "good", t: `<b>${esc(best.b.name)}</b> brings the most home: about ${money(best.s.net)} EGP a month after maintenance.` }); }
  const rank = { warn: 0, info: 1, good: 2 };
  return out.sort((a, c) => rank[a.lv] - rank[c.lv]);
}

// ---------------- views ----------------

const PRI = ["High", "Medium", "Low"];

const linkInfo = link => {
  const [k, id] = String(link || "").split(":");
  if (k === "goal") { const g = S.goals.find(x => x.id === id); return g ? { area: "Life", name: g.item, cls: valueClass(g.value) } : { area: "Life", name: "Removed goal", cls: "" }; }
  if (k === "biz") { const b = S.biz.find(x => x.id === id); return b ? { area: "Business", name: b.name, cls: bizClass(b.id) } : { area: "Business", name: "Removed business", cls: "" }; }
  if (k === "life") return { area: "Life", name: "Life", cls: "" };
  if (k === "business") return { area: "Business", name: "Business", cls: "" };
  return { area: "General", name: "", cls: "" };
};

function recommendations() {
  const out = [], t = today(), DONE = opt("msStatus")[0];
  const when = dl => dl < 0 ? `${-dl}d late` : dl === 0 ? "due today" : `due in ${dl}d`;
  S.plans.forEach(p => {
    const f = planInfo(p); if (!f.g) return;
    f.list.filter(m => m.status !== DONE && m.due).forEach(m => { const dl = days(parse(m.due), t);
      if (dl <= 14) out.push({ key: "ms-" + m.id, link: "goal:" + f.g.id, pri: dl <= 2 ? "High" : "Medium", text: `Work on "${m.name}" for ${f.g.item}`, why: `Plan milestone, ${when(dl)}` }); });
    if (f.pace === "Behind") out.push({ key: "behind-" + p.id, link: "goal:" + f.g.id, pri: "High", text: `Catch up on ${f.g.item}`, why: `Plan is behind: ${pct(f.done)} done with ${pct(f.used)} of the time used` });
  });
  S.goals.forEach(g => { const i = goalInfo(g);
    if (!i.achieved && !i.plan && (i.timeline === "Due soon" || i.timeline === "Overdue")) out.push({ key: "noplan-" + g.id, link: "goal:" + g.id, pri: "Medium", text: `Make a plan for ${g.item}`, why: `Goal is ${i.timeline.toLowerCase()} with no plan` });
    if (!i.achieved && i.save > 0 && t.getDate() <= 3) out.push({ key: "save-" + g.id + "-" + iso(t).slice(0, 7), link: "goal:" + g.id, pri: "Low", text: `Put aside ${money(i.save)} EGP for ${g.item}`, why: "Monthly saving to hit the target date" });
  });
  S.maint.forEach(m => { const i = maintInfo(m);
    if (i.active && i.dl != null && i.dl <= 7) out.push({ key: "mt-" + m.id + "-" + m.next, link: "biz:" + m.businessId, pri: i.dl <= 0 ? "High" : "Medium", text: `${m.item}: do the maintenance${num(m.cost) ? ` (${money(num(m.cost))} EGP)` : ""}`, why: `Maintenance, ${when(i.dl)}` }); });
  S.bms.filter(m => m.status !== DONE && m.due).forEach(m => { const dl = days(parse(m.due), t);
    if (dl <= 14) out.push({ key: "bms-" + m.id, link: "biz:" + m.businessId, pri: dl <= 2 ? "High" : "Medium", text: `Push "${m.name}" forward`, why: `Business milestone, ${when(dl)}` }); });
  S.decs.filter(d => !d.auto && !d.done && d.due && parse(d.due) <= new Date(t.getTime() + 2 * DAY)).forEach(d => out.push({ key: "dec-" + d.id, link: d.businessId ? "biz:" + d.businessId : "business", pri: "High", text: d.text, why: `Decision ${when(days(parse(d.due), t))}` }));
  const ACTB = opt("bizStatus")[0];
  S.biz.forEach(b => { const s = bizStats(b);
    s.dormant.slice(0, 2).forEach(x => out.push({ key: "follow-" + x.a.id + "-" + iso(t).slice(0, 7), link: "biz:" + b.id, pri: "Medium", text: `Follow up with ${x.a.name}`, why: x.last ? `No payout for ${days(t, parse(x.last))} days` : "Active, but no payout logged yet" }));
    if ((b.status || ACTB) === ACTB && s.count && s.sinceLast > 30) out.push({ key: "logpay-" + b.id + "-" + iso(t), link: "biz:" + b.id, pri: "Low", text: `Log any recent payouts for ${b.name}`, why: `Last payout logged ${s.sinceLast} days ago` });
  });
  const mk = iso(t).slice(0, 7), fixedDue = S.fixed.filter(f => num(f.day) <= t.getDate() && !S.money.some(x => x.fixedId === f.id && x.date && x.date.slice(0, 7) === mk));
  if (fixedDue.length) out.push({ key: "fixed-" + mk + "-" + fixedDue.length, link: "life", pri: "Medium", text: `Log ${fixedDue.length} fixed ${fixedDue.length === 1 ? "payment" : "payments"} on the Money tab`, why: fixedDue.slice(0, 3).map(f => f.note || f.category).join(", ") });
  const MM = monthMoney(mk), BG = budgets();
  Object.entries(MM.byCat).filter(([c, v]) => num(BG[c]) && v > num(BG[c])).slice(0, 2).forEach(([c, v]) => out.push({ key: "budget-" + c + "-" + mk, link: "life", pri: "Medium", text: `Slow down on ${c} this month`, why: `${money(v)} spent of a ${money(num(BG[c]))} EGP budget` }));
  const lb = S.opts && S.opts.lastBackup, lbAgo = lb ? days(t, parse(lb)) : null;
  if ((lbAgo == null || lbAgo >= 30) && (S.goals.length + S.pays.length + S.money.length + S.todos.length) > 0)
    out.push({ key: "backup-" + iso(t), link: "life", pri: lbAgo == null || lbAgo > 45 ? "High" : "Medium", text: "Download a backup of your tracker", why: lb ? `Last backup ${lbAgo} days ago` : "You haven't made a backup yet", action: "backup" });
  const used = new Set(S.todos.filter(x => x.recKey && (!x.done || x.date === iso(t) || x.dismissed)).map(x => x.recKey));
  const rank = { High: 0, Medium: 1, Low: 2 };
  return out.filter(r => !used.has(r.key)).sort((a, b) => rank[a.pri] - rank[b.pri]);
}
function taskStats() {
  const t = today(), real = S.todos.filter(x => !x.dismissed);
  const onDay = d => real.filter(x => x.date === d);
  let streak = 0;
  for (let i = 0; i < 400; i++) { const d = iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - i)); const n = real.filter(x => x.done && (x.doneAt || x.date) === d).length;
    if (n) streak++; else if (i > 0) break; }
  const last = n => { const from = iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - n + 1)); const xs = real.filter(x => x.date >= from && x.date <= iso(t)); return { all: xs.length, done: xs.filter(x => x.done).length }; };
  return { onDay, streak, w: last(7), m: last(30) };
}

const MKINDS = ["Expense", "Income"];
const mLabel = k => { const [y, m] = k.split("-"); return MON[+m - 1] + " " + y; };
const mShift = (k, n) => { const [y, m] = k.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
const budgets = () => (S.opts && S.opts.budgets && typeof S.opts.budgets === "object") ? S.opts.budgets : {};
const opening = () => ({ amount: num(S.opts && S.opts.openingBalance), month: (S.opts && S.opts.openingMonth) || "" });
function monthMoney(k) {
  const xs = S.money.filter(x => x.date && x.date.slice(0, 7) === k);
  const inc = xs.filter(x => x.kind === "Income"), exp = xs.filter(x => x.kind !== "Income");
  const income = sumK(inc, "amount"), spent = sumK(exp, "amount");
  const byCat = {}; exp.forEach(x => { const c = x.category || "Other"; byCat[c] = (byCat[c] || 0) + num(x.amount); });
  const byInc = {}; inc.forEach(x => { const c = x.category || "Other"; byInc[c] = (byInc[c] || 0) + num(x.amount); });
  return { k, xs, income, spent, net: income - spent, rate: income ? (income - spent) / income : null, byCat, byInc };
}
function balanceAt(k) { // closing balance at end of month k
  const o = opening(); if (o.month && k < mShift(o.month, -1)) return null; let bal = o.amount;
  S.money.forEach(x => { if (!x.date) return; const mk = x.date.slice(0, 7); if (o.month && mk < o.month) return; if (mk > k) return; bal += (x.kind === "Income" ? 1 : -1) * num(x.amount); });
  return bal;
}
function moneyStats() {
  const cur = iso(today()).slice(0, 7), last3 = [1, 2, 3].map(n => monthMoney(mShift(cur, -n))).filter(m => m.xs.length);
  const avgSpend = last3.length ? last3.reduce((s, m) => s + m.spent, 0) / last3.length : null;
  const avgIncome = last3.length ? last3.reduce((s, m) => s + m.income, 0) / last3.length : null;
  const bal = balanceAt(cur);
  return { cur, avgSpend, avgIncome, bal, runway: avgSpend ? bal / avgSpend : null };
}

const AIS = {
  goals: { c: "goals", k: "goals", label: "goal", fields: "item (name), value, priority, price (EGP), have, target (YYYY-MM-DD), note" },
  plans: { c: "plans", k: "plans", label: "plan", fields: "goal (goal name), start (YYYY-MM-DD), note. One plan per goal." },
  plan_milestones: { c: "milestones", k: "ms", label: "plan milestone", fields: "plan (the goal name the plan is for), name, worth (% of the goal; a plan's milestones add up to 100), status (msStatus), due, order" },
  businesses: { c: "businesses", k: "biz", label: "business", fields: "name, type (bizTypes), status (bizStatus), start" },
  payouts: { c: "payouts", k: "pays", label: "payout", fields: "date, business, client (client or product name, optional), revenue, expenses, paidVia, note" },
  clients: { c: "accounts", k: "accts", label: "client/product", fields: "kind (Client or Product), name, business, category (acctCats), status (acctStatus), since, contractType, contractNo, contract (description), payTerms, phone, note" },
  business_milestones: { c: "bizMilestones", k: "bms", label: "business milestone", fields: "business, name, area, due, status (msStatus), invest (EGP), note" },
  maintenance: { c: "maintenance", k: "maint", label: "maintenance item", fields: "business, client (optional, the client/product it is for), item, category (maintCats), cost (EGP each time), freq (Weekly, Monthly, Quarterly, Every 6 months, Yearly, One-off), next (due date), last, status (Active, Paused, Stopped), note" },
  decisions: { c: "decisions", k: "decs", label: "decision", fields: "text, business (optional), due, done (true/false)" },
  tasks: { c: "todos", k: "todos", label: "task", fields: "text, date (the day it is planned for), link ('' general, 'life', 'business', or a goal name or business name), pri (High, Medium, Low), mins, done (true/false), note" },
  money: { c: "money", k: "money", label: "money entry", fields: "kind (Expense or Income), date, category (expenseCats for expenses, incomeCats for income), amount (EGP), note" },
  fixed_items: { c: "fixed", k: "fixed", label: "fixed monthly item", fields: "kind (Expense or Income), category, amount, day (1-31), note (its name). To log one for a month, create a money entry with fixedId set to its id." },
};
const AI_DATE = { payouts: "date", money: "date", tasks: "date", maintenance: "next", plan_milestones: "due", business_milestones: "due", decisions: "due", goals: "target" };
const stripTags = h => String(h || "").replace(/<[^>]+>/g, "");
const noDash = s => String(s || "").replace(/\s*—\s*/g, ", ");

function aiSnapshot() {
  const t = today(), tI = iso(t), DONE = opt("msStatus")[0], L = [];
  const DOWN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const p = v => v == null || isNaN(v) ? "-" : pct(v);
  L.push(`Today is ${DOWN[t.getDay()]} ${tI}.`);
  const tasks = S.todos.filter(x => !x.dismissed);
  const tl = x => { const li = linkInfo(x.link); return `- [${x.done ? "x" : " "}] ${x.text} | ${x.pri || "Medium"}${num(x.mins) ? " | " + num(x.mins) + " min" : ""}${li.name ? " | " + li.name : " | " + li.area}${x.date !== tI ? " | " + x.date : ""}${x.note ? " | note: " + x.note : ""} (id ${x.id})`; };
  const todayT = tasks.filter(x => x.date === tI), carried = tasks.filter(x => !x.done && x.date && x.date < tI);
  const nextT = tasks.filter(x => !x.done && x.date > tI && x.date <= iso(new Date(t.getTime() + 7 * DAY))).sort((a, b) => a.date.localeCompare(b.date));
  L.push("", "## Tasks for today", ...(todayT.length ? todayT.map(tl) : ["(none planned)"]));
  if (carried.length) L.push("", "## Unfinished tasks from earlier days", ...carried.slice(0, 20).map(tl));
  if (nextT.length) L.push("", "## Tasks planned in the next 7 days", ...nextT.slice(0, 20).map(tl));
  const recs = recommendations();
  if (recs.length) L.push("", "## Recommendations the app suggests for today", ...recs.slice(0, 10).map(r => `- ${r.pri}: ${r.text} (${r.why})`));
  const decs = S.decs.filter(d => !d.auto && !d.done);
  if (decs.length) L.push("", "## Open decisions / to-dos (Business tab)", ...decs.map(d => `- ${d.text}${d.businessId ? " | " + ((S.biz.find(b => b.id === d.businessId) || {}).name || "") : ""}${d.due ? " | due " + d.due : ""} (id ${d.id})`));
  L.push("", "## Goals");
  if (!S.goals.length) L.push("(none)");
  S.goals.forEach(g => { const i = goalInfo(g); L.push(`- ${g.item} | ${g.value || "-"} | ${g.priority || "-"} | ${money(i.price)} EGP | ${g.have || "-"} | target ${g.target || "-"} | ${i.timeline}${i.save ? " | save " + money(i.save) + "/mo" : ""}${i.plan ? " | plan " + p(i.planPct) + " done" : ""} (id ${g.id})`); });
  const plans = S.plans.map(planInfo).filter(f => f.g);
  if (plans.length) L.push("", "## Plans", ...plans.map(f => `- ${f.g.item}: ${p(f.done)} done, ${f.used == null ? "no dates" : p(f.used) + " of time used"}, ${f.pace || "no pace"}${f.next ? `, next milestone "${f.next.name}"${f.next.due ? " due " + f.next.due : ""}` : ""}`));
  L.push("", "## Businesses");
  if (!S.biz.length) L.push("(none)");
  S.biz.forEach(b => { const s = bizStats(b);
    L.push(`- ${b.name} (${b.type || "-"}, ${b.status || "-"}, running ${s.running}) | all-time revenue ${money(s.rev)}, profit ${money(s.profit)} | last 3 months avg revenue ${money(s.avgRev)}/mo, profit ${money(s.avgProfit)}/mo, trend ${s.trend == null ? "-" : p(s.trend)} | upkeep ${money(s.maintMo)}/mo, net ${money(s.net)}/mo | last payout ${s.last || "never"} | active clients/products ${s.active.length}${s.top ? `, biggest ${s.top.a.name} ${p(s.topShare)}` : ""} | milestones ${s.msDone}/${s.ms.length}${s.msLate ? `, ${s.msLate} late` : ""} (id ${b.id})`); });
  const sig = signals(S.biz.map((b, i) => ({ b, i, s: bizStats(b) })));
  if (sig.length) L.push("", "## Business signals worked out by the app", ...sig.slice(0, 10).map(x => `- ${x.lv === "warn" ? "ACT" : x.lv === "good" ? "GOOD" : "NOTE"}: ${stripTags(x.t)}`));
  const mDue = S.maint.map(m => ({ m, i: maintInfo(m) })).filter(x => x.i.active && x.i.dl != null && x.i.dl <= 14);
  if (mDue.length) L.push("", "## Maintenance due within 14 days or overdue", ...mDue.map(x => `- ${x.m.item} | ${(S.biz.find(b => b.id === x.m.businessId) || {}).name || ""} | ${money(num(x.m.cost))} EGP | next ${x.m.next} (${x.i.state}) (id ${x.m.id})`));
  const bDue = S.bms.filter(m => m.status !== DONE && m.due && days(parse(m.due), t) <= 21);
  if (bDue.length) L.push("", "## Business milestones due soon or late", ...bDue.map(m => `- ${m.name} | ${(S.biz.find(b => b.id === m.businessId) || {}).name || ""} | due ${m.due} | ${m.status} (id ${m.id})`));
  const k = tI.slice(0, 7), M = monthMoney(k), B = budgets(), st = moneyStats();
  const over = Object.entries(M.byCat).filter(([c, v]) => num(B[c]) && v > num(B[c]));
  const fixedDue = S.fixed.filter(f => !S.money.some(x => x.fixedId === f.id && x.date && x.date.slice(0, 7) === k));
  L.push("", `## Personal money, ${mLabel(k)}`,
    `- Income ${money(M.income)} | spent ${money(M.spent)} | left over ${money(M.net)} | balance now ${money(balanceAt(k))} | avg monthly spend ${st.avgSpend == null ? "-" : money(st.avgSpend)}`,
    `- Budgets: ${Object.keys(B).length ? Object.entries(B).map(([c, v]) => `${c} ${money(M.byCat[c] || 0)}/${money(v)}`).join("; ") : "none set"}`,
    over.length ? `- Over budget: ${over.map(([c]) => c).join(", ")}` : "- Nothing over budget",
    fixedDue.length ? `- Fixed items not logged yet this month: ${fixedDue.map(f => `${f.note || f.category} ${money(num(f.amount))} (id ${f.id})`).join("; ")}` : "- All fixed items logged this month");
  L.push("", `## Record counts: ${Object.entries(AIS).map(([s, d]) => `${s} ${S[d.k].filter(x => !x.dismissed && !x.auto).length}`).join(", ")}`);
  return L.join("\n");
}
function aiRules() {
  const lists = ["values", "priorities", "have", "msStatus", "bizTypes", "bizStatus", "paidVia", "acctCats", "acctStatus", "maintCats", "contractTypes", "payTerms", "expenseCats", "incomeCats"]
    .map(l => `${l}: ${opt(l).join(", ")}`).join("\n");
  return `You are the assistant built into Omar's "Life & Business tracker" web app. You work for Omar, the owner, and act on his behalf inside this app as if you were him.

How to work:
- Answer from the live snapshot below first. Call read_data when you need more detail, older records, or a record id.
- When Omar asks you to add, change, tick off, log, move, or remove something, do it with the tools straight away, then say briefly what you did. Do not ask for permission to do what he asked.
- Ask one short question only when something you need is missing or ambiguous (for example which business, or an amount).
- Before deleting, if Omar did not clearly name the exact record, ask first. Every change you make can be undone with the Undo button.
- Use names for business, client, goal and plan fields; the app finds the ids. Dates are YYYY-MM-DD. "Today" is ${iso(today())}. Money is in EGP.
- To mark a task done, update it with done: true. To tick a milestone, set status to "${opt("msStatus")[0]}". To log a fixed item for this month, create a money entry with the same kind, category, amount and note plus fixedId.
- Keep replies short and clear: a line or two, or short bullet points. For reports, use a few headings and bullets and include the key numbers. Use plain words, not internal field names or ids.
- In the snapshot, "-" in a number means zero or nothing yet.
- Never use em dashes in what you write.
- Your tools can only reach this app's data. You cannot send messages, browse, or reach other apps.

Allowed values for dropdown fields:
${lists}

Record types (section: fields):
${Object.entries(AIS).map(([s, d]) => `- ${s}: ${d.fields}`).join("\n")}
${BRAIN.notes ? `\nOmar's standing instructions for you (follow them):\n${BRAIN.notes}\n` : ""}
=== LIVE SNAPSHOT OF THE APP ===
${aiSnapshot()}
=== END OF SNAPSHOT ===`;
}

function aiRow(x) {
  const r = { id: x.id };
  for (const [k, v] of Object.entries(x)) {
    if (k === "id" || k === "created" || k === "prev") continue;
    if (k === "businessId") r.business = (S.biz.find(b => b.id === v) || {}).name || "";
    else if (k === "accountId") r.client = (S.accts.find(a => a.id === v) || {}).name || "";
    else if (k === "goalId") r.goal = (S.goals.find(g => g.id === v) || {}).item || "";
    else if (k === "planId") { const pl = S.plans.find(q => q.id === v); r.plan = pl ? ((S.goals.find(g => g.id === pl.goalId) || {}).item || "") : ""; }
    else if (k === "link") { const li = linkInfo(v); r.link = li.name || li.area; }
    else r[k] = v;
  }
  return r;
}
function aiResolve(section, f0, existing) {
  const f = { ...(f0 || {}) }; delete f.id;
  const lc = v => String(v ?? "").trim().toLowerCase();
  const find = (arr, key, v) => { const s = lc(v); return arr.find(x => x.id === v) || arr.find(x => lc(x[key]) === s) || arr.find(x => s && lc(x[key]).includes(s)); };
  const miss = (v, what) => { throw new Error(`No ${what} matches "${v}". Call read_data to see what exists.`); };
  for (const key of ["business", "businessId"]) if (key in f) { const v = f[key]; delete f[key]; if (v) { const b = find(S.biz, "name", v); if (!b) miss(v, "business"); f.businessId = b.id; } else f.businessId = ""; }
  for (const key of ["client", "accountId"]) if (key in f) { const v = f[key]; delete f[key];
    if (v) { const bid = f.businessId || (existing && existing.businessId); const pool = bid ? S.accts.filter(a => a.businessId === bid) : S.accts; const a = find(pool, "name", v) || find(S.accts, "name", v); if (!a) miss(v, "client or product"); f.accountId = a.id; } else f.accountId = ""; }
  for (const key of ["goal", "goalId"]) if (key in f) { const v = f[key]; delete f[key]; const g = find(S.goals, "item", v); if (!g) miss(v, "goal"); f.goalId = g.id; }
  for (const key of ["plan", "planId"]) if (key in f) { const v = f[key]; delete f[key];
    let pl = S.plans.find(q => q.id === v); if (!pl) { const g = find(S.goals, "item", v); pl = g && S.plans.find(q => q.goalId === g.id); }
    if (!pl) miss(v, "plan (give the goal name the plan is for)"); f.planId = pl.id; }
  if (section === "tasks" && "link" in f) { const v = String(f.link || "");
    if (!v || v === "life" || v === "business" || /^(goal|biz):/.test(v)) f.link = v;
    else if (lc(v) === "general") f.link = "";
    else { const b = find(S.biz, "name", v), g = find(S.goals, "item", v); if (!b && !g) miss(v, "goal or business"); f.link = b ? "biz:" + b.id : "goal:" + g.id; } }
  ["price", "revenue", "expenses", "amount", "cost", "invest", "worth", "mins", "day", "order"].forEach(k => { if (k in f) f[k] = num(f[k]); });
  if ("done" in f) { f.done = f.done === true || f.done === "true" || f.done === 1; if (!("doneAt" in f)) f.doneAt = f.done ? iso(today()) : ""; }
  if ("status" in f && (section === "plan_milestones" || section === "business_milestones") && !("doneAt" in f)) f.doneAt = f.status === opt("msStatus")[0] ? iso(today()) : "";
  return f;
}
function aiDefaults(section, f) {
  const tI = iso(today()), d = { created: Date.now() };
  if (section === "tasks") Object.assign(d, { date: tI, link: "", pri: "Medium", mins: 0, done: false, doneAt: "", note: "" });
  if (section === "money") Object.assign(d, { kind: "Expense", date: tI, note: "" });
  if (section === "payouts") Object.assign(d, { date: tI, expenses: 0, accountId: "", paidVia: "", note: "" });
  if (section === "decisions") Object.assign(d, { done: false, doneAt: "", businessId: "", due: "" });
  if (section === "maintenance") Object.assign(d, { freq: "Monthly", status: "Active", accountId: "", note: "" });
  if (section === "clients") Object.assign(d, { kind: "Client", status: opt("acctStatus")[0] || "", since: tI });
  if (section === "businesses") Object.assign(d, { status: opt("bizStatus")[0] || "", order: S.biz.length });
  if (section === "goals") Object.assign(d, { have: opt("have")[1] || "", priority: opt("priorities")[1] || "" });
  if (section === "plan_milestones") Object.assign(d, { status: opt("msStatus")[opt("msStatus").length - 1] || "", order: f.planId ? S.ms.filter(m => m.planId === f.planId).length : 0 });
  if (section === "business_milestones") Object.assign(d, { status: opt("msStatus")[opt("msStatus").length - 1] || "", invest: 0 });
  if (section === "fixed_items") Object.assign(d, { kind: "Expense", day: 1 });
  return { ...d, ...f };
}
const aiDesc = (section, f) => { const n = f.text || f.name || f.item || f.note || f.category || "";
  const amt = f.amount != null ? ` ${money(num(f.amount))} EGP` : f.revenue != null ? ` ${money(num(f.revenue))} EGP` : f.cost != null ? ` ${money(num(f.cost))} EGP` : "";
  return `${AIS[section].label}${n ? ` "${n}"` : ""}${amt}`; };

// ----- built-in brain: free, instant, no AI. Handles everyday requests locally. -----
const DOWS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const fmtDay = k => { const d = parse(k); return d ? `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` : k; };
function lcDate(s) { // finds a day in free text; returns {iso, rest}
  const t = today(); let m, k = null, rest = s;
  const take = re => { rest = rest.replace(re, " "); };
  if (/\btoday\b|\btonight\b/.test(s)) { k = iso(t); take(/\b(for |on )?(today|tonight)\b/); }
  else if (/\btomorrow\b|\btmrw\b/.test(s)) { k = iso(new Date(t.getTime() + DAY + 3600000)); take(/\b(for |on )?(tomorrow|tmrw)\b/); }
  else if (/\byesterday\b/.test(s)) { k = iso(new Date(t.getTime() - DAY + 3600000)); take(/\b(for |on )?yesterday\b/); }
  else if ((m = /\b(\d{4}-\d{2}-\d{2})\b/.exec(s))) { k = m[1]; take(/\b(on |for )?\d{4}-\d{2}-\d{2}\b/); }
  else if ((m = /\bin (\d+) days?\b/.exec(s))) { k = iso(new Date(t.getTime() + +m[1] * DAY + 3600000)); take(/\bin \d+ days?\b/); }
  else if ((m = /\b(?:on |this |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(s))) {
    const want = DOWS.indexOf(m[1]); let add = (want - t.getDay() + 7) % 7; if (add === 0 || /next/.test(m[0])) add = add || 7;
    k = iso(new Date(t.getTime() + add * DAY + 3600000)); take(/\b(on |this |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/); }
  return { iso: k, rest };
}
const amountOf = s => { const m = /(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/i.exec(s); if (!m) return null; let v = parseFloat(m[1].replace(/,/g, "")); if (m[2]) v *= 1000; return v; };
const GENERIC = ["new", "old", "home", "with", "from", "this", "that", "studios", "studio", "trade", "trading", "company", "group", "store", "shop", "the", "and", "for", "dev", "development", "marketing", "routine"];
const findIn = (text, arr, key) => { const lc = " " + text.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff ]/g, " ") + " ";
  const exact = arr.slice().sort((a, b) => String(b[key]).length - String(a[key]).length).find(x => x[key] && lc.includes(" " + String(x[key]).toLowerCase() + " "));
  if (exact) return exact;
  return arr.find(x => String(x[key] || "").toLowerCase().split(/[^a-z0-9\u0600-\u06ff]+/).some(w => w.length >= 4 && !GENERIC.includes(w) && lc.includes(" " + w + " "))); };
const words = s => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ ]/g, " ").split(/\s+/).filter(w => w.length > 2 && !["the", "and", "for", "with", "task", "tasks", "off", "done", "finished", "tick", "mark", "did", "that", "this", "today"].includes(w));
function bestTask(text, pool) {
  const ws = words(text); let best = null, score = 0;
  pool.forEach(x => { const tw = words(x.text); const sc = ws.filter(w => tw.some(v => v.startsWith(w) || w.startsWith(v))).length / Math.max(1, Math.min(ws.length, tw.length)); if (sc > score) { score = sc; best = x; } });
  return score >= .5 ? best : null;
}
function guessCat(text, kind) {
  const list = opt(kind === "Income" ? "incomeCats" : "expenseCats"), lc = text.toLowerCase();
  const exact = list.slice().sort((a, b) => b.length - a.length).find(c => lc.includes(c.toLowerCase())); if (exact) return exact;
  const pick = (...names) => names.find(n => list.includes(n));
  const rules = kind === "Income" ? [[/salary|pay ?check|wage/, ["Salary"]], [/payout|business|sulta|palm|sss|shop/, ["Business payout"]], [/freelance|client|project/, ["Freelance"]], [/gift/, ["Gift"]], [/refund|return/, ["Refund"]]]
    : [[/restaurant|cafe|coffee|dinner|lunch|breakfast|takeaway|delivery|talabat|mcdonald|kfc|pizza/, ["Eating out", "Food & groceries"]], [/grocer|food|supermarket|carrefour|market|meat|vegetable|fruit/, ["Food & groceries"]],
      [/uber|careem|taxi|fuel|benzine|petrol|gas station|metro|transport|parking|car wash|toll/, ["Transport"]], [/electric|water bill|gas bill|bill|utilit/, ["Bills & utilities"]], [/phone|internet|mobile|wifi|vodafone|orange|etisalat|we /, ["Phone & internet"]],
      [/subscription|netflix|spotify|shahid|youtube|icloud|chatgpt|claude/, ["Subscriptions"]], [/doctor|pharmacy|medicine|hospital|clinic|dentist|gym/, ["Health"]], [/rent|apartment|home/, ["Rent / home"]],
      [/clothes|shopping|amazon|noon|shoes|jumia/, ["Shopping"]], [/movie|cinema|game|outing|trip|party/, ["Entertainment"]], [/course|book|school|class|study|tuition/, ["Education"]], [/mom|dad|family|brother|sister|kids/, ["Family"]], [/sav(e|ing)/, ["Savings"]]];
  for (const [re, names] of rules) if (re.test(lc)) { const c = pick(...names); if (c) return c; }
  return pick("Other") || list[list.length - 1] || "Other";
}
function briefText(greet) {
  const t = today(), tI = iso(t), h = nowHour();
  const tasks = S.todos.filter(x => !x.dismissed), open = tasks.filter(x => x.date === tI && !x.done), doneN = tasks.filter(x => x.date === tI && x.done).length;
  const carried = tasks.filter(x => !x.done && x.date && x.date < tI);
  const rank = { High: 0, Medium: 1, Low: 2 };
  const L = [];
  if (greet) L.push(`**Good ${h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"}, Omar.** Here's ${fmtDay(tI)}.`); else L.push(`**${fmtDay(tI)}**`);
  if (open.length) { L.push("", `**Today (${open.length} to do${doneN ? `, ${doneN} done` : ""})**`); open.sort((a, b) => (rank[a.pri] ?? 1) - (rank[b.pri] ?? 1)).slice(0, 8).forEach(x => L.push(`- ${x.text}${x.pri === "High" ? " (high)" : ""}${num(x.mins) ? `, ${num(x.mins)} min` : ""}`)); }
  else L.push("", doneN ? `Everything planned for today is done (${doneN}).` : "Nothing planned for today yet.");
  if (carried.length) L.push("", `**${carried.length} unfinished from earlier**: ${carried.slice(0, 3).map(x => x.text).join(", ")}${carried.length > 3 ? " and more" : ""}. Say "move unfinished to today" to bring them over.`);
  const recs = recommendations().filter(r => r.pri !== "Low").slice(0, 4);
  if (recs.length) { L.push("", "**Worth doing**"); recs.forEach(r => L.push(`- ${r.text} (${r.why})`)); }
  const k = tI.slice(0, 7), M = monthMoney(k), B = budgets(), tb = Object.values(B).reduce((s, v) => s + num(v), 0);
  if (M.spent || tb) L.push("", `**Money this month**: spent ${money(M.spent) === "-" ? "0" : money(M.spent)} EGP${tb ? ` of ${money(tb)} budgeted` : ""}, balance ${money(balanceAt(k)) === "-" ? "0" : money(balanceAt(k))} EGP.`);
  return L.join("\n");
}
function overdueText() {
  const t = today(), tI = iso(t), DONE = opt("msStatus")[0], L = [];
  const tasks = S.todos.filter(x => !x.dismissed && !x.done && x.date && x.date < tI);
  const mt = S.maint.filter(m => maintInfo(m).state === "Overdue");
  const bm = S.bms.filter(m => m.status !== DONE && m.due && m.due < tI);
  const pm = S.ms.filter(m => m.status !== DONE && m.due && m.due < tI);
  const gl = S.goals.filter(g => goalInfo(g).timeline === "Overdue");
  if (tasks.length) L.push(`**Tasks** (${tasks.length})`, ...tasks.slice(0, 8).map(x => `- ${x.text} (from ${fmtDay(x.date)})`));
  if (mt.length) L.push(`**Maintenance** (${mt.length})`, ...mt.map(m => `- ${m.item}, due ${fmtDay(m.next)}`));
  if (bm.length || pm.length) L.push(`**Milestones** (${bm.length + pm.length})`, ...[...bm, ...pm].map(m => `- ${m.name}, due ${fmtDay(m.due)}`));
  if (gl.length) L.push(`**Goals past their target** (${gl.length})`, ...gl.map(g => `- ${g.item}`));
  return L.length ? L.join("\n") : "Nothing is overdue. Nice.";
}
function bizText(b) {
  const s = bizStats(b), sig = signals([{ b, i: 0, s }]).filter(x => x.lv === "warn").slice(0, 3);
  return [`**${b.name}** (${b.status || "Active"}, running ${s.running})`,
    `- Last 3 months: ${money(s.avgRev) === "-" ? "0" : money(s.avgRev)} EGP revenue and ${money(s.avgProfit) === "-" ? "0" : money(s.avgProfit)} EGP profit a month${s.trend == null ? "" : `, ${s.trend >= 0 ? "up" : "down"} ${pct(Math.abs(s.trend))}`}`,
    `- Upkeep ${money(s.maintMo) === "-" ? "0" : money(s.maintMo)} EGP a month, leaving ${money(s.net) === "-" ? "0" : money(s.net)} EGP`,
    `- Last payout: ${s.last ? fmtDay(s.last) : "none yet"}${s.top ? `. Biggest source: ${s.top.a.name} (${pct(s.topShare)})` : ""}`,
    ...(s.ms.length ? [`- Milestones: ${s.msDone} of ${s.ms.length} reached${s.msLate ? `, ${s.msLate} late` : ""}`] : []),
    ...sig.map(x => `- Watch: ${stripTags(x.t)}`)].join("\n");
}
function moneyText() {
  const k = iso(today()).slice(0, 7), M = monthMoney(k), B = budgets(), st = moneyStats(), z = v => money(v) === "-" ? "0" : money(v);
  const rows = Object.entries(M.byCat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const over = Object.entries(B).filter(([c, v]) => (M.byCat[c] || 0) > num(v));
  return [`**${mLabel(k)}**: ${z(M.income)} in, ${z(M.spent)} spent, ${z(M.net)} left over. Balance ${z(balanceAt(k))} EGP.`,
    ...(rows.length ? ["", "**Biggest spending**", ...rows.map(([c, v]) => `- ${c}: ${z(v)}${num(B[c]) ? ` of ${z(num(B[c]))}` : ""}`)] : []),
    ...(over.length ? ["", `Over budget: ${over.map(([c]) => c).join(", ")}.`] : []),
    ...(st.runway != null ? ["", `At your usual spend your balance lasts about ${Math.max(0, st.runway).toFixed(1)} months.`] : [])].join("\n");
}
function reportText() {
  const t = today(), from = iso(new Date(t.getTime() - 6 * DAY)), tI = iso(t);
  const tasks = S.todos.filter(x => !x.dismissed && x.date >= from && x.date <= tI), done = tasks.filter(x => x.done);
  const pays = S.pays.filter(p => p.date >= from && p.date <= tI), money7 = S.money.filter(x => x.date >= from && x.date <= tI);
  const sp = sumK(money7.filter(x => x.kind !== "Income"), "amount"), inc = sumK(money7.filter(x => x.kind === "Income"), "amount");
  const z = v => money(v) === "-" ? "0" : money(v);
  return [`**Weekly report, ${fmtDay(from)} to ${fmtDay(tI)}**`, "",
    "**Tasks**", `- ${done.length} of ${tasks.length} planned tasks done${tasks.length ? ` (${pct(done.length / tasks.length)})` : ""}`, ...done.slice(0, 6).map(x => `- Done: ${x.text}`), "",
    "**Business**", pays.length ? `- ${pays.length} payouts, ${z(sumK(pays, "revenue"))} EGP revenue, ${z(sumK(pays, "revenue") - sumK(pays, "expenses"))} EGP profit` : "- No payouts logged this week",
    ...S.biz.map(b => { const ps = pays.filter(p => p.businessId === b.id); return ps.length ? `- ${b.name}: ${z(sumK(ps, "revenue"))} EGP` : null; }).filter(Boolean), "",
    "**Personal money**", `- ${z(inc)} in, ${z(sp)} spent`, "",
    "**Coming up**", overdueText().startsWith("Nothing") ? "- Nothing overdue" : "- Some things are overdue. Ask \"what's overdue?\" to see them."].join("\n");
}
const HELP = `I can do these instantly and for free:
- "What's for today?", "what's overdue?", "what's tomorrow?"
- "Add call Cafe X tomorrow high 20 min"
- "Done gym" or "tick off call Cafe X"
- "Move unfinished to today"
- "Spent 450 on lunch", "paid 300 uber yesterday", "got 5000 salary"
- "Payout 12000 Palm Trade"
- "How much did I spend?", "How is Sulta doing?", "My goals", "Weekly report"
For anything else I use Haiku, unless you set me to Free only.`;

async function localAnswer(q, turn) {
  const raw = q.trim(), s = raw.toLowerCase().replace(/[?!.]+$/, "").trim(), tI = iso(today());
  const act = (text) => ({ text });
  if (/^(help|what can you do|commands|how do i use you)/.test(s)) return act(HELP);
  if (/^(hi|hello|hey|salam|good (morning|afternoon|evening))\b/.test(s) && s.split(" ").length <= 3) return act(briefText(true));
  // ---- writes ----
  if (/^(move|bring|carry)\b.*\b(unfinished|undone|carried|overdue|late|old|yesterday'?s)\b/.test(s)) {
    const c = S.todos.filter(x => !x.dismissed && !x.done && x.date && x.date < tI); if (!c.length) return act("There's nothing unfinished from earlier days.");
    c.forEach(x => turn.ops.push({ op: "update", coll: "todos", id: x.id, data: { date: tI }, label: `Move "${x.text}" to today` }));
    c.forEach(x => turn.actions.push(`Moved task "${x.text}" to today`)); return act(`Moved ${c.length} unfinished ${c.length === 1 ? "task" : "tasks"} to today.`);
  }
  let m;
  if ((m = /^(?:i\s+)?(?:done|finished|completed|did|tick(?:ed)?(?:\s+off)?|check(?:ed)?(?:\s+off)?|mark(?:ed)?)\s+(.+?)(?:\s+(?:as\s+)?done)?$/.exec(s))) {
    const pool = S.todos.filter(x => !x.dismissed && !x.done && (!x.date || x.date <= tI)); const x = bestTask(m[1], pool);
    if (!x) { const any = bestTask(m[1], S.todos.filter(y => !y.dismissed && !y.done)); if (!any) return null; return tickTask(any, turn); }
    return tickTask(x, turn);
  }
  if ((m = /^(?:add|new|create|remind me(?: to)?|todo|to-do|task|plan)\s*:?\s+(?:an?\s+)?(?:new\s+)?(?:task\s*:?\s+)?(?:to\s+)?(.+)$/.exec(s)) && !/^(?:add|log|new|create)\s+(?:an?\s+|new\s+)*(?:expense|income|payout|goal|business|client|product|milestone|maintenance|plan|budget|category|option|decision|fixed)s?\b/.test(s)) {
    let rest = " " + raw.slice(raw.toLowerCase().indexOf(m[1])) + " ";
    const d = lcDate(rest.toLowerCase()); let text = d.iso ? raw.slice(raw.toLowerCase().indexOf(m[1])) : rest.trim();
    text = text.replace(/\b(for |on )?(today|tonight|tomorrow|tmrw|yesterday)\b/ig, " ").replace(/\b(on |this |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/ig, " ").replace(/\bin \d+ days?\b/ig, " ").replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
    let pri = "Medium"; if (/\b(high|urgent|important|asap)\b/i.test(text)) pri = "High"; else if (/\blow\b/i.test(text)) pri = "Low";
    text = text.replace(/\b(high|urgent|important|asap|low|medium)( priority)?\b/ig, " ").replace(/\bpriority\b/ig, " ");
    let mins = 0, mm; if ((mm = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/i.exec(text))) { mins = Math.round(parseFloat(mm[1]) * 60); text = text.replace(mm[0], " "); }
    if ((mm = /(\d+)\s*(m|min|mins|minute|minutes)\b/i.exec(text))) { mins += +mm[1]; text = text.replace(mm[0], " "); }
    const b = findIn(text, S.biz, "name"), g = findIn(text, S.goals, "item");
    text = text.replace(/\s+/g, " ").replace(/^(to|for|and)\s+/i, "").replace(/\s+(for|on|at|by)$/i, "").trim();
    if (!text) return null;
    text = text.charAt(0).toUpperCase() + text.slice(1);
    const f = { text, date: d.iso || tI, link: b ? "biz:" + b.id : g ? "goal:" + g.id : "", pri, mins, done: false, doneAt: "", note: "", created: Date.now() };
    turn.ops.push({ op: "add", coll: "todos", data: f, label: `Add task "${text}" for ${f.date === tI ? "today" : fmtDay(f.date)}${pri !== "Medium" ? ", " + pri.toLowerCase() + " priority" : ""}` }); turn.actions.push(`Added task "${text}" for ${f.date === tI ? "today" : fmtDay(f.date)}`);
    return act(`Added **${text}** for ${f.date === tI ? "today" : fmtDay(f.date)}${pri !== "Medium" ? `, ${pri.toLowerCase()} priority` : ""}${mins ? `, ${mins} min` : ""}${b ? `, linked to ${b.name}` : g ? `, linked to ${g.item}` : ""}.`);
  }
  if (/^(?:log|spent|spend|paid|pay|bought|buy|expense|add expense)\b/.test(s) && amountOf(s) != null && !/\bpayout\b/.test(s)) {
    const amt = amountOf(s); if (!(amt > 0)) return null; const d = lcDate(s);
    const cat = guessCat(s, "Expense");
    let note = raw.replace(/^(log|spent|spend|paid|pay|bought|buy|expense|add expense)\s*/i, "").replace(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?\s*(egp|le|pounds?|ج\.?م)?/i, " ").replace(/\b(today|tonight|tomorrow|yesterday)\b/ig, " ").replace(/^\s*(on|for|in)\s+/i, "").replace(/\s+/g, " ").trim();
    note = note.charAt(0).toUpperCase() + note.slice(1);
    const f = { kind: "Expense", date: d.iso || tI, category: cat, amount: amt, note, created: Date.now() };
    turn.ops.push({ op: "add", coll: "money", data: f, label: `Log expense ${money(amt)} EGP under ${cat}${note ? " (" + note + ")" : ""}${f.date !== tI ? " on " + fmtDay(f.date) : ""}` }); turn.actions.push(`Logged expense ${money(amt)} EGP (${cat})`);
    const M = monthMoney(f.date.slice(0, 7)), bud = num(budgets()[cat]);
    return act(`Logged **${money(amt)} EGP** under ${cat}${note ? ` (${note})` : ""}${f.date !== tI ? ` on ${fmtDay(f.date)}` : ""}.${bud ? ` ${cat} is at ${money((M.byCat[cat] || 0) + amt)} of ${money(bud)} this month.` : ""}`);
  }
  if (/^(?:got|received|earned|income|add income)\b/.test(s) && amountOf(s) != null) {
    const amt = amountOf(s), d = lcDate(s), cat = guessCat(s, "Income");
    const f = { kind: "Income", date: d.iso || tI, category: cat, amount: amt, note: "", created: Date.now() };
    turn.ops.push({ op: "add", coll: "money", data: f, label: `Log income ${money(amt)} EGP from ${cat}` }); turn.actions.push(`Logged income ${money(amt)} EGP (${cat})`);
    return act(`Logged **${money(amt)} EGP** income from ${cat}.`);
  }
  if (/\bpayout\b/.test(s) && amountOf(s) != null) {
    const b = findIn(raw, S.biz, "name"); if (!b) return null;
    const nums = (s.match(/\d[\d,]*(?:\.\d+)?k?/g) || []).map(x => amountOf(x));
    const rev = nums[0], exp = /\b(expenses?|cost)\b/.test(s) && nums[1] != null ? nums[1] : 0;
    const a = findIn(raw, S.accts.filter(x => x.businessId === b.id), "name"), d = lcDate(s);
    const f = { date: d.iso || tI, businessId: b.id, accountId: a ? a.id : "", revenue: rev, expenses: exp, paidVia: "", note: "", created: Date.now() };
    turn.ops.push({ op: "add", coll: "payouts", data: f, label: `Log a ${money(rev)} EGP payout for ${b.name}${a ? " from " + a.name : ""}` }); turn.actions.push(`Logged payout ${money(rev)} EGP for ${b.name}`);
    return act(`Logged a **${money(rev)} EGP** payout for ${b.name}${a ? ` from ${a.name}` : ""}${exp ? ` with ${money(exp)} expenses` : ""}.`);
  }
  // ---- reads ----
  // Anything that sounds like a change but wasn't caught above goes to the AI, not to a read.
  if (/\b(push|move|change|set|make|update|delete|remove|rename|edit|reschedule|postpone|cancel|create|add|log|put|turn|switch|increase|decrease|raise|lower)\b/.test(s)) return null;
  if (/\b(overdue|late|behind|missed)\b/.test(s)) return act(overdueText());
  if (/\btomorrow\b/.test(s) && /\b(what|tasks?|plan|have|agenda|on)\b/.test(s)) {
    const k = iso(new Date(today().getTime() + DAY + 3600000)), xs = S.todos.filter(x => !x.dismissed && x.date === k);
    return act(xs.length ? `**${fmtDay(k)}**\n${xs.map(x => `- ${x.done ? "Done: " : ""}${x.text}`).join("\n")}` : `Nothing planned for tomorrow yet. Say "add ... tomorrow" to plan something.`);
  }
  if (/\b(week|weekly)\b/.test(s) && /\b(report|summary|review|recap)\b/.test(s) || /^(report|summary|recap)$/.test(s)) return act(reportText());
  if (/(what'?s|what is|whats)\s+(for|on)\s+today|^today$|my day|plan (for )?(my|the) day|^(agenda|brief|briefing|morning)$|what do i (have|need to do)|^what'?s up/.test(s)) return act(briefText(false));
  if (/\b(balance|spent|spend|spending|budget|budgets|money|expenses)\b/.test(s) && /\b(how|what|show|my|where)\b/.test(s)) return act(moneyText());
  const b = findIn(raw, S.biz, "name");
  if (b && /\b(how|status|doing|report|update|going|summary)\b/.test(s)) return act(bizText(b));
  if (/\b(businesses|all business|my business)\b/.test(s) && /\b(how|status|doing|going)\b/.test(s)) return act(S.biz.map(bizText).join("\n\n") || "No businesses yet.");
  if (/^(my )?goals?\??$|\bmy goals\b|how are my goals/.test(s)) {
    return act(S.goals.length ? S.goals.map(g => { const i = goalInfo(g); return `- **${g.item}**: ${i.timeline}${i.plan ? `, plan ${pct(i.planPct || 0)} done` : ""}${i.save ? `, save ${money(i.save)}/mo` : ""}`; }).join("\n") : "No goals yet.");
  }
  return null;
}
async function tickTask(x, turn) {
  turn.ops.push({ op: "update", coll: "todos", id: x.id, data: { done: true, doneAt: iso(today()) }, label: `Tick off "${x.text}"` });
  turn.actions.push(`Ticked off task "${x.text}"`);
  const left = S.todos.filter(y => !y.dismissed && !y.done && y.date === iso(today()) && y.id !== x.id).length;
  return { text: `Ticked off **${x.text}**.${left ? ` ${left} left for today.` : " That's everything for today."}` };
}


// ================= shared brain (used by the web app AND the Telegram function) =================
// The AI answers with one JSON plan: { reply, read: [...], actions: [...] }.
// Reads run automatically; actions become "ops" that Omar confirms before anything is saved.

const SECTION_OF_COLL = Object.fromEntries(Object.entries(AIS).map(([s, d]) => [d.c, s]));
const isArabic = s => /[؀-ۿ]/.test(String(s || ""));
const CONFIRM_RE = /^\s*(تمام|ماشي|اه|آه|ايوه|أيوه|ايوا|نعم|اكيد|أكيد|موافق|يلا|ok|okay|yes|yep|yeah|y|sure|confirm|go|do it|✓|✔️?|👍)\s*[.!]*\s*$/i;
const CANCEL_RE = /^\s*(لا|لأ|لاء|بلاش|الغي|ألغي|الغاء|إلغاء|no|nope|n|cancel|stop|✕|✖️?|👎)\s*[.!]*\s*$/i;

// Fills S from rows of the os_docs table: [{ coll, id, data }]
function loadDocs(rows) {
  const by = {}; for (const k of Object.values(KEYOF)) by[k] = [];
  let opts = {}, assistant = {};
  for (const r of rows || []) {
    if (r.coll === "app") { if (r.id === "options") opts = r.data || {}; else if (r.id === "assistant") assistant = r.data || {}; continue; }
    const k = KEYOF[r.coll]; if (k) by[k].push({ id: r.id, ...(r.data || {}) });
  }
  Object.assign(S, by); S.opts = opts; S.optsServer = JSON.parse(JSON.stringify(opts));
  BRAIN.notes = assistant.notes || "";
  return { opts, assistant };
}

function readData(input) {
  const d = AIS[String(input.section)]; if (!d) return JSON.stringify({ error: "Unknown section " + input.section });
  const dk = AI_DATE[input.section];
  let rows = S[d.k].filter(x => !x.dismissed && !x.auto);
  if (dk && input.from) rows = rows.filter(x => (x[dk] || "") >= String(input.from));
  if (dk && input.to) rows = rows.filter(x => x[dk] && x[dk] <= String(input.to));
  let out = rows.map(aiRow);
  if (input.search) { const q = String(input.search).toLowerCase(); out = out.filter(r => JSON.stringify(r).toLowerCase().includes(q)); }
  if (dk) out.sort((a, b) => String(b[dk] || "").localeCompare(String(a[dk] || "")));
  const lim = Math.max(1, Math.min(200, Number(input.limit) || 60)); const total = out.length; out = out.slice(0, lim);
  let json = JSON.stringify({ section: input.section, total, shown: out.length, records: out });
  while (json.length > 30000 && out.length > 1) { out = out.slice(0, Math.floor(out.length * .7)); json = JSON.stringify({ section: input.section, total, shown: out.length, records: out, note: "Cut to fit." }); }
  return json;
}

// Turns the AI's proposed actions into ops: [{ op: add|update|delete|set, coll, id?, data?, label }]
function prepareActions(actions) {
  const ops = [], errors = [], browser = [];
  for (const a0 of Array.isArray(actions) ? actions : []) {
    const a = a0 || {};
    try {
      if (a.op === "settings") { ops.push(settingsOp(a)); continue; }
      if (a.op === "open_page" || a.op === "backup" || a.op === "download") { browser.push(a.op); continue; }
      const d = AIS[String(a.section)]; if (!d) throw new Error(`unknown section "${a.section}"`);
      if (a.op === "create") {
        const f = aiDefaults(a.section, aiResolve(a.section, a.fields || {}));
        if (a.section === "tasks" && !f.text) throw new Error("a task needs text");
        if (a.section === "money" && !(num(f.amount) > 0)) throw new Error("a money entry needs an amount");
        if (a.section === "payouts" && !f.businessId) throw new Error("a payout needs a business");
        ops.push({ op: "add", coll: d.c, data: f, label: "Add " + aiDesc(a.section, f) + extraLabel(a.section, f) });
      } else if (a.op === "update") {
        const ex = S[d.k].find(x => x.id === String(a.id)); if (!ex) throw new Error(`no ${d.label} with id ${a.id}`);
        const f = aiResolve(a.section, a.fields || {}, ex);
        const what = "done" in f ? (f.done ? "Tick off " : "Untick ") : f.doneAt ? "Mark done " : "Update ";
        const changes = Object.entries(a.fields || {}).filter(([k]) => !["done", "doneAt"].includes(k)).map(([k, v]) => `${k}: ${v}`).join(", ");
        ops.push({ op: "update", coll: d.c, id: ex.id, data: f, label: what + aiDesc(a.section, { ...ex, ...f }) + (changes && what === "Update " ? ` (${changes})` : "") });
      } else if (a.op === "delete") {
        const ex = S[d.k].find(x => x.id === String(a.id)); if (!ex) throw new Error(`no ${d.label} with id ${a.id}`);
        if (a.section === "businesses" && S.pays.some(p => p.businessId === ex.id)) throw new Error("that business has payouts; remove them first");
        if (a.section === "plans") S.ms.filter(m => m.planId === ex.id).forEach(m => ops.push({ op: "delete", coll: "milestones", id: m.id, label: `Delete plan milestone "${m.name}"` }));
        ops.push({ op: "delete", coll: d.c, id: ex.id, label: "Delete " + aiDesc(a.section, ex) });
      } else throw new Error(`unknown op "${a.op}"`);
    } catch (e) { errors.push(String(e && e.message || e)); }
  }
  return { ops, errors, browser };
}
const extraLabel = (section, f) => {
  if (section === "tasks") { const li = linkInfo(f.link); return ` for ${f.date === iso(today()) ? "today" : fmtDay(f.date)}${f.pri && f.pri !== "Medium" ? ", " + f.pri.toLowerCase() + " priority" : ""}${li.name ? ", " + li.name : ""}`; }
  if (section === "money") return ` (${f.kind === "Income" ? "income" : "expense"}, ${f.category || "no category"}${f.date !== iso(today()) ? ", " + fmtDay(f.date) : ""})`;
  if (section === "payouts") { const b = S.biz.find(x => x.id === f.businessId); return b ? ` for ${b.name}` : ""; }
  return "";
};
function settingsOp(a) {
  const cur = JSON.parse(JSON.stringify(S.optsServer || S.opts || {})); let label = "";
  if (a.action === "add_option" || a.action === "remove_option") {
    const l = String(a.list || ""), v = String(a.value || "").trim(); if (!LISTS[l]) throw new Error("unknown list " + l); if (!v) throw new Error("no value given");
    const arr = opt(l).slice();
    if (a.action === "add_option") { if (arr.some(x => x.toLowerCase() === v.toLowerCase())) throw new Error(`"${v}" is already in ${LISTS[l].label}`); arr.push(v); label = `Add "${v}" to ${LISTS[l].label}`; }
    else { const i = arr.findIndex(x => x.toLowerCase() === v.toLowerCase()); if (i < 0) throw new Error(`"${v}" isn't in ${LISTS[l].label}`); arr.splice(i, 1); label = `Remove "${v}" from ${LISTS[l].label}`; }
    cur[l] = arr;
  } else if (a.action === "set_budget") {
    const c = String(a.category || ""); if (!c) throw new Error("no category given"); const b = { ...(cur.budgets || {}) }, v = num(a.amount);
    if (v > 0) b[c] = v; else delete b[c]; cur.budgets = b; label = v > 0 ? `Set ${c} budget to ${money(v)} EGP` : `Remove the ${c} budget`;
  } else if (a.action === "set_starting_balance") {
    cur.openingBalance = num(a.amount); if (a.month) cur.openingMonth = String(a.month).slice(0, 7); label = `Set starting balance to ${money(num(a.amount))} EGP`;
  } else throw new Error("unknown settings action " + a.action);
  return { op: "set", coll: "app", id: "options", data: cur, label };
}

// Runs ops against a store: { add(coll, data) -> id, update(coll, id, patch), set(coll, id, data), del(coll, id) }
async function runOps(store, ops) {
  const done = [];
  for (const o of ops || []) {
    if (o.op === "add") await store.add(o.coll, o.data);
    else if (o.op === "update") await store.update(o.coll, o.id, o.data);
    else if (o.op === "set") await store.set(o.coll, o.id, o.data);
    else if (o.op === "delete") await store.del(o.coll, o.id);
    else continue;
    done.push(o.label);
  }
  return done;
}

function brainSystem() {
  const lists = ["values", "priorities", "have", "msStatus", "bizTypes", "bizStatus", "paidVia", "acctCats", "acctStatus", "maintCats", "contractTypes", "payTerms", "expenseCats", "incomeCats"]
    .map(l => `${l}: ${opt(l).join(", ")}`).join("\n");
  return `You are the assistant inside Omar's Personal Development OS: his tasks, life goals and plans, businesses (payouts, clients and products, milestones, maintenance) and personal money. You act for Omar as if you were him, but every change is shown to him to confirm before it is saved.

You understand English and Egyptian Arabic (including Franco-Arabic). Reply in the language Omar wrote in; when he writes Arabic, reply in natural Egyptian Arabic.

ANSWER FORMAT. Reply with ONE JSON object and nothing else:
{"reply": "...", "read": [], "actions": []}
- "reply": what you tell Omar. Short and clear: a line or two, or a few "- " bullets. Use **bold** sparingly. Plain words, never ids or field names. Never use em dashes.
- "read": optional lookups when the snapshot is not enough, e.g. [{"section": "money", "from": "2026-10-01", "to": "2026-10-31"}] or [{"section": "tasks", "search": "cafe"}]. When you use "read", leave "actions" empty and keep "reply" brief; you will get the results and answer again.
- "actions": the changes to make. Omar confirms them first, so word "reply" as what you WILL do ("I'll add ..."), not as done. Leave it empty for questions.

ACTION SHAPES:
- {"op": "create", "section": "<section>", "fields": {...}}
- {"op": "update", "section": "<section>", "id": "<record id>", "fields": {...only what changes}}
- {"op": "delete", "section": "<section>", "id": "<record id>"}   (only when Omar clearly asked to remove that exact record)
- {"op": "settings", "action": "set_budget", "category": "...", "amount": 0}
- {"op": "settings", "action": "add_option" | "remove_option", "list": "<list name>", "value": "..."}
- {"op": "settings", "action": "set_starting_balance", "amount": 0, "month": "YYYY-MM"}
- {"op": "open_page"} or {"op": "backup"} only if Omar asks to open a page or download a backup (these need the OS itself).

RULES:
- Use names for business, client, goal and plan fields; the app resolves them. Dates are YYYY-MM-DD. Money is EGP.
- To tick a task off: update it with {"done": true}. To move a task: update its "date". To tick a milestone: set "status" to "${opt("msStatus")[0] || "Done"}".
- To log a fixed monthly item: create a money entry with the same kind, category, amount and note, plus "fixedId".
- Ask one short question (in "reply", no actions) only if something essential is missing or ambiguous, like which business or an amount.
- In the snapshot, "-" in a number means zero or nothing yet.
- You can only reach this OS's data. You cannot send messages, browse or reach other apps.

Allowed values for dropdown fields:
${lists}

Sections and their fields:
${Object.entries(AIS).map(([s, d]) => `- ${s}: ${d.fields}`).join("\n")}
${BRAIN.notes ? `\nOmar's standing instructions (follow them):\n${BRAIN.notes}\n` : ""}`;
}
const brainSnapshot = () => `=== LIVE SNAPSHOT OF THE OS (${iso(today())}) ===\n${aiSnapshot()}\n=== END OF SNAPSHOT ===`;

function parsePlan(text) {
  const t = String(text || "").trim();
  const tryParse = s => { try { const j = JSON.parse(s); return j && typeof j === "object" ? j : null; } catch (e) { return null; } };
  let j = tryParse(t);
  if (!j) { const m = /```(?:json)?\s*([\s\S]*?)```/.exec(t); if (m) j = tryParse(m[1]); }
  if (!j) { const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a >= 0 && b > a) j = tryParse(t.slice(a, b + 1)); }
  if (!j) return null;
  return { reply: noDash(String(j.reply || "")), read: Array.isArray(j.read) ? j.read.slice(0, 4) : [], actions: Array.isArray(j.actions) ? j.actions.slice(0, 25) : [] };
}

// Runs the free built-in brain; returns { text, ops, doneText } or null when it doesn't understand.
async function freeBrain(q) {
  if (isArabic(q)) return null;
  const turn = { ops: [], actions: [] };
  const r = await localAnswer(q, turn);
  if (!r) return null;
  return { text: r.text, ops: turn.ops, doneText: r.text };
}

// Telegram-style formatting: escape, **bold** -> <b>, "- " bullets -> "• ", no em dashes.
function toTelegramHtml(md) {
  const e = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return noDash(md).split("\n").map(l => {
    let x = e(l).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
    x = x.replace(/^\s*#{1,6}\s+(.*)$/, "<b>$1</b>").replace(/^\s*[-*•]\s+/, "• ");
    return x;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}


export {
  AIS,
  AI_DATE,
  BRAIN,
  CANCEL_RE,
  CLOCK,
  CONFIRM_RE,
  DAY,
  DOWS,
  FREQ,
  GENERIC,
  HELP,
  KEYOF,
  KINDS,
  LISTS,
  MKINDS,
  MON,
  PRI,
  RUN,
  S,
  SECTION_OF_COLL,
  addInterval,
  aiDefaults,
  aiDesc,
  aiResolve,
  aiRow,
  aiRules,
  aiSnapshot,
  amountOf,
  balanceAt,
  bestTask,
  bizClass,
  bizIndex,
  bizInfo,
  bizStats,
  bizText,
  brainSnapshot,
  brainSystem,
  briefText,
  budgets,
  days,
  dueSoon,
  esc,
  extraLabel,
  fdate,
  findIn,
  fmtDay,
  freeBrain,
  goalInfo,
  guessCat,
  isArabic,
  iso,
  lcDate,
  linkInfo,
  loadDocs,
  localAnswer,
  mLabel,
  mShift,
  maintInfo,
  money,
  moneyStats,
  moneyText,
  monthMoney,
  monthsBetween,
  msOf,
  noDash,
  nowHour,
  num,
  opening,
  opt,
  overdueText,
  parse,
  parsePlan,
  pct,
  planInfo,
  prepareActions,
  readData,
  recommendations,
  reportText,
  runOps,
  settingsOp,
  signals,
  sortBiz,
  stripTags,
  sumK,
  taskStats,
  tickTask,
  toTelegramHtml,
  today,
  valueClass,
  words
};
