// Regional Sites use asynchronous secret bindings; other Sites use strings.
// A present regional binding is authoritative, even when unavailable. Never
// fall back to a stale direct value or cache a setting across requests.
export async function readSitesRuntimeSetting(environment, key) {
  try {
    const bindingKey = `SECRET_${key}`;
    const value = environment && bindingKey in environment
      ? await environment[bindingKey]?.get()
      : environment?.[key];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
