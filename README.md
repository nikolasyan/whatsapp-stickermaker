# Jambo — Sticker Maker

App Android para criar pacotes de figurinhas e importá-los no WhatsApp.
Tudo roda no aparelho: **não há servidor, backend ou nuvem em nenhum ponto.**

- Expo SDK 54 · React Native 0.81.5 · React 19.1.0
- **Android apenas.** Não há caminho de exportação no iOS.
- Uso pessoal — distribuição por APK, não pela Play Store.

## Rodando

Precisa de um **development build**. O Expo Go não serve: o app tem um módulo
nativo próprio (`WhatsAppStickerModule`) e depende do `react-native-image-crop-picker`.

```bash
npm install
npx expo prebuild --clean     # recria android/ aplicando os config plugins
npx expo run:android
```

A pasta `android/` é descartável e não é versionada — tudo que ela precisa de
especial é reaplicado pelos plugins em `plugins/`. Depois do primeiro build,
mudanças só em JS/TS pegam com reload; mudança nativa ou nova dependência
nativa exige `run:android` de novo.

```bash
npm test     # 75 testes, sem dependências extras
npm run lint
npx tsc --noEmit
```

## Decisões que não são óbvias no código

Esta seção existe porque cada um destes pontos já custou uma sessão de
diagnóstico. Se for mexer em algo próximo, leia antes.

### O JitPack é obrigatório para o build Android

`react-native-image-crop-picker` depende de `com.github.yalantis:ucrop`, que só
existe no JitPack. O template do Expo traz apenas `google()` e `mavenCentral()`,
então sem o repositório o Gradle não resolve o uCrop e **o build falha** com um
erro que não aponta para a causa.

Isso é reaplicado por [`plugins/with-ucrop-repository.js`](plugins/with-ucrop-repository.js).
Antes a linha estava editada à mão em `android/build.gradle` e se perdia a cada
`prebuild --clean` — foi o que originou um downgrade de SDK no início do projeto.

**Não existe nada que prenda o projeto ao SDK 54.** `image-crop-picker` e
AsyncStorage declaram `react-native: "*"`. O problema original era o repositório
faltando, não incompatibilidade de versão.

### AsyncStorage fica no 3.x de propósito

O `expo-doctor` espera a 2.2.0 para o SDK 54, e a divergência está declarada em
`expo.install.exclude` no `package.json`. **Não "corrija" rodando
`npx expo install @react-native-async-storage/async-storage`.**

A 3.x mudou o backend no Android: namespace `org.asyncstorage`, gravando num
banco Room chamado `AsyncStorage`. A 2.x lê o `RKStorage` antigo. Como o projeto
sempre rodou 3.x, o `RKStorage` nunca existiu nos aparelhos — o downgrade
apontaria o app para um banco inexistente e **todos os pacotes desapareceriam.**

### Trocar o `applicationId` quebra os pacotes já importados

`com.nikolasyan.jambo` forma a authority do ContentProvider
(`com.nikolasyan.jambo.stickercontentprovider`), que é o endereço pelo qual o
WhatsApp busca as figurinhas dos pacotes importados. Também define a pasta de
dados privados, onde ficam o AsyncStorage e os `.webp`.

Mudar o id = pacotes importados quebram no WhatsApp para todo mundo, e o app
novo instala **ao lado** do antigo com a pasta de dados vazia. Se precisar
trocar: exportar os pacotes para arquivo antes, trocar, reimportar depois.

### A figurinha é gerada do arquivo, nunca da tela

O caminho antigo capturava a `View` do editor com `captureRef` e reescalava
~345dp para 512px, o que reenquadrava o recorte escolhido e perdia resolução.
Hoje `buildSticker` parte do arquivo: o recorte do usuário ou a imagem inteira.

### O quadramento é nativo

`padToSquarePng` centraliza a imagem num quadrado transparente no módulo nativo
porque a ação `extent` do `expo-image-manipulator` **só existe na web**.

### Pacote animado é uma propriedade do PACOTE, não da figurinha

A especificação é literal: *"Sticker packs must contain either static or
animated stickers, never a mix of both"*. Por isso `Pack.animated` existe como
campo do pacote em vez de ser derivado das figurinhas — um pacote precisa saber
o que é mesmo quando está vazio, e a folha de salvar filtra por isso antes de
qualquer figurinha existir.

Ausente significa estático, que é o que todos os pacotes gravados antes deste
campo são. Por isso ele **não exigiu subir o `STORAGE_SCHEMA_VERSION`**.

A regra atravessa várias camadas, e é por isso que ela é a parte difícil das
animadas (bem mais que o vídeo em si):

- o teto de tamanho muda com o tipo (`maxStickerBytes`), e o card de prontidão
  mostra 100 KB ou 500 KB conforme o pacote;
- a folha de salvar do editor desabilita pacotes animados, porque o editor
  produz figurinha estática;
- `computeReadiness` reporta mistura e duração acima de 10 s, com itens que só
  aparecem quando há algo a dizer — um item que nunca falha num pacote estático
  seria ruído e mexeria no denominador da barra de progresso;
- `animated_sticker_pack` no `metadata.json` vem do pacote; vinha fixo em
  `false`, e um pacote animado marcado como estático é recusado na importação.

`durationMs` na figurinha é o que a marca como animada — a **presença** do campo,
não um booleano. Valor inválido faz o campo desaparecer em vez de virar `0`: uma
figurinha "animada com duração zero" entraria num pacote animado e faria o
WhatsApp recusar o pacote todo.

**Ainda não existe o encoder.** Não há API no Android para escrever WebP
animado (`Bitmap.compress(WEBP)` só faz estático), então criar animada a partir
de vídeo ou GIF depende da `WebPAnimEncoder` da libwebp — biblioteca de
terceiros ou compilar no NDK. A extração de frames, por outro lado, já está
coberta sem dependência nova: `MediaMetadataRetriever` para vídeo e
`com.facebook.animated.gif.GifImage` (que o Fresco já traz via
`expo.gif.enabled=true`) para GIF.

### O emoji é opcional no app, mas não no WhatsApp

O WhatsApp exige de 1 a 3 emojis por figurinha e **recusa o pacote inteiro** se a
lista vier vazia. No app escolher é opcional: `Sticker.emojis` ausente significa
"usar o padrão", e `resolveEmojis` no módulo nativo aplica 😀 nesse caso.

Isso é deliberado: o padrão vive no nativo, nunca na UI, para que escolher emoji
jamais se torne um passo obrigatório do fluxo de criação. Por isso a escolha fica
na folha de cada figurinha na tela do pacote, e não na fila de edição.

Entrada inválida (string vazia, tipo errado, mais de 3) é **descartada em
silêncio** em todas as camadas, nunca motivo para recusar um pacote — emoji é
metadado, e perder o pacote por causa dele seria desproporcional.

### Os três modos de enquadramento

`StickerMode` decide como a imagem vira um quadrado de 512×512:

| Modo | O que faz |
|---|---|
| `crop` | o usuário recortou um quadrado no editor nativo (uCrop) |
| `original` | imagem centralizada, transparência nas sobras — preserva a proporção |
| `stretch` | imagem esticada para ocupar o quadrado todo — **distorce** |

`stretch` funciona **pulando** o `padToSquare`. O `resize` do `encodeWithinLimit`
recebe largura e altura, e nesse caso o `expo-image-manipulator` usa exatamente
essas dimensões — `ResizeTransformer.kt` na lib chama
`createScaledBitmap(bitmap, 512, 512, true)`. Com a imagem já quadrada o resize
é uniforme; sem o quadramento antes, ele distorce. É por isso que o modo existe
sem precisar de código nativo novo.

### A conversão para PNG só serve ao recortador

`stageSourceImage` reencoda a imagem para PNG porque o uCrop não abre WebP — e a
galeria está cheia deles (figurinhas salvas, prints). Quando falha, o erro da
biblioteca é um genérico `Cannot find image data`, que não diz nada sobre formato.

Ela roda **só quando o recorte é aberto**, não ao escolher as fotos: num lote de
12 fotos em que você recorta 2, são 10 reencodes de vários MB que não acontecem.

### Três caches crescem sem limite se ninguém limpar

`clearTransientCache()` roda na abertura do app e limpa `cache/ImagePicker/`
(cópias em resolução cheia de cada foto escolhida), `cache/ImageManipulator/`
(os PNGs do staging), `cache/pad_*.png` (os quadrados do módulo nativo) e
`cache/exports/`. Além disso `encodeWithinLimit` apaga cada tentativa de WebP
que não couber no limite — eram até 6 órfãos **por figurinha**.

## Limites que o WhatsApp impõe

Números conferidos no [README oficial do Android](https://github.com/WhatsApp/stickers/blob/main/Android/README.md)
do repositório `WhatsApp/stickers`, não em guias de terceiros (que divergem,
principalmente na duração máxima da animação).

| | |
|---|---|
| Figurinhas por pacote | 3 a 30 |
| Composição do pacote | **estático OU animado, nunca misturado** |
| Figurinha estática | 512×512, WebP, ≤ 100 KB |
| Figurinha animada | 512×512, WebP animado, ≤ 500 KB, ≤ 10 s, frames ≥ 8 ms |
| Ícone do pacote (tray) | 96×96, PNG, ≤ 50 KB, **sempre estático** — gerado no módulo nativo |
| Emojis por figurinha | 1 a 3, obrigatório para o WhatsApp — opcional no app |

O card de prontidão na tela do pacote traduz esses requisitos; `computeReadiness`
em [`lib/packs.ts`](lib/packs.ts) é quem os calcula.

## Backup e compartilhamento

Não há nuvem. Um pacote exporta para um arquivo `.jambo.json` (JSON com os WebP
em base64), que serve ao mesmo tempo de backup e de forma de mandar o pacote
para um amigo — o arquivo trafega pelo próprio WhatsApp como documento.

O arquivo **não carrega ids nem URIs**: eles são locais do aparelho, e deixá-los
de fora é o que garante que importar sempre cria um pacote novo em vez de
arriscar sobrescrever um existente. Formato em [`lib/pack-file.ts`](lib/pack-file.ts),
versionado em `schemaVersion`.

O armazenamento local também é versionado (`STORAGE_SCHEMA_VERSION`), e
`loadPacks` ainda aceita o formato legado — um array solto, sem versão, que as
versões anteriores gravaram.

## Estrutura

```
app/                   telas (expo-router)
  (tabs)/index.tsx     Criar: escolhe fotos (até 30) e enfileira no editor
  (tabs)/packs.tsx     lista de pacotes, importar de arquivo
  editor.tsx           fila de edição: recorte / original / preencher, por figurinha
  pack/[id].tsx        pacote: prontidão, exportar ao WhatsApp, compartilhar
lib/
  packs.ts             modelo, armazenamento versionado, card de prontidão
  stickers.ts          pipeline de imagem e limpeza de cache
  pack-file.ts         export/import de pacote em arquivo
  sticker-queue.ts     entrega das fotos escolhidas para o editor
  whatsapp.ts          ponte com o módulo nativo de exportação
plugins/
  with-whatsapp-stickers.js   classes Java, MainApplication, manifest
  with-ucrop-repository.js    repositório JitPack
  android/*.java              fontes nativos (token __PACKAGE__)
scripts/               testes (node puro, sem jest)
```

## Testes

Sem jest e sem dependência nova: cada script transpila o módulo com o `tsc` do
projeto e substitui os módulos nativos por stubs.

| Script | Cobre |
|---|---|
| `test:pack-file` | formato de backup: entrada hostil, round-trip, sanitização |
| `test:packs-storage` | armazenamento: formato legado, migração, dados corrompidos |
| `test:config-plugins` | os dois config plugins: idempotência, authority, falha alta |

Os três guardam coisas que **falham em silêncio**: um erro no formato de arquivo
significa perda permanente de pacotes, e um erro nos plugins compila normalmente
e só a exportação para o WhatsApp para de funcionar.
