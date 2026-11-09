import { openRoute, RouteRow } from '@/components/Routes';
import { EmptyState, ListGroup, Loading, ROW_ICON_INSET, Screen } from '@/components/ui';
import { routeList } from '@/db/repositories/routes';
import { localDateString } from '@/domain/schedule';
import { useLoader } from '@/hooks/data';

/** Mis rutas (PLAN.md §6.8, 1.4.8), from Historial → Cardio: the walks saved as routes, the one walked last first. */
export default function RoutesScreen() {
  const { data } = useLoader(async (db) => ({ today: localDateString(new Date()), items: await routeList(db) }));

  if (!data) return <Loading />;
  if (data.items.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="map-marker-path"
          title="Sin rutas todavía"
          text="Abre una caminata y, en su menú, toca «Guardar como ruta». Cuando la repitas, se enlazará sola."
        />
      </Screen>
    );
  }
  return (
    <Screen>
      <ListGroup inset={ROW_ICON_INSET}>
        {data.items.map((item) => (
          <RouteRow key={item.route.id} item={item} today={data.today} onPress={() => openRoute(item.route.id)} />
        ))}
      </ListGroup>
    </Screen>
  );
}
