import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
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
  useWindowDimensions,
  View,
} from 'react-native';
import type {
  LayoutChangeEvent,
  ListRenderItemInfo,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';


import { ActionSheet } from '@/components/action-sheet';
import { AttachSheet } from '@/components/attach-sheet';
import { Avatar } from '@/components/avatar';
import { LinkifiedText } from '@/components/linkified-text';
import { MentionPanel } from '@/components/mention-panel';
import { MessageActionSheet } from '@/components/message-action-sheet';
import { PhotoViewer } from '@/components/photo-viewer';
import { RemoteImage } from '@/components/remote-image';
import { ReportSheet } from '@/components/report-sheet';
import { Toast } from '@/components/toast';
import { HeaderProfileButton, HeaderText, ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VideoPlayerModal } from '@/components/video-player-modal';
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
import { useVideoThumbnail } from '@/hooks/use-video-thumbnail';
import type { MessageMention } from '@/lib/chat-schema';
import { displayName } from '@/lib/display-name';
import { mentionQueryAt, rankMentionCandidates, type MentionUser } from '@/lib/mention-search';
import * as outbox from '@/lib/outbox';
import { subscribeRetryTriggers } from '@/lib/retry-triggers';
import type { OutboxAttachment, OutboxEntry, OutboxSendResult, OutboxSender } from '@/lib/outbox';
import { translateDbError } from '@/lib/db-errors';
import { shareContact } from '@/lib/share-contact';
import { userColor } from '@/lib/user-color';
import {
  MAX_PHOTOS,
  pickFromCamera,
  pickMediaFromLibrary,
  recordVideo,
  type PickedImage,
  type PickedVideo,
} from '@/lib/media';
import {
  BLOCKED_FILE_EXTENSIONS,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_MB,
  MAX_VIDEO_SIZE,
  MAX_VIDEO_SIZE_MB,
  fileExtension,
  isVideoFile,
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
    /** 23 aug: numele fișierului/videoclipului citat — fără el snippetul era gol. */
    file_name?: string | null;
    /** 24 aug: path-ul fișierului citat — sursa miniaturii video din citat. */
    file_path?: string | null;
    /** 24 aug: durata videoclipului citat (secunde) — meta „Videoclip · 0:12". */
    file_duration?: number | null;
    sender_id: string;
    deleted_at: string | null;
    sender?: { full_name: string } | null;
    /** 10 sept: contextele mesajului citat — fără ele citatul unei recomandări
     * (mesaj doar-card, content='') era gol. Embed-ul poate lipsi cu id-ul prezent. */
    recommended_mechanic_id?: string | null;
    listing_id?: string | null;
    announcement_id?: string | null;
    mechanic?: { full_name: string; deleted_at: string | null; role?: string } | null;
    listing?: { title: string } | null;
    announcement?: { location: string } | null;
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
  /** 24 aug: durata în secunde, doar la videoclipuri (badge pe bulă + meta citat). */
  file_duration?: number | null;
  /** Faza 19.6: anunțul de depanare distribuit (share). NULL = șters/invizibil prin RLS. */
  announcement_id?: string | null;
  announcement?: {
    id: string;
    location: string;
    status: string;
    description?: string | null;
  } | null;
  /** 10 sept: menționările „@Nume" din text — evidențiate + apăsabile în bulă. */
  mentions?: MessageMention[] | null;
  /** 1.1 (B3): oaspete — mesajul are o poză pe care oaspetele n-o poate vedea (placeholder). */
  has_image?: boolean | null;
}

/**
 * 1.1 (7.1, AUDIT E.21): rezultatul unei trimiteri. Până acum `onSend` întorcea `void`,
 * iar eroarea insert-ului se pierdea odată cu mesajul (compozitorul era deja golit).
 */
export type ChatSendResult<M> = { ok: true; message: M } | { ok: false; error: string };
export type ChatEditResult = { ok: true } | { ok: false; error: string };

/**
 * Mesajul text predat ecranului. Contextele (card de Market, persoană recomandată, anunț
 * distribuit) vin de aici, nu din starea ecranului: o reîncercare din coada locală — și
 * după repornire — trebuie să poarte același card ca trimiterea inițială.
 */
export interface ChatOutgoing {
  content: string;
  replyToId: string | null;
  mentions: MessageMention[] | null;
  listingId: string | null;
  mechanicId: string | null;
  announcementId: string | null;
}

/** Cover-ul unui anunț de market din embed-ul de poze (poziția minimă = cover). */
function listingCoverPath(
  listing: NonNullable<ChatMessageBase['listing']> | null | undefined,
): string | null {
  const photos = listing?.market_listing_photos;
  if (!photos || photos.length === 0) return null;
  return [...photos].sort((a, b) => a.position - b.position)[0].storage_path;
}

/** Citatul unui mesaj, normalizat defensiv (vechiul embed self-join întorcea ARRAY —
 *  vezi comentariul din MessageBubble). Folosit și de părinte (semnarea path-urilor
 *  citate pentru miniaturile din citat, 24 aug). */
function replyOf(m: ChatMessageBase): ChatMessageBase['reply_to'] {
  const raw = m.reply_to as unknown;
  return (Array.isArray(raw) ? raw[0] : raw) as ChatMessageBase['reply_to'];
}

/** Ce știe un citat / o țintă de reply despre mesaj — comun bulei și bannerului. */
type SnippetSource = {
  content: string;
  image_path?: string | null;
  file_name?: string | null;
  file_path?: string | null;
  deleted_at?: string | null;
  recommended_mechanic_id?: string | null;
  listing_id?: string | null;
  announcement_id?: string | null;
  mechanic?: { full_name?: string | null; deleted_at?: string | null; role?: string } | null;
  listing?: { title: string } | null;
  announcement?: { location: string } | null;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Rândul de text al unui citat (bula cu reply) și al bannerului „Răspunzi la…":
 * șters → marcaj; poză/fișier/video → etichetă; text → textul; altfel CONTEXTUL
 * atașat (10 sept — reply la o recomandare / anunț din Market / anunț de depanare
 * arăta un citat complet gol, fiindcă astfel de mesaje au content=''). Cu embed-ul
 * lipsă (RLS, rând dispărut) rămâne eticheta generică a benzii cardului.
 */
function contextSnippet(m: SnippetSource, t: Translate): string {
  if (m.deleted_at) return t('chat.deletedMessage');
  if (m.image_path) return t('chat.photo');
  if (m.file_name) return (isVideoFile(m.file_name, m.file_path) ? '🎥 ' : '📎 ') + m.file_name;
  if (m.content) return m.content;
  if (m.recommended_mechanic_id) {
    const name = m.mechanic ? displayName(m.mechanic, t) : '';
    return name
      ? t('chat.quoteRecommendation', { name })
      : t(m.mechanic?.role === 'driver' ? 'attach.bandDriver' : 'attach.bandMechanic');
  }
  if (m.listing_id) {
    return m.listing?.title
      ? t('chat.quoteListing', { title: m.listing.title })
      : t('attach.bandMarket');
  }
  if (m.announcement_id) {
    return m.announcement?.location
      ? t('chat.quoteAnnouncement', { location: m.announcement.location })
      : t('attach.bandAnnouncement');
  }
  return '';
}

/** Durata unui videoclip, stil player: „0:12", „1:05", „12:40". */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, Math.round(seconds % 60));
  return `${m}:${String(s).padStart(2, '0')}`;
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

/**
 * Stil 11b (spec user, 24 aug): tokens pentru CARDUL DE CITAT MEDIA (reply la
 * poză/videoclip) — fundal per direcție (bulă trimisă/primită), meta și
 * placeholder-ul de thumbnail, comutate de temă. Numele în bula primită se
 * colorează cu paleta stabilă a utilizatorului citat (userColor), în cea trimisă
 * rămâne alb.
 */
const QUOTE_TOKENS = {
  light: {
    sentBg: 'rgba(255,255,255,0.14)',
    recvBg: '#EEF2F7',
    sentMeta: 'rgba(255,255,255,0.75)',
    recvMeta: '#5B6472',
    thumbFallback: '#D7DFEA',
  },
  dark: {
    sentBg: 'rgba(255,255,255,0.12)',
    recvBg: '#0F1622',
    sentMeta: 'rgba(255,255,255,0.7)',
    recvMeta: '#96A1B1',
    thumbFallback: '#202B3E',
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

/**
 * Pragul de „font mărit" (8 oct 2026, reclamație cu înregistrare de ecran): peste el,
 * bula nu mai așază textul și ora într-un RÂND flex (text shrink + meta cu auto-margin),
 * ci într-un SINGUR Text cu un distanțier invizibil la final și ora așezată absolut în
 * colț (modelul WhatsApp). Motivul: pe Fabric (RN 0.81) rândul flex măsoară textul cu o
 * fracțiune de pixel mai puțin decât îl desenează — la fontul de sistem mărit ultimul
 * cuvânt cădea pe un al doilea rând pe care layout-ul nu-l prevăzuse și dispărea
 * („Cu drag," → „Cu", „Drag" → „Dra"; aceeași familie ca #53286 și bug-ul italic de la
 * mesajul șters). Sub prag NIMIC nu se schimbă: dispozitivele cu font normal păstrează
 * exact layout-ul de dinainte, verificat pe device.
 */
const LARGE_FONT_SCALE = 1.05;
/**
 * Ora/„editat"/distanțierul din layout-ul cu font mărit cresc cel mult 1,4× (cerere user
 * 8 oct: „ora puțin mai mică") — textul mesajului urmează scara completă, ora rămâne
 * discretă. Distanțierul are ACELAȘI plafon, ca lățimea rezervată să coincidă cu ora.
 */
const META_MAX_FONT_SCALE = 1.4;

/**
 * Distanțierul de la capătul textului în layout-ul cu font mărit: DOAR spații
 * non-breaking (nu ora cu culoare transparentă — pe Android textul „transparent"
 * din interiorul unui Text se desena vizibil, ora apărea de două ori; test 8 oct).
 * Lățimea e estimată din glifele orei/„editat" (digit ≈ 0.56 em, „:" ≈ 0.3, literă
 * ≈ 0.52, nbsp ≈ 0.25; +10 % pentru weight 600) plus bifele (14 px ≈ 1.3 em la 11 px)
 * și aerul dintre text și oră. Dacă nu încape la capătul ultimului rând, cade întreg
 * pe rândul următor, iar ora absolută îl urmează (ca pe WhatsApp).
 */
function metaSpacerFor(meta: string, withTick: boolean): string {
  let em = 0;
  for (const ch of meta) {
    em += /\d/.test(ch) ? 0.56 : ch === ':' ? 0.3 : ch === ' ' ? 0.25 : 0.52;
  }
  em *= 1.1;
  if (withTick) em += 1.3 + 0.36;
  em += 0.9;
  return ' '.repeat(Math.ceil(em / 0.25) + 1);
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
 * Compozitorul crește cu textul până la 2,5× înălțimea de bază (cerere 8 aug);
 * abia DUPĂ plafon textul derulează în interior. lineHeight explicit — altfel
 * „2,5×" ar depinde de fontul fiecărei platforme.
 *
 * Padding-ul vertical și colțurile rotunde stau pe ÎNVELIȘ (inputWrap), nu pe
 * TextInput: la un element derulabil padding-ul face parte din zona derulată,
 * deci textul intra sub marginile rotunjite la scroll (bug raportat 8 aug, cu
 * poză). Cu învelișul nederulabil, textul rămâne mereu între padding-uri.
 * Constantele INNER_* sunt înălțimile TEXTULUI; caseta vizibilă = text + 22.
 */
const COMPOSER_LINE_HEIGHT = 20;
const COMPOSER_V_PADDING = 11;
const COMPOSER_INNER_BASE = COMPOSER_LINE_HEIGHT; // caseta de bază: 42 vizibil
// Plafonul casetei VIZIBILE = 2,5 × 42 = 105 → zona de text = 105 − 22 = 83.
const COMPOSER_INNER_MAX =
  Math.round(2.5 * (COMPOSER_LINE_HEIGHT + 2 * COMPOSER_V_PADDING)) - 2 * COMPOSER_V_PADDING;
// Forma ca la WhatsApp (referință 8 aug, cu poze): pastilă la 1–3 rânduri, iar de
// la al 4-lea caseta devine dreptunghi cu colțuri moderat rotunjite.
const COMPOSER_TALL_THRESHOLD = 3 * COMPOSER_LINE_HEIGHT;
const COMPOSER_RECT_RADIUS = 20;
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
  /** Tap pe avatarul SAU numele expeditorului (chat de grup) → profilul lui. */
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
  /** Video în chat (23 aug): URL-ul SEMNAT al fișierului — sursa thumbnail-ului
   * generat pe device (bula-video). Absent la fișierele non-video. */
  fileUrl?: string;
  /** Tap pe bula-video → playerul full-screen. */
  onPressVideo?: () => void;
  /** Miniaturi în CITAT (24 aug, ca pe WhatsApp): URL-urile semnate ale pozei,
   * respectiv videoclipului citat (din ele se derivă thumbnail-ul pe device). */
  quoteImageUrl?: string;
  quoteVideoUrl?: string;
  /** Mesajul citat îi aparține utilizatorului curent → numele devine „Tu" (11b). */
  quoteIsMine?: boolean;
  /** Faza 19.6: tap pe cardul de anunț de depanare distribuit → detaliul lui. */
  onPressAnnouncement?: (announcementId: string) => void;
  /** Evidențiere scurtă a rândului (saltul din citat, 10 sept): fiecare valoare
   * nenulă nouă pornește animația; 0/absent = nimic. */
  flashNonce?: number;
  /** 1.1 (B3): poză invizibilă pentru oaspete → bulă-placeholder apăsabilă (pop-up de cont). */
  photoPlaceholder?: { label: string; onPress: () => void };
  /** 1.1 (7.1): bulă din coada locală — ceas cât se trimite, „Netrimis · Reîncearcă" la eșec. */
  localStatus?: 'sending' | 'failed';
  /** Tap pe bula netrimisă / pe „Reîncearcă" → retrimite. */
  onRetry?: () => void;
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
  fileUrl,
  onPressVideo,
  quoteImageUrl,
  quoteVideoUrl,
  quoteIsMine,
  onPressAnnouncement,
  flashNonce,
  photoPlaceholder,
  localStatus,
  onRetry,
}: MessageBubbleProps<M>) {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const { t } = useTranslation();
  // Font de sistem mărit → layout-ul „un singur Text + oră absolută" (vezi LARGE_FONT_SCALE).
  // `useWindowDimensions` urmărește și schimbarea scării din Setări, fără repornire.
  const { fontScale } = useWindowDimensions();
  const largeFont = fontScale > LARGE_FONT_SCALE;
  const isDeleted = !!message.deleted_at;
  const isImage = !isDeleted && !!message.image_path;
  const isFile = !isDeleted && !isImage && !!message.file_path;
  // Video (23 aug): un mesaj-fișier cu extensie video devine bulă-video (thumbnail +
  // play). Hook-ul rulează necondiționat (regula hooks); fără URL nu generează nimic.
  const isVideo = isFile && isVideoFile(message.file_name, message.file_path);
  const videoThumb = useVideoThumbnail(message.id, isVideo ? fileUrl : undefined);
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
  const textSurface = scheme === 'dark' ? 'dark' : 'light';
  const nameColor = userColor(message.sender_id, textSurface);
  // Pe bula PROPRIE (gradient navy + voalul alb al citatului) nicio culoare din paletă nu
  // ține contrastul ≥ 4,5 (măsurat la review, 24 oct: 2,9–4,4) → acolo rămâne albul de
  // dinainte; culoarea per utilizator se aplică pe bulele primite și pe fundalul ecranului.
  const mentionColor = (id: string) => (isMe ? '#FFFFFF' : userColor(id, textSurface));
  // Numele + rolul apar O dată per grup, ÎN prima bulă (nu deasupra ei, ca înainte).
  // Tap pe nume = tap pe avatar (profilul expeditorului) — cerere user, 10 aug.
  const senderHeader =
    !isMe && isFirstOfGroup && senderName ? (
      <Text
        numberOfLines={1}
        onPress={onPressAvatar}
        suppressHighlighting
        style={[styles.senderHeader, (isImage || isVideo) && styles.senderHeaderOnImage]}>
        <Text style={[styles.senderHeaderName, { color: nameColor }]}>{senderName}</Text>
        {senderRole ? (
          <Text style={[styles.senderHeaderRole, { color: secondaryColor }]}>
            {` · ${senderRole}`}
          </Text>
        ) : null}
      </Text>
    ) : null;
  // Bifele — sau, la bulele din coada locală (1.1, 7.1), ceasul / semnul de eroare.
  const statusIcon = (color: string) =>
    localStatus === 'sending' ? (
      <MaterialIcons
        name="schedule"
        size={14}
        color={color}
        accessibilityLabel={t('outbox.sending')}
      />
    ) : localStatus === 'failed' ? (
      <MaterialIcons
        name="error-outline"
        size={14}
        color={color}
        accessibilityLabel={t('outbox.failed')}
      />
    ) : readState ? (
      <MaterialIcons
        name={readState === 'read' ? 'done-all' : 'check'}
        size={14}
        color={color}
      />
    ) : null;
  const tick = statusIcon(secondaryColor);
  // Font mărit: distanțier INVIZIBIL randat în textul mesajului — rezervă lățimea orei
  // (+ „editat", + bifele) la capătul ultimului rând, ca ora absolută să nu se suprapună.
  // Spații non-breaking, ca distanțierul să nu se rupă de ultimul cuvânt.
  const metaSpacer = largeFont
    ? metaSpacerFor(
        [message.edited_at ? t('chat.edited') : null, formatTime(message.created_at)]
          .filter(Boolean)
          .join(' '),
        !!tick
      )
    : '';
  // Embed-ul `reply_to` vine ca obiect/null (embed pe coloana FK, m2o — vezi
  // replyEmbed). Normalizarea array→primul rămâne DEFENSIV: vechiul embed self-join
  // `<tabel>!reply_to_id` era rezolvat de PostgREST în direcția inversă (o2m) și
  // întorcea ARRAY — `[]` truthy randa un chenar quote gol, iar reply-urile reale
  // rămâneau fără citat („Mesaj indisponibil", bug reparat 7 aug).
  const rt = replyOf(message);
  const quote = !isDeleted && rt && rt.id ? rt : null;
  // Miniatura din citat (24 aug): la video se generează pe device din URL-ul semnat
  // (cache-ul e pe id-ul mesajului CITAT — dacă originalul e în listă, e deja caldă).
  const quoteIsVideo = !!quote && !quote.deleted_at && isVideoFile(quote.file_name, quote.file_path);
  const quoteIsImage = !!quote && !quote.deleted_at && !!quote.image_path;
  const quoteVideoThumb = useVideoThumbnail(
    quoteIsVideo && quote ? quote.id : '',
    quoteIsVideo ? quoteVideoUrl : undefined,
  );
  // Sursa thumbnail-ului din cardul de citat media (stil 11b): poza = URL semnat
  // direct; videoclipul = cadrul generat pe device. Lipsă → placeholder neutru.
  const quoteMediaThumb = quoteIsVideo ? quoteVideoThumb : quoteIsImage ? quoteImageUrl : undefined;
  const qtk = QUOTE_TOKENS[scheme];
  const quoteNameColor = isMe
    ? '#FFFFFF'
    : quote?.sender_id
      ? userColor(quote.sender_id, textSurface)
      : theme.brand;
  // reply_to_id există dar embed-ul vine gol: originalul e invizibil prin RLS (chat
  // global — mesaj dinaintea creării contului) sau șters definitiv → „Mesaj indisponibil".
  const quoteUnavailable = !isDeleted && !!message.reply_to_id && !quote;
  // Video/fișier (23 aug) și contexte atașate (10 sept): mesajele-atașament au
  // content='' — fără ramurile dedicate citatul era GOL (vezi contextSnippet).
  const quoteSnippet = quote ? contextSnippet(quote, t) : '';

  // Evidențiere la saltul din citat (10 sept, ca pe WhatsApp): rândul se colorează
  // scurt în brand, ține puțin, apoi se stinge. Pornește la fiecare nonce nou —
  // inclusiv la MONTARE, dacă ținta nu era randată când s-a cerut saltul
  // (virtualizare: scrollToIndex o aduce în viewport abia după retry).
  const flash = useSharedValue(0);
  useEffect(() => {
    if (!flashNonce) return;
    flash.value = 0;
    flash.value = withSequence(
      withTiming(1, { duration: 120 }),
      withDelay(700, withTiming(0, { duration: 900 })),
    );
  }, [flashNonce, flash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value * 0.18 }));

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
      {/* Banda de evidențiere pe toată lățimea rândului (inclusiv padding-ul listei). */}
      <Animated.View
        pointerEvents="none"
        style={[styles.flashOverlay, { backgroundColor: theme.brand }, flashStyle]}
      />
      {showSenderAvatar && !isMe ? (
        isFirstOfGroup ? (
          // Avatarul apare O dată per grup, aliniat SUS, în dreptul primului mesaj.
          <Pressable onPress={onPressAvatar} disabled={!onPressAvatar} hitSlop={6}>
            <Avatar
              url={senderAvatarUrl}
              name={senderName}
              size={GROUP_AVATAR_SIZE}
              color={userColor(message.sender_id, 'light')}
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
          <Text
            numberOfLines={1}
            onPress={onPressAvatar}
            suppressHighlighting
            style={styles.senderLabelOutside}>
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
            <Avatar url={mechanicAvatarUrl} name={message.mechanic.full_name} size={44} userId={message.mechanic.id} />
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
              <RemoteImage
                uri={listingCoverUrl}
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
        <Pressable
          onPress={localStatus === 'failed' ? onRetry : undefined}
          onLongPress={onLongPress}
          delayLongPress={300}>
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
            (isImage || isVideo) && styles.bubbleImage,
            !isMe && { backgroundColor: theme.backgroundElement },
          ]}>
          {senderHeader}
          {isDeleted ? (
            // Tombstone (Faza 14): bula rămâne, textul e discret (gri, cu iconița
            // „interzis" în față ca pe WhatsApp; italic doar unde Android nu-l
            // măsoară greșit — vezi deletedText).
            // Faza 16: marcaj DISTINCT dacă ștergerea a fost făcută de un moderator.
            largeFont ? (
              // Font mărit (8 oct): un singur Text (iconiță inline + marcaj + distanțier),
              // ora absolută în colț — fără rândul flex care tăia ultimul cuvânt.
              <View style={styles.textBlock}>
                <Text style={[styles.bubbleText, styles.deletedText, { color: secondaryColor }]}>
                  <MaterialIcons name="block" size={13} color={secondaryColor} />
                  {' '}
                  {message.deleted_by_admin ? t('chat.deletedByModerator') : t('chat.deletedMessage')}
                  <Text
                    style={[styles.bubbleTime, styles.metaSpacer]}
                    maxFontSizeMultiplier={META_MAX_FONT_SCALE}>
                    {metaSpacer}
                  </Text>
                </Text>
                <View style={[styles.metaInline, styles.metaAbsolute]}>
                  <Text
                    style={[styles.bubbleTime, { color: secondaryColor }]}
                    maxFontSizeMultiplier={META_MAX_FONT_SCALE}>
                    {formatTime(message.created_at)}
                  </Text>
                </View>
              </View>
            ) : (
            <View style={styles.textTimeRow}>
              <MaterialIcons
                name="block"
                size={13}
                color={secondaryColor}
                style={styles.deletedIcon}
              />
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
            )
          ) : photoPlaceholder ? (
            <Pressable
              onPress={photoPlaceholder.onPress}
              accessibilityRole="button"
              style={({ pressed }) => [styles.textTimeRow, pressed && styles.pressed]}>
              <MaterialIcons name="image" size={16} color={secondaryColor} />
              <Text style={[styles.bubbleText, styles.textShrink, { color: isMe ? '#FFFFFF' : theme.text }]}>
                {photoPlaceholder.label}
              </Text>
            </Pressable>
          ) : isImage ? (
            // Poza umple bula; ora stă peste ea, într-o pastilă întunecată.
            <Pressable
              onPress={imageUrl ? onPressImage : undefined}
              onLongPress={onLongPress}
              delayLongPress={300}
              style={({ pressed }) => [styles.imageWrap, pressed && styles.pressed]}>
              {imageUrl ? (
                // RemoteImage (15 oct): poza picată pe rețea slabă reîncearcă singură —
                // înainte rămânea goală până la repornirea app-ului.
                <RemoteImage
                  uri={imageUrl}
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
          ) : isVideo ? (
            // Video (23 aug): tile ca la poze — thumbnail generat pe device + buton
            // play; tap = playerul full-screen (expo-video). Fără thumbnail (web /
            // generare eșuată) rămâne tile-ul întunecat cu play — tot funcțional.
            <Pressable
              onPress={onPressVideo}
              onLongPress={onLongPress}
              delayLongPress={300}
              disabled={!onPressVideo}
              style={({ pressed }) => [styles.imageWrap, pressed && styles.pressed]}>
              {videoThumb ? (
                <Image
                  source={{ uri: videoThumb }}
                  style={styles.imageThumb}
                  contentFit="cover"
                  transition={150}
                />
              ) : (
                <View style={[styles.imageThumb, styles.videoPlaceholder]} />
              )}
              <View style={styles.videoPlayOverlay} pointerEvents="none">
                <View style={styles.videoPlayCircle}>
                  <MaterialIcons name="play-arrow" size={30} color="#fff" />
                </View>
              </View>
              {/* Durata (24 aug, ca în mockup 11b): pastilă stânga-jos — dreapta-jos
                  e ocupată de oră, ca la poze. Doar când durata e cunoscută. */}
              {message.file_duration ? (
                <View style={[styles.imageTimePill, styles.videoDurationPill]}>
                  <Text style={styles.imageTimeText}>
                    {formatDuration(message.file_duration)}
                  </Text>
                </View>
              ) : null}
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
              {quote && (quoteIsVideo || quoteIsImage) ? (
                // Stil 11b (spec user, 24 aug): citat media = card cu thumbnail
                // PĂTRAT 52px în STÂNGA (colțuri 8, niciodată cerc), nume + meta
                // („Videoclip"/„Poză") lângă el, FĂRĂ bara colorată; play-badge
                // (cerc 22px) doar la video, și pe placeholderul fără thumbnail.
                <Pressable
                  onPress={onPressQuote}
                  onLongPress={onLongPress}
                  delayLongPress={300}
                  style={[
                    styles.quoteMedia,
                    { backgroundColor: isMe ? qtk.sentBg : qtk.recvBg },
                  ]}>
                  <View style={styles.quoteThumbWrap}>
                    {quoteMediaThumb ? (
                      // Poza citată e URL semnat; thumbnail-ul video e fișier local —
                      // RemoteImage le afișează pe ambele (reîncearcă doar ce e remote).
                      <RemoteImage
                        uri={quoteMediaThumb}
                        style={styles.quoteThumb}
                        contentFit="cover"
                      />
                    ) : (
                      <View
                        style={[styles.quoteThumb, { backgroundColor: qtk.thumbFallback }]}
                      />
                    )}
                    {quoteIsVideo ? (
                      <View style={styles.quotePlayOverlay} pointerEvents="none">
                        <View style={styles.quotePlayBadge}>
                          <MaterialIcons name="play-arrow" size={14} color="#fff" />
                        </View>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.quoteMediaCol}>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.quoteMediaName,
                        { color: quoteNameColor },
                      ]}>
                      {quoteIsMine ? t('chat.you') : (quote.sender?.full_name ?? '')}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.quoteMediaMeta,
                        { color: isMe ? qtk.sentMeta : qtk.recvMeta },
                      ]}>
                      {quoteIsVideo
                        ? t('chat.video') +
                          (quote.file_duration ? ` · ${formatDuration(quote.file_duration)}` : '')
                        : t('chat.photoLabel')}
                    </Text>
                  </View>
                </Pressable>
              ) : quote ? (
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
                  <View style={styles.quoteTextCol}>
                    <Text
                      numberOfLines={1}
                      style={[styles.quoteName, { color: quoteNameColor }]}>
                      {quote.sender?.full_name ?? ''}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.quoteSnippet, { color: secondaryColor }]}>
                      {quoteSnippet}
                    </Text>
                  </View>
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
              {message.content !== '' && largeFont ? (
                // Font mărit (8 oct, vezi LARGE_FONT_SCALE): textul singur își face
                // rândurile, distanțierul invizibil ține loc orei, ora stă absolut în colț.
                <View style={styles.textBlock}>
                  <LinkifiedText
                    text={message.content}
                    style={[styles.bubbleText, { color: isMe ? '#ffffff' : theme.text }]}
                    linkStyle={{ color: isMe ? '#ffffff' : theme.brand }}
                    mentions={message.mentions}
                    mentionStyle={{ color: isMe ? '#ffffff' : theme.brand }}
                    mentionColor={mentionColor}
                    onLongPress={onLongPress}
                    trailing={
                      <Text
                        style={[styles.bubbleTime, styles.metaSpacer]}
                        maxFontSizeMultiplier={META_MAX_FONT_SCALE}>
                        {metaSpacer}
                      </Text>
                    }
                  />
                  <View style={[styles.metaInline, styles.metaAbsolute]}>
                    {message.edited_at ? (
                      <Text
                        style={[styles.bubbleTime, styles.editedLabel, { color: secondaryColor }]}
                        maxFontSizeMultiplier={META_MAX_FONT_SCALE}>
                        {t('chat.edited')}
                      </Text>
                    ) : null}
                    <Text
                      style={[styles.bubbleTime, { color: secondaryColor }]}
                      maxFontSizeMultiplier={META_MAX_FONT_SCALE}>
                      {formatTime(message.created_at)}
                    </Text>
                    {tick}
                  </View>
                </View>
              ) : message.content !== '' ? (
                <View style={styles.textTimeRow}>
                  {/* Linkuri + telefoane apăsabile (7 sept): pe bula trimisă rămân
                      albe (subliniate), pe cea primită iau culoarea brand. */}
                  <LinkifiedText
                    text={message.content}
                    style={[
                      styles.bubbleText,
                      styles.textShrink,
                      { color: isMe ? '#ffffff' : theme.text },
                    ]}
                    linkStyle={{ color: isMe ? '#ffffff' : theme.brand }}
                    mentions={message.mentions}
                    mentionStyle={{ color: isMe ? '#ffffff' : theme.brand }}
                    mentionColor={mentionColor}
                    onLongPress={onLongPress}
                  />
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
            {statusIcon(theme.textTertiary)}
          </View>
        )}
        {/* 1.1 (7.1): sub bula netrimisă, pe fundalul conversației (roșul n-ar avea
            contrast pe bula navy). Tap = retrimite; apăsare lungă = șterge (cu confirmare). */}
        {localStatus === 'failed' ? (
          <Pressable
            onPress={onRetry}
            onLongPress={onLongPress}
            delayLongPress={300}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${t('outbox.failed')}, ${t('outbox.retry')}`}
            style={({ pressed }) => [styles.failedRow, pressed && styles.pressed]}>
            <MaterialIcons name="error-outline" size={13} color={FAILED_COLOR[scheme]} />
            <Text style={[styles.failedText, { color: FAILED_COLOR[scheme] }]}>
              {`${t('outbox.failed')} · ${t('outbox.retry')}`}
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
    </GestureDetector>
  );
}

/** „Netrimis · Reîncearcă" (1.1, 7.1): pe fundalul conversației, contrast ≥ 4,5 în ambele teme. */
const FAILED_COLOR = { light: '#C5221F', dark: '#F28B82' } as const;

/** Pastila de zi / separatorul „Mesaje noi" de deasupra unui rând. */
function DayPill({ label, highlight }: { label: string; highlight?: boolean }) {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  return (
    <View style={styles.dateRow}>
      <View
        style={[
          styles.datePill,
          { backgroundColor: highlight ? theme.brandSoft : theme.backgroundElement },
          scheme === 'light' && Shadows.chip,
        ]}>
        <Text style={[styles.datePillText, { color: highlight ? theme.brand : theme.textTertiary }]}>
          {label}
        </Text>
      </View>
    </View>
  );
}

interface MessageRowProps<M extends ChatMessageBase> {
  item: M;
  isMe: boolean;
  isFirstOfGroup: boolean;
  /** Pastila de zi deasupra rândului; null = fără. */
  dateLabel: string | null;
  isUnreadAnchor: boolean;
  showSenderAvatar: boolean;
  senderName: string | null;
  senderRole: string | null;
  senderAvatarUrl?: string;
  imageUrl?: string;
  mechanicAvatarUrl?: string;
  listingCoverUrl?: string;
  fileUrl?: string;
  quoteImageUrl?: string;
  quoteVideoUrl?: string;
  quoteIsMine: boolean;
  readState: 'sent' | 'read' | null;
  flashNonce: number;
  downloadingFile: boolean;
  /** Oaspete: eticheta bulei-placeholder a pozei; null = poza obișnuită. */
  photoPlaceholderLabel: string | null;
  onPressPhotoPlaceholder?: () => void;
  onOpenImage: (m: M) => void;
  /** Absent = fără meniu (oaspete). */
  onOpenMenu?: (m: M) => void;
  /** Absent = fără swipe-to-reply (oaspete). */
  onSwipeReply?: (m: M) => void;
  onPressQuote: (m: M) => void;
  onPressUser?: (m: M) => void;
  onOpenFile: (m: M) => void;
  onOpenVideo: (m: M) => void;
  onPressListing?: (listingId: string) => void;
  onPressMechanic?: (mechanicId: string, role: string) => void;
  onPressAnnouncement?: (announcementId: string) => void;
}

/**
 * 1.1 (7.4, AUDIT #32): rândul unui mesaj, memoizat — tastarea și mesajele noi nu mai
 * redesenează toate bulele. Primește valori primitive (URL-uri deja rezolvate, etichete)
 * și handler-e STABILE care primesc mesajul; închiderile `() => handler(message)` se fac
 * aici. Comparația e cea implicită (superficială, pe TOATE props-urile), nu una pe câteva
 * câmpuri: identitatea lui `message` se schimbă exact când rândul trebuie redesenat
 * (mergeMessages păstrează obiectul neschimbat; addMessage / patchMessage / UPDATE-ul
 * Realtime înlocuiesc doar rândul atins) — inclusiv când sosesc embed-urile (citat, card)
 * fără ca edited_at să se schimbe, caz pe care o comparație pe id/edited_at/deleted_at
 * l-ar rata („Mesaj indisponibil" rămas pe ecran).
 */
function MessageRowImpl<M extends ChatMessageBase>({
  item,
  isFirstOfGroup,
  dateLabel,
  isUnreadAnchor,
  photoPlaceholderLabel,
  onPressPhotoPlaceholder,
  onOpenImage,
  onOpenMenu,
  onSwipeReply,
  onPressQuote,
  onPressUser,
  onOpenFile,
  onOpenVideo,
  ...rest
}: MessageRowProps<M>) {
  const { t } = useTranslation();
  return (
    // 14px între grupuri, 3px între mesajele aceluiași grup (spațierea 7a).
    <View style={isFirstOfGroup ? styles.groupSpacing : styles.messageSpacing}>
      {dateLabel ? <DayPill label={dateLabel} /> : null}
      {/* Separatorul „Mesaje noi" — deasupra primului necitit de la deschidere. */}
      {isUnreadAnchor ? <DayPill label={t('chat.newMessages')} highlight /> : null}
      <MessageBubble
        {...rest}
        message={item}
        isFirstOfGroup={isFirstOfGroup}
        onPressImage={() => onOpenImage(item)}
        onLongPress={onOpenMenu ? () => onOpenMenu(item) : undefined}
        onSwipeReply={onSwipeReply && !item.deleted_at ? () => onSwipeReply(item) : undefined}
        photoPlaceholder={
          photoPlaceholderLabel && onPressPhotoPlaceholder
            ? { label: photoPlaceholderLabel, onPress: onPressPhotoPlaceholder }
            : undefined
        }
        onPressQuote={item.reply_to_id ? () => onPressQuote(item) : undefined}
        onPressAvatar={onPressUser ? () => onPressUser(item) : undefined}
        onPressFile={!item.deleted_at && item.file_path ? () => onOpenFile(item) : undefined}
        onPressVideo={!item.deleted_at && item.file_path ? () => onOpenVideo(item) : undefined}
      />
    </View>
  );
}
const MessageRow = memo(MessageRowImpl) as typeof MessageRowImpl;

/** Citatul unei bule locale, construit din mesajul citat încă prezent în listă. */
function quoteFrom(m: ChatMessageBase, senderName: string): NonNullable<ChatMessageBase['reply_to']> {
  return {
    id: m.id,
    content: m.content,
    image_path: m.image_path ?? null,
    file_name: m.file_name ?? null,
    file_path: m.file_path ?? null,
    file_duration: m.file_duration ?? null,
    sender_id: m.sender_id,
    deleted_at: m.deleted_at ?? null,
    sender: { full_name: senderName },
    recommended_mechanic_id: m.recommended_mechanic_id ?? null,
    listing_id: m.listing_id ?? null,
    announcement_id: m.announcement_id ?? null,
    mechanic: m.mechanic
      ? { full_name: m.mechanic.full_name, deleted_at: m.mechanic.deleted_at, role: m.mechanic.role }
      : null,
    listing: m.listing ? { title: m.listing.title } : null,
    announcement: m.announcement ? { location: m.announcement.location } : null,
  };
}

/**
 * Bula locală a unui mesaj din coadă (1.1, 7.1). Poza / fișierul se arată din `localUri`;
 * cardul atașat, din instantaneul de la trimitere (fără copertă / avatar — vin cu rândul
 * de pe server). Citatul doar dacă mesajul citat e încă în listă.
 */
function pendingMessage(
  entry: OutboxEntry,
  senderId: string,
  quote: ChatMessageBase['reply_to'],
): ChatMessageBase {
  const att = entry.attachments[0];
  const preview = entry.preview;
  return {
    id: entry.localId,
    content: entry.content,
    sender_id: senderId,
    created_at: entry.createdAt,
    image_path: att?.kind === 'image' ? att.localUri : null,
    file_path: att?.kind === 'file' ? att.localUri : null,
    file_name: att?.kind === 'file' ? att.name : null,
    file_size: att?.kind === 'file' ? att.size : null,
    file_duration: att?.kind === 'file' ? (att.durationS ?? null) : null,
    reply_to_id: quote ? entry.replyToId : null,
    reply_to: quote,
    mentions: entry.mentions,
    listing_id: entry.listingId,
    listing: preview?.listing ? { ...preview.listing, status: '' } : null,
    recommended_mechanic_id: entry.mechanicId,
    mechanic: preview?.mechanic ? { ...preview.mechanic, avatar_path: null } : null,
    announcement_id: entry.announcementId,
    announcement: preview?.announcement ? { ...preview.announcement, status: '' } : null,
  };
}

interface PendingRowProps {
  entry: OutboxEntry;
  senderId: string;
  quote: ChatMessageBase['reply_to'];
  quoteImageUrl?: string;
  quoteVideoUrl?: string;
  quoteIsMine: boolean;
  isFirstOfGroup: boolean;
  dateLabel: string | null;
  onRetry: (localId: string) => void;
  onDiscard: (localId: string) => void;
}

function PendingRowImpl({
  entry,
  senderId,
  quote,
  quoteImageUrl,
  quoteVideoUrl,
  quoteIsMine,
  isFirstOfGroup,
  dateLabel,
  onRetry,
  onDiscard,
}: PendingRowProps) {
  const message = useMemo(() => pendingMessage(entry, senderId, quote), [entry, senderId, quote]);
  const failed = entry.status === 'failed';
  const retry = failed ? () => onRetry(entry.localId) : undefined;
  const att = entry.attachments[0];
  return (
    <View style={isFirstOfGroup ? styles.groupSpacing : styles.messageSpacing}>
      {dateLabel ? <DayPill label={dateLabel} /> : null}
      <MessageBubble
        message={message}
        isMe
        isFirstOfGroup={isFirstOfGroup}
        imageUrl={att?.kind === 'image' ? att.localUri : undefined}
        fileUrl={att?.kind === 'file' ? att.localUri : undefined}
        quoteImageUrl={quoteImageUrl}
        quoteVideoUrl={quoteVideoUrl}
        quoteIsMine={quoteIsMine}
        onPressImage={retry}
        onPressFile={retry}
        onPressVideo={retry}
        onLongPress={failed ? () => onDiscard(entry.localId) : undefined}
        localStatus={entry.status}
        onRetry={retry}
      />
    </View>
  );
}
const PendingRow = memo(PendingRowImpl);

/** API-ul compozitorului către ecran (1.1, 7.4): textul trăiește în compozitor. */
export interface ChatComposerHandle {
  setText: (text: string) => void;
  /** Golește textul + menționările alese. */
  clear: () => void;
  /** Golește doar dacă textul e încă cel trimis (nu șterge ce s-a tastat între timp). */
  clearIfText: (sent: string) => void;
  getText: () => string;
  insertMention: (user: MentionUser) => void;
}

interface ChatComposerProps {
  ref?: Ref<ChatComposerHandle>;
  /** Mod editare: butonul devine bifă, atașările dispar, fără menționări. */
  editing: boolean;
  hasPendingAttach: boolean;
  sending: boolean;
  uploading: boolean;
  /** Bara de blocare (Faza 18): înlocuiește caseta, dar compozitorul rămâne montat — textul
   * tastat supraviețuiește blocării + deblocării, ca înainte. */
  frozenBar: React.ReactNode;
  showCamera: boolean;
  onPressCamera: () => void;
  showPlus: boolean;
  onPressPlus: () => void;
  mentionsEnabled: boolean;
  /** Interogarea „@" de sub cursor (null = niciuna) — fereastra de menționări e a ecranului. */
  onMentionQueryChange: (query: string | null) => void;
  /** Butonul de trimitere: textul fără spații la capete + menționările rămase în text. */
  onSubmit: (text: string, mentions: MessageMention[]) => void;
}

/**
 * 1.1 (7.4, AUDIT #32): compozitorul, cu starea textului PROPRIE — înainte fiecare tastă
 * re-randa tot ecranul de chat (lista cu sute de bule inclusă). Ecranul îl comandă prin
 * `ref` (editare, golire după trimitere, inserarea unei menționări).
 */
function ChatComposerImpl({
  ref,
  editing,
  hasPendingAttach,
  sending,
  uploading,
  frozenBar,
  showCamera,
  onPressCamera,
  showPlus,
  onPressPlus,
  mentionsEnabled,
  onMentionQueryChange,
  onSubmit,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const [text, setText] = useState('');
  const textRef = useRef(text);
  textRef.current = text;

  // Creșterea compozitorului (8 aug; iOS refăcut 11 sept), per platformă:
  //  • Android — nimic manual: inputul multiline crește nativ între minHeight și
  //    maxHeight; o înălțime forțată din state doar l-ar face să „sară".
  //    onContentSizeChange (de încredere pe Android) decide DOAR forma.
  //  • iOS — ACELAȘI mecanism nativ (min/max). Până la 11 sept înălțimea venea
  //    din state, setată din onContentSizeChange — pe arhitectura nouă (RN 0.81,
  //    implicită în SDK 54) iOS emite evenimentul DOAR când se schimbă cadrul
  //    view-ului (RCTTextInputComponentView.updateLayoutMetrics), nu la tastare;
  //    cu înălțimea fixă cadrul nu se schimba niciodată → caseta rămânea pe un
  //    rând (reclamație 11 sept: „apar doar primele 4 cuvinte"; RN #52854,
  //    gifted-chat #2552 — același simptom, aceeași soluție). Forma și derularea
  //    se iau din onLayout: înălțimea AȘEZATĂ, emisă de shadow tree la orice
  //    schimbare de layout — singurul semnal de încredere pe Fabric.
  //  • web — react-native-web raportează scrollHeight, care la înălțime FIXĂ nu
  //    coboară niciodată sub ea → caseta nu s-ar mai strânge la ștergerea
  //    textului (bug prins la test, 8 aug). Măsurăm noi, pe efect de text, cu
  //    trucul clasic: înălțime 0 → citește scrollHeight (include padding-ul) →
  //    repune imediat valoarea plafonată, ca să nu existe niciun cadru gol.
  // Pe WEB nu trece NIMIC prin state: prima variantă făcea setState la fiecare
  // tastă (măsurare în efect de text) și, la tastare foarte rapidă, cascada
  // render+efect a lovit „Maximum update depth" (8 aug). Acum înălțimea se scrie
  // DOAR imperativ pe nodul DOM — React nici nu are `height` în stilul de web,
  // deci n-o suprascrie la re-render.
  // iOS: înălțimea AȘEZATĂ a zonei de text (din onLayout, între INNER_BASE și
  // INNER_MAX) — decide doar derularea; NU se mai scrie în stil.
  const [composerHeight, setComposerHeight] = useState(COMPOSER_INNER_BASE);
  // Forma pastilă → dreptunghi. DOAR pe nativ trece prin state (evenimentele vin
  // rar — fix la schimbarea numărului de rânduri). Pe web NU: s-a dovedit (de
  // două ori, 8 aug) că ORICE setState din efectul de text — chiar și cu aceeași
  // valoare — dărâmă limita de actualizări React la tastare foarte rapidă, pentru
  // că scurtcircuitul „valoare identică" nu se aplică atâta timp cât există deja
  // actualizări în așteptare de la setText. Pe web forma se scrie imperativ.
  const [composerTall, setComposerTall] = useState(false);
  // Font de sistem mărit (8 oct, vezi LARGE_FONT_SCALE): caseta își centrează textul pe
  // verticală, iar butoanele de lângă ea se centrează pe pastila cu 1–3 rânduri (la
  // 4+ rânduri rămân jos, ca pe WhatsApp). Sub prag nimic nu se schimbă.
  const { fontScale: systemFontScale } = useWindowDimensions();
  const largeFont = systemFontScale > LARGE_FONT_SCALE;
  const composerRef = useRef<TextInput>(null);
  // Android: conținutul (contentSize) — înălțimea lui e nativă, min/max.
  const handleComposerSize = useCallback(
    (e: { nativeEvent: { contentSize: { height: number } } }) => {
      setComposerTall(Math.ceil(e.nativeEvent.contentSize.height) > COMPOSER_TALL_THRESHOLD);
    },
    []
  );
  // iOS: cadrul așezat al TextInput-ului (fără padding — acela e pe înveliș),
  // deci direct comparabil cu constantele COMPOSER_INNER_*.
  const handleComposerLayout = useCallback((e: LayoutChangeEvent) => {
    const laid = Math.round(e.nativeEvent.layout.height);
    setComposerHeight(laid);
    setComposerTall(laid > COMPOSER_TALL_THRESHOLD);
  }, []);
  // Overlay-urile compozitorului pe web (stil 9c, 8 aug): fade sus/jos cât timp
  // mai e text în afara vederii + indicator plutitor care apare doar la derulare.
  // Toate IMPERATIVE (lecția din Fix 3) — React doar le randează cu opacity 0.
  const fadeTopRef = useRef<View>(null);
  const fadeBottomRef = useRef<View>(null);
  const thumbRef = useRef<View>(null);
  const thumbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateFadesRef = useRef<(() => void) | null>(null);
  // Când blocarea îngheață compozitorul, inputul se demontează — la revenire
  // efectul trebuie să se re-lege de nodul DOM nou.
  const composerFrozen = !!frozenBar;
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = composerRef.current as unknown as HTMLTextAreaElement | null;
    if (!node) return;
    const wrap = node.parentElement;
    const fadeTop = fadeTopRef.current as unknown as HTMLElement | null;
    const fadeBottom = fadeBottomRef.current as unknown as HTMLElement | null;
    const thumb = thumbRef.current as unknown as HTMLElement | null;

    // Tranzițiile (formă + opacități) se pun o singură dată, tot imperativ —
    // ATENȚIE: fără „height" în listă, altfel măsurarea 0px→final ar anima urât.
    if (wrap) wrap.style.transition = 'border-radius 180ms ease';
    if (fadeTop) fadeTop.style.transition = 'opacity 150ms ease';
    if (fadeBottom) fadeBottom.style.transition = 'opacity 150ms ease';
    if (thumb) thumb.style.transition = 'opacity 300ms ease';

    const updateFades = () => {
      const canScroll = node.scrollHeight > node.clientHeight + 1;
      if (fadeTop) fadeTop.style.opacity = canScroll && node.scrollTop > 2 ? '1' : '0';
      if (fadeBottom) {
        fadeBottom.style.opacity =
          canScroll && node.scrollTop + node.clientHeight < node.scrollHeight - 2 ? '1' : '0';
      }
    };
    updateFadesRef.current = updateFades;

    const onScroll = () => {
      updateFades();
      if (!thumb) return;
      const track = node.clientHeight;
      const h = Math.max(24, (track * track) / node.scrollHeight);
      const denom = node.scrollHeight - track;
      const top = denom > 0 ? (node.scrollTop / denom) * (track - h - 16) + 8 : 8;
      thumb.style.height = `${h}px`;
      // + padding-ul învelișului: absolutul e relativ la pastilă, nu la textarea.
      thumb.style.top = `${COMPOSER_V_PADDING + top}px`;
      thumb.style.opacity = '1';
      if (thumbTimer.current) clearTimeout(thumbTimer.current);
      thumbTimer.current = setTimeout(() => {
        thumb.style.opacity = '0';
      }, 800);
    };

    node.addEventListener('scroll', onScroll);
    node.addEventListener('input', updateFades);
    return () => {
      node.removeEventListener('scroll', onScroll);
      node.removeEventListener('input', updateFades);
      if (thumbTimer.current) clearTimeout(thumbTimer.current);
      updateFadesRef.current = null;
    };
  }, [composerFrozen]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = composerRef.current as unknown as HTMLTextAreaElement | null;
    if (!node?.style) return;
    // Trucul clasic de auto-mărire: scrollHeight nu coboară sub înălțimea fixată,
    // deci măsurăm de la 0 și repunem imediat valoarea plafonată (fără cadru gol).
    node.style.height = '0px';
    const clamped = Math.min(COMPOSER_INNER_MAX, Math.max(COMPOSER_INNER_BASE, node.scrollHeight));
    node.style.height = `${clamped}px`;
    // Forma, tot imperativ: peste prag colțuri de dreptunghi, sub prag înapoi la
    // pastila din stil (string gol = câștigă clasa CSS a învelișului). Pe web
    // composerTall rămâne veșnic false → React nu atinge niciodată borderRadius.
    const wrap = node.parentElement;
    if (wrap) {
      wrap.style.borderRadius =
        clamped > COMPOSER_TALL_THRESHOLD ? `${COMPOSER_RECT_RADIUS}px` : '';
    }
    // Fade-urile depind de noua înălțime (ex. golire → dispar amândouă).
    updateFadesRef.current?.();
  }, [text]);

  // ── Menționări „@" (10 sept 2026, ca pe WhatsApp) ─────────────────────────────
  // Cursorul: ținut în ref (sursa de adevăr) + în state (derivarea interogării
  // trebuie să re-randeze). onSelectionChange e autoritatea; onChangeText îl
  // avansează provizoriu (ordinea celor două evenimente diferă între platforme,
  // iar pe web caret-ul nu emite mereu onSelectionChange) — „la coadă rămâne la coadă".
  const selectionRef = useRef({ start: 0, end: 0 });
  const [cursor, setCursor] = useState(0);
  // Selecția forțată O SINGURĂ dată după inserarea unei menționări (cursorul după
  // „@Nume "); revine la undefined la primul onSelectionChange, ca inputul să
  // rămână necontrolat pe selecție (controlat permanent = salturi pe Android).
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(
    null,
  );
  // Persoanele alese în timpul compunerii (id → nume); la trimitere rămân doar cele
  // al căror „@Nume" mai există în text (userul poate șterge o menționare manual).
  const pickedMentions = useRef(new Map<string, string>());
  const mention = useMemo(
    () => (mentionsEnabled && !editing ? mentionQueryAt(text, cursor) : null),
    [mentionsEnabled, editing, text, cursor],
  );
  const mentionQuery = mention?.query ?? null;
  // Fereastra de menționări stă în zona listei (ecranul): îi spunem doar interogarea.
  useEffect(() => {
    onMentionQueryChange(mentionQuery);
  }, [mentionQuery, onMentionQueryChange]);

  const handleChangeText = useCallback(
    (next: string) => {
      const sel = selectionRef.current;
      const atEnd = sel.end >= text.length;
      const pos = atEnd
        ? next.length
        : Math.max(0, Math.min(sel.end + (next.length - text.length), next.length));
      selectionRef.current = { start: pos, end: pos };
      setCursor(pos);
      setText(next);
      // Orice tastare după o inserare = selecția forțată nu mai are rost (plasă de
      // siguranță dacă onSelectionChange n-a apucat s-o stingă).
      setPendingSelection((prev) => (prev ? null : prev));
    },
    [text],
  );

  const handleSelectionChange = useCallback(
    (e: { nativeEvent: { selection: { start: number; end: number } } }) => {
      selectionRef.current = e.nativeEvent.selection;
      setCursor(e.nativeEvent.selection.end);
      setPendingSelection((prev) => (prev ? null : prev));
    },
    [],
  );

  // Tap pe o persoană din fereastră: „@interogare" devine „@Nume " (cu spațiu, ca
  // tastarea să continue natural), cursorul sare după ea, tastatura rămâne deschisă.
  const insertMention = useCallback(
    (user: MentionUser) => {
      const m = mentionQueryAt(text, cursor);
      if (!m) return;
      const inserted = `@${user.full_name} `;
      const next = text.slice(0, m.start) + inserted + text.slice(Math.min(cursor, text.length));
      const pos = m.start + inserted.length;
      pickedMentions.current.set(user.id, user.full_name);
      selectionRef.current = { start: pos, end: pos };
      setCursor(pos);
      setText(next);
      setPendingSelection({ start: pos, end: pos });
      composerRef.current?.focus();
    },
    [text, cursor],
  );

  const clear = useCallback(() => {
    pickedMentions.current.clear();
    selectionRef.current = { start: 0, end: 0 };
    setCursor(0);
    setText('');
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setText,
      clear,
      clearIfText: (sent: string) => {
        if (textRef.current.trim() === sent) clear();
      },
      getText: () => textRef.current,
      insertMention,
    }),
    [clear, insertMention],
  );

  const sendEnabled = (!!text.trim() || (hasPendingAttach && !editing)) && !sending;

  function handleSend() {
    if (!sendEnabled) return;
    const trimmed = text.trim();
    // Doar menționările care au supraviețuit în text (id + numele exact inserat).
    const mentions = [...pickedMentions.current]
      .filter(([, name]) => trimmed.includes(`@${name}`))
      .map(([id, name]) => ({ id, name }));
    onSubmit(trimmed, mentions);
  }

  if (frozenBar) return <>{frozenBar}</>;

  return (
    <View
      style={[
        styles.inputBar,
        largeFont && !composerTall && styles.inputBarCentered,
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
      {showCamera ? (
        <Pressable
          onPress={onPressCamera}
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
      <View
        style={[
          styles.inputWrap,
          { backgroundColor: theme.background },
          composerTall && styles.inputWrapTall,
        ]}>
        <TextInput
          ref={composerRef}
          style={[
            styles.input,
            { color: theme.text },
            largeFont && styles.inputLargeFont,
            // Nativ (Android + iOS): creștere nativă între min și max, fără
            // înălțime din state — vezi COMPOSER_* și nota de la composerHeight.
            // Web: înălțimea e gestionată imperativ (efectul de mai sus).
            Platform.OS === 'web'
              ? null
              : { minHeight: COMPOSER_INNER_BASE, maxHeight: COMPOSER_INNER_MAX },
          ]}
          value={text}
          onChangeText={handleChangeText}
          // Menționări: poziția cursorului decide dacă suntem după un „@";
          // `selection` e setat DOAR o clipă după inserarea unei menționări.
          onSelectionChange={handleSelectionChange}
          selection={pendingSelection ?? undefined}
          // Android: onContentSizeChange decide forma. iOS: onLayout (înălțimea
          // așezată) decide forma și derularea — pe Fabric, iOS emite
          // onContentSizeChange doar la schimbarea cadrului, nu la tastare.
          onContentSizeChange={Platform.OS === 'android' ? handleComposerSize : undefined}
          onLayout={Platform.OS === 'ios' ? handleComposerLayout : undefined}
          // iOS: derularea pornește de la al 4-lea rând (pragul formei), adică
          // ÎNAINTE ca textul să poată depăși plafonul — cu derularea oprită,
          // UITextView nu aduce cursorul în vedere, iar rândul 5 ar rămâne
          // ascuns. Sub prag stă oprită: altfel UITextView „saltă" (bounce
          // fantomă) și când textul încape.
          scrollEnabled={
            Platform.OS === 'ios' ? composerHeight > COMPOSER_TALL_THRESHOLD : undefined
          }
          placeholder={t('chat.inputPlaceholder')}
          placeholderTextColor={theme.textTertiary}
          // 8 oct: la font de sistem mărit, „Scrie un mesaj…" se rupea pe două rânduri
          // în pastila îngustă. Plafon 1,3× (ca antetele, 1,2×) — sub el, nicio schimbare.
          maxFontSizeMultiplier={1.3}
          multiline
          maxLength={1000}
          // id-ul DOM pe web (CSS-ul din public/index.html îi ascunde
          // scrollbarul nativ și chenarul de focus); inert pe telefon.
          nativeID="chat-composer"
        />
        {Platform.OS === 'web' ? (
          <>
            {/* Fade-urile de overflow + indicatorul plutitor (stil 9c).
                Vizibilitatea o scriu efectele, imperativ — aici doar schelet
                cu opacity 0, ca React să nu se atingă de ea la re-render. */}
            <View ref={fadeTopRef} pointerEvents="none" style={styles.composerFadeTop}>
              <LinearGradient
                colors={[theme.background, `${theme.background}00`]}
                style={styles.composerFadeFill}
              />
            </View>
            <View ref={fadeBottomRef} pointerEvents="none" style={styles.composerFadeBottom}>
              <LinearGradient
                colors={[`${theme.background}00`, theme.background]}
                style={styles.composerFadeFill}
              />
            </View>
            <View
              ref={thumbRef}
              pointerEvents="none"
              style={[
                styles.composerThumb,
                {
                  backgroundColor:
                    scheme === 'dark' ? 'rgba(123,167,224,0.45)' : 'rgba(14,58,125,0.35)',
                },
              ]}
            />
          </>
        ) : null}
      </View>
      {/* Meniul „+" (19.5) — în DREAPTA casetei text (decizie 25 iul), doar dacă
          ecranul furnizează măcar o opțiune de atașare; ascuns în modul editare. */}
      {showPlus ? (
        <Pressable
          onPress={onPressPlus}
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
          ) : editing ? (
            <Feather name="check" size={20} color="#fff" />
          ) : (
            <Feather name="send" size={19} color="#fff" />
          )}
        </LinearGradient>
      </Pressable>
    </View>
  );
}
const ChatComposer = memo(ChatComposerImpl);

/** Distanța (px) față de capătul cu mesaje noi de la care apare butonul „la ultimul mesaj". */
const SCROLL_TO_BOTTOM_THRESHOLD = 120;

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
  /**
   * Trimite un mesaj text (1.1, 7.1). `mentions` (10 sept) = persoanele menționate cu „@"
   * care mai apar în text; contextele atașate vin tot în obiect (din coada locală). Ecranul
   * adaugă mesajul în listă la succes și ÎNTOARCE rezultatul — eroarea nu se mai înghite.
   */
  onSend: (outgoing: ChatOutgoing) => Promise<ChatSendResult<M>>;
  /**
   * Menționări „@" (10 sept): persoanele propuse imediat ce se tastează „@" —
   * canal: expeditorii încărcați (cei mai recenți primii); privat: interlocutorul.
   * Fără candidați ȘI fără căutare, „@" rămâne text simplu.
   */
  mentionCandidates?: MentionUser[];
  /** Căutare în toată aplicația pentru numele care nu sunt printre candidați (≥ 2 litere). */
  searchMentionUsers?: (query: string) => Promise<MentionUser[]>;
  /**
   * Trimite o poză ca mesaj propriu (o poză = o bulă). Când lipsește, butonul de
   * atașare nu apare — așa ținem funcționalitatea oprită acolo unde n-a fost încă
   * activată (canalele, până la Etapa 9.2.4).
   */
  onSendImage?: (image: PickedImage) => Promise<ChatSendResult<M>>;
  /** Chat de grup: numele + avatarul expeditorului, lângă bulele celorlalți. */
  renderSenderName?: (message: M) => string | null;
  /** Chat de grup: rolul expeditorului („ · Rol" după nume, în prima bulă a grupului). */
  renderSenderRole?: (message: M) => string | null;
  renderSenderAvatarPath?: (message: M) => string | null;
  /** Avatarul interlocutorului, în antet (chat 1-la-1). */
  headerAvatarPath?: string | null;
  /** Id-ul interlocutorului din antet — pentru tap pe avatar → profil (chat 1-la-1). */
  headerUserId?: string;
  /** Tap pe avatar sau pe nume (antet sau bulă) → profilul acelui utilizator. Rutarea o
   * decide ecranul; mesajul însoțește id-ul (când există) ca ecranul să poată alege ruta
   * după rolul expeditorului. Din antet (chat 1-la-1) vine fără mesaj. */
  onPressUser?: (userId: string, message?: M) => void;
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
  onSendFile?: (file: PickedFile) => Promise<ChatSendResult<M>>;
  /** Tap pe cardul utilizatorului recomandat → profilul lui public; rolul REAL vine
   * cu id-ul, ca ecranul să rutueze corect (mecanic vs transportator). */
  onPressMechanic?: (mechanicId: string, role: string) => void;
  /** Faza 19.6: tap pe cardul de anunț de depanare → detaliul lui (rutare per rol). */
  onPressAnnouncement?: (announcementId: string) => void;
  /** Lipsă = fără săgeata de back (ex. Comunitatea oaspetelui, care e tab rădăcină). */
  onBack?: () => void;
  /**
   * 1.1 (B3): doar citire (oaspete) — compozitorul e înlocuit de o bară cu `label` și un
   * buton care apelează `onPress`; fără swipe-to-reply și fără meniul de mesaj; pozele
   * (`has_image`) apar ca placeholder apăsabil (`onPressPhoto`, implicit `onPress`).
   * Ecranul care îl folosește nu marchează nimic citit și nu pornește Realtime.
   */
  readOnly?: { label: string; onPress: () => void; onPressPhoto?: () => void };
  /**
   * Acțiuni din meniul contextual (tap lung pe bulă), toate opționale — o acțiune
   * apare doar dacă ecranul o furnizează (Faza 14). „Copiază" e intern (client-side).
   */
  /** Aplică editarea (RPC) după ce utilizatorul confirmă textul nou din bara de input. */
  onEditMessage?: (m: M, newContent: string) => Promise<ChatEditResult>;
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
  /** 1.1 (G): mesajul la care derulează lista la deschidere (tap pe push-ul de mențiune/
   * reply), cu aceeași evidențiere ca tap-ul pe citat. Doar dacă mesajul e în pagina
   * încărcată; altfel nu se întâmplă nimic. Așteaptă `unreadCursor` (ancora „Mesaje noi"
   * derulează prima), deci ecranul care îl dă trebuie să dea și cursorul. */
  scrollToMessageId?: string;
  /**
   * 1.1 (7.1): firul pentru coada locală a mesajelor netrimise — `conversation:<id>` sau
   * `channel:<id>`. Lipsă (oaspete) = fără coadă.
   */
  threadKey?: string;
}

/** Valorile curente ale ecranului, citite la apel de handler-ele stabile (1.1, 7.4). */
interface ChatLatest<M extends ChatMessageBase> {
  t: Translate;
  outboxKey: string | null;
  editTarget: M | null;
  replyTarget: M | null;
  hasPendingAttach: boolean;
  pendingListing: ChatScreenProps<M>['pendingListing'];
  pendingMechanic: ChatScreenProps<M>['pendingMechanic'];
  pendingAnnouncement: ChatScreenProps<M>['pendingAnnouncement'];
  onClearPendingListing?: () => void;
  onClearPendingMechanic?: () => void;
  onClearPendingAnnouncement?: () => void;
  onSend: ChatScreenProps<M>['onSend'];
  onSendImage: ChatScreenProps<M>['onSendImage'];
  onSendFile: ChatScreenProps<M>['onSendFile'];
  onEditMessage: ChatScreenProps<M>['onEditMessage'];
  onPressUser: ChatScreenProps<M>['onPressUser'];
  onPressListing: ChatScreenProps<M>['onPressListing'];
  onPressMechanic: ChatScreenProps<M>['onPressMechanic'];
  onPressAnnouncement: ChatScreenProps<M>['onPressAnnouncement'];
  readOnly: ChatScreenProps<M>['readOnly'];
  viewerPhotos: { id: string; url: string }[];
  scrollToQuoted: (quotedId: string) => void;
  handleOpenFile: (m: M) => Promise<void>;
  handleOpenVideo: (m: M) => Promise<void>;
}

/** Eroarea pentru un Alert: codurile brute („upload_failed") trec prin traducerea comună. */
function readableError(error: string): string {
  return /^[a-z0-9_]{3,40}$/.test(error) ? translateDbError(error) : error;
}

/** Cheia rândului — funcție de modul, ca FlatList să nu primească alta la fiecare randare. */
function messageKey(item: ChatMessageBase): string {
  return item.id;
}

/**
 * Fișierul local al unui atașament mai există? Doar pentru `file://` pe telefon (cache-ul
 * pickerului poate fi golit de sistem între o încercare și alta); altceva (`blob:` pe web,
 * `content://`) sau o verificare eșuată = „poate", încercăm urcarea.
 */
function localFileExists(uri: string): boolean {
  if (Platform.OS === 'web' || !uri.startsWith('file://')) return true;
  try {
    return new File(uri).exists;
  } catch {
    return true;
  }
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
  mentionCandidates,
  searchMentionUsers,
  scrollToMessageId,
  readOnly,
  threadKey,
}: ChatScreenProps<M>) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const { blockedIds, block, unblock } = useBlocked();
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
  // Video în chat (23 aug): playerul full-screen deschis (sursa = sheet-ul de poze).
  const [videoUrlOpen, setVideoUrlOpen] = useState<string | null>(null);
  const listRef = useRef<FlatList<M>>(null);
  // Butonul „la ultimul mesaj" (15 sept): apare când lista e derulată cu mai mult de
  // SCROLL_TO_BOTTOM_THRESHOLD px de la capătul cu mesaje noi. Lista e INVERSATĂ, deci
  // contentOffset.y = distanța față de cel mai nou mesaj (0 = jos de tot) — pe toate
  // platformele, inclusiv web (react-native-web întoarce lista cu scaleY(-1)).
  // Starea se scrie doar la schimbarea booleanului, nu la fiecare eveniment de scroll.
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const awayFromBottomRef = useRef(false);
  const handleListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const away = e.nativeEvent.contentOffset.y > SCROLL_TO_BOTTOM_THRESHOLD;
    if (away !== awayFromBottomRef.current) {
      awayFromBottomRef.current = away;
      setAwayFromBottom(away);
    }
  }, []);

  // ── 1.1 (7.4, AUDIT #32): compozitorul are starea lui; handler-ele către rânduri sunt
  // stabile și citesc valorile curente din `latest` (setat la fiecare randare, mai jos).
  const latest = useRef<ChatLatest<M> | null>(null);
  const composerRef = useRef<ChatComposerHandle>(null);
  // Garda de dublu-tap pe „Trimite" (starea `sending` ajunge în compozitor abia la randare).
  const sendingRef = useRef(false);
  // Interogarea „@" raportată de compozitor; fereastra de menționări e în zona listei.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  // ── 1.1 (7.1, AUDIT E.21): coada locală a mesajelor netrimise (lib/outbox.ts) ──────────
  // Fără `client_id` pe server, potrivirea bulă locală ↔ mesaj e locală: la succes ecranul
  // adaugă rândul de pe server (addMessage, după id — un rând deja livrat de Realtime nu se
  // dublează), iar intrarea iese din coadă în același pas, deci bula locală dispare. Dacă
  // Realtime livrează mesajul ÎNAINTEA răspunsului la insert, cele două bule coexistă până
  // sosește răspunsul (atunci bula locală dispare, rândul de la Realtime rămâne). Limita
  // rămasă (insert reușit, răspuns pierdut → reîncercare = dublură) e descrisă în outbox.ts.
  const outboxKey = threadKey && currentUserId ? `${currentUserId}:${threadKey}` : null;
  const [outboxEntries, setOutboxEntries] = useState<OutboxEntry[]>([]);
  useEffect(() => {
    setOutboxEntries([]);
    if (!outboxKey) return;
    return outbox.subscribe(outboxKey, setOutboxEntries);
  }, [outboxKey]);

  // Cine trimite efectiv o intrare din coadă — LEGAT de firul `key`. Ruta de conversație e
  // refolosită la navigarea spre alt fir (se schimbă doar `id`, ChatScreen nu se remontează),
  // iar callback-urile ecranului sunt ale firului CURENT: dacă între timp s-a schimbat firul,
  // nu trimitem nimic — intrarea rămâne „Netrimis" în firul ei și pleacă la redeschiderea lui.
  const senderFor = useCallback(
    (key: string): OutboxSender =>
      async (entry: OutboxEntry): Promise<OutboxSendResult> => {
        const h = latest.current;
        if (!h) return { ok: false, error: 'not_ready' };
        if (h.outboxKey !== key) return { ok: false, error: 'thread_changed' };
        const att = entry.attachments[0];
        let result: ChatSendResult<M>;
        if (att) {
          // Doar la reîncercare (nextRetryAt > 0: a mai eșuat sau a rămas de la o rulare
          // anterioară): fișierul din cache poate fi șters de sistem între timp.
          if (entry.nextRetryAt > 0 && !localFileExists(att.localUri)) {
            setToast(h.t('outbox.attachmentMissing'));
            return { ok: false, error: 'missing_file', drop: true };
          }
          if (att.kind === 'image') {
            if (!h.onSendImage) return { ok: false, error: 'unsupported', drop: true };
            result = await h.onSendImage({ uri: att.localUri, width: att.width, height: att.height });
          } else {
            if (!h.onSendFile) return { ok: false, error: 'unsupported', drop: true };
            result = await h.onSendFile({
              uri: att.localUri,
              name: att.name,
              size: att.size,
              mimeType: att.mimeType,
              durationS: att.durationS ?? null,
            });
          }
        } else {
          result = await h.onSend({
            content: entry.content,
            replyToId: entry.replyToId,
            mentions: entry.mentions,
            listingId: entry.listingId,
            mechanicId: entry.mechanicId,
            announcementId: entry.announcementId,
          });
        }
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      },
    [],
  );

  // Reîncercări automate: la deschiderea firului (după încărcare), la revenirea rețelei sau
  // a aplicației în prim-plan (retry-triggers) și pe temporizator, cu backoff și plafon de
  // încercări (outbox.ts). Sunt aceleași cereri ca trimiterea, repetate — nimic nou.
  useEffect(() => {
    if (!outboxKey || loading) return;
    const sender = senderFor(outboxKey);
    void outbox.retryAll(outboxKey, sender);
    return subscribeRetryTriggers(() => {
      void outbox.retryAll(outboxKey, sender);
    });
  }, [outboxKey, loading, senderFor]);
  const nextTimerRetryAt = useMemo(() => {
    let next: number | null = null;
    for (const e of outboxEntries) {
      if (e.status !== 'failed' || e.attempts >= outbox.MAX_TIMER_ATTEMPTS) continue;
      if (next === null || e.nextRetryAt < next) next = e.nextRetryAt;
    }
    return next;
  }, [outboxEntries]);
  // Când temporizatorul nimerește peste alt retryAll în curs (sărit), se reprogramează
  // singur — altfel, fără nicio schimbare în coadă, n-ar mai porni nimic.
  const [timerNonce, setTimerNonce] = useState(0);
  useEffect(() => {
    if (!outboxKey || loading || nextTimerRetryAt === null) return;
    let active = true;
    const timer = setTimeout(
      () => {
        void outbox
          .retryAll(outboxKey, senderFor(outboxKey), { respectBackoff: true })
          .then((ran) => {
            if (!ran && active) setTimerNonce((n) => n + 1);
          });
      },
      // După un salt, cel puțin 1 s până la următoarea încercare (nu buclă cât durează un upload).
      Math.max(timerNonce > 0 ? 1000 : 0, nextTimerRetryAt - Date.now()),
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [outboxKey, loading, nextTimerRetryAt, senderFor, timerNonce]);

  // O poză / un fișier = o bulă, tot prin coadă, în firul `ctx` (instantaneul de la începutul
  // lotului — nu firul curent, care se poate schimba în timpul lotului). `deferred`: o
  // trimitere anterioară din lot a eșuat (rețea căzută) sau firul s-a schimbat → intră direct
  // ca „Netrimis", fără încercare acum; reîncercarea o preia. `true` = trimis.
  const sendAttachment = useCallback(
    async (att: OutboxAttachment, deferred: boolean, ctx: ChatLatest<M>): Promise<boolean> => {
      const key = ctx.outboxKey;
      const entry: OutboxEntry = {
        localId: outbox.newLocalId(),
        content: '',
        replyToId: null,
        mentions: null,
        attachments: [att],
        listingId: null,
        mechanicId: null,
        announcementId: null,
        preview: null,
        status: deferred ? 'failed' : 'sending',
        attempts: 0,
        createdAt: new Date().toISOString(),
        nextRetryAt: 0,
      };
      if (key && (await outbox.enqueue(key, entry))) {
        if (deferred) return false;
        const result = await outbox.sendEntry(key, entry.localId, senderFor(key));
        return !!result?.ok;
      }
      // Fără coadă (scrierea locală a eșuat): trimitere directă, ca înainte — dar eroarea se
      // vede. Callback-urile din `ctx` sunt ale firului lotului, deci ținta e cea corectă.
      const result =
        att.kind === 'image'
          ? await ctx.onSendImage?.({ uri: att.localUri, width: att.width, height: att.height })
          : await ctx.onSendFile?.({
              uri: att.localUri,
              name: att.name,
              size: att.size,
              mimeType: att.mimeType,
              durationS: att.durationS ?? null,
            });
      if (result && !result.ok) {
        Alert.alert(ctx.t('outbox.sendFailed'), readableError(result.error));
        return false;
      }
      return true;
    },
    [senderFor],
  );

  // Tap pe bula netrimisă = retrimite acum (încercările o iau de la capăt).
  const retryPending = useCallback(
    (localId: string) => {
      const key = latest.current?.outboxKey;
      if (key) void outbox.sendEntry(key, localId, senderFor(key), { manual: true });
    },
    [senderFor],
  );
  // Apăsare lungă pe bula netrimisă = o scoate din coadă, cu confirmare.
  const discardPending = useCallback((localId: string) => {
    const h = latest.current;
    const key = h?.outboxKey;
    if (!h || !key) return;
    Alert.alert(h.t('outbox.discardTitle'), h.t('outbox.discardBody'), [
      { text: h.t('photos.cancel'), style: 'cancel' },
      {
        text: h.t('chat.delete'),
        style: 'destructive',
        onPress: () => {
          void outbox.remove(key, localId);
        },
      },
    ]);
  }, []);

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
    composerRef.current?.setText(m.content);
  }, []);
  const cancelEdit = useCallback(() => {
    setEditTarget(null);
    composerRef.current?.setText('');
  }, []);
  // Stabil (1.1, 7.4): e handler-ul de swipe al fiecărui rând — citește modul curent din `latest`.
  const enterReplyMode = useCallback((m: M) => {
    // Ca pe WhatsApp (cerere 7 aug): textul deja tastat SUPRAVIEȚUIEȘTE intrării în
    // modul reply — swipe-ul pe o bulă nu-ți mai șterge mesajul din compozitor.
    // Excepție: veneam din modul editare — acolo inputul ținea conținutul VECHIULUI
    // mesaj, care nu trebuie să devină din greșeală mesajul nou.
    if (latest.current?.editTarget) composerRef.current?.setText('');
    setEditTarget(null);
    setReplyTarget(m);
  }, []);
  const cancelReply = useCallback(() => setReplyTarget(null), []);

  // Partajare în afara aplicației (7 sept): cardul de persoană recomandată → sheet-ul
  // nativ de share (WhatsApp, Messenger…). Pe web fără Web Share API textul ajunge
  // în clipboard, de unde toast-ul.
  const handleShareContact = useCallback(
    async (m: M) => {
      const person = m.mechanic;
      if (!person) return;
      try {
        const result = await shareContact(
          { id: person.id, name: displayName(person, t), role: person.role },
          t,
        );
        if (result === 'copied') setToast(t('shareContact.copied'));
      } catch {
        Alert.alert(t('shareContact.error'));
      }
    },
    [t],
  );

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

  // Lista inversată vrea datele descrescător (cel mai nou primul = afișat jos).
  // Sortăm, nu doar inversăm: starea crește în ordinea SOSIRII (răspuns INSERT vs.
  // eveniment Realtime), deci la trimiteri rapide un mesaj putea ateriza în array
  // înaintea unuia mai vechi — gruparea compară vecinii din array și rupea grupul.
  const reversedMessages = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [messages]
  );

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

  // Tap pe butonul „la ultimul mesaj": offset 0 = capătul cu mesaje noi al listei
  // inversate. Anulăm orice salt în curs (citat/ancoră), ca retry-ul lui să nu tragă înapoi.
  const scrollToBottom = useCallback(() => {
    pendingScroll.current = null;
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // Evidențierea țintei saltului (10 sept): {id, nonce} — nonce-ul nou reaprinde
  // animația și la un al doilea tap pe același citat; se stinge singur după ~2 s.
  const [flash, setFlash] = useState<{ id: string; nonce: number } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  // Tap pe citat → derulează la mesajul original, dacă e în pagina încărcată,
  // apoi îl evidențiază scurt (ca pe WhatsApp — altfel era greu de văzut CARE e).
  // Dacă e mai vechi decât paginarea (canal, 50/pagină) → no-op discret.
  const scrollToQuoted = useCallback(
    (quotedId: string) => {
      const index = reversedMessages.findIndex((m) => m.id === quotedId);
      if (index < 0) return;
      scrollToIndexSafe(index, 0.5, true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      // Mică întârziere: evidențierea pornește când derularea (animată) a ajuns.
      flashTimer.current = setTimeout(() => {
        setFlash({ id: quotedId, nonce: Date.now() });
        flashTimer.current = setTimeout(() => setFlash(null), 2200);
      }, 260);
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

  // 1.1 (G): tap pe push-ul de mențiune/reply → derulează la mesaj și îl evidențiază
  // (aceeași cale ca tap-ul pe citat). O singură dată per id (garda e marcată abia când
  // derularea pornește, ca un re-render în cele 300 ms să n-o piardă). Pornim DUPĂ
  // încărcare și după ancora „Mesaje noi" (80 ms), ca saltul nostru să fie ultimul.
  // Mesajul poate sosi puțin după deschidere (re-abonarea Realtime la revenirea din
  // fundal): îl așteptăm câteva secunde; dacă nu apare (mai vechi decât pagina), renunțăm
  // în tăcere — și nu mai sărim nici dacă apare mai târziu, la paginarea manuală.
  const highlightDone = useRef<string | null>(null);
  const highlightWait = useRef<{ id: string; until: number } | null>(null);
  useEffect(() => {
    const target = scrollToMessageId;
    if (!target || highlightDone.current === target) return;
    if (loading || unreadCursor === undefined) return;
    if (highlightWait.current?.id !== target) {
      highlightWait.current = { id: target, until: Date.now() + 5000 };
    }
    if (!reversedMessages.some((m) => m.id === target)) {
      if (Date.now() > highlightWait.current.until) highlightDone.current = target;
      return;
    }
    const timer = setTimeout(() => {
      highlightDone.current = target;
      scrollToQuoted(target);
    }, 300);
    return () => clearTimeout(timer);
  }, [scrollToMessageId, loading, unreadCursor, reversedMessages, scrollToQuoted]);

  // URL-uri semnate pt. poze, avatare ȘI avatarele mecanicilor recomandați (19.5),
  // într-un singur batch care crește pe măsură ce sosesc mesaje noi
  // (`useSignedUrls` cere doar path-urile încă nesemnate).
  const paths = useMemo(() => {
    const imagePaths = messages.map((m) => m.image_path);
    const avatarPaths = renderSenderAvatarPath ? messages.map(renderSenderAvatarPath) : [];
    const mechanicAvatars = messages.map((m) => m.mechanic?.avatar_path);
    const listingCovers = messages.map((m) => listingCoverPath(m.listing));
    // Video (23 aug): fișierele-video intră în batch-ul semnat — URL-ul hrănește
    // thumbnail-ul bulei și playerul. Fișierele obișnuite NU (se semnează la tap).
    const videoPaths = messages.map((m) =>
      !m.deleted_at && m.file_path && isVideoFile(m.file_name, m.file_path)
        ? m.file_path
        : null,
    );
    // Miniaturile din citat (24 aug): poza/videoclipul mesajului CITAT — originalul
    // poate fi în afara paginii încărcate, deci nu ne bazăm pe path-urile de mai sus.
    const quoteMediaPaths = messages.flatMap((m) => {
      const rt = replyOf(m);
      if (!rt || rt.deleted_at) return [];
      return [
        rt.image_path ?? null,
        rt.file_path && isVideoFile(rt.file_name, rt.file_path) ? rt.file_path : null,
      ];
    });
    return [
      ...imagePaths,
      ...avatarPaths,
      ...mechanicAvatars,
      ...listingCovers,
      ...videoPaths,
      ...quoteMediaPaths,
      headerAvatarPath,
    ].filter((p): p is string => !!p);
  }, [messages, renderSenderAvatarPath, headerAvatarPath]);
  const urls = useSignedUrls(paths);

  // Faza 19.5: alegerea + validarea fișierului (mărime, blocklist) se fac AICI —
  // ecranul primește fișierul deja valid și doar îl urcă în tabelul lui.
  const handlePickFile = useCallback(async () => {
    if (!onSendFile || uploading) return;
    // Firul (cheia + callback-urile) ÎNAINTE de picker: cât e deschis, ecranul poate trece
    // în alt fir (ruta refolosită, fără remontare) — fișierul aparține firului de acum.
    const ctx = latest.current;
    if (!ctx) return;
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
    // Videoclipurile au plafonul lor mai generos și prin pickerul de fișiere —
    // aceeași limită indiferent de drumul de intrare (bula oricum devine video).
    const isVideo = isVideoFile(asset.name);
    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_FILE_SIZE;
    if (size > maxSize) {
      Alert.alert(
        t('attach.fileTooLargeTitle'),
        t('attach.fileTooLargeBody', { max: isVideo ? MAX_VIDEO_SIZE_MB : MAX_FILE_SIZE_MB }),
      );
      return;
    }
    setUploading(true);
    try {
      // 1.1 (7.1): prin coada locală — la eșec rămâne bula „Netrimis", nu se pierde nimic.
      // Firul s-a schimbat cât era deschis pickerul → intră ca „Netrimis" în firul lui
      // (cel de dinaintea pickerului), fără să plece acum.
      await sendAttachment(
        { kind: 'file', localUri: asset.uri, name: asset.name, size, mimeType: asset.mimeType },
        latest.current?.outboxKey !== ctx.outboxKey,
        ctx,
      );
    } finally {
      setUploading(false);
    }
  }, [onSendFile, uploading, t, sendAttachment]);

  // Video (23 aug): EXACT conducta de fișiere (uploadFile + mesaj cu file_path) —
  // nicio coloană nouă în DB. Compresie reală nu există în Expo Go, deci plafonul
  // de mărime E limita (50 MB, plafon propriu — cel de fișiere rămâne 10).
  // Videoclipurile sosesc din pickerul MIXT de galerie sau din „Filmează".
  // `ctx` = firul de dinaintea pickerului (vezi handlePickFile); lipsă = firul curent.
  const sendVideos = useCallback(
    async (videos: PickedVideo[], batchCtx?: ChatLatest<M> | null) => {
      if (!onSendFile || videos.length === 0) return;
      const sendable = videos.filter((v) => v.size <= MAX_VIDEO_SIZE);
      if (sendable.length < videos.length) {
        Alert.alert(
          t('attach.fileTooLargeTitle'),
          t('attach.fileTooLargeBody', { max: MAX_VIDEO_SIZE_MB }),
        );
      }
      if (sendable.length === 0) return;
      const ctx = batchCtx ?? latest.current;
      if (!ctx) return;
      setUploading(true);
      try {
      // Secvențial, ca pozele: fiecare videoclip devine mesajul lui, în ordine (prin coadă).
      // Dacă firul s-a schimbat (cât era deschis pickerul sau în timpul lotului), videoclipurile
      // intră ca „Netrimis" în firul lotului, fără să plece acum.
      let failed = false;
      for (const video of sendable) {
        if (latest.current?.outboxKey !== ctx.outboxKey) failed = true;
        const ok = await sendAttachment(
          {
            kind: 'file',
            localUri: video.uri,
            name: video.name,
            size: video.size,
            mimeType: video.mimeType,
            // Durata (secunde) pentru meta „Videoclip · 0:12" + badge-ul de pe bulă.
            durationS:
              video.durationMs !== null ? Math.round(video.durationMs / 1000) : null,
          },
          failed,
          ctx,
        );
        if (!ok) failed = true;
      }
      } finally {
        setUploading(false);
      }
    },
    [onSendFile, t, sendAttachment],
  );

  // Tap pe bula-video → playerul full-screen. URL-ul vine de regulă din batch-ul
  // semnat; fallback-ul semnează la cerere (mesaj abia sosit, batch încă pe drum).
  const handleOpenVideo = useCallback(
    async (m: M) => {
      if (!m.file_path) return;
      const known = urls[m.file_path];
      if (known) {
        setVideoUrlOpen(known);
        return;
      }
      const url = await signedUrl(m.file_path);
      if (url) setVideoUrlOpen(url);
      else setToast(t('attach.downloadError'));
    },
    [urls, t],
  );

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

  // ── Menționări „@" (10 sept 2026): textul și cursorul stau în ChatComposer (1.1, 7.4);
  // aici rămân căutarea pe server și fereastra, care se desenează peste capătul listei.
  const mentionsEnabled = !!(mentionCandidates?.length || searchMentionUsers);
  // Rezultatele de pe server pentru interogarea curentă (≥ 2 litere, debounce scurt —
  // lista locală răspunde instant, serverul completează numele care nu sunt în chat).
  const [remoteUsers, setRemoteUsers] = useState<MentionUser[]>([]);
  useEffect(() => {
    const q = mentionQuery?.trim() ?? '';
    if (!searchMentionUsers || q.length < 2) {
      setRemoteUsers((prev) => (prev.length ? [] : prev));
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      searchMentionUsers(q).then((users) => {
        if (active) setRemoteUsers(users);
      });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [mentionQuery, searchMentionUsers]);

  const mentionUsers = useMemo(() => {
    if (mentionQuery === null) return [];
    const local = mentionCandidates ?? [];
    const seen = new Set(local.map((u) => u.id));
    const merged = [
      ...local,
      ...remoteUsers.filter((u) => u.id !== currentUserId && !seen.has(u.id)),
    ];
    return rankMentionCandidates(mentionQuery, merged, 10);
  }, [mentionQuery, mentionCandidates, remoteUsers, currentUserId]);


  const insertMention = useCallback((user: MentionUser) => {
    composerRef.current?.insertMention(user);
  }, []);

  // Mesajul a plecat (în coadă sau trimis direct): compozitorul se golește, iar reply-ul și
  // cardul atașat sunt „consumate" — doar dacă sunt tot cele trimise.
  const consumeComposer = useCallback((sent: ChatOutgoing) => {
    composerRef.current?.clearIfText(sent.content);
    setReplyTarget((current) => (current && current.id === sent.replyToId ? null : current));
    const h = latest.current;
    if (!h) return;
    if (sent.listingId && h.pendingListing?.id === sent.listingId) h.onClearPendingListing?.();
    if (sent.mechanicId && h.pendingMechanic?.id === sent.mechanicId) h.onClearPendingMechanic?.();
    if (sent.announcementId && h.pendingAnnouncement?.id === sent.announcementId) {
      h.onClearPendingAnnouncement?.();
    }
  }, []);

  // 1.1 (7.1, AUDIT E.21): compozitorul se golește abia după ce mesajul e în coada locală
  // (AsyncStorage). Înainte se golea ÎNAINTEA insert-ului, iar o eroare pierdea mesajul.
  const handleSubmit = useCallback(
    async (trimmed: string, mentions: MessageMention[]) => {
      const h = latest.current;
      if (!h || sendingRef.current) return;
      const target = h.editTarget;
      if (target && h.onEditMessage) {
        // Mod editare: confirmarea de send aplică editarea în loc să trimită un mesaj nou.
        if (!trimmed) return;
        sendingRef.current = true;
        setSending(true);
        setEditTarget(null);
        composerRef.current?.clear();
        let result: ChatEditResult;
        try {
          result = await h.onEditMessage(target, trimmed);
        } catch (e) {
          result = { ok: false, error: e instanceof Error ? e.message : String(e) };
        } finally {
          sendingRef.current = false;
          setSending(false);
        }
        // Firul s-a schimbat între timp: nu repunem în compozitor un mesaj din alt fir.
        if (!result.ok && latest.current?.outboxKey === h.outboxKey) {
          // Nimic pierdut: dacă între timp nu s-a început altceva, revenim în modul editare
          // cu textul nou, gata de reîncercat.
          const now = latest.current;
          if (!composerRef.current?.getText() && !now?.editTarget && !now?.replyTarget) {
            setEditTarget(target);
            composerRef.current?.setText(trimmed);
          }
        }
        if (!result.ok) {
          Alert.alert(
            h.t('outbox.editFailed'),
            result.error ? readableError(result.error) : h.t('outbox.editFailedBody'),
          );
        }
        return;
      }
      if (!trimmed && !h.hasPendingAttach) return;
      const sent: ChatOutgoing = {
        content: trimmed,
        replyToId: h.replyTarget?.id ?? null,
        mentions: mentions.length > 0 ? mentions : null,
        listingId: h.pendingListing?.id ?? null,
        mechanicId: h.pendingMechanic?.id ?? null,
        announcementId: h.pendingAnnouncement?.id ?? null,
      };
      sendingRef.current = true;
      setSending(true);
      const key = h.outboxKey;
      const listing = h.pendingListing;
      const mechanic = h.pendingMechanic;
      const announcement = h.pendingAnnouncement;
      const entry: OutboxEntry = {
        ...sent,
        localId: outbox.newLocalId(),
        attachments: [],
        preview: {
          listing: listing
            ? { id: listing.id, title: listing.title, price: listing.price, currency: listing.currency }
            : null,
          mechanic: mechanic
            ? {
                id: mechanic.id,
                full_name: mechanic.full_name,
                deleted_at: mechanic.deleted_at,
                role: mechanic.role,
                rating_avg: mechanic.rating_avg,
                rating_count: mechanic.rating_count,
              }
            : null,
          announcement: announcement
            ? { id: announcement.id, location: announcement.location }
            : null,
        },
        status: 'sending',
        attempts: 0,
        createdAt: new Date().toISOString(),
        nextRetryAt: 0,
      };
      try {
        if (key && (await outbox.enqueue(key, entry))) {
          // Compozitorul e al firului curent: îl golim doar dacă e tot firul mesajului.
          if (latest.current?.outboxKey === key) consumeComposer(sent);
          await outbox.sendEntry(key, entry.localId, senderFor(key));
        } else {
          // Fără coadă (scrierea locală a eșuat): trimitere directă (callback-ul firului
          // mesajului, din instantaneul `h`); textul rămâne în compozitor până la succes.
          const result = await h.onSend(sent);
          if (result.ok) {
            if (latest.current?.outboxKey === key) consumeComposer(sent);
          } else {
            Alert.alert(h.t('outbox.sendFailed'), readableError(result.error));
          }
        }
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [consumeComposer, senderFor],
  );

  // `batchCtx` = firul de dinaintea pickerului (vezi handlePickFile); lipsă = firul curent.
  const sendImages = useCallback(
    async (images: PickedImage[], batchCtx?: ChatLatest<M> | null) => {
      if (!onSendImage || images.length === 0) return;
      // Max 10 poze deodată (Faza 14.8); pe Android pickerul poate ignora selectionLimit.
      const capped = images.slice(0, MAX_PHOTOS);
      if (images.length > MAX_PHOTOS) {
        Alert.alert(t('photos.limitReachedTitle'), t('photos.limitReached', { max: MAX_PHOTOS }));
      }
      const ctx = batchCtx ?? latest.current;
      if (!ctx) return;
      setUploading(true);
      try {
        // Secvențial: fiecare poză devine mesajul ei, în ordinea aleasă (prin coadă, 1.1).
        // Dacă firul s-a schimbat (cât era deschis pickerul sau în timpul lotului), pozele
        // intră ca „Netrimis" în firul lotului, fără să plece acum.
        let failed = false;
        for (const image of capped) {
          if (latest.current?.outboxKey !== ctx.outboxKey) failed = true;
          const ok = await sendAttachment(
            { kind: 'image', localUri: image.uri, width: image.width, height: image.height },
            failed,
            ctx,
          );
          if (!ok) failed = true;
        }
      } finally {
        setUploading(false);
      }
    },
    [onSendImage, t, sendAttachment],
  );

  // Sheet tematizat în locul fostului Alert.alert nativ (nestilizabil, fără
  // închidere la tap în afară); ActionSheet gestionează și amânarea pe iOS
  // (pickerul nativ nu se poate prezenta peste un Modal care încă se închide).
  const [photoSourceOpen, setPhotoSourceOpen] = useState(false);

  const handleAttach = useCallback(() => {
    if (uploading) return;
    setPhotoSourceOpen(true);
  }, [uploading]);
  const openAttachSheet = useCallback(() => setAttachOpen(true), []);

  latest.current = {
    t,
    outboxKey,
    editTarget,
    replyTarget,
    hasPendingAttach,
    pendingListing,
    pendingMechanic,
    pendingAnnouncement,
    onClearPendingListing,
    onClearPendingMechanic,
    onClearPendingAnnouncement,
    onSend,
    onSendImage,
    onSendFile,
    onEditMessage,
    onPressUser,
    onPressListing,
    onPressMechanic,
    onPressAnnouncement,
    readOnly,
    viewerPhotos,
    scrollToQuoted,
    handleOpenFile,
    handleOpenVideo,
  };

  // ── 1.1 (7.4): handler-e stabile pentru rânduri (MessageRow e memoizat) ─────────────
  const openImage = useCallback((m: M) => {
    const index = latest.current?.viewerPhotos.findIndex((p) => p.id === m.id) ?? -1;
    if (index >= 0) setViewerAt(index);
  }, []);
  const openMenu = useCallback((m: M) => setMenuMessage(m), []);
  const pressQuote = useCallback((m: M) => {
    if (m.reply_to_id) latest.current?.scrollToQuoted(m.reply_to_id);
  }, []);
  const pressUser = useCallback((m: M) => latest.current?.onPressUser?.(m.sender_id, m), []);
  const openFile = useCallback((m: M) => {
    void latest.current?.handleOpenFile(m);
  }, []);
  const openVideo = useCallback((m: M) => {
    void latest.current?.handleOpenVideo(m);
  }, []);
  const pressListing = useCallback((id: string) => latest.current?.onPressListing?.(id), []);
  const pressMechanic = useCallback(
    (id: string, role: string) => latest.current?.onPressMechanic?.(id, role),
    [],
  );
  const pressAnnouncement = useCallback(
    (id: string) => latest.current?.onPressAnnouncement?.(id),
    [],
  );
  const pressPhotoPlaceholder = useCallback(() => {
    const ro = latest.current?.readOnly;
    (ro?.onPressPhoto ?? ro?.onPress)?.();
  }, []);
  const isReadOnly = !!readOnly;
  const hasUserPress = !!onPressUser;
  const hasListingPress = !!onPressListing;
  const hasMechanicPress = !!onPressMechanic;
  const hasAnnouncementPress = !!onPressAnnouncement;

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<M>) => {
      const avatarPath = renderSenderAvatarPath?.(item) ?? null;
      // Lista e inversată: item-ul următor din array e mesajul mai VECHI.
      // Primul mesaj al fiecărei zile primește pastila de dată deasupra.
      const older = reversedMessages[index + 1];
      const showDate = !older || dayKey(older.created_at) !== dayKey(item.created_at);
      // Grupare WhatsApp (stil 7a): mesajele consecutive de la același expeditor
      // formează un grup; grupul se rupe la zi nouă, la alt expeditor și la
      // separatorul „Mesaje noi" (un grup tăiat de separator ar rămâne fără nume).
      // Intenționat FĂRĂ prag de timp (scos 9 aug): pauzele >10 min spațiau
      // vizual mesajele aceluiași expeditor — separarea în timp o dă pastila de zi.
      const isFirstOfGroup =
        showDate ||
        !older ||
        older.sender_id !== item.sender_id ||
        item.id === unreadAnchorId;
      const isMe = item.sender_id === currentUserId;
      const cover = listingCoverPath(item.listing);
      // Miniaturile din citat (24 aug): URL-urile semnate ale media citate.
      const rt = replyOf(item);
      return (
        <MessageRow
          item={item}
          isMe={isMe}
          isFirstOfGroup={isFirstOfGroup}
          dateLabel={showDate ? dateLabel(item.created_at) : null}
          isUnreadAnchor={item.id === unreadAnchorId}
          showSenderAvatar={!!renderSenderAvatarPath}
          senderName={renderSenderName?.(item) ?? null}
          senderRole={!isMe && renderSenderRole ? renderSenderRole(item) : null}
          senderAvatarUrl={avatarPath ? urls[avatarPath] : undefined}
          imageUrl={item.image_path ? urls[item.image_path] : undefined}
          mechanicAvatarUrl={
            item.mechanic?.avatar_path ? urls[item.mechanic.avatar_path] : undefined
          }
          listingCoverUrl={cover ? urls[cover] : undefined}
          fileUrl={item.file_path ? urls[item.file_path] : undefined}
          quoteImageUrl={rt?.image_path ? urls[rt.image_path] : undefined}
          quoteVideoUrl={rt?.file_path ? urls[rt.file_path] : undefined}
          quoteIsMine={rt?.sender_id === currentUserId}
          readState={
            readReceipts && isMe && !item.deleted_at
              ? readCursor &&
                new Date(readCursor).getTime() > new Date(item.created_at).getTime()
                ? 'read'
                : 'sent'
              : null
          }
          flashNonce={flash?.id === item.id ? flash.nonce : 0}
          downloadingFile={downloadingFileId === item.id}
          photoPlaceholderLabel={
            isReadOnly && item.has_image && !item.deleted_at ? t('guest.photoPlaceholder') : null
          }
          onPressPhotoPlaceholder={isReadOnly ? pressPhotoPlaceholder : undefined}
          onOpenImage={openImage}
          onOpenMenu={isReadOnly ? undefined : openMenu}
          onSwipeReply={isReadOnly ? undefined : enterReplyMode}
          onPressQuote={pressQuote}
          onPressUser={hasUserPress ? pressUser : undefined}
          onOpenFile={openFile}
          onOpenVideo={openVideo}
          onPressListing={hasListingPress ? pressListing : undefined}
          onPressMechanic={hasMechanicPress ? pressMechanic : undefined}
          onPressAnnouncement={hasAnnouncementPress ? pressAnnouncement : undefined}
        />
      );
    },
    [
      reversedMessages,
      unreadAnchorId,
      currentUserId,
      dateLabel,
      renderSenderAvatarPath,
      renderSenderName,
      renderSenderRole,
      urls,
      readReceipts,
      readCursor,
      flash,
      downloadingFileId,
      isReadOnly,
      t,
      pressPhotoPlaceholder,
      openImage,
      openMenu,
      enterReplyMode,
      pressQuote,
      hasUserPress,
      pressUser,
      openFile,
      openVideo,
      hasListingPress,
      pressListing,
      hasMechanicPress,
      pressMechanic,
      hasAnnouncementPress,
      pressAnnouncement,
    ],
  );

  // 1.1 (7.1): bulele din coada locală, sub ultimul mesaj de pe server (ListHeaderComponent
  // = capătul de JOS al listei inversate). Gruparea și pastila de zi continuă de la el.
  const pendingHeader = useMemo(() => {
    if (outboxEntries.length === 0) return null;
    const sorted = [...outboxEntries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let prev: { created_at: string; sender_id: string } | undefined = reversedMessages[0];
    const rows = sorted.map((entry) => {
      const showDate = !prev || dayKey(prev.created_at) !== dayKey(entry.createdAt);
      const isFirstOfGroup = showDate || !prev || prev.sender_id !== currentUserId;
      prev = { created_at: entry.createdAt, sender_id: currentUserId };
      const quoted = entry.replyToId
        ? messages.find((m) => m.id === entry.replyToId)
        : undefined;
      const quote = quoted
        ? quoteFrom(
            quoted,
            renderSenderName?.(quoted) ??
              (quoted.sender_id === currentUserId ? t('chat.you') : title),
          )
        : null;
      return (
        <PendingRow
          key={entry.localId}
          entry={entry}
          senderId={currentUserId}
          quote={quote}
          quoteImageUrl={quote?.image_path ? urls[quote.image_path] : undefined}
          quoteVideoUrl={quote?.file_path ? urls[quote.file_path] : undefined}
          quoteIsMine={quote?.sender_id === currentUserId}
          isFirstOfGroup={isFirstOfGroup}
          dateLabel={showDate ? dateLabel(entry.createdAt) : null}
          onRetry={retryPending}
          onDiscard={discardPending}
        />
      );
    });
    return <View>{rows}</View>;
  }, [
    outboxEntries,
    reversedMessages,
    messages,
    currentUserId,
    renderSenderName,
    t,
    title,
    urls,
    dateLabel,
    retryPending,
    discardPending,
  ]);

  const listFooter = useMemo(
    () =>
      loadingMore ? (
        <View style={styles.loadingMore}>
          <ActivityIndicator size="small" color={theme.textSecondary} />
        </View>
      ) : null,
    [loadingMore, theme.textSecondary],
  );

  // Compozitor înghețat (doar la blocker) — bara îi ține locul, compozitorul rămâne montat.
  const blockedBar = useMemo(
    () =>
      peerBlocked ? (
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
      ) : null,
    [peerBlocked, theme, t, handleUnblockPeer],
  );

  // Eticheta acoperă textul copiilor → include și subtitlul, altfel cititorul de ecran îl sare.
  const headerA11yLabel = subtitle ? `${title}, ${subtitle}` : title;
  const headerInfoContent = (
    <>
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
    </>
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={12}>
            <Feather name="chevron-left" size={26} color={theme.onHeader} />
          </Pressable>
        ) : null}
        {headerAvatarPath !== undefined ? (
          <Pressable
            onPress={onPressUser && headerUserId ? () => onPressUser(headerUserId) : undefined}
            disabled={!onPressUser || !headerUserId}
            accessibilityRole={onPressUser && headerUserId ? 'button' : undefined}
            accessibilityLabel={headerA11yLabel}
            style={styles.headerAvatarRing}>
            <Avatar
              url={headerAvatarPath ? urls[headerAvatarPath] : undefined}
              name={title}
              size={38}
              userId={headerUserId}
            />
          </Pressable>
        ) : null}
        {/* 1.1: numele + subtitlul deschid profilul, ca avatarul (doar când există profil). */}
        {onPressUser && headerUserId ? (
          <Pressable
            onPress={() => onPressUser(headerUserId)}
            accessibilityRole="button"
            accessibilityLabel={headerA11yLabel}
            style={({ pressed }) => [styles.headerInfo, pressed && { opacity: 0.7 }]}>
            {headerInfoContent}
          </Pressable>
        ) : (
          <View style={styles.headerInfo}>{headerInfoContent}</View>
        )}
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
        {/* Oaspete: pastila „Intră în cont” (HeaderProfileButton o randează în (guest)). */}
        {readOnly ? <HeaderProfileButton /> : null}
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

        {/* Zona listei: învelișul dă ancora ferestrei de menționări (absolut, jos),
            care se suprapune peste ultimele mesaje, lipită de bannere/caseta text —
            și rămâne în limitele părintelui (Android nu livrează tap-uri în afara lor). */}
        <View style={styles.flex}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.brand} />
          </View>
        ) : messages.length === 0 && outboxEntries.length === 0 ? (
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
            keyExtractor={messageKey}
            inverted
            // Pe web bara de scroll a browserului stă permanent peste chat — o
            // ascundem (lista rămâne derulabilă); pe telefon indicatorul nativ rămâne.
            showsVerticalScrollIndicator={Platform.OS !== 'web'}
            // Cu tastatura deschisă, tap-urile pe listă erau consumate de închiderea
            // tastaturii → long-press-ul pe bule nu pornea (bug 26 iul). „handled"
            // lasă gesturile să ajungă la bule; scroll-ul închide tastatura.
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.messageList}
            onEndReached={onLoadOlder}
            onEndReachedThreshold={0.3}
            // Butonul „la ultimul mesaj" (15 sept): urmărim distanța față de capătul listei.
            onScroll={handleListScroll}
            scrollEventThrottle={64}
            // Ținta (citat/ancoră necitite) poate fi nerandată → salt aproximativ + retry.
            onScrollToIndexFailed={handleScrollToIndexFailed}
            // 1.1 (7.1): bulele din coada locală — capătul de jos al listei inversate.
            ListHeaderComponent={pendingHeader}
            ListFooterComponent={listFooter}
            // 1.1 (7.4): renderItem stabil + rânduri memoizate (MessageRow).
            renderItem={renderItem}
          />
        )}
        {/* Butonul „la ultimul mesaj" (15 sept): plutește în colțul din dreapta-jos al
            listei doar când utilizatorul s-a îndepărtat de mesajele noi; cedează locul
            ferestrei de menționări (ocupă aceeași zonă). */}
        {awayFromBottom &&
        !loading &&
        messages.length > 0 &&
        mentionUsers.length === 0 ? (
          <Pressable
            onPress={scrollToBottom}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('chat.scrollToBottom')}
            style={({ pressed }) => [
              styles.scrollToBottom,
              { backgroundColor: theme.backgroundElement, borderColor: theme.separator },
              pressed && styles.scrollToBottomPressed,
            ]}>
            <MaterialIcons name="keyboard-arrow-down" size={26} color={theme.brand} />
          </Pressable>
        ) : null}
        {/* Fereastra de menționări (10 sept): apare doar cu „@" activ ȘI cu rezultate. */}
        {mentionUsers.length > 0 ? (
          <View style={styles.mentionAnchor} pointerEvents="box-none">
            <MentionPanel users={mentionUsers} onPick={insertMention} />
          </View>
        ) : null}
        </View>

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
              <Text
                style={[
                  styles.editBannerTitle,
                  {
                    color: replyTarget.sender_id
                      ? userColor(replyTarget.sender_id, scheme === 'dark' ? 'dark' : 'light')
                      : theme.brand,
                  },
                ]}
                numberOfLines={1}>
                {renderSenderName?.(replyTarget) ??
                  (replyTarget.sender_id === currentUserId ? t('chat.you') : title)}
              </Text>
              <Text
                style={[styles.editBannerText, { color: theme.textSecondary }]}
                numberOfLines={1}>
                {contextSnippet(replyTarget, t)}
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

        {readOnly ? (
          // 1.1 (B3): oaspete — fără compozitor; bara îndeamnă la cont.
          <View
            style={[
              styles.blockedBar,
              { backgroundColor: theme.barBackground, borderTopColor: theme.separator },
            ]}>
            <MaterialIcons name="lock-outline" size={16} color={theme.textSecondary} />
            <Text style={[styles.blockedBarText, { color: theme.textSecondary }]}>
              {readOnly.label}
            </Text>
            <Pressable onPress={readOnly.onPress} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.blockedBarAction, { color: theme.brand }]}>
                {t('guest.signUpCta')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <ChatComposer
            ref={composerRef}
            editing={!!editTarget}
            hasPendingAttach={hasPendingAttach}
            sending={sending}
            uploading={uploading}
            frozenBar={blockedBar}
            showCamera={!!onSendImage && !editTarget}
            onPressCamera={handleAttach}
            showPlus={
              !!(onAttachListing || onAttachMechanic || onAttachDriver || onSendFile) && !editTarget
            }
            onPressPlus={openAttachSheet}
            mentionsEnabled={mentionsEnabled}
            onMentionQueryChange={setMentionQuery}
            onSubmit={handleSubmit}
          />
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
        onShareContact={handleShareContact}
        onReply={enterReplyMode}
        onEdit={onEditMessage ? enterEditMode : undefined}
        onDelete={onDeleteMessage ? handleDelete : undefined}
        onReport={messageTable ? setReportTarget : undefined}
        onBlock={handleBlock}
        senderBlocked={menuMessage ? blockedIds.has(menuMessage.sender_id) : false}
      />

      {/* Poze ȘI video la un loc, ca pe WhatsApp (cerere user 23 aug): galeria e
          mixtă (pickerul acceptă ambele tipuri), iar „Filmează" stă lângă
          „Fă o poză". Pe web camera lipsește — rămâne doar galeria. */}
      <ActionSheet
        visible={photoSourceOpen}
        title={t('attach.mediaSourceTitle')}
        actions={[
          {
            label: t('photos.sourceLibrary'),
            icon: 'photo-library',
            onPress: async () => {
              // Firul de ACUM, înainte de picker (vezi handlePickFile).
              const ctx = latest.current;
              const media = await pickMediaFromLibrary();
              await sendImages(media.images, ctx);
              await sendVideos(media.videos, ctx);
            },
          },
          {
            label: t('photos.sourceCamera'),
            icon: 'photo-camera',
            onPress: async () => {
              const ctx = latest.current;
              await sendImages(await pickFromCamera(), ctx);
            },
          },
          ...(Platform.OS !== 'web'
            ? [
                {
                  label: t('attach.videoRecord'),
                  icon: 'videocam' as const,
                  onPress: async () => {
                    const ctx = latest.current;
                    const video = await recordVideo();
                    if (video) await sendVideos([video], ctx);
                  },
                },
              ]
            : []),
        ]}
        onClose={() => setPhotoSourceOpen(false)}
      />

      {videoUrlOpen ? (
        <VideoPlayerModal url={videoUrlOpen} onClose={() => setVideoUrlOpen(null)} />
      ) : null}

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
  // Android (RN 0.81/Fabric): lineHeight pe un Text aflat într-un RÂND flex
  // declanșează un bug de măsurare care ascunde ultimul glif — emoji-ul dintr-un
  // mesaj gen „Vai 😂" rămânea un spațiu gol (facebook/react-native#53286,
  // #53344, #53666; fix upstream în lucru). Android stă pe înălțimea implicită.
  bubbleText: { fontSize: 14, ...(Platform.OS === 'android' ? null : { lineHeight: 20 }) },
  bubbleTime: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  // Stil 7a: textul + ora pe același rând flex — la mesaje scurte bula se lățește
  // cât textul + ora; la mesaje lungi ora coboară în colțul dreapta-jos, lângă
  // ultimul rând (align-items: flex-end + auto-margin pe meta).
  textTimeRow: { flexDirection: 'row', alignItems: 'flex-end', columnGap: 12 },
  textShrink: { flexShrink: 1 },
  // Layout-ul cu font mărit (LARGE_FONT_SCALE): textul singur, ora așezată absolut în
  // colțul dreapta-jos, peste distanțierul invizibil (transparent) din capătul textului.
  textBlock: { position: 'relative' },
  // Ora intră puțin în padding-ul bulei (14/10), ca să stea în colțul dreapta-jos, la
  // ~8 px de marginea laterală și ~6 px de cea de jos (cerere user 8 oct).
  metaAbsolute: { position: 'absolute', right: -6, bottom: -4, marginLeft: 0 },
  metaSpacer: { color: 'transparent' },
  // Font mărit: textul casetei centrat pe verticală (cu `top` rămânea sus, cu gol sub el)
  // și butoanele din bară centrate pe pastila scurtă (1–3 rânduri).
  inputLargeFont: { textAlignVertical: 'center' },
  inputBarCentered: { alignItems: 'center' },
  metaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginLeft: 'auto',
  },
  // Android măsoară textul italic (sintetic — fontul n-are variantă italic) cu
  // lățimea glifelor drepte, deci îl SUBESTIMEAZĂ: la desenare textul nu mai încape
  // pe rândul măsurat, se rupe pe un al doilea rând pe care Yoga nu l-a prevăzut și
  // ultimul cuvânt dispare cu totul („This message was" fără „deleted" — bug
  // raportat 10 sept; padding-ul de 3px de dinainte acoperea doar câțiva pixeli,
  // nu un cuvânt întreg). Pe Android renunțăm la italic (gri + iconiță fac oricum
  // marcajul distinct); iOS/web măsoară corect și păstrează stilul.
  deletedText: { fontStyle: Platform.OS === 'android' ? 'normal' : 'italic', paddingRight: 3 },
  deletedIcon: { alignSelf: 'center', marginRight: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: Spacing.one },
  // Același italic sintetic ca deletedText → aceeași regulă per platformă.
  editedLabel: { fontStyle: Platform.OS === 'android' ? 'normal' : 'italic', paddingRight: 2 },
  // Evidențierea rândului la saltul din citat (10 sept): bandă absolută pe toată
  // lățimea rândului + padding-ul listei (margini negative), opacitate animată.
  flashOverlay: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    left: -Spacing.three,
    right: -Spacing.three,
    opacity: 0,
  },
  // Ancora ferestrei de menționări: jos, peste ultimele mesaje, lipită de compozitor.
  mentionAnchor: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // 1.1 (7.1): „Netrimis · Reîncearcă" sub bula netrimisă.
  failedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    marginTop: 3,
  },
  failedText: { fontSize: 12, fontWeight: '600' },
  // Butonul „la ultimul mesaj": cerc de 40, la marginea listei (peste bulele proprii,
  // ca pe WhatsApp), cu umbra mică a chip-urilor.
  scrollToBottom: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.three,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.chip,
  },
  scrollToBottomPressed: { opacity: 0.75 },
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
    // 24 aug: rând (texte + miniatura media la dreapta); fără miniatură arată identic.
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  quoteName: { fontSize: 12, fontWeight: '700' },
  quoteSnippet: { fontSize: 13 },
  quoteTextCol: { flex: 1, gap: 1 },
  // Cardul de citat MEDIA (stil 11b, 24 aug): thumbnail pătrat 52px în STÂNGA,
  // nume + meta lângă el; fără bara colorată. Culorile vin din QUOTE_TOKENS.
  quoteMedia: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 10,
    marginBottom: 6,
    minWidth: 216,
  },
  quoteMediaCol: { flex: 1, minWidth: 0, gap: 1 },
  quoteMediaName: { fontSize: 12.5, fontWeight: '800' },
  quoteMediaMeta: { fontSize: 12, fontWeight: '600' },
  quoteThumbWrap: { width: 52, height: 52, borderRadius: 8, overflow: 'hidden' },
  quoteThumb: { width: 52, height: 52, borderRadius: 8 },
  // Play-badge-ul citatului: cerc 22px centrat, fără voal pe restul cadrului (11b).
  quotePlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quotePlayBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(10,20,40,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Bula-imagine: padding 6, poza rotunjită 12 înăuntru (design 22 iul).
  bubbleImage: { paddingHorizontal: 6, paddingVertical: 6, overflow: 'hidden' },
  imageWrap: { width: 220, height: 150 },
  // Fundalul (15 oct): cât se descarcă poza (sau reîncearcă după un eșec), bula
  // arată același voal ca placeholder-ul de semnare, nu un dreptunghi gol.
  imageThumb: { width: '100%', height: '100%', borderRadius: 12, backgroundColor: '#00000015' },
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#00000015',
  },
  // Video (23 aug): tile-ul refolosește imageWrap/imageThumb; astea sunt doar
  // placeholder-ul (fără thumbnail) + butonul de play suprapus.
  videoPlaceholder: { backgroundColor: '#10151F' },
  videoPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Pastila de durată a bulei video (24 aug): refolosește stilul pastilei de oră,
  // dar în colțul stânga-jos (dreapta-jos rămâne al orei).
  videoDurationPill: { right: undefined, left: 6 },
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
  // Pastila (colțuri + padding + fundal) e a ÎNVELIȘULUI, ca zona derulabilă să
  // rămână strict între padding-uri — textul nu mai atinge marginile rotunjite.
  inputWrap: {
    flex: 1,
    borderRadius: Radius.badge,
    paddingHorizontal: 16,
    paddingVertical: COMPOSER_V_PADDING,
    overflow: 'hidden',
  },
  // De la al 4-lea rând pastila devine dreptunghi rotunjit (stil WhatsApp).
  inputWrapTall: { borderRadius: COMPOSER_RECT_RADIUS },
  // Overlay-urile compozitorului (doar web): schelet cu opacity 0 — vizibilitatea
  // și poziția indicatorului le scriu efectele, direct pe DOM.
  composerFadeTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 18, opacity: 0 },
  composerFadeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 18,
    opacity: 0,
  },
  composerFadeFill: { flex: 1 },
  composerThumb: {
    position: 'absolute',
    right: 8,
    top: COMPOSER_V_PADDING,
    width: 4,
    height: 24,
    borderRadius: Radius.circle,
    opacity: 0,
  },
  input: {
    padding: 0,
    fontSize: 14,
    lineHeight: COMPOSER_LINE_HEIGHT,
    textAlignVertical: 'top',
    // Înălțimea vine per platformă (inline): Android + iOS min/max nativ, web
    // imperativ din efectul de text — vezi COMPOSER_* și handleComposerLayout.
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
