export const isLocalSource = source => typeof source === 'string' && /^local:\/\/[0-9a-f-]{36}\//.test(source);

export function localSourcePath(source) {
  return isLocalSource(source) ? source.slice(source.indexOf('/', 'local://'.length) + 1) : source;
}
