export type SandboxBackend = "iframe" | "webcontainer";

/**
 * The iframe is the default for single-file artifacts.
 * WebContainer is selected only when the caller asks for it and LEDRING_WEBCONTAINER=1.
 * Asking is not booting. {@link bootWebcontainer} still refuses to launch a container in this process.
 */
export function resolveSandboxBackend(requested?: SandboxBackend): SandboxBackend {
  if (requested === "webcontainer" && process.env.LEDRING_WEBCONTAINER === "1") return "webcontainer";
  return "iframe";
}

/** This build does not boot @webcontainer/api. Default CI must not set LEDRING_WEBCONTAINER. */
export function bootWebcontainer(): { booted: false; reason: string } {
  if (process.env.LEDRING_WEBCONTAINER !== "1") {
    return {
      booted: false,
      reason:
        "WebContainer boot is off. Set LEDRING_WEBCONTAINER=1 only on a page that sends Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.",
    };
  }
  return {
    booted: false,
    reason:
      "@webcontainer/api is not bundled. Install 1.6.x in a cross-origin-isolated page. This process does not boot a container, and default CI does not set LEDRING_WEBCONTAINER.",
  };
}
