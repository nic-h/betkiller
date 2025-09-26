import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Fira Code"', "monospace"]
      },
      colors: {
        surface: "#f5f5f5",
        ink: "#111111"
      }
    }
  },
  plugins: []
};

export default config;
