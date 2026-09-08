import { useTranslation } from 'react-i18next';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import type { ChatMessageBase } from '@/components/chat-screen';

/**
 * Meniul contextual unic la tap lung pe o bulă (PLAN_FAZA14.md §1).
 * Compune lista de acțiuni filtrată după context — mesaj propriu vs al altuia,
 * text vs poză, șters vs nu — și o pasează lui `ActionSheet` (care rezolvă deja
 * limita Android de 3 butoane + ieșirea garantată).
 *
 * O acțiune apare DOAR dacă ecranul a furnizat callback-ul ei (props opționale):
 * la fel ca `onSendImage` pe `ChatScreen`, un chat care nu suportă o acțiune n-o
 * arată. Etapele următoare (14.1–14.5) adaugă delete/edit/reply/report; aici e
 * doar „Copiază" + scheletul.
 */

interface MessageActionSheetProps<M extends ChatMessageBase> {
  /** Mesajul atins; `null` = meniul e închis. */
  message: M | null;
  isMe: boolean;
  /** Fereastra de editare (3 min) e calculată de caller — vezi Etapa 14.2. */
  canEdit?: boolean;
  onClose: () => void;
  onCopy?: (m: M) => void;
  /** 7 sept: cardul de persoană recomandată → partajare în afara aplicației (WhatsApp etc.). */
  onShareContact?: (m: M) => void;
  onReply?: (m: M) => void;
  onEdit?: (m: M) => void;
  onDelete?: (m: M) => void;
  onReport?: (m: M) => void;
  /** Faza 18: blochează expeditorul. Ascuns dacă expeditorul e deja blocat. */
  onBlock?: (m: M) => void;
  senderBlocked?: boolean;
}

export function MessageActionSheet<M extends ChatMessageBase>({
  message,
  isMe,
  canEdit,
  onClose,
  onCopy,
  onShareContact,
  onReply,
  onEdit,
  onDelete,
  onReport,
  onBlock,
  senderBlocked,
}: MessageActionSheetProps<M>) {
  const { t } = useTranslation();

  const isImage = !!message?.image_path;
  const isDeleted = !!message?.deleted_at;

  const actions: SheetAction[] = [];
  if (message && !isDeleted) {
    if (onReply) {
      actions.push({ label: t('chat.reply'), icon: 'reply', onPress: () => onReply(message) });
    }
    if (onCopy && !isImage) {
      actions.push({ label: t('chat.copy'), icon: 'content-copy', onPress: () => onCopy(message) });
    }
    // Contactul recomandat (card de persoană) se poate trimite și în afara aplicației;
    // un cont șters nu mai are profil de arătat → fără acțiune.
    if (onShareContact && message.mechanic && !message.mechanic.deleted_at) {
      actions.push({
        label: t('shareContact.action'),
        icon: 'share',
        onPress: () => onShareContact(message),
      });
    }
    if (onEdit && isMe && !isImage && canEdit) {
      actions.push({ label: t('chat.edit'), icon: 'edit', onPress: () => onEdit(message) });
    }
    if (onDelete && isMe) {
      actions.push({
        label: t('chat.delete'),
        icon: 'delete',
        destructive: true,
        onPress: () => onDelete(message),
      });
    }
    if (onReport && !isMe) {
      actions.push({
        label: t('chat.report'),
        icon: 'flag',
        destructive: true,
        onPress: () => onReport(message),
      });
    }
    if (onBlock && !isMe && !senderBlocked) {
      actions.push({
        label: t('block.action'),
        icon: 'block',
        destructive: true,
        onPress: () => onBlock(message),
      });
    }
  }

  // Tombstone sau niciun callback aplicabil → nu deschidem un sheet gol.
  return (
    <ActionSheet
      visible={!!message && actions.length > 0}
      title={t('chat.messageActions')}
      actions={actions}
      onClose={onClose}
    />
  );
}
