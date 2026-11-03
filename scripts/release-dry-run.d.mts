export function packablePackageDirs(repo: string): string[];
export function pagesBuildError(repo: string): string | null;
export function releaseDryRun(repo: string, dest: string): { ok: boolean; errors: string[]; tarballs: string[] };
