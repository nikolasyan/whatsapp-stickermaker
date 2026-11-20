/**
 * Fila de imagens escolhidas na galeria, entre a tela Criar e o editor.
 *
 * POR QUE NAO VAI NOS PARAMS DA ROTA: a fila chega a 30 itens e cada um ganha
 * um recorte durante a edicao. Carregar isso na rota exigiria renavegar a cada
 * figurinha so para atualizar o param. Aqui o editor consome a fila uma vez,
 * na montagem, e cuida do resto em estado local.
 *
 * E deliberadamente efemero: um reload do app no meio da edicao esvazia a fila,
 * e o editor trata esse caso mostrando um aviso em vez de uma tela vazia.
 */

export type QueuedImage = {
  /**
   * URI como veio da galeria ou da camera — pode ser `content://`.
   * Nao passa por stageSourceImage aqui: a conversao para PNG so e necessaria
   * para abrir o recortador, e quem usa a imagem inteira nao deve pagar por ela.
   */
  sourceUri: string;
  width: number;
  height: number;
};

let queue: QueuedImage[] = [];

/** Substitui a fila. Chamado uma vez por escolha de fotos. */
export function setQueue(images: QueuedImage[]) {
  queue = images;
}

/**
 * Le a fila SEM esvazia-la.
 *
 * A leitura e de proposito sem efeito colateral: o editor a consome como
 * inicializador de `useState`, e o React invoca inicializadores duas vezes em
 * dev (StrictMode). Se esta funcao limpasse a fila, a segunda invocacao
 * receberia uma lista vazia e o editor abriria sem imagem nenhuma.
 *
 * A fila fica em memoria ate a proxima escolha sobrescreve-la — sao algumas
 * strings de URI, e o editor copia tudo para estado local na montagem.
 */
export function getQueue(): QueuedImage[] {
  return queue;
}
