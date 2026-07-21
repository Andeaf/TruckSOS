import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { RADIUS_FILTER_STANDARD, useRadiusFilter } from '@/hooks/use-radius-filter';

/**
 * Selectorul filtrului de rază din header (feed + hartă) — un dropdown ancorat sub
 * declanșator, cu trepte standard, „Fără filtru" și o opțiune „Personalizat" (input
 * numeric liber). Valoarea personalizată se persistă ca orice altă rază
 * (`saveRadiusPref` stochează orice număr) → e la fel de stabilă ca treptele fixe.
 *
 * Expune `open()` prin ref: harta îl cheamă când mecanicul apasă „Anunțuri în rază"
 * fără să fi ales o rază — dropdown-ul se deschide ancorat la butonul din header.
 */

type Anchor = { top: number; right: number };

export type RadiusFilterMenuHandle = { open: () => void };

export const RadiusFilterMenu = forwardRef<RadiusFilterMenuHandle>(function RadiusFilterMenu(
  _props,
  ref
) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { radiusKm, setRadiusKm } = useRadiusFilter();
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');

  const isCustom = radiusKm != null && !RADIUS_FILTER_STANDARD.includes(radiusKm);

  function open() {
    // Măsurăm declanșatorul în coordonate de fereastră ca să ancorăm cardul exact
    // sub el — funcționează identic pe feed și hartă (butonul e în același colț).
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      const screenW = Dimensions.get('window').width;
      setCustomMode(isCustom);
      setCustomText(isCustom && radiusKm != null ? String(radiusKm) : '');
      setAnchor({ top: y + height + Spacing.one, right: screenW - (x + width) });
    });
  }

  function close() {
    setAnchor(null);
    setCustomMode(false);
  }

  function choose(km: number | null) {
    setRadiusKm(km);
    close();
  }

  function applyCustom() {
    const km = Math.round(Number(customText));
    if (Number.isFinite(km) && km > 0) {
      setRadiusKm(km);
      close();
    }
  }

  // Fără deps: `open` citește starea curentă prin closure, deci handle-ul trebuie
  // să rămână proaspăt la fiecare randare.
  useImperativeHandle(ref, () => ({ open }));

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={open}
        hitSlop={12}
        accessibilityLabel={t('radiusFilter.title')}
        style={styles.trigger}>
        {/* maxFontSizeMultiplier: aliniat cu textele din ScreenHeader (max 1.2x), altfel
            la fonturi de sistem mari trigger-ul creștea disproporționat față de titlu. */}
        <Text style={[styles.label, { color: theme.onHeader }]} maxFontSizeMultiplier={1.2}>
          {t('radiusFilter.button')}
        </Text>
        {radiusKm != null ? (
          <Text style={[styles.value, { color: theme.onHeader }]} maxFontSizeMultiplier={1.2}>
            {t('radiusFilter.km', { km: radiusKm })}
          </Text>
        ) : null}
        <MaterialIcons name="arrow-drop-down" size={20} color={theme.onHeader} />
      </Pressable>

      <Modal
        visible={anchor != null}
        transparent
        animationType="fade"
        onRequestClose={close}
        statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={close} />
        {anchor ? (
          <View
            style={[
              styles.menu,
              { backgroundColor: theme.backgroundElement, top: anchor.top, right: anchor.right },
            ]}>
            {customMode ? (
              <View style={styles.customBox}>
                <ThemedText themeColor="textSecondary" type="small">
                  {t('radiusFilter.customLabel')}
                </ThemedText>
                <View style={styles.customRow}>
                  <TextInput
                    value={customText}
                    onChangeText={(v) => setCustomText(v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    autoFocus
                    placeholder={t('radiusFilter.customPlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    style={[
                      styles.input,
                      { color: theme.text, borderColor: theme.backgroundSelected },
                    ]}
                    maxLength={4}
                    returnKeyType="done"
                    onSubmitEditing={applyCustom}
                  />
                  <ThemedText themeColor="textSecondary" type="small">
                    km
                  </ThemedText>
                  <Pressable
                    onPress={applyCustom}
                    hitSlop={8}
                    accessibilityLabel={t('radiusFilter.apply')}
                    style={[styles.apply, { backgroundColor: theme.brand }]}>
                    <MaterialIcons name="check" size={20} color="#fff" />
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                {RADIUS_FILTER_STANDARD.map((km) => (
                  <MenuRow
                    key={km}
                    label={t('radiusFilter.km', { km })}
                    selected={radiusKm === km}
                    onPress={() => choose(km)}
                  />
                ))}
                <MenuRow
                  label={t('radiusFilter.off')}
                  selected={radiusKm == null}
                  onPress={() => choose(null)}
                />
                <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
                <MenuRow
                  label={
                    isCustom && radiusKm != null
                      ? t('radiusFilter.km', { km: radiusKm })
                      : t('radiusFilter.custom')
                  }
                  selected={isCustom}
                  onPress={() => {
                    setCustomText(isCustom && radiusKm != null ? String(radiusKm) : '');
                    setCustomMode(true);
                  }}
                />
              </>
            )}
          </View>
        ) : null}
      </Modal>
    </>
  );
});

function MenuRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}>
      <ThemedText style={styles.rowLabel}>{label}</ThemedText>
      {selected ? <MaterialIcons name="check" size={18} color={theme.brand} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  label: { fontSize: 15, fontWeight: '600' },
  value: { fontSize: 13, fontWeight: '600', opacity: 0.9 },
  backdrop: { ...StyleSheet.absoluteFillObject },
  menu: {
    position: 'absolute',
    width: 220,
    borderRadius: Radius.card,
    paddingVertical: Spacing.one,
    ...Platform.select({
      android: { elevation: 8 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
    }),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  rowLabel: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.one },
  customBox: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  apply: {
    width: 36,
    height: 36,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
