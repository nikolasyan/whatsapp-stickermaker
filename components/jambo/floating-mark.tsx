import { useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

import { JamboMark } from '@/components/jambo/jambo-mark';

/**
 * "A fruta continua flutuando nos vazios" — usada no preview vazio, no card de
 * novo pacote e como marca d'agua. `slow` reproduz o jbFloatSlow do design.
 */
export function FloatingMark({
  size,
  body,
  leaf,
  slow = false,
  style,
}: {
  size: number;
  body: string;
  leaf?: string;
  slow?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const duration = slow ? 4500 : 2250;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(progress, { toValue: 0, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, slow]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, slow ? -7 : -12] });
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] });

  return (
    <Animated.View style={[style, { transform: slow ? [{ translateY }] : [{ translateY }, { rotate }] }]}>
      <JamboMark size={size} body={body} leaf={leaf} />
    </Animated.View>
  );
}
