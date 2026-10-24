/** ABI parity ignores compiler-specific internalType metadata and item order. */
export function canonical(abi: readonly unknown[]) {
  const clean = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(clean)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => key !== "internalType")
              .map(([key, v]) => [key, clean(v)]),
          )
        : value;
  return abi
    .map(clean)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
