import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
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
import { View, Share } from "react-native";
import { Button } from "../../components/ui/Button";
import { AppText, AppTextInput } from "../../components/ui/AppText";

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
    <View className="gap-3 py-4">
      <AppText>Transfer environments</AppText>
      <AppText>
        Select addresses reachable from the receiving device. Connect NetBird or Tailscale as
        needed.
      </AppText>
      {candidates.map((candidate) => (
        <View key={candidate.environmentId}>
          <AppText>{candidate.label}</AppText>
          {candidate.routes.map((route) => {
            const key = `${candidate.environmentId}:${route.url}`;
            return (
              <Button
                key={key}
                label={`${selected.has(key) ? "✓ " : ""}${route.kind}: ${route.url}`}
                disabled={busy || !permitted.has(candidate.environmentId)}
                onPress={() => toggle(key)}
              />
            );
          })}
        </View>
      ))}
      <Button
        label="Export selected"
        disabled={busy || !selected.size}
        onPress={() => void exportSelected()}
      />
      <Button
        label="Open JSON file"
        disabled={busy}
        onPress={() => {
          void (async () => {
            try {
              const result = await DocumentPicker.getDocumentAsync({
                type: ["application/json", "text/plain"],
                copyToCacheDirectory: true,
              });
              if (result.canceled) return;
              const asset = result.assets[0];
              if (!asset) return;
              const file = new File(asset.uri);
              try {
                if (file.size > 1_000_000) {
                  setMessage("File is too large.");
                  file.delete();
                  return;
                }
                setJson(await file.text());
                setPreview(null);
              } catch {
                setMessage("Could not read file.");
              }
              file.delete();
            } catch {
              setMessage("Could not read file.");
            }
          })();
        }}
      />
      <AppTextInput
        accessibilityLabel="Environment transfer JSON"
        multiline
        value={json}
        editable={!busy}
        onChangeText={(value) => {
          setJson(value);
          setPreview(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        className="min-h-32 rounded-lg border border-border p-3"
      />
      <Button
        label="Share JSON"
        disabled={busy || !json || preview !== null}
        onPress={() => {
          void Share.share({ message: json });
        }}
      />
      <Button label="Preview import" disabled={busy || !json} onPress={inspect} />
      {rows.map(({ entry, status, key }, index) => (
        <View key={key}>
          <AppText>
            {entry.label}: {status} · expires {entry.expiresAt}
          </AppText>
          {entry.routes.map((route, routeIndex) => (
            <Button
              key={route.url}
              label={`${routeIndex === 0 ? "✓ " : ""}${route.kind}: ${route.url}`}
              disabled={busy || status !== "ready"}
              onPress={() => chooseRoute(index, routeIndex)}
            />
          ))}
        </View>
      ))}
      {preview && (
        <Button
          label="Import ready environments"
          disabled={busy || !rows.some((row) => row.status === "ready")}
          onPress={() => void importSelected()}
        />
      )}
      <AppText accessibilityLiveRegion="polite">{message}</AppText>
    </View>
  );
}
