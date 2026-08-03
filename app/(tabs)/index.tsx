import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Checker } from '@/components/jambo/checker';
import { FloatingMark } from '@/components/jambo/floating-mark';
import { JamboIcon } from '@/components/jambo/icons';
import { JamboMark } from '@/components/jambo/jambo-mark';
import { IconButton, SpecChip } from '@/components/jambo/ui';
import { JamboFonts, JamboRadius } from '@/constants/jambo-theme';
import { useJamboTheme } from '@/hooks/use-jambo-theme';
import { stageSourceImage } from '@/lib/stickers';

export default function CreateScreen() {
  const router = useRouter();
  const { palette, scheme } = useJamboTheme();
  // O preview e quadrado, mas titulo e subtitulo quebram em telas estreitas.
  // Medir o espaco livre evita que ele empurre o rodape para fora da tela.
  const [previewSize, setPreviewSize] = useState(0);

  function measurePreview(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    const next = Math.floor(Math.min(width, height));
    if (Math.abs(next - previewSize) > 1) setPreviewSize(next);
  }

  async function openEditor(uri: string, width: number, height: number) {
    // Converte para PNG antes de entrar no editor: o recortador nativo nao abre WebP.
    const staged = await stageSourceImage(uri);
    router.push({ pathname: '/editor', params: { uri: staged, width: String(width), height: String(height) } });
  }

  async function pickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permissão necessária', 'Permita o acesso às suas fotos para escolher uma imagem.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: false,
      quality: 1,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (asset?.uri) await openEditor(asset.uri, asset.width, asset.height);
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permissão necessária', 'Permita o acesso à câmera para tirar uma foto.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = result.canceled ? null : result.assets[0];
    if (asset?.uri) await openEditor(asset.uri, asset.width, asset.height);
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.bg }]}>
      <View pointerEvents="none" style={styles.watermark}>
        <FloatingMark
          size={230}
          slow
          body={scheme === 'dark' ? '#1A0A10' : '#FFF0F0'}
          leaf={scheme === 'dark' ? '#12291D' : '#EAF3ED'}
        />
      </View>

      <View style={styles.header}>
        <View style={styles.brand}>
          <JamboMark size={24} body={palette.accent} leaf={palette.leaf} />
          <View style={styles.brandText}>
            <Text style={[styles.wordmark, { color: palette.text }]}>Jambo</Text>
            <Text style={[styles.tagline, { color: palette.textMuted }]}>STICKER MAKER</Text>
          </View>
        </View>
        <IconButton
          name="gear"
          size={36}
          palette={palette}
          accessibilityLabel="Ajustes"
          onPress={() => router.push('/modal')}
        />
      </View>

      <View style={styles.titleBlock}>
        <Text style={[styles.title, { color: palette.text }]}>Preview da sua imagem</Text>
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
          Escolha uma foto ou tire uma na hora. Recorte depois.
        </Text>
      </View>

      <View style={styles.previewWrap} onLayout={measurePreview}>
        {previewSize > 0 ? (
          <Checker
            cell={26}
            light={palette.checkerLight}
            dark={palette.checkerDark}
            style={[styles.preview, { width: previewSize, height: previewSize, borderColor: palette.borderDashed }]}>
            <View style={styles.previewInner}>
              <FloatingMark size={86} body={palette.accent} leaf={palette.leaf} />
              <Text style={[styles.previewHint, { color: palette.textMuted }]}>Seu preview aparecerá aqui</Text>
            </View>
          </Checker>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={pickFromLibrary}
          accessibilityRole="button"
          style={({ pressed }) => [styles.galleryButton, { backgroundColor: palette.accent }, pressed && styles.pressed]}>
          <JamboIcon name="camera" size={19} color={palette.onAccent} />
          <Text style={[styles.galleryLabel, { color: palette.onAccent }]}>Galeria</Text>
        </Pressable>
        <IconButton name="cameraAlt" size={56} palette={palette} accessibilityLabel="Tirar foto" onPress={takePhoto} />
      </View>

      <View style={styles.specWrap}>
        <SpecChip palette={palette} mono="512×512">
          · WebP · máx. 100 KB — o app resolve isso pra você
        </SpecChip>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  watermark: { position: 'absolute', top: -60, right: -70, opacity: 0.35 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 4,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandText: { gap: 1 },
  wordmark: { fontFamily: JamboFonts.display, fontSize: 19, letterSpacing: -0.6 },
  tagline: { fontFamily: JamboFonts.bodySemi, fontSize: 8.5, letterSpacing: 1.3 },
  titleBlock: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 18, gap: 6 },
  title: { fontFamily: JamboFonts.display, fontSize: 34, lineHeight: 37, letterSpacing: -1.2 },
  subtitle: { fontFamily: JamboFonts.body, fontSize: 14.5, lineHeight: 21 },
  previewWrap: { flex: 1, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  preview: { borderRadius: JamboRadius.xxl, borderWidth: 1.5, borderStyle: 'dashed' },
  previewInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  previewHint: { fontFamily: JamboFonts.body, fontSize: 13.5, textAlign: 'center', maxWidth: 190 },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 24, paddingTop: 18 },
  galleryButton: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: JamboRadius.lg,
  },
  galleryLabel: { fontFamily: JamboFonts.bodyBold, fontSize: 16 },
  specWrap: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12 },
  pressed: { opacity: 0.75 },
});
