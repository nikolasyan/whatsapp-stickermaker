import { useRouter } from 'expo-router';
import ImageCropPicker from 'react-native-image-crop-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Checker } from '@/components/jambo/checker';
import { JamboIcon, type JamboIconName } from '@/components/jambo/icons';
import { JamboMark } from '@/components/jambo/jambo-mark';
import { IconButton, PrimaryButton } from '@/components/jambo/ui';
import { JamboFonts, JamboRadius, type JamboPalette } from '@/constants/jambo-theme';
import { useJamboTheme } from '@/hooks/use-jambo-theme';
import {
  MAX_ANIMATION_MS,
  MAX_STICKERS,
  isAnimatedPack,
  loadPacks,
  mutatePacks,
  newId,
  storageErrorMessage,
  type Pack,
  type Sticker,
  type StickerMode,
} from '@/lib/packs';
import { getQueue } from '@/lib/sticker-queue';
import { animatedPreview, buildAnimatedSticker, buildSticker, stageSourceImage } from '@/lib/stickers';

/** Decisao de enquadramento de UMA imagem do lote. */
type Decision = { mode: StickerMode; croppedUri: string | null };

const DEFAULT_DECISION: Decision = { mode: 'original', croppedUri: null };

export default function EditorScreen() {
  const router = useRouter();
  const { palette } = useJamboTheme();

  // Copia a fila para estado local na montagem; dali em diante o editor e o
  // dono dela. Um reload do app zera o modulo e cai no aviso mais abaixo.
  const [initial] = useState(getQueue);
  /** Fila homogenea: o tipo vem da escolha feita na tela Criar. */
  const animated = initial.animated;
  const [images, setImages] = useState(initial.images);
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>(() => initial.images.map(() => DEFAULT_DECISION));
  const [staging, setStaging] = useState(false);
  /**
   * Previa animada por URI + MODO.
   *
   * Nao por posicao: o "Descartar esta" desloca os indices e um mapa por
   * posicao passaria a mostrar a previa de outro arquivo. E o modo entra na
   * chave porque Original e Preencher produzem resultados diferentes.
   * `undefined` = gerando, `null` = falhou.
   */
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  /** Chaves cujo job nativo ja comecou — evita disparar o mesmo duas vezes. */
  const startedPreviews = useRef<Set<string>>(new Set());
  const [saveSheetVisible, setSaveSheetVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [newName, setNewName] = useState('');
  const [newAuthor, setNewAuthor] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const total = images.length;
  const current = images[index];
  const decision = decisions[index] ?? DEFAULT_DECISION;
  const mode = decision.mode;
  const displayedUri = decision.croppedUri ?? current?.sourceUri;
  const isLast = index >= total - 1;

  const previewKey = current && animated ? `${current.sourceUri}|${mode}` : null;

  useEffect(() => {
    // Gera a previa pelo MESMO pipeline da figurinha final, so menor. E o unico
    // jeito de a previa mostrar o movimento e o enquadramento de verdade — e
    // para video e tambem o unico jeito de mostrar qualquer coisa, porque o
    // <Image> do RN nao renderiza video.
    // `previews` so recebe a chave quando o nativo TERMINA, entao checar so por
    // ele deixa passar um segundo job para a mesma chave enquanto o primeiro
    // roda — dois encodings concorrentes gravando o mesmo arquivo de cache, e o
    // resultado do primeiro descartado. O ref marca a chave na largada.
    if (!current || !previewKey || previewKey in previews || startedPreviews.current.has(previewKey)) return;
    startedPreviews.current.add(previewKey);
    let active = true;
    animatedPreview(
      current.sourceUri,
      previewKey.replace(/[^a-zA-Z0-9]/g, '').slice(-48),
      mode,
      current.kind === 'video' ? 'video' : 'gif',
    )
      .then((preview) => {
        if (active) setPreviews((previous) => ({ ...previous, [previewKey]: preview.uri }));
      })
      .catch((error) => {
        // Previa e conveniencia: falhar aqui nao pode impedir de gerar a
        // figurinha, so cai no aviso de que nao ha pre-visualizacao.
        console.warn('[editor] nao foi possivel gerar a previa', error);
        if (active) setPreviews((previous) => ({ ...previous, [previewKey]: null }));
      });
    return () => {
      active = false;
    };
  }, [current, previewKey, mode, previews]);

  function setCurrentDecision(value: Decision) {
    setDecisions((previous) => previous.map((item, position) => (position === index ? value : item)));
  }

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
    if (!current || staging) return;
    setStaging(true);
    try {
      // A conversao para PNG roda SO aqui, e nao ao escolher as fotos: ela
      // existe apenas porque o uCrop nao abre WebP (e a galeria esta cheia
      // deles). Quem usa a imagem inteira nunca paga por ela — num lote de 12
      // fotos isso evita 12 reencodes de vários MB jogados fora.
      const staged = await stageSourceImage(current.sourceUri);
      const result = await ImageCropPicker.openCropper(cropperOptions(staged));
      // O <Image> do preview so carrega com esquema; o recortador pode devolver caminho puro.
      setCurrentDecision({
        mode: 'crop',
        croppedUri: result.path.startsWith('file://') ? result.path : `file://${result.path}`,
      });
    } catch (error) {
      // Cancelar o editor nativo tambem rejeita a Promise — so isso e silencioso.
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
      if (code === 'E_PICKER_CANCELLED') return;
      console.warn('[editor] openCropper falhou', code, error);
      Alert.alert(
        'Não foi possível recortar',
        error instanceof Error && error.message ? error.message : 'O editor de recorte não abriu.',
      );
    } finally {
      setStaging(false);
    }
  }

  /** Descarta a imagem atual do lote — util quando uma das escolhidas nao presta. */
  function skipCurrent() {
    if (total <= 1) {
      router.back();
      return;
    }
    setImages((previous) => previous.filter((_, position) => position !== index));
    setDecisions((previous) => previous.filter((_, position) => position !== index));
    // Ao descartar a ultima, o indice precisa recuar para continuar valido.
    setIndex((previous) => Math.min(previous, total - 2));
  }

  /** Saida rapida: manda o resto do lote como imagem inteira e vai salvar. */
  function useWholeForRest() {
    setDecisions((previous) =>
      previous.map((item, position) => (position < index ? item : DEFAULT_DECISION)),
    );
    openSaveSheet();
  }

  async function openSaveSheet() {
    // Dois toques carregavam os pacotes duas vezes. Nao quebrava nada, mas a
    // segunda leitura chegava depois da folha abrir e podia trocar a lista
    // debaixo do dedo.
    if (saveSheetVisible) return;
    try {
      setPacks(await loadPacks());
      setSaveSheetVisible(true);
    } catch (error) {
      Alert.alert('Não foi possível carregar', storageErrorMessage(error));
    }
  }

  /**
   * Gera todas as figurinhas do lote.
   *
   * Uma imagem problematica NAO descarta o lote: ela e contada em `failed` e o
   * resto segue. Descartar 11 figurinhas boas porque a 7a falhou seria pior do
   * que salvar 11 e avisar sobre uma.
   */
  async function buildAll(): Promise<{ stickers: Sticker[]; failed: number }> {
    const stickers: Sticker[] = [];
    let failed = 0;
    setProgress({ done: 0, total });
    try {
      for (let position = 0; position < images.length; position++) {
        const stickerId = newId('sticker');
        const item = decisions[position] ?? DEFAULT_DECISION;
        try {
          // O recorte escolhido, ou a imagem de origem nos modos original/stretch.
          const source = item.croppedUri ?? images[position].sourceUri;
          // Caminhos genuinamente diferentes: a animada decodifica o GIF, compoe
          // os frames e codifica WebP animado, tudo no nativo.
          if (animated) {
            const built = await buildAnimatedSticker(
              source,
              stickerId,
              item.mode,
              // GIF e video tem extratores diferentes no nativo, mas produzem o
              // mesmo WebP animado e podem conviver num pacote.
              images[position].kind === 'video' ? 'video' : 'gif',
            );
            stickers.push({
              id: stickerId,
              processedUri: built.uri,
              mode: item.mode,
              format: 'webp',
              width: built.width,
              height: built.height,
              durationMs: built.durationMs,
              frameCount: built.frameCount,
            });
          } else {
            const built = await buildSticker(source, stickerId, item.mode);
            stickers.push({
              id: stickerId,
              processedUri: built.uri,
              mode: item.mode,
              format: 'webp',
              width: built.width,
              height: built.height,
            });
          }
        } catch (error) {
          console.warn('[editor] falhou ao gerar a figurinha', position, error);
          failed += 1;
        }
        setProgress({ done: position + 1, total });
      }
    } finally {
      setProgress(null);
    }
    return { stickers, failed };
  }

  /** Navega para o pacote, avisando antes se alguma figurinha ficou pelo caminho. */
  function finish(packId: string, failed: number) {
    const go = () => router.replace({ pathname: '/pack/[id]', params: { id: packId } });
    if (failed === 0) {
      go();
      return;
    }
    Alert.alert(
      'Algumas imagens não deram',
      `${failed} ${failed === 1 ? 'imagem não pôde' : 'imagens não puderam'} ser convertida${failed === 1 ? '' : 's'} em figurinha. O resto foi salvo.`,
      [{ text: 'Entendi', onPress: go }],
    );
  }

  async function addToPack(pack: Pack) {
    if (busy) return;
    setBusy(true);
    try {
      const { stickers, failed } = await buildAll();
      if (stickers.length === 0) {
        Alert.alert('Não foi possível gerar as figurinhas', 'Tente novamente com outras imagens.');
        return;
      }
      await mutatePacks((currentPacks) =>
        currentPacks.map((item) =>
          item.id === pack.id ? { ...item, stickers: [...item.stickers, ...stickers] } : item,
        ),
      );
      setSaveSheetVisible(false);
      finish(pack.id, failed);
    } catch (error) {
      Alert.alert('Não foi possível salvar', storageErrorMessage(error));
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
      const { stickers, failed } = await buildAll();
      if (stickers.length === 0) {
        Alert.alert('Não foi possível gerar as figurinhas', 'Tente novamente com outras imagens.');
        return;
      }
      const pack: Pack = {
        id: newId('pack'),
        name,
        author,
        // O URI persistido da figurinha sobrevive a limpeza de cache; o do preview nao.
        iconUri: stickers[0].processedUri,
        // O pacote nasce com o tipo da fila: o WhatsApp nao aceita misturar, e
        // depois de criado nao ha como converter.
        ...(animated ? { animated: true } : {}),
        stickers,
      };
      await mutatePacks((currentPacks) => [...currentPacks, pack]);
      setCreateVisible(false);
      setSaveSheetVisible(false);
      finish(pack.id, failed);
    } catch (error) {
      Alert.alert('Não foi possível salvar', storageErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  // A fila vive em memoria: um reload do app no meio da edicao a perde. Sem
  // este aviso a tela abriria com a area de imagem em branco, sem explicacao.
  if (total === 0 || !current) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, styles.empty, { backgroundColor: palette.bg }]}>
        <Text style={[styles.emptyTitle, { color: palette.text }]}>Nenhuma imagem para editar</Text>
        <Text style={[styles.emptyBody, { color: palette.textMuted }]}>
          A seleção foi perdida, provavelmente porque o app recarregou. Escolha as fotos de novo.
        </Text>
        <PrimaryButton label="Escolher fotos" palette={palette} onPress={() => router.replace('/')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: palette.bg }]}>
      <View style={styles.header}>
        <IconButton name="back" palette={palette} accessibilityLabel="Voltar" onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: palette.textSecondary }]}>
          {total > 1
            ? `${animated ? 'Animada' : 'Figurinha'} ${index + 1} de ${total}`
            : animated
              ? 'Editar animada'
              : 'Editar figurinha'}
        </Text>
        <Pressable
          onPress={openSaveSheet}
          accessibilityRole="button"
          style={({ pressed }) => [styles.headerCta, { backgroundColor: palette.accent }, pressed && styles.pressed]}>
          <Text style={{ color: palette.onAccent, fontFamily: JamboFonts.bodyBold, fontSize: 14 }}>
            {total > 1 ? 'Salvar tudo' : 'Prosseguir'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.canvasWrap}>
        <Checker
          cell={24}
          light={palette.checkerLight}
          dark={palette.checkerDark}
          style={[styles.canvas, { borderColor: palette.border }]}>
          {/* O resizeMode espelha o que o arquivo final vai ser: `contain` quando a
              imagem e centralizada num quadrado transparente (crop/original) e
              `stretch` no modo Preencher. Nunca `cover`, que mostrava um
              enquadramento ampliado e cortado que o arquivo gerado nao tinha. */}
          <View style={styles.imageArea}>
            {/* O <Image> do RN nao renderiza video. Em vez de um canvas em
                branco que parece defeito, diz o que esta acontecendo. */}
            {animated && previewKey ? (
              previews[previewKey] ? (
                // `contain` sempre: o enquadramento (incluindo o esticado do
                // modo Preencher) ja esta embutido no arquivo da previa.
                // Aplicar `stretch` aqui distorceria uma segunda vez.
                <Image source={{ uri: previews[previewKey] as string }} style={styles.canvasImage} resizeMode="contain" />
              ) : (
                <View style={styles.videoPlaceholder}>
                  {previewKey in previews ? (
                    <JamboIcon name="frame" size={46} color={palette.textMuted} />
                  ) : (
                    <ActivityIndicator size="small" color={palette.textMuted} />
                  )}
                  <Text style={[styles.videoPlaceholderTitle, { color: palette.textSecondary }]}>
                    {current.kind === 'video' ? 'Vídeo' : 'GIF'}
                  </Text>
                  <Text style={[styles.videoPlaceholderBody, { color: palette.textMuted }]}>
                    {previewKey in previews
                      ? `Não foi possível pré-visualizar este arquivo, mas a figurinha ainda pode ser gerada. Os primeiros ${MAX_ANIMATION_MS / 1000} s viram a animação.`
                      : 'Montando a prévia animada...'}
                  </Text>
                </View>
              )
            ) : (
              <Image
                source={{ uri: displayedUri }}
                style={styles.canvasImage}
                resizeMode={mode === 'stretch' ? 'stretch' : 'contain'}
              />
            )}
          </View>
          <View style={[styles.dimensionBadge, { backgroundColor: palette.bg }]}>
            <Text style={{ color: palette.leaf, fontFamily: JamboFonts.monoMedium, fontSize: 10.5 }}>512 × 512</Text>
          </View>
        </Checker>
      </View>

      <View style={styles.tools}>
        {/* Sem recorte na animada: o uCrop abre uma imagem estatica e
            devolveria um frame so, destruindo a animacao. */}
        {animated ? null : (
          <ToolTab
            palette={palette}
            icon="crop"
            label={staging ? 'Abrindo...' : 'Recortar'}
            active={mode === 'crop'}
            busy={staging}
            onPress={openCropper}
          />
        )}
        <ToolTab
          palette={palette}
          icon="square"
          label="Original"
          active={mode === 'original'}
          onPress={() => setCurrentDecision(DEFAULT_DECISION)}
        />
        <ToolTab
          palette={palette}
          icon="expand"
          label="Preencher"
          active={mode === 'stretch'}
          onPress={() => setCurrentDecision({ mode: 'stretch', croppedUri: null })}
        />
      </View>

      <View style={styles.spacer} />

      <View style={styles.footer}>
        <View style={styles.statusRow}>
          {/* No modo Preencher a imagem e distorcida de proposito — avisar e mais
              honesto do que deixar o usuario descobrir na figurinha pronta. */}
          <JamboIcon
            name={mode === 'stretch' ? 'warning' : 'check'}
            size={15}
            color={mode === 'stretch' ? palette.warning : palette.leaf}
          />
          <Text
            style={{
              color: mode === 'stretch' ? palette.warning : palette.leaf,
              fontFamily: JamboFonts.monoMedium,
              fontSize: 12,
              flexShrink: 1,
            }}>
            {mode === 'stretch'
              ? 'a imagem será esticada para preencher o quadrado'
              : animated
                ? 'webp animado · até 10 s, comprimido até caber em 500 KB'
                : 'webp · comprimido até caber em 100 KB'}
          </Text>
        </View>
        <View style={styles.footerButtons}>
          <Pressable
            onPress={skipCurrent}
            accessibilityRole="button"
            style={({ pressed }) => [styles.outlineButton, { borderColor: palette.accent }, pressed && styles.pressed]}>
            <Text style={{ color: palette.accentSoft, fontFamily: JamboFonts.bodyBold, fontSize: 15 }}>
              {total > 1 ? 'Descartar esta' : 'Outra imagem'}
            </Text>
          </Pressable>
          {isLast ? (
            <PrimaryButton
              label={total > 1 ? 'Salvar tudo' : 'Prosseguir'}
              palette={palette}
              onPress={openSaveSheet}
              style={styles.grow}
            />
          ) : (
            <PrimaryButton
              label="Próxima"
              palette={palette}
              onPress={() => setIndex((previous) => previous + 1)}
              style={styles.grow}
            />
          )}
        </View>

        {/* Saida rapida do lote: quem nao quer recortar o resto nao precisa
            passar imagem por imagem so para chegar ao fim da fila. */}
        {isLast ? null : (
          <Pressable
            onPress={useWholeForRest}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => [styles.restLink, pressed && styles.pressed]}>
            <Text style={{ color: palette.textMuted, fontFamily: JamboFonts.bodyBold, fontSize: 13.5 }}>
              Usar a imagem inteira nas {total - index} restantes
            </Text>
          </Pressable>
        )}
      </View>

      <SaveSheet
        visible={saveSheetVisible && !createVisible}
        palette={palette}
        packs={packs}
        busy={busy}
        needed={total}
        needsAnimated={animated}
        progress={progress}
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
  busy,
  onPress,
}: {
  palette: JamboPalette;
  icon: JamboIconName;
  label: string;
  active: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ selected: active, busy: Boolean(busy), disabled: Boolean(busy) }}
      style={({ pressed }) => [
        styles.tool,
        {
          backgroundColor: active ? palette.accentMuted : palette.surface,
          borderColor: active ? palette.accent : palette.border,
          borderWidth: active ? 1.5 : 1,
        },
        pressed && styles.pressed,
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={active ? palette.accentSoft : palette.textSecondary} />
      ) : (
        <JamboIcon name={icon} size={20} color={active ? palette.accentSoft : palette.textSecondary} />
      )}
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
  needed,
  needsAnimated,
  progress,
  onClose,
  onPick,
  onCreate,
}: {
  visible: boolean;
  palette: JamboPalette;
  packs: Pack[];
  busy: boolean;
  /** Quantas figurinhas o lote vai adicionar — define se o pacote tem espaco. */
  needed: number;
  /** Tipo do lote: so pacotes do mesmo tipo podem receber. */
  needsAnimated: boolean;
  progress: { done: number; total: number } | null;
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
          <View style={styles.sheetTitleRow}>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>
              {needed > 1 ? `Onde salvar as ${needed} figurinhas?` : 'Onde salvar a figurinha?'}
            </Text>
            {busy ? <ActivityIndicator size="small" color={palette.accentSoft} /> : null}
          </View>
          <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>
            {progress
              ? `Gerando ${progress.done} de ${progress.total} — quadrando e comprimindo até caber em 100 KB.`
              : needed > 1
                ? 'Elas entram no pacote agora e você continua montando depois.'
                : 'Ela entra no pacote agora e você continua montando depois.'}
          </Text>
        </View>

        <View style={styles.sheetList}>
          {packs.map((pack) => {
            // O lote inteiro precisa caber: aceitar um pacote com 2 vagas para
            // 12 figurinhas estouraria o limite de 30 do WhatsApp.
            const free = MAX_STICKERS - pack.stickers.length;
            // O WhatsApp proibe misturar: "packs must contain either static or
            // animated stickers, never a mix of both".
            const sameKind = isAnimatedPack(pack) === needsAnimated;
            const fits = free >= needed && sameKind;
            return (
              <Pressable
                key={pack.id}
                disabled={!fits || busy}
                onPress={() => onPick(pack)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.packRow,
                  { backgroundColor: palette.surfaceElevated, borderColor: palette.border },
                  !fits && styles.disabled,
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
                      color: fits ? palette.accentSoft : palette.textMuted,
                      fontFamily: JamboFonts.monoMedium,
                      fontSize: 12,
                    }}>
                    {fits
                      ? `${pack.stickers.length}/${MAX_STICKERS} figurinhas`
                      : !sameKind
                        ? needsAnimated
                          ? 'pacote estático · não aceita animadas'
                          : 'pacote animado · não aceita estáticas'
                        : free === 0
                          ? `${MAX_STICKERS}/${MAX_STICKERS} · cheio`
                          : `só cabem ${free} · precisa de ${needed}`}
                  </Text>
                </View>
                {fits ? <JamboIcon name="chevronRight" size={18} color={palette.textMuted} /> : null}
              </Pressable>
            );
          })}
        </View>

        <PrimaryButton label="Criar novo pacote" icon="plusSmall" palette={palette} onPress={onCreate} disabled={busy} />
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]}>
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
          <PrimaryButton label={busy ? 'Criando...' : 'Criar pacote'} palette={palette} onPress={onConfirm} busy={busy} />
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]}>
            <Text style={{ color: palette.textMuted, fontFamily: JamboFonts.bodyBold, fontSize: 15 }}>Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 },
  emptyTitle: { fontFamily: JamboFonts.displaySemi, fontSize: 21, textAlign: 'center' },
  emptyBody: { fontFamily: JamboFonts.body, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  restLink: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 34 },
  videoPlaceholderTitle: { fontFamily: JamboFonts.displaySemi, fontSize: 17 },
  videoPlaceholderBody: { fontFamily: JamboFonts.body, fontSize: 13, lineHeight: 19, textAlign: 'center' },
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
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
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
