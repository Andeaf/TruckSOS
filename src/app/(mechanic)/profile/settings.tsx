import { SettingsScreen } from '@/components/settings-screen';

export default function Settings() {
  return (
    <SettingsScreen
      editPath="/(mechanic)/profile/edit"
      backPath="/(mechanic)/profile"
      deletePath="/(mechanic)/profile/delete-account"
      blockedPath="/(mechanic)/profile/blocked"
      changePasswordPath="/(mechanic)/profile/change-password"
      changeEmailPath="/(mechanic)/profile/change-email"
    />
  );
}
