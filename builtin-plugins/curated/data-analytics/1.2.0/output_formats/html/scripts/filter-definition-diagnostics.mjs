/** Snapshot filter choices come from reviewed rows, not a separate options list. */
export function filterDefinitionDiagnostics(filters) {
  if (!Array.isArray(filters)) return [];
  return filters.flatMap((filter, index) => {
    if (!filter || typeof filter !== "object" || !Object.hasOwn(filter, "options")) return [];
    return [{
      code: "DATA_FILTER_OPTIONS_UNSUPPORTED",
      message: `Filter ${JSON.stringify(filter.id ?? index + 1)}: options is unsupported and would be ignored. Choices come from the filter field in its queryIds (or all queries). To include a category with no fact rows, add a separate reviewed dimension query and include it in queryIds; do not invent zero-valued facts. See docs/components/controls/filtering.md.`,
    }];
  });
}
