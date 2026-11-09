import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthAccessWriteScope,
  AuthStandardClientScopes,
  decodeEnvironmentTransfer,
  type EnvironmentTransfer,
} from "@t3tools/contracts";
import {
  environmentTransferRoutes,
  previewEnvironmentTransfer,
} from "@t3tools/client-runtime/connection";
import * as DateTime from "effect/DateTime";
import { environmentCatalog } from "../../connection/catalog";
import { transferAuth, importTransfer } from "../../state/environmentTransfer";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentsWithScope } from "../../state/session";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

async function settleTransfer(operation: () => Promise<void>, report: (message: string) => void) {
  try {
    await operation();
  } catch {
    report("Transfer interrupted. Check saved environments before trying again.");
  }
}

export function EnvironmentTransferPanel() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const candidates = [...catalog.entries.values()].map((entry) => ({
    environmentId: entry.target.environmentId,
    label: entry.target.label,
    routes: environmentTransferRoutes(entry),
  }));
  const permitted = useEnvironmentsWithScope(candidates, AuthAccessWriteScope);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [json, setJson] = useState("");
  const [preview, setPreview] = useState<EnvironmentTransfer | null>(null);
  const [message, setMessage] = useState("");
  const [previewTime, setPreviewTime] = useState(0);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mint = useAtomCommand(transferAuth.createPairingCredential, { reportFailure: false });
  const importEnvironments = useAtomCommand(importTransfer, { reportFailure: false });
  const rows = preview
    ? previewEnvironmentTransfer(preview, new Set(catalog.entries.keys()), previewTime)
    : [];
  function toggle(key: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function inspect() {
    setPreviewTime(Date.now());
    try {
      setPreview(decodeEnvironmentTransfer(json));
      setMessage("");
    } catch {
      setPreview(null);
      setMessage("Invalid environment JSON. Check the version, addresses and expiration dates.");
    }
  }
  async function exportSelected() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setPreview(null);
    setJson("");
    const environments: EnvironmentTransfer["environments"][number][] = [];
    const failed: string[] = [];
    await settleTransfer(async () => {
      for (const candidate of candidates) {
        const routes = candidate.routes.filter((route) =>
          selected.has(`${candidate.environmentId}:${route.url}`),
        );
        if (!routes.length || !permitted.has(candidate.environmentId)) continue;
        const result = await mint({
          environmentId: candidate.environmentId,
          input: { label: "Environment transfer", scopes: AuthStandardClientScopes },
        });
        if (result._tag === "Success")
          environments.push({
            environmentId: candidate.environmentId,
            label: candidate.label,
            routes,
            pairingCode: result.value.credential,
            expiresAt: DateTime.formatIso(result.value.expiresAt),
          });
        else failed.push(candidate.label);
      }
      if (environments.length) setJson(JSON.stringify({ version: 1, environments }, null, 2));
      setMessage(
        `${environments.length} exported.${failed.length ? ` Could not export: ${failed.join(", ")}. Access management and standard client permissions are required.` : " Codes expire in five minutes and can be used once. Transfer this JSON privately."}`,
      );
    }, setMessage);
    running.current = false;
    setBusy(false);
  }
  async function importSelected() {
    if (!preview || running.current) return;
    running.current = true;
    setBusy(true);
    await settleTransfer(async () => {
      const result = await importEnvironments(preview);
      setMessage(
        result._tag === "Success"
          ? result.value
              .map((row, index) => `${preview.environments[index]!.label}: ${row.status}`)
              .join("\n") +
              "\nFor failures, check the selected route and request a fresh code if it expired or was already used. Successful imports are saved."
          : "Import interrupted. Check saved environments before retrying.",
      );
      setPreview(null);
      setJson("");
    }, setMessage);
    running.current = false;
    setBusy(false);
  }
  function chooseRoute(index: number, routeIndex: number) {
    setPreview((current) =>
      current
        ? {
            ...current,
            environments: current.environments.map((entry, i) =>
              i === index
                ? {
                    ...entry,
                    routes: [
                      entry.routes[routeIndex]!,
                      ...entry.routes.filter((_, r) => r !== routeIndex),
                    ],
                  }
                : entry,
            ),
          }
        : null,
    );
  }
  return (
    <div className="flex flex-col gap-3 py-4">
      <h3>Transfer environments</h3>
      <p>
        Select addresses reachable from the receiving device. VPN addresses may require NetBird or
        Tailscale.
      </p>
      {candidates.map((candidate) => (
        <fieldset
          key={candidate.environmentId}
          disabled={busy || !permitted.has(candidate.environmentId)}
        >
          <legend>{candidate.label}</legend>
          {candidate.routes.map((route) => {
            const key = `${candidate.environmentId}:${route.url}`;
            return (
              <label key={key} className="flex gap-2">
                <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
                {route.kind}: {route.url}
              </label>
            );
          })}
        </fieldset>
      ))}
      <Button disabled={busy || !selected.size} onClick={() => void exportSelected()}>
        Export selected
      </Button>
      <label>
        Open JSON file
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 1_000_000) {
              setMessage("File is too large.");
              return;
            }
            void file
              .text()
              .then((value) => {
                setJson(value);
                setPreview(null);
              })
              .catch(() => setMessage("Could not read file."));
          }}
        />
      </label>
      <Button
        disabled={busy || !json || preview !== null}
        onClick={() => {
          const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = "t3-environments.json";
          link.click();
          URL.revokeObjectURL(url);
        }}
      >
        Download JSON
      </Button>
      <Textarea
        aria-label="Environment transfer JSON"
        value={json}
        disabled={busy}
        onChange={(event) => {
          setJson(event.target.value);
          setPreview(null);
        }}
        rows={6}
      />
      <Button disabled={busy || !json} onClick={inspect}>
        Preview import
      </Button>
      {rows.map(({ entry, status, key }, index) => (
        <div key={key}>
          <p>
            {entry.label}: {status} · expires {entry.expiresAt}
          </p>
          <select
            aria-label={`Route for ${entry.label}`}
            disabled={busy || status !== "ready"}
            value={entry.routes[0]!.url}
            onChange={(event) =>
              chooseRoute(
                index,
                entry.routes.findIndex((route) => route.url === event.target.value),
              )
            }
          >
            {entry.routes.map((route) => (
              <option key={route.url} value={route.url}>
                {route.kind}: {route.url}
              </option>
            ))}
          </select>
        </div>
      ))}
      {preview && (
        <Button
          disabled={busy || !rows.some((row) => row.status === "ready")}
          onClick={() => void importSelected()}
        >
          Import ready environments
        </Button>
      )}
      <p role="status" className="whitespace-pre-wrap">
        {message}
      </p>
    </div>
  );
}
