function shouldSendCompletion({ fingerprintA, fingerprintB, previousFingerprint }) {
  if (fingerprintA !== fingerprintB) return false;
  if (previousFingerprint === fingerprintB) return false;
  return true;
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

let passed = 0;
for (const scenario of scenarios) {
  const actual = shouldSendCompletion(scenario.input);
  const ok = actual === scenario.expected;
  if (ok) passed += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${scenario.name} -> expected=${scenario.expected}, actual=${actual}`);
}

console.log(`\nSummary: ${passed}/${scenarios.length} scenarios passed.`);
if (passed !== scenarios.length) {
  process.exitCode = 1;
}
