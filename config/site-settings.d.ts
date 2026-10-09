export type Capability =
  | 'checkout'
  | 'discounts'
  | 'currency'
  | 'language'
  | 'recommendations'
  | 'recentlyViewed'
  | 'newsletter'
  | 'reviews'
  | 'filters'
  | 'variants'
  | 'mobileMenu';
export interface SiteSettings {
  performanceMetrics: {
    enabled: boolean;
    mode: 'report' | 'strict';
    afterDomMs: number;
    maxPaintMs: number;
    minPaintMs: number;
    maxEventMs: number;
  };
  locale: string;
  timezoneId: string;
  capabilities: Partial<Record<Capability, boolean>>;
  selectors: Partial<
    Record<
      | 'addToCart'
      | 'productTitle'
      | 'price'
      | 'cartCount'
      | 'cartItems'
      | 'mobileMenuToggle'
      | 'consentAccept'
      | 'main',
      string
    >
  >;
  thresholds: {
    webVitals: { lcp: number; cls: number; interactionLatency: number };
    performance: {
      ttfb: number;
      domInteractive: number;
      domContentLoaded: number;
      loadComplete: number;
    };
    lighthouse: {
      performance: number;
      accessibility: number;
      'best-practices': number;
      seo: number;
    };
    accessibility: { maxBlocking: number; maxViolations: number; maxContrastNodes: number };
    visual: { maxDiffPixelRatio: number };
  };
  inventory: {
    discoverProducts: boolean;
    productLimit: number;
    pages: Array<{
      path: string;
      type: 'home' | 'product' | 'collection' | 'search' | 'cart' | 'static';
      language?: string;
    }>;
  };
  spelling: {
    mode: 'off' | 'report' | 'strict';
    languages: ('bg' | 'en')[];
    allowWords: string[];
    acceptedFindings: string[];
    excludeSelectors: string[];
    maxFindings: number;
    ocr: {
      enabled: boolean;
      selector: string;
      minConfidence: number;
      maxImages: number;
      tessdataPath: string;
    };
  };
}
export function resolveSiteSettings(input?: unknown): SiteSettings;
export function readSiteSettings(): SiteSettings;
export const CAPABILITIES: Capability[];
