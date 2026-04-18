#!/usr/bin/env node
import { execSync } from "node:child_process";

const targetDate = process.argv[2] ?? "2026-04-18";
const author = process.argv[3];

const since = `${targetDate} 00:00:00`;
const until = `${targetDate} 23:59:59`;

const authorArg = author ? ` --author=${JSON.stringify(author)}` : "";
const logCmd = `git log --since="${since}" --until="${until}"${authorArg} --pretty=format:"%H%x09%an%x09%s" --no-merges`;

const raw = execSync(logCmd, { encoding: "utf8" }).trim();
if (!raw) {
  console.log(`No commits on ${targetDate}${author ? ` by ${author}` : ""}`);
  process.exit(0);
}

const commits = raw.split("\n").map((line) => {
  const [hash, name, ...rest] = line.split("\t");
  return { hash, author: name, subject: rest.join("\t") };
});

let totalAdded = 0;
let totalDeleted = 0;
const perFile = new Map();
const perCommit = [];

for (const c of commits) {
  const numstat = execSync(
    `git show --no-renames --numstat --format= ${c.hash}`,
    { encoding: "utf8" },
  ).trim();
  let added = 0;
  let deleted = 0;
  let files = 0;
  if (numstat) {
    for (const line of numstat.split("\n")) {
      const [a, d, file] = line.split("\t");
      if (a === "-" || d === "-") continue;
      const ai = Number(a);
      const di = Number(d);
      added += ai;
      deleted += di;
      files += 1;
      const prev = perFile.get(file) ?? { added: 0, deleted: 0 };
      prev.added += ai;
      prev.deleted += di;
      perFile.set(file, prev);
    }
  }
  totalAdded += added;
  totalDeleted += deleted;
  perCommit.push({ ...c, added, deleted, files });
}

const fmt = (n) => String(n).padStart(6);
const shortHash = (h) => h.slice(0, 8);

console.log(`\n=== Git Daily Stats — ${targetDate}${author ? ` (${author})` : ""} ===\n`);
console.log(`Commits: ${commits.length}`);
console.log(`  Added:    ${totalAdded} lines`);
console.log(`  Deleted:  ${totalDeleted} lines`);
console.log(`  Net:      ${totalAdded - totalDeleted} lines`);
console.log(`  Total touched: ${totalAdded + totalDeleted} lines`);
console.log(`  Files changed: ${perFile.size}`);

console.log(`\n--- Commits ---`);
for (const c of perCommit) {
  console.log(
    `${shortHash(c.hash)}  +${fmt(c.added)} -${fmt(c.deleted)}  (${c.files} files)  ${c.subject}`,
  );
}

const topFiles = [...perFile.entries()]
  .sort((a, b) => b[1].added + b[1].deleted - (a[1].added + a[1].deleted))
  .slice(0, 20);

console.log(`\n--- Top ${topFiles.length} files by churn ---`);
for (const [file, s] of topFiles) {
  console.log(`  +${fmt(s.added)} -${fmt(s.deleted)}  ${file}`);
}
console.log();
