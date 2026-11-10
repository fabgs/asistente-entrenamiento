import { router } from 'expo-router';
import { showDialog, showPrompt, showSnackbar } from '@/components/Dialog';
import { openRoute, RouteRow } from '@/components/Routes';
import { AddRow, AppText, Button, EmptyState, ListGroup, ListRow, Loading, ROW_ICON_INSET, RowIcon, Screen } from '@/components/ui';
import { importGpxRoute, routeList } from '@/db/repositories/routes';
import { GpxError } from '@/domain/gpx';
import { countOf } from '@/domain/progress';
import { localDateString } from '@/domain/schedule';
import { useDb, useLoader } from '@/hooks/data';
import { pickGpx } from '@/services/gpx';

/**
 * Mis rutas (PLAN.md §6.8, 1.4.8), from Historial → Cardio: the walks saved as routes, the one walked
 * last first, and the routes imported from a GPX (1.4.9). Above them, the heat map of every walk
 * (1.4.10), saved as a route or not.
 */
export default function RoutesScreen() {
  const db = useDb();
  const { data } = useLoader(async (db) => ({ today: localDateString(new Date()), items: await routeList(db) }));

  /** A GPX from Wikiloc and the like: checked, named (its own name, editable) and opened. */
  const importGpx = async () => {
    let picked;
    try {
      picked = await pickGpx();
    } catch (e) {
      showDialog('No se pudo importar', e instanceof GpxError ? e.message : 'No se pudo leer el fichero.');
      return;
    }
    if (!picked) return;
    const name = await showPrompt('Nombre de la ruta', { value: picked.name, maxLength: 40, confirm: 'Guardar' });
    if (name === null) return;
    const { routeId, count } = await importGpxRoute(db, picked.track, name.trim() || picked.name);
    openRoute(routeId);
    if (count > 0) showSnackbar(`Ruta importada · la has hecho ${countOf(count, 'vez', 'veces')}`);
  };

  const heatMap = (
    <ListGroup inset={ROW_ICON_INSET}>
      <ListRow
        left={<RowIcon name="map-outline" />}
        title="Mapa de calor"
        // Two lines: with a big system font it does not fit in one.
        subtitle={
          <AppText variant="secondary" numberOfLines={2}>
            Por dónde caminas más
          </AppText>
        }
        onPress={() => router.push('/mapa-calor')}
      />
    </ListGroup>
  );

  if (!data) return <Loading />;
  if (data.items.length === 0) {
    return (
      <Screen>
        {heatMap}
        <EmptyState
          icon="map-marker-path"
          title="Sin rutas todavía"
          text="Abre una caminata y, en su menú, toca «Guardar como ruta». También puedes importar un GPX, como los de Wikiloc."
          action={<Button kind="secondary" icon="file-import-outline" title="Importar GPX" onPress={importGpx} />}
        />
      </Screen>
    );
  }
  return (
    <Screen>
      {heatMap}
      <ListGroup inset={ROW_ICON_INSET}>
        {data.items.map((item) => (
          <RouteRow key={item.route.id} item={item} today={data.today} onPress={() => openRoute(item.route.id)} />
        ))}
        <AddRow title="Importar GPX" onPress={importGpx} />
      </ListGroup>
    </Screen>
  );
}
