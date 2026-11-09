import { expect, it } from "vite-plus/test";
import { decodeEnvironmentTransfer } from "./environmentTransfer.ts";

const entry = {
  environmentId: "test-environment",
  label: "Test server",
  routes: [{ kind: "netbird", url: "http://100.80.1.2:3773" }],
  pairingCode: "test-only-code",
  expiresAt: "2026-11-09T12:05:00.000Z",
};

it("accepts versioned transfers and rejects credential-bearing routes and unknown fields", () => {
  const decode = (value: unknown) => decodeEnvironmentTransfer(JSON.stringify(value));
  expect(decode({ version: 1, environments: [entry] }).environments).toHaveLength(1);
  for (const url of [
    "file:///tmp/server",
    "https://user:secret@example.com",
    "https://example.com?token=secret",
    "https://example.com#token=secret",
  ]) {
    expect(() =>
      decode({ version: 1, environments: [{ ...entry, routes: [{ kind: "lan", url }] }] }),
    ).toThrow();
  }
  expect(() => decode({ version: 2, environments: [entry] })).toThrow();
  expect(() =>
    decode({ version: 1, environments: [{ ...entry, token: "persistent-secret" }] }),
  ).toThrow();
  expect(() =>
    decode({ version: 1, environments: [{ ...entry, expiresAt: "invalid" }] }),
  ).toThrow();
});
