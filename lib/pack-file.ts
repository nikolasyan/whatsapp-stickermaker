import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { MAX_STICKERS, newId, mutatePacks, type Pack, type Sticker, type StickerMode } from '@/lib/packs';
import { deleteStickerFile, persistStickerFromBase64 } from '@/lib/stickers';

/**
 * Pacote como ARQUIVO: backup local e compartilhamento entre amigos sem
 * servidor nenhum. O arquivo trafega pelo proprio WhatsApp como documento.
 *
 * O que NAO vai no arquivo, de proposito: ids e URIs. Eles sao locais do
 * aparelho, e deixa-los de fora e o que faz a importacao sempre criar um
 * pacote novo em vez de arriscar sobrescrever um existente.
 */

export const PACK_FILE_FORMAT = 'jambo-pack';
export const PACK_FILE_SCHEMA_VERSION = 1;

/**
 * Extensao dupla de proposito: o `.json` faz o Android e o WhatsApp tratarem
 * o arquivo como documento conhecido (um `.jambo` puro viraria
 * application/octet-stream e alguns apps se recusam a anexar), e o `.jambo`
 * deixa claro de quem ele e.
 */
export const PACK_FILE_EXTENSION = '.jambo.json';

/** Subdiretorio do cache — a rotina de limpeza do cache conhece este nome. */
const EXPORT_DIRECTORY = 'exports';

/**
 * Teto de tamanho do arquivo lido na importacao. Um pacote valido no limite
 * (30 x 100 KB, +33% de base64) da ~4,5 MB; 60 MB e folgado e ainda impede
 * que um arquivo corrompido ou malicioso estoure a memoria do app.
 */
const MAX_PACK_FILE_BYTES = 60 * 1024 * 1024;

/** Teto por figurinha. Acima do limite do WhatsApp de proposito: um pacote
 * importado pode vir fora de especificacao e o card de prontidao oferece
 * "Comprimir" — mas o valor precisa ser limitado. */
const MAX_STICKER_BASE64_BYTES = 1024 * 1024;

const STICKER_MODES: StickerMode[] = ['crop', 'original', 'stretch'];

type PackFileSticker = {
  mode: StickerMode;
  width: number;
  height: number;
  webpBase64: string;
};

export type PackFile = {
  format: typeof PACK_FILE_FORMAT;
  schemaVersion: number;
  exportedAt: number;
  pack: {
    name: string;
    author: string;
    stickers: PackFileSticker[];
  };
};

/** Erro com mensagem ja pronta para mostrar ao usuario. */
export class PackFileError extends Error {}

export function packFileErrorMessage(error: unknown): string {
  if (error instanceof PackFileError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Não foi possível processar o arquivo do pacote.';
}

// ---------------------------------------------------------------- exportacao

/** "Gatos do João" -> "gatos-do-joao.jambo.json" */
function safeFileName(packName: string): string {
  const base = packName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos; o resto vira hifen
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${base || 'pacote'}${PACK_FILE_EXTENSION}`;
}

async function readStickerBase64(sticker: Sticker): Promise<string> {
  const file = new File(sticker.processedUri);
  if (!file.exists) {
    throw new PackFileError(
      'Uma das figurinhas sumiu do aparelho. Abra o pacote, resolva os avisos e exporte de novo.',
    );
  }
  return file.base64();
}

export async function buildPackFile(pack: Pack): Promise<PackFile> {
  if (pack.stickers.length === 0) {
    throw new PackFileError('Este pacote está vazio, não há o que exportar.');
  }

  const stickers: PackFileSticker[] = [];
  for (const sticker of pack.stickers) {
    stickers.push({
      mode: sticker.mode,
      width: sticker.width,
      height: sticker.height,
      webpBase64: await readStickerBase64(sticker),
    });
  }

  return {
    format: PACK_FILE_FORMAT,
    schemaVersion: PACK_FILE_SCHEMA_VERSION,
    exportedAt: Date.now(),
    pack: { name: pack.name, author: pack.author, stickers },
  };
}

/** Grava o arquivo do pacote no cache e devolve o caminho. */
export async function writePackFile(pack: Pack): Promise<File> {
  const payload = await buildPackFile(pack);

  const directory = new Directory(Paths.cache, EXPORT_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true });

  const file = new File(directory, safeFileName(pack.name));
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(payload));
  return file;
}

/** Abre a folha de compartilhamento do sistema com o arquivo do pacote. */
export async function sharePackFile(pack: Pack): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new PackFileError('Este aparelho não oferece compartilhamento de arquivos.');
  }
  const file = await writePackFile(pack);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: `Enviar "${pack.name}"`,
  });
}

// ---------------------------------------------------------------- importacao

function fail(message: string): never {
  throw new PackFileError(message);
}

const NOT_A_PACK = 'Este arquivo não é um pacote do Jambo.';

function parseSticker(value: unknown, index: number): PackFileSticker {
  if (typeof value !== 'object' || value === null) fail(`${NOT_A_PACK} (figurinha ${index + 1} inválida)`);
  const sticker = value as Record<string, unknown>;

  const { webpBase64, width, height, mode } = sticker;
  if (typeof webpBase64 !== 'string' || webpBase64.length === 0) {
    fail(`${NOT_A_PACK} (figurinha ${index + 1} sem imagem)`);
  }
  if (webpBase64.length > MAX_STICKER_BASE64_BYTES) {
    fail(`A figurinha ${index + 1} é grande demais para ser importada.`);
  }

  return {
    // Dimensoes só informativas; se vierem erradas o app nao quebra, entao
    // um valor invalido cai no padrao em vez de recusar o pacote inteiro.
    width: typeof width === 'number' && width > 0 ? width : 512,
    height: typeof height === 'number' && height > 0 ? height : 512,
    mode: STICKER_MODES.includes(mode as StickerMode) ? (mode as StickerMode) : 'original',
    webpBase64,
  };
}

export function parsePackFile(raw: string): PackFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(NOT_A_PACK);
  }

  if (typeof parsed !== 'object' || parsed === null) fail(NOT_A_PACK);
  const root = parsed as Record<string, unknown>;

  if (root.format !== PACK_FILE_FORMAT) fail(NOT_A_PACK);

  const schemaVersion = root.schemaVersion;
  if (typeof schemaVersion !== 'number') fail(NOT_A_PACK);
  if (schemaVersion > PACK_FILE_SCHEMA_VERSION) {
    fail('Este pacote foi exportado por uma versão mais nova do app. Atualize o Jambo para importá-lo.');
  }

  if (typeof root.pack !== 'object' || root.pack === null) fail(NOT_A_PACK);
  const pack = root.pack as Record<string, unknown>;

  const name = typeof pack.name === 'string' ? pack.name.trim() : '';
  const author = typeof pack.author === 'string' ? pack.author.trim() : '';
  if (!name || !author) fail(`${NOT_A_PACK} (nome ou autor ausente)`);

  if (!Array.isArray(pack.stickers)) fail(NOT_A_PACK);
  if (pack.stickers.length === 0) fail('Este arquivo não tem nenhuma figurinha.');
  if (pack.stickers.length > MAX_STICKERS) {
    fail(`Um pacote aceita no máximo ${MAX_STICKERS} figurinhas, e este arquivo tem ${pack.stickers.length}.`);
  }

  return {
    format: PACK_FILE_FORMAT,
    schemaVersion,
    exportedAt: typeof root.exportedAt === 'number' ? root.exportedAt : Date.now(),
    pack: { name, author, stickers: pack.stickers.map(parseSticker) },
  };
}

/**
 * Grava as figurinhas no disco e adiciona o pacote. Sempre cria um pacote
 * novo: ids nascem aqui, nunca vem do arquivo.
 */
async function savePackFile(payload: PackFile): Promise<Pack> {
  const written: string[] = [];
  try {
    const stickers: Sticker[] = payload.pack.stickers.map((entry) => {
      const stickerId = newId('sticker');
      const uri = persistStickerFromBase64(entry.webpBase64, stickerId);
      written.push(uri);
      return {
        id: stickerId,
        processedUri: uri,
        mode: entry.mode,
        format: 'webp',
        width: entry.width,
        height: entry.height,
      };
    });

    const pack: Pack = {
      id: newId('pack'),
      name: payload.pack.name,
      author: payload.pack.author,
      iconUri: stickers[0].processedUri,
      stickers,
    };

    await mutatePacks((current) => [...current, pack]);
    return pack;
  } catch (error) {
    // Sem isto, uma falha no meio deixaria .webp orfaos ocupando espaco pra sempre.
    for (const uri of written) deleteStickerFile(uri);
    throw error;
  }
}

/**
 * Abre o seletor de arquivos e importa o pacote escolhido.
 * Devolve `null` quando o usuario cancela.
 */
export async function importPackFromFile(): Promise<Pack | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // '*/*' e nao 'application/json': um arquivo recebido pelo WhatsApp
    // frequentemente perde o MIME type, e o filtro o esconderia do seletor.
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;

  if (asset.size !== undefined && asset.size > MAX_PACK_FILE_BYTES) {
    fail('Este arquivo é grande demais para ser um pacote de figurinhas.');
  }

  const file = new File(asset.uri);
  if (!file.exists) fail('Não foi possível abrir o arquivo escolhido.');

  return savePackFile(parsePackFile(await file.text()));
}
