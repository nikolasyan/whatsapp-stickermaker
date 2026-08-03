import { useLocalSearchParams, useRouter } from 'expo-router';
import * as MediaLibrary from 'expo-media-library';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Checker } from '@/components/jambo/checker';
import { JamboIcon } from '@/components/jambo/icons';
import { IconButton, OutlineButton, PrimaryButton } from '@/components/jambo/ui';
import { JamboFonts, JamboRadius, WHATSAPP_GREEN, WHATSAPP_GREEN_ON, type JamboPalette } from '@/constants/jambo-theme';
import { useJamboTheme } from '@/hooks/use-jambo-theme';
import {
  MAX_STICKERS,
  computeReadiness,
  formatBytes,
  loadPacks,
  mutatePacks,
  type Pack,
  type Readiness,
  type ReadinessAction,
  type Sticker,
} from '@/lib/packs';
import { deleteStickerFile, recompressSticker } from '@/lib/stickers';
import { exportErrorMessage, exportPack, isWhatsAppAvailable, isWhatsAppModuleAvailable } from '@/lib/whatsapp';

export default function PackDetailScreen() {
  const router = useRouter();
  const { palette } = useJamboTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [pack, setPack] = useState<Pack | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Sticker | null>(null);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameAuthor, setRenameAuthor] = useState('');

  const refresh = useCallback(async () => {
    const packs = await loadPacks();
    const found = packs.find((item) => item.id === id) ?? null;
    setPack(found);
    setReadiness(found ? computeReadiness(found) : null);
  }, [id]);

  useEffect(() => {
    refresh()
      .catch(() => Alert.alert('Não foi possível carregar', 'Tente abrir o pacote novamente.'))
      .finally(() => setLoading(false));
  }, [refresh]);

  async function persist(next: Pack) {
    await mutatePacks((packs) => packs.map((item) => (item.id === next.id ? next : item)));
    setPack(next);
    setReadiness(computeReadiness(next));
  }

  async function handleExport() {
    if (!pack || exporting) return;
    if (!isWhatsAppModuleAvailable) {
      Alert.alert(
        'Módulo nativo ausente',
        'O WhatsAppStickerModule não foi carregado. Rode "npx expo run:android" para reconstruir o app — recarregar o JS não basta.',
      );
      return;
    }
    if (!readiness?.ready) {
      Alert.alert('Pacote incompleto', 'Resolva os itens da lista de prontidão antes de exportar.');
      return;
    }

    setExporting(true);
    try {
      if (!(await isWhatsAppAvailable())) {
        Alert.alert('WhatsApp não encontrado', 'Instale o WhatsApp ou o WhatsApp Business para adicionar este pacote.');
        return;
      }
      const result = await exportPack(pack);
      if (result.status === 'added') {
        await persist({ ...pack, exportedAt: Date.now() });
        Alert.alert('Adicionado ao WhatsApp', `"${pack.name}" já está disponível nas suas figurinhas.`);
      } else if (result.status === 'cancelled') {
        Alert.alert('Importação cancelada', 'Você saiu da tela do WhatsApp antes de confirmar.');
      } else {
        Alert.alert('WhatsApp recusou o pacote', result.error ?? 'O WhatsApp não informou o motivo.');
      }
    } catch (error) {
      Alert.alert('Não foi possível adicionar', exportErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  function handleReadinessAction(action: ReadinessAction) {
    if (!pack || !readiness) return;
    if (action === 'add') {
      router.push('/');
      return;
    }
    compressOversized();
  }

  async function compressOversized() {
    if (!pack || !readiness || readiness.oversized.length === 0) return;
    try {
      const updated = await Promise.all(
        pack.stickers.map(async (sticker) => {
          if (!readiness.oversized.includes(sticker.id)) return sticker;
          const result = await recompressSticker(sticker.processedUri, sticker.id);
          return { ...sticker, processedUri: result.uri, width: result.width, height: result.height };
        }),
      );
      await persist({ ...pack, stickers: updated });
      Alert.alert('Figurinhas comprimidas', 'Todas cabem no limite de 100 KB agora.');
    } catch (error) {
      Alert.alert('Não foi possível comprimir', error instanceof Error ? error.message : 'Tente novamente.');
    }
  }

  async function removeSticker(sticker: Sticker) {
    if (!pack) return;
    const remaining = pack.stickers.filter((item) => item.id !== sticker.id);
    await persist({
      ...pack,
      stickers: remaining,
      iconUri: remaining[0]?.processedUri ?? pack.iconUri,
    });
    deleteStickerFile(sticker.processedUri);
    setSelected(null);
  }

  async function downloadSticker(sticker: Sticker) {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permissão necessária', 'Permita o acesso à galeria para baixar a figurinha.');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(sticker.processedUri);
      Alert.alert('Imagem baixada', 'A figurinha foi salva na galeria.');
    } catch {
      Alert.alert('Não foi possível baixar', 'Tente novamente.');
    }
  }

  function openRename() {
    if (!pack) return;
    setRenameName(pack.name);
    setRenameAuthor(pack.author);
    setRenameVisible(true);
  }

  async function confirmRename() {
    if (!pack) return;
    const name = renameName.trim();
    const author = renameAuthor.trim();
    if (!name || !author) {
      Alert.alert('Preencha os dados', 'Informe o nome do pacote e o autor.');
      return;
    }
    await persist({ ...pack, name, author });
    setRenameVisible(false);
  }

  function confirmDelete() {
    if (!pack) return;
    Alert.alert('Excluir pacote?', `As ${pack.stickers.length} figurinhas serão removidas.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          for (const sticker of pack.stickers) deleteStickerFile(sticker.processedUri);
          await mutatePacks((packs) => packs.filter((item) => item.id !== pack.id));
          router.back();
        },
      },
    ]);
  }

  function openOverflow() {
    Alert.alert('Pacote', undefined, [
      { text: 'Renomear', onPress: openRename },
      { text: 'Excluir pacote', style: 'destructive', onPress: confirmDelete },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.center, { backgroundColor: palette.bg }]}>
        <Text style={{ color: palette.textMuted, fontFamily: JamboFonts.body }}>Carregando pacote...</Text>
      </SafeAreaView>
    );
  }

  if (!pack || !readiness) {
    return (
      <SafeAreaView style={[styles.screen, styles.center, { backgroundColor: palette.bg }]}>
        <Text style={{ color: palette.text, fontFamily: JamboFonts.displaySemi, fontSize: 20 }}>Pacote não encontrado</Text>
        <PrimaryButton label="Voltar" palette={palette} onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: palette.bg }]}>
      <View style={styles.header}>
        <IconButton name="back" palette={palette} accessibilityLabel="Voltar" onPress={() => router.back()} />
        <IconButton name="more" palette={palette} accessibilityLabel="Mais ações" onPress={openOverflow} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: palette.text }]}>{pack.name}</Text>
          <Text style={[styles.meta, { color: palette.textMuted }]}>
            por {pack.author} · {pack.stickers.length}/{MAX_STICKERS} figurinhas
          </Text>
        </View>

        <ReadinessCard palette={palette} readiness={readiness} onAction={handleReadinessAction} />

        <View style={styles.exportRow}>
          <PrimaryButton
            label={exporting ? 'Adicionando...' : 'Adicionar ao WhatsApp'}
            palette={palette}
            onPress={handleExport}
            disabled={exporting}
            background={WHATSAPP_GREEN}
            foreground={WHATSAPP_GREEN_ON}
            style={styles.grow}
          />
          <IconButton
            name="share"
            size={52}
            palette={palette}
            accessibilityLabel="Compartilhar pacote"
            onPress={() =>
              Alert.alert('Em breve', 'O compartilhamento de pacotes entre amigos ainda não faz parte desta versão.')
            }
          />
        </View>

        <View style={styles.grid}>
          {pack.stickers.map((sticker) => {
            const oversized = readiness.oversized.includes(sticker.id);
            return (
              <Pressable
                key={sticker.id}
                accessibilityRole="button"
                onPress={() => setSelected(sticker)}
                style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
                <Checker
                  cell={16}
                  light={palette.checkerLight}
                  dark={palette.checkerDark}
                  style={[styles.cellInner, oversized && { borderWidth: 1.5, borderColor: palette.warning }]}>
                  <Image source={{ uri: sticker.processedUri }} style={styles.cellImage} resizeMode="contain" />
                  {oversized ? (
                    <View style={[styles.cellBadgeWide, { backgroundColor: palette.warningSurface }]}>
                      <Text style={{ color: palette.warning, fontFamily: JamboFonts.monoMedium, fontSize: 10 }}>
                        {formatBytes(readiness.sizes[sticker.id] ?? 0)}
                      </Text>
                    </View>
                  ) : null}
                </Checker>
              </Pressable>
            );
          })}

          {pack.stickers.length < MAX_STICKERS ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Adicionar figurinha"
              onPress={() => router.push('/')}
              style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
              <View style={[styles.cellInner, styles.addCell, { borderColor: palette.borderDashed }]}>
                <JamboIcon name="plusSmall" size={22} color={palette.accent} />
              </View>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.footerButtons}>
          <OutlineButton label="Renomear" palette={palette} onPress={openRename} style={styles.grow} />
          <OutlineButton label="Excluir pacote" tone="danger" palette={palette} onPress={confirmDelete} style={styles.grow} />
        </View>
      </ScrollView>

      <StickerSheet
        sticker={selected}
        palette={palette}
        onClose={() => setSelected(null)}
        onDownload={downloadSticker}
        onDelete={removeSticker}
      />

      <Modal visible={renameVisible} transparent animationType="fade" onRequestClose={() => setRenameVisible(false)}>
        <View style={[styles.centerScrim, { backgroundColor: palette.scrim }]}>
          <View style={[styles.dialog, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text style={[styles.dialogTitle, { color: palette.text }]}>Renomear pacote</Text>
            <TextInput
              value={renameName}
              onChangeText={setRenameName}
              placeholder="Nome do pacote"
              placeholderTextColor={palette.textMuted}
              style={[styles.input, { color: palette.text, backgroundColor: palette.surfaceElevated, borderColor: palette.border }]}
            />
            <TextInput
              value={renameAuthor}
              onChangeText={setRenameAuthor}
              placeholder="Autor"
              placeholderTextColor={palette.textMuted}
              style={[styles.input, { color: palette.text, backgroundColor: palette.surfaceElevated, borderColor: palette.border }]}
            />
            <PrimaryButton label="Salvar" palette={palette} onPress={confirmRename} />
            <Pressable onPress={() => setRenameVisible(false)} accessibilityRole="button" style={styles.dialogCancel}>
              <Text style={{ color: palette.textMuted, fontFamily: JamboFonts.bodyBold, fontSize: 15 }}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ReadinessCard({
  palette,
  readiness,
  onAction,
}: {
  palette: JamboPalette;
  readiness: Readiness;
  onAction: (action: ReadinessAction) => void;
}) {
  const ratioColor = readiness.ready ? palette.success : palette.warning;
  return (
    <View style={[styles.readiness, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.readinessHeader}>
        <Text style={{ color: palette.text, fontFamily: JamboFonts.displaySemi, fontSize: 15 }}>{readiness.title}</Text>
        <Text style={{ color: ratioColor, fontFamily: JamboFonts.monoMedium, fontSize: 12.5 }}>
          {readiness.satisfied}/{readiness.total}
        </Text>
      </View>

      <View style={[styles.progressTrack, { backgroundColor: palette.checkerLight }]}>
        <View
          style={[
            styles.progressFill,
            { backgroundColor: palette.accent, width: `${(readiness.satisfied / readiness.total) * 100}%` },
          ]}
        />
      </View>

      <View style={styles.readinessList}>
        {readiness.items.map((item) => (
          <View key={item.id} style={styles.readinessRow}>
            <View style={styles.readinessLabel}>
              <JamboIcon
                name={item.ok ? 'check' : 'warning'}
                size={16}
                color={item.ok ? palette.leaf : palette.warning}
              />
              <Text style={{ color: palette.textSecondary, fontFamily: JamboFonts.body, fontSize: 13.5, flexShrink: 1 }}>
                {item.label}
              </Text>
            </View>
            {item.action && item.actionLabel ? (
              <Pressable
                onPress={() => onAction(item.action as ReadinessAction)}
                accessibilityRole="button"
                hitSlop={8}>
                <Text style={{ color: palette.accentSoft, fontFamily: JamboFonts.bodyBold, fontSize: 13 }}>
                  {item.actionLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function StickerSheet({
  sticker,
  palette,
  onClose,
  onDownload,
  onDelete,
}: {
  sticker: Sticker | null;
  palette: JamboPalette;
  onClose: () => void;
  onDownload: (sticker: Sticker) => void;
  onDelete: (sticker: Sticker) => void;
}) {
  return (
    <Modal visible={sticker !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.scrim, { backgroundColor: palette.scrim }]} onPress={onClose} />
      {sticker ? (
        <View style={[styles.sheet, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>
          <View style={[styles.grabber, { backgroundColor: palette.border }]} />
          <Checker cell={20} light={palette.checkerLight} dark={palette.checkerDark} style={styles.sheetPreview}>
            <Image source={{ uri: sticker.processedUri }} style={styles.sheetImage} resizeMode="contain" />
          </Checker>

          <PrimaryButton label="Baixar imagem" palette={palette} onPress={() => onDownload(sticker)} />
          <OutlineButton label="Excluir figurinha" tone="danger" palette={palette} onPress={() => onDelete(sticker)} />
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.dialogCancel}>
            <Text style={{ color: palette.textMuted, fontFamily: JamboFonts.bodyBold, fontSize: 15 }}>Fechar</Text>
          </Pressable>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  scroll: { paddingBottom: 26 },
  titleBlock: { paddingHorizontal: 24, paddingBottom: 14, gap: 4 },
  title: { fontFamily: JamboFonts.display, fontSize: 30, lineHeight: 33, letterSpacing: -0.9 },
  meta: { fontFamily: JamboFonts.monoMedium, fontSize: 12.5 },
  readiness: { marginHorizontal: 16, marginBottom: 14, padding: 16, borderRadius: JamboRadius.xl, borderWidth: 1, gap: 13 },
  readinessHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressTrack: { height: 7, borderRadius: JamboRadius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: JamboRadius.pill },
  readinessList: { gap: 10 },
  readinessRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  readinessLabel: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  exportRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 16 },
  grow: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16 },
  cell: { width: '33.333%', padding: 5 },
  cellInner: { aspectRatio: 1, borderRadius: 14 },
  addCell: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed' },
  cellImage: { width: '100%', height: '100%' },
  cellBadgeWide: { position: 'absolute', bottom: 6, left: 6, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8 },
  footerButtons: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 16 },
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
    gap: 12,
  },
  grabber: { width: 42, height: 4, borderRadius: JamboRadius.pill, alignSelf: 'center' },
  sheetPreview: { height: 220, borderRadius: JamboRadius.lg },
  sheetImage: { width: '100%', height: '100%' },
  dialog: { width: '100%', maxWidth: 360, borderRadius: JamboRadius.xl, borderWidth: 1, padding: 22, gap: 12 },
  dialogTitle: { fontFamily: JamboFonts.displaySemi, fontSize: 20 },
  dialogCancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 48, paddingHorizontal: 14, borderRadius: JamboRadius.md, borderWidth: 1, fontFamily: JamboFonts.body },
  pressed: { opacity: 0.75 },
});
