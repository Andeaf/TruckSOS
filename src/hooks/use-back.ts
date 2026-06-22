import { useNavigation } from '@react-navigation/native';
import { useRouter } from 'expo-router';

export function useBack(fallback: string) {
  const navigation = useNavigation();
  const router = useRouter();

  return () => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace(fallback as never);
    }
  };
}
