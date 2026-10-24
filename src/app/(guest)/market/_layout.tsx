import { Stack } from 'expo-router';

// La deep-jump direct pe un detaliu (link partajat, pin de pe hartă), stack-ul se
// construiește cu LISTA dedesubt — altfel back-ul fizic sărea peste listă.
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function GuestStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
