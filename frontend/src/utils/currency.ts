export function formatILS(amount: number): string {
  return `₪ ${amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatILSRounded(amount: number): string {
  return `₪ ${Math.round(amount).toLocaleString('he-IL')}`;
}
