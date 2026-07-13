import { Colors } from '@/constants/theme';
import { useResolvedScheme } from '@/hooks/use-settings';

/**
 * Culorile temei active. Schema vine din preferința utilizatorului (SettingsProvider),
 * care pe `auto` urmează sistemul — vezi `hooks/use-settings.tsx`.
 */
export function useTheme() {
  return Colors[useResolvedScheme()];
}
