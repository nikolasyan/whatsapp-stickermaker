import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

/**
 * Como a imagem foi encaixada no quadrado de 512x512:
 * - `crop`: o usuario recortou um quadrado no editor nativo;
 * - `original`: imagem inteira centralizada, com transparencia nas sobras
 *   (preserva a proporcao, mas um print de celular vira uma faixa estreita);
 * - `stretch`: imagem esticada para ocupar o quadrado todo (distorce).
 */
export type StickerMode = 'crop' | 'original' | 'stretch';

export type Sticker = {
  id: string;
  /**
   * Sem `originalUri`: o campo existia, nunca era lido e guardava o caminho da
   * imagem de origem no CACHE — que clearTransientCache() apaga a cada
   * abertura do app. Era um ponteiro garantidamente quebrado.
   * Para permitir reeditar uma figurinha, o original precisa ser copiado para o
   * diretorio de documentos, nao apenas referenciado.
   */
  processedUri: string;
  mode: StickerMode;
  format: 'webp';
  width: number;
  height: number;
};

export type Pack = {
  id: string;
  name: string;
  author: string;
  iconUri: string;
  stickers: Sticker[];
  /** Timestamp da ultima importacao confirmada pelo WhatsApp. */
  exportedAt?: number;
};

// Mantido do esquema antigo de propósito: renomear a chave apagaria os pacotes ja salvos.
const PACKS_STORAGE_KEY = '@app-de-figurinhas/albums';

/**
 * Versao do formato gravado no AsyncStorage.
 *
 * Suba este numero sempre que o formato de `Pack` mudar de maneira que o
 * codigo antigo nao entenda, e trate a conversao em `migratePacks`. Sem isto,
 * uma mudanca de formato encontra dados antigos e o app ou quebra ou os ignora
 * em silencio — que para o usuario e indistinguivel de ter perdido tudo.
 */
export const STORAGE_SCHEMA_VERSION = 1;

type StoredPayload = { schemaVersion: number; packs: Pack[] };

/**
 * Falha ao LER o armazenamento — diferente de "nao ha pacotes".
 * As telas precisam distinguir os dois: mostrar "0 pacotes" para um erro de
 * leitura faz o usuario acreditar que os pacotes foram apagados.
 */
export class PacksStorageError extends Error {}

export function storageErrorMessage(error: unknown): string {
  if (error instanceof PacksStorageError) return error.message;
  return 'Não foi possível ler seus pacotes neste momento.';
}

export const MAX_STICKER_BYTES = 100 * 1024;
export const MIN_STICKERS = 3;
export const MAX_STICKERS = 30;

let idSequence = 0;

/**
 * Id unico para pacotes e figurinhas.
 *
 * `Date.now()` sozinho nao serve: a importacao de um pacote cria ate 30
 * figurinhas no mesmo milissegundo e todas receberiam o mesmo id — o que
 * colide o nome do arquivo .webp no disco e uma figurinha sobrescreve a outra.
 * O contador garante unicidade dentro da sessao; o sufixo aleatorio evita
 * colisao entre sessoes (o contador zera quando o app reinicia).
 */
export function newId(kind: 'pack' | 'sticker'): string {
  idSequence += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${idSequence.toString(36)}-${random}-${kind}`;
}

export async function loadPacks(): Promise<Pack[]> {
  const stored = await AsyncStorage.getItem(PACKS_STORAGE_KEY);
  if (!stored) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new PacksStorageError('Os dados dos pacotes estão corrompidos e não puderam ser lidos.');
  }

  // Formato legado: um array solto, sem versao. E o que as versoes anteriores
  // gravaram, entao qualquer aparelho que ja usou o app cai aqui na primeira
  // leitura. O proximo savePacks regrava no formato novo.
  if (Array.isArray(parsed)) return parsed as Pack[];

  if (typeof parsed === 'object' && parsed !== null) {
    const payload = parsed as Partial<StoredPayload>;
    if (typeof payload.schemaVersion === 'number' && payload.schemaVersion > STORAGE_SCHEMA_VERSION) {
      throw new PacksStorageError(
        'Seus pacotes foram gravados por uma versão mais nova do app. Atualize o Jambo para abri-los.',
      );
    }
    if (Array.isArray(payload.packs)) return payload.packs;
  }

  throw new PacksStorageError('Os dados dos pacotes estão em um formato que o app não reconhece.');
}

export async function savePacks(packs: Pack[]): Promise<void> {
  const payload: StoredPayload = { schemaVersion: STORAGE_SCHEMA_VERSION, packs };
  await AsyncStorage.setItem(PACKS_STORAGE_KEY, JSON.stringify(payload));
}

/** Le, transforma e grava numa operacao so, evitando sobrescrever alteracoes de outra tela. */
export async function mutatePacks(mutate: (packs: Pack[]) => Pack[]): Promise<Pack[]> {
  const next = mutate(await loadPacks());
  await savePacks(next);
  return next;
}

export type ReadinessAction = 'add' | 'compress';

export type ReadinessItem = {
  id: string;
  label: string;
  ok: boolean;
  /** Rotulo do atalho de correcao, quando houver algo a resolver. */
  actionLabel?: string;
  action?: ReadinessAction;
};

export type Readiness = {
  items: ReadinessItem[];
  satisfied: number;
  total: number;
  ready: boolean;
  title: string;
  /** Ids das figurinhas que precisam de atencao, para destacar na grade. */
  oversized: string[];
  /** Bytes por figurinha, para exibir "142 KB" no card. */
  sizes: Record<string, number>;
};

function plural(count: number, singular: string, pluralForm: string) {
  return count === 1 ? singular : pluralForm;
}

/**
 * Traduz os requisitos do WhatsApp numa barra de prontidao.
 * Le o tamanho dos arquivos do disco (a API do expo-file-system e sincrona),
 * entao chame dentro de um efeito e nao a cada render.
 */
export function computeReadiness(pack: Pack): Readiness {
  const sizes: Record<string, number> = {};
  const oversized: string[] = [];
  const missingFiles: string[] = [];

  for (const sticker of pack.stickers) {
    try {
      const file = new File(sticker.processedUri);
      if (!file.exists) {
        missingFiles.push(sticker.id);
        continue;
      }
      sizes[sticker.id] = file.size;
      if (file.size > MAX_STICKER_BYTES) oversized.push(sticker.id);
    } catch {
      missingFiles.push(sticker.id);
    }
  }

  const count = pack.stickers.length;
  const missingCount = Math.max(0, MIN_STICKERS - count);

  const items: ReadinessItem[] = [
    {
      id: 'count',
      ok: count >= MIN_STICKERS && count <= MAX_STICKERS,
      label:
        count > MAX_STICKERS
          ? `Remova ${count - MAX_STICKERS} ${plural(count - MAX_STICKERS, 'figurinha', 'figurinhas')}`
          : missingCount > 0
            ? `Faltam ${missingCount} ${plural(missingCount, 'figurinha', 'figurinhas')}`
            : `Mínimo de ${MIN_STICKERS} figurinhas`,
      actionLabel: missingCount > 0 ? 'Adicionar' : undefined,
      action: missingCount > 0 ? 'add' : undefined,
    },
    {
      // Este item verifica a presenca dos ARQUIVOS no disco. Antes era rotulado
      // como "Ícone do pacote 96×96", que descrevia outra coisa: o icone e
      // gerado pelo modulo nativo na hora de exportar e nao ha nada que o
      // usuario possa fazer a respeito dele.
      id: 'files',
      ok: count > 0 && missingFiles.length === 0,
      label:
        missingFiles.length > 0
          ? `${missingFiles.length} ${plural(missingFiles.length, 'arquivo sumiu', 'arquivos sumiram')} do aparelho`
          : 'Todas as figurinhas no aparelho',
    },
    {
      id: 'size',
      ok: oversized.length === 0,
      label:
        oversized.length > 0
          ? `${oversized.length} ${plural(oversized.length, 'figurinha', 'figurinhas')} acima de 100 KB`
          : 'Todas abaixo de 100 KB',
      actionLabel: oversized.length > 0 ? 'Comprimir' : undefined,
      action: oversized.length > 0 ? 'compress' : undefined,
    },
  ];

  const satisfied = items.filter((item) => item.ok).length;
  const ready = satisfied === items.length;

  return {
    items,
    satisfied,
    total: items.length,
    ready,
    title: ready ? 'Pronto pra exportar' : satisfied >= items.length - 1 ? 'Quase pronto' : 'Faltam ajustes',
    oversized,
    sizes,
  };
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}
