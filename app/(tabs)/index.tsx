import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import ImageCropPicker from 'react-native-image-crop-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

type ImageAsset = { uri: string; width: number; height: number };
type ImageMode = 'crop' | 'original';
type Sticker = { id: string; originalUri: string; processedUri: string; mode: ImageMode; format: 'webp'; width: number; height: number };
type Album = { id: string; name: string; author: string; iconUri: string; stickers: Sticker[] };

const ALBUMS_STORAGE_KEY = '@app-de-figurinhas/albums';
const MAX_STICKER_BYTES = 100 * 1024;
const STICKERS_DIRECTORY = 'stickers';

// captureRef e manipulateAsync gravam no cache interno, que o Android limpa sozinho.
// Como o URI fica salvo no AsyncStorage, a figurinha precisa ir para um diretorio permanente.
function persistSticker(temporaryUri: string, stickerId: string) {
  const directory = new Directory(Paths.document, STICKERS_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true });
  const destination = new File(directory, `${stickerId}.webp`);
  if (destination.exists) destination.delete();
  new File(temporaryUri).copy(destination);
  return destination.uri;
}

export default function HomeScreen() {
  const [originalImage, setOriginalImage] = useState<ImageAsset | null>(null);
  const [processedImage, setProcessedImage] = useState<ImageAsset | null>(null);
  const [imageMode, setImageMode] = useState<ImageMode | null>(null);
  const [albumChoiceVisible, setAlbumChoiceVisible] = useState(false);
  const [albumListVisible, setAlbumListVisible] = useState(false);
  const [albumCreationVisible, setAlbumCreationVisible] = useState(false);
  const [albumName, setAlbumName] = useState('');
  const [albumAuthor, setAlbumAuthor] = useState('');
  const [albums, setAlbums] = useState<Album[]>([]);
  const previewRef = useRef<View>(null);

  useEffect(() => {
    async function loadAlbums() {
      try {
        const storedAlbums = await AsyncStorage.getItem(ALBUMS_STORAGE_KEY);
        if (storedAlbums) {
          const parsedAlbums = JSON.parse(storedAlbums) as Album[];
          setAlbums(Array.isArray(parsedAlbums) ? parsedAlbums : []);
        }
      } catch {
        setAlbums([]);
      }
    }

    loadAlbums();
  }, []);

  async function selectImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permissao necessaria', 'Permita o acesso as suas fotos para escolher uma imagem.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: false,
      quality: 1,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      const asset = result.assets[0];
      const selected = { uri: asset.uri, width: asset.width, height: asset.height };
      setOriginalImage(selected);
      setProcessedImage(null);
      setImageMode(null);
    }
  }

  async function openCropEditor() {
    if (!originalImage) return;
    try {
      const result = await ImageCropPicker.openCropper({
        path: originalImage.uri,
        mediaType: 'photo',
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
      });
      setProcessedImage({ uri: result.path, width: result.width, height: result.height });
      setImageMode('crop');
    } catch {
      // Cancelar o editor nativo tambem rejeita a Promise.
    }
  }

  const displayedImage = imageMode === 'crop' ? processedImage : originalImage;
  const screenTitle = !originalImage
    ? 'Selecionar imagem'
    : imageMode === 'crop'
      ? 'Recortar figurinha'
      : imageMode === 'original'
        ? 'Tamanho original'
        : 'Editar figurinha';

  async function captureStickerCanvas() {
    if (!previewRef.current) throw new Error('Preview indisponivel');
    const capturedUri = await captureRef(previewRef, {
      format: 'png',
      result: 'tmpfile',
      width: 512,
      height: 512,
      quality: 1,
    });

    const qualities = [0.9, 0.75, 0.6, 0.45, 0.3, 0.15];
    for (const quality of qualities) {
      const result = await manipulateAsync(capturedUri, [], {
        compress: quality,
        format: SaveFormat.WEBP,
      });
      const response = await fetch(result.uri);
      const fileSize = (await response.blob()).size;
      if (fileSize <= MAX_STICKER_BYTES) {
        return { uri: result.uri, width: result.width, height: result.height };
      }
    }

    throw new Error('Figurinha excede o limite de 100 KB');
  }

  async function buildSticker(sourceUri: string): Promise<Sticker> {
    const stickerId = `${Date.now()}-sticker`;
    const captured = await captureStickerCanvas();
    return {
      id: stickerId,
      originalUri: sourceUri,
      processedUri: persistSticker(captured.uri, stickerId),
      mode: imageMode ?? 'original',
      format: 'webp',
      width: captured.width,
      height: captured.height,
    };
  }

  function chooseNewAlbum() {
    setAlbumChoiceVisible(false);
    setAlbumName('');
    setAlbumAuthor('');
    setAlbumCreationVisible(true);
  }

  function chooseExistingAlbum() {
    setAlbumChoiceVisible(false);
    setAlbumListVisible(true);
  }

  async function handleProceed() {
    try {
      const storedAlbums = await AsyncStorage.getItem(ALBUMS_STORAGE_KEY);
      const currentAlbums = storedAlbums ? JSON.parse(storedAlbums) as Album[] : [];
      const syncedAlbums = Array.isArray(currentAlbums) ? currentAlbums : [];
      setAlbums(syncedAlbums);
      if (syncedAlbums.length === 0) {
        chooseNewAlbum();
        return;
      }
      setAlbumChoiceVisible(true);
    } catch {
      Alert.alert('Nao foi possivel carregar', 'Tente prosseguir novamente.');
    }
  }

  async function createAlbum() {
    if (!originalImage || !displayedImage) return;
    const trimmedName = albumName.trim();
    const trimmedAuthor = albumAuthor.trim();
    if (!trimmedName || !trimmedAuthor) {
      Alert.alert('Preencha os dados', 'Informe o nome do album e o autor.');
      return;
    }

    let sticker: Sticker;
    try {
      sticker = await buildSticker(originalImage.uri);
    } catch {
      Alert.alert('Nao foi possivel preparar a imagem', 'Tente novamente.');
      return;
    }

    const album: Album = {
      id: `${Date.now()}-album`,
      name: trimmedName,
      author: trimmedAuthor,
      // O URI persistido da figurinha sobrevive a limpeza de cache; o do preview nao.
      iconUri: sticker.processedUri,
      stickers: [sticker],
    };

    try {
      const storedAlbums = await AsyncStorage.getItem(ALBUMS_STORAGE_KEY);
      const currentAlbums = storedAlbums ? JSON.parse(storedAlbums) as Album[] : [];
      const nextAlbums = [...currentAlbums, album];
      await AsyncStorage.setItem(ALBUMS_STORAGE_KEY, JSON.stringify(nextAlbums));
      setAlbums(nextAlbums);
      setAlbumCreationVisible(false);
      Alert.alert('Album criado', 'A figurinha foi adicionada ao novo album.');
    } catch {
      Alert.alert('Nao foi possivel salvar', 'Tente criar o album novamente.');
    }
  }

  async function addStickerToAlbum(album: Album) {
    if (!originalImage || !displayedImage) return;

    try {
      const storedAlbums = await AsyncStorage.getItem(ALBUMS_STORAGE_KEY);
      const currentAlbums = storedAlbums ? JSON.parse(storedAlbums) as Album[] : [];
      const currentAlbum = currentAlbums.find((current) => current.id === album.id);
      if (!currentAlbum) {
        Alert.alert('Album nao encontrado', 'Atualize a listagem e tente novamente.');
        return;
      }
      if (currentAlbum.stickers.length >= 30) {
        Alert.alert('Album cheio', 'Cada album pode ter no maximo 30 figurinhas.');
        return;
      }

      const sticker = await buildSticker(originalImage.uri);
      const updatedAlbum = { ...currentAlbum, stickers: [...currentAlbum.stickers, sticker] };
      const nextAlbums = currentAlbums.map((current) => current.id === currentAlbum.id ? updatedAlbum : current);
      await AsyncStorage.setItem(ALBUMS_STORAGE_KEY, JSON.stringify(nextAlbums));
      setAlbums(nextAlbums);
      setAlbumListVisible(false);
      Alert.alert('Figurinha adicionada', `A figurinha foi adicionada ao album ${currentAlbum.name}.`);
    } catch {
      Alert.alert('Nao foi possivel salvar', 'Tente adicionar a figurinha novamente.');
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>{screenTitle}</ThemedText>
      <View ref={previewRef} collapsable={false} style={styles.previewFrame}>
        {displayedImage ? <Image source={{ uri: displayedImage.uri }} style={styles.previewImage} resizeMode={imageMode === 'crop' ? 'cover' : 'contain'} /> : <ThemedText style={styles.emptyText}>Seu preview aparecera aqui</ThemedText>}
      </View>

      {!originalImage ? (
        <Pressable onPress={selectImage} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <ThemedText style={styles.primaryText}>Selecionar imagem</ThemedText>
        </Pressable>
      ) : (
        <ThemedView style={styles.options}>
          <Pressable onPress={openCropEditor} style={({ pressed }) => [styles.option, imageMode === 'crop' && styles.selected, pressed && styles.pressed]}>
            <ThemedText style={[styles.optionText, imageMode === 'crop' && styles.selectedText]}>Recortar</ThemedText>
          </Pressable>
          <Pressable onPress={() => { setImageMode('original'); setProcessedImage(null); }} style={({ pressed }) => [styles.option, imageMode === 'original' && styles.selected, pressed && styles.pressed]}>
            <ThemedText style={[styles.optionText, imageMode === 'original' && styles.selectedText]}>Tamanho original</ThemedText>
          </Pressable>
          <Pressable onPress={selectImage} style={({ pressed }) => [styles.outlineButton, styles.changeImageButton, pressed && styles.pressed]}>
            <ThemedText style={styles.outlineText}>Escolher outra imagem</ThemedText>
          </Pressable>
          <Pressable onPress={handleProceed} style={({ pressed }) => [styles.primaryButton, styles.continueButton, pressed && styles.pressed]}>
            <ThemedText style={styles.primaryText}>Prosseguir</ThemedText>
          </Pressable>
        </ThemedView>
      )}

      <Modal visible={albumChoiceVisible} transparent animationType="fade" onRequestClose={() => setAlbumChoiceVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.albumModal}>
            <ThemedText type="subtitle" style={[styles.modalTitle, styles.modalTitleText]}>Onde salvar a figurinha?</ThemedText>
            <ThemedText style={[styles.modalHint, styles.modalHintText]}>Escolha um album para continuar a montagem.</ThemedText>
            <Pressable onPress={chooseNewAlbum} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <ThemedText style={styles.primaryText}>Criar novo album</ThemedText>
            </Pressable>
            <Pressable onPress={chooseExistingAlbum} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
              <ThemedText style={styles.optionText}>Usar album existente</ThemedText>
            </Pressable>
            <Pressable onPress={() => setAlbumChoiceVisible(false)} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
              <ThemedText style={styles.outlineText}>Cancelar</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={albumCreationVisible} transparent animationType="fade" onRequestClose={() => setAlbumCreationVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.albumModal}>
            <ThemedText type="subtitle" style={[styles.modalTitle, styles.modalTitleText]}>Criar novo album</ThemedText>
            <ThemedText style={[styles.modalHint, styles.modalHintText]}>A figurinha atual sera adicionada automaticamente.</ThemedText>
            <TextInput
              value={albumName}
              onChangeText={setAlbumName}
              placeholder="Nome do album"
              placeholderTextColor="#718096"
              style={styles.textInput}
            />
            <TextInput
              value={albumAuthor}
              onChangeText={setAlbumAuthor}
              placeholder="Autor"
              placeholderTextColor="#718096"
              style={styles.textInput}
            />
            <Pressable onPress={createAlbum} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <ThemedText style={styles.primaryText}>Criar album</ThemedText>
            </Pressable>
            <Pressable onPress={() => setAlbumCreationVisible(false)} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
              <ThemedText style={styles.outlineText}>Cancelar</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={albumListVisible} transparent animationType="fade" onRequestClose={() => setAlbumListVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.albumModal}>
            <ThemedText type="subtitle" style={[styles.modalTitle, styles.modalTitleText]}>Usar album existente</ThemedText>
            <ThemedText style={[styles.modalHint, styles.modalHintText]}>Escolha onde adicionar a figurinha atual.</ThemedText>
            {albums.map((album) => (
              <Pressable key={album.id} onPress={() => addStickerToAlbum(album)} style={({ pressed }) => [styles.albumRow, pressed && styles.pressed]}>
                <Image source={{ uri: album.iconUri }} style={styles.albumIcon} />
                <View style={styles.albumInfo}>
                  <ThemedText style={styles.albumName}>{album.name}</ThemedText>
                  <ThemedText style={styles.albumCount}>{album.stickers.length}/30 figurinhas</ThemedText>
                </View>
              </Pressable>
            ))}
            <Pressable onPress={() => setAlbumListVisible(false)} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
              <ThemedText style={styles.outlineText}>Cancelar</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 },
  title: { textAlign: 'center', fontSize: 34, lineHeight: 40 },
  previewFrame: { width: 280, height: 280, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: 'transparent' },
  previewImage: { width: 280, height: 280 },
  emptyText: { paddingHorizontal: 28, textAlign: 'center', opacity: 0.6 },
  primaryButton: { width: '100%', maxWidth: 320, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#1769E0' },
  primaryText: { color: '#FFFFFF', fontWeight: '700' },
  options: { width: '100%', maxWidth: 320, alignItems: 'center', gap: 10 },
  option: { width: '100%', minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: '#1769E0', borderRadius: 8 },
  optionText: { color: '#1769E0', fontWeight: '700', textAlign: 'center' },
  selected: { backgroundColor: '#1769E0' },
  selectedText: { color: '#FFFFFF' },
  outlineButton: { width: '100%', minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderColor: '#1769E0', borderRadius: 8 },
  changeImageButton: { marginTop: 50 },
  continueButton: { marginTop: 4 },
  outlineText: { color: '#1769E0', fontWeight: '700' },
  pressed: { opacity: 0.75 },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.45)' },
  albumModal: { width: '100%', maxWidth: 340, gap: 12, padding: 24, backgroundColor: '#FFFFFF', borderRadius: 12 },
  modalTitle: { textAlign: 'center' },
  modalTitleText: { color: '#172033' },
  modalHint: { marginBottom: 6, textAlign: 'center' },
  modalHintText: { color: '#4A5568' },
  textInput: { minHeight: 48, paddingHorizontal: 14, borderWidth: 1, borderColor: '#CBD5E0', borderRadius: 8, color: '#172033', backgroundColor: '#F7FAFC' },
  cancelButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  albumRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, padding: 8, borderWidth: 1, borderColor: '#CBD5E0', borderRadius: 8 },
  albumIcon: { width: 48, height: 48 },
  albumInfo: { flex: 1, gap: 2 },
  albumName: { color: '#172033', fontWeight: '700' },
  albumCount: { color: '#4A5568', fontSize: 14 },
});
