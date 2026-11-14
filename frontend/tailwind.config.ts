import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // "Chart room" palette: deep petrol inks, survey-marker orange, contour teal.
        petrol: {
          950: "#0B2229",
          900: "#10303A",
          800: "#163C48",
          700: "#1E4C58",
          600: "#2B6170",
        },
        mist: {
          DEFAULT: "#D9E7E5",
          muted: "#8FB0AE",
          faint: "#5F8584",
        },
        marker: {
          DEFAULT: "#FF8A3D",
          hover: "#FF9F5E",
          ink: "#2A1405",
        },
        contour: "#5ED1C4",
        alert: "#FF6B6B",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
