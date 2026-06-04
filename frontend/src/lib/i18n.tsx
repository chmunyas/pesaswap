/**
 * Lightweight i18n — auto-detects browser language, falls back to English.
 * Stolen from chmunyas/merchantApp's multi-language pattern.
 * Languages: English (en), Swahili (sw), French (fr)
 */

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Locale = 'en' | 'sw' | 'fr';

type Translations = Record<string, Record<Locale, string>>;

// Customer- and merchant-facing strings used across the app.
// Keys are dot-separated for clarity; missing translations fall back to English.
export const translations: Translations = {
  // Brand
  'brand.tagline': {
    en: 'Modern Point of Sale',
    sw: 'Mfumo wa Mauzo wa Kisasa',
    fr: 'Point de Vente Moderne',
  },

  // Generic actions
  'action.pay': { en: 'Pay', sw: 'Lipa', fr: 'Payer' },
  'action.cancel': { en: 'Cancel', sw: 'Ghairi', fr: 'Annuler' },
  'action.confirm': { en: 'Confirm', sw: 'Thibitisha', fr: 'Confirmer' },
  'action.retry': { en: 'Try Again', sw: 'Jaribu Tena', fr: 'Réessayer' },
  'action.done': { en: 'Done', sw: 'Imekamilika', fr: 'Terminé' },
  'action.continue': { en: 'Continue', sw: 'Endelea', fr: 'Continuer' },
  'action.next': { en: 'Next', sw: 'Inayofuata', fr: 'Suivant' },

  // Pay page
  'pay.tapgo': { en: 'Tap & Go', sw: 'Gusa & Lipa', fr: 'Tapez & Payez' },
  'pay.scanToPay': { en: 'Scan to Pay', sw: 'Skani Kulipa', fr: 'Scanner pour Payer' },
  'pay.scanSubtitle': {
    en: "Point your camera at the merchant's QR code",
    sw: 'Elekeza kamera kwa msimbo wa QR wa muuzaji',
    fr: 'Pointez votre caméra vers le QR code du marchand',
  },
  'pay.openScanner': { en: 'Open scanner', sw: 'Fungua skana', fr: 'Ouvrir le scanner' },
  'pay.enterTillManually': {
    en: 'Enter till number manually',
    sw: 'Weka nambari ya till kwa mkono',
    fr: 'Entrer le numéro manuellement',
  },
  'pay.tillNumber': { en: 'Till / Paybill number', sw: 'Nambari ya Till', fr: 'Numéro de caisse' },
  'pay.amount': { en: 'Amount', sw: 'Kiasi', fr: 'Montant' },
  'pay.payTo': { en: 'Pay to', sw: 'Lipa kwa', fr: 'Payer à' },
  'pay.till': { en: 'Till', sw: 'Till', fr: 'Caisse' },
  'pay.yourNumber': {
    en: 'Your mobile money number',
    sw: 'Nambari yako ya pesa za simu',
    fr: 'Votre numéro mobile money',
  },
  'pay.stkHelp': {
    en: 'STK push will be sent to this number for PIN confirmation',
    sw: 'STK push itatumwa kwa nambari hii kwa uthibitisho wa PIN',
    fr: 'Une notification STK sera envoyée à ce numéro pour confirmation',
  },
  'pay.verifiedMerchant': { en: 'Verified merchant', sw: 'Muuzaji aliyethibitishwa', fr: 'Marchand vérifié' },
  'pay.tillVerified': {
    en: 'Till number confirmed',
    sw: 'Nambari ya till imethibitishwa',
    fr: 'Numéro de caisse confirmé',
  },
  'pay.confirmPay': { en: 'Confirm & Pay', sw: 'Thibitisha & Lipa', fr: 'Confirmer & Payer' },
  'pay.useFingerprint': { en: 'Use fingerprint', sw: 'Tumia alama ya kidole', fr: 'Utiliser l\u2019empreinte' },
  'pay.fastestOneTouch': {
    en: 'Fastest — one touch to pay',
    sw: 'Haraka zaidi — gusa moja kulipa',
    fr: 'Le plus rapide — un toucher pour payer',
  },
  'pay.orEnterPin': { en: 'or enter PIN', sw: 'au weka PIN', fr: 'ou entrez le PIN' },
  'pay.processing': { en: 'Processing payment...', sw: 'Inashughulikia malipo...', fr: 'Traitement du paiement...' },
  'pay.fingerprintVerified': {
    en: 'Fingerprint verified',
    sw: 'Alama ya kidole imethibitishwa',
    fr: 'Empreinte vérifiée',
  },
  'pay.checkPhone': {
    en: 'Confirming — check your phone for M-Pesa prompt',
    sw: 'Inathibitisha — angalia simu yako kwa kidokezo cha M-Pesa',
    fr: 'Confirmation — vérifiez votre téléphone pour M-Pesa',
  },
  'pay.success': { en: 'Payment successful!', sw: 'Malipo yamefanikiwa!', fr: 'Paiement réussi !' },
  'pay.failed': { en: 'Payment failed', sw: 'Malipo yameshindwa', fr: 'Paiement échoué' },
  'pay.howItWorks': { en: 'How it works', sw: 'Inavyofanya kazi', fr: 'Comment ça marche' },
  'pay.step1': { en: 'Cashier enters amount', sw: 'Mhudumu anaweka kiasi', fr: 'Le caissier saisit le montant' },
  'pay.step2': { en: 'You scan the QR code', sw: 'Unaskani msimbo wa QR', fr: 'Vous scannez le QR code' },
  'pay.step3': {
    en: 'Confirm with PIN or fingerprint',
    sw: 'Thibitisha kwa PIN au alama ya kidole',
    fr: 'Confirmez avec PIN ou empreinte',
  },
  'pay.step4': { en: 'Done! ~8 seconds total', sw: 'Imekamilika! ~sekunde 8', fr: 'Terminé ! ~8 secondes' },
  'pay.seconds': { en: 'seconds', sw: 'sekunde', fr: 'secondes' },
  'pay.fasterThan': {
    en: 'vs. 2 minutes the old way',
    sw: 'dhidi ya dakika 2 njia ya zamani',
    fr: 'vs. 2 minutes à l\u2019ancienne',
  },

  // Table pay
  'table.yourBill': { en: 'Your bill', sw: 'Bili yako', fr: 'Votre addition' },
  'table.subtotal': { en: 'Subtotal', sw: 'Jumla ndogo', fr: 'Sous-total' },
  'table.tax': { en: 'Tax', sw: 'Ushuru', fr: 'Taxe' },
  'table.total': { en: 'Total', sw: 'Jumla', fr: 'Total' },
  'table.splitBill': { en: 'Split bill', sw: 'Gawanya bili', fr: 'Partager l\u2019addition' },
  'table.justMe': { en: 'Just me', sw: 'Mimi tu', fr: 'Juste moi' },
  'table.ways': { en: 'ways', sw: 'njia', fr: 'parts' },
  'table.addTip': { en: 'Add a tip', sw: 'Ongeza bahashishi', fr: 'Ajouter un pourboire' },
  'table.none': { en: 'None', sw: 'Hakuna', fr: 'Aucun' },
  'table.tip': { en: 'tip', sw: 'bahashishi', fr: 'pourboire' },
  'table.yourShare': { en: 'Your share', sw: 'Sehemu yako', fr: 'Votre part' },
  'table.youPay': { en: 'You pay', sw: 'Unalipa', fr: 'Vous payez' },
  'table.payNow': { en: 'Pay now', sw: 'Lipa sasa', fr: 'Payer maintenant' },
  'table.allPaid': { en: 'All paid up!', sw: 'Imelipwa yote!', fr: 'Tout est payé !' },
  'table.tableClosed': { en: 'table closed', sw: 'meza imefungwa', fr: 'table fermée' },
  'table.scanFlow': {
    en: 'Scan \u21a6 Split \u21a6 Tip \u21a6 Pay — under 30 seconds',
    sw: 'Skani \u21a6 Gawanya \u21a6 Bahashishi \u21a6 Lipa — chini ya sekunde 30',
    fr: 'Scanner \u21a6 Partager \u21a6 Pourboire \u21a6 Payer — moins de 30 sec',
  },

  // KDS
  'kds.title': { en: 'Kitchen Display', sw: 'Onyesho la Jikoni', fr: 'Affichage Cuisine' },
  'kds.noOrders': {
    en: 'No active orders. Waiting for the next ticket…',
    sw: 'Hakuna agizo. Inasubiri tikiti inayofuata…',
    fr: 'Aucune commande active. En attente du prochain ticket…',
  },
  'kds.new': { en: 'New', sw: 'Mpya', fr: 'Nouveau' },
  'kds.accepted': { en: 'Accepted', sw: 'Imekubaliwa', fr: 'Acceptée' },
  'kds.preparing': { en: 'Preparing', sw: 'Inatayarishwa', fr: 'En préparation' },
  'kds.ready': { en: 'Ready', sw: 'Tayari', fr: 'Prête' },
  'kds.served': { en: 'Served', sw: 'Imeletwa', fr: 'Servie' },
  'kds.accept': { en: 'Accept', sw: 'Kubali', fr: 'Accepter' },
  'kds.markPreparing': { en: 'Start preparing', sw: 'Anza kutayarisha', fr: 'Commencer la préparation' },
  'kds.markReady': { en: 'Mark ready', sw: 'Weka kuwa tayari', fr: 'Marquer comme prête' },
  'kds.markServed': { en: 'Mark served', sw: 'Imeletwa', fr: 'Marquer comme servie' },
  'kds.cancel': { en: 'Cancel order', sw: 'Ghairi agizo', fr: 'Annuler la commande' },
};

// ============================================================
// Provider + hook
// ============================================================

const STORAGE_KEY = 'pesaswap.locale';
const SUPPORTED: Locale[] = ['en', 'sw', 'fr'];

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED.includes(stored as Locale)) return stored as Locale;
  const nav = window.navigator.language.toLowerCase().slice(0, 2);
  if (SUPPORTED.includes(nav as Locale)) return nav as Locale;
  return 'en';
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, l);
      document.documentElement.lang = l;
    }
  }

  function t(key: string, fallback?: string): string {
    const entry = translations[key];
    if (!entry) return fallback || key;
    return entry[locale] || entry.en || fallback || key;
  }

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Graceful fallback when used outside provider (e.g., during SSR)
    return {
      locale: 'en' as Locale,
      setLocale: () => {},
      t: (key: string, fallback?: string) => translations[key]?.en || fallback || key,
    };
  }
  return ctx;
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  sw: 'Kiswahili',
  fr: 'Français',
};
