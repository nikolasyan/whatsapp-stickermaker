package com.anonymous.appdefigurinhas.whatsapp;

import com.anonymous.appdefigurinhas.BuildConfig;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.UriMatcher;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.ArrayList;
import java.util.List;

public class WhatsAppStickerProvider extends ContentProvider {
  public static final String AUTHORITY = BuildConfig.APPLICATION_ID + ".stickercontentprovider";
  private static final String TAG = "WhatsAppStickerProvider";
  private static final String STICKERS_DIR = "stickers";
  private static final String METADATA_FILE = "metadata.json";
  private static final int METADATA = 1;
  private static final int METADATA_SINGLE = 2;
  private static final int STICKERS = 3;
  private static final int ASSET = 4;
  private final UriMatcher matcher = new UriMatcher(UriMatcher.NO_MATCH);

  @Override
  public boolean onCreate() {
    matcher.addURI(AUTHORITY, "metadata", METADATA);
    matcher.addURI(AUTHORITY, "metadata/*", METADATA_SINGLE);
    matcher.addURI(AUTHORITY, "stickers/*", STICKERS);
    matcher.addURI(AUTHORITY, "stickers_asset/*/*", ASSET);
    return true;
  }

  public static File packDirectory(File externalCacheDir, String identifier) {
    return new File(new File(externalCacheDir, STICKERS_DIR), identifier);
  }

  private File stickersDirectory() {
    return new File(providerContext().getExternalCacheDir(), STICKERS_DIR);
  }

  private File packDirectory(String identifier) {
    return packDirectory(providerContext().getExternalCacheDir(), identifier);
  }

  private JSONObject readMetadata(String identifier) throws Exception {
    File metadata = new File(packDirectory(identifier), METADATA_FILE);
    return new JSONObject(StickerPackJson.readFile(metadata));
  }

  private List<JSONObject> availablePacks() {
    List<JSONObject> packs = new ArrayList<>();
    File directory = stickersDirectory();
    File[] children = directory.listFiles();
    if (children == null) return packs;
    for (File child : children) {
      if (!child.isDirectory()) continue;
      try {
        packs.add(readMetadata(child.getName()));
      } catch (Exception ignored) {
        // Remove incomplete packages left by an interrupted export.
        deleteRecursively(child);
      }
    }
    return packs;
  }

  private Cursor metadataCursor(List<JSONObject> packs) throws Exception {
    // Os nomes e a ordem seguem o contrato do WhatsApp: ele le as colunas com
    // getColumnIndexOrThrow, entao qualquer coluna faltando descarta o pacote em silencio.
    String[] columns = {
      "sticker_pack_identifier", "sticker_pack_name", "sticker_pack_publisher",
      "sticker_pack_icon", "android_play_store_link", "ios_app_download_link",
      "sticker_pack_publisher_email", "sticker_pack_publisher_website",
      "sticker_pack_privacy_policy_website", "sticker_pack_license_agreement_website",
      "image_data_version", "whatsapp_will_not_cache_stickers", "animated_sticker_pack"
    };
    MatrixCursor cursor = new MatrixCursor(columns);
    for (JSONObject pack : packs) {
      MatrixCursor.RowBuilder row = cursor.newRow();
      row.add(pack.getString("identifier"));
      row.add(pack.getString("name"));
      row.add(pack.getString("publisher"));
      row.add(pack.getString("tray_image_file"));
      row.add(pack.optString("android_play_store_link", null));
      row.add(pack.optString("ios_app_download_link", null));
      row.add(pack.getString("publisher_email"));
      row.add(pack.getString("publisher_website"));
      row.add(pack.getString("privacy_policy_website"));
      row.add(pack.getString("license_agreement_website"));
      row.add(pack.optString("image_data_version", "1"));
      row.add(pack.optBoolean("whatsapp_will_not_cache_stickers", false) ? 1 : 0);
      row.add(pack.optBoolean("animated_sticker_pack", false) ? 1 : 0);
    }
    return cursor;
  }

  private Cursor stickerCursor(String identifier) throws Exception {
    JSONObject pack = readMetadata(identifier);
    MatrixCursor cursor = new MatrixCursor(new String[]{"sticker_file_name", "sticker_emoji", "sticker_accessibility_text"});
    JSONArray stickers = pack.getJSONArray("stickers");
    for (int index = 0; index < stickers.length(); index++) {
      JSONObject sticker = stickers.getJSONObject(index);
      cursor.newRow()
        .add(sticker.getString("image_file"))
        .add(sticker.getJSONArray("emojis").toString())
        .add(sticker.optString("accessibility_text", ""));
    }
    return cursor;
  }

  @Nullable
  @Override
  public Cursor query(@NonNull Uri uri, @Nullable String[] projection, @Nullable String selection, @Nullable String[] selectionArgs, @Nullable String sortOrder) {
    try {
      Log.d(TAG, "query " + uri);
      switch (matcher.match(uri)) {
        case METADATA:
          return metadataCursor(availablePacks());
        case METADATA_SINGLE:
          return metadataCursor(java.util.Collections.singletonList(readMetadata(uri.getLastPathSegment())));
        case STICKERS:
          return stickerCursor(uri.getLastPathSegment());
        default:
          throw new IllegalArgumentException("Unsupported URI: " + uri);
      }
    } catch (Exception error) {
      throw new IllegalArgumentException("Unable to read sticker pack", error);
    }
  }

  @Nullable
  @Override
  public String getType(@NonNull Uri uri) {
    if (matcher.match(uri) == ASSET) {
      return uri.getLastPathSegment() != null && uri.getLastPathSegment().endsWith(".png")
        ? "image/png"
        : "image/webp";
    }
    return "vnd.android.cursor.dir/vnd." + AUTHORITY;
  }

  @Nullable
  @Override
  public ParcelFileDescriptor openFile(@NonNull Uri uri, @NonNull String mode) throws FileNotFoundException {
    if (matcher.match(uri) != ASSET) throw new FileNotFoundException(uri.toString());
    String[] segments = uri.getPathSegments().toArray(new String[0]);
    String identifier = segments[segments.length - 2];
    String fileName = segments[segments.length - 1];
    File file = new File(packDirectory(identifier), fileName);
    Log.d(TAG, "openFile " + file.getAbsolutePath() + " exists=" + file.exists());
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
  }

  @Override public int delete(@NonNull Uri uri, @Nullable String selection, @Nullable String[] selectionArgs) { throw new UnsupportedOperationException(); }
  @Override public int update(@NonNull Uri uri, @Nullable ContentValues values, @Nullable String selection, @Nullable String[] selectionArgs) { throw new UnsupportedOperationException(); }
  @Override public Uri insert(@NonNull Uri uri, @Nullable ContentValues values) { throw new UnsupportedOperationException(); }

  private static void deleteRecursively(File file) {
    File[] children = file.listFiles();
    if (children != null) for (File child : children) deleteRecursively(child);
    file.delete();
  }

  private android.content.Context providerContext() {
    android.content.Context context = getContext();
    if (context == null) throw new IllegalStateException("Provider is not attached");
    return context;
  }

  static final class StickerPackJson {
    static String readFile(File file) throws Exception {
      java.io.FileInputStream input = new java.io.FileInputStream(file);
      try {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toString("UTF-8");
      } finally {
        input.close();
      }
    }
  }
}
