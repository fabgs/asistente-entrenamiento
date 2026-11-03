import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { PixelRatio } from 'react-native';
import { captureRef } from 'react-native-view-shot';

/** An Instagram story is 1080 × 1920 px; a sticker (no background) is cropped to 1080 × 1100. */
export const STORY_PX = { width: 1080, height: 1920 };
export const STICKER_PX = { width: 1080, height: 1100 };

/** Size in layout units that comes out at exactly `px` on this phone. */
export const layoutSize = (px: { width: number; height: number }) => ({
  width: px.width / PixelRatio.get(),
  height: px.height / PixelRatio.get(),
});

type View = Parameters<typeof captureRef>[0];

/** A PNG of the view (transparent where it has no background), as a temporary file. */
function capture(view: View, fileName: string, px: { width: number; height: number }): Promise<string> {
  // The size is in pixels of the final image (not layout units, despite Expo's docs).
  return captureRef(view, { format: 'png', result: 'tmpfile', fileName, ...px });
}

/** Opens Android's share menu with the view as an image. */
export async function shareViewAsImage(view: View, fileName: string, px: { width: number; height: number }): Promise<void> {
  const uri = await capture(view, fileName, px);
  await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Compartir imagen' });
}

/**
 * Saves the view as an image in the phone's gallery. It only asks to add pictures, never to read
 * them (from Android 10 on, adding needs no permission at all).
 */
export async function saveViewToGallery(
  view: View,
  fileName: string,
  px: { width: number; height: number },
): Promise<'saved' | 'denied'> {
  const permission = await requestPermissionsAsync(true);
  if (!permission.granted) return 'denied';
  await Asset.create(await capture(view, fileName, px));
  return 'saved';
}
