import { useState } from 'react';
import { formatCurrency } from '../lib/utils';
import { Search, Plus, Minus, ShoppingCart, CreditCard, DollarSign, X, Check, QrCode } from 'lucide-react';
import { PaymentQR } from '../components/qr/PaymentQR';

interface CartItem {
  item_id: number;
  name: string;
  unit_price: number;
  quantity: number;
}

const CATALOG = [
  { item_id: 1, name: 'Espresso', category: 'Beverages', unit_price: 3.50 },
  { item_id: 2, name: 'Latte', category: 'Beverages', unit_price: 4.50 },
  { item_id: 3, name: 'Cappuccino', category: 'Beverages', unit_price: 4.00 },
  { item_id: 4, name: 'Green Tea', category: 'Beverages', unit_price: 2.75 },
  { item_id: 5, name: 'Croissant', category: 'Pastries', unit_price: 3.00 },
  { item_id: 6, name: 'Muffin', category: 'Pastries', unit_price: 3.25 },
  { item_id: 7, name: 'Cookie', category: 'Pastries', unit_price: 2.50 },
  { item_id: 8, name: 'Sandwich', category: 'Food', unit_price: 7.50 },
  { item_id: 9, name: 'Salad', category: 'Food', unit_price: 8.50 },
  { item_id: 10, name: 'Bagel', category: 'Food', unit_price: 4.00 },
  { item_id: 11, name: 'Orange Juice', category: 'Beverages', unit_price: 3.50 },
  { item_id: 12, name: 'Smoothie', category: 'Beverages', unit_price: 5.50 },
];

export function PosPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [saleComplete, setSaleComplete] = useState(false);
  const [showQRPayment, setShowQRPayment] = useState(false);

  const addToCart = (item: typeof CATALOG[0]) => {
    setCart(prev => {
      const existing = prev.find(c => c.item_id === item.item_id);
      if (existing) {
        return prev.map(c => c.item_id === item.item_id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { item_id: item.item_id, name: item.name, unit_price: item.unit_price, quantity: 1 }];
    });
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart(prev => prev.map(c => {
      if (c.item_id === id) {
        const newQty = c.quantity + delta;
        return newQty > 0 ? { ...c, quantity: newQty } : c;
      }
      return c;
    }).filter(c => c.quantity > 0));
  };

  const removeFromCart = (id: number) => {
    setCart(prev => prev.filter(c => c.item_id !== id));
  };

  const total = cart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const completeSale = () => {
    setSaleComplete(true);
    setTimeout(() => {
      setCart([]);
      setSaleComplete(false);
    }, 2000);
  };

  const filteredCatalog = CATALOG.filter(item =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Product Grid */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products or scan barcode..."
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-9 pr-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition"
            autoFocus
          />
        </div>

        {/* Products */}
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredCatalog.map(item => (
              <button
                key={item.item_id}
                onClick={() => addToCart(item)}
                className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 text-left hover:border-blue-300 hover:shadow-md active:scale-95 transition-all"
              >
                <div className="text-2xl mb-2">
                  {item.category === 'Beverages' ? '☕' : item.category === 'Pastries' ? '🥐' : '🥪'}
                </div>
                <h3 className="font-medium text-sm text-gray-900 dark:text-white truncate">{item.name}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{item.category}</p>
                <p className="mt-2 text-lg font-bold text-blue-500">{formatCurrency(item.unit_price)}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cart Panel */}
      <div className="w-80 flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
        {/* Cart Header */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <ShoppingCart className="h-5 w-5 text-blue-500" />
          <h2 className="font-semibold text-gray-900 dark:text-white">Cart</h2>
          <span className="ml-auto rounded-full bg-blue-500 px-2 py-0.5 text-xs text-white font-medium">
            {itemCount}
          </span>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-auto p-3 space-y-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <ShoppingCart className="h-12 w-12 mb-2 opacity-30" />
              <p className="text-sm">Cart is empty</p>
              <p className="text-xs">Tap items to add them</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.item_id} className="flex items-center gap-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 p-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{item.name}</p>
                  <p className="text-xs text-gray-500">{formatCurrency(item.unit_price)} each</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateQuantity(item.item_id, -1)}
                    className="rounded-md p-1 hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.item_id, 1)}
                    className="rounded-md p-1 hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <span className="text-sm font-medium w-14 text-right">{formatCurrency(item.unit_price * item.quantity)}</span>
                <button
                  onClick={() => removeFromCart(item.item_id)}
                  className="rounded-md p-1 hover:bg-red-100 dark:hover:bg-red-900/20 text-red-400"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Cart Footer */}
        <div className="border-t p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Subtotal</span>
            <span className="text-sm font-medium">{formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Tax (8%)</span>
            <span className="text-sm font-medium">{formatCurrency(total * 0.08)}</span>
          </div>
          <div className="flex justify-between items-center border-t pt-2">
            <span className="font-semibold text-gray-900 dark:text-white">Total</span>
            <span className="text-xl font-bold text-blue-500">{formatCurrency(total * 1.08)}</span>
          </div>

          {/* Payment Buttons */}
          <div className="grid grid-cols-3 gap-2 pt-2">
            <button
              disabled={cart.length === 0}
              onClick={completeSale}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-green-500 px-2 py-3 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <DollarSign className="h-4 w-4" />
              Cash
            </button>
            <button
              disabled={cart.length === 0}
              onClick={completeSale}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-2 py-3 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <CreditCard className="h-4 w-4" />
              Card
            </button>
            <button
              disabled={cart.length === 0}
              onClick={() => setShowQRPayment(true)}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-purple-500 px-2 py-3 text-xs font-medium text-white hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <QrCode className="h-4 w-4" />
              QR Pay
            </button>
          </div>
        </div>

        {/* Sale Complete Overlay */}
        {saleComplete && (
          <div className="absolute inset-0 flex items-center justify-center bg-green-500/90 rounded-xl z-10">
            <div className="text-center text-white">
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3">
                <Check className="h-8 w-8" />
              </div>
              <p className="text-lg font-bold">Sale Complete!</p>
              <p className="text-sm opacity-80">{formatCurrency(total * 1.08)}</p>
            </div>
          </div>
        )}
      </div>

      {/* QR Payment Modal */}
      {showQRPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowQRPayment(false)}>
          <div className="max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <PaymentQR
              saleId={Date.now()}
              amount={total * 1.08}
              merchantName="PESASWAP"
              invoiceNumber={`POS-${Date.now().toString().slice(-6)}`}
              onPaymentConfirmed={() => {
                setShowQRPayment(false);
                completeSale();
              }}
            />
            <button
              onClick={() => setShowQRPayment(false)}
              className="w-full mt-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
