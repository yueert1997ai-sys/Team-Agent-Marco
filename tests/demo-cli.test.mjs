import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("mock CLI completes without provider credentials", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["dist/src/demo/cli.js", "--mode", "mock", "--topic", "是否继续做圆桌会议", "--no-save"],
    { env: { ...process.env, GEMINI_API_KEY: "", DEEPSEEK_API_KEY: "" }, timeout: 10_000 }
  );
  assert.equal(stderr, "");
  assert.match(stdout, /模拟会议/);
  assert.match(stdout, /最终决定/);
});
