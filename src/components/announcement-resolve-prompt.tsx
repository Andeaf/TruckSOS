import { Pressable, StyleSheet, Text, View, type PressableStateCallbackType } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

export interface AnnouncementResolvePromptProps {
  /** „Marchează ca rezolvat". */
  onResolve: () => void;
  /** „Încă nu" și X-ul din colț: aceeași acțiune (amânare 24h). */
  onNotNow: () => void;
  /**
   * „Anulează anunțul". Absent pe anunțurile `accepted` (mecanic asignat): nicăieri
   * în app nu se anulează un anunț acceptat — RLS permite `cancelled` doar din `open`.
   */
  onCancel?: () => void;
  /** O acțiune e în curs pe acest anunț: butoanele se dezactivează (fără spinner — caseta rămâne scundă). */
  busy?: boolean;
}

/** react-native-web trimite și `hovered` în callback-ul de stil; tipurile RN declară doar `pressed`. */
type PressState = PressableStateCallbackType & { hovered?: boolean };
const isActive = (s: PressState) => s.pressed || s.hovered === true;

const AMBER = '#b97b0e';

/**
 * Caseta „Și-a găsit anunțul rezolvarea?" (design 12c, 4 sept 2026): randată ÎN
 * card, sub metadate, pe anunțurile neatinse de 12h+. Culorile sunt fixe (cremă /
 * chihlimbar / verde din design, nu din temă) — la fel ca badge-ul „mecanici
 * interesați": e un element de atenționare, nu o suprafață a temei.
 * Iconițe: Feather `help-circle` / `x` — contururile din design; grosimea liniei
 * e cea a fontului (2), nu 2.2 / 2.4 ca în CSS.
 */
export function AnnouncementResolvePrompt({
  onResolve,
  onNotNow,
  onCancel,
  busy = false,
}: AnnouncementResolvePromptProps) {
  const { t } = useTranslation();
  const notNowLabel = t('driver.announcements.resolvePromptNotNow');

  return (
    <View style={[styles.box, busy && styles.busy]}>
      <View style={styles.titleRow}>
        <Feather name="help-circle" size={16} color={AMBER} />
        <Text style={styles.title} maxFontSizeMultiplier={1.2}>
          {t('driver.announcements.resolvePromptTitle')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={notNowLabel}
          disabled={busy}
          onPress={onNotNow}
          hitSlop={4}
          style={(s: PressState) => [styles.close, isActive(s) && styles.closeActive]}>
          <Feather name="x" size={14} color={AMBER} />
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onNotNow}
          style={(s: PressState) => [styles.notNow, isActive(s) && styles.notNowActive]}>
          <Text style={styles.notNowText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {notNowLabel}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onResolve}
          style={(s: PressState) => [styles.resolve, isActive(s) && styles.resolveActive]}>
          <Text style={styles.resolveText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {t('driver.announcements.resolveButton')}
          </Text>
        </Pressable>
      </View>

      {onCancel ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onCancel}
          hitSlop={6}
          style={styles.cancel}>
          {(s: PressState) => (
            <Text
              style={[styles.cancelText, isActive(s) && styles.cancelTextActive]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}>
              {t('driver.announcements.cancelButton')}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Valorile exacte din design (12c). marginTop 6 + gap-ul de 6 al cardului = cei 12px.
  box: {
    marginTop: 6,
    backgroundColor: '#fff8ec',
    borderWidth: 1,
    borderColor: '#f3ddb0',
    borderRadius: 12,
    paddingTop: 8,
    paddingRight: 12,
    paddingBottom: 8,
    paddingLeft: 14,
  },
  busy: { opacity: 0.6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '700', color: '#7a5408' },
  close: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeActive: { backgroundColor: 'rgba(185,123,14,0.12)' },
  // „Încă nu" stânga (flex 2), verdele dreapta (flex 3); înălțimile se egalează
  // prin stretch-ul implicit al rândului (verdele n-are border, albul are 1px).
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  notNow: {
    flex: 2,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0d4bb',
    borderRadius: 11,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notNowActive: { backgroundColor: '#f6efe0', borderColor: '#d4c5a5' },
  notNowText: { fontSize: 13, fontWeight: '700', color: '#1c2635', textAlign: 'center' },
  resolve: {
    flex: 3,
    backgroundColor: '#1c7c3c',
    borderRadius: 11,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resolveActive: { backgroundColor: '#166a33' },
  resolveText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 16,
  },
  cancel: { marginTop: 8, alignSelf: 'center' },
  cancelText: { fontSize: 13, fontWeight: '700', color: '#c33d3d', textAlign: 'center' },
  cancelTextActive: { color: '#a63232' },
});
