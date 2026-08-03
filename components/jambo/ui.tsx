import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { JamboIcon, type JamboIconName } from '@/components/jambo/icons';
import { JamboFonts, JamboRadius, type JamboPalette } from '@/constants/jambo-theme';

export function IconButton({
  name,
  onPress,
  palette,
  size = 38,
  accessibilityLabel,
}: {
  name: JamboIconName;
  onPress: () => void;
  palette: JamboPalette;
  size?: number;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: JamboRadius.md,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        pressed && styles.pressed,
      ]}>
      <JamboIcon name={name} size={Math.round(size * 0.47)} color={palette.accentSoft} />
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  palette,
  icon,
  disabled,
  background,
  foreground,
  style,
}: {
  label: string;
  onPress: () => void;
  palette: JamboPalette;
  icon?: JamboIconName;
  disabled?: boolean;
  /** Sobrescreve o accent — usado apenas pelo botao do WhatsApp. */
  background?: string;
  foreground?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = background ?? palette.accent;
  const fg = foreground ?? palette.onAccent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: bg },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}>
      {icon ? <JamboIcon name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontFamily: JamboFonts.bodyBold, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

export function OutlineButton({
  label,
  onPress,
  palette,
  tone = 'accent',
  style,
}: {
  label: string;
  onPress: () => void;
  palette: JamboPalette;
  tone?: 'accent' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const border = tone === 'danger' ? '#FF8073' : palette.accent;
  const color = tone === 'danger' ? '#FFA79E' : palette.accentSoft;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.outline, { borderColor: border }, pressed && styles.pressed, style]}>
      <Text style={{ color, fontFamily: JamboFonts.bodyBold, fontSize: 14.5 }}>{label}</Text>
    </Pressable>
  );
}

export function StatusPill({
  label,
  tone,
  palette,
  icon,
}: {
  label: string;
  tone: 'success' | 'warning';
  palette: JamboPalette;
  icon?: JamboIconName;
}) {
  const background = tone === 'success' ? palette.successSurface : palette.warningSurface;
  const color = tone === 'success' ? palette.success : palette.warning;
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      {icon ? <JamboIcon name={icon} size={13} color={color} /> : null}
      <Text style={{ color, fontFamily: JamboFonts.bodyBold, fontSize: 11.5 }}>{label}</Text>
    </View>
  );
}

/** "512×512 · WebP · máx. 100 KB — o app resolve isso pra você" */
export function SpecChip({ palette, mono, children }: { palette: JamboPalette; mono: string; children: string }) {
  return (
    <View style={[styles.specChip, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={{ color: palette.leaf, fontFamily: JamboFonts.monoMedium, fontSize: 11.5 }}>{mono}</Text>
      <Text style={{ color: palette.textMuted, fontFamily: JamboFonts.body, fontSize: 12.5, flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  primary: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 18,
    borderRadius: JamboRadius.lg,
  },
  outline: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: JamboRadius.pill,
  },
  specChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderRadius: 14,
    borderWidth: 1,
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
});
