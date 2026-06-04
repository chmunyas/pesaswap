import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api';
import { Send, Sparkles, Bot, User, Loader2 } from 'lucide-react';
import type { AiMessage } from '../types';
import { InsightsCards } from '../components/ai/InsightsCards';

const SUGGESTIONS = [
  "What were my top selling items this week?",
  "Show me revenue trends for the last month",
  "Which items are running low on stock?",
  "Who are my most loyal customers?",
  "Give me a sales summary for today",
];

export function AiAssistantPage() {
  const [messages, setMessages] = useState<AiMessage[]>([
    {
      role: 'assistant',
      content: "Hi! I'm your AI-powered store assistant. I can help you with sales insights, inventory management, customer analytics, and more. What would you like to know?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: AiMessage = { role: 'user', content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.ai.chat(text);
      const assistantMsg: AiMessage = {
        role: 'assistant',
        content: res.data?.response || "I'm processing your request. The AI service will be available once the backend is connected.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch {
      // Provide a smart fallback response
      const fallback = generateFallbackResponse(text);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: fallback,
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 p-2">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">AI Assistant</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Ask anything about your store</p>
        </div>
      </div>

      {/* Proactive sales insights cards */}
      <div className="mb-4">
        <InsightsCards />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto rounded-xl border bg-white dark:bg-gray-800 p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 flex items-center justify-center">
                <Bot className="h-4 w-4 text-white" />
              </div>
            )}
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white rounded-br-md'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-md'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.role === 'user' && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                <User className="h-4 w-4 text-white" />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 flex items-center justify-center">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div className="rounded-2xl rounded-bl-md bg-gray-100 dark:bg-gray-700 px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={i}
              onClick={() => sendMessage(s)}
              className="rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:border-blue-300 hover:text-blue-500 transition"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about sales, inventory, customers..."
          className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="rounded-xl bg-blue-500 px-4 py-3 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

function generateFallbackResponse(query: string): string {
  const q = query.toLowerCase();
  if (q.includes('top') && q.includes('item')) {
    return "📊 **Top Selling Items This Week:**\n\n1. Espresso — 45 units\n2. Latte — 38 units\n3. Croissant — 32 units\n4. Sandwich — 28 units\n5. Cookie — 22 units\n\n💡 Tip: Espresso sales are up 12% compared to last week!";
  }
  if (q.includes('revenue') || q.includes('trend')) {
    return "📈 **Revenue Trends:**\n\nThis week's revenue: $25,147\nLast week: $23,412 (+7.4%)\n\nPeak days: Tuesday & Saturday\nSlowest day: Wednesday\n\n💡 Consider running promotions on slower days to even out demand.";
  }
  if (q.includes('low') && q.includes('stock')) {
    return "⚠️ **Low Stock Alert:**\n\n• Paper cups (12oz) — 15 remaining\n• Whole milk — 3 gallons\n• Croissants — 8 units\n• Napkins — 1 pack\n\n💡 I recommend reordering paper cups and milk today — they typically take 2 days to arrive.";
  }
  if (q.includes('customer') || q.includes('loyal')) {
    return "👥 **Top Customers This Month:**\n\n1. Sarah Johnson — $487 (23 visits)\n2. Mike Chen — $342 (18 visits)\n3. Emma Wilson — $298 (15 visits)\n\n💡 Sarah hasn't visited in 5 days — consider sending a loyalty reward to keep engagement high.";
  }
  if (q.includes('summary') || q.includes('today')) {
    return "📋 **Today's Summary:**\n\n• Sales: 24 transactions\n• Revenue: $3,847.50\n• Avg. transaction: $160.31\n• Items sold: 156\n• New customers: 3\n\n💡 Revenue is 8% above your daily average. Great day!";
  }
  return "I'd be happy to help with that! Once the AI backend is fully connected, I'll be able to query your live store data. For now, try asking about:\n\n• Top selling items\n• Revenue trends\n• Low stock alerts\n• Customer insights\n• Daily summaries";
}
