import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import * as Clipboard from 'expo-clipboard';

import { Avatar } from '@/components/avatar';
import { MessageActionSheet } from '@/components/message-action-sheet';
import { PhotoViewer } from '@/components/photo-viewer';
import { Toast } from '@/components/toast';
import { HeaderText, ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import { pickFromCamera, pickFromLibrary, type PickedImage } from '@/lib/media';

export interface ChatMessageBase {
  id: string;
  /** Gol ('') când mesajul e o poză. */
  content: string;
  /** Path în Storage; prezent doar la mesajele-imagine (Etapa 9.2). */
  image_path?: string | null;
  sender_id: string;
  created_at: string;
  /** Faza 14: marcaje opționale (coloane adăugate incremental în etapele 14.1–14.3). */
  deleted_at?: string | null;
  edited_at?: string | null;
  reply_to_id?: string | null;
  /** Faza 14: mesajul citat (self-join). NULL dacă nu e reply sau citatul a fost șters din DB. */
  reply_to?: {
    id: string;
    content: string;
    image_path: string | null;
    sender_id: string;
    deleted_at: string | null;
    sender?: { full_name: string } | null;
  } | null;
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('ro-RO', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface MessageBubbleProps<M extends ChatMessageBase> {
  message: M;
  isMe: boolean;
  accentColor: string;
  senderLabel?: string | null;
  /** URL semnat, când mesajul e o poză; lipsește cât timp se semnează sau dacă RLS refuză. */
  imageUrl?: string;
  /** Avatarul expeditorului, doar în chatul de grup (unde mesajele vin de la mai mulți). */
  senderName?: string | null;
  senderAvatarUrl?: string;
  showSenderAvatar?: boolean;
  onPressImage?: () => void;
  onLongPress?: () => void;
  /** Tap pe citat → derulează la mesajul original (dacă e încărcat). */
  onPressQuote?: () => void;
  /** Tap pe avatarul expeditorului (chat de grup) → profilul lui. */
  onPressAvatar?: () => void;
}

function MessageBubble<M extends ChatMessageBase>({
  message,
  isMe,
  accentColor,
  senderLabel,
  imageUrl,
  senderName,
  senderAvatarUrl,
  showSenderAvatar,
  onPressImage,
  onLongPress,
  onPressQuote,
  onPressAvatar,
}: MessageBubbleProps<M>) {
  const theme = useTheme();
  const { t } = useTranslation();
  const isDeleted = !!message.deleted_at;
  const isImage = !isDeleted && !!message.image_path;
  const secondaryColor = isMe ? 'rgba(255,255,255,0.7)' : theme.textSecondary;
  const quote = !isDeleted ? message.reply_to : null;
  const quoteSnippet = quote
    ? quote.deleted_at
      ? t('chat.deletedMessage')
      : quote.image_path
        ? t('chat.photo')
        : quote.content
    : '';
  return (
    <View style={[styles.bubbleRow, isMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      {showSenderAvatar && !isMe ? (
        <Pressable onPress={onPressAvatar} disabled={!onPressAvatar}>
          <Avatar url={senderAvatarUrl} name={senderName} size={32} />
        </Pressable>
      ) : null}
      <View style={styles.bubbleColumn}>
        {senderLabel ? (
          <ThemedText themeColor="textSecondary" type="small" style={styles.senderLabel}>
            {senderLabel}
          </ThemedText>
        ) : null}
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={300}
          style={[
            styles.bubble,
            isImage && styles.bubbleImage,
            { backgroundColor: isMe ? accentColor : theme.backgroundElement },
          ]}>
          {isDeleted ? (
            // Tombstone (Faza 14): bula rămâne, textul e discret (italic/gri).
            <>
              <Text style={[styles.bubbleText, styles.deletedText, { color: secondaryColor }]}>
                {t('chat.deletedMessage')}
              </Text>
              <Text style={[styles.bubbleTime, { color: secondaryColor }]}>
                {formatTime(message.created_at)}
              </Text>
            </>
          ) : isImage ? (
            // Poza umple bula; ora stă peste ea, într-o pastilă întunecată.
            <Pressable
              onPress={imageUrl ? onPressImage : undefined}
              onLongPress={onLongPress}
              delayLongPress={300}
              style={({ pressed }) => [styles.imageWrap, pressed && styles.pressed]}>
              {imageUrl ? (
                <Image
                  source={{ uri: imageUrl }}
                  style={styles.imageThumb}
                  contentFit="cover"
                  transition={150}
                />
              ) : (
                <View style={[styles.imageThumb, styles.imagePlaceholder]}>
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                </View>
              )}
              <View style={styles.imageTimePill}>
                <Text style={styles.imageTimeText}>{formatTime(message.created_at)}</Text>
              </View>
            </Pressable>
          ) : (
            <>
              {quote ? (
                <Pressable
                  onPress={onPressQuote}
                  style={[
                    styles.quote,
                    {
                      backgroundColor: isMe ? 'rgba(255,255,255,0.16)' : theme.background,
                      borderLeftColor: isMe ? '#ffffff' : accentColor,
                    },
                  ]}>
                  <Text
                    numberOfLines={1}
                    style={[styles.quoteName, { color: isMe ? '#ffffff' : accentColor }]}>
                    {quote.sender?.full_name ?? ''}
                  </Text>
                  <Text numberOfLines={1} style={[styles.quoteSnippet, { color: secondaryColor }]}>
                    {quoteSnippet}
                  </Text>
                </Pressable>
              ) : null}
              <Text style={[styles.bubbleText, { color: isMe ? '#ffffff' : theme.text }]}>
                {message.content}
              </Text>
              <View style={styles.metaRow}>
                {message.edited_at ? (
                  <Text style={[styles.bubbleTime, styles.editedLabel, { color: secondaryColor }]}>
                    {t('chat.edited')}
                  </Text>
                ) : null}
                <Text style={[styles.bubbleTime, { color: secondaryColor }]}>
                  {formatTime(message.created_at)}
                </Text>
              </View>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

interface ChatScreenProps<M extends ChatMessageBase> {
  currentUserId: string;
  accentColor: string;
  title: string;
  subtitle: string;
  subtitleIcon?: keyof typeof MaterialIcons.glyphMap;
  bannerText?: string;
  messages: M[];
  loading: boolean;
  loadingMore?: boolean;
  onLoadOlder?: () => void;
  onSend: (content: string, replyToId?: string | null) => Promise<void>;
  /**
   * Trimite o poză ca mesaj propriu (o poză = o bulă). Când lipsește, butonul de
   * atașare nu apare — așa ținem funcționalitatea oprită acolo unde n-a fost încă
   * activată (canalele, până la Etapa 9.2.4).
   */
  onSendImage?: (image: PickedImage) => Promise<void>;
  renderSenderLabel?: (message: M) => string | null;
  /** Chat de grup: numele + avatarul expeditorului, lângă bulele celorlalți. */
  renderSenderName?: (message: M) => string | null;
  renderSenderAvatarPath?: (message: M) => string | null;
  /** Avatarul interlocutorului, în antet (chat 1-la-1). */
  headerAvatarPath?: string | null;
  /** Id-ul interlocutorului din antet — pentru tap pe avatar → profil (chat 1-la-1). */
  headerUserId?: string;
  /** Tap pe avatar (antet sau bulă) → profilul acelui utilizator. Rutarea o decide ecranul. */
  onPressUser?: (userId: string) => void;
  onBack: () => void;
  /**
   * Acțiuni din meniul contextual (tap lung pe bulă), toate opționale — o acțiune
   * apare doar dacă ecranul o furnizează (Faza 14). „Copiază" e intern (client-side).
   */
  /** Aplică editarea (RPC) după ce utilizatorul confirmă textul nou din bara de input. */
  onEditMessage?: (m: M, newContent: string) => Promise<void> | void;
  onDeleteMessage?: (m: M) => void;
  onReportMessage?: (m: M) => void;
  /** Fereastra de editare (3 min), calculată de ecran — vezi Etapa 14.2. */
  canEditMessage?: (m: M) => boolean;
}

export function ChatScreen<M extends ChatMessageBase>({
  currentUserId,
  accentColor,
  title,
  subtitle,
  subtitleIcon,
  bannerText,
  messages,
  loading,
  loadingMore,
  onLoadOlder,
  onSend,
  onSendImage,
  renderSenderLabel,
  renderSenderName,
  renderSenderAvatarPath,
  headerAvatarPath,
  headerUserId,
  onPressUser,
  onBack,
  onEditMessage,
  onDeleteMessage,
  onReportMessage,
  canEditMessage,
}: ChatScreenProps<M>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [menuMessage, setMenuMessage] = useState<M | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<M | null>(null);
  const [replyTarget, setReplyTarget] = useState<M | null>(null);
  const listRef = useRef<FlatList<M>>(null);

  // „Editează" din meniu → intrăm în mod editare: input precompletat + banner cu anulare.
  // Editarea și reply-ul se exclud reciproc în compozitor.
  const enterEditMode = useCallback((m: M) => {
    setReplyTarget(null);
    setEditTarget(m);
    setText(m.content);
  }, []);
  const cancelEdit = useCallback(() => {
    setEditTarget(null);
    setText('');
  }, []);
  const enterReplyMode = useCallback((m: M) => {
    setEditTarget(null);
    setText('');
    setReplyTarget(m);
  }, []);
  const cancelReply = useCallback(() => setReplyTarget(null), []);

  const handleCopy = useCallback(
    async (m: M) => {
      await Clipboard.setStringAsync(m.content);
      setToast(t('chat.copied'));
    },
    [t],
  );
  const hideToast = useCallback(() => setToast(null), []);

  // Confirmarea de ștergere e centralizată aici (nu duplicată în cele 4 ecrane).
  const handleDelete = useCallback(
    (m: M) => {
      Alert.alert(t('chat.deleteConfirmTitle'), t('chat.deleteConfirmBody'), [
        { text: t('photos.cancel'), style: 'cancel' },
        { text: t('chat.delete'), style: 'destructive', onPress: () => onDeleteMessage?.(m) },
      ]);
    },
    [t, onDeleteMessage],
  );

  // Android emite Did*, iOS Will* — ascultăm ambele ca bara să urce la fel pe amândouă.
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false),
    );
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Inverted FlatList needs data in descending order (newest first = shown at bottom)
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  // Tap pe citat → derulează la mesajul original, dacă e în pagina încărcată.
  // Dacă e mai vechi decât paginarea (canal, 50/pagină) → no-op discret.
  const scrollToQuoted = useCallback(
    (quotedId: string) => {
      const index = reversedMessages.findIndex((m) => m.id === quotedId);
      if (index >= 0) {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      }
    },
    [reversedMessages],
  );

  // URL-uri semnate pt. poze ȘI avatare, într-un singur batch care crește pe măsură
  // ce sosesc mesaje noi (`useSignedUrls` cere doar path-urile încă nesemnate).
  const paths = useMemo(() => {
    const imagePaths = messages.map((m) => m.image_path);
    const avatarPaths = renderSenderAvatarPath ? messages.map(renderSenderAvatarPath) : [];
    return [...imagePaths, ...avatarPaths, headerAvatarPath].filter((p): p is string => !!p);
  }, [messages, renderSenderAvatarPath, headerAvatarPath]);
  const urls = useSignedUrls(paths);

  // Pozele conversației, în ordine cronologică: viewer-ul le parcurge pe toate,
  // nu doar pe cea atinsă.
  const viewerPhotos = useMemo(
    () =>
      messages
        .filter((m) => m.image_path && urls[m.image_path])
        .map((m) => ({ id: m.id, url: urls[m.image_path!] })),
    [messages, urls],
  );

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    if (editTarget && onEditMessage) {
      // Mod editare: confirmarea de send aplică editarea în loc să trimită un mesaj nou.
      const target = editTarget;
      setEditTarget(null);
      setText('');
      await onEditMessage(target, trimmed);
    } else {
      const replyId = replyTarget?.id ?? null;
      setText('');
      setReplyTarget(null);
      await onSend(trimmed, replyId);
    }
    setSending(false);
  }

  async function sendImages(images: PickedImage[]) {
    if (!onSendImage || images.length === 0) return;
    setUploading(true);
    // Secvențial: fiecare poză devine mesajul ei, în ordinea aleasă.
    for (const image of images) {
      await onSendImage(image);
    }
    setUploading(false);
  }

  function handleAttach() {
    if (uploading) return;
    Alert.alert(t('photos.sourceTitle'), undefined, [
      {
        text: t('photos.sourceLibrary'),
        onPress: async () => sendImages(await pickFromLibrary()),
      },
      {
        text: t('photos.sourceCamera'),
        onPress: async () => sendImages(await pickFromCamera()),
      },
      { text: t('photos.cancel'), style: 'cancel' },
    ]);
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader>
        <Pressable onPress={onBack} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={theme.onHeader} />
        </Pressable>
        {headerAvatarPath !== undefined ? (
          <Pressable
            onPress={onPressUser && headerUserId ? () => onPressUser(headerUserId) : undefined}
            disabled={!onPressUser || !headerUserId}>
            <Avatar
              url={headerAvatarPath ? urls[headerAvatarPath] : undefined}
              name={title}
              size={36}
            />
          </Pressable>
        ) : null}
        <View style={styles.headerInfo}>
          <HeaderText numberOfLines={1}>{title}</HeaderText>
          <View style={styles.locationRow}>
            {subtitleIcon ? (
              <MaterialIcons name={subtitleIcon} size={11} color={theme.onHeader} />
            ) : null}
            <Text style={[styles.headerSubtitle, { color: theme.onHeader }]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>
      </ScreenHeader>

      {bannerText ? (
        <View style={styles.resolvedBanner}>
          <MaterialIcons name="check-circle" size={14} color="#22c55e" />
          <Text style={styles.resolvedText}>{bannerText}</Text>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={accentColor} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.centered}>
            <MaterialIcons name="chat-bubble-outline" size={48} color={theme.textSecondary} />
            <ThemedText themeColor="textSecondary" type="small" style={styles.emptyText}>
              {t('chat.emptyMessages')}
            </ThemedText>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={reversedMessages}
            keyExtractor={(item) => item.id}
            inverted
            contentContainerStyle={styles.messageList}
            onEndReached={onLoadOlder}
            onEndReachedThreshold={0.3}
            // Mesajul citat poate să nu fie randat încă → eșec grațios, fără crash.
            onScrollToIndexFailed={() => {}}
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.loadingMore}>
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                </View>
              ) : null
            }
            renderItem={({ item }) => {
              const avatarPath = renderSenderAvatarPath?.(item) ?? null;
              return (
              <MessageBubble
                message={item}
                isMe={item.sender_id === currentUserId}
                accentColor={accentColor}
                senderLabel={
                  item.sender_id !== currentUserId && renderSenderLabel
                    ? renderSenderLabel(item)
                    : null
                }
                showSenderAvatar={!!renderSenderAvatarPath}
                senderName={renderSenderName?.(item) ?? null}
                senderAvatarUrl={avatarPath ? urls[avatarPath] : undefined}
                imageUrl={item.image_path ? urls[item.image_path] : undefined}
                onPressImage={() => {
                  const index = viewerPhotos.findIndex((p) => p.id === item.id);
                  if (index >= 0) setViewerAt(index);
                }}
                onLongPress={() => setMenuMessage(item)}
                onPressQuote={
                  item.reply_to_id ? () => scrollToQuoted(item.reply_to_id!) : undefined
                }
                onPressAvatar={
                  onPressUser ? () => onPressUser(item.sender_id) : undefined
                }
              />
              );
            }}
          />
        )}

        {replyTarget && !editTarget ? (
          <View style={[styles.editBanner, { backgroundColor: theme.backgroundElement }]}>
            <MaterialIcons name="reply" size={16} color={accentColor} />
            <View style={styles.editBannerInfo}>
              <Text style={[styles.editBannerTitle, { color: accentColor }]} numberOfLines={1}>
                {renderSenderName?.(replyTarget) ??
                  (replyTarget.sender_id === currentUserId ? t('chat.you') : title)}
              </Text>
              <Text
                style={[styles.editBannerText, { color: theme.textSecondary }]}
                numberOfLines={1}>
                {replyTarget.deleted_at
                  ? t('chat.deletedMessage')
                  : replyTarget.image_path
                    ? t('chat.photo')
                    : replyTarget.content}
              </Text>
            </View>
            <Pressable onPress={cancelReply} hitSlop={8} accessibilityLabel={t('chat.cancelReply')}>
              <MaterialIcons name="close" size={20} color={theme.textSecondary} />
            </Pressable>
          </View>
        ) : null}

        {editTarget ? (
          <View style={[styles.editBanner, { backgroundColor: theme.backgroundElement }]}>
            <MaterialIcons name="edit" size={16} color={accentColor} />
            <View style={styles.editBannerInfo}>
              <Text style={[styles.editBannerTitle, { color: accentColor }]}>
                {t('chat.editingMessage')}
              </Text>
              <Text
                style={[styles.editBannerText, { color: theme.textSecondary }]}
                numberOfLines={1}>
                {editTarget.content}
              </Text>
            </View>
            <Pressable onPress={cancelEdit} hitSlop={8} accessibilityLabel={t('chat.cancelEdit')}>
              <MaterialIcons name="close" size={20} color={theme.textSecondary} />
            </Pressable>
          </View>
        ) : null}

        <View
          style={[
            styles.inputBar,
            {
              // Cu tastatura deschisă, zona de siguranță de jos (bara de navigație)
              // e acoperită de tastatură — dacă i-am păstra padding-ul, bara de input
              // ar pluti la câțiva zeci de px deasupra tastelor.
              paddingBottom: keyboardVisible ? Spacing.one : insets.bottom + Spacing.two,
              backgroundColor: theme.background,
              borderTopColor: theme.backgroundElement,
            },
          ]}>
          {onSendImage && !editTarget ? (
            <Pressable
              onPress={handleAttach}
              disabled={uploading}
              style={styles.attachButton}
              hitSlop={8}
              accessibilityLabel={t('chat.attach')}>
              {uploading ? (
                <ActivityIndicator size="small" color={accentColor} />
              ) : (
                <MaterialIcons name="add-a-photo" size={22} color={theme.textSecondary} />
              )}
            </Pressable>
          ) : null}
          <TextInput
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundElement },
            ]}
            value={text}
            onChangeText={setText}
            placeholder={t('chat.inputPlaceholder')}
            placeholderTextColor={theme.textSecondary}
            multiline
            maxLength={1000}
          />
          <Pressable
            onPress={handleSend}
            disabled={!text.trim() || sending}
            style={[
              styles.sendButton,
              {
                backgroundColor: accentColor,
                opacity: text.trim() && !sending ? 1 : 0.4,
              },
            ]}>
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name={editTarget ? 'check' : 'send'} size={20} color="#fff" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {viewerAt !== null ? (
        <PhotoViewer
          visible
          photos={viewerPhotos}
          initialIndex={viewerAt}
          showDownload
          onClose={() => setViewerAt(null)}
        />
      ) : null}

      <MessageActionSheet
        message={menuMessage}
        isMe={menuMessage ? menuMessage.sender_id === currentUserId : false}
        canEdit={menuMessage && canEditMessage ? canEditMessage(menuMessage) : false}
        onClose={() => setMenuMessage(null)}
        onCopy={handleCopy}
        onReply={enterReplyMode}
        onEdit={onEditMessage ? enterEditMode : undefined}
        onDelete={onDeleteMessage ? handleDelete : undefined}
        onReport={onReportMessage}
      />

      <Toast message={toast} onHide={hideToast} bottomOffset={64} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  headerInfo: { flex: 1, gap: 2 },
  headerSubtitle: { fontSize: 13, lineHeight: 18, opacity: 0.85 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.two },
  emptyText: { textAlign: 'center' },
  messageList: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  loadingMore: { paddingVertical: Spacing.two, alignItems: 'center' },
  // `flex-end`: în chatul de grup avatarul stă lângă baza bulei, nu lângă vârful ei.
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.one, marginVertical: 2 },
  bubbleRowRight: { justifyContent: 'flex-end' },
  bubbleRowLeft: { justifyContent: 'flex-start' },
  bubbleColumn: { maxWidth: '78%' },
  senderLabel: { marginBottom: 2, marginLeft: 4, fontSize: 11 },
  bubble: {
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 2,
    gap: 2,
  },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTime: { fontSize: 11, alignSelf: 'flex-end' },
  deletedText: { fontStyle: 'italic' },
  metaRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: Spacing.one },
  editedLabel: { fontStyle: 'italic' },
  quote: {
    borderLeftWidth: 3,
    borderRadius: Radius.badge,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    marginBottom: Spacing.one,
    gap: 1,
  },
  quoteName: { fontSize: 12, fontWeight: '700' },
  quoteSnippet: { fontSize: 13 },
  // Bula-imagine: fără padding, poza umple bula.
  bubbleImage: { padding: 0, overflow: 'hidden' },
  imageWrap: { width: 220, height: 220 },
  imageThumb: { width: '100%', height: '100%' },
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#00000015',
  },
  imageTimePill: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.badge,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  imageTimeText: { fontSize: 11, color: '#fff' },
  attachButton: {
    width: 42,
    height: 42,
    borderRadius: Radius.circle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: { opacity: 0.8 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    fontSize: 15,
    maxHeight: 120,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: Radius.circle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resolvedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one + 2,
    backgroundColor: '#22c55e1A',
  },
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.control,
  },
  editBannerInfo: { flex: 1, gap: 1 },
  editBannerTitle: { fontSize: 12, fontWeight: '700' },
  editBannerText: { fontSize: 13 },
  resolvedText: {
    fontSize: 12,
    color: '#22c55e',
    fontWeight: '600',
  },
});
