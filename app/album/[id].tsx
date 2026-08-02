import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { useEffect, useState } from 'react';
import { Alert, Image, Modal, NativeModules, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

type Sticker = { id: string; originalUri: string; processedUri: string; mode: 'crop' | 'original'; format?: 'webp'; width: number; height: number };
type Album = { id: string; name: string; author: string; iconUri: string; stickers: Sticker[] };

const ALBUMS_STORAGE_KEY = '@app-de-figurinhas/albums';
const MAX_STICKER_BYTES = 100 * 1024;
const WHATSAPP_OPERATION_TIMEOUT_MS = 15000;
type ExportResult = { status: 'added' | 'cancelled' | 'rejected'; error?: string };
const whatsappStickerModule = NativeModules.WhatsAppStickerModule as {
  isWhatsAppAvailable(): Promise<boolean>;
  addStickerPack(config: {
    identifier: string;
    title: string;
    author: string;
    trayImage: string;
    publisherEmail: string;
    publisherURL: string;
    privacyPolicyURL: string;
    licenseURL: string;
    stickers: { url: string }[];
  }): Promise<ExportResult>;
};

const EXPORT_ERROR_MESSAGES: Record<string, string> = {
  WHATSAPP_NOT_INSTALLED: 'Instale o WhatsApp (ou o WhatsApp Business) para adicionar este álbum.',
  NO_ACTIVITY: 'Mantenha o app aberto enquanto o WhatsApp é chamado e tente de novo.',
  WHATSAPP_OPEN_FAILED: 'Não foi possível abrir a tela de importação do WhatsApp.',
  EXPORT_IN_PROGRESS: 'Já existe uma importação aguardando resposta do WhatsApp.',
  STICKER_PACK_FAILED: 'Falha ao preparar os arquivos das figurinhas.',
};

export default function AlbumDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [selectedSticker, setSelectedSticker] = useState<Sticker | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    async function loadAlbum() {
      try {
        const storedAlbums = await AsyncStorage.getItem(ALBUMS_STORAGE_KEY);
        const albums = storedAlbums ? JSON.parse(storedAlbums) as Album[] : [];
        setAlbum(albums.find((item) => item.id === id) ?? null);
      } catch {
        Alert.alert('Nao foi possivel carregar', 'Tente abrir o album novamente.');
      } finally {
        setLoading(false);
      }
    }

    loadAlbum();
  }, [id]);

  function confirmRemoveSticker() {
    if (!selectedSticker || !album) return;
    Alert.alert('Excluir figurinha?', 'Essa acao nao pode ser desfeita.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: () => removeSticker(selectedSticker.id) },
    ]);
  }

  async function removeSticker(stickerId: string) {
    if (!album) return;
    const updatedAlbum = { ...album, stickers: album.stickers.filter((sticker) => sticker.id !== stickerId) };
    try {
      const storedAlbums = await AsyncStorage.getItem(ALBUMS_STORAGE_KEY);
      const albums = storedAlbums ? JSON.parse(storedAlbums) as Album[] : [];
      const nextAlbums = albums.map((item) => item.id === album.id ? updatedAlbum : item);
      await AsyncStorage.setItem(ALBUMS_STORAGE_KEY, JSON.stringify(nextAlbums));
      setAlbum(updatedAlbum);
      setSelectedSticker(null);
    } catch {
      Alert.alert('Nao foi possivel excluir', 'Tente novamente.');
    }
  }

  function openEditAlbum() {
    if (!album) return;
    setEditName(album.name);
    setEditAuthor(album.author);
    setEditVisible(true);
  }

  async function saveAlbumChanges() {
    if (!album) return;
    const name = editName.trim();
    const author = editAuthor.trim();
    if (!name || !author) {
      Alert.alert('Preencha os dados', 'Informe o nome do album e o autor.');
      return;
    }

    const updatedAlbum = { ...album, name, author };
    try {
      const storedAlbums = await AsyncStorage.getItem(ALBUMS_STORAGE_KEY);
      const albums = storedAlbums ? JSON.parse(storedAlbums) as Album[] : [];
      const nextAlbums = albums.map((item) => item.id === album.id ? updatedAlbum : item);
      await AsyncStorage.setItem(ALBUMS_STORAGE_KEY, JSON.stringify(nextAlbums));
      setAlbum(updatedAlbum);
      setEditVisible(false);
    } catch {
      Alert.alert('Nao foi possivel salvar', 'Tente editar o album novamente.');
    }
  }

  function confirmDeleteAlbum() {
    if (!album) return;
    Alert.alert('Excluir album?', `Todas as ${album.stickers.length} figurinhas serao removidas.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: deleteAlbum },
    ]);
  }

  async function deleteAlbum() {
    if (!album) return;
    try {
      const storedAlbums = await AsyncStorage.getItem(ALBUMS_STORAGE_KEY);
      const albums = storedAlbums ? JSON.parse(storedAlbums) as Album[] : [];
      const nextAlbums = albums.filter((item) => item.id !== album.id);
      await AsyncStorage.setItem(ALBUMS_STORAGE_KEY, JSON.stringify(nextAlbums));
      router.back();
    } catch {
      Alert.alert('Nao foi possivel excluir', 'Tente novamente.');
    }
  }

  async function getAlbumValidationErrors() {
    if (!album) return ['álbum não encontrado'];
    const errors: string[] = [];
    if (album.stickers.length < 3) errors.push('adicione pelo menos 3 figurinhas');
    if (album.stickers.length > 30) errors.push('remova figurinhas até ficar com no máximo 30');

    for (const [index, sticker] of album.stickers.entries()) {
      const number = index + 1;
      if (sticker.format !== 'webp') errors.push(`a figurinha ${number} não está em WebP`);
      if (sticker.width !== 512 || sticker.height !== 512) errors.push(`a figurinha ${number} não está em 512x512`);
      const file = new File(sticker.processedUri);
      if (!file.exists) errors.push(`a figurinha ${number} não está mais disponível no dispositivo`);
      else if (file.size > MAX_STICKER_BYTES) errors.push(`a figurinha ${number} excede 100 KB`);
    }
    return errors;
  }

  async function validateAlbumForWhatsApp() {
    if (!album || validating || exporting) return;
    setValidating(true);
    try {
      const errors = await getAlbumValidationErrors();
      Alert.alert(errors.length > 0 ? 'Álbum não validado' : 'Álbum válido', errors.length > 0
        ? errors.join('\n')
        : 'Todas as figurinhas atendem aos requisitos para o WhatsApp.');
    } catch {
      Alert.alert('Não foi possível validar', 'Tente novamente em alguns instantes.');
    } finally {
      setValidating(false);
    }
  }

  async function addAlbumToWhatsApp() {
    if (!album || validating || exporting) return;
    if (!whatsappStickerModule) {
      Alert.alert('Módulo nativo ausente', 'O WhatsAppStickerModule não foi carregado. Rode "npx expo run:android" para reconstruir o app — recarregar o JS não basta.');
      return;
    }
    setExporting(true);
    try {
      const errors = await Promise.race([
        getAlbumValidationErrors(),
        new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error('validation-timeout')), WHATSAPP_OPERATION_TIMEOUT_MS)),
      ]);
      if (errors.length > 0) {
        Alert.alert('Álbum não validado', errors.join('\n'));
        return;
      }

      const whatsappAvailable = await Promise.race([
        whatsappStickerModule.isWhatsAppAvailable(),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('availability-timeout')), WHATSAPP_OPERATION_TIMEOUT_MS)),
      ]);
      if (!whatsappAvailable) {
        Alert.alert('WhatsApp não encontrado', 'Instale o WhatsApp ou o WhatsApp Business para adicionar este álbum.');
        return;
      }

      const identifier = `album_${album.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      // Sem timeout aqui: a Promise so resolve quando o usuario volta da tela do WhatsApp.
      const result = await whatsappStickerModule.addStickerPack({
        identifier,
        title: album.name,
        author: album.author,
        trayImage: album.stickers[0].processedUri,
        publisherEmail: 'nikolasyan@users.noreply.github.com',
        publisherURL: 'https://github.com/nikolasyan/whatsapp-stickermaker',
        privacyPolicyURL: 'https://github.com/nikolasyan/whatsapp-stickermaker',
        licenseURL: 'https://github.com/nikolasyan/whatsapp-stickermaker',
        stickers: album.stickers.map((sticker) => ({ url: sticker.processedUri })),
      });

      if (result.status === 'added') {
        Alert.alert('Adicionado ao WhatsApp', `"${album.name}" já está disponível nas suas figurinhas.`);
      } else if (result.status === 'cancelled') {
        Alert.alert('Importação cancelada', 'Você saiu da tela do WhatsApp antes de confirmar.');
      } else {
        Alert.alert('WhatsApp recusou o álbum', result.error ?? 'O WhatsApp não informou o motivo.');
      }
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
      const message = error instanceof Error && error.message === 'validation-timeout'
        ? 'A validação demorou demais. Verifique se as imagens do álbum ainda estão disponíveis.'
        : error instanceof Error && error.message === 'availability-timeout'
          ? 'O WhatsApp não respondeu à verificação.'
          : EXPORT_ERROR_MESSAGES[code]
            ?? (error instanceof Error && error.message ? error.message : 'O WhatsApp não conseguiu importar este álbum.');
      Alert.alert('Não foi possível adicionar', message);
    } finally {
      setExporting(false);
    }
  }

  async function downloadSelectedSticker() {
    if (!selectedSticker) return;
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permissao necessaria', 'Permita o acesso a sua galeria para baixar a figurinha.');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(selectedSticker.processedUri);
      Alert.alert('Imagem baixada', 'A figurinha foi salva na galeria.');
    } catch {
      Alert.alert('Nao foi possivel baixar', 'Tente novamente.');
    }
  }

  if (loading) {
    return <ThemedView style={styles.center}><ThemedText style={styles.secondaryText}>Carregando album...</ThemedText></ThemedView>;
  }

  if (!album) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="subtitle" style={styles.heading}>Album nao encontrado</ThemedText>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <ThemedText style={styles.primaryText}>Voltar para albuns</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: album.name, headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <ThemedText style={styles.backText}>Voltar</ThemedText>
        </Pressable>
        <View style={styles.headerInfo}>
          <ThemedText type="title" style={styles.heading}>{album.name}</ThemedText>
          <ThemedText style={styles.secondaryText}>{album.author} · {album.stickers.length}/30 figurinhas</ThemedText>
        </View>
      </View>
      <View style={styles.albumActions}>
        <Pressable onPress={openEditAlbum} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
          <ThemedText style={styles.actionText}>Editar album</ThemedText>
        </Pressable>
        <Pressable onPress={confirmDeleteAlbum} style={({ pressed }) => [styles.actionButton, styles.deleteOutline, pressed && styles.pressed]}>
          <ThemedText style={styles.deleteOutlineText}>Excluir album</ThemedText>
        </Pressable>
      </View>
      <Pressable onPress={validateAlbumForWhatsApp} disabled={validating} style={({ pressed }) => [styles.validationButton, pressed && styles.pressed, validating && styles.disabled]}>
        <ThemedText style={styles.validationText}>{validating ? 'Validando...' : 'Validar para o WhatsApp'}</ThemedText>
      </Pressable>
      <Pressable onPress={addAlbumToWhatsApp} disabled={validating || exporting} style={({ pressed }) => [styles.whatsappButton, pressed && styles.pressed, (validating || exporting) && styles.disabled]}>
        <ThemedText style={styles.whatsappText}>{exporting ? 'Adicionando...' : 'Adicionar ao WhatsApp'}</ThemedText>
      </Pressable>

      {album.stickers.length === 0 ? (
        <View style={styles.center}>
          <ThemedText style={styles.secondaryText}>Este album ainda nao tem figurinhas.</ThemedText>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {album.stickers.map((sticker) => (
            <Pressable key={sticker.id} onPress={() => setSelectedSticker(sticker)} style={({ pressed }) => [styles.stickerTile, pressed && styles.pressed]}>
              <Image source={{ uri: sticker.processedUri }} style={styles.stickerImage} resizeMode="contain" />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Modal visible={selectedSticker !== null} transparent animationType="fade" onRequestClose={() => setSelectedSticker(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.previewModal}>
            {selectedSticker && <Image source={{ uri: selectedSticker.processedUri }} style={styles.expandedImage} resizeMode="contain" />}
            <Pressable onPress={downloadSelectedSticker} style={({ pressed }) => [styles.downloadButton, pressed && styles.pressed]}>
              <ThemedText style={styles.downloadText}>Baixar imagem</ThemedText>
            </Pressable>
            <Pressable onPress={confirmRemoveSticker} style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
              <ThemedText style={styles.deleteText}>Excluir figurinha</ThemedText>
            </Pressable>
            <Pressable onPress={() => setSelectedSticker(null)} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
              <ThemedText style={styles.backText}>Fechar</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.editModal}>
            <ThemedText type="subtitle" style={styles.modalTitle}>Editar album</ThemedText>
            <TextInput value={editName} onChangeText={setEditName} placeholder="Nome do album" placeholderTextColor="#718096" style={styles.textInput} />
            <TextInput value={editAuthor} onChangeText={setEditAuthor} placeholder="Autor" placeholderTextColor="#718096" style={styles.textInput} />
            <Pressable onPress={saveAlbumChanges} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <ThemedText style={styles.primaryText}>Salvar alteracoes</ThemedText>
            </Pressable>
            <Pressable onPress={() => setEditVisible(false)} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
              <ThemedText style={styles.backText}>Cancelar</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 24, paddingBottom: 20 },
  backButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  backText: { color: '#1769E0', fontWeight: '700' },
  headerInfo: { flex: 1, gap: 4 },
  albumActions: { flexDirection: 'row', gap: 10, paddingBottom: 20 },
  validationButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 20, borderRadius: 8, backgroundColor: '#E5F6EE' },
  validationText: { color: '#18794E', fontWeight: '700' },
  whatsappButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', marginBottom: 20, borderRadius: 8, backgroundColor: '#25D366' },
  whatsappText: { color: '#FFFFFF', fontWeight: '700' },
  actionButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1769E0', borderRadius: 8 },
  actionText: { color: '#1769E0', fontWeight: '700' },
  deleteOutline: { borderColor: '#C53030' },
  deleteOutlineText: { color: '#C53030', fontWeight: '700' },
  heading: { color: '#172033', fontSize: 26, lineHeight: 32 },
  secondaryText: { color: '#4A5568' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 24 },
  stickerTile: { width: '31%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  stickerImage: { width: '100%', height: '100%' },
  primaryButton: { width: '100%', maxWidth: 320, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#1769E0' },
  primaryText: { color: '#FFFFFF', fontWeight: '700' },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.55)' },
  previewModal: { width: '100%', maxWidth: 360, alignItems: 'center', gap: 14, padding: 20, backgroundColor: '#FFFFFF', borderRadius: 12 },
  expandedImage: { width: '100%', height: 320, backgroundColor: 'transparent' },
  downloadButton: { width: '100%', minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#1769E0' },
  downloadText: { color: '#FFFFFF', fontWeight: '700' },
  deleteButton: { width: '100%', minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#C53030' },
  deleteText: { color: '#FFFFFF', fontWeight: '700' },
  cancelButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  editModal: { width: '100%', maxWidth: 360, gap: 14, padding: 20, backgroundColor: '#FFFFFF', borderRadius: 12 },
  modalTitle: { color: '#172033', textAlign: 'center' },
  textInput: { minHeight: 48, paddingHorizontal: 14, borderWidth: 1, borderColor: '#CBD5E0', borderRadius: 8, color: '#172033', backgroundColor: '#F7FAFC' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.6 },
});