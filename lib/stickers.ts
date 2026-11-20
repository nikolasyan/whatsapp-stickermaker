import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { NativeModules } from 'react-native';

import { MAX_STICKER_BYTES, type StickerMode } from '@/lib/packs';

const STICKERS_DIRECTORY = 'stickers';
const STICKER_SIDE = 512;
const QUALITY_STEPS = [0.9, 0.75, 0.6, 0.45, 0.3, 0.15];

const imageModule = NativeModules.WhatsAppStickerModule as
  | { padToSquarePng(sourceUri: string): Promise<string> }
  | undefined;

/**
 * manipulateAsync grava no cache interno, que o Android limpa sozinho.
 * Como o URI fica salvo no AsyncStorage, a figurinha precisa ir para um diretorio permanente.
 */
/** Caminho permanente e vazio para uma figurinha, com o diretorio garantido. */
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
    for (const name of ['ImagePicker', 'ImageManipulator', 'exports']) {
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
async function encodeWithinLimit(sourceUri: string, stickerId: string): Promise<BuiltSticker> {
  for (const quality of QUALITY_STEPS) {
    const result = await manipulateAsync(sourceUri, [{ resize: { width: STICKER_SIDE, height: STICKER_SIDE } }], {
      compress: quality,
      format: SaveFormat.WEBP,
    });
    const bytes = new File(result.uri).size;
    if (bytes <= MAX_STICKER_BYTES) {
      const uri = persistSticker(result.uri, stickerId);
      // Já copiado para o diretorio permanente; a copia no cache nao serve mais.
      deleteQuietly(result.uri);
      return { uri, width: result.width, height: result.height, bytes };
    }
    // Tentativa grande demais. Sem este delete, cada figurinha deixa ate 6
    // WebP orfaos no cache — um por degrau de qualidade que nao couber.
    deleteQuietly(result.uri);
  }

  throw new Error('Figurinha excede o limite de 100 KB');
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
