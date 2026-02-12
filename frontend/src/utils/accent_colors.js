/**
 * Accent Color Utilities
 * 
 * Provides preset color palettes and dynamic shade generation
 * for the custom accent color feature.
 */

// ============================================================
// Preset Color Palettes (Tailwind-aligned shades)
// ============================================================

export const ACCENT_PRESETS = {
  // 翡翠 (Hisui) - Jade green, classic teal
  teal: {
    id: 'teal',
    name: '翡翠',
    shades: {
      50: '#f0fdfa',
      100: '#ccfbf1',
      200: '#99f6e4',
      300: '#5eead4',
      400: '#2dd4bf',
      500: '#14b8a6',
      600: '#0d9488',
      700: '#0f766e',
      800: '#115e59',
      900: '#134e4a',
    },
  },
  // 縹 (Hanada) - Traditional Japanese light indigo
  hanada: {
    id: 'hanada',
    name: '縹',
    shades: {
      50: '#f0f7ff',
      100: '#e0efff',
      200: '#baddff',
      300: '#7cc0ff',
      400: '#369eff',
      500: '#0b7aeb',
      600: '#0060c9',
      700: '#004da3',
      800: '#054186',
      900: '#0a386f',
    },
  },
  // 藤 (Fuji) - Wisteria purple, soft and elegant
  fuji: {
    id: 'fuji',
    name: '藤',
    shades: {
      50: '#faf8ff',
      100: '#f3edff',
      200: '#e9deff',
      300: '#d6c3ff',
      400: '#bb9bff',
      500: '#9d6fff',
      600: '#8b4df5',
      700: '#7839db',
      800: '#6530b8',
      900: '#542996',
    },
  },
  // 紅梅 (Kobai) - Plum blossom red, refined and warm
  kobai: {
    id: 'kobai',
    name: '紅梅',
    shades: {
      50: '#fff5f6',
      100: '#ffe8eb',
      200: '#ffd5db',
      300: '#ffb3be',
      400: '#ff849a',
      500: '#e85a78',
      600: '#d03d60',
      700: '#af2d4e',
      800: '#922846',
      900: '#7c2541',
    },
  },
  // 萌黄 (Moegi) - Fresh spring green
  moegi: {
    id: 'moegi',
    name: '萌黄',
    shades: {
      50: '#f6fce9',
      100: '#ebf8cf',
      200: '#d7f1a4',
      300: '#bce56f',
      400: '#a0d544',
      500: '#82bb27',
      600: '#64951b',
      700: '#4c7219',
      800: '#3f5a19',
      900: '#364c1a',
    },
  },
  // 山吹 (Yamabuki) - Kerria yellow, warm gold
  yamabuki: {
    id: 'yamabuki',
    name: '山吹',
    shades: {
      50: '#fffbeb',
      100: '#fff4c6',
      200: '#ffe888',
      300: '#ffd64a',
      400: '#ffc220',
      500: '#f9a007',
      600: '#dd7802',
      700: '#b75306',
      800: '#943f0c',
      900: '#7a350d',
    },
  },
  // 墨 (Sumi) - Ink black, pure and minimal
  sumi: {
    id: 'sumi',
    name: '墨',
    shades: {
      50: '#f7f7f7',
      100: '#e3e3e3',
      200: '#c8c8c8',
      300: '#a4a4a4',
      400: '#818181',
      500: '#666666',
      600: '#515151',
      700: '#434343',
      800: '#383838',
      900: '#1a1a1a',
    },
  },
};

// ============================================================
// Color Conversion Utilities
// ============================================================

/**
 * Convert hex color to HSL
 * @param {string} hex - Hex color string (#RRGGBB)
 * @returns {{ h: number, s: number, l: number }} HSL values (h: 0-360, s: 0-100, l: 0-100)
 */
export function hexToHsl(hex) {
  hex = hex.replace(/^#/, '');
  
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  
  let h = 0;
  let s = 0;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Convert HSL to hex color
 * @param {number} h - Hue (0-360)
 * @param {number} s - Saturation (0-100)
 * @param {number} l - Lightness (0-100)
 * @returns {string} Hex color string (#RRGGBB)
 */
export function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  
  let r = 0, g = 0, b = 0;
  
  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else if (h >= 300 && h < 360) {
    r = c; g = 0; b = x;
  }
  
  const toHex = (n) => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ============================================================
// Shade Generation
// ============================================================

/**
 * Generate a full shade palette from a single hex color
 * Uses the input as the 500 shade and generates others relative to it
 * @param {string} hex - Base hex color (will become shade 500)
 * @returns {Object} Shade object with keys 50-900
 */
export function generateShadesFromHex(hex) {
  const { h, s, l } = hexToHsl(hex);
  
  const shadeLightness = {
    50: 96,
    100: 90,
    200: 80,
    300: 65,
    400: 50,
    500: l,
    600: 35,
    700: 30,
    800: 25,
    900: 20,
  };
  
  const shadeSaturation = {
    50: Math.max(s * 0.3, 10),
    100: Math.max(s * 0.5, 15),
    200: Math.max(s * 0.7, 20),
    300: Math.max(s * 0.85, 30),
    400: Math.max(s * 0.95, 40),
    500: s,
    600: Math.min(s * 1.05, 100),
    700: Math.min(s * 1.1, 100),
    800: Math.min(s * 1.1, 100),
    900: Math.min(s * 1.05, 100),
  };
  
  const shades = {};
  for (const shade of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
    shades[shade] = hslToHex(h, shadeSaturation[shade], shadeLightness[shade]);
  }
  
  return shades;
}

// ============================================================
// Validation
// ============================================================

/**
 * Validate hex color format
 * @param {string} hex - Color string to validate
 * @returns {boolean} True if valid #RRGGBB format
 */
export function isValidHex(hex) {
  if (!hex || typeof hex !== 'string') return false;
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

/**
 * Normalize hex input (add # if missing, uppercase)
 * @param {string} input - User input
 * @returns {string} Normalized hex or original input if invalid
 */
export function normalizeHex(input) {
  if (!input) return '';
  let hex = input.trim();
  if (!hex.startsWith('#')) {
    hex = '#' + hex;
  }
  return hex.toUpperCase();
}

// ============================================================
// DOM Application
// ============================================================

/**
 * Apply accent color shades to document root as CSS variables
 * @param {Object} shades - Shade object with keys 50-900
 */
export function applyAccentToDOM(shades) {
  const root = document.documentElement;
  
  for (const [shade, color] of Object.entries(shades)) {
    root.style.setProperty(`--accent-${shade}`, color);
  }
}

/**
 * Get current accent shades from a preset or custom hex
 * @param {string} accentId - Preset ID or 'custom'
 * @param {string} customHex - Custom hex value (only used if accentId === 'custom')
 * @returns {Object} Shade object with keys 50-900
 */
export function getAccentShades(accentId, customHex = '') {
  if (accentId === 'custom' && isValidHex(customHex)) {
    return generateShadesFromHex(customHex);
  }
  
  const preset = ACCENT_PRESETS[accentId];
  if (preset) {
    return preset.shades;
  }
  
  return ACCENT_PRESETS.teal.shades;
}

// ============================================================
// Exports
// ============================================================

export default {
  ACCENT_PRESETS,
  hexToHsl,
  hslToHex,
  generateShadesFromHex,
  isValidHex,
  normalizeHex,
  applyAccentToDOM,
  getAccentShades,
};
