import type { ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';

interface IconButtonProps {
  /** Eticheta citită de cititorul de ecran (obligatorie: butonul nu are text). */
  label: string;
  onPress?: PressableProps['onPress'];
  /** Iconița (de regulă <MaterialIcons />); butonul nu adaugă fundal sau padding. */
  icon: ReactNode;
  hitSlop?: PressableProps['hitSlop'];
  disabled?: boolean;
  selected?: boolean;
  style?: PressableProps['style'];
  testID?: string;
}

/**
 * Buton doar cu iconiță, accesibil: `label` devine `accessibilityLabel`.
 * Fără stil propriu — aspectul vine din `style` și din iconița primită.
 */
export function IconButton({
  label,
  onPress,
  icon,
  hitSlop = 12,
  disabled,
  selected,
  style,
  testID,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={hitSlop}
      disabled={disabled}
      style={style}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: selected ?? false }}>
      {icon}
    </Pressable>
  );
}
