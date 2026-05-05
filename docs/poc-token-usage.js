#!/usr/bin/env node

/**
 * Token Usage POC — 解析本机 Claude Code + Codex 的 token 用量数据
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const os = require("os");

const HOME = os.homedir();

// ─── Claude Code Parser ───

async function parseClaudeFile(filePath) {
  const events = [];
  const seen = new Set();

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.includes('"type":"assistant"')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type !== "assistant") continue;
      const msg = obj.message || {};
      const usage = msg.usage;
      if (!usage) continue;

      const dedupKey = `${msg.id || ""}:${obj.requestId || ""}`;
      if (dedupKey !== ":" && seen.has(dedupKey)) continue;
      if (dedupKey !== ":") seen.add(dedupKey);

      events.push({
        agent: "claude-code",
        model: msg.model || "unknown",
        timestamp: obj.timestamp || "",
        sessionId: obj.sessionId || "",
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_creation_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
      });
    } catch {}
  }
  return events;
}

async function scanClaude() {
  const dirs = [
    path.join(HOME, ".claude", "projects"),
    path.join(HOME, ".config", "claude", "projects"),
  ];

  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    collectJsonlFiles(dir, files);
  }

  console.log(`  Found ${files.length} Claude Code JSONL files`);

  let allEvents = [];
  for (const f of files) {
    const events = await parseClaudeFile(f);
    allEvents.push(...events);
  }
  return allEvents;
}

// ─── Codex Parser ───

async function parseCodexFile(filePath) {
  const events = [];
  let lastTotal = null;
  let currentModel = "unknown";

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.includes("token_count") && !line.includes("turn_context")) continue;
    try {
      const obj = JSON.parse(line);
      const payload = obj.payload || {};

      if (payload.model) {
        currentModel = payload.model;
        continue;
      }

      if (payload.type !== "token_count") continue;
      const info = payload.info;
      if (!info || !info.total_token_usage) continue;

      const total = info.total_token_usage;
      const last = info.last_token_usage;

      let input = 0, output = 0, cached = 0, reasoning = 0;

      if (last && last.input_tokens > 0) {
        input = last.input_tokens || 0;
        output = last.output_tokens || 0;
        cached = last.cached_input_tokens || 0;
        reasoning = last.reasoning_output_tokens || 0;
      } else if (lastTotal) {
        input = Math.max(0, (total.input_tokens || 0) - (lastTotal.input_tokens || 0));
        output = Math.max(0, (total.output_tokens || 0) - (lastTotal.output_tokens || 0));
        cached = Math.max(0, (total.cached_input_tokens || 0) - (lastTotal.cached_input_tokens || 0));
        reasoning = Math.max(0, (total.reasoning_output_tokens || 0) - (lastTotal.reasoning_output_tokens || 0));
      } else {
        input = total.input_tokens || 0;
        output = total.output_tokens || 0;
        cached = total.cached_input_tokens || 0;
        reasoning = total.reasoning_output_tokens || 0;
      }

      lastTotal = { ...total };

      if (input + output === 0) continue;

      events.push({
        agent: "codex",
        model: currentModel,
        timestamp: obj.timestamp || "",
        sessionId: path.basename(filePath, ".jsonl"),
        input_tokens: input,
        output_tokens: output,
        cached_input_tokens: cached,
        reasoning_output_tokens: reasoning,
      });
    } catch {}
  }
  return events;
}

async function scanCodex() {
  const codexHome = process.env.CODEX_HOME || path.join(HOME, ".codex");
  const dirs = [
    path.join(codexHome, "sessions"),
    path.join(codexHome, "archived_sessions"),
  ];

  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    collectJsonlFiles(dir, files);
  }

  console.log(`  Found ${files.length} Codex JSONL files`);

  let allEvents = [];
  for (const f of files) {
    const events = await parseCodexFile(f);
    allEvents.push(...events);
  }
  return allEvents;
}

// ─── Utilities ───

function collectJsonlFiles(dir, result) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsonlFiles(full, result);
    } else if (entry.name.endsWith(".jsonl")) {
      result.push(full);
    }
  }
}

function formatNumber(n) {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// ─── Main ───

async function main() {
  console.log("Token Usage POC — Scanning local AI agent data\n");

  const start = Date.now();

  console.log("[1/2] Scanning Claude Code...");
  const claudeEvents = await scanClaude();

  console.log("[2/2] Scanning Codex...");
  const codexEvents = await scanCodex();

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  const allEvents = [...claudeEvents, ...codexEvents];

  console.log(`\nParsed ${allEvents.length} events in ${elapsed}s\n`);

  // ─── Summary by Agent ───
  console.log("═══ Summary by Agent ═══\n");

  const byAgent = {};
  for (const e of allEvents) {
    if (!byAgent[e.agent]) byAgent[e.agent] = { count: 0, input: 0, output: 0, models: new Set() };
    const a = byAgent[e.agent];
    a.count++;
    a.input += e.input_tokens;
    a.output += e.output_tokens;
    a.models.add(e.model);
  }

  for (const [agent, data] of Object.entries(byAgent)) {
    const total = data.input + data.output;
    console.log(`${agent}:`);
    console.log(`  Messages:     ${formatNumber(data.count)}`);
    console.log(`  Input tokens: ${formatNumber(data.input)}`);
    console.log(`  Output tokens:${formatNumber(data.output)}`);
    console.log(`  Total tokens: ${formatNumber(total)}`);
    console.log(`  Models:       ${[...data.models].join(", ")}`);
    console.log();
  }

  // ─── Summary by Model ───
  console.log("═══ Summary by Model ═══\n");

  const byModel = {};
  for (const e of allEvents) {
    const key = `${e.agent}/${e.model}`;
    if (!byModel[key]) byModel[key] = { count: 0, input: 0, output: 0 };
    byModel[key].count++;
    byModel[key].input += e.input_tokens;
    byModel[key].output += e.output_tokens;
  }

  const sorted = Object.entries(byModel).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output));
  for (const [model, data] of sorted) {
    const total = data.input + data.output;
    console.log(`  ${model.padEnd(45)} ${formatNumber(data.count).padStart(6)} msgs  ${formatNumber(total).padStart(8)} tokens`);
  }

  // ─── Daily trend (last 14 days) ───
  console.log("\n═══ Daily Trend (last 14 days) ═══\n");

  const byDay = {};
  for (const e of allEvents) {
    if (!e.timestamp) continue;
    const day = e.timestamp.slice(0, 10);
    if (!byDay[day]) byDay[day] = { input: 0, output: 0, count: 0 };
    byDay[day].input += e.input_tokens;
    byDay[day].output += e.output_tokens;
    byDay[day].count++;
  }

  const days = Object.keys(byDay).sort().slice(-14);
  const maxTokens = Math.max(...days.map((d) => byDay[d].input + byDay[d].output));

  for (const day of days) {
    const data = byDay[day];
    const total = data.input + data.output;
    const barLen = Math.round((total / maxTokens) * 40);
    const bar = "█".repeat(barLen) + "░".repeat(40 - barLen);
    console.log(`  ${day}  ${bar}  ${formatNumber(total).padStart(8)}  (${data.count} msgs)`);
  }

  // ─── Date range ───
  const allDays = Object.keys(byDay).sort();
  if (allDays.length > 0) {
    console.log(`\n  Date range: ${allDays[0]} → ${allDays[allDays.length - 1]} (${allDays.length} active days)`);
  }

  const grandInput = allEvents.reduce((s, e) => s + e.input_tokens, 0);
  const grandOutput = allEvents.reduce((s, e) => s + e.output_tokens, 0);
  console.log(`  Grand total: ${formatNumber(grandInput + grandOutput)} tokens (${formatNumber(grandInput)} in / ${formatNumber(grandOutput)} out)`);
}

main().catch(console.error);
