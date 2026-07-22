import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';


import { Avatar } from '@/components/avatar';
import { MessageActionSheet } from '@/components/message-action-sheet';
import { PhotoViewer } from '@/components/photo-viewer';
import { ReportSheet } from '@/components/report-sheet';
import { Toast } from '@/components/toast';
import { HeaderText, ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  ActiveGradient,
  HeaderGradientDirection,
  Radius,
  Shadows,
  Spacing,
} from '@/constants/theme';
import { useBlocked } from '@/hooks/use-blocked';
import { useResolvedScheme } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import { MAX_PHOTOS, pickFromCamera, pickFromLibrary, type PickedImage } from '@/lib/media';

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
  /** Faza 16: tombstone pus de un moderator → marcaj distinct „Șters de moderator". */
  deleted_by_admin?: boolean | null;
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

/** Cheie de zi locală (nu UTC) — decide unde apar separatoarele de dată. */
function dayKey(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Suprafața bulei: gradientul „element activ" la mesajele proprii, suprafață
 * simplă la cele primite — același interior, ambele teme.
 */
function BubbleSurface({
  isMe,
  scheme,
  style,
  children,
}: {
  isMe: boolean;
  scheme: 'light' | 'dark';
  style: React.ComponentProps<typeof View>['style'];
  children: React.ReactNode;
}) {
  if (isMe) {
    return (
      <LinearGradient
        colors={ActiveGradient[scheme]}
        start={HeaderGradientDirection.start}
        end={HeaderGradientDirection.end}
        style={style}>
        {children}
      </LinearGradient>
    );
  }
  return <View style={style}>{children}</View>;
}

interface MessageBubbleProps<M extends ChatMessageBase> {
  message: M;
  isMe: boolean;
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
  /** Bife (doar chat privat, mesaj propriu): trimis (✓) / citit (✓✓). Null = fără bife. */
  readState?: 'sent' | 'read' | null;
  /** Swipe la dreapta pe bulă → reply; absent = gestul e dezactivat (ex. mesaj șters). */
  onSwipeReply?: () => void;
}

function MessageBubble<M extends ChatMessageBase>({
  message,
  isMe,
  senderLabel,
  imageUrl,
  senderName,
  senderAvatarUrl,
  showSenderAvatar,
  onPressImage,
  onLongPress,
  onPressQuote,
  onPressAvatar,
  readState,
  onSwipeReply,
}: MessageBubbleProps<M>) {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const { t } = useTranslation();
  const isDeleted = !!message.deleted_at;
  const isImage = !isDeleted && !!message.image_path;
  // Design 22 iul: timp/bife pe bula trimisă = alb 70%; pe cea primită = text terțiar.
  const secondaryColor = isMe ? 'rgba(255,255,255,0.7)' : theme.textTertiary;
  const tick = readState ? (
    <MaterialIcons
      name={readState === 'read' ? 'done-all' : 'check'}
      size={14}
      color={secondaryColor}
    />
  ) : null;
  // PostgREST întoarce embed-ul self-join `reply_to` ca ARRAY ([] pentru non-reply),
  // nu ca obiect/null. `[]` e truthy → randa un chenar `styles.quote` gol deasupra
  // textului (foarte vizibil pe bulele verzi). Normalizăm (array→primul) și cerem `id`.
  const rawReply = message.reply_to as unknown;
  const rt = (Array.isArray(rawReply) ? rawReply[0] : rawReply) as ChatMessageBase['reply_to'];
  const quote = !isDeleted && rt && rt.id ? rt : null;
  const quoteSnippet = quote
    ? quote.deleted_at
      ? t('chat.deletedMessage')
      : quote.image_path
        ? t('chat.photo')
        : quote.content
    : '';

  // Swipe la dreapta → reply (ambele platforme). Detectorul stă pe ÎNTREGUL rând al
  // mesajului, nu doar pe bulă — la mesajele scurte bula e îngustă și degetul nimerea
  // pe lângă ea; animația se aplică tot doar bulei. Dacă degetul pornește CHIAR pe
  // bulă (instinctul majorității), pragul e la JUMĂTATE — limitele bulei vin din
  // onLayout, iar pragul se alege la începutul gestului. Activare DOAR pe orizontală
  // (activeOffsetX + failOffsetY), ca gestul să nu fure scroll-ul vertical al listei.
  // Reply-ul se declanșează în onUpdate, la trecerea pragului — NU în onEnd: pe iOS
  // Pressable-ul interior putea anula gestul înainte de onEnd. onFinalize rulează și
  // la anulare → resetul animației e garantat.
  const translateX = useSharedValue(0);
  const swipeTriggered = useSharedValue(false);
  const bubbleLeft = useSharedValue(0);
  const bubbleRight = useSharedValue(0);
  const swipeThreshold = useSharedValue(40);
  const swipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const swipeGesture = Gesture.Pan()
    .enabled(!!onSwipeReply)
    .activeOffsetX(16)
    .failOffsetY([-16, 16])
    .onStart((e) => {
      swipeTriggered.value = false;
      swipeThreshold.value =
        e.x >= bubbleLeft.value && e.x <= bubbleRight.value ? 20 : 40;
    })
    .onUpdate((e) => {
      translateX.value = Math.min(Math.max(e.translationX, 0), 80);
      if (!swipeTriggered.value && e.translationX > swipeThreshold.value && onSwipeReply) {
        swipeTriggered.value = true;
        runOnJS(onSwipeReply)();
      }
    })
    .onFinalize(() => {
      translateX.value = withSpring(0, { damping: 22, stiffness: 300 });
    });

  return (
    <GestureDetector gesture={swipeGesture}>
    <View style={[styles.bubbleRow, isMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      {showSenderAvatar && !isMe ? (
        <Pressable onPress={onPressAvatar} disabled={!onPressAvatar}>
          <Avatar url={senderAvatarUrl} name={senderName} size={32} />
        </Pressable>
      ) : null}
      <Animated.View
        style={[styles.bubbleColumn, swipeStyle]}
        onLayout={(e) => {
          bubbleLeft.value = e.nativeEvent.layout.x;
          bubbleRight.value = e.nativeEvent.layout.x + e.nativeEvent.layout.width;
        }}>
        {senderLabel ? (
          <ThemedText themeColor="textSecondary" type="small" style={styles.senderLabel}>
            {senderLabel}
          </ThemedText>
        ) : null}
        <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <BubbleSurface
          isMe={isMe}
          scheme={scheme}
          style={[
            styles.bubble,
            isMe ? styles.bubbleMe : styles.bubbleOther,
            // Umbra stă pe suprafața cu fundal (altfel Android nu desenează elevation);
            // în dark, bulele primite rămân plate — decizie de design.
            isMe && (scheme === 'light' ? styles.sentShadowLight : styles.sentShadowDark),
            isImage && styles.bubbleImage,
            !isMe && { backgroundColor: theme.backgroundElement },
          ]}>
          {isDeleted ? (
            // Tombstone (Faza 14): bula rămâne, textul e discret (italic/gri).
            // Faza 16: marcaj DISTINCT dacă ștergerea a fost făcută de un moderator.
            <>
              <Text style={[styles.bubbleText, styles.deletedText, { color: secondaryColor }]}>
                {message.deleted_by_admin ? t('chat.deletedByModerator') : t('chat.deletedMessage')}
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
                {tick}
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
                      borderLeftColor: isMe ? '#ffffff' : theme.brand,
                    },
                  ]}>
                  <Text
                    numberOfLines={1}
                    style={[styles.quoteName, { color: isMe ? '#ffffff' : theme.brand }]}>
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
                {tick}
              </View>
            </>
          )}
        </BubbleSurface>
        </Pressable>
      </Animated.View>
    </View>
    </GestureDetector>
  );
}

interface ChatScreenProps<M extends ChatMessageBase> {
  currentUserId: string;
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
  /** Tabelul mesajelor („messages" privat / „channel_messages" canal) — activează raportarea. */
  messageTable?: 'messages' | 'channel_messages';
  /** Fereastra de editare (3 min), calculată de ecran — vezi Etapa 14.2. */
  canEditMessage?: (m: M) => boolean;
  /** Bife de citit — DOAR chat privat (nu are sens cu N participanți). */
  readReceipts?: boolean;
  /** `last_read_at` al celuilalt participant (chat privat) — decide ✓ vs ✓✓. */
  readCursor?: string | null;
}

export function ChatScreen<M extends ChatMessageBase>({
  currentUserId,
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
  messageTable,
  canEditMessage,
  readReceipts,
  readCursor,
}: ChatScreenProps<M>) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const { blockedIds, block, unblock } = useBlocked();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [menuMessage, setMenuMessage] = useState<M | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<M | null>(null);
  const [replyTarget, setReplyTarget] = useState<M | null>(null);
  const [reportTarget, setReportTarget] = useState<M | null>(null);
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
      try {
        // Import LENEȘ: pe development build-urile vechi (compilate înainte ca
        // expo-clipboard să fie adăugat în Faza 14) modulul nativ `ExpoClipboard`
        // lipsește, iar un import STATIC ar crăpa aplicația la pornire. Îl încărcăm
        // doar la apăsarea pe „Copiază” și degradăm elegant dacă lipsește.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
        await Clipboard.setStringAsync(m.content);
        setToast(t('chat.copied'));
      } catch {
        // Modul nativ absent (dev build vechi) → copierea nu e disponibilă. În Expo Go
        // și pe build-urile noi funcționează normal.
      }
    },
    [t],
  );
  const hideToast = useCallback(() => setToast(null), []);

  // Blocarea (Faza 18): confirmare + RPC; efectele server-side (îngheț, feed) sunt
  // instant, iar în chatul global mesajele expeditorului dispar prin filtrul din hook.
  const handleBlock = useCallback(
    (m: M) => {
      Alert.alert(t('block.confirmTitle'), t('block.confirmBody'), [
        { text: t('block.cancel'), style: 'cancel' },
        {
          text: t('block.confirm'),
          style: 'destructive',
          onPress: async () => {
            const err = await block(m.sender_id);
            setToast(err ? t('block.error') : t('block.done'));
          },
        },
      ]);
    },
    [t, block],
  );

  // Doar blockerul își vede starea (propriile blocări) — pentru chat 1-la-1 înghețăm
  // compozitorul cu banner + Deblochează. Blocatul nu primește niciun indicator.
  const peerBlocked = !!headerUserId && blockedIds.has(headerUserId);
  const handleUnblockPeer = useCallback(() => {
    if (!headerUserId) return;
    Alert.alert(t('block.unblockConfirmTitle'), t('block.unblockConfirmBody'), [
      { text: t('block.cancel'), style: 'cancel' },
      { text: t('block.unblock'), onPress: () => unblock(headerUserId) },
    ]);
  }, [t, unblock, headerUserId]);

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

  // Inverted FlatList needs data in descending order (newest first = shown at bottom)
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  // Eticheta pastilei de dată: Astăzi / Ieri / dată în limba aplicației.
  const dateLabel = useCallback(
    (dateStr: string) => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      if (dayKey(dateStr) === dayKey(now.toISOString())) return t('chat.today');
      if (dayKey(dateStr) === dayKey(yesterday.toISOString())) return t('chat.yesterday');
      const d = new Date(dateStr);
      return d.toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'long',
        ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
      });
    },
    [t, i18n.language],
  );

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
    // Max 10 poze deodată (Faza 14.8); pe Android pickerul poate ignora selectionLimit.
    const capped = images.slice(0, MAX_PHOTOS);
    if (images.length > MAX_PHOTOS) {
      Alert.alert(t('photos.limitReachedTitle'), t('photos.limitReached', { max: MAX_PHOTOS }));
    }
    setUploading(true);
    // Secvențial: fiecare poză devine mesajul ei, în ordinea aleasă.
    for (const image of capped) {
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
          <Feather name="chevron-left" size={26} color={theme.onHeader} />
        </Pressable>
        {headerAvatarPath !== undefined ? (
          <Pressable
            onPress={onPressUser && headerUserId ? () => onPressUser(headerUserId) : undefined}
            disabled={!onPressUser || !headerUserId}
            style={styles.headerAvatarRing}>
            <Avatar
              url={headerAvatarPath ? urls[headerAvatarPath] : undefined}
              name={title}
              size={38}
            />
          </Pressable>
        ) : null}
        <View style={styles.headerInfo}>
          <HeaderText numberOfLines={1} style={styles.headerName}>
            {title}
          </HeaderText>
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

      {/* Fără keyboardVerticalOffset: KAV-ul își măsoară poziția relativ la părintele
          full-screen, deci baza lui e deja fundul ecranului — un offset ar SUPRA-compensa
          cu înălțimea headerului (gol între bară și tastatură; verificat pe iPhone real). */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.brand} />
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
            renderItem={({ item, index }) => {
              const avatarPath = renderSenderAvatarPath?.(item) ?? null;
              // Lista e inversată: item-ul următor din array e mesajul mai VECHI.
              // Primul mesaj al fiecărei zile primește pastila de dată deasupra.
              const older = reversedMessages[index + 1];
              const showDate = !older || dayKey(older.created_at) !== dayKey(item.created_at);
              return (
              <View>
              {showDate ? (
                <View style={styles.dateRow}>
                  <View
                    style={[
                      styles.datePill,
                      { backgroundColor: theme.backgroundElement },
                      scheme === 'light' && Shadows.chip,
                    ]}>
                    <Text style={[styles.datePillText, { color: theme.textTertiary }]}>
                      {dateLabel(item.created_at)}
                    </Text>
                  </View>
                </View>
              ) : null}
              <MessageBubble
                message={item}
                isMe={item.sender_id === currentUserId}
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
                onSwipeReply={!item.deleted_at ? () => enterReplyMode(item) : undefined}
                onPressQuote={
                  item.reply_to_id ? () => scrollToQuoted(item.reply_to_id!) : undefined
                }
                onPressAvatar={
                  onPressUser ? () => onPressUser(item.sender_id) : undefined
                }
                readState={
                  readReceipts && item.sender_id === currentUserId && !item.deleted_at
                    ? readCursor &&
                      new Date(readCursor).getTime() > new Date(item.created_at).getTime()
                      ? 'read'
                      : 'sent'
                    : null
                }
              />
              </View>
              );
            }}
          />
        )}

        {replyTarget && !editTarget ? (
          <View style={[styles.editBanner, { backgroundColor: theme.backgroundElement }]}>
            <MaterialIcons name="reply" size={16} color={theme.brand} />
            <View style={styles.editBannerInfo}>
              <Text style={[styles.editBannerTitle, { color: theme.brand }]} numberOfLines={1}>
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
            <MaterialIcons name="edit" size={16} color={theme.brand} />
            <View style={styles.editBannerInfo}>
              <Text style={[styles.editBannerTitle, { color: theme.brand }]}>
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

        {peerBlocked ? (
          // Compozitor înghețat (doar la blocker): fără input, cu ieșire directă din blocare.
          <View
            style={[
              styles.blockedBar,
              { backgroundColor: theme.barBackground, borderTopColor: theme.separator },
            ]}>
            <MaterialIcons name="block" size={16} color={theme.textSecondary} />
            <Text style={[styles.blockedBarText, { color: theme.textSecondary }]}>
              {t('block.bannerText')}
            </Text>
            <Pressable onPress={handleUnblockPeer} hitSlop={8}>
              <Text style={[styles.blockedBarAction, { color: theme.brand }]}>
                {t('block.unblock')}
              </Text>
            </Pressable>
          </View>
        ) : (
        <View
          style={[
            styles.inputBar,
            {
              // Fără insets.bottom: sub bara de input e TAB BAR-ul, care ocupă el zona
              // de siguranță — adăugarea insetului dubla compensarea și lăsa un gol
              // vizibil între input și tab-uri (feedback pe Samsung + iPhone).
              // Cu tastatura deschisă padding-ul rămâne minim (bara stă lipită de taste).
              paddingBottom: Spacing.one,
              backgroundColor: theme.barBackground,
              borderTopColor: theme.separator,
            },
          ]}>
          {onSendImage && !editTarget ? (
            <Pressable
              onPress={handleAttach}
              disabled={uploading}
              style={[styles.attachButton, { backgroundColor: theme.brandSoft }]}
              hitSlop={8}
              accessibilityLabel={t('chat.attach')}>
              {uploading ? (
                <ActivityIndicator size="small" color={theme.brand} />
              ) : (
                <Feather name="camera" size={19} color={theme.brand} />
              )}
            </Pressable>
          ) : null}
          <TextInput
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.background },
            ]}
            value={text}
            onChangeText={setText}
            placeholder={t('chat.inputPlaceholder')}
            placeholderTextColor={theme.textTertiary}
            multiline
            maxLength={1000}
          />
          <Pressable
            onPress={handleSend}
            disabled={!text.trim() || sending}
            style={{ opacity: text.trim() && !sending ? 1 : 0.4 }}>
            <LinearGradient
              colors={ActiveGradient[scheme]}
              start={HeaderGradientDirection.start}
              end={HeaderGradientDirection.end}
              style={[
                styles.sendButton,
                scheme === 'light' ? styles.sendShadowLight : styles.sendShadowDark,
              ]}>
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : editTarget ? (
                <Feather name="check" size={20} color="#fff" />
              ) : (
                <Feather name="send" size={19} color="#fff" />
              )}
            </LinearGradient>
          </Pressable>
        </View>
        )}
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
        onReport={messageTable ? setReportTarget : undefined}
        onBlock={handleBlock}
        senderBlocked={menuMessage ? blockedIds.has(menuMessage.sender_id) : false}
      />

      {reportTarget && messageTable ? (
        <ReportSheet
          visible
          reportedUserId={reportTarget.sender_id}
          messageId={reportTarget.id}
          messageTable={messageTable}
          contentSnapshot={reportTarget.content}
          imagePathSnapshot={reportTarget.image_path}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => {
            setReportTarget(null);
            setToast(t('report.submitted'));
          }}
        />
      ) : null}

      <Toast message={toast} onHide={hideToast} bottomOffset={64} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  headerInfo: { flex: 1, gap: 2 },
  // Design 22 iul: nume 17/800, subtitlu 12/600 la 75%, avatar cu inel alb translucid.
  headerName: { fontSize: 17, fontWeight: '800' },
  headerSubtitle: { fontSize: 12, fontWeight: '600', lineHeight: 17, opacity: 0.75 },
  headerAvatarRing: {
    borderRadius: Radius.circle,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    padding: 1,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dateRow: { alignItems: 'center', marginVertical: Spacing.two },
  datePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.badge,
  },
  datePillText: { fontSize: 11, fontWeight: '700' },
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
  bubbleColumn: { maxWidth: '75%' },
  senderLabel: { marginBottom: 2, marginLeft: 4, fontSize: 11 },
  // Colțurile-„coadă" (4px jos, pe partea expeditorului) vin din bubbleMe/bubbleOther.
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    // Fără gap: ora stă imediat sub text (leading-ul liniei de text dă deja ~3px aer);
    // gap-ul de 2px în plus se citea ca spațiu mort sub mesaj (feedback pe device).
  },
  bubbleMe: { borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4 },
  sentShadowLight: {
    shadowColor: '#0E3A7D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  sentShadowDark: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 4,
  },
  sendShadowLight: {
    shadowColor: '#0E3A7D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 5,
  },
  sendShadowDark: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 5,
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTime: { fontSize: 11, lineHeight: 14, fontWeight: '600', alignSelf: 'flex-end' },
  // paddingRight: Android măsoară textul italic cu lățimea glifelor drepte (o
  // subestimează) → ultimul cuvânt se tăia la marginea bulei („This message was…”).
  // Padding-ul mută zona tăiată pe spațiu gol, nu pe text.
  deletedText: { fontStyle: 'italic', paddingRight: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: Spacing.one },
  editedLabel: { fontStyle: 'italic', paddingRight: 2 }, // italic: același clip ca deletedText
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
  // Bula-imagine: padding 6, poza rotunjită 12 înăuntru (design 22 iul).
  bubbleImage: { paddingHorizontal: 6, paddingVertical: 6, overflow: 'hidden' },
  imageWrap: { width: 220, height: 150 },
  imageThumb: { width: '100%', height: '100%', borderRadius: 12 },
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#00000015',
  },
  imageTimePill: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.badge,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  imageTimeText: { fontSize: 11, color: '#fff' },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.circle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: { opacity: 0.8 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 10,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderRadius: Radius.badge,
    paddingHorizontal: 16,
    paddingVertical: 11,
    fontSize: 14,
    maxHeight: 120,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.circle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  blockedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
  },
  blockedBarText: { flex: 1, fontSize: 13 },
  blockedBarAction: { fontSize: 14, fontWeight: '700' },
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
