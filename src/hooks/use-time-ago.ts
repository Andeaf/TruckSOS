import { useTranslation } from 'react-i18next';

export function useTimeAgo() {
  const { t } = useTranslation();
  return (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('common.timeNow');
    if (mins < 60) return t('common.timeMinsAgo', { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('common.timeHoursAgo', { count: hrs });
    return t('common.timeDaysAgo', { count: Math.floor(hrs / 24) });
  };
}
