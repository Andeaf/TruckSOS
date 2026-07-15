/**
 * Format unic pentru contorul bulinelor (Faza 14.10, fix audit bug 1): plafon la „9+".
 * Folosit ATÂT pe tabBarBadge CÂT ȘI pe cardurile individuale, ca cele două să nu mai
 * difere (înainte: tabBar necapat vs carduri „99+").
 */
export function formatBadge(count: number): string | number {
  return count > 9 ? '9+' : count;
}
