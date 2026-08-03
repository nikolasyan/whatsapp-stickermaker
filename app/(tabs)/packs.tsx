import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Checker } from '@/components/jambo/checker';
import { FloatingMark } from '@/components/jambo/floating-mark';
import { JamboIcon } from '@/components/jambo/icons';
import { StatusPill } from '@/components/jambo/ui';
import { JamboFonts, JamboRadius } from '@/constants/jambo-theme';
import { useJamboTheme } from '@/hooks/use-jambo-theme';
import { MAX_STICKERS, computeReadiness, loadPacks, type Pack } from '@/lib/packs';

const THUMB_SLOTS = 4;

type PackRow = { pack: Pack; warnings: number };

export default function PacksScreen() {
  const router = useRouter();
  const { palette, scheme } = useJamboTheme();
  const [rows, setRows] = useState<PackRow[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        try {
          const packs = await loadPacks();
          // computeReadiness le o disco; roda uma vez por foco, nunca por render.
          const next = packs.map((pack) => ({
            pack,
            warnings: computeReadiness(pack).items.filter((item) => !item.ok).length,
          }));
          if (active) setRows(next);
        } catch {
          if (active) setRows([]);
        } finally {
          if (active) setLoading(false);
        }
      }
      load();
      return () => {
        active = false;
      };
    }, []),
  );

  const totalStickers = rows.reduce((sum, row) => sum + row.pack.stickers.length, 0);

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.bg }]}>
      <View style={styles.titleBlock}>
        <Text style={[styles.title, { color: palette.text }]}>Seus pacotes</Text>
        <Text style={[styles.meta, { color: palette.textMuted }]}>
          {loading
            ? 'carregando...'
            : `${rows.length} ${rows.length === 1 ? 'pacote' : 'pacotes'} · ${totalStickers} ${totalStickers === 1 ? 'figurinha' : 'figurinhas'}`}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {rows.map(({ pack, warnings }) => {
          const thumbs = pack.stickers.slice(0, THUMB_SLOTS);
          const overflow = pack.stickers.length - thumbs.length;
          return (
            <Pressable
              key={pack.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/pack/[id]', params: { id: pack.id } })}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: palette.surface, borderColor: palette.border },
                pressed && styles.pressed,
              ]}>
              <View style={styles.thumbRow}>
                {Array.from({ length: THUMB_SLOTS }, (_, index) => {
                  const sticker = thumbs[index];
                  const isOverflowSlot = index === THUMB_SLOTS - 1 && overflow > 0;
                  if (isOverflowSlot) {
                    return (
                      <View
                        key="overflow"
                        style={[styles.thumb, styles.overflowThumb, { borderColor: palette.borderDashed }]}>
                        <Text style={{ color: palette.textMuted, fontFamily: JamboFonts.monoMedium, fontSize: 12 }}>
                          +{overflow + 1}
                        </Text>
                      </View>
                    );
                  }
                  if (!sticker) return <View key={index} style={[styles.thumb, { backgroundColor: palette.surfaceElevated }]} />;
                  return (
                    <Checker
                      key={sticker.id}
                      cell={14}
                      light={palette.checkerLight}
                      dark={palette.checkerDark}
                      style={styles.thumb}>
                      <Image source={{ uri: sticker.processedUri }} style={styles.thumbImage} resizeMode="contain" />
                    </Checker>
                  );
                })}
              </View>

              <View style={styles.cardFooter}>
                <View style={styles.cardInfo}>
                  <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={1}>
                    {pack.name}
                  </Text>
                  <Text style={[styles.cardMeta, { color: palette.textMuted }]} numberOfLines={1}>
                    {pack.stickers.length}/{MAX_STICKERS} · por {pack.author}
                  </Text>
                </View>
                {warnings > 0 ? (
                  <StatusPill palette={palette} tone="warning" label={`${warnings} ${warnings === 1 ? 'aviso' : 'avisos'}`} />
                ) : (
                  <StatusPill
                    palette={palette}
                    tone="success"
                    icon="check"
                    label={pack.exportedAt ? 'No WhatsApp' : 'Pronto'}
                  />
                )}
              </View>
            </Pressable>
          );
        })}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/')}
          style={({ pressed }) => [styles.newCard, { borderColor: palette.border }, pressed && styles.pressed]}>
          <FloatingMark
            size={36}
            slow
            body={scheme === 'dark' ? '#3B141F' : '#F6D9DD'}
            leaf={scheme === 'dark' ? '#123322' : '#D9E9DF'}
          />
          <View style={styles.newCardInfo}>
            <Text style={[styles.newCardTitle, { color: palette.textSecondary }]}>Novo pacote</Text>
            <Text style={[styles.newCardHint, { color: palette.textMuted }]}>
              Até {MAX_STICKERS} figurinhas por pacote
            </Text>
          </View>
          <JamboIcon name="plusSmall" size={20} color={palette.accent} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  titleBlock: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 18, gap: 5 },
  title: { fontFamily: JamboFonts.display, fontSize: 32, lineHeight: 34, letterSpacing: -1.1 },
  meta: { fontFamily: JamboFonts.monoMedium, fontSize: 13 },
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  card: { borderRadius: JamboRadius.xl, borderWidth: 1, padding: 14, gap: 12 },
  thumbRow: { flexDirection: 'row', gap: 8 },
  thumb: { flex: 1, aspectRatio: 1, borderRadius: JamboRadius.md },
  overflowThumb: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed' },
  thumbImage: { width: '100%', height: '100%' },
  cardFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  cardInfo: { flex: 1, gap: 3 },
  cardName: { fontFamily: JamboFonts.displaySemi, fontSize: 18 },
  cardMeta: { fontFamily: JamboFonts.monoMedium, fontSize: 12 },
  newCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: JamboRadius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  newCardInfo: { flex: 1, gap: 3 },
  newCardTitle: { fontFamily: JamboFonts.displaySemi, fontSize: 15 },
  newCardHint: { fontFamily: JamboFonts.body, fontSize: 12.5, lineHeight: 17 },
  pressed: { opacity: 0.75 },
});
