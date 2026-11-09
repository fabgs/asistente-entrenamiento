import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showActions, showDialog } from '@/components/Dialog';
import { PhotoPager } from '@/components/PhotoPager';
import { AppText, EmptyState, HeaderActions, IconButton, Loading } from '@/components/ui';
import { getPhoto, listPhotos, type PhotoOwner } from '@/db/repositories/photos';
import { formatLongDate, formatTimeOfDay } from '@/domain/format';
import { useDb, useLoader } from '@/hooks/data';
import { isOnPhone, photoUri, removePhoto } from '@/services/photos';
import { colors, spacing } from '@/theme';

/** The photos of a session, one per page, starting at the one tapped; pinch or double tap zooms. */
export default function PhotoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState<number | null>(null);
  // The session is that of the photo opened; it stays after removing that photo.
  const owner = useRef<PhotoOwner | null>(null);

  const { data, reload } = useLoader(async (db) => {
    if (!owner.current) {
      const photo = await getPhoto(db, Number(id));
      if (!photo) return null;
      owner.current = photo.owner;
    }
    const photos = (await listPhotos(db, owner.current)).filter(isOnPhone);
    return { photos, start: Math.max(0, photos.findIndex((p) => p.id === Number(id))) };
  });

  if (data === undefined) return <Loading />;
  if (data === null || data.photos.length === 0) {
    return <EmptyState icon="image-off-outline" title="No se encontró esta foto" text="Puede que se quitara." />;
  }
  const { photos } = data;
  const shown = Math.min(index ?? data.start, photos.length - 1);
  const current = photos[shown];

  const remove = () =>
    showDialog('¿Quitar esta foto?', 'Se quita de la sesión. Si está en la galería del móvil, sigue allí.', [
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: async () => {
          await removePhoto(db, current);
          if (photos.length === 1) {
            router.back();
            return;
          }
          // The one after it takes its place; the last one gives way to the one before.
          setIndex(Math.min(shown, photos.length - 2));
          reload();
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);

  return (
    <>
      <Stack.Screen
        options={{
          title: photos.length > 1 ? `${shown + 1} de ${photos.length}` : 'Foto',
          headerRight: () => (
            <HeaderActions>
              <IconButton
                icon="dots-vertical"
                label="Más acciones"
                onPress={() => showActions([{ text: 'Quitar foto', icon: 'trash-can-outline', destructive: true, onPress: remove }])}
              />
            </HeaderActions>
          ),
        }}
      />
      {/* The gestures of the pager need a root of their own: the app has none at its top. */}
      <GestureHandlerRootView style={[styles.screen, { paddingBottom: insets.bottom }]}>
        {/* A new pager after removing a photo, opened where it was. */}
        <PhotoPager
          key={photos.map((p) => p.id).join(',')}
          photos={photos.map((p) => ({ id: p.id, uri: photoUri(p.file), width: p.width, height: p.height }))}
          initialIndex={shown}
          width={width}
          onIndexChange={setIndex}
        />
        {current.takenAt !== null || current.place ? (
          <View style={styles.caption}>
            {current.takenAt !== null ? (
              <AppText variant="secondary" tabular>
                {formatLongDate(new Date(current.takenAt))} · {formatTimeOfDay(current.takenAt)}
              </AppText>
            ) : null}
            {current.place ? <AppText variant="caption">En el mapa de la ruta</AppText> : null}
          </View>
        ) : null}
      </GestureHandlerRootView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  caption: { alignItems: 'center', gap: 2, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
});
