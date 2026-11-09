import * as Schema from "effect/Schema";
import { EnvironmentId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const TransferRouteUrl = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter(
    (value) => {
      try {
        const url = new URL(value);
        return (
          (url.protocol === "http:" || url.protocol === "https:") &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname === "/"
        );
      } catch {
        return false;
      }
    },
    { expected: "an HTTP origin without credentials, query, or fragment" },
  ),
);

export const EnvironmentTransfer = Schema.Struct({
  version: Schema.Literal(1),
  environments: Schema.Array(
    Schema.Struct({
      environmentId: EnvironmentId,
      label: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
      routes: Schema.Array(
        Schema.Struct({
          kind: Schema.Literals(["lan", "netbird", "tailscale", "other"]),
          url: TransferRouteUrl,
        }),
      ).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
      pairingCode: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
      expiresAt: Schema.String.check(
        Schema.makeFilter(
          (value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
          { expected: "an ISO expiration timestamp" },
        ),
      ),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});
export type EnvironmentTransfer = typeof EnvironmentTransfer.Type;

const decodeTransfer = Schema.decodeUnknownSync(EnvironmentTransfer, { onExcessProperty: "error" });

export function decodeEnvironmentTransfer(json: string): EnvironmentTransfer {
  if (json.length > 1_000_000) throw new Error("Environment transfer is too large.");
  return decodeTransfer(JSON.parse(json));
}
