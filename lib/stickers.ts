import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { NativeModules } from 'react-native';

import { MAX_STICKER_BYTES, type StickerMode } from '@/lib/packs';

const STICKERS_DIRECTORY = 'stickers';
/** Previas animadas no cache — a limpeza do boot conhece este nome. */
const PREVIEWS_DIRECTORY = 'previews';
const STICKER_SIDE = 512;
const QUALITY_STEPS = [0.9, 0.75, 0.6, 0.45, 0.3, 0.15];

const imageModule = NativeModules.WhatsAppStickerModule as
  | { padToSquarePng(sourceUri: string): Promise<string> }
  | undefined;

/**
/**
 * Caminho permanente e vazio para uma figurinha, com o diretorio garantido.
 *
 * Por que o diretorio de documentos e nao o cache: o URI fica salvo no
 * AsyncStorage, e o manipulateAsync (como todo o resto) grava no cache interno,
 * que o Android limpa sozinho. Uma figurinha apontando para o cache e uma
 * figurinha que some.
 */
function stickerDestination(stickerId: string): File {
  const directory = new Directory(Paths.document, STICKERS_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true });
  const destination = new File(directory, `${stickerId}.webp`);
  if (destination.exists) destination.delete();
  return destination;
}

export function persistSticker(temporaryUri: string, stickerId: string): string {
  const destination = stickerDestination(stickerId);
  new File(temporaryUri).copy(destination);
  return destination.uri;
}

/**
 * Grava uma figurinha vinda de um pacote importado, que chega em base64
 * dentro do arquivo .jambo.json em vez de como arquivo no disco.
 */
export function persistStickerFromBase64(base64: string, stickerId: string): string {
  const destination = stickerDestination(stickerId);
  destination.create();
  destination.write(base64, { encoding: 'base64' });
  return destination.uri;
}

/** Apaga um arquivo sem falhar se ele ja nao existe. */
function deleteQuietly(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Arquivo ja removido ou fora do nosso diretorio — nada a fazer.
  }
}

export function deleteStickerFile(uri: string) {
  deleteQuietly(uri);
}

/**
 * Apaga os intermediarios de imagem acumulados no cache.
 *
 * Sao quatro fontes, e nenhuma se limpa sozinha:
 *  - `cache/ImagePicker/`: as copias em resolucao cheia que o expo-image-picker
 *    faz de cada foto escolhida (CACHE_DIR_NAME na lib). Com selecao multipla
 *    de 12 fotos sao 12 copias — dezenas de MB por lote;
 *  - `cache/ImageManipulator/`: os PNGs do stageSourceImage. O
 *    expo-image-manipulator grava tudo ai (veja FileUtils.kt na lib) e cada
 *    foto da galeria reencodada em PNG tem vários MB;
 *  - `cache/pad_*.png`: os quadrados transparentes do modulo nativo;
 *  - `cache/exports/`: os .jambo.json gerados ao compartilhar um pacote.
 *
 * Roda no boot do app: nesse momento nada esta em uso, e nenhuma figurinha
 * salva mora no cache — persistSticker sempre copia para o diretorio de
 * documentos justamente porque o Android limpa o cache quando quer.
 */
export function clearTransientCache() {
  try {
    for (const name of ['ImagePicker', 'ImageManipulator', 'exports', PREVIEWS_DIRECTORY]) {
      const directory = new Directory(Paths.cache, name);
      if (directory.exists) directory.delete();
    }
    for (const entry of new Directory(Paths.cache).list()) {
      // Sem checar `name`: esta versao da API nao expoe o nome do arquivo.
      if (entry instanceof File && entry.uri.includes('/pad_')) deleteQuietly(entry.uri);
    }
  } catch {
    // Limpeza e oportunista — uma falha aqui nao pode impedir o app de abrir.
  }
}

/**
 * Reencoda a imagem escolhida para PNG antes de entregar ao editor.
 *
 * O uCrop (dentro do react-native-image-crop-picker) nao consegue abrir WebP —
 * e a galeria esta cheia deles: figurinhas salvas, prints, imagens baixadas.
 * Quando isso acontece ele volta sem saida e a biblioteca reporta o erro generico
 * "Cannot find image data", que nao diz nada sobre formato.
 *
 * Copiar os bytes nao resolve: o problema e o formato, nao o caminho.
 */
export async function stageSourceImage(uri: string): Promise<string> {
  try {
    const result = await manipulateAsync(uri, [], { format: SaveFormat.PNG });
    return result.uri;
  } catch (error) {
    // Nao silenciar: sem o aviso, uma falha aqui reproduz o bug original identico.
    console.warn('[criar] nao foi possivel converter a imagem', uri, error);
    return uri;
  }
}

export type BuiltSticker = { uri: string; width: number; height: number; bytes: number };

export type BuiltAnimatedSticker = BuiltSticker & { durationMs: number; frameCount: number };

/** De onde a animacao vem — define qual extrator nativo roda. */
export type AnimatedSource = 'gif' | 'video';

type AnimatedBuilder = (
  sourceUri: string,
  destinationPath: string,
  stretch: boolean,
) => Promise<BuiltAnimatedSticker>;

const animatedModule = NativeModules.AnimatedStickerModule as
  | {
      buildFromGif: AnimatedBuilder;
      buildFromVideo: AnimatedBuilder;
      animatedPreview(
        sourceUri: string,
        destinationPath: string,
        stretch: boolean,
        fromVideo: boolean,
      ): Promise<BuiltAnimatedSticker>;
    }
  | undefined;

/** Falso em build que nao foi recompilada depois do modulo de animacao entrar. */
export const isAnimatedEncoderAvailable = Boolean(animatedModule?.buildFromGif);

/**
 * Previa ANIMADA do que a figurinha vai ser.
 *
 * Passa pelo mesmo pipeline da figurinha final — compor, encaixar, codificar
 * WebP animado — so numa resolucao menor (PREVIEW_SIDE, no modulo nativo). Por
 * isso mostra o enquadramento, a distorcao do modo Preencher, o movimento e o
 * loop de verdade, em vez de aproximar.
 *
 * Nao e identica ao resultado: se a escada precisar decimar frames para caber
 * em 500 KB, a figurinha final tera MENOS frames que a previa.
 *
 * Vai para o cache: e descartavel, e a limpeza do boot leva embora.
 */
export async function animatedPreview(
  sourceUri: string,
  previewId: string,
  mode: StickerMode,
  source: AnimatedSource,
): Promise<BuiltAnimatedSticker> {
  if (!animatedModule?.animatedPreview) {
    throw new Error('O módulo de figurinhas animadas não está nesta build.');
  }
  const directory = new Directory(Paths.cache, PREVIEWS_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true });
  return animatedModule.animatedPreview(
    sourceUri,
    new File(directory, `${previewId}.webp`).uri,
    mode === 'stretch',
    source === 'video',
  );
}

/**
 * Gera figurinha ANIMADA a partir de um GIF ou de um video.
 *
 * Tudo acontece no nativo: decodificar (GifImage do Fresco para GIF,
 * MediaMetadataRetriever para video), compor os frames, encaixar no quadrado e
 * codificar o WebP animado dentro de 500 KB. Nao ha caminho em JS porque nao
 * existe encoder de WebP animado em JS nem na API do Android — veja
 * plugins/android/AnimatedStickerModule.kt.
 *
 * `mode` aqui so distingue Preencher (distorce) de Original (centraliza): o
 * recorte do uCrop nao se aplica a animacao.
 */
export async function buildAnimatedSticker(
  sourceUri: string,
  stickerId: string,
  mode: StickerMode,
  source: AnimatedSource,
): Promise<BuiltAnimatedSticker> {
  const build = source === 'video' ? animatedModule?.buildFromVideo : animatedModule?.buildFromGif;
  if (!build) {
    throw new Error(
      'O módulo de figurinhas animadas não está nesta build. Rode "npx expo run:android" para recompilar — recarregar o JS não basta.',
    );
  }
  // Mesmo diretorio permanente das estaticas; o nativo grava neste caminho.
  const destination = stickerDestination(stickerId);
  return build(sourceUri, destination.uri, mode === 'stretch');
}

/**
 * Centraliza a imagem num quadrado transparente. Delega ao modulo nativo porque a acao
 * `extent` do expo-image-manipulator so existe na web.
 */
async function padToSquare(sourceUri: string): Promise<string> {
  if (!imageModule?.padToSquarePng) {
    throw new Error('O módulo nativo de imagem não está disponível nesta build.');
  }
  return imageModule.padToSquarePng(sourceUri);
}

/** Comprime para WebP baixando a qualidade ate caber no limite do WhatsApp. */
async function encodeWithinLimit(
  sourceUri: string,
  stickerId: string,
  // Parametrizado porque o teto do WhatsApp depende do tipo: 100 KB estatica,
  // 500 KB animada. Figurinha animada nao passa por aqui (este caminho e do
  // expo-image-manipulator, que so faz WebP estatico), mas o limite ja fica
  // explicito em vez de embutido na mensagem de erro.
  limitBytes: number = MAX_STICKER_BYTES,
): Promise<BuiltSticker> {
  for (const quality of QUALITY_STEPS) {
    const result = await manipulateAsync(sourceUri, [{ resize: { width: STICKER_SIDE, height: STICKER_SIDE } }], {
      compress: quality,
      format: SaveFormat.WEBP,
    });
    const bytes = new File(result.uri).size;
    if (bytes <= limitBytes) {
      const uri = persistSticker(result.uri, stickerId);
      // Já copiado para o diretorio permanente; a copia no cache nao serve mais.
      deleteQuietly(result.uri);
      return { uri, width: result.width, height: result.height, bytes };
    }
    // Tentativa grande demais. Sem este delete, cada figurinha deixa ate 6
    // WebP orfaos no cache — um por degrau de qualidade que nao couber.
    deleteQuietly(result.uri);
  }

  throw new Error(`Figurinha excede o limite de ${Math.round(limitBytes / 1024)} KB`);
}

/**
 * Gera a figurinha a partir do ARQUIVO, nunca de um print da tela.
 * O caminho antigo capturava a View do editor com captureRef e reescalava ~345dp para 512px,
 * o que reenquadrava o recorte escolhido e ainda perdia resolucao.
 *
 * `sourceUri` ja e a imagem certa: o recorte do usuario no modo `crop`, a imagem
 * inteira no modo `original`. O quadramento roda sempre — quando a imagem ja e
 * quadrada ele e uma copia sem perda, e evita que o resize distorca o enquadramento.
 */
export async function buildSticker(
  sourceUri: string,
  stickerId: string,
  mode: StickerMode,
): Promise<BuiltSticker> {
  // `stretch` pula o quadramento de proposito. O resize do encodeWithinLimit
  // recebe largura E altura, e nesse caso o expo-image-manipulator usa
  // exatamente essas dimensoes — veja ResizeTransformer.kt na lib, que chama
  // createScaledBitmap(bitmap, 512, 512, true). Sem o padToSquare antes, isso
  // distorce a imagem para ocupar o quadrado inteiro, que e justamente o efeito
  // desejado para prints de tela.
  if (mode === 'stretch') return encodeWithinLimit(sourceUri, stickerId);

  const padded = await padToSquare(sourceUri);
  try {
    return await encodeWithinLimit(padded, stickerId);
  } finally {
    // O quadrado e so um intermediario — PNG sem perda, em resolucao cheia,
    // facilmente alguns MB. Fica no cache para sempre se ninguem apagar.
    deleteQuietly(padded);
  }
}

/** Recomprime uma figurinha ja salva — atalho "Comprimir" do card de prontidao. */
export async function recompressSticker(sourceUri: string, stickerId: string): Promise<BuiltSticker> {
  return encodeWithinLimit(sourceUri, stickerId);
}
