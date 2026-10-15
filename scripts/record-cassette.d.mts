export function cassetteFromResponse(response: unknown): {
  error?: string;
  cassette?: {
    id: string;
    idea: string;
    provenance: { kind: "recorded"; note: string; model: string; recordedAt: string };
    artifacts: { html: string }[];
  };
};
