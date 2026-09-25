/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#0B0D10",
        surface: "#15181D",
        "surface-raised": "#1D2128",
        subtle: "#2A2E35",
        primary: "#F2F3F5",
        secondary: "#9AA0AC",
        disabled: "#5A5F68",
        accent: "#5B8CFF",
        "accent-pressed": "#4570E0",
        "stem-vocals": "#FF9F5B",
        "stem-instrumental": "#5BD1FF",
        "stem-drums": "#B778FF",
        "stem-bass": "#5BFF9F",
        "stem-other": "#FF7AC6",
        success: "#4ADE80",
        warning: "#FBBF24",
        error: "#F87171",
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        full: "999px",
      },
      fontSize: {
        xs: "12px",
        sm: "14px",
        base: "16px",
        lg: "20px",
        xl: "24px",
        "2xl": "32px",
      },
    },
  },
  plugins: [],
};