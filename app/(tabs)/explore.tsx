import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

type Sticker = { id: string; originalUri: string; processedUri: string; mode: 'crop' | 'original'; width: number; height: number };
type Album = { id: string; name: string; author: string; iconUri: string; stickers: Sticker[] };

const ALBUMS_STORAGE_KEY = '@app-de-figurinhas/albums';

export default function AlbumsScreen() {
  const router = useRouter();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let active = true;

    async function loadAlbums() {
      setLoading(true);
      try {
        const storedAlbums = await AsyncStorage.getItem(ALBUMS_STORAGE_KEY);
        const parsedAlbums = storedAlbums ? JSON.parse(storedAlbums) as Album[] : [];
        if (active) setAlbums(Array.isArray(parsedAlbums) ? parsedAlbums : []);
      } catch {
        if (active) {
          setAlbums([]);
          Alert.alert('Nao foi possivel carregar', 'Tente abrir a tela de albuns novamente.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAlbums();
    return () => {
      active = false;
    };
  }, []));

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>Meus albuns</ThemedText>
      <ThemedText style={styles.subtitle}>Organize suas figurinhas em pacotes.</ThemedText>

      {loading ? (
        <ThemedText style={styles.emptyText}>Carregando albuns...</ThemedText>
      ) : albums.length === 0 ? (
        <View style={styles.emptyState}>
          <ThemedText style={styles.emptyText}>Voce ainda nao criou nenhum album.</ThemedText>
          <Pressable onPress={() => router.push('/')} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <ThemedText style={styles.primaryText}>Criar primeiro album</ThemedText>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {albums.map((album) => (
            <Pressable key={album.id} onPress={() => router.push({ pathname: '/album/[id]', params: { id: album.id } })} style={({ pressed }) => [styles.albumCard, pressed && styles.pressed]}>
              <Image source={{ uri: album.iconUri }} style={styles.albumIcon} />
              <View style={styles.albumInfo}>
                <ThemedText style={styles.albumName}>{album.name}</ThemedText>
                <ThemedText style={styles.albumAuthor}>{album.author}</ThemedText>
                <ThemedText style={styles.albumCount}>{album.stickers.length}/30 figurinhas</ThemedText>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 12, padding: 24 },
  title: { marginTop: 24, color: '#172033' },
  subtitle: { color: '#4A5568' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  emptyText: { color: '#4A5568', textAlign: 'center' },
  primaryButton: { width: '100%', maxWidth: 320, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#1769E0' },
  primaryText: { color: '#FFFFFF', fontWeight: '700' },
  list: { gap: 12, paddingVertical: 20 },
  albumCard: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 12, borderWidth: 1, borderColor: '#CBD5E0', borderRadius: 8, backgroundColor: '#FFFFFF' },
  albumIcon: { width: 72, height: 72 },
  albumInfo: { flex: 1, gap: 3 },
  albumName: { color: '#172033', fontSize: 18, fontWeight: '700' },
  albumAuthor: { color: '#4A5568' },
  albumCount: { color: '#1769E0', fontWeight: '700' },
  pressed: { opacity: 0.75 },
});