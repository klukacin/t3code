import {
  createAuthEnvironmentAtoms,
  createEnvironmentTransferImportCommand,
} from "@t3tools/client-runtime/state/auth";
import { connectionAtomRuntime } from "../connection/runtime";
export const transferAuth = createAuthEnvironmentAtoms(connectionAtomRuntime);
export const importTransfer = createEnvironmentTransferImportCommand(connectionAtomRuntime);
