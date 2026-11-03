export const BETA_VERSION: string;
export function publishedManifestErrors(manifest: Record<string, unknown>): string[];
export function ledringManifestErrors(manifest: Record<string, unknown>): string[];
export function ledringPackageManifest(version: string): Record<string, unknown>;
export function stageLedring(repo: string, dest: string): Promise<Record<string, unknown>>;
export function smokeLedring(stage: string, repo: string): string[];
export function packLedring(stage: string, destDir: string): string;
