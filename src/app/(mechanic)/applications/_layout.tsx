import { Stack } from 'expo-router';

// La deep-jump direct pe un detaliu (tap pe notificare), stack-ul se construiește
// cu LISTA dedesubt — altfel back-ul fizic sărea peste listă, direct în tab-ul
// de start (26 aug).
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function ApplicationsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
