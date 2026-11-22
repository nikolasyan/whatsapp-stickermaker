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
import { JamboFonts, JamboRadius, type JamboPalette } from '@/constants/jambo-theme';
import { useJamboTheme } from '@/hooks/use-jambo-theme';
import { MAX_STICKERS } from '@/lib/packs';
import { setQueue, type QueuedImage } from '@/lib/sticker-queue';

/**
 * Reconhece GIF por tipo MIME, com o nome do arquivo e a extensao do URI como
 * reserva: `mimeType` e opcional no retorno do picker e alguns fabricantes nao
 * o preenchem.
 */
function isGif(asset: { mimeType?: string; fileName?: string | null; uri: string }): boolean {
  if (asset.mimeType) return asset.mimeType === 'image/gif';
  const name = (asset.fileName ?? asset.uri).toLowerCase();
  return name.endsWith('.gif');
}

export default function CreateScreen() {
  const router = useRouter();
  const { palette, scheme } = useJamboTheme();
  // O preview e quadrado, mas titulo e subtitulo quebram em telas estreitas.
  // Medir o espaco livre evita que ele empurre o rodape para fora da tela.
  const [previewSize, setPreviewSize] = useState(0);
  const [animated, setAnimated] = useState(false);

  function measurePreview(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    const next = Math.floor(Math.min(width, height));
    if (Math.abs(next - previewSize) > 1) setPreviewSize(next);
  }

  /**
   * Entrega a fila ao editor. Nao converte nada aqui: o stageSourceImage
   * (reencodar para PNG) existe apenas porque o recortador nativo nao abre
   * WebP, entao ele roda no editor, so quando o recorte e aberto de verdade.
   * Com 12 fotos escolhidas, converter todas na entrada seriam 12 conversoes
   * de vários MB — a maioria jogada fora sem ninguem usar.
   */
  function openEditor(images: QueuedImage[], animated: boolean) {
    if (images.length === 0) return;
    setQueue(images, animated);
    router.push('/editor');
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
      allowsMultipleSelection: true,
      // Teto do pacote: escolher mais que isso nao teria onde caber.
      selectionLimit: MAX_STICKERS,
      // `quality: 1` nao e so "qualidade maxima": no Android ele faz o
      // expo-image-picker usar o RawImageExporter, que COPIA os bytes em vez de
      // reencodar. E isso que preserva a animacao de um GIF — com qualquer
      // outro valor o picker achataria num frame so antes do nosso encoder ver
      // o arquivo. Nao baixe este valor.
      quality: 1,
    });
    if (result.canceled) return;

    const images = result.assets.map((asset) => ({
      sourceUri: asset.uri,
      width: asset.width,
      height: asset.height,
    }));

    if (!animated) {
      openEditor(images, false);
      return;
    }

    // O seletor do sistema nao filtra por GIF de forma confiavel entre
    // fabricantes, entao a checagem e nossa: sem ela um JPEG entraria no
    // caminho animado e o decodificador de GIF falharia com erro obscuro.
    const gifs = result.assets.filter((asset) => isGif(asset));
    if (gifs.length === 0) {
      Alert.alert(
        'Nenhum GIF selecionado',
        'Figurinha animada precisa de um GIF. Para imagem comum, troque para "Imagem" acima.',
      );
      return;
    }
    if (gifs.length < result.assets.length) {
      Alert.alert(
        'Algumas não são GIF',
        `${result.assets.length - gifs.length} das imagens escolhidas não são GIF e ficaram de fora.`,
      );
    }
    openEditor(
      gifs.map((asset) => ({ sourceUri: asset.uri, width: asset.width, height: asset.height })),
      true,
    );
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permissão necessária', 'Permita o acesso à câmera para tirar uma foto.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = result.canceled ? null : result.assets[0];
    // A camera sempre produz imagem estatica, independente do modo escolhido.
    if (asset?.uri) openEditor([{ sourceUri: asset.uri, width: asset.width, height: asset.height }], false);
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
      </View>

      <View style={styles.titleBlock}>
        <Text style={[styles.title, { color: palette.text }]}>
          {animated ? 'Figurinha animada' : 'Preview da sua imagem'}
        </Text>
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
          {animated
            ? 'Escolha um GIF da galeria. Ele vira uma animação de até 10 segundos.'
            : 'Escolha uma ou várias fotos, ou tire uma na hora. Recorte depois.'}
        </Text>
      </View>

      <View style={[styles.switcher, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <KindTab label="Imagem" active={!animated} palette={palette} onPress={() => setAnimated(false)} />
        <KindTab label="Animada" active={animated} palette={palette} onPress={() => setAnimated(true)} />
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
          <JamboIcon name={animated ? 'frame' : 'camera'} size={19} color={palette.onAccent} />
          <Text style={[styles.galleryLabel, { color: palette.onAccent }]}>
            {animated ? 'Escolher GIF' : 'Galeria'}
          </Text>
        </Pressable>
        {/* Sem camera no modo animado: nao se tira um GIF. */}
        {animated ? null : (
          <IconButton name="cameraAlt" size={56} palette={palette} accessibilityLabel="Tirar foto" onPress={takePhoto} />
        )}
      </View>

      <View style={styles.specWrap}>
        <SpecChip palette={palette} mono="512×512">
          {animated
            ? ' · WebP animado · máx. 500 KB · até 10 s'
            : ' · WebP · máx. 100 KB — o app resolve isso pra você'}
        </SpecChip>
      </View>
    </SafeAreaView>
  );
}

function KindTab({
  label,
  active,
  palette,
  onPress,
}: {
  label: string;
  active: boolean;
  palette: JamboPalette;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.kindTab,
        active && { backgroundColor: palette.accentMuted },
        pressed && styles.pressed,
      ]}>
      <Text
        style={{
          color: active ? palette.accentSoft : palette.textMuted,
          fontFamily: active ? JamboFonts.bodyBold : JamboFonts.bodySemi,
          fontSize: 14,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  switcher: {
    flexDirection: 'row',
    marginHorizontal: 24,
    padding: 4,
    gap: 4,
    borderRadius: JamboRadius.md,
    borderWidth: 1,
  },
  kindTab: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: JamboRadius.sm },
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
