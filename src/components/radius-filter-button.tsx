import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { RADIUS_FILTER_OPTIONS, useRadiusFilter } from '@/hooks/use-radius-filter';

/**
 * Butonul din header (feed + hartă) care deschide selectorul filtrului de rază
 * (PLAN_FAZA13.md §1.1). Același sheet cu bifă ca raza de notificări din Setări,
 * aceleași trepte. Cu filtrul activ, valoarea („50 km") apare lângă iconiță —
 * pe banda albastră nu putem semnala starea prin culoarea brand.
 */
export function RadiusFilterButton() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { radiusKm, setRadiusKm } = useRadiusFilter();
  const [sheetVisible, setSheetVisible] = useState(false);

  const actions: SheetAction[] = RADIUS_FILTER_OPTIONS.map((km) => ({
    label: km == null ? t('radiusFilter.off') : t('radiusFilter.km', { km }),
    icon: km === radiusKm ? 'check-circle' : 'radio-button-unchecked',
    onPress: () => setRadiusKm(km),
  }));

  return (
    <>
      <Pressable
        onPress={() => setSheetVisible(true)}
        hitSlop={12}
        accessibilityLabel={t('radiusFilter.title')}
        style={styles.button}>
        <MaterialIcons name="filter-alt" size={22} color={theme.onHeader} />
        {radiusKm != null ? (
          <Text style={[styles.value, { color: theme.onHeader }]}>
            {t('radiusFilter.km', { km: radiusKm })}
          </Text>
        ) : null}
      </Pressable>

      <ActionSheet
        visible={sheetVisible}
        title={t('radiusFilter.title')}
        actions={actions}
        onClose={() => setSheetVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  value: { fontSize: 13, fontWeight: '600' },
});
