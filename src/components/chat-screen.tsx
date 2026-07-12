import { useEffect, useMemo, useState } from 'react';
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

import { PhotoViewer } from '@/components/photo-viewer';
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
  onPressImage?: () => void;
}

function MessageBubble<M extends ChatMessageBase>({
  message,
  isMe,
  accentColor,
  senderLabel,
  imageUrl,
  onPressImage,
}: MessageBubbleProps<M>) {
  const theme = useTheme();
  const isImage = !!message.image_path;
  return (
    <View style={[styles.bubbleRow, isMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      <View style={styles.bubbleColumn}>
        {senderLabel ? (
          <ThemedText themeColor="textSecondary" type="small" style={styles.senderLabel}>
            {senderLabel}
          </ThemedText>
        ) : null}
        <View
          style={[
            styles.bubble,
            isImage && styles.bubbleImage,
            { backgroundColor: isMe ? accentColor : theme.backgroundElement },
          ]}>
          {isImage ? (
            // Poza umple bula; ora stă peste ea, într-o pastilă întunecată.
            <Pressable
              onPress={imageUrl ? onPressImage : undefined}
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
              <Text style={[styles.bubbleText, { color: isMe ? '#ffffff' : theme.text }]}>
                {message.content}
              </Text>
              <Text style={[styles.bubbleTime, { color: isMe ? 'rgba(255,255,255,0.7)' : theme.textSecondary }]}>
                {formatTime(message.created_at)}
              </Text>
            </>
          )}
        </View>
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
  onSend: (content: string) => Promise<void>;
  /**
   * Trimite o poză ca mesaj propriu (o poză = o bulă). Când lipsește, butonul de
   * atașare nu apare — așa ținem funcționalitatea oprită acolo unde n-a fost încă
   * activată (canalele, până la Etapa 9.2.4).
   */
  onSendImage?: (image: PickedImage) => Promise<void>;
  renderSenderLabel?: (message: M) => string | null;
  onBack: () => void;
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
  onBack,
}: ChatScreenProps<M>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

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

  // URL-uri semnate pt. mesajele-imagine, cerute în batch pe măsură ce sosesc.
  const imagePaths = useMemo(
    () => messages.map((m) => m.image_path).filter((p): p is string => !!p),
    [messages],
  );
  const urls = useSignedUrls(imagePaths);

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
    setText('');
    await onSend(trimmed);
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
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: theme.backgroundElement }]}>
        <Pressable onPress={onBack} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} />
        </Pressable>
        <View style={styles.headerInfo}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {title}
          </ThemedText>
          <View style={styles.locationRow}>
            {subtitleIcon ? (
              <MaterialIcons name={subtitleIcon} size={11} color={theme.textSecondary} />
            ) : null}
            <ThemedText themeColor="textSecondary" type="small" numberOfLines={1}>
              {subtitle}
            </ThemedText>
          </View>
        </View>
      </View>

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
            data={reversedMessages}
            keyExtractor={(item) => item.id}
            inverted
            contentContainerStyle={styles.messageList}
            onEndReached={onLoadOlder}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.loadingMore}>
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                isMe={item.sender_id === currentUserId}
                accentColor={accentColor}
                senderLabel={
                  item.sender_id !== currentUserId && renderSenderLabel
                    ? renderSenderLabel(item)
                    : null
                }
                imageUrl={item.image_path ? urls[item.image_path] : undefined}
                onPressImage={() => {
                  const index = viewerPhotos.findIndex((p) => p.id === item.id);
                  if (index >= 0) setViewerAt(index);
                }}
              />
            )}
          />
        )}

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
          {onSendImage ? (
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
              <MaterialIcons name="send" size={20} color="#fff" />
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    gap: Spacing.three,
    borderBottomWidth: 1,
  },
  headerInfo: { flex: 1, gap: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.two },
  emptyText: { textAlign: 'center' },
  messageList: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  loadingMore: { paddingVertical: Spacing.two, alignItems: 'center' },
  bubbleRow: { flexDirection: 'row', marginVertical: 2 },
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
  resolvedText: {
    fontSize: 12,
    color: '#22c55e',
    fontWeight: '600',
  },
});
