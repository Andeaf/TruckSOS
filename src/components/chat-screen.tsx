import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface ChatMessageBase {
  id: string;
  content: string;
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
}

function MessageBubble<M extends ChatMessageBase>({
  message,
  isMe,
  accentColor,
  senderLabel,
}: MessageBubbleProps<M>) {
  const theme = useTheme();
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
            { backgroundColor: isMe ? accentColor : theme.backgroundElement },
          ]}>
          <Text style={[styles.bubbleText, { color: isMe ? '#ffffff' : theme.text }]}>
            {message.content}
          </Text>
          <Text style={[styles.bubbleTime, { color: isMe ? 'rgba(255,255,255,0.7)' : theme.textSecondary }]}>
            {formatTime(message.created_at)}
          </Text>
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
  renderSenderLabel,
  onBack,
}: ChatScreenProps<M>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  // Inverted FlatList needs data in descending order (newest first = shown at bottom)
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    await onSend(trimmed);
    setSending(false);
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
              />
            )}
          />
        )}

        <View
          style={[
            styles.inputBar,
            {
              paddingBottom: insets.bottom + Spacing.two,
              backgroundColor: theme.background,
              borderTopColor: theme.backgroundElement,
            },
          ]}>
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
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 2,
    gap: 2,
  },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTime: { fontSize: 11, alignSelf: 'flex-end' },
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
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    fontSize: 15,
    maxHeight: 120,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
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
