import { SettingsScreen } from '@/components/settings-screen';

export default function Settings() {
  return (
    <SettingsScreen
      editPath="/(driver)/profile/edit"
      backPath="/(driver)/profile"
      deletePath="/(driver)/profile/delete-account"
      blockedPath="/(driver)/profile/blocked"
      changePasswordPath="/(driver)/profile/change-password"
      changeEmailPath="/(driver)/profile/change-email"
    />
  );
}
