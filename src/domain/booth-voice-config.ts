export function getBoothVoiceEnabled(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return true;
  const value = (config as Record<string, unknown>).voiceEnabled;
  return typeof value === "boolean" ? value : true;
}

export function mergeBoothVoiceConfig(config: unknown, voiceEnabled: boolean) {
  const current = config && typeof config === "object" && !Array.isArray(config)
    ? config as Record<string, unknown>
    : {};
  return { ...current, voiceEnabled };
}
