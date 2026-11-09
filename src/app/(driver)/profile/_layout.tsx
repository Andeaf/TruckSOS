import { Stack } from 'expo-router';

// Ancora stivei (PLAN_1.1_FIX 7.9): push-ul de moderare poate deschide `profile/moderation` cu stiva Profil nemontată
// (pornire la rece); fără initialRouteName stiva ar conține doar [moderation], back ar sări pe alt tab și tab-ul Profil
// ar rămâne blocat pe acel ecran. Același tipar ca announcements / conversations / applications.
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function DriverProfileLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
