import { expect, it } from "@effect/vitest";
import { decodeEnvironmentTransfer } from "@t3tools/contracts";
import { previewEnvironmentTransfer } from "./transfer.ts";
import { importEnvironmentTransfer } from "./transfer.ts";
import * as Effect from "effect/Effect";
import { ConnectionBlockedError, ConnectionTransientError } from "./model.ts";

it.effect("retains successes and skips duplicates while continuing after a rejected code", () =>
  Effect.gen(function* () {
    const entry = {
      environmentId: "one",
      label: "One",
      routes: [{ kind: "netbird", url: "http://100.80.1.1:3773" }],
      pairingCode: "fixture",
      expiresAt: "2099-11-09T12:05:00Z",
    };
    const transfer = decodeEnvironmentTransfer(
      JSON.stringify({
        version: 1,
        environments: [
          entry,
          entry,
          { ...entry, environmentId: "two" },
          { ...entry, environmentId: "three" },
          { ...entry, environmentId: "four" },
          { ...entry, environmentId: "expired", expiresAt: "1960-01-01T00:00:00Z" },
        ],
      }),
    );
    const redeemed: string[] = [];
    const results = yield* importEnvironmentTransfer(transfer, new Set(), (input) =>
      Effect.gen(function* () {
        redeemed.push(input.expectedEnvironmentId!);
        if (input.expectedEnvironmentId === "two")
          return yield* new ConnectionBlockedError({
            reason: "authentication",
            detail: "Rejected code",
          });
        if (input.expectedEnvironmentId === "four")
          return yield* new ConnectionTransientError({ reason: "network", detail: "No route" });
        return input.expectedEnvironmentId!;
      }),
    );
    expect(redeemed).toEqual(["one", "two", "three", "four"]);
    expect(results.map((row) => row.status)).toEqual([
      "imported",
      "duplicate",
      "code-rejected",
      "imported",
      "route-unavailable",
      "expired",
    ]);
  }),
);

it("previews duplicates and expiration without redeeming credentials", () => {
  const entry = {
    environmentId: "one",
    label: "One",
    routes: [{ kind: "netbird", url: "http://100.80.1.1:3773" }],
    pairingCode: "fixture",
    expiresAt: "2026-11-09T12:05:00Z",
  };
  const transfer = decodeEnvironmentTransfer(
    JSON.stringify({
      version: 1,
      environments: [entry, entry, { ...entry, environmentId: "two" }],
    }),
  );
  expect(
    previewEnvironmentTransfer(transfer, new Set(), Date.parse("2026-11-09T12:00:00Z")).map(
      (row) => row.status,
    ),
  ).toEqual(["ready", "duplicate", "ready"]);
  expect(
    previewEnvironmentTransfer(
      transfer,
      new Set([transfer.environments[0]!.environmentId]),
      Date.parse("2026-11-09T12:05:00Z"),
    ).map((row) => row.status),
  ).toEqual(["duplicate", "duplicate", "expired"]);
});
