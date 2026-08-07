import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';


import { ActionSheet } from '@/components/action-sheet';
import { AttachSheet } from '@/components/attach-sheet';
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
import { displayName } from '@/lib/display-name';
import { MAX_PHOTOS, pickFromCamera, pickFromLibrary, type PickedImage } from '@/lib/media';
import {
  BLOCKED_FILE_EXTENSIONS,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_MB,
  fileExtension,
  signedUrl,
  type PickedFile,
} from '@/lib/storage';
import { webDownload } from '@/lib/web-download';

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
  /** Faza 19.4: contextul de anunț de market atașat mesajului („Sunt interesat"). */
  listing_id?: string | null;
  /** NULL și când anunțul a fost șters (SET NULL) — cardul pur și simplu nu se randează. */
  listing?: {
    id: string;
    title: string;
    price: number;
    currency: string;
    status: string;
    category?: string | null;
    description?: string | null;
    market_listing_photos?: { storage_path: string; position: number }[];
  } | null;
  /** Faza 19.5/19.6: utilizatorul recomandat atașat mesajului (mecanic SAU transportator). */
  recommended_mechanic_id?: string | null;
  mechanic?: {
    id: string;
    full_name: string;
    avatar_path: string | null;
    deleted_at: string | null;
    /** Rolul REAL — decide rutarea cardului (numele câmpului rămâne istoric). */
    role?: string;
    rating_avg: number;
    rating_count: number;
    specialization?: string | null;
    activity_zone?: string | null;
  } | null;
  /** Faza 19.5: mesaj-fișier (un fișier = o bulă; content=''). */
  file_path?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  /** Faza 19.6: anunțul de depanare distribuit (share). NULL = șters/invizibil prin RLS. */
  announcement_id?: string | null;
  announcement?: {
    id: string;
    location: string;
    status: string;
    description?: string | null;
  } | null;
}

/** Cover-ul unui anunț de market din embed-ul de poze (poziția minimă = cover). */
function listingCoverPath(
  listing: NonNullable<ChatMessageBase['listing']> | null | undefined,
): string | null {
  const photos = listing?.market_listing_photos;
  if (!photos || photos.length === 0) return null;
  return [...photos].sort((a, b) => a.position - b.position)[0].storage_path;
}

/** Mărimea fișierului, lizibilă: sub 1 MB în KB, altfel în MB cu o zecimală. */
function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Stil 6b (26 iul, spec user): „atașament etichetat" — tokens semantici dedicați
 * cardurilor de context, comutați de temă. Cardul NU stă în bula navy: e o suprafață
 * proprie (alb/dark) direct pe fundalul conversației, cu bandă de tip sus și CTA jos.
 */
const CARD_TOKENS = {
  light: {
    surface: '#FFFFFF',
    bandBg: '#E8EEFB',
    label: '#0E3A7D',
    textPrimary: '#1C2635',
    textSecondary: '#5B6472',
    textTertiary: '#98A1AD',
    price: '#1C9E4F',
    star: '#F5A623',
    separator: '#EEF1F5',
    photoBg: '#E3E9F1',
  },
  dark: {
    surface: '#1A2333',
    bandBg: '#1E2A40',
    label: '#7BA7E0',
    textPrimary: '#E8EDF4',
    textSecondary: '#96A1B1',
    textTertiary: '#7D8899',
    price: '#4ECB7D',
    star: '#F5A623',
    separator: '#202B3E',
    photoBg: '#212C40',
  },
} as const;

interface AttachmentCardProps {
  isMe: boolean;
  scheme: 'light' | 'dark';
  icon: keyof typeof Feather.glyphMap;
  bandLabel: string;
  cta: string;
  onPress?: () => void;
  onLongPress?: () => void;
  children: React.ReactNode;
}

/** Scheletul cardului 6b: bandă de tip → corp (children) → CTA. Tot cardul e tappabil. */
function AttachmentCard({
  isMe,
  scheme,
  icon,
  bandLabel,
  cta,
  onPress,
  onLongPress,
  children,
}: AttachmentCardProps) {
  const tk = CARD_TOKENS[scheme];
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      disabled={!onPress && !onLongPress}
      style={[
        styles.attachCard,
        { backgroundColor: tk.surface },
        scheme === 'light' && styles.attachCardShadow,
      ]}>
      <View style={[styles.attachBand, { backgroundColor: tk.bandBg }]}>
        <Feather name={icon} size={14} color={tk.label} />
        <Text style={[styles.attachBandText, { color: tk.label }]} numberOfLines={1}>
          {bandLabel}
        </Text>
      </View>
      <View style={styles.attachBody}>{children}</View>
      <View style={[styles.attachCta, { borderTopColor: tk.separator }]}>
        <Text style={[styles.attachCtaText, { color: tk.label }]}>{cta}</Text>
      </View>
    </Pressable>
  );
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
 * Culoarea stabilă a unui membru (stil 7a): hash pe user id → paleta de 4.
 * `base` = fundal avatar (ambele teme) + numele în light; `dark` = numele în dark
 * (base-ul navy/verde ar fi ilizibil pe bula #1A2333).
 */
const USER_COLORS = [
  { base: '#D6437F', dark: '#E06C9F' }, // roz
  { base: '#164F9E', dark: '#7BA7E0' }, // albastru
  { base: '#1C7C3C', dark: '#4ECB7D' }, // verde
  { base: '#C4690B', dark: '#E8A44B' }, // portocaliu
] as const;

function userColor(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) % 1000003;
  }
  return USER_COLORS[hash % USER_COLORS.length];
}

/** Pauza care rupe un grup de mesaje consecutive (ca la WhatsApp). */
const GROUP_GAP_MS = 10 * 60 * 1000;
/** Lățimea avatarului din chatul de grup — și a indentării mesajelor 2+ din grup. */
const GROUP_AVATAR_SIZE = 34;

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
  /** URL semnat, când mesajul e o poză; lipsește cât timp se semnează sau dacă RLS refuză. */
  imageUrl?: string;
  /** Avatarul expeditorului, doar în chatul de grup (unde mesajele vin de la mai mulți). */
  senderName?: string | null;
  /** Rolul expeditorului (chat de grup) — „ · Rol" lângă nume, în prima bulă a grupului. */
  senderRole?: string | null;
  senderAvatarUrl?: string;
  showSenderAvatar?: boolean;
  /** Grupare WhatsApp (stil 7a): primul mesaj al unui grup consecutiv de la același
   * expeditor — doar el are avatar + nume + „coada" din colțul de sus. */
  isFirstOfGroup: boolean;
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
  /** Faza 19.4: tap pe cardul de anunț atașat mesajului → detaliul anunțului. */
  onPressListing?: (listingId: string) => void;
  /** Faza 19.5/19.6: tap pe cardul utilizatorului recomandat → profilul lui public
   * (rolul REAL însoțește id-ul, pentru rutarea corectă la screen). */
  onPressMechanic?: (mechanicId: string, role: string) => void;
  /** Avatarul (semnat) al utilizatorului recomandat din card. */
  mechanicAvatarUrl?: string;
  /** Cover-ul (semnat) al anunțului de market din card (26 iul, carduri detaliate). */
  listingCoverUrl?: string;
  /** Faza 19.5: tap pe bula-fișier → descarcă + deschide; spinner cât timp descarcă. */
  onPressFile?: () => void;
  downloadingFile?: boolean;
  /** Faza 19.6: tap pe cardul de anunț de depanare distribuit → detaliul lui. */
  onPressAnnouncement?: (announcementId: string) => void;
}

function MessageBubble<M extends ChatMessageBase>({
  message,
  isMe,
  imageUrl,
  senderName,
  senderRole,
  senderAvatarUrl,
  showSenderAvatar,
  isFirstOfGroup,
  onPressImage,
  onLongPress,
  onPressQuote,
  onPressAvatar,
  readState,
  onSwipeReply,
  onPressListing,
  onPressMechanic,
  mechanicAvatarUrl,
  listingCoverUrl,
  onPressFile,
  downloadingFile,
  onPressAnnouncement,
}: MessageBubbleProps<M>) {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const { t } = useTranslation();
  const isDeleted = !!message.deleted_at;
  const isImage = !isDeleted && !!message.image_path;
  const isFile = !isDeleted && !isImage && !!message.file_path;
  // Stil 6b: contextele se randează ca AttachmentCard ÎN AFARA bulei; bula apare doar
  // dacă mesajul mai are și altceva de arătat (text/poză/fișier/tombstone).
  const hasContext =
    !isDeleted && !!(message.listing || message.mechanic || message.announcement);
  const showBubble = isDeleted || isImage || isFile || message.content !== '' || !hasContext;
  const tk = CARD_TOKENS[scheme];
  const recExtra = message.mechanic
    ? (message.mechanic.activity_zone ?? message.mechanic.specialization ?? null)
    : null;
  const listingMeta = message.listing
    ? [
        message.listing.category ? t(`market.categories.${message.listing.category}`) : null,
        message.listing.status === 'sold'
          ? t('market.soldBadge')
          : message.listing.description?.trim() || null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const announcementMeta = message.announcement
    ? [
        t(`attach.status.${message.announcement.status}`, {
          defaultValue: message.announcement.status,
        }),
        message.announcement.description?.trim() || null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  // Design 22 iul: timp/bife pe bula trimisă = alb 70%; pe cea primită = text terțiar.
  const secondaryColor = isMe ? 'rgba(255,255,255,0.7)' : theme.textTertiary;
  // Stil 7a: culoarea stabilă a expeditorului (avatar + nume), hash pe user id.
  const uc = userColor(message.sender_id);
  const nameColor = scheme === 'dark' ? uc.dark : uc.base;
  // Numele + rolul apar O dată per grup, ÎN prima bulă (nu deasupra ei, ca înainte).
  const senderHeader =
    !isMe && isFirstOfGroup && senderName ? (
      <Text
        numberOfLines={1}
        style={[styles.senderHeader, !isDeleted && !!message.image_path && styles.senderHeaderOnImage]}>
        <Text style={[styles.senderHeaderName, { color: nameColor }]}>{senderName}</Text>
        {senderRole ? (
          <Text style={[styles.senderHeaderRole, { color: secondaryColor }]}>
            {` · ${senderRole}`}
          </Text>
        ) : null}
      </Text>
    ) : null;
  const tick = readState ? (
    <MaterialIcons
      name={readState === 'read' ? 'done-all' : 'check'}
      size={14}
      color={secondaryColor}
    />
  ) : null;
  // Embed-ul `reply_to` vine ca obiect/null (embed pe coloana FK, m2o — vezi
  // replyEmbed). Normalizarea array→primul rămâne DEFENSIV: vechiul embed self-join
  // `<tabel>!reply_to_id` era rezolvat de PostgREST în direcția inversă (o2m) și
  // întorcea ARRAY — `[]` truthy randa un chenar quote gol, iar reply-urile reale
  // rămâneau fără citat („Mesaj indisponibil", bug reparat 7 aug).
  const rawReply = message.reply_to as unknown;
  const rt = (Array.isArray(rawReply) ? rawReply[0] : rawReply) as ChatMessageBase['reply_to'];
  const quote = !isDeleted && rt && rt.id ? rt : null;
  // reply_to_id există dar embed-ul vine gol: originalul e invizibil prin RLS (chat
  // global — mesaj dinaintea creării contului) sau șters definitiv → „Mesaj indisponibil".
  const quoteUnavailable = !isDeleted && !!message.reply_to_id && !quote;
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
        isFirstOfGroup ? (
          // Avatarul apare O dată per grup, aliniat SUS, în dreptul primului mesaj.
          <Pressable onPress={onPressAvatar} disabled={!onPressAvatar} hitSlop={6}>
            <Avatar
              url={senderAvatarUrl}
              name={senderName}
              size={GROUP_AVATAR_SIZE}
              color={uc.base}
            />
          </Pressable>
        ) : (
          // Mesajele 2+ din grup: fără avatar, dar aliniate la aceeași margine stângă.
          <View style={styles.avatarSpacer} />
        )
      ) : null}
      <Animated.View
        style={[
          styles.bubbleColumn,
          isMe ? styles.bubbleColumnMe : styles.bubbleColumnOther,
          swipeStyle,
        ]}
        onLayout={(e) => {
          bubbleLeft.value = e.nativeEvent.layout.x;
          bubbleRight.value = e.nativeEvent.layout.x + e.nativeEvent.layout.width;
        }}>
        {/* Mesaj doar-card (fără bulă): numele nu are bulă în care să stea → deasupra cardului. */}
        {!showBubble && !isMe && isFirstOfGroup && senderName ? (
          <Text numberOfLines={1} style={styles.senderLabelOutside}>
            <Text style={[styles.senderHeaderName, { color: nameColor }]}>{senderName}</Text>
            {senderRole ? (
              <Text style={[styles.senderHeaderRole, { color: theme.textTertiary }]}>
                {` · ${senderRole}`}
              </Text>
            ) : null}
          </Text>
        ) : null}

        {/* Stil 6b: „atașament etichetat" — recomandare de persoană. */}
        {!isDeleted && message.mechanic ? (
          <AttachmentCard
            isMe={isMe}
            scheme={scheme}
            icon={message.mechanic.role === 'driver' ? 'truck' : 'tool'}
            bandLabel={t(
              message.mechanic.role === 'driver' ? 'attach.bandDriver' : 'attach.bandMechanic'
            )}
            cta={t('attach.cardCtaProfile')}
            onPress={
              onPressMechanic && !message.mechanic.deleted_at
                ? () =>
                    onPressMechanic(message.mechanic!.id, message.mechanic!.role ?? 'mechanic')
                : undefined
            }
            onLongPress={onLongPress}>
            <Avatar url={mechanicAvatarUrl} name={message.mechanic.full_name} size={44} />
            <View style={styles.attachInfo}>
              <Text
                numberOfLines={1}
                style={[styles.attachName, { color: tk.textPrimary }]}>
                {displayName(message.mechanic, t)}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.attachMeta, { color: tk.textSecondary }]}>
                {message.mechanic.rating_count > 0 ? (
                  <>
                    <Text style={{ color: tk.star }}>{'★ '}</Text>
                    {message.mechanic.rating_avg.toFixed(1)}
                    {recExtra ? ` · ${recExtra}` : ''}
                  </>
                ) : (
                  (recExtra ??
                    t(`auth.roleSelect.${message.mechanic.role ?? 'mechanic'}Title`))
                )}
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color={tk.textTertiary} />
          </AttachmentCard>
        ) : null}

        {/* Stil 6b: „atașament etichetat" — produs din Market. */}
        {!isDeleted && message.listing ? (
          <AttachmentCard
            isMe={isMe}
            scheme={scheme}
            icon="tag"
            bandLabel={t('attach.bandMarket')}
            cta={t('attach.cardCtaListing')}
            onPress={onPressListing ? () => onPressListing(message.listing!.id) : undefined}
            onLongPress={onLongPress}>
            {listingCoverUrl ? (
              <Image
                source={{ uri: listingCoverUrl }}
                style={styles.attachThumb}
                contentFit="cover"
                transition={100}
              />
            ) : (
              <View
                style={[
                  styles.attachThumb,
                  styles.attachThumbFallback,
                  { backgroundColor: tk.photoBg },
                ]}>
                <Feather name="image" size={20} color={tk.textTertiary} />
              </View>
            )}
            <View style={styles.attachInfo}>
              <Text
                numberOfLines={1}
                style={[styles.attachName, { color: tk.textPrimary }]}>
                {message.listing.title}
              </Text>
              {listingMeta ? (
                <Text
                  numberOfLines={1}
                  style={[styles.attachMeta, { color: tk.textTertiary }]}>
                  {listingMeta}
                </Text>
              ) : null}
              <Text numberOfLines={1} style={[styles.attachPrice, { color: tk.price }]}>
                {`${Number(message.listing.price).toLocaleString()} ${message.listing.currency}`}
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color={tk.textTertiary} />
          </AttachmentCard>
        ) : null}

        {/* Stil 6b: „atașament etichetat" — anunț de depanare distribuit. */}
        {!isDeleted && message.announcement ? (
          <AttachmentCard
            isMe={isMe}
            scheme={scheme}
            icon="map-pin"
            bandLabel={t('attach.bandAnnouncement')}
            cta={t('attach.cardCtaListing')}
            onPress={
              onPressAnnouncement
                ? () => onPressAnnouncement(message.announcement!.id)
                : undefined
            }
            onLongPress={onLongPress}>
            <View
              style={[
                styles.attachThumb,
                styles.attachThumbFallback,
                { backgroundColor: tk.bandBg },
              ]}>
              <Feather name="map-pin" size={20} color={tk.label} />
            </View>
            <View style={styles.attachInfo}>
              <Text
                numberOfLines={1}
                style={[styles.attachName, { color: tk.textPrimary }]}>
                {message.announcement.location}
              </Text>
              {announcementMeta ? (
                <Text
                  numberOfLines={1}
                  style={[styles.attachMeta, { color: tk.textSecondary }]}>
                  {announcementMeta}
                </Text>
              ) : null}
            </View>
            <Feather name="chevron-right" size={16} color={tk.textTertiary} />
          </AttachmentCard>
        ) : null}

        {showBubble ? (
        <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <BubbleSurface
          isMe={isMe}
          scheme={scheme}
          style={[
            styles.bubble,
            // Stil 7a: „coada" stă pe colțul de SUS al PRIMEI bule din grup;
            // restul bulelor sunt complet rotunjite.
            isFirstOfGroup && (isMe ? styles.bubbleTailMe : styles.bubbleTailOther),
            // Umbra stă pe suprafața cu fundal (altfel Android nu desenează elevation);
            // în dark, bulele primite rămân plate — decizie de design.
            isMe && (scheme === 'light' ? styles.sentShadowLight : styles.sentShadowDark),
            isImage && styles.bubbleImage,
            !isMe && { backgroundColor: theme.backgroundElement },
          ]}>
          {senderHeader}
          {isDeleted ? (
            // Tombstone (Faza 14): bula rămâne, textul e discret (italic/gri).
            // Faza 16: marcaj DISTINCT dacă ștergerea a fost făcută de un moderator.
            <View style={styles.textTimeRow}>
              <Text
                style={[
                  styles.bubbleText,
                  styles.textShrink,
                  styles.deletedText,
                  { color: secondaryColor },
                ]}>
                {message.deleted_by_admin ? t('chat.deletedByModerator') : t('chat.deletedMessage')}
              </Text>
              <View style={styles.metaInline}>
                <Text style={[styles.bubbleTime, { color: secondaryColor }]}>
                  {formatTime(message.created_at)}
                </Text>
              </View>
            </View>
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
          ) : isFile ? (
            // Faza 19.5: bula-fișier — icon + nume + mărime; tap = descarcă + deschide.
            <>
              <Pressable
                onPress={onPressFile}
                onLongPress={onLongPress}
                delayLongPress={300}
                disabled={!onPressFile || downloadingFile}
                style={styles.fileRow}>
                <View
                  style={[
                    styles.fileIconWrap,
                    { backgroundColor: isMe ? 'rgba(255,255,255,0.16)' : theme.brandSoft },
                  ]}>
                  {downloadingFile ? (
                    <ActivityIndicator size="small" color={isMe ? '#ffffff' : theme.brand} />
                  ) : (
                    <MaterialIcons
                      name="insert-drive-file"
                      size={22}
                      color={isMe ? '#ffffff' : theme.brand}
                    />
                  )}
                </View>
                <View style={styles.fileInfo}>
                  <Text
                    numberOfLines={1}
                    style={[styles.fileName, { color: isMe ? '#ffffff' : theme.text }]}>
                    {message.file_name ?? ''}
                  </Text>
                  <Text style={[styles.fileSize, { color: secondaryColor }]}>
                    {formatFileSize(message.file_size)}
                  </Text>
                </View>
                <MaterialIcons name="file-download" size={18} color={secondaryColor} />
              </Pressable>
              <View style={styles.metaRow}>
                <Text style={[styles.bubbleTime, { color: secondaryColor }]}>
                  {formatTime(message.created_at)}
                </Text>
                {tick}
              </View>
            </>
          ) : (
            <>
              {quote ? (
                <Pressable
                  onPress={onPressQuote}
                  onLongPress={onLongPress}
                  delayLongPress={300}
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
              ) : quoteUnavailable ? (
                // Fără Pressable: nu există mesaj la care să derulăm.
                <View
                  style={[
                    styles.quote,
                    {
                      backgroundColor: isMe ? 'rgba(255,255,255,0.16)' : theme.background,
                      borderLeftColor: isMe ? '#ffffff' : theme.brand,
                    },
                  ]}>
                  <Text
                    numberOfLines={1}
                    style={[styles.quoteSnippet, styles.deletedText, { color: secondaryColor }]}>
                    {t('chat.unavailableMessage')}
                  </Text>
                </View>
              ) : null}
              {/* Ora stă în colțul dreapta-jos, la nivelul ULTIMULUI rând de text
                  (stil 7a): rând flex cu textul shrink + meta împinsă cu auto-margin.
                  La mesaje scurte bula se lățește cât textul + ora pe același rând. */}
              {message.content !== '' ? (
                <View style={styles.textTimeRow}>
                  <Text
                    style={[
                      styles.bubbleText,
                      styles.textShrink,
                      { color: isMe ? '#ffffff' : theme.text },
                    ]}>
                    {message.content}
                  </Text>
                  <View style={styles.metaInline}>
                    {message.edited_at ? (
                      <Text
                        style={[styles.bubbleTime, styles.editedLabel, { color: secondaryColor }]}>
                        {t('chat.edited')}
                      </Text>
                    ) : null}
                    <Text style={[styles.bubbleTime, { color: secondaryColor }]}>
                      {formatTime(message.created_at)}
                    </Text>
                    {tick}
                  </View>
                </View>
              ) : (
                // 19.6: mesaj doar-atașament (fără text) → doar rândul de meta.
                <View style={styles.metaRow}>
                  {message.edited_at ? (
                    <Text
                      style={[styles.bubbleTime, styles.editedLabel, { color: secondaryColor }]}>
                      {t('chat.edited')}
                    </Text>
                  ) : null}
                  <Text style={[styles.bubbleTime, { color: secondaryColor }]}>
                    {formatTime(message.created_at)}
                  </Text>
                  {tick}
                </View>
              )}
            </>
          )}
        </BubbleSurface>
        </Pressable>
        ) : (
          // Mesaj doar-card (spec 6b §4): ora + bifele stau SUB card, în afara lui.
          <View
            style={[
              styles.attachExternalMeta,
              isMe ? styles.attachMetaRight : styles.attachMetaLeft,
            ]}>
            <Text style={[styles.bubbleTime, { color: theme.textTertiary }]}>
              {formatTime(message.created_at)}
            </Text>
            {readState ? (
              <MaterialIcons
                name={readState === 'read' ? 'done-all' : 'check'}
                size={14}
                color={theme.textTertiary}
              />
            ) : null}
          </View>
        )}
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
  /** Chat de grup: numele + avatarul expeditorului, lângă bulele celorlalți. */
  renderSenderName?: (message: M) => string | null;
  /** Chat de grup: rolul expeditorului („ · Rol" după nume, în prima bulă a grupului). */
  renderSenderRole?: (message: M) => string | null;
  renderSenderAvatarPath?: (message: M) => string | null;
  /** Avatarul interlocutorului, în antet (chat 1-la-1). */
  headerAvatarPath?: string | null;
  /** Id-ul interlocutorului din antet — pentru tap pe avatar → profil (chat 1-la-1). */
  headerUserId?: string;
  /** Tap pe avatar (antet sau bulă) → profilul acelui utilizator. Rutarea o decide ecranul. */
  onPressUser?: (userId: string) => void;
  /** Faza 19.4: tap pe cardul de anunț atașat unui mesaj → detaliul anunțului. */
  onPressListing?: (listingId: string) => void;
  /**
   * Anunțul de market care se va atașa URMĂTORULUI mesaj trimis („Contactează
   * vânzătorul"). Afișat ca banner deasupra casetei text; × îl scoate — mesajul
   * devine unul obișnuit, fără card (Faza 19.4).
   */
  pendingListing?: { id: string; title: string; price: number; currency: string } | null;
  /** × pe bannerul anunțului atașat. Fără handler, bannerul nu are ×. */
  onClearPendingListing?: () => void;
  /** Faza 19.5/19.6: utilizatorul care se va atașa următorului mesaj — rolul decide
   * eticheta bannerului („Mecanic recomandat" vs „Transportator recomandat"). */
  pendingMechanic?: {
    id: string;
    full_name: string;
    deleted_at: string | null;
    role?: string;
    rating_avg: number;
    rating_count: number;
  } | null;
  onClearPendingMechanic?: () => void;
  /** Faza 19.6: anunțul de DEPANARE care se va atașa următorului mesaj (share). */
  pendingAnnouncement?: { id: string; location: string } | null;
  onClearPendingAnnouncement?: () => void;
  /** Faza 19.5: meniul „+" — fiecare opțiune apare doar dacă ecranul o furnizează. */
  onAttachListing?: () => void;
  onAttachMechanic?: () => void;
  /** Faza 19.6: „Recomandă un transportator" — aceleași sisteme ca la mecanic. */
  onAttachDriver?: () => void;
  /** Trimite fișierul ales (validat deja: mărime + blocklist). Un fișier = o bulă. */
  onSendFile?: (file: PickedFile) => Promise<void>;
  /** Tap pe cardul utilizatorului recomandat → profilul lui public; rolul REAL vine
   * cu id-ul, ca ecranul să rutueze corect (mecanic vs transportator). */
  onPressMechanic?: (mechanicId: string, role: string) => void;
  /** Faza 19.6: tap pe cardul de anunț de depanare → detaliul lui (rutare per rol). */
  onPressAnnouncement?: (announcementId: string) => void;
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
  /** Cursorul MEU de citire, „înghețat" de ecran la deschidere (ÎNAINTE de mark-read):
   * decide unde apare separatorul „Mesaje noi" și unde aterizează lista (cerere 7 aug).
   * `undefined` = încă se încarcă (fără ancoră); `null` = niciodată deschisă. */
  unreadCursor?: string | null;
  /** Numărul interlocutorului (chat 1-la-1): dacă există, antetul arată butonul de apel
   * (deschide dialer-ul cu numărul pretastat). Vine din get_mechanic_phone/
   * get_driver_phone, deci simpla lui prezență = acces permis (conversație non-market,
   * fără blocaj) — clientul nu re-verifică nimic. */
  phoneNumber?: string | null;
  /** Rotița de setări din antet (canalul global, 5 aug) — apare doar dacă e furnizat. */
  onOpenSettings?: () => void;
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
  renderSenderName,
  renderSenderRole,
  renderSenderAvatarPath,
  headerAvatarPath,
  headerUserId,
  onPressUser,
  onPressListing,
  pendingListing,
  onClearPendingListing,
  pendingMechanic,
  onClearPendingMechanic,
  pendingAnnouncement,
  onClearPendingAnnouncement,
  onAttachListing,
  onAttachMechanic,
  onAttachDriver,
  onSendFile,
  onPressMechanic,
  onPressAnnouncement,
  onBack,
  onEditMessage,
  onDeleteMessage,
  messageTable,
  canEditMessage,
  readReceipts,
  readCursor,
  unreadCursor,
  phoneNumber,
  onOpenSettings,
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
  // Faza 19.5: meniul „+" + descărcarea de fișiere (un singur download odată).
  const [attachOpen, setAttachOpen] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const listRef = useRef<FlatList<M>>(null);

  // Android (SDK 54, edge-to-edge): fereastra NU se redimensionează la tastatură, iar
  // KeyboardAvoidingView e defect în ambele moduri ('height' nu-și revine la închidere,
  // 'padding' lasă padding rezidual). Măsurătorile de poziție (measureInWindow) sunt și
  // ele capcană: pe unele device-uri fereastra exclude status bar-ul, iar evenimentul de
  // tastatură raportează de la vârful ecranului → inputul rămânea SUB tastatură cu exact
  // înălțimea status bar-ului (măsurat pe Samsung, din screenshot-uri). Deci FĂRĂ
  // poziții: tastatura acoperă din containerul nostru exact (înălțimea ei − ce stă SUB
  // container = tab bar-ul, cu tot cu insetul de sistem inclus în el). Fiecare mărime
  // vine dintr-o singură sursă → nu există spații de coordonate de dez-aliniat.
  // La închidere: 0 garantat. iOS rămâne pe KAV 'padding' (corect, testat pe iPhone).
  // Formula folosește DOAR valori ancorate la ecranul fizic complet: `screen.height`
  // (documentat: include barele de sistem) și `endCoordinates.screenY` (vârful
  // tastaturii — verificat numeric pe device că e ancorat la vârful ecranului, spre
  // deosebire de `endCoordinates.height` și `measureInWindow`, care variază între
  // OEM-uri cu/fără insetele de sistem). containerBottom = screen − tabBar.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const [kbOverlap, setKbOverlap] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'ios') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      const screenH = Dimensions.get('screen').height;
      setKbOverlap(Math.max(screenH - tabBarHeight - e.endCoordinates.screenY, 0));
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [tabBarHeight]);

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
  const enterReplyMode = useCallback(
    (m: M) => {
      // Ca pe WhatsApp (cerere 7 aug): textul deja tastat SUPRAVIEȚUIEȘTE intrării în
      // modul reply — swipe-ul pe o bulă nu-ți mai șterge mesajul din compozitor.
      // Excepție: veneam din modul editare — acolo inputul ținea conținutul VECHIULUI
      // mesaj, care nu trebuie să devină din greșeală mesajul nou.
      if (editTarget) setText('');
      setEditTarget(null);
      setReplyTarget(m);
    },
    [editTarget]
  );
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

  // scrollToIndex pe listă inversată FĂRĂ getItemLayout (bulele au înălțimi variabile):
  // ținta poate fi nerandată încă, deci eșecul primei încercări e NORMAL. Reținem ținta,
  // sărim aproximativ (averageItemLength — virtualizarea randează zona), apoi reîncercăm
  // precis — de câteva ori, nu la nesfârșit.
  const pendingScroll = useRef<{ index: number; viewPosition: number; retries: number } | null>(
    null
  );
  const scrollToIndexSafe = useCallback(
    (index: number, viewPosition: number, animated: boolean) => {
      pendingScroll.current = { index, viewPosition, retries: 4 };
      listRef.current?.scrollToIndex({ index, viewPosition, animated });
    },
    []
  );
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      const target = pendingScroll.current;
      if (!target || target.retries <= 0) return;
      target.retries -= 1;
      listRef.current?.scrollToOffset({
        offset: info.averageItemLength * target.index,
        animated: false,
      });
      setTimeout(() => {
        if (pendingScroll.current === target) {
          listRef.current?.scrollToIndex({
            index: target.index,
            viewPosition: target.viewPosition,
            animated: false,
          });
        }
      }, 120);
    },
    []
  );

  // Tap pe citat → derulează la mesajul original, dacă e în pagina încărcată.
  // Dacă e mai vechi decât paginarea (canal, 50/pagină) → no-op discret.
  const scrollToQuoted = useCallback(
    (quotedId: string) => {
      const index = reversedMessages.findIndex((m) => m.id === quotedId);
      if (index >= 0) scrollToIndexSafe(index, 0.5, true);
    },
    [reversedMessages, scrollToIndexSafe],
  );

  // Ancora „Mesaje noi" (cerere 7 aug, ca pe WhatsApp): la deschidere, dacă există
  // mesaje de la ALȚII mai noi decât cursorul meu de citire (snapshot luat de ecran
  // înainte de mark-read), lista aterizează pe primul necitit, cu separator deasupra.
  // Calculată O SINGURĂ dată per montare — mesajele sosite live după aceea n-o mută.
  const [unreadAnchorId, setUnreadAnchorId] = useState<string | null>(null);
  const anchorDone = useRef(false);
  useEffect(() => {
    if (anchorDone.current || loading || unreadCursor === undefined) return;
    anchorDone.current = true;
    // Fără cursor (prima deschidere): în CANAL pornim de la final, ca până acum — la
    // prima intrare totul e „nou" și am ateriza cu 50 de mesaje în urmă, fără folos.
    // Într-o conversație privată nedeschisă, primul mesaj chiar e locul potrivit.
    const cutoff = unreadCursor
      ? new Date(unreadCursor).getTime()
      : messageTable === 'channel_messages'
        ? Infinity
        : 0;
    const first = messages.find(
      (m) => m.sender_id !== currentUserId && new Date(m.created_at).getTime() > cutoff
    );
    if (first) setUnreadAnchorId(first.id);
  }, [loading, unreadCursor, messages, currentUserId, messageTable]);

  useEffect(() => {
    if (!unreadAnchorId) return;
    const index = reversedMessages.findIndex((m) => m.id === unreadAnchorId);
    // index 0 = cel mai nou mesaj: lista inversată pornește deja acolo.
    if (index <= 0) return;
    const timer = setTimeout(() => scrollToIndexSafe(index, 0.9, false), 80);
    return () => clearTimeout(timer);
    // Intenționat DOAR la fixarea ancorei — mesajele noi nu re-derulează lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadAnchorId]);

  // URL-uri semnate pt. poze, avatare ȘI avatarele mecanicilor recomandați (19.5),
  // într-un singur batch care crește pe măsură ce sosesc mesaje noi
  // (`useSignedUrls` cere doar path-urile încă nesemnate).
  const paths = useMemo(() => {
    const imagePaths = messages.map((m) => m.image_path);
    const avatarPaths = renderSenderAvatarPath ? messages.map(renderSenderAvatarPath) : [];
    const mechanicAvatars = messages.map((m) => m.mechanic?.avatar_path);
    const listingCovers = messages.map((m) => listingCoverPath(m.listing));
    return [
      ...imagePaths,
      ...avatarPaths,
      ...mechanicAvatars,
      ...listingCovers,
      headerAvatarPath,
    ].filter((p): p is string => !!p);
  }, [messages, renderSenderAvatarPath, headerAvatarPath]);
  const urls = useSignedUrls(paths);

  // Faza 19.5: alegerea + validarea fișierului (mărime, blocklist) se fac AICI —
  // ecranul primește fișierul deja valid și doar îl urcă în tabelul lui.
  const handlePickFile = useCallback(async () => {
    if (!onSendFile || uploading) return;
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (BLOCKED_FILE_EXTENSIONS.includes(fileExtension(asset.name))) {
      Alert.alert(t('attach.fileBlockedTitle'), t('attach.fileBlockedBody'));
      return;
    }
    // Pickerul poate omite mărimea — o citim atunci direct de pe fișierul din cache.
    let size = asset.size ?? 0;
    if (!size) {
      try {
        size = new File(asset.uri).size ?? 0;
      } catch {
        size = 0;
      }
    }
    if (size > MAX_FILE_SIZE) {
      Alert.alert(
        t('attach.fileTooLargeTitle'),
        t('attach.fileTooLargeBody', { max: MAX_FILE_SIZE_MB }),
      );
      return;
    }
    setUploading(true);
    await onSendFile({ uri: asset.uri, name: asset.name, size, mimeType: asset.mimeType });
    setUploading(false);
  }, [onSendFile, uploading, t]);

  // Descarcă fișierul (URL semnat → cache) și îl deschide prin share sheet-ul nativ —
  // de acolo utilizatorul îl poate vizualiza sau salva. Numele original e păstrat.
  // Pe WEB nu există File/Paths/Sharing: descărcăm prin browser (blob + <a download>).
  const handleOpenFile = useCallback(
    async (m: M) => {
      if (!m.file_path || downloadingFileId) return;
      if (Platform.OS === 'web') {
        setDownloadingFileId(m.id);
        try {
          const url = await signedUrl(m.file_path);
          if (!url) throw new Error('no_signed_url');
          await webDownload(url, m.file_name ?? 'file');
        } catch {
          setToast(t('attach.downloadError'));
        } finally {
          setDownloadingFileId(null);
        }
        return;
      }
      setDownloadingFileId(m.id);
      try {
        const url = await signedUrl(m.file_path);
        if (!url) throw new Error('no_signed_url');
        const safeName = (m.file_name ?? 'file').replace(/[\\/:*?"<>|]/g, '_');
        const target = new File(Paths.cache, `${m.id}-${safeName}`);
        try {
          if (target.exists) target.delete();
        } catch {
          // Rămășiță coruptă în cache — downloadFileAsync o suprascrie oricum.
        }
        const downloaded = await File.downloadFileAsync(url, target);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(downloaded.uri, { dialogTitle: m.file_name ?? undefined });
        }
      } catch {
        setToast(t('attach.downloadError'));
      } finally {
        setDownloadingFileId(null);
      }
    },
    [downloadingFileId, t],
  );

  // Pozele conversației, în ordine cronologică: viewer-ul le parcurge pe toate,
  // nu doar pe cea atinsă.
  const viewerPhotos = useMemo(
    () =>
      messages
        .filter((m) => m.image_path && urls[m.image_path])
        .map((m) => ({ id: m.id, url: urls[m.image_path!] })),
    [messages, urls],
  );

  // 19.6: un atașament în așteptare se poate trimite și FĂRĂ text — mesajul e doar
  // cardul (CHECK-ul din DB acceptă asta prin migrarea 196b).
  const hasPendingAttach = !!(pendingListing || pendingMechanic || pendingAnnouncement);
  const sendEnabled = (!!text.trim() || (hasPendingAttach && !editTarget)) && !sending;

  async function handleSend() {
    const trimmed = text.trim();
    if (sending) return;
    if (editTarget && onEditMessage) {
      // Mod editare: confirmarea de send aplică editarea în loc să trimită un mesaj nou.
      if (!trimmed) return;
      setSending(true);
      const target = editTarget;
      setEditTarget(null);
      setText('');
      await onEditMessage(target, trimmed);
    } else {
      if (!trimmed && !hasPendingAttach) return;
      setSending(true);
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

  // Sheet tematizat în locul fostului Alert.alert nativ (nestilizabil, fără
  // închidere la tap în afară); ActionSheet gestionează și amânarea pe iOS
  // (pickerul nativ nu se poate prezenta peste un Modal care încă se închide).
  const [photoSourceOpen, setPhotoSourceOpen] = useState(false);

  function handleAttach() {
    if (uploading) return;
    setPhotoSourceOpen(true);
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
        {/* Butonul de apel (7 aug) — doar 1-la-1, doar când numărul e accesibil
            (RPC-ul a întors non-null) și interlocutorul nu e blocat de mine. */}
        {phoneNumber && !peerBlocked ? (
          <Pressable
            onPress={() => Linking.openURL(`tel:${phoneNumber.replace(/[^+\d]/g, '')}`)}
            hitSlop={12}
            accessibilityLabel={t('chat.callPeer')}>
            <MaterialIcons name="call" size={22} color={theme.onHeader} />
          </Pressable>
        ) : null}
        {/* Setările canalului (5 aug) — doar ecranele care furnizează handler-ul. */}
        {onOpenSettings ? (
          <Pressable
            onPress={onOpenSettings}
            hitSlop={12}
            accessibilityLabel={t('channelSettings.title')}>
            <MaterialIcons name="settings" size={22} color={theme.onHeader} />
          </Pressable>
        ) : null}
      </ScreenHeader>

      {bannerText ? (
        <View style={styles.resolvedBanner}>
          <MaterialIcons name="check-circle" size={14} color="#22c55e" />
          <Text style={styles.resolvedText}>{bannerText}</Text>
        </View>
      ) : null}

      {/* iOS: KAV 'padding' fără keyboardVerticalOffset (KAV-ul își măsoară poziția
          relativ la părintele full-screen; un offset ar SUPRA-compensa cu înălțimea
          headerului — verificat pe iPhone real). Android: behavior INERT — tastatura
          e gestionată de distanțierul kbOverlap (vezi efectul de mai sus); atât
          'height' cât și 'padding' lăsau spațiu rezidual la închidere pe edge-to-edge. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

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
            // Cu tastatura deschisă, tap-urile pe listă erau consumate de închiderea
            // tastaturii → long-press-ul pe bule nu pornea (bug 26 iul). „handled"
            // lasă gesturile să ajungă la bule; scroll-ul închide tastatura.
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.messageList}
            onEndReached={onLoadOlder}
            onEndReachedThreshold={0.3}
            // Ținta (citat/ancoră necitite) poate fi nerandată → salt aproximativ + retry.
            onScrollToIndexFailed={handleScrollToIndexFailed}
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
              // Grupare WhatsApp (stil 7a): mesajele consecutive de la același expeditor
              // formează un grup; grupul se rupe la zi nouă, la pauze >10 min și la
              // separatorul „Mesaje noi" (un grup tăiat de separator ar rămâne fără nume).
              const isFirstOfGroup =
                showDate ||
                !older ||
                older.sender_id !== item.sender_id ||
                new Date(item.created_at).getTime() - new Date(older.created_at).getTime() >
                  GROUP_GAP_MS ||
                item.id === unreadAnchorId;
              return (
              // 14px între grupuri, 3px între mesajele aceluiași grup (spațierea 7a).
              <View style={isFirstOfGroup ? styles.groupSpacing : styles.messageSpacing}>
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
              {/* Separatorul „Mesaje noi" — deasupra primului necitit de la deschidere. */}
              {item.id === unreadAnchorId ? (
                <View style={styles.dateRow}>
                  <View
                    style={[
                      styles.datePill,
                      { backgroundColor: theme.brandSoft },
                      scheme === 'light' && Shadows.chip,
                    ]}>
                    <Text style={[styles.datePillText, { color: theme.brand }]}>
                      {t('chat.newMessages')}
                    </Text>
                  </View>
                </View>
              ) : null}
              <MessageBubble
                message={item}
                isMe={item.sender_id === currentUserId}
                isFirstOfGroup={isFirstOfGroup}
                showSenderAvatar={!!renderSenderAvatarPath}
                senderName={renderSenderName?.(item) ?? null}
                senderRole={
                  item.sender_id !== currentUserId && renderSenderRole
                    ? renderSenderRole(item)
                    : null
                }
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
                onPressListing={onPressListing}
                onPressMechanic={onPressMechanic}
                onPressAnnouncement={onPressAnnouncement}
                mechanicAvatarUrl={
                  item.mechanic?.avatar_path ? urls[item.mechanic.avatar_path] : undefined
                }
                listingCoverUrl={(() => {
                  const cover = listingCoverPath(item.listing);
                  return cover ? urls[cover] : undefined;
                })()}
                onPressFile={
                  !item.deleted_at && item.file_path ? () => handleOpenFile(item) : undefined
                }
                downloadingFile={downloadingFileId === item.id}
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

        {/* Bannerul „anunț atașat" (Faza 19.4): stă deasupra celor de reply/editare —
            atașarea privește următorul mesaj trimis, indiferent dacă e și reply. */}
        {pendingListing && !editTarget ? (
          <View style={[styles.editBanner, { backgroundColor: theme.backgroundElement }]}>
            <MaterialIcons name="sell" size={16} color={theme.price} />
            <View style={styles.editBannerInfo}>
              <Text style={[styles.editBannerTitle, { color: theme.price }]} numberOfLines={1}>
                {t('market.composerAttached')}
              </Text>
              <Text
                style={[styles.editBannerText, { color: theme.textSecondary }]}
                numberOfLines={1}>
                {`${pendingListing.title} · ${Number(pendingListing.price).toLocaleString()} ${pendingListing.currency}`}
              </Text>
            </View>
            {onClearPendingListing ? (
              <Pressable
                onPress={onClearPendingListing}
                hitSlop={8}
                accessibilityLabel={t('market.composerAttachedRemove')}>
                <MaterialIcons name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Bannerul „Anunț de depanare" (19.6, share) — același tipar. */}
        {pendingAnnouncement && !editTarget ? (
          <View style={[styles.editBanner, { backgroundColor: theme.backgroundElement }]}>
            <MaterialIcons name="location-on" size={16} color={theme.brand} />
            <View style={styles.editBannerInfo}>
              <Text style={[styles.editBannerTitle, { color: theme.brand }]} numberOfLines={1}>
                {t('attach.announcementBanner')}
              </Text>
              <Text
                style={[styles.editBannerText, { color: theme.textSecondary }]}
                numberOfLines={1}>
                {pendingAnnouncement.location}
              </Text>
            </View>
            {onClearPendingAnnouncement ? (
              <Pressable
                onPress={onClearPendingAnnouncement}
                hitSlop={8}
                accessibilityLabel={t('attach.announcementRemove')}>
                <MaterialIcons name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Bannerul „Mecanic/Transportator recomandat" (19.5/19.6) — eticheta pe rol. */}
        {pendingMechanic && !editTarget ? (
          <View style={[styles.editBanner, { backgroundColor: theme.backgroundElement }]}>
            <MaterialIcons
              name={pendingMechanic.role === 'driver' ? 'local-shipping' : 'engineering'}
              size={16}
              color={theme.brand}
            />
            <View style={styles.editBannerInfo}>
              <Text style={[styles.editBannerTitle, { color: theme.brand }]} numberOfLines={1}>
                {t(
                  pendingMechanic.role === 'driver'
                    ? 'attach.driverBanner'
                    : 'attach.mechanicBanner'
                )}
              </Text>
              <Text
                style={[styles.editBannerText, { color: theme.textSecondary }]}
                numberOfLines={1}>
                {displayName(pendingMechanic, t)}
                {pendingMechanic.rating_count > 0
                  ? ` · ★ ${pendingMechanic.rating_avg.toFixed(1)}`
                  : ''}
              </Text>
            </View>
            {onClearPendingMechanic ? (
              <Pressable
                onPress={onClearPendingMechanic}
                hitSlop={8}
                accessibilityLabel={t('attach.mechanicRemove')}>
                <MaterialIcons name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

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
          {/* TextInput-ul multiline NU stă direct în rândul flex: pe Android, când
              crește pe verticală se re-măsoară cu lățime necontrânsă și textul se
              întindea peste butoanele „+"/trimite — wrapper-ul îi fixează lățimea. */}
          <View style={styles.inputWrap}>
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
          </View>
          {/* Meniul „+" (19.5) — în DREAPTA casetei text (decizie 25 iul), doar dacă
              ecranul furnizează măcar o opțiune de atașare; ascuns în modul editare. */}
          {(onAttachListing || onAttachMechanic || onAttachDriver || onSendFile) && !editTarget ? (
            <Pressable
              onPress={() => setAttachOpen(true)}
              style={[styles.attachButton, { backgroundColor: theme.brandSoft }]}
              hitSlop={8}
              accessibilityLabel={t('attach.title')}>
              <Feather name="plus" size={20} color={theme.brand} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={handleSend}
            disabled={!sendEnabled}
            style={{ opacity: sendEnabled ? 1 : 0.4 }}>
            <LinearGradient
              colors={ActiveGradient[scheme]}
              start={HeaderGradientDirection.start}
              end={HeaderGradientDirection.end}
              style={[
                styles.sendButton,
                // Umbra DOAR pe starea activă: elevation sub un părinte cu opacity<1 se
                // vede PRIN suprafața translucidă ca o pată poligonală decalată (Android)
                // — sursa „octagonului" semitransparent de pe butonul dezactivat.
                sendEnabled &&
                  (scheme === 'light' ? styles.sendShadowLight : styles.sendShadowDark),
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
        {/* Distanțierul de tastatură (doar Android — vezi efectul kbOverlap). */}
        {Platform.OS !== 'ios' ? <View style={{ height: kbOverlap }} /> : null}
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

      {/* Meniul „+" ca grilă 2/rând (19.6): închide întâi modalul, apoi rulează
          acțiunea (pe iOS după onDismiss) — exact ce cere document pickerul nativ. */}
      <AttachSheet
        visible={attachOpen}
        title={t('attach.title')}
        onClose={() => setAttachOpen(false)}
        options={[
          // Rândul de sus: cele două recomandări una lângă alta (cerința 26 iul).
          ...(onAttachMechanic
            ? [
                {
                  key: 'mechanic',
                  label: t('attach.mechanic'),
                  icon: 'engineering' as const,
                  onPress: onAttachMechanic,
                },
              ]
            : []),
          ...(onAttachDriver
            ? [
                {
                  key: 'driver',
                  label: t('attach.driver'),
                  icon: 'local-shipping' as const,
                  onPress: onAttachDriver,
                },
              ]
            : []),
          ...(onAttachListing
            ? [
                {
                  key: 'listing',
                  label: t('attach.market'),
                  icon: 'sell' as const,
                  onPress: onAttachListing,
                },
              ]
            : []),
          ...(onSendFile
            ? [
                {
                  key: 'file',
                  label: t('attach.file', { max: MAX_FILE_SIZE_MB }),
                  icon: 'attach-file' as const,
                  onPress: handlePickFile,
                },
              ]
            : []),
        ]}
      />

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

      <ActionSheet
        visible={photoSourceOpen}
        title={t('photos.sourceTitle')}
        actions={[
          {
            label: t('photos.sourceLibrary'),
            icon: 'photo-library',
            onPress: async () => sendImages(await pickFromLibrary()),
          },
          {
            label: t('photos.sourceCamera'),
            icon: 'photo-camera',
            onPress: async () => sendImages(await pickFromCamera()),
          },
        ]}
        onClose={() => setPhotoSourceOpen(false)}
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
    // Spațierea vine per rând (groupSpacing/messageSpacing), nu dintr-un gap uniform.
  },
  loadingMore: { paddingVertical: Spacing.two, alignItems: 'center' },
  // Spațierea 7a: 14px între grupuri, 3px în interiorul unui grup.
  groupSpacing: { marginTop: 14 },
  messageSpacing: { marginTop: 3 },
  // `flex-start` (stil 7a): avatarul stă SUS, în dreptul primei bule a grupului.
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bubbleRowRight: { justifyContent: 'flex-end' },
  bubbleRowLeft: { justifyContent: 'flex-start' },
  // Mesajele 2+ dintr-un grup rămân aliniate la marginea primei bule.
  avatarSpacer: { width: GROUP_AVATAR_SIZE },
  // 78% trimise / 75% primite (spec 7a; primitele pierd oricum indentarea avatarului).
  bubbleColumn: {},
  bubbleColumnMe: { maxWidth: '78%' },
  bubbleColumnOther: { maxWidth: '75%' },
  // Numele deasupra cardurilor de atașament (mesaj fără bulă în care să-l punem).
  senderLabelOutside: { marginBottom: 2, marginLeft: 4, fontSize: 12.5 },
  // Numele + rolul din PRIMA bulă a grupului (stil 7a).
  senderHeader: { fontSize: 12.5, marginBottom: 2 },
  senderHeaderName: { fontWeight: '700' },
  senderHeaderRole: { fontWeight: '600' },
  senderHeaderOnImage: { paddingHorizontal: 8, paddingTop: 4 },
  // Colțurile-„coadă" (4px SUS, pe partea expeditorului) — doar prima bulă din grup.
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    // Fără gap: ora stă imediat sub text (leading-ul liniei de text dă deja ~3px aer);
    // gap-ul de 2px în plus se citea ca spațiu mort sub mesaj (feedback pe device).
  },
  bubbleTailMe: { borderTopRightRadius: 4 },
  bubbleTailOther: { borderTopLeftRadius: 4 },
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
  bubbleTime: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  // Stil 7a: textul + ora pe același rând flex — la mesaje scurte bula se lățește
  // cât textul + ora; la mesaje lungi ora coboară în colțul dreapta-jos, lângă
  // ultimul rând (align-items: flex-end + auto-margin pe meta).
  textTimeRow: { flexDirection: 'row', alignItems: 'flex-end', columnGap: 12 },
  textShrink: { flexShrink: 1 },
  metaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginLeft: 'auto',
  },
  // paddingRight: Android măsoară textul italic cu lățimea glifelor drepte (o
  // subestimează) → ultimul cuvânt se tăia la marginea bulei („This message was…”).
  // Padding-ul mută zona tăiată pe spațiu gol, nu pe text.
  deletedText: { fontStyle: 'italic', paddingRight: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: Spacing.one },
  editedLabel: { fontStyle: 'italic', paddingRight: 2 }, // italic: același clip ca deletedText
  // Stil 6b (26 iul): „atașament etichetat" — card pe suprafață proprie, ÎN AFARA bulei.
  attachCard: {
    borderRadius: 16,
    overflow: 'hidden',
    minWidth: 252,
    marginBottom: 2,
  },
  attachCardShadow: {
    shadowColor: '#142850',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 3,
  },
  attachBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  attachBandText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  attachBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  attachInfo: { flex: 1, gap: 2 },
  attachName: { fontSize: 15, fontWeight: '700' },
  attachMeta: { fontSize: 12, fontWeight: '600' },
  attachPrice: { fontSize: 14, fontWeight: '800', marginTop: 3 },
  attachThumb: { width: 52, height: 52, borderRadius: 10 },
  attachThumbFallback: { justifyContent: 'center', alignItems: 'center' },
  attachCta: { borderTopWidth: 1, paddingVertical: 10, alignItems: 'center' },
  attachCtaText: { fontSize: 13, fontWeight: '700' },
  attachExternalMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  attachMetaRight: { alignSelf: 'flex-end' },
  attachMetaLeft: { alignSelf: 'flex-start' },
  // Faza 19.5: bula-fișier.
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minWidth: 200,
    maxWidth: 260,
    paddingVertical: 2,
  },
  fileIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 13, fontWeight: '700' },
  fileSize: { fontSize: 11, fontWeight: '600', marginTop: 1 },
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
  inputWrap: { flex: 1 },
  input: {
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
