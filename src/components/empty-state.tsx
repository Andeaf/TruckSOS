import { StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface EmptyStateProps {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  description?: string;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <MaterialIcons name={icon} size={56} color={theme.textSecondary} />
      <ThemedText type="subtitle" style={styles.title}>
        {title}
      </ThemedText>
      {description ? (
        <ThemedText themeColor="textSecondary" style={styles.description}>
          {description}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.five,
  },
  title: {
    fontSize: 22,
    lineHeight: 30,
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    lineHeight: 22,
  },
});
