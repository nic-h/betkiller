import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: "var(--bk-font-sans)",
        mono: "var(--bk-font-mono)"
      },
      colors: {
        bg: "hsl(var(--bk-bg))",
        surface: "hsl(var(--bk-surface))",
        surface2: "hsl(var(--bk-surface-2))",
        border: "hsl(var(--bk-border))",
        muted: "hsl(var(--bk-muted))",
        text: "hsl(var(--bk-text))",
        accent: "hsl(var(--bk-accent))",
        success: "hsl(var(--bk-success))",
        warning: "hsl(var(--bk-warning))",
        danger: "hsl(var(--bk-danger))",
        brand: {
          bg: "hsl(var(--bk-brand-bg))",
          panel: "hsl(var(--bk-brand-panel))",
          surface: "hsl(var(--bk-brand-surface))",
          ring: "hsl(var(--bk-brand-ring))",
          muted: "hsl(var(--bk-brand-muted))",
          text: "hsl(var(--bk-brand-text))",
          blue: "hsl(var(--bk-brand-blue))",
          orange: "hsl(var(--bk-brand-orange))"
        }
      },
      borderRadius: {
        DEFAULT: "var(--bk-radius)",
        sm: "var(--bk-radius-sm)",
        lg: "var(--bk-radius-lg)",
        xl: "var(--bk-radius-xl)"
      },
      boxShadow: {
        sm: "var(--bk-shadow-sm)",
        DEFAULT: "var(--bk-shadow)"
      }
    }
  },
  prefix: "bk-"
};

export default config;
