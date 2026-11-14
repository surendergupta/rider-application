/** Parse a user-typed rupee amount ("1,245.50") into integer paise. Returns null if invalid. */
export function rupeesToPaise(input: FormDataEntryValue | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).replace(/[,\s₹]/g, "");
  if (s === "" || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [r, p = ""] = s.split(".");
  return Number(r) * 100 + Number(p.padEnd(2, "0"));
}
