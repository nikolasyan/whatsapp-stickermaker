import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { NativeModules } from 'react-native';

import { MAX_STICKER_BYTES } from '@/lib/packs';

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
export function persistSticker(temporaryUri: string, stickerId: string): string {
  const directory = new Directory(Paths.document, STICKERS_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true });
  const destination = new File(directory, `${stickerId}.webp`);
  if (destination.exists) destination.delete();
  new File(temporaryUri).copy(destination);
  return destination.uri;
}

export function deleteStickerFile(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Arquivo ja removido ou fora do nosso diretorio — nada a fazer.
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
    console.log('[criar] imagem convertida para PNG em', result.uri);
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
      return { uri: persistSticker(result.uri, stickerId), width: result.width, height: result.height, bytes };
    }
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
export async function buildSticker(sourceUri: string, stickerId: string): Promise<BuiltSticker> {
  return encodeWithinLimit(await padToSquare(sourceUri), stickerId);
}

/** Recomprime uma figurinha ja salva — atalho "Comprimir" do card de prontidao. */
export async function recompressSticker(sourceUri: string, stickerId: string): Promise<BuiltSticker> {
  return encodeWithinLimit(sourceUri, stickerId);
}
