function shouldSendCompletion({ fingerprintA, fingerprintB, previousFingerprint }) {
  if (fingerprintA !== fingerprintB) return false;
  if (previousFingerprint === fingerprintB) return false;
  return true;
}

function shouldSkipCompletion({ parentID, title }) {
  if (typeof parentID === "string" && parentID.length > 0) return true;
  if (!title) return false;
  const t = title.toLowerCase();
  return t.includes("subagent") || t.includes("@explore") || t.includes("@librarian") || t.includes("@oracle");
}

function shouldRetryForEmptyAssistant({ assistantContent, retryCount, maxRetries }) {
  if (assistantContent.trim()) return false;
  return retryCount < maxRetries;
}

const scenarios = [
  {
    name: "stable-idle-final",
    input: {
      fingerprintA: "12::u|a::t1:completed|t2:completed",
      fingerprintB: "12::u|a::t1:completed|t2:completed",
      previousFingerprint: null,
    },
    expected: true,
  },
  {
    name: "changed-during-recheck",
    input: {
      fingerprintA: "12::u|a::t1:pending",
      fingerprintB: "13::u|a|a::t1:pending",
      previousFingerprint: null,
    },
    expected: false,
  },
  {
    name: "duplicate-fingerprint",
    input: {
      fingerprintA: "13::u|a|a::t1:completed",
      fingerprintB: "13::u|a|a::t1:completed",
      previousFingerprint: "13::u|a|a::t1:completed",
    },
    expected: false,
  },
];

const skipScenarios = [
  { name: "parent-child-session", input: { parentID: "ses_parent", title: "Some title" }, expected: true },
  { name: "subagent-title", input: { parentID: undefined, title: "Research robust patterns (@librarian subagent)" }, expected: true },
  { name: "root-session", input: { parentID: undefined, title: "User main task" }, expected: false },
];

const retryScenarios = [
  { name: "empty-first-retry", input: { assistantContent: "", retryCount: 0, maxRetries: 4 }, expected: true },
  { name: "empty-at-limit", input: { assistantContent: "", retryCount: 4, maxRetries: 4 }, expected: false },
  { name: "has-content", input: { assistantContent: "done", retryCount: 1, maxRetries: 4 }, expected: false },
];

let passed = 0;
for (const scenario of scenarios) {
  const actual = shouldSendCompletion(scenario.input);
  const ok = actual === scenario.expected;
  if (ok) passed += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${scenario.name} -> expected=${scenario.expected}, actual=${actual}`);
}

for (const scenario of skipScenarios) {
  const actual = shouldSkipCompletion(scenario.input);
  const ok = actual === scenario.expected;
  if (ok) passed += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${scenario.name} -> expected=${scenario.expected}, actual=${actual}`);
}

for (const scenario of retryScenarios) {
  const actual = shouldRetryForEmptyAssistant(scenario.input);
  const ok = actual === scenario.expected;
  if (ok) passed += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${scenario.name} -> expected=${scenario.expected}, actual=${actual}`);
}

const total = scenarios.length + skipScenarios.length + retryScenarios.length;
console.log(`\nSummary: ${passed}/${total} scenarios passed.`);
if (passed !== total) {
  process.exitCode = 1;
}
