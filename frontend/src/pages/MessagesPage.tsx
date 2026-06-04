import { useEffect, useMemo, useState } from 'react';
import { Mail, Search, Send } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate } from '../lib/utils';

interface MessageRecord {
  message_id: number;
  sender: string;
  subject: string;
  preview: string;
  body: string;
  sent_at: string;
  unread: boolean;
  department: string;
}

const MOCK_MESSAGES: MessageRecord[] = [
  {
    message_id: 1,
    sender: 'Naomi Carter',
    subject: 'Register 2 drawer count complete',
    preview: 'Cash count matches expected total and receipts have been uploaded.',
    body: 'Hi team, Register 2 cash drawer has been counted and reconciled. Everything matches the expected closing amount, and I attached the receipt photos to the shift log for review.',
    sent_at: '2026-06-02T17:12:00',
    unread: true,
    department: 'Front Counter',
  },
  {
    message_id: 2,
    sender: 'Amina Yusuf',
    subject: 'Low stock alert for pastry case',
    preview: 'Croissants and muffins will need replenishment before tomorrow morning rush.',
    body: 'Croissants are down to 12 and blueberry muffins are down to 9. Please add them to the next bakery receiving so we do not run short for the commuter rush.',
    sent_at: '2026-06-02T14:45:00',
    unread: true,
    department: 'Kitchen',
  },
  {
    message_id: 3,
    sender: 'Grace Mensah',
    subject: 'Supplier delivery moved to 9 AM',
    preview: 'Blue Ridge Roasters confirmed a later drop-off for tomorrow morning.',
    body: 'Blue Ridge Roasters called to move their delivery window from 7 AM to 9 AM. Inventory team should plan receiving coverage accordingly.',
    sent_at: '2026-06-01T18:20:00',
    unread: false,
    department: 'Procurement',
  },
  {
    message_id: 4,
    sender: 'Moses Kimani',
    subject: 'POS shortcut training reminder',
    preview: 'Reminder that the 15-minute training starts at 8:30 before opening.',
    body: 'Quick reminder that the POS shortcut refresher starts at 8:30 AM in the back office. We will cover returns, suspended sales, and gift card issuance.',
    sent_at: '2026-06-01T08:05:00',
    unread: false,
    department: 'Operations',
  },
  {
    message_id: 5,
    sender: 'Fatima Omar',
    subject: 'Expense receipt uploaded',
    preview: 'Paper supply invoice for May has been uploaded to the expenses queue.',
    body: 'The May invoice for paper cups and napkins is now uploaded to the expenses module. Please tag it under Supplies when reviewing month-end entries.',
    sent_at: '2026-05-31T12:48:00',
    unread: false,
    department: 'Admin',
  },
  {
    message_id: 6,
    sender: 'Leo Grant',
    subject: 'Weekly backup succeeded',
    preview: 'Automated backup completed successfully with no integrity warnings.',
    body: 'The scheduled Sunday backup completed successfully. File integrity check passed and restore validation was clean. No action required.',
    sent_at: '2026-05-31T07:30:00',
    unread: false,
    department: 'System',
  },
];

function normalizeMessage(raw: Record<string, unknown>): MessageRecord {
  return {
    message_id: Number(raw.message_id ?? raw.id ?? 0),
    sender: String(raw.sender ?? 'Team Member'),
    subject: String(raw.subject ?? 'Message'),
    preview: String(raw.preview ?? raw.body ?? ''),
    body: String(raw.body ?? raw.preview ?? ''),
    sent_at: String(raw.sent_at ?? raw.created_at ?? new Date().toISOString()),
    unread: Boolean(raw.unread ?? false),
    department: String(raw.department ?? 'Operations'),
  };
}

export function MessagesPage() {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState<number>(MOCK_MESSAGES[0].message_id);

  useEffect(() => {
    api.messages.list()
      .then((res) => {
        const payload = Array.isArray(res.data.messages)
          ? res.data.messages.filter((message): message is Record<string, unknown> => typeof message === 'object' && message !== null)
          : [];

        const nextMessages = payload.length > 0 ? payload.map(normalizeMessage) : MOCK_MESSAGES;
        setMessages(nextMessages);
        setSelectedMessageId(nextMessages[0]?.message_id ?? 0);
      })
      .catch(() => {
        setMessages(MOCK_MESSAGES);
        setSelectedMessageId(MOCK_MESSAGES[0].message_id);
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredMessages = useMemo(() => {
    const query = search.toLowerCase();

    return messages.filter((message) => [message.sender, message.subject, message.preview, message.department].some((value) => value.toLowerCase().includes(query)));
  }, [messages, search]);

  const selectedMessage = filteredMessages.find((message) => message.message_id === selectedMessageId) ?? filteredMessages[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Messages</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Stay aligned with front-of-house, inventory, and back-office updates.</p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600">
          <Send className="h-4 w-4" />
          Compose
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {loading ? (
          <div className="flex h-96 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
          </div>
        ) : (
          <div className="grid min-h-[640px] lg:grid-cols-[340px_minmax(0,1fr)]">
            <div className="border-b border-gray-200 p-4 lg:border-b-0 lg:border-r dark:border-gray-700">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search inbox..."
                  className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
                />
              </div>

              <div className="mt-4 space-y-2">
                {filteredMessages.map((message) => (
                  <button
                    key={message.message_id}
                    onClick={() => setSelectedMessageId(message.message_id)}
                    className={`w-full rounded-xl border p-4 text-left transition ${selectedMessage?.message_id === message.message_id ? 'border-blue-500 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-900/20' : 'border-transparent hover:border-gray-200 hover:bg-gray-50 dark:hover:border-gray-700 dark:hover:bg-gray-900/40'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900 dark:text-white">{message.sender}</p>
                          {message.unread && <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />}
                        </div>
                        <p className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-200">{message.subject}</p>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{formatDate(message.sent_at)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">{message.preview}</p>
                    <p className="mt-3 text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">{message.department}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6">
              {selectedMessage ? (
                <div className="flex h-full flex-col">
                  <div className="flex items-start justify-between gap-4 border-b border-gray-200 pb-5 dark:border-gray-700">
                    <div>
                      <div className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{selectedMessage.department}</div>
                      <h2 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">{selectedMessage.subject}</h2>
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">From {selectedMessage.sender} · {formatDate(selectedMessage.sent_at)}</p>
                    </div>
                    <div className="rounded-xl bg-blue-500/10 p-3 text-blue-500">
                      <Mail className="h-5 w-5" />
                    </div>
                  </div>

                  <div className="mt-6 flex-1 rounded-xl bg-gray-50 p-5 text-sm leading-7 text-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
                    {selectedMessage.body}
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    <span>Use Messages for store announcements, shift notes, and operational follow-up.</span>
                    <button className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-blue-600">
                      <Send className="h-4 w-4" />
                      Reply
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center">
                  <Mail className="h-8 w-8 text-gray-400" />
                  <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">No messages found</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Try changing the search query to surface another conversation.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
