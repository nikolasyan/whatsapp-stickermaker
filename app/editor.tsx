import { useLocalSearchParams, useRouter } from 'expo-router';
import ImageCropPicker from 'react-native-image-crop-picker';
import { useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Checker } from '@/components/jambo/checker';
import { JamboIcon } from '@/components/jambo/icons';
import { JamboMark } from '@/components/jambo/jambo-mark';
import { IconButton, PrimaryButton } from '@/components/jambo/ui';
import { JamboFonts, JamboRadius, type JamboPalette } from '@/constants/jambo-theme';
import { useJamboTheme } from '@/hooks/use-jambo-theme';
import { MAX_STICKERS, loadPacks, mutatePacks, type Pack, type Sticker } from '@/lib/packs';
import { buildSticker } from '@/lib/stickers';

type Mode = 'crop' | 'original';

export default function EditorScreen() {
  const router = useRouter();
  const { palette } = useJamboTheme();
  const params = useLocalSearchParams<{ uri: string; width: string; height: string }>();

  const sourceUri = params.uri;
  const [croppedUri, setCroppedUri] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('original');
  const [saveSheetVisible, setSaveSheetVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [newName, setNewName] = useState('');
  const [newAuthor, setNewAuthor] = useState('');
  const [busy, setBusy] = useState(false);

  const displayedUri = mode === 'crop' && croppedUri ? croppedUri : sourceUri;

  function cropperOptions(path: string) {
    return {
      path,
      mediaType: 'photo' as const,
      cropping: true,
      width: 512,
      height: 512,
      compressImageMaxWidth: 512,
      compressImageMaxHeight: 512,
      compressImageQuality: 0.9,
      showCropFrame: true,
      showCropGuidelines: true,
      avoidEmptySpaceAroundImage: true,
      cropperToolbarTitle: 'Recortar figurinha',
      cropperChooseText: 'Confirmar',
      cropperCancelText: 'Cancelar',
    };
  }

  async function openCropper() {
    try {
      console.log('[editor] abrindo recortador para', sourceUri);
      const result = await ImageCropPicker.openCropper(cropperOptions(sourceUri));
      console.log('[editor] recorte devolvido', result.path, result.width, 'x', result.height);
      // O <Image> do preview so carrega com esquema; o recortador pode devolver caminho puro.
      setCroppedUri(result.path.startsWith('file://') ? result.path : `file://${result.path}`);
      setMode('crop');
    } catch (error) {
      // Cancelar o editor nativo tambem rejeita a Promise — so isso e silencioso.
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
      if (code === 'E_PICKER_CANCELLED') return;
      console.warn('[editor] openCropper falhou', code, error);
      Alert.alert(
        'Não foi possível recortar',
        error instanceof Error && error.message ? error.message : 'O editor de recorte não abriu.',
      );
    }
  }

  async function openSaveSheet() {
    try {
      setPacks(await loadPacks());
      setSaveSheetVisible(true);
    } catch {
      Alert.alert('Não foi possível carregar', 'Tente prosseguir novamente.');
    }
  }

  async function makeSticker(): Promise<Sticker> {
    const stickerId = `${Date.now()}-sticker`;
    // displayedUri e o recorte escolhido (modo crop) ou a imagem inteira (modo original).
    const built = await buildSticker(displayedUri, stickerId);
    return {
      id: stickerId,
      originalUri: sourceUri,
      processedUri: built.uri,
      mode,
      format: 'webp',
      width: built.width,
      height: built.height,
    };
  }

  async function addToPack(pack: Pack) {
    if (busy) return;
    setBusy(true);
    try {
      const sticker = await makeSticker();
      await mutatePacks((current) =>
        current.map((item) => (item.id === pack.id ? { ...item, stickers: [...item.stickers, sticker] } : item)),
      );
      setSaveSheetVisible(false);
      router.replace({ pathname: '/pack/[id]', params: { id: pack.id } });
    } catch {
      Alert.alert('Não foi possível salvar', 'Tente adicionar a figurinha novamente.');
    } finally {
      setBusy(false);
    }
  }

  async function createPack() {
    if (busy) return;
    const name = newName.trim();
    const author = newAuthor.trim();
    if (!name || !author) {
      Alert.alert('Preencha os dados', 'Informe o nome do pacote e o autor.');
      return;
    }
    setBusy(true);
    try {
      const sticker = await makeSticker();
      const pack: Pack = {
        id: `${Date.now()}-pack`,
        name,
        author,
        // O URI persistido da figurinha sobrevive a limpeza de cache; o do preview nao.
        iconUri: sticker.processedUri,
        stickers: [sticker],
      };
      await mutatePacks((current) => [...current, pack]);
      setCreateVisible(false);
      setSaveSheetVisible(false);
      router.replace({ pathname: '/pack/[id]', params: { id: pack.id } });
    } catch {
      Alert.alert('Não foi possível salvar', 'Tente criar o pacote novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: palette.bg }]}>
      <View style={styles.header}>
        <IconButton name="back" palette={palette} accessibilityLabel="Voltar" onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: palette.textSecondary }]}>Editar figurinha</Text>
        <Pressable
          onPress={openSaveSheet}
          accessibilityRole="button"
          style={({ pressed }) => [styles.headerCta, { backgroundColor: palette.accent }, pressed && styles.pressed]}>
          <Text style={{ color: palette.onAccent, fontFamily: JamboFonts.bodyBold, fontSize: 14 }}>Prosseguir</Text>
        </Pressable>
      </View>

      <View style={styles.canvasWrap}>
        <Checker
          cell={24}
          light={palette.checkerLight}
          dark={palette.checkerDark}
          style={[styles.canvas, { borderColor: palette.border }]}>
          {/* `contain` nos dois modos porque o arquivo final e sempre a imagem centralizada
              num quadrado transparente. Usar `cover` aqui mostrava um enquadramento
              (ampliado, cortado) que o arquivo gerado nao tinha. */}
          <View style={styles.imageArea}>
            <Image source={{ uri: displayedUri }} style={styles.canvasImage} resizeMode="contain" />
          </View>
          <View style={[styles.dimensionBadge, { backgroundColor: palette.bg }]}>
            <Text style={{ color: palette.leaf, fontFamily: JamboFonts.monoMedium, fontSize: 10.5 }}>512 × 512</Text>
          </View>
        </Checker>
      </View>

      <View style={styles.tools}>
        <ToolTab
          palette={palette}
          icon="crop"
          label="Recortar"
          active={mode === 'crop'}
          onPress={openCropper}
        />
        <ToolTab
          palette={palette}
          icon="square"
          label="Original"
          active={mode === 'original'}
          onPress={() => setMode('original')}
        />
      </View>

      <View style={styles.spacer} />

      <View style={styles.footer}>
        <View style={styles.statusRow}>
          <JamboIcon name="check" size={15} color={palette.leaf} />
          <Text style={{ color: palette.leaf, fontFamily: JamboFonts.monoMedium, fontSize: 12 }}>
            webp · comprimido até caber em 100 KB
          </Text>
        </View>
        <View style={styles.footerButtons}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.outlineButton, { borderColor: palette.accent }, pressed && styles.pressed]}>
            <Text style={{ color: palette.accentSoft, fontFamily: JamboFonts.bodyBold, fontSize: 15 }}>Outra imagem</Text>
          </Pressable>
          <PrimaryButton label="Prosseguir" palette={palette} onPress={openSaveSheet} style={styles.grow} />
        </View>
      </View>

      <SaveSheet
        visible={saveSheetVisible && !createVisible}
        palette={palette}
        packs={packs}
        busy={busy}
        onClose={() => setSaveSheetVisible(false)}
        onPick={addToPack}
        onCreate={() => {
          setNewName('');
          setNewAuthor('');
          setCreateVisible(true);
        }}
      />

      <CreatePackModal
        visible={createVisible}
        palette={palette}
        name={newName}
        author={newAuthor}
        busy={busy}
        onName={setNewName}
        onAuthor={setNewAuthor}
        onCancel={() => setCreateVisible(false)}
        onConfirm={createPack}
      />
    </SafeAreaView>
  );
}

function ToolTab({
  palette,
  icon,
  label,
  active,
  onPress,
}: {
  palette: JamboPalette;
  icon: 'crop' | 'square';
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.tool,
        {
          backgroundColor: active ? palette.accentMuted : palette.surface,
          borderColor: active ? palette.accent : palette.border,
          borderWidth: active ? 1.5 : 1,
        },
        pressed && styles.pressed,
      ]}>
      <JamboIcon name={icon} size={20} color={active ? palette.accentSoft : palette.textSecondary} />
      <Text
        style={{
          color: active ? palette.accentSoft : palette.textSecondary,
          fontFamily: active ? JamboFonts.bodyBold : JamboFonts.bodySemi,
          fontSize: 11.5,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SaveSheet({
  visible,
  palette,
  packs,
  busy,
  onClose,
  onPick,
  onCreate,
}: {
  visible: boolean;
  palette: JamboPalette;
  packs: Pack[];
  busy: boolean;
  onClose: () => void;
  onPick: (pack: Pack) => void;
  onCreate: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.scrim, { backgroundColor: palette.scrim }]} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>
        <View style={[styles.grabber, { backgroundColor: palette.border }]} />
        <View style={styles.sheetTitleBlock}>
          <Text style={[styles.sheetTitle, { color: palette.text }]}>Onde salvar a figurinha?</Text>
          <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>
            Ela entra no pacote agora e você continua montando depois.
          </Text>
        </View>

        <View style={styles.sheetList}>
          {packs.map((pack) => {
            const full = pack.stickers.length >= MAX_STICKERS;
            return (
              <Pressable
                key={pack.id}
                disabled={full || busy}
                onPress={() => onPick(pack)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.packRow,
                  { backgroundColor: palette.surfaceElevated, borderColor: palette.border },
                  full && styles.disabled,
                  pressed && styles.pressed,
                ]}>
                <Checker
                  cell={13}
                  light={palette.checkerLight}
                  dark={palette.checkerDark}
                  style={styles.packThumb}>
                  {pack.iconUri ? (
                    <Image source={{ uri: pack.iconUri }} style={styles.packThumbImage} resizeMode="contain" />
                  ) : (
                    <View style={styles.packThumbFallback}>
                      <JamboMark size={26} body={palette.accent} leaf={palette.leaf} />
                    </View>
                  )}
                </Checker>
                <View style={styles.packRowInfo}>
                  <Text style={[styles.packRowName, { color: palette.text }]} numberOfLines={1}>
                    {pack.name}
                  </Text>
                  <Text
                    style={{
                      color: full ? palette.textMuted : palette.accentSoft,
                      fontFamily: JamboFonts.monoMedium,
                      fontSize: 12,
                    }}>
                    {full ? `${MAX_STICKERS}/${MAX_STICKERS} · cheio` : `${pack.stickers.length}/${MAX_STICKERS} figurinhas`}
                  </Text>
                </View>
                {!full ? <JamboIcon name="chevronRight" size={18} color={palette.textMuted} /> : null}
              </Pressable>
            );
          })}
        </View>

        <PrimaryButton label="Criar novo pacote" icon="plusSmall" palette={palette} onPress={onCreate} disabled={busy} />
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.sheetCancel}>
          <Text style={{ color: palette.textMuted, fontFamily: JamboFonts.bodyBold, fontSize: 15 }}>Cancelar</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function CreatePackModal({
  visible,
  palette,
  name,
  author,
  busy,
  onName,
  onAuthor,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  palette: JamboPalette;
  name: string;
  author: string;
  busy: boolean;
  onName: (value: string) => void;
  onAuthor: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.centerScrim, { backgroundColor: palette.scrim }]}>
        <View style={[styles.dialog, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.sheetTitle, { color: palette.text }]}>Criar novo pacote</Text>
          <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>
            A figurinha atual entra nele automaticamente.
          </Text>
          <TextInput
            value={name}
            onChangeText={onName}
            placeholder="Nome do pacote"
            placeholderTextColor={palette.textMuted}
            style={[styles.input, { color: palette.text, backgroundColor: palette.surfaceElevated, borderColor: palette.border }]}
          />
          <TextInput
            value={author}
            onChangeText={onAuthor}
            placeholder="Autor"
            placeholderTextColor={palette.textMuted}
            style={[styles.input, { color: palette.text, backgroundColor: palette.surfaceElevated, borderColor: palette.border }]}
          />
          <PrimaryButton label={busy ? 'Criando...' : 'Criar pacote'} palette={palette} onPress={onConfirm} disabled={busy} />
          <Pressable onPress={onCancel} accessibilityRole="button" style={styles.sheetCancel}>
            <Text style={{ color: palette.textMuted, fontFamily: JamboFonts.bodyBold, fontSize: 15 }}>Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: { fontFamily: JamboFonts.bodySemi, fontSize: 13.5 },
  headerCta: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: JamboRadius.pill },
  canvasWrap: { paddingHorizontal: 16 },
  canvas: { aspectRatio: 1, borderRadius: 22, borderWidth: 1 },
  imageArea: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  canvasImage: { width: '100%', height: '100%' },
  dimensionBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: JamboRadius.pill,
    opacity: 0.92,
  },
  tools: { flexDirection: 'row', gap: 9, paddingHorizontal: 16, paddingTop: 14 },
  tool: { flex: 1, alignItems: 'center', gap: 7, paddingVertical: 13, paddingHorizontal: 4, borderRadius: JamboRadius.lg },
  spacer: { flex: 1 },
  footer: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  footerButtons: { flexDirection: 'row', gap: 10 },
  outlineButton: {
    minHeight: 54,
    paddingHorizontal: 18,
    borderRadius: JamboRadius.lg,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject },
  centerScrim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: JamboRadius.xxl,
    borderTopRightRadius: JamboRadius.xxl,
    borderTopWidth: 1,
    paddingTop: 14,
    paddingHorizontal: 20,
    paddingBottom: 30,
    gap: 14,
  },
  grabber: { width: 42, height: 4, borderRadius: JamboRadius.pill, alignSelf: 'center' },
  sheetTitleBlock: { gap: 4 },
  sheetTitle: { fontFamily: JamboFonts.displaySemi, fontSize: 22, letterSpacing: -0.4 },
  sheetSubtitle: { fontFamily: JamboFonts.body, fontSize: 13.5, lineHeight: 20 },
  sheetList: { gap: 9 },
  packRow: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 12, borderRadius: JamboRadius.lg, borderWidth: 1 },
  packThumb: { width: 52, height: 52, borderRadius: 13 },
  packThumbImage: { width: '100%', height: '100%' },
  packThumbFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  packRowInfo: { flex: 1, gap: 2 },
  packRowName: { fontFamily: JamboFonts.displaySemi, fontSize: 16 },
  sheetCancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 360, borderRadius: JamboRadius.xl, borderWidth: 1, padding: 22, gap: 12 },
  input: { minHeight: 48, paddingHorizontal: 14, borderRadius: JamboRadius.md, borderWidth: 1, fontFamily: JamboFonts.body },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
});
