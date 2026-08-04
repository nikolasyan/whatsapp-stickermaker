package __PACKAGE__.whatsapp;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import android.util.Log;

public class WhatsAppStickerModule extends ReactContextBaseJavaModule implements ActivityEventListener {
  private static final String WHATSAPP_CONSUMER_PACKAGE = "com.whatsapp";
  private static final String WHATSAPP_BUSINESS_PACKAGE = "com.whatsapp.w4b";
  private static final String ENABLE_STICKER_PACK = "com.whatsapp.intent.action.ENABLE_STICKER_PACK";
  private static final String TAG = "WhatsAppStickerModule";
  private static final int TRAY_IMAGE_SIZE = 96;
  private static final int ADD_PACK_REQUEST = 200;
  // U+1F600 GRINNING FACE construido em ASCII puro para nao depender do encoding do source.
  private static final String DEFAULT_EMOJI = new String(Character.toChars(0x1F600));

  // O WhatsApp so informa por que recusou um pacote via onActivityResult, entao a Promise
  // do addStickerPack fica pendente aqui ate a tela de importacao voltar.
  // volatile: escrita na thread de preparacao, leitura em onActivityResult (main thread).
  private volatile @Nullable Promise pendingPromise;

  public WhatsAppStickerModule(ReactApplicationContext context) {
    super(context);
    context.addActivityEventListener(this);
  }

  @NonNull
  @Override
  public String getName() {
    return "WhatsAppStickerModule";
  }

  /** Retorna o pacote do WhatsApp capaz de importar figurinhas, preferindo o app comum. */
  private @Nullable String resolveWhatsAppPackage() {
    PackageManager packageManager = getReactApplicationContext().getPackageManager();
    for (String candidate : new String[]{WHATSAPP_CONSUMER_PACKAGE, WHATSAPP_BUSINESS_PACKAGE}) {
      Intent intent = new Intent(ENABLE_STICKER_PACK).setPackage(candidate);
      if (packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null) return candidate;
    }
    return null;
  }

  @ReactMethod
  public void isWhatsAppAvailable(Promise promise) {
    promise.resolve(resolveWhatsAppPackage() != null);
  }

  @ReactMethod
  public void addStickerPack(ReadableMap config, Promise promise) {
    if (pendingPromise != null) {
      promise.reject("EXPORT_IN_PROGRESS", "Ja existe uma importacao aguardando resposta do WhatsApp.");
      return;
    }

    new Thread(() -> {
      try {
        String identifier = config.getString("identifier");
        String title = config.getString("title");
        String author = config.getString("author");
        File externalCache = getReactApplicationContext().getExternalCacheDir();
        if (externalCache == null) throw new IllegalStateException("External cache unavailable");
        File packDirectory = WhatsAppStickerProvider.packDirectory(externalCache, identifier);
        // Precisa ser lido antes do delete: o WhatsApp so recarrega um pacote ja importado
        // quando o image_data_version muda.
        String imageDataVersion = String.valueOf(nextImageDataVersion(packDirectory));
        deleteRecursively(packDirectory);
        if (!packDirectory.mkdirs() && !packDirectory.isDirectory()) throw new IllegalStateException("Could not create sticker pack");

        ReadableArray stickerArray = config.getArray("stickers");
        if (stickerArray == null || stickerArray.size() == 0) throw new IllegalArgumentException("Sticker pack is empty");
        JSONArray stickers = new JSONArray();
        for (int index = 0; index < stickerArray.size(); index++) {
          ReadableMap sticker = stickerArray.getMap(index);
          String sourceUri = sticker.getString("url");
          String fileName = "sticker_" + index + ".webp";
          copyUriToFile(sourceUri, new File(packDirectory, fileName));
          // O WhatsApp rejeita entradas de emoji vazias; cada figurinha precisa de 1 a 3 emojis validos.
          String emoji = sticker.hasKey("emoji") ? sticker.getString("emoji") : null;
          if (emoji == null || emoji.trim().isEmpty()) emoji = DEFAULT_EMOJI;
          JSONArray emojis = new JSONArray().put(emoji);
          stickers.put(new JSONObject().put("image_file", fileName).put("emojis", emojis));
        }
        Log.d(TAG, "Copied " + stickerArray.size() + " stickers to " + packDirectory.getAbsolutePath());

        String trayImageUri = config.getString("trayImage");
        copyTrayImageToPng(trayImageUri, new File(packDirectory, "tray.png"));
        JSONObject metadata = new JSONObject()
          .put("identifier", identifier)
          .put("name", title)
          .put("publisher", author)
          .put("tray_image_file", "tray.png")
          .put("publisher_email", config.getString("publisherEmail"))
          .put("publisher_website", config.getString("publisherURL"))
          .put("privacy_policy_website", config.getString("privacyPolicyURL"))
          .put("license_agreement_website", config.getString("licenseURL"))
          .put("image_data_version", imageDataVersion)
          .put("whatsapp_will_not_cache_stickers", false)
          .put("animated_sticker_pack", false)
          .put("stickers", stickers);
        writeText(new File(packDirectory, "metadata.json"), metadata.toString());
        Log.d(TAG, "Metadata ready for " + identifier + " (image_data_version=" + imageDataVersion + ")");

        String whatsappPackage = resolveWhatsAppPackage();
        if (whatsappPackage == null) {
          promise.reject("WHATSAPP_NOT_INSTALLED", "Nenhum WhatsApp capaz de importar figurinhas foi encontrado.");
          return;
        }

        Intent intent = new Intent(ENABLE_STICKER_PACK);
        intent.setPackage(whatsappPackage);
        intent.putExtra("sticker_pack_id", identifier);
        intent.putExtra("sticker_pack_authority", WhatsAppStickerProvider.AUTHORITY);
        intent.putExtra("sticker_pack_name", title);
        Activity activity = getCurrentActivity();
        if (activity == null) {
          promise.reject("NO_ACTIVITY", "O app precisa estar em primeiro plano para abrir o WhatsApp.");
          return;
        }

        pendingPromise = promise;
        activity.runOnUiThread(() -> {
          try {
            // startActivityForResult (e nao startActivity) e o unico jeito de receber o
            // extra validation_error quando o WhatsApp recusa o pacote.
            activity.startActivityForResult(intent, ADD_PACK_REQUEST);
            Log.d(TAG, "Import activity started for " + identifier + " on " + whatsappPackage);
          } catch (Exception error) {
            Log.e(TAG, "Could not open WhatsApp import screen", error);
            rejectPending("WHATSAPP_OPEN_FAILED", error.getMessage());
          }
        });
      } catch (Exception error) {
        Log.e(TAG, "Failed to prepare sticker pack", error);
        pendingPromise = null;
        promise.reject("STICKER_PACK_FAILED", error);
      }
    }).start();
  }

  @Override
  public void onActivityResult(Activity activity, int requestCode, int resultCode, @Nullable Intent data) {
    if (requestCode != ADD_PACK_REQUEST) return;
    Promise promise = pendingPromise;
    pendingPromise = null;
    if (promise == null) return;

    String validationError = data != null ? data.getStringExtra("validation_error") : null;
    Log.d(TAG, "Import result resultCode=" + resultCode + " validationError=" + validationError);

    WritableMap result = Arguments.createMap();
    if (validationError != null && !validationError.trim().isEmpty()) {
      // O WhatsApp analisou o pacote e recusou; a mensagem dele e o unico diagnostico util.
      result.putString("status", "rejected");
      result.putString("error", validationError);
    } else if (resultCode == Activity.RESULT_CANCELED) {
      result.putString("status", "cancelled");
    } else {
      result.putString("status", "added");
    }
    promise.resolve(result);
  }

  @Override
  public void onNewIntent(Intent intent) {
    // Sem uso: o fluxo de importacao termina em onActivityResult.
  }

  /**
   * Centraliza a imagem num quadrado transparente do tamanho do maior lado.
   * O WhatsApp exige figurinhas exatamente 512x512, e o expo-image-manipulator
   * so implementa a acao `extent` (preenchimento) na web — no Android nao existe.
   * Devolve um PNG para preservar o canal alfa.
   */
  @ReactMethod
  public void padToSquarePng(String sourceUri, Promise promise) {
    new Thread(() -> {
      Bitmap source = null;
      Bitmap square = null;
      try {
        Uri uri = Uri.parse(sourceUri);
        InputStream input = uri.getScheme() == null || "file".equals(uri.getScheme())
          ? new FileInputStream(uri.getPath())
          : getReactApplicationContext().getContentResolver().openInputStream(uri);
        if (input == null) throw new IllegalArgumentException("Unable to open " + sourceUri);
        try (InputStream stream = input) {
          source = BitmapFactory.decodeStream(stream);
        }
        if (source == null) throw new IllegalArgumentException("Unable to decode " + sourceUri);

        int side = Math.max(source.getWidth(), source.getHeight());
        square = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888);
        square.eraseColor(Color.TRANSPARENT);
        Canvas canvas = new Canvas(square);
        canvas.drawBitmap(source, (side - source.getWidth()) / 2f, (side - source.getHeight()) / 2f, null);

        File output = new File(getReactApplicationContext().getCacheDir(), "pad_" + System.currentTimeMillis() + ".png");
        try (FileOutputStream stream = new FileOutputStream(output)) {
          square.compress(Bitmap.CompressFormat.PNG, 100, stream);
        }
        promise.resolve(Uri.fromFile(output).toString());
      } catch (Exception error) {
        Log.e(TAG, "Failed to pad image to square", error);
        promise.reject("PAD_FAILED", error);
      } finally {
        if (square != null) square.recycle();
        if (source != null) source.recycle();
      }
    }).start();
  }

  private void rejectPending(String code, @Nullable String message) {
    Promise promise = pendingPromise;
    pendingPromise = null;
    if (promise != null) promise.reject(code, message != null ? message : code);
  }

  /** O WhatsApp ignora alteracoes num pacote ja importado enquanto o image_data_version nao mudar. */
  private int nextImageDataVersion(File packDirectory) {
    File metadataFile = new File(packDirectory, "metadata.json");
    if (!metadataFile.exists()) return 1;
    try {
      JSONObject previous = new JSONObject(WhatsAppStickerProvider.StickerPackJson.readFile(metadataFile));
      return Integer.parseInt(previous.optString("image_data_version", "1")) + 1;
    } catch (Exception ignored) {
      return 1;
    }
  }

  private void copyTrayImageToPng(String source, File destination) throws Exception {
    Uri uri = Uri.parse(source);
    InputStream input = uri.getScheme() == null || "file".equals(uri.getScheme())
      ? new FileInputStream(uri.getPath())
      : getReactApplicationContext().getContentResolver().openInputStream(uri);
    if (input == null) throw new IllegalArgumentException("Unable to open " + source);
    try (InputStream stream = input; OutputStream output = new FileOutputStream(destination)) {
      Bitmap bitmap = BitmapFactory.decodeStream(stream);
      if (bitmap == null) throw new IllegalArgumentException("Unable to decode tray image");
      // O WhatsApp exige tray icon PNG de 96x96 com no maximo 50 KB.
      Bitmap tray = Bitmap.createScaledBitmap(bitmap, TRAY_IMAGE_SIZE, TRAY_IMAGE_SIZE, true);
      tray.compress(Bitmap.CompressFormat.PNG, 100, output);
      if (tray != bitmap) tray.recycle();
      bitmap.recycle();
    }
  }

  private void copyUriToFile(String source, File destination) throws Exception {
    Uri uri = Uri.parse(source);
    InputStream input = uri.getScheme() == null || "file".equals(uri.getScheme())
      ? new FileInputStream(uri.getPath())
      : getReactApplicationContext().getContentResolver().openInputStream(uri);
    if (input == null) throw new IllegalArgumentException("Unable to open " + source);
    try (InputStream stream = input; FileOutputStream output = new FileOutputStream(destination)) {
      byte[] buffer = new byte[8192];
      int count;
      while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
    }
  }

  private static void writeText(File file, String content) throws Exception {
    try (FileOutputStream output = new FileOutputStream(file)) {
      output.write(content.getBytes("UTF-8"));
    }
  }

  private static void deleteRecursively(File file) {
    if (!file.exists()) return;
    File[] children = file.listFiles();
    if (children != null) for (File child : children) deleteRecursively(child);
    file.delete();
  }
}
