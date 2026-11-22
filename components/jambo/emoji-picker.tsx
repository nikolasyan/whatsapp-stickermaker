import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/jambo/ui';
import { JamboFonts, JamboRadius, type JamboPalette } from '@/constants/jambo-theme';
import { MAX_EMOJIS } from '@/lib/packs';

/**
 * Conjunto curado em vez de um TextInput com teclado de emoji.
 *
 * O WhatsApp recusa o pacote inteiro se uma entrada de emoji for invalida, e
 * validar "isto e realmente um emoji?" em JS depende de escapes de propriedade
 * Unicode que nao sao confiaveis no Hermes. Com uma lista fechada o problema
 * nao existe, e escolher fica mais rapido do que abrir o teclado.
 */
const EMOJIS = [
  // Rostos
  '😀', '😁', '😂', '🤣', '😅', '😊', '😍', '🥰', '😘', '😎',
  '🤔', '🤨', '😐', '🙄', '😏', '😢', '😭', '😤', '😡', '🤯',
  '😱', '🥳', '🤩', '🥺', '😴', '🤤', '😬', '🙃', '🤫', '🤪',
  // Gestos
  '👍', '👎', '👌', '👏', '🙏', '💪', '🤝', '👊', '🫡', '🖐️',
  // Simbolos e reacoes
  '❤️', '🔥', '✨', '💯', '🎉', '⭐', '💀', '🤡', '👀', '🧠',
  '💩', '😈', '🫂', '💔',
  // Bichos
  '🐶', '🐱', '🐵', '🙈', '🐷', '🦅',
  // Coisas
  '☕', '🍻', '⚽', '🎮', '💸', '🚀',
] as const;

export function EmojiPicker({
  palette,
  initial,
  onCancel,
  onConfirm,
}: {
  palette: JamboPalette;
  initial: string[];
  onCancel: () => void;
  /** Lista vazia significa "voltar ao padrao". */
  onConfirm: (emojis: string[]) => void;
}) {
  // Montado so quando aberto, entao o estado inicial vale por abertura.
  const [selected, setSelected] = useState<string[]>(() => initial.slice(0, MAX_EMOJIS));

  function toggle(emoji: string) {
    setSelected((previous) => {
      if (previous.includes(emoji)) return previous.filter((item) => item !== emoji);
      // Cheio: ignora em vez de substituir — trocar um emoji que o usuario nao
      // apontou seria uma escolha silenciosa pelas costas dele.
      if (previous.length >= MAX_EMOJIS) return previous;
      return [...previous, emoji];
    });
  }

  const full = selected.length >= MAX_EMOJIS;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={[styles.scrim, { backgroundColor: palette.scrim }]} onPress={onCancel} />
      <View style={[styles.sheet, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>
        <View style={[styles.grabber, { backgroundColor: palette.border }]} />

        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: palette.text }]}>Emojis da figurinha</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            O WhatsApp usa eles na busca de figurinhas. Até {MAX_EMOJIS} — ou deixe em branco para
            usar o padrão.
          </Text>
        </View>

        <View style={[styles.preview, { backgroundColor: palette.surfaceElevated, borderColor: palette.border }]}>
          {selected.length > 0 ? (
            <Text style={styles.previewEmojis}>{selected.join('  ')}</Text>
          ) : (
            <Text style={{ color: palette.textMuted, fontFamily: JamboFonts.body, fontSize: 13.5 }}>
              Nenhum escolhido · o padrão 😀 será usado
            </Text>
          )}
          <Text style={{ color: palette.textMuted, fontFamily: JamboFonts.monoMedium, fontSize: 11.5 }}>
            {selected.length}/{MAX_EMOJIS}
          </Text>
        </View>

        <ScrollView style={styles.gridScroll} contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {EMOJIS.map((emoji) => {
            const active = selected.includes(emoji);
            return (
              <Pressable
                key={emoji}
                onPress={() => toggle(emoji)}
                accessibilityRole="button"
                accessibilityLabel={`Emoji ${emoji}`}
                accessibilityState={{ selected: active, disabled: !active && full }}
                style={({ pressed }) => [
                  styles.cell,
                  {
                    backgroundColor: active ? palette.accentMuted : 'transparent',
                    borderColor: active ? palette.accent : 'transparent',
                  },
                  !active && full && styles.dimmed,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.cellEmoji}>{emoji}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <PrimaryButton label="Salvar" palette={palette} onPress={() => onConfirm(selected)} />
        <View style={styles.footerRow}>
          <Pressable
            onPress={() => setSelected([])}
            accessibilityRole="button"
            style={styles.footerAction}
            hitSlop={6}>
            <Text style={{ color: palette.accentSoft, fontFamily: JamboFonts.bodyBold, fontSize: 14 }}>
              Limpar
            </Text>
          </Pressable>
          <Pressable onPress={onCancel} accessibilityRole="button" style={styles.footerAction} hitSlop={6}>
            <Text style={{ color: palette.textMuted, fontFamily: JamboFonts.bodyBold, fontSize: 14 }}>
              Cancelar
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '86%',
    borderTopLeftRadius: JamboRadius.xxl,
    borderTopRightRadius: JamboRadius.xxl,
    borderTopWidth: 1,
    paddingTop: 14,
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 12,
  },
  grabber: { width: 42, height: 4, borderRadius: JamboRadius.pill, alignSelf: 'center' },
  titleBlock: { gap: 4 },
  title: { fontFamily: JamboFonts.displaySemi, fontSize: 21, letterSpacing: -0.4 },
  subtitle: { fontFamily: JamboFonts.body, fontSize: 13, lineHeight: 19 },
  preview: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: JamboRadius.md,
    borderWidth: 1,
  },
  previewEmojis: { fontSize: 24 },
  gridScroll: { flexGrow: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, paddingVertical: 2 },
  cell: {
    width: '10%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: JamboRadius.sm,
    borderWidth: 1.5,
  },
  cellEmoji: { fontSize: 23 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  footerAction: { minHeight: 40, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  dimmed: { opacity: 0.35 },
});
