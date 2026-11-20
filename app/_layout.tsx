import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
// Import por peso, e nao pela raiz do pacote: a raiz arrasta os ~9 pesos de cada
// familia para o bundle, mesmo os que o app nunca usa.
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { NunitoSans_400Regular } from '@expo-google-fonts/nunito-sans/400Regular';
import { NunitoSans_600SemiBold } from '@expo-google-fonts/nunito-sans/600SemiBold';
import { NunitoSans_700Bold } from '@expo-google-fonts/nunito-sans/700Bold';
import { Outfit_700Bold } from '@expo-google-fonts/outfit/700Bold';
import { Outfit_800ExtraBold } from '@expo-google-fonts/outfit/800ExtraBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useJamboTheme } from '@/hooks/use-jambo-theme';
import { clearTransientCache } from '@/lib/stickers';

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync().catch(() => {
  // A splash ja pode ter sido escondida num reload de desenvolvimento.
});

export default function RootLayout() {
  const { palette, scheme } = useJamboTheme();
  const [fontsLoaded, fontError] = useFonts({
    Outfit_700Bold,
    Outfit_800ExtraBold,
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
    NunitoSans_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  useEffect(() => {
    // Some com a splash tambem em caso de erro, senao o app trava numa tela branca.
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    // Uma vez por abertura: e o unico momento garantido em que nenhum
    // intermediario de imagem esta em uso. E sincrono, mas sao duas pastas e
    // uma listagem — se algum dia pesar, da para mover para um worklet.
    clearTransientCache();
  }, []);

  if (!fontsLoaded && !fontError) return null;

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme: Theme = {
    ...base,
    colors: {
      ...base.colors,
      background: palette.bg,
      card: palette.surface,
      border: palette.border,
      text: palette.text,
      primary: palette.accent,
    },
  };

  return (
    <ThemeProvider value={navigationTheme}>
      <Stack screenOptions={{ contentStyle: { backgroundColor: palette.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="editor" options={{ headerShown: false }} />
        <Stack.Screen name="pack/[id]" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}
