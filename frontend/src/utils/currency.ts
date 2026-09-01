export function formatILS(amount: number): string {
  return `₪ ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatILSRounded(amount: number): string {
  return `₪ ${Math.round(amount).toLocaleString("en-US")}`;
}
