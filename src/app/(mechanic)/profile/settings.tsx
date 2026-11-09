import { SettingsScreen } from '@/components/settings-screen';

export default function Settings() {
  return (
    <SettingsScreen
      editPath="/(mechanic)/profile/edit"
      backPath="/(mechanic)/profile"
      deletePath="/(mechanic)/profile/delete-account"
      blockedPath="/(mechanic)/profile/blocked"
      moderationPath="/(mechanic)/profile/moderation"
      changePasswordPath="/(mechanic)/profile/change-password"
      changeEmailPath="/(mechanic)/profile/change-email"
      twoFactorPath="/(mechanic)/profile/two-factor"
    />
  );
}
