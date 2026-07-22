import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Radius } from '@/constants/theme';
import { useResolvedScheme } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import type { AnnouncementStatus } from '@/types/database';

/**
 * Pastila de status (redesign 22 iul 2026): 12/700, padding 4×10, pill.
 * Verde = cere atenție/e viu (deschis), chihlimbar = în lucru, gri = încheiat.
 * Prefixele („●", „✓") vin din design — nu sunt în textele traduse.
 */
const PREFIX: Record<AnnouncementStatus, string> = {
  open: '● ',
  accepted: '● ',
  resolved: '✓ ',
  cancelled: '',
};

const AMBER = { light: { color: '#B45309', bg: '#FCEEDC' }, dark: { color: '#F0A954', bg: '#3A2A12' } };

export function StatusBadge({ status }: { status: AnnouncementStatus }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();

  const palette: Record<AnnouncementStatus, { color: string; bg: string }> = {
    open: { color: theme.successText, bg: theme.successBg },
    accepted: AMBER[scheme],
    resolved: { color: theme.textSecondary, bg: theme.neutralBg },
    cancelled: { color: theme.textTertiary, bg: theme.neutralBg },
  };
  const { color, bg } = palette[status];

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color }]} maxFontSizeMultiplier={1.2}>
        {PREFIX[status]}
        {t(`status.${status}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.badge,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
  },
});
