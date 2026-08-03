import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Xadrez que representa transparencia, em tons de jambo (nunca cinza neutro).
 * Substitui o `repeating-conic-gradient` do design, que nao existe no React Native.
 */
export function Checker({
  cell = 24,
  light,
  dark,
  style,
  children,
}: {
  cell?: number;
  light: string;
  dark: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    // Evita re-render em variacoes subpixel de layout.
    if (Math.abs(width - size.width) > 1 || Math.abs(height - size.height) > 1) {
      setSize({ width, height });
    }
  }

  const columns = Math.ceil(size.width / cell);
  const rows = Math.ceil(size.height / cell);

  return (
    <View style={[styles.container, style]} onLayout={handleLayout}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {Array.from({ length: rows }, (_, row) => (
          <View key={row} style={styles.row}>
            {Array.from({ length: columns }, (_, column) => (
              <View
                key={column}
                style={{
                  width: cell,
                  height: cell,
                  backgroundColor: (row + column) % 2 === 0 ? light : dark,
                }}
              />
            ))}
          </View>
        ))}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  row: { flexDirection: 'row' },
});
