import { router } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Photo } from '@/db/repositories/photos';
import { photoUri } from '@/services/photos';
import { colors, radius, spacing } from '@/theme';
import { showActions } from './Dialog';
import { AppText, Icon, ListGroup, ListRow, RowIcon, Section } from './ui';

const TILE = 96;

/** «Hacer una foto» or «Elegir de la galería». */
export function askPhotoSource(onCamera: () => void, onGallery: () => void): void {
  showActions([
    { text: 'Hacer una foto', icon: 'camera-outline', onPress: onCamera },
    { text: 'Elegir de la galería', icon: 'image-multiple-outline', onPress: onGallery },
  ]);
}

export const openPhoto = (photo: Photo) => router.push({ pathname: '/foto/[id]', params: { id: String(photo.id) } });

/**
 * The photos of a session as a strip of thumbnails that open them, with «Añadir» at the end; with
 * none yet, a single row to add the first one.
 */
export function PhotoSection({ photos, onAdd }: { photos: Photo[]; onAdd: () => void }) {
  if (photos.length === 0) {
    return (
      <ListGroup>
        <ListRow
          title="Añadir foto"
          subtitle="De la cámara o de la galería"
          left={<RowIcon name="camera-plus-outline" />}
          onPress={onAdd}
          chevron={false}
        />
      </ListGroup>
    );
  }
  return (
    <Section label="Fotos" right={String(photos.length)}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {photos.map((p, i) => (
          <Pressable
            key={p.id}
            onPress={() => openPhoto(p)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Foto ${i + 1} de ${photos.length}`}
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}>
            <Image source={{ uri: photoUri(p.file) }} style={styles.image} resizeMode="cover" resizeMethod="resize" />
            {p.place ? (
              <View style={styles.pin}>
                <Icon name="map-marker" size={14} color={colors.text} />
              </View>
            ) : null}
          </Pressable>
        ))}
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Añadir foto"
          android_ripple={{ color: colors.pressed }}
          style={[styles.tile, styles.add]}>
          <Icon name="camera-plus-outline" size={24} color={colors.text} />
          <AppText variant="label" weight="600" style={{ color: colors.text }}>
            Añadir
          </AppText>
        </Pressable>
      </ScrollView>
    </Section>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm },
  tile: { width: TILE, height: TILE, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.cardAlt },
  image: { width: TILE, height: TILE },
  add: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.card },
  pin: {
    position: 'absolute',
    left: spacing.xs,
    bottom: spacing.xs,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
});
