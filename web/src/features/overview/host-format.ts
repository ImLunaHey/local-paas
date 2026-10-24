export const gib = (n: number | null | undefined) =>
  n == null ? '—' : (n / 2 ** 30).toFixed(1) + ' GiB'
