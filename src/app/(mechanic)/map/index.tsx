/**
 * Ruta hărții — wrapper subțire (7 aug, varianta web): expo-router bagă toate
 * fișierele din `app/` în bundle prin require.context, indiferent de platformă, deci
 * un `.web.tsx` de RUTĂ nu împiedică importul react-native-maps să rupă bundle-ul
 * web. Split-ul de platformă se face la nivel de COMPONENTĂ (Metro alege
 * mechanic-map-screen.web.tsx pe web), exact ca la mini-map.
 */
import MechanicMapScreen from '@/components/mechanic-map-screen';
import { useExitConfirm } from '@/hooks/use-exit-confirm';

export default function MechanicMapRoute() {
  // Tab-ul de start al mecanicului: back-ul de aici întreabă dacă închide aplicația.
  useExitConfirm();
  return <MechanicMapScreen />;
}
