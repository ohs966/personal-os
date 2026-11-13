// Personal OS web app. Data lives in this OS's own Cloudflare backend (Worker + D1); the assistant's brain
// is shared with the Telegram bot through core.js.
import { api, cfDb, downloader } from "./cfdb.js";
import {
  AIS, AI_DATE, BRAIN, CANCEL_RE, CLOCK, CONFIRM_RE, DAY, DOWS, FREQ, GENERIC, HELP, KEYOF, KINDS, LISTS, MKINDS, MON, PRI, RUN, S, SECTION_OF_COLL, addInterval, aiDefaults, aiDesc, aiResolve, aiRow, aiRules, aiSnapshot, amountOf, balanceAt, bestTask, bizClass, bizIndex, bizInfo, bizStats, bizText, brainSnapshot, brainSystem, briefText, budgets, days, dueSoon, esc, extraLabel, fdate, findIn, fmtDay, freeBrain, goalInfo, guessCat, isArabic, iso, lcDate, linkInfo, loadDocs, localAnswer, mLabel, mShift, maintInfo, money, moneyStats, moneyText, monthMoney, monthsBetween, msOf, noDash, nowHour, num, opening, opt, overdueText, parse, parsePlan, pct, planInfo, prepareActions, readData, recommendations, reportText, runOps, settingsOp, signals, sortBiz, stripTags, sumK, taskStats, tickTask, toTelegramHtml, today, valueClass, words
} from "./core.js";

// ---------------- state ----------------
let tab = "goals", bizTab = "overview", bizSel = "", payLimit = 40;

// ---------------- helpers ----------------
const $ = s => document.querySelector(s);
const check = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const icon = { up: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5L6 4.5l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  x: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' };

function toast(msg, withUndo) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  if (withUndo) { const b = document.createElement("button"); b.className = "toast-undo"; b.dataset.undo = "1"; b.textContent = "Undo"; t.appendChild(b); }
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, withUndo ? 6000 : 2400);
}

// ---------------- undo ----------------
// Every write goes through a wrapper that remembers each document's state before the change.
let undoGroup = null; const undoStack = [];
function prevOf(c, id) {
  if (c === "app" && id === "options") return S.optsServer ? JSON.parse(JSON.stringify(S.optsServer)) : null;
  const k = KEYOF[c], r = k && S[k].find(x => x.id === id); if (!r) return null;
  const { id: _i, ...rest } = r; return JSON.parse(JSON.stringify(rest));
}
function wrapDb(raw) {
  const rec = (c, id) => { if (undoGroup && !undoGroup.some(o => o.c === c && o.id === id)) undoGroup.push({ c, id, prev: prevOf(c, id) }); };
  const docW = (c, id, ref) => ({ update: d => { rec(c, id); return ref.update(d); }, set: d => { rec(c, id); return ref.set(d); }, delete: () => { rec(c, id); return ref.delete(); },
    onSnapshot: (...a) => ref.onSnapshot(...a), get: (...a) => ref.get(...a) });
  return {
    collection: c => { const col = raw.collection(c); return { onSnapshot: (...a) => col.onSnapshot(...a),
      add: async d => { const g = undoGroup, r = await col.add(d); if (g && r && r.id) g.push({ c, id: r.id, prev: null }); return r; },
      doc: id => docW(c, id, col.doc(id)) }; },
    doc: path => { const [c, id] = path.split("/"); return docW(c, id, raw.doc(path)); },
  };
}
const redoStack = [];
function syncUndoBtn() {
  const b = $("#undo"), r = $("#redo"); if (!b || !r) return;
  const top = undoStack[undoStack.length - 1], rt = redoStack[redoStack.length - 1];
  b.hidden = r.hidden = !!S.readOnly;
  b.disabled = !top; b.title = top ? "Undo: " + top.label + " (Ctrl+Z)" : "Nothing to undo yet";
  r.disabled = !rt; r.title = rt ? "Redo: " + rt.label + " (Ctrl+Shift+Z)" : "Nothing to redo";
}
let undoing = false;
// Applies a group's saved states and returns the opposite group (the states just replaced).
async function applyGroup(g) {
  const inverse = { label: g.label, ops: g.ops.map(o => ({ c: o.c, id: o.id, prev: prevOf(o.c, o.id) })) };
  for (const o of g.ops.slice().reverse()) {
    const ref = o.c === "app" ? S.rawDb.doc("app/" + o.id) : S.rawDb.collection(o.c).doc(o.id);
    if (o.prev) await ref.set(o.prev); else await ref.delete();
  }
  return inverse;
}
async function stepHistory(from, to, word) {
  if (undoing) return; const g = from.pop(); syncUndoBtn();
  if (!g) return toast(`Nothing to ${word.toLowerCase()}.`);
  undoing = true;
  try { const inv = await applyGroup(g); to.push(inv); toast(`${word === "Undo" ? "Undone" : "Redone"}: ` + g.label.replace(/\.$/, ""), false); }
  catch (e) { from.push(g); toast(`Couldn't ${word.toLowerCase()} that. Check your connection and try again.`); }
  undoing = false; syncUndoBtn();
}
const undo = () => stepHistory(undoStack, redoStack, "Undo");
const redo = () => stepHistory(redoStack, undoStack, "Redo");

// ---------------- data writes ----------------
async function write(fn, okMsg) {
  if (!S.db) { toast("Your data isn't connected in this view."); return false; }
  const group = []; undoGroup = group;
  try {
    await fn();
    if (undoGroup === group) undoGroup = null;
    if (group.length) { undoStack.push({ label: okMsg || "Change", ops: group }); if (undoStack.length > 30) undoStack.shift(); redoStack.length = 0; syncUndoBtn(); }
    if (okMsg) toast(okMsg, group.length > 0);
    return true;
  }
  catch (e) {
    if (undoGroup === group) undoGroup = null;
    if (group.length) { undoStack.push({ label: (okMsg || "Change") + " (partly saved)", ops: group }); redoStack.length = 0; syncUndoBtn(); }
    if (e && e.code === "invalid_argument") { S.readOnly = true; toast("You can view this tracker but not change it."); render(); }
    else if (e && e.code === "quota_exceeded") toast("Storage is full. Delete some old payouts to make room.");
    else toast("That didn't save. Check your connection and try again.");
    return false;
  }
}
let optChain = Promise.resolve();
function saveOpts(next) {
  S.opts = next; render();
  optChain = optChain.then(() => write(() => S.db.doc("app/options").set(next)));
  return optChain;
}
function addOption(list, value) {
  value = value.trim(); if (!value) return false;
  const cur = opt(list);
  if (cur.some(x => x.toLowerCase() === value.toLowerCase())) { toast(`"${value}" is already in the list.`); return false; }
  const next = { ...(S.opts || {}), [list]: [...cur, value] };
  saveOpts(next); return true;
}

// ---------------- calculations ----------------
function tiles(list) {
  return `<div class="tiles">${list.map(t => `<div class="tile"><div class="k">${esc(t.k)}</div><div class="v ${t.sm ? "sm" : ""} ${t.num ? "num" : ""}">${t.v}</div>${t.s ? `<div class="s">${t.s}</div>` : ""}</div>`).join("")}</div>`;
}
const barHtml = f => f == null ? "" : `<span class="bar10" aria-hidden="true"><i style="width:${Math.round(Math.min(1, Math.max(0, f)) * 100)}%"></i></span>`;
const timelinePill = t => `<span class="pill ${t === "Achieved" ? "done" : t === "Overdue" ? "late" : t === "Due soon" ? "soon" : "calm"}">${esc(t)}</span>`;
const loading = () => !(S.ready.has("goals") && S.ready.has("opts"));

function viewGoals() {
  const G = S.goals.slice().sort((a, b) => (a.target || "9999").localeCompare(b.target || "9999"));
  const info = new Map(G.map(g => [g.id, goalInfo(g)]));
  const total = G.length, ach = G.filter(g => info.get(g.id).achieved).length;
  const all = G.reduce((s, g) => s + info.get(g.id).price, 0);
  const left = G.reduce((s, g) => s + (info.get(g.id).achieved ? 0 : info.get(g.id).price), 0);
  const save = G.reduce((s, g) => s + info.get(g.id).save, 0);
  const over = G.filter(g => info.get(g.id).timeline === "Overdue"), soon = G.filter(g => info.get(g.id).timeline === "Due soon");
  const nextG = G.filter(g => !info.get(g.id).achieved && parse(g.target) && parse(g.target) >= today())[0];
  const top = opt("priorities")[0];
  const topLeft = G.filter(g => g.priority === top && !info.get(g.id).achieved).length;
  const vals = opt("values").map((v, i) => {
    const gs = G.filter(g => g.value === v), done = gs.filter(g => info.get(g.id).achieved).length;
    const pr = gs.map(g => info.get(g.id).planPct).filter(x => x != null);
    return { v, i, n: gs.length, done, prog: gs.length ? done / gs.length : null,
      total: gs.reduce((s, g) => s + info.get(g.id).price, 0), left: gs.reduce((s, g) => s + (info.get(g.id).achieved ? 0 : info.get(g.id).price), 0),
      save: gs.reduce((s, g) => s + info.get(g.id).save, 0), plan: pr.length ? pr.reduce((a, b) => a + b, 0) / pr.length : null };
  });
  const withGoals = vals.filter(x => x.n);
  const focus = withGoals.slice().sort((a, b) => a.prog - b.prog)[0];
  const biggest = vals.filter(x => x.left > 0).sort((a, b) => b.left - a.left)[0];

  const rows = G.map(g => {
    const f = info.get(g.id);
    return `<tr class="click ${valueClass(g.value)}" data-edit="goal" data-id="${esc(g.id)}">
      <td class="strong">${esc(g.item)}</td><td>${esc(g.value || "-")}</td><td>${esc(g.priority || "-")}</td>
      <td class="r num">${money(f.price)}</td><td>${f.achieved ? '<span class="pill done">' + esc(g.have) + "</span>" : esc(g.have || "-")}</td>
      <td class="num">${fdate(g.target)}</td><td class="r num">${f.days == null ? "-" : f.days}</td><td>${timelinePill(f.timeline)}</td>
      <td class="r num">${money(f.save)}</td><td class="r num">${f.planPct == null ? '<span class="muted">no plan</span>' : pct(f.planPct)}</td></tr>`;
  }).join("");

  return `<div class="head"><h1>Life goals</h1>${S.readOnly ? "" : '<button class="btn" data-new="goal">+ New goal</button>'}
      <p>Everything you want to have or become, why it matters, what it costs and when.</p></div>
    ${tiles([
      { k: "Progress", v: total ? pct(ach / total) : "-", s: total ? barHtml(ach / total) + ` ${ach} of ${total} achieved` : "Add your first goal" },
      { k: "Still to reach (EGP)", v: money(left), num: true, s: all ? `of ${money(all)} total` : "" },
      { k: "Save per month (EGP)", v: money(save), num: true, s: "to hit every target date" },
      { k: "Next goal", v: nextG ? esc(nextG.item) : "Nothing scheduled", sm: true, s: nextG ? `${fdate(nextG.target)} · ${money(num(nextG.price))} EGP` : "Add a target date" },
      { k: "Overdue", v: String(over.length), s: over.length ? money(over.reduce((s, g) => s + num(g.price), 0)) + " EGP behind" : "nothing late" },
      { k: "Due soon", v: String(soon.length), s: `in the next ${dueSoon()} days` },
      { k: "Focus area", v: focus ? esc(focus.v) : "-", sm: true, s: focus ? `lowest progress, ${pct(focus.prog)}` : "" },
      { k: "Top priority left", v: String(topLeft), s: top ? esc(top) + " priority goals pending" : "" },
    ])}
    <section class="sec"><div class="sec-h"><h2>Balance by value</h2><span class="hint">How your goals spread across what matters to you</span></div>
      <div class="scroll"><table><thead><tr><th>Value</th><th class="r">Goals</th><th class="r">Achieved</th><th>Progress</th><th class="r">Total (EGP)</th><th class="r">To reach</th><th class="r">Share</th><th class="r">Save / mo</th><th class="r">Plan avg</th></tr></thead>
      <tbody>${vals.length ? vals.map(x => `<tr class="c${x.i % 8}"><td class="strong">${esc(x.v)}</td><td class="r num">${x.n || "-"}</td><td class="r num">${x.done || "-"}</td>
        <td>${x.prog == null ? "" : barHtml(x.prog) + ' <span class="num">' + pct(x.prog) + "</span>"}</td><td class="r num">${money(x.total)}</td><td class="r num">${money(x.left)}</td>
        <td class="r num">${left ? pct(x.left / left) : "-"}</td><td class="r num">${money(x.save)}</td><td class="r num">${x.plan == null ? "-" : pct(x.plan)}</td></tr>`).join("")
        + `<tr class="total"><td>Total</td><td class="r num">${total || "-"}</td><td class="r num">${ach || "-"}</td><td>${total ? barHtml(ach / total) + ' <span class="num">' + pct(ach / total) + "</span>" : ""}</td><td class="r num">${money(all)}</td><td class="r num">${money(left)}</td><td class="r num">${left ? "100%" : "-"}</td><td class="r num">${money(save)}</td><td class="r num">-</td></tr>`
        : `<tr><td colspan="9" class="empty">No values yet. Add them on the <b>Options</b> tab.</td></tr>`}</tbody></table></div>
      ${biggest ? `<div class="status-line">Biggest cost still ahead: <b>${esc(biggest.v)}</b>, ${money(biggest.left)} EGP</div>` : ""}
    </section>
    <section class="sec"><div class="sec-h"><h2>My goals</h2><span class="hint">Tap a goal to edit it. Rows take their value's colour.</span></div>
      <div class="scroll"><table><thead><tr><th>Item / trait</th><th>Value</th><th>Priority</th><th class="r">Price (EGP)</th><th>Have it?</th><th>Target</th><th class="r">Days left</th><th>Timeline</th><th class="r">Save / mo</th><th class="r">Plan</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="10" class="empty">${loading() ? "Loading your goals..." : "No goals yet. Press <b>+ New goal</b> to add the first one."}</td></tr>`}</tbody></table></div>
    </section>`;
}

function viewPlans() {
  const P = S.plans.map(p => ({ p, f: planInfo(p) })).sort((a, b) => (a.f.target ? iso(a.f.target) : "9999").localeCompare(b.f.target ? iso(b.f.target) : "9999"));
  const doneMs = S.ms.filter(m => m.status === opt("msStatus")[0]).length;
  const avg = P.length ? P.reduce((s, x) => s + x.f.done, 0) / P.length : null;
  const onTrack = P.filter(x => ["Ahead", "On pace", "Complete"].includes(x.f.pace)).length, behind = P.filter(x => x.f.pace === "Behind").length;
  const pend = S.ms.filter(m => m.status !== opt("msStatus")[0] && m.due && S.plans.some(p => p.id === m.planId)).sort((a, b) => a.due.localeCompare(b.due));
  const nextM = pend[0];
  const late = pend.filter(m => parse(m.due) < today()).length;
  const freeGoals = S.goals.filter(g => !S.plans.some(p => p.goalId === g.id));

  const cards = P.map(({ p, f }) => {
    const name = f.g ? f.g.item : "Goal removed";
    const cls = f.g ? valueClass(f.g.value) : "";
    const ms = f.list.map((m, i) => {
      const isDone = m.status === opt("msStatus")[0];
      const d = parse(m.due), dl = d ? days(d, today()) : null;
      const timing = isDone ? "" : dl == null ? "" : dl < 0 ? `<span class="pill late">${-dl}d late</span>` : `<span class="muted">${dl}d left</span>`;
      return `<div class="ms-row ${isDone ? "done" : ""}">
        <button class="tick ${isDone ? "on" : ""}" data-tick="${esc(m.id)}" aria-label="${isDone ? "Mark not done" : "Mark done"}: ${esc(m.name)}" ${S.readOnly ? "disabled" : ""}>${isDone ? check : ""}</button>
        <div class="ms-name" data-edit="ms" data-id="${esc(m.id)}"><b>${esc(m.name)}</b><span>${esc(m.status || "-")} · due ${fdate(m.due)} · worth ${Math.round(num(m.worth))}%</span></div>
        <div class="ms-right">${timing}<span class="pill" style="background:rgba(255,212,0,.7)">reaches ${Math.round(f.reaches[i])}%</span></div></div>`;
    }).join("");
    const warn = f.totalWorth !== 100 && f.list.length ? `<p class="panel-note">Milestones add up to ${Math.round(f.totalWorth)}%. Make them total 100% so the goal finishes at 100%.</p>` : "";
    return `<article class="plan ${cls}">
      <div class="plan-top"><h3>${esc(name)}</h3>${f.g ? `<span class="chip"><span class="dot"></span>${esc(f.g.value || "No value")}</span>` : ""}
        ${f.pace ? `<span class="pill ${f.pace === "Behind" ? "late" : f.pace === "On pace" ? "calm" : "done"}">${f.pace}</span>` : ""}
        ${S.readOnly ? "" : `<button class="btn small ghost" data-edit="plan" data-id="${esc(p.id)}">Edit plan</button><button class="btn small" data-new="ms" data-plan="${esc(p.id)}">+ Milestone</button>`}</div>
      <div class="facts"><span>Start <b>${fdate(p.start)}</b></span><span>Target <b>${f.target ? fdate(iso(f.target)) : "set on Goals"}</b></span>
        <span>Duration <b>${f.dur == null ? "-" : f.dur >= 60 ? Math.round(f.dur / 30.44) + " months" : f.dur + " days"}</b></span>
        <span>Milestones <b>${f.doneCount} / ${f.list.length}</b></span><span>Next <b>${f.next ? esc(f.next.name) : f.list.length ? "All done" : "Add milestones"}</b></span></div>
      <div class="meter"><div class="meter-track" role="img" aria-label="${pct(f.done)} done, ${f.used == null ? "no start date" : pct(f.used) + " of time used"}">
        <div class="meter-fill" style="width:${Math.round(f.done * 100)}%"></div>${f.used == null ? "" : `<div class="meter-time" style="left:calc(${Math.round(f.used * 100)}% - 1px)"></div>`}</div>
        <div class="meter-legend"><span><b>${pct(f.done)}</b> finished</span><span>${f.used == null ? "Add a start date to track pace" : pct(f.used) + " of the time used (dark line)"}</span></div></div>
      ${ms ? `<div class="ms">${ms}</div>` : `<div class="empty">No milestones yet. Add steps and give each one the % of the goal it's worth.</div>`}${warn}
    </article>`;
  }).join("");

  return `<div class="head"><h1>Goal plans</h1>${S.readOnly ? "" : `<button class="btn" data-new="plan" ${freeGoals.length ? "" : "disabled title=\"Every goal already has a plan\""}>+ New plan</button>`}
      <p>Break a goal into milestones. Each milestone is worth a share of the goal, and ticking it moves the goal's % forward.</p></div>
    ${tiles([
      { k: "Active plans", v: String(P.length) },
      { k: "Average done", v: avg == null ? "-" : pct(avg), s: avg == null ? "" : barHtml(avg) },
      { k: "Pace", v: `${onTrack} on track`, sm: true, s: `${behind} behind` },
      { k: "Milestones done", v: `${doneMs} / ${S.ms.length}`, s: late ? `${late} late` : "none late" },
      { k: "Next milestone", v: nextM ? esc(nextM.name) : "Nothing due", sm: true, s: nextM ? fdate(nextM.due) : "" },
    ])}
    <section class="plans">${cards || `<div class="empty">${S.ready.has("plans") ? "No plans yet. Press <b>+ New plan</b> and pick a goal from your Goals tab." : "Loading your plans..."}</div>`}</section>`;
}

function decisionsHtml(sig, ids) {
  const ack = new Map(S.decs.filter(d => d.auto).map(d => [d.key, d]));
  const mine = S.decs.filter(d => !d.auto && (!d.businessId || ids.has(d.businessId) || !S.biz.some(b => b.id === d.businessId)));
  const LV = { warn: "Act", info: "Note", good: "Good", mine: "Mine" };
  const row = (x, done) => `<div class="sig ${x.lv} ${done ? "done" : ""}">
    <button class="tick sm ${done ? "on" : ""}" ${x.auto ? `data-ack="${esc(x.k)}"` : `data-dtick="${esc(x.id)}"`} aria-label="${done ? "Mark not done" : "Mark done"}" ${S.readOnly ? "disabled" : ""}>${done ? check : ""}</button>
    <span class="lv">${LV[x.lv]}</span><span class="txt">${x.t}</span>
    <span class="meta">${x.when ? esc(x.when) : ""}${!x.auto && !S.readOnly ? `<button class="ibtn" data-drm="${esc(x.id)}" aria-label="Remove">${icon.x}</button>` : ""}</span></div>`;
  const auto = sig.map(x => ({ ...x, auto: true, done: !!(ack.get(x.k) || {}).done, when: (ack.get(x.k) || {}).done ? "done " + fdate((ack.get(x.k) || {}).doneAt) : "" }));
  const own = mine.map(d => { const b = S.biz.find(z => z.id === d.businessId);
    return { id: d.id, lv: "mine", auto: false, done: !!d.done, t: (b ? `<b>${esc(b.name)}</b>: ` : "") + esc(d.text), created: d.created || 0,
      when: d.done ? "done " + fdate(d.doneAt) : d.due ? "by " + fdate(d.due) : "" }; });
  const open = [...own.filter(x => !x.done).sort((a, b) => (a.created - b.created)), ...auto.filter(x => !x.done)];
  const done = [...own.filter(x => x.done), ...auto.filter(x => x.done)].sort((a, b) => String(b.when).localeCompare(String(a.when)));
  const form = S.readOnly || !S.db ? "" : `<form class="dec-add" data-dec="1"><input type="text" id="dec-new" placeholder="Add a decision or to-do, e.g. Ask Cafe X for a 12-month contract" aria-label="New decision or to-do">
    <select id="dec-biz" aria-label="Business"><option value="">General</option>${S.biz.map(b => `<option value="${esc(b.id)}" ${b.id === bizSel ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
    <input type="date" id="dec-due" aria-label="Due date (optional)" style="flex:0 1 160px"><button class="btn small" type="submit">Add</button></form>`;
  return form + (open.length ? open.map(x => row(x, false)).join("") : `<div class="empty">${S.biz.length ? "Nothing open. Add a point above when something comes up." : "Add a business to start."}</div>`)
    + (done.length ? `<div class="done-h">Done (${done.length})</div>` + done.slice(0, 15).map(x => row(x, true)).join("") : "");
}

function viewBusiness() {
  sortBiz();
  const ALL = S.biz.map((b, i) => ({ b, i, s: bizStats(b) }));
  const B = ALL.filter(x => !bizSel || x.b.id === bizSel);
  const ids = new Set(B.map(x => x.b.id));
  const pays = S.pays.filter(p => ids.has(p.businessId));
  const rev = sumK(pays, "revenue"), exp = sumK(pays, "expenses"), prof = rev - exp;
  const t = today(), m0 = new Date(t.getFullYear(), t.getMonth(), 1), lm = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const inMonth = (p, m) => { const d = parse(p.date); return d && d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth(); };
  const bname = id => { const b = S.biz.find(x => x.id === id); return b ? esc(b.name) : '<span class="muted">Removed business</span>'; };
  const counts = { sources: S.accts.filter(a => ids.has(a.businessId)).length, milestones: S.bms.filter(m => ids.has(m.businessId)).length,
    maintenance: S.maint.filter(m => ids.has(m.businessId)).length, payouts: pays.length };
  const subs = [["overview", "Overview"], ["sources", "Clients & products"], ["milestones", "Milestones"], ["maintenance", "Maintenance"], ["payouts", "Payouts"]];
  const actions = S.readOnly ? "" : ({
    overview: `<button class="btn ghost" data-new="biz">+ Business</button><button class="btn" data-new="pay" ${S.biz.length ? "" : "disabled"}>+ Log payout</button>`,
    sources: `<button class="btn" data-new="acct" ${S.biz.length ? "" : "disabled"}>+ Client or product</button>`,
    milestones: `<button class="btn" data-new="bms" ${S.biz.length ? "" : "disabled"}>+ Milestone</button>`,
    maintenance: `<button class="btn" data-new="maint" ${S.biz.length ? "" : "disabled"}>+ Maintenance item</button>`,
    payouts: `<button class="btn" data-new="pay" ${S.biz.length ? "" : "disabled"}>+ Log payout</button>`,
  })[bizTab];
  const head = `<div class="head"><h1>Business tracker</h1>${actions}
      <p>Payouts, the clients and products behind them, development milestones and upkeep, all linked per business. Each business keeps its own colour.</p></div>
    <div class="toolbar"><nav class="seg" aria-label="Business sections">${subs.map(([k, l]) => `<button data-btab="${k}" aria-pressed="${bizTab === k}">${l}${counts[k] != null ? `<span class="count">${counts[k]}</span>` : ""}</button>`).join("")}</nav>
      <div class="filter"><label for="bsel" class="muted" style="font-size:12px">Business</label><select id="bsel" data-filter="biz"><option value="">All businesses</option>${S.biz.map(b => `<option value="${esc(b.id)}" ${bizSel === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div></div>`;
  const loadingRow = (cols, msg) => `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`;

  // ----- overview -----
  if (bizTab === "overview") {
    const thisM = pays.filter(p => inMonth(p, m0)), lastM = pays.filter(p => inMonth(p, lm));
    const thisRev = sumK(thisM, "revenue"), lastRev = sumK(lastM, "revenue");
    const maintMo = B.reduce((s, x) => s + x.s.maintMo, 0), net = B.reduce((s, x) => s + x.s.net, 0), avgRev = B.reduce((s, x) => s + x.s.avgRev, 0);
    const best = (fn, fmt) => { const c = B.filter(x => x.s.count).sort((a, b) => fn(b) - fn(a))[0]; return c ? { v: esc(c.b.name), s: fmt(c) } : { v: "No payouts yet", s: "" }; };
    const topE = best(x => x.s.profit, x => money(x.s.profit) + " EGP profit");
    const longest = B.filter(x => x.s.months != null).sort((a, b) => b.s.months - a.s.months)[0];
    const dates = pays.map(p => parse(p.date)).filter(Boolean).sort((a, b) => a - b), months = [];
    if (dates.length) {
      let s = new Date(dates[0].getFullYear(), dates[0].getMonth(), 1); const floor = new Date(m0.getFullYear(), m0.getMonth() - 11, 1); if (s < floor) s = floor;
      for (let d = new Date(s); d <= m0; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
    }
    const mrows = months.map((m, k) => {
      const ps = pays.filter(p => inMonth(p, m)), r = sumK(ps, "revenue"), pr = r - sumK(ps, "expenses");
      const prevR = k ? sumK(pays.filter(p => inMonth(p, months[k - 1])), "revenue") : 0;
      return { m, r, pr, n: ps.length, vs: (k && prevR) ? r / prevR - 1 : null, shares: B.map(x => r ? sumK(ps.filter(p => p.businessId === x.b.id), "revenue") / r : null) };
    });
    const sig = signals(B);
    const totalProfit = B.reduce((s, x) => s + x.s.profit, 0);
    const health = B.map(({ b, i, s }) => `<tr class="click c${i % 8}" data-edit="biz" data-id="${esc(b.id)}">
      <td class="strong">${esc(b.name)}</td><td class="r num">${money(s.avgRev)}</td><td class="r num">${money(s.avgProfit)}</td><td class="r num">${money(s.maintMo)}</td>
      <td class="r num strong">${money(s.net)}</td><td class="r num">${s.maintRatio == null ? "-" : pct(s.maintRatio)}</td>
      <td class="r num">${s.trend == null ? "-" : (s.trend >= 0 ? "+" : "") + pct(s.trend)}</td>
      <td>${s.top ? esc(s.top.a.name) + ' <span class="muted num">' + pct(s.topShare) + "</span>" : "-"}</td><td class="r num">${s.active.length || "-"}</td>
      <td class="r num">${s.ms.length ? s.msDone + " / " + s.ms.length : "-"}</td>
      <td>${s.maintOver || s.msLate ? `<span class="pill late">${s.maintOver + s.msLate} overdue</span>` : s.maintSoon ? `<span class="pill soon">${s.maintSoon} due soon</span>` : '<span class="pill calm">Clear</span>'}</td></tr>`).join("");
    const brow = B.map(({ b, i, s }) => `<tr class="click c${i % 8}" data-edit="biz" data-id="${esc(b.id)}">
      <td class="strong">${esc(b.name)}</td><td>${esc(b.type || "-")}</td><td>${b.status && b.status === opt("bizStatus")[0] ? '<span class="pill done">' + esc(b.status) + "</span>" : esc(b.status || "-")}</td>
      <td>${s.running}</td><td class="r num">${s.count || "-"}</td><td class="r num">${money(s.rev)}</td><td class="r num">${money(s.exp)}</td>
      <td class="r num strong">${money(s.profit)}</td><td class="r num">${pct(s.margin)}</td><td class="r num">${totalProfit ? pct(s.profit / totalProfit) : "-"}</td>
      <td class="num">${fdate(s.last)}</td><td class="r num">${s.perMonth == null ? "-" : s.perMonth.toFixed(1)}</td></tr>`).join("");
    return head + tiles([
      { k: "Total revenue (EGP)", v: money(rev), num: true },
      { k: "Total profit (EGP)", v: money(prof), num: true, s: rev ? `${pct(prof / rev)} margin` : "" },
      { k: "This month (EGP)", v: money(thisRev), num: true, s: `${thisM.length} payouts · ${lastRev ? (thisRev / lastRev - 1 >= 0 ? "+" : "") + pct(thisRev / lastRev - 1) + " vs last month" : "no payouts last month"}` },
      { k: "Maintenance / month (EGP)", v: money(maintMo), num: true, s: avgRev ? `${pct(maintMo / avgRev)} of monthly revenue` : "set up on Maintenance" },
      { k: "Net / month (EGP)", v: money(net), num: true, s: "avg profit, last 3 months, minus upkeep" },
      { k: "Top earner", v: topE.v, sm: true, s: topE.s },
      { k: "Longest running", v: longest ? esc(longest.b.name) : "-", sm: true, s: longest ? longest.s.running : "" },
    ]) + `
    <section class="sec"><div class="sec-h"><h2>What needs a decision</h2><span class="hint">Your own points plus ones worked out from payouts, clients, milestones and maintenance. Tick to mark done.</span></div>
      <div class="signals">${decisionsHtml(sig, ids)}</div>
      <div class="signals" hidden>${sig.length ? sig.slice(0, 10).map(x => `<div class="sig ${x.lv}"><span class="lv">${x.lv === "warn" ? "Act" : x.lv === "good" ? "Good" : "Note"}</span><span>${x.t}</span></div>`).join("")
        : `<div class="empty">${S.biz.length ? "Nothing needs attention right now." : "Add a business to start."}</div>`}</div></section>
    <section class="sec"><div class="sec-h"><h2>Business health</h2><span class="hint">Monthly figures average the last 3 months</span></div>
      <div class="scroll"><table style="min-width:900px"><thead><tr><th>Business</th><th class="r">Revenue / mo</th><th class="r">Profit / mo</th><th class="r">Upkeep / mo</th><th class="r">Net / mo</th><th class="r">Upkeep %</th><th class="r">3-mo trend</th><th>Biggest source</th><th class="r">Active sources</th><th class="r">Milestones</th><th>Overdue</th></tr></thead>
      <tbody>${health || loadingRow(11, S.ready.has("biz") ? "No businesses yet. Press <b>+ Business</b> to add one." : "Loading...")}</tbody></table></div></section>
    <section class="sec"><div class="sec-h"><h2>Your businesses</h2><span class="hint">Tap a business to edit its type, status or start date</span></div>
      <div class="scroll"><table><thead><tr><th>Business</th><th>Type</th><th>Status</th><th>Running for</th><th class="r">Payouts</th><th class="r">Revenue</th><th class="r">Expenses</th><th class="r">Profit</th><th class="r">Margin</th><th class="r">Share</th><th>Last payout</th><th class="r">Per month</th></tr></thead>
      <tbody>${brow ? brow + `<tr class="total"><td colspan="4">${bizSel ? "Selected" : "All businesses"}</td><td class="r num">${pays.length || "-"}</td><td class="r num">${money(rev)}</td><td class="r num">${money(exp)}</td><td class="r num">${money(prof)}</td><td class="r num">${rev ? pct(prof / rev) : "-"}</td><td colspan="3"></td></tr>` : loadingRow(12, "No businesses yet.")}</tbody></table></div></section>
    <section class="sec"><div class="sec-h"><h2>Monthly breakdown</h2><span class="hint">Each business's share of the month's revenue, in its own colour</span></div>
      <div class="scroll"><table><thead><tr><th>Month</th><th class="r">Revenue</th><th class="r">Profit</th><th class="r">Payouts</th><th class="r">Vs last month</th>${B.map(x => `<th class="r">${esc(x.b.name)} %</th>`).join("")}</tr></thead>
      <tbody>${mrows.length ? mrows.slice().reverse().map(x => `<tr><td class="strong">${MON[x.m.getMonth()]} ${x.m.getFullYear()}</td><td class="r num">${money(x.r)}</td><td class="r num">${money(x.pr)}</td><td class="r num">${x.n || "-"}</td>
        <td class="r num">${x.vs == null ? "-" : (x.vs >= 0 ? "+" : "") + pct(x.vs)}</td>${x.shares.map((s, j) => `<td class="r num" style="background:var(--v${B[j].i % 8})">${s ? pct(s) : "-"}</td>`).join("")}</tr>`).join("")
        : loadingRow(5 + B.length, "Months appear here after your first payout.")}</tbody></table></div></section>`;
  }

  // ----- clients & products -----
  if (bizTab === "sources") {
    const rows = B.flatMap(x => x.s.bySrc.map(src => ({ ...src, bi: x.i, b: x.b, bizRev: x.s.rev })));
    const ACT = opt("acctStatus")[0], isAct = a => !a.status || a.status === ACT;
    const clients = rows.filter(r => r.a.kind !== "Product" && isAct(r.a)).length, products = rows.filter(r => r.a.kind === "Product" && isAct(r.a)).length;
    const top = rows.slice().sort((a, b) => b.rev - a.rev)[0];
    const dormant = B.reduce((s, x) => s + x.s.dormant.length, 0);
    const cats = {}; rows.forEach(r => { const c = r.a.category || "Uncategorised"; cats[c] = cats[c] || { n: 0, rev: 0 }; cats[c].n++; cats[c].rev += r.rev; });
    const totalSrcRev = rows.reduce((s, r) => s + r.rev, 0);
    const body = rows.map(r => {
      const since = r.last ? days(t, parse(r.last)) : null, act = isAct(r.a);
      return `<tr class="click c${r.bi % 8}" data-edit="acct" data-id="${esc(r.a.id)}"><td style="min-width:220px"><div class="strong">${esc(r.a.name)}</div>${r.a.contract ? `<div class="muted" style="font-size:12px;max-width:300px;overflow-wrap:anywhere">${esc(r.a.contract)}</div>` : ""}</td><td>${esc(r.a.kind || "Client")}</td><td>${esc(r.b.name)}</td><td>${esc(r.a.category || "-")}</td>
        <td>${esc(r.a.contractType || "-")}${r.a.contractNo ? `<div class="muted num" style="font-size:11.5px">No. ${esc(r.a.contractNo)}</div>` : ""}</td><td>${esc(r.a.payTerms || "-")}</td><td class="num" style="white-space:nowrap">${r.a.phone ? `<a href="tel:${esc(r.a.phone.replace(/[^0-9+]/g, ""))}" style="color:inherit">${esc(r.a.phone)}</a>` : "-"}</td>
        <td>${act ? '<span class="pill done">' + esc(r.a.status || ACT || "Active") + "</span>" : esc(r.a.status)}</td><td class="num">${fdate(r.a.since)}</td>
        <td class="r num">${r.n || "-"}</td><td class="r num">${money(r.rev)}</td><td class="r num">${money(r.profit)}</td><td class="r num">${r.bizRev ? pct(r.rev / r.bizRev) : "-"}</td>
        <td class="r num">${r.n ? money(r.rev / r.n) : "-"}</td><td class="r num">${r.maintMo ? money(r.maintMo) : "-"}</td><td class="num">${fdate(r.last)}</td>
        <td>${act && (since == null || since > 60) ? `<span class="pill soon">${since == null ? "Never paid" : since + "d quiet"}</span>` : since == null ? "-" : `<span class="muted">${since}d ago</span>`}</td></tr>`;
    }).join("");
    return head + tiles([
      { k: "Active clients", v: String(clients) }, { k: "Active products", v: String(products) },
      { k: "Biggest source", v: top && top.rev ? esc(top.a.name) : "-", sm: true, s: top && top.rev ? `${pct(top.bizRev ? top.rev / top.bizRev : 0)} of ${esc(top.b.name)}` : "" },
      { k: "Quiet 60+ days", v: String(dormant), s: "active but no recent payout" },
      { k: "Payouts not linked", v: String(B.reduce((s, x) => s + x.s.untagged, 0)), s: "link them to a client or product" },
    ]) + `
    <section class="sec"><div class="sec-h"><h2>Clients & products</h2><span class="hint">Everything a business earns from. Link payouts to them when you log one.</span></div>
      <div class="scroll"><table style="min-width:1280px"><thead><tr><th>Name</th><th>Kind</th><th>Business</th><th>Category</th><th>Contract</th><th>Payment terms</th><th>Number</th><th>Status</th><th>Since</th><th class="r">Payouts</th><th class="r">Revenue</th><th class="r">Profit</th><th class="r">Share of business</th><th class="r">Avg payout</th><th class="r">Upkeep / mo</th><th>Last payout</th><th>Activity</th></tr></thead>
      <tbody>${body || loadingRow(17, S.ready.has("accts") ? "No clients or products yet. Press <b>+ Client or product</b>, e.g. a supply customer for SSS or a best-selling item for Sulta Studios." : "Loading...")}</tbody></table></div></section>
    <div class="two-col" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
    <section class="sec"><div class="sec-h"><h2>By category</h2></div>
      <div class="scroll"><table style="min-width:0"><thead><tr><th>Category</th><th class="r">Count</th><th class="r">Revenue</th><th class="r">Share</th></tr></thead>
      <tbody>${Object.keys(cats).length ? Object.entries(cats).sort((a, b) => b[1].rev - a[1].rev).map(([c, v]) => `<tr><td class="strong">${esc(c)}</td><td class="r num">${v.n}</td><td class="r num">${money(v.rev)}</td><td class="r num">${totalSrcRev ? pct(v.rev / totalSrcRev) : "-"}</td></tr>`).join("") : loadingRow(4, "Categories show once you add clients or products.")}</tbody></table></div></section>
    <section class="sec"><div class="sec-h"><h2>By contract and payment terms</h2></div>
      <div class="scroll"><table style="min-width:0"><thead><tr><th>Contract type</th><th>Payment terms</th><th class="r">Count</th><th class="r">Revenue</th><th class="r">Upkeep / mo</th></tr></thead>
      <tbody>${(() => { const g = {}; rows.forEach(r => { const k = (r.a.contractType || "No contract set") + "|" + (r.a.payTerms || "-"); g[k] = g[k] || { n: 0, rev: 0, mo: 0 }; g[k].n++; g[k].rev += r.rev; g[k].mo += r.maintMo; });
        const e = Object.entries(g).sort((a, b) => b[1].rev - a[1].rev); return e.length ? e.map(([k, v]) => { const [ct, pt] = k.split("|"); return `<tr><td class="strong">${esc(ct)}</td><td>${esc(pt)}</td><td class="r num">${v.n}</td><td class="r num">${money(v.rev)}</td><td class="r num">${money(v.mo)}</td></tr>`; }).join("") : loadingRow(5, "Shows once you add clients."); })()}</tbody></table></div></section>
    </div>`;
  }

  // ----- business milestones -----
  if (bizTab === "milestones") {
    const DONE = opt("msStatus")[0];
    const list = S.bms.filter(m => ids.has(m.businessId)).sort((a, b) => (a.status === DONE) - (b.status === DONE) || (a.due || "9999").localeCompare(b.due || "9999"));
    const done = list.filter(m => m.status === DONE).length, late = list.filter(m => m.status !== DONE && m.due && parse(m.due) < t).length;
    const next = list.find(m => m.status !== DONE && m.due);
    const invest = sumK(list, "invest"), investDone = sumK(list.filter(m => m.status === DONE), "invest");
    const body = list.map(m => {
      const isDone = m.status === DONE, d = parse(m.due), dl = d ? days(d, t) : null;
      return `<tr class="${bizClass(m.businessId)}"><td><button class="tick sm ${isDone ? "on" : ""}" data-btick="${esc(m.id)}" aria-label="${isDone ? "Mark not done" : "Mark done"}: ${esc(m.name)}" ${S.readOnly ? "disabled" : ""}>${isDone ? check : ""}</button></td>
        <td class="strong click-cell" data-edit="bms" data-id="${esc(m.id)}" style="cursor:pointer">${esc(m.name)}</td><td>${bname(m.businessId)}</td><td>${esc(m.area || "-")}</td><td class="num">${fdate(m.due)}</td><td>${esc(m.status || "-")}</td>
        <td class="r num">${money(num(m.invest))}</td><td>${isDone ? '<span class="pill done">Done</span>' : dl == null ? "-" : dl < 0 ? `<span class="pill late">${-dl}d late</span>` : dl <= 14 ? `<span class="pill soon">${dl}d left</span>` : `<span class="muted">${dl}d left</span>`}</td>
        <td class="muted">${esc(m.note || "")}</td></tr>`;
    }).join("");
    const per = B.map(({ b, i, s }) => `<tr class="c${i % 8}"><td class="strong">${esc(b.name)}</td><td>${s.ms.length ? barHtml(s.msDone / s.ms.length) + ' <span class="num">' + pct(s.msDone / s.ms.length) + "</span>" : "-"}</td><td class="r num">${s.ms.length ? s.msDone + " / " + s.ms.length : "-"}</td><td class="r num">${s.msLate || "-"}</td><td>${s.nextMs ? esc(s.nextMs.name) + ' <span class="muted num">' + fdate(s.nextMs.due) + "</span>" : "-"}</td><td class="r num">${money(s.invest)}</td></tr>`).join("");
    return head + tiles([
      { k: "Milestones reached", v: `${done} / ${list.length}`, s: list.length ? barHtml(done / list.length) : "" },
      { k: "Late", v: String(late), s: late ? "past their due date" : "nothing late" },
      { k: "Next up", v: next ? esc(next.name) : "-", sm: true, s: next ? `${bname(next.businessId)} · ${fdate(next.due)}` : "" },
      { k: "Investment planned (EGP)", v: money(invest), num: true, s: invest ? `${money(investDone)} spent on reached milestones` : "add a cost to milestones" },
    ]) + `
    <section class="sec"><div class="sec-h"><h2>Progress by business</h2></div>
      <div class="scroll"><table><thead><tr><th>Business</th><th>Progress</th><th class="r">Reached</th><th class="r">Late</th><th>Next milestone</th><th class="r">Investment (EGP)</th></tr></thead>
      <tbody>${per || loadingRow(6, "Add a business first.")}</tbody></table></div></section>
    <section class="sec"><div class="sec-h"><h2>Development milestones</h2><span class="hint">Tick to mark reached. Tap a name to edit.</span></div>
      <div class="scroll"><table><thead><tr><th style="width:40px"></th><th>Milestone</th><th>Business</th><th>Area</th><th>Due</th><th>Status</th><th class="r">Investment (EGP)</th><th>Timing</th><th>Note</th></tr></thead>
      <tbody>${body || loadingRow(9, S.ready.has("bms") ? "No milestones yet. Press <b>+ Milestone</b> for steps like a new product line, a website launch or a first wholesale client." : "Loading...")}</tbody></table></div></section>`;
  }

  // ----- maintenance -----
  if (bizTab === "maintenance") {
    const list = S.maint.filter(m => ids.has(m.businessId)).map(m => ({ m, i: maintInfo(m) }))
      .sort((a, b) => ({ Overdue: 0, "Due soon": 1, OK: 2, "No date": 3 }[a.i.state] ?? 4) - ({ Overdue: 0, "Due soon": 1, OK: 2, "No date": 3 }[b.i.state] ?? 4) || (a.m.next || "9999").localeCompare(b.m.next || "9999"));
    const mo = list.reduce((s, x) => s + x.i.perMonth, 0), over = list.filter(x => x.i.state === "Overdue"), soon = list.filter(x => x.i.state === "Due soon");
    const avgRev = B.reduce((s, x) => s + x.s.avgRev, 0);
    const cats = {}; list.forEach(x => { const c = x.m.category || "Uncategorised"; cats[c] = (cats[c] || 0) + x.i.perMonth; });
    const pill = st => `<span class="pill ${st === "Overdue" ? "late" : st === "Due soon" ? "soon" : st === "OK" ? "calm" : "calm"}">${esc(st)}</span>`;
    const body = list.map(({ m, i }) => `<tr class="${bizClass(m.businessId)}"><td class="strong" data-edit="maint" data-id="${esc(m.id)}" style="cursor:pointer">${esc(m.item)}</td><td>${bname(m.businessId)}</td><td>${(() => { const a = S.accts.find(x => x.id === m.accountId); return a ? esc(a.name) : '<span class="muted">Whole business</span>'; })()}</td><td>${esc(m.category || "-")}</td>
      <td>${esc(m.freq || "-")}</td><td class="r num">${money(num(m.cost))}</td><td class="r num">${money(i.perMonth)}</td><td class="num">${fdate(m.next)}</td><td class="num">${fdate(m.last)}</td><td><div style="display:flex;gap:6px;align-items:center;white-space:nowrap">${pill(i.state)}${S.readOnly || !i.active ? "" : `<button class="btn small ghost" data-mdone="${esc(m.id)}">Done today</button>`}</div></td></tr>`).join("");
    const per = B.map(({ b, i, s }) => `<tr class="c${i % 8}"><td class="strong">${esc(b.name)}</td><td class="r num">${money(s.maintMo)}</td><td class="r num">${money(s.maintMo * 12)}</td><td class="r num">${s.maintRatio == null ? "-" : pct(s.maintRatio)}</td><td class="r num strong">${money(s.net)}</td><td class="r num">${s.maintOver || "-"}</td></tr>`).join("");
    return head + tiles([
      { k: "Upkeep / month (EGP)", v: money(mo), num: true, s: avgRev ? `${pct(mo / avgRev)} of monthly revenue` : "" },
      { k: "Upkeep / year (EGP)", v: money(mo * 12), num: true },
      { k: "Overdue", v: String(over.length), s: over.length ? esc(over[0].m.item) + (over.length > 1 ? " and more" : "") : "nothing overdue" },
      { k: "Due in 14 days", v: String(soon.length), s: soon.length ? money(sumK(soon.map(x => x.m), "cost")) + " EGP coming up" : "" },
    ]) + `
    <div class="two-col">
    <section class="sec"><div class="sec-h"><h2>Maintenance items</h2><span class="hint">Subscriptions, renewals and upkeep. "Done today" moves the next due date forward.</span></div>
      <div class="scroll"><table style="min-width:980px"><thead><tr><th>Item</th><th>Business</th><th>For</th><th>Category</th><th>How often</th><th class="r">Cost (EGP)</th><th class="r">Per month</th><th>Next due</th><th>Last done</th><th>State</th></tr></thead>
      <tbody>${body || loadingRow(10, S.ready.has("maint") ? "Nothing tracked yet. Press <b>+ Maintenance item</b> for things like the Shopify plan, Zendrop, a domain renewal or equipment servicing." : "Loading...")}</tbody></table></div></section>
    <div class="sec" style="gap:14px">
    <section class="sec"><div class="sec-h"><h2>Cost of keeping each business running</h2></div>
      <div class="scroll"><table style="min-width:0"><thead><tr><th>Business</th><th class="r">/ month</th><th class="r">/ year</th><th class="r">% of revenue</th><th class="r">Net / mo</th><th class="r">Overdue</th></tr></thead>
      <tbody>${per || loadingRow(6, "Add a business first.")}</tbody></table></div></section>
    <section class="sec"><div class="sec-h"><h2>By category</h2></div>
      <div class="scroll"><table style="min-width:0"><thead><tr><th>Category</th><th class="r">/ month</th><th class="r">Share</th></tr></thead>
      <tbody>${Object.keys(cats).length ? Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<tr><td class="strong">${esc(c)}</td><td class="r num">${money(v)}</td><td class="r num">${mo ? pct(v / mo) : "-"}</td></tr>`).join("") : loadingRow(3, "Categories show once you add items.")}</tbody></table></div></section>
    </div></div>`;
  }

  // ----- payouts -----
  const shown = pays.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.created || 0) - (a.created || 0));
  const prow = shown.slice(0, payLimit).map(p => {
    const src = S.accts.find(a => a.id === p.accountId), pr = num(p.revenue) - num(p.expenses);
    return `<tr class="click ${bizClass(p.businessId)}" data-edit="pay" data-id="${esc(p.id)}"><td class="num">${fdate(p.date)}</td><td class="strong">${bname(p.businessId)}</td><td>${src ? esc(src.name) : '<span class="muted">Not linked</span>'}</td>
      <td class="r num">${money(num(p.revenue))}</td><td class="r num">${money(num(p.expenses))}</td><td class="r num strong">${money(pr)}</td><td>${esc(p.paidVia || "-")}</td><td class="muted">${esc(p.note || "")}</td></tr>`;
  }).join("");
  return head + `<section class="sec"><div class="sec-h"><h2>Payout log</h2><span class="hint">Newest first. Tap a payout to fix it or link it to a client or product.</span></div>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Business</th><th>Client / product</th><th class="r">Revenue (EGP)</th><th class="r">Expenses (EGP)</th><th class="r">Profit (EGP)</th><th>Paid via</th><th>Note</th></tr></thead>
      <tbody>${prow || loadingRow(8, S.ready.has("pays") ? "No payouts logged yet. Press <b>+ Log payout</b> when money comes in." : "Loading...")}</tbody></table></div>
      ${shown.length > payLimit ? `<div style="text-align:center"><button class="btn ghost small" data-more="pay">Show ${Math.min(40, shown.length - payLimit)} more</button></div>` : ""}</section>`;
}

// ---------------- backup and restore ----------------
const COLLS = [["goals", "goals"], ["plans", "plans"], ["milestones", "ms"], ["businesses", "biz"], ["payouts", "pays"], ["accounts", "accts"], ["bizMilestones", "bms"],
  ["maintenance", "maint"], ["decisions", "decs"], ["todos", "todos"], ["money", "money"], ["fixed", "fixed"]];
let DL = null, restoreData = null;
const strip = o => { const { id, ...rest } = o; return rest; };
const stamp = () => { const d = new Date(); return iso(d) + "_" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0"); };
async function saveFile(filename, data) {
  if (!DL) { toast("Saving files isn't available in this view. Open the tracker in Claude."); return false; }
  try { await DL.save({ filename, data }); return true; }
  catch (e) {
    const c = e && e.code;
    if (c === "declined") toast("Not saved.");
    else if (c === "rate_limited") toast("A save is already waiting for your answer.");
    else if (c === "too_large") toast("That file is too large for this destination.");
    else toast("Saving isn't available here right now.");
    return false;
  }
}
async function backupJson() {
  const out = { app: "life-business-tracker", version: 1, exportedAt: new Date().toISOString(), options: S.opts || {}, collections: {} };
  COLLS.forEach(([c, k]) => { out.collections[c] = Object.fromEntries(S[k].map(x => [x.id, strip(x)])); });
  const n = COLLS.reduce((s2, [, k]) => s2 + S[k].length, 0);
  const ok = await saveFile(`life-business-backup_${stamp()}.json`, JSON.stringify(out, null, 1));
  if (ok) { toast(`Backup saved: ${n} records`); saveOpts({ ...(S.opts || {}), lastBackup: iso(today()) }); }
}
// Minimal .xlsx writer (no outside library): SpreadsheetML parts in an uncompressed zip.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  files.forEach(([name, text]) => {
    const nb = enc.encode(name), db = enc.encode(text), c = crc32(db);
    const head = [0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0)];
    parts.push(new Uint8Array(head), nb, db);
    central.push(new Uint8Array([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
    off += head.length + nb.length + db.length;
  });
  const cSize = central.reduce((s2, x) => s2 + x.length, 0);
  return new Blob([...parts, ...central, new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cSize), ...u32(off), 0, 0])]);
}
function makeXlsx(sheets) {
  const x = v => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const col = i => { let s2 = ""; i++; while (i) { const m = (i - 1) % 26; s2 = String.fromCharCode(65 + m) + s2; i = Math.floor((i - 1) / 26); } return s2; };
  const names = Object.keys(sheets).map(n => n.replace(/[\\\/?*\[\]:]/g, " ").slice(0, 31));
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFD400"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC1121F"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
  ];
  Object.values(sheets).forEach((rows, si) => {
    const keys = rows.length ? Object.keys(rows[0]) : ["Info"], data = rows.length ? rows : [{ Info: "Nothing yet" }];
    const widths = keys.map(k => Math.min(45, Math.max(10, k.length + 2, ...data.map(r => String(r[k] ?? "").length + 2))));
    const cell = (v, r, c, head) => { const ref = col(c) + r;
      if (!head && typeof v === "number" && isFinite(v)) return `<c r="${ref}" s="2"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${head ? ' s="1"' : ""}><is><t xml:space="preserve">${x(v)}</t></is></c>`; };
    const body = [`<row r="1">${keys.map((k, c) => cell(k, 1, c, true)).join("")}</row>`, ...data.map((r, i) => `<row r="${i + 2}">${keys.map((k, c) => cell(r[k], i + 2, c, false)).join("")}</row>`)].join("");
    files.push([`xl/worksheets/sheet${si + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData></worksheet>`]);
  });
  return zipStore(files);
}
async function backupXlsx() {
  const bn = id => (S.biz.find(b => b.id === id) || {}).name || "", an = id => (S.accts.find(a => a.id === id) || {}).name || "", gn = id => (S.goals.find(g => g.id === id) || {}).item || "";
  const sheets = {
    "Goals": S.goals.map(g => ({ Item: g.item, Value: g.value, Priority: g.priority, "Price (EGP)": num(g.price), "Have it": g.have, Target: g.target })),
    "Plan milestones": S.ms.map(m => { const p = S.plans.find(x => x.id === m.planId) || {}; return { Goal: gn(p.goalId), "Plan start": p.start || "", Milestone: m.name, "Worth %": num(m.worth), Due: m.due || "", Status: m.status, "Done on": m.doneAt || "" }; }),
    "Businesses": S.biz.map(b => ({ Business: b.name, Type: b.type, Status: b.status, Start: b.start || "" })),
    "Payouts": S.pays.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(p => ({ Date: p.date, Business: bn(p.businessId), "Client / product": an(p.accountId), "Revenue (EGP)": num(p.revenue), "Expenses (EGP)": num(p.expenses), "Profit (EGP)": num(p.revenue) - num(p.expenses), "Paid via": p.paidVia || "", Note: p.note || "" })),
    "Clients & products": S.accts.map(a => ({ Name: a.name, Kind: a.kind, Business: bn(a.businessId), Category: a.category || "", Status: a.status || "", "Contract type": a.contractType || "", "Contract no.": a.contractNo || "", Contract: a.contract || "", "Payment terms": a.payTerms || "", "Contact number": a.phone || "", Since: a.since || "", Note: a.note || "" })),
    "Business milestones": S.bms.map(m => ({ Business: bn(m.businessId), Milestone: m.name, Area: m.area || "", Due: m.due || "", Status: m.status, "Investment (EGP)": num(m.invest), "Done on": m.doneAt || "", Note: m.note || "" })),
    "Maintenance": S.maint.map(m => ({ Item: m.item, Business: bn(m.businessId), For: an(m.accountId) || "Whole business", Category: m.category || "", "Cost (EGP)": num(m.cost), "How often": m.freq, "Per month (EGP)": Math.round(maintInfo(m).perMonth), "Next due": m.next || "", "Last done": m.last || "", Status: m.status || "" })),
    "Money": S.money.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(x => ({ Date: x.date, Type: x.kind, Category: x.category, "Amount (EGP)": num(x.amount), Note: x.note || "" })),
    "Fixed items": S.fixed.map(f => ({ Name: f.note || "", Type: f.kind, Category: f.category, "Amount (EGP)": num(f.amount), "Day of month": num(f.day) })),
    "Tasks": S.todos.filter(x => !x.dismissed).slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(x => { const li = linkInfo(x.link); return { Day: x.date, Task: x.text, Area: li.area, "Linked to": li.name, Priority: x.pri || "", Minutes: num(x.mins), Done: x.done ? "Yes" : "No", "Done on": x.doneAt || "", Note: x.note || "" }; }),
    "Decisions": S.decs.filter(d => !d.auto).map(d => ({ Point: d.text, Business: bn(d.businessId) || "General", Due: d.due || "", Done: d.done ? "Yes" : "No", "Done on": d.doneAt || "" })),
  };
  if (await saveFile(`life-business_${stamp()}.xlsx`, makeXlsx(sheets))) toast("Spreadsheet saved");
}
async function readRestoreFile(file) {
  try {
    const j = JSON.parse(await file.text());
    if (!j || j.app !== "life-business-tracker" || !j.collections) throw new Error("bad");
    const counts = COLLS.map(([c]) => [c, Object.keys(j.collections[c] || {}).length]);
    restoreData = { j, n: counts.reduce((s2, [, n]) => s2 + n, 0), busy: false }; render();
  } catch (e) { restoreData = null; toast("That file isn't a tracker backup."); }
}
async function doRestore() {
  if (!restoreData || restoreData.busy) return; const j = restoreData.j; restoreData.busy = true; render();
  let n = 0;
  const ok = await write(async () => {
    const rows = [];
    for (const [c] of COLLS) for (const [id, d] of Object.entries(j.collections[c] || {})) rows.push({ coll: c, id, data: d });
    if (j.options && typeof j.options === "object") rows.push({ coll: "app", id: "options", data: { ...j.options } });
    if (j.assistant && typeof j.assistant === "object") rows.push({ coll: "app", id: "assistant", data: { ...j.assistant } });
    n = rows.filter(r => r.coll !== "app").length;
    if (S.rawDb && S.rawDb.bulkSet) await S.rawDb.bulkSet(rows);
    else for (const r of rows) await S.db.doc(r.coll + "/" + r.id).set(r.data);
  });
  restoreData = null;
  if (ok) toast(`Restored ${n} records`); render();
}
function backupCard() {
  const last = S.opts && S.opts.lastBackup, ago = last ? days(today(), parse(last)) : null;
  const n = COLLS.reduce((s2, [, k]) => s2 + S[k].length, 0);
  return `<section class="sec backup"><div class="sec-h"><h2>Backup and restore</h2><span class="hint">${last ? `Last backup ${fdate(last)}${ago ? `, ${ago} ${ago === 1 ? "day" : "days"} ago` : ", today"}` : "No backup yet"} · ${n} records</span></div>
    <div class="backup-row">
      <div><b>Full backup</b><p class="note">One file with everything, including options and budgets. Keep it somewhere safe, like Google Drive. You can restore from it any time.</p>
        <button class="btn" data-backup="json" ${DL ? "" : "disabled"}>Download backup</button></div>
      <div><b>Spreadsheet copy</b><p class="note">An Excel file with a readable sheet for each part: payouts, money, clients, maintenance, tasks and more.</p>
        <button class="btn ghost" data-backup="xlsx" ${DL ? "" : "disabled"}>Download spreadsheet</button></div>
      <div><b>Restore</b><p class="note">Bring back data from a backup file. Nothing is deleted; records in the file are put back.</p>
        ${S.readOnly || !S.db ? '<p class="note">Not available in this view.</p>' : '<label class="btn ghost" style="display:inline-block;cursor:pointer">Choose backup file<input type="file" accept=".json,application/json" id="restore-file" hidden></label>'}</div>
    </div>${DL ? "" : '<p class="note">Downloading files needs the tracker open inside Claude.</p>'}<div id="restore-box">${!restoreData ? "" : restoreData.busy ? '<p class="note">Restoring. Keep this page open.</p>'
      : `<div class="confirm"><span>Backup from <b>${esc(String(restoreData.j.exportedAt || "").slice(0, 10))}</b> with ${restoreData.n} records. Restoring brings back everything in it and overwrites records with the same id. Records you added since are kept.</span>
      <div><button type="button" class="btn small" data-restoreyes="1">Restore now</button><button type="button" class="btn small ghost" data-restoreno="1">Cancel</button></div></div>`}</div></section>`;
}

function viewOptions() {
  const cards = Object.entries(LISTS).map(([k, meta]) => `<div class="opt"><h3>${esc(meta.label)}</h3>
    <ul>${opt(k).map((v, i) => `<li class="${meta.coloured ? "c" + (i % 8) : ""}"><span class="t">${esc(v)}</span>${i === 0 && meta.note.startsWith("The first") ? '<span class="first">first</span>' : ""}
      ${S.readOnly ? "" : `${i ? `<button class="ibtn" title="Move up" aria-label="Move ${esc(v)} up" data-up="${k}" data-i="${i}">${icon.up}</button>` : ""}<button class="ibtn" title="Remove" aria-label="Remove ${esc(v)}" data-rm="${k}" data-i="${i}">${icon.x}</button>`}</li>`).join("") || '<li><span class="t muted">Nothing yet</span></li>'}</ul>
    ${S.readOnly ? "" : `<form data-addopt="${k}"><input type="text" id="add-${k}" placeholder="Add an option" aria-label="Add to ${esc(meta.label)}"><button class="btn small" type="submit">Add</button></form>`}
    ${meta.note ? `<p class="note">${esc(meta.note)}</p>` : ""}</div>`).join("");
  return `<div class="head"><h1>Options</h1><p>Backups, and the choices in every dropdown. You can also add a new choice straight from any dropdown with <b>+ Add new…</b>.</p></div>
    ${backupCard()}
    <div class="opt-grid">${cards}
      <div class="opt"><h3>Due soon window</h3><form data-soon="1"><input type="number" id="soon" min="1" max="365" value="${dueSoon()}" aria-label="Due soon window in days" ${S.readOnly ? "disabled" : ""}><button class="btn small" type="submit" ${S.readOnly ? "disabled" : ""}>Save</button></form>
        <p class="note">Goals with a target date within this many days show as Due soon.</p></div></div>`;
}

// ---------------- today (daily to-do) ----------------
let dayView = iso(today());
const linkSelect = (id, value) => `<select id="${id}" aria-label="Linked to">
    <option value="">General</option>
    <optgroup label="Life"><option value="life" ${value === "life" ? "selected" : ""}>Life (general)</option>${S.goals.map(g => `<option value="goal:${esc(g.id)}" ${value === "goal:" + g.id ? "selected" : ""}>${esc(g.item)}</option>`).join("")}</optgroup>
    <optgroup label="Business"><option value="business" ${value === "business" ? "selected" : ""}>Business (general)</option>${S.biz.map(b => `<option value="biz:${esc(b.id)}" ${value === "biz:" + b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</optgroup></select>`;

function viewToday() {
  const tIso = iso(today()), isToday = dayView === tIso, d = parse(dayView);
  const st = taskStats(), list = st.onDay(dayView);
  const rank = { High: 0, Medium: 1, Low: 2 };
  const open = list.filter(x => !x.done).sort((a, b) => (rank[a.pri] ?? 1) - (rank[b.pri] ?? 1) || (a.created || 0) - (b.created || 0));
  const done = list.filter(x => x.done);
  const carried = isToday ? S.todos.filter(x => !x.dismissed && !x.done && x.date && x.date < tIso).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const minsP = list.reduce((s, x) => s + num(x.mins), 0), minsD = done.reduce((s, x) => s + num(x.mins), 0);
  const recs = isToday ? recommendations() : [];
  const label = isToday ? "Today" : dayView === iso(new Date(today().getTime() + DAY)) ? "Tomorrow" : dayView === iso(new Date(today().getTime() - DAY)) ? "Yesterday" : "";
  const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const row = (x, extra = "") => { const li = linkInfo(x.link);
    return `<div class="sig todo ${x.done ? "done" : ""} ${li.cls}">
      <button class="tick sm ${x.done ? "on" : ""}" data-ttick="${esc(x.id)}" aria-label="${x.done ? "Mark not done" : "Mark done"}" ${S.readOnly ? "disabled" : ""}>${x.done ? check : ""}</button>
      <span class="lv pri-${(x.pri || "Medium").toLowerCase()}">${esc(x.pri || "Medium")}</span>
      <span class="txt" data-edit="todo" data-id="${esc(x.id)}" style="cursor:pointer">${esc(x.text)}${li.name ? ` <span class="chip ${li.cls}"><span class="dot"></span>${esc(li.name)}</span>` : ` <span class="muted" style="font-size:11.5px">${esc(li.area)}</span>`}${x.note ? `<div class="muted" style="font-size:12px">${esc(x.note)}</div>` : ""}</span>
      <span class="meta">${extra}${num(x.mins) ? `<span class="num">${num(x.mins)} min</span>` : ""}${S.readOnly ? "" : `${!x.done ? `<button class="btn small ghost" data-tmove="${esc(x.id)}" title="Move to the next day">Tomorrow</button>` : ""}<button class="ibtn" data-trm="${esc(x.id)}" aria-label="Remove">${icon.x}</button>`}</span></div>`; };
  const form = S.readOnly || !S.db ? "" : `<form class="dec-add" data-todo="1"><input type="text" id="td-new" placeholder="Add a task for ${label ? label.toLowerCase() : fdate(dayView)}" aria-label="New task">
    ${linkSelect("td-link", "")}<select id="td-pri" aria-label="Priority" style="flex:0 1 120px">${PRI.map(p => `<option ${p === "Medium" ? "selected" : ""}>${p}</option>`).join("")}</select>
    <input type="number" id="td-mins" min="0" step="5" placeholder="Minutes" aria-label="Minutes" style="flex:0 1 110px"><button class="btn small" type="submit">Add</button></form>`;
  return `<div class="head"><h1>${label ? label : DOW[d.getDay()]} <span class="muted" style="font-size:16px;font-weight:600">${DOW[d.getDay()]}, ${fdate(dayView)}</span></h1>
      <div class="dayn"><button class="btn ghost small" data-day="-1" aria-label="Previous day">&larr;</button>${isToday ? "" : '<button class="btn ghost small" data-day="0">Today</button>'}<button class="btn ghost small" data-day="1" aria-label="Next day">&rarr;</button></div>
      <p>Your daily list for life and business. Tick tasks off, push them to tomorrow, or add a recommendation with one tap.</p></div>
    ${tiles([
      { k: "Done", v: `${done.length} / ${list.length}`, s: list.length ? barHtml(done.length / list.length) : "nothing planned yet" },
      { k: "Time", v: `${minsD} / ${minsP} min`, sm: true, s: minsP ? "done / planned" : "add minutes to plan your time" },
      { k: "Streak", v: `${st.streak} ${st.streak === 1 ? "day" : "days"}`, sm: true, s: "days in a row with a task done" },
      { k: "Last 7 days", v: st.w.all ? pct(st.w.done / st.w.all) : "-", s: st.w.all ? `${st.w.done} of ${st.w.all} tasks done` : "" },
      { k: "Carried over", v: String(carried.length), s: carried.length ? "unfinished from earlier days" : "all clear" },
    ])}
    <div class="two-col">
      <section class="sec"><div class="sec-h"><h2>${label ? label + "'s" : "This day's"} list</h2><span class="hint">Tap a task to edit it</span></div>
        <div class="signals">${form}
          ${open.length ? open.map(x => row(x)).join("") : `<div class="empty">${list.length ? "Everything done. Nice." : "No tasks yet. Add one above or pick a recommendation."}</div>`}
          ${carried.length ? `<div class="done-h">Carried over (${carried.length})</div>` + carried.map(x => row(x, `<span class="pill soon">from ${fdate(x.date)}</span>${S.readOnly ? "" : `<button class="btn small" data-ttoday="${esc(x.id)}">Move to today</button>`}`)).join("") : ""}
          ${done.length ? `<div class="done-h">Done (${done.length})</div>` + done.map(x => row(x)).join("") : ""}</div></section>
      <section class="sec"><div class="sec-h"><h2>Recommended</h2><span class="hint">${isToday ? "From your plans, milestones, maintenance and clients" : "Shown on today's list"}</span></div>
        <div class="signals">${recs.length ? recs.slice(0, 12).map(r => { const li = linkInfo(r.link);
          return `<div class="sig rec ${li.cls}"><span class="lv pri-${r.pri.toLowerCase()}">${r.pri}</span><span class="txt">${esc(r.text)}<div class="muted" style="font-size:12px">${esc(r.why)}${li.name ? " · " + esc(li.name) : ""}</div></span>
            <span class="meta">${S.readOnly ? "" : `${r.action === "backup" ? `<button class="btn small" data-backup="json" ${DL ? "" : "disabled"}>Back up now</button>` : `<button class="btn small" data-radd="${esc(r.key)}">+ Add</button>`}<button class="ibtn" data-rskip="${esc(r.key)}" aria-label="Dismiss" title="Not today">${icon.x}</button>`}</span></div>`; }).join("")
          : `<div class="empty">${isToday ? "No recommendations right now. Everything's on track." : "Go to today to see recommendations."}</div>`}</div></section>
    </div>`;
}

// ---------------- insights (charts) ----------------
const HUE = i => `var(--h${i % 8})`;
let tipEl = null;
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const short = n => { const a = Math.abs(n); return (n < 0 ? "-" : "") + (a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M" : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "k" : String(Math.round(a))); };
// groups: [{label, segs:[{v, c, name}], tip}] stacked, values may be negative only for single-seg groups
function vbars(groups, { h = 200, fmt = short, unit = "", int = false } = {}) {
  const W = 640, padL = 44, padB = 26, padT = 10, plotH = h - padB - padT, n = Math.max(1, groups.length);
  const tops = groups.map(g => g.segs.filter(s => s.v > 0).reduce((a, s) => a + s.v, 0)), bots = groups.map(g => g.segs.filter(s => s.v < 0).reduce((a, s) => a + s.v, 0));
  const max = int ? Math.max(2, Math.ceil(Math.max(0, ...tops) / 2) * 2) : niceMax(Math.max(0, ...tops)), minRaw = Math.min(0, ...bots), min = minRaw < 0 ? -niceMax(-minRaw) : 0;
  const y = v => padT + (max - v) / (max - min) * plotH, slot = (W - padL) / n, bw = Math.max(6, Math.min(36, slot * .62));
  const ticks = [0, .5, 1].map(f => min + (max - min) * f).concat(min < 0 ? [0] : []);
  let svg = `<svg viewBox="0 0 ${W} ${h}" class="chart" role="img">`;
  [...new Set(ticks)].forEach(tv => { svg += `<line x1="${padL}" x2="${W}" y1="${y(tv)}" y2="${y(tv)}" class="${tv === 0 ? "base" : "grid"}"/><text x="${padL - 6}" y="${y(tv) + 4}" class="ax" text-anchor="end">${fmt(tv)}</text>`; });
  groups.forEach((g, i) => {
    const cx = padL + slot * i + slot / 2, x = cx - bw / 2; let up = 0, down = 0;
    const pos = g.segs.filter(s => s.v > 0), neg = g.segs.filter(s => s.v < 0);
    pos.forEach((s, k) => { const y0 = y(up), y1 = y(up + s.v); up += s.v; const top = k === pos.length - 1, hh = Math.max(0, y0 - y1 - (k ? 2 : 0));
      svg += top ? `<path d="M${x},${y0 - (k ? 2 : 0)}v${-Math.max(0, hh - 4)}q0,-4 4,-4h${bw - 8}q4,0 4,4v${Math.max(0, hh - 4)}z" fill="${s.c}"/>` : `<rect x="${x}" y="${y1}" width="${bw}" height="${hh}" fill="${s.c}"/>`; });
    neg.forEach(s => { const y0 = y(down), y1 = y(down + s.v); down += s.v; const hh = Math.max(0, y1 - y0);
      svg += `<path d="M${x},${y0}v${Math.max(0, hh - 4)}q0,4 4,4h${bw - 8}q4,0 4,-4v${-Math.max(0, hh - 4)}z" fill="${s.c}"/>`; });
    if (n <= 16 || i % 2 === 0) svg += `<text x="${cx}" y="${h - 8}" class="ax" text-anchor="middle">${esc(g.label)}</text>`;
    svg += `<rect x="${padL + slot * i}" y="${padT}" width="${slot}" height="${plotH}" class="hit" data-tip="${esc(g.tip || g.label)}"/>`;
  });
  return svg + "</svg>";
}
// rows: [{label, v, c, txt, tip, mark}] horizontal bars, mark = 0..1 marker position for pct charts
function hbars(rows, { fmt = short, max = null, pctMode = false } = {}) {
  if (!rows.length) return "";
  const W = 640, rh = 30, padL = 150, padR = 92, H = rows.length * rh + 6;
  const mx = pctMode ? 1 : niceMax(Math.max(0, ...rows.map(r => Math.max(r.v, r.mark || 0)))), mn = pctMode ? 0 : Math.min(0, ...rows.map(r => r.v));
  const span = (mx - mn) || 1, x = v => padL + (v - mn) / span * (W - padL - padR);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
  if (mn < 0) svg += `<line x1="${x(0)}" x2="${x(0)}" y1="0" y2="${H}" class="base"/>`;
  rows.forEach((r, i) => {
    const yy = i * rh + 6, x0 = x(Math.min(0, r.v)), x1 = x(Math.max(0, r.v)), w = Math.max(r.v ? 2 : 0, x1 - x0);
    svg += `<text x="${padL - 8}" y="${yy + 15}" class="lb" text-anchor="end">${esc(r.label.length > 22 ? r.label.slice(0, 21) + "…" : r.label)}</text>`;
    if (pctMode) svg += `<rect x="${padL}" y="${yy + 4}" width="${W - padL - padR}" height="14" rx="4" class="track"/>`;
    svg += `<rect x="${x0}" y="${yy + 4}" width="${w}" height="14" rx="4" fill="${r.c}"/>`;
    if (r.mark != null) svg += `<line x1="${x(r.mark)}" x2="${x(r.mark)}" y1="${yy}" y2="${yy + 22}" class="marker"/>`;
    svg += `<text x="${W - padR + 8}" y="${yy + 15}" class="val">${esc(r.txt != null ? r.txt : fmt(r.v))}</text>`;
    svg += `<rect x="0" y="${yy}" width="${W}" height="${rh}" class="hit" data-tip="${esc(r.tip || r.label + ": " + (r.txt != null ? r.txt : fmt(r.v)))}"/>`;
  });
  return svg + "</svg>";
}
const legend = items => `<div class="legend">${items.map(i => `<span><i style="background:${i.c}"></i>${esc(i.name)}</span>`).join("")}</div>`;
const tableOf = (head, rows) => `<div class="scroll"><table style="min-width:0"><thead><tr>${head.map((h, i) => `<th class="${i ? "r" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? "r num" : "strong"}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
let chartN = 0;
const card = (title, hint, chart, table, empty) => { const id = "ch" + (chartN++);
  return `<section class="sec chart-card"><div class="sec-h"><h2>${esc(title)}</h2>${table && !empty ? `<button class="btn ghost small" data-ctab="${id}">Table</button>` : ""}</div>
    ${hint ? `<p class="hint" style="margin:0">${hint}</p>` : ""}
    ${empty ? `<div class="empty">${empty}</div>` : `<div class="chart-wrap" id="${id}-c">${chart}</div><div id="${id}-t" hidden>${table}</div>`}</section>`; };

function viewInsights() {
  chartN = 0; sortBiz();
  const t = today(), m0 = new Date(t.getFullYear(), t.getMonth(), 1), DONE = opt("msStatus")[0];
  const months = Array.from({ length: 12 }, (_, i) => new Date(m0.getFullYear(), m0.getMonth() - 11 + i, 1));
  const mKey = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), mLab = d => MON[d.getMonth()] + (d.getMonth() === 0 ? " " + String(d.getFullYear()).slice(2) : "");
  const B = S.biz.map((b, i) => ({ b, i, s: bizStats(b) }));
  // tiles
  const inDays = (p, a, z) => { const d = parse(p.date); return d && d > a && d <= z; };
  const d30 = new Date(t.getTime() - 30 * DAY), d60 = new Date(t.getTime() - 60 * DAY);
  const rev30 = sumK(S.pays.filter(p => inDays(p, d30, t)), "revenue"), revP = sumK(S.pays.filter(p => inDays(p, d60, d30)), "revenue");
  const st = taskStats();
  const plansI = S.plans.map(planInfo).filter(f => f.g), onPace = plansI.filter(f => ["Ahead", "On pace", "Complete"].includes(f.pace)).length;
  const overdue = S.maint.filter(m => maintInfo(m).state === "Overdue").length + S.bms.filter(m => m.status !== DONE && m.due && parse(m.due) < t).length
    + plansI.reduce((s, f) => s + f.list.filter(m => m.status !== DONE && m.due && parse(m.due) < t).length, 0) + S.todos.filter(x => !x.dismissed && !x.done && x.date && x.date < iso(t)).length;
  // upcoming maintenance cost in windows
  const win = [30, 60, 90], upcoming = B.map(x => win.map(() => 0));
  S.maint.forEach(m => { const i = maintInfo(m), bi = S.biz.findIndex(b => b.id === m.businessId); if (!i.active || !m.next || bi < 0) return;
    let d = m.next, guard = 0; while (d && guard++ < 60) { const dl = days(parse(d), t); if (dl > 90) break; const w = dl <= 30 ? 0 : dl <= 60 ? 1 : 2; upcoming[bi][w] += num(m.cost); const nx = addInterval(d, m.freq); if (!nx || nx === d) break; d = nx; } });
  const up30 = upcoming.reduce((s, r) => s + r[0], 0);
  const goalsLeft = S.goals.filter(g => !goalInfo(g).achieved);
  let html = `<div class="head"><h1>Insights</h1><p>Charts for decisions across life, business and your time. Hover or tap a bar for the numbers, or press Table to see them as a list.</p></div>`
    + tiles([
      { k: "Revenue, last 30 days (EGP)", v: money(rev30), num: true, s: revP ? `${rev30 >= revP ? "+" : ""}${pct(rev30 / revP - 1)} vs the 30 days before` : "no payouts in the 30 days before" },
      { k: "Net / month after upkeep (EGP)", v: money(B.reduce((s, x) => s + x.s.net, 0)), num: true, s: "all businesses, last 3 months" },
      { k: "Upkeep due, next 30 days (EGP)", v: money(up30), num: true },
      { k: "Tasks done, last 7 days", v: st.w.all ? pct(st.w.done / st.w.all) : "-", s: `${st.w.done} of ${st.w.all} · streak ${st.streak}d` },
      { k: "Plans on pace", v: plansI.length ? `${onPace} / ${plansI.length}` : "-", s: plansI.length ? "ahead, on pace or complete" : "no plans yet" },
      { k: "Overdue items", v: String(overdue), s: "milestones, maintenance and tasks" },
      { k: "Still to fund (EGP)", v: money(goalsLeft.reduce((s, g) => s + num(g.price), 0)), num: true, s: `${goalsLeft.length} ${goalsLeft.length === 1 ? "goal" : "goals"} not reached` },
    ]);

  // ---- business ----
  const pm = months.map(m => { const ps = S.pays.filter(p => p.date && p.date.slice(0, 7) === mKey(m)); return { m, ps, byB: B.map(x => sumK(ps.filter(p => p.businessId === x.b.id), "revenue")), rev: sumK(ps, "revenue"), prof: sumK(ps, "revenue") - sumK(ps, "expenses") }; });
  const anyPay = pm.some(x => x.rev || x.prof);
  const bizLegend = legend(B.map(x => ({ c: HUE(x.i), name: x.b.name })));
  const c1 = card("Revenue by business", "Last 12 months, stacked by business. Shows who carries each month.",
    (B.length > 1 ? bizLegend : "") + vbars(pm.map(x => ({ label: mLab(x.m), segs: x.byB.map((v, j) => ({ v, c: HUE(B[j].i) })), tip: `${MON[x.m.getMonth()]} ${x.m.getFullYear()}: ${money(x.rev)} EGP` + B.map((y, j) => x.byB[j] ? ` · ${y.b.name} ${money(x.byB[j])}` : "").join("") }))),
    tableOf(["Month", ...B.map(x => x.b.name), "Total"], pm.map(x => [MON[x.m.getMonth()] + " " + x.m.getFullYear(), ...x.byB.map(money), money(x.rev)])), anyPay ? "" : "Log payouts to see this chart.");
  const c2 = card("Profit per month", "All businesses, revenue minus expenses on each payout.",
    vbars(pm.map(x => ({ label: mLab(x.m), segs: [{ v: x.prof, c: x.prof < 0 ? "var(--h7)" : "var(--h0)" }], tip: `${MON[x.m.getMonth()]} ${x.m.getFullYear()}: ${money(x.prof)} EGP profit` }))),
    tableOf(["Month", "Profit (EGP)"], pm.map(x => [MON[x.m.getMonth()] + " " + x.m.getFullYear(), money(x.prof)])), anyPay ? "" : "Log payouts to see this chart.");
  const netRows = B.map(x => ({ label: x.b.name, v: x.s.net, c: HUE(x.i), txt: money(x.s.net), tip: `${x.b.name}: ${money(x.s.avgProfit)} profit − ${money(x.s.maintMo)} upkeep = ${money(x.s.net)} EGP a month` }));
  const c3 = card("Net per month after upkeep", "Average profit over the last 3 months minus monthly maintenance. Where to invest, and what to fix.",
    hbars(netRows), tableOf(["Business", "Profit / mo", "Upkeep / mo", "Net / mo"], B.map(x => [x.b.name, money(x.s.avgProfit), money(x.s.maintMo), money(x.s.net)])), B.length ? "" : "Add a business first.");
  const srcAll = B.flatMap(x => x.s.bySrc.filter(r => r.rev > 0).map(r => ({ ...r, bi: x.i, b: x.b, share: x.s.rev ? r.rev / x.s.rev : 0 }))).sort((a, b) => b.rev - a.rev).slice(0, 8);
  const c4 = card("Top clients and products", "Revenue by source, coloured by business. A long first bar means risky dependence.",
    (B.length > 1 ? bizLegend : "") + hbars(srcAll.map(r => ({ label: r.a.name, v: r.rev, c: HUE(r.bi), txt: `${short(r.rev)} · ${pct(r.share)}`, tip: `${r.a.name} (${r.b.name}): ${money(r.rev)} EGP, ${pct(r.share)} of the business, ${r.n} payouts` }))),
    tableOf(["Client / product", "Business", "Revenue", "Share"], srcAll.map(r => [r.a.name, r.b.name, money(r.rev), pct(r.share)])), srcAll.length ? "" : "Link payouts to clients or products to see this.");
  const cats = {}; S.maint.forEach(m => { const i = maintInfo(m); if (i.perMonth) { const c = m.category || "Uncategorised"; cats[c] = (cats[c] || 0) + i.perMonth; } });
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const c5 = card("Upkeep by category", "Monthly maintenance cost. The biggest bar is the first place to cut or renegotiate.",
    hbars(catRows.map(([c, v]) => ({ label: c, v, c: "var(--h0)", txt: money(v) }))), tableOf(["Category", "EGP / month"], catRows.map(([c, v]) => [c, money(v)])), catRows.length ? "" : "Add maintenance items to see this.");
  const c6 = card("Upkeep coming up", "Maintenance cost falling due in the next 90 days, so you can keep cash ready.",
    (B.length > 1 ? bizLegend : "") + vbars(win.map((w, k) => ({ label: k === 0 ? "Next 30 days" : k === 1 ? "31 to 60" : "61 to 90", segs: B.map((x, j) => ({ v: upcoming[j][k], c: HUE(x.i) })), tip: `${k === 0 ? "Next 30 days" : k === 1 ? "Days 31 to 60" : "Days 61 to 90"}: ${money(upcoming.reduce((s, r) => s + r[k], 0))} EGP` + B.map((x, j) => upcoming[j][k] ? ` · ${x.b.name} ${money(upcoming[j][k])}` : "").join("") }))),
    tableOf(["Window", ...B.map(x => x.b.name)], win.map((w, k) => [k === 0 ? "Next 30 days" : k === 1 ? "31 to 60" : "61 to 90", ...B.map((x, j) => money(upcoming[j][k]))])), S.maint.some(m => maintInfo(m).active && m.next) ? "" : "Add maintenance with a next due date to see this.");

  // ---- life ----
  const vals = opt("values"), byVal = vals.map((v, i) => { const gs = S.goals.filter(g => g.value === v); const a = gs.filter(g => goalInfo(g).achieved).length; return { v, i, n: gs.length, a, left: gs.filter(g => !goalInfo(g).achieved).reduce((s, g) => s + num(g.price), 0) }; });
  const c7 = card("Goals reached by value", "Share of goals achieved in each area of life. The shortest bar is where to focus next.",
    hbars(byVal.filter(x => x.n).map(x => ({ label: x.v, v: x.a / x.n, c: HUE(x.i), txt: `${x.a} / ${x.n}`, tip: `${x.v}: ${x.a} of ${x.n} goals reached, ${money(x.left)} EGP still to fund` })), { pctMode: true }),
    tableOf(["Value", "Reached", "Goals", "Still to fund"], byVal.filter(x => x.n).map(x => [x.v, String(x.a), String(x.n), money(x.left)])), S.goals.length ? "" : "Add goals to see this.");
  const c8 = card("Plans: progress vs time used", "Bar is how much of the goal is done. The line is how much of its time has passed. Bar behind the line means behind schedule.",
    hbars(plansI.map(f => ({ label: f.g.item, v: f.done, c: HUE(Math.max(0, vals.indexOf(f.g.value))), mark: f.used, txt: pct(f.done), tip: `${f.g.item}: ${pct(f.done)} done, ${f.used == null ? "no dates" : pct(f.used) + " of the time used"} · ${f.pace || "no pace"}` })), { pctMode: true }),
    tableOf(["Plan", "Done", "Time used", "Pace"], plansI.map(f => [f.g.item, pct(f.done), f.used == null ? "-" : pct(f.used), f.pace || "-"])), plansI.length ? "" : "Make a plan on the Plans tab to see this.");
  const fm = Array.from({ length: 12 }, (_, i) => new Date(m0.getFullYear(), m0.getMonth() + i, 1));
  const need = fm.map(m => ({ m, gs: goalsLeft.filter(g => g.target && g.target.slice(0, 7) === mKey(m)) }));
  const late = goalsLeft.filter(g => g.target && parse(g.target) < m0);
  const c9 = card("Money needed by target month", "Price of goals not reached yet, by the month you want them. Plan savings around the tall bars.",
    vbars(need.map(x => ({ label: mLab(x.m), segs: [{ v: x.gs.reduce((s, g) => s + num(g.price), 0), c: "var(--h1)" }], tip: `${MON[x.m.getMonth()]} ${x.m.getFullYear()}: ${money(x.gs.reduce((s, g) => s + num(g.price), 0))} EGP` + (x.gs.length ? " · " + x.gs.map(g => g.item).join(", ") : "") }))),
    tableOf(["Month", "EGP", "Goals"], need.filter(x => x.gs.length).map(x => [MON[x.m.getMonth()] + " " + x.m.getFullYear(), money(x.gs.reduce((s, g) => s + num(g.price), 0)), x.gs.map(g => g.item).join(", ")])),
    need.some(x => x.gs.length) ? "" : "Add goals with a price and target date in the next 12 months to see this.") + (late.length ? `<p class="hint" style="margin:-4px 0 0">${late.length} unreached ${late.length === 1 ? "goal is" : "goals are"} already past ${late.length === 1 ? "its" : "their"} target date.</p>` : "");

  // ---- time and tasks ----
  const AREAS = [["Business", "var(--h0)"], ["Life", "var(--h1)"], ["General", "var(--h2)"]];
  const real = S.todos.filter(x => !x.dismissed);
  const dd = Array.from({ length: 14 }, (_, i) => new Date(t.getFullYear(), t.getMonth(), t.getDate() - 13 + i));
  const perDay = dd.map(d => { const k = iso(d), xs = real.filter(x => x.done && (x.doneAt || x.date) === k); return { d, k, by: AREAS.map(([a]) => xs.filter(x => linkInfo(x.link).area === a).length), planned: real.filter(x => x.date === k).length }; });
  const c10 = card("Tasks done per day", "Last 14 days, by area. Keeps an eye on balance between life and business.",
    legend(AREAS.map(([n, c]) => ({ c, name: n }))) + vbars(perDay.map(x => ({ label: String(x.d.getDate()), segs: x.by.map((v, j) => ({ v, c: AREAS[j][1] })), tip: `${fdate(x.k)}: ${x.by.reduce((a, b) => a + b, 0)} done of ${x.planned} planned` + AREAS.map(([a], j) => x.by[j] ? ` · ${a} ${x.by[j]}` : "").join("") })), { fmt: v => String(Math.round(v)), int: true }),
    tableOf(["Day", ...AREAS.map(a => a[0]), "Planned"], perDay.map(x => [fdate(x.k), ...x.by.map(String), String(x.planned)])), real.length ? "" : "Tick off tasks on the Today tab to see this.");
  const from30 = iso(new Date(t.getTime() - 29 * DAY)), t30 = real.filter(x => x.date >= from30 && x.date <= iso(t));
  const byPri = PRI.map((p, i) => { const xs = t30.filter(x => (x.pri || "Medium") === p); return { p, n: xs.length, d: xs.filter(x => x.done).length, i }; });
  const byArea = AREAS.map(([a, c]) => { const xs = t30.filter(x => linkInfo(x.link).area === a); return { a, c, n: xs.length, d: xs.filter(x => x.done).length, mins: xs.filter(x => x.done).reduce((s, x) => s + num(x.mins), 0) }; });
  const c11 = card("Finish rate, last 30 days", "Share of planned tasks you finished. Low on High priority means the day is overloaded.",
    hbars([...byPri.filter(x => x.n).map(x => ({ label: x.p + " priority", v: x.d / x.n, c: "var(--h0)", txt: `${pct(x.d / x.n)} · ${x.d}/${x.n}` })), ...byArea.filter(x => x.n).map(x => ({ label: x.a, v: x.d / x.n, c: x.c, txt: `${pct(x.d / x.n)} · ${x.d}/${x.n}` }))], { pctMode: true }),
    tableOf(["Group", "Done", "Planned", "Rate"], [...byPri.filter(x => x.n).map(x => [x.p + " priority", String(x.d), String(x.n), pct(x.d / x.n)]), ...byArea.filter(x => x.n).map(x => [x.a, String(x.d), String(x.n), pct(x.d / x.n)])]), t30.length ? "" : "Plan tasks on the Today tab to see this.");
  const d7 = dd.slice(-7).map(d => { const k = iso(d), xs = real.filter(x => x.date === k); const dm = xs.filter(x => x.done).reduce((s, x) => s + num(x.mins), 0), pmin = xs.reduce((s, x) => s + num(x.mins), 0); return { d, k, dm, left: Math.max(0, pmin - dm), pmin }; });
  const DOW3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const c12 = card("Time planned vs done", "Last 7 days, in minutes. The light part is planned time you didn't get to.",
    legend([{ c: "var(--h0)", name: "Done" }, { c: "var(--track)", name: "Not done" }]) + vbars(d7.map(x => ({ label: DOW3[x.d.getDay()], segs: [{ v: x.dm, c: "var(--h0)" }, { v: x.left, c: "var(--track)" }], tip: `${fdate(x.k)}: ${x.dm} of ${x.pmin} min done` })), { fmt: v => Math.round(v) + "m" }),
    tableOf(["Day", "Done (min)", "Planned (min)"], d7.map(x => [fdate(x.k), String(x.dm), String(x.pmin)])), real.some(x => num(x.mins)) ? "" : "Add minutes to tasks to see where your time goes.");
  const msDone = months.map(m => ({ m, life: S.ms.filter(x => x.status === DONE && x.doneAt && x.doneAt.slice(0, 7) === mKey(m)).length, biz: S.bms.filter(x => x.status === DONE && x.doneAt && x.doneAt.slice(0, 7) === mKey(m)).length }));
  const c13 = card("Milestones reached per month", "Goal plan milestones and business milestones you ticked off. Shows momentum.",
    legend([{ c: "var(--h1)", name: "Life" }, { c: "var(--h0)", name: "Business" }]) + vbars(msDone.map(x => ({ label: mLab(x.m), segs: [{ v: x.life, c: "var(--h1)" }, { v: x.biz, c: "var(--h0)" }], tip: `${MON[x.m.getMonth()]} ${x.m.getFullYear()}: ${x.life} life, ${x.biz} business` })), { fmt: v => String(Math.round(v)), int: true }),
    tableOf(["Month", "Life", "Business"], msDone.map(x => [MON[x.m.getMonth()] + " " + x.m.getFullYear(), String(x.life), String(x.biz)])), msDone.some(x => x.life || x.biz) ? "" : "Counts milestones from now on, as you tick them.");

  const mm12 = Array.from({ length: 12 }, (_, i) => mShift(iso(t).slice(0, 7), -11 + i)).map(monthMoney), anyMoney = mm12.some(m => m.xs.length);
  const c14 = card("Left over each month", "Personal income minus spending. Red months spent more than came in.",
    vbars(mm12.map(m => ({ label: mLab(parse(m.k + "-01")), segs: [{ v: m.net, c: m.net < 0 ? "var(--h7)" : "var(--h5)" }], tip: `${mLabel(m.k)}: ${money(m.income)} in, ${money(m.spent)} out, ${money(m.net)} left` }))),
    tableOf(["Month", "Income", "Spent", "Left over"], mm12.map(m => [mLabel(m.k), money(m.income), money(m.spent), money(m.net)])), anyMoney ? "" : "Log income and expenses on the Money tab to see this.");
  const curM = monthMoney(iso(t).slice(0, 7)), BGt = budgets(), spendRows = [...new Set([...opt("expenseCats"), ...Object.keys(curM.byCat)])].map(c => ({ c, v: curM.byCat[c] || 0, b: num(BGt[c]) })).filter(r => r.v || r.b).sort((a, b) => b.v - a.v).slice(0, 10);
  const c15 = card("Spending vs budget, this month", "Bar is what you've spent. The line is the budget. Past the line means over budget.",
    hbars(spendRows.map(r => ({ label: r.c, v: r.v, c: r.b && r.v > r.b ? "var(--h7)" : "var(--h0)", mark: r.b || null, txt: r.b ? `${short(r.v)} / ${short(r.b)}` : short(r.v), tip: `${r.c}: ${money(r.v)} spent${r.b ? ` of ${money(r.b)} budget` : ", no budget"}` }))),
    tableOf(["Category", "Spent", "Budget"], spendRows.map(r => [r.c, money(r.v), money(r.b)])), spendRows.length ? "" : "Log expenses or set budgets on the Money tab to see this.");
  const avgCats = {}, withSpend = mm12.slice(-4, -1).filter(m => m.spent); withSpend.forEach(m => Object.entries(m.byCat).forEach(([c, v]) => { avgCats[c] = (avgCats[c] || 0) + v / withSpend.length; }));
  const avgRows = Object.entries(avgCats).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const c16 = card("Where your money usually goes", "Average monthly spending by category over the last 3 full months you logged.",
    hbars(avgRows.map(([c, v]) => ({ label: c, v, c: "var(--h6)", txt: money(v) }))), tableOf(["Category", "EGP / month"], avgRows.map(([c, v]) => [c, money(v)])), avgRows.length ? "" : "Shows once you have a month or more of expenses.");
  const c17 = card("Balance at month end", "Starting balance plus everything in minus everything out.",
    vbars(mm12.map(m => { const b = balanceAt(m.k); return { label: mLab(parse(m.k + "-01")), segs: [{ v: b || 0, c: b < 0 ? "var(--h7)" : "var(--h0)" }], tip: b == null ? `${mLabel(m.k)}: before your starting month` : `${mLabel(m.k)}: ${money(b)} EGP` }; })),
    tableOf(["Month", "Balance"], mm12.map(m => [mLabel(m.k), money(balanceAt(m.k))])), anyMoney || opening().amount ? "" : "Set a starting balance on the Money tab to see this.");
  html += `<h2 class="group-h">Personal money</h2><div class="charts">${c14}${c15}${c16}${c17}</div>`;
  return html + `<h2 class="group-h">Business</h2><div class="charts">${c1}${c2}${c3}${c4}${c5}${c6}</div>
    <h2 class="group-h">Life</h2><div class="charts">${c7}${c8}${c9}</div>
    <h2 class="group-h">Time and tasks</h2><div class="charts">${c10}${c11}${c12}${c13}</div>`;
}

// ---------------- money (personal monthly balance sheet) ----------------
let moneyMonth = iso(today()).slice(0, 7), entryCat = "";
function setBudget(cat, v) {
  const b = { ...budgets() }; if (v > 0) b[cat] = v; else delete b[cat];
  const next = { ...(S.opts || {}), budgets: b }; S.opts = next; render();
  return write(() => S.db.doc("app/options").set(next), v > 0 ? `Budget for ${cat}: ${money(v)} EGP` : `Removed ${cat} from your budgets`);
}
function viewMoney() {
  const k = moneyMonth, M = monthMoney(k), P = monthMoney(mShift(k, -1)), st = moneyStats(), B = budgets();
  const cats = opt("expenseCats"), totalBudget = cats.reduce((s, c) => s + num(B[c]), 0);
  const fixedDue = S.fixed.filter(f => !S.money.some(x => x.fixedId === f.id && x.date && x.date.slice(0, 7) === k));
  const closing = balanceAt(k), openBal = balanceAt(mShift(k, -1));
  const catRows = [...new Set([...cats, ...Object.keys(M.byCat)])].map((c, i) => ({ c, i, b: num(B[c]), s: M.byCat[c] || 0, p: P.byCat[c] || 0 })).filter(r => r.b || r.s || r.p);
  const over = catRows.filter(r => r.b && r.s > r.b);
  const months = Array.from({ length: 12 }, (_, i) => mShift(k, -11 + i)).map(monthMoney);
  const firstMonth = S.money.map(x => (x.date || "").slice(0, 7)).filter(Boolean).sort()[0];
  const sheet = months.filter(m => m.xs.length || (firstMonth && m.k >= firstMonth && m.k <= st.cur)).reverse();
  const entries = M.xs.filter(x => !entryCat || (x.category || "Other") === entryCat).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.created || 0) - (a.created || 0));
  const pctBar = (s, b) => b ? `<span class="bar10 ${s > b ? "over" : ""}"><i style="width:${Math.min(100, Math.round(s / b * 100))}%"></i></span>` : "";
  return `<div class="head"><h1>Money <span class="muted" style="font-size:16px;font-weight:600">${mLabel(k)}</span></h1>
      <div class="dayn"><button class="btn ghost small" data-mmon="-1" aria-label="Previous month">&larr;</button>${k === st.cur ? "" : '<button class="btn ghost small" data-mmon="0">This month</button>'}<button class="btn ghost small" data-mmon="1" aria-label="Next month">&rarr;</button></div>
      ${S.readOnly ? "" : `<button class="btn ghost" data-new="budget">Budgets & balance</button><button class="btn ghost" data-new="money" data-mkind="Income">+ Income</button><button class="btn" data-new="money" data-mkind="Expense">+ Expense</button>`}
      <p>Your personal monthly balance sheet: what came in, what went out, and what's left. Set budgets per category and fixed monthly items like rent.</p></div>
    ${tiles([
      { k: "Income (EGP)", v: money(M.income), num: true, s: P.income ? `${M.income >= P.income ? "+" : ""}${pct(M.income / P.income - 1)} vs last month` : "" },
      { k: "Spent (EGP)", v: money(M.spent), num: true, s: totalBudget ? `${pct(M.spent / totalBudget)} of ${money(totalBudget)} budget` : P.spent ? `${M.spent >= P.spent ? "+" : ""}${pct(M.spent / P.spent - 1)} vs last month` : "" },
      { k: "Left over (EGP)", v: money(M.net) === "-" ? "0" : money(M.net), num: true, s: M.rate == null ? "" : `${pct(M.rate)} saved` },
      { k: "Balance (EGP)", v: money(closing) === "-" ? "0" : money(closing), num: true, s: `end of ${mLabel(k)}${opening().amount || opening().month ? "" : " · set a starting balance"}` },
      { k: "Avg monthly spend (EGP)", v: st.avgSpend == null ? "-" : money(st.avgSpend), num: true, s: "last 3 months" },
      { k: "Runway", v: st.runway == null ? "-" : st.runway < 0 ? "0 mo" : `${st.runway.toFixed(1)} mo`, sm: true, s: "how long your balance lasts at that spend" },
      { k: "Over budget", v: String(over.length), s: over.length ? over.slice(0, 2).map(r => esc(r.c)).join(", ") + (over.length > 2 ? " and more" : "") : "all within budget" },
    ])}
    ${fixedDue.length && !S.readOnly ? `<div class="sig info" style="grid-template-columns:56px minmax(0,1fr) auto"><span class="lv">Fixed</span><span class="txt">${fixedDue.length} fixed ${fixedDue.length === 1 ? "item isn't" : "items aren't"} in ${mLabel(k)} yet: ${fixedDue.slice(0, 4).map(f => esc(f.note || f.category)).join(", ")}${fixedDue.length > 4 ? " and more" : ""} (${money(sumK(fixedDue.filter(f => f.kind !== "Income"), "amount"))} EGP out${sumK(fixedDue.filter(f => f.kind === "Income"), "amount") ? `, ${money(sumK(fixedDue.filter(f => f.kind === "Income"), "amount"))} in` : ""}).</span><span class="meta"><button class="btn small" data-fixadd="1">Log them all</button></span></div>` : ""}
    <section class="sec"><div class="sec-h"><h2>Balance sheet</h2><span class="hint">Month by month. Opening balance plus income minus expenses gives the closing balance.</span></div>
      <div class="scroll"><table><thead><tr><th>Month</th><th class="r">Opening</th><th class="r">Income</th><th class="r">Expenses</th><th class="r">Left over</th><th class="r">Saved %</th><th class="r">Closing</th><th class="r">Vs budget</th></tr></thead>
      <tbody>${sheet.length ? sheet.map(m => `<tr class="click ${m.k === k ? "c1" : ""}" data-mgo="${m.k}"><td class="strong">${mLabel(m.k)}</td><td class="r num">${money(balanceAt(mShift(m.k, -1)))}</td><td class="r num">${money(m.income)}</td><td class="r num">${money(m.spent)}</td>
        <td class="r num strong">${money(m.net)}</td><td class="r num">${m.rate == null ? "-" : pct(m.rate)}</td><td class="r num strong">${money(balanceAt(m.k))}</td><td class="r num">${totalBudget ? (m.spent > totalBudget ? `<span class="pill late">${money(m.spent - totalBudget)} over</span>` : `<span class="pill done">${money(totalBudget - m.spent)} under</span>`) : "-"}</td></tr>`).join("")
        : `<tr><td colspan="8" class="empty">${S.ready.has("money") ? "Nothing logged yet. Press <b>+ Expense</b> or <b>+ Income</b>, or set up fixed items under <b>Budgets & balance</b>." : "Loading..."}</td></tr>`}</tbody></table></div></section>
    <div class="two-col">
      <section class="sec"><div class="sec-h"><h2>Spending by category</h2><span class="hint">${mLabel(k)} against your budgets</span></div>
        <div class="scroll"><table><thead><tr><th>Category</th><th class="r">Budget</th><th class="r">Spent</th><th class="r">Left</th><th>Used</th><th class="r">Share</th><th class="r">Last month</th><th></th></tr></thead>
        <tbody>${catRows.length ? catRows.sort((a, b) => b.s - a.s).map(r => `<tr class="${entryCat === r.c ? "c1" : ""}"><td class="strong"><button class="linkbtn" data-mcatf="${esc(r.c)}" title="Show only ${esc(r.c)} entries">${esc(r.c)}</button></td>
          <td class="r">${S.readOnly ? `<span class="num">${money(r.b)}</span>` : `<input type="number" class="inline-num" min="0" step="50" inputmode="decimal" value="${r.b || ""}" placeholder="None" data-budget="${esc(r.c)}" aria-label="Budget for ${esc(r.c)}">`}</td><td class="r num">${money(r.s)}</td>
          <td class="r num">${r.b ? (r.b - r.s < 0 ? `<span class="pill late">${money(r.s - r.b)} over</span>` : money(r.b - r.s)) : "-"}</td><td>${pctBar(r.s, r.b)}${r.b ? ` <span class="num" style="font-size:12px">${pct(r.s / r.b)}</span>` : ""}</td>
          <td class="r num">${M.spent ? pct(r.s / M.spent) : "-"}</td><td class="r num">${money(r.p)}</td>
          <td class="r" style="white-space:nowrap">${S.readOnly ? "" : `<button class="btn small ghost" data-new="money" data-mkind="Expense" data-mcat="${esc(r.c)}" title="Log spending in ${esc(r.c)}">+ Spend</button>${r.b ? `<button class="ibtn" data-budrm="${esc(r.c)}" aria-label="Remove ${esc(r.c)} budget" title="Remove this budget">${icon.x}</button>` : ""}`}</td></tr>`).join("") + `<tr class="total"><td>Total</td><td class="r num">${money(totalBudget)}</td><td class="r num">${money(M.spent)}</td><td class="r num">${totalBudget ? money(totalBudget - M.spent) : "-"}</td><td></td><td></td><td class="r num">${money(P.spent)}</td><td></td></tr>`
          : `<tr><td colspan="8" class="empty">No budgets or spending in ${mLabel(k)} yet.</td></tr>`}</tbody></table></div>
        ${S.readOnly ? "" : (() => { const free = cats.filter(c => !num(B[c])); return free.length ? `<form class="dec-add" data-budadd="1"><select id="bud-cat" aria-label="Category" style="flex:1 1 200px">${free.map(c => `<option>${esc(c)}</option>`).join("")}</select>
          <input type="number" id="bud-amt" min="0" step="50" inputmode="decimal" placeholder="Monthly budget (EGP)" aria-label="Monthly budget" style="flex:1 1 180px"><button class="btn small" type="submit">+ Add budget</button></form>` : ""; })()}
        <p class="note" style="font-size:12px;color:var(--ink2);margin:0">Type in the Budget box to change it, × to remove a budget, + Spend to log money spent, or tap a category to see its entries.</p></section>
      <section class="sec"><div class="sec-h"><h2>Income by source</h2></div>
        <div class="scroll"><table style="min-width:0"><thead><tr><th>Source</th><th class="r">EGP</th><th class="r">Share</th></tr></thead>
        <tbody>${Object.keys(M.byInc).length ? Object.entries(M.byInc).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<tr><td class="strong">${esc(c)}</td><td class="r num">${money(v)}</td><td class="r num">${M.income ? pct(v / M.income) : "-"}</td></tr>`).join("")
          : `<tr><td colspan="3" class="empty">No income in ${mLabel(k)}.</td></tr>`}</tbody></table></div>
        <div class="sec-h" style="margin-top:6px"><h2>Fixed monthly items</h2>${S.readOnly ? "" : '<button class="btn ghost small" data-new="fixed">+ Fixed item</button>'}</div>
        <div class="scroll"><table style="min-width:0"><thead><tr><th>${esc(MON[+k.slice(5) - 1])}</th><th>Item</th><th>Category</th><th class="r">Day</th><th class="r">EGP</th></tr></thead>
        <tbody>${S.fixed.length ? S.fixed.slice().sort((a, b) => num(a.day) - num(b.day)).map(f => { const on = S.money.some(x => x.fixedId === f.id && x.date && x.date.slice(0, 7) === k);
          return `<tr class="click ${f.kind === "Income" ? "c5" : ""}" data-edit="fixed" data-id="${esc(f.id)}"><td style="width:44px"><button class="tick sm ${on ? "on" : ""}" data-fixtoggle="${esc(f.id)}" aria-label="${on ? "Take out of" : "Log in"} ${esc(mLabel(k))}: ${esc(f.note || f.category)}" title="${on ? "Logged for " + esc(mLabel(k)) + ". Tap to take it back out." : "Not logged for " + esc(mLabel(k)) + ". Tap to log it."}" ${S.readOnly ? "disabled" : ""}>${on ? check : ""}</button></td><td class="strong">${esc(f.note || f.category)}</td><td>${esc(f.category || "-")}${f.kind === "Income" ? ' <span class="muted">(in)</span>' : ""}</td><td class="r num">${num(f.day) || "-"}</td><td class="r num">${money(num(f.amount))}</td></tr>`; }).join("")
          : `<tr><td colspan="5" class="empty">Add rent, bills, subscriptions or salary once. Then tick them off each month.</td></tr>`}</tbody></table></div>
        ${S.fixed.length ? `<p class="note" style="font-size:12px;color:var(--ink2);margin:0">Tick an item to log it for ${esc(mLabel(k))}. Untick it to take it back out.</p>` : ""}</section>
    </div>
    <section class="sec"><div class="sec-h"><h2>Entries</h2><span class="hint">${entryCat ? `Only <b>${esc(entryCat)}</b> in ${mLabel(k)}.` : `Everything logged in ${mLabel(k)}.`} Tap one to edit, or × to remove it.</span>${entryCat ? '<button class="btn small ghost" data-mcatf="">Show all</button>' : ""}</div>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Note</th><th class="r">EGP</th><th style="width:44px"></th></tr></thead>
      <tbody>${entries.length ? entries.map(x => `<tr class="click ${x.kind === "Income" ? "c5" : ""}" data-edit="money" data-id="${esc(x.id)}"><td class="num">${fdate(x.date)}</td><td>${esc(x.kind || "Expense")}</td><td class="strong">${esc(x.category || "-")}</td><td class="muted">${esc(x.note || "")}</td><td class="r num strong">${x.kind === "Income" ? "+" : "−"}${money(num(x.amount))}</td>
        <td>${S.readOnly ? "" : `<button class="ibtn" data-mdel="${esc(x.id)}" aria-label="Remove this entry" title="Remove this entry">${icon.x}</button>`}</td></tr>`).join("")
        : `<tr><td colspan="6" class="empty">${entryCat ? `No ${esc(entryCat)} entries in ${mLabel(k)}.` : `Nothing logged in ${mLabel(k)} yet.`}</td></tr>`}</tbody></table></div></section>`;
}

// ---------------- assistant ----------------
// A chat drawer that runs on the viewer's own Claude account (the `sample` capability).
// It reads a live snapshot of the app, and changes data through page tools that write
// via the same undo-aware wrapper as the rest of the app.
const AI = { sample: null, tools: false, off: false, open: false, busy: false, ctl: null, msgs: [], notes: "", loaded: false, showSet: false };
function mdLite(src) {
  const inline = s => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = esc(noDash(src)).split("\n"); let html = "", list = null, table = [];
  const flushTable = () => { if (!table.length) return; const rows = table.filter(r => !/^\|?\s*:?-{2,}/.test(r.replace(/\|/g, "|").trim()) || /[a-z0-9]/i.test(r.replace(/[-:|\s]/g, "")));
    const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim()));
    html += `<div class="ai-tbl"><table>${rows.map((r, i) => `<tr>${cells(r).map(c => i ? `<td>${c}</td>` : `<th>${c}</th>`).join("")}</tr>`).join("")}</table></div>`; table = []; };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const l of lines) {
    if (/^\s*\|.*\|\s*$/.test(l)) { closeList(); table.push(l); continue; } else flushTable();
    let m;
    if ((m = /^\s*[-*•]\s+(.*)/.exec(l))) { if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) { if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; continue; }
    closeList();
    if ((m = /^#{1,6}\s+(.*)/.exec(l))) { html += `<h4>${inline(m[1])}</h4>`; continue; }
    if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  closeList(); flushTable(); return html;
}

// ----- voice (device features, free) -----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function plainSpeech(md) { return noDash(md).replace(/\*\*|__|`|#+\s/g, "").replace(/^\s*[-*]\s+/gm, "").replace(/\|/g, " ").replace(/\n{2,}/g, ". ").replace(/\n/g, ". ").slice(0, 900); }
function aiSpeak(md) {
  if (!AI.speak || !window.speechSynthesis) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(plainSpeech(md)); u.rate = 1.05; u.lang = /[؀-ۿ]/.test(md) ? "ar-EG" : "en-US"; speechSynthesis.speak(u); } catch (e) {}
}
function aiListen() {
  if (!SR) return toast("Voice typing isn't supported here. Use your keyboard's microphone button.");
  if (rec) { try { rec.stop(); } catch (e) {} return; }
  try {
    rec = new SR(); rec.lang = AI.lang || "en-US"; rec.interimResults = true; rec.maxAlternatives = 1;
    const q = $("#ai-q"), mic = $("#ai-mic"); let finalText = "";
    mic.classList.add("on"); mic.setAttribute("aria-pressed", "true");
    rec.onresult = e => { let txt = ""; for (let i = 0; i < e.results.length; i++) { txt += e.results[i][0].transcript; if (e.results[i].isFinal) finalText = txt; } q.value = txt; };
    rec.onerror = e => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { AI.micBlocked = true; toast("The microphone isn't allowed here. Use your keyboard's microphone button instead."); const b = $("#ai-mic"); if (b) b.hidden = true; } else if (e.error !== "aborted" && e.error !== "no-speech") toast("Didn't catch that. Try again."); };
    rec.onend = () => { rec = null; mic.classList.remove("on"); mic.setAttribute("aria-pressed", "false"); const v = (finalText || q.value).trim(); if (v && !AI.busy) { q.value = ""; aiSend(v); } };
    rec.start();
  } catch (e) { rec = null; toast("Voice typing isn't available here. Use your keyboard's microphone button."); }
}

// ----- drawer -----
const AI_CHIPS = ["What's for today?", "What's overdue?", "How much did I spend?", "Weekly report", "Move unfinished to today", "Help"];
const MODES = [["free-first", "Free first", "Built-in brain handles everyday things instantly and free. Only what it can't understand goes to Haiku."],
  ["free", "Free only", "Never uses Claude. Instant and free, but only understands the everyday commands."],
  ["haiku", "Haiku always", "Every message goes to Haiku. Smartest here, uses a little Claude usage each time."]];
try { AI.speak = localStorage.getItem("lb-ai-speak") === "1"; AI.lang = localStorage.getItem("lb-ai-lang") || "en-US"; } catch (e) { AI.lang = "en-US"; }
AI.mode = "free-first"; AI.unread = 0; AI.lastBrief = "";
function aiErrText(msg) { return msg || "Something went wrong reaching Haiku. Try again, or use a built-in command."; }
function aiBuild() {
  if (document.getElementById("ai")) return;
  const el = document.createElement("aside"); el.id = "ai"; el.className = "ai"; el.hidden = true; el.setAttribute("aria-label", "Assistant");
  el.innerHTML = `<div class="ai-h"><b>Assistant</b><span class="ai-sub" id="ai-sub"></span><span class="spacer"></span>
      <button type="button" class="ai-hb" id="ai-spk" data-ai="speak" aria-pressed="false" title="Read replies out loud">Voice off</button>
      <button type="button" class="ai-hb" data-ai="set">Settings</button><button type="button" class="ai-hb" data-ai="clear">Clear</button>
      <button type="button" class="ibtn" data-ai="close" aria-label="Close assistant">${icon.x}</button></div>
    <div class="ai-set" id="ai-set" hidden>
      <fieldset class="ai-modes"><legend>How it thinks</legend>${MODES.map(([v, l, d]) => `<label><input type="radio" name="ai-mode" value="${v}"><span><b>${l}</b><br><span class="muted">${d}</span></span></label>`).join("")}</fieldset>
      <label class="f" for="ai-lang">Voice language<select id="ai-lang"><option value="en-US">English</option><option value="ar-EG">Arabic (Egypt)</option><option value="en-GB">English (UK)</option></select></label>
      <label class="f" for="ai-notes">Standing instructions (used by Haiku)
      <textarea id="ai-notes" rows="3" placeholder="e.g. Keep my daily list under 6 tasks. Plan Sulta work in the mornings."></textarea></label>
      <div style="display:flex;gap:6px;justify-content:flex-end"><button type="button" class="btn small ghost" data-ai="setclose">Cancel</button><button type="button" class="btn small" data-ai="setsave">Save</button></div>
      <section class="tg-card" id="tg-card" aria-label="Telegram"></section></div>
    <div class="ai-log" id="ai-log" aria-live="polite"></div>
    <div class="ai-chips" id="ai-chips">${AI_CHIPS.map(c => `<button type="button" class="ai-chip" data-aiq="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <form class="ai-in" id="ai-form">
      <button type="button" class="ai-mic" id="ai-mic" data-ai="mic" aria-pressed="false" aria-label="Talk to the assistant" title="Talk" ${SR ? "" : "hidden"}><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><rect x="6" y="1.5" width="6" height="10" rx="3" fill="currentColor"/><path d="M3.5 8.5a5.5 5.5 0 0 0 11 0M9 14v2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      <textarea id="ai-q" rows="2" placeholder="Ask, or tell me what to add, log or tick off" aria-label="Message the assistant"></textarea>
      <button type="submit" class="btn" id="ai-send">Send</button></form>`;
  document.body.appendChild(el);
  const fab = document.createElement("button"); fab.type = "button"; fab.className = "ai-fab"; fab.dataset.ai = "open"; fab.innerHTML = '<span aria-hidden="true">✦</span> Assistant<span class="ai-badge" id="ai-badge" hidden></span>'; fab.hidden = true;
  document.body.appendChild(fab);
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-ai],[data-aiq],[data-aiundo],[data-aisave],[data-aiok],[data-aino],[data-tg]"); if (!b) return;
    if (b.dataset.tg) return tgAction(b.dataset.tg, b.dataset.chat);
    if (b.dataset.aiok != null) return aiDecide(+b.dataset.aiok, true);
    if (b.dataset.aino != null) return aiDecide(+b.dataset.aino, false);
    if (b.dataset.aiq) { if (!AI.busy) aiSend(b.dataset.aiq); return; }
    if (b.dataset.aiundo != null) return aiUndo(+b.dataset.aiundo);
    if (b.dataset.aisave != null) return aiSaveReply(+b.dataset.aisave);
    const a = b.dataset.ai;
    if (a === "open") aiOpen(true); else if (a === "close") aiOpen(false);
    else if (a === "stop") { if (AI.ctl) AI.ctl.abort(); }
    else if (a === "mic") aiListen();
    else if (a === "speak") { AI.speak = !AI.speak; try { localStorage.setItem("lb-ai-speak", AI.speak ? "1" : "0"); } catch (er) {} if (!AI.speak && window.speechSynthesis) speechSynthesis.cancel(); aiSyncHead(); if (AI.speak) aiSpeak("Voice on."); }
    else if (a === "clear") { if (AI.busy) return; AI.msgs = []; aiPersist(); aiRender(); }
    else if (a === "set") { AI.showSet = !AI.showSet; const s = $("#ai-set"); s.hidden = !AI.showSet;
      if (AI.showSet) { tgRender(); $("#ai-notes").value = AI.notes || ""; $("#ai-lang").value = AI.lang || "en-US"; document.querySelectorAll('input[name="ai-mode"]').forEach(r => { r.checked = r.value === AI.mode; }); } }
    else if (a === "setclose") { AI.showSet = false; $("#ai-set").hidden = true; }
    else if (a === "setsave") { AI.notes = $("#ai-notes").value.trim(); const r = document.querySelector('input[name="ai-mode"]:checked'); if (r) AI.mode = r.value;
      AI.lang = $("#ai-lang").value; try { localStorage.setItem("lb-ai-lang", AI.lang); } catch (er) {}
      BRAIN.notes = AI.notes; AI.showSet = false; $("#ai-set").hidden = true; aiPersist(); aiSyncHead(); toast("Settings saved"); }
  });
  $("#ai-form").addEventListener("submit", e => { e.preventDefault(); const q = $("#ai-q").value.trim(); if (!q || AI.busy) return; $("#ai-q").value = ""; aiSend(q); });
  $("#ai-q").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#ai-form").requestSubmit(); } });
  aiSyncHead();
}
function aiSyncHead() {
  const sub = $("#ai-sub"); if (sub) sub.textContent = AI.mode === "free" ? "free mode" : AI.mode === "haiku" ? "Haiku" : "free first, Haiku backup";
  const sp = $("#ai-spk"); if (sp) { sp.textContent = AI.speak ? "Voice on" : "Voice off"; sp.setAttribute("aria-pressed", String(AI.speak)); sp.hidden = !window.speechSynthesis; }
  const bd = $("#ai-badge"); if (bd) { bd.hidden = !AI.unread; bd.textContent = AI.unread; }
  const tb = $("#ai-top"); if (tb) tb.classList.toggle("has-new", !!AI.unread);
}
function aiOpen(v) { AI.open = v; $("#ai").hidden = !v; document.body.classList.toggle("ai-on", v); const f = document.querySelector(".ai-fab"); if (f) f.hidden = v || !S.db;
  if (v) { AI.unread = 0; aiSyncHead(); aiRender(); setTimeout(() => { const q = $("#ai-q"); if (q) q.focus(); }, 50); } }
function aiBubble(m, i) {
  if (m.role === "user") return `<div class="ai-msg me"><div class="ai-b">${esc(m.content).replace(/\n/g, "<br>")}</div></div>`;
  const acts = (m.actions || []).length ? `<div class="ai-acts"><b>${m.actions.length} ${m.actions.length === 1 ? "change" : "changes"}</b><ul>${m.actions.map(a => `<li>${esc(noDash(a))}</li>`).join("")}</ul>
    ${m.group && !m.undone ? `<button type="button" class="btn small ghost" data-aiundo="${i}">Undo</button>` : m.undone ? '<span class="muted">Undone</span>' : ""}</div>` : "";
  const prop = m.proposal && !m.decided ? `<div class="ai-acts"><b>Confirm?</b><ul>${m.proposal.map(o => `<li>${esc(noDash(o.label))}</li>`).join("")}</ul>
    <div style="display:flex;gap:6px"><button type="button" class="btn small" data-aiok="${i}">\u2713 Confirm</button><button type="button" class="btn small ghost" data-aino="${i}">\u2715 Cancel</button></div></div>` : m.decided === "no" ? '<p class="muted" style="font-size:12px">Cancelled. Nothing was changed.</p>' : "";
  const body = m.content ? mdLite(m.content) : m.pending ? `<p class="ai-think">Thinking<span>.</span><span>.</span><span>.</span></p>` : "";
  const tag = m.via === "free" ? '<span class="ai-via">free</span>' : m.via === "haiku" ? '<span class="ai-via">Haiku</span>' : m.via === "brief" ? '<span class="ai-via">daily message</span>' : "";
  return `<div class="ai-msg bot"><div class="ai-b">${body}${m.error ? `<p class="ai-err">${esc(m.error)}</p>` : ""}${prop}${acts}
    ${!m.pending && m.content ? `<div class="ai-tools">${tag}${DL ? `<button type="button" class="linkbtn" data-aisave="${i}">Save as file</button>` : ""}</div>` : ""}</div></div>`;
}
function aiRender() {
  const log = $("#ai-log"); if (!log) return;
  log.innerHTML = AI.msgs.length ? AI.msgs.map(aiBubble).join("") :
    `<div class="ai-hello"><p><b>Hi Omar.</b> I can see everything in your OS and do things for you. You can also text me on Telegram: Settings, Connect Telegram.</p>
      <p>Everyday things are instant and free: "what's for today?", "add call Cafe X tomorrow high", "spent 450 on lunch", "done gym", "move unfinished to today", "how is Sulta doing?". Press the microphone to talk, and Voice on to hear me.</p>
      <p class="muted">${AI.mode === "free" ? "Free only: I won't use Claude." : "Anything else goes to Claude Haiku, which costs a fraction of a cent per message. Changes it suggests wait for your OK. Change this in Settings."}</p></div>`;
  $("#ai-chips").hidden = AI.msgs.length > 2;
  const send = $("#ai-send"); send.textContent = AI.busy ? "Stop" : "Send"; send.type = AI.busy ? "button" : "submit"; if (AI.busy) send.dataset.ai = "stop"; else delete send.dataset.ai;
  log.scrollTop = log.scrollHeight;
}
function aiUpdateLast() {
  const log = $("#ai-log"); if (!log) return; const i = AI.msgs.length - 1, last = log.lastElementChild;
  if (last && last.classList.contains("bot")) { last.outerHTML = aiBubble(AI.msgs[i], i); log.scrollTop = log.scrollHeight; } else aiRender();
}
function aiPersist() {
  if (!S.rawDb || S.readOnly) return;
  const history = AI.msgs.filter(m => !m.pending && (m.content || (m.actions || []).length)).slice(-40).map(m => ({ role: m.role, content: String(m.content || "").slice(0, 8000), actions: m.actions || [], via: m.via || "" }));
  S.rawDb.doc("app/assistant").set({ notes: AI.notes || "", mode: AI.mode, lastBrief: AI.lastBrief || "", history }).catch(() => {});
}
async function aiUndo(i) {
  const m = AI.msgs[i]; if (!m || !m.group || m.undone) return;
  try { await applyGroup({ label: "Assistant changes", ops: m.group }); const k = undoStack.findIndex(g => g.ops === m.group); if (k >= 0) undoStack.splice(k, 1); syncUndoBtn(); m.undone = true; toast("Undone"); aiRender(); }
  catch (e) { toast("Couldn't undo that. Try the Undo button."); }
}
async function aiSaveReply(i) {
  const m = AI.msgs[i]; if (!m) return; const q = (AI.msgs[i - 1] || {}).role === "user" ? AI.msgs[i - 1].content : "Assistant";
  const name = q.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40).toLowerCase() || "assistant";
  if (await saveFile(`${name}_${iso(today())}.md`, `# ${q}\n\n_${iso(today())}_\n\n${noDash(m.content)}\n`)) toast("Saved");
}
function aiFinish(bot) {
  bot.pending = false; AI.busy = false; AI.ctl = null;
  aiPersist(); aiRender(); if (bot.content) aiSpeak(bot.content);
}
// Runs ops (from either brain) as one undoable group.
const appStore = {
  add: (c, d) => S.db.collection(c).add(d).then(r => r.id),
  update: (c, id, p) => S.db.collection(c).doc(id).update(p),
  set: (c, id, d) => S.db.doc(c + "/" + id).set(d),
  del: (c, id) => S.db.collection(c).doc(id).delete(),
};
async function runGrouped(ops) {
  const group = []; undoGroup = group; let done = [];
  try { done = await runOps(appStore, ops); } finally { if (undoGroup === group) undoGroup = null; }
  if (group.length) { undoStack.push({ label: "Assistant changes", ops: group }); if (undoStack.length > 30) undoStack.shift(); redoStack.length = 0; syncUndoBtn(); }
  return { done, group };
}
const askServer = (text, convo, signal) => api("/api/assistant", { text, convo }, { signal });
async function aiSend(q) {
  if (AI.busy) return;
  AI.msgs.forEach(m => { if (m.proposal && !m.decided) m.decided = "no"; });
  AI.msgs.push({ role: "user", content: q });
  const bot = { role: "assistant", content: "", actions: [], pending: true }; AI.msgs.push(bot);
  AI.busy = true; aiRender();
  // 1. the free built-in brain: instant, no AI; its changes apply at once and can be undone
  if (AI.mode !== "haiku") {
    let r = null; try { r = await freeBrain(q); } catch (e) { r = { text: "That didn't work: " + (e && e.message ? e.message : "try again."), ops: [] }; }
    if (r) {
      bot.via = "free"; bot.content = r.text;
      if (r.ops.length) {
        if (S.readOnly || !S.db) bot.content = "I can't change things in this view.";
        else { try { const res = await runGrouped(r.ops); bot.actions = res.done; bot.group = res.group; } catch (e) { bot.content = ""; bot.error = "Couldn't save that: " + e.message; } }
      }
      return aiFinish(bot);
    }
    if (AI.mode === "free") { bot.content = `I didn't understand that in free mode.\n\n${HELP}`; bot.via = "free"; return aiFinish(bot); }
  }
  // 2. Claude Haiku on the server (same brain as Telegram); changes come back as a proposal to confirm
  const ctl = new AbortController(); AI.ctl = ctl; bot.via = "haiku"; aiRender();
  const hist = AI.msgs.slice(0, -2).filter(m => m.content || (m.actions || []).length).slice(-12)
    .map(m => ({ role: m.role, content: m.role === "assistant" ? (String(m.content || "").slice(0, 3000) + ((m.actions || []).length ? `\n[Changes made: ${m.actions.join("; ")}]` : "")) || "(done)" : m.content }));
  try {
    const j = await askServer(q, hist, ctl.signal);
    bot.content = noDash(j.reply || ""); if (Array.isArray(j.ops) && j.ops.length) bot.proposal = j.ops;
  } catch (e) {
    if (e && e.name === "AbortError") bot.content = bot.content || "Stopped."; else bot.error = aiErrText(e && e.message);
  }
  aiFinish(bot);
}
async function aiDecide(i, yes) {
  const m = AI.msgs[i]; if (!m || !m.proposal || m.decided) return;
  if (!yes) { m.decided = "no"; aiPersist(); return aiRender(); }
  m.decided = "yes";
  try { const res = await runGrouped(m.proposal); m.actions = res.done; m.group = res.group; toast("Saved", true); }
  catch (e) { m.error = "Couldn't save that: " + e.message; m.decided = null; }
  aiPersist(); aiRender();
}
function aiMaybeBrief() {
  const tI = iso(today()); if (!AI.loaded || AI.lastBrief === tI || !S.ready.has("todos") || !S.ready.has("opts")) return;
  if (!(S.todos.length + S.goals.length + S.biz.length + S.money.length)) return;
  AI.lastBrief = tI; AI.msgs.push({ role: "assistant", content: briefText(true), actions: [], via: "brief" });
  if (!AI.open) AI.unread += 1; aiPersist(); aiSyncHead(); if (AI.open) aiRender();
}
async function aiInit() {
  aiBuild();
  const fab = document.querySelector(".ai-fab"); if (fab) fab.hidden = AI.open || !S.db;
  const hb = $("#ai-top"); if (hb) hb.hidden = !S.db;
  setTimeout(aiMaybeBrief, 1500); setTimeout(aiMaybeBrief, 5000);
  if (AI.open) aiRender();
}

// ---------------- Connect Telegram ----------------
const TG = { links: [], code: null, bot: null, until: 0, spend: null, timer: null };
async function tgRender(reload = true) {
  const box = $("#tg-card"); if (!box) return;
  if (reload) {
    try { const j = await api("/api/telegram"); TG.links = j.links || []; TG.spend = Number(j.spendMonth || 0); TG.bot = j.bot || TG.bot; }
    catch (e) { toast("Couldn't load Telegram: " + e.message); }
  }
  const left = Math.max(0, Math.round((TG.until - Date.now()) / 1000));
  const link = TG.code && TG.bot ? `https://t.me/${TG.bot}?start=${TG.code}` : "";
  box.innerHTML = `<h3>Telegram</h3>
    <p class="muted">Text or send voice notes to your assistant from Telegram. Only chats you link here can use it.</p>
    ${TG.links.length ? `<ul class="tg-links">${TG.links.map(c => `<li><span><b>${esc(c.first_name || "Telegram chat")}</b>${c.username ? ` @${esc(c.username)}` : ""}<br><span class="muted">linked ${fdate(iso(new Date(Number(c.linked_at))))}</span></span>
      <button type="button" class="btn small ghost" data-tg="unlink" data-chat="${esc(c.chat_id)}">Disconnect</button></li>`).join("")}</ul>` : '<p class="muted">No chats linked yet.</p>'}
    ${TG.code && left > 0 ? `<div class="tg-code"><span class="num">${esc(TG.code)}</span><span class="muted">valid ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}</span>
      ${link ? `<a class="btn small" href="${esc(link)}" target="_blank" rel="noopener">Open in Telegram</a>` : '<span class="ai-err">The bot isn\'t set up yet. Finish the setup steps first.</span>'}</div>
      <p class="muted">Press Open in Telegram, then Start. The code works once and expires in 15 minutes.</p>` : ""}
    <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn small" data-tg="connect">Connect Telegram</button><button type="button" class="btn small ghost" data-tg="refresh">Refresh</button></div>
    <p class="muted" style="margin-top:6px">Claude spend this month: <b>$${(TG.spend || 0).toFixed(3)}</b></p>
    <p class="muted"><button type="button" class="linkbtn" data-tg="signout">Sign out of this device</button></p>`;
  clearTimeout(TG.timer); if (TG.code && left > 0) TG.timer = setTimeout(() => tgRender(false), 1000);
}
async function tgAction(what, chat) {
  if (what === "connect") {
    let data; try { data = await api("/api/telegram/pair", {}); } catch (e) { return toast("Couldn't make a code: " + e.message); }
    TG.code = data.code; TG.bot = data.bot; TG.until = Number(data.expires_at) || Date.now() + 15 * 60000; await tgRender(false);
    if (TG.bot) window.open(`https://t.me/${TG.bot}?start=${TG.code}`, "_blank", "noopener");
  } else if (what === "unlink") {
    try { await api("/api/telegram/unlink", { chat_id: Number(chat) }); } catch (e) { return toast("Couldn't disconnect: " + e.message); }
    toast("Disconnected"); tgRender();
  } else if (what === "refresh") tgRender();
  else if (what === "signout") { try { await api("/api/logout", {}); } catch (e) { } location.reload(); }
}

// ---------------- render ----------------
function render() {
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false"));
  let html = tab === "today" ? viewToday() : tab === "insights" ? viewInsights() : tab === "money" ? viewMoney() : tab === "plans" ? viewPlans() : tab === "business" ? viewBusiness() : tab === "options" ? viewOptions() : viewGoals();
  if (S.noDb) html = `<div class="confirm" role="status">Your saved data isn't available in this view. Open the tracker from Claude while signed in to load and save it.</div>` + html;
  else if (S.readOnly) html = `<div class="status-line">View only. Ask the owner for edit access to make changes.</div>` + html;
  $("#view").innerHTML = html;
  applySorts();
}

// ---------------- table sorting ----------------
const sortState = {};
try { Object.assign(sortState, JSON.parse(localStorage.getItem("lb-sort") || "{}")); } catch (e) {}
const tableKey = t => { const sec = t.closest(".sec"); const h = sec && sec.querySelector("h2");
  const all = [...document.querySelectorAll("#view table")].filter(x => (x.closest(".sec") || {}).querySelector && x.closest(".sec").querySelector("h2") === h);
  return tab + "|" + (tab === "business" ? bizTab + "|" : "") + (h ? h.textContent.trim() : "t") + "|" + all.indexOf(t); };
const MONI = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function cellValue(td) {
  if (!td) return null;
  const t = td.textContent.replace(/\s+/g, " ").trim();
  if (!t || t === "-" || t === "Choose…") return null;
  let m = /^(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2})\b/.exec(t); if (m) return 2000 + +m[3] + (MONI[m[2]] * 31 + +m[1]) / 1000;
  m = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/.exec(t); if (m) return +m[2] + MONI[m[1]] / 12;
  m = /^(\d+) yr (\d+) mo$/.exec(t); if (m) return +m[1] * 12 + +m[2];
  m = /^\(([\d,.]+)\)$/.exec(t); if (m) return -parseFloat(m[1].replace(/,/g, ""));
  m = /^([+-]?[\d,]*\.?\d+)\s*(%|d\b.*|\/.*|EGP.*)?$/.exec(t); if (m) return parseFloat(m[1].replace(/,/g, ""));
  m = /^(\d+)d (late|left|quiet|ago)/.exec(t); if (m) return m[2] === "late" ? -m[1] : +m[1];
  return t.toLowerCase();
}
function applySorts() {
  document.querySelectorAll("#view table").forEach(tbl => {
    const key = tableKey(tbl), st = sortState[key], ths = [...tbl.querySelectorAll("thead th")];
    ths.forEach((th, i) => { if (th.textContent.trim()) { th.classList.add("sortable"); th.tabIndex = 0; th.dataset.sortcol = i; th.setAttribute("aria-sort", st && st.col === i ? (st.dir > 0 ? "ascending" : "descending") : "none"); } });
    if (!st || !ths[st.col]) return;
    const body = tbl.tBodies[0]; if (!body) return;
    const rows = [...body.rows], fixed = rows.filter(r => r.classList.contains("total") || r.querySelector(".empty")), movable = rows.filter(r => !fixed.includes(r));
    const cols = c => { let n = 0; for (const td of c.cells) { if (n === st.col) return td; n += td.colSpan || 1; } return null; };
    movable.map((r, i) => ({ r, i, v: cellValue(cols(r)) })).sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i; if (a.v === null) return 1; if (b.v === null) return -1;
      const c = (typeof a.v === "number" && typeof b.v === "number") ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true });
      return c * st.dir || a.i - b.i;
    }).forEach(x => body.appendChild(x.r));
    fixed.forEach(r => body.appendChild(r));
  });
}
function toggleSort(th) {
  const tbl = th.closest("table"), key = tableKey(tbl), col = +th.dataset.sortcol, st = sortState[key];
  if (!st || st.col !== col) sortState[key] = { col, dir: 1 }; else if (st.dir === 1) sortState[key] = { col, dir: -1 }; else delete sortState[key];
  try { localStorage.setItem("lb-sort", JSON.stringify(sortState)); } catch (e) {}
  render();
}
function go(t) { tab = t; try { history.replaceState(null, "", "#" + t); } catch (e) {} try { localStorage.setItem("lb-tab", t); } catch (e) {} render(); window.scrollTo(0, 0); }

// ---------------- panel (forms) ----------------
function selectField(id, label, list, value, required) {
  const items = opt(list);
  const has = value && !items.includes(value);
  return `<label class="f" for="${id}">${esc(label)}
    <select id="${id}" data-list="${list}" ${required ? "required" : ""}><option value="">Choose…</option>
      ${items.map(v => `<option ${v === value ? "selected" : ""}>${esc(v)}</option>`).join("")}${has ? `<option selected>${esc(value)}</option>` : ""}
      ${S.readOnly ? "" : '<option value="__new">+ Add new…</option>'}</select></label>
    <div class="inline-add" data-for="${id}" hidden><input type="text" id="${id}-new" placeholder="New ${esc(label.toLowerCase())}" aria-label="New ${esc(label)}"><button class="btn small" type="button" data-addfor="${id}">Add</button></div>`;
}
const input = (id, label, type, value, extra = "") => `<label class="f" for="${id}">${esc(label)}<input type="${type}" id="${id}" value="${esc(value ?? "")}" ${extra}></label>`;
const bizSelect = (value) => `<label class="f" for="f-biz">Business<select id="f-biz" required><option value="">Choose…</option>${S.biz.map(b => `<option value="${esc(b.id)}" ${b.id === value ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>`;
const plainSelect = (id, label, items, value) => `<label class="f" for="${id}">${esc(label)}<select id="${id}">${items.map(v => `<option ${v === value ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
const srcOptions = (bizId, value) => `<option value="">Not linked</option>${S.accts.filter(a => a.businessId === bizId).sort((a, b) => String(a.name).localeCompare(b.name)).map(a => `<option value="${esc(a.id)}" ${a.id === value ? "selected" : ""}>${esc(a.name)} (${esc(a.kind || "Client")})</option>`).join("")}${S.readOnly || !bizId ? "" : '<option value="__new">+ Add new…</option>'}`;
const textArea = (id, label, value, ph) => `<label class="f" for="${id}">${esc(label)}<textarea id="${id}" rows="3" placeholder="${esc(ph || "")}">${esc(value ?? "")}</textarea></label>`;
const srcFor = (bizId, value) => `<option value="">Whole business</option>${S.accts.filter(a => a.businessId === bizId).sort((a, b) => String(a.name).localeCompare(b.name)).map(a => `<option value="${esc(a.id)}" ${a.id === value ? "selected" : ""}>${esc(a.name)} (${esc(a.kind || "Client")})</option>`).join("")}`;
let panel = null;
function openPanel(kind, id, ctx = {}) {
  const rec = id ? ({ goal: S.goals, plan: S.plans, ms: S.ms, biz: S.biz, pay: S.pays, acct: S.accts, bms: S.bms, maint: S.maint, todo: S.todos, money: S.money, fixed: S.fixed }[kind] || []).find(x => x.id === id) : null;
  if (id && !rec) return;
  panel = { kind, id, ctx };
  const r = rec || {};
  let title = "", body = "", note = "";
  if (kind === "goal") {
    title = id ? "Edit goal" : "New goal";
    body = input("f-item", "Item or trait", "text", r.item, 'required placeholder="e.g. Driving licence"')
      + `<div class="two">${selectField("f-value", "Value", "values", r.value)}${selectField("f-priority", "Priority", "priorities", r.priority)}</div>`
      + `<div class="two">${input("f-price", "Price (EGP)", "number", r.price, 'min="0" step="1" inputmode="decimal"')}${selectField("f-have", "Have it?", "have", r.have || opt("have")[1] || "")}</div>`
      + input("f-target", "Target date", "date", r.target);
    if (id && S.plans.some(p => p.goalId === id)) note = "This goal has a plan. Deleting the goal also deletes its plan and milestones.";
  } else if (kind === "plan") {
    title = id ? "Edit plan" : "New plan";
    const free = S.goals.filter(g => !S.plans.some(p => p.goalId === g.id && p.id !== id));
    body = `<label class="f" for="f-goal">Goal<select id="f-goal" required><option value="">Choose a goal…</option>${free.map(g => `<option value="${esc(g.id)}" ${g.id === r.goalId ? "selected" : ""}>${esc(g.item)}</option>`).join("")}</select></label>`
      + input("f-start", "Start date", "date", r.start || iso(today()))
      + `<p class="panel-note">The target date comes from the goal on the Goals tab, so you only set it in one place.</p>`;
    if (id) note = "Deleting the plan also deletes its milestones. The goal stays.";
  } else if (kind === "ms") {
    title = id ? "Edit milestone" : "New milestone";
    const planId = r.planId || ctx.plan;
    const used = S.ms.filter(m => m.planId === planId && m.id !== id).reduce((s, m) => s + num(m.worth), 0);
    body = input("f-name", "Milestone", "text", r.name, 'required placeholder="e.g. Pass the theory test"')
      + `<div class="two">${input("f-worth", "Worth (% of goal)", "number", r.worth ?? Math.max(0, 100 - used), 'min="0" max="100" step="1" inputmode="numeric"')}${input("f-due", "Due date", "date", r.due)}</div>`
      + selectField("f-status", "Status", "msStatus", r.status || opt("msStatus")[opt("msStatus").length - 1] || "")
      + `<p class="panel-note">Other milestones in this plan already add up to ${Math.round(used)}%.</p>`;
    panel.ctx.plan = planId;
  } else if (kind === "biz") {
    title = id ? "Edit business" : "New business";
    body = input("f-bname", "Business name", "text", r.name, 'required')
      + `<div class="two">${selectField("f-btype", "Type", "bizTypes", r.type)}${selectField("f-bstatus", "Status", "bizStatus", r.status || opt("bizStatus")[0] || "")}</div>`
      + input("f-bstart", "Start date (optional)", "date", r.start)
      + `<p class="panel-note">Leave the start date empty to count from its first payout.</p>`;
    if (id && S.pays.some(p => p.businessId === id)) note = "This business has payouts, so it can't be deleted. Set its status to Closed instead.";
  } else if (kind === "pay") {
    title = id ? "Edit payout" : "Log payout";
    body = `<div class="two">${input("f-date", "Date", "date", r.date || iso(today()), "required")}
        ${bizSelect(r.businessId || ctx.biz)}</div>
      <label class="f" for="f-src">Client or product<select id="f-src">${srcOptions(r.businessId || ctx.biz, r.accountId)}</select></label>
      <div class="inline-add" data-for="f-src" hidden><input type="text" id="f-src-new" placeholder="New client or product name" aria-label="New client or product"><select id="f-src-kind" aria-label="Kind" style="width:auto">${KINDS.map(k => `<option>${k}</option>`).join("")}</select><button class="btn small" type="button" data-addsrc="1">Add</button></div>
      <div class="two">${input("f-rev", "Revenue (EGP)", "number", r.revenue, 'min="0" step="1" inputmode="decimal" required')}${input("f-exp", "Expenses (EGP)", "number", r.expenses, 'min="0" step="1" inputmode="decimal"')}</div>
      ${selectField("f-via", "Paid via", "paidVia", r.paidVia)}${input("f-note", "Note", "text", r.note, 'placeholder="Optional"')}
      <p class="panel-note" id="f-profit"></p>`;
  } else if (kind === "money" || kind === "fixed") {
    const isFixed = kind === "fixed", mk = r.kind || ctx.kind || "Expense";
    title = isFixed ? (id ? "Edit fixed item" : "New fixed monthly item") : (id ? "Edit entry" : mk === "Income" ? "Add income" : "Add expense");
    const defDate = moneyMonth === iso(today()).slice(0, 7) ? iso(today()) : moneyMonth + "-01";
    body = `<div class="two">${plainSelect("f-mkind", "Type", MKINDS, mk)}${isFixed ? input("f-mday", "Day of month", "number", r.day || 1, 'min="1" max="31" step="1" inputmode="numeric"') : input("f-mdate", "Date", "date", r.date || defDate, "required")}</div>`
      + `<div data-catfor="Expense" ${mk === "Income" ? "hidden" : ""}>${selectField("f-mcat-e", "Category", "expenseCats", mk !== "Income" ? (r.category || ctx.cat || "") : "")}</div>`
      + `<div data-catfor="Income" ${mk === "Income" ? "" : "hidden"}>${selectField("f-mcat-i", "Source", "incomeCats", mk === "Income" ? r.category : "")}</div>`
      + input("f-mamt", "Amount (EGP)", "number", r.amount, 'min="0" step="1" inputmode="decimal" required')
      + input("f-mnote", isFixed ? "Name" : "Note", "text", r.note, isFixed ? 'placeholder="e.g. Rent, Internet, Salary"' : 'placeholder="Optional"')
      + (isFixed ? `<p class="panel-note">Fixed items repeat every month. On the Money tab press <b>Add them</b> to log them for a month in one go.</p>` : "");
  } else if (kind === "budget") {
    title = "Budgets and balance";
    const B = budgets(), o = opening();
    body = `<div class="two">${input("f-obal", "Starting balance (EGP)", "number", o.amount || "", 'step="1" inputmode="decimal"')}${input("f-omon", "Counted from month", "month", o.month || iso(today()).slice(0, 7))}</div>
      <p class="panel-note">What you had at the start of that month across cash and accounts. The balance sheet builds on it.</p>
      <h3 class="done-h" style="margin:6px 0 0">Monthly budget per category (EGP)</h3>`
      + opt("expenseCats").map((c, i) => input("f-bud-" + i, c, "number", B[c] || "", 'min="0" step="50" inputmode="decimal" placeholder="No budget"')).join("")
      + `<p class="panel-note">Add or rename categories on the Options tab.</p>`;
  } else if (kind === "todo") {
    title = "Edit task";
    body = input("f-ttext", "Task", "text", r.text, "required")
      + `<label class="f" for="f-tlink">Linked to${linkSelect("f-tlink", r.link || "")}</label>`
      + `<div class="two">${input("f-tdate", "Day", "date", r.date || dayView, "required")}${plainSelect("f-tpri", "Priority", PRI, r.pri || "Medium")}</div>`
      + `<div class="two">${input("f-tmins", "Minutes", "number", r.mins, 'min="0" step="5" inputmode="numeric"')}${input("f-tnote", "Note", "text", r.note, 'placeholder="Optional"')}</div>`;
  } else if (kind === "acct") {
    title = id ? "Edit client or product" : "New client or product";
    body = `<div class="two">${plainSelect("f-kind", "Kind", KINDS, r.kind || "Client")}${bizSelect(r.businessId || ctx.biz)}</div>`
      + input("f-aname", "Name", "text", r.name, 'required placeholder="e.g. a supply customer or a product line"')
      + `<div class="two">${selectField("f-acat", "Category", "acctCats", r.category)}${selectField("f-astatus", "Status", "acctStatus", r.status || opt("acctStatus")[0] || "")}</div>`
      + `<div class="two">${selectField("f-ctype", "Contract type", "contractTypes", r.contractType)}${input("f-cno", "Contract number", "text", r.contractNo, 'placeholder="Optional"')}</div>`
      + textArea("f-cdesc", "Contract description", r.contract, "What's agreed: scope, quantities, renewal, anything to remember")
      + `<div class="two">${selectField("f-terms", "Payment terms", "payTerms", r.payTerms)}${input("f-phone", "Contact number", "tel", r.phone, 'placeholder="e.g. +20 10 1234 5678" inputmode="tel"')}</div>`
      + `<div class="two">${input("f-since", "Since", "date", r.since)}${input("f-note", "Note", "text", r.note, 'placeholder="Optional"')}</div>`
      + `<p class="panel-note">Link payouts and maintenance to this to see what it brings in and what it costs to keep.</p>`;
    if (id && (S.pays.some(p => p.accountId === id) || S.maint.some(m => m.accountId === id))) note = "Deleting this keeps its payouts and maintenance but unlinks them.";
  } else if (kind === "bms") {
    title = id ? "Edit business milestone" : "New business milestone";
    body = bizSelect(r.businessId || ctx.biz)
      + input("f-name", "Milestone", "text", r.name, 'required placeholder="e.g. Launch the wholesale catalogue"')
      + `<div class="two">${input("f-area", "Area", "text", r.area, 'placeholder="e.g. Sales, Product, Ops"')}${input("f-due", "Due date", "date", r.due)}</div>`
      + `<div class="two">${selectField("f-status", "Status", "msStatus", r.status || opt("msStatus")[opt("msStatus").length - 1] || "")}${input("f-invest", "Investment (EGP)", "number", r.invest, 'min="0" step="1" inputmode="decimal"')}</div>`
      + input("f-note", "Note", "text", r.note, 'placeholder="Optional"');
  } else if (kind === "maint") {
    title = id ? "Edit maintenance item" : "New maintenance item";
    body = bizSelect(r.businessId || ctx.biz)
      + `<label class="f" for="f-mfor">For client or product<select id="f-mfor">${srcFor(r.businessId || ctx.biz, r.accountId)}</select></label>`
      + input("f-mitem", "Item", "text", r.item, 'required placeholder="e.g. Shopify plan, machine servicing for a client"')
      + `<div class="two">${selectField("f-mcat", "Category", "maintCats", r.category)}${input("f-cost", "Cost each time (EGP)", "number", r.cost, 'min="0" step="1" inputmode="decimal"')}</div>`
      + `<div class="two">${plainSelect("f-freq", "How often", Object.keys(FREQ), r.freq || "Monthly")}${plainSelect("f-run", "Status", RUN, r.status || "Active")}</div>`
      + `<div class="two">${input("f-next", "Next due", "date", r.next)}${input("f-last", "Last done", "date", r.last)}</div>`
      + input("f-note", "Note", "text", r.note, 'placeholder="Optional"');
  }
  const canDelete = id && !(kind === "biz" && S.pays.some(p => p.businessId === id));
  $("#layer").innerHTML = `<div class="veil" data-close="1"></div>
    <form class="panel" id="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" novalidate>
      <div class="panel-h"><h2 id="panel-title">${title}</h2><button type="button" class="ibtn" data-close="1" aria-label="Close">${icon.x}</button></div>
      <div class="panel-b">${body}${note ? `<p class="panel-note">${esc(note)}</p>` : ""}<div id="confirm"></div></div>
      <div class="panel-f">${canDelete && !S.readOnly ? '<button type="button" class="btn danger small" data-del="1">Delete</button>' : ""}<span class="spacer"></span>
        <button type="button" class="btn ghost" data-close="1">Cancel</button>${S.readOnly ? "" : '<button type="submit" class="btn">Save</button>'}</div>
    </form>`;
  const first = $("#panel input, #panel select"); if (first) first.focus();
  if (kind === "pay") updateProfit();
}
function closePanel() { panel = null; $("#layer").innerHTML = ""; }
function updateProfit() {
  const el = $("#f-profit"); if (!el) return;
  const p = num($("#f-rev").value) - num($("#f-exp").value);
  el.textContent = $("#f-rev").value ? `Profit: ${money(p) === "-" ? "0" : money(p)} EGP` : "";
}
const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
const sel = id => { const v = val(id); return v === "__new" ? "" : v; };

async function submitPanel() {
  if (!panel) return;
  const { kind, id } = panel; let data, coll;
  if (kind === "goal") {
    if (!val("f-item")) return toast("Give the goal a name.");
    data = { item: val("f-item"), value: sel("f-value"), priority: sel("f-priority"), price: num(val("f-price")), have: sel("f-have"), target: val("f-target") }; coll = "goals";
  } else if (kind === "plan") {
    if (!val("f-goal")) return toast("Pick the goal this plan is for.");
    data = { goalId: val("f-goal"), start: val("f-start") }; coll = "plans";
  } else if (kind === "ms") {
    if (!val("f-name")) return toast("Name the milestone.");
    const w = num(val("f-worth")); if (w < 0 || w > 100) return toast("Worth must be between 0 and 100%.");
    data = { planId: panel.ctx.plan, name: val("f-name"), worth: w, due: val("f-due"), status: sel("f-status") }; coll = "milestones";
    if (!id) data.order = Math.max(0, ...S.ms.filter(m => m.planId === panel.ctx.plan).map(m => (m.order ?? 0) + 1));
  } else if (kind === "biz") {
    if (!val("f-bname")) return toast("Give the business a name.");
    data = { name: val("f-bname"), type: sel("f-btype"), status: sel("f-bstatus"), start: val("f-bstart") }; coll = "businesses";
    if (!id) data.order = Math.max(0, ...S.biz.map(b => (b.order ?? 0) + 1));
  } else if (kind === "pay") {
    if (!val("f-date")) return toast("Add the payout date.");
    if (!val("f-biz")) return toast("Pick which business paid out.");
    if (val("f-rev") === "") return toast("Enter the revenue, even if it's 0.");
    data = { date: val("f-date"), businessId: val("f-biz"), accountId: sel("f-src"), revenue: num(val("f-rev")), expenses: num(val("f-exp")), paidVia: sel("f-via"), note: val("f-note") }; coll = "payouts";
  } else if (kind === "money" || kind === "fixed") {
    const mk = val("f-mkind"), cat = mk === "Income" ? sel("f-mcat-i") : sel("f-mcat-e"), amt = num(val("f-mamt"));
    if (!amt) return toast("Enter the amount.");
    if (!cat) return toast(mk === "Income" ? "Pick a source." : "Pick a category.");
    if (kind === "money") { if (!val("f-mdate")) return toast("Add the date."); data = { kind: mk, date: val("f-mdate"), category: cat, amount: amt, note: val("f-mnote") }; coll = "money"; }
    else { data = { kind: mk, day: Math.min(31, Math.max(1, Math.round(num(val("f-mday")) || 1))), category: cat, amount: amt, note: val("f-mnote") }; coll = "fixed"; }
  } else if (kind === "budget") {
    const b = {}; opt("expenseCats").forEach((c, i) => { const v = num(val("f-bud-" + i)); if (v > 0) b[c] = v; });
    saveOpts({ ...(S.opts || {}), budgets: b, openingBalance: num(val("f-obal")), openingMonth: val("f-omon") }); toast("Saved"); return closePanel();
  } else if (kind === "todo") {
    if (!val("f-ttext")) return toast("Type the task.");
    data = { text: val("f-ttext"), link: val("f-tlink"), date: val("f-tdate") || dayView, pri: val("f-tpri"), mins: num(val("f-tmins")), note: val("f-tnote") }; coll = "todos";
  } else if (kind === "acct") {
    if (!val("f-biz")) return toast("Pick the business it belongs to.");
    if (!val("f-aname")) return toast("Give it a name.");
    data = { kind: val("f-kind"), businessId: val("f-biz"), name: val("f-aname"), category: sel("f-acat"), status: sel("f-astatus"), since: val("f-since"), note: val("f-note"),
      contractType: sel("f-ctype"), contractNo: val("f-cno"), contract: val("f-cdesc"), payTerms: sel("f-terms"), phone: val("f-phone") }; coll = "accounts";
  } else if (kind === "bms") {
    if (!val("f-biz")) return toast("Pick the business.");
    if (!val("f-name")) return toast("Name the milestone.");
    data = { businessId: val("f-biz"), name: val("f-name"), area: val("f-area"), due: val("f-due"), status: sel("f-status"), invest: num(val("f-invest")), note: val("f-note") }; coll = "bizMilestones";
  } else if (kind === "maint") {
    if (!val("f-biz")) return toast("Pick the business.");
    if (!val("f-mitem")) return toast("Name the item.");
    data = { businessId: val("f-biz"), accountId: val("f-mfor"), item: val("f-mitem"), category: sel("f-mcat"), cost: num(val("f-cost")), freq: val("f-freq"), status: val("f-run"), next: val("f-next"), last: val("f-last"), note: val("f-note") }; coll = "maintenance";
  }
  const btn = $('#panel [type="submit"]'); if (btn) btn.disabled = true;
  const ok = await write(() => id ? S.db.collection(coll).doc(id).update(data) : S.db.collection(coll).add({ ...data, created: Date.now() }), id ? "Saved" : "Added");
  if (ok) closePanel(); else if (btn) btn.disabled = false;
}
function askDelete() {
  $("#confirm").innerHTML = `<div class="confirm"><span>Delete this for good? This can't be undone.</span><div><button type="button" class="btn small" data-delyes="1">Yes, delete</button><button type="button" class="btn small ghost" data-delno="1">Keep it</button></div></div>`;
}
async function doDelete() {
  const { kind, id } = panel;
  const ok = await write(async () => {
    if (kind === "goal") {
      for (const p of S.plans.filter(p => p.goalId === id)) { for (const m of S.ms.filter(m => m.planId === p.id)) await S.db.collection("milestones").doc(m.id).delete(); await S.db.collection("plans").doc(p.id).delete(); }
      await S.db.collection("goals").doc(id).delete();
    } else if (kind === "plan") {
      for (const m of S.ms.filter(m => m.planId === id)) await S.db.collection("milestones").doc(m.id).delete();
      await S.db.collection("plans").doc(id).delete();
    } else if (kind === "biz") {
      for (const a of S.accts.filter(a => a.businessId === id)) await S.db.collection("accounts").doc(a.id).delete();
      for (const m of S.bms.filter(m => m.businessId === id)) await S.db.collection("bizMilestones").doc(m.id).delete();
      for (const m of S.maint.filter(m => m.businessId === id)) await S.db.collection("maintenance").doc(m.id).delete();
      await S.db.collection("businesses").doc(id).delete();
    } else if (kind === "acct") {
      for (const p of S.pays.filter(p => p.accountId === id)) await S.db.collection("payouts").doc(p.id).update({ accountId: "" });
      for (const m of S.maint.filter(m => m.accountId === id)) await S.db.collection("maintenance").doc(m.id).update({ accountId: "" });
      await S.db.collection("accounts").doc(id).delete();
    } else {
      await S.db.collection({ ms: "milestones", pay: "payouts", bms: "bizMilestones", maint: "maintenance", todo: "todos", money: "money", fixed: "fixed" }[kind]).doc(id).delete();
    }
  }, "Deleted");
  if (ok) closePanel();
}

// ---------------- events ----------------
document.addEventListener("click", e => {
  const t = e.target.closest("[data-tab],[data-new],[data-edit],[data-tick],[data-close],[data-del],[data-delyes],[data-delno],[data-addfor],[data-up],[data-rm],[data-more],[data-btab],[data-btick],[data-mdone],[data-addsrc],[data-ack],[data-dtick],[data-drm],[data-day],[data-ttick],[data-tmove],[data-trm],[data-ttoday],[data-radd],[data-rskip],[data-ctab],[data-mmon],[data-mgo],[data-fixadd],[data-backup],[data-restoreyes],[data-restoreno],[data-undo],[data-redo],[data-fixtoggle],[data-mdel],[data-budrm],[data-mcatf]");
  const sth = e.target.closest("th.sortable"); if (sth) return toggleSort(sth);
  if (!t || e.target.closest('a[href^="tel:"]')) return;
  const d = t.dataset;
  if (d.tab) return go(d.tab);
  if (d.close) return closePanel();
  if (d.btab) { bizTab = d.btab; payLimit = 40; return render(); }
  if (d.undo) { $("#toast").hidden = true; return undo(); }
  if (d.redo) return redo();
  if (d.backup) return d.backup === "xlsx" ? backupXlsx() : backupJson();
  if (d.restoreyes) return doRestore();
  if (d.restoreno) { restoreData = null; return render(); }
  if (d.mmon != null && d.mmon !== "") { const n = +d.mmon; moneyMonth = n === 0 ? iso(today()).slice(0, 7) : mShift(moneyMonth, n); return render(); }
  if (d.mgo) { moneyMonth = d.mgo; return render(); }
  if (d.budrm) return setBudget(d.budrm, 0);
  if (d.mcatf != null && t.matches("[data-mcatf]")) { entryCat = entryCat === d.mcatf ? "" : d.mcatf; render(); if (entryCat) { const el = [...document.querySelectorAll(".sec h2")].find(h => h.textContent === "Entries"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); } return; }
  if (d.mdel) { const x = S.money.find(z => z.id === d.mdel); if (!x) return;
    return write(() => S.db.collection("money").doc(x.id).delete(), `Removed ${x.kind === "Income" ? "income" : "expense"} of ${money(num(x.amount))} EGP`); }
  if (d.fixtoggle) {
    const f = S.fixed.find(z => z.id === d.fixtoggle); if (!f) return;
    const k = moneyMonth, logged = S.money.filter(x => x.fixedId === f.id && x.date && x.date.slice(0, 7) === k), name = f.note || f.category;
    if (logged.length) return write(async () => { for (const x of logged) await S.db.collection("money").doc(x.id).delete(); }, `Took ${name} out of ${mLabel(k)}`);
    const [yy, mm] = k.split("-").map(Number), last = new Date(yy, mm, 0).getDate();
    return write(() => S.db.collection("money").add({ kind: f.kind || "Expense", date: k + "-" + String(Math.min(last, num(f.day) || 1)).padStart(2, "0"), category: f.category, amount: num(f.amount), note: f.note || "", fixedId: f.id, created: Date.now() }), `Logged ${name} for ${mLabel(k)}`);
  }
  if (d.fixadd) {
    const k = moneyMonth, [yy, mm] = k.split("-").map(Number), last = new Date(yy, mm, 0).getDate();
    const due = S.fixed.filter(f => !S.money.some(x => x.fixedId === f.id && x.date && x.date.slice(0, 7) === k));
    return write(async () => { for (const f of due) await S.db.collection("money").add({ kind: f.kind || "Expense", date: k + "-" + String(Math.min(last, num(f.day) || 1)).padStart(2, "0"), category: f.category, amount: num(f.amount), note: f.note || "", fixedId: f.id, created: Date.now() }); }, `Added ${due.length} fixed ${due.length === 1 ? "item" : "items"}`);
  }
  if (d.new) return S.readOnly ? null : openPanel(d.new, null, { plan: d.plan, biz: bizSel, kind: d.mkind, cat: d.mcat });
  if (d.edit) return openPanel(d.edit, d.id);
  if (d.del) return askDelete();
  if (d.delno) { $("#confirm").innerHTML = ""; return; }
  if (d.delyes) return doDelete();
  if (d.more) { payLimit += 40; return render(); }
  if (d.tick) {
    const m = S.ms.find(x => x.id === d.tick); if (!m) return;
    const DONE = opt("msStatus")[0]; const next = m.status === DONE ? (m.prev && m.prev !== DONE ? m.prev : opt("msStatus")[1] || "") : DONE;
    return write(() => S.db.collection("milestones").doc(m.id).update({ status: next, prev: m.status === DONE ? "" : (m.status || ""), doneAt: next === DONE ? iso(today()) : "" }), next === DONE ? "Milestone done" : "Marked not done");
  }
  if (d.day != null && d.day !== "") { const n = +d.day; dayView = n === 0 ? iso(today()) : iso(new Date(parse(dayView).getTime() + n * DAY + 3600000)); return render(); }
  if (d.ctab) { const c = document.getElementById(d.ctab + "-c"), tb = document.getElementById(d.ctab + "-t"); if (c && tb) { const show = tb.hidden; tb.hidden = !show; c.hidden = show; t.textContent = show ? "Chart" : "Table"; } return; }
  if (d.ttick) { const x = S.todos.find(z => z.id === d.ttick); if (!x) return;
    return write(() => S.db.collection("todos").doc(x.id).update({ done: !x.done, doneAt: x.done ? "" : iso(today()) }), x.done ? "Marked not done" : "Done"); }
  if (d.tmove) { const x = S.todos.find(z => z.id === d.tmove); if (!x) return; const nx = iso(new Date(parse(x.date || dayView).getTime() + DAY + 3600000));
    return write(() => S.db.collection("todos").doc(x.id).update({ date: nx }), `Moved to ${fdate(nx)}`); }
  if (d.ttoday) return write(() => S.db.collection("todos").doc(d.ttoday).update({ date: iso(today()) }), "Moved to today");
  if (d.trm) return write(() => S.db.collection("todos").doc(d.trm).delete(), "Removed");
  if (d.radd || d.rskip) { const key = d.radd || d.rskip, r = recommendations().find(z => z.key === key); if (!r) return;
    const data = d.radd ? { text: r.text, link: r.link, date: iso(today()), pri: r.pri, mins: 0, note: r.why, done: false, doneAt: "", recKey: r.key, created: Date.now() }
      : { recKey: r.key, dismissed: true, date: iso(today()), created: Date.now() };
    return write(() => S.db.collection("todos").add(data), d.radd ? "Added to today" : "Hidden for now"); }
  if (d.ack) {
    const id2 = "auto_" + d.ack.replace(/[^A-Za-z0-9_\-]/g, "_"), ex = S.decs.find(x => x.id === id2);
    if (ex && ex.done) return write(() => S.db.collection("decisions").doc(id2).delete(), "Marked not done");
    return write(() => S.db.collection("decisions").doc(id2).set({ auto: true, key: d.ack, done: true, doneAt: iso(today()) }), "Ticked off");
  }
  if (d.dtick) {
    const x = S.decs.find(z => z.id === d.dtick); if (!x) return;
    return write(() => S.db.collection("decisions").doc(x.id).update({ done: !x.done, doneAt: x.done ? "" : iso(today()) }), x.done ? "Marked not done" : "Ticked off");
  }
  if (d.drm) return write(() => S.db.collection("decisions").doc(d.drm).delete(), "Removed");
  if (d.btick) {
    const m = S.bms.find(x => x.id === d.btick); if (!m) return;
    const DONE = opt("msStatus")[0]; const next = m.status === DONE ? (m.prev && m.prev !== DONE ? m.prev : opt("msStatus")[1] || "") : DONE;
    return write(() => S.db.collection("bizMilestones").doc(m.id).update({ status: next, prev: m.status === DONE ? "" : (m.status || ""), doneAt: next === DONE ? iso(today()) : "" }), next === DONE ? "Milestone reached" : "Marked not done");
  }
  if (d.mdone) {
    const m = S.maint.find(x => x.id === d.mdone); if (!m) return;
    const t0 = iso(today()), nx = addInterval(t0, m.freq);
    return write(() => S.db.collection("maintenance").doc(m.id).update({ last: t0, next: nx || "" }), nx ? `Done. Next due ${fdate(nx)}` : "Marked done");
  }
  if (d.addsrc) {
    const name = val("f-src-new"), b = val("f-biz"); if (!b) return toast("Pick the business first."); if (!name) return toast("Type the name first.");
    const kindV = val("f-src-kind") || "Client";
    return (async () => {
      let ref; const ok = await write(async () => { ref = await S.db.collection("accounts").add({ kind: kindV, name, businessId: b, category: "", status: opt("acctStatus")[0] || "", since: iso(today()), note: "", created: Date.now() }); }, `Added "${name}"`);
      if (!ok) return;
      const id2 = ref && ref.id; const s = document.getElementById("f-src"); if (!s) return;
      if (id2 && !s.querySelector(`option[value="${id2}"]`)) { const o = document.createElement("option"); o.value = id2; o.textContent = `${name} (${kindV})`; s.insertBefore(o, s.querySelector('option[value="__new"]')); }
      if (id2) s.value = id2; t.closest(".inline-add").hidden = true; document.getElementById("f-src-new").value = "";
    })();
  }
  if (d.addfor) {
    const s = document.getElementById(d.addfor), inp = document.getElementById(d.addfor + "-new"), v = inp.value.trim();
    if (!v) return toast("Type the new option first.");
    if (addOption(s.dataset.list, v) || opt(s.dataset.list).includes(v)) {
      const o = document.createElement("option"); o.textContent = v; s.insertBefore(o, s.querySelector('option[value="__new"]')); s.value = v;
      t.closest(".inline-add").hidden = true; inp.value = ""; toast(`Added "${v}" to the list`);
    }
    return;
  }
  if (d.up || d.rm) {
    const k = d.up || d.rm, i = +d.i, list = opt(k).slice();
    if (d.up) [list[i - 1], list[i]] = [list[i], list[i - 1]]; else list.splice(i, 1);
    return saveOpts({ ...(S.opts || {}), [k]: list });
  }
});
document.addEventListener("change", e => {
  const s = e.target;
  if (s.matches("select[data-list]")) {
    const box = document.querySelector(`.inline-add[data-for="${s.id}"]`);
    if (box) { box.hidden = s.value !== "__new"; if (s.value === "__new") box.querySelector("input").focus(); }
  }
  if (s.matches('[data-filter="biz"]')) { bizSel = s.value; payLimit = 40; render(); }
  if (s.matches("input[data-budget]")) { const v = Math.max(0, num(s.value)); if (v !== num(budgets()[s.dataset.budget])) setBudget(s.dataset.budget, v); return; }
  if (s.id === "restore-file" && s.files && s.files[0]) { readRestoreFile(s.files[0]); s.value = ""; return; }
  if (s.id === "f-mkind") document.querySelectorAll("[data-catfor]").forEach(el => { el.hidden = el.dataset.catfor !== s.value; });
  if (s.id === "f-src") { const box = document.querySelector('.inline-add[data-for="f-src"]'); if (box) { box.hidden = s.value !== "__new"; if (s.value === "__new") box.querySelector("input").focus(); } }
  if (s.id === "f-biz" && panel && panel.kind === "maint") { const f = document.getElementById("f-mfor"); if (f) f.innerHTML = srcFor(s.value, ""); }
  if (s.id === "f-biz" && panel && panel.kind === "pay") { const src = document.getElementById("f-src"); if (src) src.innerHTML = srcOptions(s.value, ""); const box = document.querySelector('.inline-add[data-for="f-src"]'); if (box) box.hidden = true; }
});
const tipShow = (el, x, y) => { const tp = $("#tip"); tp.textContent = el.dataset.tip; tp.hidden = false;
  const w = tp.offsetWidth, h = tp.offsetHeight; tp.style.left = Math.max(8, Math.min(innerWidth - w - 8, x + 12)) + "px"; tp.style.top = Math.max(8, y - h - 12) + "px"; };
document.addEventListener("mousemove", e => { const h = e.target.closest && e.target.closest(".hit"); if (h) tipShow(h, e.clientX, e.clientY); else $("#tip").hidden = true; });
document.addEventListener("touchstart", e => { const h = e.target.closest && e.target.closest(".hit"); if (h) { const t0 = e.touches[0]; tipShow(h, t0.clientX, t0.clientY); } else $("#tip").hidden = true; }, { passive: true });
document.addEventListener("input", e => { if (e.target.id === "f-rev" || e.target.id === "f-exp") updateProfit(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && panel) closePanel();
  else if (e.key === "Escape" && AI.open) aiOpen(false);
  if ((e.ctrlKey || e.metaKey) && !e.target.closest("input, textarea, select")) {
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
  }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("th.sortable")) { e.preventDefault(); toggleSort(e.target); }
  if (e.key === "Enter" && e.target.matches("input[data-budget]")) { e.preventDefault(); e.target.blur(); }
  if (e.key === "Enter" && e.target.matches(".inline-add input")) { e.preventDefault(); const b = e.target.parentElement.querySelector("button"); if (b) b.click(); }
  if (e.key === "Enter" && e.target.closest("tr.click") ) { e.target.closest("tr.click").click(); }
});
document.addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "panel") return submitPanel();
  if (f.dataset.budadd) { const c = val("bud-cat"), v = num(val("bud-amt")); if (!c) return; if (!(v > 0)) return toast("Enter the monthly budget."); return setBudget(c, v); }
  if (f.dataset.todo) {
    const text = val("td-new"); if (!text) return toast("Type the task first.");
    const data = { text, link: val("td-link"), pri: val("td-pri") || "Medium", mins: num(val("td-mins")), date: dayView, done: false, doneAt: "", note: "", created: Date.now() };
    return write(() => S.db.collection("todos").add(data), "Added").then(ok => { if (ok) { const i = document.getElementById("td-new"); if (i) { i.value = ""; i.focus(); } } });
  }
  if (f.dataset.dec) {
    const text = val("dec-new"); if (!text) return toast("Type the point first.");
    const data = { text, businessId: val("dec-biz"), due: val("dec-due"), done: false, doneAt: "", created: Date.now() };
    return write(() => S.db.collection("decisions").add(data), "Added").then(ok => { if (ok) { const i = document.getElementById("dec-new"); if (i) { i.value = ""; i.focus(); } } });
  }
  if (f.dataset.addopt) { const inp = f.querySelector("input"); if (addOption(f.dataset.addopt, inp.value)) inp.value = ""; return; }
  if (f.dataset.soon) { const n = Math.round(num($("#soon").value)); if (n < 1) return toast("Enter at least 1 day."); saveOpts({ ...(S.opts || {}), dueSoon: n }); toast("Saved"); }
});

// ---------------- boot ----------------
const start = () => {
  let t = (location.hash || "").slice(1);
  const TABS = ["today", "goals", "plans", "business", "money", "insights", "options"];
  if (!TABS.includes(t)) { try { t = localStorage.getItem("lb-tab") || "today"; } catch (e) { t = "today"; } }
  if (!TABS.includes(t)) t = "today";
  tab = t; render();
};
start();

// Sign-in screen; the first account created becomes the owner of this OS (any later sign-up is refused).
function showAuth(msg) {
  const el = $("#auth"); el.hidden = false; document.body.classList.add("locked");
  $("#auth-msg").textContent = msg || "";
  $("#auth-form").onsubmit = async e => {
    e.preventDefault();
    const email = $("#auth-email").value.trim(), password = $("#auth-pass").value, create = e.submitter && e.submitter.dataset.create;
    if (!email || password.length < 8) { $("#auth-msg").textContent = "Enter your email and a password of at least 8 characters."; return; }
    $("#auth-msg").textContent = create ? "Creating your account..." : "Signing in...";
    try { await api(create ? "/api/signup" : "/api/login", { email, password }); }
    catch (err) { $("#auth-msg").textContent = err.message; return; }
    location.reload();
  };
}
(async () => {
  DL = downloader;
  let me = { signedIn: false, hasOwner: true };
  try { me = await api("/api/me"); } catch (e) { toast("Couldn't reach the server: " + e.message); }
  if (!me.signedIn) { ["goals", "opts", "plans", "biz", "pays", "accts", "bms", "maint", "ms", "decs", "todos", "money", "fixed"].forEach(k => S.ready.add(k)); render(); return showAuth(me.hasOwner ? "" : "First time here? Enter your email and a password, then press Create account."); }
  const db = cfDb({ onSignedOut: () => location.reload() });
  db.ready.catch(e => { if (e.status !== 401) toast("Couldn't load your data: " + e.message); });
  S.rawDb = db; S.db = wrapDb(db);
  db.doc("app/assistant").onSnapshot(snap => { if (AI.loaded) return; const d = snap.exists ? snap.data() || {} : {};
    AI.notes = d.notes || ""; BRAIN.notes = AI.notes; AI.mode = ["free-first", "free", "haiku"].includes(d.mode) ? d.mode : "free-first"; AI.lastBrief = d.lastBrief || "";
    AI.msgs = Array.isArray(d.history) ? d.history.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || ""), actions: Array.isArray(m.actions) ? m.actions : [], via: m.via || "" })) : [];
    AI.loaded = true; aiSyncHead(); if (AI.open) aiRender(); aiMaybeBrief(); }, () => { AI.loaded = true; });
  aiInit();
  const listen = (coll, key, readyKey) => db.collection(coll).onSnapshot(snap => {
    S[key] = snap.docs.map(d => ({ id: d.id, ...d.data() })); S.ready.add(readyKey); render();
  }, () => { S.ready.add(readyKey); render(); });
  db.doc("app/options").onSnapshot(snap => { S.optsServer = snap.exists ? JSON.parse(JSON.stringify(snap.data())) : null; S.opts = snap.exists ? { ...snap.data() } : (S.opts || {}); S.ready.add("opts"); render(); }, () => { S.ready.add("opts"); render(); });
  listen("goals", "goals", "goals"); listen("plans", "plans", "plans"); listen("milestones", "ms", "ms");
  listen("businesses", "biz", "biz"); listen("payouts", "pays", "pays");
  listen("accounts", "accts", "accts"); listen("bizMilestones", "bms", "bms"); listen("maintenance", "maint", "maint"); listen("decisions", "decs", "decs"); listen("todos", "todos", "todos"); listen("money", "money", "money"); listen("fixed", "fixed", "fixed");
})();