import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

export type StickerMode = 'crop' | 'original';

export type Sticker = {
  id: string;
  originalUri: string;
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

export const MAX_STICKER_BYTES = 100 * 1024;
export const MIN_STICKERS = 3;
export const MAX_STICKERS = 30;

export async function loadPacks(): Promise<Pack[]> {
  const stored = await AsyncStorage.getItem(PACKS_STORAGE_KEY);
  if (!stored) return [];
  const parsed = JSON.parse(stored) as Pack[];
  return Array.isArray(parsed) ? parsed : [];
}

export async function savePacks(packs: Pack[]): Promise<void> {
  await AsyncStorage.setItem(PACKS_STORAGE_KEY, JSON.stringify(packs));
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
      id: 'tray',
      ok: count > 0 && missingFiles.length === 0,
      label:
        missingFiles.length > 0
          ? `${missingFiles.length} ${plural(missingFiles.length, 'arquivo sumiu', 'arquivos sumiram')} do aparelho`
          : 'Ícone do pacote 96×96',
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
