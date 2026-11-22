package __PACKAGE__.whatsapp

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.Rect
import android.net.Uri
import android.util.Log
import com.aureusapps.android.webpandroid.encoder.WebPAnimEncoder
import com.aureusapps.android.webpandroid.encoder.WebPAnimEncoderOptions
import com.aureusapps.android.webpandroid.encoder.WebPConfig
import com.aureusapps.android.webpandroid.encoder.WebPMuxAnimParams
import com.aureusapps.android.webpandroid.encoder.WebPPreset
import com.facebook.animated.gif.GifImage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.io.File

/**
 * Cria figurinha ANIMADA (WebP animado) a partir de um GIF.
 *
 * POR QUE E KOTLIN e nao Java, como o resto do codigo nativo deste projeto: a
 * biblioteca de encoding e Kotlin com argumentos default, e o WebPConfig dela
 * tem construtor de 28 parametros boxed. De Java seriam 28 nulls posicionais.
 *
 * POR QUE PRECISA DE BIBLIOTECA: nao existe API no Android para escrever WebP
 * animado — Bitmap.compress(WEBP) so produz estatico. O encoder animado vive na
 * libwebpmux, e esta biblioteca e um binding JNI dela. Veja a auditoria do AAR
 * em plugins/with-webp-encoder.js.
 *
 * A DECODIFICACAO do GIF nao usa biblioteca nova: o GifImage do Fresco ja esta
 * no APK porque o template do Expo liga `expo.gif.enabled=true`.
 */
class AnimatedStickerModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  companion object {
    private const val TAG = "AnimatedStickerModule"
    private const val SIDE = 512

    /** Limites da especificacao do WhatsApp (Android/README.md do WhatsApp/stickers). */
    private const val MAX_BYTES = 500 * 1024
    private const val MAX_DURATION_MS = 10_000
    private const val MIN_FRAME_MS = 8

    /**
     * GIF com delay 0 e comum e significa "o mais rapido possivel". Renderizar
     * isso a 8ms deixaria a animacao absurdamente rapida, entao usamos a
     * convencao que os navegadores adotaram: 0 vira 100ms.
     */
    private const val UNSPECIFIED_FRAME_MS = 100

    /** Codigos de disposal do formato GIF (nao sao constantes do Fresco). */
    private const val DISPOSE_TO_BACKGROUND = 2
    private const val DISPOSE_TO_PREVIOUS = 3

    /** Escada de qualidade, no mesmo espirito da usada na figurinha estatica. */
    private val QUALITY_STEPS = listOf(80f, 65f, 50f, 35f, 20f)
  }

  override fun getName() = "AnimatedStickerModule"

  /**
   * @param stretch true usa o modo Preencher (distorce para ocupar o quadrado);
   *                false centraliza preservando a proporcao, como o modo Original.
   */
  @ReactMethod
  fun buildFromGif(sourceUri: String, destinationPath: String, stretch: Boolean, promise: Promise) {
    Thread {
      try {
        promise.resolve(encodeGif(sourceUri, destinationPath, stretch))
      } catch (error: Throwable) {
        Log.e(TAG, "Falha ao gerar figurinha animada", error)
        promise.reject("ANIMATED_STICKER_FAILED", error.message ?: "Falha ao gerar a figurinha animada", error)
      }
    }.start()
  }

  private fun encodeGif(sourceUri: String, destinationPath: String, stretch: Boolean): WritableMap {
    val bytes = readBytes(sourceUri)
    val gif = GifImage.createFromByteArray(bytes)
    var candidate: List<Frame> = emptyList()
    try {
      if (gif.frameCount <= 0) throw IllegalArgumentException("O GIF nao tem frames.")

      candidate = composeFrames(gif, stretch)
      if (candidate.isEmpty()) throw IllegalArgumentException("Nao foi possivel ler os frames do GIF.")

      // Aceita caminho puro ou file:// — o expo-file-system do lado JS sempre
      // entrega URI com esquema, e File("file:///...") nao resolve.
      val destination = File(stripFileScheme(destinationPath))
      destination.parentFile?.mkdirs()

      // Duas dimensoes de compressao: primeiro baixa a qualidade; se ainda nao
      // couber, descarta frames alternados (somando a duracao deles no vizinho,
      // para a animacao nao acelerar). Um GIF longo de 512x512 nao cabe em
      // 500 KB so com qualidade.
      while (true) {
        // Entra na escada perto do alvo em vez de sempre comecar em 80: cada
        // tentativa custa ~7s num GIF de 90 frames, e descer a escada inteira
        // fazia o usuario esperar meio minuto por um resultado previsivel.
        val steps = stepsFor(candidate.size)
        Log.d(TAG, "${candidate.size} frames: tentando qualidades $steps")
        for (quality in steps) {
          val written = encode(candidate, quality, destination)
          if (written <= MAX_BYTES) {
            var finalBytes = written
            var finalQuality = quality

            // Folga grande significa que a estimativa foi pessimista — sem isto
            // um GIF de grafico simples com muitos frames sairia na qualidade
            // mais baixa sem precisar. Uma tentativa extra, e so quando a folga
            // e clara, para nao desfazer o ganho de tempo.
            val better = QUALITY_STEPS.getOrNull(QUALITY_STEPS.indexOf(quality) - 1)
            if (better != null && written < MAX_BYTES / 2) {
              val upgraded = encode(candidate, better, destination)
              if (upgraded <= MAX_BYTES) {
                finalBytes = upgraded
                finalQuality = better
              } else {
                // A tentativa melhor deixou o arquivo ACIMA do limite no
                // destino. Reescrever com a qualidade que cabia nao e
                // opcional: sem isto entregariamos o arquivo grande.
                finalBytes = encode(candidate, quality, destination)
              }
            }

            Log.d(TAG, "Gerado com qualidade $finalQuality, ${candidate.size} frames, $finalBytes bytes")
            return result(destination, finalBytes, candidate)
          }
        }
        if (candidate.size <= 2) break
        candidate = decimate(candidate)
        Log.d(TAG, "Nao cabe em 500 KB; reduzindo para ${candidate.size} frames")
      }

      throw IllegalStateException("Esta animacao nao cabe em 500 KB nem reduzindo frames e qualidade.")
    } finally {
      gif.dispose()
      // Sem isto, cada tentativa deixa ate 30 bitmaps de 512x512 (1 MB cada em
      // ARGB_8888) para o GC — suficiente para derrubar o app num GIF longo.
      for (frame in candidate) frame.bitmap.recycle()
    }
  }

  private fun result(destination: File, bytes: Long, frames: List<Frame>): WritableMap {
    val map = Arguments.createMap()
    map.putString("uri", Uri.fromFile(destination).toString())
    map.putInt("width", SIDE)
    map.putInt("height", SIDE)
    map.putDouble("bytes", bytes.toDouble())
    map.putInt("durationMs", frames.sumOf { it.durationMs })
    map.putInt("frameCount", frames.size)
    return map
  }

  private data class Frame(val bitmap: Bitmap, val durationMs: Int)

  /**
   * Compoe os frames do GIF em imagens completas de 512x512.
   *
   * Frame de GIF pode ser PARCIAL: redesenha so um retangulo sobre o resultado
   * anterior, e o que acontece com o anterior depende do disposal mode. Ignorar
   * isso nao da erro — da fantasma e rastro na animacao, que so aparece olhando.
   */
  private fun composeFrames(gif: GifImage, stretch: Boolean): List<Frame> {
    val canvasBitmap = Bitmap.createBitmap(gif.width, gif.height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(canvasBitmap)
    val out = mutableListOf<Frame>()
    var total = 0

    try {
      for (index in 0 until gif.frameCount) {
        val frame = gif.getFrame(index)
        try {
          val durationMs = normalizeDuration(frame.durationMs)
          // Corta no limite do WhatsApp em vez de gerar algo que ele recusa.
          if (total + durationMs > MAX_DURATION_MS) break

          // DISPOSE_TO_PREVIOUS exige voltar ao estado anterior depois de
          // desenhar, entao guardamos uma copia antes.
          val backup = if (frame.disposalMode == DISPOSE_TO_PREVIOUS) canvasBitmap.copy(Bitmap.Config.ARGB_8888, false) else null

          val patch = Bitmap.createBitmap(frame.width, frame.height, Bitmap.Config.ARGB_8888)
          try {
            frame.renderFrame(frame.width, frame.height, patch)
            canvas.drawBitmap(patch, frame.xOffset.toFloat(), frame.yOffset.toFloat(), null)
          } finally {
            patch.recycle()
          }

          out.add(Frame(toSquare(canvasBitmap, stretch), durationMs))
          total += durationMs

          when (frame.disposalMode) {
            DISPOSE_TO_BACKGROUND -> {
              canvas.save()
              canvas.clipRect(frame.xOffset, frame.yOffset, frame.xOffset + frame.width, frame.yOffset + frame.height)
              canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
              canvas.restore()
            }
            DISPOSE_TO_PREVIOUS -> backup?.let {
              canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
              canvas.drawBitmap(it, 0f, 0f, null)
              it.recycle()
            }
            // 0 (nao especificado) e 1 (nao descartar): o frame fica no canvas.
          }
        } finally {
          frame.dispose()
        }
      }
    } finally {
      canvasBitmap.recycle()
    }

    return out
  }

  /**
   * Por onde entrar na escada de qualidade, estimado pelo orcamento por frame.
   *
   * MEDIDO NO APARELHO, duas amostras: 24 frames couberam em q35 (~21 KB por
   * frame de orcamento) e 90 frames em q20 (~5,6 KB). Sao dois pontos, nao uma
   * curva — a estimativa serve para pular as tentativas obviamente grandes
   * demais, nao para acertar de primeira. A escada abaixo do ponto de entrada
   * continua inteira, entao errar por otimismo custa uma tentativa, nunca o
   * resultado.
   *
   * Comecar sempre em 80 fazia um GIF de 90 frames gastar 5 tentativas (~35s)
   * para chegar onde a primeira estimativa chega direto.
   */
  private fun stepsFor(frameCount: Int): List<Float> {
    val budgetKbPerFrame = (MAX_BYTES / 1024f) / frameCount
    val entry = when {
      budgetKbPerFrame >= 40f -> 80f
      budgetKbPerFrame >= 20f -> 50f
      budgetKbPerFrame >= 10f -> 35f
      else -> 20f
    }
    // ifEmpty nunca deveria disparar (20f e o ultimo degrau), mas uma escada
    // vazia transformaria "nao cabe" em "nem tentei".
    return QUALITY_STEPS.filter { it <= entry }.ifEmpty { listOf(QUALITY_STEPS.last()) }
  }

  private fun normalizeDuration(raw: Int): Int =
    if (raw <= 0) UNSPECIFIED_FRAME_MS else raw.coerceAtLeast(MIN_FRAME_MS)

  /** Encaixa o frame no quadrado de 512x512, com ou sem distorcao. */
  private fun toSquare(source: Bitmap, stretch: Boolean): Bitmap {
    val square = Bitmap.createBitmap(SIDE, SIDE, Bitmap.Config.ARGB_8888)
    square.eraseColor(Color.TRANSPARENT)
    val canvas = Canvas(square)

    val destination = if (stretch) {
      Rect(0, 0, SIDE, SIDE)
    } else {
      val scale = minOf(SIDE.toFloat() / source.width, SIDE.toFloat() / source.height)
      val width = (source.width * scale).toInt()
      val height = (source.height * scale).toInt()
      val left = (SIDE - width) / 2
      val top = (SIDE - height) / 2
      Rect(left, top, left + width, top + height)
    }

    canvas.drawBitmap(source, Rect(0, 0, source.width, source.height), destination, null)
    return square
  }

  /**
   * Descarta frames alternados somando a duracao no frame que fica, para a
   * animacao manter a mesma velocidade com menos quadros.
   */
  private fun decimate(frames: List<Frame>): List<Frame> {
    val out = mutableListOf<Frame>()
    var index = 0
    while (index < frames.size) {
      val keep = frames[index]
      val dropped = frames.getOrNull(index + 1)
      out.add(Frame(keep.bitmap, normalizeDuration(keep.durationMs + (dropped?.durationMs ?: 0))))
      dropped?.bitmap?.recycle()
      index += 2
    }
    return out
  }

  private fun encode(frames: List<Frame>, quality: Float, destination: File): Long {
    // Apagar ANTES de cada tentativa, nao so uma vez antes do loop: a escada
    // reusa o mesmo caminho dezenas de vezes, e se o assemble nao truncar o
    // arquivo cada tentativa soma em cima da anterior. O tamanho medido so
    // cresce, nenhuma qualidade "cabe", e o erro final culpa a animacao.
    if (destination.exists()) destination.delete()
    val encoder = WebPAnimEncoder(
      reactApplicationContext,
      SIDE,
      SIDE,
      WebPAnimEncoderOptions(
        minimizeSize = true,
        // 0 = repetir para sempre, que e o comportamento esperado de figurinha.
        animParams = WebPMuxAnimParams(loopCount = 0),
      ),
    )
    try {
      encoder.configure(
        WebPConfig(lossless = WebPConfig.COMPRESSION_LOSSY, quality = quality),
        WebPPreset.WEBP_PRESET_PICTURE,
      )
      // Convencao da libwebp: cada frame recebe o timestamp em que COMECA, e o
      // assemble recebe o timestamp final (a duracao total).
      var timestamp = 0L
      for (frame in frames) {
        encoder.addFrame(timestamp, frame.bitmap)
        timestamp += frame.durationMs
      }
      encoder.assemble(timestamp, Uri.fromFile(destination))
    } finally {
      encoder.release()
    }
    val written = destination.length()
    // Logar toda tentativa, nao so a que passa: sem isto, "nao cabe em 500 KB"
    // nao distingue compressao ineficaz de animacao genuinamente grande.
    Log.d(TAG, "tentativa: ${frames.size} frames, qualidade $quality -> $written bytes")
    return written
  }

  private fun stripFileScheme(value: String): String =
    if (value.startsWith("file://")) requireNotNull(Uri.parse(value).path) { "URI sem caminho: $value" } else value

  private fun readBytes(sourceUri: String): ByteArray {
    val uri = Uri.parse(sourceUri)
    val stream = if (uri.scheme == null || uri.scheme == "file") {
      File(requireNotNull(uri.path) { "URI sem caminho: $sourceUri" }).inputStream()
    } else {
      reactApplicationContext.contentResolver.openInputStream(uri)
        ?: throw IllegalArgumentException("Nao foi possivel abrir $sourceUri")
    }
    return stream.use { it.readBytes() }
  }
}
