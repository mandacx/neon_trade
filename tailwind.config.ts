import type { Config } from "tailwindcss";

export default {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        levels: {
          putLow: '#EF4444',
          putInt: '#F97316',
          putCallInt: '#EAB308',
          callInt: '#84CC16',
          callHigh: '#22C55E',
          closest: '#3B82F6'
        }
      },
    },
  },
  plugins: [],
} satisfies Config;
