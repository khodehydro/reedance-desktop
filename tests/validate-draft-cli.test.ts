import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.join(__dirname, "..");
const fixture = path.join(root, "contracts", "fixtures", "quiet-step.rddraft.json");

function run(...args: string[]): { code: number | null; out: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(root, "scripts", "validate-draft.ts"), ...args], { cwd: root, encoding: "utf8" });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

test("validate:draft accepts a contract-valid draft and flags editorial gaps only in --strict mode", () => {
  const normal = run(fixture);
  assert.equal(normal.code, 0, normal.out);
  assert.match(normal.out, /✓ .*quiet-step/);
  assert.match(normal.out, /story has 2 lines \(minimum 25\)/);
  const strict = run(fixture, "--strict");
  assert.equal(strict.code, 1, "quality rules block in strict mode");
});

test("validate:draft blocks what the studio import would reject", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-validate-"));
  const draft = JSON.parse(fs.readFileSync(fixture, "utf8"));
  draft.lyrics[1].language = "es"; // foreign line that still teaches words
  draft.lyrics[0].startMs = 10; // timings belong to the studio
  const file = path.join(dir, "bad.rddraft.json");
  fs.writeFileSync(file, JSON.stringify(draft));
  fs.writeFileSync(path.join(dir, "bom.rddraft.json"), "\ufeff{}");
  const result = run(dir);
  assert.equal(result.code, 1);
  assert.match(result.out, /startMs/);
  assert.match(result.out, /UTF-8 BOM/);
  assert.match(result.out, /0\/2 draft\(s\) pass/);
});
