import fs from "fs"; import path from "path";
export function rows(dir = "/home/claude/pos/export") {
  const out = [];
  for (const coll of fs.readdirSync(dir)) for (const f of fs.readdirSync(path.join(dir, coll))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, coll, f), "utf8"));
    out.push({ coll, id: j.id ?? f.replace(/\.json$/, ""), data: j.data ?? j });
  }
  return out;
}
