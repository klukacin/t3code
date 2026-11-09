import * as Schema from "effect/Schema";
import type { EnvironmentId, EnvironmentTransfer } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import { ConnectionBlockedError, ConnectionTransientError } from "./model.ts";
import type { PairingConnectionInput } from "./onboarding.ts";
import type { ConnectionCatalogEntry } from "./catalog.ts";
import { connectionRoutes, connectionRouteKind, routeHttpBaseUrl } from "./routes.ts";

const isTransientError = Schema.is(ConnectionTransientError);
const isBlockedError = Schema.is(ConnectionBlockedError);

export function environmentTransferRoutes(entry: ConnectionCatalogEntry) {
  return connectionRoutes(entry)
    .flatMap((route) => {
      const url = routeHttpBaseUrl(route);
      const kind = connectionRouteKind(route);
      if (!url || kind === "loopback" || kind === "relay" || kind === "ssh") return [];
      return [
        {
          url,
          kind:
            kind === "tailnet"
              ? ("tailscale" as const)
              : kind === "lan"
                ? ("lan" as const)
                : ("other" as const),
        },
      ];
    })
    .filter(
      (route, index, routes) => routes.findIndex((other) => other.url === route.url) === index,
    );
}

export const importEnvironmentTransfer = Effect.fn("connection.importEnvironmentTransfer")(
  function* <E, R>(
    transfer: EnvironmentTransfer,
    known: ReadonlySet<EnvironmentId>,
    register: (input: PairingConnectionInput) => Effect.Effect<EnvironmentId, E, R>,
  ) {
    const seen = new Set(known);
    return yield* Effect.forEach(
      transfer.environments,
      (entry) =>
        Effect.gen(function* () {
          if (seen.has(entry.environmentId))
            return { environmentId: entry.environmentId, status: "duplicate" as const };
          seen.add(entry.environmentId);
          const now = yield* Clock.currentTimeMillis;
          if (Date.parse(entry.expiresAt) <= now)
            return { environmentId: entry.environmentId, status: "expired" as const };
          // A lost exchange response may already have spent the code; never retry another route automatically.
          return yield* register({
            host: entry.routes[0]!.url,
            pairingCode: entry.pairingCode,
            expectedEnvironmentId: entry.environmentId,
          }).pipe(
            Effect.map(() => ({ environmentId: entry.environmentId, status: "imported" as const })),
            Effect.catch((error) =>
              Effect.succeed({
                environmentId: entry.environmentId,
                status: isTransientError(error)
                  ? ("route-unavailable" as const)
                  : isBlockedError(error) && error.reason === "authentication"
                    ? ("code-rejected" as const)
                    : ("failed" as const),
              }),
            ),
          );
        }),
      { concurrency: 1 },
    );
  },
);

export function previewEnvironmentTransfer(
  transfer: EnvironmentTransfer,
  known: ReadonlySet<EnvironmentId>,
  now: number,
) {
  const seen = new Set(known);
  return transfer.environments.map((entry, index) => {
    const status = seen.has(entry.environmentId)
      ? "duplicate"
      : Date.parse(entry.expiresAt) <= now
        ? "expired"
        : "ready";
    seen.add(entry.environmentId);
    return { entry, status, key: `${entry.environmentId}:${index}` } as const;
  });
}
